// Homepage behaviour: checkpoints, smooth scrolling, which section is on screen,
// the Press Run sequence, the circuit field, and cards that rise in as they
// arrive. Loaded only by index.html.

import Lenis from 'lenis'
import { startCircuitGrid, stopCircuitGrid } from './circuit-grid'

document.documentElement.classList.remove('no-js')
document.documentElement.classList.add('js')

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
const touchOnly = matchMedia('(pointer: coarse)').matches

// Lenis eases the moves between checkpoints. Wheel smoothing is off, because
// the wheel is handled below and moves one checkpoint at a time.
const lenis = reduceMotion ? null : new Lenis({ duration: 1.2, smoothWheel: false })
if (lenis) {
  const raf = (time: number) => {
    lenis.raf(time)
    requestAnimationFrame(raf)
  }
  requestAnimationFrame(raf)
}

const frame = document.getElementById('stage-frame') as HTMLIFrameElement | null
const beats = Array.from(document.querySelectorAll<HTMLElement>('.beat'))
const RUN = 4                        // the section where Run is pressed
const CLOSING = beats.length - 1     // the last section: the circuit field

// Checkpoints are the top of each section, then the very bottom so the
// credits can be reached.
function checkpoints(): number[] {
  const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
  const tops = beats.map(el => Math.min(max, el.getBoundingClientRect().top + window.scrollY))
  return [...tops, max].filter((y, i, all) => i === 0 || y - all[i - 1] > 2)
}

function nearest(stops: number[]): number {
  let best = 0
  for (let i = 1; i < stops.length; i++) {
    if (Math.abs(stops[i] - window.scrollY) < Math.abs(stops[best] - window.scrollY)) best = i
  }
  return best
}

// ── Sections ─────────────────────────────────────────────────

let section = -1

function sendToScene(name: string, detail?: number) {
  frame?.contentWindow?.dispatchEvent(new CustomEvent(name, { detail }))
}

const gridCanvas = document.getElementById('circuit-grid') as HTMLCanvasElement | null

function setSection(next: number) {
  if (next === section) return
  const before = section
  section = next
  sendToScene('surge-section', next)
  if (next === RUN) playRun()
  else if (before === RUN) resetRun()
  if (next === CLOSING) {
    document.documentElement.classList.add('grid-on')
    if (gridCanvas) startCircuitGrid(gridCanvas)
  } else if (before === CLOSING) {
    document.documentElement.classList.remove('grid-on')
    stopCircuitGrid()
  }
}

let sectionQueued = false
function trackSection() {
  if (sectionQueued) return
  sectionQueued = true
  requestAnimationFrame(() => {
    sectionQueued = false
    setSection(Math.min(nearest(checkpoints()), CLOSING))
  })
}

window.addEventListener('scroll', trackSection, { passive: true })

// ── Press Run ────────────────────────────────────────────────
// On the Run section a pointing hand comes in, presses the green play button
// below the LED, and the scene lights the LED. Leaving the section resets it.

const overlay = document.getElementById('run-overlay')
const playButton = overlay?.querySelector<HTMLElement>('.play') ?? null
let runTimers: number[] = []

function clearRunTimers() {
  runTimers.forEach(timer => window.clearTimeout(timer))
  runTimers = []
}

function playRun() {
  if (!overlay || !playButton) return
  clearRunTimers()
  overlay.classList.remove('press', 'lit')
  playButton.classList.remove('pressed', 'lit')
  void overlay.offsetWidth // restart the hand's move from the corner
  overlay.classList.add('on')
  runTimers = [
    window.setTimeout(() => {
      overlay.classList.add('press')
      playButton.classList.add('pressed')
    }, 1100),
    window.setTimeout(() => {
      overlay.classList.remove('press')
      playButton.classList.remove('pressed')
      overlay.classList.add('lit')
      playButton.classList.add('lit')
      sendToScene('surge-run')
    }, 1350),
  ]
}

function resetRun() {
  clearRunTimers()
  overlay?.classList.remove('on', 'press', 'lit')
  playButton?.classList.remove('pressed', 'lit')
  sendToScene('surge-stop')
}

// ── Scrolling by checkpoint ──────────────────────────────────

// One move at a time while Lenis is easing. A move's target is remembered, so
// a long scroll keeps going at a steady pace instead of stalling on each stop.
const STEP_MS = 900
const GAP_MS = 700                   // while the wheel keeps turning, one step per gap
let moveId = 0
let moving = false
let targetIndex = 0
let lastStepAt = 0

function goTo(index: number, stops: number[]) {
  targetIndex = index
  if (lenis) {
    const id = ++moveId
    moving = true
    window.setTimeout(() => {
      if (id === moveId) moving = false
    }, STEP_MS + 80)
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
    if (e.ctrlKey) return // leave pinch zoom alone
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

// ── The scene ────────────────────────────────────────────────

// The board's first frame lands a moment after the iframe's load event. A cached
// page can finish loading before this module runs, so that case is checked too.
const showScene = () => {
  setSection(Math.min(nearest(checkpoints()), CLOSING))
  setTimeout(() => document.documentElement.classList.add('is-loaded'), 300)
}
frame?.addEventListener('load', showScene)
const doc = frame?.contentDocument
if (doc && doc.readyState === 'complete' && doc.location.href !== 'about:blank') showScene()

// ── Cards ────────────────────────────────────────────────────

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
