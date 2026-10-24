import assert from 'node:assert/strict'
import test from 'node:test'
import { applyCircuitActions, parseAgentReply } from '../src/agent/actions.ts'
import { STARTER_DESIGN } from '../src/data/library.ts'

test('incremental agent edits preserve unrelated components', () => {
  const next = applyCircuitActions(STARTER_DESIGN, [{ type: 'update_component', id: 'r1', value: '22 kΩ' }])
  assert.equal(next.components.find((item) => item.id === 'r1').value, '22 kΩ')
  assert.equal(STARTER_DESIGN.components.find((item) => item.id === 'r1').value, '10 kΩ')
  assert.deepEqual(next.wires, STARTER_DESIGN.wires)
  assert.deepEqual(next.components.find((item) => item.id === 'u1'), STARTER_DESIGN.components.find((item) => item.id === 'u1'))
})

test('new components snap to a socket and can be connected in the same proposal', () => {
  const next = applyCircuitActions(STARTER_DESIGN, [
    { type: 'add_component', id: 'new-led', kind: 'led', label: 'LED2', value: '2.1 V', x: 3.8, z: -1.9 },
    { type: 'add_wire', id: 'new-wire', from: 'new-led', to: 'gnd', layer: 'ground' },
  ])
  const added = next.components.find((item) => item.id === 'new-led')
  assert.equal(added.kind, 'led')
  assert.equal(added.position[2], -1.95)
  assert.equal(next.wires.at(-1).from, added.id)
})

test('removing a component removes attached wires', () => {
  const next = applyCircuitActions(STARTER_DESIGN, [{ type: 'remove_component', id: 'u1' }])
  assert.ok(!next.components.some((item) => item.id === 'u1'))
  assert.ok(!next.wires.some((wire) => wire.from === 'u1' || wire.to === 'u1'))
})

test('invalid proposals fail atomically without changing the circuit', () => {
  const before = structuredClone(STARTER_DESIGN)
  assert.throws(() => applyCircuitActions(STARTER_DESIGN, [
    { type: 'update_component', id: 'r1', value: '1 Ω' },
    { type: 'add_wire', id: 'bad', from: 'missing', to: 'gnd', layer: 'ground' },
  ]))
  assert.deepEqual(STARTER_DESIGN, before)
  assert.throws(() => applyCircuitActions(STARTER_DESIGN, [{ type: 'execute_script', id: 'x' }]), /unsupported/)
  assert.throws(() => applyCircuitActions(STARTER_DESIGN, [{ type: 'add_component', id: 'vin', kind: 'power', x: 0, z: 1 }]), /already exists/)
  assert.throws(() => parseAgentReply({ reply: '', actions: [] }))
  assert.throws(() => applyCircuitActions(STARTER_DESIGN, Array(31).fill({ type: 'remove_wire', id: 'x' })), /at most 30/)
})
