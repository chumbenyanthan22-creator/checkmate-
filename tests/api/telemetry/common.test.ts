import { describe, expect, it } from "vitest";
import {
  bearerToken,
  emailIsAllowlisted,
  parseRequestBody,
  readBoundedRequestBody,
  secureTokenMatch,
} from "../../../server/api/telemetry/common";

describe("private telemetry API guards", () => {
  it("extracts a bearer token without accepting other schemes", () => {
    expect(bearerToken({ headers: { authorization: "Bearer secret-token" } })).toBe("secret-token");
    expect(bearerToken({ headers: { authorization: "Basic secret-token" } })).toBeNull();
  });

  it("compares ingest tokens safely and rejects absent or different-length values", () => {
    expect(secureTokenMatch("same-length", "same-length")).toBe(true);
    expect(secureTokenMatch("different", "same-length")).toBe(false);
    expect(secureTokenMatch(null, "configured-token")).toBe(false);
  });

  it("normalizes email casing and whitespace in the allowlist", () => {
    expect(emailIsAllowlisted("Owner@Example.com", " owner@example.com, analyst@example.com ")).toBe(true);
    expect(emailIsAllowlisted("other@example.com", " owner@example.com ")).toBe(false);
    expect(emailIsAllowlisted("owner@example.com", undefined)).toBe(false);
  });

  it("bounds request bodies before parsing or schema validation", () => {
    expect(parseRequestBody('{"signal":"guard_allowed"}')).toEqual({ signal: "guard_allowed" });
    expect(parseRequestBody(`{"detail":"${"x".repeat(5000)}"}`)).toBeNull();
    expect(parseRequestBody({ detail: "x".repeat(5000) })).toBeNull();
    expect(parseRequestBody("{not-json")).toBeNull();
  });

  it("parses a bounded raw stream without evaluating a lazy parsed-body getter", async () => {
    const request = {
      headers: {},
      get body() {
        throw new Error("parsed body getter must not be accessed");
      },
      async *[Symbol.asyncIterator]() {
        yield Buffer.from('{"signal":"guard_allowed"}');
      },
    };
    await expect(readBoundedRequestBody(request)).resolves.toEqual({
      ok: true,
      value: { signal: "guard_allowed" },
    });
  });

  it("rejects oversized declared and chunked raw bodies at 4 KiB", async () => {
    let declaredBodyRead = false;
    const declared = {
      headers: { "content-length": "4097" },
      resume() {},
      async *[Symbol.asyncIterator]() {
        declaredBodyRead = true;
        yield Buffer.from("{}");
      },
    };
    await expect(readBoundedRequestBody(declared)).resolves.toEqual({
      ok: false,
      reason: "too_large",
    });
    expect(declaredBodyRead).toBe(false);

    const chunked = {
      headers: {},
      async *[Symbol.asyncIterator]() {
        yield Buffer.alloc(4097, 120);
      },
    };
    await expect(readBoundedRequestBody(chunked)).resolves.toEqual({
      ok: false,
      reason: "too_large",
    });
  });
});
