#!/usr/bin/env node
// Owner-review renderings. Nothing here ships — profile-repo/ never gets a preview file.
//
//   node tools/preview.mjs                 sheet at 840 + 360, page at 1216/840/480/390
//   node tools/preview.mjs sheet  [w]      every master asset stacked
//   node tools/preview.mjs pocket          every pocket asset stacked at 360
//   node tools/preview.mjs page   [w]      profile-repo/README.md as GitHub would render it
//   node tools/preview.mjs bands  [w]      the same page cut into 1050 px bands, for reading
//
// `page` wraps the markdown in the same <article class="markdown-body …"> GitHub uses and paints
// it with the theme values read out of the CSS github.com/Calfredo23 actually serves
// (tools/gh-page.mjs caches the URL). That is what makes the width sweep meaningful: it is the
// only way to see the seam between a #2c011a sheet and a #0d1117 page, and whether a chip
// survives at phone width.
//
// Capture goes through tools/cdp.mjs at real elapsed time, never Chrome's --screenshot: virtual
// time freezes every animation clock at t=0, which is what made an intact hosted card look empty.

import { writeFile, readdir, readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { marked } from 'marked';
import { capture, measure, close } from './cdp.mjs';
import { SITE, ASSETS } from './site.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = path.join(HERE, 'tmp');
const toUrl = (p) => 'file:///' + p.split(path.sep).join('/');

await mkdir(TMP, { recursive: true });
const files = existsSync(ASSETS) ? await readdir(ASSETS) : [];
if (!files.length) { console.error('  no assets — run node tools/build.mjs first'); process.exit(2); }

// Reading order, so the sheet is a storyboard and not an alphabet.
const ORDER = ['hypergamy.svg'];
const master = (list) => list.filter((f) => !f.endsWith('-pocket.svg'));
const pocket = (list) => list.filter((f) => f.endsWith('-pocket.svg'));
const ordered = [
  ...ORDER.flatMap((f) => [f, f.replace(/\.svg$/, '-pocket.svg')]).filter((f) => files.includes(f)),
  ...files.filter((f) => !ORDER.includes(f) && !ORDER.includes(f.replace(/-pocket\.svg$/, '.svg'))),
];

// Real-time capture, not Chrome's --screenshot: virtual time freezes every animation clock at
// t=0, which made the hosted cards look empty and would have got a defect "fixed" that was never
// there. settle is wall-clock ms after the load event.
async function shoot(html, out, w, { settle = 900 } = {}) {
  const page = path.join(TMP, out.replace(/\.png$/, '.html'));
  await writeFile(page, html);
  await capture({ page, out: path.join(TMP, out), width: w, height: 1000, settle, full: true });
  console.log(`  ${out}`);
}

async function sheet(width, set = master) {
  const list = set(ordered);
  const html =
    `<!doctype html><meta charset="utf-8"><style>` +
    `body{margin:0;padding:12px;background:#0d1117;display:flex;flex-direction:column;gap:12px;box-sizing:border-box}` +
    `img{width:${width}px;display:block;outline:1px dashed #30363d;outline-offset:-1px}` +
    `</style><body>` + list.map((f) => `<img src="${toUrl(path.join(ASSETS, f))}">`).join('');
  await shoot(html, `sheet-${width}.png`, width + 24);
}

async function page(width, band = 0) {
  const facts = existsSync(path.join(TMP, 'gh-page.json'))
    ? JSON.parse(await readFile(path.join(TMP, 'gh-page.json'), 'utf8'))
    : {};
  // GitHub's markdown typography lives in the app bundle, not the theme stylesheet, so linking
  // only the theme CSS produced dim text on a dark canvas and made the preview untrustworthy.
  // These are the theme values read out of the CSS the page actually serves (tools/tmp/
  // gh-dark-tokens.json): canvas #0d1117, fg #f0f6fc, muted #9198a1, border #3d444d.
  const tk = existsSync(path.join(TMP, 'gh-dark-tokens.json'))
    ? JSON.parse(await readFile(path.join(TMP, 'gh-dark-tokens.json'), 'utf8'))
    : {};
  const bg = tk['bgColor-default'] ?? '#0d1117';
  const fg = tk['fgColor-default'] ?? '#f0f6fc';
  const muted = tk['fgColor-muted'] ?? '#9198a1';
  const line = tk['borderColor-default'] ?? '#3d444d';

  const md = await readFile(path.join(SITE, 'README.md'), 'utf8');
  const html =
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    // The README links assets/ relatively, exactly as it will on GitHub; <base> keeps that
    // resolution honest instead of rewriting the markdown for the preview.
    `<base href="${toUrl(SITE) + '/'}">` +
    `<style>` +
    `html,body{margin:0;background:${bg}}` +
    `.wrap{max-width:${width}px;margin:0 auto;padding:16px;box-sizing:border-box}` +
    `body{color:${fg};font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans",Helvetica,Arial,sans-serif}` +
    // GitHub does not set display:block on markdown images, and the first version of this rule
    // did — which made the two inline shields badges stack left-aligned and looked like a defect
    // in the README rather than in the harness.
    `.md{max-width:none} .md p{margin:0 0 16px} .md img{max-width:100%;vertical-align:middle}` +
    `.md div[align=center]{text-align:center}` +
    // Measured against the CSS GitHub actually serves (@primer/css markdown.css v21), which is
    // `table{display:block;width:100%;width:max-content;max-width:100%;overflow:auto}` — a wide
    // table on a phone SCROLLS, it does not clip. The first version of this rule said width:100%
    // with no overflow, which made the five-column SHIPPED table look broken at 358 px when it
    // isn't. border-collapse is not in that file; the app bundle supplies it and the rendered
    // result is single-line borders, so it stays.
    `.md table{display:block;width:100%;width:max-content;max-width:100%;overflow:auto;` +
      `border-collapse:collapse;border-spacing:0;margin:0 0 16px;font-variant:tabular-nums}` +
    `.md th,.md td{border:1px solid ${line};padding:6px 13px}` +
    // marked emits `align="center"` — the legacy attribute, which is the one GitHub's sanitizer
    // keeps. Setting text-align in author CSS would override the presentational hint and hide it,
    // so the harness spells the hints out instead. GitHub's own markdown.css sets none.
    `.md td[align=center],.md th[align=center]{text-align:center}` +
    `.md td[align=right],.md th[align=right]{text-align:right}` +
    `.md tr{background:${bg};border-top:1px solid ${tk['borderColor-muted'] ?? '#3d444d'}}` +
    `.md tr:nth-child(2n){background:${tk['bgColor-muted'] ?? '#151b23'}}` +
    `.md th{font-weight:600;background:${tk['bgColor-muted'] ?? '#151b23'}}` +
    `.md code{padding:.2em .4em;border-radius:6px;background:rgba(110,118,129,.4);font:85% ui-monospace,SFMono-Regular,Menlo,monospace}` +
    `.md a{color:#4493f8;text-decoration:none} .md a:hover{text-decoration:underline}` +
    `.md strong{font-weight:600}` +
    `.note{color:${muted};font-size:12px;border:1px dashed ${line};padding:6px 10px;margin-bottom:14px}` +
    `</style></head><body><div class="wrap">` +
    `<div class="note">Preview harness — canvas, text and table chrome use GitHub&rsquo;s served dark tokens; ` +
    `the README is parsed by marked, not by GitHub. Assets resolve relatively via &lt;base&gt;, as they will in the repo.</div>` +
    `<article class="md ${facts.articleClass || 'markdown-body'}">${marked.parse(md)}</article>` +
    `</div></body></html>`;
  const file = path.join(TMP, `page-${width}.html`);
  await writeFile(file, html);
  if (!band) { await shoot(html, `page-${width}.png`, width); return; }
  // A 4000 px page is unreadable in one image. Cut it into review bands instead.
  const { h } = await measure(file, width);
  const n = Math.ceil(h / band);
  for (let i = 0; i < n; i++) {
    const y = i * band;
    await capture({
      page: file, out: path.join(TMP, `page-${width}-${String(i + 1).padStart(2, '0')}.png`),
      width, height: 1000, settle: 900, full: true,
      clip: { x: 0, y, width, height: Math.min(band, h - y) },
    });
    console.log(`  page-${width}-${String(i + 1).padStart(2, '0')}.png   y ${y}..${Math.min(h, y + band)} of ${h}`);
  }
}

const mode = process.argv[2] ?? 'both';
const arg = +(process.argv[3] || 0);
if (mode === 'sheet') await sheet(arg || 840);
else if (mode === 'pocket') await sheet(360, pocket);
else if (mode === 'page') await page(arg || 1216);
else if (mode === 'bands') await page(arg || 1216, 1050);
else {
  await sheet(840);
  await sheet(360, pocket);
  await page(1216);
  await page(840);
  await page(480);
  await page(390);
}
await close();
