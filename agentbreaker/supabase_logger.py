from __future__ import annotations

import base64
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import hashlib
import json
import os
import re
import uuid
from pathlib import Path
from typing import Any, Protocol, TYPE_CHECKING
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

if TYPE_CHECKING:
    from .slack_alerter import SlackAlerter

from .cost_calculator import CostCalculator
from .session_ids import canonical_uuid, schema_uuid


class SupabaseLike(Protocol):
    def table(self, name: str) -> Any: ...


@dataclass(frozen=True)
class PendingWrite:
    table: str
    payload: dict[str, Any]
    error: str
    queued_at: str


class SupabaseLogger:
    """Protected SovereignHalt API transport with optional legacy table logging.

    Direct table logging is disabled unless SOVEREIGNHALT_LEGACY_DIRECT_SUPABASE
    is explicitly enabled. It requires a service-role credential; the legacy
    SUPABASE_KEY alias is accepted only when its format declares that role.
    DDL is deliberately deployed through Supabase migrations.
    """

    REQUIRED_TABLES = ("agent_sessions", "tool_execution_logs", "agent_alerts")

    @staticmethod
    def _declares_service_role(key: str) -> bool:
        """Reject public-key formats; Supabase validates the actual credential."""
        if key.startswith("sb_secret_"):
            return True
        parts = key.split(".")
        if len(parts) != 3:
            return False
        try:
            payload = parts[1] + "=" * (-len(parts[1]) % 4)
            claims = json.loads(base64.urlsafe_b64decode(payload))
        except Exception:
            return False
        return isinstance(claims, dict) and claims.get("role") == "service_role"

    def __init__(self, client: SupabaseLike | None = None, outbox_path: str | Path = ".agentbreaker-outbox.jsonl", slack_alerter: "SlackAlerter | None" = None, cost_calculator: CostCalculator | None = None, agent_name: str | None = None, agent_slug: str | None = None, agent_id: str | None = None) -> None:
        if client is None:
            from dotenv import load_dotenv
            load_dotenv()
        self.ingest_url = os.environ.get("SOVEREIGNHALT_INGEST_URL", "").strip()
        self.ingest_token = os.environ.get("SOVEREIGNHALT_INGEST_TOKEN", "").strip()
        if self.ingest_url:
            try:
                parsed_url = urlsplit(self.ingest_url)
            except ValueError as exc:
                raise RuntimeError("SOVEREIGNHALT_INGEST_URL must be a valid HTTPS ingestion endpoint") from exc
            if (
                parsed_url.scheme != "https"
                or not parsed_url.netloc
                or parsed_url.username
                or parsed_url.password
                or parsed_url.query
                or parsed_url.fragment
                or parsed_url.path != "/api/telemetry/ingest"
            ):
                raise RuntimeError(
                    "SOVEREIGNHALT_INGEST_URL must be HTTPS and end exactly with /api/telemetry/ingest"
                )
        self.agent_name = (agent_name or os.environ.get("SOVEREIGNHALT_AGENT_NAME", "")).strip()
        self.agent_slug = (agent_slug or os.environ.get("SOVEREIGNHALT_AGENT_SLUG", "")).strip().lower()
        self.agent_id = agent_id or os.environ.get("SOVEREIGNHALT_AGENT_ID") or os.environ.get("AGENT_ID")
        if client is None:
            api_ingestion_ready = bool(self.ingest_url and self.ingest_token and self.agent_name)
            legacy_direct_enabled = os.environ.get(
                "SOVEREIGNHALT_LEGACY_DIRECT_SUPABASE", ""
            ).strip().lower() in {"1", "true", "yes"}
            if legacy_direct_enabled:
                url = os.environ.get("SUPABASE_URL")
                explicit_service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
                legacy_key = os.environ.get("SUPABASE_KEY", "").strip()
                key = explicit_service_key or legacy_key
                if key and not self._declares_service_role(key):
                    raise RuntimeError(
                        "Legacy direct Supabase writes require a service-role-formatted credential; "
                        "use SUPABASE_SERVICE_ROLE_KEY."
                    )
                if url and key:
                    from supabase import create_client
                    client = create_client(url, key)
                elif not api_ingestion_ready:
                    raise RuntimeError(
                        "Enabled legacy direct mode requires SUPABASE_URL and "
                        "SUPABASE_SERVICE_ROLE_KEY, or configure protected API ingestion"
                    )
            elif not api_ingestion_ready:
                raise RuntimeError(
                    "Configure protected API ingestion, or explicitly enable legacy direct mode "
                    "with SOVEREIGNHALT_LEGACY_DIRECT_SUPABASE=true, SUPABASE_URL, and "
                    "SUPABASE_SERVICE_ROLE_KEY"
                )
        self.client: SupabaseLike | None = client
        self.outbox_path = Path(outbox_path)
        self.slack_alerter = slack_alerter
        self.cost_calculator = cost_calculator or CostCalculator.from_config_file(supabase_client=client)
        self.last_cost_usd = 0.0
        self.last_output_tokens = 0
        self.missing_tables: list[str] = []
        self._check_tables()

    def _check_tables(self) -> None:
        if self.client is None:
            self.missing_tables = list(self.REQUIRED_TABLES)
            return
        for table in self.REQUIRED_TABLES:
            try:
                self.client.table(table).select("*").limit(1).execute()
            except Exception:
                self.missing_tables.append(table)

    @property
    def schema_ready(self) -> bool:
        if self.client is None:
            return bool(self.ingest_url and self.ingest_token and self.agent_name)
        return not self.missing_tables

    @staticmethod
    def _now() -> str:
        return datetime.now(timezone.utc).isoformat()

    @staticmethod
    def _args_hash(args: dict[str, Any]) -> str:
        encoded = json.dumps(args, sort_keys=True, separators=(",", ":"), default=str).encode()
        return hashlib.sha256(encoded).hexdigest()

    def _try_write(self, table: str, payload: dict[str, Any]) -> tuple[bool, str | None]:
        if self.client is None:
            return False, "Direct Supabase writer is not configured"
        try:
            self.client.table(table).insert(payload).execute()
            return True, None
        except Exception as exc:  # noqa: BLE001 - network/client errors are queued
            return False, str(exc)

    def _write(self, table: str, payload: dict[str, Any]) -> bool:
        success, error = self._try_write(table, payload)
        if not success:
            self._queue(table, payload, error or "Supabase write failed")
        return success

    def _queue(self, table: str, payload: dict[str, Any], error: str | Exception) -> None:
        pending = PendingWrite(table, payload, str(error), self._now())
        self.outbox_path.parent.mkdir(parents=True, exist_ok=True)
        with self.outbox_path.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(asdict(pending), default=str) + "\n")

    def set_agent_identity(self, agent_id: str | None, agent_name: str | None = None, agent_slug: str | None = None) -> None:
        if agent_id:
            self.agent_id = str(agent_id)
        if agent_name:
            self.agent_name = agent_name.strip()
        if agent_slug:
            self.agent_slug = agent_slug.strip().lower()

    @staticmethod
    def _database_session_id(session_id: str) -> str | None:
        try:
            return schema_uuid(session_id, "session")
        except ValueError:
            return None

    @staticmethod
    def _dashboard_signal(decision: dict[str, Any] | str) -> str | None:
        allowed = {
            "guard_allowed",
            "loop_detected",
            "max_iterations_exceeded",
            "budget_exceeded",
            "policy_blocked",
            "approval_required",
        }
        if not isinstance(decision, dict):
            return None
        explicit = decision.get("signal")
        return explicit if isinstance(explicit, str) and explicit in allowed else None

    def _send_dashboard_decision(self, decision: dict[str, Any] | str, event_id: str) -> tuple[bool, str | None]:
        if not self.ingest_url or not self.ingest_token:
            return False, "SOVEREIGNHALT_INGEST_URL and SOVEREIGNHALT_INGEST_TOKEN are required"
        if not self.agent_name:
            return False, "SOVEREIGNHALT_AGENT_NAME is required; refusing placeholder identity"

        signal = self._dashboard_signal(decision)
        if signal is None:
            return False, "An explicit allowlisted telemetry signal is required"
        action = str(decision.get("action", "tool_call") if isinstance(decision, dict) else "tool_call")[:120]
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:/-]{0,119}", action):
            return False, "Tool action must be a bounded identifier"
        payload = {
            "event": {
                "id": event_id,
                "action": action or "tool_call",
                "signal": signal,
            },
        }
        request = Request(
            self.ingest_url,
            data=json.dumps(payload, separators=(",", ":")).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {self.ingest_token}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            method="POST",
        )
        try:
            with urlopen(request, timeout=5) as response:
                status = getattr(response, "status", 200)
                if 200 <= status < 300:
                    return True, None
                return False, f"Telemetry API returned HTTP {status}"
        except HTTPError as exc:
            return False, f"Telemetry API returned HTTP {exc.code}"
        except URLError:
            return False, "Telemetry API transport failed"
        except Exception as exc:  # noqa: BLE001 - never log request headers or tokens
            return False, f"Telemetry API request failed ({type(exc).__name__})"

    def ensure_session(self, session_id: str, company_id: str | None = None, max_budget_usd: float = 10.0) -> bool:
        database_session_id = self._database_session_id(session_id)
        if database_session_id is None:
            return False
        payload = {
            "session_id": database_session_id,
            "company_id": schema_uuid(company_id, "company") if company_id else None,
            "max_budget_usd": float(max_budget_usd),
            "current_spend_usd": 0.0,
            "is_paused": False,
            "created_at": self._now(),
        }
        try:
            self.client.table("agent_sessions").upsert(payload, on_conflict="session_id").execute()
            return True
        except Exception as exc:  # noqa: BLE001
            self._queue("agent_sessions", payload, exc)
            return False

    def log_tool_call(self, session_id: str, tool_name: str, args: dict[str, Any], output: Any, cost_usd: float | None = None, model_name: str = "gpt-4", agent_id: str | None = None) -> bool:
        database_session_id = self._database_session_id(session_id)
        if database_session_id is None:
            return False
        output_length = len(str(output))
        self.last_output_tokens = self.cost_calculator.estimate_tokens(output_length)
        self.last_cost_usd = self.cost_calculator.estimate_cost(output_length, model_name)
        payload = {
            "session_id": database_session_id,
            "tool_name": tool_name,
            "arguments_hash": self._args_hash(args),
            "cost_incurred": self.last_cost_usd,
            "model_name": model_name,
            "output_tokens_estimated": self.last_output_tokens,
            "executed_at": self._now(),
        }
        database_agent_id = canonical_uuid(agent_id)
        if database_agent_id:
            payload["agent_id"] = database_agent_id
        written = self._write("tool_execution_logs", payload)
        self.increment_session_spend(session_id, self.last_cost_usd)
        return written

    def log_loop_detection(self, session_id: str, loop_info: dict[str, Any], tool_name: str, fingerprint: str) -> bool:
        database_session_id = self._database_session_id(session_id)
        if database_session_id is None:
            return False
        payload = {
            "session_id": database_session_id,
            "alert_type": str(loop_info.get("alert_type", "loop_detected")),
            "fingerprint": fingerprint,
            "cycle_length": int(loop_info.get("cycle_length", 1)),
            "created_at": self._now(),
        }
        written = self._write("agent_alerts", payload)
        if self.slack_alerter is not None:
            self.slack_alerter.alert_loop(session_id, {**loop_info, "fingerprint": fingerprint}, tool_name)
        return written

    def log_budget_exceeded(self, session_id: str, tool_name: str, estimated_cost_usd: float, max_budget_usd: float) -> bool:
        database_session_id = self._database_session_id(session_id)
        if database_session_id is None:
            return False
        """Record a budget block without sending a loop alert to Slack."""
        payload = {
            "session_id": database_session_id,
            "alert_type": "budget_exceeded",
            "fingerprint": f"budget:{database_session_id}",
            "cycle_length": 0,
            "created_at": self._now(),
        }
        return self._write("agent_alerts", payload)

    def pause_session(self, session_id: str, reason: str) -> bool:
        database_session_id = self._database_session_id(session_id)
        if database_session_id is None:
            return False
        return self._update("agent_sessions", {"is_paused": True}, {"session_id": database_session_id}, reason=reason)

    def resume_session(self, session_id: str) -> bool:
        database_session_id = self._database_session_id(session_id)
        if database_session_id is None:
            return False
        return self._update("agent_sessions", {"is_paused": False}, {"session_id": database_session_id})

    def update_session_spend(self, session_id: str, current_spend: float) -> bool:
        database_session_id = self._database_session_id(session_id)
        if database_session_id is None:
            return False
        return self._update("agent_sessions", {"current_spend_usd": float(current_spend)}, {"session_id": database_session_id})

    def increment_session_spend(self, session_id: str, delta_usd: float) -> bool:
        database_session_id = self._database_session_id(session_id)
        if database_session_id is None:
            return False
        try:
            response = (self.client.table("agent_sessions").select("current_spend_usd")
                        .eq("session_id", database_session_id).limit(1).execute())
            rows = response.get("data") or []
            current = float((rows[0] or {}).get("current_spend_usd") or 0) if rows else 0.0
            return self._update("agent_sessions", {"current_spend_usd": round(current + float(delta_usd), 8)}, {"session_id": database_session_id})
        except Exception as exc:  # noqa: BLE001
            self._queue("agent_sessions", {"session_id": database_session_id, "spend_increment_usd": float(delta_usd)}, exc)
            return False

    def _update(self, table: str, values: dict[str, Any], filters: dict[str, Any], **context: Any) -> bool:
        try:
            query = self.client.table(table).update(values)
            for key, value in filters.items():
                query = query.eq(key, value)
            query.execute()
            return True
        except Exception as exc:  # noqa: BLE001
            self._queue(table, {**values, **filters, **context}, exc)
            return False

    def record_decision(self, session_id: str, decision: dict[str, Any] | str, timestamp: str | None = None) -> bool:
        if self.ingest_url or self.ingest_token:
            event_id = str(uuid.uuid4())
            signal = self._dashboard_signal(decision)
            if signal is None:
                return False
            requested_action = str(decision.get("action", "tool_call") if isinstance(decision, dict) else "tool_call")[:120]
            action = (
                requested_action
                if re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:/-]{0,119}", requested_action)
                else "tool_call"
            )
            success, error = self._send_dashboard_decision(decision, event_id)
            if not success:
                safe_payload = {
                    "event_id": event_id,
                    "action": action,
                    "signal": signal,
                }
                self._queue("sovereignhalt_ingest", safe_payload, error or "Telemetry API write failed")
            return success

        # Dashboard decisions are accepted only by the authenticated, per-agent API.
        # Legacy direct writes remain available for session and cost tables, not audit events.
        return False
