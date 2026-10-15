#!/usr/bin/env node
// Font service for the generator.
//
// GitHub loads README images as an <img>, which isolates the SVG from the network — so a
// Google Fonts @import inside an asset does nothing (MEASURED: probe T1b) and every face
// has to be embedded. An embedded *full* latin face costs 10–22 KB, which blows the per-asset
// budget before a single path is drawn.
//
// So: ask Google's css2 API for the exact characters each asset uses. It answers with a
// STATIC, weight-materialized, glyph-subset woff2 — 1–2 KB, no local subsetter in the loop.
// MEASURED here, not assumed: Cabin 400 -> 'M' advance 0.8120 em, Cabin 600 -> 0.8255 em,
// Chakra Petch 500 -> 0.7850, 700 -> 0.8010. The plain family URL serves one variable file for
// every weight, so without the text= path a declared 600 would render at the default 400.
//
// Results are cached by sha1(family|weight|charset), so a rebuild is offline and byte-stable.
// The cache outlives every copy change, so it accumulates subsets no asset asks for any more.
// USED records what a build actually pulled; tools/prune-fonts.mjs reads it.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const wawoff2 = require('wawoff2');
const fontkit = require('fontkit');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, 'fonts', 'embed');

export const USED = new Set();

// UA that makes Google Fonts serve woff2 rather than ttf/eot.
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/120.0.0.0 Safari/537.36';

const slug = (family) => family.toLowerCase().replace(/[^a-z0-9]+/g, '');
const memo = new Map();

/**
 * @returns {Promise<{css:string, bytes:number, measure(str:string,size:number,trackingEm:number):number}>}
 */
export async function face(family, weight, charset) {
  const chars = [...new Set(charset.replace(/[\s]/g, ' ').split(''))]
    .filter((c) => c !== ' ')
    .sort()
    .join('');
  const key = createHash('sha1').update(`${family}|${weight}|${chars}`).digest('hex').slice(0, 16);
  const hit = memo.get(key);
  if (hit) return hit;

  await mkdir(CACHE, { recursive: true });
  const woffPath = path.join(CACHE, `${slug(family)}-${weight}-${key}.woff2`);
  const jsonPath = path.join(CACHE, `${slug(family)}-${weight}-${key}.json`);
  let woff, adv;

  if (existsSync(woffPath) && existsSync(jsonPath)) {
    woff = await readFile(woffPath);
    adv = JSON.parse(await readFile(jsonPath, 'utf8'));
  } else {
    const url =
      `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}` +
      `:wght@${weight}&display=block&text=${encodeURIComponent(chars)}`;
    const css = await (await fetch(url, { headers: { 'User-Agent': UA } })).text();
    const src = /src:\s*url\(([^)]+)\)/.exec(css)?.[1];
    if (!src) throw new Error(`css2 gave no src for ${family} ${weight} — charset too large?`);
    woff = Buffer.from(await (await fetch(src)).arrayBuffer());
    const ttf = Buffer.from(await wawoff2.decompress(new Uint8Array(woff)));
    const font = fontkit.create(ttf);
    const upem = font.unitsPerEm;
    adv = { upem, capHeight: round((font.capHeight ?? font.ascent * 0.72) / upem), a: {} };
    for (const ch of chars) adv.a[ch] = round(advanceOf(font, ch) / upem);
    adv.fallback = round(Math.max(...Object.values(adv.a)));
    await writeFile(woffPath, woff);
    await writeFile(jsonPath, JSON.stringify(adv));
  }

  const b64 = woff.toString('base64');
  USED.add(path.basename(woffPath));
  USED.add(path.basename(jsonPath));
  const out = {
    family, weight,
    bytes: woff.length,
    embedded: Buffer.byteLength(b64),
    css:
      `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};` +
      `src:url(data:font/woff2;base64,${b64}) format('woff2');}`,
    // Exact laid-out width: per-glyph advance plus letter-spacing after every glyph,
    // which is what Chrome does with the SVG letter-spacing attribute.
    measure(str, size, trackingEm = 0) {
      let em = 0;
      for (const ch of str) em += adv.a[ch] ?? (ch === ' ' ? spaceWidth(str, adv) : adv.fallback);
      return (em + trackingEm * [...str].length) * size;
    },
  };
  memo.set(key, out);
  return out;
}

function spaceWidth(str, adv) {
  // A space may fall outside the requested charset when it was never engraved; it is always
  // present in a Google subset, so its real advance is on the sheet.
  return adv.a[' '] ?? 0.25;
}

function advanceOf(font, ch) {
  const g = font.layout(ch).glyphs[0];
  return g ? g.advanceWidth : 0;
}

const round = (v) => Math.round(v * 1e4) / 1e4;
