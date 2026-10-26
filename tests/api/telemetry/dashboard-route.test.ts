import { describe, expect, it } from "vitest";
import type { ApiRequest, ApiResponse } from "../../../server/api/telemetry/common";
import dashboardRoute from "../../../api/telemetry/dashboard";

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

describe("dashboard Vercel route wrapper", () => {
  it("returns 401 for a request without a bearer token before touching the data source", async () => {
    const harness = responseHarness();
    await dashboardRoute({ method: "GET", headers: {} } as ApiRequest, harness.response);
    expect(harness.statusCode).toBe(401);
    expect(harness.body).toEqual({ error: "authentication_required" });
    expect(harness.headers["Cache-Control"]).toBe("private, no-store, max-age=0");
    expect(harness.headers.Vary).toBe("Authorization");
  });

  it("rejects non-GET methods at the Vercel entrypoint", async () => {
    const harness = responseHarness();
    await dashboardRoute({ method: "POST", headers: {} } as ApiRequest, harness.response);
    expect(harness.statusCode).toBe(405);
    expect(harness.body).toEqual({ error: "method_not_allowed" });
    expect(harness.headers.Allow).toBe("GET");
  });
});
