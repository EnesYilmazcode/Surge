// Tests for wire-route.js: a jumper wire arches over the parts its run crosses,
// as one smooth curve.
//
// Run with:  node --test

const test   = require('node:test');
const assert = require('node:assert');

const Route = require('./helpers/workbench.cjs')('wire-route');

const at = (x, z, y = 0.18) => ({ x, y, z });
// A part footprint from x0 to x1 and z0 to z1, with its top at `top`.
const part = (x0, x1, z0, z1, top) => ({ min: { x: x0, z: z0 }, max: { x: x1, z: z1 }, top });
const inside = (p, o) => p.x >= o.min.x && p.x <= o.max.x && p.z >= o.min.z && p.z <= o.max.z;

// The drawn curve: start, the two control points, end. Sampled finely.
function curve(start, end, r, n = 400) {
  const out = [];
  for (let k = 0; k <= n; k++) out.push(Route.bezier(start, r.p1, r.p2, end, k / n));
  return out;
}

test('a wire with nothing in its way keeps its ordinary arc', () => {
  assert.equal(Route.route(at(0, 0), at(3, 0), []), null);
  // A part off to the side of the run
  assert.equal(Route.route(at(0, 0), at(3, 0), [part(1, 2, 1, 2, 1.5)]), null);
});

test('a wire crossing a part arches over its top, and the curve keeps its two ends', () => {
  const start = at(0, 0), end = at(3, 0);
  const display = part(1, 2, -0.5, 0.5, 1.45);
  const r = Route.route(start, end, [display]);
  assert.ok(r, 'a raised route is returned');
  assert.equal(r.clear, true);
  const pts = curve(start, end, r);
  assert.deepEqual(pts[0], start);
  assert.ok(Math.abs(pts[pts.length - 1].x - 3) < 1e-9 && pts[pts.length - 1].y === 0.18);
  let over = 0;
  for (const p of pts) {
    if (inside(p, display)) {
      over++;
      assert.ok(p.y >= 1.45 + Route.CLEARANCE - 1e-6, `the wire is ${p.y.toFixed(3)} over the part at x=${p.x.toFixed(2)}`);
    }
  }
  assert.ok(over > 20, 'the sampled curve covers the part');
  // The arch is no higher than it needs to be
  const peak = Math.max(...pts.map((p) => p.y));
  assert.ok(peak < 1.45 + Route.CLEARANCE + 0.4, `peak ${peak}`);
});

test('a part a little short of a hole is cleared by a rounded arch, not a sharp drop', () => {
  // The display's body ends 0.3 short of the hole at the far end
  const body = part(1, 2.2, -0.5, 0.5, 1.45);
  const end = at(2.5, 0);
  const r = Route.route(at(0, 0), end, [body]);
  assert.ok(r && r.clear, 'the arch clears the body');
  const pts = curve(at(0, 0), end, r);
  for (const p of pts) {
    if (inside(p, body)) assert.ok(p.y >= 1.45 + Route.CLEARANCE - 1e-6, `${p.y} over the part at x=${p.x}`);
  }
  assert.ok(Math.abs(pts[pts.length - 1].x - 2.5) < 1e-9);
});

test('a part 0.8 short of the hole leaves room for a gentle, low arch', () => {
  const body = part(1, 2.2, -0.5, 0.5, 1.45);
  const end = at(3.0, 0);
  const r = Route.route(at(0, 0), end, [body]);
  assert.ok(r && r.clear);
  const peak = Math.max(...curve(at(0, 0), end, r).map((p) => p.y));
  assert.ok(peak < 2.2, `peak ${peak.toFixed(2)} should stay low`);
});

test('a part taller than the ceiling cannot be cleared, and the wire stops at the ceiling', () => {
  const r = Route.route(at(0, 0), at(3, 0), [part(1, 2, -0.5, 0.5, 5)]);
  assert.ok(r);
  assert.equal(r.clear, false);
  assert.equal(r.p1.y, Route.CEILING);
});

test('a run between two parts clears both, including on a diagonal', () => {
  const start = at(0, 0), end = at(4, 2);
  const a = part(1, 1.8, 0.4, 0.9, 1.0);
  const b = part(2.6, 3.2, 1.4, 1.9, 1.2);
  const r = Route.route(start, end, [a, b]);
  assert.ok(r && r.clear);
  for (const p of curve(start, end, r)) {
    for (const o of [a, b]) {
      if (inside(p, o)) assert.ok(p.y >= o.top + Route.CLEARANCE - 1e-6, `${p.y} over a part of top ${o.top}`);
    }
  }
});

test('the curve is one smooth arch: it turns gently through the middle of the run', () => {
  const start = at(0, 0), end = at(3, 0);
  const r = Route.route(start, end, [part(1, 2, -0.5, 0.5, 1.45)]);
  const pts = curve(start, end, r, 400);
  // Angle of each small step, in the vertical plane of the run
  const angles = [];
  for (let k = 1; k < pts.length; k++) {
    angles.push(Math.atan2(pts[k].y - pts[k - 1].y, pts[k].x - pts[k - 1].x));
  }
  // Turn between successive steps, through the middle 60% of the run
  const from = Math.floor(angles.length * 0.2), to = Math.floor(angles.length * 0.8);
  let worst = 0;
  for (let k = from + 1; k < to; k++) worst = Math.max(worst, Math.abs(angles[k] - angles[k - 1]));
  assert.ok(worst < 0.05, `the middle of the arch turns ${(worst * 180 / Math.PI).toFixed(2)} degrees per step`);
});

test('a run along one axis stays on that axis', () => {
  const r = Route.route(at(0, 0), at(3, 0), [part(1, 2, -0.5, 0.5, 1.45)]);
  for (const p of curve(at(0, 0), at(3, 0), r)) assert.ok(Math.abs(p.z) < 1e-9);
});
