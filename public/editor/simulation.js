// ─────────────────────────────────────────────────────────────
//  simulate.js — Circuit simulation engine
//
//  NODE MODEL
//  ──────────
//  Each breadboard hole belongs to a "node" determined by its
//  physical connectivity (columns in same half share a node):
//
//    bb_top_<col>  →  any hole in col <col>, rows a–e
//    bb_bot_<col>  →  any hole in col <col>, rows f–j
//    bb_rail_tp    →  all holes in the top + rail row    (positive)
//    bb_rail_tn    →  all holes in the top − rail row    (negative)
//    bb_rail_bn    →  all holes in the bottom + rail row (positive)
//    bb_rail_bp    →  all holes in the bottom − rail row (negative)
//
//  Wires (drawn by the user) additionally merge any two nodes.
//
//  POLARITY
//  ────────
//  LEDs are diodes — current may only flow from anode (+) to cathode (−).
//  If the circuit drives current the wrong way the LED stays off.
//  Battery: pin 0 = positive (+) output, pin 1 = negative (−) return.
//
//  Exports: App.runSimulation(), App.stopSimulation()
// ─────────────────────────────────────────────────────────────

(function (App) {

  // ── Electrical properties ───────────────────────────────────
  const PROPS = {
    // A real 9V alkaline has 1-2Ω of internal resistance. Modelling it
    // is what makes a short circuit produce a large finite current and
    // a sagging terminal voltage instead of a divide-by-zero.
    battery:  { voltage: 9.0, internalResistance: 1.0 },
    resistor: { resistance: 220 },    // 220 Ω default
    // vf/ratedCurrent are the datasheet operating point (2.0V @ 20mA);
    // the solver derives the diode saturation current from them.
    // ideality n ≈ 2 is typical for an LED junction.
    led:      { forwardVoltage: 2.0, ratedCurrent: 0.020, ideality: 2.0,
                thresholdCurrent: 0.001, maxCurrent: 0.030 },
    buzzer:   { resistance: 42,      thresholdCurrent: 0.001 },
  };

  // Format a current for the results panel.
  function fmtI(a) {
    const x = Math.abs(a);
    if (x >= 1)      return a.toFixed(2) + ' A';
    if (x >= 1e-3)   return (a * 1e3).toFixed(1) + ' mA';
    if (x >= 1e-6)   return (a * 1e6).toFixed(1) + ' µA';
    return (a * 1e9).toFixed(1) + ' nA';
  }

  // ── Buzzer audio ─────────────────────────────────────────────
  let _audioCtx = null;
  const _buzzerNodes = new Map(); // comp → { osc, gain }

  function _getAudioCtx() {
    if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return _audioCtx;
  }

  function activateBuzzer(comp) {
    if (_buzzerNodes.has(comp)) return;
    try {
      const ctx  = _getAudioCtx();
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = 220;   // low, buzzy tone
      gain.gain.value = 0.12;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      _buzzerNodes.set(comp, { osc, gain });
    } catch {}
  }

  function deactivateBuzzer(comp) {
    const node = _buzzerNodes.get(comp);
    if (!node) return;
    try {
      const ctx = _getAudioCtx();
      node.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
      setTimeout(() => { try { node.osc.stop(); } catch {} }, 80);
    } catch {}
    _buzzerNodes.delete(comp);
  }

  function stopAllBuzzers() {
    _buzzerNodes.forEach((node) => {
      try {
        const ctx = _getAudioCtx();
        node.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
        setTimeout(() => { try { node.osc.stop(); } catch {} }, 80);
      } catch {}
    });
    _buzzerNodes.clear();
  }

  // ── Union-Find ──────────────────────────────────────────────
  class UnionFind {
    constructor() { this._p = {}; }
    make(id) { if (!(id in this._p)) this._p[id] = id; }
    find(id) {
      this.make(id);
      if (this._p[id] !== id) this._p[id] = this.find(this._p[id]);
      return this._p[id];
    }
    union(a, b) {
      const ra = this.find(a), rb = this.find(b);
      if (ra !== rb) this._p[rb] = ra;
    }
  }

  // ── Breadboard node identity ────────────────────────────────
  const TOP_BODY = new Set(['a','b','c','d','e']);
  const BOT_BODY = new Set(['f','g','h','i','j']);

  function bbNodeId(col, row) {
    if (TOP_BODY.has(row)) return `bb_top_${col}`;
    if (BOT_BODY.has(row)) return `bb_bot_${col}`;
    return `bb_rail_${row}`; // tp | tn | bn | bp
  }

  // ── Build graph ─────────────────────────────────────────────
  function buildGraph(components, wires) {
    const uf      = new UnionFind();
    const pinNode = []; // pinNode[ci][pi] = raw node string

    // 1. Assign every component pin to a node
    components.forEach((comp, ci) => {
      pinNode[ci] = [];
      comp.pins.forEach((_, pi) => {
        let nid;
        if (comp.holeRefs?.[pi]) {
          const { col, row } = comp.holeRefs[pi];
          nid = bbNodeId(col, row);
        } else {
          nid = `free_${ci}_${pi}`;
        }
        pinNode[ci][pi] = nid;
        uf.make(nid);
      });
    });

    // 2. Wires merge nodes — wires store startHole/endHole for breadboard
    //    holes and startComp/startPinIdx for off-board pins (e.g. battery).
    wires.forEach(wire => {
      const { startHole, endHole, startComp, startPinIdx, endComp, endPinIdx } = wire;

      // Resolve each endpoint to a node string
      let na = startHole ? bbNodeId(startHole.col, startHole.row) : null;
      let nb = endHole   ? bbNodeId(endHole.col,   endHole.row)   : null;

      // Fall back to component free-pin node when no board hole was recorded
      if (!na && startComp) {
        const ci = components.indexOf(startComp);
        if (ci >= 0 && pinNode[ci]?.[startPinIdx] != null) na = pinNode[ci][startPinIdx];
      }
      if (!nb && endComp) {
        const ci = components.indexOf(endComp);
        if (ci >= 0 && pinNode[ci]?.[endPinIdx] != null) nb = pinNode[ci][endPinIdx];
      }

      if (na && nb) uf.union(na, nb);
    });

    // 3. Buttons that are pressed act as closed switches — merge their two pins
    components.forEach((comp, ci) => {
      if (comp.type === 'button' && comp.pressed) {
        uf.union(pinNode[ci][0], pinNode[ci][1]);
      }
    });

    // 4. Resolve each pin to its root
    return components.map((comp, ci) => ({
      comp,
      // nodes[pi] = root node of pin pi
      nodes: comp.pins.map((_, pi) => uf.find(pinNode[ci][pi])),
    }));
  }

  // ── Netlist construction ─────────────────────────────────────
  //
  //  The Union-Find pass above gives the true electrical nodes of
  //  the board. That part was always correct, so it stays. What
  //  changes is everything after it: instead of walking paths, we
  //  hand the node graph to the MNA solver and let it satisfy
  //  Kirchhoff's Current Law at every node simultaneously.
  //
  //  Pin conventions (see components.js):
  //    battery   pin 0 = +        pin 1 = −
  //    led       pin 0 = cathode  pin 1 = anode
  //
  function buildNetlist(graph) {
    const elements = [];
    const nodeSet  = new Set();
    const track    = n => { nodeSet.add(n); return n; };

    graph.forEach((entry, ci) => {
      const { comp, nodes } = entry;
      const id = `${comp.type}_${ci}`;
      comp._simId = id;

      switch (comp.type) {
        case 'battery': {
          // A real cell is an ideal source in series with its internal
          // resistance, and that series element needs its own node.
          // Folding Rint into the source instead loses it the moment a
          // user wires the two terminals together: Union-Find merges the
          // terminals, and an ideal source across itself is a
          // contradiction rather than the 9A a real battery delivers.
          const inner = id + '__int';
          track(inner);
          elements.push({ id: id + '__rint', kind: 'resistor',
            a: track(nodes[0]), b: inner,
            resistance: PROPS.battery.internalResistance });
          elements.push({ id, kind: 'vsource',
            a: inner, b: track(nodes[1]),
            voltage: comp.voltage ?? PROPS.battery.voltage });
          break;
        }

        case 'resistor':
          elements.push({ id, kind: 'resistor',
            a: track(nodes[0]), b: track(nodes[1]),
            resistance: comp.resistance ?? PROPS.resistor.resistance });
          break;

        case 'buzzer':
          elements.push({ id, kind: 'resistor',
            a: track(nodes[0]), b: track(nodes[1]),
            resistance: PROPS.buzzer.resistance });
          break;

        case 'led':
          // a = anode (pin 1), b = cathode (pin 0). Reverse bias now
          // falls out of the diode equation instead of needing the
          // polarity special case that was documented but never written.
          elements.push({ id, kind: 'diode',
            a: track(nodes[1]), b: track(nodes[0]),
            vf:     PROPS.led.forwardVoltage,
            iRated: PROPS.led.ratedCurrent,
            n:      PROPS.led.ideality });
          break;

        case 'button':
          track(nodes[0]); track(nodes[1]);
          // A pressed button is already collapsed into a single node
          // by the Union-Find pass above, so there is normally nothing
          // left to stamp. The guard is defensive: emitting a 0V source
          // across one node would put an all-zero row in the matrix.
          // An OPEN button contributes no element at all — an open
          // circuit is the absence of a branch, not a very big resistor.
          if (comp.pressed && nodes[0] !== nodes[1]) {
            elements.push({ id, kind: 'short', a: nodes[0], b: nodes[1] });
          }
          break;

        default:
          nodes.forEach(track);
      }
    });

    return { nodes: [...nodeSet], elements };
  }

  // ── Visual: LED on/off ──────────────────────────────────────
  const activeLights = [];

  function lightUpLED(comp) {
    comp.group.traverse(obj => {
      if (!obj.isMesh || !obj.material.transparent) return;
      obj.material = obj.material.clone();
      obj.material.emissiveIntensity = 3.5;
      obj.material.opacity = 1.0;
    });

    const ledColor = getDomeColor(comp) ?? 0xffffff;
    const p0 = comp.pins[0], p1 = comp.pins[1];
    const light = new THREE.PointLight(ledColor, 8.0, 10);
    light.position.set((p0.x + p1.x) / 2, 3.0, (p0.z + p1.z) / 2);
    App.scene.add(light);
    activeLights.push(light);
    comp._simLight = light;
  }

  function dimLED(comp) {
    comp.group.traverse(obj => {
      if (!obj.isMesh || !obj.material.transparent) return;
      obj.material.emissiveIntensity = 0.45;
      obj.material.opacity = 0.88;
    });
    if (comp._simLight) { App.scene.remove(comp._simLight); comp._simLight = null; }
  }

  function getDomeColor(comp) {
    let col = null;
    comp.group.traverse(obj => {
      if (obj.isMesh && obj.material.transparent && col === null)
        col = obj.material.color.getHex();
    });
    return col;
  }

  // ── Results overlay ─────────────────────────────────────────
  function showResults(lines) {
    let box = document.getElementById('sim-results');
    if (!box) {
      box = document.createElement('div');
      box.id = 'sim-results';
      document.getElementById('canvas-wrap').appendChild(box);
    }
    box.innerHTML = lines.map(l =>
      `<div class="sim-line ${l.cls || ''}">${l.text}</div>`
    ).join('');
    box.style.display = 'block';
  }

  function hideResults() {
    const b = document.getElementById('sim-results');
    if (b) b.style.display = 'none';
  }

  // ── Button click handler (active only during simulation) ─────
  let _btnClickHandler = null;

  function installButtonClicks() {
    removeButtonClicks();
    const canvas    = document.getElementById('canvas');
    const raycaster = new THREE.Raycaster();
    const mouseNDC  = new THREE.Vector2();

    _btnClickHandler = function (e) {
      // Only fire on a clean click (not a drag)
      const r = canvas.getBoundingClientRect();
      mouseNDC.x =  ((e.clientX - r.left) / r.width)  * 2 - 1;
      mouseNDC.y = -((e.clientY - r.top)  / r.height) * 2 + 1;
      raycaster.setFromCamera(mouseNDC, App.camera);

      const capMeshes = [];
      App.state.components.forEach(c => {
        if (c.type === 'button' && c.capMesh) capMeshes.push(c.capMesh);
      });
      if (!capMeshes.length) return;

      const hits = raycaster.intersectObjects(capMeshes, false);
      if (!hits.length) return;

      const cap  = hits[0].object;
      const comp = cap.userData.ownerComp;
      if (comp) {
        App.toggleButton(comp);   // animate cap + flip comp.pressed
        App.runSimulation();      // re-evaluate circuit with new button state
      }
    };

    canvas.addEventListener('click', _btnClickHandler);
  }

  function removeButtonClicks() {
    if (_btnClickHandler) {
      const canvas = document.getElementById('canvas');
      canvas.removeEventListener('click', _btnClickHandler);
      _btnClickHandler = null;
    }
  }

  // ── Internal: clear visual state only (no button/UI reset) ──
  function clearSimVisuals() {
    activeLights.forEach(l => App.scene.remove(l));
    activeLights.length = 0;
    App.state.components.forEach(c => {
      if (c.type === 'led')    dimLED(c);
      if (c.type === 'buzzer') deactivateBuzzer(c);
    });
    stopAllBuzzers();
    hideResults();
  }

  // ── Public: runSimulation ───────────────────────────────────
  App.runSimulation = function () {
    const { components, wires } = App.state;
    const isRerun = _btnClickHandler !== null; // already running = button click re-run
    clearSimVisuals(); // preserve button states across re-runs

    // Switch to select mode so user can click components during simulation
    if (!isRerun && App.setMode) App.setMode('select');

    if (!components.length) {
      showResults([{ text: 'No components placed.', cls: 'sim-warn' }]);
      return;
    }

    const graph   = buildGraph(components, wires);
    const lines   = [];
    const bats    = graph.filter(g => g.comp.type === 'battery');
    const buttons = components.filter(c => c.type === 'button');
    buttons.forEach((btn, i) => {
      const state = btn.pressed ? '🟢 CLOSED (current flowing)' : '⭕ OPEN — click to press';
      lines.push({ text: `Button ${i + 1}: ${state}`, cls: btn.pressed ? 'sim-on' : 'sim-info' });
    });

    if (!bats.length) {
      showResults([{ text: 'No battery in circuit.', cls: 'sim-warn' }]);
      if (!isRerun) installButtonClicks();
      return;
    }

    // ── Solve the whole circuit at once ───────────────────────
    const netlist  = buildNetlist(graph);
    netlist.ground = bats[0].nodes[1];        // battery − is the reference node
    const elemById = new Map(netlist.elements.map(e => [e.id, e]));

    const sol = MNA.solve(netlist);

    if (!sol.ok) {
      showResults([{ text: '⚠ Circuit could not be solved — check for conflicting connections.',
                     cls: 'sim-err' }]);
      if (!isRerun) installButtonClicks();
      return;
    }
    if (!sol.converged) {
      lines.push({ text: '⚠ Solver hit its iteration cap — results are approximate.',
                   cls: 'sim-warn' });
    }

    const vAt = n => sol.voltages[n] ?? 0;

    // ── Battery / supply report ───────────────────────────────
    bats.forEach((bat, bi) => {
      const I    = sol.currents[bat.comp._simId] ?? 0;
      const Vnom = bat.comp.voltage ?? PROPS.battery.voltage;
      const Vterm = vAt(bat.nodes[0]) - vAt(bat.nodes[1]);

      lines.push({
        text: `Battery ${bi + 1}: ${Vnom}V nominal — delivering ${fmtI(I)} at ${Vterm.toFixed(2)}V`,
        cls: 'sim-info',
      });

      if (Math.abs(I) > 1.0) {
        lines.push({ text: `  ⚠ SHORT CIRCUIT — ${fmtI(I)} through the cell, terminal collapsed to ${Vterm.toFixed(2)}V.`,
                     cls: 'sim-err' });
      } else if (Math.abs(I) < 1e-6) {
        lines.push({ text: '  Circuit open — no complete path, no current flowing.',
                     cls: 'sim-warn' });
      }
    });

    // ── Per-component report ──────────────────────────────────
    let anyOutput = false;

    graph.forEach(({ comp }) => {
      const I = sol.currents[comp._simId];
      if (I === undefined) return;
      const el = elemById.get(comp._simId);

      if (comp.type === 'led') {
        anyOutput = true;
        const vd = el ? vAt(el.a) - vAt(el.b) : 0;

        if (I >= PROPS.led.thresholdCurrent) {
          lightUpLED(comp);
          const over = I > PROPS.led.maxCurrent ? '  ⚠ above rated 20mA' : '';
          lines.push({ text: `  💡 LED ON — ${fmtI(I)} at ${vd.toFixed(2)}V${over}`, cls: 'sim-on' });
        } else if (vd < 0.5) {
          // Genuinely backwards, or simply unpowered. Both read as
          // "no forward bias", and the solver tells them apart by
          // how far negative the junction sits.
          lines.push({
            text: vd < -0.5
              ? `  LED off — reverse biased at ${vd.toFixed(2)}V (leads are backwards).`
              : '  LED off — no voltage across it.',
            cls: 'sim-warn' });
        } else {
          lines.push({ text: `  LED off — only ${fmtI(I)}, under the ${fmtI(PROPS.led.thresholdCurrent)} threshold.`,
                       cls: 'sim-warn' });
        }
      }

      if (comp.type === 'buzzer') {
        anyOutput = true;
        if (Math.abs(I) >= PROPS.buzzer.thresholdCurrent) {
          activateBuzzer(comp);
          lines.push({ text: `  🔔 BUZZER ON — ${fmtI(Math.abs(I))}`, cls: 'sim-on' });
        } else {
          lines.push({ text: '  Buzzer off — current too low.', cls: 'sim-warn' });
        }
      }

      if (comp.type === 'resistor' && Math.abs(I) > 1e-7) {
        const R = comp.resistance ?? PROPS.resistor.resistance;
        const P = I * I * R;
        const warn = P > 0.25 ? '  ⚠ exceeds a 1/4W part' : '';
        lines.push({ text: `  Resistor ${R}Ω — ${fmtI(Math.abs(I))}, ${(P * 1000).toFixed(0)}mW${warn}`,
                     cls: 'sim-info' });
      }
    });

    if (!anyOutput) {
      lines.push({ text: '  No LED or buzzer in the circuit.', cls: 'sim-info' });
    }

    showResults(lines);
    App.simRunning = true;
    document.getElementById('sim-run-btn').style.display  = 'none';
    document.getElementById('sim-stop-btn').style.display = 'inline-flex';
    // Only install the click handler on the first run — re-runs from
    // the button handler itself keep the same handler alive.
    if (!isRerun) installButtonClicks();
  };

  // ── Public: stopSimulation ──────────────────────────────────
  App.stopSimulation = function () {
    clearSimVisuals();
    // Reset all buttons directly — no toggleButton call to avoid re-entrancy
    App.state.components.forEach(c => {
      if (c.type !== 'button') return;
      c.pressed = false;
      const cap = c.capMesh;
      if (!cap) return;
      if (cap.userData._animId) { cancelAnimationFrame(cap.userData._animId); cap.userData._animId = null; }
      cap.position.y = cap.userData.capRestY;
      if (cap.userData.matCloned) {
        cap.material.color.setHex(0xe8e8e8);
        cap.material.emissive.setHex(0x000000);
        cap.material.emissiveIntensity = 0;
      }
    });
    App.simRunning = false;
    removeButtonClicks();
    const runBtn  = document.getElementById('sim-run-btn');
    const stopBtn = document.getElementById('sim-stop-btn');
    if (runBtn)  runBtn.style.display  = 'inline-flex';
    if (stopBtn) stopBtn.style.display = 'none';
  };

  // ── Test seam ────────────────────────────────────────────────
  //  buildGraph and buildNetlist are pure functions of the placed
  //  components and wires. Exposing them lets the Node suite verify
  //  the full board -> netlist -> solver path with no DOM and no
  //  WebGL, which is the part that actually decides correctness.
  App._internals = { buildGraph, buildNetlist, PROPS, fmtI };

})(window.App = window.App || {});
