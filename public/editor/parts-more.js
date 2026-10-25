// ─────────────────────────────────────────────────────────────
//  parts-more.js — 3D model and footprint for the 7-segment display
//
//  The display takes ten pins in two rows across the centre channel: pins
//  1-5 along the top row, 6-10 back along the bottom row. The builder takes
//  its holes in pin order and returns { group, pins }, like the builders in
//  parts.js: pins sit on the holes, at board level.
//
//  The model is a readable stand-in drawn from the part's size, not a vendor model.
// ─────────────────────────────────────────────────────────────

(function (App) {

  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const lin = App.lin;

  const shared = m => { m.userData.shared = true; return m; };
  const MAT = {
    lead:  shared(new THREE.MeshStandardMaterial({ color: lin(0xd9dce1), metalness: 1.0, roughness: 0.25 })),
    epoxy: shared(new THREE.MeshPhysicalMaterial({ color: lin(0x17181c), roughness: 0.42, clearcoat: 0.5, clearcoatRoughness: 0.3 })),
    white: shared(new THREE.MeshStandardMaterial({ color: lin(0xf1f1ee), roughness: 0.5 })),
    segOff: shared(new THREE.MeshStandardMaterial({ color: lin(0x5a1414), roughness: 0.35 })),
    window: shared(new THREE.MeshPhysicalMaterial({ color: lin(0x0b0c0e), roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.08 })),
  };

  // Origin at the middle of the part, local +x along the columns, local +z across the rows.
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
    };
  }

  // A straight lead from the board up to height `top`, at each hole.
  function legs(f, group, holes, top, mat) {
    holes.forEach(h => {
      const p = group.worldToLocal(V3(h.x, 0, h.z));
      f.add(new THREE.CylinderGeometry(0.045, 0.045, top, 8), mat, p.x, top / 2, p.z);
    });
  }

  // ── 7-segment display ──
  //  The digit runs along the body's long side: its height is along local x and
  //  its width across, so the horizontal bars lie across the body and the
  //  vertical ones run along it.
  function buildSeg7(holes) {
    const top = holes.slice(0, 5);
    const centre = V3(holes.reduce((s, h) => s + h.x, 0) / holes.length, 0, holes.reduce((s, h) => s + h.z, 0) / holes.length);
    const { group } = frameAlong(top[0], top[4], centre);
    const f = factory(group);
    const S = 0.5, H = 0.95, BL = 2.4, BD = 1.75;
    legs(f, group, holes, S, MAT.lead);
    f.box(BL, H, BD, MAT.epoxy, 0, S + H / 2, 0);

    const y = S + H + 0.02;
    // A dark window the digit sits behind, then the bars: along z they are
    // horizontal in the digit (a, g, d); along x they are vertical (b, c, e, f).
    f.box(1.95, 0.02, 1.25, MAT.window, 0, y - 0.01, 0);
    // Each segment has its own material, so a lit one glows without the rest.
    const segs = {};
    const bar = (seg, w, d, x, z) => {
      const mat = new THREE.MeshStandardMaterial({ color: lin(0x5a1414), roughness: 0.35, emissive: lin(0xff3324), emissiveIntensity: 0 });
      segs[seg] = f.box(w, 0.04, d, mat, x, y + 0.01, z);
    };
    bar('a', 0.1, 0.9, 0.82, 0);        // top
    bar('b', 0.66, 0.1, 0.42, 0.42);    // upper right
    bar('c', 0.66, 0.1, -0.42, 0.42);   // lower right
    bar('d', 0.1, 0.9, -0.82, 0);       // bottom
    bar('e', 0.66, 0.1, -0.42, -0.42);  // lower left
    bar('f', 0.66, 0.1, 0.42, -0.42);   // upper left
    bar('g', 0.1, 0.9, 0, 0);           // middle
    bar('dp', 0.12, 0.12, -0.92, 0.62); // decimal point, lower right
    f.box(0.1, 0.05, 0.1, MAT.white, -BL / 2 + 0.25, y, -BD / 2 + 0.25);   // pin 1 mark

    // simulation.js calls this with the current in amps through each segment; a lit
    // segment glows in proportion to its current, and an unlit one goes dark.
    group.userData.setSegments = lit => {
      for (const seg of Object.keys(segs)) {
        const I = lit[seg] || 0;
        segs[seg].material.emissiveIntensity = I > 0 ? 0.6 + 1.4 * Math.min(1, I / 0.02) : 0;
        segs[seg].material.color.copy(lin(I > 0 ? 0xff5a48 : 0x5a1414));
      }
    };

    return { group, pins: holes.map(h => V3(h.x, 0, h.z)) };
  }

  const SPEC = {
    seg7: { pins: 10, dip: true, build: buildSeg7 },
  };

  App.PART_SPECS = SPEC;
  App.buildPart = (type, holes) => SPEC[type].build(holes);
  App.buildPartPreview = (type, holes, ok) => {
    const { group } = SPEC[type].build(holes);
    App.ghostify?.(group, ok);
    return group;
  };

})(window.App = window.App || {});
