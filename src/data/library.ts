import type { CircuitComponent, CircuitDesign, ComponentKind } from '../types/circuit'

export const COMPONENT_LIBRARY: Array<{ kind: ComponentKind; name: string; detail: string; value: string; color: string; pins: number }> = [
  { kind: 'power', name: 'DC Source', detail: 'Regulated supply', value: '12 V', color: '#ffb33b', pins: 2 },
  { kind: 'resistor', name: 'Resistor', detail: 'Axial, 1%', value: '1 kΩ', color: '#d6b27a', pins: 2 },
  { kind: 'capacitor', name: 'Capacitor', detail: 'Low ESR', value: '100 µF', color: '#8ea7b5', pins: 2 },
  { kind: 'led', name: 'LED', detail: 'Indicator', value: '2.1 V', color: '#ff654f', pins: 2 },
  { kind: 'ic', name: 'Logic IC', detail: 'DIP-8 package', value: 'NE555', color: '#20272a', pins: 8 },
  { kind: 'sensor', name: 'Sensor', detail: 'Analog module', value: 'TMP36', color: '#2d7d68', pins: 3 },
  { kind: 'switch', name: 'Switch', detail: 'Momentary input', value: 'SPST', color: '#767d80', pins: 2 },
  { kind: 'ground', name: 'Ground', detail: 'Reference node', value: '0 V', color: '#7a8a8f', pins: 1 },
]

const part = (id: string, kind: ComponentKind, label: string, value: string, position: [number, number, number], rotation = 0): CircuitComponent => {
  const source = COMPONENT_LIBRARY.find((item) => item.kind === kind)!
  return { id, kind, label, value, position, rotation, pins: source.pins, color: source.color, description: source.detail }
}

export const STARTER_DESIGN: CircuitDesign = {
  name: 'Ambient light controller',
  description: 'Photo-sensing threshold circuit with a clean, regulated output stage.',
  components: [
    part('vin', 'power', 'VIN', '9 V', [-4.5, 0, -1.7]),
    part('c1', 'capacitor', 'C1', '100 µF', [-2.8, 0, -1.7]),
    part('r1', 'resistor', 'R1', '10 kΩ', [-1.1, 0, -0.5], Math.PI / 2),
    part('ldr', 'sensor', 'LDR1', '10–100 kΩ', [0.7, 0, -0.5]),
    part('u1', 'ic', 'U1', 'LM358', [0, 0, 1.8]),
    part('r2', 'resistor', 'R2', '330 Ω', [2.2, 0, 1.8]),
    part('led1', 'led', 'LED1', 'Warm white', [4.1, 0, 1.8]),
    part('gnd', 'ground', 'GND', '0 V', [3.4, 0, -1.8]),
  ],
  wires: [
    { id: 'w1', from: 'vin', to: 'c1', layer: 'power', voltage: 9 },
    { id: 'w2', from: 'c1', to: 'r1', layer: 'power', voltage: 8.9 },
    { id: 'w3', from: 'r1', to: 'ldr', layer: 'signal', voltage: 4.2 },
    { id: 'w4', from: 'ldr', to: 'u1', layer: 'signal', voltage: 3.6 },
    { id: 'w5', from: 'u1', to: 'r2', layer: 'signal', voltage: 5 },
    { id: 'w6', from: 'r2', to: 'led1', layer: 'signal', voltage: 2.1 },
    { id: 'w7', from: 'led1', to: 'gnd', layer: 'ground', voltage: 0 },
    { id: 'w8', from: 'c1', to: 'gnd', layer: 'ground', voltage: 0 },
  ],
}

export function createComponent(kind: ComponentKind, index: number): CircuitComponent {
  const source = COMPONENT_LIBRARY.find((item) => item.kind === kind)!
  const col = (index % 4) - 1.5
  const row = Math.floor(index / 4) - 0.5
  return {
    id: `${kind}-${Date.now()}`,
    kind,
    label: `${source.name.split(' ')[0].toUpperCase()}${index + 1}`,
    value: source.value,
    description: source.detail,
    position: [col * 2.2, 0, row * 2.2],
    pins: source.pins,
    color: source.color,
  }
}
