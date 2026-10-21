// cdp.mjs — real-time screenshot capture over the DevTools protocol.
// Chrome's `--screenshot` CLI runs on virtual time, which freezes every CSS/SMIL animation
// clock at t=0 (measured: a plain div control with no font or network dependency stayed at its
// start keyframe under --screenshot, while the SVGs beside it did too).
// Hosted cards animate in, so a CLI screenshot of them is a false negative. This attaches to
// a live debugger and shoots at a real wall-clock offset.
//
//   import { capture } from './cdp.mjs';
//   await capture({ page, out, width, height, settle: 1200 });

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME_BIN || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function launchChrome() {
  const udd = path.join(HERE, 'tmp', 'udd');
  fs.rmSync(udd, { recursive: true, force: true });
  const proc = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--force-device-scale-factor=1', '--remote-debugging-port=0',
    '--allow-file-access-from-files', `--user-data-dir=${udd}`,
    '--window-size=800,600', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  return new Promise((res, rej) => {
    let buf = '';
    proc.stderr.on('data', (d) => {
      buf += d.toString();
      const m = buf.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (m) res({ proc, wsUrl: m[1] });
    });
    proc.on('exit', (code) => rej(new Error('chrome exited ' + code + '\n' + buf)));
    setTimeout(() => rej(new Error('no devtools ws url:\n' + buf)), 20000);
  });
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = [];
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) { this.pending.get(m.id)(m); this.pending.delete(m.id); }
      for (const l of this.listeners) l(m);
    });
  }
  send(method, params = {}, sessionId) {
    return new Promise((res, rej) => {
      const id = ++this.id;
      this.pending.set(id, (m) => m.error
        ? rej(new Error(method + ': ' + JSON.stringify(m.error)))
        : res(m.result));
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId && { sessionId }) }));
    });
  }
  waitEvent(method, sessionId, timeout = 30000) {
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('timeout waiting ' + method)), timeout);
      const l = (m) => {
        if (m.method === method && (!sessionId || m.sessionId === sessionId)) {
          clearTimeout(t);
          this.listeners = this.listeners.filter((x) => x !== l);
          res(m);
        }
      };
      this.listeners.push(l);
    });
  }
}

let server = null;

// One capture: load `page` (a file path), wait for load + `settle` ms of real time, shoot.
// `full` paints past the viewport, so a tall document needs no height guess and no trim pass.
export async function capture({ page, out, width, height, settle = 800, full = false, clip = null, shots = null }) {
  if (!server) {
    const s = await launchChrome();
    const ws = new WebSocket(s.wsUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    s.ws = ws;
    s.cdp = new CDP(ws);
    server = s;
  }
  const { cdp } = server;
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Emulation.setDeviceMetricsOverride',
    { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
  const url = 'file:///' + path.resolve(page).split(path.sep).join('/');
  const load = cdp.waitEvent('Page.loadEventFired', sessionId);
  await cdp.send('Page.navigate', { url }, sessionId);
  await load;
  const t0 = Date.now();
  const marks = shots || [{ tag: path.basename(out, '.png'), at: settle, file: out }];
  const written = [];
  for (const s of marks) {
    const wait = s.at - (Date.now() - t0);
    if (wait > 0) await sleep(wait);
    const args = { format: 'png', ...(full && { captureBeyondViewport: true }) };
    if (s.clip || clip) args.clip = { ...(clip || {}), ...(s.clip || {}), scale: 1 };
    const { data } = await cdp.send('Page.captureScreenshot', args, sessionId);
    const file = s.file || path.join(path.dirname(out), `${s.tag}.png`);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    written.push(file);
  }
  if (!marks.length) {
    const { result } = await cdp.send('Runtime.evaluate', {
      expression: 'JSON.stringify({h:document.documentElement.scrollHeight,w:document.documentElement.scrollWidth})',
      returnByValue: true,
    }, sessionId);
    await cdp.send('Target.closeTarget', { targetId });
    return JSON.parse(result.value);
  }
  await cdp.send('Target.closeTarget', { targetId });
  return written;
}

// Content box of a page, so a slice pass knows how tall to cut.
export async function measure(page, width) {
  return capture({ page, out: '', width, height: 1000, shots: [] });
}

export async function close() {
  if (!server) return;
  server.ws.close();
  server.proc.kill();
  server = null;
}
