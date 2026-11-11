// Minimal Chrome DevTools Protocol driver (Node 22: global fetch and WebSocket, no dependency).
// The Chrome binary comes from IDAUTO_PDF_CHROME; set LD_LIBRARY_PATH yourself if the host needs it.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch() {
  const bin = process.env.IDAUTO_PDF_CHROME;
  if (!bin) throw new Error('set IDAUTO_PDF_CHROME to a Chrome or chrome-headless-shell binary');
  const port = 9400 + Math.floor(Math.random() * 400);
  const profile = mkdtempSync(join(tmpdir(), 'idauto-pdf-'));
  const proc = spawn(bin, ['--headless', '--no-sandbox', '--disable-gpu', '--allow-file-access-from-files',
    '--remote-debugging-port=' + port, '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 80 && !targets; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { await sleep(250); }
  }
  if (!targets) { proc.kill('SIGKILL'); throw new Error('Chrome did not start'); }
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pending = new Map(); const waiters = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
    else if (d.method) for (const w of waiters.splice(0)) w(d);
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const i = ++id; pending.set(i, (d) => (d.error ? reject(new Error(method + ': ' + d.error.message)) : resolve(d.result)));
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const page = {
    send,
    async goto(url) {
      await send('Page.enable');
      const loaded = new Promise((r) => { const f = (d) => (d.method === 'Page.loadEventFired' ? r() : waiters.push(f)); waiters.push(f); });
      await send('Page.navigate', { url }); await loaded;
    },
    async eval(expression) {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error('page error: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
      return r.result.value;
    },
    async close() { try { ws.close(); } catch {} proc.kill('SIGKILL'); await sleep(300); rmSync(profile, { recursive: true, force: true }); },
  };
  return page;
}
