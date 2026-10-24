// ─────────────────────────────────────────────────────────────
//  stage.js — helpers shared by the homepage scenes (hero.js, showcase.js)
//
//  Tweens, the camera orbit, the amber contact ring, and placing saved parts
//  and jumpers the way rebuildBoard does. Loaded only on ?hero and ?showcase.
// ─────────────────────────────────────────────────────────────

(function (App) {

  // Tells the homepage which step is on screen, so its labels can follow.
  const phase = name => window.dispatchEvent(new CustomEvent('surge-phase', { detail: name }));

  const easeOut = k => 1 - Math.pow(1 - k, 3);
  const wait = ms => new Promise(done => setTimeout(done, ms));

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

  // A brief amber ring on the board where a piece clicks home.
  const RING = new THREE.RingGeometry(0.14, 0.2, 40);
  RING.rotateX(-Math.PI / 2);
  function contact(at) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.9, depthWrite: false });
    const ring = new THREE.Mesh(RING, mat);
    ring.position.set(at.x, 0.42, at.z);
    App.scene.add(ring);
    tween(520, k => {
      ring.scale.setScalar(1 + 4 * easeOut(k));
      mat.opacity = 0.9 * (1 - k);
      if (k === 1) { App.scene.remove(ring); mat.dispose(); }
    });
  }

  function contactPart(group) {
    contact(new THREE.Box3().setFromObject(group).getCenter(new THREE.Vector3()));
  }

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

  App.stage = { phase, easeOut, wait, tween, orbit, contact, contactPart, placePart, placeJumper };

})(window.App);
