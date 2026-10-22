import { describe, expect, it } from "vitest";
import { mapDashboardRecords } from "../../../server/api/telemetry/dashboard";

const agentId = "c4b94a71-e8e3-41f2-8b46-37c2b6336e1c";
const profile = {
  id: agentId,
  name: "Invoice Reviewer",
  slug: "invoice-reviewer",
  token: "test-agent-token-with-more-than-thirty-two-characters",
  description: "Registered profile",
  agent_class: "privileged" as const,
  risk_level: "medium" as const,
};
const agentRow = {
  id: agentId,
  name: "Invoice Reviewer",
  slug: "invoice-reviewer",
  last_seen_at: "1970-01-01T00:00:07.000Z",
};
const eventRow = {
  id: "a14235ba-aadd-4e67-86d3-52f948e0e4cf",
  agent_id: agentId,
  agent_name: "Invoice Reviewer",
  action: "read_invoice",
  detail: "Loop detected: repeated identical tool sequence blocked before dispatch.",
  outcome: "blocked",
  risk_level: "critical",
  created_at: "1970-01-01T00:00:06.000Z",
  metadata: { source: "sovereignhalt_python_sdk", signal: "loop_detected" },
};

const map = (agents: unknown[], events: unknown[]) => mapDashboardRecords(
  agents as never[],
  events as never[],
  [profile],
  0,
  10_000,
);

describe("private dashboard record mapping", () => {
  it("returns only registered agents backed by a recent, linked, validated SDK event", () => {
    const result = map([agentRow], [eventRow]);
    expect(result.agents).toHaveLength(1);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].signal).toBe("loop_detected");
    expect(result.agents[0]).not.toHaveProperty("status");
    expect(result.agents[0].risk_level).toBe("medium");
    expect(result.agents[0].agent_class).toBe("privileged");
  });

  it("does not expose default-only agent rows or orphan events", () => {
    const defaultAgent = {
      ...agentRow,
      status: "active",
      risk_level: "low",
      agent_class: "standard",
      tool_calls: 0,
    };
    expect(map([defaultAgent], []).agents).toEqual([]);
    expect(map([defaultAgent], [{ ...eventRow, agent_id: null }])).toEqual({ agents: [], events: [] });
  });

  it("rejects unregistered, misattributed, stale, or non-source events", () => {
    expect(map([{ ...agentRow, slug: "unknown-agent" }], [eventRow])).toEqual({ agents: [], events: [] });
    expect(map([agentRow], [{ ...eventRow, agent_name: "Other Agent" }])).toEqual({ agents: [], events: [] });
    expect(map([agentRow], [{ ...eventRow, metadata: { source: "manual", signal: "loop_detected" } }]))
      .toEqual({ agents: [], events: [] });
    expect(map([agentRow], [{ ...eventRow, metadata: { source: "sovereignhalt_python_sdk", signal: "unknown" } }]))
      .toEqual({ agents: [], events: [] });
    expect(map([agentRow], [{ ...eventRow, created_at: "1970-01-01T00:00:20.000Z" }]))
      .toEqual({ agents: [], events: [] });
  });
});
