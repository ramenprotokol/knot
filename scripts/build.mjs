// Builds dist/ from a clean clone: bundles the TypeScript (three.js included) with
// content-hashed names, copies the static files, and writes THIRD-PARTY-NOTICES.txt.
// Usage: npm run build
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');
const pub = join(root, 'public');

await rm(dist, { recursive: true, force: true });
await mkdir(join(dist, 'assets'), { recursive: true });

const result = await build({
  entryPoints: [join(root, 'src/app/main.ts')],
  bundle: true,
  format: 'esm',
  target: ['es2022', 'chrome100', 'safari16', 'firefox110'],
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  outdir: join(dist, 'assets'),
  entryNames: '[name]-[hash]',
  metafile: true,
  logLevel: 'warning',
});

const outputs = Object.keys(result.metafile.outputs).map((p) => relative(dist, join(root, p)).split('\\').join('/'));
const js = outputs.find((p) => p.endsWith('.js'));
const css = outputs.find((p) => p.endsWith('.css'));
if (!js || !css) throw new Error(`build: expected one .js and one .css output, got ${outputs.join(', ')}`);

// The tiny theme boot script is not bundled (it must run before first paint); hash it by hand.
const bootSrc = await readFile(join(pub, 'boot.js'));
const boot = `assets/boot-${createHash('sha256').update(bootSrc).digest('hex').slice(0, 8)}.js`;
await writeFile(join(dist, boot), bootSrc);

const html = (await readFile(join(pub, 'index.html'), 'utf8')).replace('%JS%', js).replace('%CSS%', css).replace('%BOOT%', boot);
if (/%(JS|CSS|BOOT)%/.test(html)) throw new Error('build: placeholders left in index.html');
await writeFile(join(dist, 'index.html'), html);

for (const name of await readdir(pub)) {
  if (name === 'index.html' || name === 'boot.js') continue;
  await copyFile(join(pub, name), join(dist, name));
}

// ---------- third-party notices ----------
const threePkg = JSON.parse(await readFile(join(root, 'node_modules/three/package.json'), 'utf8'));
const threeLicence = (await readFile(join(root, 'node_modules/three/LICENSE'), 'utf8')).trim();
const bundledThree = Object.keys(result.metafile.inputs).some((p) => p.includes('node_modules/three/'));
if (!bundledThree) throw new Error('build: expected three.js in the bundle');

const OFL_SUMMARY = `SIL Open Font License, Version 1.1 — https://openfontlicense.org/open-font-license-official-text/
The font is loaded by the visitor's browser from Google Fonts (fonts.googleapis.com /
fonts.gstatic.com); no font files are included in this site's files.`;

const notices = `THIRD-PARTY NOTICES — knot
===========================

This site bundles or uses the following third-party work. The site's own code is MIT
licensed (Copyright (c) 2026 ramenprotokol).

-------------------------------------------------------------------------------
three.js ${threePkg.version}
-------------------------------------------------------------------------------
Bundled (minified) into ${js}.
Source: https://github.com/mrdoob/three.js  (npm package "three", version ${threePkg.version})
Licence: ${threePkg.license}

${threeLicence}

-------------------------------------------------------------------------------
Fonts (loaded from Google Fonts at run time, not bundled)
-------------------------------------------------------------------------------
Barlow Condensed — Copyright 2017 The Barlow Project Authors
  https://github.com/jpt/barlow — ${OFL_SUMMARY}

Source Serif 4 — Copyright 2014-2021 Adobe (http://www.adobe.com/), with Reserved Font Name 'Source'
  https://github.com/adobe-fonts/source-serif — ${OFL_SUMMARY}

IBM Plex Mono — Copyright © 2017 IBM Corp. with Reserved Font Name "Plex"
  https://github.com/IBM/plex — ${OFL_SUMMARY}

-------------------------------------------------------------------------------
Knot table data
-------------------------------------------------------------------------------
The Alexander polynomials of the knots up to 7 crossings (and the three composite knots
listed) are mathematical facts, typed in by hand. No database files, tables or text were
copied into this site. Source:

  D. Rolfsen, Knots and Links, Publish or Perish (1976), Appendix C (the knot table),
    as reproduced in the Knot Atlas: https://katlas.org/wiki/The_Rolfsen_Knot_Table

See also (a standard reference; its data was not consulted for these values):

  C. Livingston and A. H. Moore, KnotInfo: Table of Knot Invariants, knotinfo.org,
    September 26, 2026 (citation in the form KnotInfo requests).

Neither the Knot Atlas nor KnotInfo publishes a licence for its data; both are cited here.
The project's unit tests (not part of this site) recompute every polynomial from the
Knot Atlas PD codes, which are quoted in the test file with attribution.
`;
await writeFile(join(dist, 'THIRD-PARTY-NOTICES.txt'), notices);

const sizes = [];
for (const p of [js, css, boot, 'index.html', 'THIRD-PARTY-NOTICES.txt']) sizes.push(`${p} ${((await stat(join(dist, p))).size / 1024).toFixed(1)} KiB`);
console.log(`dist/ ready:\n  ${sizes.join('\n  ')}`);
