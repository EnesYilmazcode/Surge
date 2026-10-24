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

test('ESP32 model puts its 30 header pins on the board grid from the two first-pin holes', () => {
  const app = models()
  const a = { x: 2, z: 1.75 }, b = { x: 2, z: -1.75 }
  const esp = app.buildESP32(a, b)
  assert.equal(esp.pins.length, 30)
  assert.equal(app.ESP32_PINS.length, 30)
  assert.deepEqual([esp.pins[0].x, esp.pins[0].z], [a.x, a.z])
  assert.deepEqual([esp.pins[15].x, esp.pins[15].z], [b.x, b.z])
  for (let i = 1; i < 15; i++) {
    assert.ok(Math.abs(esp.pins[i].x - (a.x + 0.4 * i)) < 1e-9)
    assert.ok(Math.abs(esp.pins[i].z - a.z) < 1e-9)
    assert.ok(Math.abs(esp.pins[15 + i].x - (b.x + 0.4 * i)) < 1e-9)
  }
  // the model's own header pins land where the electrical pins say
  const bounds = new THREE.Box3().setFromObject(esp.group)
  assert.ok(bounds.min.y < 0 && bounds.max.y > 0.8)
  assert.ok(bounds.min.x < a.x && bounds.max.x > a.x + 0.4 * 14)
  esp.group.userData.setLit(true, 1)
  esp.group.userData.setPowered(true)
  app.setHighlight(esp.group, true)
  app.setHighlight(esp.group, false)
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
