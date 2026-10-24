// ─────────────────────────────────────────────────────────────
//  home.js: the homepage scene, loaded by app.html?home
//
//  One circuit, centred on the bench, with nothing to scroll. A green button sits
//  on the bench, as a little extra: pressing it runs the circuit and lights the
//  LED, and pressing it again stops. The camera can be turned and zoomed. Nothing
//  is saved.
// ─────────────────────────────────────────────────────────────

(function (App) {

  const { placePart, placeJumper, tween } = App.stage;
  
  let running = false;
  let button = null;   // { group, base, cap, capMat, restY }

  // The button is a real part of the bench: a dark base, a green cap, and a white
  // play triangle on top.
  function makeButton(x, z, groundY) {
    const group = new THREE.Group();
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.5, metalness: 0.2 });
    const capMat = new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.45, emissive: 0x0f5d2a, emissiveIntensity: 0.25 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.2, 0.36, 48), baseMat);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.86, 0.34, 48), capMat);
    base.position.y = 0.18;
    cap.position.y = 0.53;
    base.castShadow = base.receiveShadow = true;
    cap.castShadow = true;

    const triangle = new THREE.Shape();
    triangle.moveTo(-0.22, -0.28);
    triangle.lineTo(-0.22, 0.28);
    triangle.lineTo(0.34, 0);
    const mark = new THREE.Mesh(
      new THREE.ShapeGeometry(triangle),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 }),
    );
    mark.rotation.x = -Math.PI / 2;
    mark.position.y = 0.175;
    cap.add(mark);

    group.add(base, cap);
    group.position.set(x, groundY, z);
    App.scene.add(group);
    return { group, base, cap, capMat, restY: cap.position.y };
  }

  // Press the cap down and back up, and run or stop the circuit.
  function press() {
    if (running) App.stopSimulation();
    else App.runSimulation();
    running = !running;
    button.capMat.emissiveIntensity = running ? 1.2 : 0.6;
    const { cap, restY } = button;
    tween(90, k => { cap.position.y = restY - 0.12 * k; }).then(() => {
      tween(180, k => { cap.position.y = restY - 0.12 * (1 - k); });
    });
  }

  // Which object is under the pointer?
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function overButton(event) {
    const canvas = App.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    ndc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    ray.setFromCamera(ndc, App.camera);
    return ray.intersectObjects([button.cap, button.base], false).length > 0;
  }

  function setup(demo) {
    const bb = App.state.breadboard;
    App.clearAll();

    // The circuit, built the way a saved file is loaded.
    const parts = demo.components.map(c => placePart(c, bb));
    demo.wires.forEach(w => placeJumper(w, parts, bb));

    // Centre the composition: the board and the battery.
    const groundY = App.scene.getObjectByName('ground')?.position.y ?? -0.385;
    const boardBox = new THREE.Box3().setFromObject(bb.group);
    const whole = boardBox.clone();
    for (const c of App.state.components) whole.union(new THREE.Box3().setFromObject(c.group));
    button = makeButton(boardBox.getCenter(new THREE.Vector3()).x, boardBox.max.z + 3.4, groundY);
    App.homeButton = button;   // for the page and for tests
    whole.union(new THREE.Box3().setFromObject(button.group));
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

    // The canvas answers the pointer: the button presses, and shows a hand over it.
    const canvas = App.renderer.domElement;
    canvas.addEventListener('pointerdown', e => {
      if (e.button === 0 && overButton(e)) press();
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
