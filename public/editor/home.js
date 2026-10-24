// ─────────────────────────────────────────────────────────────
//  home.js: the homepage scene, loaded by app.html?home
//
//  One circuit, centred on the bench, with nothing to scroll. Across the front,
//  a large guarded button spans the breadboard: pressing it opens the editor.
//  The Surge mark lies on the bench beside the board. Nothing is saved.
// ─────────────────────────────────────────────────────────────

(function (App) {

  const { placePart, placeJumper, tween } = App.stage;

  const GREEN = 0x15803d, ORANGE = 0xe98b0b;
  const BASE_MAT  = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.5, metalness: 0.2 });
  const GUARD_MAT = new THREE.MeshPhysicalMaterial({ color: 0x8d9198, roughness: 0.38, metalness: 0.55, clearcoat: 0.2 });
  const CAP_MAT   = new THREE.MeshPhysicalMaterial({ color: GREEN, roughness: 0.45, emissive: 0x0f5d2a, emissiveIntensity: 0.25 });
  const WHITE_MAT = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
  const ORANGE_MAT = new THREE.MeshStandardMaterial({ color: ORANGE, roughness: 0.5 });

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
  function makeEditorButton(x, z, groundY, length) {
    const W = 3.6, L = length;
    const CL = L - 1.8, CW = W - 1.2;          // the cap
    const group = new THREE.Group();
    group.position.set(x, groundY, z);

    const base = block(L + 1.0, W + 0.8, 0.5, 0.35, BASE_MAT);
    const guard = block(L + 0.7, W + 0.5, 0.6, 0.85, GUARD_MAT,
      { w: CL + 0.16, d: CW + 0.16, r: 0.4 });
    guard.position.y = 0.35;

    const capGroup = new THREE.Group();
    capGroup.position.y = 0.35;
    const cap = block(CL, CW, 0.4, 0.55, CAP_MAT);
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(CL - 0.6, CW - 0.4),
      new THREE.MeshBasicMaterial({ map: labelTexture(), transparent: true, depthWrite: false, toneMapped: false }),
    );
    label.rotation.x = -Math.PI / 2;
    label.position.y = 0.55 + 0.01;
    capGroup.add(cap, label);

    group.add(base, guard, capGroup);
    App.scene.add(group);
    return { group, cap: capGroup, hit: [cap, label], restY: capGroup.position.y };
  }

  // The Surge mark on the bench: the orange tile with its white trace, as in the favicon.
  function makeLogo(x, z, groundY) {
    const group = new THREE.Group();
    const S = 4.2 / 24;          // the mark is drawn on a 24-unit grid
    group.add(block(4.2, 4.2, 0.8, 0.3, ORANGE_MAT));
    const pts = [[16.2, 5.6], [9.9, 5.6], [7.4, 8.1], [7.4, 9.7], [9.7, 12], [14.3, 12], [16.6, 14.3],
                 [16.6, 15.9], [14.1, 18.4], [7.8, 18.4]]
      .map(([px, py]) => new THREE.Vector3((px - 12) * S, 0.36, (py - 12) * S));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 160, 0.2, 10, false), WHITE_MAT));
    for (const [px, py] of [[16.6, 5.6], [7.4, 18.4]]) {
      const dot = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.08, 20), WHITE_MAT);
      dot.position.set((px - 12) * S, 0.34, (py - 12) * S);
      group.add(dot);
    }
    group.position.set(x, groundY, z);
    App.scene.add(group);
    return group;
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

  // Press the cap down, then take the page to the editor.
  let leaving = false;
  function openEditor() {
    if (leaving) return;
    leaving = true;
    tween(160, k => { editor.cap.position.y = editor.restY - 0.18 * k; }).then(() => {
      window.top.location.href = 'app.html';
    });
  }

  function setup(demo) {
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

    const logo = makeLogo(boardBox.min.x - 6, cz, groundY);
    whole.union(new THREE.Box3().setFromObject(logo));

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

    // The canvas answers the pointer: the button opens the editor, and shows a hand over it.
    const canvas = App.renderer.domElement;
    canvas.addEventListener('pointerdown', e => {
      if (e.button === 0 && overButton(e)) openEditor();
    });
    canvas.addEventListener('pointermove', e => {
      canvas.style.cursor = overButton(e) ? 'pointer' : '';
    });

    window.dispatchEvent(new CustomEvent('surge-home-ready'));
  }

  fetch('/editor/demo.surge')
    .then(r => r.json())
    .then(setup)
    .catch(() => {});

})(window.App);
