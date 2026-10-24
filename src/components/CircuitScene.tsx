import { ContactShadows, Grid, Line, OrbitControls, PerspectiveCamera, RoundedBox, Text } from '@react-three/drei'
import { Canvas, useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import type { Group, Mesh } from 'three'
import type { CircuitComponent, CircuitLayer, CircuitWire } from '../types/circuit'

const LAYER_COLORS: Record<CircuitLayer, string> = {
  power: '#b66b0a',
  signal: '#087f70',
  ground: '#637873',
}

interface SceneProps {
  components: CircuitComponent[]
  wires: CircuitWire[]
  selectedId: string | null
  activeLayers: Record<CircuitLayer, boolean>
  simulating: boolean
  onSelect: (id: string | null) => void
}

function Pins({ count, span = 1.2 }: { count: number; span?: number }) {
  const sideCount = Math.max(1, Math.ceil(count / 2))
  return <>
    {Array.from({ length: sideCount }).map((_, index) => {
      const z = sideCount === 1 ? 0 : -span / 2 + (index * span) / (sideCount - 1)
      return <group key={index}>
        <mesh position={[-0.72, 0.16, z]}><boxGeometry args={[0.42, 0.08, 0.1]} /><meshStandardMaterial color="#aab2b0" metalness={0.85} roughness={0.2} /></mesh>
        {index + sideCount < count && <mesh position={[0.72, 0.16, z]}><boxGeometry args={[0.42, 0.08, 0.1]} /><meshStandardMaterial color="#aab2b0" metalness={0.85} roughness={0.2} /></mesh>}
      </group>
    })}
  </>
}

function PartShape({ component, selected, simulating, onSelect }: { component: CircuitComponent; selected: boolean; simulating: boolean; onSelect: () => void }) {
  const group = useRef<Group>(null)
  const pulse = useRef<Mesh>(null)
  useFrame(({ clock }) => {
    if (group.current && selected) group.current.position.y = 0.05 + Math.sin(clock.elapsedTime * 3) * 0.025
    if (pulse.current && component.kind === 'led') {
      const strength = simulating ? 0.65 + Math.sin(clock.elapsedTime * 5) * 0.3 : 0.15
      const material = pulse.current.material as import('three').MeshStandardMaterial
      material.emissiveIntensity = strength
    }
  })

  const body = (() => {
    switch (component.kind) {
      case 'resistor':
        return <group rotation={[0, 0, Math.PI / 2]}>
          <mesh><cylinderGeometry args={[0.22, 0.22, 1.2, 18]} /><meshStandardMaterial color="#d3b47f" roughness={0.5} /></mesh>
          {[-0.28, -0.08, 0.12, 0.32].map((y, i) => <mesh key={y} position={[0, y, 0]}><cylinderGeometry args={[0.225, 0.225, 0.07, 18]} /><meshStandardMaterial color={['#7f3d26', '#222a2d', '#d74438', '#d8ad3b'][i]} /></mesh>)}
          <mesh position={[0, -0.95, 0]}><cylinderGeometry args={[0.035, 0.035, 0.7, 8]} /><meshStandardMaterial color="#b9c1c0" metalness={0.8} /></mesh>
          <mesh position={[0, 0.95, 0]}><cylinderGeometry args={[0.035, 0.035, 0.7, 8]} /><meshStandardMaterial color="#b9c1c0" metalness={0.8} /></mesh>
        </group>
      case 'capacitor':
        return <group>
          <mesh position={[0, 0.45, 0]}><cylinderGeometry args={[0.36, 0.36, 0.9, 24]} /><meshStandardMaterial color="#3f5660" metalness={0.35} roughness={0.35} /></mesh>
          <mesh position={[0, 0.91, 0]}><cylinderGeometry args={[0.32, 0.32, 0.03, 24]} /><meshStandardMaterial color="#9aa4a6" metalness={0.8} /></mesh>
          <mesh position={[-0.13, -0.14, 0]}><cylinderGeometry args={[0.025, 0.025, 0.55, 8]} /><meshStandardMaterial color="#aeb7b5" metalness={0.8} /></mesh>
          <mesh position={[0.13, -0.14, 0]}><cylinderGeometry args={[0.025, 0.025, 0.55, 8]} /><meshStandardMaterial color="#aeb7b5" metalness={0.8} /></mesh>
        </group>
      case 'led':
        return <group>
          <mesh ref={pulse} position={[0, 0.48, 0]}><sphereGeometry args={[0.38, 24, 24, 0, Math.PI * 2, 0, Math.PI / 1.7]} /><meshStandardMaterial color={component.color} transparent opacity={0.8} emissive={component.color} emissiveIntensity={0.2} /></mesh>
          <mesh position={[0, 0.18, 0]}><cylinderGeometry args={[0.38, 0.38, 0.18, 24]} /><meshStandardMaterial color={component.color} transparent opacity={0.65} /></mesh>
          <mesh position={[-0.13, -0.15, 0]}><cylinderGeometry args={[0.025, 0.025, 0.62, 8]} /><meshStandardMaterial color="#aeb7b5" metalness={0.8} /></mesh>
          <mesh position={[0.13, -0.23, 0]}><cylinderGeometry args={[0.025, 0.025, 0.78, 8]} /><meshStandardMaterial color="#aeb7b5" metalness={0.8} /></mesh>
        </group>
      case 'power':
        return <group><RoundedBox args={[1.25, 0.58, 1.05]} radius={0.12}><meshStandardMaterial color="#b87622" metalness={0.3} roughness={0.35} /></RoundedBox><mesh position={[0, 0.31, 0]}><boxGeometry args={[0.65, 0.04, 0.5]} /><meshStandardMaterial color="#202628" /></mesh><Text position={[0, 0.345, 0]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.18} color="#ffc45e">DC</Text></group>
      case 'ground':
        return <group><mesh position={[0, 0.34, 0]}><coneGeometry args={[0.42, 0.68, 4]} /><meshStandardMaterial color="#758184" metalness={0.45} /></mesh><mesh position={[0, 0.02, 0]}><cylinderGeometry args={[0.03, 0.03, 0.5, 8]} /><meshStandardMaterial color="#aab4b4" metalness={0.8} /></mesh></group>
      case 'switch':
        return <group><RoundedBox args={[1.15, 0.36, 0.85]} radius={0.1}><meshStandardMaterial color="#3a4447" /></RoundedBox><mesh position={[0, 0.38, 0]} rotation={[0, 0, -0.45]}><boxGeometry args={[0.16, 0.65, 0.16]} /><meshStandardMaterial color="#d6d9d5" metalness={0.6} /></mesh><Pins count={2} span={0} /></group>
      case 'sensor':
        return <group><RoundedBox args={[1.3, 0.22, 1.05]} radius={0.08}><meshStandardMaterial color="#1a7563" metalness={0.1} roughness={0.5} /></RoundedBox><mesh position={[0, 0.26, 0]}><boxGeometry args={[0.58, 0.3, 0.55]} /><meshStandardMaterial color="#1d2527" /></mesh><mesh position={[0, 0.42, 0]}><circleGeometry args={[0.17, 20]} /><meshStandardMaterial color="#54cbb0" emissive="#2aa68e" emissiveIntensity={0.35} /></mesh><Pins count={3} /></group>
      default:
        return <group><RoundedBox args={[1.55, 0.42, 1.35]} radius={0.12}><meshStandardMaterial color="#1c2224" roughness={0.42} metalness={0.25} /></RoundedBox><mesh position={[0, 0.235, 0]}><circleGeometry args={[0.1, 18]} /><meshStandardMaterial color="#5c6668" /></mesh><Pins count={component.pins} span={1} /></group>
    }
  })()

  return <group ref={group} position={component.position} rotation={[0, component.rotation ?? 0, 0]} onClick={(event) => { event.stopPropagation(); onSelect() }}>
    {selected && <mesh position={[0, -0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[0.75, 0.92, 32]} /><meshBasicMaterial color="#42e8d1" transparent opacity={0.7} /></mesh>}
    {body}
    <Text position={[0, 1.35, 0]} fontSize={0.24} color={selected ? '#087f70' : '#263d39'} anchorY="middle" outlineWidth={0.008} outlineColor="#ffffff">{component.label}</Text>
  </group>
}

function RoutedWire({ wire, components, active, simulating }: { wire: CircuitWire; components: CircuitComponent[]; active: boolean; simulating: boolean }) {
  const from = components.find((item) => item.id === wire.from)
  const to = components.find((item) => item.id === wire.to)
  const line = useRef<any>(null)
  useFrame((_, delta) => {
    if (line.current?.material && simulating) line.current.material.dashOffset -= delta * 0.8
  })
  if (!from || !to || !active) return null
  const [x1, , z1] = from.position
  const [x2, , z2] = to.position
  const offset = wire.layer === 'power' ? 0.12 : wire.layer === 'ground' ? -0.1 : 0
  const points: Array<[number, number, number]> = [[x1, 0.1 + offset, z1], [x1, 0.1 + offset, (z1 + z2) / 2], [x2, 0.1 + offset, (z1 + z2) / 2], [x2, 0.1 + offset, z2]]
  return <Line ref={line} points={points} color={LAYER_COLORS[wire.layer]} lineWidth={simulating ? 2.7 : 1.7} dashed={simulating} dashScale={5} dashSize={0.3} gapSize={0.22} transparent opacity={simulating ? 0.95 : 0.66} />
}

function Board({ scene }: { scene: SceneProps }) {
  const visibleWires = useMemo(() => scene.wires.filter((wire) => scene.activeLayers[wire.layer]), [scene.wires, scene.activeLayers])
  return <>
    <color attach="background" args={['#f3f7f6']} />
    <fog attach="fog" args={['#f3f7f6', 13, 28]} />
    <ambientLight intensity={0.65} />
    <directionalLight position={[-4, 9, 3]} intensity={2.4} color="#e9fff9" castShadow />
    <pointLight position={[6, 4, -3]} intensity={8} distance={15} color="#c1e9df" />
    <PerspectiveCamera makeDefault position={[8.2, 8.7, 10.6]} fov={42} />
    <group onPointerMissed={() => scene.onSelect(null)}>
      <RoundedBox position={[0, -0.22, 0]} args={[11.8, 0.32, 7.4]} radius={0.22} receiveShadow>
        <meshStandardMaterial color="#e2eae5" metalness={0.12} roughness={0.75} />
      </RoundedBox>
      <Grid position={[0, -0.045, 0]} args={[11.2, 6.8]} cellSize={0.5} cellThickness={0.6} cellColor="#c2d3cb" sectionSize={2} sectionThickness={0.8} sectionColor="#91b1a3" fadeDistance={13} fadeStrength={1.4} infiniteGrid={false} />
      {visibleWires.map((wire) => <RoutedWire key={wire.id} wire={wire} components={scene.components} active simulating={scene.simulating} />)}
      {scene.components.map((component) => <PartShape key={component.id} component={component} selected={scene.selectedId === component.id} simulating={scene.simulating} onSelect={() => scene.onSelect(component.id)} />)}
    </group>
    <ContactShadows position={[0, -0.04, 0]} opacity={0.5} scale={16} blur={2.2} far={5} />
    <OrbitControls makeDefault target={[0, 0.25, 0]} minDistance={7} maxDistance={20} maxPolarAngle={Math.PI / 2.15} enableDamping dampingFactor={0.08} />
  </>
}

export default function CircuitScene(props: SceneProps) {
  return <Canvas shadows dpr={[1, 1.6]} gl={{ antialias: true }}>
    <Board scene={props} />
  </Canvas>
}
