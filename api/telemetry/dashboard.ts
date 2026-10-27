import type { ApiRequest, ApiResponse } from "../../server/api/telemetry/common.js";
import dashboardHandler from "../../server/api/telemetry/dashboard.js";

export default async function dashboardRoute(request: ApiRequest, response: ApiResponse) {
  response.setHeader("Cache-Control", "private, no-store, max-age=0");
  response.setHeader("Vary", "Authorization");
  response.setHeader("X-Content-Type-Options", "nosniff");

  if (request.method !== "GET") {
    request.resume?.();
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "method_not_allowed" });
  }

  return dashboardHandler(request, response);
}
