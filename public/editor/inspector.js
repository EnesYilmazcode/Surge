// ─────────────────────────────────────────────────────────────
//  inspector.js — the card for the selected part or wire
//
//  Shows what the part is and what it does in a circuit, and lets a
//  resistor's value or an LED's colour be changed in place.
// ─────────────────────────────────────────────────────────────

(function (App) {

  const RESISTORS = [100, 220, 330, 470, 1000, 2200, 10000];
  const LEDS = ['red', 'yellow', 'green', 'blue', 'white'];
  const SWATCH = { red: '#ef4444', yellow: '#facc15', green: '#22c55e', blue: '#3b82f6', white: '#f5f5f4' };

  const ABOUT = {
    resistor: 'Limits current. In series with an LED it sets how bright the LED is and keeps it from burning out.',
    led: 'Lights when current flows from the long leg (anode, +) to the short leg (cathode, −). Always needs a resistor.',
    battery: 'The 9 V supply. Wire + to a red rail and − to a blue rail, then feed the board from the rails.',
    buzzer: 'Beeps when about 9 V is across it, + leg toward power.',
    button: 'Connects its two legs only while pressed. During a simulation, click it to press.',
    esp32: 'A Wi-Fi and Bluetooth microcontroller board. Each pin shares its strip with the free hole beside it, so wire to that hole. It runs the sketch file named above.',
  };

  const ohms = r => r >= 1000 ? (r / 1000) + ' kΩ' : r + ' Ω';
  const title = t => ({ resistor: 'Resistor', led: 'LED', battery: '9 V battery', buzzer: 'Buzzer', button: 'Push button', esp32: 'ESP32 DevKit' }[t] || t);

  const esc = t => String(t).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const CODE_ICON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m8 7-5 5 5 5"/><path d="m16 7 5 5-5 5"/></svg>';

  let card = null;

  function ensureCard() {
    if (card) return card;
    card = document.createElement('div');
    card.id = 'inspector';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'Selected part');
    document.getElementById('canvas-wrap').appendChild(card);
    return card;
  }

  function where(item) {
    if (!item.holeRefs) return 'Off the board';
    const h = item.holeRefs, f = App.formatHole;
    if (h.length > 2) return `${f(h[0])}–${f(h[h.length / 2 - 1])}, ${f(h[h.length / 2])}–${f(h[h.length - 1])}`;
    return h.map(f).join(' → ');
  }

  App.showInspector = function (item, kind) {
    const el = ensureCard();
    const ids = App.componentIds();
    let html = '';
    if (kind === 'wire') {
      const [a, b] = App.wireLabels(item);
      html = `<div class="insp-head"><span class="insp-title">Jumper wire</span><span class="insp-id">${a || '?'} → ${b || '?'}</span></div>
              <p class="insp-about">Joins two strips (or a strip and a battery terminal) into one connection.</p>`;
    } else {
      const id = ids[App.state.components.indexOf(item)];
      const file = item.type === 'esp32' && item.values.sketch
        ? `<button class="insp-file" data-sketch="${esc(item.values.sketch)}" title="Open in the code editor">${CODE_ICON}${esc(item.values.sketch)}</button>` : '';
      html = `<div class="insp-head"><span class="insp-title">${title(item.type)}</span>${file}<span class="insp-id">${id} · ${where(item)}</span></div>
              <p class="insp-about">${ABOUT[item.type] || ''}</p>`;
      if (item.type === 'resistor') {
        html += '<div class="insp-label">Resistance</div><div class="insp-chips">' +
          RESISTORS.map(r => `<button class="insp-chip ${item.values.resistance === r ? 'on' : ''}" data-r="${r}">${ohms(r)}</button>`).join('') + '</div>';
      }
      if (item.type === 'led') {
        html += '<div class="insp-label">Colour</div><div class="insp-chips">' +
          LEDS.map(c => `<button class="insp-swatch ${item.values.color === c ? 'on' : ''}" data-c="${c}" title="${c}" aria-label="${c}" style="--sw:${SWATCH[c]}"></button>`).join('') +
          `<span class="insp-note">${item.values.forwardVoltage.toFixed(1)} V forward</span></div>`;
      }
    }
    html += `<div class="insp-actions"><button class="insp-delete">Delete</button></div>`;
    el.innerHTML = html;
    el.style.display = 'block';

    el.querySelectorAll('[data-r]').forEach(b => b.addEventListener('click', () => {
      App.setComponentValues(item, { resistance: +b.dataset.r });
      App.showInspector(item, kind);
    }));
    el.querySelectorAll('[data-c]').forEach(b => b.addEventListener('click', () => {
      App.setComponentValues(item, { color: b.dataset.c });
      App.showInspector(item, kind);
    }));
    el.querySelectorAll('[data-sketch]').forEach(b => b.addEventListener('click', () => App.openSketch(b.dataset.sketch)));
    el.querySelector('.insp-delete').addEventListener('click', () => App.deleteSelected());
  };

  App.hideInspector = function () {
    if (card) card.style.display = 'none';
  };

})(window.App = window.App || {});
