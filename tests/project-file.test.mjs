import assert from 'node:assert/strict'
import test from 'node:test'
import { STARTER_DESIGN } from '../src/data/library.ts'
import { MAX_PROJECT_BYTES, parseProject, projectFilename, serializeProject, validateDesign } from '../src/data/project-file.ts'

function fixture() {
  return {
    name: 'Bench supply',
    description: 'Portable circuit',
    components: [
      { id: 'v1', kind: 'power', label: 'VIN', value: '9 V', description: 'DC source', position: [-2, 0, 1], pins: 2, color: '#ffb33b', rotation: 1.57 },
      { id: 'g1', kind: 'ground', label: 'GND', value: '0 V', description: 'Reference', position: [2, 0, 1], pins: 1, color: '#7a8a8f' },
    ],
    wires: [{ id: 'net1', from: 'v1', to: 'g1', layer: 'ground', voltage: 0 }],
  }
}

test('export and import preserve component properties, placement and connectivity', () => {
  const original = fixture()
  const imported = parseProject(serializeProject(original))
  assert.deepEqual(imported, original)
  imported.components[0].position[0] = 4
  assert.equal(original.components[0].position[0], -2)
})

test('empty designs are portable', () => {
  const empty = { name: '', description: '', components: [], wires: [] }
  assert.deepEqual(parseProject(serializeProject(empty)), empty)
})

test('the complete starter circuit and browser-local design format are supported', () => {
  assert.deepEqual(parseProject(serializeProject(STARTER_DESIGN)), STARTER_DESIGN)
  assert.deepEqual(validateDesign(JSON.parse(JSON.stringify(STARTER_DESIGN))), STARTER_DESIGN)
})

test('malformed, unrelated, and future-version files are rejected', () => {
  assert.throws(() => parseProject('{'), /valid JSON/)
  assert.throws(() => parseProject('null'), /structure/)
  assert.throws(() => parseProject(JSON.stringify(fixture())), /Surge circuit file/)
  const file = JSON.parse(serializeProject(fixture()))
  file.version = 2
  assert.throws(() => parseProject(JSON.stringify(file)), /unsupported version/)
})

test('missing wire endpoints and duplicate IDs are rejected', () => {
  const missing = fixture()
  missing.wires[0].to = 'missing'
  assert.throws(() => validateDesign(missing), /missing component/)
  const duplicatePart = fixture()
  duplicatePart.components[1].id = 'v1'
  assert.throws(() => validateDesign(duplicatePart), /Component IDs must be unique/)
  const duplicateWire = fixture()
  duplicateWire.wires.push({ ...duplicateWire.wires[0] })
  assert.throws(() => validateDesign(duplicateWire), /Wire IDs must be unique/)
})

test('invalid geometry, unsupported kinds and layers cannot reach the renderer', () => {
  for (const position of [[NaN, 0, 0], [0, Infinity, 0], [0, 0], [1001, 0, 0]]) {
    const design = fixture()
    design.components[0].position = position
    assert.throws(() => validateDesign(design))
  }
  const kind = fixture()
  kind.components[0].kind = 'unknown'
  assert.throws(() => validateDesign(kind), /Unknown component/)
  const layer = fixture()
  layer.wires[0].layer = 'unknown'
  assert.throws(() => validateDesign(layer), /Unknown wire layer/)
})

test('invalid pin counts, labels and colors are rejected', () => {
  const design = fixture()
  design.components[0].pins = 500
  assert.throws(() => validateDesign(design), /Pin count/)
  design.components[0].pins = 2
  design.components[0].label = null
  assert.throws(() => validateDesign(design), /component reference/)
  design.components[0].label = 'VIN'
  design.components[0].color = 'not-a-color'
  assert.throws(() => validateDesign(design), /color/)
})

test('oversized files and excessive component counts are rejected', () => {
  assert.throws(() => parseProject(' '.repeat(MAX_PROJECT_BYTES + 1)), /smaller than 2 MB/)
  const design = fixture()
  design.components = Array.from({ length: 501 }, (_, index) => ({ ...design.components[0], id: String(index) }))
  assert.throws(() => validateDesign(design), /at most 500/)
})

test('file names are safe and readable', () => {
  assert.equal(projectFilename('Bench / supply?'), 'bench-supply.surge.json')
  assert.equal(projectFilename(''), 'untitled.surge.json')
})
