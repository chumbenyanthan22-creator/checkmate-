import { describe, expect, it } from "vitest";
import type { ApiRequest, ApiResponse } from "../../../server/api/telemetry/common";
import ingestRoute from "../../../api/telemetry/ingest";

function responseHarness() {
  const headers: Record<string, string> = {};
  let statusCode = 200;
  let body: unknown;
  const response: ApiResponse = {
    status(code) {
      statusCode = code;
      return response;
    },
    json(value) {
      body = value;
    },
    setHeader(name, value) {
      headers[name] = value;
    },
  };
  return {
    response,
    get statusCode() { return statusCode; },
    get body() { return body; },
    headers,
  };
}

const registry = JSON.stringify([{
  name: "Route Test Agent",
  slug: "route-test-agent",
  token: "route-test-agent-token-with-at-least-32-characters",
  agent_class: "standard",
  risk_level: "low",
}]);

describe("ingest Vercel route wrapper", () => {
  it("rejects non-POST methods before dispatching to the SDK handler", async () => {
    const harness = responseHarness();
    await ingestRoute({ method: "GET", headers: {} } as ApiRequest, harness.response);
    expect(harness.statusCode).toBe(405);
    expect(harness.body).toEqual({ error: "method_not_allowed" });
    expect(harness.headers.Allow).toBe("POST");
  });

  it("returns 401 for an absent agent token without touching Supabase", async () => {
    const previous = process.env.SOVEREIGNHALT_INGEST_AGENTS_JSON;
    process.env.SOVEREIGNHALT_INGEST_AGENTS_JSON = registry;
    try {
      const harness = responseHarness();
      await ingestRoute({ method: "POST", headers: {}, body: {} } as ApiRequest, harness.response);
      expect(harness.statusCode).toBe(401);
      expect(harness.body).toEqual({ error: "invalid_ingestion_credentials" });
    } finally {
      if (previous === undefined) delete process.env.SOVEREIGNHALT_INGEST_AGENTS_JSON;
      else process.env.SOVEREIGNHALT_INGEST_AGENTS_JSON = previous;
    }
  });
});
