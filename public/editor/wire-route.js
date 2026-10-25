// ─────────────────────────────────────────────────────────────
//  wire-route.js — arches a jumper wire over the parts it would cross
//
//  A jumper is one smooth curve between two holes. When the straight run
//  between them passes over a part's body, the curve is raised with its two
//  control points until it clears every part underneath. The result is a
//  single rounded arch, with no joins or flat tops, so it reads as a wire
//  and not as a box. A wire that clears everything keeps its ordinary arc.
//
//  Near a hole that sits right beside a part, the control point is pulled in
//  close above that hole, so the wire drops almost straight down into it, as
//  a real lead would.
//
//  Browser: window.WireRoute, also App.WireRoute.   Node: module.exports.
// ─────────────────────────────────────────────────────────────

(function (root, factory) {
  const W = factory();
  if (typeof module === 'object' && module.exports) module.exports = W;
  if (root) { root.WireRoute = W; (root.App = root.App || {}).WireRoute = W; }
})(typeof window !== 'undefined' ? window : null, function () {

  const CLEARANCE = 0.12;   // air between a wire and the top of a part it passes over
  const CEILING   = 3.2;    // the highest a wire may arch, in board units
  const MIN_REACH = 0.02;   // the shortest horizontal reach of a control point: a near-vertical drop
  const MAX_REACH = 0.4;    // the longest, as a fraction of the run
  const STEP      = 0.02;   // sampling step along the run
  const SAMPLES   = 400;    // samples of the curve when checking clearance
  const MARGIN    = 0.05;   // extra height above the lowest clearing curve, so the edge has room

  const inside = (p, o) => p.x >= o.min.x && p.x <= o.max.x && p.z >= o.min.z && p.z <= o.max.z;

  // A point on the cubic Bezier from a to d with control points b and c.
  function bezier(a, b, c, d, t) {
    const u = 1 - t;
    const k0 = u * u * u, k1 = 3 * u * u * t, k2 = 3 * u * t * t, k3 = t * t * t;
    return { x: k0 * a.x + k1 * b.x + k2 * c.x + k3 * d.x,
             y: k0 * a.y + k1 * b.y + k2 * c.y + k3 * d.y,
             z: k0 * a.z + k1 * b.z + k2 * c.z + k3 * d.z };
  }

  // Route a wire from start to end (board space, {x, y, z}) over `obstacles`,
  // each { min: {x, z}, max: {x, z}, top }. Returns null when nothing is in the
  // way. Otherwise returns { p1, p2, clear }: the two control points of the
  // curve from start to end, and whether it clears every part below the ceiling.
  function route(start, end, obstacles) {
    const d = Math.hypot(end.x - start.x, end.z - start.z);
    if (!obstacles || !obstacles.length || d < 0.05) return null;
    const ux = (end.x - start.x) / d, uz = (end.z - start.z) / d;

    // The first and last stretch of the run that is over some part
    const n = Math.ceil(d / STEP);
    let first = -1, last = -1;
    for (let i = 0; i <= n; i++) {
      const x = d * i / n;
      const p = { x: start.x + ux * x, z: start.z + uz * x };
      if (obstacles.some((o) => inside(p, o))) { if (first < 0) first = x; last = x; }
    }
    if (first < 0) return null;

    // Clear ground at each end, before the first part and after the last. The true
    // edge can lie up to one step before the first sample over a part.
    const clearS = Math.max(0, first - STEP), clearE = Math.max(0, d - last - STEP);
    const reachS = Math.min(d * MAX_REACH, Math.max(MIN_REACH, clearS * 0.6));
    const reachE = Math.min(d * MAX_REACH, Math.max(MIN_REACH, clearE * 0.6));

    // Control points level at height h, pulled in from each end by its reach
    const controls = (h) => ({
      p1: { x: start.x + ux * reachS, y: h, z: start.z + uz * reachS },
      p2: { x: end.x - ux * reachE, y: h, z: end.z - uz * reachE },
    });
    const clears = (h) => {
      const { p1, p2 } = controls(h);
      for (let k = 0; k <= SAMPLES; k++) {
        const p = bezier(start, p1, p2, end, k / SAMPLES);
        for (const o of obstacles) if (inside(p, o) && p.y < o.top + CLEARANCE) return false;
      }
      return true;
    };

    // The lowest control height that clears everything, by bisection
    const floor = Math.max(start.y, end.y) + 0.05;
    if (!clears(CEILING)) return { ...controls(CEILING), clear: false };
    let lo = floor, hi = CEILING;
    if (clears(lo)) hi = lo;
    else for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (clears(mid)) hi = mid; else lo = mid; }
    return { ...controls(Math.min(CEILING, hi + MARGIN)), clear: true };
  }

  return { route, bezier, CLEARANCE, CEILING };
});
