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

// Checkpoints are reached one after another. While the page is moving toward
// one, the next step counts from that target, so a long scroll keeps going at a
// steady pace instead of stalling on every stop. Lenis does the easing.
const STEP_MS = 900
const GAP_MS = 700                 // while the wheel keeps turning, one step per gap
let moveId = 0
let moving = false
let targetIndex = 0
let lastStepAt = 0

function goTo(index: number, stops: number[]) {
  targetIndex = index
  if (lenis) {
    const id = ++moveId
    moving = true
    setTimeout(() => { if (id === moveId) moving = false }, STEP_MS + 80)
    lenis.scrollTo(stops[index], { duration: STEP_MS / 1000 })
  } else {
    window.scrollTo(0, stops[index])
  }
}

// Move one checkpoint up or down.
function step(dir: number) {
  const stops = checkpoints()
  const base = moving ? targetIndex : nearest(stops)
  const j = Math.min(stops.length - 1, Math.max(0, base + dir))
  if (j !== base) goTo(j, stops)
}

// A wheel gesture is a burst of wheel events. A new burst always takes a step,
// and a burst that keeps going takes another step each GAP_MS.
let lastWheel = 0
if (!touchOnly) {
  // Capture phase on window, so this runs before Lenis's own wheel listener and
  // stops it seeing the event. Lenis would otherwise cancel the move in progress.
  window.addEventListener('wheel', e => {
    if (e.ctrlKey) return                  // leave pinch zoom alone
    e.preventDefault()
    e.stopImmediatePropagation()
    const now = performance.now()
    const newGesture = now - lastWheel > 280
    lastWheel = now
    if (Math.abs(e.deltaY) < 1) return
    if (newGesture || now - lastStepAt > GAP_MS) {
      lastStepAt = now
      step(Math.sign(e.deltaY))
    }
  }, { passive: false, capture: true })

  window.addEventListener('keydown', e => {
    const dirs: Record<string, number> = { ArrowDown: 1, PageDown: 1, ArrowUp: -1, PageUp: -1 }
    let dir = dirs[e.key] ?? 0
    if (e.key === ' ') dir = e.shiftKey ? -1 : 1
    if (dir === 0 && e.key !== 'Home' && e.key !== 'End') return
    e.preventDefault()
    if (moving) return
    const stops = checkpoints()
    if (e.key === 'Home') goTo(0, stops)
    else if (e.key === 'End') goTo(stops.length - 1, stops)
    else step(dir)
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
