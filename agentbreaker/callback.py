from __future__ import annotations

import os
from typing import Any
from uuid import uuid4

from .detector import Detector, ToolCall
from .langchain_handler import BudgetExceededException, LoopDetectedException

try:
    from langchain_core.callbacks import BaseCallbackHandler as _CallbackBase
except ImportError:  # pragma: no cover - stdlib fallback for the zero-dep demo

    class _CallbackBase:  # type: ignore[no-redef]
        raise_error = False


class CheckmateHandler(_CallbackBase):
    """LangChain callback that blocks a tool call before it is dispatched.

    Drop-in::

        callbacks=[CheckmateHandler(session_id="pilot", max_iterations=8)]

    Identical repeats trip the loop rule. Varying arguments still die when the
    session crosses ``max_iterations``. No Supabase or API key required.
    """

    raise_error = True

    def __init__(
        self,
        session_id: str,
        loop_threshold: int = 3,
        max_iterations: int | None = 12,
        max_budget_usd: float | None = None,
        cost_per_call_usd: float = 0.0,
        telemetry_enabled: bool = False,
        agent_name: str | None = None,
        agent_slug: str | None = None,
        agent_id: str | None = None,
        telemetry_logger: Any | None = None,
    ) -> None:
        try:
            super().__init__()
        except TypeError:
            pass
        self.session_id = session_id
        self.detector = Detector(loop_threshold=loop_threshold, max_iterations=max_iterations)
        self.max_budget_usd = None if max_budget_usd is None else float(max_budget_usd)
        self.cost_per_call_usd = float(cost_per_call_usd)
        self.current_spend = 0.0
        if telemetry_logger is None and telemetry_enabled:
            from dotenv import load_dotenv

            load_dotenv()
            if not os.environ.get("SOVEREIGNHALT_INGEST_URL"):
                raise RuntimeError("SOVEREIGNHALT_INGEST_URL is required when SDK telemetry is enabled")
            from .supabase_logger import SupabaseLogger

            telemetry_logger = SupabaseLogger(
                agent_name=agent_name,
                agent_slug=agent_slug,
                agent_id=agent_id,
            )
        self.telemetry_logger = telemetry_logger

    def _record_telemetry(self, tool_name: str, decision: str, signal: str) -> None:
        if self.telemetry_logger is None:
            return
        try:
            self.telemetry_logger.record_decision(
                self.session_id,
                {
                    "action": tool_name,
                    "decision": decision,
                    "signal": signal,
                },
            )
        except Exception:
            # Telemetry transport must never change whether a tool is dispatched.
            return

    def on_tool_start(
        self,
        serialized: dict[str, Any],
        input_str: str = "",
        *,
        run_id: Any = None,
        inputs: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> None:
        del run_id, kwargs
        tool_name = str(serialized.get("name") or serialized.get("id") or "tool")
        args = inputs if isinstance(inputs, dict) else {"input": input_str}
        estimated = self.cost_per_call_usd
        if self.max_budget_usd is not None and self.current_spend + estimated > self.max_budget_usd:
            self._record_telemetry(
                tool_name,
                "budget_exceeded",
                "budget_exceeded",
            )
            raise BudgetExceededException(self.session_id, tool_name, self.current_spend, self.max_budget_usd)
        call = ToolCall(self.session_id, tool_name, args)
        decision = self.detector.evaluate(call)
        if decision.action == "blocked":
            signal = (
                "max_iterations_exceeded"
                if "max_iterations" in decision.matched_policies
                else "loop_detected"
                if "loop_and_no_progress_detection" in decision.matched_policies
                else "policy_blocked"
            )
            self._record_telemetry(tool_name, "blocked", signal)
            if "max_iterations" in decision.matched_policies:
                cap = self.detector.max_iterations or 0
                raise LoopDetectedException(
                    self.session_id,
                    tool_name,
                    call.fingerprint,
                    cap,
                    reason=f"Session exceeded max_iterations={cap} on {tool_name}",
                )
            raise LoopDetectedException(self.session_id, tool_name, call.fingerprint, self.detector.loop_threshold)
        self._record_telemetry(tool_name, "allowed", "guard_allowed")
        self.current_spend += estimated

    def guard(self, tool_name: str, args: dict[str, Any] | None = None) -> None:
        """Same check ``on_tool_start`` runs. Use this from a hand-rolled agent loop."""
        self.on_tool_start({"name": tool_name}, "", run_id=uuid4(), inputs=args or {})
