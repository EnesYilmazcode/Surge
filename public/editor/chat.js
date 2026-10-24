
// ── Surge AI chat (via backend proxy) ──────────────────────────
const chatHistory = [];   // {role:'user'|'model', text} pairs for conversation memory

/* Model instructions and tool schemas are kept on the local server. */

function validateActions(actions) {
  if (!Array.isArray(actions) || actions.length > 50) throw new Error('Invalid proposal.');
  return actions;
}

async function askGeminiClient(markdown, userMsg, history) {
  const msg = userMsg || 'Analyze my circuit and tell me what to do next.';
  const res = await fetch('/api/surge/workbench', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ markdown, message: msg, history: history.slice(-12), board: App.exportState() }),
  });
  if (!res.ok) { const err = await res.json(); throw new Error(err.error || 'Surge could not complete the request.'); }
  const data = await res.json();
  let { reply, actions } = data;
  reply = reply || '(no response)';
  actions = Array.isArray(actions) ? actions : [];
  actions = validateActions(actions);
  return { reply, actions };
}

// ── Chat helpers ─────────────────────────────────────────────────

function surgeAddMsg(text, role) {
  const welcome = document.getElementById('surge-welcome');
  if (welcome) welcome.classList.add('hidden');
  const box = document.getElementById('surge-messages');
  const el  = document.createElement('div');
  el.className   = 'chat-msg ' + role;
  el.textContent = text;
  box.appendChild(el);
  box.scrollTop  = box.scrollHeight;
  return el;
}

function surgeTyping() {
  const welcome = document.getElementById('surge-welcome');
  if (welcome) welcome.classList.add('hidden');
  const box = document.getElementById('surge-messages');
  const el  = document.createElement('div');
  el.className = 'chat-msg typing';
  el.innerHTML = '<div class="typing-dots"><span></span><span></span><span></span></div>';
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
  return el;
}

// ── Hole parser ──────────────────────────────────────────────────

function parseHole(str) {
  if (!str) return [null, null];
  const railM = str.match(/^(tp|tn|bp|bn)_(\d+)$/i);
  if (railM) return [parseInt(railM[2]) - 1, railM[1].toLowerCase()];
  const m = str.match(/^([a-j])(\d+)$/i);
  if (m)    return [parseInt(m[2]) - 1, m[1].toLowerCase()];
  return [null, null];
}

// ── Execute actions (real placement) ────────────────────────────

function surgeExecActions(actions) {
  if (!actions || !actions.length) return 0;
  const bb = App.state.breadboard;
  let done = 0;
  actions.forEach(a => {
    try {
      if (a.tool === 'place_resistor') {
        const hA = bb.getHole(...parseHole(a.holeA));
        const hB = bb.getHole(...parseHole(a.holeB));
        if (hA && hB) { App.placeResistor(hA, hB); done++; }
      } else if (a.tool === 'place_led') {
        const hA = bb.getHole(...parseHole(a.holeA));
        const hB = bb.getHole(...parseHole(a.holeB));
        if (hA && hB) { App.placeLED(hA, hB); done++; }
      } else if (a.tool === 'place_buzzer') {
        const hA = bb.getHole(...parseHole(a.holeA));
        const hB = bb.getHole(...parseHole(a.holeB));
        if (hA && hB) { App.placeBuzzer(hA, hB); done++; }
      } else if (a.tool === 'place_button') {
        const hA = bb.getHole(...parseHole(a.holeA));
        const hB = bb.getHole(...parseHole(a.holeB));
        if (hA && hB) { App.placeButton(hA, hB); done++; }
      } else if (a.tool === 'place_battery') {
        App.placeBattery(13, 0); done++;
      } else if (a.tool === 'add_wire') {
        execWire(a.from, a.to, a.color); done++;
      } else if (a.tool === 'remove_component') {
        if (execRemoveComponent(a.id)) done++;
      } else if (a.tool === 'remove_wire') {
        if (execRemoveWire(a.from, a.to)) done++;
      } else if (a.tool === 'delete_all') {
        App.clearAll(); done++;
      }
    } catch (e) { console.warn('Action failed:', a, e.message); }
  });
  return done;
}

function execRemoveComponent(compId) {
  const match = compId && compId.match(/^(resistor|led|battery|buzzer|button)_(\d+)$/);
  if (!match) return false;
  const comp = App.state.components.filter(c => c.type === match[1])[Number(match[2])];
  if (!comp) return false;
  App.selectItem(comp, 'component');
  App.deleteSelected();
  return true;
}

function execRemoveWire(fromStr, toStr) {
  if (!fromStr || !toStr) return false;
  const bb = App.state.breadboard;
  // Helper to normalize a wire endpoint to a comparable string
  function holeKey(ref) {
    if (!ref) return null;
    return ref.row + (ref.col + 1);
  }
  function pinKey(comp, pinIdx) {
    if (!comp) return null;
    const idx = App.state.components.indexOf(comp);
    return `${App.componentId(comp)}_pin${pinIdx}`;
  }
  function wireEndKey(w, side) {
    if (side === 'start') {
      if (w.startHole) return holeKey(w.startHole);
      if (w.startComp) return pinKey(w.startComp, w.startPinIdx);
    } else {
      if (w.endHole) return holeKey(w.endHole);
      if (w.endComp) return pinKey(w.endComp, w.endPinIdx);
    }
    return null;
  }
  // Normalize the from/to strings for comparison
  const normFrom = fromStr.toLowerCase();
  const normTo = toStr.toLowerCase();
  // Find matching wire (check both orderings)
  const idx = App.state.wires.findIndex(w => {
    const ws = wireEndKey(w, 'start');
    const we = wireEndKey(w, 'end');
    if (!ws || !we) return false;
    return (ws === normFrom && we === normTo) || (ws === normTo && we === normFrom);
  });
  if (idx === -1) { console.warn('remove_wire: not found:', fromStr, '→', toStr); return false; }
  const wire = App.state.wires[idx];
  App.scene.remove(wire.group);
  App.state.wires.splice(idx, 1);
  console.log('Removed wire:', fromStr, '→', toStr);
  return true;
}

function execWire(fromStr, toStr, colorName) {
  const bb = App.state.breadboard;
  const COLOR_MAP = { red: 0xef4444, yellow: 0xfbbf24, green: 0x22c55e,
                      blue: 0x3b82f6, black: 0x111111, white: 0xffffff };
  const colorHex = colorName ? (COLOR_MAP[colorName.toLowerCase()] || 0xef4444) : App.state.wireColor;

  function resolve(str) {
    const pinM = str.match(/^(\w+)_(\d+)_pin(\d+)$/i);
    if (pinM) {
      const comps = App.state.components.filter(c => c.type === pinM[1]);
      const comp  = comps[parseInt(pinM[2])];
      if (comp) {
        const pm = comp.pinMeshes[parseInt(pinM[3])];
        if (pm) return { world: pm.userData.world.clone(), holeRef: null, pinMesh: pm };
      }
      return null;
    }
    const [col, row] = parseHole(str);
    if (col === null) return null;
    const h = bb.getHole(col, row);
    if (!h) return null;
    return { world: h.world.clone(), holeRef: { col: h.col, row: h.row }, pinMesh: null };
  }

  const start = resolve(fromStr);
  const end   = resolve(toStr);
  if (!start || !end) return;
  const saved = App.state.wireColor;
  App.state.wireColor = colorHex;
  App.state.wireStart = start;
  App.finishWire(end);
  App.state.wireColor = saved;
}

// ── Preview / Accept / Decline ───────────────────────────────────

let _pendingActions = null;
let _pendingBoardSignature = null;
let surgeRequestInProgress = false;
let _pendingGhosts  = [];

const _COLOR_MAP = { red: 0xef4444, yellow: 0xfbbf24, green: 0x22c55e,
                     blue: 0x3b82f6, black: 0x111111, white: 0xffffff };

function surgePreviewActions(actions) {
  surgeDeclineChanges();          // clear any stale preview first
  if (!actions || !actions.length) return;
  _pendingActions = actions;
  _pendingBoardSignature = JSON.stringify(App.exportState());

  const bb = App.state.breadboard;

  // ── Pre-compute expected pin positions for pending components ──
  // This lets wire ghosts resolve pins of components that don't exist yet.
  const pendingPins = {};
  const H = 2.6;                          // battery body height (must match buildBattery)
  let pendingBatteryIdx = App.state.components.filter(c => c.type === 'battery').length;
  for (const a of actions) {
    if (a.tool === 'place_battery') {
      const wx = 13, wz = 0;             // same as surgeExecActions hardcoded position
      pendingPins[`battery_${pendingBatteryIdx}_pin0`] = new THREE.Vector3(wx - 0.32, H + 0.54, wz);
      pendingPins[`battery_${pendingBatteryIdx}_pin1`] = new THREE.Vector3(wx + 0.32, H + 0.24, wz);
      pendingBatteryIdx++;
    }
  }

  // ── Build a ghost for each action ─────────────────────────────
  for (const a of actions) {
    let ghost = null;

    // Component ghosts — use existing buildPreview (already semi-transparent)
    if (['place_resistor','place_led','place_buzzer','place_button'].includes(a.tool)) {
      const type = a.tool.replace('place_', '');
      const hA   = bb.getHole(...parseHole(a.holeA));
      const hB   = bb.getHole(...parseHole(a.holeB));
      if (hA && hB) {
        const SPANS = { resistor: App.RESISTOR_SPAN, led: App.LED_SPAN,
                        buzzer: App.BUZZER_SPAN, button: App.BUTTON_SPAN };
        const rotation = hA.col === hB.col ? 1 : 0;
        ghost = App.buildPreview(type, SPANS[type] || 2, bb.HS, rotation);
        ghost.position.set((hA.x + hB.x) / 2, 0, (hA.z + hB.z) / 2);
      }

    } else if (a.tool === 'place_battery') {
      ghost = App.buildPreview('battery', 0, bb.HS, 0);
      ghost.position.set(13, 0, 0);

    } else if (a.tool === 'add_wire') {
      ghost = _buildWireGhost(a.from, a.to, a.color, pendingPins);

    } else if (a.tool === 'remove_component') {
      // Highlight the component to be removed with red tint
      const m = a.id && a.id.match(/^(\w+)_(\d+)$/);
      if (m) {
        const comps = App.state.components.filter(c => c.type === m[1]);
        const comp = comps[parseInt(m[2])];
        if (comp && comp.group) {
          comp.group.traverse(child => {
            if (child.isMesh && child.material) {
              child._origMaterial = child.material;
              child.material = child.material.clone();
              child.material.color.set(0xff0000);
              child.material.transparent = true;
              child.material.opacity = 0.5;
            }
          });
          _pendingGhosts.push({ _isRemovalHighlight: true, comp: comp });
        }
      }

    } else if (a.tool === 'remove_wire') {
      // Highlight the wire to be removed with red tint
      const normFrom = a.from?.toLowerCase(), normTo = a.to?.toLowerCase();
      function hk(ref) { return ref ? ref.row + (ref.col + 1) : null; }
      function pk(comp, pi) { const i = App.state.components.indexOf(comp); return comp ? `${App.componentId(comp)}_pin${pi}` : null; }
      const wire = App.state.wires.find(w => {
        const ws = w.startHole ? hk(w.startHole) : pk(w.startComp, w.startPinIdx);
        const we = w.endHole ? hk(w.endHole) : pk(w.endComp, w.endPinIdx);
        return (ws === normFrom && we === normTo) || (ws === normTo && we === normFrom);
      });
      if (wire && wire.group) {
        wire.group.traverse(child => {
          if (child.isMesh && child.material) {
            child._origMaterial = child.material;
            child.material = child.material.clone();
            child.material.color.set(0xff0000);
            child.material.transparent = true;
            child.material.opacity = 0.5;
          }
        });
        _pendingGhosts.push({ _isRemovalHighlight: true, wire: wire });
      }
    }
    // delete_all: no ghost mesh — flagged in the pending bar text instead

    if (ghost) { App.scene.add(ghost); _pendingGhosts.push(ghost); }
  }

  // Show the pending bar
  document.getElementById('surge-pending-bar').style.display = 'flex';
}

function _buildWireGhost(fromStr, toStr, colorName, pendingPins) {
  const bb  = App.state.breadboard;
  const hex = colorName ? (_COLOR_MAP[colorName.toLowerCase()] || 0xef4444) : 0xef4444;

  function resolvePos(str) {
    // Check pending pins first (for not-yet-placed components e.g. battery preview)
    if (pendingPins && pendingPins[str]) return pendingPins[str].clone();
    // Try breadboard hole
    const [col, row] = parseHole(str);
    if (col !== null) {
      const h = bb.getHole(col, row);
      if (h) return new THREE.Vector3(h.x, 0.06, h.z);
    }
    // Try existing placed component pin
    const pinM = str.match(/^(\w+)_(\d+)_pin(\d+)$/i);
    if (pinM) {
      const comps = App.state.components.filter(c => c.type === pinM[1]);
      const comp  = comps[parseInt(pinM[2])];
      const pm    = comp?.pinMeshes[parseInt(pinM[3])];
      if (pm) return pm.userData.world.clone();
    }
    return null;
  }

  const start = resolvePos(fromStr);
  const end   = resolvePos(toStr);
  if (!start || !end) return null;

  const g    = new THREE.Group();
  const mat  = new THREE.MeshLambertMaterial({ color: hex, transparent: true, opacity: 0.42, depthWrite: false });
  const dist = start.distanceTo(end);
  const mid  = new THREE.Vector3(
    (start.x + end.x) / 2,
    Math.max(start.y, end.y) + dist * 0.22 + 0.38,
    (start.z + end.z) / 2
  );
  const curve = new THREE.CatmullRomCurve3([start, mid, end]);
  g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 26, 0.043, 7, false), mat));
  return g;
}

function surgeAcceptChanges() {
  if (!_pendingActions) return;
  if (_pendingBoardSignature !== JSON.stringify(App.exportState())) {
    surgeDeclineChanges();
    surgeAddMsg('The board changed. Ask for an updated proposal.', 'system');
    return;
  }
  const actions = _pendingActions;
  _surgeClearGhosts();
  _pendingActions = null;
  document.getElementById('surge-pending-bar').style.display = 'none';

  const n = surgeExecActions(actions);
  surgeAddMsg(`✓ Applied ${n} change${n !== 1 ? 's' : ''} to your circuit.`, 'system');
}

function surgeDeclineChanges() {
  if (!_pendingActions) return;
  _surgeClearGhosts();
  _pendingActions = null;
  document.getElementById('surge-pending-bar').style.display = 'none';
  surgeAddMsg('Changes declined.', 'system');
}

function _surgeClearGhosts() {
  _pendingGhosts.forEach(g => {
    if (g._isRemovalHighlight) {
      // Restore original materials on highlighted components/wires
      const target = g.comp ? g.comp.group : g.wire ? g.wire.group : null;
      if (target) {
        target.traverse(child => {
          if (child.isMesh && child._origMaterial) {
            child.material = child._origMaterial;
            delete child._origMaterial;
          }
        });
      }
    } else {
      App.scene.remove(g);
    }
  });
  _pendingGhosts = [];
}

// ── Main ask ─────────────────────────────────────────────────────

async function surgeAsk(overrideMsg) {
  if (surgeRequestInProgress) return;
  const input = document.getElementById('surge-input');
  const msg   = (overrideMsg !== undefined) ? overrideMsg : input.value.trim();
  if (!msg || msg.length > 6000) return;
  surgeRequestInProgress = true;
  const boardSignature = JSON.stringify(App.exportState());

  // If there's an open preview, dismiss it before sending a new message
  if (_pendingActions) {
    _surgeClearGhosts();
    _pendingActions = null;
    document.getElementById('surge-pending-bar').style.display = 'none';
  }

  surgeAddMsg(msg, 'user');
  input.value = '';
  input.style.height = 'auto';

  const typingEl = surgeTyping();

  try {
    const markdown = (typeof App !== 'undefined' && App.exportMarkdown)
      ? App.exportMarkdown() : '_Board not ready._';

    const data = await askGeminiClient(markdown, msg, chatHistory.slice(-20));
    typingEl.remove();
    if (boardSignature !== JSON.stringify(App.exportState())) {
      surgeAddMsg('The board changed while Surge was thinking. Send the request again for the updated circuit.', 'system');
      return;
    }
    surgeAddMsg(data.reply || '(no reply)', 'ai');

    // Store turn pair for conversation memory
    chatHistory.push({ role: 'user', text: msg });
    chatHistory.push({ role: 'model', text: data.reply || '' });

    if (data.actions && data.actions.length) {
      surgePreviewActions(data.actions);
    }

  } catch (err) {
    typingEl.remove();
    surgeAddMsg('⚠️ ' + err.message, 'system');
  } finally {
    surgeRequestInProgress = false;
  }

}

function surgeQuick(msg) { surgeAsk(msg); }

(() => {
  const inp = document.getElementById('surge-input');
  if (!inp) return;
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); surgeAsk(); }
  });
  // Auto-resize textarea as user types
  function autoResize() {
    inp.style.height = 'auto';
    inp.style.height = Math.min(inp.scrollHeight, 100) + 'px';
  }
  inp.addEventListener('input', autoResize);
})();
