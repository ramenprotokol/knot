// Builds dist/ from a clean clone: bundles the TypeScript (three.js included) and the CSS (with
// its fonts) under content-hashed names, copies the static files, and writes THIRD-PARTY-NOTICES.txt.
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
  // Fonts referenced from the stylesheet are copied into assets/ under content-hashed names.
  loader: { '.woff2': 'file' },
  outdir: join(dist, 'assets'),
  entryNames: '[name]-[hash]',
  assetNames: '[name]-[hash]',
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

// The self-hosted fonts: each family's licence file (src/fonts/*-OFL.txt, as published with the
// family in github.com/google/fonts) and the files that ship, by source stem. The build fails on a
// font in dist/ that is not listed here, or a listed one that did not ship.
const FONTS = [
  {
    family: 'Barlow Condensed',
    version: '1.408',
    licence: 'barlow-condensed-OFL.txt',
    source: 'https://github.com/jpt/barlow (files as served by https://fonts.google.com/specimen/Barlow+Condensed)',
    files: { 'barlow-condensed-500': 'Medium 500, Latin', 'barlow-condensed-600': 'SemiBold 600, Latin', 'barlow-condensed-700': 'Bold 700, Latin' },
  },
  {
    family: 'IBM Plex Mono',
    version: '2.3',
    licence: 'ibm-plex-mono-OFL.txt',
    embedded: 'Copyright 2017 IBM Corp. All rights reserved.',
    source: 'https://github.com/IBM/plex (files as served by https://fonts.google.com/specimen/IBM+Plex+Mono)',
    files: { 'ibm-plex-mono-400': 'Regular 400, Latin', 'ibm-plex-mono-500': 'Medium 500, Latin' },
  },
  {
    family: 'Source Serif 4',
    version: '4.004',
    licence: 'source-serif-4-OFL.txt',
    embedded: '© 2014 - 2021 Adobe Systems Incorporated (http://www.adobe.com/), with Reserved Font Name ‘Source’.',
    source: 'https://github.com/adobe-fonts/source-serif (files as served by https://fonts.google.com/specimen/Source+Serif+4)',
    files: {
      'source-serif-4-roman-latin': 'Roman, variable: wght 200-900, opsz 8-60; Latin',
      'source-serif-4-roman-latin-ext': 'Roman, variable: wght 200-900, opsz 8-60; Latin Extended',
      'source-serif-4-roman-greek': 'Roman, variable: wght 200-900, opsz 8-60; Greek',
      'source-serif-4-italic-latin': 'Italic 400, variable: opsz 8-60; Latin',
      'source-serif-4-italic-greek': 'Italic 400, variable: opsz 8-60; Greek',
    },
  },
];
const fontOutputs = outputs.filter((p) => /\.(woff2?|ttf|otf|eot)$/i.test(p));
const shipped = new Set();
const OFL_START = /^-+\nSIL OPEN FONT LICENSE Version 1\.1/m;
/** The licence body from the "SIL OPEN FONT LICENSE" banner on, with trailing spaces trimmed. */
const oflBody = (text) => text.slice(text.search(OFL_START)).split('\n').map((l) => l.trimEnd()).join('\n').trim();
let oflText = null;
const fontSections = [];
for (const font of FONTS) {
  const licence = (await readFile(join(root, 'src/fonts', font.licence), 'utf8')).replace(/\r\n/g, '\n');
  const copyright = licence.slice(0, licence.indexOf('This Font Software is licensed')).trim();
  if (!/^Copyright/.test(copyright) || licence.search(OFL_START) < 0) throw new Error(`build: src/fonts/${font.licence} is not an OFL 1.1 licence file`);
  // Every family uses the same OFL 1.1 text (only the FAQ link above it differs), so it is printed once.
  oflText ??= oflBody(licence);
  if (oflBody(licence) !== oflText) throw new Error(`build: src/fonts/${font.licence} differs from the OFL 1.1 text printed in the notices`);
  const lines = [`${font.family} ${font.version}`, `  ${copyright}`];
  if (font.embedded) lines.push(`  (copyright notice in the font files: ${font.embedded})`);
  lines.push(`  Licence: SIL Open Font License 1.1 (text below)`, `  Source: ${font.source}`);
  for (const [stem, what] of Object.entries(font.files)) {
    const file = fontOutputs.find((p) => new RegExp(`^assets/${stem}-[A-Z0-9]{8}\\.woff2$`).test(p));
    if (!file) throw new Error(`build: font ${stem} is not in dist/assets (is it referenced from src/styles.css?)`);
    shipped.add(file);
    lines.push(`  Ships: ${file} (${what})`);
  }
  fontSections.push(lines.join('\n'));
}
const unknownFonts = fontOutputs.filter((p) => !shipped.has(p));
if (unknownFonts.length) throw new Error(`build: font files without a notices entry: ${unknownFonts.join(', ')}`);

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
Fonts (served from this site; SIL Open Font License 1.1)
-------------------------------------------------------------------------------
The WOFF2 files are the ones Google Fonts serves for these families, unmodified: the
Latin subset of each face, plus the Latin Extended and Greek subsets of Source Serif 4
(the working uses those letters). They are copied into assets/ under content-hashed
names, so opening the page sends nothing to a font service.

${fontSections.join('\n\n')}

-------------------------------------------------------------------------------
SIL Open Font License 1.1 (applies to each font family above)
-------------------------------------------------------------------------------
The licence text, as it appears in each family's OFL.txt below its copyright line:

${oflText}

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
for (const p of [js, css, boot, ...fontOutputs, 'index.html', 'THIRD-PARTY-NOTICES.txt']) sizes.push(`${p} ${((await stat(join(dist, p))).size / 1024).toFixed(1)} KiB`);
console.log(`dist/ ready:\n  ${sizes.join('\n  ')}`);
