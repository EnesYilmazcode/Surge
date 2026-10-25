// End-to-end checks for the editor, run in a real browser against the dev server.
// Run with: npm run test:e2e

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, startBrowser, openEditor, clickHole, holePoint, readout, ledLitWhileRunning, wait } from './harness.mjs';

// ESP32 pin indexes, in the order of App.ESP32_PINS
const PIN = { D2: 26, D5: 22, GND: 13 };

let server, browser;
before(async () => {
  server = await startServer();
  browser = await startBrowser();
}, { timeout: 180000 });
after(async () => {
  await browser?.close();
  server?.kill();
});

// A sensible starting circuit: an LED with its resistor on the lower rows, and an
// ESP32 far to the right. The ESP32's pad `padIndex` is wired to the resistor,
// and its GND pad to the LED's cathode.
async function buildLedCircuit(page, padIndex) {
  await page.evaluate(() => {
    const bb = App.state.breadboard;
    App.clearAll();
    App.placeESP32(bb.getHole(26, 'i'), bb.getHole(26, 'b'));
    App.placeLED(bb.getHole(6, 'h'), bb.getHole(4, 'h'));
    App.placeResistor(bb.getHole(0, 'j'), bb.getHole(4, 'j'));
  });
  await page.evaluate((padIndex) => {
    const bb = App.state.breadboard;
    const esp = App.state.components.find(c => c.type === 'esp32');
    const wire = (pad, col, row) => {
      const hole = bb.getHole(col, row);
      App.state.wireStart = { world: pad.userData.world.clone(), holeRef: null, pinMesh: pad };
      App.finishWire({ world: hole.world.clone(), holeRef: { col: hole.col, row: hole.row }, pinMesh: null });
    };
    wire(esp.pinMeshes[padIndex], 0, 'h');
    wire(esp.pinMeshes[13], 6, 'h');
  }, padIndex);
}

test('the parts list fits without a scroll bar and lists the parts we ship', async () => {
  const page = await openEditor(browser);
  const list = await page.evaluate(() => {
    const side = document.getElementById('sidebar');
    return {
      names: [...document.querySelectorAll('.comp-item-name')].map(n => n.textContent),
      overflows: side.scrollHeight > side.clientHeight,
    };
  });
  assert.deepEqual(list.names, ['Resistor', 'LED', 'Battery', 'Buzzer', '7-segment display', 'Push button', 'ESP32', 'Wire']);
  assert.equal(list.overflows, false);
  await page.close();
});

test('a part picked from the library lands on the hole under the pointer', async () => {
  const page = await openEditor(browser);
  await page.click('.comp-item[data-type="resistor"]');
  await wait(200);
  await clickHole(page, 10, 'f');
  const types = await page.evaluate(() => App.state.components.map(c => c.type));
  assert.deepEqual(types, ['resistor']);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('the 7-segment display places from the library and is marked as not simulated', async () => {
  const page = await openEditor(browser);
  await page.click('.comp-item[data-type="seg7"]');
  await wait(200);
  await clickHole(page, 12, 'e');
  const types = await page.evaluate(() => App.state.components.map(c => c.type));
  assert.deepEqual(types, ['seg7']);
  await page.evaluate(() => App.runSimulation());
  await wait(800);
  assert.match(await readout(page), /7-segment display: placed on the board, not simulated yet/);
  await page.close();
});

test('Escape clears the selection highlight and the picked part', async () => {
  const page = await openEditor(browser);
  await page.evaluate(() => {
    const bb = App.state.breadboard;
    App.placeResistor(bb.getHole(2, 'f'), bb.getHole(6, 'f'));
    App.selectItem(App.state.components[0], 'component');
  });
  const highlighted = () => page.evaluate(() => {
    let n = 0;
    App.state.components[0].group.traverse(o => { if (o.isMesh && o.userData._baseMat) n++; });
    return n;
  });
  assert.ok(await highlighted() > 0, 'the part is highlighted before Escape');
  await page.keyboard.press('Escape');
  await wait(200);
  assert.equal(await highlighted(), 0);
  assert.equal(await page.evaluate(() => App.state.selected), null);
  await page.close();
});

test('the dock is the name, the resistor slider and a trash icon, and the slider snaps to standard values', async () => {
  const page = await openEditor(browser);
  await page.evaluate(() => {
    const bb = App.state.breadboard;
    App.placeResistor(bb.getHole(2, 'f'), bb.getHole(6, 'f'));
    App.selectItem(App.state.components[0], 'component');
  });
  await wait(300);
  const dock = await page.evaluate(() => ({
    hasSlider: !!document.querySelector('#inspector input[type="range"]'),
    hasTrash: !!document.querySelector('#inspector .insp-delete'),
    hasClose: !!document.querySelector('#inspector .insp-close'),
    hasLocation: /→|·/.test(document.querySelector('#inspector .insp-id')?.textContent || ''),
  }));
  assert.deepEqual(dock, { hasSlider: true, hasTrash: true, hasClose: false, hasLocation: false });
  await page.evaluate(() => {
    const s = document.querySelector('#inspector input[type="range"]');
    s.value = 6;
    s.dispatchEvent(new Event('input'));
    s.dispatchEvent(new Event('change'));
  });
  await wait(200);
  assert.equal(await page.evaluate(() => App.state.components[0].values.resistance), 1000);
  await page.close();
});

test('a wire to the sketch pin D2 lights the LED', async () => {
  const page = await openEditor(browser);
  await buildLedCircuit(page, PIN.D2);
  assert.equal(await ledLitWhileRunning(page), true);
  await page.close();
});

test('a wire to an unused pin, D5, leaves the LED dark', async () => {
  const page = await openEditor(browser);
  await buildLedCircuit(page, PIN.D5);
  assert.equal(await ledLitWhileRunning(page), false);
  await page.close();
});

test('a saved circuit reloads with its pin wiring intact', async () => {
  const page = await openEditor(browser);
  await buildLedCircuit(page, PIN.D2);
  const saved = await page.evaluate(async () => {
    let blob = null;
    const createURL = URL.createObjectURL, click = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = b => { blob = b; return 'blob:e2e'; };
    HTMLAnchorElement.prototype.click = function () {};
    try { App.saveCircuit(); } finally { URL.createObjectURL = createURL; HTMLAnchorElement.prototype.click = click; }
    return blob ? await blob.text() : null;
  });
  assert.ok(saved, 'Save produced a file');
  await page.evaluate(text => { App.clearAll(); App.loadCircuitData(JSON.parse(text)); }, saved);
  assert.equal(await ledLitWhileRunning(page), true);
  await page.close();
});

test('the board export the chat sends works with the ESP32 and the display on it', async () => {
  const page = await openEditor(browser);
  await buildLedCircuit(page, PIN.D2);
  await page.evaluate(() => {
    const bb = App.state.breadboard;
    const fp = App.partFootprint('seg7', bb.getHole(12, 'e'), 0);
    App.placePart('seg7', fp.holes);
  });
  const result = await page.evaluate(() => {
    try {
      const board = App.exportBoard();
      const markdown = App.exportMarkdown();
      return { ok: true, types: board.components.map(c => c.type), markdown: markdown.length > 0 };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  assert.deepEqual(result, { ok: true, types: ['esp32', 'led', 'resistor', 'seg7'], markdown: true });
  await page.close();
});

test('the chat sends the sketch, proposes a code change and a value change, and Enter applies both', async () => {
  const page = await openEditor(browser);
  await buildLedCircuit(page, PIN.D2);
  const sketch = await page.evaluate(() => App.state.components.find(c => c.type === 'esp32').values.sketch);
  const code = 'const int LED_PIN = 2;\nvoid setup() { pinMode(LED_PIN, OUTPUT); }\nvoid loop() { digitalWrite(LED_PIN, HIGH); delay(100); digitalWrite(LED_PIN, LOW); delay(100); }\n';

  // Answer the chat with a fixed proposal, so the test does not depend on the model
  let sent = null;
  await page.setRequestInterception(true);
  page.on('request', request => {
    if (!request.url().includes('/api/surge/workbench')) return request.continue();
    sent = JSON.parse(request.postData());
    request.respond({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        reply: 'Blink faster, and use a 1 kΩ resistor.',
        actions: [
          { tool: 'write_sketch', file: sketch, code },
          { tool: 'set_value', id: 'resistor_0', resistance: 1000 },
        ],
      }),
    });
  });

  await page.type('#surge-input', 'Blink faster, and use a 1k resistor');
  await page.click('#surge-send');
  await page.waitForFunction(() => document.getElementById('surge-pending-bar').style.display === 'flex', { timeout: 20000 });

  assert.equal(await page.$eval('#surge-pending-count', el => el.textContent), '2 changes ready');
  assert.deepEqual(sent.board.sketches.map(s => s.name), [sketch], 'the sketch went to the model');
  assert.equal(await page.evaluate(() => App.getSketch(App.state.components.find(c => c.type === 'esp32').values.sketch)).then(t => t.includes('delay(500)')), true, 'the sketch is unchanged until Enter');

  await page.focus('#surge-input');
  await page.keyboard.press('Enter');
  await wait(500);

  assert.equal(await page.evaluate(name => App.getSketch(name), sketch), code);
  assert.equal(await page.evaluate(() => App.state.components.find(c => c.type === 'resistor').values.resistance), 1000);
  assert.equal(await page.$eval('#surge-pending-bar', el => el.style.display), 'none');
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('the chat places an ESP32 with its sketch, and wires a named pin to a hole', async () => {
  const page = await openEditor(browser);
  const code = 'const int LED_PIN = 2;\nvoid setup() { pinMode(LED_PIN, OUTPUT); }\nvoid loop() { digitalWrite(LED_PIN, HIGH); delay(250); digitalWrite(LED_PIN, LOW); delay(250); }\n';
  await page.setRequestInterception(true);
  page.on('request', request => {
    if (!request.url().includes('/api/surge/workbench')) return request.continue();
    request.respond({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        reply: 'Added an ESP32 that blinks D2, and wired D2 to b12.',
        actions: [
          { tool: 'place_esp32', holeA: 'i30', holeB: 'b30', code },
          { tool: 'connect_pin', pin: 'esp32_0_D2', to: 'b12', color: 'yellow' },
        ],
      }),
    });
  });
  await page.type('#surge-input', 'Add an ESP32 that blinks, and wire D2 to b12');
  await page.click('#surge-send');
  await page.waitForFunction(() => document.getElementById('surge-pending-bar').style.display === 'flex', { timeout: 20000 });
  assert.equal(await page.$eval('#surge-pending-count', el => el.textContent), '2 changes ready');
  await page.focus('#surge-input');
  await page.keyboard.press('Enter');
  await wait(600);

  const result = await page.evaluate(() => {
    const esp = App.state.components.find(c => c.type === 'esp32');
    const wire = App.state.wires[0];
    return {
      parts: App.state.components.map(c => c.type),
      sketch: esp ? App.getSketch(esp.values.sketch) : null,
      wires: App.state.wires.length,
      wireStartsAtD2: !!wire && wire.startComp === esp && wire.startPinIdx === 26,
      wireEndsAtHole: !!wire && App.formatHole(wire.endHole) === 'b12',
    };
  });
  assert.deepEqual(result.parts, ['esp32']);
  assert.equal(result.sketch, code);
  assert.equal(result.wires, 1);
  assert.equal(result.wireStartsAtD2, true);
  assert.equal(result.wireEndsAtHole, true);
  assert.deepEqual(page.errors, []);
  await page.close();
});
