import type { ApiRequest, ApiResponse } from "../../server/api/telemetry/common";

export default async function ingestRoute(request: ApiRequest, response: ApiResponse) {
  response.setHeader("Cache-Control", "private, no-store, max-age=0");
  response.setHeader("Vary", "Authorization");
  response.setHeader("X-Content-Type-Options", "nosniff");

  if (request.method !== "POST") {
    request.resume?.();
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "method_not_allowed" });
  }

  const { default: ingestHandler } = await import("../../server/api/telemetry/ingest");
  return ingestHandler(request, response);
}
