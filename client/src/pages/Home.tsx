import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Code2,
  Database,
  FileCheck2,
  FileClock,
  FileText,
  Gauge,
  LayoutDashboard,
  LockKeyhole,
  Menu,
  MoreHorizontal,
  Network,
  Pause,
  Play,
  Power,
  RefreshCw,
  Search,
  ServerCog,
  Settings2,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  UserCheck,
  X,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import "../cyberpunk.css";
import { isSupabaseConfigured, supabase, workspaceId } from "@/lib/supabase";
import { toast } from "sonner";

const RuntimeCoreScene = lazy(() => import("../components/AgentCoreScene"));

type DataState =
  | "loading"
  | "unconfigured"
  | "scope_missing"
  | "connected"
  | "empty"
  | "error";
type ActivityStatus = "allowed" | "blocked" | "approval";
type ViewId =
  | "overview"
  | "agents"
  | "policies"
  | "approvals"
  | "audit"
  | "plans"
  | "settings";

type SceneAgent = {
  id: string;
  name: string;
  status: string;
  risk: string;
  calls?: string;
};
type SceneMetric = {
  agents: string;
  approvals: string;
  events: string;
  blocked: string;
};
type DashboardEvent = {
  id: string;
  agent: string;
  agentId: string;
  action: string;
  detail: string;
  status: ActivityStatus;
  risk: string;
  time: string;
  createdAt: string | null;
  cost?: string;
};
type DashboardApproval = {
  id: string;
  agent: string;
  action: string;
  detail: string;
  risk: string;
  age: string;
};
type Policy = {
  id: string;
  title: string;
  description: string;
  scope: string;
  state: boolean;
};
type AgentRecord = SceneAgent & { description: string; className: string };

const navItems: { id: ViewId; label: string; icon: LucideIcon }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "agents", label: "Agent Registry", icon: Bot },
  { id: "policies", label: "Policies", icon: ShieldCheck },
  { id: "approvals", label: "Approvals", icon: UserCheck },
  { id: "audit", label: "Audit Trail", icon: FileClock },
  { id: "plans", label: "Plans & Pricing", icon: Gauge },
  { id: "settings", label: "Settings", icon: Settings2 },
];

const statusLabel: Record<ActivityStatus, string> = {
  allowed: "Allowed",
  blocked: "Blocked",
  approval: "Approval required",
};
const statusClass: Record<ActivityStatus, string> = {
  allowed: "status-allowed",
  blocked: "status-blocked",
  approval: "status-approval",
};

function titleCase(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}
function text(value: unknown): string {
  return value === null || value === undefined || value === ""
    ? "—"
    : String(value);
}
function related(value: unknown, field: string): string | undefined {
  if (Array.isArray(value)) return related(value[0], field);
  if (value && typeof value === "object")
    return text((value as Record<string, unknown>)[field]);
  return undefined;
}
function relativeTime(value: unknown): string {
  if (!value) return "—";
  const timestamp = new Date(String(value)).getTime();
  if (!Number.isFinite(timestamp)) return String(value);
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
function activityStatus(value: unknown): ActivityStatus | null {
  const normalized = String(value ?? "").toLowerCase();
  if (["allowed", "allow", "success", "completed"].includes(normalized))
    return "allowed";
  if (["blocked", "block", "denied", "rejected"].includes(normalized))
    return "blocked";
  if (
    ["approval", "pending", "review", "approval_required"].includes(normalized)
  )
    return "approval";
  return null;
}
function risk(value: unknown): string {
  return text(value);
}

function LogoMark() {
  return (
    <div className="logo-mark" aria-label="AgentBreaker logo">
      <ShieldCheck size={19} strokeWidth={2.5} />
      <span className="logo-break">/</span>
    </div>
  );
}
function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        <div className="eyebrow">
          <span className="eyebrow-line" />
          {eyebrow}
        </div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
function StatusPill({ status }: { status: ActivityStatus }) {
  const Icon =
    status === "allowed"
      ? CheckCircle2
      : status === "blocked"
        ? XCircle
        : Clock3;
  return (
    <span className={`status-pill ${statusClass[status]}`}>
      <Icon size={13} /> {statusLabel[status]}
    </span>
  );
}
function DataStatePanel({
  state,
  onRetry,
  compact = false,
}: {
  state: Exclude<DataState, "connected">;
  onRetry?: () => void;
  compact?: boolean;
}) {
  const copy: Record<
    Exclude<DataState, "connected">,
    { title: string; detail: string }
  > = {
    loading: {
      title: "Loading workspace data",
      detail: "Waiting for the scoped Supabase workspace query to complete.",
    },
    unconfigured: {
      title: "Supabase is not configured",
      detail:
        "Add the Supabase URL and publishable key to load workspace data.",
    },
    scope_missing: {
      title: "Workspace scope is missing",
      detail:
        "Set VITE_SUPABASE_WORKSPACE_ID before workspace data can be requested.",
    },
    empty: {
      title: "No workspace data yet",
      detail:
        "The selected workspace has no agents, approvals, or audit events to display.",
    },
    error: {
      title: "Workspace data could not be loaded",
      detail:
        "Supabase returned an error for one or more scoped workspace queries.",
    },
  };
  return (
    <section
      className={`panel empty-state ${compact ? "data-state-notice" : "tall"}`}
      role="status"
    >
      <AlertTriangle size={22} />
      <div>
        <strong>{copy[state].title}</strong>
        <p>{copy[state].detail}</p>
        {onRetry && (
          <button className="secondary-button" onClick={onRetry}>
            <RefreshCw size={14} /> Retry
          </button>
        )}
      </div>
    </section>
  );
}

function isWithinTimeRange(createdAt: string | null, range: string): boolean {
  if (!createdAt) return false;
  const timestamp = new Date(createdAt).getTime();
  if (!Number.isFinite(timestamp) || timestamp > Date.now()) return false;
  const hours = range === "7d" ? 24 * 7 : range === "30d" ? 24 * 30 : 24;
  return Date.now() - timestamp <= hours * 60 * 60 * 1000;
}

type HomeSceneProps = {
  dataState: DataState;
  agents: SceneAgent[];
  metrics: SceneMetric;
  timeRange: string;
  setTimeRange: (range: string) => void;
  events: DashboardEvent[];
  activityFilter: "all" | ActivityStatus;
  setActivityFilter: (filter: "all" | ActivityStatus) => void;
  agentFilter: string;
  setAgentFilter: (filter: string) => void;
  approvals: DashboardApproval[];
  onApproval: (id: string, action: "approved" | "blocked") => void;
  onEmergencyStop: () => void;
  emergencyStopped: boolean;
  onAgentSelect: (id: string) => void;
  onOpenAudit: () => void;
  onOpenApprovals: () => void;
};

type LegacySceneProps = Omit<HomeSceneProps, "metrics"> & {
  metrics: SceneMetric & { actions: string; spend: string; delta: string };
  spendTrend: never[];
  sessionSpend?: number;
};
const LegacyRuntimeCore =
  RuntimeCoreScene as unknown as ComponentType<LegacySceneProps>;
function AgentCoreScene(props: HomeSceneProps) {
  const metrics = {
    ...props.metrics,
    actions: props.metrics.events,
    spend: "—",
    delta: "—",
  };
  return <LegacyRuntimeCore {...props} metrics={metrics} spendTrend={[]} />;
}

export default function Home() {
  const [activeView, setActiveView] = useState<ViewId>("overview");
  const [timeRange, setTimeRange] = useState("24h");
  const [activityFilter, setActivityFilter] = useState<"all" | ActivityStatus>(
    "all"
  );
  const [agentFilter, setAgentFilter] = useState("all");
  const [dataState, setDataState] = useState<DataState>("loading");
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [events, setEvents] = useState<DashboardEvent[]>([]);
  const [approvals, setApprovals] = useState<DashboardApproval[]>([]);
  const [emergencyStopped, setEmergencyStopped] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [loadVersion, setLoadVersion] = useState(0);

  useEffect(() => {
    let mounted = true;
    const loadWorkspace = async () => {
      if (!isSupabaseConfigured) {
        setDataState("unconfigured");
        return;
      }
      if (!workspaceId) {
        setDataState("scope_missing");
        return;
      }
      const client = supabase;
      if (!client) {
        setDataState("unconfigured");
        return;
      }
      setDataState("loading");
      setAgents([]);
      setPolicies([]);
      setApprovals([]);
      setEvents([]);
      const scoped = (table: string, fields: string) =>
        client.from(table).select(fields).eq("workspace_id", workspaceId);
      try {
        const [agentsResult, policiesResult, approvalsResult, auditResult] =
          await Promise.all([
            scoped(
              "agents",
              "id, name, slug, description, status, risk_level, tool_calls, agent_class"
            ),
            scoped("policies", "id, title, description, scope, enabled"),
            scoped(
              "approvals",
              "id, reference, agent_id, action, detail, risk_level, requested_at, agents(name)"
            ).eq("status", "pending"),
            scoped(
              "audit_events",
              "id, agent_id, agent_name, action, detail, outcome, risk_level, created_at, agents(name)"
            ),
          ]);
        if (!mounted) return;
        if (
          agentsResult.error ||
          policiesResult.error ||
          approvalsResult.error ||
          auditResult.error
        ) {
          setDataState("error");
          return;
        }

        const nextAgents: AgentRecord[] = (agentsResult.data ?? []).map(row => {
          const item = row as unknown as Record<string, unknown>;
          return {
            id: text(item.id),
            name: text(item.name ?? item.slug),
            description: text(item.description),
            status: titleCase(text(item.status)),
            risk: risk(item.risk_level),
            calls:
              item.tool_calls === null || item.tool_calls === undefined
                ? undefined
                : String(item.tool_calls),
            className: titleCase(text(item.agent_class)),
          };
        });
        const nextPolicies: Policy[] = (policiesResult.data ?? []).map(row => {
          const item = row as unknown as Record<string, unknown>;
          return {
            id: text(item.id),
            title: text(item.title),
            description: text(item.description),
            scope: text(item.scope),
            state: Boolean(item.enabled),
          };
        });
        const nextApprovals: DashboardApproval[] = (
          approvalsResult.data ?? []
        ).map(row => {
          const item = row as unknown as Record<string, unknown>;
          const joined = related(item.agents, "name");
          return {
            id: text(item.reference ?? item.id),
            agent: text(joined ?? item.agent_id),
            action: text(item.action),
            detail: text(item.detail),
            risk: risk(item.risk_level),
            age: relativeTime(item.requested_at),
          };
        });
        const nextEvents: DashboardEvent[] = (auditResult.data ?? []).flatMap(
          row => {
            const item = row as unknown as Record<string, unknown>;
            const status = activityStatus(item.outcome);
            if (!status) return [];
            const createdAt =
              typeof item.created_at === "string" ? item.created_at : null;
            return [
              {
                id: text(item.id),
                agent: text(
                  item.agent_name ??
                    related(item.agents, "name") ??
                    item.agent_id
                ),
                agentId: text(item.agent_id),
                action: text(item.action),
                detail: text(item.detail),
                status,
                risk: risk(item.risk_level),
                time: relativeTime(createdAt),
                createdAt,
                cost:
                  item.cost === null || item.cost === undefined
                    ? undefined
                    : text(item.cost),
              },
            ];
          }
        );
        setAgents(nextAgents);
        setPolicies(nextPolicies);
        setApprovals(nextApprovals);
        setEvents(nextEvents);
        setDataState(
          nextAgents.length ||
            nextPolicies.length ||
            nextApprovals.length ||
            nextEvents.length
            ? "connected"
            : "empty"
        );
      } catch {
        if (mounted) setDataState("error");
      }
    };
    void loadWorkspace();
    return () => {
      mounted = false;
    };
  }, [loadVersion]);

  const timeFilteredEvents = useMemo(
    () => events.filter(event => isWithinTimeRange(event.createdAt, timeRange)),
    [events, timeRange]
  );
  const filteredEvents = useMemo(
    () =>
      timeFilteredEvents.filter(
        event =>
          (activityFilter === "all" || event.status === activityFilter) &&
          (agentFilter === "all" || event.agentId === agentFilter)
      ),
    [timeFilteredEvents, activityFilter, agentFilter]
  );
  const querySucceeded = dataState === "connected" || dataState === "empty";
  const metrics: SceneMetric = querySucceeded
    ? {
        agents: String(agents.length),
        approvals: String(approvals.length),
        events: String(timeFilteredEvents.length),
        blocked: String(
          timeFilteredEvents.filter(event => event.status === "blocked").length
        ),
      }
    : { agents: "—", approvals: "—", events: "—", blocked: "—" };
  const selectedAgent = agents.find(agent => agent.id === agentFilter) ?? null;
  const setView = (view: ViewId) => {
    setActiveView(view);
    setMobileNavOpen(false);
  };
  const openAgent = (id: string) => {
    setAgentFilter(id);
    setView("agents");
  };
  const togglePolicy = (id: string) => {
    setPolicies(current =>
      current.map(policy =>
        policy.id === id ? { ...policy, state: !policy.state } : policy
      )
    );
    toast.info(
      "Preview only: policy state changed locally; Supabase was not updated."
    );
  };
  const respondToApproval = (id: string, action: "approved" | "blocked") => {
    setApprovals(current => current.filter(approval => approval.id !== id));
    toast.info(
      `Preview only: action marked ${action}; no runtime action was sent.`
    );
  };
  const toggleEmergencyStop = () => {
    setEmergencyStopped(stopped => !stopped);
    toast.info(
      "Preview only: emergency control changed locally; no live runtime was stopped or resumed."
    );
  };

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNavOpen ? "sidebar-open" : ""}`}>
        <div className="brand-lockup">
          <LogoMark />
          <div>
            <div className="brand-name">AgentBreaker</div>
            <div className="brand-subtitle">Runtime control plane</div>
          </div>
        </div>
        <div className="workspace-switcher">
          <div className="workspace-avatar">W</div>
          <div className="workspace-copy">
            <span>
              {workspaceId ? "Scoped workspace" : "Workspace not selected"}
            </span>
            <small>
              {workspaceId ? workspaceId : "Configure a workspace scope"}
            </small>
          </div>
          <ChevronDown size={15} />
        </div>
        <div className="nav-label">Control center</div>
        <nav className="nav-list">
          {navItems.map(item => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={`nav-item ${activeView === item.id ? "nav-item-active" : ""}`}
                onClick={() => setView(item.id)}
              >
                <Icon size={17} />
                <span>{item.label}</span>
                {item.id === "approvals" && approvals.length > 0 && (
                  <span className="nav-badge">{approvals.length}</span>
                )}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-spacer" />
        <div className="runtime-card">
          <div className="runtime-card-header">
            <span className="preview-dot" /> Local controls{" "}
            <span className="runtime-live">PREVIEW</span>
          </div>
          <p>
            Policy, approval, and emergency controls are local-only previews.
          </p>
        </div>
        <button className="user-card" onClick={() => setView("settings")}>
          <div className="user-avatar">—</div>
          <div>
            <strong>Local operator</strong>
            <small>No identity connected</small>
          </div>
          <MoreHorizontal size={17} />
        </button>
      </aside>
      <main className="main-content">
        <header className="topbar">
          <button
            className="mobile-menu"
            onClick={() => setMobileNavOpen(current => !current)}
          >
            <Menu size={20} />
          </button>
          <div className="breadcrumb">
            <span>Control center</span>
            <ChevronRight size={14} />
            <strong>
              {navItems.find(item => item.id === activeView)?.label}
            </strong>
          </div>
          <div className="topbar-actions">
            <div className={`system-state system-state-${dataState}`}>
              {dataState === "connected"
                ? "Supabase scoped"
                : dataState.replace("_", " ")}
            </div>
          </div>
        </header>
        {emergencyStopped && (
          <div className="emergency-banner">
            <div>
              <Power size={18} />
              <strong>Preview stop enabled</strong>
              <span>No live runtime action was sent.</span>
            </div>
            <button onClick={toggleEmergencyStop}>Resume preview</button>
          </div>
        )}
        <div
          className={`content-wrap ${activeView === "overview" ? "content-wrap-immersive" : ""} ${emergencyStopped ? "emergency-visible" : ""}`}
        >
          {activeView === "overview" && (
            <OverviewView
              dataState={dataState}
              metrics={metrics}
              timeRange={timeRange}
              setTimeRange={setTimeRange}
              events={filteredEvents}
              activityFilter={activityFilter}
              setActivityFilter={setActivityFilter}
              agentFilter={agentFilter}
              setAgentFilter={setAgentFilter}
              approvals={approvals}
              onApproval={respondToApproval}
              onEmergencyStop={toggleEmergencyStop}
              emergencyStopped={emergencyStopped}
              onAgentSelect={openAgent}
              onOpenAudit={() => setView("audit")}
              onOpenApprovals={() => setView("approvals")}
              agents={agents}
              onRetry={() => setLoadVersion(version => version + 1)}
            />
          )}
          {activeView === "agents" && (
            <AgentsView
              dataState={dataState}
              agents={agents}
              selectedAgent={selectedAgent}
              onSelect={openAgent}
              onRetry={() => setLoadVersion(version => version + 1)}
            />
          )}
          {activeView === "policies" && (
            <PoliciesView
              dataState={dataState}
              policies={policies}
              onToggle={togglePolicy}
              onRetry={() => setLoadVersion(version => version + 1)}
            />
          )}
          {activeView === "approvals" && (
            <ApprovalsView
              dataState={dataState}
              approvals={approvals}
              onRespond={respondToApproval}
              onRetry={() => setLoadVersion(version => version + 1)}
            />
          )}
          {activeView === "audit" && (
            <AuditView
              dataState={dataState}
              events={events}
              onRetry={() => setLoadVersion(version => version + 1)}
            />
          )}
          {activeView === "plans" && <PlansView />}
          {activeView === "settings" && (
            <SettingsView
              dataState={dataState}
              stopped={emergencyStopped}
              onEmergencyStop={toggleEmergencyStop}
            />
          )}
        </div>
      </main>
    </div>
  );
}

function OverviewView(
  props: HomeSceneProps & { onRetry: () => void; agents: AgentRecord[] }
) {
  return (
    <>
      <PageHeader
        eyebrow="Agent runtime control plane"
        title="Welcome to AgentBreaker"
        description="The 3D workspace stays visible while only verified, explicitly scoped records are shown."
      />
      {props.dataState !== "connected" && (
        <DataStatePanel
          compact
          state={props.dataState}
          onRetry={props.dataState === "error" ? props.onRetry : undefined}
        />
      )}
      <Suspense
        fallback={
          <section className="panel cp-control-deck cp-control-deck-loading">
            <span className="cp-loading-orbit" />
            Loading runtime view…
          </section>
        }
      >
        <AgentCoreScene
          dataState={props.dataState}
          agents={props.agents}
          metrics={props.metrics}
          timeRange={props.timeRange}
          setTimeRange={props.setTimeRange}
          events={props.events}
          activityFilter={props.activityFilter}
          setActivityFilter={props.setActivityFilter}
          agentFilter={props.agentFilter}
          setAgentFilter={props.setAgentFilter}
          approvals={props.approvals}
          onApproval={props.onApproval}
          onEmergencyStop={props.onEmergencyStop}
          emergencyStopped={props.emergencyStopped}
          onAgentSelect={props.onAgentSelect}
          onOpenAudit={props.onOpenAudit}
          onOpenApprovals={props.onOpenApprovals}
        />
      </Suspense>
    </>
  );
}

function QueryState({
  dataState,
  onRetry,
}: {
  dataState: DataState;
  onRetry: () => void;
}) {
  if (dataState === "connected" || dataState === "empty") return null;
  return (
    <DataStatePanel
      state={dataState}
      onRetry={dataState === "error" ? onRetry : undefined}
    />
  );
}
function AgentsView({
  dataState,
  agents,
  selectedAgent,
  onSelect,
  onRetry,
}: {
  dataState: DataState;
  agents: AgentRecord[];
  selectedAgent: AgentRecord | null;
  onSelect: (id: string) => void;
  onRetry: () => void;
}) {
  const [search, setSearch] = useState("");
  const normalizedSearch = search.trim().toLowerCase();
  const visibleAgents = agents.filter(
    agent =>
      !normalizedSearch ||
      [
        agent.name,
        agent.description,
        agent.className,
        agent.status,
        agent.risk,
      ].some(value => value.toLowerCase().includes(normalizedSearch))
  );
  return (
    <>
      <PageHeader
        eyebrow="Inventory"
        title="Agent registry"
        description="Agents returned by the selected Supabase workspace."
      />
      <QueryState dataState={dataState} onRetry={onRetry} />
      {(dataState === "connected" || dataState === "empty") && (
        <>
          <div className="search-field" role="search">
            <Search size={16} />
            <input
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Search loaded agents..."
              aria-label="Search loaded agents"
            />
          </div>
          <div className="agent-grid">
            {visibleAgents.map(agent => (
              <button
                className={`agent-card ${selectedAgent?.id === agent.id ? "agent-card-selected" : ""}`}
                key={agent.id}
                onClick={() => onSelect(agent.id)}
              >
                <div className="agent-card-top">
                  <span className="agent-avatar">
                    <Bot size={18} />
                  </span>
                  <span
                    className={`status-badge ${agent.status.toLowerCase()}`}
                  >
                    <span className="status-dot" />
                    {agent.status}
                  </span>
                </div>
                <h3>{agent.name}</h3>
                <p>{agent.description}</p>
                <div className="agent-card-meta">
                  <span>{agent.className}</span>
                  <span>{agent.risk} risk</span>
                  {agent.calls && <span>{agent.calls} calls</span>}
                </div>
              </button>
            ))}
            {agents.length === 0 && <DataStatePanel state="empty" />}
            {agents.length > 0 && visibleAgents.length === 0 && (
              <div className="empty-state">
                No loaded agents match “{search}”.
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
function PoliciesView({
  dataState,
  policies,
  onToggle,
  onRetry,
}: {
  dataState: DataState;
  policies: Policy[];
  onToggle: (id: string) => void;
  onRetry: () => void;
}) {
  return (
    <>
      <PageHeader
        eyebrow="Guardrails"
        title="Policies"
        description="Workspace policies from Supabase. Changes here are preview-only and are not persisted."
      />
      <QueryState dataState={dataState} onRetry={onRetry} />
      {(dataState === "connected" || dataState === "empty") && (
        <>
          <div className="policy-grid">
            {policies.map(policy => (
              <section className="panel policy-card" key={policy.id}>
                <div className="policy-card-head">
                  <div className="policy-icon">
                    <Shield size={17} />
                  </div>
                  <button
                    className={`toggle ${policy.state ? "toggle-on" : ""}`}
                    onClick={() => onToggle(policy.id)}
                    aria-pressed={policy.state}
                  >
                    <span />
                  </button>
                </div>
                <h3>{policy.title}</h3>
                <p>{policy.description}</p>
                <div className="policy-footer">
                  <span>{policy.scope}</span>
                  <strong>{policy.state ? "Enabled" : "Disabled"}</strong>
                </div>
              </section>
            ))}
            {policies.length === 0 && <DataStatePanel state="empty" />}
          </div>
          <p className="muted-note">
            <AlertTriangle size={14} /> Preview-only policy controls do not
            write to Supabase or change a live runtime.
          </p>
        </>
      )}
    </>
  );
}
function ApprovalsView({
  dataState,
  approvals,
  onRespond,
  onRetry,
}: {
  dataState: DataState;
  approvals: DashboardApproval[];
  onRespond: (id: string, action: "approved" | "blocked") => void;
  onRetry: () => void;
}) {
  return (
    <>
      <PageHeader
        eyebrow="Human-in-the-loop"
        title="Approvals"
        description="Pending actions returned by the selected workspace. Decisions below are local previews."
      />
      <QueryState dataState={dataState} onRetry={onRetry} />
      {(dataState === "connected" || dataState === "empty") && (
        <section className="panel">
          <div className="panel-header">
            <div>
              <div className="panel-kicker">Needs attention</div>
              <h2>Pending decisions</h2>
            </div>
            <span className="header-chip">
              <Clock3 size={15} /> {approvals.length} pending
            </span>
          </div>
          <div className="approval-page-list">
            {approvals.map(approval => (
              <div className="approval-page-card" key={approval.id}>
                <div className="approval-page-main">
                  <div className="approval-card-top">
                    <span className="risk-tag">{approval.risk} risk</span>
                    <span className="approval-id">{approval.id}</span>
                    <small>{approval.age}</small>
                  </div>
                  <h3>{approval.action}</h3>
                  <p>{approval.detail}</p>
                  <div className="approval-agent">
                    <div className="mini-avatar">
                      <Bot size={14} />
                    </div>
                    {approval.agent}
                  </div>
                </div>
                <div className="approval-page-actions">
                  <button
                    className="approve-button"
                    onClick={() => onRespond(approval.id, "approved")}
                  >
                    <Check size={14} /> Approve preview
                  </button>
                  <button
                    className="block-button"
                    onClick={() => onRespond(approval.id, "blocked")}
                  >
                    <X size={14} /> Block preview
                  </button>
                </div>
              </div>
            ))}
            {approvals.length === 0 && (
              <div className="empty-state tall">
                <CheckCircle2 size={22} />
                No pending workspace approvals.
              </div>
            )}
          </div>
        </section>
      )}
    </>
  );
}
function AuditView({
  dataState,
  events,
  onRetry,
}: {
  dataState: DataState;
  events: DashboardEvent[];
  onRetry: () => void;
}) {
  return (
    <>
      <PageHeader
        eyebrow="Evidence layer"
        title="Audit trail"
        description="Audit events returned by the selected Supabase workspace."
      />
      <QueryState dataState={dataState} onRetry={onRetry} />
      {(dataState === "connected" || dataState === "empty") && (
        <>
          <div className="audit-summary">
            <div>
              <strong>{events.length}</strong>
              <span>events loaded</span>
            </div>
            <div>
              <strong>
                {events.filter(event => event.status === "blocked").length}
              </strong>
              <span>blocked events</span>
            </div>
            <div>
              <strong>
                {events.filter(event => event.status === "approval").length}
              </strong>
              <span>approval events</span>
            </div>
          </div>
          <section className="panel audit-panel">
            <div className="audit-toolbar">
              <div className="search-field">
                <Search size={16} />
                <input placeholder="Search loaded events..." disabled />
              </div>
              <div className="select-wrap compact">
                <select defaultValue="all" disabled>
                  <option value="all">All outcomes</option>
                </select>
                <ChevronDown size={14} />
              </div>
            </div>
            <div className="audit-table">
              <div className="audit-table-head">
                <span>Outcome</span>
                <span>Action</span>
                <span>Agent</span>
                <span>Risk</span>
                <span>Cost</span>
                <span>Time</span>
              </div>
              {events.map(event => (
                <div className="audit-table-row" key={event.id}>
                  <StatusPill status={event.status} />
                  <div>
                    <strong>{event.action}</strong>
                    <small>{event.detail}</small>
                  </div>
                  <span>{event.agent}</span>
                  <span className="risk-tag">{event.risk}</span>
                  <span className="audit-cost">{event.cost ?? "—"}</span>
                  <span className="audit-time">{event.time}</span>
                  <ChevronRight size={15} />
                </div>
              ))}
              {events.length === 0 && (
                <div className="empty-state">No audit events returned.</div>
              )}
            </div>
          </section>
        </>
      )}
    </>
  );
}
function PlansView() {
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const selectPlan = (plan: string) => {
    setSelectedPlan(plan);
    toast.info(
      `${plan} selected locally. Billing and checkout are not connected; no purchase was made.`
    );
  };
  return (
    <>
      <PageHeader
        eyebrow="Plans"
        title="Plans & Pricing"
        description="Select a plan locally for preview; billing and checkout are not connected."
      />
      <div className="pricing-grid">
        <section
          className={`panel pricing-card ${selectedPlan === "30-day option" ? "pricing-card-selected" : ""}`}
        >
          <div className="panel-kicker">30-day free trial</div>
          <h2>$0</h2>
          <p>Explore the control plane before committing to a paid plan.</p>
          <button
            className="secondary-button"
            onClick={() => selectPlan("30-day option")}
          >
            Select locally
          </button>
        </section>
        <section
          className={`panel pricing-card pricing-card-popular ${selectedPlan === "Team" ? "pricing-card-selected" : ""}`}
        >
          <span className="pricing-popular">Popular</span>
          <div className="panel-kicker">Team</div>
          <h2>$299/month</h2>
          <p>For teams evaluating ongoing agent oversight.</p>
          <button className="primary-button" onClick={() => selectPlan("Team")}>
            Select locally
          </button>
        </section>
        <section
          className={`panel pricing-card ${selectedPlan === "Enterprise" ? "pricing-card-selected" : ""}`}
        >
          <div className="panel-kicker">Enterprise</div>
          <h2>$1,499/month</h2>
          <p>For organizations considering a broader governance rollout.</p>
          <button
            className="secondary-button"
            onClick={() => selectPlan("Enterprise")}
          >
            Select locally
          </button>
        </section>
      </div>
      <p className="muted-note">
        <AlertTriangle size={14} />{" "}
        {selectedPlan
          ? `${selectedPlan} is selected locally. Billing is not connected and no purchase was made.`
          : "Billing and checkout are not connected; selections stay local to this preview."}
      </p>
    </>
  );
}
function SettingsView({
  dataState,
  stopped,
  onEmergencyStop,
}: {
  dataState: DataState;
  stopped: boolean;
  onEmergencyStop: () => void;
}) {
  return (
    <>
      <PageHeader
        eyebrow="Workspace configuration"
        title="Settings"
        description="Review connection state and local preview controls."
      />
      <div className="settings-layout">
        <div className="settings-nav">
          <div className="settings-nav-active">
            <Settings2 size={16} /> Workspace
          </div>
        </div>
        <div className="settings-content">
          <section className="panel settings-panel">
            <div className="panel-header">
              <div>
                <div className="panel-kicker">Workspace</div>
                <h2>
                  {workspaceId ? "Scoped workspace" : "Workspace not selected"}
                </h2>
              </div>
              <span className="connected-pill">
                <span className="status-dot" /> {dataState}
              </span>
            </div>
            <SettingRow
              title="Workspace ID"
              value={workspaceId ?? "Not configured"}
            />
            <SettingRow
              title="Supabase connection"
              value={isSupabaseConfigured ? "Configured" : "Not configured"}
            />
          </section>
          <section className="panel settings-panel danger-zone">
            <div className="panel-header">
              <div>
                <div className="panel-kicker">Preview controls</div>
                <h2>Runtime controls</h2>
              </div>
              <Power size={18} className="muted-icon" />
            </div>
            <div className="danger-row">
              <div>
                <strong>Emergency stop preview</strong>
                <p>
                  Changes local UI state only; it does not stop a live runtime.
                </p>
              </div>
              <button
                className={`stop-button ${stopped ? "resume-button" : ""}`}
                onClick={onEmergencyStop}
              >
                {stopped ? "Resume preview" : "Engage preview"}
              </button>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
function SettingRow({ title, value }: { title: string; value: string }) {
  return (
    <div className="setting-row">
      <div>
        <strong>{title}</strong>
        <span>{value}</span>
      </div>
      <ChevronRight size={16} className="muted-icon" />
    </div>
  );
}
