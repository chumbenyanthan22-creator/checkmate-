import { z } from "zod";
import {
  bearerToken,
  createAdminClient,
  getSovereignHaltWorkspace,
  readBoundedRequestBody,
  respond,
  secureTokenMatch,
  setPrivateHeaders,
  type ApiRequest,
  type ApiResponse,
} from "./common";

const slugPattern = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;
const actionPattern = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,119}$/;
const signalSchema = z.enum([
  "guard_allowed",
  "loop_detected",
  "max_iterations_exceeded",
  "budget_exceeded",
  "policy_blocked",
  "approval_required",
]);

export const configuredAgentSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().toLowerCase().regex(slugPattern),
  token: z.string().min(32).max(512),
  description: z.string().trim().max(240).optional(),
  agent_class: z.enum(["standard", "privileged"]),
  risk_level: z.enum(["low", "medium", "high", "critical"]),
}).strict();

export const configuredAgentsSchema = z.array(configuredAgentSchema).min(1).max(100).superRefine((agents, context) => {
  const slugs = new Set<string>();
  const names = new Set<string>();
  const tokens = new Set<string>();
  const ids = new Set<string>();
  for (const [index, agent] of agents.entries()) {
    if (slugs.has(agent.slug))
      context.addIssue({ code: "custom", path: [index, "slug"], message: "Agent slugs must be unique" });
    if (names.has(agent.name))
      context.addIssue({ code: "custom", path: [index, "name"], message: "Agent names must be unique" });
    if (tokens.has(agent.token))
      context.addIssue({ code: "custom", path: [index, "token"], message: "Each agent needs a distinct token" });
    if (agent.id && ids.has(agent.id))
      context.addIssue({ code: "custom", path: [index, "id"], message: "Agent UUIDs must be unique" });
    slugs.add(agent.slug);
    names.add(agent.name);
    tokens.add(agent.token);
    if (agent.id) ids.add(agent.id);
  }
});

export const payloadSchema = z.object({
  event: z.object({
    id: z.string().uuid(),
    action: z.string().regex(actionPattern),
    signal: signalSchema,
  }).strict(),
}).strict();

export const signalResult = {
  guard_allowed: {
    outcome: "allowed",
    status: "active",
    riskLevel: "low",
    detail: "Pre-dispatch guard allowed the tool call.",
  },
  loop_detected: {
    outcome: "blocked",
    status: "paused",
    riskLevel: "critical",
    detail: "Loop detected: repeated identical tool sequence blocked before dispatch.",
  },
  max_iterations_exceeded: {
    outcome: "blocked",
    status: "paused",
    riskLevel: "high",
    detail: "Maximum iteration limit blocked the tool call before dispatch.",
  },
  budget_exceeded: {
    outcome: "blocked",
    status: "paused",
    riskLevel: "high",
    detail: "Session budget limit blocked the tool call before dispatch.",
  },
  policy_blocked: {
    outcome: "blocked",
    status: "paused",
    riskLevel: "high",
    detail: "Policy blocked the tool call before dispatch.",
  },
  approval_required: {
    outcome: "approval",
    status: "review",
    riskLevel: "medium",
    detail: "Tool call requires operator approval before dispatch.",
  },
} as const;

export type ConfiguredAgent = z.infer<typeof configuredAgentSchema>;

export function parseConfiguredAgents(raw: string | undefined): ConfiguredAgent[] | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = configuredAgentsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function authorizeConfiguredAgent(
  agents: ConfiguredAgent[],
  candidateToken: string | null,
): ConfiguredAgent | null {
  if (!candidateToken) return null;
  let match: ConfiguredAgent | null = null;
  for (const agent of agents) {
    if (secureTokenMatch(candidateToken, agent.token)) match = agent;
  }
  return match;
}

export default async function ingestHandler(request: ApiRequest, response: ApiResponse) {
  setPrivateHeaders(response);
  if (request.method !== "POST") {
    request.resume?.();
    response.setHeader("Allow", "POST");
    return respond(response, 405, { error: "method_not_allowed" });
  }

  const configuredAgents = parseConfiguredAgents(process.env.SOVEREIGNHALT_INGEST_AGENTS_JSON);
  if (!configuredAgents) {
    request.resume?.();
    return respond(response, 503, { error: "ingestion_not_configured" });
  }

  const agent = authorizeConfiguredAgent(configuredAgents, bearerToken(request));
  if (!agent) {
    request.resume?.();
    return respond(response, 401, { error: "invalid_ingestion_credentials" });
  }

  const body = await readBoundedRequestBody(request);
  if (!body.ok)
    return respond(response, body.reason === "too_large" ? 413 : 400, {
      error: body.reason === "too_large" ? "telemetry_body_too_large" : "invalid_telemetry_payload",
    });
  const parsed = payloadSchema.safeParse(body.value);
  if (!parsed.success)
    return respond(response, 400, { error: "invalid_telemetry_payload" });
  const { event } = parsed.data;

  const admin = createAdminClient();
  if (!admin) return respond(response, 503, { error: "private_data_source_unconfigured" });

  try {
    const { workspace, error: workspaceError } = await getSovereignHaltWorkspace(admin, true);
    if (workspaceError || !workspace)
      return respond(response, 503, { error: "private_workspace_unavailable" });

    const now = new Date().toISOString();
    const { data: existingAgent, error: lookupError } = await admin
      .from("agents")
      .select("id, name, slug")
      .eq("workspace_id", workspace.id)
      .eq("slug", agent.slug)
      .maybeSingle();
    if (lookupError)
      return respond(response, 503, { error: "agent_registration_failed" });
    if (
      existingAgent &&
      (existingAgent.name !== agent.name || existingAgent.slug !== agent.slug || (agent.id && existingAgent.id !== agent.id))
    ) return respond(response, 409, { error: "configured_agent_identity_conflict" });

    let agentRecord = existingAgent;
    if (!agentRecord) {
      const provisionalAgent: Record<string, string> = {
        workspace_id: workspace.id,
        slug: agent.slug,
        name: agent.name,
        description: agent.description ?? "",
        status: "review",
        risk_level: agent.risk_level,
        agent_class: agent.agent_class,
        last_seen_at: "1970-01-01T00:00:00.000Z",
      };
      if (agent.id) provisionalAgent.id = agent.id;
      const { data: createdAgent, error: createAgentError } = await admin
        .from("agents")
        .insert(provisionalAgent)
        .select("id, name, slug")
        .single();
      if (!createAgentError && createdAgent) {
        agentRecord = createdAgent;
      } else {
        const { data: racedAgent, error: racedLookupError } = await admin
          .from("agents")
          .select("id, name, slug")
          .eq("workspace_id", workspace.id)
          .eq("slug", agent.slug)
          .maybeSingle();
        if (
          racedLookupError ||
          !racedAgent ||
          racedAgent.name !== agent.name ||
          racedAgent.slug !== agent.slug ||
          (agent.id && racedAgent.id !== agent.id)
        ) return respond(response, 503, { error: "agent_registration_failed" });
        agentRecord = racedAgent;
      }
    }

    const eventPayload = {
      id: event.id,
      workspace_id: workspace.id,
      agent_id: agentRecord.id,
      agent_name: agent.name,
      action: event.action,
      detail: signalResult[event.signal].detail,
      outcome: signalResult[event.signal].outcome,
      risk_level: signalResult[event.signal].riskLevel,
      metadata: { source: "sovereignhalt_python_sdk", signal: event.signal },
      created_at: now,
    };
    const { data: insertedEvent, error: eventError } = await admin
      .from("audit_events")
      .upsert(eventPayload, { onConflict: "id", ignoreDuplicates: true })
      .select("id, created_at")
      .maybeSingle();
    if (eventError)
      return respond(response, 503, { error: "telemetry_write_failed" });

    let auditEvent = insertedEvent;
    if (!auditEvent) {
      const { data: existingEvent, error: duplicateLookupError } = await admin
        .from("audit_events")
        .select("id, created_at, agent_id, agent_name, action, detail, outcome, risk_level, metadata")
        .eq("id", event.id)
        .eq("workspace_id", workspace.id)
        .maybeSingle();
      if (duplicateLookupError || !existingEvent)
        return respond(response, 503, { error: "telemetry_write_failed" });
      if (
        existingEvent.agent_id !== agentRecord.id ||
        existingEvent.agent_name !== agent.name ||
        existingEvent.action !== event.action ||
        existingEvent.detail !== signalResult[event.signal].detail ||
        existingEvent.outcome !== signalResult[event.signal].outcome ||
        existingEvent.risk_level !== signalResult[event.signal].riskLevel ||
        existingEvent.metadata?.signal !== event.signal ||
        existingEvent.metadata?.source !== "sovereignhalt_python_sdk"
      ) return respond(response, 409, { error: "event_id_conflict" });
      auditEvent = existingEvent;
    }

    const { data: updatedAgent, error: updateAgentError } = await admin
      .from("agents")
      .update({
        description: agent.description ?? "",
        status: signalResult[event.signal].status,
        risk_level: agent.risk_level,
        agent_class: agent.agent_class,
        last_seen_at: now,
      })
      .eq("id", agentRecord.id)
      .eq("workspace_id", workspace.id)
      .select("id, name, slug")
      .single();
    if (updateAgentError || !updatedAgent)
      return respond(response, 503, { error: "agent_registration_failed" });

    return respond(response, 201, {
      workspace: { id: workspace.id, slug: workspace.slug, name: workspace.name },
      agent: { id: updatedAgent.id, slug: agent.slug, name: agent.name },
      event: { id: auditEvent.id, created_at: auditEvent.created_at },
    });
  } catch {
    return respond(response, 503, { error: "telemetry_write_failed" });
  }
}
