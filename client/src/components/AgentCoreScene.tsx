import { Canvas } from "@react-three/fiber";
import {
  Activity,
  ArrowUpRight,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Download,
  FileClock,
  Pause,
  Play,
  Power,
  RefreshCw,
  Shield,
  ShieldAlert,
  SlidersHorizontal,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import NeuralCoreScene from "./NeuralCoreScene";

type DataState =
  | "loading"
  | "unconfigured"
  | "scope_missing"
  | "connected"
  | "empty"
  | "error";
type ActivityStatus = "allowed" | "blocked" | "approval";
type RiskLevel = "Low" | "Medium" | "High" | "Critical";
type AgentSignal = {
  id: string;
  name: string;
  status: string;
  risk: string;
  calls?: string;
};
type ActivitySignal = {
  id: string | number;
  agent: string;
  agentId: string;
  action: string;
  detail: string;
  status: ActivityStatus;
  risk: RiskLevel;
  time: string;
  cost?: string;
};
type ApprovalSignal = {
  id: string;
  agent: string;
  action: string;
  detail: string;
  risk: RiskLevel;
  age: string;
};
type MetricPack = {
  agents: string;
  approvals: string;
  events: string;
  blocked: string;
  /** Legacy fields are accepted for the unchanged Home.tsx caller but are intentionally not rendered. */
  actions?: string;
  spend?: string;
  delta?: string;
};

type AgentCoreSceneProps = {
  dataState?: DataState;
  agents: AgentSignal[];
  metrics: MetricPack;
  timeRange: string;
  setTimeRange: (range: string) => void;
  events: ActivitySignal[];
  activityFilter: "all" | ActivityStatus;
  setActivityFilter: (filter: "all" | ActivityStatus) => void;
  agentFilter: string;
  setAgentFilter: (filter: string) => void;
  approvals: ApprovalSignal[];
  onApproval: (id: string, action: "approved" | "blocked") => void;
  onEmergencyStop: () => void;
  emergencyStopped: boolean;
  onAgentSelect: (id: string) => void;
  onOpenAudit: () => void;
  onOpenApprovals: () => void;
  /** Accepted for source compatibility; spend is not displayed without a contract field. */
  spendTrend?: unknown;
  sessionSpend?: unknown;
};

const riskColors: Record<RiskLevel, string> = {
  Low: "#59eacb",
  Medium: "#5cecff",
  High: "#b36bff",
  Critical: "#ff486d",
};
const activityLabels: Record<ActivityStatus | "all", string> = {
  all: "ALL",
  allowed: "ALLOW",
  blocked: "BLOCK",
  approval: "REVIEW",
};
const riskStyle: Record<RiskLevel, string> = {
  Low: "risk-low",
  Medium: "risk-medium",
  High: "risk-high",
  Critical: "risk-critical",
};

function riskIcon(status: ActivityStatus) {
  if (status === "allowed") return CheckCircle2;
  if (status === "blocked") return XCircle;
  return Clock3;
}

function displayValue(value: string | undefined) {
  return value?.trim() ? value : "—";
}

function stateLabel(state: DataState) {
  if (state === "loading") return "LOADING WORKSPACE DATA";
  if (state === "unconfigured") return "WORKSPACE NOT CONFIGURED";
  if (state === "scope_missing") return "WORKSPACE SCOPE UNAVAILABLE";
  if (state === "error") return "WORKSPACE DATA ERROR";
  if (state === "empty") return "NO WORKSPACE DATA";
  return "WORKSPACE DATA CONNECTED";
}

function ActivityPanel({
  dataState,
  events,
  agents,
  activityFilter,
  setActivityFilter,
  agentFilter,
  setAgentFilter,
  onSelectAgent,
  onOpenAudit,
}: {
  dataState: DataState;
  events: ActivitySignal[];
  agents: AgentSignal[];
  activityFilter: "all" | ActivityStatus;
  setActivityFilter: (filter: "all" | ActivityStatus) => void;
  agentFilter: string;
  setAgentFilter: (filter: string) => void;
  onSelectAgent: (id: string) => void;
  onOpenAudit: () => void;
}) {
  return (
    <section className="cp-hud-module cp-activity-module">
      <div className="cp-module-head">
        <span>
          <Activity size={12} /> READ-ONLY WORKSPACE DATA
        </span>
        <button className="cp-plain-link" onClick={onOpenAudit}>
          FULL LOG <ArrowUpRight size={11} />
        </button>
      </div>
      <div className="cp-readonly-note">AUDIT FEED · DISPLAY ONLY</div>
      <div className="cp-stream-controls">
        <div
          className="cp-filter-chips"
          role="group"
          aria-label="Filter workspace activity by decision"
        >
          {(["all", "allowed", "blocked", "approval"] as const).map(filter => (
            <button
              key={filter}
              className={activityFilter === filter ? "is-active" : ""}
              onClick={() => setActivityFilter(filter)}
              aria-pressed={activityFilter === filter}
            >
              {activityLabels[filter]}
            </button>
          ))}
        </div>
        <label className="cp-agent-filter">
          <SlidersHorizontal size={11} />
          <select
            value={agentFilter}
            onChange={event => setAgentFilter(event.target.value)}
            aria-label="Filter workspace activity by agent"
          >
            <option value="all">ALL AGENTS</option>
            {agents.map(agent => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
          <ChevronDown size={11} />
        </label>
      </div>
      <div className="cp-event-list">
        {events.slice(0, 3).map(event => {
          const Icon = riskIcon(event.status);
          return (
            <button
              className="cp-event-row"
              key={event.id}
              onClick={() => onSelectAgent(event.agentId)}
              aria-label={`Focus ${event.agent} from workspace event ${event.action}`}
            >
              <span className={`cp-event-icon event-${event.status}`}>
                <Icon size={12} />
              </span>
              <span className="cp-event-copy">
                <strong>{event.action}</strong>
                <small>
                  {event.agent} · {event.detail}
                </small>
              </span>
              <span className={`cp-event-risk ${riskStyle[event.risk]}`}>
                {event.risk.slice(0, 3).toUpperCase()}
              </span>
            </button>
          );
        })}
        {events.length === 0 && (
          <div className="cp-empty-stream">
            {dataState === "connected" || dataState === "empty"
              ? "No workspace events match the current filters."
              : "Activity appears after a scoped workspace query succeeds."}
          </div>
        )}
      </div>
    </section>
  );
}

function RiskMix({ events }: { events: ActivitySignal[] }) {
  const mix = useMemo(() => {
    const total = events.length;
    const levels: RiskLevel[] = ["Low", "Medium", "High", "Critical"];
    let cursor = 0;
    const segments = levels.map(risk => {
      const count = events.filter(event => event.risk === risk).length;
      const percent = total ? (count / total) * 100 : 0;
      const start = cursor;
      cursor += percent;
      return { risk, count, percent, start, end: cursor };
    });
    const gradient = total
      ? segments
          .map(
            ({ risk, start, end }) => `${riskColors[risk]} ${start}% ${end}%`
          )
          .join(", ")
      : "#20253a 0% 100%";
    return { segments, gradient, total };
  }, [events]);

  return (
    <div className="cp-risk-mix">
      <div
        className="cp-risk-donut"
        style={
          {
            "--risk-gradient": `conic-gradient(${mix.gradient})`,
          } as CSSProperties
        }
      >
        <div>
          <strong>{mix.total || "—"}</strong>
          <small>EVENTS</small>
        </div>
      </div>
      <div className="cp-risk-legend">
        {mix.segments.map(({ risk, count, percent }) => (
          <div key={risk}>
            <i style={{ backgroundColor: riskColors[risk] }} />
            <span>{risk.toUpperCase()}</span>
            <strong>{mix.total ? `${Math.round(percent)}%` : "—"}</strong>
            <small>{count || "—"}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

function ApprovalQueue({
  dataState,
  approvals,
  onApproval,
  onOpen,
}: {
  dataState: DataState;
  approvals: ApprovalSignal[];
  onApproval: (id: string, action: "approved" | "blocked") => void;
  onOpen: () => void;
}) {
  return (
    <section className="cp-hud-module cp-approval-module">
      <div className="cp-module-head">
        <span>
          <ShieldAlert size={12} /> APPROVAL DATA
        </span>
        <span className="cp-approval-count">{approvals.length || "—"}</span>
      </div>
      <div className="cp-readonly-note">
        LOCAL PREVIEW ACTIONS · VERIFY BEFORE USE
      </div>
      <div className="cp-approval-list">
        {approvals.slice(0, 2).map(approval => (
          <article className="cp-approval-item" key={approval.id}>
            <div className="cp-approval-top">
              <strong>{approval.action}</strong>
              <span className={`cp-event-risk ${riskStyle[approval.risk]}`}>
                {approval.risk.toUpperCase()}
              </span>
            </div>
            <p>{approval.detail}</p>
            <div className="cp-approval-meta">
              <span>{approval.agent}</span>
              <span>{approval.age || "—"}</span>
            </div>
            <div className="cp-approval-actions">
              <button onClick={() => onApproval(approval.id, "approved")}>
                ALLOW PREVIEW
              </button>
              <button onClick={() => onApproval(approval.id, "blocked")}>
                BLOCK PREVIEW
              </button>
            </div>
          </article>
        ))}
        {approvals.length === 0 && (
          <div className="cp-empty-stream">
            {dataState === "connected" || dataState === "empty"
              ? "No pending approval records were returned."
              : "Approval data appears after a scoped workspace query succeeds."}
          </div>
        )}
      </div>
      <button className="cp-queue-link" onClick={onOpen}>
        OPEN APPROVAL VIEW <ChevronRight size={11} />
      </button>
    </section>
  );
}

export default function AgentCoreScene({
  dataState,
  agents,
  metrics,
  timeRange,
  setTimeRange,
  events,
  activityFilter,
  setActivityFilter,
  agentFilter,
  setAgentFilter,
  approvals,
  onApproval,
  onEmergencyStop,
  emergencyStopped,
  onAgentSelect,
  onOpenAudit,
  onOpenApprovals,
}: AgentCoreSceneProps) {
  const [selectedId, setSelectedId] = useState(agents[0]?.id ?? "");
  const [running, setRunning] = useState(true);
  const [isolatedAgentId, setIsolatedAgentId] = useState<string | null>(null);
  const [cameraKey, setCameraKey] = useState(0);
  const selected = agents.find(agent => agent.id === selectedId) ?? agents[0];
  const selectedRisk = (selected?.risk ?? "—") as RiskLevel;
  const isolated = Boolean(selected && isolatedAgentId === selected.id);
  const previewActive = running && !emergencyStopped;
  const resolvedDataState = dataState ?? "unconfigured";
  const blockedEvents = events.filter(
    event => event.status === "blocked"
  ).length;

  useEffect(() => {
    if (!agents.some(agent => agent.id === selectedId))
      setSelectedId(agents[0]?.id ?? "");
  }, [agents, selectedId]);

  const focusAgent = (id: string) => {
    if (agents.some(agent => agent.id === id)) {
      setSelectedId(id);
    }
  };
  const exportLog = () => {
    const report = {
      generatedAt: new Date().toISOString(),
      dataState: resolvedDataState,
      source: "read-only workspace data",
      localPreview: { running, emergencyStopped, isolatedAgentId },
      focus: selected
        ? {
            id: selected.id,
            name: selected.name,
            status: selected.status,
            risk: selected.risk,
            calls: selected.calls ?? null,
          }
        : null,
      metrics,
      events: events.slice(0, 20),
      approvals,
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(report, null, 2)], { type: "application/json" })
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `workspace-data-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  const recalibrate = () => {
    setCameraKey(key => key + 1);
    setSelectedId(agents[0]?.id ?? "");
    setIsolatedAgentId(null);
  };
  const toggleIsolation = () => {
    if (!selected) return;
    setIsolatedAgentId(current =>
      current === selected.id ? null : selected.id
    );
  };

  return (
    <section
      className="panel cp-control-deck"
      aria-label="Read-only workspace data with local 3D preview controls"
    >
      <header className="cp-console-topbar">
        <div className="cp-console-brand">
          <div className="cp-console-brand-mark">
            <span>AB</span>
            <i />
          </div>
          <div className="cp-console-title">
            <strong>
              AGENTBREAKER <span>// WELCOME</span>
            </strong>
            <small>AI RUNTIME CONTROL PLANE · READ-ONLY PREVIEW</small>
          </div>
        </div>
        <div className="cp-console-statuses">
          <span
            className={`cp-console-pill ${emergencyStopped ? "is-danger" : previewActive ? "is-live" : "is-paused"}`}
          >
            <i />
            {emergencyStopped
              ? "PREVIEW STOPPED"
              : previewActive
                ? "PREVIEW RUNNING"
                : "PREVIEW PAUSED"}
          </span>
          <span className="cp-console-pill">
            <Bot size={11} /> {agents.length || "—"} AGENT RECORDS
          </span>
          <span className="cp-console-pill cp-readonly-pill">
            {stateLabel(resolvedDataState)}
          </span>
        </div>
        <div className="cp-console-controls">
          <label className="cp-range-select">
            <Clock3 size={12} />
            <select
              value={timeRange}
              onChange={event => setTimeRange(event.target.value)}
              aria-label="Choose workspace data time range"
            >
              <option value="24h">24 HOURS</option>
              <option value="7d">7 DAYS</option>
              <option value="30d">30 DAYS</option>
            </select>
            <ChevronDown size={11} />
          </label>
          <button
            className={`cp-emergency-button ${emergencyStopped ? "is-resume" : ""}`}
            onClick={onEmergencyStop}
          >
            <Power size={12} />
            {emergencyStopped ? "RESUME PREVIEW" : "STOP PREVIEW"}
          </button>
        </div>
      </header>

      <div className="cp-kpi-strip" aria-label="Workspace data summary">
        <div className="cp-kpi-cell">
          <span>
            <Bot size={12} /> AGENT RECORDS
          </span>
          <strong>
            {displayValue(metrics.agents) || agents.length || "—"}
          </strong>
          <small>read-only workspace field</small>
        </div>
        <div className="cp-kpi-cell">
          <span>
            <Activity size={12} /> EVENT RECORDS
          </span>
          <strong>
            {displayValue(metrics.events) || events.length || "—"}
          </strong>
          <small>read-only workspace field</small>
        </div>
        <div className="cp-kpi-cell">
          <span>
            <Shield size={12} /> BLOCKED RECORDS
          </span>
          <strong className="cp-kpi-danger">
            {displayValue(metrics.blocked) || blockedEvents || "—"}
          </strong>
          <small>source data only</small>
        </div>
        <div className="cp-kpi-cell">
          <span>
            <ShieldAlert size={12} /> APPROVAL RECORDS
          </span>
          <strong>
            {displayValue(metrics.approvals) || approvals.length || "—"}
          </strong>
          <small>local preview actions</small>
        </div>
      </div>

      <div className="cp-console-grid">
        <aside className="cp-console-rail cp-left-rail">
          <section className="cp-hud-module cp-focus-module">
            <div className="cp-module-head">
              <span>
                <Bot size={12} /> AGENT DATA
              </span>
              <span className="cp-module-index">READ-ONLY</span>
            </div>
            <div className="cp-focus-card">
              <span className="cp-focus-avatar">
                <Bot size={17} />
              </span>
              <div>
                <small>FOCUSED RECORD</small>
                <strong>{selected?.name ?? "No agent selected"}</strong>
              </div>
              <span
                className={`cp-node-led ${emergencyStopped ? "is-red" : ""}`}
              />
            </div>
            <div className="cp-focus-meta">
              <span className={emergencyStopped ? "is-red" : ""}>
                {emergencyStopped
                  ? "PREVIEW STOPPED"
                  : (selected?.status.toUpperCase() ?? "—")}
              </span>
              <span
                className={`cp-event-risk ${selectedRisk in riskStyle ? riskStyle[selectedRisk] : ""}`}
              >
                {selected?.risk?.toUpperCase() ?? "—"}
              </span>
            </div>
            <div className="cp-boundary-readout">
              <span>DATA SOURCE</span>
              <strong>WORKSPACE RECORD</strong>
              <small>
                {isolated
                  ? "Selected node isolated in local preview"
                  : "Displayed without write or dispatch claims"}
              </small>
            </div>
            <div className="cp-exposure">
              <span>RISK FIELD</span>
              <strong>{selected?.risk ?? "—"}</strong>
            </div>
            <div className="cp-agent-pickers" aria-label="Select focused agent">
              {agents.map((agent, index) => (
                <button
                  key={agent.id}
                  className={agent.id === selected?.id ? "is-active" : ""}
                  onClick={() => focusAgent(agent.id)}
                  aria-pressed={agent.id === selected?.id}
                >
                  <span
                    style={
                      {
                        "--agent-color":
                          index % 2 === 0 ? "#5cecff" : "#b36bff",
                      } as CSSProperties
                    }
                  />
                  {agent.name}
                </button>
              ))}
            </div>
            <button
              className="cp-profile-link"
              onClick={() => selected && onAgentSelect(selected.id)}
              disabled={!selected}
            >
              OPEN AGENT PROFILE <ChevronRight size={11} />
            </button>
          </section>

          <ActivityPanel
            dataState={resolvedDataState}
            events={events}
            agents={agents}
            activityFilter={activityFilter}
            setActivityFilter={setActivityFilter}
            agentFilter={agentFilter}
            setAgentFilter={setAgentFilter}
            onSelectAgent={focusAgent}
            onOpenAudit={onOpenAudit}
          />
        </aside>

        <main className="cp-core-column">
          <section
            className={`cp-core-stage ${emergencyStopped ? "is-alert" : ""}`}
            aria-label="Interactive 3D neural workspace preview"
          >
            <div className="cp-core-caption">
              <span>
                <i className="cp-caption-live" /> NEURAL WORKSPACE PREVIEW
              </span>
              <span>WEBGL / 3D · {agents.length || "—"} RECORDS</span>
            </div>
            <Canvas
              key={cameraKey}
              dpr={[1, 1.75]}
              camera={{ position: [0, 0.15, 6.2], fov: 38 }}
              gl={{
                antialias: true,
                alpha: true,
                powerPreference: "high-performance",
              }}
            >
              <NeuralCoreScene
                agents={agents}
                selectedId={selected?.id ?? ""}
                running={running}
                emergencyStopped={emergencyStopped}
                isolatedAgentId={isolatedAgentId}
                onSelectAgent={focusAgent}
              />
            </Canvas>
            <div className="cp-core-corner cp-core-corner-left">
              <span>VIEW STATE</span>
              <strong className={emergencyStopped ? "is-red" : ""}>
                {emergencyStopped
                  ? "STOPPED"
                  : isolated
                    ? "ISOLATED"
                    : "PREVIEW"}
              </strong>
              <small>READ-ONLY VISUALIZATION</small>
            </div>
            <div className="cp-core-corner cp-core-corner-right">
              <span>FOCUS RISK</span>
              <strong className={selectedRisk === "Critical" ? "is-red" : ""}>
                {selected?.risk?.toUpperCase() ?? "—"}
              </strong>
              <small>TOOL CALL FIELD · {selected?.calls ?? "—"}</small>
            </div>
            <div className="cp-core-bottom">
              <span>{selected?.name ?? "No selected agent"}</span>
              <small>DRAG TO ORBIT · CLICK A RECORD TO FOCUS</small>
            </div>
          </section>
          <div className="cp-core-statusline">
            <span>
              <i /> READ-ONLY DATA
            </span>
            <span>POINT CLOUD · WORKSPACE RECORDS</span>
            <span>{previewActive ? "PREVIEW MOVING" : "PREVIEW PAUSED"}</span>
          </div>
        </main>

        <aside className="cp-console-rail cp-right-rail">
          <section className="cp-hud-module cp-analytics-module">
            <div className="cp-module-head">
              <span>
                <Activity size={12} /> DATA DISTRIBUTION
              </span>
              <span className="cp-module-index">READ-ONLY</span>
            </div>
            <div className="cp-analytics-split">
              <div className="cp-risk-panel">
                <small>RISK FIELD MIX</small>
                <RiskMix events={events} />
              </div>
              <div className="cp-spend-panel">
                <small>OPTIONAL COST FIELDS</small>
                <strong>
                  {events.some(event => event.cost) ? "AVAILABLE" : "—"}
                </strong>
                <span>no derived spend shown</span>
              </div>
            </div>
            <div className="cp-prediction-rows cp-record-rows">
              <div>
                <span>EVENT RECORDS</span>
                <strong>{events.length || "—"}</strong>
              </div>
              <div>
                <span>APPROVAL RECORDS</span>
                <strong>{approvals.length || "—"}</strong>
              </div>
              <div>
                <span>BLOCKED RECORDS</span>
                <strong>{blockedEvents || "—"}</strong>
              </div>
            </div>
          </section>

          <ApprovalQueue
            dataState={resolvedDataState}
            approvals={approvals}
            onApproval={onApproval}
            onOpen={onOpenApprovals}
          />

          <section className="cp-hud-module cp-system-module">
            <div className="cp-module-head">
              <span>
                <FileClock size={12} /> DATA TRACE
              </span>
              <button className="cp-plain-link" onClick={onOpenAudit}>
                AUDIT <ArrowUpRight size={10} />
              </button>
            </div>
            <div className="cp-trace-lines">
              <span>
                <i className={emergencyStopped ? "is-red" : ""} />
                {emergencyStopped
                  ? "preview_control · stopped"
                  : "workspace_data · read-only"}
              </span>
              <span>
                <i className="is-purple" />
                {agents.length || "—"} agent records · displayed
              </span>
              <span>
                <i className={previewActive ? "" : "is-purple"} />
                {previewActive
                  ? "scene_preview · moving"
                  : "scene_preview · paused"}
              </span>
            </div>
          </section>
        </aside>
      </div>

      <footer className="cp-operator-bar">
        <div className="cp-operator-actions">
          <span className="cp-preview-label">
            LOCAL CONTROLS · PREVIEW ONLY
          </span>
          <button
            className={`cp-operator-button ${running ? "" : "is-selected"}`}
            onClick={() => setRunning(current => !current)}
            aria-label={
              running
                ? "Pause the local 3D preview"
                : "Resume the local 3D preview"
            }
          >
            {running ? <Pause size={12} /> : <Play size={12} />}
            {running ? "PAUSE PREVIEW" : "RESUME PREVIEW"}
          </button>
          <button className="cp-operator-button" onClick={exportLog}>
            <Download size={12} /> EXPORT DATA
          </button>
          <button
            className={`cp-operator-button ${isolated ? "is-selected is-isolated" : ""}`}
            onClick={toggleIsolation}
            disabled={!selected}
          >
            <ShieldAlert size={12} />
            {isolated ? "RELEASE VIEW" : "ISOLATE VIEW"}
          </button>
          <button className="cp-operator-button" onClick={recalibrate}>
            <RefreshCw size={12} /> RESET VIEW
          </button>
        </div>
        <div className="cp-render-readout">
          <span>
            <Bot size={11} /> {agents.length || "—"} RECORDS
          </span>
          <span>R3F · THREE.JS</span>
          <span>
            {emergencyStopped
              ? "PREVIEW STOPPED"
              : previewActive
                ? "LOCAL PREVIEW"
                : "PREVIEW PAUSED"}
          </span>
        </div>
      </footer>
    </section>
  );
}
