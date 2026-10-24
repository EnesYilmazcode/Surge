// ─────────────────────────────────────────────────────────────
//  showcase.js — the scroll-driven homepage scene, loaded by app.html?showcase
//
//  The board drops in and the camera spins once. After that the parent page
//  sends scroll progress (0 to 1) as a surge-scroll event: the camera travels
//  half a revolution, parts snap in and wires click on at set points, and the
//  LED lights near the far side. Scrolling back undoes it. Nothing is saved.
// ─────────────────────────────────────────────────────────────

(function (App) {

  const { easeOut, tween, contact, contactPart, placePart, placeJumper } = App.stage;

  const FAR_SIDE = Math.PI;      // half a revolution across the whole page
  const RUN_AT = 0.76;           // progress at which Run lights the LED
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let target = 0;                // where the page says we are
  let shown = 0;                 // eased toward target so scrolling feels smooth

  window.addEventListener('surge-scroll', e => {
    target = Math.min(1, Math.max(0, Number(e.detail) || 0));
  });

  fetch('/editor/demo.surge')
    .then(r => r.json())
    .then(demo => start(demo))
    .catch(() => {});

  function start(demo) {
    const bb = App.state.breadboard;
    const board = bb.group;
    const partAt = demo.components.map((_, i) => 0.08 + i * 0.12);
    const wireAt = demo.wires.map((_, i) => 0.46 + i * 0.05);
    const partRecs = [];
    const wireRecs = [];
    let running = false;

    // The camera circles the board's centre and looks at a point just left of
    // it, so the board stays right of the homepage text at every angle.
    const lookX = App.camera.aspect > 1.2 ? -3.5 : 0;
    function frame(angle, radius, height) {
      App.camera.position.set(radius * Math.sin(angle), height, radius * Math.cos(angle));
      App.controls.target.set(lookX, 0, 0);
      App.camera.lookAt(App.controls.target);
    }
    App.controls.enabled = false;
    App.clearAll();

    // Bring the placed pieces in line with progress, in both directions.
    function sync(p) {
      if (running && p < RUN_AT) { App.stopSimulation(); running = false; }
      for (let i = wireAt.length - 1; i >= 0; i--) {
        if (p < wireAt[i] && wireRecs[i]) { App.removeWire(wireRecs[i]); wireRecs[i] = null; }
      }
      for (let i = partAt.length - 1; i >= 0; i--) {
        if (p < partAt[i] && partRecs[i]) { App.removeComponent(partRecs[i]); partRecs[i] = null; }
      }
      partAt.forEach((at, i) => {
        if (p < at || partRecs[i]) return;
        const piece = placePart(demo.components[i], bb);
        partRecs[i] = piece;
        if (piece) contactPart(piece.group);
      });
      wireAt.forEach((at, i) => {
        if (p < at || wireRecs[i]) return;
        const before = App.state.wires.length;
        placeJumper(demo.wires[i], partRecs, bb);
        if (App.state.wires.length > before) {
          const w = App.state.wires[before];
          wireRecs[i] = w;
          contact(w.startWorld);
          contact(w.endWorld);
        }
      });
      if (!running && p >= RUN_AT) { App.runSimulation(); running = true; }
    }

    // The intro: the board drops in while the camera spins once and settles.
    const rest = board.position.y;
    tween(3400, k => {
      const e = easeOut(k);
      board.position.y = rest + 7 * (1 - e);
      frame(0.6 - 5.5 * (1 - e), 24, 14);
    }).then(() => {
      App.addTicker(() => {
        shown = calm ? target : shown + (target - shown) * 0.12;
        frame(0.6 + FAR_SIDE * shown, 24 + 3 * shown, 14 + 4 * shown);
        sync(shown);
      });
    });
  }

})(window.App);
