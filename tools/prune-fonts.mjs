#!/usr/bin/env node
// Delete subset faces the generator no longer asks for.
//
//   node tools/prune-fonts.mjs [--dry]
//
// fonts.mjs caches every subset by sha1(family|weight|charset). That is the right key for a
// cache and the wrong key for a repo: change one word of the copy and the old face stays on
// disk looking load-bearing. build.mjs writes fonts/embed/used.json from the set actually
// pulled, so this is a diff against a real build rather than a guess from filenames.
//
// Refuses to run without a manifest — an absent one would justify deleting everything.

import { readFile, readdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(HERE, 'fonts', 'embed');
const MANIFEST = path.join(DIR, 'used.json');

if (!existsSync(MANIFEST)) {
  console.error('  no fonts/embed/used.json — run `node tools/build.mjs` first');
  process.exit(2);
}
const used = new Set(JSON.parse(await readFile(MANIFEST, 'utf8')));
const dry = process.argv.includes('--dry');

const files = (await readdir(DIR)).filter((f) => f !== 'used.json');
const stale = files.filter((f) => !used.has(f));
let bytes = 0;
for (const f of stale) {
  const size = Buffer.byteLength(await readFile(path.join(DIR, f)));
  bytes += size;
  console.log(`  ${dry ? 'would delete' : 'deleted      '} ${f}  (${size} B)`);
  if (!dry) await unlink(path.join(DIR, f));
}
console.log(
  `\n  ${used.size} faces kept · ${stale.length} ${dry ? 'stale' : 'removed'} · ${bytes} B ` +
  `${dry ? '(dry run)' : 'reclaimed'}`
);
