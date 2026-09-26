// Screenshots of the built site for visual review (desktop, dark, true 400 px phone).
// Usage: npm run shots -- <output-dir> [preset] [--full] [--working] [--relax]
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, sleep } from './cdp.mjs';
import { startServer } from './serve.mjs';

const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith('--')) ?? 'shots';
const preset = args.filter((a) => !a.startsWith('--'))[1] ?? null;
const full = args.includes('--full');
const working = args.includes('--working');
const relax = args.includes('--relax');
await mkdir(out, { recursive: true });

const server = await startServer(fileURLToPath(new URL('../dist', import.meta.url)), 0);
const base = `http://127.0.0.1:${server.address().port}/`;

const views = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'desktop-dark', width: 1280, height: 800, dark: true },
  { name: 'phone', width: 400, height: 860, mobile: true, deviceScaleFactor: 2 },
];

try {
  for (const v of views) {
    const b = await launch({ ...v, reducedMotion: true });
    try {
      await b.goto(base);
      if (preset) await b.click(`.preset[data-id="${preset}"]`);
      if (relax) {
        await b.click('#btn-relax');
        for (let i = 0; i < 100 && (await b.evaluate('window.__knot.summary().busy')); i++) await sleep(100);
      }
      if (working) await b.evaluate('document.getElementById("working").open = true');
      await sleep(900);
      const png = full ? await b.fullScreenshot() : await b.screenshot();
      const file = join(out, `${v.name}${preset ? `-${preset}` : ''}${relax ? '-relaxed' : ''}${full ? '-full' : ''}.png`);
      await writeFile(file, png);
      const scroll = await b.evaluate('[document.documentElement.scrollWidth, window.innerWidth]');
      console.log(file, 'scrollWidth/innerWidth', scroll.join('/'), b.problems.length ? `PROBLEMS: ${b.problems.join(' | ')}` : 'no console problems');
    } finally {
      await b.close();
    }
  }
} finally {
  server.close();
}
