from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import re
import secrets
from typing import Any
from uuid import UUID
from urllib.parse import urlsplit

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.responses import JSONResponse

from .models import AgentCreate, MemberCreate, StatusCommand, TelemetryEvent, TenantCreate
from .service import (
    AccessDenied,
    AuthenticationRequired,
    BackendUnavailable,
    Principal,
    Store,
    backend_enabled,
    create_admin_client,
    digest_token,
    verify_user,
)

logger = logging.getLogger("sovereignhalt.api")
app = FastAPI(title="SovereignHalt API", version="1.0.0", docs_url=None, redoc_url=None)
MAX_JSON_BYTES = 16_384


@app.middleware("http")
async def private_response_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "private, no-store, max-age=0"
    response.headers["Vary"] = "Authorization"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


@app.middleware("http")
async def normalize_vercel_api_path(request: Request, call_next):
    path = request.scope.get("path", "")
    if path.startswith("/api/"):
        request.scope["path"] = path[4:]
    return await call_next(request)


def _feature_gate() -> None:
    if not backend_enabled():
        raise HTTPException(status_code=404, detail="tenant_backend_not_enabled")


def _store() -> Store:
    _feature_gate()
    try:
        return Store(create_admin_client())
    except BackendUnavailable as exc:
        raise HTTPException(status_code=503, detail="tenant_backend_unconfigured") from exc


def _token(authorization: str | None) -> str:
    match = re.fullmatch(r"\s*Bearer\s+([^\s]+)\s*", authorization or "", re.IGNORECASE)
    if not match or len(match.group(1)) > 8192:
        raise HTTPException(status_code=401, detail="authentication_required")
    return match.group(1)


def _user(authorization: str | None = Header(default=None)) -> Principal:
    token = _token(authorization)
    try:
        return verify_user(token)
    except BackendUnavailable as exc:
        raise HTTPException(status_code=503, detail="auth_service_unconfigured") from exc
    except AuthenticationRequired as exc:
        raise HTTPException(status_code=401, detail="authentication_required") from exc


def _enabled_user(authorization: str | None = Header(default=None)) -> Principal:
    _feature_gate()
    return _user(authorization)


async def _model_body(request: Request, model: type[Any]) -> Any:
    content_length = request.headers.get("content-length")
    if content_length and content_length.isdigit() and int(content_length) > MAX_JSON_BYTES:
        raise HTTPException(status_code=413, detail="request_too_large")
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > MAX_JSON_BYTES:
            raise HTTPException(status_code=413, detail="request_too_large")
    try:
        return model.model_validate_json(bytes(body))
    except Exception as exc:
        raise HTTPException(status_code=422, detail="invalid_request") from exc


def _access_error(exc: Exception) -> HTTPException:
    if isinstance(exc, AccessDenied):
        return HTTPException(status_code=403, detail="tenant_membership_required")
    if isinstance(exc, BackendUnavailable):
        return HTTPException(status_code=503, detail="tenant_backend_unavailable")
    return HTTPException(status_code=503, detail="tenant_backend_unavailable")


def _alert_signature(secret: str, body: bytes) -> str:
    return "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


async def _send_loop_webhook(event: dict[str, Any]) -> bool:
    url = os.getenv("SOVEREIGNHALT_ALERT_WEBHOOK_URL", "").strip()
    secret = os.getenv("SOVEREIGNHALT_ALERT_WEBHOOK_SECRET", "").strip()
    if not url or not secret:
        return False
    try:
        parsed = urlsplit(url)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.fragment:
            return False
        body = json.dumps(event, separators=(",", ":")).encode("utf-8")
        async with httpx.AsyncClient(timeout=3.0, follow_redirects=False) as client:
            response = await client.post(url, content=body, headers={
                "Content-Type": "application/json",
                "X-SovereignHalt-Signature": _alert_signature(secret, body),
            })
        return 200 <= response.status_code < 300
    except Exception:
        logger.warning("loop alert webhook delivery failed")
        return False


@app.get("/v1/dashboard")
def tenant_dashboard(
    tenant_id: str | None = Query(default=None, max_length=36),
    principal: Principal = Depends(_enabled_user),
    store: Store = Depends(_store),
):
    try:
        if tenant_id:
            tenant_id = str(UUID(tenant_id))
        return store.dashboard(principal.user_id, tenant_id)
    except (AccessDenied, BackendUnavailable) as exc:
        raise _access_error(exc) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="invalid_tenant_id") from exc


@app.post("/v1/tenants")
async def create_tenant(request: Request, principal: Principal = Depends(_enabled_user), store: Store = Depends(_store)):
    admin_list = os.getenv("SOVEREIGNHALT_ALLOWED_EMAILS", "")
    allowed = {item.strip().lower() for item in admin_list.split(",") if item.strip()}
    if principal.email not in allowed:
        raise HTTPException(status_code=403, detail="platform_admin_required")
    payload = await _model_body(request, TenantCreate)
    try:
        row = store.create_tenant(principal.user_id, payload.name, payload.workspace_name)
        return {"tenant_id": row["tenant_id"], "workspace_id": row["workspace_id"]}
    except (AccessDenied, BackendUnavailable) as exc:
        raise _access_error(exc) from exc


@app.post("/v1/tenants/{tenant_id}/members")
async def add_member(tenant_id: UUID, request: Request, principal: Principal = Depends(_enabled_user), store: Store = Depends(_store)):
    payload = await _model_body(request, MemberCreate)
    try:
        store.add_member(str(tenant_id), principal.user_id, str(payload.user_id), payload.role)
        return {"tenant_id": str(tenant_id), "user_id": str(payload.user_id), "role": payload.role}
    except (AccessDenied, BackendUnavailable) as exc:
        raise _access_error(exc) from exc


@app.post("/v1/agents")
async def create_agent(request: Request, principal: Principal = Depends(_enabled_user), store: Store = Depends(_store)):
    payload = await _model_body(request, AgentCreate)
    token = "sh_live_" + secrets.token_urlsafe(32)
    prefix = token[:16]
    try:
        row = store.create_agent(principal.user_id, payload.model_dump(mode="json"), prefix, digest_token(token))
        return {"agent_id": row["agent_id"], "api_key_id": row["api_key_id"], "api_key": token, "key_prefix": prefix, "warning": "The API key is shown once. Store it in the agent runtime secret manager."}
    except (AccessDenied, BackendUnavailable) as exc:
        raise _access_error(exc) from exc


@app.post("/v1/agents/{agent_id}/keys")
async def rotate_agent_key(agent_id: UUID, tenant_id: str = Query(..., min_length=36, max_length=36), principal: Principal = Depends(_enabled_user), store: Store = Depends(_store)):
    token = "sh_live_" + secrets.token_urlsafe(32)
    prefix = token[:16]
    try:
        key_id = store.add_key(principal.user_id, str(UUID(tenant_id)), str(agent_id), prefix, digest_token(token))
        return {"api_key_id": key_id, "api_key": token, "key_prefix": prefix, "warning": "The API key is shown once. Store it in the agent runtime secret manager."}
    except (AccessDenied, BackendUnavailable) as exc:
        raise _access_error(exc) from exc


@app.delete("/v1/agents/{agent_id}/keys/{key_id}")
def revoke_agent_key(agent_id: UUID, key_id: UUID, tenant_id: str = Query(..., min_length=36, max_length=36), principal: Principal = Depends(_enabled_user), store: Store = Depends(_store)):
    try:
        if not store.revoke_key(principal.user_id, str(UUID(tenant_id)), str(agent_id), str(key_id)):
            raise HTTPException(status_code=404, detail="key_not_found")
        return {"revoked": True}
    except (AccessDenied, BackendUnavailable) as exc:
        raise _access_error(exc) from exc


@app.post("/v1/telemetry")
async def ingest_telemetry(request: Request, authorization: str | None = Header(default=None), store: Store = Depends(_store)):
    _feature_gate()
    token = _token(authorization)
    payload = await _model_body(request, TelemetryEvent)
    key = store.lookup_agent_key(digest_token(token))
    if not key or not hmac.compare_digest(str(key.get("key_hash", "")), digest_token(token)):
        raise HTTPException(status_code=401, detail="agent_token_invalid")
    scopes = key.get("scopes") or []
    if "telemetry:write" not in scopes:
        raise HTTPException(status_code=403, detail="agent_scope_denied")
    try:
        result = store.ingest(str(key["tenant_id"]), str(key.get("workspace_id") or ""), str(key["agent_id"]), payload.model_dump(mode="json"))
    except (AccessDenied, BackendUnavailable) as exc:
        raise _access_error(exc) from exc
    webhook_sent = False
    if result.get("loop_detected"):
        alert = {
            "event": "sovereignhalt.loop_detected",
            "tenant_id": str(key["tenant_id"]),
            "agent_id": str(key["agent_id"]),
            "event_id": str(payload.event_id),
        }
        webhook_sent = await _send_loop_webhook(alert)
        logger.warning("server loop detected for agent %s", key["agent_id"])
    return {
        "event_id": str(payload.event_id),
        "loop_detected": bool(result.get("loop_detected")),
        "status": result.get("status"),
        "halted_at": result.get("halted_at"),
        "webhook_sent": webhook_sent,
    }


@app.get("/v1/agents/{agent_id}/status")
def read_agent_status(agent_id: UUID, authorization: str | None = Header(default=None), store: Store = Depends(_store)):
    _feature_gate()
    token = _token(authorization)
    key = store.lookup_agent_key(digest_token(token))
    if not key or not hmac.compare_digest(str(key.get("key_hash", "")), digest_token(token)):
        raise HTTPException(status_code=401, detail="agent_token_invalid")
    if "agent:status:read" not in (key.get("scopes") or []):
        raise HTTPException(status_code=403, detail="agent_scope_denied")
    if str(key["agent_id"]) != str(agent_id):
        raise HTTPException(status_code=403, detail="agent_scope_denied")
    try:
        status = store.get_agent_status(str(key["tenant_id"]), str(agent_id))
        if not status:
            raise HTTPException(status_code=404, detail="agent_not_found")
        return {"agent_id": str(agent_id), **status}
    except BackendUnavailable as exc:
        raise _access_error(exc) from exc


@app.put("/v1/agents/{agent_id}/status")
async def set_agent_status(agent_id: UUID, request: Request, tenant_id: str = Query(..., min_length=36, max_length=36), principal: Principal = Depends(_enabled_user), store: Store = Depends(_store)):
    payload = await _model_body(request, StatusCommand)
    try:
        return store.set_status(principal.user_id, str(UUID(tenant_id)), str(agent_id), payload.command, payload.reason_code)
    except (AccessDenied, BackendUnavailable) as exc:
        raise _access_error(exc) from exc


@app.get("/health")
def health():
    return {"ok": True, "component": "sovereignhalt-v1"}
