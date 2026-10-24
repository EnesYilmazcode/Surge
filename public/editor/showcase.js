// ─────────────────────────────────────────────────────────────
//  showcase.js: the homepage scene, loaded by app.html?showcase
//
//  The page says which section it is on (surge-section). Each section names the
//  pieces it should show, and the scene brings the board to that set one piece
//  at a time, moving the camera to each piece as it lands. The page also says
//  when Run is pressed (surge-run) and when it is left (surge-stop). Nothing is
//  saved.
// ─────────────────────────────────────────────────────────────

(function (App) {

  // Parts: 0 battery, 1 resistor, 2 LED. Wires: 0 and 1 are the battery's red and
  // black leads, which go on together. 2 and 3 are the signal jumpers.
  const WIRE_GROUPS = [[0, 1], [2], [3]];
  const SECTIONS = [
    { parts: [0, 1, 2], wires: [0, 1, 2, 3] }, // 0 the demo, already built
    { parts: [], wires: [] },                  // 1 an empty board
    { parts: [0, 1, 2], wires: [] },           // 2 place the real parts
    { parts: [0, 1, 2], wires: [0, 1, 2, 3] }, // 3 wire it up
    { parts: [0, 1, 2], wires: [0, 1, 2, 3] }, // 4 press run
    { parts: [0, 1, 2], wires: [0, 1, 2, 3] }, // 5 closing: the scene is hidden
  ];
  const RUN = 4;
  const FIRST_GAP = 350;   // ms between pieces on the first build
  const GAP = 800;         // ms between pieces going on
  const CLEAR_GAP = 380;   // ms between pieces coming off
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const { easeOut, tween, contact, contactPart, placePart, placeJumper } = App.stage;

  let demo = null;         // the demo circuit, once it has loaded
  let introDone = false;
  let ready = false;       // intro done and the demo is loaded
  let section = 0;         // the section the page is on
  let gen = 0;             // cancels a transition that is still playing
  let lit = false;
  let firstBuild = true;
  const partRecs = [];
  const wireRecs = [];

  function start() {
    const bb = App.state.breadboard;
    const board = bb.group;
    const lookShift = App.camera.aspect > 1.2 ? -3.5 : 0;   // the homepage text sits left
    const fit = Math.min(3.5, Math.max(1, 1.6 / App.camera.aspect));

    const hole = (col, row) => bb.getHole(col, row)?.world.clone();
    const midOf = (...points) => {
      const found = points.filter(Boolean);
      return found.reduce((m, p) => m.add(p), new THREE.Vector3()).multiplyScalar(1 / found.length);
    };
    const BATTERY = new THREE.Vector3(13.2, 0.5, 0);
    const RESISTOR = midOf(hole(4, 'a'), hole(8, 'a'));
    const LED = midOf(hole(10, 'b'), hole(8, 'b'));
    // Centred between the board's left edge and the battery, so both are in shot.
    const CIRCUIT = new THREE.Vector3((BATTERY.x - bb.BOARD_W / 2) / 2, 0, 0);
    const LOOK = new THREE.Vector3(CIRCUIT.x + lookShift, 0, 0);

    // Camera views. Each is a front view: straight out along +z from its look point.
    const OVERVIEW = { look: LOOK, r: 30 * fit, h: 11 * fit };
    const PART_VIEW = [
      { look: BATTERY, r: 14, h: 6 },
      { look: RESISTOR, r: 7, h: 3.5 },
      { look: LED, r: 7, h: 3.5 },
    ];
    const RUN_VIEW = { look: LED, r: 7, h: 3.5 };

    const cam = { look: LOOK.clone(), r: OVERVIEW.r, h: OVERVIEW.h };   // where the camera is
    const goal = { look: LOOK.clone(), r: OVERVIEW.r, h: OVERVIEW.h };  // where it is heading
    const aim = view => {
      goal.look.copy(view.look);
      goal.r = view.r;
      goal.h = view.h;
    };

    const addPart = i => {
      if (partRecs[i]) return;
      const piece = placePart(demo.components[i], bb);
      partRecs[i] = piece;
      if (piece) contactPart(piece.group);
    };
    const removePart = i => {
      if (!partRecs[i]) return;
      App.removeComponent(partRecs[i]);
      partRecs[i] = null;
    };
    const addWire = i => {
      if (wireRecs[i]) return;
      const before = App.state.wires.length;
      placeJumper(demo.wires[i], partRecs, bb);
      if (App.state.wires.length > before) {
        const w = App.state.wires[before];
        wireRecs[i] = w;
        contact(w.startWorld);
        contact(w.endWorld);
      }
    };
    const removeWire = i => {
      if (!wireRecs[i]) return;
      App.removeWire(wireRecs[i]);
      wireRecs[i] = null;
    };

    // Bring the board to a section's pieces. Pieces leave in reverse order and
    // arrive in order, and the camera moves to each one as it lands.
    function transition(target) {
      const want = SECTIONS[target];
      const myGen = ++gen;
      const steps = [];
      let t = 0;
      const at = (fn, gap) => {
        steps.push([t, fn]);
        t += gap;
      };
      const gap = firstBuild ? FIRST_GAP : GAP;
      firstBuild = false;

      if (lit && target !== RUN && target !== 5) {
        App.stopSimulation();
        lit = false;
      }
      aim(target >= RUN ? RUN_VIEW : OVERVIEW);

      const dropWires = [0, 1, 2, 3].filter(i => wireRecs[i] && !want.wires.includes(i)).reverse();
      const dropParts = [0, 1, 2].filter(i => partRecs[i] && !want.parts.includes(i)).reverse();
      for (const i of dropWires) at(() => removeWire(i), CLEAR_GAP);
      for (const i of dropParts) at(() => removePart(i), CLEAR_GAP);

      for (const i of want.parts.filter(i => !partRecs[i])) {
        at(() => {
          addPart(i);
          aim(PART_VIEW[i]);
        }, gap);
      }
      for (const group of WIRE_GROUPS) {
        if (!group.some(i => want.wires.includes(i) && !wireRecs[i])) continue;
        at(() => {
          for (const i of group) if (want.wires.includes(i)) addWire(i);
        }, gap);
      }
      at(() => aim(target >= RUN ? RUN_VIEW : OVERVIEW), 0);

      for (const [delay, fn] of steps) {
        setTimeout(() => {
          if (myGen === gen) fn();
        }, delay);
      }
    }

    const complete = sec =>
      SECTIONS[sec].parts.every(i => partRecs[i]) && SECTIONS[sec].wires.every(i => wireRecs[i]);

    window.addEventListener('surge-section', e => {
      section = Math.min(SECTIONS.length - 1, Math.max(0, Number(e.detail) || 0));
      if (ready) transition(section);
    });
    window.addEventListener('surge-run', () => {
      if (!lit && ready && section === RUN && complete(RUN)) {
        App.runSimulation();
        lit = true;
      }
    });
    window.addEventListener('surge-stop', () => {
      if (lit) {
        App.stopSimulation();
        lit = false;
      }
    });

    function maybeStart() {
      if (ready || !introDone || !demo) return;
      ready = true;
      transition(section);
    }

    fetch('/editor/demo.surge')
      .then(r => r.json())
      .then(data => {
        demo = data;
        maybeStart();
      })
      .catch(() => {});

    App.controls.enabled = false;
    App.clearAll();

    // The intro: the board drops in while the camera zooms in and spins once,
    // settling square to the front. Then the camera follows the camera goal.
    const rest = board.position.y;
    tween(2400, k => {
      const e = easeOut(k);
      board.position.y = rest + 7 * (1 - e);
      const r = (30 + 14 * (1 - e)) * fit;
      const h = (11 + 12 * (1 - e)) * fit;
      const a = -5.5 * (1 - e);
      App.camera.position.set(LOOK.x + r * Math.sin(a), LOOK.y + h, LOOK.z + r * Math.cos(a));
      App.controls.target.copy(LOOK);
      App.camera.lookAt(LOOK);
    }).then(() => {
      let last = null;
      App.addTicker(now => {
        const dt = last === null ? 1 / 60 : Math.min(0.05, now - last);
        last = now;
        const k = calm ? 1 : 1 - Math.exp(-dt * 4.5);
        cam.look.lerp(goal.look, k);
        cam.r += (goal.r - cam.r) * k;
        cam.h += (goal.h - cam.h) * k;
        App.camera.position.set(cam.look.x, cam.look.y + cam.h, cam.look.z + cam.r);
        App.controls.target.copy(cam.look);
        App.camera.lookAt(cam.look);
      });
      introDone = true;
      maybeStart();
    });
  }

  start();

})(window.App);
