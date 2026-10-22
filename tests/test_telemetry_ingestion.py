import io
import base64
import json
from pathlib import Path
import sys
from types import ModuleType
from uuid import UUID

import pytest

from agentbreaker import CheckmateHandler, LoopDetectedException
from agentbreaker.supabase_logger import SupabaseLogger

TEST_TOKEN = "test-only-agent-ingest-token-with-more-than-32-bytes"


class _Query:
    def select(self, columns):
        return self

    def limit(self, count):
        return self

    def execute(self):
        return {"data": []}


class _Client:
    def table(self, name):
        return _Query()


def _configure_agent(monkeypatch):
    monkeypatch.setenv("SOVEREIGNHALT_INGEST_URL", "https://dashboard.example/api/telemetry/ingest")
    monkeypatch.setenv("SOVEREIGNHALT_INGEST_TOKEN", TEST_TOKEN)
    monkeypatch.setenv("SOVEREIGNHALT_AGENT_NAME", "Invoice Reviewer")
    monkeypatch.setenv("SOVEREIGNHALT_AGENT_SLUG", "invoice-reviewer")
    monkeypatch.delenv("SOVEREIGNHALT_AGENT_ID", raising=False)
    monkeypatch.delenv("AGENT_ID", raising=False)
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_KEY", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    monkeypatch.setattr("dotenv.load_dotenv", lambda *args, **kwargs: False)


def test_dashboard_ingestion_sends_only_event_and_structured_signal(
    tmp_path: Path, monkeypatch
):
    _configure_agent(monkeypatch)
    sent = {}

    def fake_urlopen(request, timeout):
        sent["url"] = request.full_url
        sent["headers"] = dict(request.header_items())
        sent["payload"] = json.loads(request.data.decode("utf-8"))
        return io.BytesIO(b"{}")

    monkeypatch.setattr("agentbreaker.supabase_logger.urlopen", fake_urlopen)
    logger = SupabaseLogger(outbox_path=tmp_path / "outbox.jsonl")
    assert logger.client is None
    assert logger.schema_ready

    assert logger.record_decision(
        "local-session",
        {
            "action": "read_invoice",
            "decision": "blocked",
            "signal": "loop_detected",
            "reason": "private customer detail must not leave the producer",
            "arguments": {"customer_secret": "never-transmit"},
        },
    )

    assert sent["url"] == "https://dashboard.example/api/telemetry/ingest"
    assert sent["headers"]["Authorization"] == f"Bearer {TEST_TOKEN}"
    payload = sent["payload"]
    assert set(payload) == {"event"}
    assert payload["event"]["action"] == "read_invoice"
    assert payload["event"]["signal"] == "loop_detected"
    UUID(payload["event"]["id"])
    assert set(payload["event"]) == {"id", "action", "signal"}
    assert "private customer detail" not in json.dumps(payload)
    assert "arguments" not in json.dumps(payload)
    assert "never-transmit" not in json.dumps(payload)
    assert TEST_TOKEN not in json.dumps(payload)
    assert not (tmp_path / "outbox.jsonl").exists()


def test_unstructured_decisions_cannot_become_loop_or_allowed_signals(tmp_path: Path, monkeypatch):
    _configure_agent(monkeypatch)
    sent = []
    monkeypatch.setattr("agentbreaker.supabase_logger.urlopen", lambda *args, **kwargs: sent.append(args))
    logger = SupabaseLogger(outbox_path=tmp_path / "outbox.jsonl")

    assert not logger.record_decision("private-session", "loop detected in customer text")
    assert not logger.record_decision(
        "private-session",
        {"action": "read_invoice", "decision": "loop", "reason": "private input"},
    )
    assert sent == []
    assert not (tmp_path / "outbox.jsonl").exists()


def test_ingestion_refuses_missing_identity_and_queues_only_bounded_fields(
    tmp_path: Path, monkeypatch
):
    monkeypatch.setenv("SOVEREIGNHALT_INGEST_URL", "https://dashboard.example/api/telemetry/ingest")
    monkeypatch.setenv("SOVEREIGNHALT_INGEST_TOKEN", TEST_TOKEN)
    monkeypatch.delenv("SOVEREIGNHALT_AGENT_NAME", raising=False)
    monkeypatch.delenv("SOVEREIGNHALT_AGENT_SLUG", raising=False)

    logger = SupabaseLogger(_Client(), tmp_path / "outbox.jsonl")
    assert not logger.record_decision(
        "local-session",
        {
            "action": "customer name secret",
            "decision": "allowed",
            "signal": "guard_allowed",
            "reason": "private customer detail",
            "arguments": {"secret": "never-queue"},
        },
    )

    queued = (tmp_path / "outbox.jsonl").read_text(encoding="utf-8")
    assert "sovereignhalt_ingest" in queued
    assert "SOVEREIGNHALT_AGENT_NAME is required" in queued
    assert "11111111-1111-1111-1111-111111111111" not in queued
    assert "Live detector" not in queued
    assert TEST_TOKEN not in queued
    assert "private customer detail" not in queued
    assert "never-queue" not in queued
    assert "customer name secret" not in queued
    assert "local-session" not in queued
    assert "session_id" not in queued
    assert '"action": "tool_call"' in queued
    assert '"signal": "guard_allowed"' in queued


def test_api_only_mode_ignores_a_publishable_supabase_key(tmp_path: Path, monkeypatch):
    _configure_agent(monkeypatch)
    monkeypatch.setenv("SUPABASE_URL", "https://project.example.supabase.co")
    monkeypatch.setenv("SUPABASE_KEY", "sb_publishable_not-for-direct-writes")

    logger = SupabaseLogger(outbox_path=tmp_path / "outbox.jsonl")

    assert logger.client is None
    assert logger.schema_ready


def test_api_only_mode_ignores_even_a_service_role_key(tmp_path: Path, monkeypatch):
    _configure_agent(monkeypatch)
    monkeypatch.setenv("SUPABASE_URL", "https://project.example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "sb_secret_must-not-enable-direct-mode")

    logger = SupabaseLogger(outbox_path=tmp_path / "outbox.jsonl")

    assert logger.client is None
    assert logger.schema_ready


def test_direct_writer_rejects_a_publishable_key(tmp_path: Path, monkeypatch):
    _configure_agent(monkeypatch)
    for key in (
        "SOVEREIGNHALT_INGEST_URL",
        "SOVEREIGNHALT_INGEST_TOKEN",
        "SOVEREIGNHALT_AGENT_NAME",
        "SOVEREIGNHALT_AGENT_SLUG",
    ):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("SUPABASE_URL", "https://project.example.supabase.co")
    monkeypatch.setenv("SUPABASE_KEY", "sb_publishable_not-for-direct-writes")
    monkeypatch.setenv("SOVEREIGNHALT_LEGACY_DIRECT_SUPABASE", "true")

    with pytest.raises(RuntimeError, match="service-role"):
        SupabaseLogger(outbox_path=tmp_path / "outbox.jsonl")


def test_direct_writer_accepts_explicit_service_role_key(tmp_path: Path, monkeypatch):
    _configure_agent(monkeypatch)
    for key in (
        "SOVEREIGNHALT_INGEST_URL",
        "SOVEREIGNHALT_INGEST_TOKEN",
        "SOVEREIGNHALT_AGENT_NAME",
        "SOVEREIGNHALT_AGENT_SLUG",
    ):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv("SUPABASE_URL", "https://project.example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "sb_secret_test-only")
    monkeypatch.setenv("SOVEREIGNHALT_LEGACY_DIRECT_SUPABASE", "true")
    fake_client = _Client()
    module = ModuleType("supabase")
    module.create_client = lambda url, key: fake_client
    monkeypatch.setitem(sys.modules, "supabase", module)

    logger = SupabaseLogger(outbox_path=tmp_path / "outbox.jsonl")

    assert logger.client is fake_client
    assert logger.schema_ready


def test_legacy_key_alias_requires_service_role_claim():
    service_payload = base64.urlsafe_b64encode(b'{"role":"service_role"}').decode().rstrip("=")
    anon_payload = base64.urlsafe_b64encode(b'{"role":"anon"}').decode().rstrip("=")

    assert SupabaseLogger._declares_service_role(f"header.{service_payload}.signature")
    assert not SupabaseLogger._declares_service_role(f"header.{anon_payload}.signature")


@pytest.mark.parametrize(
    "url",
    [
        "http://dashboard.example/api/telemetry/ingest",
        "https://dashboard.example/api/telemetry/ingest?next=example",
        "https://user:secret@dashboard.example/api/telemetry/ingest",
        "https://dashboard.example/api/other",
        "https://dashboard.example/api/telemetry/ingest/",
    ],
)
def test_ingestion_url_requires_exact_https_endpoint(url, monkeypatch):
    monkeypatch.setenv("SOVEREIGNHALT_INGEST_URL", url)
    monkeypatch.setenv("SOVEREIGNHALT_INGEST_TOKEN", TEST_TOKEN)
    monkeypatch.setenv("SOVEREIGNHALT_AGENT_NAME", "Invoice Reviewer")
    with pytest.raises(RuntimeError, match="HTTPS"):
        SupabaseLogger(_Client())


def test_opt_in_public_callback_uses_protected_transport(tmp_path: Path, monkeypatch):
    _configure_agent(monkeypatch)
    sent = {}

    def fake_urlopen(request, timeout):
        sent["headers"] = dict(request.header_items())
        sent["payload"] = json.loads(request.data.decode("utf-8"))
        return io.BytesIO(b"{}")

    monkeypatch.setattr("agentbreaker.supabase_logger.urlopen", fake_urlopen)
    handler = CheckmateHandler(
        session_id="production-session",
        telemetry_enabled=True,
        agent_name="Invoice Reviewer",
        agent_slug="invoice-reviewer",
    )
    handler.on_tool_start(
        {"name": "lookup_ticket"},
        inputs={"private_ticket_content": "do-not-send"},
    )

    assert sent["headers"]["Authorization"] == f"Bearer {TEST_TOKEN}"
    assert set(sent["payload"]) == {"event"}
    assert sent["payload"]["event"]["signal"] == "guard_allowed"
    assert "do-not-send" not in json.dumps(sent["payload"])
    assert "private_ticket_content" not in json.dumps(sent["payload"])


def test_public_sdk_callback_emits_only_structured_guard_signals():
    class CaptureLogger:
        def __init__(self):
            self.events = []

        def record_decision(self, session_id, decision):
            self.events.append((session_id, decision))
            return True

    capture = CaptureLogger()
    handler = CheckmateHandler(
        session_id="real-session",
        loop_threshold=3,
        telemetry_logger=capture,
    )
    private_arguments = {"customer_ref": "confidential-value"}

    for _ in range(2):
        handler.on_tool_start({"name": "lookup_customer"}, inputs=private_arguments)
    with pytest.raises(LoopDetectedException):
        handler.on_tool_start({"name": "lookup_customer"}, inputs=private_arguments)

    assert len(capture.events) == 3
    assert [event[1]["signal"] for event in capture.events] == [
        "guard_allowed",
        "guard_allowed",
        "loop_detected",
    ]
    assert all(event[0] == "real-session" for event in capture.events)
    serialized = json.dumps(capture.events)
    assert "confidential-value" not in serialized
    assert "arguments" not in serialized
    assert "reason" not in serialized
