from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import uuid
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


class AgentHaltedError(RuntimeError):
    """Raised before a tool executes when the control API reports a HALT/CUT."""


class AgentStatusUnavailable(AgentHaltedError):
    """Raised when status cannot be verified and fail-closed mode is enabled."""


class SovereignHaltClient:
    """Small synchronous client for tenant-scoped telemetry and remote halt polling.

    Only keyed hashes and bounded metadata leave the agent process; raw tool arguments
    and model output are never sent. Call ``assert_active`` immediately before each
    tool dispatch. A remote halt cannot interrupt a tool already in progress.
    """

    _EVENT_TYPES = {"tool_call", "model_step", "guard_signal"}
    _SIGNALS = {"guard_allowed", "policy_blocked", "approval_required", "budget_exceeded", "max_iterations_exceeded"}
    _MAX_SIGNATURE_BYTES = 1_000_000

    def __init__(self, api_base_url: str, api_token: str, agent_id: str, *, timeout: float = 5.0, fail_closed: bool = True):
        parsed = urlsplit(api_base_url.strip())
        if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ("", "/"):
            raise ValueError("api_base_url must be an HTTPS origin without credentials, path, query or fragment")
        if not api_token or len(api_token) < 32:
            raise ValueError("api_token must be a per-agent secret")
        if not re.fullmatch(r"[A-Fa-f0-9-]{36}", str(agent_id)):
            raise ValueError("agent_id must be a UUID")
        self.origin = f"https://{parsed.netloc}"
        self.api_token = api_token
        self.agent_id = str(agent_id)
        self.timeout = max(1.0, min(float(timeout), 15.0))
        self.fail_closed = bool(fail_closed)
        self._telemetry_failed = False

    @classmethod
    def from_env(cls) -> "SovereignHaltClient":
        endpoint = os.getenv("SOVEREIGNHALT_API_V1_URL", "").strip()
        token = os.getenv("SOVEREIGNHALT_INGEST_TOKEN", "").strip()
        agent_id = os.getenv("SOVEREIGNHALT_AGENT_ID", "").strip()
        parsed = urlsplit(endpoint)
        if parsed.path != "/api/v1/telemetry" or parsed.query or parsed.fragment:
            raise RuntimeError("SOVEREIGNHALT_API_V1_URL must be the HTTPS /api/v1/telemetry endpoint")
        fail_closed = os.getenv("SOVEREIGNHALT_STATUS_FAIL_CLOSED", "true").strip().lower() not in {"0", "false", "no"}
        return cls(f"{parsed.scheme}://{parsed.netloc}", token, agent_id, fail_closed=fail_closed)

    def _request(self, method: str, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        body = None if payload is None else json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
        request = Request(
            self.origin + path,
            data=body,
            headers={
                "Authorization": f"Bearer {self.api_token}",
                "Accept": "application/json",
                **({"Content-Type": "application/json"} if body is not None else {}),
            },
            method=method,
        )
        try:
            with urlopen(request, timeout=self.timeout) as response:
                decoded = json.loads(response.read(16_384).decode("utf-8"))
                return decoded if isinstance(decoded, dict) else {}
        except HTTPError as exc:
            raise RuntimeError(f"SovereignHalt API returned HTTP {exc.code}") from None
        except (URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
            raise RuntimeError(f"SovereignHalt API request failed ({type(exc).__name__})") from None

    def check_status(self, agent_id: str | None = None) -> dict[str, Any]:
        target = str(agent_id or self.agent_id)
        if not re.fullmatch(r"[A-Fa-f0-9-]{36}", target):
            raise ValueError("agent_id must be a UUID")
        return self._request("GET", f"/api/v1/agents/{target}/status")

    @staticmethod
    def _identifier(value: str, *, fallback: str, limit: int) -> str:
        normalized = re.sub(r"[^A-Za-z0-9_.:/-]+", "_", str(value).strip())[:limit].strip("_./:-")
        return normalized or fallback

    def assert_active(self, agent_id: str | None = None) -> dict[str, Any] | None:
        if self.fail_closed and self._telemetry_failed:
            raise AgentStatusUnavailable("a prior telemetry event was not acknowledged; execution stopped")
        try:
            status = self.check_status(agent_id)
            state = str(status.get("status", "")).upper()
            if state != "ACTIVE":
                raise AgentHaltedError(f"SovereignHalt blocked execution: agent status is {state or 'unknown'}")
            return status
        except AgentHaltedError:
            raise
        except Exception as exc:
            if self.fail_closed:
                raise AgentStatusUnavailable("SovereignHalt status could not be verified; execution stopped") from exc
            return None

    def emit_event(
        self,
        *,
        action: str,
        signal: str,
        event_type: str = "tool_call",
        tool_name: str | None = None,
        args: Any = None,
        output: Any = None,
        model: str | None = None,
        latency_ms: int | None = None,
        input_tokens: int | None = None,
        output_tokens: int | None = None,
        error_code: str | None = None,
    ) -> dict[str, Any] | None:
        if signal not in self._SIGNALS or event_type not in self._EVENT_TYPES:
            raise ValueError("unsupported telemetry event type or signal")
        safe_action = self._identifier(action, fallback="tool_action", limit=96)
        safe_tool_name = self._identifier(tool_name, fallback="", limit=80) if tool_name else ""
        canonical = json.dumps({"action": action, "tool_name": tool_name, "args": args}, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
        if len(canonical) > self._MAX_SIGNATURE_BYTES:
            self._telemetry_failed = True
            return None
        tool_signature = hmac.new(self.api_token.encode("utf-8"), canonical, hashlib.sha256).hexdigest()
        output_fingerprint = None
        if output is not None:
            output_bytes = str(output).encode("utf-8", errors="replace")
            if len(output_bytes) <= self._MAX_SIGNATURE_BYTES:
                output_fingerprint = hmac.new(self.api_token.encode("utf-8"), output_bytes, hashlib.sha256).hexdigest()
        payload = {
            "event_id": str(uuid.uuid4()),
            "event_type": event_type,
            "action": safe_action,
            "signal": signal,
            "tool_signature": tool_signature,
            "token_fingerprint": output_fingerprint,
            "payload": {
                **({"tool_name": safe_tool_name} if safe_tool_name else {}),
                **({"model": str(model)[:80]} if model else {}),
                **({"latency_ms": max(0, min(int(latency_ms), 600_000))} if latency_ms is not None else {}),
                **({"input_tokens": max(0, min(int(input_tokens), 2_000_000))} if input_tokens is not None else {}),
                **({"output_tokens": max(0, min(int(output_tokens), 2_000_000))} if output_tokens is not None else {}),
                **({"error_code": self._identifier(error_code, fallback="unknown", limit=64)} if error_code else {}),
            },
        }
        try:
            result = self._request("POST", "/api/v1/telemetry", payload)
            if result.get("event_id") != payload["event_id"]:
                raise RuntimeError("SovereignHalt event acknowledgement mismatch")
            return result
        except Exception:
            self._telemetry_failed = True
            return None
