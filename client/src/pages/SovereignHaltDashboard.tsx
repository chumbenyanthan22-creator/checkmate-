import { useEffect, useMemo, useRef, useState } from "react";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import AgentBreakerControlRoom, { type ControlRoomAgent } from "../components/AgentBreakerControlRoom";
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

  const controlAgents: ControlRoomAgent[] = agents.map(agent => ({
    ...agent,
    health: agentHealth(agent, events),
    latestEvent: latestAgentEvent(agent, events),
  }));
  const focusedAgent = controlAgents.find(agent => agent.id === selectedId) ?? null;
  const reviewCount = visibleEvents.filter(event => event.status === "approval").length;

  return (
    <AgentBreakerControlRoom
      feedState={feedState}
      connected={connected}
      sourceMessage={stateMessage(feedState)}
      workspaceName={workspaceName}
      userEmail={userEmail}
      lastUpdated={lastUpdated}
      elapsed={elapsed}
      agents={controlAgents}
      visibleEvents={visibleEvents}
      selectedId={selectedId}
      selectedAgent={focusedAgent}
      loopEventCount={loopEvents.length}
      loopAgentCount={loopAgentIds.size}
      blockedCount={blockedCount}
      reviewCount={reviewCount}
      blockRate={blockRate}
      buckets={buckets}
      maxBucket={maxBucket}
      range={range}
      running={running}
      isolatedId={isolatedId}
      cameraKey={cameraKey}
      onSelectAgent={setSelectedId}
      onRangeChange={setRange}
      onToggleRunning={() => setRunning(value => !value)}
      onExportLog={exportLog}
      onToggleIsolation={toggleIsolation}
      onRecalibrate={recalibrate}
      onSignOut={onSignOut}
    />
  );
}
