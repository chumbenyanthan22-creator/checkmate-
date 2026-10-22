import { Canvas } from "@react-three/fiber";
import {
  Activity,
  AlertTriangle,
  ArrowDownToLine,
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
import { useEffect, useMemo, useRef, useState } from "react";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import NeuralCoreScene from "../components/NeuralCoreScene";
import "../sovereignhalt.css";

type FeedState =
  | "unconfigured"
  | "connecting"
  | "live"
  | "empty"
  | "unauthorized"
  | "error";
type ActivityStatus = "allowed" | "blocked" | "approval";
type AgentRecord = {
  id: string;
  name: string;
  description: string;
  risk: string;
  agentClass: string;
};
type EventRecord = {
  id: string;
  agentId: string;
  agentName: string;
  action: string;
  detail: string;
  status: ActivityStatus;
  risk: string;
  signal: string;
  createdAt: string;
};
type TimeRange = "24h" | "7d" | "30d";
type ChartBucket = {
  label: string;
  start: number;
  allowed: number;
  blocked: number;
  approval: number;
};

const EMPTY_AGENTS: AgentRecord[] = [];
const EMPTY_EVENTS: EventRecord[] = [];

function isConnected(state: FeedState) {
  return state === "live" || state === "empty";
}

function stateLabel(state: FeedState) {
  switch (state) {
    case "live":
      return "LIVE • ACTIVE";
    case "empty":
      return "LIVE • ACTIVE";
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

function stateMessage(state: FeedState) {
  switch (state) {
    case "connecting":
      return "Reading records from the configured workspace.";
    case "live":
      return "Workspace records are refreshing every 15 seconds.";
    case "empty":
      return "Private telemetry API is connected; the workspace is created on the first real SDK event.";
    case "unauthorized":
      return "This Supabase account is not allowlisted for the private workspace. No telemetry is displayed.";
    case "error":
      return "The authenticated telemetry API could not be read. No agent or event records are displayed.";
    default:
      return "Private Supabase Auth, server telemetry API, or registered real-agent profiles are not configured. No private records are displayed.";
  }
}

function decision(value: unknown): ActivityStatus | null {
  const normalized = String(value ?? "").toLowerCase();
  if (["allowed", "allow", "success", "completed"].includes(normalized))
    return "allowed";
  if (["blocked", "block", "denied", "rejected"].includes(normalized))
    return "blocked";
  if (["approval", "pending", "review", "approval_required"].includes(normalized))
    return "approval";
  return null;
}

function titleCase(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\w/g, character => character.toUpperCase());
}

function isLoopSignal(event: EventRecord) {
  return event.status === "blocked" && event.signal === "loop_detected";
}

function latestAgentEvent(agent: AgentRecord, events: EventRecord[]) {
  return events
    .filter(event => event.agentId === agent.id)
    .reduce<EventRecord | null>((current, candidate) => {
      if (!current) return candidate;
      return new Date(candidate.createdAt).getTime() > new Date(current.createdAt).getTime()
        ? candidate
        : current;
    }, null);
}

function agentHealth(agent: AgentRecord, events: EventRecord[]) {
  const latest = latestAgentEvent(agent, events);
  if (!latest) return "Unknown";
  if (latest.signal === "loop_detected") return "Loop Detected";
  if (latest.signal === "guard_allowed") return "Healthy";
  if (latest.signal === "approval_required") return "Review";
  return "Blocked";
}

function statusClass(status: string) {
  if (status === "Healthy") return "is-healthy";
  if (status === "Loop Detected") return "is-loop";
  if (status === "Unknown") return "is-unknown";
  return "is-review";
}

function formatTime(value: string) {
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) return "TIME UNKNOWN";
  return timestamp.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function timeSince(value: number) {
  const seconds = Math.max(0, Math.floor(value / 1000));
  const hours = Math.floor(seconds / 3600)
    .toString()
    .padStart(2, "0");
  const minutes = Math.floor((seconds % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const remaining = (seconds % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}:${remaining}`;
}

function rangeStart(range: TimeRange, now: number) {
  const duration =
    range === "24h"
      ? 24 * 60 * 60 * 1000
      : range === "7d"
        ? 7 * 24 * 60 * 60 * 1000
        : 30 * 24 * 60 * 60 * 1000;
  return now - duration;
}

function buildBuckets(events: EventRecord[], range: TimeRange, now: number) {
  const count = range === "24h" ? 8 : range === "7d" ? 7 : 10;
  const start = rangeStart(range, now);
  const step = (now - start) / count;
  const buckets: ChartBucket[] = Array.from({ length: count }, (_, index) => {
    const at = start + index * step;
    const date = new Date(at);
    return {
      start: at,
      label:
        range === "24h"
          ? date.toLocaleTimeString([], { hour: "2-digit", hour12: false })
          : date.toLocaleDateString([], { month: "short", day: "numeric" }),
      allowed: 0,
      blocked: 0,
      approval: 0,
    };
  });

  events.forEach(event => {
    const timestamp = new Date(event.createdAt).getTime();
    if (!Number.isFinite(timestamp) || timestamp < start || timestamp > now)
      return;
    const index = Math.min(count - 1, Math.floor((timestamp - start) / step));
    buckets[index][event.status] += 1;
  });
  return buckets;
}

function EmptyPanel({
  state,
  compact = false,
}: {
  state: FeedState;
  compact?: boolean;
}) {
  const Icon = state === "error" ? AlertTriangle : state === "unauthorized" ? LockKeyhole : Unplug;
  return (
    <div className={`sh-empty ${compact ? "is-compact" : ""}`}>
      <Icon size={compact ? 15 : 20} />
      <span>{stateMessage(state)}</span>
    </div>
  );
}

export default function SovereignHaltDashboard({
  accessToken,
  userEmail,
  onSignOut,
}: {
  accessToken: string;
  userEmail: string;
  onSignOut: () => void;
}) {
  const configured = Boolean(isSupabaseConfigured && supabase);
  const [feedState, setFeedState] = useState<FeedState>(
    configured ? "connecting" : "unconfigured"
  );
  const [agents, setAgents] = useState<AgentRecord[]>(EMPTY_AGENTS);
  const [events, setEvents] = useState<EventRecord[]>(EMPTY_EVENTS);
  const [workspaceName, setWorkspaceName] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [range, setRange] = useState<TimeRange>("24h");
  const [running, setRunning] = useState(true);
  const [selectedId, setSelectedId] = useState("");
  const [isolatedId, setIsolatedId] = useState<string | null>(null);
  const [cameraKey, setCameraKey] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const sessionStart = useRef(Date.now());
  const firstLoad = useRef(true);

  useEffect(() => {
    const timer = window.setInterval(
      () => setElapsed(Date.now() - sessionStart.current),
      1000
    );
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!configured || !supabase) {
      setAgents([]);
      setEvents([]);
      setWorkspaceName(null);
      setFeedState("unconfigured");
      setLastUpdated(null);
      return;
    }

    let active = true;
    const failClosed = (state: FeedState, name: string | null = null) => {
      if (!active) return;
      setAgents([]);
      setEvents([]);
      setWorkspaceName(name);
      setFeedState(state);
    };

    const loadTelemetry = async () => {
      if (firstLoad.current) setFeedState("connecting");
      try {
        const response = await fetch("/api/telemetry/dashboard", {
          method: "GET",
          cache: "no-store",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
        });
        if (!active) return;
        if (response.status === 401 || response.status === 403) {
          failClosed("unauthorized");
          firstLoad.current = false;
          setLastUpdated(new Date());
          return;
        }
        if (response.status === 503) {
          failClosed("unconfigured");
          firstLoad.current = false;
          setLastUpdated(new Date());
          return;
        }
        if (!response.ok) throw new Error("Private telemetry request failed");

        const payload = (await response.json()) as {
          workspace?: { name?: unknown } | null;
          agents?: unknown;
          events?: unknown;
        };
        if (!Array.isArray(payload.agents) || !Array.isArray(payload.events))
          throw new Error("Private telemetry response is invalid");

        const nextAgents = (payload.agents as Record<string, unknown>[])
          .flatMap(row => {
            const id = String(row.id ?? "").trim();
            const name = String(row.name ?? "").trim();
            if (!id || !name) return [];
            return [
              {
                id,
                name,
                description: String(row.description ?? ""),
                risk: String(row.risk_level ?? ""),
                agentClass: String(row.agent_class ?? ""),
              },
            ];
          });
        const agentNames = new Map(nextAgents.map(agent => [agent.id, agent.name]));
        const nextEvents = (payload.events as Record<string, unknown>[])
          .flatMap(row => {
            const result = decision(row.outcome);
            if (!result) return [];
            const agentId = String(row.agent_id ?? "");
            const agentName = String(row.agent_name ?? "");
            const action = String(row.action ?? "").trim();
            const createdAt = String(row.created_at ?? "");
            const signal = String(row.signal ?? "");
            if (
              !agentId ||
              !agentName ||
              agentName !== agentNames.get(agentId) ||
              !["guard_allowed", "loop_detected", "max_iterations_exceeded", "budget_exceeded", "policy_blocked", "approval_required"].includes(signal) ||
              !action ||
              !createdAt
            ) return [];
            return [
              {
                id: String(row.id ?? `${agentId}-${createdAt}`),
                agentId,
                agentName,
                action,
                detail: String(row.detail ?? ""),
                status: result,
                risk: String(row.risk_level ?? ""),
                signal,
                createdAt,
              },
            ];
          });

        if (!active) return;
        setAgents(nextAgents);
        setEvents(nextEvents);
        const name = payload.workspace?.name;
        setWorkspaceName(typeof name === "string" ? name : "SOVEREIGNHALT PRIVATE FEED");
        setFeedState(
          nextAgents.length || nextEvents.length ? "live" : "empty"
        );
        setLastUpdated(new Date());
        firstLoad.current = false;
      } catch {
        failClosed("error");
        firstLoad.current = false;
      }
    };

    void loadTelemetry();
    const refresh = window.setInterval(() => void loadTelemetry(), 15_000);
    return () => {
      active = false;
      window.clearInterval(refresh);
    };
  }, [configured, accessToken]);

  useEffect(() => {
    if (!agents.some(agent => agent.id === selectedId))
      setSelectedId(agents[0]?.id ?? "");
  }, [agents, selectedId]);

  const connected = isConnected(feedState);
  const now = Date.now();
  const visibleEvents = useMemo(() => {
    const start = rangeStart(range, now);
    return events.filter(event => {
      const timestamp = new Date(event.createdAt).getTime();
      return Number.isFinite(timestamp) && timestamp >= start && timestamp <= now;
    });
  }, [events, range, now]);
  const buckets = useMemo(
    () => buildBuckets(visibleEvents, range, now),
    [visibleEvents, range, now]
  );
  const selectedAgent = agents.find(agent => agent.id === selectedId) ?? null;
  const loopEvents = visibleEvents.filter(isLoopSignal);
  const loopAgentIds = new Set(
    agents
      .filter(agent => agentHealth(agent, events) === "Loop Detected")
      .map(agent => agent.id)
  );
  const blockedCount = visibleEvents.filter(event => event.status === "blocked").length;
  const blockRate = visibleEvents.length
    ? `${Math.round((blockedCount / visibleEvents.length) * 100)}%`
    : connected
      ? "0%"
      : "—";
  const maxBucket = Math.max(
    0,
    ...buckets.map(bucket => bucket.allowed + bucket.blocked + bucket.approval)
  );

  const exportLog = () => {
    if (!connected) return;
    const report = {
      generatedAt: new Date().toISOString(),
      source: "allowlisted private telemetry API",
      workspace: workspaceName,
      selectedWindow: range,
      records: {
        agents: agents.map(agent => ({
          id: agent.id,
          name: agent.name,
          status: agentHealth(agent, events),
          risk: agent.risk || null,
        })),
        events: visibleEvents,
      },
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(report, null, 2)], { type: "application/json" })
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `sovereignhalt-log-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const toggleIsolation = () => {
    if (!selectedAgent) return;
    setIsolatedId(current => (current === selectedAgent.id ? null : selectedAgent.id));
  };

  const recalibrate = () => {
    setCameraKey(key => key + 1);
    setSelectedId(agents[0]?.id ?? "");
    setIsolatedId(null);
    setRunning(true);
  };

  return (
    <main className="sh-app">
      <header className="sh-header">
        <div className="sh-brand-lockup">
          <span className="sh-chip-mark" aria-hidden="true">
            <Cpu size={22} strokeWidth={1.8} />
          </span>
          <div className="sh-brand-copy">
            <strong>SOVEREIGNHALT</strong>
            <small>RUNTIME OBSERVABILITY / CONTROL SURFACE</small>
          </div>
        </div>

        <div className="sh-header-meta">
          <span
            className={`sh-live-state ${connected ? "is-connected" : `is-${feedState}`}`}
            title={stateMessage(feedState)}
          >
            <i /> {stateLabel(feedState)}
          </span>
          <span className="sh-meta-separator" />
          <span className="sh-session-clock">
            <Clock3 size={13} />
            <span>
              <small>SESSION</small>
              <strong>{timeSince(elapsed)}</strong>
            </span>
          </span>
          <span className="sh-security-badge">
            <LockKeyhole size={12} />
            <span>SEC LEVEL</span>
            <b>{connected ? "WORKSPACE / RO" : "UNBOUND"}</b>
          </span>
          <span className="sh-auth-user" title={userEmail}>
            <LockKeyhole size={12} /> <span>{userEmail}</span>
          </span>
          <button className="sh-signout-button" onClick={onSignOut} title="Sign out of the private console">
            <LogOut size={12} /> SIGN OUT
          </button>
        </div>
      </header>

      <div className="sh-source-line" aria-live="polite">
        <span className="sh-source-name">
          <Database size={12} />
          {workspaceName ?? "SOVEREIGNHALT PRIVATE FEED"}
        </span>
        <span>{stateMessage(feedState)}</span>
        <span className="sh-refresh-time">
          {lastUpdated ? `SYNC ${formatTime(lastUpdated.toISOString())}` : "AWAITING SOURCE"}
        </span>
      </div>

      <section className="sh-dashboard-grid" aria-label="SovereignHalt runtime dashboard">
        <aside className="sh-rail sh-left-rail">
          <section className="sh-panel sh-agents-panel">
            <div className="sh-panel-heading">
              <div>
                <span className="sh-kicker"><Cpu size={12} /> FLEET TELEMETRY</span>
                <h2>Agent Status</h2>
              </div>
              <span className="sh-record-count">{connected ? agents.length : "—"}</span>
            </div>
            <div className="sh-agent-list">
              {agents.map(agent => {
                const health = agentHealth(agent, events);
                return (
                  <button
                    key={agent.id}
                    className={`sh-agent-row ${selectedId === agent.id ? "is-selected" : ""}`}
                    onClick={() => setSelectedId(agent.id)}
                    aria-pressed={selectedId === agent.id}
                  >
                    <span className={`sh-agent-core ${statusClass(health)}`}>
                      <Cpu size={14} />
                    </span>
                    <span className="sh-agent-identity">
                      <strong>{agent.name}</strong>
                      <small>{agent.agentClass || "WORKSPACE AGENT"}</small>
                    </span>
                    <span className={`sh-health-pill ${statusClass(health)}`}>
                      <i /> {health}
                    </span>
                  </button>
                );
              })}
              {agents.length === 0 && <EmptyPanel state={feedState} compact />}
            </div>
            <div className="sh-panel-footnote">
              <span><Shield size={11} /> SOURCE-RECORDED STATUS</span>
              <span>{connected ? `${agents.length} RECORDS` : "NO SOURCE ROWS"}</span>
            </div>
          </section>

          <section className="sh-panel sh-metrics-panel">
            <div className="sh-panel-heading">
              <div>
                <span className="sh-kicker"><Activity size={12} /> SOURCE-DRIVEN</span>
                <h2>Real-time Metrics</h2>
              </div>
              <span className={`sh-pulse-label ${connected ? "is-on" : ""}`}><i /> 15S</span>
            </div>
            <div className="sh-metric-grid">
              <Metric label="AGENT RECORDS" value={connected ? agents.length : "—"} tone="cyan" />
              <Metric label={`EVENTS / ${range.toUpperCase()}`} value={connected ? visibleEvents.length : "—"} tone="purple" />
              <Metric label="BLOCKED EVENTS" value={connected ? blockedCount : "—"} tone="red" />
              <Metric label="LOOP FLAGS" value={connected ? loopAgentIds.size : "—"} tone="purple" />
            </div>
            <div className="sh-metric-note">SCOPED WORKSPACE · UP TO 250 AUDIT ROWS · 15S REFRESH</div>
          </section>

          <section className="sh-panel sh-activity-panel">
            <div className="sh-panel-heading">
              <div>
                <span className="sh-kicker"><Activity size={12} /> AUDIT EVENTS</span>
                <h2>Agent Activity</h2>
              </div>
              <label className="sh-range-select">
                <span className="sr-only">Activity chart window</span>
                <select value={range} onChange={event => setRange(event.target.value as TimeRange)}>
                  <option value="24h">24H</option>
                  <option value="7d">7D</option>
                  <option value="30d">30D</option>
                </select>
              </label>
            </div>
            {connected && visibleEvents.length > 0 ? (
              <div className="sh-chart" role="img" aria-label={`Workspace event activity for the last ${range}`}>
                <div className="sh-chart-bars">
                  {buckets.map(bucket => {
                    const total = bucket.allowed + bucket.blocked + bucket.approval;
                    const scale = maxBucket ? (total / maxBucket) * 100 : 0;
                    const allowedHeight = total ? (bucket.allowed / total) * scale : 0;
                    const blockedHeight = total ? (bucket.blocked / total) * scale : 0;
                    const approvalHeight = total ? (bucket.approval / total) * scale : 0;
                    return (
                      <div className="sh-chart-column" key={bucket.start}>
                        <span className="sh-chart-total">{total || ""}</span>
                        <div className="sh-chart-track">
                          <i className="is-approval" style={{ height: `${approvalHeight}%` }} />
                          <i className="is-blocked" style={{ height: `${blockedHeight}%` }} />
                          <i className="is-allowed" style={{ height: `${allowedHeight}%` }} />
                        </div>
                        <small>{bucket.label}</small>
                      </div>
                    );
                  })}
                </div>
                <div className="sh-chart-legend">
                  <span><i className="is-allowed" /> ALLOWED</span>
                  <span><i className="is-blocked" /> BLOCKED</span>
                  <span><i className="is-approval" /> REVIEW</span>
                </div>
              </div>
            ) : connected ? (
              <div className="sh-chart-empty">NO EVENTS IN THIS WINDOW</div>
            ) : (
              <EmptyPanel state={feedState} compact />
            )}
          </section>
        </aside>

        <section className="sh-center-column">
          <div className="sh-panel sh-graph-panel">
            <div className="sh-graph-heading">
              <div>
                <span className="sh-kicker"><Activity size={12} /> FORCE-DIRECTED AGENT FIELD</span>
                <h1>HOLOGRAPHIC AGENT CORE</h1>
                <p>{selectedAgent ? `${selectedAgent.name} · ${agents.length} verified agents · ${visibleEvents.length} scoped events` : "Waiting for a verified workspace scope"}</p>
              </div>
              <div className={`sh-network-state ${connected ? "is-on" : ""}`}>
                <i /> {connected ? "OBSERVING" : "UNBOUND"}
              </div>
            </div>
            <div className="sh-canvas-wrap">
              <div className="sh-canvas-grid" />
              <Canvas
                key={cameraKey}
                dpr={[1, 1.6]}
                camera={{ position: [0, 0.12, 6.6], fov: 40 }}
                gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
              >
                <NeuralCoreScene
                  agents={agents.map(agent => ({
                    id: agent.id,
                    name: agent.name,
                    risk: latestAgentEvent(agent, events)?.risk || agent.risk,
                  }))}
                  selectedId={selectedId}
                  running={running}
                  emergencyStopped={false}
                  isolatedAgentId={isolatedId}
                  onSelectAgent={setSelectedId}
                />
              </Canvas>
              {agents.length === 0 && (
                <div className="sh-field-empty" aria-live="polite">
                  <span className="sh-field-empty-mark"><Cpu size={23} /></span>
                  <strong>NO VERIFIED AGENT RECORDS</strong>
                  <small>{connected ? "Waiting for the first real SDK event in this private workspace." : "Sign in and configure private telemetry to reveal authenticated agent records."}</small>
                </div>
              )}
              <div className="sh-canvas-readout sh-readout-top">
                <span><i className={connected ? "is-active" : ""} /> {connected ? "SCOPED WORKSPACE" : "NO LIVE SOURCE"}</span>
                <span>{connected ? `${agents.length} NODES` : "— NODES"}</span>
              </div>
              <div className="sh-canvas-readout sh-readout-bottom">
                <span>FOCUS <b>{selectedAgent?.name ?? "NO AGENT SELECTED"}</b></span>
                <span>{selectedAgent ? agentHealth(selectedAgent, events).toUpperCase() : "AWAITING AGENT RECORDS"}</span>
              </div>
              <div className="sh-graph-disclaimer">ANIMATED LINKS ARE A VISUAL LAYOUT · NOT OBSERVED AGENT TRAFFIC</div>
            </div>
            <div className="sh-graph-foot">
              <span><i className="is-cyan" /> VERIFIED AGENT RECORD</span>
              <span><i className="is-purple" /> VISUAL EDGE</span>
              <span>{running ? "FIELD MOTION ACTIVE" : "FIELD MOTION PAUSED"}</span>
            </div>
          </div>

          <section className="sh-panel sh-selection-panel">
            <span className="sh-kicker"><Cpu size={12} /> SELECTED RECORD</span>
            {selectedAgent ? (
              <div className="sh-selection-content">
                <div>
                  <strong>{selectedAgent.name}</strong>
                  <small>{selectedAgent.description || "No source description provided."}</small>
                </div>
                <span className={`sh-health-pill ${statusClass(agentHealth(selectedAgent, events))}`}>
                  <i /> {agentHealth(selectedAgent, events)}
                </span>
                <span className="sh-source-risk">RISK FIELD <b>{selectedAgent.risk ? titleCase(selectedAgent.risk) : "NOT PROVIDED"}</b></span>
              </div>
            ) : (
              <p className="sh-selection-empty">No verified agent record is available to focus.</p>
            )}
          </section>
        </section>

        <aside className="sh-rail sh-right-rail">
          <section className="sh-panel sh-analytics-panel">
            <div className="sh-panel-heading">
              <div>
                <span className="sh-kicker"><ShieldAlert size={12} /> OBSERVED SIGNALS</span>
                <h2>Analytics &amp; Prediction</h2>
              </div>
              <span className="sh-analytics-mark"><Activity size={14} /></span>
            </div>
            <div className="sh-analytics-pair">
              <div>
                <small>LOOP SIGNALS</small>
                <strong className={loopEvents.length ? "is-alert" : ""}>{connected ? loopEvents.length : "—"}</strong>
                <span>blocked loop-related events</span>
              </div>
              <div>
                <small>BLOCK RATE</small>
                <strong>{connected ? blockRate : "—"}</strong>
                <span>of loaded event records</span>
              </div>
            </div>
            <div className="sh-risk-breakdown">
              <div className="sh-subheading"><span>OBSERVED OUTCOMES</span><small>{connected ? visibleEvents.length : "—"} EVENTS</small></div>
              {([
                ["Allowed", "allowed", "is-allowed"],
                ["Blocked", "blocked", "is-blocked"],
                ["Review", "approval", "is-approval"],
              ] as const).map(([label, key, tone]) => {
                const count = visibleEvents.filter(event => event.status === key).length;
                const ratio = visibleEvents.length ? (count / visibleEvents.length) * 100 : 0;
                return (
                  <div className="sh-outcome-row" key={key}>
                    <span><i className={tone} /> {label}</span>
                    <div className="sh-outcome-track"><i className={tone} style={{ width: connected ? `${ratio}%` : "0%" }} /></div>
                    <b>{connected ? count : "—"}</b>
                  </div>
                );
              })}
            </div>
            <div className="sh-prediction-note">
              <span><Activity size={12} /> FORECAST STATUS</span>
              <strong>NO PREDICTION MODEL CONNECTED</strong>
              <small>No forecast is displayed without a real prediction source.</small>
            </div>
          </section>

          <section className="sh-panel sh-log-panel">
            <div className="sh-panel-heading">
              <div>
                <span className="sh-kicker"><Database size={12} /> WORKSPACE AUDIT FEED</span>
                <h2>System Log</h2>
              </div>
              <span className="sh-log-count">{connected ? visibleEvents.length : "—"}</span>
            </div>
            <div className="sh-log-list">
              {visibleEvents.slice(0, 8).map(event => (
                <article className="sh-log-row" key={event.id}>
                  <span className={`sh-log-marker is-${event.status}`}><i /></span>
                  <div className="sh-log-copy">
                    <div className="sh-log-title-row">
                      <strong>{event.action}</strong>
                      <time>{formatTime(event.createdAt)}</time>
                    </div>
                    <p>{event.agentName || "UNATTRIBUTED EVENT"}{event.detail ? ` · ${event.detail}` : ""}</p>
                    <span className={`sh-event-outcome is-${event.status}`}>{event.status.toUpperCase()}{event.risk ? ` / ${event.risk.toUpperCase()}` : ""}</span>
                  </div>
                </article>
              ))}
              {visibleEvents.length === 0 &&
                (connected ? (
                  <div className="sh-chart-empty">NO AUDIT EVENTS IN THIS WINDOW</div>
                ) : (
                  <EmptyPanel state={feedState} compact />
                ))}
            </div>
            <div className="sh-log-footnote">UP TO 250 LATEST SCOPED RECORDS · LAST 30 DAYS</div>
          </section>
        </aside>
      </section>

      <footer className="sh-operator-bar">
        <div className="sh-operator-note">
          <span><LockKeyhole size={12} /> VISUALIZATION CONTROLS</span>
          <small>LOCAL VIEW ONLY · NO RUNTIME COMMANDS ARE SENT</small>
        </div>
        <div className="sh-operator-actions">
          <button onClick={() => setRunning(value => !value)} title="Pause or resume the visualization; agents keep running">
            {running ? <Pause size={14} /> : <Play size={14} />}{running ? "PAUSE" : "RESUME"}
          </button>
          <button onClick={exportLog} disabled={!connected} title="Export loaded workspace records">
            <ArrowDownToLine size={14} /> EXPORT LOG
          </button>
          <button onClick={toggleIsolation} disabled={!selectedAgent} className={isolatedId ? "is-isolated" : ""} title="Isolate the selected node in this visualization only">
            <Shield size={14} />{isolatedId ? "RECONNECT AGENT" : "ISOLATE AGENT"}
          </button>
          <button onClick={recalibrate} title="Reset graph focus and camera">
            <RefreshCw size={14} /> RECALIBRATE
          </button>
        </div>
        <div className="sh-operator-live">
          <span className={connected ? "is-connected" : ""}><i /> {connected ? "SOURCE VERIFIED" : "SOURCE UNAVAILABLE"}</span>
          <small>{lastUpdated ? `SYNCED ${formatTime(lastUpdated.toISOString())}` : "NO SYNC"}</small>
        </div>
      </footer>
    </main>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone: "cyan" | "purple" | "red";
}) {
  return (
    <div className={`sh-metric-card is-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
