#!/usr/bin/env node
// Reference metrics for the generator's text layout.
//
//   node tools/fetch-fonts.mjs
//
// Writes tools/fonts/ref/<slug>.woff2 (a static, weight-materialized subset of every glyph the
// profile can ever use) and tools/fonts/ref/metrics.json (per-character advance in em).
// build.mjs lays text out from these numbers instead of estimating a character width, which is
// the only way a caption can be proven to clear a rule rather than hoped to.
//
// Why not the plain family URL: it serves ONE variable file per family, so 'Cabin 600' and
// 'Cabin 400' come back byte-identical and a declared weight would not be materialised.
// Measured: Cabin 'M' advance is 0.8120 em at 400 and 0.8255 em at 600. The css2 text= route
// returns a static instance per weight, so metrics here are the real ones.

import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const wawoff2 = require('wawoff2');
const fontkit = require('fontkit');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REF = path.join(HERE, 'fonts', 'ref');

// Mirrors the site: Chakra Petch 500 + 700 (BaseLayout.astro:41-50), Cabin 400 + 600,
// JetBrains Mono 400 + 500. The site declares JetBrains Mono but never loads it — a portfolio
// bug, reported separately; the profile embeds it properly.
export const FACES = [
  { slug: 'chakra-500', family: 'Chakra Petch', weight: 500 },
  { slug: 'chakra-700', family: 'Chakra Petch', weight: 700 },
  { slug: 'cabin-400', family: 'Cabin', weight: 400 },
  { slug: 'cabin-600', family: 'Cabin', weight: 600 },
  { slug: 'jbmono-400', family: 'JetBrains Mono', weight: 400 },
  { slug: 'jbmono-500', family: 'JetBrains Mono', weight: 500 },
];

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/120.0.0.0 Safari/537.36';

// Everything the copy can reach for: printable ASCII plus the typographic punctuation actually
// used (· – — “ ” →) and nothing else. Latin subset coverage, no CJK detour.
export const WORKING_CHARS =
  ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`' +
  'abcdefghijklmnopqrstuvwxyz{|}~·–—‘’“”→';

await mkdir(REF, { recursive: true });
const metrics = {};

for (const f of FACES) {
  const url =
    `https://fonts.googleapis.com/css2?family=${encodeURIComponent(f.family)}` +
    `:wght@${f.weight}&display=block&text=${encodeURIComponent(WORKING_CHARS)}`;
  const css = await (await fetch(url, { headers: { 'User-Agent': UA } })).text();
  const src = /src:\s*url\(([^)]+)\)/.exec(css)?.[1];
  if (!src) throw new Error(`css2 returned no src for ${f.family} ${f.weight}`);
  const woff = Buffer.from(await (await fetch(src)).arrayBuffer());
  const ttf = Buffer.from(await wawoff2.decompress(new Uint8Array(woff)));
  const font = fontkit.create(ttf);
  const upem = font.unitsPerEm;

  if (Object.keys(font.variationAxes || {}).length) {
    throw new Error(`${f.family} ${f.weight} came back variable — weight would not be materialised`);
  }
  const missing = [...WORKING_CHARS].filter((c) => c !== ' ' && !font.glyphForCodePoint(c.codePointAt(0)));

  const adv = {};
  for (const ch of WORKING_CHARS) {
    const g = font.layout(ch).glyphs[0];
    adv[ch] = Math.round(((g ? g.advanceWidth : 0) / upem) * 1e4) / 1e4;
  }
  metrics[f.slug] = {
    family: f.family, weight: f.weight, file: `${f.slug}.woff2`, upem,
    embeddedBytes: woff.length,
    capHeight: Math.round(((font.capHeight ?? font.ascent * 0.72) / upem) * 1e4) / 1e4,
    fallback: Math.max(...Object.values(adv)),
    missing,
    advance: adv,
  };
  await writeFile(path.join(REF, `${f.slug}.woff2`), woff);
  console.log(
    `  ${f.slug.padEnd(12)} ${(woff.length / 1024).toFixed(2).padStart(6)} KB static · ` +
    `cap ${metrics[f.slug].capHeight.toFixed(3)} · missing ${missing.length ? missing.join('') : 'none'}`
  );
}

await writeFile(path.join(REF, 'metrics.json'), JSON.stringify(metrics, null, 1));
console.log(`\n  6 faces · ref/metrics.json written\n`);
