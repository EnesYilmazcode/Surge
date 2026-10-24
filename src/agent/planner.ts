import { COMPONENT_LIBRARY } from '../data/library'
import type { CircuitComponent, CircuitDesign, CircuitWire, ComponentKind } from '../types/circuit'

const makePart = (kind: ComponentKind, label: string, value: string, position: [number, number, number], index: number): CircuitComponent => {
  const source = COMPONENT_LIBRARY.find((item) => item.kind === kind)!
  return { id: `${label.toLowerCase()}-${index}-${Date.now()}`, kind, label, value, position, pins: source.pins, color: source.color, description: source.detail }
}

const connect = (components: CircuitComponent[], layers: Array<'power' | 'signal' | 'ground'>): CircuitWire[] =>
  components.slice(0, -1).map((item, index) => ({
    id: `agent-wire-${Date.now()}-${index}`,
    from: item.id,
    to: components[index + 1].id,
    layer: layers[index % layers.length],
  }))

export interface AgentPlan {
  design: CircuitDesign
  summary: string
  steps: string[]
}

export function planCircuit(prompt: string): AgentPlan {
  const text = prompt.toLowerCase()
  let name = 'Regulated sensor interface'
  let description = 'A stable mixed-signal reference design generated from your design intent.'
  let specs: Array<[ComponentKind, string, string]> = [
    ['power', 'VIN', '12 V'], ['capacitor', 'C1', '100 µF'], ['sensor', 'SENSE', 'TMP36'],
    ['resistor', 'R1', '10 kΩ'], ['ic', 'U1', 'LM358'], ['led', 'STATUS', '2.1 V'], ['ground', 'GND', '0 V'],
  ]

  if (text.includes('motor') || text.includes('fan')) {
    name = 'Protected motor driver'
    description = 'PWM motor stage with input conditioning and flyback protection.'
    specs = [['power', 'VIN', '12 V'], ['capacitor', 'C1', '220 µF'], ['resistor', 'R1', '1 kΩ'], ['ic', 'U1', 'DRV8871'], ['switch', 'PWM', '20 kHz'], ['led', 'RUN', 'Green'], ['ground', 'GND', '0 V']]
  } else if (text.includes('blink') || text.includes('timer') || text.includes('pulse')) {
    name = 'Precision pulse generator'
    description = 'Adjustable astable timer with a buffered visual output.'
    specs = [['power', 'VIN', '5 V'], ['capacitor', 'C1', '10 µF'], ['resistor', 'R1', '1 kΩ'], ['resistor', 'R2', '47 kΩ'], ['ic', 'U1', 'NE555'], ['led', 'PULSE', 'Red'], ['ground', 'GND', '0 V']]
  } else if (text.includes('solar') || text.includes('battery') || text.includes('charge')) {
    name = 'Solar battery conditioner'
    description = 'A protected low-power charging path with status indication.'
    specs = [['power', 'PANEL', '12 V'], ['capacitor', 'CIN', '220 µF'], ['ic', 'REG', 'MPPT buck'], ['sensor', 'MON', 'INA219'], ['resistor', 'RSET', '0.1 Ω'], ['led', 'CHARGE', 'Amber'], ['capacitor', 'COUT', '100 µF'], ['ground', 'GND', '0 V']]
  } else if (text.includes('audio') || text.includes('amplifier')) {
    name = 'Low-noise audio preamp'
    description = 'AC-coupled signal stage with biasing and output filtering.'
    specs = [['power', 'VIN', '9 V'], ['capacitor', 'CIN', '1 µF'], ['resistor', 'RBIAS', '100 kΩ'], ['ic', 'U1', 'NE5532'], ['resistor', 'RF', '10 kΩ'], ['capacitor', 'COUT', '10 µF'], ['ground', 'GND', '0 V']]
  }

  const positions: Array<[number, number, number]> = [[-4.5, 0, -1.8], [-2.8, 0, -1.8], [-1.1, 0, -0.8], [0.8, 0, -0.8], [-0.2, 0, 1.8], [1.9, 0, 1.8], [3.7, 0, 1.2], [4.3, 0, -1.8]]
  const components = specs.map(([kind, label, value], index) => makePart(kind, label, value, positions[index], index))
  const wires = connect(components, ['power', 'signal', 'signal', 'ground'])
  if (components.length > 4) wires.push({ id: `return-${Date.now()}`, from: components[components.length - 1].id, to: components[1].id, layer: 'ground' })

  return {
    design: { name, description, components, wires },
    summary: `Built ${name.toLowerCase()} with ${components.length} parts and ${wires.length} routed connections.`,
    steps: ['Interpreted electrical intent', 'Selected compatible parts', 'Routed power and signal nets', 'Prepared the design for simulation'],
  }
}
