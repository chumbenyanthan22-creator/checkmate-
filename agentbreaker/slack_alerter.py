from __future__ import annotations

import json
import logging
import os
import threading
from typing import Any
from urllib.error import URLError
from urllib.request import Request, urlopen

logger = logging.getLogger(__name__)


class SlackAlerter:
    def __init__(self, webhook_url: str | None) -> None:
        self.webhook_url = webhook_url

    @classmethod
    def from_env(cls) -> "SlackAlerter":
        return cls(os.getenv("SLACK_WEBHOOK_URL"))

    def alert_loop(self, session_id: str, loop_info: dict[str, Any], tool_name: str) -> None:
        """Schedule the Slack POST and return immediately; never block detection."""
        if not self.webhook_url:
            logger.info("Slack alert skipped: SLACK_WEBHOOK_URL is not configured")
            return
        payload = self._payload(session_id, loop_info, tool_name)
        thread = threading.Thread(target=self._post, args=(payload,), daemon=True, name="sovereignhalt-slack-alert")
        thread.start()

    @staticmethod
    def _payload(session_id: str, loop_info: dict[str, Any], tool_name: str) -> dict[str, Any]:
        fingerprint = str(loop_info.get("fingerprint", "unknown"))
        loop_type = str(loop_info.get("loop_type", loop_info.get("alert_type", "repeat")))
        cycle_length = int(loop_info.get("cycle_length", 1))
        value = json.dumps({"session_id": session_id}, separators=(",", ":"))
        return {
            "attachments": [{
                "color": "#ef4444",
                "blocks": [
                    {"type": "header", "text": {"type": "plain_text", "text": "SovereignHalt loop detected"}},
                    {"type": "section", "fields": [
                        {"type": "mrkdwn", "text": f"*Tool*\n`{tool_name}`"},
                        {"type": "mrkdwn", "text": f"*Loop type*\n`{loop_type}`"},
                        {"type": "mrkdwn", "text": f"*Fingerprint*\n`{fingerprint[:16]}`"},
                        {"type": "mrkdwn", "text": f"*Cycle length*\n`{cycle_length}`"},
                    ]},
                    {"type": "context", "elements": [{"type": "mrkdwn", "text": f"Session: `{session_id}` · SovereignHalt paused the session before dispatch."}]},
                    {"type": "actions", "elements": [
                        {"type": "button", "action_id": "sovereignhalt_continue", "text": {"type": "plain_text", "text": "Continue"}, "style": "primary", "value": value, "confirm": {"title": {"type": "plain_text", "text": "Continue this session?"}, "text": {"type": "mrkdwn", "text": "This resets the detector history for this session."}, "confirm": {"type": "plain_text", "text": "Continue"}, "deny": {"type": "plain_text", "text": "Cancel"}}},
                        {"type": "button", "action_id": "sovereignhalt_kill", "text": {"type": "plain_text", "text": "Kill"}, "style": "danger", "value": value, "confirm": {"title": {"type": "plain_text", "text": "Kill this session?"}, "text": {"type": "mrkdwn", "text": "The session will remain paused."}, "confirm": {"type": "plain_text", "text": "Kill"}, "deny": {"type": "plain_text", "text": "Cancel"}}},
                    ]},
                ],
            }]
        }

    def _post(self, payload: dict[str, Any]) -> None:
        try:
            body = json.dumps(payload).encode("utf-8")
            request = Request(self.webhook_url or "", data=body, headers={"Content-Type": "application/json"}, method="POST")
            with urlopen(request, timeout=5) as response:
                if response.status >= 300:
                    logger.warning("Slack webhook returned HTTP %s", response.status)
        except (OSError, URLError, ValueError) as exc:
            logger.warning("Slack alert failed; detector result remains authoritative: %s", exc)
