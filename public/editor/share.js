(function(root) {
  const MAX_BYTES = 1024 * 1024;
  const MAX_LINK = 64000;
  const PREFIX = '#circuit=v1.';

  async function bytesFrom(stream) {
    const reader = stream.getReader();
    const chunks = [];
    let length = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > MAX_BYTES) throw new Error('This circuit is too large for a share link. Use Download instead.');
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
  }

  async function createLink(data, address) {
    const circuit = root.WorkbenchFiles.validate(data);
    // A shared circuit is an independent copy. Leave browser IDs and thumbnails out.
    delete circuit.id;
    delete circuit.thumbnail;
    const json = new TextEncoder().encode(JSON.stringify(circuit));
    if (json.length > MAX_BYTES) throw new Error('This circuit is too large for a share link. Use Download instead.');
    const compressed = await bytesFrom(new Blob([json]).stream().pipeThrough(new CompressionStream('deflate')));
    let binary = '';
    for (const byte of compressed) binary += String.fromCharCode(byte);
    const encoded = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const url = new URL('app.html', address);
    url.hash = PREFIX + encoded;
    if (url.href.length > MAX_LINK) throw new Error('This circuit is too large for a share link. Use Download instead.');
    return url.href;
  }

  async function readLink(hash) {
    if (!hash.startsWith('#circuit=')) return null;
    if (!hash.startsWith(PREFIX) || hash.length > MAX_LINK) throw new Error('This circuit link is invalid or unsupported.');
    const encoded = hash.slice(PREFIX.length);
    if (!/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error('This circuit link is invalid.');
    try {
      const binary = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'));
      const compressed = Uint8Array.from(binary, c => c.charCodeAt(0));
      const bytes = await bytesFrom(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate')));
      const circuit = root.WorkbenchFiles.validate(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
      delete circuit.id;
      delete circuit.thumbnail;
      return circuit;
    } catch { throw new Error('This circuit link is invalid or too large.'); }
  }

  async function copyLink(link) {
    try { await navigator.clipboard.writeText(link); return true; } catch {}
    const input = document.createElement('textarea');
    input.value = link;
    input.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.append(input);
    input.select();
    try { return document.execCommand('copy'); }
    catch { return false; }
    finally { input.remove(); }
  }

  root.WorkbenchShare = { createLink, readLink, copyLink };
})(globalThis);
