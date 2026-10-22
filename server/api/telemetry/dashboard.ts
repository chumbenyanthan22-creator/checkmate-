import {
  bearerToken,
  createAdminClient,
  emailIsAllowlisted,
  getSovereignHaltWorkspace,
  respond,
  setPrivateHeaders,
  type ApiRequest,
  type ApiResponse,
} from "./common";
import {
  parseConfiguredAgents,
  signalResult,
  type ConfiguredAgent,
} from "./ingest";

type GuardSignal = keyof typeof signalResult;
type AgentRow = {
  id: string;
  name: string;
  slug: string;
  last_seen_at: string;
};
type EventRow = {
  id: string;
  agent_id: string | null;
  agent_name: string;
  action: string;
  detail: string;
  outcome: string;
  risk_level: string;
  created_at: string;
  metadata: unknown;
};

const actionPattern = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,119}$/;

function isGuardSignal(value: unknown): value is GuardSignal {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(signalResult, value);
}

export function mapDashboardRecords(
  agentRows: AgentRow[],
  eventRows: EventRow[],
  profiles: ConfiguredAgent[],
  sinceMilliseconds: number,
  nowMilliseconds: number,
) {
  const profilesBySlug = new Map(profiles.map(profile => [profile.slug, profile]));
  const registeredRows = agentRows.flatMap(row => {
    const profile = profilesBySlug.get(row.slug);
    const lastSeen = Date.parse(row.last_seen_at);
    if (
      !profile ||
      profile.name !== row.name ||
      (profile.id && profile.id !== row.id) ||
      !Number.isFinite(lastSeen) ||
      lastSeen < sinceMilliseconds ||
      lastSeen > nowMilliseconds
    ) return [];
    return [{
      id: row.id,
      name: profile.name,
      slug: profile.slug,
      description: (profile.description ?? "").slice(0, 240),
      risk_level: profile.risk_level,
      agent_class: profile.agent_class,
      last_seen_at: row.last_seen_at,
    }];
  });
  const agentsById = new Map(registeredRows.map(agent => [agent.id, agent]));

  const events = eventRows.flatMap(row => {
    if (!row.agent_id || !actionPattern.test(row.action)) return [];
    const linkedAgent = agentsById.get(row.agent_id);
    if (!linkedAgent || row.agent_name !== linkedAgent.name) return [];
    const createdAt = Date.parse(row.created_at);
    if (!Number.isFinite(createdAt) || createdAt < sinceMilliseconds || createdAt > nowMilliseconds) return [];
    const metadata = (row.metadata ?? {}) as Record<string, unknown>;
    const signal = metadata.signal;
    if (metadata.source !== "sovereignhalt_python_sdk" || !isGuardSignal(signal)) return [];
    const result = signalResult[signal];
    if (
      row.outcome !== result.outcome ||
      row.detail !== result.detail ||
      row.risk_level !== result.riskLevel
    ) return [];
    return [{
      id: row.id,
      agent_id: row.agent_id,
      agent_name: linkedAgent.name,
      action: row.action,
      detail: result.detail,
      outcome: result.outcome,
      risk_level: result.riskLevel,
      signal,
      created_at: row.created_at,
    }];
  });

  const observedAgentIds = new Set(events.map(event => event.agent_id));
  const agents = registeredRows.filter(agent => observedAgentIds.has(agent.id));
  return { agents, events };
}

export default async function dashboardHandler(request: ApiRequest, response: ApiResponse) {
  setPrivateHeaders(response);
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return respond(response, 405, { error: "method_not_allowed" });
  }

  const token = bearerToken(request);
  if (!token) return respond(response, 401, { error: "authentication_required" });

  const admin = createAdminClient();
  if (!admin) return respond(response, 503, { error: "private_data_source_unconfigured" });

  const allowedEmails = process.env.SOVEREIGNHALT_ALLOWED_EMAILS;
  if (!allowedEmails?.trim())
    return respond(response, 503, { error: "dashboard_access_not_configured" });

  try {
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    const user = authData.user;
    const email = user?.email ?? null;
    const verifiedEmail = Boolean(user?.email_confirmed_at || user?.confirmed_at);
    if (authError || !email || !verifiedEmail)
      return respond(response, 401, { error: "authentication_required" });
    if (!emailIsAllowlisted(email, allowedEmails))
      return respond(response, 403, { error: "dashboard_access_denied" });

    const configuredAgents = parseConfiguredAgents(process.env.SOVEREIGNHALT_INGEST_AGENTS_JSON);
    if (!configuredAgents)
      return respond(response, 503, { error: "dashboard_agent_registry_unconfigured" });

    const { workspace, error: workspaceError } = await getSovereignHaltWorkspace(admin);
    if (workspaceError)
      return respond(response, 503, { error: "private_workspace_unavailable" });
    if (!workspace)
      return respond(response, 200, { workspace: null, agents: [], events: [] });

    const nowMilliseconds = Date.now();
    const now = new Date(nowMilliseconds).toISOString();
    const sinceMilliseconds = nowMilliseconds - 30 * 24 * 60 * 60 * 1000;
    const since = new Date(sinceMilliseconds).toISOString();
    const [agentResult, eventResult] = await Promise.all([
      admin
        .from("agents")
        .select("id, name, slug, last_seen_at")
        .eq("workspace_id", workspace.id)
        .gte("last_seen_at", since)
        .lte("last_seen_at", now)
        .order("last_seen_at", { ascending: false })
        .limit(100),
      admin
        .from("audit_events")
        .select("id, agent_id, agent_name, action, detail, outcome, risk_level, created_at, metadata")
        .eq("workspace_id", workspace.id)
        .contains("metadata", { source: "sovereignhalt_python_sdk" })
        .gte("created_at", since)
        .lte("created_at", now)
        .order("created_at", { ascending: false })
        .limit(250),
    ]);

    if (agentResult.error || eventResult.error)
      return respond(response, 503, { error: "private_telemetry_unavailable" });

    const { agents, events } = mapDashboardRecords(
      agentResult.data ?? [],
      eventResult.data ?? [],
      configuredAgents,
      sinceMilliseconds,
      nowMilliseconds,
    );
    return respond(response, 200, {
      workspace: { id: workspace.id, slug: workspace.slug, name: workspace.name },
      agents,
      events,
    });
  } catch {
    return respond(response, 503, { error: "private_telemetry_unavailable" });
  }
}
