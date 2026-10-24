import type { CircuitComponent, CircuitDesign, CircuitWire, ComponentKind, CircuitLayer } from '../types/circuit'

export const MAX_PROJECT_BYTES = 2 * 1024 * 1024
const kinds: ComponentKind[] = ['power', 'resistor', 'capacitor', 'led', 'ic', 'sensor', 'switch', 'ground']
const layers: CircuitLayer[] = ['power', 'signal', 'ground']

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The file contains an invalid circuit structure.')
  }
  return value as Record<string, unknown>
}

function text(value: unknown, field: string, max = 500, allowEmpty = true): string {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim())) {
    throw new Error(`Invalid ${field} in circuit file.`)
  }
  return value
}

function finite(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid ${field} in circuit file.`)
  }
  return value
}

export function validateDesign(value: unknown): CircuitDesign {
  const design = record(value)
  if (!Array.isArray(design.components) || design.components.length > 500 ||
      !Array.isArray(design.wires) || design.wires.length > 2000) {
    throw new Error('A circuit must contain at most 500 components and 2,000 wires.')
  }

  const componentIds = new Set<string>()
  const components: CircuitComponent[] = design.components.map((value) => {
    const part = record(value)
    const id = text(part.id, 'component ID', 100, false)
    if (componentIds.has(id)) throw new Error('Component IDs must be unique.')
    componentIds.add(id)
    if (!kinds.includes(part.kind as ComponentKind)) throw new Error('Unknown component kind.')
    if (!Array.isArray(part.position) || part.position.length !== 3) throw new Error('Invalid component position.')
    const position = part.position.map((axis) => finite(axis, 'position'))
    if (position.some((axis) => Math.abs(axis) > 1000)) throw new Error('Component position is outside the workspace limits.')
    const pins = finite(part.pins, 'pin count')
    if (!Number.isInteger(pins) || pins < 1 || pins > 64) throw new Error('Pin count must be between 1 and 64.')
    const color = text(part.color, 'component color', 9, false)
    if (!/^#[\da-f]{6}$/i.test(color)) throw new Error('Component colors must use six-digit hex values.')

    return {
      id,
      kind: part.kind as ComponentKind,
      label: text(part.label, 'component reference', 100),
      value: text(part.value, 'component value', 100),
      description: text(part.description, 'component description'),
      position: position as [number, number, number],
      ...(part.rotation === undefined ? {} : { rotation: finite(part.rotation, 'rotation') }),
      pins,
      color,
    }
  })

  const wireIds = new Set<string>()
  const wires: CircuitWire[] = design.wires.map((value) => {
    const wire = record(value)
    const id = text(wire.id, 'wire ID', 100, false)
    if (wireIds.has(id)) throw new Error('Wire IDs must be unique.')
    wireIds.add(id)
    const from = text(wire.from, 'wire source', 100, false)
    const to = text(wire.to, 'wire destination', 100, false)
    if (!componentIds.has(from) || !componentIds.has(to)) throw new Error('A wire references a missing component.')
    if (!layers.includes(wire.layer as CircuitLayer)) throw new Error('Unknown wire layer.')
    return {
      id, from, to, layer: wire.layer as CircuitLayer,
      ...(wire.voltage === undefined ? {} : { voltage: finite(wire.voltage, 'wire voltage') }),
    }
  })

  return {
    name: text(design.name, 'project name', 200),
    description: text(design.description, 'project description', 2000),
    components,
    wires,
  }
}

export function serializeProject(design: CircuitDesign): string {
  return JSON.stringify({ format: 'surge-circuit', version: 1, design: validateDesign(design) }, null, 2)
}

export function parseProject(contents: string): CircuitDesign {
  if (new TextEncoder().encode(contents).byteLength > MAX_PROJECT_BYTES) {
    throw new Error('Choose a circuit file smaller than 2 MB.')
  }
  let value: unknown
  try {
    value = JSON.parse(contents)
  } catch {
    throw new Error('This file is not valid JSON. Choose an exported Surge circuit.')
  }
  const file = record(value)
  if (file.format !== 'surge-circuit') throw new Error('Choose a Surge circuit file.')
  if (file.version !== 1) throw new Error('This circuit file uses an unsupported version.')
  return validateDesign(file.design)
}

export function projectFilename(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80)
  return `${slug || 'untitled'}.surge.json`
}
