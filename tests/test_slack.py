import json
import hashlib
import hmac
import threading
import time
from urllib.parse import urlencode

from fastapi.testclient import TestClient

from sovereignhalt import Detector, SlackAlerter, ToolCall
from sovereignhalt.slack_webhook_handler import app, mark_loop_alert, register_session


class Logger:
    def __init__(self):
        self.paused = []

    def pause_session(self, session_id, reason):
        self.paused.append((session_id, reason))
        return True

    def resume_session(self, session_id):
        return True


def test_block_kit_contains_continue_and_kill():
    payload = SlackAlerter._payload("s1", {"loop_type": "repeat", "fingerprint": "abc", "cycle_length": 3}, "read_invoice")
    actions = payload["attachments"][0]["blocks"][-1]["elements"]
    assert [item["action_id"] for item in actions] == ["sovereignhalt_continue", "sovereignhalt_kill"]
    assert "SovereignHalt" in payload["attachments"][0]["blocks"][0]["text"]["text"]
    assert actions[0]["style"] == "primary"
    assert actions[1]["style"] == "danger"


def test_alert_posts_on_background_thread(monkeypatch):
    called = threading.Event()
    alerter = SlackAlerter("https://example.invalid/webhook")

    def fake_post(payload):
        called.set()

    monkeypatch.setattr(alerter, "_post", fake_post)
    alerter.alert_loop("s1", {"cycle_length": 3}, "read_invoice")
    assert called.wait(1)


def test_continue_resets_detector():
    detector = Detector()
    logger = Logger()
    register_session("s-continue", detector, logger)
    for _ in range(2):
        detector.evaluate(ToolCall("s-continue", "read", {}))
    response = TestClient(app).post("/webhook/slack", data={"payload": json.dumps({"actions": [{"action_id": "sovereignhalt_continue", "value": json.dumps({"session_id": "s-continue"})}]})})
    assert response.status_code == 200
    assert detector._recent == {}


def test_kill_pauses_session():
    detector = Detector()
    logger = Logger()
    register_session("s-kill", detector, logger)
    response = TestClient(app).post("/webhook/slack", data={"payload": json.dumps({"actions": [{"action_id": "sovereignhalt_kill", "value": json.dumps({"session_id": "s-kill"})}]})})
    assert response.status_code == 200
    assert logger.paused == [("s-kill", "Killed from Slack")]


def test_legacy_action_ids_remain_supported():
    detector = Detector()
    logger = Logger()
    register_session("s-legacy", detector, logger)
    response = TestClient(app).post(
        "/webhook/slack",
        data={"payload": json.dumps({"actions": [{"action_id": "agentbreaker_kill", "value": json.dumps({"session_id": "s-legacy"})}]})},
    )
    assert response.status_code == 200
    assert logger.paused == [("s-legacy", "Killed from Slack")]


def test_loop_alert_timeout_pauses_session():
    detector = Detector()
    logger = Logger()
    register_session("s-timeout", detector, logger)
    mark_loop_alert("s-timeout", timeout_seconds=0.01)
    deadline = time.time() + 1
    while time.time() < deadline and not logger.paused:
        time.sleep(0.01)
    assert logger.paused == [("s-timeout", "No Slack decision received before timeout")]


def test_slack_signature_is_required_when_configured(monkeypatch):
    monkeypatch.setenv("SLACK_SIGNING_SECRET", "test-secret")
    payload = json.dumps({"actions": [{"action_id": "sovereignhalt_kill", "value": json.dumps({"session_id": "missing"})}]})
    body = urlencode({"payload": payload}).encode()
    timestamp = str(int(time.time()))
    signature = "v0=" + hmac.new(b"test-secret", f"v0:{timestamp}:".encode() + body, hashlib.sha256).hexdigest()
    response = TestClient(app).post("/webhook/slack", content=body, headers={"Content-Type": "application/x-www-form-urlencoded", "X-Slack-Request-Timestamp": timestamp, "X-Slack-Signature": signature})
    assert response.status_code == 404
