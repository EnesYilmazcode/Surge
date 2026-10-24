// ─────────────────────────────────────────────────────────────
//  showcase.js — the scroll-driven homepage scene, loaded by app.html?showcase
//
//  The board spins in once and settles square to the front, its long side
//  across the screen. After that the parent page sends scroll progress (0 to 1)
//  as a surge-scroll event, and the camera moves through keyframes: it pushes in
//  on the battery's label, pulls back so the jumpers can be watched drawing out
//  from the battery, and lights the LED at Run. Every view is a front view, so
//  the camera only moves in and out and up and down, never around. Scrolling
//  back undoes everything. Nothing is saved.
// ─────────────────────────────────────────────────────────────

(function (App) {

  const { easeOut, tween, contact, contactPart, placePart, placeJumper } = App.stage;

  // Checkpoints sit at the top of each section: Place 0.196, Wire 0.393,
  // Run 0.589, Keep 0.786, Closing 0.982 (share of the page's total scroll).
  // The battery lands on its checkpoint; the rest land between checkpoints.
  const PART_AT = [0.19, 0.28, 0.34];       // battery, resistor, LED
  const WIRE_AT = [0.385, 0.405, 0.48, 0.5]; // the four jumpers in demo.surge, drawn as the camera arrives
  const RUN_AT = 0.589;                     // Run lights the LED at its checkpoint
  const HYST = 0.012;                       // a part is removed only well past its threshold
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

    // The homepage text sits left, so the scene is shifted right to clear it.
    const lookShift = App.camera.aspect > 1.2 ? -3.5 : 0;

    // Where the camera looks, from the board's own holes.
    const hole = (col, row) => bb.getHole(col, row)?.world.clone();
    const midOf = (...points) => {
      const found = points.filter(Boolean);
      return found.reduce((m, p) => m.add(p), new THREE.Vector3()).multiplyScalar(1 / found.length);
    };
    const BATTERY  = new THREE.Vector3(13.2, 0.5, 0);
    const RESISTOR = midOf(hole(4, 'a'), hole(8, 'a'));
    const LED      = midOf(hole(10, 'b'), hole(8, 'b'));

    // The resting point of the camera: the middle of the whole circuit.
    // Centred between the board's left edge and the battery, so both are in shot.
    const CIRCUIT = new THREE.Vector3((BATTERY.x - bb.BOARD_W / 2) / 2, 0, 0);
    const LOOK = new THREE.Vector3(CIRCUIT.x + lookShift, 0, 0);

    // A camera key. The camera sits straight out along +z from its look point,
    // at height h, so every view is a front view of the long horizontal board.
    // On a narrow screen the board is wider than the view, so the overview and
    // wide shots pull further back to fit it.
    const fit = Math.min(3.5, Math.max(1, 1.6 / App.camera.aspect));
    const view = (p, look, r, h) => {
      const s = look === LOOK ? fit : 1;
      return { p, look, r: r * s, h: h * s };
    };
    const overview = p => view(p, LOOK, 30, 11);

    // Each event is a close-up on one piece. `until` holds a wider view for
    // several checkpoints, as when the jumpers draw out from the battery.
    const EVENTS = [
      { p: PART_AT[0], look: BATTERY,  r: 14, h: 6 },        // battery: its label faces the camera, all of it in shot
      { p: PART_AT[1], look: RESISTOR, r: 7,  h: 3.5 },
      { p: PART_AT[2], look: LED,      r: 7,  h: 3.5 },
      { p: WIRE_AT[0], look: LOOK,     r: 30, h: 11, until: WIRE_AT[3] + 0.02 },
      { p: RUN_AT,     look: LED,      r: 7,  h: 3.5 },
    ];

    // Each event: push in, hold briefly, then pull back to the overview. Events
    // close together stay on their view, so the camera does not bounce between
    // two parts.
    const keys = [overview(0)];
    EVENTS.forEach((e, i) => {
      const next = EVENTS[i + 1];
      const end = e.until ?? e.p + 0.02;
      const prev = EVENTS[i - 1];
      const prevEnd = prev ? (prev.until ?? prev.p + 0.02) + 0.05 : 0;
      if (e.p - 0.03 > prevEnd) keys.push(overview(e.p - 0.03));
      keys.push(view(e.p, e.look, e.r, e.h), view(end, e.look, e.r, e.h));
      if (!next || next.p - 0.03 > end + 0.05) keys.push(overview(end + 0.05));
    });
    keys.push(overview(0.786), overview(0.982), view(1, LOOK, 34, 13));
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
            look: A.look.clone().lerp(B.look, e),
            r: A.r + (B.r - A.r) * e,
            h: A.h + (B.h - A.h) * e,
          };
        }
      }
      return keys[keys.length - 1];
    }

    // Place the camera at angle a around its look point (0 is straight in
    // front; only the intro uses a non-zero angle, and it ends at zero).
    function frame(c) {
      const a = c.a ?? 0;
      App.camera.position.set(
        c.look.x + c.r * Math.sin(a),
        c.look.y + c.h,
        c.look.z + c.r * Math.cos(a),
      );
      App.controls.target.copy(c.look);
      App.camera.lookAt(c.look);
    }

    App.controls.enabled = false;
    App.clearAll();

    const partRecs = [];
    const wireRecs = [];
    let running = false;

    // The homepage's Run button lights the LED. Leaving the Run section turns it off.
    window.addEventListener('surge-run', () => {
      if (!running) { App.runSimulation(); running = true; }
    });
    window.addEventListener('surge-stop', () => {
      if (running) { App.stopSimulation(); running = false; }
    });

    // Bring the placed pieces in line with progress, in both directions.
    function sync(p) {
      if (running && p < RUN_AT - HYST) { App.stopSimulation(); running = false; }
      for (let i = WIRE_AT.length - 1; i >= 0; i--) {
        if (p < WIRE_AT[i] - HYST && wireRecs[i]) { App.removeWire(wireRecs[i]); wireRecs[i] = null; }
      }
      for (let i = PART_AT.length - 1; i >= 0; i--) {
        if (p < PART_AT[i] - HYST && partRecs[i]) { App.removeComponent(partRecs[i]); partRecs[i] = null; }
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
    }

    // The intro: the board drops in while the camera zooms in and spins once,
    // settling square to the front.
    const rest = board.position.y;
    tween(2400, k => {
      const e = easeOut(k);
      board.position.y = rest + 7 * (1 - e);
      frame({ look: LOOK, r: (30 + 14 * (1 - e)) * fit, h: (11 + 12 * (1 - e)) * fit, a: -5.5 * (1 - e) });
    }).then(() => {
      // A critically damped spring follows the page. It never overshoots, so a
      // hard scroll glides to the new spot instead of swinging back and forth.
      const W = 5;                     // stiffness: the camera settles in about a second
      let vel = 0, last = null;
      App.addTicker(now => {
        if (calm) {
          shown = target;
        } else {
          const dt = last === null ? 1 / 60 : Math.min(0.05, now - last);
          last = now;
          vel += (W * W * (target - shown) - 2 * W * vel) * dt;
          shown = Math.min(1, Math.max(0, shown + vel * dt));
        }
        frame(sample(shown));
        if (demo) sync(shown);
      });
    });
  }

})(window.App);
