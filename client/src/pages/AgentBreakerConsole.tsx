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
  Database,
  Download,
  FileClock,
  Gauge,
  LockKeyhole,
  Menu,
  Network,
  Pause,
  Play,
  Power,
  RefreshCw,
  Search,
  Settings2,
  Shield,
  ShieldAlert,
  ShieldCheck,
  X,
  XCircle,
  Zap,
} from "lucide-react";
import { Canvas } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { isSupabaseConfigured, supabase, workspaceId } from "@/lib/supabase";
import NeuralCoreScene from "../components/NeuralCoreScene";
import "../cyberpunk.css";
import "../agentbreaker-dashboard.css";

type ViewId =
  | "overview"
  | "agents"
  | "policies"
  | "approvals"
  | "audit"
  | "settings"
  | "plans";
type DataMode = "demo" | "connecting" | "live";
type Decision = "allowed" | "blocked" | "approval";
type RiskLevel = "Low" | "Medium" | "High" | "Critical";

type AgentRecord = {
  id: string;
  name: string;
  description: string;
  status: string;
  risk: string;
  calls: string;
  className: string;
};
type PolicyRecord = {
  id: string;
  title: string;
  description: string;
  scope: string;
  enabled: boolean;
};
type ApprovalRecord = {
  id: string;
  agent: string;
  action: string;
  detail: string;
  risk: RiskLevel;
  age: string;
};
type EventRecord = {
  id: string;
  agent: string;
  agentId: string;
  action: string;
  detail: string;
  status: Decision;
  risk: RiskLevel;
  time: string;
  createdAt: string;
  cost?: string;
};
type RuntimeData = {
  agents: AgentRecord[];
  policies: PolicyRecord[];
  approvals: ApprovalRecord[];
  events: EventRecord[];
  actionsToday: number | null;
  spend: number | null;
};

const navigation: {
  id: Exclude<ViewId, "plans">;
  label: string;
  icon: typeof Gauge;
}[] = [
  { id: "overview", label: "Overview", icon: Gauge },
  { id: "agents", label: "Agent Registry", icon: Bot },
  { id: "policies", label: "Policies", icon: ShieldCheck },
  { id: "approvals", label: "Approvals", icon: ShieldAlert },
  { id: "audit", label: "Audit Trail", icon: FileClock },
  { id: "settings", label: "Settings", icon: Settings2 },
];

function ago(minutes: number) {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function createDemoData(): RuntimeData {
  const agents: AgentRecord[] = [
    {
      id: "demo-agent-support",
      name: "Support Copilot",
      description: "Customer operations",
      status: "Healthy",
      risk: "Low",
      calls: "82",
      className: "Support",
    },
    {
      id: "demo-agent-research",
      name: "Research Analyst",
      description: "Knowledge retrieval",
      status: "Loop detected",
      risk: "Critical",
      calls: "64",
      className: "Research",
    },
    {
      id: "demo-agent-invoice",
      name: "Invoice Triage",
      description: "Finance operations",
      status: "Healthy",
      risk: "Low",
      calls: "51",
      className: "Finance",
    },
    {
      id: "demo-agent-release",
      name: "Release Assistant",
      description: "Engineering workflow",
      status: "Healthy",
      risk: "Low",
      calls: "47",
      className: "Engineering",
    },
    {
      id: "demo-agent-policy",
      name: "Policy Monitor",
      description: "Guardrail inspection",
      status: "Healthy",
      risk: "Low",
      calls: "42",
      className: "Governance",
    },
  ];
  const events: EventRecord[] = [
    {
      id: "demo-event-01",
      agent: "Research Analyst",
      agentId: "demo-agent-research",
      action: "Repeated search pattern",
      detail: "Loop signature intercepted before tool dispatch",
      status: "blocked",
      risk: "Critical",
      time: "00:18",
      createdAt: ago(1),
      cost: "$0.02",
    },
    {
      id: "demo-event-02",
      agent: "Support Copilot",
      agentId: "demo-agent-support",
      action: "Response approved",
      detail: "Customer reply passed policy checks",
      status: "allowed",
      risk: "Low",
      time: "01:42",
      createdAt: ago(3),
      cost: "$0.02",
    },
    {
      id: "demo-event-03",
      agent: "Invoice Triage",
      agentId: "demo-agent-invoice",
      action: "Approval requested",
      detail: "Refund exceeds the routine review threshold",
      status: "approval",
      risk: "High",
      time: "04:09",
      createdAt: ago(7),
      cost: "$0.02",
    },
    {
      id: "demo-event-04",
      agent: "Release Assistant",
      agentId: "demo-agent-release",
      action: "Deployment check passed",
      detail: "Read-only release checklist completed",
      status: "allowed",
      risk: "Low",
      time: "08:31",
      createdAt: ago(12),
      cost: "$0.02",
    },
  ];
  return {
    agents,
    events,
    actionsToday: 286,
    spend: 0.08,
    policies: [
      {
        id: "demo-policy-tools",
        title: "Approved tool boundary",
        description: "Keep tool access inside the configured demo allowlist.",
        scope: "All demo agents",
        enabled: true,
      },
      {
        id: "demo-policy-loop",
        title: "Loop signature guard",
        description: "Flag repeated action patterns before another dispatch.",
        scope: "Runtime behavior",
        enabled: true,
      },
      {
        id: "demo-policy-review",
        title: "Human review threshold",
        description: "Route sensitive or high-impact actions to an operator.",
        scope: "High-risk actions",
        enabled: true,
      },
    ],
    approvals: [
      {
        id: "demo-approval-01",
        agent: "Invoice Triage",
        action: "Refund request",
        detail: "Amount is above the routine review threshold.",
        risk: "High",
        age: "1m",
      },
      {
        id: "demo-approval-02",
        agent: "Support Copilot",
        action: "External reply",
        detail: "Response contains a policy-sensitive commitment.",
        risk: "Medium",
        age: "4m",
      },
    ],
  };
}

function riskLevel(value: unknown): RiskLevel {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized.includes("critical")) return "Critical";
  if (normalized.includes("high")) return "High";
  if (normalized.includes("medium")) return "Medium";
  return "Low";
}

function outcome(value: unknown): Decision | null {
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

function timeAgo(value: unknown) {
  if (!value) return "—";
  const timestamp = new Date(String(value)).getTime();
  if (!Number.isFinite(timestamp)) return "—";
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

function statusTone(agent: AgentRecord) {
  return /loop|critical|blocked/i.test(`${agent.status} ${agent.risk}`)
    ? "danger"
    : /review|watch|medium/i.test(`${agent.status} ${agent.risk}`)
      ? "watch"
      : "healthy";
}

function PanelTitle({
  eyebrow,
  title,
  trailing,
}: {
  eyebrow: string;
  title: string;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="ab-panel-title">
      <div>
        <span className="ab-eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
      </div>
      {trailing}
    </div>
  );
}

function RiskTag({ risk }: { risk: string }) {
  return (
    <span className={`ab-risk-tag ab-risk-${risk.toLowerCase()}`}>{risk}</span>
  );
}

export default function AgentBreakerConsole() {
  const [sampleData] = useState<RuntimeData>(() => createDemoData());
  const [runtimeData, setRuntimeData] = useState<RuntimeData>(sampleData);
  const [dataMode, setDataMode] = useState<DataMode>("demo");
  const [modeNote, setModeNote] = useState(
    "Sample telemetry is active. No live agent commands are connected."
  );
  const [activeView, setActiveView] = useState<ViewId>("overview");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [emergencyStopped, setEmergencyStopped] = useState(false);
  const [running, setRunning] = useState(true);
  const [selectedId, setSelectedId] = useState(sampleData.agents[0]?.id ?? "");
  const [isolatedAgentId, setIsolatedAgentId] = useState<string | null>(null);
  const [cameraKey, setCameraKey] = useState(0);
  const [agentSearch, setAgentSearch] = useState("");
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured || !workspaceId || !supabase) {
      setRuntimeData(sampleData);
      setDataMode("demo");
      setModeNote(
        "No scoped workspace selected. Clearly labeled demo data is shown instead."
      );
      return;
    }

    let active = true;
    setDataMode("connecting");
    setModeNote("Reading records scoped to the selected workspace.");
    const client = supabase;
    const scoped = (table: string, fields: string) =>
      client.from(table).select(fields).eq("workspace_id", workspaceId);

    const loadWorkspace = async () => {
      try {
        const [agentResult, policyResult, approvalResult, auditResult] =
          await Promise.all([
            scoped(
              "agents",
              "id, name, slug, description, status, risk_level, tool_calls, agent_class"
            ),
            scoped("policies", "id, title, description, scope, enabled"),
            scoped(
              "approvals",
              "id, reference, agent_id, action, detail, risk_level, requested_at, status, agents(name)"
            ).eq("status", "pending"),
            scoped(
              "audit_events",
              "id, agent_id, agent_name, action, detail, outcome, risk_level, created_at, agents(name)"
            ),
          ]);
        if (!active) return;
        if (
          agentResult.error ||
          policyResult.error ||
          approvalResult.error ||
          auditResult.error
        ) {
          setRuntimeData(sampleData);
          setDataMode("demo");
          setModeNote(
            "Live workspace data could not be read. Sample data is shown in Demo Mode."
          );
          return;
        }

        const rawAgents = (agentResult.data ?? []) as unknown as Record<
          string,
          unknown
        >[];
        const rawPolicies = (policyResult.data ?? []) as unknown as Record<
          string,
          unknown
        >[];
        const rawApprovals = (approvalResult.data ?? []) as unknown as Record<
          string,
          unknown
        >[];
        const rawEvents = (auditResult.data ?? []) as unknown as Record<
          string,
          unknown
        >[];
        const liveAgents: AgentRecord[] = rawAgents.map(row => ({
          id: String(row.id ?? "unknown-agent"),
          name: String(row.name ?? row.slug ?? "Unnamed agent"),
          description: String(row.description ?? "Workspace agent"),
          status: String(row.status ?? "Unknown"),
          risk: String(row.risk_level ?? "Unknown"),
          calls: row.tool_calls == null ? "—" : String(row.tool_calls),
          className: String(row.agent_class ?? "Agent"),
        }));
        const livePolicies: PolicyRecord[] = rawPolicies.map(row => ({
          id: String(row.id ?? "unknown-policy"),
          title: String(row.title ?? "Untitled policy"),
          description: String(row.description ?? ""),
          scope: String(row.scope ?? "Workspace"),
          enabled: Boolean(row.enabled),
        }));
        const liveApprovals: ApprovalRecord[] = rawApprovals.map(row => {
          const joined = Array.isArray(row.agents) ? row.agents[0] : row.agents;
          const joinedName =
            joined && typeof joined === "object"
              ? (joined as Record<string, unknown>).name
              : undefined;
          return {
            id: String(row.reference ?? row.id ?? "approval"),
            agent: String(joinedName ?? row.agent_id ?? "Unknown agent"),
            action: String(row.action ?? "Review required"),
            detail: String(row.detail ?? "No detail provided."),
            risk: riskLevel(row.risk_level),
            age: timeAgo(row.requested_at),
          };
        });
        const liveEvents: EventRecord[] = rawEvents.flatMap(row => {
          const decision = outcome(row.outcome);
          if (!decision) return [];
          const joined = Array.isArray(row.agents) ? row.agents[0] : row.agents;
          const joinedName =
            joined && typeof joined === "object"
              ? (joined as Record<string, unknown>).name
              : undefined;
          const timestamp = String(row.created_at ?? "");
          return [
            {
              id: String(row.id ?? `${row.agent_id}-${timestamp}`),
              agent: String(
                row.agent_name ?? joinedName ?? row.agent_id ?? "Unknown agent"
              ),
              agentId: String(row.agent_id ?? "unknown-agent"),
              action: String(row.action ?? "Audit event"),
              detail: String(row.detail ?? ""),
              status: decision,
              risk: riskLevel(row.risk_level),
              time: timeAgo(timestamp),
              createdAt: timestamp,
            },
          ];
        });

        if (
          !liveAgents.length &&
          !livePolicies.length &&
          !liveApprovals.length &&
          !liveEvents.length
        ) {
          setRuntimeData(sampleData);
          setDataMode("demo");
          setModeNote(
            "This workspace has no visible runtime records yet. Sample data is shown in Demo Mode."
          );
          return;
        }
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        const actionsToday = rawEvents.filter(row => {
          const timestamp = new Date(String(row.created_at ?? "")).getTime();
          return (
            Number.isFinite(timestamp) && timestamp >= startOfToday.getTime()
          );
        }).length;
        setRuntimeData({
          agents: liveAgents,
          policies: livePolicies,
          approvals: liveApprovals,
          events: liveEvents,
          actionsToday,
          spend: null,
        });
        setDataMode("live");
        setModeNote(
          "Read-only records are scoped to the selected workspace. Controls remain local previews."
        );
      } catch {
        if (!active) return;
        setRuntimeData(sampleData);
        setDataMode("demo");
        setModeNote(
          "Live workspace data could not be read. Sample data is shown in Demo Mode."
        );
      }
    };
    void loadWorkspace();
    return () => {
      active = false;
    };
  }, [sampleData]);

  useEffect(() => {
    if (!runtimeData.agents.some(agent => agent.id === selectedId)) {
      setSelectedId(runtimeData.agents[0]?.id ?? "");
    }
  }, [runtimeData.agents, selectedId]);

  const selectedAgent =
    runtimeData.agents.find(agent => agent.id === selectedId) ??
    runtimeData.agents[0];
  const blockedCount = runtimeData.events.filter(
    event => event.status === "blocked"
  ).length;
  const loopCount = runtimeData.agents.filter(
    agent => statusTone(agent) === "danger"
  ).length;
  const healthyCount = runtimeData.agents.filter(
    agent => statusTone(agent) === "healthy"
  ).length;
  const networkNodeCount =
    dataMode === "live"
      ? runtimeData.agents.length
      : Math.max(6, runtimeData.agents.length);
  const visibleAgents = useMemo(() => {
    const query = agentSearch.trim().toLowerCase();
    if (!query) return runtimeData.agents;
    return runtimeData.agents.filter(agent =>
      [agent.name, agent.description, agent.className, agent.status, agent.risk]
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [agentSearch, runtimeData.agents]);

  const setView = (view: ViewId) => {
    setActiveView(view);
    setMobileNavOpen(false);
  };
  const updateApproval = (id: string, action: "approved" | "blocked") => {
    setRuntimeData(current => ({
      ...current,
      approvals: current.approvals.filter(approval => approval.id !== id),
    }));
    toast.info(
      `Preview only: approval marked ${action}; no runtime action was sent.`
    );
  };
  const togglePolicy = (id: string) => {
    setRuntimeData(current => ({
      ...current,
      policies: current.policies.map(policy =>
        policy.id === id ? { ...policy, enabled: !policy.enabled } : policy
      ),
    }));
    toast.info(
      "Preview only: policy changed locally; no workspace record was updated."
    );
  };
  const exportLog = () => {
    const report = {
      generatedAt: new Date().toISOString(),
      demoMode: dataMode !== "live",
      dataSource:
        dataMode === "live"
          ? "scoped read-only workspace"
          : "synthetic demo sample",
      localPreview: { running, emergencyStopped, isolatedAgentId },
      metrics: {
        protectedAgents: runtimeData.agents.length,
        actionsToday: runtimeData.actionsToday,
        blockedActions: blockedCount,
        spend: runtimeData.spend,
      },
      agents: runtimeData.agents,
      events: runtimeData.events,
      approvals: runtimeData.approvals,
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(report, null, 2)], { type: "application/json" })
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `agentbreaker-${dataMode === "live" ? "workspace" : "demo"}-log-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  const toggleEmergencyStop = () => {
    setEmergencyStopped(value => !value);
    toast.info(
      "Preview control only. No live agent runtime was stopped or resumed."
    );
  };
  const toggleIsolation = () => {
    if (!selectedAgent) return;
    setIsolatedAgentId(current =>
      current === selectedAgent.id ? null : selectedAgent.id
    );
  };
  const recalibrate = () => {
    setCameraKey(key => key + 1);
    setSelectedId(runtimeData.agents[0]?.id ?? "");
    setIsolatedAgentId(null);
    setRunning(true);
  };
  const selectPlan = (plan: string) => {
    setSelectedPlan(plan);
    toast.info(
      `${plan} selected locally. Billing is not connected; no purchase was made.`
    );
  };
  const spendLabel =
    runtimeData.spend == null ? "—" : `$${runtimeData.spend.toFixed(2)}`;
  const statusLabel = emergencyStopped
    ? "STOPPED"
    : running
      ? "LIVE"
      : "PAUSED";

  return (
    <div
      className={`app-shell agentbreaker-shell ${mobileNavOpen ? "ab-nav-open" : ""}`}
    >
      {mobileNavOpen && (
        <button
          className="ab-mobile-overlay"
          aria-label="Close navigation"
          onClick={() => setMobileNavOpen(false)}
        />
      )}
      <aside className={`sidebar ${mobileNavOpen ? "sidebar-open" : ""}`}>
        <div className="brand-lockup">
          <div className="logo-mark ab-logo-mark">
            <ShieldCheck size={18} strokeWidth={2.5} />
            <span className="logo-break">/</span>
          </div>
          <div>
            <div className="brand-name">AgentBreaker</div>
            <div className="brand-subtitle">Runtime control plane</div>
          </div>
        </div>
        <div className="workspace-switcher ab-workspace-switcher">
          <div className="workspace-avatar">AB</div>
          <div className="workspace-copy">
            <span>
              {dataMode === "live" ? "Scoped workspace" : "Demo runtime"}
            </span>
            <small>
              {dataMode === "live"
                ? "READ-ONLY TELEMETRY"
                : "SAMPLE DATA · LOCAL PREVIEW"}
            </small>
          </div>
          <ChevronDown size={14} />
        </div>
        <div className="nav-label">Control center</div>
        <nav className="nav-list" aria-label="AgentBreaker navigation">
          {navigation.map(item => {
            const Icon = item.icon;
            const active =
              activeView === item.id ||
              (activeView === "plans" && item.id === "settings");
            return (
              <button
                key={item.id}
                className={`nav-item ${active ? "nav-item-active" : ""}`}
                onClick={() => setView(item.id)}
              >
                <Icon size={17} />
                <span>{item.label}</span>
                {item.id === "approvals" &&
                  runtimeData.approvals.length > 0 && (
                    <span className="nav-badge">
                      {runtimeData.approvals.length}
                    </span>
                  )}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-spacer" />
        <section className="runtime-card ab-sidebar-card">
          <div className="runtime-card-header">
            <span className="preview-dot" /> Simulation feed
            <span className="runtime-live">
              {dataMode === "live" ? "READ ONLY" : "DEMO"}
            </span>
          </div>
          <p>
            {dataMode === "live"
              ? "Scoped workspace records. Runtime controls are local previews."
              : "Sample values are labeled. No live agents or commands are connected."}
          </p>
          <div className="runtime-stat">
            <span>PROTECTED AGENTS</span>
            <strong>{runtimeData.agents.length}</strong>
          </div>
          <div className="progress-track">
            <div
              className="progress-fill fill-mint"
              style={{
                width: `${Math.min(100, runtimeData.agents.length * 20)}%`,
              }}
            />
          </div>
        </section>
        <button
          className="user-card ab-user-card"
          onClick={() => setView("settings")}
        >
          <div className="user-avatar">OP</div>
          <div>
            <strong>Preview operator</strong>
            <small>Local session · no account claim</small>
          </div>
          <Settings2 size={16} />
        </button>
      </aside>

      <main className="main-content ab-main-content">
        <header className="topbar ab-topbar">
          <div className="ab-topbar-left">
            <button
              className="mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMobileNavOpen(value => !value)}
            >
              <Menu size={20} />
            </button>
            <div>
              <div className="ab-title-lockup">
                <span>AGENTBREAKER</span>
                <i>/</i>
                <small>AI AGENT RUNTIME CONTROL PLANE</small>
              </div>
              <div className="ab-topbar-subtitle">
                POLICY ENFORCEMENT <b>·</b> LOOP DETECTION <b>·</b> AUDITABILITY
              </div>
            </div>
          </div>
          <div className="ab-topbar-actions">
            <span
              className={`ab-live-status ${statusLabel === "STOPPED" ? "is-danger" : statusLabel === "PAUSED" ? "is-paused" : ""}`}
            >
              <i /> {statusLabel}
            </span>
            <span
              className={`ab-mode-badge ${dataMode === "live" ? "is-live-data" : ""}`}
            >
              <span /> {dataMode === "live" ? "SCOPED DATA" : "DEMO MODE"}
            </span>
            <button
              className={`ab-emergency-button ${emergencyStopped ? "is-resume" : ""}`}
              onClick={toggleEmergencyStop}
            >
              <Power size={15} />{" "}
              {emergencyStopped ? "RESUME PREVIEW" : "EMERGENCY STOP"}
            </button>
          </div>
        </header>

        {emergencyStopped && (
          <div className="ab-emergency-banner">
            <Power size={15} /> <strong>PREVIEW STOP ENABLED</strong>
            <span>No live runtime command was sent.</span>
            <button onClick={toggleEmergencyStop}>Resume preview</button>
          </div>
        )}

        <div className="content-wrap ab-content-wrap">
          {activeView === "overview" && (
            <div className="ab-overview">
              <div className="ab-mode-note">
                <span className="ab-mode-note-icon">
                  <Database size={14} />
                </span>
                <div>
                  <strong>
                    {dataMode === "live"
                      ? "SCOPED WORKSPACE DATA · READ ONLY"
                      : dataMode === "connecting"
                        ? "CONNECTING · DEMO SNAPSHOT REMAINS VISIBLE"
                        : "SIMULATED TELEMETRY · DEMO MODE"}
                  </strong>
                  <small>{modeNote}</small>
                </div>
                <span className="ab-local-only">
                  <LockKeyhole size={12} /> LOCAL PREVIEW CONTROLS
                </span>
              </div>

              <div className="ab-dashboard-grid">
                <aside className="ab-left-stack">
                  <section className="ab-panel ab-agents-panel">
                    <PanelTitle
                      eyebrow="PROTECTED AGENTS"
                      title="Runtime fleet"
                      trailing={
                        <span className="ab-count-chip">
                          {runtimeData.agents.length} <small>AGENTS</small>
                        </span>
                      }
                    />
                    <div className="ab-agent-list">
                      {runtimeData.agents.slice(0, 5).map(agent => {
                        const tone = statusTone(agent);
                        return (
                          <button
                            key={agent.id}
                            className={`ab-agent-row ${selectedAgent?.id === agent.id ? "is-selected" : ""}`}
                            onClick={() => setSelectedId(agent.id)}
                          >
                            <span className={`ab-agent-orb is-${tone}`}>
                              <Bot size={15} />
                            </span>
                            <span className="ab-agent-copy">
                              <strong>{agent.name}</strong>
                              <small>
                                {agent.className} <i>·</i>{" "}
                                {dataMode === "live"
                                  ? "WORKSPACE RECORD"
                                  : "DEMO AGENT"}
                              </small>
                            </span>
                            <span className={`ab-agent-status is-${tone}`}>
                              <i />
                              {tone === "danger"
                                ? "LOOP"
                                : tone === "watch"
                                  ? "WATCH"
                                  : "HEALTHY"}
                            </span>
                          </button>
                        );
                      })}
                      {runtimeData.agents.length === 0 && (
                        <div className="ab-inline-empty">
                          No agent records in this scoped workspace yet.
                        </div>
                      )}
                    </div>
                    <button
                      className="ab-text-link"
                      onClick={() => setView("agents")}
                    >
                      OPEN AGENT REGISTRY <ArrowUpRight size={13} />
                    </button>
                  </section>

                  <section className="ab-panel ab-metrics-panel">
                    <PanelTitle
                      eyebrow="RUNTIME TELEMETRY"
                      title="Live metrics"
                      trailing={
                        <span className="ab-live-mini">
                          <i /> {dataMode === "live" ? "SCOPED" : "SAMPLE"}
                        </span>
                      }
                    />
                    <div className="ab-metric-grid">
                      <div className="ab-metric-cell">
                        <span>
                          <Activity size={13} /> ACTIONS TODAY
                        </span>
                        <strong>{runtimeData.actionsToday ?? "—"}</strong>
                        <small>
                          {dataMode === "live"
                            ? "scoped audit records"
                            : "simulated sample"}
                        </small>
                      </div>
                      <div className="ab-metric-cell">
                        <span>
                          <ShieldAlert size={13} /> BLOCKED ACTIONS
                        </span>
                        <strong className={blockedCount ? "is-red" : ""}>
                          {blockedCount}
                        </strong>
                        <small>
                          {dataMode === "live"
                            ? "returned audit records"
                            : "loop guard sample"}
                        </small>
                      </div>
                      <div className="ab-metric-cell">
                        <span>
                          <Gauge size={13} /> PROTECTED AGENTS
                        </span>
                        <strong>{runtimeData.agents.length}</strong>
                        <small>
                          {dataMode === "live"
                            ? "workspace records"
                            : "demo fleet"}
                        </small>
                      </div>
                      <div className="ab-metric-cell">
                        <span>
                          <Zap size={13} /> SPEND
                        </span>
                        <strong>{spendLabel}</strong>
                        <small>
                          {runtimeData.spend == null
                            ? "not supplied by workspace"
                            : "simulated usage"}
                        </small>
                      </div>
                    </div>
                  </section>
                </aside>

                <section
                  className="ab-panel ab-graph-panel"
                  aria-label="Interactive loop detection graph"
                >
                  <div className="ab-graph-heading">
                    <div>
                      <span className="ab-eyebrow">
                        NETWORK ANALYSIS <i>/</i> RUNTIME MAP
                      </span>
                      <h1>LIVE LOOP DETECTION GRAPH</h1>
                      <p>
                        {dataMode === "live"
                          ? `${runtimeData.agents.length} scoped agent nodes`
                          : `${runtimeData.agents.length} protected agents + ${Math.max(0, networkNodeCount - runtimeData.agents.length)} graph-only demo agent`}
                      </p>
                    </div>
                    <span className="ab-graph-live">
                      <i /> {running && !emergencyStopped ? "LIVE" : "PAUSED"}
                    </span>
                  </div>
                  <div
                    className={`ab-graph-view ${emergencyStopped ? "is-stopped" : ""}`}
                  >
                    <Canvas
                      key={cameraKey}
                      dpr={[1, 1.6]}
                      camera={{ position: [0, 0.15, 6.8], fov: 41 }}
                      gl={{
                        antialias: true,
                        alpha: true,
                        powerPreference: "high-performance",
                      }}
                    >
                      <NeuralCoreScene
                        agents={runtimeData.agents}
                        selectedId={selectedAgent?.id ?? ""}
                        running={running}
                        emergencyStopped={emergencyStopped}
                        isolatedAgentId={isolatedAgentId}
                        onSelectAgent={setSelectedId}
                        demoMode={dataMode !== "live"}
                      />
                    </Canvas>
                    <div className="ab-graph-hud ab-graph-hud-top">
                      <span>
                        <i />{" "}
                        {dataMode === "live"
                          ? "SCOPED GRAPH"
                          : "SIMULATION ACTIVE"}
                      </span>
                      <span>{networkNodeCount} NODES</span>
                    </div>
                    <div className="ab-graph-hud ab-graph-hud-bottom">
                      <span>
                        FOCUS <b>{selectedAgent?.name ?? "No selection"}</b>
                      </span>
                      <span>
                        RISK{" "}
                        <b
                          className={
                            statusTone(
                              selectedAgent ?? {
                                id: "",
                                name: "",
                                description: "",
                                status: "Healthy",
                                risk: "Low",
                                calls: "",
                                className: "",
                              }
                            ) === "danger"
                              ? "is-red"
                              : ""
                          }
                        >
                          {selectedAgent?.risk ?? "—"}
                        </b>
                      </span>
                    </div>
                    <div className="ab-graph-watermark">
                      AB<span>://</span>RUNTIME
                    </div>
                  </div>
                  <div className="ab-graph-legend">
                    <span>
                      <i className="healthy" /> HEALTHY AGENT
                    </span>
                    <span>
                      <i className="danger" /> LOOP DETECTED
                    </span>
                    <span>
                      <i className="flow" /> ACTIVE CONNECTION
                    </span>
                    <small>DRAG TO ORBIT · SCROLL TO ZOOM</small>
                  </div>
                </section>

                <aside className="ab-right-stack">
                  <section className="ab-panel ab-risk-panel">
                    <PanelTitle
                      eyebrow="THREAT MONITOR"
                      title="Risk posture"
                      trailing={
                        <span
                          className={`ab-risk-status ${loopCount ? "is-watch" : ""}`}
                        >
                          <i />
                          {loopCount ? "GUARDED" : "STABLE"}
                        </span>
                      }
                    />
                    <div className="ab-risk-overview">
                      <div
                        className={`ab-risk-ring ${loopCount ? "has-alert" : ""}`}
                      >
                        <div>
                          <strong>{loopCount}</strong>
                          <small>FLAGGED</small>
                        </div>
                      </div>
                      <div className="ab-risk-copy">
                        <strong>
                          {loopCount ? "Loop signature" : "No active flags"}
                        </strong>
                        <span>
                          {loopCount
                            ? "Detected and blocked in the demo stream."
                            : "No flagged agents in current data."}
                        </span>
                        <small>
                          {healthyCount} healthy <i>·</i>{" "}
                          {runtimeData.agents.length} protected
                        </small>
                      </div>
                    </div>
                    <div className="ab-risk-meter">
                      <div>
                        <span>HEALTHY FLEET</span>
                        <strong>
                          {runtimeData.agents.length
                            ? Math.round(
                                (healthyCount / runtimeData.agents.length) * 100
                              )
                            : 0}
                          %
                        </strong>
                      </div>
                      <div className="ab-meter-track">
                        <i
                          style={{
                            width: `${runtimeData.agents.length ? (healthyCount / runtimeData.agents.length) * 100 : 0}%`,
                          }}
                        />
                      </div>
                    </div>
                  </section>

                  <section className="ab-panel ab-approval-panel">
                    <PanelTitle
                      eyebrow="HUMAN REVIEW"
                      title="Approval queue"
                      trailing={
                        <span className="ab-count-chip is-purple">
                          {runtimeData.approvals.length} <small>PENDING</small>
                        </span>
                      }
                    />
                    <div className="ab-approval-list">
                      {runtimeData.approvals.slice(0, 2).map(approval => (
                        <article className="ab-approval-item" key={approval.id}>
                          <div className="ab-approval-head">
                            <strong>{approval.action}</strong>
                            <RiskTag risk={approval.risk} />
                          </div>
                          <p>{approval.detail}</p>
                          <div className="ab-approval-meta">
                            <span>
                              <Bot size={11} /> {approval.agent}
                            </span>
                            <small>{approval.age} ago</small>
                          </div>
                          <div className="ab-approval-actions">
                            <button
                              onClick={() =>
                                updateApproval(approval.id, "approved")
                              }
                            >
                              <Check size={12} /> ALLOW PREVIEW
                            </button>
                            <button
                              onClick={() =>
                                updateApproval(approval.id, "blocked")
                              }
                            >
                              <X size={12} /> BLOCK PREVIEW
                            </button>
                          </div>
                        </article>
                      ))}
                      {runtimeData.approvals.length === 0 && (
                        <div className="ab-inline-empty">
                          <CheckCircle2 size={15} /> Queue clear. No pending
                          decisions.
                        </div>
                      )}
                    </div>
                    <button
                      className="ab-text-link"
                      onClick={() => setView("approvals")}
                    >
                      OPEN APPROVALS <ArrowUpRight size={13} />
                    </button>
                  </section>

                  <section className="ab-panel ab-system-panel">
                    <PanelTitle
                      eyebrow={
                        dataMode === "live"
                          ? "SCOPED AUDIT FEED"
                          : "SIMULATED AUDIT FEED"
                      }
                      title="System log"
                      trailing={
                        <button
                          className="ab-icon-link"
                          aria-label="Open audit trail"
                          onClick={() => setView("audit")}
                        >
                          <ArrowUpRight size={14} />
                        </button>
                      }
                    />
                    <div className="ab-log-list">
                      {runtimeData.events.slice(0, 3).map(event => (
                        <div className="ab-log-row" key={event.id}>
                          <span className={`ab-log-dot is-${event.status}`} />
                          <div>
                            <strong>{event.action}</strong>
                            <small>
                              {event.agent} <i>·</i> {event.time}
                            </small>
                          </div>
                          <RiskTag risk={event.risk} />
                        </div>
                      ))}
                      {runtimeData.events.length === 0 && (
                        <div className="ab-inline-empty">
                          No audit events have been returned for this workspace.
                        </div>
                      )}
                    </div>
                  </section>
                </aside>
              </div>

              <footer className="ab-control-bar">
                <div className="ab-control-label">
                  <span>
                    <LockKeyhole size={14} /> OPERATOR CONTROLS
                  </span>
                  <small>LOCAL PREVIEW ONLY · NO LIVE COMMANDS</small>
                </div>
                <div className="ab-control-buttons">
                  <button
                    className={running ? "" : "is-active"}
                    onClick={() => setRunning(value => !value)}
                  >
                    {running ? <Pause size={14} /> : <Play size={14} />}{" "}
                    {running ? "PAUSE" : "RESUME"}
                  </button>
                  <button onClick={exportLog}>
                    <Download size={14} /> EXPORT LOG
                  </button>
                  <button
                    className={isolatedAgentId ? "is-active is-isolated" : ""}
                    onClick={toggleIsolation}
                    disabled={!selectedAgent}
                  >
                    <Network size={14} />{" "}
                    {isolatedAgentId ? "RECONNECT AGENT" : "ISOLATE AGENT"}
                  </button>
                  <button onClick={recalibrate}>
                    <RefreshCw size={14} /> RECALIBRATE
                  </button>
                </div>
              </footer>
            </div>
          )}

          {activeView === "agents" && (
            <section className="ab-secondary-view">
              <div className="ab-page-heading">
                <div>
                  <span className="ab-eyebrow">
                    INVENTORY / {dataMode === "live" ? "SCOPED" : "DEMO"}
                  </span>
                  <h1>Agent Registry</h1>
                  <p>
                    {dataMode === "live"
                      ? "Workspace agents scoped to read-only telemetry."
                      : "Demo entries are synthetic and clearly labeled."}
                  </p>
                </div>
                <span className="ab-count-chip">
                  {runtimeData.agents.length} <small>AGENTS</small>
                </span>
              </div>
              <div className="ab-search-box">
                <Search size={15} />
                <input
                  value={agentSearch}
                  onChange={event => setAgentSearch(event.target.value)}
                  placeholder="Search agents, classes, status..."
                  aria-label="Search agents"
                />
              </div>
              <div className="ab-registry-grid">
                {visibleAgents.map(agent => (
                  <article className="ab-panel ab-registry-card" key={agent.id}>
                    <div className="ab-registry-card-top">
                      <span className={`ab-agent-orb is-${statusTone(agent)}`}>
                        <Bot size={17} />
                      </span>
                      <span
                        className={`ab-agent-status is-${statusTone(agent)}`}
                      >
                        <i />
                        {agent.status}
                      </span>
                    </div>
                    <h2>{agent.name}</h2>
                    <p>{agent.description}</p>
                    <div className="ab-registry-meta">
                      <span>{agent.className}</span>
                      <span>
                        {agent.calls}{" "}
                        {dataMode === "live" ? "tool calls" : "calls"}{" "}
                        <small>
                          ·{" "}
                          {dataMode === "live"
                            ? "workspace data"
                            : "demo snapshot"}
                        </small>
                      </span>
                    </div>
                    <div className="ab-registry-risk">
                      <span>Risk level</span>
                      <RiskTag risk={riskLevel(agent.risk)} />
                    </div>
                  </article>
                ))}
                {visibleAgents.length === 0 && (
                  <div className="ab-inline-empty">
                    No agents match that search.
                  </div>
                )}
              </div>
            </section>
          )}

          {activeView === "policies" && (
            <section className="ab-secondary-view">
              <div className="ab-page-heading">
                <div>
                  <span className="ab-eyebrow">GUARDRAILS / LOCAL PREVIEW</span>
                  <h1>Policies</h1>
                  <p>
                    Policy switches change this screen only; no Supabase write
                    or live runtime update is sent.
                  </p>
                </div>
                <span className="ab-mode-badge">
                  <span /> {dataMode === "live" ? "READ ONLY" : "DEMO MODE"}
                </span>
              </div>
              <div className="ab-policy-grid">
                {runtimeData.policies.map(policy => (
                  <article className="ab-panel ab-policy-card" key={policy.id}>
                    <div className="ab-policy-icon">
                      <Shield size={18} />
                    </div>
                    <button
                      className={`ab-toggle ${policy.enabled ? "is-on" : ""}`}
                      onClick={() => togglePolicy(policy.id)}
                      aria-pressed={policy.enabled}
                    >
                      <span />
                    </button>
                    <span className="ab-eyebrow">{policy.scope}</span>
                    <h2>{policy.title}</h2>
                    <p>{policy.description}</p>
                    <div className="ab-policy-foot">
                      <span>LOCAL PREVIEW</span>
                      <strong>{policy.enabled ? "ENABLED" : "DISABLED"}</strong>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}

          {activeView === "approvals" && (
            <section className="ab-secondary-view">
              <div className="ab-page-heading">
                <div>
                  <span className="ab-eyebrow">
                    HUMAN-IN-THE-LOOP /{" "}
                    {dataMode === "live" ? "READ ONLY" : "DEMO"}
                  </span>
                  <h1>Approval Queue</h1>
                  <p>
                    Responses are local previews. No live agent is approved,
                    blocked, or dispatched.
                  </p>
                </div>
                <span className="ab-count-chip is-purple">
                  {runtimeData.approvals.length} <small>PENDING</small>
                </span>
              </div>
              <section className="ab-panel ab-approval-page-list">
                {runtimeData.approvals.map(approval => (
                  <article className="ab-approval-page-item" key={approval.id}>
                    <div>
                      <div className="ab-approval-head">
                        <RiskTag risk={approval.risk} />
                        <small>{approval.age} ago</small>
                      </div>
                      <h2>{approval.action}</h2>
                      <p>{approval.detail}</p>
                      <span className="ab-approval-agent">
                        <Bot size={13} /> {approval.agent}
                      </span>
                    </div>
                    <div className="ab-approval-actions">
                      <button
                        onClick={() => updateApproval(approval.id, "approved")}
                      >
                        <Check size={13} /> ALLOW PREVIEW
                      </button>
                      <button
                        onClick={() => updateApproval(approval.id, "blocked")}
                      >
                        <X size={13} /> BLOCK PREVIEW
                      </button>
                    </div>
                  </article>
                ))}
                {runtimeData.approvals.length === 0 && (
                  <div className="ab-inline-empty">
                    <CheckCircle2 size={16} /> Queue clear. No pending
                    decisions.
                  </div>
                )}
              </section>
            </section>
          )}

          {activeView === "audit" && (
            <section className="ab-secondary-view">
              <div className="ab-page-heading">
                <div>
                  <span className="ab-eyebrow">
                    EVIDENCE LAYER / {dataMode === "live" ? "SCOPED" : "DEMO"}
                  </span>
                  <h1>Audit Trail</h1>
                  <p>
                    {dataMode === "live"
                      ? "Read-only audit events scoped to the selected workspace."
                      : "Sample events for UI evaluation; not production audit records."}
                  </p>
                </div>
                <button className="ab-secondary-button" onClick={exportLog}>
                  <Download size={14} /> Export log
                </button>
              </div>
              <section className="ab-panel ab-audit-panel">
                <div className="ab-audit-heading">
                  <span>OUTCOME</span>
                  <span>EVENT</span>
                  <span>AGENT</span>
                  <span>RISK</span>
                  <span>TIME</span>
                </div>
                {runtimeData.events.map(event => (
                  <div className="ab-audit-row" key={event.id}>
                    <span className={`ab-log-dot is-${event.status}`} />{" "}
                    <div>
                      <strong>{event.action}</strong>
                      <small>{event.detail}</small>
                    </div>
                    <span>{event.agent}</span>
                    <RiskTag risk={event.risk} />
                    <time>{event.time}</time>
                  </div>
                ))}
                {runtimeData.events.length === 0 && (
                  <div className="ab-inline-empty">
                    No audit events have been returned for this workspace.
                  </div>
                )}
              </section>
            </section>
          )}

          {activeView === "settings" && (
            <section className="ab-secondary-view">
              <div className="ab-page-heading">
                <div>
                  <span className="ab-eyebrow">
                    CONTROL PLANE / CONFIGURATION
                  </span>
                  <h1>Settings</h1>
                  <p>Current data source and preview-control boundaries.</p>
                </div>
                <Settings2 size={22} className="ab-heading-icon" />
              </div>
              <div className="ab-settings-grid">
                <section className="ab-panel ab-settings-card">
                  <PanelTitle
                    eyebrow="DATA MODE"
                    title={
                      dataMode === "live" ? "Scoped workspace" : "Demo Mode"
                    }
                  />
                  <p>{modeNote}</p>
                  <div className="ab-setting-row">
                    <span>Data source</span>
                    <strong>
                      {dataMode === "live"
                        ? "Supabase · workspace scoped"
                        : "Synthetic demo sample"}
                    </strong>
                  </div>
                  <div className="ab-setting-row">
                    <span>Workspace scope</span>
                    <strong>
                      {dataMode === "live"
                        ? "Selected workspace"
                        : "Not selected · demo fallback"}
                    </strong>
                  </div>
                  <div className="ab-setting-row">
                    <span>Runtime commands</span>
                    <strong>Disabled · local preview only</strong>
                  </div>
                </section>
                <section className="ab-panel ab-settings-card">
                  <PanelTitle
                    eyebrow="CONTROL SAFETY"
                    title="Preview boundary"
                  />
                  <div className="ab-safety-row">
                    <span className="ab-safety-icon">
                      <Power size={17} />
                    </span>
                    <div>
                      <strong>Emergency stop preview</strong>
                      <p>
                        Changes local visual state only and does not stop a
                        production runtime.
                      </p>
                    </div>
                  </div>
                  <button
                    className="ab-emergency-button ab-settings-stop"
                    onClick={toggleEmergencyStop}
                  >
                    <Power size={14} />{" "}
                    {emergencyStopped
                      ? "RESUME PREVIEW"
                      : "EMERGENCY STOP PREVIEW"}
                  </button>
                  <button
                    className="ab-pricing-link"
                    onClick={() => setView("plans")}
                  >
                    View Plans & Pricing <ArrowUpRight size={14} />
                  </button>
                </section>
              </div>
            </section>
          )}

          {activeView === "plans" && (
            <section className="ab-secondary-view">
              <div className="ab-page-heading">
                <div>
                  <span className="ab-eyebrow">COMMERCIAL PREVIEW</span>
                  <h1>Plans & Pricing</h1>
                  <p>
                    Local plan selection only. Checkout and billing are not
                    connected.
                  </p>
                </div>
                <span className="ab-mode-badge">
                  <span /> LOCAL PREVIEW
                </span>
              </div>
              <div className="ab-plans-grid">
                <article
                  className={`ab-panel ab-plan-card ${selectedPlan === "30-day Free Trial" ? "is-selected" : ""}`}
                >
                  <span className="ab-eyebrow">START HERE</span>
                  <h2>30-day Free Trial</h2>
                  <strong>$0</strong>
                  <p>Explore AgentBreaker with the demo control plane.</p>
                  <button
                    className="ab-secondary-button"
                    onClick={() => selectPlan("30-day Free Trial")}
                  >
                    Select locally
                  </button>
                </article>
                <article
                  className={`ab-panel ab-plan-card is-popular ${selectedPlan === "Popular" ? "is-selected" : ""}`}
                >
                  <span className="ab-popular-label">POPULAR</span>
                  <span className="ab-eyebrow">TEAM PLAN</span>
                  <h2>Popular</h2>
                  <strong>
                    $299<small>/ month</small>
                  </strong>
                  <p>For teams evaluating ongoing agent oversight.</p>
                  <button
                    className="ab-primary-button"
                    onClick={() => selectPlan("Popular")}
                  >
                    Select locally
                  </button>
                </article>
                <article
                  className={`ab-panel ab-plan-card ${selectedPlan === "Enterprise" ? "is-selected" : ""}`}
                >
                  <span className="ab-eyebrow">SCALE</span>
                  <h2>Enterprise</h2>
                  <strong>
                    $1,499<small>/ month</small>
                  </strong>
                  <p>
                    For organizations considering a broader governance rollout.
                  </p>
                  <button
                    className="ab-secondary-button"
                    onClick={() => selectPlan("Enterprise")}
                  >
                    Select locally
                  </button>
                </article>
              </div>
              {selectedPlan && (
                <div className="ab-inline-note">
                  <CheckCircle2 size={14} /> {selectedPlan} selected locally. No
                  billing action was made.
                </div>
              )}
            </section>
          )}

          <footer className="ab-app-footer">
            <span>
              AGENTBREAKER <i>/</i> RUNTIME CONTROL PLANE
            </span>
            <span>
              {dataMode === "live"
                ? "SCOPED READ-ONLY DATA"
                : "DEMO SIMULATION · SAMPLE VALUES"}{" "}
              <b>·</b> CONTROLS ARE LOCAL PREVIEWS
            </span>
          </footer>
        </div>
      </main>
    </div>
  );
}
