// ─────────────────────────────────────────────────────────────
//  showcase.js — the scroll-driven homepage scene, loaded by app.html?showcase
//
//  The board zooms and spins in once. After that the parent page sends scroll
//  progress (0 to 1) as a surge-scroll event, and the camera follows a path of
//  keyframes: it swings around the board, then pushes in on each part as it
//  snaps in, on each pair of wires, and on the LED when Run lights it. Scrolling
//  back undoes everything. Nothing is saved.
// ─────────────────────────────────────────────────────────────

(function (App) {

  const { easeOut, tween, contact, contactPart, placePart, placeJumper } = App.stage;

  const FAR_SIDE = Math.PI;                 // half a revolution across the page
  const PART_AT = [0.17, 0.24, 0.31];       // battery, resistor, LED
  const WIRE_AT = [0.36, 0.39, 0.43, 0.47]; // the four jumpers in demo.surge
  const RUN_AT = 0.55;                      // Run lights the LED
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let target = 0;                           // where the page says we are
  let shown = 0;                            // eased toward target so scrolling feels smooth

  window.addEventListener('surge-scroll', e => {
    target = Math.min(1, Math.max(0, Number(e.detail) || 0));
  });

  // The intro starts at once. The demo circuit arrives in parallel and joins
  // the scene when it does, so the board never waits on the download.
  let demo = null;
  fetch('/editor/demo.surge').then(r => r.json()).then(data => { demo = data; }).catch(() => {});
  start();

  function start() {
    const bb = App.state.breadboard;
    const board = bb.group;
    const lookX = App.camera.aspect > 1.2 ? -3.5 : 0;   // board sits right of the text
    const LOOK = new THREE.Vector3(lookX, 0, 0);
    const ORIGIN = new THREE.Vector3(0, 0, 0);

    // Where the camera looks at each part and wire, from the board's own holes.
    const hole = (col, row) => bb.getHole(col, row)?.world.clone();
    const midOf = (...points) => {
      const found = points.filter(Boolean);
      return found.reduce((m, p) => m.add(p), new THREE.Vector3()).multiplyScalar(1 / found.length);
    };
    const BATTERY  = new THREE.Vector3(13.2, 0.5, 0);
    const RESISTOR = midOf(hole(4, 'a'), hole(8, 'a'));
    const LED      = midOf(hole(10, 'b'), hole(8, 'b'));
    const RAILS    = midOf(BATTERY, hole(1, 'tp'), hole(1, 'tn'));
    const SIGNAL   = midOf(hole(4, 'b'), hole(10, 'c'));

    // A camera key: the orbit centre, what it looks at, and the orbit shape.
    const overview = p => {
      const s = Math.sin(Math.PI * p);
      return { p, center: ORIGIN, look: LOOK, r: 24 - 3 * s, h: 14 + 4 * s, a: 0.6 + FAR_SIDE * p };
    };
    const focus = (p, at, aOff, r, h) => ({ p, center: at, look: at, r, h, a: 0.6 + FAR_SIDE * p + aOff });

    const EVENTS = [
      { p: PART_AT[0], at: BATTERY,  aOff:  0.7, r: 10, h: 6 },
      { p: PART_AT[1], at: RESISTOR, aOff: -0.6, r: 6.5, h: 4.5 },
      { p: PART_AT[2], at: LED,      aOff:  0.9, r: 6, h: 4 },
      { p: 0.375,      at: RAILS,    aOff: -0.8, r: 8, h: 6 },
      { p: 0.45,       at: SIGNAL,   aOff:  0.6, r: 7, h: 5 },
      { p: RUN_AT,     at: LED,      aOff: -0.5, r: 8, h: 5 },
    ];

    // Each event: swing out, push in, hold briefly, then pull back to the overview.
    const keys = [overview(0)];
    for (const e of EVENTS) {
      keys.push(
        overview(e.p - 0.03),
        focus(e.p, e.at, e.aOff, e.r, e.h),
        focus(e.p + 0.02, e.at, e.aOff, e.r, e.h),
        overview(e.p + 0.05),
      );
    }
    keys.push(overview(0.8), { ...overview(1), r: 34, h: 22 });
    keys.sort((a, b) => a.p - b.p);

    // The camera state at progress p, blended smoothly between keys.
    function sample(p) {
      if (p <= keys[0].p) return keys[0];
      for (let i = 0; i < keys.length - 1; i++) {
        const A = keys[i], B = keys[i + 1];
        if (p <= B.p) {
          const span = B.p - A.p;
          const t = span < 1e-6 ? 1 : (p - A.p) / span;
          const e = t * t * (3 - 2 * t);
          return {
            center: A.center.clone().lerp(B.center, e),
            look:   A.look.clone().lerp(B.look, e),
            r: A.r + (B.r - A.r) * e,
            h: A.h + (B.h - A.h) * e,
            a: A.a + (B.a - A.a) * e,
          };
        }
      }
      return keys[keys.length - 1];
    }

    function frame(c) {
      App.camera.position.set(
        c.center.x + c.r * Math.sin(c.a),
        c.center.y + c.h,
        c.center.z + c.r * Math.cos(c.a),
      );
      App.controls.target.copy(c.look);
      App.camera.lookAt(c.look);
    }

    App.controls.enabled = false;
    App.clearAll();

    // Bring the placed pieces in line with progress, in both directions.
    function sync(p) {
      if (running && p < RUN_AT) { App.stopSimulation(); running = false; }
      for (let i = WIRE_AT.length - 1; i >= 0; i--) {
        if (p < WIRE_AT[i] && wireRecs[i]) { App.removeWire(wireRecs[i]); wireRecs[i] = null; }
      }
      for (let i = PART_AT.length - 1; i >= 0; i--) {
        if (p < PART_AT[i] && partRecs[i]) { App.removeComponent(partRecs[i]); partRecs[i] = null; }
      }
      PART_AT.forEach((at, i) => {
        if (p < at || partRecs[i]) return;
        const piece = placePart(demo.components[i], bb);
        partRecs[i] = piece;
        if (piece) contactPart(piece.group);
      });
      WIRE_AT.forEach((at, i) => {
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

    const partRecs = [];
    const wireRecs = [];
    let running = false;

    // The intro: the board drops in while the camera zooms in and spins once.
    const rest = board.position.y;
    tween(2400, k => {
      const e = easeOut(k);
      board.position.y = rest + 7 * (1 - e);
      frame({ center: ORIGIN, look: LOOK, r: 24 + 14 * (1 - e), h: 14 + 10 * (1 - e), a: 0.6 - 5.5 * (1 - e) });
    }).then(() => {
      App.addTicker(() => {
        shown = calm ? target : shown + (target - shown) * 0.1;
        frame(sample(shown));
        if (demo) sync(shown);
      });
    });
  }

})(window.App);
