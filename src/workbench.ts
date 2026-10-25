import { workbenchThree } from './workbench-three'
import type { SketchOptions } from './sketch-runtime'

// The homepage scene is this same editor opened with ?home: the demo circuit on
// the bench, with nothing to scroll. It never saves anything. The flag keeps its
// old name, isHero, because the editor checks it before saving.
const home = new URLSearchParams(window.location.search).has('home')
;(window as unknown as Record<string, unknown>).THREE = workbenchThree
;(window as unknown as Record<string, unknown>).App = {
  isHero: home,
  // Runs the open sketch and returns its pin changes. The interpreter loads on first use.
  async runSketch(sketch: string, options?: SketchOptions) {
    const { runSketch, levelsAt } = await import('./sketch-runtime')
    const run = runSketch(sketch, options)
    return { ...run, at: (ms: number) => levelsAt(run, ms) }
  },
  onReady(callback: () => void) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', callback, { once: true })
    else callback()
  },
}

async function loadScript(name: string) {
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = `/editor/${name}.js`
    script.async = false
    const onError = (event: ErrorEvent) => {
      if (event.filename && !event.filename.includes(`/editor/${name}.js`)) return
      cleanup()
      reject(new Error(`${name}: ${event.message}`))
    }
    const cleanup = () => window.removeEventListener('error', onError)
    window.addEventListener('error', onError)
    script.onload = () => { cleanup(); resolve() }
    script.onerror = () => { cleanup(); reject(new Error(`Unable to load the ${name} module.`)) }
    document.body.append(script)
  })
}

async function boot() {
  const modules = ['board-model', 'wire-route', 'scene', 'board', 'parts', 'parts-more', 'input', 'solver', 'simulation', 'project-format', 'code', 'editor', 'inspector', 'chat', 'thumbs', 'projects']
  if (home) modules.push('stage', 'home')
  // Fetch the modules together. Scripts added with async = false still run in order.
  await Promise.all(modules.map(loadScript))
}

boot().catch((error) => {
  const message = document.createElement('div')
  message.setAttribute('role', 'alert')
  message.className = 'startup-error'
  message.textContent = `Surge could not start: ${error.message} Refresh the page to try again.`
  document.getElementById('canvas-wrap')?.append(message)
})
