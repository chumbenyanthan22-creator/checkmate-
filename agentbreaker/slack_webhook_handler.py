from __future__ import annotations

import hashlib
import hmac
import json
import os
import threading
import time
from dataclasses import dataclass
from typing import Any

from fastapi import FastAPI, HTTPException, Request

from .detector import Detector
from .supabase_logger import SupabaseLogger


@dataclass
class SessionControl:
    detector: Detector
    logger: SupabaseLogger
    timeout_timer: threading.Timer | None = None


app = FastAPI(title="SovereignHalt Slack webhook")
_sessions: dict[str, SessionControl] = {}


def register_session(session_id: str, detector: Detector, logger: SupabaseLogger, timeout_seconds: float | None = None) -> None:
    _cancel_timeout(session_id)
    _sessions[session_id] = SessionControl(detector=detector, logger=logger)


def _cancel_timeout(session_id: str) -> None:
    control = _sessions.get(session_id)
    if control and control.timeout_timer:
        control.timeout_timer.cancel()
        control.timeout_timer = None


def mark_loop_alert(session_id: str, timeout_seconds: float | None = None) -> None:
    """Start the safe-default pause timer after a loop alert is emitted."""
    control = _sessions.get(session_id)
    if control is None:
        return
    _cancel_timeout(session_id)
    seconds = float(timeout_seconds if timeout_seconds is not None else os.getenv("SOVEREIGNHALT_SLACK_TIMEOUT_SECONDS", os.getenv("AGENTBREAKER_SLACK_TIMEOUT_SECONDS", "60")))
    control.timeout_timer = threading.Timer(seconds, _timeout_session, args=(session_id,))
    control.timeout_timer.daemon = True
    control.timeout_timer.start()


def _timeout_session(session_id: str) -> None:
    control = _sessions.get(session_id)
    if control is not None:
        control.logger.pause_session(session_id, "No Slack decision received before timeout")


async def _verify_slack_signature(request: Request) -> None:
    secret = os.getenv("SLACK_SIGNING_SECRET")
    if not secret:
        return
    timestamp = request.headers.get("X-Slack-Request-Timestamp")
    signature = request.headers.get("X-Slack-Signature")
    if not timestamp or not signature:
        raise HTTPException(status_code=401, detail="Missing Slack signature")
    try:
        if abs(time.time() - int(timestamp)) > 300:
            raise HTTPException(status_code=401, detail="Expired Slack request")
    except ValueError as exc:
        raise HTTPException(status_code=401, detail="Invalid Slack timestamp") from exc
    body = await request.body()
    basestring = f"v0:{timestamp}:".encode() + body
    expected = "v0=" + hmac.new(secret.encode(), basestring, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        raise HTTPException(status_code=401, detail="Invalid Slack signature")


def _payload_data(payload: str) -> dict[str, Any]:
    try:
        data = json.loads(payload)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Invalid Slack payload") from exc
    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="Invalid Slack payload")
    return data


@app.post("/webhook/slack")
async def slack_button(request: Request) -> dict[str, str]:
    await _verify_slack_signature(request)
    form = await request.form()
    payload = form.get("payload")
    if not isinstance(payload, str):
        raise HTTPException(status_code=400, detail="Missing Slack payload")
    data = _payload_data(payload)
    actions = data.get("actions") or []
    if not actions:
        raise HTTPException(status_code=400, detail="Missing Slack action")
    action = actions[0]
    action_id = action.get("action_id")
    try:
        value = json.loads(action.get("value", "{}"))
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Invalid action value") from exc
    session_id = value.get("session_id")
    control = _sessions.get(session_id)
    if not session_id or control is None:
        raise HTTPException(status_code=404, detail="Unknown or expired session")
    if action_id in {"sovereignhalt_continue", "agentbreaker_continue"}:
        _cancel_timeout(session_id)
        control.detector.reset(session_id)
        resume = getattr(control.logger, "resume_session", None)
        if resume is not None:
            resume(session_id)
        return {"text": f"SovereignHalt detector reset for session {session_id}. Continue approved."}
    if action_id in {"sovereignhalt_kill", "agentbreaker_kill"}:
        _cancel_timeout(session_id)
        control.logger.pause_session(session_id, "Killed from Slack")
        return {"text": f"SovereignHalt session {session_id} remains paused. Kill recorded."}
    raise HTTPException(status_code=400, detail="Unsupported Slack action")
