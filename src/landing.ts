// Homepage behaviour: checkpoints, smooth scrolling, the scroll progress the 3D
// scene follows, and cards that rise in as they arrive. Loaded only by index.html.

import Lenis from 'lenis'

document.documentElement.classList.remove('no-js')
document.documentElement.classList.add('js')

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
const touchOnly = matchMedia('(pointer: coarse)').matches

// Lenis eases the moves between checkpoints. Wheel smoothing is off, because
// the wheel is handled below and moves one checkpoint per gesture.
const lenis = reduceMotion ? null : new Lenis({ duration: 1.2, smoothWheel: false })
if (lenis) {
  const raf = (time: number) => {
    lenis.raf(time)
    requestAnimationFrame(raf)
  }
  requestAnimationFrame(raf)
}

// Checkpoints are the top of each section, then the very bottom so the
// credits can be reached.
function checkpoints(): number[] {
  const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
  const tops = Array.from(document.querySelectorAll<HTMLElement>('.beat'))
    .map(el => Math.min(max, el.getBoundingClientRect().top + window.scrollY))
  return [...tops, max].filter((y, i, all) => i === 0 || y - all[i - 1] > 2)
}

function nearest(stops: number[]): number {
  let best = 0
  for (let i = 1; i < stops.length; i++) {
    if (Math.abs(stops[i] - window.scrollY) < Math.abs(stops[best] - window.scrollY)) best = i
  }
  return best
}

let busy = false

function goTo(y: number) {
  if (lenis) {
    busy = true
    lenis.scrollTo(y, { duration: 1.1, onComplete: () => { busy = false } })
  } else {
    window.scrollTo(0, y)
  }
}

// Move one checkpoint up or down, and stop there.
function step(dir: number) {
  const stops = checkpoints()
  const i = nearest(stops)
  const j = Math.min(stops.length - 1, Math.max(0, i + dir))
  if (j !== i) goTo(stops[j])
}

// A wheel gesture is a burst of wheel events. Trackpad momentum keeps the burst
// going, so the next checkpoint only counts after a short pause.
let lastWheel = 0
if (!touchOnly) {
  window.addEventListener('wheel', e => {
    if (e.ctrlKey) return                  // leave pinch zoom alone
    e.preventDefault()
    const now = performance.now()
    const newGesture = now - lastWheel > 280
    lastWheel = now
    if (busy || !newGesture || Math.abs(e.deltaY) < 1) return
    step(Math.sign(e.deltaY))
  }, { passive: false })

  window.addEventListener('keydown', e => {
    const dirs: Record<string, number> = { ArrowDown: 1, PageDown: 1, ArrowUp: -1, PageUp: -1 }
    let dir = dirs[e.key] ?? 0
    if (e.key === ' ') dir = e.shiftKey ? -1 : 1
    if (dir === 0 && e.key !== 'Home' && e.key !== 'End') return
    e.preventDefault()
    if (busy) return
    if (e.key === 'Home' || e.key === 'End') {
      const stops = checkpoints()
      goTo(e.key === 'Home' ? stops[0] : stops[stops.length - 1])
    } else {
      step(dir)
    }
  })
}

const frame = document.getElementById('stage-frame') as HTMLIFrameElement | null
let queued = false

// Send the page's scroll progress (0 at the top, 1 at the bottom) to the scene.
function sendProgress() {
  queued = false
  if (!frame?.contentWindow) return
  const max = document.documentElement.scrollHeight - window.innerHeight
  const p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0
  frame.contentWindow.dispatchEvent(new CustomEvent('surge-scroll', { detail: p }))
}

window.addEventListener('scroll', () => {
  if (!queued) {
    queued = true
    requestAnimationFrame(sendProgress)
  }
}, { passive: true })

// The board's first frame lands a moment after the iframe's load event.
const showScene = () => {
  sendProgress()
  setTimeout(() => document.documentElement.classList.add('is-loaded'), 300)
}
frame?.addEventListener('load', showScene)
// A cached page can finish loading before this module runs, and then the load
// event never reaches us. Show the scene in that case, skipping about:blank.
const doc = frame?.contentDocument
if (doc && doc.readyState === 'complete' && doc.location.href !== 'about:blank') showScene()

// Cards rise in as they enter the screen.
if ('IntersectionObserver' in window) {
  const seen = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add('in')
        seen.unobserve(entry.target)
      }
    }
  }, { threshold: 0.2 })
  document.querySelectorAll('.card').forEach(card => seen.observe(card))
}
