#!/usr/bin/env node
// tools/langs.mjs — read the real language census and write tools/langs.json.
//
//   node tools/langs.mjs
//
// This exists because the hosted top-langs card is honest but unreadable: one repo holds a
// 6.24 MB serialized .ipynb, and a notebook's bytes are JSON, not code. GitHub's language API
// counts them, so the card is a single orange bar and 96.65% of it says "Jupyter Notebook".
// The plate build.mjs draws instead reports the same census over source files, and prints the
// exclusion on its own face. Neither number is invented, and neither is this script's output
// hand-typed into content.js.
//
// Unauthenticated: 60 req/hr, one per repo. Private repos are invisible to this endpoint, so
// the scope line says PUBLIC.

import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, 'tmp', 'languages');
const USER = process.argv[2] || 'Calfredo23';
const FORCE = process.argv.includes('--fresh');
const NB = 'Jupyter Notebook';          // serialized JSON, not source

const get = async (url) => {
  const r = await fetch(url, { headers: { 'User-Agent': 'profile-tools', Accept: 'application/vnd.github+json' } });
  if (r.status === 403 || r.status === 429) {
    const back = new Date((+r.headers.get('x-ratelimit-reset') || 0) * 1000);
    throw new Error('GitHub API rate limit hit (unauthenticated, 60/hr). Resets ' +
      (Number.isNaN(+back) ? 'soon' : back.toLocaleTimeString()) +
      ' — re-run then, or the per-repo cache in tools/tmp/languages/ already holds most of it.');
  }
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
};

// One request per repo, and the budget is 60/hr unauthenticated, so cache. A cached run costs
// nothing and a rate-limited run resumes instead of restarting.
await mkdir(CACHE, { recursive: true });
const langOf = async (full) => {
  const f = path.join(CACHE, full.replace(/\//g, '__') + '.json');
  if (!FORCE && existsSync(f)) return JSON.parse(await readFile(f, 'utf8'));
  const L = await get(`https://api.github.com/repos/${full}/languages`);
  await writeFile(f, JSON.stringify(L));
  return L;
};

const listed = async () => {
  const f = path.join(CACHE, `_repos-${USER}.json`);
  if (!FORCE && existsSync(f)) return JSON.parse(await readFile(f, 'utf8'));
  const R = await get(`https://api.github.com/users/${USER}/repos?per_page=100`);
  await writeFile(f, JSON.stringify(R));
  return R;
};
const repos = (await listed()).filter((r) => !r.fork);

const bytes = {};
const owners = {};
for (const r of repos) {
  const L = await langOf(r.full_name);
  for (const [k, v] of Object.entries(L)) {
    bytes[k] = (bytes[k] || 0) + v;
    (owners[k] ??= []).push(r.name);
  }
  process.stdout.write('.');
}

const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
const total = sum(bytes);
const nbBytes = bytes[NB] ?? 0;
const src = { ...bytes };
delete src[NB];
const srcTotal = sum(src);

const mb = (v) => Math.round(v / 1048576 * 100) / 100;
const out = {
  user: USER,
  asOf: new Date().toISOString().slice(0, 10),
  repos: repos.length,
  scope: `${repos.length} PUBLIC REPOS · BYTES OF TRACKED SOURCE`,
  totalBytes: total,
  sourceBytes: srcTotal,
  rows: Object.entries(src)
    .sort((a, b) => b[1] - a[1])
    .map(([name, v]) => ({ name, bytes: v, pct: Math.round((100 * v / srcTotal) * 100) / 100 })),
  excluded: nbBytes ? {
    name: NB,
    bytes: nbBytes,
    pctOfAll: Math.round((100 * nbBytes / total) * 100) / 100,
    repos: owners[NB],
    why: `${mb(nbBytes)} MB OF SERIALIZED .IPYNB JSON, NOT TYPED SOURCE`,
  } : null,
};

await writeFile(path.join(HERE, 'langs.json'), JSON.stringify(out, null, 2) + '\n');
console.log(`\n  ${out.asOf}  total ${mb(total)} MB · source ${mb(srcTotal)} MB`);
for (const r of out.rows) console.log(`    ${String(r.pct).padStart(6)}%  ${r.name}`);
if (out.excluded) console.log(`   excluded  ${out.excluded.pctOfAll}% ${out.excluded.name} (${out.excluded.repos.join(', ')})`);
console.log(`  -> tools/langs.json`);
