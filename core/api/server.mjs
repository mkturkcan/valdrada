// The API's TCP half for a core process: the framing and routing of server/main.js (the Electron host) without a page.
// Clients speak docs/api/protocol.md:
//
//   [u32 big-endian length N][u8 kind][N-1 payload bytes]      kind 1 = JSON (UTF-8), kind 2 = binary blob
//
// Requests are {id, method, params}; answers {id, result} or {id, error: {code, message}}, in order per connection.
// server.status and server.ping are answered here (they work while the world is still loading); every other request
// waits for ready and then goes to the session (core/api/session.mjs), whose answers and events come back through
// send(cid, ...). A client that goes away is reported to the session (its sensors stop, its actors stay).
import net from 'node:net';

export const SERVER_VERSION = '0.1.0';
const KIND_JSON = 1, KIND_BLOB = 2;

function frame(kind, payload) {
  const head = Buffer.alloc(5);
  head.writeUInt32BE(payload.length + 1, 0);
  head[4] = kind;
  return [head, payload];
}

export function startServer({ port = 2000, host = '127.0.0.1', log = () => {}, verbose = false } = {}) {
  const clients = new Map();     // cid -> socket
  const queue = [];              // requests that arrived before ready
  let seq = 0, ready = false, onRequest = null, onDisconnect = null;
  const t0 = Date.now();
  function send(cid, obj, blobs = []) {
    const sock = clients.get(cid);
    if (!sock || sock.destroyed) return;
    const js = Buffer.from(JSON.stringify(blobs.length ? { ...obj, blobs: blobs.length } : obj), 'utf8');
    for (const b of frame(KIND_JSON, js)) sock.write(b);
    for (const blob of blobs) {
      const buf = Buffer.isBuffer(blob) ? blob : Buffer.from(blob.buffer ? blob.buffer : blob, blob.byteOffset || 0, blob.byteLength);
      for (const b of frame(KIND_BLOB, buf)) sock.write(b);
    }
  }
  function handle(cid, msg) {
    if (verbose) log(`#${cid} ->`, msg.method);
    if (typeof msg.method !== 'string') return send(cid, { id: msg.id ?? null, error: { code: 'bad_request', message: 'missing method' } });
    if (msg.method === 'server.status') return send(cid, { id: msg.id, result: { ready, server_version: SERVER_VERSION, uptime: (Date.now() - t0) / 1000, clients: clients.size } });
    if (msg.method === 'server.ping') return send(cid, { id: msg.id, result: 'pong' });
    if (!ready || !onRequest) { queue.push([cid, msg]); return; }
    onRequest(cid, msg);
  }
  const srv = net.createServer((sock) => {
    const cid = ++seq;
    clients.set(cid, sock);
    sock.setNoDelay(true);
    log(`client #${cid} connected from ${sock.remoteAddress}:${sock.remotePort}`);
    // incoming bytes as a list of chunks, joined once a whole frame is there (a renderer's image arrives in hundreds of
    // chunks; joining at every chunk copied it quadratically)
    const chunks = [];
    let have = 0;
    const take = (n) => {
      const out = Buffer.allocUnsafe(n);
      for (let o = 0; o < n;) {
        const c = chunks[0], k = Math.min(c.length, n - o);
        c.copy(out, o, 0, k); o += k;
        if (k === c.length) chunks.shift(); else chunks[0] = c.subarray(k);
      }
      have -= n;
      return out;
    };
    const head = () => { if (chunks[0].length < 5) { const b = take(have >= 5 ? 5 : have); chunks.unshift(b); have += b.length; } return chunks[0]; };
    // a request with `blobs: n` (a renderer client's render.result, docs/specs/render-protocol.md) is handled once its n
    // binary frames have arrived; they reach the session as msg._blobs
    let open = null;
    sock.on('data', (chunk) => {
      chunks.push(chunk); have += chunk.length;
      while (have >= 5) {
        const n = head().readUInt32BE(0);
        if (n < 1 || n > 1024 * 1024 * 1024) { sock.destroy(new Error('bad frame length')); return; }
        if (have < 4 + n) break;
        const fr = take(4 + n);
        const kind = fr[4], payload = fr.subarray(5);
        if (kind === KIND_BLOB) {
          if (!open) continue;   // a blob nobody announced
          open._blobs.push(payload);
          if (open._blobs.length >= open.blobs) { const m = open; open = null; handle(cid, m); }
          continue;
        }
        if (kind !== KIND_JSON) continue;
        let msg;
        try { msg = JSON.parse(payload.toString('utf8')); } catch { send(cid, { id: null, error: { code: 'bad_json', message: 'request is not JSON' } }); continue; }
        if ((msg.blobs | 0) > 0) { msg._blobs = []; open = msg; continue; }
        handle(cid, msg);
      }
    });
    const bye = () => {
      if (!clients.has(cid)) return;
      clients.delete(cid);
      log(`client #${cid} disconnected`);
      if (onDisconnect) onDisconnect(cid);
    };
    sock.on('close', bye);
    sock.on('error', bye);
  });
  const listening = new Promise((res, rej) => {
    srv.on('error', rej);
    srv.listen(port, host, () => { log(`listening on ${host}:${port}`); res(); });
  });
  return {
    listening, send, clients,
    // the session: its request handler and disconnect hook; ready flushes the requests that waited
    attach(handler, disconnect) { onRequest = handler; onDisconnect = disconnect; },
    setReady() {
      ready = true;
      while (queue.length) { const [cid, msg] = queue.shift(); if (clients.has(cid)) onRequest(cid, msg); }
    },
    close() { for (const s of clients.values()) s.destroy(); return new Promise((r) => srv.close(() => r())); },
  };
}
