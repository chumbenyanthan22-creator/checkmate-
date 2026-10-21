import { OrbitControls, Stars, Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

type AgentSignal = { id: string; name: string; risk?: string };

type NeuralCoreSceneProps = {
  agents: AgentSignal[];
  selectedId: string;
  running: boolean;
  emergencyStopped: boolean;
  isolatedAgentId: string | null;
  onSelectAgent: (id: string) => void;
  demoMode?: boolean;
};

type GraphAgent = AgentSignal & { synthetic?: boolean };

const GRAPH_HELPER_ID = "__runtime_supervisor_graph_helper__";
const NEURAL_UP = new THREE.Vector3(0, 1, 0);

const PARTICLE_VERTEX_SHADER = `
  attribute float aSeed;
  attribute vec3 color;
  uniform float uTime;
  uniform float uMotion;
  uniform float uPointSize;
  varying vec3 vColor;
  varying float vTwinkle;

  void main() {
    float phase = aSeed * 31.4159;
    float shimmer = 0.5 + 0.5 * sin(uTime * (0.7 + fract(aSeed * 7.13) * 1.2) + phase);
    vec3 jitter = vec3(
      sin(uTime * 0.49 + phase),
      cos(uTime * 0.41 + phase * 1.37),
      sin(uTime * 0.57 + phase * 0.71)
    ) * (0.01 + fract(aSeed * 19.17) * 0.018) * uMotion;
    vec4 mvPosition = modelViewMatrix * vec4(position + jitter, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = uPointSize * (270.0 / max(1.0, -mvPosition.z)) * (0.78 + shimmer * 0.38);
    vColor = color;
    vTwinkle = shimmer;
  }
`;

const PARTICLE_FRAGMENT_SHADER = `
  varying vec3 vColor;
  varying float vTwinkle;

  void main() {
    float distanceFromCenter = length(gl_PointCoord - vec2(0.5));
    if (distanceFromCenter > 0.5) discard;
    float softness = 1.0 - smoothstep(0.08, 0.5, distanceFromCenter);
    float shimmer = 0.72 + vTwinkle * 0.4;
    gl_FragColor = vec4(vColor * shimmer, softness * (0.55 + vTwinkle * 0.32));
  }
`;

const FLOW_VERTEX_SHADER = `
  attribute float aProgress;
  varying float vProgress;

  void main() {
    vProgress = aProgress;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FLOW_FRAGMENT_SHADER = `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uOpacity;
  uniform float uFlow;
  varying float vProgress;

  void main() {
    float head = fract(uTime * uFlow);
    float distanceToHead = abs(vProgress - head);
    distanceToHead = min(distanceToHead, 1.0 - distanceToHead);
    float pulse = smoothstep(0.38, 0.0, distanceToHead);
    float edgeFade = 0.34 + 0.66 * sin(vProgress * 3.14159265);
    gl_FragColor = vec4(uColor * (0.72 + pulse * 1.8), uOpacity * edgeFade * (0.7 + pulse * 0.3));
  }
`;

function fract(value: number) {
  return value - Math.floor(value);
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);

  return reduced;
}

function makeAmbientParticles() {
  const positions: number[] = [];
  const colors: number[] = [];
  const seeds: number[] = [];
  const cool = new THREE.Color("#4c789f");
  const violet = new THREE.Color("#655487");

  for (let index = 0; index < 430; index += 1) {
    const seed = index + 1;
    const angle = seed * 2.399963;
    const radius = 2.35 + ((seed * 19) % 127) / 100;
    const height = (((seed * 37) % 101) / 100) * 4.6 - 2.3;
    positions.push(
      Math.cos(angle) * radius,
      height,
      Math.sin(angle) * radius * 0.74
    );
    const tint = cool
      .clone()
      .lerp(violet, fract(Math.sin(seed * 12.17) * 214.7));
    const intensity = 0.5 + fract(Math.sin(seed * 18.17) * 231.7) * 0.48;
    colors.push(tint.r * intensity, tint.g * intensity, tint.b * intensity);
    seeds.push(fract(Math.sin(seed * 43.11) * 8921.17));
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3)
  );
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute("aSeed", new THREE.Float32BufferAttribute(seeds, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

function AnimatedParticles({
  geometry,
  motionEnabled,
  reducedMotion,
  pointSize,
}: {
  geometry: THREE.BufferGeometry;
  motionEnabled: boolean;
  reducedMotion: boolean;
  pointSize: number;
}) {
  const material = useRef<THREE.ShaderMaterial>(null);

  useFrame(state => {
    if (!material.current) return;
    material.current.uniforms.uTime.value = motionEnabled
      ? state.clock.elapsedTime
      : 0;
    material.current.uniforms.uMotion.value = motionEnabled
      ? reducedMotion
        ? 0.16
        : 1
      : 0;
  });

  return (
    <points geometry={geometry}>
      <shaderMaterial
        ref={material}
        vertexShader={PARTICLE_VERTEX_SHADER}
        fragmentShader={PARTICLE_FRAGMENT_SHADER}
        uniforms={{
          uTime: { value: 0 },
          uMotion: { value: 1 },
          uPointSize: { value: pointSize },
        }}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        toneMapped={false}
      />
    </points>
  );
}

function isCritical(agent: GraphAgent, emergencyStopped: boolean) {
  if (emergencyStopped) return true;
  if (agent.synthetic) return false;
  return /loop|critical|danger|error|fail|blocked|high/i.test(agent.risk ?? "");
}

function AgentNode({
  agent,
  initialPosition,
  nodeRef,
  selected,
  emergencyStopped,
  isolated,
  isolationActive,
  onSelect,
}: {
  agent: GraphAgent;
  initialPosition: THREE.Vector3;
  nodeRef: (node: THREE.Group | null) => void;
  selected: boolean;
  emergencyStopped: boolean;
  isolated: boolean;
  isolationActive: boolean;
  onSelect: (id: string) => void;
}) {
  const critical = isCritical(agent, emergencyStopped);
  const color = critical ? "#ff4f71" : "#48e7ff";
  const opacity = emergencyStopped
    ? 0.58
    : isolationActive && !isolated
      ? 0.16
      : agent.synthetic
        ? 0.74
        : 0.96;
  const hit = (event: { stopPropagation: () => void }) => {
    event.stopPropagation();
    if (!agent.synthetic) onSelect(agent.id);
  };

  return (
    <group ref={nodeRef} position={initialPosition.toArray()}>
      <mesh onClick={hit}>
        <sphereGeometry args={[selected ? 0.17 : 0.14, 16, 16]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={selected ? 3.8 : critical ? 3 : 2.4}
          metalness={0.2}
          roughness={0.16}
          transparent
          opacity={opacity}
          toneMapped={false}
        />
      </mesh>
      <mesh scale={selected ? 1.45 : 1.22}>
        <sphereGeometry args={[0.14, 12, 12]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={opacity * (selected ? 0.2 : 0.1)}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} onClick={hit}>
        <torusGeometry args={[selected ? 0.245 : 0.205, 0.008, 8, 40]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={opacity * 0.78}
          toneMapped={false}
        />
      </mesh>
      <mesh rotation={[0.35, 0.7, 0]} scale={0.78}>
        <torusGeometry args={[selected ? 0.26 : 0.22, 0.0045, 6, 36]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={opacity * 0.34}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      {selected && !emergencyStopped && (
        <pointLight color={color} intensity={1.1} distance={1.8} />
      )}
      {agent.synthetic && (
        <Text
          position={[0, 0.34, 0]}
          fontSize={0.082}
          lineHeight={1.15}
          color="#b9f5ff"
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.006}
          outlineColor="#071018"
        >
          EXTERNAL DEMO AGENT{`\n`}GRAPH-ONLY · NOT PROTECTED
        </Text>
      )}
      {!agent.synthetic && (
        <Text
          position={[0, -0.24, 0]}
          fontSize={0.082}
          maxWidth={0.95}
          textAlign="center"
          color={critical ? "#ff9baa" : "#a8f4ff"}
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.006}
          outlineColor="#071018"
        >
          {agent.name}
        </Text>
      )}
    </group>
  );
}

function FlowLink({
  from,
  to,
  color,
  motionEnabled,
  reducedMotion,
  index,
}: {
  from: React.MutableRefObject<THREE.Group | null>;
  to: React.MutableRefObject<THREE.Group | null>;
  color: string;
  motionEnabled: boolean;
  reducedMotion: boolean;
  index: number;
}) {
  const geometry = useMemo(() => {
    const line = new THREE.BufferGeometry();
    line.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(new Float32Array(6), 3)
    );
    line.setAttribute("aProgress", new THREE.Float32BufferAttribute([0, 1], 1));
    return line;
  }, []);
  const material = useRef<THREE.ShaderMaterial>(null);
  const lineColor = useMemo(() => new THREE.Color(color), [color]);

  useFrame(state => {
    const start = from.current;
    const end = to.current;
    if (!start || !end) return;
    const position = geometry.getAttribute("position") as THREE.BufferAttribute;
    position.setXYZ(0, start.position.x, start.position.y, start.position.z);
    position.setXYZ(1, end.position.x, end.position.y, end.position.z);
    position.needsUpdate = true;
    if (material.current) {
      material.current.uniforms.uTime.value = motionEnabled
        ? state.clock.elapsedTime
        : 0;
      material.current.uniforms.uFlow.value = reducedMotion
        ? 0.2
        : 0.75 + (index % 3) * 0.16;
    }
  });

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <lineSegments geometry={geometry} renderOrder={-1}>
      <shaderMaterial
        ref={material}
        vertexShader={FLOW_VERTEX_SHADER}
        fragmentShader={FLOW_FRAGMENT_SHADER}
        uniforms={{
          uColor: { value: lineColor },
          uTime: { value: 0 },
          uOpacity: { value: color === "#ff4f71" ? 0.55 : 0.42 },
          uFlow: { value: 0.75 },
        }}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        toneMapped={false}
      />
    </lineSegments>
  );
}

function EnergyOrb({
  position,
  color,
  motionEnabled,
  reducedMotion,
  phase,
}: {
  position: [number, number, number];
  color: string;
  motionEnabled: boolean;
  reducedMotion: boolean;
  phase: number;
}) {
  const group = useRef<THREE.Group>(null);
  const base = useMemo(() => new THREE.Vector3(...position), [position]);

  useFrame(state => {
    if (!group.current || !motionEnabled) return;
    const scale = reducedMotion ? 0.18 : 1;
    const time = state.clock.elapsedTime * scale + phase;
    group.current.position.set(
      base.x + Math.sin(time * 0.62) * 0.12,
      base.y + Math.cos(time * 0.48) * 0.16,
      base.z + Math.sin(time * 0.39) * 0.1
    );
    group.current.rotation.y += state.clock.getDelta() * 0.12 * scale;
  });

  return (
    <group ref={group} position={position}>
      <mesh>
        <sphereGeometry args={[0.24, 16, 16]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.07}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.2, 0.008, 8, 28]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.24}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

function NetworkGraph({
  graphAgents,
  selectedId,
  running,
  emergencyStopped,
  isolatedAgentId,
  reducedMotion,
  onSelectAgent,
}: {
  graphAgents: GraphAgent[];
  selectedId: string;
  running: boolean;
  emergencyStopped: boolean;
  isolatedAgentId: string | null;
  reducedMotion: boolean;
  onSelectAgent: (id: string) => void;
}) {
  const nodeRefs = useRef<Array<THREE.Group | null>>([]);
  const nodeHandles = useMemo<
    Array<React.MutableRefObject<THREE.Group | null>>
  >(() => graphAgents.map(() => ({ current: null })), [graphAgents.length]);
  const motionEnabled = running && !emergencyStopped;
  const states = useMemo(
    () =>
      graphAgents.map((_, index) => {
        const angle =
          (index / Math.max(1, graphAgents.length)) * Math.PI * 2 - Math.PI / 2;
        const radius = 1.92 + (index % 3) * 0.14;
        const x = Math.cos(angle) * radius;
        const y =
          Math.sin(angle) * radius * 0.58 + Math.sin(index * 1.91) * 0.14;
        const z = Math.sin(angle) * radius * 0.34;
        return {
          position: new THREE.Vector3(x, y, z),
          home: new THREE.Vector3(x, y, z),
          velocity: new THREE.Vector3(),
          phase: index * 1.37,
        };
      }),
    [graphAgents.length]
  );
  const edges = useMemo(() => {
    const result: Array<[number, number]> = [];
    const count = graphAgents.length;
    if (count < 2) return result;
    for (let index = 0; index < count; index += 1) {
      result.push([index, (index + 1) % count]);
      if (index % 2 === 0 && count > 4)
        result.push([index, (index + 2) % count]);
    }
    return result;
  }, [graphAgents.length]);

  useFrame(state => {
    if (!motionEnabled) {
      states.forEach(item => item.velocity.set(0, 0, 0));
    } else {
      const speed = reducedMotion ? 0.18 : 1;
      const forces = states.map(() => new THREE.Vector3());
      const difference = new THREE.Vector3();

      for (let index = 0; index < states.length; index += 1) {
        const current = states[index];
        forces[index].add(
          current.home.clone().sub(current.position).multiplyScalar(0.52)
        );
        forces[index].add(
          new THREE.Vector3(
            Math.sin(state.clock.elapsedTime * 0.55 + current.phase),
            Math.cos(state.clock.elapsedTime * 0.43 + current.phase * 1.4),
            Math.sin(state.clock.elapsedTime * 0.67 + current.phase * 0.7)
          ).multiplyScalar(0.025 * speed)
        );

        for (let other = index + 1; other < states.length; other += 1) {
          difference.subVectors(current.position, states[other].position);
          const distanceSquared = Math.max(0.18, difference.lengthSq());
          forces[index].add(
            difference.normalize().multiplyScalar(0.022 / distanceSquared)
          );
          forces[other].add(
            difference.normalize().multiplyScalar(-0.022 / distanceSquared)
          );
        }
      }

      edges.forEach(([a, b]) => {
        difference.subVectors(states[b].position, states[a].position);
        const distance = Math.max(0.001, difference.length());
        const spring = difference
          .normalize()
          .multiplyScalar((distance - 1.8) * 0.075);
        forces[a].add(spring);
        forces[b].sub(spring);
      });

      states.forEach((item, index) => {
        item.velocity.add(forces[index].multiplyScalar(speed * 0.42));
        item.velocity.multiplyScalar(reducedMotion ? 0.82 : 0.91);
        item.position.add(item.velocity);
        const length = item.position.length();
        if (length > 2.85) item.position.multiplyScalar(2.85 / length);
      });
    }

    states.forEach((item, index) => {
      const node = nodeRefs.current[index];
      if (node) node.position.copy(item.position);
    });
  });

  return (
    <group>
      {edges.map(([fromIndex, toIndex], index) => {
        const fromCritical = isCritical(
          graphAgents[fromIndex],
          emergencyStopped
        );
        const toCritical = isCritical(graphAgents[toIndex], emergencyStopped);
        return (
          <FlowLink
            key={`${fromIndex}-${toIndex}`}
            from={nodeHandles[fromIndex]}
            to={nodeHandles[toIndex]}
            color={fromCritical || toCritical ? "#ff4f71" : "#48e7ff"}
            motionEnabled={motionEnabled}
            reducedMotion={reducedMotion}
            index={index}
          />
        );
      })}
      {graphAgents.map((agent, index) => (
        <AgentNode
          key={agent.id}
          agent={agent}
          initialPosition={states[index].position}
          nodeRef={node => {
            nodeRefs.current[index] = node;
            nodeHandles[index].current = node;
          }}
          selected={agent.id === selectedId}
          emergencyStopped={emergencyStopped}
          isolated={agent.id === isolatedAgentId}
          isolationActive={Boolean(isolatedAgentId)}
          onSelect={onSelectAgent}
        />
      ))}
    </group>
  );
}

export default function NeuralCoreScene({
  agents,
  selectedId,
  running,
  emergencyStopped,
  isolatedAgentId,
  onSelectAgent,
  demoMode = false,
}: NeuralCoreSceneProps) {
  const reducedMotion = useReducedMotion();
  const motionEnabled = running && !emergencyStopped;
  const ambientGeometry = useMemo(makeAmbientParticles, []);
  const graphAgents = useMemo<GraphAgent[]>(() => {
    const visibleAgents = agents.slice(0, 8);
    if (demoMode && visibleAgents.length < 6) {
      return [
        ...visibleAgents,
        {
          id: GRAPH_HELPER_ID,
          name: "External Demo Agent",
          synthetic: true,
          risk: "graph-only helper",
        },
      ];
    }
    return visibleAgents;
  }, [agents, demoMode]);
  const syntheticCount = graphAgents.filter(agent => agent.synthetic).length;
  const liveCount = graphAgents.length - syntheticCount;
  const summary = `${liveCount} ${demoMode ? "DEMO" : "SCOPED"} AGENT${liveCount === 1 ? "" : "S"} • ${
    syntheticCount
      ? `${syntheticCount} SYNTHETIC GRAPH HELPER${syntheticCount === 1 ? "" : "S"}`
      : "NO SYNTHETIC NODES"
  }`;

  useEffect(() => () => ambientGeometry.dispose(), [ambientGeometry]);

  return (
    <>
      <color attach="background" args={["#03070d"]} />
      <fog attach="fog" args={["#03070d", 7, 14]} />
      <ambientLight intensity={0.42} />
      <hemisphereLight args={["#93ecff", "#100c1d", 0.9]} />
      <pointLight
        position={[0, 2.8, 2.4]}
        color={emergencyStopped ? "#ff4f71" : "#49e7ff"}
        intensity={8}
        distance={8}
      />
      <pointLight
        position={[-2.4, -1.4, -2]}
        color="#7358cb"
        intensity={5}
        distance={7}
      />
      <pointLight
        position={[2.8, 1.2, -1.6]}
        color="#5adfff"
        intensity={3.5}
        distance={6}
      />
      <Stars
        radius={16}
        depth={8}
        count={320}
        factor={1.55}
        saturation={0.8}
        fade
        speed={motionEnabled ? (reducedMotion ? 0.04 : 0.22) : 0}
      />
      <AnimatedParticles
        geometry={ambientGeometry}
        motionEnabled={motionEnabled}
        reducedMotion={reducedMotion}
        pointSize={0.021}
      />
      <Text
        position={[0, 2.25, 0]}
        fontSize={0.09}
        color={emergencyStopped ? "#ff7890" : "#9defff"}
        anchorX="center"
        anchorY="middle"
        letterSpacing={0.08}
        outlineWidth={0.008}
        outlineColor="#03070d"
      >
        {summary}
      </Text>
      <NetworkGraph
        graphAgents={graphAgents}
        selectedId={selectedId}
        running={running}
        emergencyStopped={emergencyStopped}
        isolatedAgentId={isolatedAgentId}
        reducedMotion={reducedMotion}
        onSelectAgent={onSelectAgent}
      />
      <EnergyOrb
        position={[-1.9, 1.18, -0.8]}
        color={emergencyStopped ? "#ff4f71" : "#45e7ff"}
        motionEnabled={motionEnabled}
        reducedMotion={reducedMotion}
        phase={0.2}
      />
      <EnergyOrb
        position={[1.92, -0.88, -0.65]}
        color={emergencyStopped ? "#ff4f71" : "#9872ff"}
        motionEnabled={motionEnabled}
        reducedMotion={reducedMotion}
        phase={1.8}
      />
      <EnergyOrb
        position={[0.25, 1.55, 1.35]}
        color={emergencyStopped ? "#ff4f71" : "#ffd16e"}
        motionEnabled={motionEnabled}
        reducedMotion={reducedMotion}
        phase={3.1}
      />
      <OrbitControls
        target={[0, 0, 0]}
        enablePan={false}
        enableZoom
        minDistance={4.2}
        maxDistance={9}
        enableDamping
        dampingFactor={0.08}
        autoRotate={motionEnabled}
        autoRotateSpeed={reducedMotion ? 0.16 : 0.42}
        minPolarAngle={Math.PI * 0.24}
        maxPolarAngle={Math.PI * 0.76}
      />
    </>
  );
}
