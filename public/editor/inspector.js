// ─────────────────────────────────────────────────────────────
//  inspector.js — the dock for the selected part or wire
//
//  A bar along the bottom of the board: the part's name and where it sits,
//  the control that changes it (a resistor's value slider, an LED's colour,
//  an ESP32's sketch), and a delete button on the right. Escape clears the
//  selection.
// ─────────────────────────────────────────────────────────────

(function (App) {

  // Standard resistor values, lowest to highest. The slider snaps between them.
  const RESISTORS = [100, 150, 220, 330, 470, 680, 1000, 1500, 2200, 3300, 4700, 10000];
  const LEDS = ['red', 'yellow', 'green', 'blue', 'white'];
  const SWATCH = { red: '#ef4444', yellow: '#facc15', green: '#22c55e', blue: '#3b82f6', white: '#f5f5f4' };

  const NAMES = {
    resistor: 'Resistor', led: 'LED', battery: '9 V battery', buzzer: 'Buzzer', button: 'Push button',
    esp32: 'ESP32 DevKit', wire: 'Jumper wire', seg7: '7-segment display',
  };

  const ohms = r => r >= 1000 ? (r / 1000) + ' kΩ' : r + ' Ω';
  const esc = t => String(t).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  const ICON = {
    code:  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m8 7-5 5 5 5"/><path d="m16 7 5 5-5 5"/></svg>',
    trash: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M9 6V4h6v2"/></svg>',
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

  // The control for a part, as markup. Parts without settings get none.
  function controlsFor(item) {
    if (item.type === 'resistor') {
      // The first standard value at or above the part's value, so an odd value still lands on the bar.
      const at = Math.max(0, RESISTORS.findIndex(r => r >= item.values.resistance));
      const top = at < 0 ? RESISTORS.length - 1 : at;
      return `<label class="insp-slider">
          <span class="insp-value">${ohms(RESISTORS[top])}</span>
          <input type="range" min="0" max="${RESISTORS.length - 1}" step="1" value="${top}" aria-label="Resistance" list="insp-ticks">
          <datalist id="insp-ticks">${RESISTORS.map((r, i) => `<option value="${i}" label="${ohms(r)}"></option>`).join('')}</datalist>
        </label>`;
    }
    if (item.type === 'led') {
      return LEDS.map(c => `<button class="insp-swatch ${item.values.color === c ? 'on' : ''}" data-c="${c}" title="${c}" aria-label="${c}" style="--sw:${SWATCH[c]}"></button>`).join('') +
        `<span class="insp-note">${item.values.forwardVoltage.toFixed(1)} V</span>`;
    }
    if (item.type === 'esp32' && item.values.sketch) {
      return `<button class="insp-sketch" data-sketch="${esc(item.values.sketch)}" title="Edit the sketch" aria-label="Edit the sketch">${ICON.code}</button>`;
    }
    return '';
  }

  App.showInspector = function (item, kind) {
    const el = ensureCard();
    const isWire = kind === 'wire';
    const type = isWire ? 'wire' : item.type;
    let id = '', controls = '';
    if (!isWire) {
      const ids = App.componentIds();
      id = ids[App.state.components.indexOf(item)] || '';
      controls = controlsFor(item);
    }
    el.innerHTML = `
      <div class="insp-main">
        <span class="insp-title">${esc(NAMES[type] || type)}</span>
        <span class="insp-id">${esc(id)}</span>
      </div>
      <div class="insp-controls">${controls}</div>
      <button class="insp-delete" title="Delete (Del)" aria-label="Delete">${ICON.trash}</button>`;
    el.style.display = 'grid';

    el.querySelectorAll('[data-c]').forEach(b => b.addEventListener('click', () => {
      App.setComponentValues(item, { color: b.dataset.c });
      App.showInspector(item, kind);
    }));
    const slider = el.querySelector('input[type="range"]');
    if (slider) {
      const label = el.querySelector('.insp-value');
      slider.addEventListener('input', () => { label.textContent = ohms(RESISTORS[+slider.value]); });
      slider.addEventListener('change', () => {
        App.setComponentValues(item, { resistance: RESISTORS[+slider.value] });
        App.showInspector(item, kind);
      });
    }
    el.querySelectorAll('[data-sketch]').forEach(b => b.addEventListener('click', () => App.openSketch(b.dataset.sketch)));
    el.querySelector('.insp-delete').addEventListener('click', () => App.deleteSelected());
  };

  App.hideInspector = function () {
    if (card) card.style.display = 'none';
  };

})(window.App = window.App || {});
