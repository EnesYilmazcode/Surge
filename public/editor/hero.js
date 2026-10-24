// ─────────────────────────────────────────────────────────────
//  hero.js — the homepage preview, loaded only by app.html?hero
//
//  Plays the demo circuit one piece at a time, so the battery, resistor,
//  LED and jumpers each drop onto the board. It then runs the solver, holds
//  while the LED lights, and starts over. Nothing is saved (App.isHero).
// ─────────────────────────────────────────────────────────────

(function (App) {

  const STEP_MS = 850;     // pause between pieces, long enough to see each drop
  const HOLD_MS = 4200;    // how long the lit circuit stays on screen
  const wait = ms => new Promise(done => setTimeout(done, ms));

  // Place one saved part the way rebuildBoard does. Returns its record or null.
  function placePart(part, bb) {
    const before = App.state.components.length;
    const hole = ref => bb.getHole(ref.col, ref.row);
    if (part.type === 'battery' && part.position) {
      App.placeBattery(part.position.x, part.position.z, part.values);
    } else if (part.holeRefs?.length === 2) {
      const a = hole(part.holeRefs[0]), b = hole(part.holeRefs[1]);
      if (!a || !b) return null;
      if (part.type === 'resistor') App.placeResistor(a, b, part.values);
      else if (part.type === 'led') App.placeLED(a, b, part.values);
    }
    return App.state.components.length > before ? App.state.components[before] : null;
  }

  // Run one saved jumper between two ends, as rebuildBoard does.
  function placeJumper(wire, parts, bb) {
    const end = (hole, compIdx, pinIdx) => {
      if (hole) {
        const h = bb.getHole(hole.col, hole.row);
        return h ? { world: h.world.clone(), holeRef: { col: h.col, row: h.row }, pinMesh: null } : null;
      }
      const pm = parts[compIdx]?.pinMeshes[pinIdx];
      return pm ? { world: pm.userData.world.clone(), holeRef: null, pinMesh: pm } : null;
    };
    const from = end(wire.startHole, wire.startCompIdx, wire.startPinIdx);
    const to   = end(wire.endHole, wire.endCompIdx, wire.endPinIdx);
    if (!from || !to) return;
    App.state.wireColor = wire.color ?? 0xef4444;
    App.state.wireStart = { world: from.world, holeRef: from.holeRef, pinMesh: from.pinMesh };
    App.finishWire(to);
  }

  const easeOut = k => 1 - Math.pow(1 - k, 3);

  // Run step(k) from 0 to 1 over `ms`, once per frame.
  const tween = (ms, step) => new Promise(done => {
    const t0 = performance.now();
    const tick = () => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      step(k);
      if (k === 1) { App.removeTicker(tick); done(); }
    };
    App.addTicker(tick);
  });

  // Keep the camera on a ring around the board. Angle is in radians.
  function orbit(angle, radius, height) {
    const t = App.controls.target;
    App.camera.position.set(t.x + radius * Math.sin(angle), height, t.z + radius * Math.cos(angle));
    App.camera.lookAt(t);
  }

  // The board drops in while the camera spins, then the spin slows to rest
  // at an angle. The derivative of easeOut is zero at the end, so it settles.
  async function intro(board) {
    const rest = board.position.y;
    const settle = 0.6;
    await tween(3400, k => {
      const e = easeOut(k);
      board.position.y = rest + 7 * (1 - e);
      orbit(settle - 5.5 * (1 - e), 30, 16);
    });
  }

  async function run(demo) {
    const bb = App.state.breadboard;
    // The board sits to the right of the homepage text, so shift the view left.
    App.controls.target.x = App.camera.aspect > 1.2 ? -3.5 : 0;
    App.controls.enabled = false;
    for (;;) {
      App.clearAll();
      if (calm) orbit(0.6, 30, 16);
      else await intro(bb.group);
      await wait(STEP_MS);

      const parts = [];
      for (const part of demo.components) {
        parts.push(placePart(part, bb));
        await wait(STEP_MS);
      }
      for (const wire of demo.wires) {
        placeJumper(wire, parts, bb);
        await wait(STEP_MS);
      }

      App.runSimulation();
      await wait(HOLD_MS);
      App.stopSimulation();
    }
  }

  // Visitors who ask for less motion get a still board, not a turning one.
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;

  fetch('/editor/demo.surge')
    .then(r => r.json())
    .then(demo => {
      run(demo);
    })
    .catch(() => {});

})(window.App);
