import { workbenchThree } from './workbench-three'

;(window as unknown as Record<string, unknown>).THREE = workbenchThree
;(window as unknown as Record<string, unknown>).App = {
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
  for (const name of ['board-model', 'scene', 'board', 'parts', 'input', 'solver', 'simulation', 'project-format', 'editor', 'inspector', 'chat', 'thumbs', 'projects']) {
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
