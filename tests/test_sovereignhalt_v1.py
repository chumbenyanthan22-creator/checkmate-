import json
import sys
from pathlib import Path
from types import ModuleType
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from starlette.websockets import WebSocketDisconnect

from agentbreaker.detector import Detector
from agentbreaker.langchain_handler import LoopBreakerHandler, LoopDetectedException
from sovereignhalt.client import AgentHaltedError, AgentStatusUnavailable, SovereignHaltClient
from sovereignhalt_api import websocket as websocket_module
from sovereignhalt_api.app import _store, app
from sovereignhalt_api.models import TelemetryEvent
from sovereignhalt_api.service import digest_token

AGENT_ID = "11111111-1111-4111-8111-111111111111"
TENANT_ID = "22222222-2222-4222-8222-222222222222"
WORKSPACE_ID = "33333333-3333-4333-8333-333333333333"
API_TOKEN = "sh_live_test_" + "x" * 48


@pytest.fixture(autouse=True)
def tenant_backend_disabled_by_default(monkeypatch):
    monkeypatch.setenv("SOVEREIGNHALT_TENANT_BACKEND_ENABLED", "false")
    monkeypatch.delenv("SOVEREIGNHALT_ALERT_WEBHOOK_URL", raising=False)
    monkeypatch.delenv("SOVEREIGNHALT_ALERT_WEBHOOK_SECRET", raising=False)
    app.dependency_overrides.clear()
    yield
    app.dependency_overrides.clear()


def test_v1_routes_fail_closed_without_activation_or_schema():
    with TestClient(app) as client:
        response = client.get("/api/v1/dashboard")
        assert response.status_code == 404
        assert response.json()["detail"] == "tenant_backend_not_enabled"

        response = client.post("/api/v1/telemetry", headers={"Authorization": f"Bearer {API_TOKEN}"}, json={})
        assert response.status_code == 404
        assert response.json()["detail"] == "tenant_backend_not_enabled"

        health = client.get("/api/health")
        assert health.status_code == 200
        assert health.json()["component"] == "sovereignhalt-v1"
        assert health.headers["cache-control"].startswith("private, no-store")


def test_event_model_rejects_caller_selected_tenant_and_raw_arguments():
    with pytest.raises(ValidationError):
        TelemetryEvent.model_validate({
            "event_id": str(uuid4()),
            "event_type": "tool_call",
            "action": "query_customer",
            "signal": "guard_allowed",
            "tenant_id": TENANT_ID,
            "arguments": {"secret": "private"},
        })


def test_sdk_sends_only_bounded_metadata_and_keyed_fingerprints():
    client = SovereignHaltClient("https://telemetry.example", API_TOKEN, AGENT_ID)
    captured = {}

    def request(method, path, payload=None):
        captured.update(method=method, path=path, payload=payload)
        return {"event_id": payload["event_id"], "status": "ACTIVE"}

    client._request = request
    result = client.emit_event(
        action="search customer records",
        signal="guard_allowed",
        tool_name="Customer Search Tool",
        args={"email": "private@example.test"},
        output="private customer response",
        model="example-model",
    )

    serialized = json.dumps(captured["payload"])
    assert result["status"] == "ACTIVE"
    assert captured["method"] == "POST"
    assert captured["path"] == "/api/v1/telemetry"
    assert captured["payload"]["action"] == "search_customer_records"
    assert captured["payload"]["payload"]["tool_name"] == "Customer_Search_Tool"
    assert len(captured["payload"]["tool_signature"]) == 64
    assert len(captured["payload"]["token_fingerprint"]) == 64
    assert API_TOKEN not in serialized
    assert "private@example.test" not in serialized
    assert "private customer response" not in serialized
    assert "args" not in serialized and "output" not in serialized


def test_sdk_blocks_halted_status_and_latches_missing_event_acknowledgement():
    client = SovereignHaltClient("https://telemetry.example", API_TOKEN, AGENT_ID)
    client._request = lambda method, path, payload=None: {"status": "HALTED"}
    with pytest.raises(AgentHaltedError, match="HALTED"):
        client.assert_active()

    client = SovereignHaltClient("https://telemetry.example", API_TOKEN, AGENT_ID)
    client._request = lambda method, path, payload=None: {"status": "accepted"}
    assert client.emit_event(action="lookup", signal="guard_allowed") is None
    with pytest.raises(AgentStatusUnavailable, match="not acknowledged"):
        client.assert_active()


def test_sdk_fail_closed_on_status_transport_error():
    client = SovereignHaltClient("https://telemetry.example", API_TOKEN, AGENT_ID)

    def unavailable(*args, **kwargs):
        raise RuntimeError("offline")

    client._request = unavailable
    with pytest.raises(AgentStatusUnavailable, match="could not be verified"):
        client.assert_active()


def test_local_loop_block_is_forwarded_as_a_server_verifiable_tool_attempt(monkeypatch):
    fake_slack = ModuleType("slack_webhook_handler")
    fake_slack.register_session = lambda *args, **kwargs: None
    fake_slack.mark_loop_alert = lambda *args, **kwargs: None
    monkeypatch.setitem(sys.modules, "slack_webhook_handler", fake_slack)

    class Logger:
        last_cost_usd = 0.01
        cost_calculator = None

        def record_decision(self, *args, **kwargs):
            return True

        def log_tool_call(self, *args, **kwargs):
            return None

        def log_loop_detection(self, *args, **kwargs):
            return None

        def pause_session(self, *args, **kwargs):
            return None

    class Remote:
        def __init__(self):
            self.events = []
            self.checks = 0

        def assert_active(self, agent_id=None):
            self.checks += 1
            return {"status": "ACTIVE"}

        def emit_event(self, **event):
            self.events.append(event)
            return {"status": "ACTIVE"}

    remote = Remote()
    executed = []
    handler = LoopBreakerHandler(
        session_id="agent-session",
        logger=Logger(),
        detector=Detector(loop_threshold=3),
        cost_per_call_usd=0.01,
        remote_control=remote,
    )

    for _ in range(2):
        handler.invoke("repeat_tool", {"query": "same"}, lambda args: executed.append(args) or "ok")
    with pytest.raises(LoopDetectedException):
        handler.invoke("repeat_tool", {"query": "same"}, lambda args: executed.append(args) or "must-not-run")

    assert len(executed) == 2
    assert len(remote.events) == 3
    assert remote.events[-1]["signal"] == "policy_blocked"
    assert remote.events[-1]["event_type"] == "tool_call"
    assert remote.checks == 3


def test_telemetry_route_derives_identity_from_agent_key_and_reports_server_loop(monkeypatch):
    monkeypatch.setenv("SOVEREIGNHALT_TENANT_BACKEND_ENABLED", "true")

    class StoreStub:
        def lookup_agent_key(self, token_hash):
            assert token_hash == digest_token(API_TOKEN)
            return {
                "key_hash": token_hash,
                "tenant_id": TENANT_ID,
                "workspace_id": WORKSPACE_ID,
                "agent_id": AGENT_ID,
                "scopes": ["telemetry:write", "agent:status:read"],
            }

        def ingest(self, tenant_id, workspace_id, agent_id, event):
            assert (tenant_id, workspace_id, agent_id) == (TENANT_ID, WORKSPACE_ID, AGENT_ID)
            assert "arguments" not in event and "output" not in event
            return {"loop_detected": True, "status": "HALTED", "halted_at": "2026-10-30T00:00:00+00:00"}

    app.dependency_overrides[_store] = lambda: StoreStub()
    event_id = str(uuid4())
    body = {
        "event_id": event_id,
        "event_type": "tool_call",
        "action": "repeat_tool",
        "signal": "guard_allowed",
        "tool_signature": "a" * 64,
        "payload": {"tool_name": "repeat_tool", "latency_ms": 12},
    }
    with TestClient(app) as client:
        response = client.post(
            "/api/v1/telemetry",
            headers={"Authorization": f"Bearer {API_TOKEN}"},
            json=body,
        )

    assert response.status_code == 200
    assert response.json()["event_id"] == event_id
    assert response.json()["loop_detected"] is True
    assert response.json()["status"] == "HALTED"
    assert response.json()["webhook_sent"] is False


def test_telemetry_route_rejects_unknown_key_and_extra_identity(monkeypatch):
    monkeypatch.setenv("SOVEREIGNHALT_TENANT_BACKEND_ENABLED", "true")

    class StoreStub:
        def lookup_agent_key(self, token_hash):
            return None

    app.dependency_overrides[_store] = lambda: StoreStub()
    body = {
        "event_id": str(uuid4()),
        "event_type": "tool_call",
        "action": "read_record",
        "signal": "guard_allowed",
        "tenant_id": TENANT_ID,
    }
    with TestClient(app) as client:
        response = client.post(
            "/api/v1/telemetry",
            headers={"Authorization": f"Bearer {API_TOKEN}"},
            json=body,
        )
        assert response.status_code == 422
        body.pop("tenant_id")
        response = client.post(
            "/api/v1/telemetry",
            headers={"Authorization": "Bearer unknown-agent-key-with-more-than-32-bytes"},
            json=body,
        )

    assert response.status_code == 401
    assert response.json()["detail"] == "agent_token_invalid"


def test_status_websocket_requires_auth_and_normalizes_vercel_prefix():
    socket_client = TestClient(websocket_module.vercel_app)
    with socket_client.websocket_connect(f"/api/v1/agents/{AGENT_ID}/status/ws") as socket:
        with pytest.raises(WebSocketDisconnect) as exc:
            socket.receive_json()
    assert exc.value.code == 1013


def test_status_websocket_authenticates_agent_token_and_streams_status(monkeypatch):
    monkeypatch.setenv("SOVEREIGNHALT_TENANT_BACKEND_ENABLED", "true")

    class StoreStub:
        def __init__(self, client):
            pass

        def lookup_agent_key(self, token_hash):
            assert token_hash == digest_token(API_TOKEN)
            return {
                "key_hash": token_hash,
                "tenant_id": TENANT_ID,
                "agent_id": AGENT_ID,
                "scopes": ["agent:status:read"],
            }

        def get_agent_status(self, tenant_id, agent_id):
            assert (tenant_id, agent_id) == (TENANT_ID, AGENT_ID)
            return {"status": "HALTED", "halt_reason": "OPERATOR_CUT", "halted_at": "2026-10-30T00:00:00+00:00"}

    monkeypatch.setattr(websocket_module, "create_admin_client", lambda: object())
    monkeypatch.setattr(websocket_module, "Store", StoreStub)
    socket_client = TestClient(websocket_module.vercel_app)
    with socket_client.websocket_connect(f"/api/v1/agents/{AGENT_ID}/status/ws") as socket:
        socket.send_json({"token": API_TOKEN})
        status = socket.receive_json()
        assert status["agent_id"] == AGENT_ID
        assert status["status"] == "HALTED"
        assert status["halt_reason"] == "OPERATOR_CUT"
        socket.close()


def test_staged_sql_has_tenant_isolation_atomic_loop_checks_and_null_safe_roles():
    sql_path = Path(__file__).resolve().parents[1] / "supabase/pending/20261030_sovereignhalt_mvp_schema.sql"
    sql = sql_path.read_text(encoding="utf-8")
    assert "MANUAL REVIEW ONLY" in sql
    assert "ENABLE ROW LEVEL SECURITY" in sql
    assert "REVOKE ALL ON public.sh_tenants" in sql
    assert "UNIQUE (tenant_id, agent_id, event_id)" in sql
    assert "ON CONFLICT (tenant_id, agent_id, event_id) DO NOTHING" in sql
    assert "AND agent_id = p_agent_id AND workspace_id = p_workspace_id AND event_id = p_event_id" in sql
    assert "FOR UPDATE;" in sql
    assert "FOR UPDATE" in sql
    assert "LIMIT 5" in sql
    assert "event_type = 'tool_call'" in sql
    assert "v_agent.status <> 'ACTIVE'" in sql
    assert "SET status = 'HALTED', halt_reason = 'LOOP_DETECTED'" in sql
    assert sql.count("COALESCE(v_role, '') NOT IN") >= 4
    assert "GRANT ALL ON public.sh_tenants" in sql and "TO service_role" in sql
    assert "TO authenticated" in sql
    assert "GRANT INSERT" not in sql and "GRANT UPDATE" not in sql
