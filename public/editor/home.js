// ─────────────────────────────────────────────────────────────
//  home.js: the homepage scene, loaded by app.html?home
//
//  One circuit, centred on the bench, with nothing to scroll. Across the front,
//  a large guarded button spans the breadboard. Behind the board, SURGE and the
//  Surge mark stand on the bench in 3D, and drop in while the circuit's LED
//  flickers on. Nothing is saved until the button is pressed: then this same
//  scene becomes the editor, with no new page (enterEditor).
// ─────────────────────────────────────────────────────────────

(function (App) {

  const { placePart, placeJumper, tween } = App.stage;

  // Everything that leaves when the editor opens is transparent from the start,
  // at full opacity: turning transparency on later recompiles the shaders, and
  // the first frame of the transition would stall.
  const fades = { transparent: true, opacity: 1 };
  const GREEN = 0x15803d, ORANGE = 0xe98b0b, CREAM = 0xf4f1ea;
  const BASE_MAT  = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.5, metalness: 0.2, ...fades });
  const GUARD_MAT = new THREE.MeshPhysicalMaterial({ color: 0x8d9198, roughness: 0.38, metalness: 0.55, clearcoat: 0.2, ...fades });
  const CAP_MAT   = new THREE.MeshPhysicalMaterial({ color: GREEN, roughness: 0.45, emissive: 0x0f5d2a, emissiveIntensity: 0.25, ...fades });
  // The title letters: cream faces, with the brand orange on their sides.
  const FACE_MAT  = new THREE.MeshPhysicalMaterial({ color: App.lin(CREAM), roughness: 0.4, clearcoat: 0.5, clearcoatRoughness: 0.3, ...fades });
  const SIDE_MAT  = new THREE.MeshPhysicalMaterial({ color: App.lin(ORANGE), roughness: 0.45, clearcoat: 0.3, clearcoatRoughness: 0.4, ...fades });
  // The mark's trace, the same cream as the letter faces.
  const TRACE_MAT = new THREE.MeshPhysicalMaterial({ color: App.lin(CREAM), roughness: 0.35, clearcoat: 0.5, clearcoatRoughness: 0.3, ...fades });

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
    label.renderOrder = 1;                    // after the cap, which is transparent too
    capGroup.add(cap, label);

    group.add(base, guard, capGroup);
    App.scene.add(group);
    return { group, cap: capGroup, hit: [cap, label], restY: capGroup.position.y };
  }

  // The Surge mark, standing upright: the orange tile with its trace, as in the
  // favicon, `h` square and `depth` thick, centred on the origin and facing +z.
  function makeMark(h, depth) {
    const k = h / 4.2, S = h / 24;          // as drawn at 4.2 across, on a 24-unit grid
    const flat = new THREE.Group();         // built lying down, as the bench is, then stood up
    flat.add(block(h, h, 0.8 * k, depth, SIDE_MAT));
    const pts = [[16.2, 5.6], [9.9, 5.6], [7.4, 8.1], [7.4, 9.7], [9.7, 12], [14.3, 12], [16.6, 14.3],
                 [16.6, 15.9], [14.1, 18.4], [7.8, 18.4]]
      .map(([px, py]) => new THREE.Vector3((px - 12) * S, depth + 0.06 * k, (py - 12) * S));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    flat.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 160, 0.2 * k, 10, false), TRACE_MAT));
    for (const [px, py] of [[16.6, 5.6], [7.4, 18.4]]) {
      const dot = new THREE.Mesh(new THREE.CylinderGeometry(0.42 * k, 0.42 * k, 0.08 * k, 20), TRACE_MAT);
      dot.position.set((px - 12) * S, depth + 0.04 * k, (py - 12) * S);
      flat.add(dot);
    }
    flat.traverse(o => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
    flat.rotation.x = Math.PI / 2;          // the top face turns to the camera, the trace reads upright
    flat.position.z = -depth / 2;
    const mark = new THREE.Group();
    mark.add(flat);
    return mark;
  }

  // SURGE in 3D, then the mark: one piece per character, standing on the bench
  // and facing the camera, sized to span `width`. The glyphs are Space Grotesk
  // Bold, the page's own face, cut down to these five letters (fonts/OFL.txt).
  const TITLE = 'SURGE';
  function makeTitle(font, cx, z, groundY, width) {
    const res = font.data.resolution;
    const gap = 0.06, markGap = 0.22;                  // extra tracking, in ems
    // The mark is as tall as the capitals, measured from the E.
    const probe = new THREE.TextGeometry('E', { font, size: 1, height: 0.01, curveSegments: 2 });
    probe.computeBoundingBox();
    const bevel = 0.02, cap = probe.boundingBox.max.y + 2 * bevel;
    probe.dispose();
    const ems = [...TITLE].reduce((sum, ch) => sum + font.data.glyphs[ch].ha / res + gap, 0) + markGap + cap;
    const size = width / ems, depth = size * 0.28;

    const group = new THREE.Group();
    group.position.set(cx - width / 2, groundY, z);
    let x = 0;
    const pieces = [...TITLE].map(ch => {
      const geo = new THREE.TextGeometry(ch, {
        font, size, height: depth, curveSegments: 10,
        bevelEnabled: true, bevelThickness: size * 0.03, bevelSize: size * bevel, bevelSegments: 3,
      });
      geo.translate(0, size * bevel, -depth / 2);         // the bevel sits on the bench, not under it
      const mesh = new THREE.Mesh(geo, [FACE_MAT, SIDE_MAT]);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.position.x = x;
      x += (font.data.glyphs[ch].ha / res + gap) * size;
      group.add(mesh);
      return mesh;
    });
    const h = cap * size;
    const mark = makeMark(h, depth + 2 * size * 0.03);    // as thick as a letter with its bevels
    mark.position.set(x + markGap * size + h / 2, h / 2, 0);
    group.add(mark);
    pieces.push(mark);
    pieces.forEach(p => { p.userData.restY = p.position.y; });

    App.scene.add(group);
    return { group, pieces, size };
  }

  // The pieces drop onto the bench one after another: a fall, then a small hop.
  // Meanwhile the LED stutters, flashing as each piece lands; once the mark is
  // down it stays on. With reduced motion, everything is simply in place and lit.
  // Once the editor opens, the homepage's light show is over: the LED lights only
  // when the circuit is run, so every pending flicker and flash is silenced.
  let showOver = false;
  let flickerTimer = null;

  function dropIn(title, led) {
    const lit = led?.group.userData.setLit;
    const setLit = lit && ((on, k) => { if (!showOver) lit(on, k); });
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setLit?.(true, 1); return; }
    const lift = title.size * 1.4, FALL = 0.68, MS = 720, START = 250, STEP = 110;
    const height = k => k < FALL ? lift * (1 - (k / FALL) ** 2)
                                 : lift * 0.06 * 4 * ((k - FALL) / (1 - FALL)) * (1 - (k - FALL) / (1 - FALL));
    if (setLit) setTimeout(() => {
      if (showOver) return;
      flickerTimer = setInterval(() => setLit(Math.random() < 0.4, 0.4 + Math.random() * 0.5), 70);
    }, START);
    const last = title.pieces.length - 1;
    const land = i => {
      if (!setLit) return;
      setLit(true, 1.4);                                  // a flash as the piece hits
      if (i === last) { clearInterval(flickerTimer); setTimeout(() => setLit(true, 1), 120); }
    };
    title.pieces.forEach((m, i) => {
      const rest = m.userData.restY;
      m.position.y = rest + lift;
      m.visible = false;
      setTimeout(() => {
        m.visible = true;
        let landed = false;
        tween(MS, k => {
          m.position.y = rest + height(k);
          if (!landed && k >= FALL) { landed = true; land(i); }
        });
      }, START + i * STEP);
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
    setTimeout(enterEditor, 140);
  }

  // ── Into the editor ──────────────────────────────────────────
  //  The homepage is the editor with its panels hidden, so opening the editor
  //  needs no new page. The title and the button sink into the bench as they
  //  fade, the camera glides to the editor's view, and the panels slide in from
  //  their edges: the top bar from the top, the parts from the left and the
  //  chat from the right (or up from the bottom, where they stack under the
  //  canvas). The canvas shrinks with them, so the scene never jumps. The
  //  circuit on the bench becomes the editor's, as app.html?demo opens it.
  const ENTER_MS = 1100;
  const easeInOut = k => k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
  const listening = new AbortController();     // the homepage's pointer handlers
  let title = null, breathe = null, limits = null;

  // Animate `prop` (a margin) from -size to 0, so the element slides in and
  // the layout makes room for it as it goes.
  function slideIn(el, prop, size, fade, ms, delay) {
    if (!el || !size) return;
    const from = { [prop]: -size + 'px' }, to = { [prop]: '0px' };
    if (fade) { from.opacity = 0; to.opacity = 1; }
    el.animate([from, to], { duration: ms, delay, easing: 'cubic-bezier(0.22, 0.8, 0.24, 1)', fill: 'backwards' });
  }

  function enterEditor() {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const ms = reduce ? 1 : ENTER_MS;
    listening.abort();
    // The demo circuit is not running in the editor, so its LED goes dark
    showOver = true;
    clearInterval(flickerTimer);
    App.state.components.forEach(c => { if (c.type === 'led') c.group.userData.setLit?.(false); });
    App.setMode('select');            // and no leftover hint from wiring the demo
    App.removeTicker(breathe);
    App.controls.enabled = true;
    App.renderer.domElement.style.cursor = '';

    // Show the editor's panels and measure where the canvas will end up, then
    // start each panel off its edge before the browser paints it in place.
    const $ = id => document.getElementById(id);
    document.documentElement.classList.replace('scene', 'entering');
    const top = $('topbar'), side = $('sidebar'), chat = $('surge-panel'), body = $('body');
    const wrap = $('canvas-wrap').getBoundingClientRect();
    const view = App.defaultView(wrap.width / wrap.height);
    if (!reduce) {
      const slide = ms * 0.8, delay = ms * 0.15;
      slideIn(top, 'marginTop', top.offsetHeight, true, slide, delay);
      if (getComputedStyle(body).flexDirection === 'column') {
        slideIn(body, 'marginBottom', side.offsetHeight + chat.offsetHeight, false, slide, delay);
      } else {
        slideIn(side, 'marginLeft', side.offsetWidth, true, slide, delay);
        slideIn(chat, 'marginRight', chat.offsetWidth, true, slide, delay);
      }
      $('clear-all-btn')?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: slide, delay, fill: 'backwards' });
    }

    // The title and the button sink into the bench as they fade.
    const leavers = [editor.group, title?.group].filter(Boolean);
    const mats = new Set();
    leavers.forEach(g => g.traverse(o => { if (o.isMesh) [].concat(o.material).forEach(m => mats.add(m)); }));
    const y0 = leavers.map(g => g.position.y);
    tween(ms * 0.7, k => {
      const e = k * k;
      mats.forEach(m => { m.opacity = 1 - e; });
      leavers.forEach((g, i) => { g.position.y = y0[i] - e * 2.5; });
    }).then(() => {
      leavers.forEach(g => { App.scene.remove(g); App.disposeGroup(g); });
      App.removeTicker(capTick);
    });

    // The camera glides from the title's framing to the editor's.
    const p0 = App.camera.position.clone(), t0 = App.controls.target.clone();
    tween(ms, k => {
      const e = easeInOut(k);
      App.camera.position.lerpVectors(p0, view.position, e);
      App.controls.target.lerpVectors(t0, view.target, e);
    }).then(() => {
      // From here on this is the editor, holding the demo circuit.
      document.documentElement.classList.remove('entering');
      App.isHero = false;
      App.homeButton = null;
      App.controls.minDistance = limits.min;
      App.controls.maxDistance = limits.max;
      App.state.circuitName = 'Demo';
      const name = $('circuit-name-field');
      if (name) name.textContent = 'Demo';
      App.clearHistory();               // the demo is the starting point, not an edit
      App.refreshCounts();              // and the first save, as opening the demo does
      window.top.surgeEditorOpened?.();
    });
  }

  function setup(demo, fontData) {
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
    title = fontData ? makeTitle(fontData, cx, boardBox.min.z - 2.4, groundY, length * 0.86) : null;
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
    limits = { min: App.controls.minDistance, max: App.controls.maxDistance };   // the editor's, for later
    App.controls.minDistance = 6;
    App.controls.maxDistance = 60;

    // The cap breathes, so the button reads as live.
    breathe = t => { CAP_MAT.emissiveIntensity = 0.22 + 0.12 * (0.5 + 0.5 * Math.sin(t * 1.6)); };
    App.addTicker(breathe);

    // The canvas answers the pointer like a real button: the cap goes down when
    // pressed and comes back up when let go; letting go over it opens the editor.
    capTarget = editor.restY;
    App.addTicker(capTick);
    const canvas = App.renderer.domElement, signal = listening.signal;
    canvas.addEventListener('pointerdown', e => {
      if (e.button !== 0 || !overButton(e)) return;
      canvas.setPointerCapture?.(e.pointerId);
      press();
    }, { signal });
    canvas.addEventListener('pointerup', e => {
      if (!held) return;
      if (overButton(e)) openEditor(); else release();
    }, { signal });
    canvas.addEventListener('pointercancel', release, { signal });
    canvas.addEventListener('pointermove', e => {
      const over = overButton(e);
      canvas.style.cursor = over ? 'pointer' : '';
      if (held && !leaving) capTarget = over ? editor.restY - PRESS : editor.restY;   // slide off to cancel
    }, { signal });

    const led = App.state.components.find(c => c.type === 'led');
    if (title) dropIn(title, led);
    else led?.group.userData.setLit?.(true, 1);

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
