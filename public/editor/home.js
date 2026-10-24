// ─────────────────────────────────────────────────────────────
//  home.js: the homepage scene, loaded by app.html?home
//
//  One circuit, centred on the bench, with nothing to scroll. Across the front,
//  a large guarded button spans the breadboard: pressing it opens the editor.
//  Behind the board, SURGE stands on the bench in 3D letters. Nothing is saved.
// ─────────────────────────────────────────────────────────────

(function (App) {

  const { placePart, placeJumper, tween } = App.stage;

  const GREEN = 0x15803d, ORANGE = 0xe98b0b, CREAM = 0xf4f1ea;
  const BASE_MAT  = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.5, metalness: 0.2 });
  const GUARD_MAT = new THREE.MeshPhysicalMaterial({ color: 0x8d9198, roughness: 0.38, metalness: 0.55, clearcoat: 0.2 });
  const CAP_MAT   = new THREE.MeshPhysicalMaterial({ color: GREEN, roughness: 0.45, emissive: 0x0f5d2a, emissiveIntensity: 0.25 });
  // The title letters: cream faces, with the brand orange on their sides.
  const FACE_MAT  = new THREE.MeshPhysicalMaterial({ color: App.lin(CREAM), roughness: 0.4, clearcoat: 0.5, clearcoatRoughness: 0.3 });
  const SIDE_MAT  = new THREE.MeshPhysicalMaterial({ color: App.lin(ORANGE), roughness: 0.45, clearcoat: 0.3, clearcoatRoughness: 0.4 });

  // A rounded rectangle, in the x-y plane, centred on the origin.
  function rounded(w, d, r) {
    const s = new THREE.Shape();
    const x0 = -w / 2, x1 = w / 2, y0 = -d / 2, y1 = d / 2;
    s.moveTo(x0 + r, y0);
    s.lineTo(x1 - r, y0); s.quadraticCurveTo(x1, y0, x1, y0 + r);
    s.lineTo(x1, y1 - r); s.quadraticCurveTo(x1, y1, x1 - r, y1);
    s.lineTo(x0 + r, y1); s.quadraticCurveTo(x0, y1, x0, y1 - r);
    s.lineTo(x0, y0 + r); s.quadraticCurveTo(x0, y0, x0 + r, y0);
    return s;
  }

  // A rounded block standing on y = 0, `h` tall. With `hole`, its middle is cut away.
  function block(w, d, r, h, mat, hole) {
    const shape = rounded(w, d, r);
    if (hole) shape.holes.push(rounded(hole.w, hole.d, hole.r));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 12 });
    geo.rotateX(-Math.PI / 2);     // extrude up, as the rest of the bench is built
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = mesh.receiveShadow = true;
    return mesh;
  }

  // The label on the cap: "Open the editor" and a play mark, drawn once fonts are ready.
  function labelTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 2048; canvas.height = 256;
    const g = canvas.getContext('2d');
    const tex = new THREE.CanvasTexture(canvas);
    tex.anisotropy = 8;
    const draw = () => {
      g.clearRect(0, 0, canvas.width, canvas.height);
      g.font = "700 150px 'Space Grotesk', 'Inter', system-ui, sans-serif";
      g.textBaseline = 'middle';
      const text = 'Open the editor', mark = 92, gap = 46;
      const total = g.measureText(text).width + gap + mark;
      const x = canvas.width / 2 - total / 2;
      g.fillStyle = '#0b3b1f';
      g.fillText(text, x, canvas.height / 2 + 6);
      const mx = x + total - mark, my = canvas.height / 2;
      g.beginPath();
      g.moveTo(mx, my - mark / 2); g.lineTo(mx, my + mark / 2); g.lineTo(mx + mark * 0.85, my);
      g.closePath();
      g.fill();
      tex.needsUpdate = true;
    };
    draw();
    document.fonts?.load("700 150px 'Space Grotesk'").then(draw, () => {});
    return tex;
  }

  // The button is a real part of the bench, as before: a dark base, a grey guard
  // standing round the cap, and a green cap that presses down. It spans `length`.
  // At rest the cap stands above the guard's rim; pressed, it sinks just below it.
  const BASE_H = 0.35, GUARD_H = 0.85, CAP_H = 1.1, PRESS = 0.36;
  function makeEditorButton(x, z, groundY, length) {
    const W = 3.6, L = length;
    const CL = L - 1.8, CW = W - 1.2;          // the cap
    const group = new THREE.Group();
    group.position.set(x, groundY, z);

    const base = block(L + 1.0, W + 0.8, 0.5, BASE_H, BASE_MAT);
    const guard = block(L + 0.7, W + 0.5, 0.6, GUARD_H, GUARD_MAT,
      { w: CL + 0.16, d: CW + 0.16, r: 0.4 });
    guard.position.y = BASE_H;

    const capGroup = new THREE.Group();
    capGroup.position.y = BASE_H;
    const cap = block(CL, CW, 0.4, CAP_H, CAP_MAT);
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(CL - 0.6, CW - 0.4),
      new THREE.MeshBasicMaterial({ map: labelTexture(), transparent: true, depthWrite: false, toneMapped: false }),
    );
    label.rotation.x = -Math.PI / 2;
    label.position.y = CAP_H + 0.01;
    capGroup.add(cap, label);

    group.add(base, guard, capGroup);
    App.scene.add(group);
    return { group, cap: capGroup, hit: [cap, label], restY: capGroup.position.y };
  }

  // SURGE in 3D: one extruded letter per character, standing on the bench and
  // facing the camera, sized to span `width`. The glyphs are Space Grotesk Bold,
  // the page's own face, cut down to these five letters (fonts/OFL.txt).
  const TITLE = 'SURGE';
  function makeTitle(font, cx, z, groundY, width) {
    const res = font.data.resolution;
    const gap = 0.06;                                   // extra tracking, in ems
    const ems = [...TITLE].reduce((sum, ch) => sum + font.data.glyphs[ch].ha / res, 0) + gap * (TITLE.length - 1);
    const size = width / ems, depth = size * 0.28;
    const group = new THREE.Group();
    group.position.set(cx - width / 2, groundY, z);
    let x = 0;
    const letters = [...TITLE].map(ch => {
      const geo = new THREE.TextGeometry(ch, {
        font, size, height: depth, curveSegments: 10,
        bevelEnabled: true, bevelThickness: size * 0.03, bevelSize: size * 0.02, bevelSegments: 3,
      });
      geo.translate(0, size * 0.03, -depth / 2);          // the bevel sits on the bench, not under it
      const mesh = new THREE.Mesh(geo, [FACE_MAT, SIDE_MAT]);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.position.x = x;
      x += (font.data.glyphs[ch].ha / res + gap) * size;
      group.add(mesh);
      return mesh;
    });
    App.scene.add(group);
    return { group, letters, size };
  }

  // The letters drop onto the bench one after another: a fall, then a small hop.
  function dropIn(title) {
    const lift = title.size * 1.4, FALL = 0.68;
    const height = k => k < FALL ? lift * (1 - (k / FALL) ** 2)
                                 : lift * 0.06 * 4 * ((k - FALL) / (1 - FALL)) * (1 - (k - FALL) / (1 - FALL));
    title.letters.forEach((m, i) => {
      m.position.y = lift;
      m.visible = false;
      setTimeout(() => {
        m.visible = true;
        tween(720, k => { m.position.y = height(k); });
      }, 250 + i * 110);
    });
  }

  // Which part of the button is under the pointer?
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let editor = null;
  function overButton(event) {
    const canvas = App.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    ndc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    ray.setFromCamera(ndc, App.camera);
    return ray.intersectObjects(editor.hit, false).length > 0;
  }

  // The cap follows a target height: down while it is held, back up when let go.
  // Releasing over the button opens the editor, after the press has shown. While
  // it is held the camera stays put, so pressing never turns into an orbit.
  let capTarget = 0, lastT = null, held = false, leaving = false;
  function capTick(t) {
    const dt = lastT == null ? 0 : Math.min(0.1, t - lastT);
    lastT = t;
    const y = editor.cap.position.y;
    editor.cap.position.y = y + (capTarget - y) * (1 - Math.exp(-dt * 28));
  }
  function press()   { held = true;  capTarget = editor.restY - PRESS; App.controls.enabled = false; }
  function release() { held = false; App.controls.enabled = true; if (!leaving) capTarget = editor.restY; }
  function openEditor() {
    if (leaving) return;
    leaving = true;
    capTarget = editor.restY - PRESS;
    setTimeout(() => { window.top.location.href = 'app.html'; }, 140);
  }

  function setup(demo, font) {
    const bb = App.state.breadboard;
    App.clearAll();

    // The circuit, built the way a saved file is loaded.
    const parts = demo.components.map(c => placePart(c, bb));
    demo.wires.forEach(w => placeJumper(w, parts, bb));

    // Centre the composition: the board, the battery, the button and the mark.
    const groundY = App.scene.getObjectByName('ground')?.position.y ?? -0.385;
    const boardBox = new THREE.Box3().setFromObject(bb.group);
    const whole = boardBox.clone();
    for (const c of App.state.components) whole.union(new THREE.Box3().setFromObject(c.group));

    const cx = boardBox.getCenter(new THREE.Vector3()).x;
    const cz = boardBox.getCenter(new THREE.Vector3()).z;
    const length = boardBox.max.x - boardBox.min.x;
    editor = makeEditorButton(cx, boardBox.max.z + 3.4, groundY, length);
    App.homeButton = editor;   // for the page and for tests
    whole.union(new THREE.Box3().setFromObject(editor.group));

    // The title stands behind the board, a little narrower than it.
    const title = font ? makeTitle(font, cx, boardBox.min.z - 2.4, groundY, length * 0.86) : null;
    if (title) whole.union(new THREE.Box3().setFromObject(title.group));

    const center = whole.getCenter(new THREE.Vector3());
    const size = whole.getSize(new THREE.Vector3());

    // Frame it from the front, with room either side.
    const aspect = App.camera.aspect || 1.6;
    const vfov = App.camera.fov * Math.PI / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
    const halfW = size.x / 2 + 3, halfH = size.y / 2 + 4;
    const dist = Math.max(halfW / Math.tan(hfov / 2), halfH / Math.tan(vfov / 2));
    // Aim a little below the middle, so the composition sits higher in the frame.
    const look = center.clone();
    look.y -= dist * 0.07;
    App.controls.target.copy(look);
    App.camera.position.set(look.x, look.y + dist * 0.4, look.z + dist);
    App.camera.lookAt(look);
    App.controls.minDistance = 6;
    App.controls.maxDistance = 60;

    // The cap breathes, so the button reads as live.
    App.addTicker(t => { CAP_MAT.emissiveIntensity = 0.22 + 0.12 * (0.5 + 0.5 * Math.sin(t * 1.6)); });

    // The canvas answers the pointer like a real button: the cap goes down when
    // pressed and comes back up when let go; letting go over it opens the editor.
    capTarget = editor.restY;
    App.addTicker(capTick);
    const canvas = App.renderer.domElement;
    canvas.addEventListener('pointerdown', e => {
      if (e.button !== 0 || !overButton(e)) return;
      canvas.setPointerCapture?.(e.pointerId);
      press();
    });
    canvas.addEventListener('pointerup', e => {
      if (!held) return;
      if (overButton(e)) openEditor(); else release();
    });
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('pointermove', e => {
      const over = overButton(e);
      canvas.style.cursor = over ? 'pointer' : '';
      if (held && !leaving) capTarget = over ? editor.restY - PRESS : editor.restY;   // slide off to cancel
    });

    if (title) dropIn(title);

    window.dispatchEvent(new CustomEvent('surge-home-ready'));
  }

  // The title needs its font; without it the bench still loads, untitled.
  const font = fetch('/editor/fonts/space-grotesk-bold-surge.typeface.json')
    .then(r => r.json())
    .then(data => new THREE.Font(data))
    .catch(() => null);
  Promise.all([fetch('/editor/demo.surge').then(r => r.json()), font])
    .then(([demo, f]) => setup(demo, f))
    .catch(() => {});

})(window.App);
