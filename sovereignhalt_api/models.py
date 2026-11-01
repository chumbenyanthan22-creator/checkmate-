from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class EventPayload(StrictModel):
    tool_name: str | None = Field(default=None, min_length=1, max_length=80, pattern=r"^[A-Za-z0-9][A-Za-z0-9_.:/-]*$")
    model: str | None = Field(default=None, min_length=1, max_length=80)
    latency_ms: int | None = Field(default=None, ge=0, le=600_000)
    input_tokens: int | None = Field(default=None, ge=0, le=2_000_000)
    output_tokens: int | None = Field(default=None, ge=0, le=2_000_000)
    error_code: str | None = Field(default=None, min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_.:-]+$")


class TelemetryEvent(StrictModel):
    event_id: UUID
    event_type: Literal["tool_call", "model_step", "guard_signal"]
    action: str = Field(min_length=1, max_length=96, pattern=r"^[A-Za-z0-9][A-Za-z0-9_.:/-]*$")
    signal: Literal["guard_allowed", "policy_blocked", "approval_required", "budget_exceeded", "max_iterations_exceeded"]
    tool_signature: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    token_fingerprint: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    payload: EventPayload = Field(default_factory=EventPayload)


class TenantCreate(StrictModel):
    name: str = Field(min_length=1, max_length=120)
    workspace_name: str = Field(default="Production", min_length=1, max_length=120)


class MemberCreate(StrictModel):
    user_id: UUID
    role: Literal["admin", "operator", "viewer"]


class AgentCreate(StrictModel):
    tenant_id: UUID
    workspace_id: UUID
    name: str = Field(min_length=1, max_length=120)
    slug: str = Field(min_length=2, max_length=63, pattern=r"^[a-z0-9][a-z0-9-]+$")
    agent_class: Literal["standard", "privileged"] = "standard"
    risk_level: Literal["low", "medium", "high", "critical"] = "low"


class StatusCommand(StrictModel):
    command: Literal["HALT", "CUT", "RESUME"]
    reason_code: Literal["operator_request", "incident_response", "maintenance", "loop_review"] = "operator_request"
