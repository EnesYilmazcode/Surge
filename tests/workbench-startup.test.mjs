import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import { createServer } from 'vite'

test('workbench environment, controls and renderer share a single Three.js generation', async () => {
  const server = await createServer({ server: { middlewareMode: true, hmr: false } })
  try {
    const { workbenchThree: THREE } = await server.ssrLoadModule('/src/workbench-three.ts')
    assert.equal(THREE.REVISION, '128')
    const environment = new THREE.RoomEnvironment()
    assert.ok(environment instanceof THREE.Scene)
    environment.traverse((object) => {
      if (!object.isMesh) return
      assert.ok(object.geometry instanceof THREE.BufferGeometry)
      assert.ok(object.material instanceof THREE.Material, 'environment material must match the renderer')
      assert.equal(typeof object.material.onBuild, 'function', 'legacy renderer requires the material onBuild hook')
    })

    // Execute the real scene and board code, replacing only the GPU and DOM.
    // This catches initialization exceptions before the render loop can start.
    const gradient = { addColorStop() {} }
    const ctx = new Proxy({}, { get: (_, key) => {
      if (key === 'measureText') return () => ({ width: 30 })
      if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => gradient
      if (key === 'getImageData') return (_, __, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) })
      return () => {}
    } })
    const element = () => ({
      style: {}, clientWidth: 1200, clientHeight: 800, addEventListener() {},
      classList: { add() {}, remove() {}, toggle() {} }, appendChild() {},
      getContext: () => ctx, getRootNode: () => document,
      ownerDocument: { addEventListener() {}, removeEventListener() {} },
    })
    const document = { createElement: element, getElementById: element, addEventListener() {}, querySelectorAll: () => [] }
    globalThis.document = document
    let frames = 0
    class Renderer {
      constructor({ canvas }) { this.domElement = canvas; this.shadowMap = {}; this.capabilities = { getMaxAnisotropy: () => 1 } }
      setPixelRatio() {}
      setSize() {}
      render() { frames++ }
    }
    class PMREMGenerator {
      fromScene(scene) { assert.ok(scene instanceof THREE.Scene); return { texture: new THREE.Texture() } }
      dispose() {}
    }
    const context = vm.createContext({
      THREE: { ...THREE, WebGLRenderer: Renderer, PMREMGenerator }, document,
      ResizeObserver: class { observe() {} }, devicePixelRatio: 1,
      requestAnimationFrame() {}, performance: { now: () => 0 },
      setTimeout() {}, clearTimeout() {},
      localStorage: { getItem: () => null }, sessionStorage: { getItem: () => null },
    })
    context.window = context
    for (const name of ['board-model', 'scene', 'board', 'parts', 'input', 'solver', 'simulation', 'project-format', 'editor', 'inspector']) {
      vm.runInContext(readFileSync(new URL(`../public/editor/${name}.js`, import.meta.url), 'utf8'), context, { filename: `${name}.js` })
    }
    const board = context.App.state.breadboard
    assert.ok(board.group.children.length > 0)
    assert.ok(context.App.camera.aspect > 1)
    assert.equal(board.holeData.length, 700)
    assert.ok(context.App.scene.children.includes(board.group))
    assert.ok(frames > 0, 'editor must reach its render loop')

    for (const addon of ['controls/OrbitControls', 'environments/RoomEnvironment']) {
      const transformed = await server.transformRequest(`/node_modules/three-classic/examples/jsm/${addon}.js`)
      assert.ok(!transformed.code.includes('/node_modules/.vite/deps/three.js'), 'browser addons must not load the prototype renderer')
      assert.match(transformed.code, /three-classic/)
    }
  } finally {
    delete globalThis.document
    await server.close()
  }
})
