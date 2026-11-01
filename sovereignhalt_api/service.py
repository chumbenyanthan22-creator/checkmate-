from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import os
import re
from typing import Any
from uuid import UUID

from supabase import Client, create_client


class BackendUnavailable(RuntimeError):
    pass


class AuthenticationRequired(RuntimeError):
    pass


class AccessDenied(RuntimeError):
    pass


@dataclass(frozen=True)
class Principal:
    user_id: str
    email: str


def backend_enabled() -> bool:
    return os.getenv("SOVEREIGNHALT_TENANT_BACKEND_ENABLED", "").strip().lower() in {"1", "true", "yes"}


def create_admin_client() -> Client:
    url = os.getenv("SUPABASE_URL", "").strip()
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not url or not key:
        raise BackendUnavailable("backend configuration missing")
    try:
        return create_client(url, key)
    except Exception as exc:
        raise BackendUnavailable("backend client unavailable") from exc


def verify_user(access_token: str) -> Principal:
    if not access_token or len(access_token) > 8192:
        raise AuthenticationRequired("authentication required")
    client = create_admin_client()
    try:
        result = client.auth.get_user(access_token)
        user = getattr(result, "user", None) or getattr(getattr(result, "data", None), "user", None)
        user_id = str(getattr(user, "id", "") or "")
        email = str(getattr(user, "email", "") or "").strip().lower()
        confirmed = bool(getattr(user, "email_confirmed_at", None) or getattr(user, "confirmed_at", None))
        if not user_id or not email or not confirmed:
            raise AuthenticationRequired("authentication required")
        return Principal(user_id=user_id, email=email)
    except AuthenticationRequired:
        raise
    except Exception as exc:
        raise AuthenticationRequired("authentication required") from exc


def _rows(response: Any) -> list[dict[str, Any]]:
    data = getattr(response, "data", None)
    if isinstance(data, dict):
        return [data]
    return data if isinstance(data, list) else []


def _first(response: Any) -> dict[str, Any] | None:
    rows = _rows(response)
    return rows[0] if rows else None


def _rpc_row(response: Any) -> dict[str, Any] | None:
    return _first(response)


class Store:
    def __init__(self, client: Client):
        self.client = client

    def _require_role(self, tenant_id: str, actor_id: str, roles: set[str]) -> None:
        try:
            membership = _first(self.client.table("sh_tenant_members").select("role").eq("tenant_id", tenant_id).eq("user_id", actor_id).limit(1).execute())
        except Exception as exc:
            raise BackendUnavailable("tenant membership lookup failed") from exc
        if not membership or membership.get("role") not in roles:
            raise AccessDenied("tenant membership required")

    def lookup_agent_key(self, digest: str) -> dict[str, Any] | None:
        try:
            row = _first(self.client.table("sh_agent_api_keys").select(
                "id,tenant_id,agent_id,key_hash,scopes,expires_at,revoked_at,sh_agents!inner(workspace_id)"
            ).eq("key_hash", digest).limit(1).execute())
            if not row or row.get("revoked_at"):
                return None
            linked_agent = row.get("sh_agents") or {}
            if isinstance(linked_agent, list):
                linked_agent = linked_agent[0] if linked_agent else {}
            row["workspace_id"] = linked_agent.get("workspace_id") if isinstance(linked_agent, dict) else None
            expiry = row.get("expires_at")
            if expiry and datetime.fromisoformat(str(expiry).replace("Z", "+00:00")) <= datetime.now(timezone.utc):
                return None
            return row
        except Exception as exc:
            raise BackendUnavailable("agent credential lookup failed") from exc

    def get_agent_status(self, tenant_id: str, agent_id: str) -> dict[str, Any] | None:
        try:
            return _first(self.client.table("sh_agents").select(
                "id,status,halt_reason,halted_at,last_event_at"
            ).eq("tenant_id", tenant_id).eq("id", agent_id).limit(1).execute())
        except Exception as exc:
            raise BackendUnavailable("agent status unavailable") from exc

    def ingest(self, tenant_id: str, workspace_id: str, agent_id: str, event: dict[str, Any]) -> dict[str, Any]:
        params = {
            "p_tenant_id": tenant_id,
            "p_workspace_id": workspace_id,
            "p_agent_id": agent_id,
            "p_event_id": str(event["event_id"]),
            "p_event_type": event["event_type"],
            "p_action": event["action"],
            "p_signal": event["signal"],
            "p_tool_signature": event.get("tool_signature"),
            "p_token_fingerprint": event.get("token_fingerprint"),
            "p_event_payload": event.get("payload") or {},
        }
        try:
            row = _rpc_row(self.client.rpc("sh_ingest_agent_event", params).execute())
            if not row:
                raise BackendUnavailable("event result missing")
            return row
        except BackendUnavailable:
            raise
        except Exception as exc:
            raise BackendUnavailable("event ingestion failed") from exc

    def create_tenant(self, owner_id: str, name: str, workspace_name: str) -> dict[str, Any]:
        base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:48] or "tenant"
        suffix = os.urandom(4).hex()
        tenant_slug = f"{base}-{suffix}"
        workspace_slug = "production"
        try:
            row = _rpc_row(self.client.rpc("sh_create_tenant", {
                "p_owner_user_id": owner_id,
                "p_name": name,
                "p_tenant_slug": tenant_slug,
                "p_workspace_name": workspace_name,
                "p_workspace_slug": workspace_slug,
            }).execute())
            if not row:
                raise BackendUnavailable("tenant creation result missing")
            return row
        except BackendUnavailable:
            raise
        except Exception as exc:
            raise BackendUnavailable("tenant creation failed") from exc

    def add_member(self, tenant_id: str, actor_id: str, user_id: str, role: str) -> None:
        try:
            self._require_role(tenant_id, actor_id, {"owner", "admin"})
            result = self.client.rpc("sh_add_tenant_member", {
                "p_tenant_id": tenant_id,
                "p_actor_id": actor_id,
                "p_user_id": user_id,
                "p_role": role,
            }).execute()
            if getattr(result, "data", None) is not True:
                raise AccessDenied("membership was not granted")
        except AccessDenied:
            raise
        except Exception as exc:
            raise BackendUnavailable("membership update failed") from exc

    def create_agent(self, actor_id: str, payload: dict[str, Any], key_prefix: str, key_hash: str) -> dict[str, Any]:
        try:
            self._require_role(str(payload["tenant_id"]), actor_id, {"owner", "admin"})
            row = _rpc_row(self.client.rpc("sh_create_agent_with_key", {
                "p_tenant_id": str(payload["tenant_id"]),
                "p_workspace_id": str(payload["workspace_id"]),
                "p_actor_id": actor_id,
                "p_name": payload["name"],
                "p_slug": payload["slug"],
                "p_agent_class": payload["agent_class"],
                "p_risk_level": payload["risk_level"],
                "p_key_prefix": key_prefix,
                "p_key_hash": key_hash,
            }).execute())
            if not row:
                raise BackendUnavailable("agent creation result missing")
            return row
        except AccessDenied:
            raise
        except BackendUnavailable:
            raise
        except Exception as exc:
            raise BackendUnavailable("agent creation failed") from exc

    def add_key(self, actor_id: str, tenant_id: str, agent_id: str, key_prefix: str, key_hash: str) -> str:
        try:
            self._require_role(tenant_id, actor_id, {"owner", "admin"})
            row = _rpc_row(self.client.rpc("sh_rotate_agent_key", {
                "p_tenant_id": tenant_id,
                "p_agent_id": agent_id,
                "p_actor_id": actor_id,
                "p_key_prefix": key_prefix,
                "p_key_hash": key_hash,
            }).execute())
            if not row:
                raise BackendUnavailable("key rotation result missing")
            return str(row["api_key_id"])
        except AccessDenied:
            raise
        except Exception as exc:
            raise BackendUnavailable("agent key creation failed") from exc

    def set_status(self, actor_id: str, tenant_id: str, agent_id: str, command: str, reason_code: str) -> dict[str, Any]:
        try:
            self._require_role(tenant_id, actor_id, {"owner", "admin", "operator"})
            row = _rpc_row(self.client.rpc("sh_set_agent_status", {
                "p_tenant_id": tenant_id,
                "p_agent_id": agent_id,
                "p_actor_id": actor_id,
                "p_command": command,
                "p_reason": reason_code,
            }).execute())
            if not row:
                raise BackendUnavailable("status result missing")
            return row
        except AccessDenied:
            raise
        except BackendUnavailable:
            raise
        except Exception as exc:
            raise BackendUnavailable("status update failed") from exc

    def revoke_key(self, actor_id: str, tenant_id: str, agent_id: str, key_id: str) -> bool:
        try:
            self._require_role(tenant_id, actor_id, {"owner", "admin"})
            result = self.client.rpc("sh_revoke_agent_key", {
                "p_tenant_id": tenant_id,
                "p_agent_id": agent_id,
                "p_key_id": key_id,
                "p_actor_id": actor_id,
            }).execute()
            return bool(getattr(result, "data", False))
        except AccessDenied:
            raise
        except Exception as exc:
            raise BackendUnavailable("agent key revocation failed") from exc

    def dashboard(self, user_id: str, tenant_id: str | None = None) -> dict[str, Any]:
        try:
            members = _rows(self.client.table("sh_tenant_members").select("tenant_id,role").eq("user_id", user_id).limit(100).execute())
            allowed_ids = sorted({str(row["tenant_id"]) for row in members if row.get("tenant_id")})
            if tenant_id:
                if tenant_id not in allowed_ids:
                    raise AccessDenied("tenant membership required")
                allowed_ids = [tenant_id]
            if not allowed_ids:
                raise AccessDenied("tenant membership required")

            tenants = _rows(self.client.table("sh_tenants").select("id,name,slug,plan_code,status,created_at").in_("id", allowed_ids).eq("status", "active").execute())
            allowed_ids = sorted({str(row["id"]) for row in tenants})
            if not allowed_ids:
                raise AccessDenied("active tenant membership required")
            workspaces = _rows(self.client.table("sh_workspaces").select("id,tenant_id,name,slug,environment").in_("tenant_id", allowed_ids).limit(200).execute())
            workspace_ids = [str(row["id"]) for row in workspaces]
            if not workspace_ids:
                return {"workspace": {"id": "none", "name": "No workspace provisioned"}, "agents": [], "events": []}
            now = datetime.now(timezone.utc)
            since = now - timedelta(days=30)
            since_iso = since.isoformat()
            agents = _rows(self.client.table("sh_agents").select("id,tenant_id,workspace_id,name,slug,agent_class,risk_level,status,halt_reason,halted_at,last_event_at,created_at").in_("workspace_id", workspace_ids).order("created_at", desc=True).limit(100).execute())

            def observed_or_stopped(agent: dict[str, Any]) -> bool:
                if agent.get("status") in {"HALTED", "DISABLED"}:
                    return True
                value = agent.get("last_event_at")
                if not value:
                    return False
                try:
                    last_event = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
                    if last_event.tzinfo is None:
                        last_event = last_event.replace(tzinfo=timezone.utc)
                    return since <= last_event <= now
                except (TypeError, ValueError):
                    return False

            agents = [agent for agent in agents if observed_or_stopped(agent)]
            events = _rows(self.client.table("sh_events_log").select("id,event_id,tenant_id,workspace_id,agent_id,event_type,action,signal,event_payload,loop_flag,created_at").in_("workspace_id", workspace_ids).gte("created_at", since_iso).lte("created_at", now.isoformat()).order("created_at", desc=True).limit(250).execute())
        except AccessDenied:
            raise
        except Exception as exc:
            raise BackendUnavailable("tenant dashboard read failed") from exc

        agent_by_id = {str(row["id"]): row for row in agents}
        outcomes = {
            "guard_allowed": ("allowed", "Agent guard allowed this action"),
            "policy_blocked": ("blocked", "Agent policy blocked this action"),
            "approval_required": ("approval", "Action requires operator approval"),
            "budget_exceeded": ("blocked", "Configured agent budget was reached"),
            "max_iterations_exceeded": ("blocked", "Configured iteration limit was reached"),
            "operator_halt": ("blocked", "Operator issued HALT"),
            "operator_cut": ("blocked", "Operator issued CUT"),
            "operator_resume": ("allowed", "Operator resumed the agent"),
        }
        mapped_events = []
        for row in events:
            agent = agent_by_id.get(str(row.get("agent_id")))
            if not agent:
                continue
            signal = "loop_detected" if row.get("loop_flag") else str(row.get("signal", ""))
            if signal == "loop_detected":
                outcome, detail = "blocked", "Server detected five consecutive matching tool signatures or token fingerprints; agent halted"
            else:
                outcome, detail = outcomes.get(signal, ("blocked", "Agent event recorded"))
            mapped_events.append({
                "id": str(row.get("id")),
                "agent_id": str(agent["id"]),
                "agent_name": str(agent["name"]),
                "action": str(row.get("action", "")),
                "detail": detail,
                "outcome": outcome,
                "risk_level": str(agent.get("risk_level", "low")),
                "signal": signal,
                "created_at": row.get("created_at"),
            })
        workspace_name = workspaces[0]["name"] if len(workspaces) == 1 else f"{len(workspaces)} authorized workspaces"
        return {
            "workspace": {"id": str(workspaces[0]["id"]) if len(workspaces) == 1 else "multiple", "name": str(workspace_name)},
            "agents": [{
                "id": str(row["id"]),
                "name": str(row["name"]),
                "slug": str(row["slug"]),
                "description": "",
                "risk_level": str(row["risk_level"]),
                "agent_class": str(row["agent_class"]),
                "status": str(row["status"]),
                "halt_reason": row.get("halt_reason"),
                "halted_at": row.get("halted_at"),
                "last_seen_at": row.get("last_event_at"),
            } for row in agents],
            "events": mapped_events,
        }


def digest_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
