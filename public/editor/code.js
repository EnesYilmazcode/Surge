// ─────────────────────────────────────────────────────────────
//  code.js — the Code view: a small ESP32 (Arduino C++) editor
//
//  A transparent <textarea> sits over a highlighted <pre>; the two share one
//  font and padding so the caret lines up with the coloured text.
//
//  The editor holds several sketch files, one tab each. Every ESP32 on the
//  board runs one of them, named in its values.sketch, and a file lives and
//  dies with its ESP32: there is no way to add or delete one by hand. The files are kept in
//  localStorage and travel inside circuit files.
//
//  Exports: App.setView, App.openSketch, App.getSketch, App.sketchFiles,
//           App.setSketchFiles, App.claimSketch, App.addSketch, App.ensureSketch, App.dropSketch, App.pruneSketches
// ─────────────────────────────────────────────────────────────

(function (App) {

  const KEY = 'surge_sketches';
  const OLD_KEY = 'surge_sketch';       // one sketch, before there were files
  const NAME_RE = /^[\w\-. ]{1,40}$/;
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

  const SKELETON = `void setup() {
}

void loop() {
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

    const tabList = view.querySelector('.code-tab-list');
    const usedBy = document.getElementById('code-used-by');

    // ── The files ────────────────────────────────────────────
    let files = [], active = 0;
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (saved && Array.isArray(saved.files)) {
        files = saved.files.filter(f => f && NAME_RE.test(f.name) && typeof f.code === 'string');
        active = Math.min(Math.max(saved.active | 0, 0), files.length - 1);
      } else {
        const old = localStorage.getItem(OLD_KEY);
        if (old != null) files = [{ name: 'sketch.ino', code: old }];
      }
    } catch {}
    if (!files.length) { files = [{ name: 'sketch.ino', code: STARTER }]; active = 0; }

    const find = name => files.find(f => f.name === name);
    const esp32s = () => (App.state ? App.state.components.filter(c => c.type === 'esp32') : []);
    const sketchOf = c => c.values && c.values.sketch;

    function nextName() {
      if (!find('sketch.ino')) return 'sketch.ino';
      for (let n = 2; ; n++) if (!find(`sketch_${n}.ino`)) return `sketch_${n}.ino`;
    }

    let lineCount = 0;
    function select(index) {
      active = Math.min(Math.max(index, 0), files.length - 1);
      input.value = files[active].code;
      input.setSelectionRange(0, 0);
      input.scrollTop = input.scrollLeft = 0;
      renderTabs();
      render();
    }

    function renderTabs() {
      tabList.replaceChildren();
      files.forEach((file, i) => {
        const tab = document.createElement('div');
        tab.className = 'code-tab' + (i === active ? ' on' : '');
        tab.setAttribute('role', 'tab');
        tab.tabIndex = 0;
        const label = document.createElement('span');
        label.textContent = file.name;
        tab.append(label);
        tab.addEventListener('click', () => { if (i !== active) select(i); });
        tab.addEventListener('dblclick', () => rename(tab, label, i));
        tabList.append(tab);
      });
      const ids = App.componentIds ? App.componentIds() : [];
      const using = esp32s().filter(c => sketchOf(c) === files[active].name)
        .map(c => ids[App.state.components.indexOf(c)]).filter(Boolean);
      usedBy.textContent = using.length ? 'Runs on ' + using.join(', ') : 'Not used by an ESP32';
    }

    // Deleted files wait here, so undoing the deletion of an ESP32 brings its code back.
    const trash = new Map();

    function remove(i) {
      trash.set(files[i].name, files[i].code);
      files.splice(i, 1);
      // The editor always has a file. This stand-in gives way if the deleted one comes back.
      if (!files.length) files.push({ name: 'sketch.ino', code: STARTER, fallback: true });
      persist();
      select(i === active ? Math.max(0, i - 1) : (i < active ? active - 1 : active));
    }

    // Double-click a tab to rename it in place.
    function rename(tab, label, i) {
      const old = files[i].name;
      const field = document.createElement('input');
      field.className = 'code-tab-input';
      field.value = old;
      field.maxLength = 40;
      field.spellcheck = false;
      label.replaceWith(field);
      field.focus();
      field.select();
      let done = false;
      const finish = commit => {
        if (done) return;
        done = true;
        if (commit) {
          let next = field.value.trim();
          if (next && !/\.\w+$/.test(next)) next += '.ino';
          if (next !== old && NAME_RE.test(next) && !find(next)) App.renameSketch(old, next);
        }
        renderTabs();
      };
      field.addEventListener('keydown', e => {
        if (e.key === 'Enter') finish(true);
        else if (e.key === 'Escape') finish(false);
        e.stopPropagation();
      });
      field.addEventListener('blur', () => finish(true));
    }

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
      _saveTimer = setTimeout(() => {
        try { localStorage.setItem(KEY, JSON.stringify({ files, active })); } catch {}
      }, 400);
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

    input.addEventListener('input', () => { delete files[active].fallback; files[active].code = input.value; render(); persist(); });
    input.addEventListener('scroll', syncScroll);
    ['keyup', 'click', 'select'].forEach(ev => input.addEventListener(ev, updatePos));
    document.addEventListener('selectionchange', () => { if (document.activeElement === input) updatePos(); });

    // ── Board / Code switch ──────────────────────────────────
    const buttons = document.querySelectorAll('.mode-btn[data-view]');
    App.setView = function (name) {
      const showCode = name === 'code';
      app.classList.toggle('view-code', showCode);
      view.hidden = !showCode;
      buttons.forEach(b => b.classList.toggle('active', b.dataset.view === name));
      if (showCode) { renderTabs(); render(); input.focus(); }
    };
    buttons.forEach(b => b.addEventListener('click', () => App.setView(b.dataset.view)));

    // ── Files, for the rest of the editor ────────────────────
    // The text of a file by name, or of the open one with no name.
    App.getSketch = name => name === undefined ? files[active].code : (find(name) ? find(name).code : '');
    App.hasSketch = name => !!find(name);
    App.sketchFiles = () => files.map(f => ({ name: f.name, code: f.code }));

    // The AI's edit: replace one file's text. The open file refreshes in place.
    App.writeSketch = function (name, code) {
      const file = find(name);
      if (!file) return false;
      file.code = code;
      delete file.fallback;
      persist();
      if (files[active] === file) { input.value = code; render(); }
      return true;
    };

    // A file with this name that was just deleted comes back with its text.
    App.addSketch = function (name, code) {
      if (code == null && name && trash.has(name)) { code = trash.get(name); trash.delete(name); }
      const file = { name: name || nextName(), code: code != null ? code : (files.length ? SKELETON : STARTER) };
      files.push(file);
      persist();
      renderTabs();
      return file.name;
    };

    // Replace every file, as when a circuit is opened.
    App.setSketchFiles = function (list) {
      const next = (list || []).filter(f => f && NAME_RE.test(f.name) && typeof f.code === 'string');
      if (!next.length) return;
      files = next.map(f => ({ name: f.name, code: f.code }));
      persist();
      select(0);
    };

    // The file for an ESP32 that has none yet: one no other ESP32 runs, else a new one.
    App.claimSketch = function () {
      const taken = new Set(esp32s().map(sketchOf));
      const free = files.find(f => !taken.has(f.name));
      return free ? free.name : App.addSketch();
    };

    // Make sure a file exists for an ESP32 that is being put back (undo, redo, or
    // opening a circuit): a deleted one returns with its text.
    App.ensureSketch = function (name) {
      const file = find(name);
      if (file && !(file.fallback && trash.has(name))) return;
      if (!file) { App.addSketch(name); return; }
      file.code = trash.get(name);
      delete file.fallback;
      trash.delete(name);
      persist();
      if (files[active] === file) select(active); else renderTabs();
    };

    // Files exist only for ESP32s: drop any that no ESP32 runs, always leaving one
    // to look at. Call it once a circuit's parts are on the board.
    App.pruneSketches = function () {
      const used = new Set(esp32s().map(sketchOf));
      const keep = used.size ? null : files[0];
      files.filter(f => !used.has(f.name) && f !== keep).forEach(f => App.dropSketch(f.name));
    };

    // Delete a file by name, as when the ESP32 that ran it is deleted.
    App.dropSketch = function (name) {
      const i = files.findIndex(f => f.name === name);
      if (i >= 0) remove(i);
    };

    App.renameSketch = function (old, next) {
      const file = find(old);
      if (!file || find(next) || !NAME_RE.test(next)) return false;
      file.name = next;
      esp32s().forEach(c => { if (sketchOf(c) === old) c.values.sketch = next; });
      persist();
      if (App.scheduleAutoSave) App.scheduleAutoSave();
      renderTabs();
      return true;
    };

    // Open the Code view on a file.
    App.openSketch = function (name) {
      const i = files.findIndex(f => f.name === name);
      if (i >= 0) select(i);
      App.setView('code');
    };

    // The tabs show which files are in use, so redraw them when the board changes.
    App.refreshSketchTabs = () => { if (!view.hidden) renderTabs(); };

    select(active);
  });

})(window.App = window.App || {});
