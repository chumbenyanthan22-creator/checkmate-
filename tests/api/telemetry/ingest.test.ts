import { describe, expect, it } from "vitest";
import { isSovereignHaltWorkspace, SOVEREIGNHALT_WORKSPACE } from "../../../server/api/telemetry/common";
import {
  authorizeConfiguredAgent,
  configuredAgentsSchema,
  parseConfiguredAgents,
  payloadSchema,
  signalResult,
} from "../../../server/api/telemetry/ingest";

const agentToken = "test-agent-token-with-more-than-thirty-two-characters";
const registry = [
  {
    name: "Invoice Reviewer",
    slug: "invoice-reviewer",
    token: agentToken,
    agent_class: "privileged",
    risk_level: "medium",
  },
];

const validRequest = {
  event: {
    id: "a14235ba-aadd-4e67-86d3-52f948e0e4cf",
    action: "read_invoice",
    signal: "loop_detected",
  },
};

describe("protected telemetry ingestion", () => {
  it("derives the canonical agent solely from its unique bearer token", () => {
    const configured = parseConfiguredAgents(JSON.stringify(registry));
    expect(configured).not.toBeNull();
    expect(authorizeConfiguredAgent(configured!, agentToken)?.slug).toBe("invoice-reviewer");
    expect(authorizeConfiguredAgent(configured!, "different-agent-token-000000000000000")).toBeNull();
    expect(authorizeConfiguredAgent(configured!, null)).toBeNull();
  });

  it("fails configuration closed on duplicate identities or shared/short tokens", () => {
    expect(configuredAgentsSchema.safeParse([...registry, ...registry]).success).toBe(false);
    expect(configuredAgentsSchema.safeParse([
      ...registry,
      { ...registry[0], slug: "invoice-reviewer-2", name: "Invoice Reviewer 2" },
    ]).success).toBe(false);
    expect(configuredAgentsSchema.safeParse([
      { ...registry[0], token: "short" },
    ]).success).toBe(false);
    expect(parseConfiguredAgents("{not-json")).toBeNull();
  });

  it("accepts only the event contract and rejects caller-controlled identity or details", () => {
    expect(payloadSchema.safeParse(validRequest).success).toBe(true);
    expect(payloadSchema.safeParse({
      ...validRequest,
      agent: { name: "Fabricated", slug: "fabricated" },
    }).success).toBe(false);
    expect(payloadSchema.safeParse({
      ...validRequest,
      event: { ...validRequest.event, detail: "private customer payload" },
    }).success).toBe(false);
    expect(payloadSchema.safeParse({
      ...validRequest,
      arguments: { customer_secret: "not accepted" },
    }).success).toBe(false);
    expect(payloadSchema.safeParse({
      ...validRequest,
      event: { ...validRequest.event, created_at: "2099-01-01T00:00:00.000Z" },
    }).success).toBe(false);
  });

  it("derives Loop Detected from an explicit loop signal rather than caller text", () => {
    expect(signalResult.loop_detected).toMatchObject({
      outcome: "blocked",
      status: "paused",
      riskLevel: "critical",
    });
    expect(signalResult.loop_detected.detail).toMatch(/^Loop detected:/);
    expect(signalResult.budget_exceeded.detail).not.toContain("Loop detected");
  });
});

describe("dedicated private workspace marker", () => {
  const expected = {
    id: "7d8318b0-8b9d-4f1c-b2b9-f167a1bd4fe9",
    ...SOVEREIGNHALT_WORKSPACE,
  };

  it("accepts only the exact reserved slug, name, and plan marker", () => {
    expect(isSovereignHaltWorkspace(expected)).toBe(true);
    expect(isSovereignHaltWorkspace({ ...expected, name: "Other Tenant" })).toBe(false);
    expect(isSovereignHaltWorkspace({ ...expected, plan: "private" })).toBe(false);
    expect(isSovereignHaltWorkspace({
      ...expected,
      id: "11111111-1111-1111-1111-111111111111",
    })).toBe(false);
  });
});
