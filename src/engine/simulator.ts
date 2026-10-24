import type { CircuitDesign, SimulationResult } from '../types/circuit'

const numeric = (value: string) => Number(value.match(/[\d.]+/)?.[0] ?? 0)

export function simulateCircuit(design: CircuitDesign): SimulationResult {
  const source = design.components.find((item) => item.kind === 'power')
  const voltageIn = source ? numeric(source.value) || 9 : 0
  const resistors = design.components.filter((item) => item.kind === 'resistor')
  const leds = design.components.filter((item) => item.kind === 'led')
  const totalResistance = Math.max(120, resistors.reduce((sum, item) => {
    const value = numeric(item.value)
    return sum + (item.value.toLowerCase().includes('k') ? value * 1000 : value)
  }, 0))
  const ledDrop = leds.length ? Math.min(voltageIn * 0.7, numeric(leds[0].value) || 2.1) : 0
  const voltageOut = Math.max(0, voltageIn - ledDrop)
  const current = Math.min(0.12, Math.max(0, voltageOut / totalResistance))
  const efficiency = voltageIn > 0 ? Math.min(98.8, 88 + Math.min(8, design.components.length * 0.65)) : 0
  const warnings: string[] = []

  if (!source) warnings.push('No power source detected')
  if (!design.components.some((item) => item.kind === 'ground')) warnings.push('Circuit needs a ground reference')
  if (leds.length && resistors.length === 0) warnings.push('LED requires a current-limiting resistor')
  if (design.wires.length < Math.max(0, design.components.length - 1)) warnings.push('One or more nodes may be floating')

  return {
    voltageIn,
    voltageOut: Number(voltageOut.toFixed(2)),
    current: Number((current * 1000).toFixed(1)),
    power: Number((voltageIn * current).toFixed(3)),
    efficiency: Number(efficiency.toFixed(1)),
    status: warnings.length > 1 ? 'error' : warnings.length ? 'warning' : 'nominal',
    warnings,
    nodeCount: new Set(design.wires.flatMap((wire) => [wire.from, wire.to])).size,
  }
}
