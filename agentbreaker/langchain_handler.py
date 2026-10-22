from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from .detector import Detector, ToolCall
from .supabase_logger import SupabaseLogger


class LoopDetectedException(RuntimeError):
    def __init__(self, session_id: str, tool_name: str, fingerprint: str, cycle_length: int, reason: str | None = None) -> None:
        self.session_id = session_id
        self.tool_name = tool_name
        self.fingerprint = fingerprint
        self.cycle_length = cycle_length
        message = reason or f"Loop detected for {tool_name} after {cycle_length} identical calls"
        super().__init__(message)


class BudgetExceededException(RuntimeError):
    def __init__(self, session_id: str, tool_name: str, current_spend_usd: float, max_budget_usd: float) -> None:
        self.session_id = session_id
        self.tool_name = tool_name
        self.current_spend_usd = current_spend_usd
        self.max_budget_usd = max_budget_usd
        super().__init__(f"Budget exceeded for {session_id}: ${current_spend_usd:.6f} >= ${max_budget_usd:.6f}")


@dataclass(frozen=True)
class HandlerResult:
    output: Any
    cost_usd: float


class LoopBreakerHandler:
    """Pre-dispatch handler for LangChain tools with Supabase event logging."""

    def __init__(self, session_id: str, logger: SupabaseLogger, detector: Detector | None = None, cost_per_call_usd: float = 0.0, model_name: str = "gpt-4", agent_id: str | None = None, max_budget_usd: float | None = None) -> None:
        self.session_id = session_id
        self.logger = logger
        self.detector = detector or Detector()
        self.cost_per_call_usd = float(cost_per_call_usd)
        self.model_name = model_name
        self.agent_id = agent_id
        identity_setter = getattr(self.logger, "set_agent_identity", None)
        if agent_id and callable(identity_setter):
            identity_setter(agent_id)
        self.max_budget_usd = None if max_budget_usd is None else float(max_budget_usd)
        self.current_spend = 0.0
        try:
            from slack_webhook_handler import register_session
            register_session(self.session_id, self.detector, self.logger)
        except ImportError:
            # Keep the detector usable in minimal installations without FastAPI.
            pass

    def invoke(self, tool_name: str, args: dict[str, Any], execute: Callable[[dict[str, Any]], Any]) -> HandlerResult:
        estimated_cost = self.cost_per_call_usd or self.logger.cost_calculator.estimate_cost(1, self.model_name)
        if self.max_budget_usd is not None and self.current_spend + estimated_cost > self.max_budget_usd:
            reason = "Session spend would exceed the configured budget before dispatch"
            self.logger.record_decision(self.session_id, {"action": tool_name, "decision": "budget_exceeded", "signal": "budget_exceeded", "reason": reason})
            self.logger.log_budget_exceeded(self.session_id, tool_name, estimated_cost, self.max_budget_usd)
            self.logger.pause_session(self.session_id, reason)
            raise BudgetExceededException(self.session_id, tool_name, self.current_spend, self.max_budget_usd)
        call = ToolCall(self.session_id, tool_name, args)
        decision = self.detector.evaluate(call)
        signal = (
            "max_iterations_exceeded"
            if "max_iterations" in decision.matched_policies
            else "loop_detected"
            if "loop_and_no_progress_detection" in decision.matched_policies
            else "policy_blocked"
            if decision.action == "blocked"
            else "guard_allowed"
        )
        self.logger.record_decision(
            self.session_id,
            {"action": tool_name, "decision": decision.action, "signal": signal, "reason": decision.reason},
        )
        if decision.action == "blocked":
            info = {"alert_type": "loop_detected", "cycle_length": self.detector.loop_threshold}
            self.logger.log_loop_detection(self.session_id, info, tool_name, call.fingerprint)
            self.logger.pause_session(self.session_id, decision.reason)
            try:
                from slack_webhook_handler import mark_loop_alert
                mark_loop_alert(self.session_id)
            except ImportError:
                pass
            raise LoopDetectedException(self.session_id, tool_name, call.fingerprint, self.detector.loop_threshold, reason=decision.reason)
        output = execute(args)
        self.logger.log_tool_call(self.session_id, tool_name, args, output, model_name=self.model_name, agent_id=self.agent_id)
        self.current_spend += self.logger.last_cost_usd
        return HandlerResult(output=output, cost_usd=self.logger.last_cost_usd)

    # Callback-shaped aliases for LangChain integrations.
    def on_loop(self, tool_name: str, loop_info: dict[str, Any], fingerprint: str) -> None:
        self.logger.log_loop_detection(self.session_id, loop_info, tool_name, fingerprint)
        self.logger.pause_session(self.session_id, str(loop_info.get("reason", "loop detected")))

    def on_tool_end(self, tool_name: str, args: dict[str, Any], output: Any, cost_usd: float) -> None:
        self.logger.log_tool_call(self.session_id, tool_name, args, output, model_name=self.model_name, agent_id=self.agent_id)
        self.current_spend += self.logger.last_cost_usd
