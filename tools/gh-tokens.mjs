#!/usr/bin/env node
// Pull the colour and font tokens GitHub actually serves for the profile page, so the preview
// canvas is measured rather than remembered. Cached; refetch with --refresh.
//
//   node tools/gh-tokens.mjs [--refresh]

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, 'tmp', 'gh-tokens.json');
const URL = 'https://github.com/Calfredo23';

const KEYS = [
  '--bgColor-default', '--bgColor-inset', '--bgColor-muted',
  '--fgColor-default', '--fgColor-muted', '--fgColor-link', '--fgColor-onEmphasis',
  '--borderColor-default', '--borderColor-muted',
  '--fontStack-system', '--text-size-medium',
];

if (existsSync(CACHE) && !process.argv.includes('--refresh')) {
  console.log('  cached', CACHE);
  console.log(JSON.stringify(JSON.parse(await readFile(CACHE, 'utf8')), null, 1));
  process.exit(0);
}

const html = await (await fetch(URL, {
  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36' },
})).text();

const out = { _source: URL, _fetched: new Date().toISOString(), _bytes: html.length };
for (const k of KEYS) {
  const re = new RegExp(k.replace(/[-[\]{}()*+?.,\\^$|#]/g, '\\$&') + '\\s*:\\s*([^;}]+)');
  const m = re.exec(html);
  if (m) out[k] = m[1].trim();
}
// The profile README column width is set by the page grid, not by us — grab whatever max-width
// GitHub puts on the markdown container so the preview scales like the real thing.
const grid = /class="[^"]*col-12[^"]*"/.exec(html)?.[0];
if (grid) out._gridClass = grid;

await mkdir(path.dirname(CACHE), { recursive: true });
await writeFile(CACHE, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
