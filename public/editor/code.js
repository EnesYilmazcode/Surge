// ─────────────────────────────────────────────────────────────
//  code.js — the Code view: a small ESP32 (Arduino C++) editor
//
//  A transparent <textarea> sits over a highlighted <pre>; the two share one
//  font and padding so the caret lines up with the coloured text. The sketch
//  is kept in localStorage.
//
//  Exports: App.setView, App.getSketch, App.setSketch
// ─────────────────────────────────────────────────────────────

(function (App) {

  const KEY = 'surge_sketch';
  const STARTER = `// Blink the on-board LED on an ESP32
const int LED_PIN = 2;

void setup() {
  pinMode(LED_PIN, OUTPUT);
  Serial.begin(115200);
}

void loop() {
  digitalWrite(LED_PIN, HIGH);
  delay(500);
  digitalWrite(LED_PIN, LOW);
  delay(500);
}
`;

  const words = list => new Set(list.split(' '));
  const KEYWORDS = words('if else for while do switch case break continue return default goto new delete class struct enum namespace using template typename public private protected static const constexpr volatile inline extern sizeof true false nullptr this');
  const TYPES = words('void int long short char float double bool boolean byte word unsigned signed size_t uint8_t uint16_t uint32_t uint64_t int8_t int16_t int32_t int64_t String auto');
  const ARDUINO = words('HIGH LOW INPUT OUTPUT INPUT_PULLUP LED_BUILTIN Serial Wire SPI WiFi setup loop');

  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const TOKEN = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|(^[ \t]*#[^\n]*)|(\b(?:0[xX][\da-fA-F]+|\d+\.?\d*)\w*)|([A-Za-z_]\w*)/gm;

  function highlight(src) {
    let out = '', last = 0, m;
    TOKEN.lastIndex = 0;
    while ((m = TOKEN.exec(src))) {
      out += esc(src.slice(last, m.index));
      last = m.index + m[0].length;
      const t = esc(m[0]);
      if (m[1]) out += `<span class="tok-c">${t}</span>`;
      else if (m[2]) out += `<span class="tok-s">${t}</span>`;
      else if (m[3]) out += `<span class="tok-p">${t}</span>`;
      else if (m[4]) out += `<span class="tok-n">${t}</span>`;
      else {
        const w = m[0];
        const cls = KEYWORDS.has(w) ? 'k' : TYPES.has(w) ? 't' : ARDUINO.has(w) ? 'a'
          : src[last] === '(' ? 'f' : '';
        out += cls ? `<span class="tok-${cls}">${t}</span>` : t;
      }
    }
    return out + esc(src.slice(last));
  }

  App.onReady(() => {
    const view   = document.getElementById('code-view');
    const input  = view.querySelector('.code-input');
    const code   = view.querySelector('.code-highlight code');
    const pre    = view.querySelector('.code-highlight');
    const gutter = view.querySelector('.code-gutter-inner');
    const gutterBox = view.querySelector('.code-gutter');
    const pos    = document.getElementById('code-pos');
    const app    = document.getElementById('app');

    let saved = null;
    try { saved = localStorage.getItem(KEY); } catch {}
    input.value = saved != null ? saved : STARTER;

    let lineCount = 0;
    function render() {
      const src = input.value;
      // A trailing newline needs a character after it or the last line collapses.
      code.innerHTML = highlight(src) + '\n';
      const n = src.split('\n').length;
      if (n !== lineCount) {
        lineCount = n;
        gutter.innerHTML = Array.from({ length: n }, (_, i) => `<div>${i + 1}</div>`).join('');
      }
      syncScroll();
      updatePos();
    }

    function syncScroll() {
      pre.scrollTop = input.scrollTop;
      pre.scrollLeft = input.scrollLeft;
      gutterBox.scrollTop = input.scrollTop;
    }

    let _current = null;
    function updatePos() {
      const before = input.value.slice(0, input.selectionStart).split('\n');
      const line = before.length;
      pos.textContent = `Ln ${line}, Col ${before[before.length - 1].length + 1}`;
      if (_current) _current.classList.remove('on');
      _current = gutter.children[line - 1] || null;
      if (_current) _current.classList.add('on');
    }

    let _saveTimer;
    function persist() {
      clearTimeout(_saveTimer);
      _saveTimer = setTimeout(() => { try { localStorage.setItem(KEY, input.value); } catch {} }, 400);
    }

    // execCommand keeps the browser's own undo stack; setRangeText is the fallback.
    function insert(text) {
      if (!document.execCommand('insertText', false, text)) {
        input.setRangeText(text, input.selectionStart, input.selectionEnd, 'end');
        render();
      }
    }

    function indentLines(outdent) {
      const v = input.value;
      const start = v.lastIndexOf('\n', input.selectionStart - 1) + 1;
      let end = input.selectionEnd;
      if (end > start && v[end - 1] === '\n') end--;
      const block = v.slice(start, end);
      const next = block.split('\n').map(l => outdent ? l.replace(/^ {1,2}/, '') : '  ' + l).join('\n');
      const s0 = input.selectionStart, e0 = input.selectionEnd;
      input.setSelectionRange(start, end);
      insert(next);
      const first = outdent ? -Math.min(2, (block.match(/^ */) || [''])[0].length) : 2;
      input.setSelectionRange(Math.max(start, s0 + first), e0 + (next.length - block.length));
    }

    input.addEventListener('keydown', e => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const multi = input.value.slice(input.selectionStart, input.selectionEnd).includes('\n');
        if (multi || e.shiftKey) indentLines(e.shiftKey); else insert('  ');
      } else if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        const v = input.value, i = input.selectionStart;
        const line = v.slice(v.lastIndexOf('\n', i - 1) + 1, i);
        const indent = (line.match(/^[ \t]*/) || [''])[0];
        const open = /\{\s*$/.test(line) ? '  ' : '';
        insert('\n' + indent + open);
      }
    });

    input.addEventListener('input', () => { render(); persist(); });
    input.addEventListener('scroll', syncScroll);
    ['keyup', 'click', 'select'].forEach(ev => input.addEventListener(ev, updatePos));
    document.addEventListener('selectionchange', () => { if (document.activeElement === input) updatePos(); });

    // ── Board / Code switch ──────────────────────────────────
    const buttons = document.querySelectorAll('.mode-btn[data-view]');
    App.setView = function (name) {
      const code = name === 'code';
      app.classList.toggle('view-code', code);
      view.hidden = !code;
      buttons.forEach(b => b.classList.toggle('active', b.dataset.view === name));
      if (code) { render(); input.focus(); }
    };
    buttons.forEach(b => b.addEventListener('click', () => App.setView(b.dataset.view)));

    App.getSketch = () => input.value;
    App.setSketch = text => {
      input.value = text;
      render();
      persist();
    };
    render();
  });

})(window.App = window.App || {});
