import { Canvas } from "@react-three/fiber";
import { Activity, Bot, ChevronRight, Download, Network, Pause, Play, Radio, RefreshCw, ShieldAlert } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";
import HolographicChessboard from "./HolographicChessboard";

type AgentSignal = {
  id: string;
  name: string;
  status: string;
  risk: string;
};

type AgentCoreSceneProps = {
  agents: AgentSignal[];
  emergencyStopped: boolean;
  onAgentSelect: (id: string) => void;
};

const nodePalette = ["#56efff", "#b36bff", "#ff526f", "#8c7bff"];
const networkPoints: [number, number][] = [[28, 64], [100, 24], [174, 68], [249, 28], [326, 65], [400, 33]];
const networkEdges: [number, number][] = [[0, 1], [0, 2], [1, 2], [1, 3], [2, 3], [2, 4], [3, 4], [3, 5], [4, 5]];

function AgentActivityTrace() {
  return (
    <svg className="cp-mini-chart" viewBox="0 0 220 54" role="img" aria-label="Agent activity trend rising over the last five minutes">
      <defs><linearGradient id="cpTraceFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#5cecff" stopOpacity="0.28" /><stop offset="1" stopColor="#5cecff" stopOpacity="0" /></linearGradient></defs>
      <path d="M0 45 L16 38 L31 42 L47 22 L62 30 L78 25 L93 36 L109 15 L125 25 L140 20 L156 29 L171 9 L187 18 L203 5 L220 11 L220 54 L0 54 Z" fill="url(#cpTraceFill)" />
      <path d="M0 45 L16 38 L31 42 L47 22 L62 30 L78 25 L93 36 L109 15 L125 25 L140 20 L156 29 L171 9 L187 18 L203 5 L220 11" fill="none" stroke="#59eaff" strokeWidth="1.8" vectorEffect="non-scaling-stroke" />
      <circle cx="203" cy="5" r="3" fill="#bd74ff" />
    </svg>
  );
}

function PredictionChart() {
  return (
    <svg className="cp-prediction-chart" viewBox="0 0 220 78" role="img" aria-label="Runtime prediction trend">
      <defs><linearGradient id="cpPredictionFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#b36bff" stopOpacity="0.38" /><stop offset="1" stopColor="#b36bff" stopOpacity="0" /></linearGradient></defs>
      {[18, 38, 58].map((y) => <line key={y} x1="0" y1={y} x2="220" y2={y} stroke="rgba(127,151,183,.14)" strokeWidth="1" />)}
      <path d="M0 65 L18 57 L35 62 L52 42 L69 49 L86 35 L103 43 L120 18 L137 34 L154 28 L171 41 L188 14 L204 23 L220 8 L220 78 L0 78 Z" fill="url(#cpPredictionFill)" />
      <path d="M0 65 L18 57 L35 62 L52 42 L69 49 L86 35 L103 43 L120 18 L137 34 L154 28 L171 41 L188 14 L204 23 L220 8" fill="none" stroke="#c47cff" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      <circle cx="220" cy="8" r="3" fill="#5cecff" />
    </svg>
  );
}

function AgentNetworkMap({ agents, selectedId, onSelect }: { agents: AgentSignal[]; selectedId: string; onSelect: (id: string) => void }) {
  const visibleAgents = agents.slice(0, networkPoints.length);
  return (
    <section className="cp-hud-module cp-network-module">
      <div className="cp-module-head"><span><Network size={12} /> ATTACK VECTOR VISUALIZATION</span><span className="cp-module-index">ROUTE MAP · {visibleAgents.length} NODES</span></div>
      <div className="cp-network-map">
        <svg viewBox="0 0 428 92" role="group" aria-label="Interactive agent network map">
          <defs><linearGradient id="cpNetworkLine" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#5cecff" /><stop offset="1" stopColor="#b36bff" /></linearGradient></defs>
          {networkEdges.filter(([from, to]) => from < visibleAgents.length && to < visibleAgents.length).map(([from, to], index) => {
            const [x1, y1] = networkPoints[from];
            const [x2, y2] = networkPoints[to];
            return <line key={`${from}-${to}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke="url(#cpNetworkLine)" strokeWidth={index % 3 === 0 ? "1.5" : "1"} strokeOpacity={index % 2 === 0 ? "0.7" : "0.35"} strokeDasharray={index % 3 === 1 ? "4 4" : undefined} />;
          })}
          {visibleAgents.map((agent, index) => {
            const [cx, cy] = networkPoints[index];
            const color = nodePalette[index % nodePalette.length];
            const isSelected = agent.id === selectedId;
            return (
              <g key={agent.id} role="button" tabIndex={0} aria-label={`Focus ${agent.name} on the network map`} onClick={() => onSelect(agent.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(agent.id); } }} className="cp-network-node">
                <circle cx={cx} cy={cy} r={isSelected ? 13 : 10} fill="#080c17" stroke={color} strokeWidth={isSelected ? 2 : 1.4} />
                <circle cx={cx} cy={cy} r={isSelected ? 5 : 3.5} fill={color} />
                <circle cx={cx} cy={cy} r={isSelected ? 17 : 14} fill="none" stroke={color} strokeOpacity="0.28" />
                <text x={cx} y={cy + 27} textAnchor="middle" fill={isSelected ? "#dffaff" : "#71849f"}>{agent.name.replace(" Agent", "").split(" ")[0].toUpperCase()}</text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="cp-network-legend"><span><i className="cp-cyan-dot" /> TRUSTED ROUTE</span><span><i className="cp-purple-dot" /> POLICY BOUNDARY</span><span>CLICK NODE TO FOCUS</span></div>
    </section>
  );
}

export default function AgentCoreScene({ agents, emergencyStopped, onAgentSelect }: AgentCoreSceneProps) {
  const [selectedId, setSelectedId] = useState(agents[0]?.id ?? "");
  const [running, setRunning] = useState(true);
  const [isolatedAgentId, setIsolatedAgentId] = useState<string | null>(null);
  const [cameraKey, setCameraKey] = useState(0);
  const selected = agents.find((agent) => agent.id === selectedId) ?? agents[0];
  const risk = selected?.risk ?? "Low";
  const riskKey = risk.toLowerCase();
  const riskScore = riskKey.includes("critical") ? 94 : riskKey.includes("high") ? 78 : riskKey.includes("medium") ? 48 : 19;
  const isolated = Boolean(selected && isolatedAgentId === selected.id);
  const stateLabel = emergencyStopped ? "LOCKDOWN" : isolated ? "ISOLATED" : running ? "LIVE · ACTIVE" : "SIM · PAUSED";

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) setRunning(false);
  }, []);

  const focusAgent = (id: string) => setSelectedId(id);
  const openProfile = () => { if (selected) onAgentSelect(selected.id); };

  const exportLog = () => {
    const report = {
      generatedAt: new Date().toISOString(),
      product: "AgentBreaker Runtime Control Plane",
      mode: emergencyStopped ? "emergency-stopped" : isolated ? "agent-isolated" : running ? "active" : "paused",
      focus: selected ? { id: selected.id, name: selected.name, status: selected.status, risk: selected.risk } : null,
      agents: agents.map(({ id, name, status, risk: agentRisk }) => ({ id, name, status, risk: agentRisk })),
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
  };

  const toggleIsolation = () => {
    if (!selected) return;
    setIsolatedAgentId((current) => current === selected.id ? null : selected.id);
  };

  return (
    <section className="panel cp-control-deck" aria-label="AgentBreaker holographic runtime control deck">
      <header className="cp-console-topbar">
        <div className="cp-console-brand">
          <div className="cp-console-brand-mark"><span>AB</span><i /></div>
          <div className="cp-console-title"><strong>AGENTBREAKER <span>// CHESS ENGINE</span></strong><small>AI RUNTIME CONTROL PLANE</small></div>
        </div>
        <div className="cp-console-statuses">
          <span className={`cp-console-pill ${emergencyStopped ? "is-danger" : running ? "is-live" : "is-paused"}`}><i />{stateLabel}</span>
          <span className="cp-console-pill cp-session-pill"><Radio size={11} /> SESSION · 00:14:32</span>
          <span className={`cp-console-pill cp-security-pill ${riskKey.includes("critical") || emergencyStopped ? "is-danger" : ""}`}><ShieldAlert size={11} /> SEC LEVEL · {emergencyStopped ? "LOCKDOWN" : risk.toUpperCase()}</span>
        </div>
      </header>

      <div className="cp-console-grid">
        <aside className="cp-console-rail cp-left-rail">
          <section className="cp-hud-module cp-agent-module">
            <div className="cp-module-head"><span>AGENT STATUS</span><span className="cp-module-index">01 / FOCUS</span></div>
            <div className="cp-agent-focus">
              <span className="cp-agent-avatar"><Bot size={17} /></span>
              <div><small>FOCUSED NODE</small><strong>{selected?.name ?? "No agent selected"}</strong></div>
            </div>
            <div className="cp-status-row"><span className={`cp-status-pill ${emergencyStopped ? "is-danger" : isolated ? "is-isolated" : ""}`}><i />{emergencyStopped ? "HALTED" : isolated ? "ISOLATED" : selected?.status ?? "READY"}</span><span className={`cp-risk-pill risk-${riskKey.replace(/\s+/g, "-")}`}>{risk.toUpperCase()} RISK</span></div>
            <div className="cp-target-box"><small>RUNTIME BOUNDARY</small><strong>{emergencyStopped ? "EXECUTION FROZEN" : "PRE-DISPATCH GUARD"}</strong><span>{isolated ? "Node isolated from the demo mesh" : "Tool calls remain inside policy"}</span></div>
            <div className="cp-progress-heading"><span>RISK EXPOSURE</span><strong>{emergencyStopped ? "0%" : `${riskScore}%`}</strong></div>
            <div className="cp-risk-meter"><span style={{ width: `${emergencyStopped ? 0 : riskScore}%`, "--meter-color": riskScore >= 78 ? "#ff526f" : riskScore >= 48 ? "#b36bff" : "#56efff" } as CSSProperties} /></div>
            <button className="cp-profile-link" onClick={openProfile}>OPEN AGENT PROFILE <ChevronRight size={12} /></button>
          </section>

          <section className="cp-hud-module cp-metrics-module">
            <div className="cp-module-head"><span>REAL-TIME METRICS</span><span className="cp-module-index">SIM STREAM</span></div>
            <div className="cp-metric-grid">
              <div><small>LATENCY</small><strong>12<span>ms</span></strong></div>
              <div><small>NODE EVAL</small><strong>4.7<span>/ms</span></strong></div>
              <div><small>ACTIVE NODES</small><strong>{emergencyStopped ? "0" : agents.length}<span> / {agents.length}</span></strong></div>
            </div>
            <div className="cp-module-subhead"><span>AGENT ACTIVITY</span><small>LAST 5 MIN</small></div>
            <AgentActivityTrace />
            <div className="cp-chart-scale"><span>-5m</span><span>-3m</span><span>-1m</span><span>NOW</span></div>
          </section>
        </aside>

        <main className="cp-board-column">
          <section className={`cp-board-stage ${emergencyStopped ? "is-alert" : ""}`} aria-label="Interactive 3D holographic chessboard">
            <div className="cp-board-coordinate cp-board-coordinate-top"><span>LIVE RUNTIME MESH</span><span>SECURE CHANNEL <i /></span></div>
            <Canvas key={cameraKey} dpr={[1, 1.7]} camera={{ position: [0, 7.5, 9.4], fov: 42 }} gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}>
              <HolographicChessboard agents={agents} selectedId={selected?.id ?? ""} running={running} emergencyStopped={emergencyStopped} isolatedAgentId={isolatedAgentId} onSelectAgent={focusAgent} />
            </Canvas>
            <div className="cp-board-callout cp-board-callout-left" aria-hidden="true"><span>ENGINE STATE</span><strong className={emergencyStopped ? "is-danger-text" : ""}>{emergencyStopped ? "STOPPED" : isolated ? "ISOLATED" : "BOUNDED"}</strong><small>{emergencyStopped ? "ALL AGENTS FROZEN" : "POLICY GATE · ACTIVE"}</small></div>
            <div className="cp-board-callout cp-board-callout-right" aria-hidden="true"><span>MOVE CONFIDENCE</span><strong>{Math.max(0, 100 - riskScore)}%</strong><small><i /> ROUTE VERIFIED</small></div>
            <div className="cp-board-coordinate cp-board-coordinate-bottom"><span>AGENTBREAKER // OPERATOR VIEW</span><span>DRAG TO ORBIT</span></div>
          </section>
          <AgentNetworkMap agents={agents} selectedId={selected?.id ?? ""} onSelect={focusAgent} />
        </main>

        <aside className="cp-console-rail cp-right-rail">
          <section className="cp-hud-module cp-analytics-module">
            <div className="cp-module-head"><span>ANALYTICS &amp; PREDICTION</span><span className="cp-module-index">LIVE</span></div>
            <PredictionChart />
            <div className="cp-prediction-score"><div><small>ROUTE EFFICIENCY</small><strong>{Math.max(0, 100 - Math.round(riskScore * 0.14))}.3%</strong></div><span className="cp-score-ring">{Math.max(0, 100 - riskScore)}<small>%</small></span></div>
            <div className="cp-module-subhead"><span>MOVE PREDICTION CONFIDENCE</span><small>TOP 3</small></div>
            <div className="cp-confidence-list">
              {[{ label: "ALLOW", value: 91, color: "cyan" }, { label: "REVIEW", value: 74, color: "purple" }, { label: "BLOCK", value: 52, color: "red" }].map((item) => <div className="cp-confidence-row" key={item.label}><span>{item.label}</span><div><i className={`bar-${item.color}`} style={{ width: `${emergencyStopped && item.label !== "BLOCK" ? 0 : item.value}%` }} /></div><strong>{emergencyStopped && item.label !== "BLOCK" ? 0 : item.value}%</strong></div>)}
            </div>
          </section>

          <section className="cp-hud-module cp-system-module">
            <div className="cp-module-head"><span>SYSTEM LOG</span><span className="cp-module-index">3 EVENTS</span></div>
            <ul className="cp-system-log">
              <li><span className={emergencyStopped ? "log-red" : "log-cyan"} />{emergencyStopped ? "emergency_stop · engaged" : "policy_engine · boundaries synced"}</li>
              <li><span className="log-purple" />{isolated ? "agent_isolation · local mesh" : `${agents.length} agent nodes · synchronized`}</li>
              <li><span className={running ? "log-cyan" : "log-purple"} />{running ? "runtime_stream · nominal" : "scene_simulation · paused"}</li>
            </ul>
          </section>
        </aside>
      </div>

      <footer className="cp-operator-bar">
        <div className="cp-operator-actions">
          <button className={`cp-operator-button ${running ? "" : "is-selected"}`} onClick={() => setRunning((current) => !current)} aria-label={running ? "Pause the scene" : "Resume the scene"}>{running ? <Pause size={12} /> : <Play size={12} />}{running ? "PAUSE" : "RESUME"}</button>
          <button className="cp-operator-button" onClick={exportLog}><Download size={12} /> EXPORT LOG</button>
          <button className={`cp-operator-button ${isolated ? "is-selected is-isolated" : ""}`} onClick={toggleIsolation} disabled={!selected}><ShieldAlert size={12} />{isolated ? "RELEASE NODE" : "ISOLATE AGENT"}</button>
          <button className="cp-operator-button" onClick={recalibrate}><RefreshCw size={12} /> RECALIBRATE</button>
        </div>
        <div className="cp-render-readout"><span>RENDER · THREE.JS / WEBGL</span><span>PIECES · 26</span><span className={emergencyStopped ? "is-danger-text" : ""}>{emergencyStopped ? "CONTROL · LOCKED" : "CONTROL · ACTIVE"}</span></div>
      </footer>
    </section>
  );
}
