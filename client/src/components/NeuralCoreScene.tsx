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
};

type GraphAgent = AgentSignal;
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
  motionEnabled,
  reducedMotion,
  phase,
  densityScale,
  onSelect,
}: {
  agent: GraphAgent;
  initialPosition: THREE.Vector3;
  nodeRef: (node: THREE.Group | null) => void;
  selected: boolean;
  emergencyStopped: boolean;
  isolated: boolean;
  isolationActive: boolean;
  motionEnabled: boolean;
  reducedMotion: boolean;
  phase: number;
  densityScale: number;
  onSelect: (id: string) => void;
}) {
  const critical = isCritical(agent, emergencyStopped);
  const color = critical ? "#ff4f71" : "#48e7ff";
  const opacity = emergencyStopped
    ? 0.58
    : isolationActive && !isolated
      ? 0.16
      : 0.96;
  const model = useRef<THREE.Group>(null);
  const orbit = useRef<THREE.Group>(null);
  const coreMaterial = useRef<THREE.MeshStandardMaterial>(null);
  const heroField = useRef<THREE.Group>(null);
  const fieldShell = useRef<THREE.MeshBasicMaterial>(null);
  const scanline = useRef<THREE.Mesh>(null);
  const pulseRing = useRef<THREE.Mesh>(null);
  const displayScale = selected ? 2 : 1;
  const labelY = selected ? -1.08 : -0.45;

  useFrame(({ clock }) => {
    const time = clock.elapsedTime * (reducedMotion ? 0.16 : 1) + phase;
    if (model.current) {
      model.current.position.y = motionEnabled ? Math.sin(time * 1.15) * 0.025 : 0;
      model.current.rotation.y = motionEnabled ? Math.sin(time * 0.34) * 0.17 : 0;
    }
    if (orbit.current) {
      orbit.current.rotation.set(
        Math.PI / 2 + (motionEnabled ? Math.sin(time * 0.24) * 0.08 : 0),
        motionEnabled ? time * 0.34 : 0,
        motionEnabled ? Math.cos(time * 0.2) * 0.08 : 0
      );
    }
    if (heroField.current) {
      heroField.current.rotation.set(
        motionEnabled ? Math.sin(time * 0.27) * 0.11 : 0,
        motionEnabled ? time * 0.16 : 0,
        motionEnabled ? Math.cos(time * 0.21) * 0.08 : 0
      );
    }
    if (fieldShell.current) {
      fieldShell.current.opacity = opacity * (0.18 + (motionEnabled ? Math.sin(time * 1.9) * 0.045 : 0));
    }
    if (scanline.current) {
      scanline.current.position.y = motionEnabled ? Math.sin(time * 1.1) * 0.23 : 0;
    }
    if (pulseRing.current) {
      const pulse = motionEnabled ? 1 + Math.sin(time * 1.7) * 0.055 : 1;
      pulseRing.current.scale.setScalar(pulse);
    }
    if (coreMaterial.current) {
      coreMaterial.current.emissiveIntensity = selected
        ? 5 + (motionEnabled ? Math.sin(time * 2.4) * 1.1 : 0)
        : 1.9 + (motionEnabled ? Math.sin(time * 2.1) * 0.45 : 0);
    }
  });

  const hit = (event: { stopPropagation: () => void }) => {
    event.stopPropagation();
    onSelect(agent.id);
  };

  return (
    <group ref={nodeRef} position={initialPosition.toArray()} onClick={hit}>
      <group scale={densityScale}>
        <group ref={model} scale={displayScale}>
          <mesh>
            <sphereGeometry args={[0.3, 24, 24]} />
            <meshBasicMaterial
              color={selected ? "#8c6cff" : color}
              transparent
              opacity={opacity * (selected ? 0.09 : 0.045)}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
              toneMapped={false}
            />
          </mesh>

          <mesh position={[0, -0.075, 0]} scale={[0.9, 1.12, 0.78]}>
            <sphereGeometry args={[0.145, 24, 20]} />
            <meshPhysicalMaterial
              color="#0b1d2b"
              emissive={color}
              emissiveIntensity={0.38}
              metalness={0.88}
              roughness={0.2}
              clearcoat={0.9}
              clearcoatRoughness={0.18}
              transparent
              opacity={opacity}
            />
          </mesh>
          <mesh position={[0, -0.027, 0]} scale={[1.34, 0.58, 0.88]}>
            <sphereGeometry args={[0.125, 20, 16]} />
            <meshPhysicalMaterial
              color="#17263a"
              emissive={color}
              emissiveIntensity={0.22}
              metalness={0.92}
              roughness={0.24}
              clearcoat={1}
              transparent
              opacity={opacity}
            />
          </mesh>
          <mesh position={[0, 0.067, 0]}>
            <cylinderGeometry args={[0.034, 0.043, 0.058, 14]} />
            <meshStandardMaterial color="#172b3b" metalness={0.86} roughness={0.24} />
          </mesh>
          <mesh position={[0, 0.157, 0]}>
            <sphereGeometry args={[0.096, 24, 20]} />
            <meshPhysicalMaterial
              color="#102638"
              emissive={color}
              emissiveIntensity={0.4}
              metalness={0.76}
              roughness={0.19}
              clearcoat={1}
              transparent
              opacity={opacity}
            />
          </mesh>

          <mesh position={[0, 0.158, 0.079]}>
            <boxGeometry args={[0.167, 0.064, 0.024]} />
            <meshPhysicalMaterial
              color={critical ? "#3c1527" : "#0d5265"}
              emissive={color}
              emissiveIntensity={selected ? 2.5 : 1.7}
              metalness={0.35}
              roughness={0.14}
              clearcoat={1}
              transparent
              opacity={opacity}
            />
          </mesh>
          <mesh position={[0, 0.158, 0.095]}>
            <boxGeometry args={[0.12, 0.006, 0.004]} />
            <meshBasicMaterial color="#e8fcff" transparent opacity={opacity * 0.92} toneMapped={false} />
          </mesh>
          {[-1, 1].map(side => (
            <mesh key={side} position={[side * 0.105, 0.16, 0]}>
              <sphereGeometry args={[0.026, 14, 12]} />
              <meshStandardMaterial
                color="#142b3e"
                emissive={color}
                emissiveIntensity={0.8}
                metalness={0.82}
                roughness={0.2}
              />
            </mesh>
          ))}

          <mesh position={[0, -0.072, 0.126]}>
            <icosahedronGeometry args={[0.043, 1]} />
            <meshStandardMaterial
              ref={coreMaterial}
              color="#c3fbff"
              emissive={color}
              emissiveIntensity={2}
              metalness={0.42}
              roughness={0.13}
              toneMapped={false}
            />
          </mesh>
          <mesh position={[0, -0.072, 0.124]}>
            <torusGeometry args={[0.064, 0.004, 6, 32]} />
            <meshBasicMaterial
              color={color}
              transparent
              opacity={opacity * 0.72}
              blending={THREE.AdditiveBlending}
              toneMapped={false}
            />
          </mesh>

          {selected && (
            <group ref={heroField}>
              <mesh scale={[1, 1.24, 0.9]}>
                <icosahedronGeometry args={[0.48, 1]} />
                <meshBasicMaterial
                  ref={fieldShell}
                  color="#70f3ff"
                  wireframe
                  transparent
                  opacity={opacity * 0.18}
                  depthWrite={false}
                  blending={THREE.AdditiveBlending}
                  toneMapped={false}
                />
              </mesh>
              <mesh rotation={[0.52, 0.4, 0.22]} scale={[1.08, 0.94, 1.08]}>
                <icosahedronGeometry args={[0.5, 1]} />
                <meshBasicMaterial
                  color="#a679ff"
                  wireframe
                  transparent
                  opacity={opacity * 0.13}
                  depthWrite={false}
                  blending={THREE.AdditiveBlending}
                  toneMapped={false}
                />
              </mesh>
              <mesh rotation={[Math.PI / 2, 0.08, 0]}>
                <torusGeometry args={[0.57, 0.006, 8, 96]} />
                <meshBasicMaterial color="#56e6ff" transparent opacity={opacity * 0.82} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
              </mesh>
              <mesh rotation={[0.24, 0.3, 1.12]}>
                <torusGeometry args={[0.61, 0.004, 6, 96]} />
                <meshBasicMaterial color="#b58aff" transparent opacity={opacity * 0.7} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
              </mesh>
              <mesh ref={pulseRing} position={[0, -0.4, 0]} rotation={[Math.PI / 2, 0, 0]}>
                <torusGeometry args={[0.49, 0.005, 6, 96]} />
                <meshBasicMaterial color="#55efff" transparent opacity={opacity * 0.6} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
              </mesh>
              <mesh position={[0, -0.04, -0.06]}>
                <cylinderGeometry args={[0.2, 0.44, 0.96, 8, 1, true]} />
                <meshBasicMaterial color="#4be8ff" transparent opacity={opacity * 0.035} side={THREE.DoubleSide} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
              </mesh>
              <mesh ref={scanline} position={[0, 0, 0.46]}>
                <planeGeometry args={[0.48, 0.009]} />
                <meshBasicMaterial color="#e5fdff" transparent opacity={opacity * 0.86} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
              </mesh>
            </group>
          )}

          <group ref={orbit} rotation={[Math.PI / 2, 0, 0]}>
            <mesh>
              <torusGeometry args={[0.34, 0.005, 6, 72]} />
              <meshBasicMaterial
                color={selected ? "#ba9aff" : color}
                transparent
                opacity={opacity * 0.7}
                blending={THREE.AdditiveBlending}
                toneMapped={false}
              />
            </mesh>
            <mesh position={[0.34, 0, 0]}>
              <icosahedronGeometry args={[0.021, 1]} />
              <meshBasicMaterial color="#f2ffff" toneMapped={false} />
            </mesh>
          </group>
          <mesh rotation={[0.68, 0.75, 0.16]}>
            <torusGeometry args={[0.31, 0.0035, 5, 64]} />
            <meshBasicMaterial
              color={selected ? "#56e6ff" : "#a679ff"}
              transparent
              opacity={opacity * 0.42}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
              toneMapped={false}
            />
          </mesh>
          {selected && !emergencyStopped && (
            <pointLight position={[0, 0.08, 0.35]} color="#61efff" intensity={3.1} distance={3.1} />
          )}
        </group>

        <mesh position={[0, labelY, 0.02]}>
          <planeGeometry args={[0.88, 0.13]} />
          <meshBasicMaterial
            color={selected ? "#0d3542" : "#07121f"}
            transparent
            opacity={opacity * (selected ? 0.9 : 0.7)}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
        <Text
          position={[0, labelY, 0.032]}
          fontSize={0.065}
          maxWidth={0.82}
          textAlign="center"
          color={critical ? "#ffb2c0" : "#e1fbff"}
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.004}
          outlineColor="#040914"
          letterSpacing={0.025}
        >
          {agent.name}
        </Text>
      </group>
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

function HolographicStage({
  motionEnabled,
  reducedMotion,
}: {
  motionEnabled: boolean;
  reducedMotion: boolean;
}) {
  const scaffold = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    if (!scaffold.current) return;
    const pace = reducedMotion ? 0.16 : 1;
    scaffold.current.rotation.z = motionEnabled
      ? Math.sin(clock.elapsedTime * 0.08 * pace) * 0.025
      : 0;
    scaffold.current.rotation.y = motionEnabled
      ? Math.sin(clock.elapsedTime * 0.07 * pace) * 0.06
      : 0;
  });

  return (
    <group ref={scaffold} position={[0, 0, -1.2]}>
      <mesh>
        <torusGeometry args={[2.78, 0.0045, 5, 128]} />
        <meshBasicMaterial
          color="#56e6ff"
          transparent
          opacity={0.11}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0.34, 0]}>
        <torusGeometry args={[2.62, 0.0035, 5, 112]} />
        <meshBasicMaterial
          color="#a679ff"
          transparent
          opacity={0.095}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
      <mesh rotation={[0.18, 0.42, 0.9]}>
        <torusGeometry args={[2.9, 0.0025, 4, 128]} />
        <meshBasicMaterial
          color="#6da9cd"
          transparent
          opacity={0.055}
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
  const selectedIndex = graphAgents.findIndex(agent => agent.id === selectedId);
  const densityScale = Math.max(
    0.58,
    1 - Math.max(0, graphAgents.length - 10) * 0.018
  );
  const states = useMemo(
    () =>
      graphAgents.map((_, index) => {
        if (index === selectedIndex) {
          return {
            position: new THREE.Vector3(0, 0, 0),
            home: new THREE.Vector3(0, 0, 0),
            velocity: new THREE.Vector3(),
            phase: index * 1.37,
          };
        }
        const orbitCount = graphAgents.length - (selectedIndex >= 0 ? 1 : 0);
        const orbitIndex = selectedIndex >= 0 && index > selectedIndex ? index - 1 : index;
        const angle =
          (orbitIndex / Math.max(1, orbitCount)) * Math.PI * 2 - Math.PI / 2;
        const radius =
          1.92 +
          Math.min(0.72, Math.max(0, orbitCount - 8) * 0.055) +
          (orbitIndex % 3) * 0.14;
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
    [graphAgents.length, selectedIndex]
  );
  const edges = useMemo(() => {
    const result: Array<[number, number]> = [];
    const count = graphAgents.length;
    if (count < 2) return result;
    if (selectedIndex >= 0) {
      const orbitIndexes = graphAgents
        .map((_, index) => index)
        .filter(index => index !== selectedIndex);
      orbitIndexes.forEach(index => result.push([selectedIndex, index]));
      if (orbitIndexes.length > 2) {
        for (let index = 0; index < orbitIndexes.length; index += 1) {
          result.push([
            orbitIndexes[index],
            orbitIndexes[(index + 1) % orbitIndexes.length],
          ]);
        }
      }
      return result;
    }
    for (let index = 0; index < count; index += 1) {
      result.push([index, (index + 1) % count]);
      if (index % 2 === 0 && count > 4)
        result.push([index, (index + 2) % count]);
    }
    return result;
  }, [graphAgents, selectedIndex]);

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
          motionEnabled={motionEnabled}
          reducedMotion={reducedMotion}
          phase={index * 1.37}
          densityScale={densityScale}
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
}: NeuralCoreSceneProps) {
  const reducedMotion = useReducedMotion();
  const motionEnabled = running && !emergencyStopped;
  const ambientGeometry = useMemo(makeAmbientParticles, []);
  const graphAgents = useMemo<GraphAgent[]>(() => agents, [agents]);

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
      <HolographicStage
        motionEnabled={motionEnabled}
        reducedMotion={reducedMotion}
      />
      <NetworkGraph
        graphAgents={graphAgents}
        selectedId={selectedId}
        running={running}
        emergencyStopped={emergencyStopped}
        isolatedAgentId={isolatedAgentId}
        reducedMotion={reducedMotion}
        onSelectAgent={onSelectAgent}
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
