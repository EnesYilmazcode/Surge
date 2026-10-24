import * as THREE from 'three-classic'
import { OrbitControls } from 'three-classic/examples/jsm/controls/OrbitControls.js'

;(window as unknown as Record<string, unknown>).THREE = { ...THREE, OrbitControls }

async function loadScript(name: string) {
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = `/editor/${name}.js`
    script.async = false
    script.onload = () => resolve()
    script.onerror = () => reject(new Error(`Unable to load the ${name} module.`))
    document.body.append(script)
  })
}

async function boot() {
  for (const name of ['scene', 'board', 'parts', 'input', 'solver', 'simulation', 'project-format', 'editor', 'chat', 'projects']) {
    await loadScript(name)
  }
}

boot().catch((error) => {
  const message = document.createElement('div')
  message.setAttribute('role', 'alert')
  message.className = 'startup-error'
  message.textContent = `Surge could not start: ${error.message} Refresh the page to try again.`
  document.getElementById('canvas-wrap')?.append(message)
})
