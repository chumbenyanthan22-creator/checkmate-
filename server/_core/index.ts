import "dotenv/config";
import express from "express";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { publicPlatformScript } from "./publicConfig";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import dashboardTelemetryHandler from "../api/telemetry/dashboard";
import ingestTelemetryHandler from "../api/telemetry/ingest";
import type { ApiRequest, ApiResponse } from "../api/telemetry/common";

function adaptTelemetryRequest(request: import("express").Request): ApiRequest {
  return {
    method: request.method,
    headers: request.headers as ApiRequest["headers"],
    [Symbol.asyncIterator]: () => request[Symbol.asyncIterator](),
    resume: () => request.resume(),
  };
}

function telemetryRoute(
  handler: (request: ApiRequest, response: ApiResponse) => Promise<void>,
) {
  return (request: import("express").Request, response: import("express").Response) => {
    void handler(adaptTelemetryRequest(request), response as unknown as ApiResponse).catch(() => {
      if (!response.headersSent)
        response.status(500).json({ error: "internal_server_error" });
    });
  };
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Handle telemetry before the global parsers so its 4 KiB raw-stream cap applies.
  app.get("/api/telemetry/dashboard", telemetryRoute(dashboardTelemetryHandler));
  app.post("/api/telemetry/ingest", telemetryRoute(ingestTelemetryHandler));
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/api/platform/config.js", (_req, res) => {
    res.set("Cache-Control", "no-store").type("application/javascript").send(publicPlatformScript());
  });
  registerOAuthRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const port = Number(process.env.PORT || "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");
  server.on("error", error => { console.error("Server failed:", error.message); process.exit(1); });
  server.listen(port, "0.0.0.0", () => console.log(`Server listening on port ${port}`));
}

startServer().catch(error => { console.error(error); process.exit(1); });
