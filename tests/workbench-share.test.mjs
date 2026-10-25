import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const context = vm.createContext({ Blob, CompressionStream, DecompressionStream, TextEncoder, TextDecoder, Uint8Array, URL, atob, btoa });
for (const module of ['project-format', 'share']) {
  vm.runInContext(readFileSync(new URL(`../public/editor/${module}.js`, import.meta.url), 'utf8'), context);
}
const { createLink, readLink } = context.WorkbenchShare;
const fixture = JSON.parse(readFileSync(new URL('../public/editor/demo.surge', import.meta.url), 'utf8'));

test('share links preserve a circuit and Unicode names without carrying browser identity or thumbnails', async () => {
  const data = { ...fixture, name: 'LED — 電路 🔌', id: 'local-project', thumbnail: 'data:image/jpeg;base64,YQ==' };
  const url = new URL(await createLink(data, 'https://surge.example/app.html?demo#old'));
  assert.equal(url.origin, 'https://surge.example');
  assert.equal(url.pathname, '/app.html');
  assert.equal(url.search, '');
  const restored = JSON.parse(JSON.stringify(await readLink(url.hash)));
  const expected = JSON.parse(JSON.stringify(context.WorkbenchFiles.validate(data)));
  delete expected.id;
  delete expected.thumbnail;
  assert.deepEqual(restored, expected);
  assert.ok(url.href.length < JSON.stringify(data).length);
});

test('ESP32 pins and sketch files survive sharing', async () => {
  const data = {
    name: 'ESP32 blink',
    components: [{ type: 'esp32', values: { sketch: 'blink.ino' }, holeRefs: Array.from({ length: 30 }, (_, i) => ({ row: i < 15 ? 'i' : 'b', col: i % 15 })) }],
    wires: [{ startCompIdx: 0, startPinIdx: 17, endHole: { row: 'a', col: 20 }, color: 0x22aa33 }],
    files: [{ name: 'blink.ino', code: 'void setup() { pinMode(2, OUTPUT); }\nvoid loop() { digitalWrite(2, HIGH); }' }],
  };
  const restored = await readLink(new URL(await createLink(data, 'http://localhost:5173/app.html')).hash);
  assert.equal(restored.files[0].code, data.files[0].code);
  assert.equal(restored.components[0].values.sketch, 'blink.ino');
  assert.equal(restored.wires[0].startPinIdx, 17);
  assert.equal(restored.wires[0].endHole.col, 20);
});

test('empty circuits work and unrelated hashes are ignored', async () => {
  const url = await createLink({ components: [], wires: [] }, 'https://surge.example/app.html');
  assert.equal((await readLink(new URL(url).hash)).components.length, 0);
  assert.equal(await readLink('#other'), null);
});

test('malformed, unsupported, and oversized payloads are rejected', async () => {
  for (const hash of ['#circuit=v2.abc', '#circuit=v1.', '#circuit=v1.bad!', '#circuit=v1.abc', '#circuit=v1.' + 'a'.repeat(64000)]) {
    await assert.rejects(readLink(hash), /invalid|unsupported/);
  }
  await assert.rejects(createLink({ components: [{ type: 'unknown' }], wires: [] }, 'https://surge.example'), /Unsupported/);
  const oversized = { components: [], wires: [], files: Array.from({ length: 12 }, (_, i) => ({ name: `sketch${i}.ino`, code: 'a'.repeat(100000) })) };
  await assert.rejects(createLink(oversized, 'https://surge.example'), /too large/);
  // A tiny compressed link must not bypass the uncompressed size limit.
  const compressed = new Uint8Array(await new Response(new Blob([JSON.stringify(oversized)]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
  const encoded = Buffer.from(compressed).toString('base64url');
  await assert.rejects(readLink('#circuit=v1.' + encoded), /too large/);
});
