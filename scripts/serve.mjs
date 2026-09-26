// A tiny static server for dist/ that applies public/_headers the way Cloudflare Pages does,
// so local runs get the production CSP and cache rules.
// Usage: npm run serve [-- --port 8123]   (default: a random free port)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
};

/** Parse a Cloudflare `_headers` file: a path pattern on its own line, then indented `Name: value` lines. */
export function parseHeaders(text) {
  const rules = [];
  let cur = null;
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      cur = { pattern: line.trim(), set: [] };
      rules.push(cur);
    } else if (cur) {
      const t = line.trim();
      const i = t.indexOf(':');
      cur.set.push([t.slice(0, i).trim().toLowerCase(), t.slice(i + 1).trim()]);
    }
  }
  return rules;
}

function matches(pattern, path) {
  if (pattern.endsWith('*')) return path.startsWith(pattern.slice(0, -1));
  return path === pattern;
}

/** Headers Cloudflare would send: all matching rules apply; repeated names are joined with ", ". */
export function headersFor(rules, path) {
  const out = {};
  for (const r of rules) {
    if (!matches(r.pattern, path)) continue;
    for (const [name, value] of r.set) out[name] = name in out ? `${out[name]}, ${value}` : value;
  }
  return out;
}

export async function startServer(dir, port = 0) {
  const rules = parseHeaders(await readFile(join(dir, '_headers'), 'utf8').catch(() => ''));
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      let path = decodeURIComponent(url.pathname);
      if (path.endsWith('/')) path += 'index.html';
      const file = normalize(join(dir, path));
      if (!file.startsWith(normalize(dir))) {
        res.writeHead(403).end();
        return;
      }
      const s = await stat(file).catch(() => null);
      if (!s || !s.isFile() || path.split('/').pop() === '_headers') {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
        return;
      }
      const headers = { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', ...headersFor(rules, url.pathname) };
      res.writeHead(200, headers).end(await readFile(file));
    } catch {
      res.writeHead(500).end();
    }
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const i = process.argv.indexOf('--port');
  const port = i > 0 ? Number(process.argv[i + 1]) : 0;
  const dir = fileURLToPath(new URL('../dist', import.meta.url));
  const server = await startServer(dir, port);
  console.log(`serving dist/ on http://127.0.0.1:${server.address().port}`);
}
