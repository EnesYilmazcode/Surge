// ─────────────────────────────────────────────────────────────
//  board.test.js — end-to-end board test
//
//  Loads the REAL simulate.js and walks the whole path a click on
//  Simulate takes: placed components + wires -> Union-Find node
//  graph -> netlist -> MNA solve. No DOM, no WebGL, no stubbed
//  circuit logic. Only THREE and document are faked, and neither
//  is touched by the code under test.
//
//  Run: npm test
// ─────────────────────────────────────────────────────────────

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const solverContext = { module: { exports: {} } };
require('node:vm').runInNewContext(require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'public', 'editor', 'solver.js'), 'utf8'), solverContext);
const MNA = solverContext.module.exports;

// ── Minimal host environment ─────────────────────────────────
const sandbox = {
  THREE:    { PointLight: function () {}, Raycaster: function () {}, Vector2: function () {} },
  document: { getElementById: () => null, createElement: () => ({ style: {} }) },
  MNA,
  console,
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

vm.runInContext(
  fs.readFileSync(path.join(__dirname, '..', 'public', 'editor', 'simulation.js'), 'utf8'),
  sandbox,
  { filename: 'simulate.js' }
);

const { buildGraph, buildNetlist } = sandbox.App._internals;

let passed = 0, failed = 0;
const failures = [];

function approx(actual, expected, tol, label) {
  const ok = Math.abs(actual - expected) <= tol;
  ok ? passed++ : (failed++, failures.push(`${label}: expected ${expected}, got ${actual}`));
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label} = ${Number(actual).toPrecision(6)}`);
}
function assert(cond, label) {
  cond ? passed++ : (failed++, failures.push(label));
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${label}`);
}
function section(t) { console.log(`\n${t}\n${'-'.repeat(t.length)}`); }

// ── Board part factories ─────────────────────────────────────
//  holeRefs[i] is where pin i is plugged in. Pin conventions come
//  straight from components.js:
//    battery  pin 0 = +        pin 1 = −
//    led      pin 0 = cathode  pin 1 = anode
const hole = (col, row) => ({ col, row });

const part = (type, refs, extra = {}) => ({
  type,
  pins: refs.map(() => ({})),
  holeRefs: refs,
  ...extra,
});

const battery  = (plus, minus)          => part('battery',  [plus, minus]);
const resistor = (a, b, ohms)           => part('resistor', [a, b], { resistance: ohms });
const led      = (cathode, anode)       => part('led',      [cathode, anode]);
const button   = (a, b, pressed = false) => part('button',  [a, b], { pressed });

function solveBoard(components, wires = []) {
  const graph   = buildGraph(components, wires);
  const netlist = buildNetlist(graph);
  const bat     = graph.find(g => g.comp.type === 'battery');
  netlist.ground = bat.nodes[1];
  return { sol: MNA.solve(netlist), graph, netlist };
}
const currentOf = (sol, comp) => sol.currents[comp._simId];

console.log('Board integration suite (real simulate.js)');
console.log('==========================================');

// ── 1. Node identity: a breadboard column really is one node ──
section('1. Breadboard column connectivity');
{
  const bat = battery(hole(1, 'a'), hole(2, 'a'));
  const r   = resistor(hole(1, 'e'), hole(2, 'e'), 220);  // same columns, rows a and e
  const graph = buildGraph([bat, r], []);
  assert(graph[0].nodes[0] === graph[1].nodes[0], 'col 1 rows a and e share a node');
  assert(graph[0].nodes[1] === graph[1].nodes[1], 'col 2 rows a and e share a node');
  assert(graph[0].nodes[0] !== graph[0].nodes[1], 'col 1 and col 2 are different nodes');

  const g2 = buildGraph([battery(hole(1, 'a'), hole(2, 'a')), resistor(hole(1, 'f'), hole(2, 'f'), 220)], []);
  assert(g2[0].nodes[0] !== g2[1].nodes[0],
    'rows a and f are NOT connected (centre channel splits the column)');
}

// ── 2. Simple lit LED ────────────────────────────────────────
section('2. 9V -> 220R -> LED, built on the board');
{
  const bat = battery(hole(1, 'a'), hole(2, 'a'));
  const r   = resistor(hole(1, 'b'), hole(5, 'a'), 220);
  const d   = led(hole(2, 'b'), hole(5, 'b'));      // cathode col2, anode col5
  const { sol } = solveBoard([bat, r, d]);

  assert(sol.ok && sol.converged, 'solved and converged');
  const i = currentOf(sol, d);
  console.log(`      LED current = ${(i * 1000).toFixed(3)} mA`);
  assert(i > 0.001, 'LED is above the 1mA light threshold');
  approx(currentOf(sol, r), i, 1e-9, 'series resistor carries the same current');
  assert(i < 9 / 220, 'current is below the resistor-only ceiling');
}

// ── 3. The regression: shared resistor, two parallel LEDs ────
section('3. Shared 220R feeding two LEDs (old engine doubled this)');
{
  const bat = battery(hole(1, 'a'), hole(2, 'a'));
  const r   = resistor(hole(1, 'b'), hole(5, 'a'), 220);
  const d1  = led(hole(2, 'b'), hole(5, 'b'));
  const d2  = led(hole(2, 'c'), hole(5, 'c'));
  const { sol } = solveBoard([bat, r, d1, d2]);

  const iR  = currentOf(sol, r);
  const i1  = currentOf(sol, d1);
  const i2  = currentOf(sol, d2);
  console.log(`      R = ${(iR*1000).toFixed(3)} mA, D1 = ${(i1*1000).toFixed(3)} mA, D2 = ${(i2*1000).toFixed(3)} mA`);

  approx(i1 + i2, iR, 1e-8, 'KCL holds at the shared node');
  approx(i1, i2, 1e-9, 'identical LEDs split the current evenly');
  const legacy = (9 - 2.0) / 220;
  console.log(`      old engine would report ${(legacy*1000).toFixed(3)} mA for EACH LED`);
  assert(legacy > i1 * 1.5, 'old engine overstated each LED by more than 50%');
}

// ── 4. Reversed LED stays dark ───────────────────────────────
section('4. LED inserted backwards');
{
  const bat = battery(hole(1, 'a'), hole(2, 'a'));
  const r   = resistor(hole(1, 'b'), hole(5, 'a'), 220);
  const d   = led(hole(5, 'b'), hole(2, 'b'));      // cathode toward the resistor
  const { sol } = solveBoard([bat, r, d]);

  const i = Math.abs(currentOf(sol, d));
  console.log(`      reverse current = ${(i * 1e6).toExponential(3)} uA`);
  assert(i < 0.001, 'stays below the light-up threshold (LED is dark)');
}

// ── 5. Button gates the circuit ──────────────────────────────
section('5. Push button open vs closed');
{
  const build = pressed => {
    const bat = battery(hole(1, 'a'), hole(2, 'a'));
    const r   = resistor(hole(1, 'b'), hole(5, 'a'), 220);
    const btn = button(hole(5, 'b'), hole(8, 'a'), pressed);
    const d   = led(hole(2, 'b'), hole(8, 'b'));
    return { parts: [bat, r, btn, d], d };
  };

  const open   = build(false);
  const closed = build(true);
  const iOpen   = Math.abs(currentOf(solveBoard(open.parts).sol,   open.d));
  const iClosed = Math.abs(currentOf(solveBoard(closed.parts).sol, closed.d));

  console.log(`      open = ${(iOpen*1e9).toFixed(2)} nA, closed = ${(iClosed*1000).toFixed(3)} mA`);
  assert(iOpen   < 1e-6,  'open button: no meaningful current');
  assert(iClosed > 0.001, 'closed button: LED lights');
}

// ── 6. Wires merge nodes ─────────────────────────────────────
section('6. A user-drawn wire merges two columns');
{
  const bat = battery(hole(1, 'a'), hole(2, 'a'));
  const r   = resistor(hole(1, 'b'), hole(5, 'a'), 220);
  const d   = led(hole(2, 'b'), hole(9, 'b'));       // anode on col 9, nothing there yet
  const noWire = solveBoard([bat, r, d]);
  assert(Math.abs(currentOf(noWire.sol, d)) < 1e-6, 'no wire: circuit is open');

  const wire = { startHole: hole(5, 'c'), endHole: hole(9, 'c') };
  const withWire = solveBoard([bat, r, d], [wire]);
  assert(Math.abs(currentOf(withWire.sol, d)) > 0.001, 'wire closes the circuit and the LED lights');
}

// ── 7. Short circuit is caught ───────────────────────────────
section('7. Wire straight across the battery');
{
  const bat = battery(hole(1, 'a'), hole(2, 'a'));
  const w   = { startHole: hole(1, 'b'), endHole: hole(2, 'b') };
  const { sol } = solveBoard([bat], [w]);
  const i = Math.abs(currentOf(sol, bat));
  console.log(`      battery current = ${i.toFixed(3)} A`);
  assert(i > 1.0, 'flagged as a short (>1A through the cell)');
  assert(Number.isFinite(i), 'finite, not a divide-by-zero');
  approx(i, 9 / 1.0, 0.01, 'equals V / internal resistance');
}

// ── 8. Power rails ───────────────────────────────────────────
section('8. Power rails run the length of the board');
{
  const bat = battery(hole(1, 'tp'), hole(1, 'tn'));   // onto the + and − rails
  const r   = resistor(hole(40, 'tp'), hole(5, 'a'), 220);
  const d   = led(hole(40, 'tn'), hole(5, 'b'));
  const { sol } = solveBoard([bat, r, d]);
  const i = currentOf(sol, d);
  console.log(`      LED current via rails = ${(i * 1000).toFixed(3)} mA`);
  assert(i > 0.001, 'rail at col 1 reaches col 40');
}

console.log(`\n${'='.repeat(46)}`);
console.log(`  ${passed} passed, ${failed} failed`);
console.log('='.repeat(46));
if (failed) {
  console.log('\nFailures:');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
