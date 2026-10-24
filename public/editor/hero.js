// ─────────────────────────────────────────────────────────────
//  hero.js — the homepage intro, loaded only by app.html?hero
//
//  The board drops in while the camera spins, then the demo circuit is built
//  one piece at a time. It runs the solver, pulls back, holds while the LED
//  lights, and starts over. Nothing is saved (App.isHero).
// ─────────────────────────────────────────────────────────────

(function (App) {

  const { phase, easeOut, wait, tween, orbit, contactPart, contact, placePart, placeJumper } = App.stage;

  const STEP_MS = 850;     // pause between pieces, long enough to see each drop
  const HOLD_MS = 6000;    // how long the lit circuit stays on screen

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

  // With the LED lit, the camera spins once more, settles, then pulls back to
  // show the whole working circuit.
  async function finale() {
    await tween(2600, k => orbit(0.6 + 3.0 * easeOut(k), 30, 16));
    await tween(2400, k => {
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      orbit(3.6, 30 + 14 * e, 16 + 8 * e);
    });
  }

  async function run(demo) {
    const bb = App.state.breadboard;
    // The board sits to the right of the homepage text, so shift the view left.
    App.controls.target.x = App.camera.aspect > 1.2 ? -3.5 : 0;
    App.controls.enabled = false;
    for (;;) {
      App.clearAll();
      phase('board');
      if (calm) orbit(0.6, 30, 16);
      else await intro(bb.group);
      phase('snap');
      await wait(STEP_MS);

      const parts = [];
      for (const part of demo.components) {
        const piece = placePart(part, bb);
        parts.push(piece);
        if (piece) contactPart(piece.group);
        await wait(STEP_MS);
      }
      phase('wire');
      for (const wire of demo.wires) {
        const before = App.state.wires.length;
        placeJumper(wire, parts, bb);
        if (App.state.wires.length > before) {
          const w = App.state.wires[before];
          contact(w.startWorld);
          contact(w.endWorld);
        }
        await wait(STEP_MS);
      }

      phase('run');
      App.runSimulation();
      if (!calm) await finale();
      phase('hold');
      await wait(HOLD_MS);
      App.stopSimulation();
      document.documentElement.classList.add('fade');
      await wait(800);
    }
  }

  // Visitors who ask for less motion get a still board, not a turning one.
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;

  fetch('/editor/demo.surge')
    .then(r => r.json())
    .then(demo => run(demo))
    .catch(() => {});

})(window.App);
