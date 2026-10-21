import { OrbitControls, Stars } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

type AgentSignal = { id: string; name: string };
type PieceKind = "pawn" | "rook" | "knight" | "bishop" | "queen" | "king";
type Team = "cyan" | "violet";

type HolographicChessboardProps = {
  agents: AgentSignal[];
  selectedId: string;
  running: boolean;
  emergencyStopped: boolean;
  isolatedAgentId: string | null;
  onSelectAgent: (id: string) => void;
};

const pieceProfiles: Record<PieceKind, THREE.Vector2[]> = {
  pawn: [new THREE.Vector2(0, 0.025), new THREE.Vector2(0.17, 0.025), new THREE.Vector2(0.19, 0.075), new THREE.Vector2(0.12, 0.13), new THREE.Vector2(0.075, 0.24), new THREE.Vector2(0.13, 0.3), new THREE.Vector2(0.11, 0.36), new THREE.Vector2(0.055, 0.42), new THREE.Vector2(0, 0.43)],
  rook: [new THREE.Vector2(0, 0.025), new THREE.Vector2(0.18, 0.025), new THREE.Vector2(0.2, 0.08), new THREE.Vector2(0.12, 0.14), new THREE.Vector2(0.15, 0.31), new THREE.Vector2(0.18, 0.42), new THREE.Vector2(0.19, 0.49), new THREE.Vector2(0.22, 0.51), new THREE.Vector2(0.21, 0.57), new THREE.Vector2(0, 0.57)],
  knight: [new THREE.Vector2(0, 0.025), new THREE.Vector2(0.17, 0.025), new THREE.Vector2(0.19, 0.08), new THREE.Vector2(0.12, 0.14), new THREE.Vector2(0.1, 0.29), new THREE.Vector2(0.2, 0.34), new THREE.Vector2(0.17, 0.43), new THREE.Vector2(0.075, 0.5), new THREE.Vector2(0, 0.51)],
  bishop: [new THREE.Vector2(0, 0.025), new THREE.Vector2(0.18, 0.025), new THREE.Vector2(0.2, 0.08), new THREE.Vector2(0.12, 0.14), new THREE.Vector2(0.16, 0.26), new THREE.Vector2(0.11, 0.38), new THREE.Vector2(0.075, 0.51), new THREE.Vector2(0.035, 0.59), new THREE.Vector2(0, 0.6)],
  queen: [new THREE.Vector2(0, 0.025), new THREE.Vector2(0.2, 0.025), new THREE.Vector2(0.22, 0.08), new THREE.Vector2(0.13, 0.15), new THREE.Vector2(0.18, 0.29), new THREE.Vector2(0.14, 0.4), new THREE.Vector2(0.08, 0.54), new THREE.Vector2(0.14, 0.59), new THREE.Vector2(0.11, 0.65), new THREE.Vector2(0, 0.65)],
  king: [new THREE.Vector2(0, 0.025), new THREE.Vector2(0.21, 0.025), new THREE.Vector2(0.23, 0.08), new THREE.Vector2(0.14, 0.15), new THREE.Vector2(0.18, 0.29), new THREE.Vector2(0.14, 0.42), new THREE.Vector2(0.09, 0.57), new THREE.Vector2(0.12, 0.64), new THREE.Vector2(0.08, 0.7), new THREE.Vector2(0, 0.7)],
};

const pieces: { kind: PieceKind; file: number; rank: number; team: Team; agentIndex: number }[] = [
  { kind: "rook", file: 0, rank: 0, team: "cyan", agentIndex: 0 },
  { kind: "knight", file: 1, rank: 0, team: "cyan", agentIndex: 0 },
  { kind: "bishop", file: 2, rank: 0, team: "cyan", agentIndex: 0 },
  { kind: "queen", file: 3, rank: 0, team: "cyan", agentIndex: 1 },
  { kind: "king", file: 4, rank: 0, team: "cyan", agentIndex: 1 },
  { kind: "bishop", file: 5, rank: 0, team: "cyan", agentIndex: 1 },
  { kind: "knight", file: 6, rank: 0, team: "cyan", agentIndex: 2 },
  { kind: "rook", file: 7, rank: 0, team: "cyan", agentIndex: 2 },
  { kind: "pawn", file: 1, rank: 1, team: "cyan", agentIndex: 0 },
  { kind: "pawn", file: 3, rank: 1, team: "cyan", agentIndex: 1 },
  { kind: "pawn", file: 5, rank: 1, team: "cyan", agentIndex: 2 },
  { kind: "pawn", file: 6, rank: 2, team: "cyan", agentIndex: 2 },
  { kind: "rook", file: 0, rank: 7, team: "violet", agentIndex: 2 },
  { kind: "knight", file: 1, rank: 7, team: "violet", agentIndex: 2 },
  { kind: "bishop", file: 2, rank: 7, team: "violet", agentIndex: 1 },
  { kind: "queen", file: 3, rank: 7, team: "violet", agentIndex: 1 },
  { kind: "king", file: 4, rank: 7, team: "violet", agentIndex: 0 },
  { kind: "bishop", file: 5, rank: 7, team: "violet", agentIndex: 0 },
  { kind: "knight", file: 6, rank: 7, team: "violet", agentIndex: 0 },
  { kind: "rook", file: 7, rank: 7, team: "violet", agentIndex: 1 },
  { kind: "pawn", file: 1, rank: 6, team: "violet", agentIndex: 2 },
  { kind: "pawn", file: 3, rank: 6, team: "violet", agentIndex: 1 },
  { kind: "pawn", file: 5, rank: 6, team: "violet", agentIndex: 0 },
  { kind: "pawn", file: 6, rank: 5, team: "violet", agentIndex: 2 },
  { kind: "knight", file: 2, rank: 4, team: "cyan", agentIndex: 1 },
  { kind: "queen", file: 5, rank: 3, team: "violet", agentIndex: 2 },
];

const cells = Array.from({ length: 64 }, (_, index) => ({ file: index % 8, rank: Math.floor(index / 8) }));

function ChessPiece({ kind, file, rank, team, agent, selected, running, emergencyStopped, isolated, isolationActive, onSelect }: {
  kind: PieceKind;
  file: number;
  rank: number;
  team: Team;
  agent?: AgentSignal;
  selected: boolean;
  running: boolean;
  emergencyStopped: boolean;
  isolated: boolean;
  isolationActive: boolean;
  onSelect: (id: string) => void;
}) {
  const group = useRef<THREE.Group>(null!);
  const baseY = useMemo(() => 0.035, []);
  const color = emergencyStopped ? "#ff466d" : isolated ? "#ff4e73" : team === "cyan" ? "#56efff" : "#b36bff";
  const dimmed = isolationActive && !isolated;

  useFrame((state, delta) => {
    if (!running) return;
    group.current.position.y = baseY + Math.sin(state.clock.elapsedTime * 1.45 + file + rank * 0.5) * 0.025;
    group.current.rotation.y += delta * (selected ? 0.16 : 0.055);
  });

  const choose = () => { if (agent) onSelect(agent.id); };

  return (
    <group ref={group} position={[file - 3.5, baseY, rank - 3.5]} scale={selected ? 1.08 : 1}>
      <mesh position={[0, 0.045, 0]} onClick={choose}>
        <cylinderGeometry args={[0.27, 0.32, 0.08, 32]} />
        <meshPhysicalMaterial color={color} emissive={color} emissiveIntensity={selected ? 1.75 : 0.8} metalness={0.55} roughness={0.19} transparent opacity={dimmed ? 0.25 : 0.88} clearcoat={1} toneMapped={false} />
        </mesh>
        <mesh position={[0, 0.08, 0]} rotation={[Math.PI / 2, 0, 0]} onClick={choose}>
          <torusGeometry args={[0.235, 0.014, 8, 36]} />
        <meshBasicMaterial color={color} transparent opacity={dimmed ? 0.12 : selected ? 0.95 : 0.68} />
      </mesh>
      <mesh onClick={choose}>
        <latheGeometry args={[pieceProfiles[kind], 24]} />
        <meshPhysicalMaterial color={color} emissive={color} emissiveIntensity={selected ? 1.6 : 0.68} metalness={0.35} roughness={0.21} transparent opacity={dimmed ? 0.24 : 0.86} clearcoat={1} toneMapped={false} />
        </mesh>
      {kind === "pawn" && <mesh position={[0, 0.485, 0]} onClick={choose}><sphereGeometry args={[0.095, 20, 20]} /><meshPhysicalMaterial color={color} emissive={color} emissiveIntensity={1.1} metalness={0.3} roughness={0.16} transparent opacity={dimmed ? 0.25 : 0.9} /></mesh>}
      {kind === "bishop" && <mesh position={[0, 0.63, 0]} onClick={choose}><sphereGeometry args={[0.09, 20, 20]} /><meshPhysicalMaterial color={color} emissive={color} emissiveIntensity={1.15} metalness={0.3} roughness={0.16} /></mesh>}
      {kind === "queen" && <mesh position={[0, 0.68, 0]} onClick={choose}><sphereGeometry args={[0.115, 20, 20]} /><meshPhysicalMaterial color={color} emissive={color} emissiveIntensity={1.25} metalness={0.3} roughness={0.15} /></mesh>}
      {kind === "king" && <group position={[0, 0.69, 0]} onClick={choose}>
        <mesh><boxGeometry args={[0.055, 0.24, 0.055]} /><meshBasicMaterial color={color} /></mesh>
        <mesh><boxGeometry args={[0.2, 0.052, 0.052]} /><meshBasicMaterial color={color} /></mesh>
      </group>}
      {kind === "rook" && <group position={[0, 0.56, 0]} onClick={choose}>
        <mesh><cylinderGeometry args={[0.19, 0.19, 0.06, 8]} /><meshBasicMaterial color={color} /></mesh>
        {[0, 1, 2, 3].map((tooth) => <mesh key={tooth} position={[Math.cos(tooth * Math.PI / 2) * 0.13, 0.06, Math.sin(tooth * Math.PI / 2) * 0.13]}><boxGeometry args={[0.07, 0.09, 0.07]} /><meshBasicMaterial color={color} /></mesh>)}
      </group>}
      {kind === "knight" && <group position={[0, 0.48, 0]} onClick={choose}>
        <mesh position={[0.035, 0.07, 0]} rotation={[0, 0, -0.28]}><capsuleGeometry args={[0.075, 0.18, 4, 8]} /><meshPhysicalMaterial color={color} emissive={color} emissiveIntensity={0.9} metalness={0.4} roughness={0.2} transparent opacity={dimmed ? 0.25 : 0.9} /></mesh>
        <mesh position={[0.13, 0.16, 0]}><coneGeometry args={[0.05, 0.13, 5]} /><meshBasicMaterial color={color} /></mesh>
      </group>}
      {selected && <pointLight position={[0, 0.45, 0]} color={color} intensity={1.15} distance={1.5} />}
    </group>
  );
}

function FloatingOrb({ position, color, radius, speed, running }: { position: [number, number, number]; color: string; radius: number; speed: number; running: boolean }) {
  const orb = useRef<THREE.Mesh>(null!);
  useFrame((state) => {
    if (!running) return;
    orb.current.position.y = position[1] + Math.sin(state.clock.elapsedTime * speed + position[0]) * 0.16;
  });
  return (
    <mesh ref={orb} position={position}>
      <sphereGeometry args={[radius, 24, 24]} />
      <meshPhysicalMaterial color={color} emissive={color} emissiveIntensity={1.5} metalness={0.4} roughness={0.12} transparent opacity={0.64} clearcoat={1} />
    </mesh>
  );
}

function BoardSurface({ emergencyStopped }: { emergencyStopped: boolean }) {
  return (
    <group>
      <mesh position={[0, -0.16, 0]} receiveShadow>
        <boxGeometry args={[8.25, 0.3, 8.25]} />
        <meshPhysicalMaterial color="#111629" emissive="#16284b" emissiveIntensity={0.42} metalness={0.75} roughness={0.24} transparent opacity={0.96} clearcoat={0.8} />
      </mesh>
      <mesh position={[0, -0.002, 0]}>
        <boxGeometry args={[8.08, 0.06, 8.08]} />
        <meshBasicMaterial color={emergencyStopped ? "#ff466d" : "#54e9ff"} wireframe transparent opacity={0.38} />
      </mesh>
      {cells.map(({ file, rank }) => {
        const light = (file + rank) % 2 === 0;
        const focus = (file === 3 && rank === 3) || (file === 4 && rank === 4) || (file === 5 && rank === 3);
        const tint = emergencyStopped ? (light ? "#351322" : "#190e1a") : focus ? (light ? "#2b2160" : "#102b48") : light ? "#152337" : "#09111e";
        const glow = emergencyStopped ? "#ff315e" : focus ? (file === 4 ? "#bd74ff" : "#58edff") : light ? "#2d6990" : "#12273d";
        return (
          <mesh key={`${file}-${rank}`} position={[file - 3.5, 0.022, rank - 3.5]} receiveShadow>
            <boxGeometry args={[0.97, 0.045, 0.97]} />
            <meshPhysicalMaterial color={tint} emissive={glow} emissiveIntensity={focus ? 0.95 : light ? 0.34 : 0.24} metalness={0.62} roughness={0.25} transparent opacity={0.98} clearcoat={0.55} toneMapped={false} />
          </mesh>
        );
      })}
      <mesh position={[0, -0.285, 0]}>
        <boxGeometry args={[8.45, 0.08, 8.45]} />
        <meshBasicMaterial color={emergencyStopped ? "#ff466d" : "#a65cff"} wireframe transparent opacity={0.5} />
      </mesh>
    </group>
  );
}

export default function HolographicChessboard({ agents, selectedId, running, emergencyStopped, isolatedAgentId, onSelectAgent }: HolographicChessboardProps) {
  const boardGroup = useRef<THREE.Group>(null!);

  useFrame((_state, delta) => {
    if (!running) return;
    boardGroup.current.rotation.y += delta * 0.035;
  });

  return (
    <>
      <color attach="background" args={["#05060b"]} />
      <fog attach="fog" args={["#05060b", 18, 46]} />
      <ambientLight intensity={0.76} />
      <hemisphereLight args={["#8feeff", "#101027", 1.05]} />
      <pointLight position={[0, 5.4, 3.2]} color={emergencyStopped ? "#ff3564" : "#62eaff"} intensity={32} distance={13} />
      <pointLight position={[-4.2, 1.5, -2.4]} color="#a25cff" intensity={24} distance={12} />
      <pointLight position={[3.8, 2.8, -1.2]} color="#ff4fc9" intensity={13} distance={10} />
      <Stars radius={20} depth={12} count={560} factor={2.1} saturation={0.6} fade speed={running ? 0.3 : 0} />
      <group ref={boardGroup}>
        <BoardSurface emergencyStopped={emergencyStopped} />
        {pieces.map((piece, index) => {
          const agent = agents[piece.agentIndex % Math.max(1, agents.length)];
          const isolated = Boolean(isolatedAgentId && agent?.id === isolatedAgentId);
          return (
            <ChessPiece
              key={`${piece.kind}-${piece.file}-${piece.rank}-${index}`}
              {...piece}
              agent={agent}
              selected={agent?.id === selectedId}
              running={running}
              emergencyStopped={emergencyStopped}
              isolated={isolated}
              isolationActive={Boolean(isolatedAgentId)}
              onSelect={onSelectAgent}
            />
          );
        })}
      </group>
      <FloatingOrb position={[-4.25, 1.45, 0.45]} color="#53edff" radius={0.2} speed={0.72} running={running} />
      <FloatingOrb position={[4.2, 1.05, -0.2]} color="#ab65ff" radius={0.27} speed={0.55} running={running} />
      <FloatingOrb position={[-2.7, 2.1, -3.15]} color="#a86bff" radius={0.12} speed={0.92} running={running} />
      <FloatingOrb position={[3.5, 2.3, 2.2]} color="#56efff" radius={0.1} speed={0.8} running={running} />
      <OrbitControls target={[0, 0.25, 0]} enablePan={false} enableZoom={false} enableDamping dampingFactor={0.08} autoRotate={running} autoRotateSpeed={0.25} minPolarAngle={Math.PI * 0.28} maxPolarAngle={Math.PI * 0.46} />
    </>
  );
}
