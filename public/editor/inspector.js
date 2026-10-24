// ─────────────────────────────────────────────────────────────
//  inspector.js — the dock for the selected part or wire
//
//  A bar along the bottom of the board: the part's picture, its name and
//  where it sits, one line on what it does, and the controls that change it
//  (a resistor's value, an LED's colour, an ESP32's sketch). Escape or the
//  close button clears the selection.
// ─────────────────────────────────────────────────────────────

(function (App) {

  const RESISTORS = [100, 220, 330, 470, 1000, 2200, 10000];
  const LEDS = ['red', 'yellow', 'green', 'blue', 'white'];
  const SWATCH = { red: '#ef4444', yellow: '#facc15', green: '#22c55e', blue: '#3b82f6', white: '#f5f5f4' };

  // What each part is and what it does in a circuit. Adding a part means adding a row here.
  const INFO = {
    resistor: { name: 'Resistor', about: 'Limits current. In series with an LED it sets how bright the LED is and keeps it from burning out.' },
    led:      { name: 'LED', about: 'Lights when current flows from the long leg (anode, +) to the short leg (cathode, −). Always needs a resistor.' },
    battery:  { name: '9 V battery', about: 'The 9 V supply. Wire + to a red rail and − to a blue rail, then feed the board from the rails.' },
    buzzer:   { name: 'Buzzer', about: 'Beeps when about 9 V is across it, + leg toward power.' },
    button:   { name: 'Push button', about: 'Connects its two legs only while pressed. During a simulation, click it to press.' },
    esp32:    { name: 'ESP32 DevKit', about: 'Wi-Fi and Bluetooth board, powered over USB by the bank beside it. Wire to the named pins along its edges. The sketch drives a pin by its GPIO number: D2 is GPIO2.' },
    wire:     { name: 'Jumper wire', about: 'Joins two sockets, or a socket and a pin, into one connection.' },
  };

  const ohms = r => r >= 1000 ? (r / 1000) + ' kΩ' : r + ' Ω';
  const esc = t => String(t).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  const ICON = {
    code:  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m8 7-5 5 5 5"/><path d="m16 7 5 5-5 5"/></svg>',
    trash: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M9 6V4h6v2"/></svg>',
  };

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

  // The part's picture, taken from its palette tile so the dock matches the library.
  function pictureOf(type) {
    const img = document.querySelector(`.comp-item[data-type="${type}"] [data-thumb] img`);
    return img ? img.getAttribute('src') : '';
  }

  function where(item) {
    if (!item.holeRefs) return 'Off the board';
    const h = item.holeRefs, f = App.formatHole;
    if (h.length > 2) return `${f(h[0])}–${f(h[h.length / 2 - 1])}, ${f(h[h.length / 2])}–${f(h[h.length - 1])}`;
    return h.map(f).join(' → ');
  }

  // The controls for a part, as markup. Wires and parts without settings get none.
  function controlsFor(item) {
    if (item.type === 'resistor') {
      return RESISTORS.map(r => `<button class="insp-chip ${item.values.resistance === r ? 'on' : ''}" data-r="${r}" title="${ohms(r)}">${ohms(r)}</button>`).join('');
    }
    if (item.type === 'led') {
      return LEDS.map(c => `<button class="insp-swatch ${item.values.color === c ? 'on' : ''}" data-c="${c}" title="${c}" aria-label="${c}" style="--sw:${SWATCH[c]}"></button>`).join('') +
        `<span class="insp-note">${item.values.forwardVoltage.toFixed(1)} V</span>`;
    }
    if (item.type === 'esp32' && item.values.sketch) {
      return `<button class="insp-sketch" data-sketch="${esc(item.values.sketch)}" title="Open ${esc(item.values.sketch)} in the code editor">${ICON.code}${esc(item.values.sketch)}</button>`;
    }
    return '';
  }

  App.showInspector = function (item, kind) {
    const el = ensureCard();
    const isWire = kind === 'wire';
    const type = isWire ? 'wire' : item.type;
    const info = INFO[type] || { name: type, about: '' };
    let id = '', controls = '';
    if (isWire) {
      const [a, b] = App.wireLabels(item);
      id = `${a || '?'} → ${b || '?'}`;
    } else {
      const ids = App.componentIds();
      id = `${ids[App.state.components.indexOf(item)]} · ${where(item)}`;
      controls = controlsFor(item);
    }
    const picture = pictureOf(type);
    el.innerHTML = `
      <div class="insp-thumb">${picture ? `<img src="${picture}" alt="">` : ''}</div>
      <div class="insp-main">
        <span class="insp-title">${esc(info.name)}</span>
        <span class="insp-id">${esc(id)}</span>
        <p class="insp-about">${esc(info.about)}</p>
      </div>
      <div class="insp-controls">${controls}</div>
      <div class="insp-end">
        <button class="insp-delete" title="Delete (Del)">${ICON.trash}Delete</button>
        <button class="insp-close" title="Close (Esc)" aria-label="Close">×</button>
      </div>`;
    el.style.display = 'grid';

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
    el.querySelector('.insp-close').addEventListener('click', () => App.deselect());
  };

  App.hideInspector = function () {
    if (card) card.style.display = 'none';
  };

})(window.App = window.App || {});
