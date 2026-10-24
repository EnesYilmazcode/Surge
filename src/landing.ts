// Homepage behaviour: smooth scrolling, the scroll progress the 3D scene
// follows, and cards that rise in as they arrive. Loaded only by index.html.

import Lenis from 'lenis'

document.documentElement.classList.remove('no-js')
document.documentElement.classList.add('js')

// Lenis eases wheel and trackpad scrolling. The scene follows the page's real
// scroll position, so it receives the smoothed value. Reduced-motion visitors
// keep the browser's own scrolling.
if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const lenis = new Lenis({ duration: 1.2 })
  const raf = (time: number) => {
    lenis.raf(time)
    requestAnimationFrame(raf)
  }
  requestAnimationFrame(raf)
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
