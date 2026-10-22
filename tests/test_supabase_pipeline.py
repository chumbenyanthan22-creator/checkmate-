from pathlib import Path
from uuid import UUID

import pytest
from langchain_core.tools import StructuredTool

from agentbreaker_detector import Detector
from agentbreaker.cost_calculator import CostCalculator
from langchain_handler import BudgetExceededException, LoopBreakerHandler, LoopDetectedException
from supabase_logger import SupabaseLogger
from agentbreaker.session_ids import schema_uuid


class Query:
    def __init__(self, store, table, fail=False):
        self.store, self.table_name, self.fail = store, table, fail
        self.operation, self.payload, self.filters = None, None, {}

    def select(self, columns):
        return self

    def limit(self, count):
        return self

    def upsert(self, payload, on_conflict=None):
        self.operation, self.payload = "upsert", payload
        return self

    def insert(self, payload):
        self.operation, self.payload = "insert", payload
        return self

    def update(self, payload):
        self.operation, self.payload = "update", payload
        return self

    def eq(self, key, value):
        self.filters[key] = value
        return self

    def gte(self, key, value):
        self.filters[f"{key}_gte"] = value
        return self

    def lte(self, key, value):
        self.filters[f"{key}_lte"] = value
        return self

    def execute(self):
        if self.fail:
            raise ConnectionError("Supabase unavailable")
        if self.operation is not None:
            self.store.append((self.operation, self.table_name, self.payload, self.filters))
        return {"data": [self.payload] if self.operation is not None else []}


class FakeClient:
    def __init__(self, fail=False):
        self.store, self.queries, self.fail = [], [], fail

    def table(self, name):
        query = Query(self.store, name, self.fail)
        self.queries.append(query)
        return query


def test_logger_reports_schema_ready(tmp_path: Path):
    assert SupabaseLogger(FakeClient(), tmp_path / "outbox.jsonl").schema_ready


def test_session_initialization_writes_expected_schema(tmp_path: Path):
    client = FakeClient()
    assert SupabaseLogger(client, tmp_path / "outbox.jsonl").ensure_session("s1", company_id="acme")
    assert client.store[0][0] == "upsert" and client.store[0][1] == "agent_sessions"
    assert client.store[0][2]["current_spend_usd"] == 0.0
    assert client.store[0][2]["session_id"] == schema_uuid("s1", "session")
    assert client.store[0][2]["company_id"] == schema_uuid("acme", "company")
    UUID(client.store[0][2]["session_id"])


def test_tool_call_writes_expected_schema(tmp_path: Path):
    client = FakeClient()
    assert SupabaseLogger(client, tmp_path / "outbox.jsonl").log_tool_call(
        "s1", "read_invoice", {"id": 1}, "ok", 0.01, agent_id="not-a-uuid"
    )
    operation, table, payload, _ = client.store[0]
    assert operation == "insert" and table == "tool_execution_logs"
    assert payload["session_id"] == schema_uuid("s1", "session")
    assert payload["tool_name"] == "read_invoice"
    assert "agent_id" not in payload
    UUID(payload["session_id"])


def test_loop_write_has_fingerprint_and_cycle_length(tmp_path: Path):
    client = FakeClient()
    logger = SupabaseLogger(client, tmp_path / "outbox.jsonl")
    assert logger.log_loop_detection("s1", {"cycle_length": 3}, "read_invoice", "abc")
    assert client.store[0][1] == "agent_alerts"
    assert client.store[0][2]["session_id"] == schema_uuid("s1", "session")
    assert client.store[0][2]["fingerprint"] == "abc"


def test_pause_updates_session(tmp_path: Path):
    client = FakeClient()
    assert SupabaseLogger(client, tmp_path / "outbox.jsonl").pause_session("s1", "loop")
    assert client.store[0][1] == "agent_sessions"
    assert client.store[0][2] == {"is_paused": True}
    assert client.store[0][3]["session_id"] == schema_uuid("s1", "session")


def test_existing_uuid_session_ids_are_preserved_and_string_keys_are_stable():
    existing = "c4b94a71-e8e3-41f2-8b46-37c2b6336e1c"
    assert schema_uuid(existing, "session") == existing
    assert schema_uuid("pilot", "session") == schema_uuid("pilot", "session")
    assert schema_uuid("pilot", "session") != schema_uuid("pilot", "company")


def test_cost_aggregation_uses_the_same_compatible_session_key():
    client = FakeClient()
    calculator = CostCalculator({"gpt-4": 0.03}, supabase_client=client)
    assert calculator.aggregate_cost("pilot", "2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z") == 0
    assert client.queries[-1].filters["session_id"] == schema_uuid("pilot", "session")


def test_legacy_direct_mode_does_not_write_or_queue_dashboard_decisions(tmp_path: Path, monkeypatch):
    monkeypatch.delenv("SOVEREIGNHALT_INGEST_URL", raising=False)
    monkeypatch.delenv("SOVEREIGNHALT_INGEST_TOKEN", raising=False)
    client = FakeClient()
    outbox = tmp_path / "outbox.jsonl"
    assert not SupabaseLogger(client, outbox).record_decision(
        "private-session",
        {"decision": "blocked", "reason": "customer PII", "arguments": {"secret": "never-write"}},
    )
    assert not any(table == "audit_events" for _, table, _, _ in client.store)
    assert not outbox.exists()


def test_handler_logs_calls_spend_and_loop(tmp_path: Path):
    client = FakeClient()
    logger = SupabaseLogger(client, tmp_path / "outbox.jsonl")
    handler = LoopBreakerHandler("s1", logger, Detector(loop_threshold=3), cost_per_call_usd=0.1)
    for _ in range(2):
        handler.invoke("read_invoice", {"id": "INV-1"}, lambda args: "ok")
    with pytest.raises(LoopDetectedException):
        handler.invoke("read_invoice", {"id": "INV-1"}, lambda args: "should-not-run")
    tables = [entry[1] for entry in client.store]
    assert tables.count("tool_execution_logs") == 2
    assert "agent_alerts" in tables
    assert "agent_alerts" in tables
    assert handler.current_spend == pytest.approx(0.00006)


def test_handler_blocks_before_budget_is_exceeded(tmp_path: Path):
    client = FakeClient()
    logger = SupabaseLogger(client, tmp_path / "outbox.jsonl")
    handler = LoopBreakerHandler("budget-session", logger, Detector(loop_threshold=10), cost_per_call_usd=0.00004, max_budget_usd=0.00005)
    handler.invoke("read_invoice", {"id": "INV-1"}, lambda args: "ok")
    executed = []
    with pytest.raises(BudgetExceededException):
        handler.invoke("read_invoice", {"id": "INV-2"}, lambda args: executed.append(args))
    assert executed == []
    assert any(entry[1] == "agent_alerts" and entry[2]["alert_type"] == "budget_exceeded" for entry in client.store)
    assert any(entry[1] == "agent_sessions" and entry[2] == {"is_paused": True} for entry in client.store)


def test_real_langchain_tool_is_blocked_before_dispatch(tmp_path: Path):
    client = FakeClient()
    logger = SupabaseLogger(client, tmp_path / "outbox.jsonl")
    handler = LoopBreakerHandler("langchain-session", logger, Detector(loop_threshold=3))
    executions = []

    def read_invoice(invoice_id: str) -> str:
        executions.append(invoice_id)
        return f"invoice {invoice_id} read"

    tool = StructuredTool.from_function(read_invoice, name="read_invoice", description="Read an invoice")
    for _ in range(2):
        handler.invoke("read_invoice", {"invoice_id": "INV-2048"}, tool.invoke)
    with pytest.raises(LoopDetectedException):
        handler.invoke("read_invoice", {"invoice_id": "INV-2048"}, tool.invoke)
    assert executions == ["INV-2048", "INV-2048"]
