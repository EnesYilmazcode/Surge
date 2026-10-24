import { validateDesign } from '../data/project-file.ts'
import { nearestHole } from '../data/breadboard.ts'
import { COMPONENT_LIBRARY } from '../data/library.ts'
import type { CircuitDesign, ComponentKind, CircuitLayer } from '../types/circuit'

export type CircuitAction =
  | { type: 'add_component'; id: string; kind: ComponentKind; label: string; value: string; x: number; z: number }
  | { type: 'update_component'; id: string; label?: string; value?: string }
  | { type: 'remove_component'; id: string }
  | { type: 'add_wire'; id: string; from: string; to: string; layer: CircuitLayer }
  | { type: 'remove_wire'; id: string }

export interface AgentReply { reply: string; actions: CircuitAction[] }

export function parseAgentReply(value: unknown): AgentReply {
  if (!value || typeof value !== 'object') throw new Error('Surge returned an unreadable response.')
  const result = value as Record<string, unknown>
  if (typeof result.reply !== 'string' || !result.reply.trim() || result.reply.length > 16000 ||
      !Array.isArray(result.actions) || result.actions.length > 30) {
    throw new Error('Surge returned an invalid response. Try a smaller request.')
  }
  return { reply: result.reply, actions: result.actions as CircuitAction[] }
}

export function applyCircuitActions(design: CircuitDesign, actions: CircuitAction[]): CircuitDesign {
  if (!Array.isArray(actions) || actions.length > 30) throw new Error('A proposal can contain at most 30 changes.')
  const next = structuredClone(design)
  for (const action of actions) {
    if (!action || typeof action !== 'object' || typeof action.id !== 'string' || !action.id.trim()) {
      throw new Error('Invalid change in circuit proposal.')
    }
    switch (action.type) {
      case 'add_component': {
        if (next.components.some((item) => item.id === action.id)) throw new Error('Proposed component ID already exists.')
        const part = COMPONENT_LIBRARY.find((item) => item.kind === action.kind)
        const hole = nearestHole(action.x, action.z)
        if (!part || !hole) throw new Error('A proposed component cannot be placed on this breadboard.')
        next.components.push({
          id: action.id, kind: action.kind, label: action.label, value: action.value,
          description: part.detail, pins: part.pins, color: part.color, position: [hole.x, 0, hole.z],
        })
        break
      }
      case 'update_component': {
        const part = next.components.find((item) => item.id === action.id)
        if (!part) throw new Error('The proposed component no longer exists.')
        if (action.label !== undefined) part.label = action.label
        if (action.value !== undefined) part.value = action.value
        break
      }
      case 'remove_component': {
        if (!next.components.some((item) => item.id === action.id)) throw new Error('The proposed component no longer exists.')
        next.components = next.components.filter((item) => item.id !== action.id)
        next.wires = next.wires.filter((wire) => wire.from !== action.id && wire.to !== action.id)
        break
      }
      case 'add_wire':
        next.wires.push({ id: action.id, from: action.from, to: action.to, layer: action.layer })
        break
      case 'remove_wire':
        if (!next.wires.some((wire) => wire.id === action.id)) throw new Error('The proposed wire no longer exists.')
        next.wires = next.wires.filter((wire) => wire.id !== action.id)
        break
      default: throw new Error('Surge proposed an unsupported change.')
    }
  }
  return validateDesign(next)
}
