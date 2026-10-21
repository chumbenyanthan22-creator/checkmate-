import { OrbitControls, Stars } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

type AgentSignal = { id: string; name: string; risk?: string };

type NeuralCoreSceneProps = {
  agents: AgentSignal[];
  selectedId: string;
  running: boolean;
  emergencyStopped: boolean;
  isolatedAgentId: string | null;
  onSelectAgent: (id: string) => void;
};

const POINTS_PER_HEMISPHERE = 6200;
const NEURAL_UP = new THREE.Vector3(0, 1, 0);

function fract(value: number) {
  return value - Math.floor(value);
}

function makeCoreGeometry(alert: boolean) {
  const positions: number[] = [];
  const colors: number[] = [];
  const cyan = new THREE.Color(alert ? "#ff496d" : "#50e9ff");
  const purple = new THREE.Color(alert ? "#ff496d" : "#aa70ff");
  const gold = new THREE.Color(alert ? "#ff496d" : "#ffd269");

  for (const side of [-1, 1]) {
    for (let index = 0; index < POINTS_PER_HEMISPHERE; index += 1) {
      const vertical = (index + 0.5) / POINTS_PER_HEMISPHERE;
      const yNorm = 1 - 2 * vertical;
      const jitter = fract(Math.sin((index + 1) * (side + 4) * 12.9898) * 43758.5453);
      const jitterY = fract(Math.sin((index + 3) * 78.233 + side * 39.425) * 23421.631) - 0.5;
      const theta = (jitter - 0.5) * Math.PI + jitterY * 0.055;
      const ring = Math.sqrt(Math.max(0, 1 - yNorm * yNorm));
      const latitude = Math.asin(THREE.MathUtils.clamp(yNorm, -1, 1));
      const folds = 1
        + Math.sin(theta * 5 + latitude * 4 + side) * 0.12
        + Math.cos(theta * 8 - latitude * 7 + side * 0.7) * 0.062
        + Math.sin(theta * 15 + latitude * 12) * 0.028;
      const jaw = 1 - 0.16 * THREE.MathUtils.smoothstep(-yNorm, 0.5, 0.98);
      const x = side * (0.055 + ring * jaw * folds * 0.74 * Math.cos(theta));
      const z = ring * folds * Math.sin(theta) * 0.68;
      const crownRipple = yNorm > 0.68 ? Math.sin(theta * 5 + side) * 0.035 * (yNorm - 0.68) : 0;
      const y = yNorm * 1.08 + crownRipple;
      positions.push(x, y, z);

      let color: THREE.Color;
      if (yNorm < -0.28) color = purple.clone().lerp(cyan, (yNorm + 1) / 0.72);
      else if (yNorm > 0.36) color = cyan.clone().lerp(gold, (yNorm - 0.36) / 0.64);
      else color = (side < 0 ? cyan : purple).clone().lerp(cyan, 0.35);
      const sparkle = 0.78 + 0.44 * fract(Math.sin((index + 7) * 91.17 + side * 31.7) * 41321.93);
      colors.push(color.r * sparkle, color.g * sparkle, color.b * sparkle);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

function makeAmbientParticles() {
  const positions: number[] = [];
  for (let index = 0; index < 240; index += 1) {
    const seed = index + 1;
    const angle = seed * 2.399963;
    const height = ((seed * 37) % 101) / 100 * 3.6 - 1.8;
    const radius = 1.68 + ((seed * 19) % 53) / 100;
    positions.push(Math.cos(angle) * radius, height, Math.sin(angle) * radius);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

function AgentNode({ agent, index, count, selected, running, emergencyStopped, isolated, isolationActive, onSelect }: {
  agent: AgentSignal;
  index: number;
  count: number;
  selected: boolean;
  running: boolean;
  emergencyStopped: boolean;
  isolated: boolean;
  isolationActive: boolean;
  onSelect: (id: string) => void;
}) {
  const group = useRef<THREE.Group>(null!);
  const tether = useRef<THREE.Mesh>(null!);
  const direction = useMemo(() => new THREE.Vector3(), []);
  const baseAngle = (index / Math.max(3, count)) * Math.PI * 2;
  const color = emergencyStopped || isolated ? "#ff496d" : index % 2 === 0 ? "#5cecff" : "#b579ff";
  const opacity = isolationActive && !isolated ? 0.24 : 0.94;

  useFrame((state, delta) => {
    const motionActive = running && !emergencyStopped;
    const time = motionActive ? state.clock.elapsedTime : 0;
    const angle = baseAngle + time * 0.14;
    const x = Math.sin(angle) * 1.76;
    const y = motionActive ? Math.sin(time * 0.46 + index) * 0.67 : 0;
    const z = Math.cos(angle) * 1.34;
    group.current.position.set(x, y, z);
    if (motionActive) group.current.rotation.y += delta * 0.28;

    direction.set(x, y, z);
    const distance = direction.length();
    tether.current.position.copy(direction).multiplyScalar(0.5);
    tether.current.quaternion.setFromUnitVectors(NEURAL_UP, direction.normalize());
    tether.current.scale.set(1, distance, 1);
  });

  return (
    <>
      <mesh ref={tether}>
        <cylinderGeometry args={[0.0035, 0.0035, 1, 5]} />
        <meshBasicMaterial color={color} transparent opacity={opacity * 0.28} depthWrite={false} />
      </mesh>
      <group ref={group} position={[Math.sin(baseAngle) * 1.76, 0, Math.cos(baseAngle) * 1.34]}>
        <mesh onClick={(event) => { event.stopPropagation(); onSelect(agent.id); }}>
          <icosahedronGeometry args={[selected ? 0.082 : 0.057, 1]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={selected ? 2.2 : 1.15} metalness={0.15} roughness={0.14} transparent opacity={opacity} toneMapped={false} />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]} onClick={(event) => { event.stopPropagation(); onSelect(agent.id); }}>
          <torusGeometry args={[selected ? 0.128 : 0.092, 0.005, 6, 40]} />
          <meshBasicMaterial color={color} transparent opacity={opacity * 0.65} />
        </mesh>
        {selected && <pointLight color={color} intensity={0.8} distance={1.4} />}
      </group>
    </>
  );
}

export default function NeuralCoreScene({ agents, selectedId, running, emergencyStopped, isolatedAgentId, onSelectAgent }: NeuralCoreSceneProps) {
  const core = useRef<THREE.Group>(null!);
  const scanBand = useRef<THREE.Mesh>(null!);
  const pointGeometry = useMemo(() => makeCoreGeometry(emergencyStopped), [emergencyStopped]);
  const ambientGeometry = useMemo(makeAmbientParticles, []);
  const motionEnabled = running && !emergencyStopped;

  useEffect(() => () => {
    pointGeometry.dispose();
    ambientGeometry.dispose();
  }, [ambientGeometry, pointGeometry]);

  useFrame((state, delta) => {
    if (!motionEnabled) return;
    const time = state.clock.elapsedTime;
    core.current.rotation.y += delta * 0.095;
    core.current.rotation.x = Math.sin(time * 0.21) * 0.035;
    core.current.position.y = Math.sin(time * 0.6) * 0.045;
    core.current.scale.setScalar(1 + Math.sin(time * 0.85) * 0.012);
    scanBand.current.position.y = Math.sin(time * 0.7) * 0.82;
  });

  return (
    <>
      <color attach="background" args={["#05060b"]} />
      <fog attach="fog" args={["#05060b", 8, 17]} />
      <ambientLight intensity={0.64} />
      <hemisphereLight args={["#a5edff", "#171126", 1.15]} />
      <pointLight position={[0, 2.6, 3.1]} color={emergencyStopped ? "#ff496d" : "#58eaff"} intensity={13} distance={8} />
      <pointLight position={[-2.8, -0.7, -2.4]} color={emergencyStopped ? "#ff496d" : "#a879ff"} intensity={10} distance={7} />
      <pointLight position={[2.9, 1.6, -1.5]} color={emergencyStopped ? "#ff496d" : "#ffd26a"} intensity={5} distance={6} />
      <Stars radius={18} depth={7} count={360} factor={1.8} saturation={0.65} fade speed={motionEnabled ? 0.22 : 0} />
      <points geometry={ambientGeometry}>
        <pointsMaterial color={emergencyStopped ? "#ff496d" : "#8299bd"} size={0.017} transparent opacity={0.48} depthWrite={false} sizeAttenuation />
      </points>
      <group ref={core}>
        <points geometry={pointGeometry}>
          <pointsMaterial size={0.023} vertexColors transparent opacity={0.98} depthWrite={false} sizeAttenuation blending={THREE.AdditiveBlending} toneMapped={false} />
        </points>
        <mesh ref={scanBand} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[1.05, 0.004, 5, 100]} />
          <meshBasicMaterial color={emergencyStopped ? "#ff496d" : "#c5f8ff"} transparent opacity={0.26} toneMapped={false} />
        </mesh>
        <mesh rotation={[0.34, 0.2, 0]}>
          <torusGeometry args={[1.48, 0.004, 5, 100]} />
          <meshBasicMaterial color={emergencyStopped ? "#ff496d" : "#a777ff"} transparent opacity={0.13} />
        </mesh>
        <mesh position={[0, 0, 0]}>
          <icosahedronGeometry args={[0.09, 1]} />
          <meshStandardMaterial color={emergencyStopped ? "#ff496d" : "#ffd168"} emissive={emergencyStopped ? "#ff496d" : "#e4a946"} emissiveIntensity={1.2} metalness={0.3} roughness={0.25} toneMapped={false} />
        </mesh>
        {agents.map((agent, index) => (
          <AgentNode
            key={agent.id}
            agent={agent}
            index={index}
            count={agents.length}
            selected={agent.id === selectedId}
            running={motionEnabled}
            emergencyStopped={emergencyStopped}
            isolated={agent.id === isolatedAgentId}
            isolationActive={Boolean(isolatedAgentId)}
            onSelect={onSelectAgent}
          />
        ))}
      </group>
      <OrbitControls target={[0, 0, 0]} enablePan={false} enableZoom={false} enableDamping dampingFactor={0.08} autoRotate={motionEnabled} autoRotateSpeed={0.18} minPolarAngle={Math.PI * 0.3} maxPolarAngle={Math.PI * 0.7} />
    </>
  );
}
