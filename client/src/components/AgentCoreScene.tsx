import { Canvas, useFrame } from "@react-three/fiber";
import { Html, OrbitControls, Stars } from "@react-three/drei";
import { Activity, Bot, Pause, Play, Radar, ShieldAlert } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import * as THREE from "three";

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

function RuntimeCore({ running, emergencyStopped }: { running: boolean; emergencyStopped: boolean }) {
  const core = useRef<THREE.Group>(null!);
  const pulse = useRef<THREE.Mesh>(null!);
  const coreColor = emergencyStopped ? "#ff466b" : "#55efff";
  const orbitColor = emergencyStopped ? "#ff426d" : "#9c6bff";

  useFrame((state, delta) => {
    if (!running) return;
    core.current.rotation.y += delta * 0.24;
    core.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.36) * 0.06;
    const scale = 1 + Math.sin(state.clock.elapsedTime * (emergencyStopped ? 4.1 : 1.8)) * (emergencyStopped ? 0.045 : 0.014);
    pulse.current.scale.setScalar(scale);
  });

  return (
    <>
      <group ref={core}>
        <mesh ref={pulse}>
          <sphereGeometry args={[0.48, 32, 32]} />
          <meshPhysicalMaterial color={coreColor} emissive={coreColor} emissiveIntensity={emergencyStopped ? 1.7 : 0.72} metalness={0.42} roughness={0.16} clearcoat={1} transparent opacity={0.88} />
        </mesh>
        <mesh>
          <icosahedronGeometry args={[0.76, 1]} />
          <meshBasicMaterial color={coreColor} wireframe transparent opacity={0.48} />
        </mesh>
        <mesh rotation={[Math.PI / 2.8, 0.2, 0.4]}>
          <torusGeometry args={[1.12, 0.012, 8, 150]} />
          <meshBasicMaterial color={orbitColor} transparent opacity={0.9} />
        </mesh>
        <mesh rotation={[0.7, 0.9, 1.05]}>
          <torusGeometry args={[1.33, 0.008, 8, 150]} />
          <meshBasicMaterial color={coreColor} transparent opacity={0.54} />
        </mesh>
        <mesh rotation={[0.1, 0.45, Math.PI / 2]}>
          <torusGeometry args={[0.91, 0.006, 8, 150]} />
          <meshBasicMaterial color="#e6b9ff" transparent opacity={0.44} />
        </mesh>
      </group>
      <Html position={[0, -0.12, 0]} center distanceFactor={5.4}>
        <div className={`cp-core-stamp ${emergencyStopped ? "is-alert" : ""}`}>
          <span>RUNTIME</span>
          <strong>AB<span>/</span>01</strong>
        </div>
      </Html>
    </>
  );
}

function AgentNode({ agent, index, selected, running, emergencyStopped, onSelect }: {
  agent: AgentSignal;
  index: number;
  selected: boolean;
  running: boolean;
  emergencyStopped: boolean;
  onSelect: (id: string) => void;
}) {
  const node = useRef<THREE.Group>(null!);
  const phase = useRef((index / Math.max(1, 3)) * Math.PI * 2);
  const color = nodePalette[index % nodePalette.length];
  const radius = 2.18 + (index % 2) * 0.13;
  const speed = index % 2 === 0 ? 0.23 : -0.19;

  useFrame((_state, delta) => {
    if (!running) return;
    phase.current += delta * speed;
    const angle = phase.current;
    node.current.position.set(Math.cos(angle) * radius, Math.sin(angle * 1.7 + index) * 0.34, Math.sin(angle) * 1.16);
    node.current.rotation.y += delta * 0.42;
  });

  return (
    <group ref={node}>
      <mesh onClick={(event) => { event.stopPropagation(); onSelect(agent.id); }}>
        <sphereGeometry args={[selected ? 0.19 : 0.14, 24, 24]} />
        <meshStandardMaterial color={emergencyStopped ? "#ff466b" : color} emissive={emergencyStopped ? "#ff244e" : color} emissiveIntensity={selected ? 2.5 : 1.25} metalness={0.25} roughness={0.22} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} onClick={(event) => { event.stopPropagation(); onSelect(agent.id); }}>
        <torusGeometry args={[selected ? 0.27 : 0.22, 0.008, 8, 40]} />
        <meshBasicMaterial color={emergencyStopped ? "#ff466b" : color} transparent opacity={selected ? 0.95 : 0.56} />
      </mesh>
      <Html position={[0, 0.37, 0]} center distanceFactor={7.6}>
        <button className={`cp-node-label ${selected ? "is-selected" : ""} ${emergencyStopped ? "is-alert" : ""}`} onClick={(event) => { event.stopPropagation(); onSelect(agent.id); }}>
          <span className="cp-node-dot" />{agent.name}
        </button>
      </Html>
    </group>
  );
}

export default function AgentCoreScene({ agents, emergencyStopped, onAgentSelect }: AgentCoreSceneProps) {
  const [selectedId, setSelectedId] = useState(agents[0]?.id ?? "");
  const [running, setRunning] = useState(true);
  const selected = agents.find((agent) => agent.id === selectedId) ?? agents[0];

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) setRunning(false);
  }, []);

  const selectAgent = (id: string) => {
    setSelectedId(id);
  };

  return (
    <section className="panel cp-scene-panel" aria-label="Live 3D agent runtime topology">
      <div className="panel-header cp-scene-header">
        <div>
          <div className="panel-kicker"><Radar size={13} /> Runtime topology <span className={`cp-live-tag ${emergencyStopped ? "is-halted" : !running ? "is-paused" : ""}`}><span className="live-dot" /> {emergencyStopped ? "HALTED" : running ? "LIVE" : "SIM PAUSED"}</span></div>
          <h2>Agent mesh <span className="cp-scene-subtitle">/ dispatch boundary</span></h2>
        </div>
        <div className="cp-scene-header-actions">
          <span className="cp-scene-count"><span className="cp-signal-bars"><i /><i /><i /></span> {agents.length} NODES</span>
          <button className="cp-motion-button" onClick={() => setRunning((current) => !current)} aria-label={running ? "Pause 3D scene motion" : "Resume 3D scene motion"}>
            {running ? <Pause size={13} /> : <Play size={13} />}{running ? "Pause sim" : "Resume sim"}
          </button>
        </div>
      </div>
      <div className={`cp-scene-stage ${emergencyStopped ? "is-alert" : ""}`}>
        <div className="cp-stage-coordinate cp-stage-coordinate-top"><span>SYS / 03</span><span>SECURE CHANNEL <i /></span></div>
        <Canvas dpr={[1, 1.7]} camera={{ position: [0, 1.15, 7.5], fov: 37 }} gl={{ antialias: true, alpha: true }}>
          <color attach="background" args={["#05060b"]} />
          <ambientLight intensity={0.48} />
          <pointLight position={[0, 1.8, 2.2]} color={emergencyStopped ? "#ff325f" : "#5cecff"} intensity={18} distance={8} />
          <pointLight position={[-3, -1, -2]} color="#a96aff" intensity={12} distance={8} />
          <Stars radius={14} depth={9} count={520} factor={2.2} saturation={0.45} fade speed={running ? 0.28 : 0} />
          <gridHelper args={[8, 24, "#173b56", "#101b2b"]} position={[0, -1.7, 0]} />
          <RuntimeCore running={running} emergencyStopped={emergencyStopped} />
          {agents.slice(0, 4).map((agent, index) => (
            <AgentNode key={agent.id} agent={agent} index={index} selected={selected?.id === agent.id} running={running} emergencyStopped={emergencyStopped} onSelect={selectAgent} />
          ))}
          <OrbitControls enablePan={false} enableZoom={false} enableDamping dampingFactor={0.07} autoRotate={running} autoRotateSpeed={0.18} minPolarAngle={Math.PI * 0.28} maxPolarAngle={Math.PI * 0.68} />
        </Canvas>
        <div className="cp-scene-overlay cp-scene-overlay-left" aria-hidden="true">
          <span className="cp-readout-label">ENFORCEMENT</span>
          <strong className={emergencyStopped ? "is-alert-text" : ""}>{emergencyStopped ? "PAUSED" : "PRE-DISPATCH"}</strong>
          <small>{emergencyStopped ? "ALL NODES FROZEN" : "POLICY ENGINE · 0.11 SEC"}</small>
        </div>
        <div className="cp-scene-overlay cp-scene-overlay-right" aria-hidden="true">
          <span className="cp-readout-label">THREAT INDEX</span>
          <strong>{emergencyStopped ? "LOCK" : "LOW"}</strong>
          <small><ShieldAlert size={11} /> BOUNDARY SECURE</small>
        </div>
        <div className="cp-stage-coordinate cp-stage-coordinate-bottom"><span>AGENTBREAKER // CONTROL PLANE</span><span>DRAG TO ORBIT</span></div>
      </div>
      <div className="cp-scene-footer">
        <div className="cp-selected-agent">
          <span className="cp-selected-agent-icon"><Bot size={15} /></span>
          <div><small>FOCUSED NODE</small><strong>{selected?.name ?? "No agent selected"}</strong></div>
          <span className={`cp-status-pill ${emergencyStopped ? "is-alert" : ""}`}><Activity size={11} /> {emergencyStopped ? "HALTED" : selected?.status ?? "READY"}</span>
        </div>
        <div className="cp-agent-chips" aria-label="Select an agent node">
          {agents.slice(0, 4).map((agent, index) => (
            <button key={agent.id} className={`cp-agent-chip ${selected?.id === agent.id ? "is-selected" : ""}`} onClick={() => selectAgent(agent.id)} title={`Focus ${agent.name}`}>
              <span style={{ "--node-color": nodePalette[index % nodePalette.length] } as CSSProperties} />{agent.name.replace(" Agent", "")}
            </button>
          ))}
        </div>
        <button className="cp-open-profile" onClick={() => selected && onAgentSelect(selected.id)}>Open profile <span>↗</span></button>
      </div>
    </section>
  );
}
