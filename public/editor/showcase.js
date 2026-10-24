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

  // Checkpoints sit at the top of each section: Place 0.196, Wire 0.393,
  // Run 0.589, Keep 0.786, Closing 0.982 (share of the page's total scroll).
  // The battery lands on its checkpoint; the rest land between checkpoints.
  const PART_AT = [0.196, 0.28, 0.34];      // battery, resistor, LED
  const WIRE_AT = [0.393, 0.41, 0.48, 0.5]; // the four jumpers in demo.surge
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
    // The overview orbits the whole board at angle a. Each overview takes the
    // angle of the close-up before it, so the angle only ever increases as the
    // page scrolls, and the camera never swings back the way it came.
    const overview = (p, a) => ({ p, center: ORIGIN, look: LOOK, r: 24, h: 14, a });
    // Close-up angles are absolute, not relative to the sweep. The camera sits
    // at +z for angle 0, which is the side of the battery that carries its label.
    const focus = (p, at, a, r, h) => ({ p, center: at, look: at, r, h, a });

    const EVENTS = [
      { p: PART_AT[0], at: BATTERY,  a: 0.12, r: 10, h: 6 },
      { p: PART_AT[1], at: RESISTOR, a: 0.35, r: 6.5, h: 4.5 },
      { p: PART_AT[2], at: LED,      a: 0.5,  r: 6, h: 4 },
      { p: 0.393,      at: RAILS,    a: 0.9,  r: 8, h: 6 },
      { p: 0.48,       at: SIGNAL,   a: 1.1,  r: 7, h: 5 },
      { p: RUN_AT,     at: LED,      a: 1.4,  r: 8, h: 5 },
    ];

    // Each event: push in, hold briefly, then pull back to the overview at the
    // same angle. Events close together stay on their close-ups, so the camera
    // does not bounce out and back in between two parts.
    const keys = [overview(0, 0)];
    let prevA = 0;
    EVENTS.forEach((e, i) => {
      const next = EVENTS[i + 1];
      const prevEnd = i ? EVENTS[i - 1].p + 0.05 : 0;
      if (e.p - 0.03 > prevEnd) keys.push(overview(e.p - 0.03, prevA));
      keys.push(focus(e.p, e.at, e.a, e.r, e.h), focus(e.p + 0.02, e.at, e.a, e.r, e.h));
      if (!next || next.p - 0.03 > e.p + 0.05) keys.push(overview(e.p + 0.05, e.a));
      prevA = e.a;
    });
    // After Run, the camera swings to the far side and pulls wide.
    keys.push(overview(0.786, 2.6), overview(0.982, 3.9), { ...overview(1, 3.9), r: 34, h: 22 });
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
      frame({ center: ORIGIN, look: LOOK, r: 24 + 14 * (1 - e), h: 14 + 10 * (1 - e), a: -5.5 * (1 - e) });
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
