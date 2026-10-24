// ─────────────────────────────────────────────────────────────
//  parts-more.js — 3D models for the newer parts, and their footprints
//
//  Each part is a row of pins, or two rows for the 7-segment display,
//  laid out from the hole it is placed on. A builder takes its holes in
//  pin order and returns { group, pins }, like the builders in parts.js:
//  pins sit on the holes themselves, at board level.
//
//  The shapes are drawn from each part's published size. They are readable
//  stand-ins, not vendor models.
// ─────────────────────────────────────────────────────────────

(function (App) {

  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const lin = App.lin;

  const shared = m => { m.userData.shared = true; return m; };
  const MAT = {
    lead:    shared(new THREE.MeshStandardMaterial({ color: lin(0xd9dce1), metalness: 1.0, roughness: 0.25 })),
    steel:   shared(new THREE.MeshStandardMaterial({ color: lin(0xc3c7cd), metalness: 1.0, roughness: 0.3 })),
    epoxy:   shared(new THREE.MeshPhysicalMaterial({ color: lin(0x17181c), roughness: 0.42, clearcoat: 0.5, clearcoatRoughness: 0.3 })),
    blue:    shared(new THREE.MeshPhysicalMaterial({ color: lin(0x1d4ed8), roughness: 0.45, clearcoat: 0.3, clearcoatRoughness: 0.4 })),
    capBlue: shared(new THREE.MeshPhysicalMaterial({ color: lin(0x1e3a8a), roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.25 })),
    rubber:  shared(new THREE.MeshStandardMaterial({ color: lin(0x0b0c0e), roughness: 0.9 })),
    white:   shared(new THREE.MeshStandardMaterial({ color: lin(0xf1f1ee), roughness: 0.5 })),
    charcoal: shared(new THREE.MeshPhysicalMaterial({ color: lin(0x2b2f36), roughness: 0.4, clearcoat: 0.4 })),
    knob:    shared(new THREE.MeshPhysicalMaterial({ color: lin(0xb9bec6), roughness: 0.3, metalness: 0.6 })),
    pcb:     shared(new THREE.MeshStandardMaterial({ color: lin(0x1f4fb0), roughness: 0.55 })),
    grille:  shared(new THREE.MeshStandardMaterial({ color: lin(0x6b7079), roughness: 0.6, metalness: 0.4 })),
    fan:     shared(new THREE.MeshStandardMaterial({ color: lin(0x25282e), roughness: 0.5 })),
    blade:   shared(new THREE.MeshStandardMaterial({ color: lin(0xe7e8ea), roughness: 0.45 })),
    wireRed: shared(new THREE.MeshStandardMaterial({ color: lin(0xdc2626), roughness: 0.5 })),
    wireBlk: shared(new THREE.MeshStandardMaterial({ color: lin(0x18191c), roughness: 0.5 })),
    wireOrg: shared(new THREE.MeshStandardMaterial({ color: lin(0xf59e0b), roughness: 0.5 })),
    wireBrn: shared(new THREE.MeshStandardMaterial({ color: lin(0x7c3f1d), roughness: 0.5 })),
  };

  // The holes are the pins. Each builder works in its own frame: the origin
  // at the middle of the part, local +x along the holes, local +z across them.
  function frameAlong(a, b, center) {
    const A = V3(a.x, 0, a.z), B = V3(b.x, 0, b.z);
    const d = B.clone().sub(A);
    const span = d.length();
    d.normalize();
    const group = new THREE.Group();
    group.position.copy(center || A.clone().add(B).multiplyScalar(0.5));
    group.rotation.y = Math.atan2(-d.z, d.x);
    group.updateMatrixWorld(true);
    return { group, span };
  }

  function factory(group) {
    const add = (geo, mat, x, y, z) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = m.receiveShadow = true;
      group.add(m);
      return m;
    };
    return {
      add,
      box: (w, h, d, mat, x, y, z) => add(new THREE.BoxGeometry(w, h, d), mat, x, y, z),
      cyl: (r, h, mat, x, y, z, seg = 16) => add(new THREE.CylinderGeometry(r, r, h, seg), mat, x, y, z),
    };
  }

  // A straight lead from the board up to height `top`, at each hole.
  function legs(f, group, holes, top, mat) {
    holes.forEach(h => {
      const p = group.worldToLocal(V3(h.x, 0, h.z));
      f.cyl(0.045, top, mat, p.x, top / 2, p.z, 8);
    });
  }

  const pinsOf = holes => holes.map(h => V3(h.x, 0, h.z));

  // ── Electrolytic capacitor: a blue can with a white stripe on the − side ──
  function buildCapacitor(holes) {
    const { group } = frameAlong(holes[0], holes[1]);
    const f = factory(group);
    const S = 0.5, R = 0.5, H = 1.3;
    legs(f, group, holes, S + 0.12, MAT.lead);
    f.cyl(R, H, MAT.capBlue, 0, S + H / 2, 0, 40);
    f.cyl(R - 0.02, 0.12, MAT.rubber, 0, S + H + 0.02, 0, 40);
    f.box(0.04, H * 0.9, 0.2, MAT.white, R - 0.01, S + H / 2, 0);   // stripe on the − side
    return { group, pins: pinsOf(holes) };
  }

  // ── Potentiometer: a box body, a metal shaft and a knob ──
  function buildPotentiometer(holes) {
    const { group, span } = frameAlong(holes[0], holes[2]);
    const f = factory(group);
    const S = 0.5, BH = 1.1;
    legs(f, group, holes, S, MAT.lead);
    f.box(span + 1.0, BH, 1.6, MAT.charcoal, 0, S + BH / 2, 0);
    f.cyl(0.2, 0.55, MAT.steel, 0, S + BH + 0.27, 0, 20);
    f.cyl(0.62, 0.4, MAT.knob, 0, S + BH + 0.75, 0, 36);
    f.box(0.08, 0.03, 0.5, MAT.charcoal, 0, S + BH + 0.97, 0);   // pointer
    return { group, pins: pinsOf(holes) };
  }

  // ── Servo (SG90 size): a blue body on standoff leads, with a white horn ──
  function buildServo(holes) {
    const { group, span } = frameAlong(holes[0], holes[2]);
    const f = factory(group);
    const S = 1.0, W = 2.0, H = 2.6, L = 3.6;
    const colours = [MAT.wireOrg, MAT.wireRed, MAT.wireBrn];   // signal, +, −
    holes.forEach((h, i) => {
      const p = group.worldToLocal(V3(h.x, 0, h.z));
      f.cyl(0.05, S, colours[i], p.x, S / 2, p.z, 8);
    });
    f.box(W, H, L, MAT.blue, 0, S + H / 2, 0);
    f.box(span + 2.0, 0.16, 0.9, MAT.blue, 0, S + H - 0.45, 0);   // mounting flange
    f.cyl(0.72, 0.14, MAT.white, 0, S + H + 0.07, -0.6, 28);      // horn
    return { group, pins: pinsOf(holes) };
  }

  // ── Ultrasonic module (HC-SR04): a blue board on standoffs, two transducers ──
  function buildUltrasonic(holes) {
    const { group } = frameAlong(holes[0], holes[3]);
    const f = factory(group);
    const S = 1.2, L = 7.1, W = 3.1, T = 0.14;
    legs(f, group, holes, S, MAT.lead);
    f.box(L, T, W, MAT.pcb, 0, S + T / 2, 0);
    for (const x of [-2.2, 2.2]) {
      f.cyl(1.15, 1.2, MAT.steel, x, S + T + 0.6, 0, 40);
      f.cyl(0.95, 0.04, MAT.grille, x, S + T + 1.22, 0, 40);
    }
    return { group, pins: pinsOf(holes) };
  }

  // ── Transistor (TO-92): a black epoxy D on three leads ──
  function buildTransistor(holes) {
    const { group } = frameAlong(holes[0], holes[2]);
    const f = factory(group);
    const S = 0.7;
    legs(f, group, holes, S + 0.05, MAT.lead);
    const rx = 0.42, ry = 0.72;
    const shape = new THREE.Shape();
    shape.moveTo(-rx, 0);
    shape.lineTo(rx, 0);
    shape.absellipse(0, 0, rx, ry, 0, Math.PI, false, 0);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.55, bevelEnabled: false, curveSegments: 24 });
    geo.translate(0, 0, -0.275);
    f.add(geo, MAT.epoxy, 0, S, 0);
    return { group, pins: pinsOf(holes) };
  }

  // ── DC fan: a square housing with a window, and seven blades that turn ──
  const spinning = new Set();
  let lastTick = null, ticking = false;
  function startSpin() {
    if (ticking) return;
    ticking = true;
    App.addTicker(t => {
      if (lastTick == null) lastTick = t;
      const dt = Math.min(0.1, t - lastTick);
      lastTick = t;
      spinning.forEach(blades => { blades.rotation.y += dt * 22; });
    });
  }

  function buildFan(holes) {
    startSpin();
    const { group } = frameAlong(holes[0], holes[1]);
    const f = factory(group);
    const S = 1.1, Z = 3.6, T = 0.5;
    legs(f, group, holes, S, MAT.wireRed);
    f.box(Z, T, 0.45, MAT.fan, 0, S + T / 2, Z / 2 - 0.22);
    f.box(Z, T, 0.45, MAT.fan, 0, S + T / 2, -Z / 2 + 0.22);
    f.box(0.45, T, Z - 0.9, MAT.fan, Z / 2 - 0.22, S + T / 2, 0);
    f.box(0.45, T, Z - 0.9, MAT.fan, -Z / 2 + 0.22, S + T / 2, 0);
    const blades = new THREE.Group();
    blades.position.set(0, S + T / 2, 0);
    for (let k = 0; k < 7; k++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.05, 0.42), MAT.blade);
      blade.position.x = 0.6;
      blade.rotation.set(0.35, 0, 0);
      blade.castShadow = true;
      const arm = new THREE.Group();
      arm.rotation.y = (k * Math.PI * 2) / 7;
      arm.add(blade);
      blades.add(arm);
    }
    blades.add(new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.22, 20), MAT.fan));
    group.add(blades);
    group.userData.setActive = on => { if (on) spinning.add(blades); else spinning.delete(blades); };
    return { group, pins: pinsOf(holes) };
  }

  // ── 7-segment display, ten pins in two rows across the centre channel ──
  //  Pins 1-5 run along the top row (holes 0-4), pins 6-10 back along the bottom row.
  function buildSeg7(holes) {
    const top = holes.slice(0, 5), bottom = holes.slice(5);
    const centre = V3(holes.reduce((s, h) => s + h.x, 0) / holes.length, 0, holes.reduce((s, h) => s + h.z, 0) / holes.length);
    const { group } = frameAlong(top[0], top[4], centre);
    const f = factory(group);
    const S = 0.5, H = 0.95, BL = 2.4, BD = 1.75;
    legs(f, group, holes, S, MAT.lead);
    f.box(BL, H, BD, MAT.epoxy, 0, S + H / 2, 0);
    // the digit face: seven segments, unlit
    const seg = (w, d, x, z) => f.box(w, 0.05, d, shared(new THREE.MeshStandardMaterial({ color: lin(0x3a0c0c), roughness: 0.4 })), x, S + H + 0.02, z);
    seg(0.95, 0.14, 0, -0.5);      // a
    seg(0.14, 0.5, 0.45, -0.25);   // b
    seg(0.14, 0.5, 0.45, 0.25);    // c
    seg(0.95, 0.14, 0, 0.5);       // d
    seg(0.14, 0.5, -0.45, 0.25);   // e
    seg(0.14, 0.5, -0.45, -0.25);  // f
    seg(0.95, 0.14, 0, 0);         // g
    f.box(0.1, 0.05, 0.1, MAT.white, -BL / 2 + 0.25, S + H + 0.02, -BD / 2 + 0.25);   // pin 1 mark
    return { group, pins: pinsOf(holes) };
  }

  // What each part is laid out as. `step` is the gap between pins in holes;
  // `dip` parts take two rows of pins, `pins` in total.
  const SPEC = {
    capacitor:     { pins: 2, step: 2, build: buildCapacitor },
    potentiometer: { pins: 3, step: 1, build: buildPotentiometer },
    servo:         { pins: 3, step: 1, build: buildServo },
    ultrasonic:    { pins: 4, step: 1, build: buildUltrasonic },
    transistor:    { pins: 3, step: 1, build: buildTransistor },
    fan:           { pins: 2, step: 2, build: buildFan },
    seg7:          { pins: 10, dip: true, build: buildSeg7 },
  };

  App.PART_SPECS = SPEC;
  App.buildPart = (type, holes) => SPEC[type].build(holes);
  App.buildPartPreview = (type, holes, ok) => {
    const { group } = SPEC[type].build(holes);
    App.ghostify?.(group, ok);
    return group;
  };

})(window.App = window.App || {});
