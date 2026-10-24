import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import test from 'node:test'

const require = createRequire(import.meta.url)
const THREE = require('three-classic')
function models() {
  const gradient = { addColorStop() {} }
  const ctx = new Proxy({}, { get: (_, key) => {
    if (key === 'measureText') return () => ({ width: 30 })
    if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => gradient
    if (key === 'getImageData') return (_, __, width, height) => ({ data: new Uint8ClampedArray(width * height * 4) })
    return () => {}
  } })
  const context = vm.createContext({
    THREE,
    document: { createElement: () => ({ width: 512, height: 512, getContext: () => ctx }) },
    App: { PROPS: { resistor: { resistance: 470 }, battery: { voltage: 9 }, led: { forwardVoltage: 2, maxCurrent: 0.02 } } },
  })
  context.window = context
  vm.runInContext(readFileSync(new URL('../public/editor/parts.js', import.meta.url), 'utf8'), context)
  return context.App
}

test('component builders produce physically based surfaces and exact electrical pin positions', () => {
  const app = models()
  const left = { x: -0.8, z: 0 }, right = { x: 0.8, z: 0 }
  for (const build of [
    () => app.buildResistor(left, right, 470),
    () => app.buildLED(left, right, 'red'),
    () => app.buildBuzzer(left, right),
    () => app.buildButton(left, right),
  ]) {
    const part = build()
    assert.equal(part.pins.length, 2)
    assert.equal(part.pins[0].x, left.x)
    assert.equal(part.pins[1].x, right.x)
    const materials = []
    part.group.traverse((child) => { if (child.isMesh) materials.push(child.material) })
    assert.ok(materials.length > 2)
    assert.ok(materials.some((material) => material.isMeshStandardMaterial || material.isMeshPhysicalMaterial))
    assert.ok(materials.some((material) => material.metalness > 0.5))
  }
})

test('LED model exposes simulation-driven illumination and reversible highlighting', () => {
  const app = models()
  const led = app.buildLED({ x: -0.4, z: 0 }, { x: 0.4, z: 0 }, 'blue')
  assert.equal(typeof led.group.userData.setLit, 'function')
  led.group.userData.setLit(true, 0.8)
  app.setHighlight(led.group, true)
  app.setHighlight(led.group, false)
  led.group.userData.setLit(false, 0)
  assert.ok(led.group.children.length > 2)
})
