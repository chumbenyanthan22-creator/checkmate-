import { Canvas } from "@react-three/fiber";
import { motion, useReducedMotion } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  ArrowDownToLine,
  Bot,
  Check,
  Clock3,
  Cpu,
  Database,
  LockKeyhole,
  LogOut,
  Pause,
  Play,
  RefreshCw,
  Shield,
  ShieldAlert,
  Unplug,
} from "lucide-react";
import type { ReactNode } from "react";
import NeuralCoreScene from "./NeuralCoreScene";
import "../agent-breaker-console.css";

export type ControlRoomFeedState =
  | "unconfigured"
  | "connecting"
  | "live"
  | "empty"
  | "unauthorized"
  | "error";
export type ControlRoomStatus = "allowed" | "blocked" | "approval";
export type ControlRoomRange = "24h" | "7d" | "30d";

export type ControlRoomEvent = {
  id: string;
  agentId: string;
  agentName: string;
  action: string;
  detail: string;
  status: ControlRoomStatus;
  risk: string;
  signal: string;
  createdAt: string;
};

export type ControlRoomAgent = {
  id: string;
  name: string;
  description: string;
  risk: string;
  agentClass: string;
  health: string;
  latestEvent: ControlRoomEvent | null;
};

export type ControlRoomBucket = {
  label: string;
  start: number;
  allowed: number;
  blocked: number;
  approval: number;
};

type Props = {
  feedState: ControlRoomFeedState;
  connected: boolean;
  sourceMessage: string;
  workspaceName: string | null;
  userEmail: string;
  lastUpdated: Date | null;
  elapsed: number;
  agents: ControlRoomAgent[];
  visibleEvents: ControlRoomEvent[];
  selectedId: string;
  selectedAgent: ControlRoomAgent | null;
  loopEventCount: number;
  loopAgentCount: number;
  blockedCount: number;
  reviewCount: number;
  blockRate: string;
  buckets: ControlRoomBucket[];
  maxBucket: number;
  range: ControlRoomRange;
  running: boolean;
  isolatedId: string | null;
  cameraKey: number;
  onSelectAgent: (id: string) => void;
  onRangeChange: (range: ControlRoomRange) => void;
  onToggleRunning: () => void;
  onExportLog: () => void;
  onToggleIsolation: () => void;
  onRecalibrate: () => void;
  onSignOut: () => void;
};

const SIGNALS = [
  "guard_allowed",
  "loop_detected",
  "max_iterations_exceeded",
  "budget_exceeded",
  "policy_blocked",
  "approval_required",
] as const;

const CONTRACT = `POST /api/telemetry/ingest\nAuthorization: Bearer <agent-token>\n\n{\n  "event": {\n    "id": "<uuid>",\n    "action": "<bounded-action>",\n    "signal": "<allowlisted-signal>"\n  }\n}`;

function formatTime(value: string | Date) {
  const timestamp = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(timestamp.getTime())) return "TIME UNKNOWN";
  return timestamp.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function elapsedTime(value: number) {
  const seconds = Math.max(0, Math.floor(value / 1000));
  const hours = Math.floor(seconds / 3600).toString().padStart(2, "0");
  const minutes = Math.floor((seconds % 3600) / 60).toString().padStart(2, "0");
  const remaining = (seconds % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}:${remaining}`;
}

function readable(value: string) {
  return value.replace(/[_-]+/g, " ").trim().replace(/\b\w/g, part => part.toUpperCase());
}

function feedLabel(state: ControlRoomFeedState) {
  switch (state) {
    case "live":
      return "LIVE · VERIFIED FEED";
    case "empty":
      return "SOURCE CONNECTED · NO EVENTS";
    case "connecting":
      return "CONNECTING";
    case "unauthorized":
      return "ACCESS DENIED";
    case "error":
      return "SOURCE ERROR";
    default:
      return "SOURCE OFFLINE";
  }
}

function EmptyState({
  state,
  connected,
  message,
  compact = false,
}: {
  state: ControlRoomFeedState;
  connected: boolean;
  message: string;
  compact?: boolean;
}) {
  const Icon = state === "error" ? AlertTriangle : state === "unauthorized" ? ShieldAlert : Unplug;
  return (
    <div className={`ab-empty ${compact ? "is-compact" : ""}`} role="status">
      <Icon size={compact ? 13 : 17} aria-hidden="true" />
      <span>
        <strong>{connected ? "NO VERIFIED RECORDS" : feedLabel(state)}</strong>
        <small>{message}</small>
      </span>
    </div>
  );
}

function RoomHeader({
  index,
  room,
  title,
  note,
  right,
}: {
  index: string;
  room: string;
  title: string;
  note: string;
  right?: ReactNode;
}) {
  return (
    <div className="ab-room-heading">
      <div className="ab-room-index">{index}</div>
      <div className="ab-room-title">
        <span>{room}</span>
        <h2>{title}</h2>
        <small>{note}</small>
      </div>
      <div className="ab-room-meta">{right}</div>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone: "cyan" | "orange" | "red" | "violet";
}) {
  return (
    <div className={`ab-metric is-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function OutcomeBars({
  events,
  connected,
}: {
  events: ControlRoomEvent[];
  connected: boolean;
}) {
  const outcomes = [
    { key: "allowed", label: "ALLOWED", color: "cyan" },
    { key: "blocked", label: "BLOCKED", color: "red" },
    { key: "approval", label: "REVIEW", color: "orange" },
  ] as const;
  const total = events.length;

  return (
    <div className="ab-outcomes">
      {outcomes.map(outcome => {
        const count = events.filter(event => event.status === outcome.key).length;
        const width = total ? (count / total) * 100 : 0;
        return (
          <div className="ab-outcome-row" key={outcome.key}>
            <span><i className={`is-${outcome.color}`} />{outcome.label}</span>
            <div className="ab-outcome-track" aria-hidden="true">
              <i className={`is-${outcome.color}`} style={{ width: connected ? `${width}%` : "0%" }} />
            </div>
            <b>{connected ? count : "—"}</b>
          </div>
        );
      })}
    </div>
  );
}

function ActivityChart({
  buckets,
  maxBucket,
  connected,
  range,
}: {
  buckets: ControlRoomBucket[];
  maxBucket: number;
  connected: boolean;
  range: ControlRoomRange;
}) {
  if (!connected || !buckets.some(bucket => bucket.allowed + bucket.blocked + bucket.approval > 0)) {
    return (
      <div className="ab-chart-empty">
        <Activity size={15} aria-hidden="true" />
        <span>{connected ? "NO EVENTS IN THIS WINDOW" : "WAITING FOR VERIFIED SOURCE"}</span>
      </div>
    );
  }

  return (
    <div className="ab-chart" role="img" aria-label={`Verified event activity over ${range}`}>
      <div className="ab-chart-columns">
        {buckets.map(bucket => {
          const total = bucket.allowed + bucket.blocked + bucket.approval;
          const scale = maxBucket ? (total / maxBucket) * 100 : 0;
          const allowed = total ? (bucket.allowed / total) * scale : 0;
          const blocked = total ? (bucket.blocked / total) * scale : 0;
          const approval = total ? (bucket.approval / total) * scale : 0;
          return (
            <div className="ab-chart-column" key={bucket.start} title={`${bucket.label}: ${total} verified events`}>
              <span>{total || ""}</span>
              <div className="ab-chart-track">
                <i className="is-orange" style={{ height: `${approval}%` }} />
                <i className="is-red" style={{ height: `${blocked}%` }} />
                <i className="is-cyan" style={{ height: `${allowed}%` }} />
              </div>
              <small>{bucket.label}</small>
            </div>
          );
        })}
      </div>
      <div className="ab-chart-legend">
        <span><i className="is-cyan" /> ALLOWED</span>
        <span><i className="is-red" /> BLOCKED</span>
        <span><i className="is-orange" /> REVIEW</span>
      </div>
    </div>
  );
}

function EventRows({
  events,
  state,
  connected,
  message,
  onSelectAgent,
  limit = 5,
}: {
  events: ControlRoomEvent[];
  state: ControlRoomFeedState;
  connected: boolean;
  message: string;
  onSelectAgent: (id: string) => void;
  limit?: number;
}) {
  if (!events.length) return <EmptyState state={state} connected={connected} message={message} compact />;

  return (
    <div className="ab-event-list">
      {events.slice(0, limit).map(event => (
        <button
          className={`ab-event-row is-${event.status}`}
          key={event.id}
          onClick={() => onSelectAgent(event.agentId)}
          title={`Focus ${event.agentName}`}
        >
          <span className="ab-event-led"><i /></span>
          <span className="ab-event-copy">
            <span className="ab-event-title"><strong>{event.action}</strong><time>{formatTime(event.createdAt)}</time></span>
            <span className="ab-event-meta"><b>{event.agentName}</b><em>{readable(event.signal)}</em></span>
          </span>
        </button>
      ))}
    </div>
  );
}

function AgentConveyor({
  agents,
  selectedId,
  state,
  connected,
  message,
  onSelectAgent,
}: {
  agents: ControlRoomAgent[];
  selectedId: string;
  state: ControlRoomFeedState;
  connected: boolean;
  message: string;
  onSelectAgent: (id: string) => void;
}) {
  return (
    <div className="ab-conveyor">
      <div className="ab-conveyor-label"><span>VERIFIED AGENT CONVEYOR</span><small>{connected ? `${agents.length} RECORDS` : "SOURCE UNAVAILABLE"}</small></div>
      <div className="ab-conveyor-track">
        {agents.length ? agents.slice(0, 12).map(agent => (
          <button
            className={`ab-conveyor-card ${agent.health === "Loop Detected" ? "is-alert" : agent.health === "Blocked" ? "is-blocked" : ""}`}
            key={agent.id}
            onClick={() => onSelectAgent(agent.id)}
            aria-pressed={selectedId === agent.id}
          >
            <span className="ab-card-index">AGENT / {agent.agentClass || "REGISTERED"}</span>
            <strong>{agent.name}</strong>
            <span className="ab-card-status"><i />{agent.health.toUpperCase()}</span>
          </button>
        )) : (
          <div className="ab-conveyor-empty"><span>NO VERIFIED AGENT CARDS</span><small>{message}</small></div>
        )}
      </div>
      <span className="ab-flow-scan" aria-hidden="true" />
    </div>
  );
}

function EventConveyor({
  events,
  state,
  connected,
  message,
  onSelectAgent,
}: {
  events: ControlRoomEvent[];
  state: ControlRoomFeedState;
  connected: boolean;
  message: string;
  onSelectAgent: (id: string) => void;
}) {
  return (
    <div className="ab-conveyor">
      <div className="ab-conveyor-label"><span>OBSERVED EVENT CONVEYOR</span><small>{connected ? `${events.length} IN WINDOW` : feedLabel(state)}</small></div>
      <div className="ab-conveyor-track">
        {events.length ? events.slice(0, 14).map(event => (
          <button
            className={`ab-conveyor-card is-${event.status}`}
            key={event.id}
            onClick={() => onSelectAgent(event.agentId)}
            title={`${event.agentName} · ${readable(event.signal)}`}
          >
            <span className="ab-card-index">{formatTime(event.createdAt)} / {event.agentName}</span>
            <strong>{event.action}</strong>
            <span className="ab-card-status"><i />{readable(event.signal).toUpperCase()}</span>
          </button>
        )) : (
          <div className="ab-conveyor-empty"><span>NO VERIFIED EVENT CARDS</span><small>{message}</small></div>
        )}
      </div>
      <span className="ab-flow-scan" aria-hidden="true" />
    </div>
  );
}

function EventGrid({
  events,
  state,
  connected,
  message,
  onSelectAgent,
}: {
  events: ControlRoomEvent[];
  state: ControlRoomFeedState;
  connected: boolean;
  message: string;
  onSelectAgent: (id: string) => void;
}) {
  if (!events.length) return <EmptyState state={state} connected={connected} message={message} compact />;
  return (
    <div className="ab-event-grid" aria-label="One cell per verified event in the selected window">
      {events.slice(0, 56).map(event => (
        <button
          className={`ab-event-cell is-${event.status}`}
          key={event.id}
          onClick={() => onSelectAgent(event.agentId)}
          title={`${event.agentName} · ${event.action} · ${readable(event.signal)}`}
          aria-label={`${event.agentName}: ${event.action}, ${readable(event.signal)}`}
        >
          <span>{event.status === "allowed" ? <Check size={8} /> : event.status === "blocked" ? "!" : "?"}</span>
        </button>
      ))}
    </div>
  );
}

function SelectedAgentPanel({ agent }: { agent: ControlRoomAgent | null }) {
  if (!agent) {
    return (
      <div className="ab-selected-empty">
        <Cpu size={20} aria-hidden="true" />
        <strong>NO AGENT FOCUSED</strong>
        <small>A verified event is required before an agent can be selected.</small>
      </div>
    );
  }

  return (
    <div className="ab-selected-record">
      <div className="ab-selected-identity">
        <span className="ab-selected-avatar"><Bot size={20} aria-hidden="true" /></span>
        <span><strong>{agent.name}</strong><small>{agent.agentClass || "REGISTERED AGENT"}</small></span>
        <b className={`ab-health is-${agent.health === "Healthy" ? "healthy" : agent.health === "Loop Detected" ? "alert" : agent.health === "Unknown" ? "unknown" : agent.health === "Blocked" ? "blocked" : "review"}`}>
          <i />{agent.health.toUpperCase()}
        </b>
      </div>
      <div className="ab-selected-fields">
        <div><small>REGISTERED RISK</small><b>{agent.risk ? readable(agent.risk) : "NOT PROVIDED"}</b></div>
        <div><small>LAST VERIFIED SIGNAL</small><b>{agent.latestEvent ? readable(agent.latestEvent.signal) : "NO EVENT"}</b></div>
        <div><small>LAST OBSERVED</small><b>{agent.latestEvent ? formatTime(agent.latestEvent.createdAt) : "TIME UNKNOWN"}</b></div>
      </div>
      <p>{agent.description || "No source description provided."}</p>
    </div>
  );
}

export default function AgentBreakerControlRoom(props: Props) {
  const reducedMotion = Boolean(useReducedMotion());
  const {
    feedState,
    connected,
    sourceMessage,
    workspaceName,
    userEmail,
    lastUpdated,
    elapsed,
    agents,
    visibleEvents,
    selectedId,
    selectedAgent,
    loopEventCount,
    loopAgentCount,
    blockedCount,
    reviewCount,
    blockRate,
    buckets,
    maxBucket,
    range,
    running,
    isolatedId,
    cameraKey,
    onSelectAgent,
    onRangeChange,
    onToggleRunning,
    onExportLog,
    onToggleIsolation,
    onRecalibrate,
    onSignOut,
  } = props;
  const status = feedLabel(feedState);
  const motionClass = `${running && !reducedMotion ? "" : "is-paused"}`;
  const sceneAgents = agents.map(agent => ({ id: agent.id, name: agent.name, risk: agent.latestEvent?.risk || agent.risk }));

  return (
    <main className={`ab-console ${motionClass}`}>
      <header className="ab-header">
        <div className="ab-brand-lockup">
          <span className="ab-brand-mark" aria-hidden="true"><Bot size={24} strokeWidth={1.8} /></span>
          <div className="ab-brand-copy">
            <strong>SOVEREIGNHALT</strong>
            <small>AGENT BREAKER / PRIVATE TELEMETRY</small>
          </div>
        </div>
        <div className={`ab-source-status is-${feedState}`} title={sourceMessage} aria-live="polite">
          <i />{status}
        </div>
        <div className="ab-header-clock"><Clock3 size={12} /><span><small>CONSOLE UPTIME</small><b>{elapsedTime(elapsed)}</b></span></div>
        <div className={`ab-sec-badge ${connected ? "is-bound" : ""}`}><LockKeyhole size={12} /><span>SEC LEVEL</span><b>{connected ? "ALLOWLISTED / RO" : "LOCKED"}</b></div>
        <div className="ab-header-metrics" aria-label="Authenticated workspace metrics">
          <Metric label="VERIFIED AGENTS" value={connected ? agents.length : "—"} tone="cyan" />
          <Metric label={`SDK EVENTS / ${range.toUpperCase()}`} value={connected ? visibleEvents.length : "—"} tone="orange" />
          <Metric label="BLOCKED" value={connected ? blockedCount : "—"} tone="red" />
          <Metric label="REVIEW SIGNALS" value={connected ? reviewCount : "—"} tone="violet" />
        </div>
        <div className="ab-system-tags" aria-label="System capabilities">
          <span>SUPABASE AUTH</span><span>SDK INGEST</span><span>PRIVATE FEED</span><span>NO FILE PAYLOAD</span>
        </div>
        <div className="ab-header-user" title={userEmail}><LockKeyhole size={11} /><span>{userEmail}</span></div>
        <button className="ab-signout" onClick={onSignOut} title="Sign out of the private console"><LogOut size={12} /><span>SIGN OUT</span></button>
      </header>

      <div className="ab-source-strip" aria-live="polite">
        <span className="ab-source-name"><Database size={12} />{workspaceName || "SOVEREIGNHALT PRIVATE FEED"}</span>
        <span className="ab-source-message">{sourceMessage}</span>
        <span className="ab-sync-time">{lastUpdated ? `SYNC ${formatTime(lastUpdated)}` : "AWAITING SOURCE"}</span>
      </div>

      <div className="ab-rooms">
        <motion.section
          className="ab-room ab-room-a"
          aria-labelledby="ab-room-a-title"
          initial={reducedMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.32, delay: 0.02 }}
        >
          <RoomHeader
            index="01"
            room="ROOM A"
            title="VERIFIED AGENT SIGNALS"
            note="Only registered workspace agents and validated SDK events are shown"
            right={<><span className="ab-live-mark"><i />{connected ? "15S POLL" : "SOURCE WAIT"}</span><b>{connected ? `${agents.length} AGENTS` : "— AGENTS"}</b></>}
          />
          <div className="ab-room-content ab-room-a-content">
            <section className="ab-subpanel ab-roster-panel">
              <div className="ab-subheading"><span>01A / AGENT STATUS</span><small>{connected ? agents.length : "—"} RECORDS</small></div>
              {agents.length ? (
                <div className="ab-roster-list">
                  {agents.slice(0, 6).map(agent => (
                    <button className={`ab-roster-row ${selectedId === agent.id ? "is-selected" : ""}`} key={agent.id} onClick={() => onSelectAgent(agent.id)} aria-pressed={selectedId === agent.id}>
                      <span className="ab-roster-glyph"><Cpu size={12} /></span>
                      <span className="ab-roster-name"><b>{agent.name}</b><small>{agent.agentClass || "REGISTERED"}</small></span>
                      <span className={`ab-health is-${agent.health === "Healthy" ? "healthy" : agent.health === "Loop Detected" ? "alert" : agent.health === "Unknown" ? "unknown" : agent.health === "Blocked" ? "blocked" : "review"}`}><i />{agent.health.toUpperCase()}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <EmptyState state={feedState} connected={connected} message={sourceMessage} compact />
              )}
              <div className="ab-panel-foot"><Shield size={10} />SOURCE-RECORDED HEALTH ONLY</div>
            </section>

            <section className="ab-subpanel ab-activity-panel">
              <div className="ab-subheading"><span>01B / EVENT ACTIVITY</span><label className="ab-range-select"><span className="sr-only">Activity window</span><select value={range} onChange={event => onRangeChange(event.target.value as ControlRoomRange)}><option value="24h">24H</option><option value="7d">7D</option><option value="30d">30D</option></select></label></div>
              <ActivityChart buckets={buckets} maxBucket={maxBucket} connected={connected} range={range} />
            </section>

            <section className="ab-subpanel ab-signal-panel">
              <div className="ab-subheading"><span>01C / SOURCE COUNTS</span><small>SELECTED WINDOW</small></div>
              <div className="ab-signal-stats">
                <div><small>EVENTS</small><b>{connected ? visibleEvents.length : "—"}</b></div>
                <div><small>LOOP FLAGS</small><b className={loopEventCount ? "is-red" : ""}>{connected ? loopEventCount : "—"}</b></div>
                <div><small>BLOCK RATE</small><b>{connected ? blockRate : "—"}</b></div>
                <div><small>LOOP AGENTS</small><b className={loopAgentCount ? "is-red" : ""}>{connected ? loopAgentCount : "—"}</b></div>
              </div>
              <div className="ab-clean-wall"><span className="ab-wall-line" /><span>PRIVATE DATA WALL</span><small>ONLY ALLOWLISTED FEED PASSES</small></div>
            </section>
          </div>
          <AgentConveyor agents={agents} selectedId={selectedId} state={feedState} connected={connected} message={sourceMessage} onSelectAgent={onSelectAgent} />
        </motion.section>

        <motion.section
          className="ab-room ab-room-b"
          aria-labelledby="ab-room-b-title"
          initial={reducedMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.32, delay: 0.08 }}
        >
          <RoomHeader
            index="02"
            room="ROOM B"
            title="STRUCTURED SIGNAL / SELECTED AGENT"
            note="Identity, outcome, risk, and timestamps are derived or validated server-side"
            right={<span className="ab-contract-mark"><LockKeyhole size={10} />SDK CONTRACT</span>}
          />
          <div className="ab-room-content ab-room-b-content">
            <section className="ab-subpanel ab-contract-panel">
              <div className="ab-subheading"><span>02A / INGEST CONTRACT</span><small>NO RAW TOOL DATA</small></div>
              <pre className="ab-contract-code"><code>{CONTRACT}</code></pre>
              <div className="ab-signal-allowlist"><span>ALLOWLISTED SIGNALS</span>{SIGNALS.map(signal => <b key={signal}>{signal}</b>)}</div>
            </section>

            <section className="ab-subpanel ab-scene-panel">
              <div className="ab-subheading"><span>02B / VERIFIED AGENT FIELD</span><small>{connected ? `${agents.length} REAL NODES` : "NO SOURCE"}</small></div>
              <div className="ab-scene-stage">
                {agents.length ? (
                  <Canvas key={cameraKey} dpr={[1, 1.35]} camera={{ position: [0, 0.12, 6.6], fov: 40 }} gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}>
                    <NeuralCoreScene agents={sceneAgents} selectedId={selectedId} running={running && !reducedMotion} emergencyStopped={false} isolatedAgentId={isolatedId} onSelectAgent={onSelectAgent} />
                  </Canvas>
                ) : (
                  <div className="ab-scene-empty"><Bot size={22} /><strong>NO VERIFIED AGENTS</strong><small>{sourceMessage}</small></div>
                )}
                <div className="ab-scene-overlay"><span><i className={connected ? "is-connected" : ""} />{connected ? "AUTHENTICATED SCOPE" : "UNBOUND"}</span><span>{selectedAgent ? selectedAgent.name : "NO AGENT FOCUSED"}</span></div>
              </div>
              <div className="ab-scene-foot"><span>R3F / RECORD-MAPPED</span><span>LINKS ARE VISUAL ONLY</span></div>
            </section>

            <section className="ab-subpanel ab-selected-panel">
              <div className="ab-subheading"><span>02C / FOCUS RECORD</span><small>LOCAL SELECTION</small></div>
              <SelectedAgentPanel agent={selectedAgent} />
            </section>
          </div>
          <SignalConveyor />
        </motion.section>

        <motion.section
          className="ab-room ab-room-c"
          aria-labelledby="ab-room-c-title"
          initial={reducedMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.32, delay: 0.14 }}
        >
          <RoomHeader
            index="03"
            room="ORACLE"
            title="OBSERVED OUTCOMES / SYSTEM LOG"
            note="No prediction or external action is displayed without a connected source"
            right={<span className="ab-log-counter">{connected ? `${visibleEvents.length} EVENTS` : "NO SOURCE ROWS"}</span>}
          />
          <div className="ab-room-content ab-room-c-content">
            <section className="ab-subpanel ab-outcome-panel">
              <div className="ab-subheading"><span>03A / OBSERVED OUTCOMES</span><small>{connected ? `${visibleEvents.length} RECORDS` : "—"}</small></div>
              <OutcomeBars events={visibleEvents} connected={connected} />
              <div className="ab-observed-pair">
                <div><small>LOOP SIGNAL EVENTS</small><b className={loopEventCount ? "is-red" : ""}>{connected ? loopEventCount : "—"}</b></div>
                <div><small>REVIEW SIGNALS</small><b>{connected ? reviewCount : "—"}</b></div>
              </div>
              <div className="ab-prediction-note"><Activity size={12} /><span><b>FORECAST: UNAVAILABLE</b><small>No prediction model is connected.</small></span></div>
            </section>

            <section className="ab-subpanel ab-grid-panel">
              <div className="ab-subheading"><span>03B / EVENT GRID</span><small>ONE CELL / VERIFIED EVENT</small></div>
              <EventGrid events={visibleEvents} state={feedState} connected={connected} message={sourceMessage} onSelectAgent={onSelectAgent} />
              <div className="ab-grid-legend"><span><i className="is-cyan" />ALLOWED</span><span><i className="is-red" />BLOCKED</span><span><i className="is-orange" />REVIEW</span></div>
            </section>

            <section className="ab-subpanel ab-log-panel">
              <div className="ab-subheading"><span>03C / PRIVATE AUDIT FEED</span><small>{connected ? `LAST ${Math.min(visibleEvents.length, 8)}` : "—"}</small></div>
              <EventRows events={visibleEvents} state={feedState} connected={connected} message={sourceMessage} onSelectAgent={onSelectAgent} limit={8} />
            </section>
          </div>
          <EventConveyor events={visibleEvents} state={feedState} connected={connected} message={sourceMessage} onSelectAgent={onSelectAgent} />
        </motion.section>
      </div>

      <div className="ab-terminal-strip" aria-live="polite">
        <span className="ab-terminal-prompt">SOVEREIGNHALT<span>$</span></span>
        <code>{connected ? "GET /api/telemetry/dashboard · CACHE: NO-STORE" : "WAITING FOR AUTHORIZED PRIVATE SOURCE"}</code>
        <span className="ab-terminal-source"><i className={connected ? "is-connected" : ""} />{connected ? (feedState === "live" ? "VERIFIED EVENTS PRESENT" : "API CONNECTED · NO VERIFIED EVENTS") : status}</span>
        <span className="ab-terminal-sync">{lastUpdated ? formatTime(lastUpdated) : "NO SYNC"}</span>
      </div>

      <footer className="ab-operator-bar">
        <div className="ab-operator-note"><span><Shield size={12} />VISUALIZATION CONTROLS</span><small>LOCAL VIEW ONLY · NO RUNTIME COMMANDS ARE SENT</small></div>
        <div className="ab-operator-actions">
          <button onClick={onToggleRunning} title="Pause or resume visual motion; agents continue running">{running ? <Pause size={13} /> : <Play size={13} />}{running ? "PAUSE" : "RESUME"}</button>
          <button onClick={onExportLog} disabled={!connected} title="Export only the currently loaded authenticated records"><ArrowDownToLine size={13} />EXPORT LOG</button>
          <button onClick={onToggleIsolation} disabled={!selectedAgent} className={isolatedId ? "is-isolated" : ""} title="Isolate the selected agent in this visualization only"><ShieldAlert size={13} />{isolatedId ? "RECONNECT AGENT" : "ISOLATE AGENT"}</button>
          <button onClick={onRecalibrate} title="Reset local scene focus and camera"><RefreshCw size={13} />RECALIBRATE</button>
        </div>
        <div className="ab-operator-source"><span className={connected ? "is-connected" : ""}><i />{connected ? "AUTHENTICATED / READ ONLY" : "NO VERIFIED SOURCE"}</span><small>{workspaceName || "PRIVATE WORKSPACE"}</small></div>
      </footer>
    </main>
  );
}


function SignalConveyor() {
  return (
    <div className="ab-conveyor">
      <div className="ab-conveyor-label"><span>SERVER-ALLOWLISTED SIGNAL CONVEYOR</span><small>SCHEMA ENUM · NOT EVENT COUNTS</small></div>
      <div className="ab-conveyor-track">
        {SIGNALS.map(signal => <span className="ab-signal-chip" key={signal}><i />{signal}</span>)}
      </div>
      <span className="ab-flow-scan" aria-hidden="true" />
    </div>
  );
}
