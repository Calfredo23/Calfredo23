#!/usr/bin/env node
// Cache what GitHub actually serves for the profile page, so the preview renders on the real
// canvas with the real stylesheet instead of a recoloured guess.
//
//   node tools/gh-page.mjs [--refresh]
//
// Stores tools/tmp/gh-page.html plus tools/tmp/gh-page.json (stylesheet URLs, the markdown-body
// wrapper classes, the content column width). preview.mjs links the same CSS from
// github.githubassets.com — that is the difference between "looks like a dark page" and
// "looks like github.com/Calfredo23".

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = path.join(HERE, 'tmp');
const URL = 'https://github.com/Calfredo23';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const htmlPath = path.join(TMP, 'gh-page.html');
const jsonPath = path.join(TMP, 'gh-page.json');

let html;
if (existsSync(htmlPath) && !process.argv.includes('--refresh')) {
  html = await readFile(htmlPath, 'utf8');
} else {
  html = await (await fetch(URL, { headers: { 'User-Agent': UA } })).text();
  await mkdir(TMP, { recursive: true });
  await writeFile(htmlPath, html);
}

const themes = {};
for (const m of html.matchAll(/<link[^>]+data-color-theme="([^"]+)"[^>]*data-href="([^"]+)"/g)) {
  themes[m[1]] = m[2];
}
const article = /<article class="(markdown-body[^"]*)"/.exec(html)?.[1] ?? 'markdown-body entry-content container-lg f5';
// The README column is a grid cell; grab its class list so the preview is the same width.
const col = /<div[^>]+class="([^"]*col-12[^"]*)"[^>]*>\s*<div[^>]+class="[^"]*(?:js-user-profile-sticky|px-3)/.exec(html)?.[1];

const facts = {
  url: URL,
  fetched: new Date().toISOString(),
  bytes: html.length,
  darkCss: themes.dark ?? null,
  lightCss: themes.light ?? null,
  articleClass: article,
  columnClass: col ?? null,
  // Inline theme tokens GitHub ships with the page, if any survive in markup.
  inlineTokens: Object.fromEntries(
    [...html.matchAll(/--(bgColor|fgColor|borderColor)-([a-zA-Z-]+):\s*(#[0-9a-f]{3,8})/gi)]
      .slice(0, 60).map((m) => [`--${m[1]}-${m[2]}`, m[3]])
  ),
};
await writeFile(jsonPath, JSON.stringify(facts, null, 1));
console.log(`  dark css   ${facts.darkCss}`);
console.log(`  article    .${facts.articleClass}`);
console.log(`  column     ${facts.columnClass ?? '(not found)'}`);
console.log(`  tokens     ${Object.keys(facts.inlineTokens).length} inline`);
