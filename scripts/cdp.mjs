// A minimal Chrome DevTools Protocol driver (no dependencies): launch headless Chrome, emulate
// a device (true phone widths included), load a page, collect console errors, send mouse
// input and take screenshots. Used by the end-to-end tests and scripts/shots.mjs.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

export function findChrome() {
  return CANDIDATES.find((p) => existsSync(p)) ?? null;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ width = 1280, height = 800, deviceScaleFactor = 1, mobile = false, reducedMotion = false, dark = false } = {}) {
  const chrome = findChrome();
  if (!chrome) throw new Error('Chrome not found (set CHROME_PATH)');
  const profile = await mkdtemp(join(tmpdir(), 'knot-chrome-'));
  const proc = spawn(
    chrome,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--hide-scrollbars',
      '--mute-audio',
      '--enable-unsafe-swiftshader',
      '--use-angle=swiftshader',
      `--window-size=${Math.max(width, 500)},${height}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  proc.stderr.on('data', () => {});

  let port = null;
  for (let i = 0; i < 100 && !port; i++) {
    await sleep(100);
    const txt = await readFile(join(profile, 'DevToolsActivePort'), 'utf8').catch(() => null);
    if (txt) port = Number(txt.split('\n')[0]);
  }
  if (!port) {
    proc.kill();
    throw new Error('Chrome did not open a debugging port');
  }
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  let nextId = 1;
  const pending = new Map();
  const problems = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
      return;
    }
    if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'assert' || msg.params.type === 'warning')) {
      problems.push(`console.${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      problems.push(`exception: ${d.exception?.description ?? d.text}`);
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      problems.push(`log: ${msg.params.entry.text} ${msg.params.entry.url ?? ''}`.trim());
    }
  };

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor, mobile });
  if (mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  const features = [];
  if (reducedMotion) features.push({ name: 'prefers-reduced-motion', value: 'reduce' });
  features.push({ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' });
  await send('Emulation.setEmulatedMedia', { features });

  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };

  const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra });

  return {
    send,
    evaluate,
    problems,
    async goto(url, { readyTimeout = 30000 } = {}) {
      await send('Page.navigate', { url });
      const start = Date.now();
      while (Date.now() - start < readyTimeout) {
        await sleep(120);
        const status = await evaluate('document.documentElement.dataset.status || ""').catch(() => '');
        if (status === 'ready') return;
      }
      throw new Error(`page did not become ready within ${readyTimeout} ms`);
    },
    async click(selector) {
      const box = await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const r0 = e.getBoundingClientRect(); if (r0.top < 0 || r0.bottom > innerHeight) e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
      if (!box) throw new Error(`no element for ${selector}`);
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box[0], y: box[1] });
      await mouse('mousePressed', box[0], box[1]);
      await mouse('mouseReleased', box[0], box[1]);
    },
    /** Drag the mouse through a list of page coordinates. */
    async drag(points) {
      const [x0, y0] = points[0];
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0, y: y0 });
      await mouse('mousePressed', x0, y0);
      for (const [x, y] of points.slice(1)) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 });
      const [x1, y1] = points[points.length - 1];
      await mouse('mouseReleased', x1, y1);
    },
    async key(key, code = key) {
      const vk = { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Escape: 27, Tab: 9 }[key];
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: vk });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk });
    },
    async screenshot() {
      const r = await send('Page.captureScreenshot', { format: 'png' });
      return Buffer.from(r.data, 'base64');
    },
    async fullScreenshot() {
      const h = await evaluate('Math.ceil(document.documentElement.scrollHeight)');
      // Full pages are captured at 1× so very tall pages stay quick.
      await send('Emulation.setDeviceMetricsOverride', { width, height: h, deviceScaleFactor: 1, mobile });
      await sleep(400);
      const r = await send('Page.captureScreenshot', { format: 'png' });
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor, mobile });
      return Buffer.from(r.data, 'base64');
    },
    async close() {
      try {
        ws.close();
      } catch {
        /* already closed */
      }
      proc.kill();
      await sleep(200);
      await rm(profile, { recursive: true, force: true }).catch(() => {});
    },
  };
}
