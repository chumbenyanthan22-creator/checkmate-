import { Canvas } from "@react-three/fiber";
import {
  Activity,
  ArrowUpRight,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
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

type ActivityStatus = "allowed" | "blocked" | "approval";
type RiskLevel = "Low" | "Medium" | "High" | "Critical";
type AgentSignal = { id: string; name: string; status: string; risk: string; calls?: string };
type ActivitySignal = { id: number; agent: string; agentId: string; action: string; detail: string; status: ActivityStatus; risk: RiskLevel; time: string; cost?: string };
type ApprovalSignal = { id: string; agent: string; action: string; detail: string; risk: RiskLevel; age: string };
type SpendPoint = { day: string; total: number };
type MetricPack = { agents: string; actions: string; blocked: string; spend: string; delta: string };

type AgentCoreSceneProps = {
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
  spendTrend: SpendPoint[];
  sessionSpend: number;
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

function formatSpend(value: number) {
  return `$${value.toFixed(value < 0.01 ? 4 : 2)}`;
}

function SpendTrend({ points }: { points: SpendPoint[] }) {
  const recent = points.slice(-12);
  const max = Math.max(...recent.map((point) => point.total), 0.000001);
  const coordinates = recent.map((point, index) => {
    const x = recent.length === 1 ? 50 : (index / (recent.length - 1)) * 100;
    const y = 38 - (point.total / max) * 30;
    return `${x},${y}`;
  });
  return (
    <svg className="cp-spend-trend" viewBox="0 0 100 42" preserveAspectRatio="none" role="img" aria-label="Daily estimated runtime spend trend">
      <defs><linearGradient id="cpSpendFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#5cecff" stopOpacity=".25" /><stop offset="1" stopColor="#5cecff" stopOpacity="0" /></linearGradient></defs>
      {[10, 22, 34].map((y) => <line key={y} x1="0" y1={y} x2="100" y2={y} stroke="rgba(137,160,190,.14)" strokeWidth=".4" />)}
      {coordinates.length > 1 && <polygon points={`0,42 ${coordinates.join(" ")} 100,42`} fill="url(#cpSpendFill)" />}
      {coordinates.length > 0 && <polyline points={coordinates.join(" ")} fill="none" stroke="#5cecff" strokeWidth="1.3" vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}

function ActivityPanel({ events, agents, activityFilter, setActivityFilter, agentFilter, setAgentFilter, onSelectAgent, onOpenAudit }: {
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
      <div className="cp-module-head"><span><Activity size={12} /> DECISION STREAM</span><button className="cp-plain-link" onClick={onOpenAudit}>FULL LOG <ArrowUpRight size={11} /></button></div>
      <div className="cp-stream-controls">
        <div className="cp-filter-chips" role="group" aria-label="Filter activity by decision">
          {(["all", "allowed", "blocked", "approval"] as const).map((filter) => (
            <button key={filter} className={activityFilter === filter ? "is-active" : ""} onClick={() => setActivityFilter(filter)} aria-pressed={activityFilter === filter}>{activityLabels[filter]}</button>
          ))}
        </div>
        <label className="cp-agent-filter"><SlidersHorizontal size={11} /><select value={agentFilter} onChange={(event) => setAgentFilter(event.target.value)} aria-label="Filter activity by agent"><option value="all">ALL AGENTS</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select><ChevronDown size={11} /></label>
      </div>
      <div className="cp-event-list">
        {events.slice(0, 3).map((event) => {
          const Icon = riskIcon(event.status);
          return (
            <button className="cp-event-row" key={event.id} onClick={() => onSelectAgent(event.agentId)} aria-label={`Focus ${event.agent} from event ${event.action}`}>
              <span className={`cp-event-icon event-${event.status}`}><Icon size={12} /></span>
              <span className="cp-event-copy"><strong>{event.action}</strong><small>{event.agent} · {event.detail}</small></span>
              <span className={`cp-event-risk ${riskStyle[event.risk]}`}>{event.risk.slice(0, 3).toUpperCase()}</span>
            </button>
          );
        })}
        {events.length === 0 && <div className="cp-empty-stream">No decisions match the current filters.</div>}
      </div>
    </section>
  );
}

function RiskMix({ events }: { events: ActivitySignal[] }) {
  const mix = useMemo(() => {
    const total = events.length;
    const levels: RiskLevel[] = ["Low", "Medium", "High", "Critical"];
    let cursor = 0;
    const segments = levels.map((risk) => {
      const count = events.filter((event) => event.risk === risk).length;
      const percent = total ? (count / total) * 100 : 0;
      const start = cursor;
      cursor += percent;
      return { risk, count, percent, start, end: cursor };
    });
    const gradient = total ? segments.map(({ risk, start, end }) => `${riskColors[risk]} ${start}% ${end}%`).join(", ") : "#20253a 0% 100%";
    return { segments, gradient, total };
  }, [events]);

  return (
    <div className="cp-risk-mix">
      <div className="cp-risk-donut" style={{ "--risk-gradient": `conic-gradient(${mix.gradient})` } as CSSProperties}>
        <div><strong>{mix.total}</strong><small>EVENTS</small></div>
      </div>
      <div className="cp-risk-legend">
        {mix.segments.map(({ risk, count, percent }) => <div key={risk}><i style={{ backgroundColor: riskColors[risk] }} /><span>{risk.toUpperCase()}</span><strong>{mix.total ? `${Math.round(percent)}%` : "—"}</strong><small>{count}</small></div>)}
      </div>
    </div>
  );
}

function ApprovalQueue({ approvals, onApproval, onOpen }: { approvals: ApprovalSignal[]; onApproval: (id: string, action: "approved" | "blocked") => void; onOpen: () => void }) {
  return (
    <section className="cp-hud-module cp-approval-module">
      <div className="cp-module-head"><span><ShieldAlert size={12} /> PENDING APPROVALS</span><span className="cp-approval-count">{approvals.length}</span></div>
      <div className="cp-approval-list">
        {approvals.slice(0, 2).map((approval) => (
          <article className="cp-approval-item" key={approval.id}>
            <div className="cp-approval-top"><strong>{approval.action}</strong><span className={`cp-event-risk ${riskStyle[approval.risk]}`}>{approval.risk.toUpperCase()}</span></div>
            <p>{approval.detail}</p>
            <div className="cp-approval-meta"><span>{approval.agent}</span><span>{approval.id}</span></div>
            <div className="cp-approval-actions"><button onClick={() => onApproval(approval.id, "approved")}>ALLOW</button><button onClick={() => onApproval(approval.id, "blocked")}>BLOCK</button></div>
          </article>
        ))}
        {approvals.length === 0 && <div className="cp-empty-stream">Queue clear · no decisions required.</div>}
      </div>
      <button className="cp-queue-link" onClick={onOpen}>OPEN APPROVAL QUEUE <ChevronRight size={11} /></button>
    </section>
  );
}

export default function AgentCoreScene({
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
  spendTrend,
  sessionSpend,
}: AgentCoreSceneProps) {
  const [selectedId, setSelectedId] = useState(agents[0]?.id ?? "");
  const [running, setRunning] = useState(true);
  const [isolatedAgentId, setIsolatedAgentId] = useState<string | null>(null);
  const [cameraKey, setCameraKey] = useState(0);
  const selected = agents.find((agent) => agent.id === selectedId) ?? agents[0];
  const risk = (selected?.risk ?? "Low") as RiskLevel;
  const riskScore = risk === "Critical" ? 94 : risk === "High" ? 78 : risk === "Medium" ? 48 : 19;
  const isolated = Boolean(selected && isolatedAgentId === selected.id);
  const motionEnabled = running && !emergencyStopped;
  const spendValue = sessionSpend > 0 ? formatSpend(sessionSpend) : metrics.spend;

  useEffect(() => {
    if (!agents.some((agent) => agent.id === selectedId)) setSelectedId(agents[0]?.id ?? "");
  }, [agents, selectedId]);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) setRunning(false);
  }, []);

  const focusAgent = (id: string) => {
    if (agents.some((agent) => agent.id === id)) setSelectedId(id);
  };
  const exportLog = () => {
    const report = {
      generatedAt: new Date().toISOString(),
      product: "AgentBreaker Runtime Control Plane",
      mode: emergencyStopped ? "emergency-stopped" : isolated ? "agent-isolated" : running ? "active" : "paused",
      focus: selected ? { id: selected.id, name: selected.name, status: selected.status, risk: selected.risk } : null,
      metrics,
      events: events.slice(0, 20),
      approvals: approvals.map(({ id, action, risk: approvalRisk, agent }) => ({ id, action, risk: approvalRisk, agent })),
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `agentbreaker-runtime-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  const recalibrate = () => {
    setCameraKey((key) => key + 1);
    setSelectedId(agents[0]?.id ?? "");
    setIsolatedAgentId(null);
    setRunning(true);
  };
  const toggleIsolation = () => {
    if (!selected) return;
    setIsolatedAgentId((current) => current === selected.id ? null : selected.id);
  };

  return (
    <section className="panel cp-control-deck" aria-label="AgentBreaker single-screen runtime control dashboard">
      <header className="cp-console-topbar">
        <div className="cp-console-brand">
          <div className="cp-console-brand-mark"><span>AB</span><i /></div>
          <div className="cp-console-title"><strong>AGENTBREAKER <span>// RUNTIME CORE</span></strong><small>AI AGENT CONTROL PLANE</small></div>
        </div>
        <div className="cp-console-statuses">
          <span className={`cp-console-pill ${emergencyStopped ? "is-danger" : motionEnabled ? "is-live" : "is-paused"}`}><i />{emergencyStopped ? "EXECUTION HALTED" : motionEnabled ? "RUNTIME ACTIVE" : "SIMULATION PAUSED"}</span>
          <span className="cp-console-pill"><Bot size={11} /> {agents.length} FOCUSED NODES</span>
        </div>
        <div className="cp-console-controls">
          <label className="cp-range-select"><Clock3 size={12} /><select value={timeRange} onChange={(event) => setTimeRange(event.target.value)} aria-label="Choose telemetry time range"><option value="24h">24 HOURS</option><option value="7d">7 DAYS</option><option value="30d">30 DAYS</option></select><ChevronDown size={11} /></label>
          <button className={`cp-emergency-button ${emergencyStopped ? "is-resume" : ""}`} onClick={onEmergencyStop}><Power size={12} />{emergencyStopped ? "RESUME" : "EMERGENCY STOP"}</button>
        </div>
      </header>

      <div className="cp-kpi-strip" aria-label="Runtime summary metrics">
        <div className="cp-kpi-cell"><span><Bot size={12} /> PROTECTED AGENTS</span><strong>{metrics.agents}</strong><small>{metrics.delta} vs previous period</small></div>
        <div className="cp-kpi-cell"><span><Activity size={12} /> ACTIONS TODAY</span><strong>{metrics.actions}</strong><small>within defined boundaries</small></div>
        <div className="cp-kpi-cell"><span><Shield size={12} /> BLOCKED ACTIONS</span><strong className="cp-kpi-danger">{metrics.blocked}</strong><small>prevented before dispatch</small></div>
        <div className="cp-kpi-cell"><span><CircleDollarSign size={12} /> SPEND TRACKED</span><strong>{spendValue}</strong><small>{sessionSpend > 0 ? "estimated from tool outputs" : "awaiting live tool logs"}</small></div>
      </div>

      <div className="cp-console-grid">
        <aside className="cp-console-rail cp-left-rail">
          <section className="cp-hud-module cp-focus-module">
            <div className="cp-module-head"><span><Bot size={12} /> AGENT STATUS</span><span className="cp-module-index">01 / FOCUS</span></div>
            <div className="cp-focus-card">
              <span className="cp-focus-avatar"><Bot size={17} /></span>
              <div><small>FOCUSED NODE</small><strong>{selected?.name ?? "No agent selected"}</strong></div>
              <span className={`cp-node-led ${emergencyStopped ? "is-red" : ""}`} />
            </div>
            <div className="cp-focus-meta"><span className={emergencyStopped ? "is-red" : ""}>{emergencyStopped ? "HALTED" : selected?.status.toUpperCase() ?? "READY"}</span><span className={`cp-event-risk ${riskStyle[risk]}`}>{risk.toUpperCase()} RISK</span></div>
            <div className="cp-boundary-readout"><span>RUNTIME BOUNDARY</span><strong>{emergencyStopped ? "EXECUTION FROZEN" : "PRE-DISPATCH GUARD"}</strong><small>{isolated ? "Selected node isolated in local demo" : "Tool calls evaluated before dispatch"}</small></div>
            <div className="cp-exposure"><span>RISK EXPOSURE</span><strong>{emergencyStopped ? "0%" : `${riskScore}%`}</strong></div>
            <div className="cp-risk-meter"><span style={{ width: `${emergencyStopped ? 0 : riskScore}%`, "--meter-color": riskColors[risk] } as CSSProperties} /></div>
            <div className="cp-agent-pickers" aria-label="Select focused agent">
              {agents.map((agent, index) => <button key={agent.id} className={agent.id === selected?.id ? "is-active" : ""} onClick={() => focusAgent(agent.id)} aria-pressed={agent.id === selected?.id}><span style={{ "--agent-color": index % 2 === 0 ? "#5cecff" : "#b36bff" } as CSSProperties} />{agent.name.replace(" Agent", "")}</button>)}
            </div>
            <button className="cp-profile-link" onClick={() => selected && onAgentSelect(selected.id)}>OPEN AGENT PROFILE <ChevronRight size={11} /></button>
          </section>

          <ActivityPanel events={events} agents={agents} activityFilter={activityFilter} setActivityFilter={setActivityFilter} agentFilter={agentFilter} setAgentFilter={setAgentFilter} onSelectAgent={focusAgent} onOpenAudit={onOpenAudit} />
        </aside>

        <main className="cp-core-column">
          <section className={`cp-core-stage ${emergencyStopped ? "is-alert" : ""}`} aria-label="Interactive real-time 3D neural runtime core">
            <div className="cp-core-caption"><span><i className="cp-caption-live" /> NEURAL RUNTIME CORE</span><span>WEBGL / 3D · {agents.length} NODES</span></div>
            <Canvas key={cameraKey} dpr={[1, 1.75]} camera={{ position: [0, 0.15, 6.2], fov: 38 }} gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}>
              <NeuralCoreScene agents={agents} selectedId={selected?.id ?? ""} running={running} emergencyStopped={emergencyStopped} isolatedAgentId={isolatedAgentId} onSelectAgent={focusAgent} />
            </Canvas>
            <div className="cp-core-corner cp-core-corner-left"><span>ENGINE STATE</span><strong className={emergencyStopped ? "is-red" : ""}>{emergencyStopped ? "FROZEN" : isolated ? "ISOLATED" : "BOUNDED"}</strong><small>POLICY GATE · {emergencyStopped ? "CLOSED" : "ACTIVE"}</small></div>
            <div className="cp-core-corner cp-core-corner-right"><span>FOCUS RISK</span><strong className={risk === "Critical" ? "is-red" : ""}>{risk.toUpperCase()}</strong><small>{selected?.calls ?? "—"} CALLS TRACKED</small></div>
            <div className="cp-core-bottom"><span>{selected?.name ?? "Agent node"}</span><small>DRAG TO ORBIT · CLICK A NODE TO FOCUS</small></div>
          </section>
          <div className="cp-core-statusline"><span><i /> TRUST BOUNDARY ACTIVE</span><span>POINT CLOUD · {CORE_ROWS_LABEL}</span><span>{motionEnabled ? "MOTION LIVE" : "MOTION PAUSED"}</span></div>
        </main>

        <aside className="cp-console-rail cp-right-rail">
          <section className="cp-hud-module cp-analytics-module">
            <div className="cp-module-head"><span><Activity size={12} /> TELEMETRY &amp; RISK</span><span className="cp-module-index">FILTERED VIEW</span></div>
            <div className="cp-analytics-split"><div className="cp-risk-panel"><small>RISK MIX</small><RiskMix events={events} /></div><div className="cp-spend-panel"><small>SPEND TREND</small><strong>{spendValue}</strong><SpendTrend points={spendTrend} /><span>{spendTrend.at(-1)?.day ?? "NO LOGS"}</span></div></div>
            <div className="cp-prediction-rows"><div><span>SAFE ROUTES</span><i><b style={{ width: "92%" }} /></i><strong>92%</strong></div><div><span>REVIEW QUEUE</span><i><b className="is-purple" style={{ width: `${Math.min(100, approvals.length * 22)}%` }} /></i><strong>{approvals.length}</strong></div><div><span>BLOCK SIGNAL</span><i><b className="is-red" style={{ width: `${Math.min(100, Number(metrics.blocked.replace(/[^0-9]/g, "")) || 14)}%` }} /></i><strong>{metrics.blocked}</strong></div></div>
          </section>

          <ApprovalQueue approvals={approvals} onApproval={onApproval} onOpen={onOpenApprovals} />

          <section className="cp-hud-module cp-system-module">
            <div className="cp-module-head"><span><FileClock size={12} /> SYSTEM TRACE</span><button className="cp-plain-link" onClick={onOpenAudit}>AUDIT <ArrowUpRight size={10} /></button></div>
            <div className="cp-trace-lines"><span><i className={emergencyStopped ? "is-red" : ""} />{emergencyStopped ? "emergency_stop · engaged" : "policy_engine · boundaries synced"}</span><span><i className="is-purple" />{agents.length} agent nodes · observed</span><span><i className={motionEnabled ? "" : "is-purple"} />{motionEnabled ? "runtime_stream · active" : "runtime_stream · paused"}</span></div>
          </section>
        </aside>
      </div>

      <footer className="cp-operator-bar">
        <div className="cp-operator-actions">
          <button className={`cp-operator-button ${running ? "" : "is-selected"}`} onClick={() => setRunning((current) => !current)} aria-label={running ? "Pause the 3D scene" : "Resume the 3D scene"}>{running ? <Pause size={12} /> : <Play size={12} />}{running ? "PAUSE SCENE" : "RESUME SCENE"}</button>
          <button className="cp-operator-button" onClick={exportLog}><Download size={12} /> EXPORT LOG</button>
          <button className={`cp-operator-button ${isolated ? "is-selected is-isolated" : ""}`} onClick={toggleIsolation} disabled={!selected}><ShieldAlert size={12} />{isolated ? "RELEASE NODE" : "ISOLATE FOCUS"}</button>
          <button className="cp-operator-button" onClick={recalibrate}><RefreshCw size={12} /> RECALIBRATE</button>
        </div>
        <div className="cp-render-readout"><span><Bot size={11} /> {agents.length} AGENTS</span><span>R3F · THREE.JS</span><span>{emergencyStopped ? "EMERGENCY STOP ACTIVE" : motionEnabled ? "CORE STREAM ACTIVE" : "CORE PAUSED"}</span></div>
      </footer>
    </section>
  );
}

const CORE_ROWS_LABEL = "3D PARTICLE FIELD";
