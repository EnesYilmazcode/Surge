import { RoundedBox } from '@react-three/drei'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { CanvasTexture, InstancedMesh, Object3D, SRGBColorSpace } from 'three'
import { BOARD_COLUMNS, BOARD_DEPTH, BOARD_HOLES, BOARD_ROWS, BOARD_WIDTH, HOLE_PITCH } from '../data/breadboard'

function createBoardTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 2048
  canvas.height = 1280
  const context = canvas.getContext('2d')!
  const x = (value: number) => (value / BOARD_WIDTH + 0.5) * canvas.width
  const z = (value: number) => (value / BOARD_DEPTH + 0.5) * canvas.height
  context.fillStyle = '#f4f0e7'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = '#ece6da'
  context.fillRect(x(-5.6), z(-2.14), x(5.6) - x(-5.6), z(-0.32) - z(-2.14))
  context.fillRect(x(-5.6), z(0.32), x(5.6) - x(-5.6), z(2.14) - z(0.32))

  const channel = context.createLinearGradient(0, z(-0.22), 0, z(0.22))
  channel.addColorStop(0, '#c7bead')
  channel.addColorStop(0.4, '#aba18f')
  channel.addColorStop(1, '#ddd4c4')
  context.fillStyle = channel
  context.fillRect(x(-5.75), z(-0.22), x(5.75) - x(-5.75), z(0.22) - z(-0.22))

  context.font = '600 25px ui-monospace, monospace'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  for (const row of BOARD_ROWS) {
    const rail = 'polarity' in row
    const positive = rail && row.polarity === 'positive'
    context.fillStyle = rail ? (positive ? '#bd5549' : '#4c79ad') : '#786e5c'
    const label = rail ? (positive ? '+' : '−') : row.id.toUpperCase()
    context.fillText(label, x(-5.8), z(row.z))
    context.fillText(label, x(5.8), z(row.z))
    if (rail) {
      context.fillRect(x(-5.5), z(row.z - 0.14), x(5.5) - x(-5.5), 3)
    }
  }
  context.fillStyle = '#786e5c'
  context.font = '500 21px ui-monospace, monospace'
  for (let column = 1; column <= BOARD_COLUMNS; column++) {
    if (column !== 1 && column % 5 !== 0) continue
    const px = x((column - 1 - (BOARD_COLUMNS - 1) / 2) * HOLE_PITCH)
    context.fillText(String(column), px, z(-2.32))
    context.fillText(String(column), px, z(2.32))
  }
  context.fillStyle = '#918675'
  context.font = '600 19px ui-monospace, monospace'
  context.fillText('SURGE  /  30 COLUMN BREADBOARD', x(0), z(3.52))
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

export default function BreadboardModel({ onSurfaceClick }: { onSurfaceClick: (x: number, z: number) => void }) {
  const sockets = useRef<InstancedMesh>(null)
  const rims = useRef<InstancedMesh>(null)
  const texture = useMemo(createBoardTexture, [])
  useEffect(() => () => texture.dispose(), [texture])

  useLayoutEffect(() => {
    const transform = new Object3D()
    BOARD_HOLES.forEach((hole, index) => {
      transform.position.set(hole.x, 0.012, hole.z)
      transform.updateMatrix()
      rims.current!.setMatrixAt(index, transform.matrix)
      transform.position.y = 0.023
      transform.updateMatrix()
      sockets.current!.setMatrixAt(index, transform.matrix)
    })
    rims.current!.instanceMatrix.needsUpdate = true
    sockets.current!.instanceMatrix.needsUpdate = true
  }, [])

  return <group onClick={(event) => { event.stopPropagation(); onSurfaceClick(event.point.x, event.point.z) }}>
    <RoundedBox position={[0, -0.245, 0]} args={[BOARD_WIDTH, 0.48, BOARD_DEPTH]} radius={0.12} receiveShadow>
      <meshStandardMaterial color="#e4ddcf" roughness={0.85} />
    </RoundedBox>
    <mesh position={[0, 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[BOARD_WIDTH - 0.16, BOARD_DEPTH - 0.16]} />
      <meshStandardMaterial map={texture} roughness={0.9} />
    </mesh>
    <instancedMesh ref={rims} args={[undefined, undefined, BOARD_HOLES.length]}>
      <boxGeometry args={[0.147, 0.014, 0.147]} />
      <meshStandardMaterial color="#bfb4a0" roughness={0.75} />
    </instancedMesh>
    <instancedMesh ref={sockets} args={[undefined, undefined, BOARD_HOLES.length]}>
      <boxGeometry args={[0.088, 0.012, 0.088]} />
      <meshStandardMaterial color="#393a35" roughness={0.95} />
    </instancedMesh>
  </group>
}
