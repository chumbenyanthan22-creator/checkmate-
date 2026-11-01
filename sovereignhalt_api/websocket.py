from __future__ import annotations

import asyncio
import hmac
import json
import logging
import time
from uuid import UUID

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from starlette.concurrency import run_in_threadpool

from .service import Store, backend_enabled, create_admin_client, digest_token

logger = logging.getLogger("sovereignhalt.api.websocket")
app = FastAPI(title="SovereignHalt status socket", docs_url=None, redoc_url=None)
MAX_AUTH_MESSAGE = 8_192
MAX_CONNECTION_SECONDS = 120
POLL_INTERVAL_SECONDS = 2


@app.websocket("/v1/agents/{agent_id}/status/ws")
async def agent_status_socket(websocket: WebSocket, agent_id: UUID):
    await websocket.accept()
    if not backend_enabled():
        await websocket.close(code=1013, reason="service unavailable")
        return

    try:
        raw = await asyncio.wait_for(websocket.receive_text(), timeout=5)
        if len(raw.encode("utf-8")) > MAX_AUTH_MESSAGE:
            await websocket.close(code=1009, reason="auth message too large")
            return
        message = json.loads(raw)
        token = message.get("token") if isinstance(message, dict) else None
        if not isinstance(token, str) or not token or len(token) > MAX_AUTH_MESSAGE:
            await websocket.close(code=4401, reason="authentication required")
            return

        store = await run_in_threadpool(lambda: Store(create_admin_client()))
        key = await run_in_threadpool(store.lookup_agent_key, digest_token(token))
        if not key or not hmac.compare_digest(str(key.get("key_hash", "")), digest_token(token)):
            await websocket.close(code=4401, reason="agent token invalid")
            return
        if "agent:status:read" not in (key.get("scopes") or []) or str(key.get("agent_id")) != str(agent_id):
            await websocket.close(code=4403, reason="agent scope denied")
            return

        deadline = time.monotonic() + MAX_CONNECTION_SECONDS
        previous = None
        while time.monotonic() < deadline:
            status = await run_in_threadpool(store.get_agent_status, str(key["tenant_id"]), str(agent_id))
            if not status:
                await websocket.close(code=4404, reason="agent not found")
                return
            current = {"agent_id": str(agent_id), **status}
            if current != previous:
                await websocket.send_json(current)
                previous = current
            else:
                await websocket.send_json({"type": "heartbeat"})
            await asyncio.sleep(POLL_INTERVAL_SECONDS)
        await websocket.close(code=1000, reason="reconnect for fresh status")
    except WebSocketDisconnect:
        return
    except asyncio.TimeoutError:
        await websocket.close(code=4408, reason="authentication timeout")
    except (json.JSONDecodeError, TypeError, ValueError):
        await websocket.close(code=4400, reason="invalid auth message")
    except Exception:
        logger.warning("agent status socket ended unexpectedly")
        try:
            await websocket.close(code=1011, reason="status unavailable")
        except Exception:
            pass


class StripApiPrefix:
    """Normalize Vercel's /api function prefix for HTTP and WebSocket ASGI scopes."""

    def __init__(self, inner):
        self.inner = inner

    async def __call__(self, scope, receive, send):
        path = scope.get("path", "")
        if scope.get("type") in {"http", "websocket"} and path.startswith("/api/"):
            scope = dict(scope)
            scope["path"] = path[4:]
            raw_path = scope.get("raw_path")
            if isinstance(raw_path, bytes) and raw_path.startswith(b"/api/"):
                scope["raw_path"] = raw_path[4:]
        await self.inner(scope, receive, send)


vercel_app = StripApiPrefix(app)
