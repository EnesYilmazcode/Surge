export const BOARD_COLUMNS = 30
export const HOLE_PITCH = 0.36
export const BOARD_WIDTH = 12.2
export const BOARD_DEPTH = 7.5

export const BOARD_ROWS = [
  { id: 'top-plus', z: -3.08, polarity: 'positive' },
  { id: 'top-minus', z: -2.72, polarity: 'negative' },
  { id: 'a', z: -1.95 }, { id: 'b', z: -1.59 }, { id: 'c', z: -1.23 },
  { id: 'd', z: -0.87 }, { id: 'e', z: -0.51 },
  { id: 'f', z: 0.51 }, { id: 'g', z: 0.87 }, { id: 'h', z: 1.23 },
  { id: 'i', z: 1.59 }, { id: 'j', z: 1.95 },
  { id: 'bottom-plus', z: 2.72, polarity: 'positive' },
  { id: 'bottom-minus', z: 3.08, polarity: 'negative' },
] as const

export interface BoardHole {
  id: string
  row: string
  column: number
  x: number
  z: number
  node: string
}

export const BOARD_HOLES: BoardHole[] = BOARD_ROWS.flatMap((row) =>
  Array.from({ length: BOARD_COLUMNS }, (_, index) => ({
    id: `${row.id}:${index + 1}`,
    row: row.id,
    column: index + 1,
    x: (index - (BOARD_COLUMNS - 1) / 2) * HOLE_PITCH,
    z: row.z,
    node: row.id.includes('-') ? row.id : `${row.z < 0 ? 'upper' : 'lower'}:${index + 1}`,
  })),
)

export function nearestHole(x: number, z: number): BoardHole | null {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null
  let nearest: BoardHole | null = null
  let distance = 0.27
  for (const hole of BOARD_HOLES) {
    const next = Math.hypot(hole.x - x, hole.z - z)
    if (next < distance) { nearest = hole; distance = next }
  }
  return nearest
}
