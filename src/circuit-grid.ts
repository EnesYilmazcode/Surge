// ─────────────────────────────────────────────────────────────
//  circuit-grid.ts: the background of the homepage's closing section
//
//  A field of small breadboard circuits, drawn on a canvas. The circuit in the
//  centre appears first, then each ring around it, one after another. Once the
//  field is full, the outer circuits keep changing, so it never stops. Each
//  circuit is drawn once and cached.
// ─────────────────────────────────────────────────────────────

const TILE = 150;        // css px for one circuit
const PITCH = 172;       // css px from one circuit to the next
const RING_MS = 420;     // time from one ring to the next
const APPEAR_MS = 520;   // time one circuit takes to appear
const SWAP_MS = 380;     // time between outer circuits changing
const WIRE_COLORS = ['#ef4444', '#f5f5f4', '#fbbf24', '#3b82f6'];
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

type Cell = { seed: number; born: number };

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let running = false;
let frameId = 0;
let epoch = 1;
let startedAt = 0;
let lastSwap = 0;
const cells = new Map<string, Cell>();
const tiles = new Map<number, HTMLCanvasElement>();

// Small seeded random numbers (mulberry32), so a seed always draws the same circuit.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(i: number, j: number, salt: number) {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(salt, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

const easeOut = (k: number) => 1 - Math.pow(1 - k, 3);

// Hole positions on one circuit's board: two halves of five rows and ten columns.
function holeAt(half: number, row: number, col: number): [number, number] {
  return [24 + col * 12.4, (half ? 84 : 24) + row * 10];
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function drawTile(seed: number): HTMLCanvasElement {
  const cached = tiles.get(seed);
  if (cached) return cached;
  if (tiles.size > 260) tiles.clear();

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const c = document.createElement('canvas');
  c.width = c.height = Math.round(TILE * dpr);
  const g = c.getContext('2d');
  if (!g) return c;
  g.scale(dpr, dpr);
  const r = rng(seed);
  const pick = (n: number) => Math.floor(r() * n);

  // The board
  g.fillStyle = '#23262b';
  roundRect(g, 0, 0, TILE, TILE, 14);
  g.fill();
  g.fillStyle = '#e9e6df';
  roundRect(g, 12, 16, TILE - 24, TILE - 32, 6);
  g.fill();
  g.fillStyle = 'rgba(40,36,30,0.12)';
  g.fillRect(12, TILE / 2 - 3, TILE - 24, 6);
  g.fillStyle = '#5b5650';
  for (const half of [0, 1]) {
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 10; col++) {
        const [x, y] = holeAt(half, row, col);
        g.beginPath();
        g.arc(x, y, 1.4, 0, Math.PI * 2);
        g.fill();
      }
    }
  }

  // One to three parts, each spanning a few holes
  const parts = 1 + pick(3);
  for (let p = 0; p < parts; p++) {
    const half = pick(2), row = pick(5), colA = pick(6), colB = colA + 3 + pick(2);
    const [ax, ay] = holeAt(half, row, colA);
    const [bx, by] = holeAt(half, row, colB);
    const mx = (ax + bx) / 2, my = ay;
    const kind = pick(4);
    g.strokeStyle = '#9ca3af';
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(ax, ay);
    g.lineTo(mx - 9, my);
    g.moveTo(bx, by);
    g.lineTo(mx + 9, my);
    g.stroke();
    if (kind === 0) {
      // resistor
      g.fillStyle = '#e8d3a8';
      roundRect(g, mx - 9, my - 4, 18, 8, 3);
      g.fill();
      g.fillStyle = '#7c2d12';
      g.fillRect(mx - 5, my - 4, 2, 8);
      g.fillStyle = '#a16207';
      g.fillRect(mx - 1, my - 4, 2, 8);
    } else if (kind === 1) {
      // LED with a glow
      const glow = g.createRadialGradient(mx, my - 2, 0, mx, my - 2, 18);
      glow.addColorStop(0, 'rgba(248,113,113,0.55)');
      glow.addColorStop(1, 'rgba(248,113,113,0)');
      g.fillStyle = glow;
      g.beginPath();
      g.arc(mx, my - 2, 18, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#ef4444';
      g.beginPath();
      g.arc(mx, my - 2, 6, Math.PI, 0);
      g.lineTo(mx + 6, my + 1);
      g.lineTo(mx - 6, my + 1);
      g.closePath();
      g.fill();
    } else if (kind === 2) {
      // battery
      g.fillStyle = '#1a1814';
      roundRect(g, mx - 13, my - 9, 26, 16, 3);
      g.fill();
      g.fillStyle = '#fbbf24';
      g.fillRect(mx - 7, my - 4, 14, 7);
    } else {
      // push button
      g.fillStyle = '#6b7280';
      roundRect(g, mx - 6, my - 6, 12, 12, 2);
      g.fill();
      g.fillStyle = '#16a34a';
      g.beginPath();
      g.arc(mx, my, 3, 0, Math.PI * 2);
      g.fill();
    }
  }

  // One to three jumpers, arcing up over the board
  const wires = 1 + pick(3);
  g.lineCap = 'round';
  g.lineWidth = 2.6;
  for (let w = 0; w < wires; w++) {
    const [ax, ay] = holeAt(pick(2), pick(5), pick(10));
    const [bx, by] = holeAt(pick(2), pick(5), pick(10));
    const lift = 16 + r() * 22;
    g.strokeStyle = WIRE_COLORS[pick(WIRE_COLORS.length)];
    g.beginPath();
    g.moveTo(ax, ay);
    g.quadraticCurveTo((ax + bx) / 2, Math.min(ay, by) - lift, bx, by);
    g.stroke();
  }
  return c;
}

// The circuit at grid position (i, j). Outer rings start later than inner ones.
function cellAt(i: number, j: number): Cell {
  const key = i + ',' + j;
  let cell = cells.get(key);
  if (!cell) {
    const ring = Math.max(Math.abs(i), Math.abs(j));
    const jitter = reduceMotion ? 0 : hash(i, j, 7) % 180;
    cell = { seed: hash(i, j, epoch), born: startedAt + (reduceMotion ? 0 : ring * RING_MS + jitter) };
    cells.set(key, cell);
  }
  return cell;
}

// Replace one outer circuit with a new one.
function swapOne(now: number, reachX: number, reachY: number) {
  let i = 0, j = 0;
  for (let attempt = 0; attempt < 8; attempt++) {
    i = Math.round((Math.random() * 2 - 1) * reachX);
    j = Math.round((Math.random() * 2 - 1) * reachY);
    if (Math.max(Math.abs(i), Math.abs(j)) >= 2) break;
  }
  cells.set(i + ',' + j, { seed: hash(i, j, ++epoch), born: now });
}

function draw(now: number) {
  if (!running || !canvas || !ctx) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = canvas.clientWidth, H = canvas.clientHeight;
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const reachX = Math.ceil(W / 2 / PITCH) + 1;
  const reachY = Math.ceil(H / 2 / PITCH) + 1;
  if (now - startedAt > RING_MS * 6 && now - lastSwap > SWAP_MS) {
    lastSwap = now;
    swapOne(now, reachX, reachY);
  }

  const cx = W / 2, cy = H / 2;
  for (let j = -reachY; j <= reachY; j++) {
    for (let i = -reachX; i <= reachX; i++) {
      const cell = cellAt(i, j);
      const t = (now - cell.born) / APPEAR_MS;
      if (t <= 0) continue;
      const k = easeOut(Math.min(1, t));
      const size = TILE * (0.8 + 0.2 * k);
      ctx.globalAlpha = k;
      ctx.drawImage(drawTile(cell.seed), cx + i * PITCH - size / 2, cy + j * PITCH - size / 2, size, size);
    }
  }
  ctx.globalAlpha = 1;
  frameId = requestAnimationFrame(draw);
}

// Start the field from its centre circuit. Every start rolls new circuits.
export function startCircuitGrid(el: HTMLCanvasElement) {
  const c = el.getContext('2d');
  if (!c) return;
  canvas = el;
  ctx = c;
  epoch += 1;
  cells.clear();
  startedAt = performance.now();
  lastSwap = startedAt;
  if (!running) {
    running = true;
    frameId = requestAnimationFrame(draw);
  }
}

export function stopCircuitGrid() {
  running = false;
  cancelAnimationFrame(frameId);
}
