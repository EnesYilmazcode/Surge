export type ComponentKind = 'power' | 'resistor' | 'capacitor' | 'led' | 'ic' | 'sensor' | 'switch' | 'ground'
export type CircuitLayer = 'power' | 'signal' | 'ground'

export interface CircuitComponent {
  id: string
  kind: ComponentKind
  label: string
  value: string
  description: string
  position: [number, number, number]
  rotation?: number
  pins: number
  color: string
}

export interface CircuitWire {
  id: string
  from: string
  to: string
  layer: CircuitLayer
  voltage?: number
}

export interface CircuitDesign {
  name: string
  description: string
  components: CircuitComponent[]
  wires: CircuitWire[]
}

export interface SimulationResult {
  voltageIn: number
  voltageOut: number
  current: number
  power: number
  efficiency: number
  status: 'nominal' | 'warning' | 'error'
  warnings: string[]
  nodeCount: number
}
