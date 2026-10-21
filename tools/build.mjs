#!/usr/bin/env node
// CALFREDO profile asset generator.
//
//   node tools/fetch-fonts.mjs   once: reference metrics for text layout
//   node tools/mk-seal.mjs       once per logo change: rasterize the seals (needs Chrome)
//   node tools/langs.mjs         refresh the census the ledger plate reads (needs network)
//   node tools/build.mjs         render + write assets/* + print the size manifest
//   node tools/build.mjs --check render to memory, diff against disk, exit 1 on drift
//
// Every asset under assets/ comes from here, driven by tools/tokens.json and tools/content.js.
// Nothing is hand-drawn, so the palette is auditable and a re-theme is one file edit.
// Rationale and the measured constraints in table form: tools/README.md
//
// Platform reality this code is written around. Each was established by a render harness, not by
// reading documentation; the T-numbers below name those probes.
//   · GitHub strips <style>, inline <svg> and style=/class= from README HTML.
//   · An SVG loaded as <img> is network-isolated: an @import for fonts does nothing (T1b),
//     an embedded base64 woff2 does (T1). So faces are embedded, subset to each asset's own
//     characters (fonts.mjs).
//   · Both SMIL and same-document @keyframes animate under <img> (T2, T3).
//   · Text is laid out from real glyph advances, never an average-width guess, so nothing that
//     is positioned next to a rule can collide with it.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { face, USED } from './fonts.mjs';
import { ASSETS } from './site.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = ASSETS;
const CHECK = process.argv.includes('--check');

const T = JSON.parse(await readFile(path.join(HERE, 'tokens.json'), 'utf8'));
const M = JSON.parse(await readFile(path.join(HERE, 'fonts', 'ref', 'metrics.json'), 'utf8'));
const C = (await import('./content.js')).default;
// Derived data, never hand-typed: node tools/langs.mjs reads it from the GitHub API.
const LANGS = existsSync(path.join(HERE, 'langs.json'))
  ? JSON.parse(await readFile(path.join(HERE, 'langs.json'), 'utf8'))
  : null;

const col = (k) => T.color[k];
// Filled in the run section, before any asset function is called.
let SEAL_B64 = null, SEAL_POCKET_B64 = null;
// W is settable, not fixed. The same layout code renders the 840 master and a natively-narrow
// 360 pocket set, because a sheet authored at 840 and asked to fit GitHub's 358 px phone column
// puts its 10 px labels at 4 px — unreadable. The pocket set is re-authored, never downscaled.
let W = T.meta.designWidth;
const setWidth = (w) => { W = w; };
const narrow = () => W < 600;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const n = (v) => (Math.round(v * 100) / 100).toString();

// ── type ────────────────────────────────────────────────────────────────────
// A role is a token; a face is a file. This maps the roles in tokens.json onto the six
// faces fetch-fonts.mjs measured.
const ROLE_FACE = {
  display: 'chakra-700',
  head: 'chakra-700',
  subhead: 'chakra-500',
  body: 'cabin-400',
  label: 'jbmono-500',
  data: 'jbmono-400',
};

let RUNS = new Map(); // `${family}|${weight}` -> characters actually engraved

function track(fam, str) {
  const set = RUNS.get(fam) ?? new Set();
  for (const ch of str) if (ch !== ' ') set.add(ch);
  RUNS.set(fam, set);
}

function widthOf(role, str, size, trackingEm) {
  const m = M[ROLE_FACE[role]];
  let em = 0;
  for (const ch of str) em += m.advance[ch] ?? m.fallback;
  return (em + trackingEm * [...str].length) * size;
}

function text(str, x, y, role, fill, opts = {}) {
  const spec = T.type[role];
  const size = opts.size ?? spec.size ?? 14;
  const tracking = opts.tracking ?? spec.tracking ?? 0;
  const s = (opts.upper ?? spec.uppercase) ? String(str).toUpperCase() : String(str);
  track(`${spec.family}|${spec.weight}`, s);
  const color = typeof fill === 'string' && fill.startsWith('#') ? fill : col(fill);
  return (
    `<text x="${n(x)}" y="${n(y)}" text-anchor="${opts.anchor ?? 'start'}" ` +
    `font-family="${spec.family}" font-weight="${opts.weight ?? spec.weight}" ` +
    `font-size="${n(size)}" letter-spacing="${n(tracking * size)}" fill="${color}"` +
    `${opts.opacity != null ? ` fill-opacity="${opts.opacity}"` : ''}` +
    `${opts.cls ? ` class="${opts.cls}"` : ''}` +
    `${opts.filter ? ` filter="url(#${opts.filter})"` : ''}>${esc(s)}</text>`
  );
}

// Shrink a run until it fits a box, so a longer string is re-fitted rather than overrunning.
function fit(str, role, maxW, size, trackingEm) {
  let s = size;
  while (s > 7 && widthOf(role, str, s, trackingEm) > maxW) s -= 0.25;
  return s;
}

// ── geometry ────────────────────────────────────────────────────────────────
function hex(cx, cy, r) {
  return Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 180) * (60 * i - 90);
    return `${n(cx + r * Math.cos(a))},${n(cy + r * Math.sin(a))}`;
  }).join(' ');
}

function tickBand(w, h, inset, step, color) {
  const parts = [];
  const line = (x1, y1, x2, y2) =>
    parts.push(`<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}"/>`);
  for (let x = inset; x <= w - inset; x += step) {
    const len = Math.round((x - inset) / step) % 5 === 0 ? 9 : 4;
    line(x, inset, x, inset + len);
    line(x, h - inset, x, h - inset - len);
  }
  for (let y = inset; y <= h - inset; y += step) {
    const len = Math.round((y - inset) / step) % 5 === 0 ? 9 : 4;
    line(inset, y, inset + len, y);
    line(w - inset, y, w - inset - len, y);
  }
  return `<g stroke="${color}" stroke-width="1" stroke-opacity="${T.color.tickAlpha}">${parts.join('')}</g>`;
}

function cornerBrackets(w, h, inset, arm) {
  const at = (x, y, dx, dy) =>
    `<path d="M${n(x)} ${n(y)} l${n(dx * arm)} 0 M${n(x)} ${n(y)} l0 ${n(dy * arm)}" ` +
    `stroke="${col('gold')}" stroke-width="2" stroke-opacity="0.55" fill="none"/>`;
  return at(inset, inset, 1, 1) + at(w - inset, inset, -1, 1) +
         at(inset, h - inset, 1, -1) + at(w - inset, h - inset, -1, -1);
}

// 7px notched corners — the chip profile the site footer already uses (global.css:4073).
function chip(x, y, w, h, label) {
  const k = T.geometry.notch;
  const d = `M${n(x + k)} ${n(y)} H${n(x + w)} V${n(y + h - k)} L${n(x + w - k)} ${n(y + h)} ` +
            `H${n(x)} V${n(y + k)} Z`;
  return (
    `<path d="${d}" fill="${col('block')}" stroke="${col('brass')}" stroke-opacity="0.3" stroke-width="1"/>` +
    text(label, x + w / 2, y + h / 2 + 4, 'data', 'bone', { anchor: 'middle', size: 11, tracking: 0.06 })
  );
}

// Returns the rows laid out as well as the markup, so a rack can size itself to its content.
function chipRows(items, x0, x1, y0, rowH) {
  const rows = [];
  let row = [], x = x0;
  for (const it of items) {
    const w = Math.ceil(widthOf('data', it, 11, 0.06)) + 26;
    if (x + w > x1 && row.length) { rows.push(row); row = []; x = x0; }
    row.push({ it, w, x });
    x += w + 8;
  }
  if (row.length) rows.push(row);
  const body = rows.map((r, i) =>
    r.map(({ it, w, x }) => chip(x, y0 + i * rowH, w, 24, it)).join('')
  ).join('');
  return { body, rows: rows.length };
}

const GOLD_RULE = `<linearGradient id="gr" x1="0" y1="0" x2="1" y2="0">
<stop offset="0%" stop-color="${col('gold')}" stop-opacity="0"/>
<stop offset="20%" stop-color="${col('gold')}" stop-opacity="0.7"/>
<stop offset="50%" stop-color="${col('gilt')}" stop-opacity="1"/>
<stop offset="80%" stop-color="${col('gold')}" stop-opacity="0.7"/>
<stop offset="100%" stop-color="${col('gold')}" stop-opacity="0"/></linearGradient>`;

const GLOW = `<filter id="glow" x="-40%" y="-60%" width="180%" height="240%">
<feGaussianBlur stdDeviation="7" result="b"/>
<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;

// Bars read left-to-right, so the gradient runs gilt where the value starts and fades out.
const BAR_FILL = `<linearGradient id="bar" x1="0" y1="0" x2="1" y2="0">
<stop offset="0%" stop-color="${col('gilt')}"/>
<stop offset="100%" stop-color="${col('brass')}" stop-opacity="0.85"/></linearGradient>`;

// Instrument-plate chrome: double border, four rivets, a header rail with a note at each end.
// Shared by the gauge plate and the language ledger so two plates on the same sheet cannot
// drift apart in weight, radius or rivet size.
function plateFrame(H, left, right, { inset = 9 } = {}) {
  const pad = narrow() ? 20 : 26;
  const x0 = inset + pad, x1 = W - inset - pad;
  // Two notes on one rail. Shrink them by the same factor so their relative emphasis survives,
  // instead of letting the longer one run under the other at pocket width.
  const lw = widthOf('label', String(left).toUpperCase(), 8.5, 0.2);
  const rw = widthOf('label', String(right).toUpperCase(), 8.5, 0.2);
  const k = Math.min(1, (x1 - x0 - 20) / (lw + rw));
  const size = 8.5 * k;
  const rivets = [[inset + 12, inset + 12], [W - inset - 12, inset + 12],
                  [inset + 12, H - inset - 12], [W - inset - 12, H - inset - 12]]
    .map(([x, y]) =>
      `<circle cx="${x}" cy="${y}" r="3.2" fill="none" stroke="${col('brass')}" stroke-opacity="0.5"/>` +
      `<circle cx="${x}" cy="${y}" r="1.1" fill="${col('gold')}" fill-opacity="0.6"/>`).join('');
  return `
<rect x="${inset}" y="${inset}" width="${W - 2 * inset}" height="${H - 2 * inset}" rx="1"
      fill="${col('block')}" stroke="${col('brass')}" stroke-opacity="0.35"/>
<rect x="${inset + 4}" y="${inset + 4}" width="${W - 2 * inset - 8}" height="${H - 2 * inset - 8}"
      fill="none" stroke="${col('brass')}" stroke-opacity="0.12"/>
${rivets}
${text(left, x0, 26, 'label', 'gold', { size, tracking: 0.2, opacity: 0.85 })}
${text(right, x1, 26, 'label', 'ash', { anchor: 'end', size, tracking: 0.2, opacity: 0.6 })}
<line x1="${inset + 20}" y1="34" x2="${W - inset - 20}" y2="34" stroke="${col('brass')}" stroke-opacity="0.2"/>`;
}

async function svgDoc(h, body, { style = '', extraDefs = '' } = {}) {
  const faces = [];
  for (const [key, chars] of RUNS) {
    const [family, weight] = key.split('|');
    faces.push(await face(family, +weight, [...chars].join('')));
  }
  const css = faces.map((f) => f.css).join('\n');
  return {
    markup:
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
      `viewBox="0 0 ${W} ${h}" width="${W}" height="${h}" role="img">\n` +
      `<defs>${extraDefs}</defs>\n` +
      `${css || style ? `<style>${css}${style}</style>` : ''}${body}\n</svg>\n`,
    faces: faces.map((f) => `${f.family} ${f.weight}:${f.embedded}B`).join(' '),
  };
}

// ── assets ──────────────────────────────────────────────────────────────────
async function heroSheet() {
  RUNS = new Map();
  const H = T.meta.heroHeight, inset = T.geometry.tickInset;
  const seal = { cx: 122, cy: 186, r: 84 };
  const left = 236;                       // everything right of the seal starts here
  const rightEdge = W - inset - 14;

  const rings = T.geometry.sealRings.map((rg, i) => {
    const r = seal.r + 6 + i * 7;
    return `<polygon points="${hex(seal.cx, seal.cy, r)}" fill="none" stroke="${col(rg.color)}" ` +
      `stroke-width="${rg.width}" stroke-opacity="${rg.opacity}">` +
      `<animate attributeName="stroke-opacity" values="${rg.opacity};${n(rg.opacity * 0.4)};${rg.opacity}" ` +
      `dur="${i === 0 ? T.motion.loops.breath : T.motion.loops.breathSlow}" repeatCount="indefinite"/></polygon>`;
  }).join('\n');

  // Right-margin note block. Baselines run down from the top; the caption column must stay clear.
  const hud = C.hud.map((s, i) =>
    text(s, rightEdge, 120 + i * 15, 'label', 'ash', { anchor: 'end', size: 9.5, tracking: 0.12, opacity: 0.8 })
  ).join('\n');
  const hudW = Math.max(...C.hud.map((s) => widthOf('label', s.toUpperCase(), 9.5, 0.12)));

  // One block, three lines: handle, caption, motto. Sized to the space between the seal and
  // the note column, then stacked off the measured cap heights so the gaps are real gaps.
  const avail = rightEdge - hudW - 22 - left;
  const name = C.name;
  const nameSize = fit(name, 'display', avail, 64, 0.045);
  const roleSize = fit(C.role, 'label', avail, 12.5, 0.14);
  const mottoSize = fit(C.motto, 'body', avail, 15, 0.02);

  const capTop = 200;
  const nameBase = capTop + M['chakra-700'].capHeight * nameSize;
  const roleBase = nameBase + 26;
  const mottoBase = roleBase + 28;

  // ISO title block across the foot of the sheet.
  const tbTop = mottoBase + 30, tbBot = H - inset, tbMid = (tbTop + tbBot) / 2;
  const cols = [inset, inset + (W - 2 * inset) / 3, inset + 2 * (W - 2 * inset) / 3, W - inset];
  const cells = [
    ['DWG NO', C.dwg, 0, 0], ['MATERIAL', C.material, 1, 0], ['FINISH', C.finish, 2, 0],
    ['SCALE', C.scale, 0, 1], ['LOCATION', C.location, 1, 1], ['REV', C.rev, 2, 1],
  ].map(([label, value, ci, ri]) => {
    const x = cols[ci] + 14, top = ri ? tbMid : tbTop;
    const cellW = cols[1] - cols[0] - 28;
    const size = fit(value, 'subhead', cellW, 15, 0.027);
    return text(label, x, top + 21, 'label', 'ash', { size: 9, tracking: 0.16, opacity: 0.75 }) +
      text(value, x, top + 45, 'subhead', 'bone', {
        size, tracking: 0.027, cls: label === 'REV' ? 'stamp' : undefined,
      });
  }).join('\n');

  // Header rail. The band above the seal and the note column was 110 px of nothing; a drawing
  // names its owner there, so the legal name goes there, between two hairlines.
  const railY = 47, railHalf = widthOf('label', C.legal.toUpperCase(), 9.5, 0.34) / 2 + 18;
  const rail =
    `<line x1="${inset + 22}" y1="${railY - 4}" x2="${n(W / 2 - railHalf)}" y2="${railY - 4}" ` +
      `stroke="${col('brass')}" stroke-opacity="0.3"/>` +
    `<line x1="${n(W / 2 + railHalf)}" y1="${railY - 4}" x2="${n(W - inset - 22)}" y2="${railY - 4}" ` +
      `stroke="${col('brass')}" stroke-opacity="0.3"/>` +
    `<path d="M${n(W / 2 - railHalf - 6)} ${railY - 8} v8 M${n(W / 2 + railHalf + 6)} ${railY - 8} v8" ` +
      `stroke="${col('gold')}" stroke-opacity="0.45" stroke-width="1.2"/>` +
    text(C.legal, W / 2, railY, 'label', 'brass', { anchor: 'middle', size: 9.5, tracking: 0.34, opacity: 0.9 });

  const grid =
    `<line x1="${n(cols[1])}" y1="${tbTop}" x2="${n(cols[1])}" y2="${tbBot}" stroke="${col('brass')}" stroke-opacity="0.18"/>` +
    `<line x1="${n(cols[2])}" y1="${tbTop}" x2="${n(cols[2])}" y2="${tbBot}" stroke="${col('brass')}" stroke-opacity="0.18"/>` +
    `<line x1="${inset}" y1="${n(tbMid)}" x2="${W - inset}" y2="${n(tbMid)}" stroke="${col('brass')}" stroke-opacity="0.18"/>` +
    `<line x1="${inset}" y1="${n(tbTop)}" x2="${W - inset}" y2="${n(tbTop)}" stroke="${col('brass')}" stroke-opacity="0.35"/>`;

  return svgDoc(H, `
<rect width="${W}" height="${H}" fill="${col('sheet')}"/>
${tickBand(W, H, inset, T.geometry.tick, col('brass'))}
<rect x="${inset}" y="${inset}" width="${W - 2 * inset}" height="${H - 2 * inset}" fill="none"
      stroke="${col('brass')}" stroke-opacity="${T.color.ruleAlpha}"/>
${cornerBrackets(W, H, inset, 20)}
${rail}
<circle cx="${seal.cx}" cy="${seal.cy}" r="128" fill="url(#halo)"/>
<polygon points="${hex(seal.cx, seal.cy, seal.r)}" fill="${col('plate')}"
         stroke="${col('brass')}" stroke-opacity="0.4"/>
<g clip-path="url(#hexclip)">
  <image x="${n(seal.cx - 60)}" y="${n(seal.cy - 60)}" width="120" height="120"
         href="data:image/png;base64,${SEAL_B64}"/>
</g>
${rings}
${text(name, left, nameBase, 'display', 'gilt', { size: nameSize, tracking: 0.045, filter: 'glow' })}
${text(C.role, left + 2, roleBase, 'label', 'ash', { size: roleSize, tracking: 0.14 })}
${text(C.motto, left + 2, mottoBase, 'body', 'gold', { size: mottoSize, tracking: 0.02, upper: false })}
${hud}
${grid}
${cells}
`, {
    style: `
.stamp{animation:st ${T.motion.oneShot.stamp} ${T.motion.ease} both}
@keyframes st{from{fill:${col('ash')}}to{fill:${col('gilt')}}`,
    extraDefs: `${GLOW}
<radialGradient id="halo"><stop offset="0%" stop-color="${col('gold')}" stop-opacity="0.3"/>
<stop offset="60%" stop-color="${col('gold')}" stop-opacity="0.07"/>
<stop offset="100%" stop-color="${col('gold')}" stop-opacity="0"/></radialGradient>
<clipPath id="hexclip"><polygon points="${hex(seal.cx, seal.cy, 70)}"/></clipPath>`,
  });
}

// The pocket hero. Not a downscaled master: GitHub's phone column is ~358 px, so a sheet
// authored at 840 lands its 10 px labels at 4 px. This re-composes instead — seal above the
// name rather than beside it, the margin notes stacked under the motto, and a two-cell title
// block, because six cells of ISO metadata is the first thing to become illegible, not the last.
async function heroPocket() {
  RUNS = new Map();
  const H = 360, inset = T.geometry.tickInset, mid = W / 2;
  const seal = { cx: mid, cy: 84, r: 44 };

  const rings = T.geometry.sealRings.map((rg, i) => {
    const r = seal.r + 5 + i * 6;
    return `<polygon points="${hex(seal.cx, seal.cy, r)}" fill="none" stroke="${col(rg.color)}" ` +
      `stroke-width="${rg.width}" stroke-opacity="${rg.opacity}">` +
      `<animate attributeName="stroke-opacity" values="${rg.opacity};${n(rg.opacity * 0.4)};${rg.opacity}" ` +
      `dur="${i === 0 ? T.motion.loops.breath : T.motion.loops.breathSlow}" repeatCount="indefinite"/></polygon>`;
  }).join('\n');

  const nameSize = fit(C.name, 'display', W - 44, 42, 0.05);
  const roleSize = fit(C.role, 'label', W - 40, 11.5, 0.14);
  const mottoSize = fit(C.motto, 'body', W - 40, 13, 0.02);

  const tbTop = 312, tbBot = H - inset;
  const cells = [['DWG NO', C.dwg, inset], ['REV', C.rev, mid]]
    .map(([label, value, x0]) => {
      const cellW = mid - inset - 28;
      return text(label, x0 + 14, tbTop + 14, 'label', 'ash', { size: 7.5, tracking: 0.16, opacity: 0.75 }) +
        text(value, x0 + 14, tbTop + 30, 'subhead', label === 'REV' ? 'gilt' : 'bone', {
          size: fit(value, 'subhead', cellW, 12, 0.027), tracking: 0.027,
          cls: label === 'REV' ? 'stamp' : undefined,
        });
    }).join('\n');

  return svgDoc(H, `
<rect width="${W}" height="${H}" fill="${col('sheet')}"/>
${tickBand(W, H, inset, T.geometry.tick, col('brass'))}
<rect x="${inset}" y="${inset}" width="${W - 2 * inset}" height="${H - 2 * inset}" fill="none"
      stroke="${col('brass')}" stroke-opacity="${T.color.ruleAlpha}"/>
${cornerBrackets(W, H, inset, 14)}
<circle cx="${seal.cx}" cy="${seal.cy}" r="72" fill="url(#halo)"/>
<polygon points="${hex(seal.cx, seal.cy, seal.r)}" fill="${col('plate')}"
         stroke="${col('brass')}" stroke-opacity="0.4"/>
<g clip-path="url(#hexclip)">
  <image x="${n(seal.cx - 33)}" y="${n(seal.cy - 33)}" width="66" height="66"
         href="data:image/png;base64,${SEAL_POCKET_B64}"/>
</g>
${rings}
${text(C.legal, mid, 148, 'label', 'brass', { anchor: 'middle', size: fit(C.legal, 'label', W - 40, 8.5, 0.3), tracking: 0.3, opacity: 0.9 })}
${text(C.name, mid, 186, 'display', 'gilt', { anchor: 'middle', size: nameSize, tracking: 0.05, filter: 'glow' })}
${text(C.role, mid, 205, 'label', 'ash', { anchor: 'middle', size: roleSize, tracking: 0.14 })}
${text(C.motto, mid, 224, 'body', 'gold', { anchor: 'middle', size: mottoSize, tracking: 0.02, upper: false })}
${C.hud.map((s, i) => text(s, mid, 246 + i * 12, 'label', 'ash', {
    anchor: 'middle', size: fit(s, 'label', W - 30, 8.5, 0.12), tracking: 0.12, opacity: 0.8 })).join('\n')}
<line x1="${inset}" y1="${tbTop}" x2="${W - inset}" y2="${tbTop}" stroke="${col('brass')}" stroke-opacity="0.35"/>
<line x1="${mid}" y1="${tbTop}" x2="${mid}" y2="${tbBot}" stroke="${col('brass')}" stroke-opacity="0.18"/>
${cells}
`, {
    style: `
.stamp{animation:st ${T.motion.oneShot.stamp} ${T.motion.ease} both}
@keyframes st{from{fill:${col('ash')}}to{fill:${col('gilt')}}`,
    extraDefs: `${GLOW}
<radialGradient id="halo"><stop offset="0%" stop-color="${col('gold')}" stop-opacity="0.3"/>
<stop offset="60%" stop-color="${col('gold')}" stop-opacity="0.07"/>
<stop offset="100%" stop-color="${col('gold')}" stop-opacity="0"/></radialGradient>
<clipPath id="hexclip"><polygon points="${hex(seal.cx, seal.cy, 37)}"/></clipPath>`,
  });
}

async function rule(cap = false) {
  RUNS = new Map();
  const H = cap ? 20 : 14, mid = W / 2;
  if (cap) {
    return svgDoc(H, `
<rect x="40" y="9" width="${W - 80}" height="1.2" fill="url(#gr)"/>
<path d="M40 4 V9 H46 M${W - 46} 9 H${W - 40} V4" stroke="${col('gold')}" stroke-opacity="0.6"
      stroke-width="1.4" fill="none"/>
<path d="M${mid} 3 L${mid + 5} 10 L${mid} 17 L${mid - 5} 10 Z" fill="${col('gilt')}" fill-opacity="0.9"/>
<circle cx="${mid - 60}" cy="10" r="1.6" fill="${col('gold')}" fill-opacity="0.5">
<animate attributeName="fill-opacity" values="0.5;0.12;0.5" dur="${T.motion.loops.pulse}" begin="0.35s" repeatCount="indefinite"/></circle>
<circle cx="${mid + 60}" cy="10" r="1.6" fill="${col('gold')}" fill-opacity="0.5">
<animate attributeName="fill-opacity" values="0.5;0.12;0.5" dur="${T.motion.loops.pulse}" begin="0.35s" repeatCount="indefinite"/></circle>`,
      { extraDefs: GOLD_RULE });
  }
  return svgDoc(H, `
<rect x="0" y="6" width="${W}" height="1.4" fill="url(#gr)"/>
<circle cx="${mid}" cy="7" r="4" fill="${col('gilt')}">
<animate attributeName="r" values="4;4.6;4" dur="${T.motion.loops.pulse}" repeatCount="indefinite"/>
<animate attributeName="fill-opacity" values="1;0.45;1" dur="${T.motion.loops.pulse}" repeatCount="indefinite"/></circle>
<circle cx="${mid - 30}" cy="7" r="2.2" fill="${col('gold')}" fill-opacity="0.55">
<animate attributeName="fill-opacity" values="0.55;0.12;0.55" dur="${T.motion.loops.pulse}" begin="0.35s" repeatCount="indefinite"/></circle>
<circle cx="${mid + 30}" cy="7" r="2.2" fill="${col('gold')}" fill-opacity="0.55">
<animate attributeName="fill-opacity" values="0.55;0.12;0.55" dur="${T.motion.loops.pulse}" begin="0.35s" repeatCount="indefinite"/></circle>
<circle cx="${mid - 54}" cy="7" r="1.3" fill="${col('gold')}" fill-opacity="0.3"/>
<circle cx="${mid + 54}" cy="7" r="1.3" fill="${col('gold')}" fill-opacity="0.3"/>`,
    { extraDefs: GOLD_RULE });
}

async function head({ label, sub }) {
  RUNS = new Map();
  const H = 66, mid = W / 2;
  // At 360 there is no room left for the flanking rules, so the label takes the full width and
  // the rules are dropped rather than squeezed into stubs.
  const pocket = narrow();
  const size = fit(label, 'head', pocket ? W - 40 : W - 240, 22, 0.16);
  const subSize = fit(sub, 'label', pocket ? W - 24 : W - 160, 9.5, 0.18);
  const half = widthOf('head', label.toUpperCase(), size, 0.16) / 2 + 18;
  const ruleW = pocket ? 0 : Math.max(60, mid - half - 32);
  const flank = (x) =>
    `<rect x="${n(x)}" y="26" width="${n(ruleW)}" height="1" fill="url(#gr)"/>` +
    `<path d="M${n(x < mid ? x - 8 : x + ruleW + 8)} 22 V30" stroke="${col('gold')}" stroke-opacity="0.5" stroke-width="1.2"/>`;
  return svgDoc(H, `
${ruleW ? flank(mid - half - ruleW) + flank(mid + half) : ''}
${text(label, mid, 34, 'head', 'gilt', { anchor: 'middle', size, tracking: 0.16, filter: 'glow' })}
${text(sub, mid, 56, 'label', 'ash', { anchor: 'middle', size: subSize, tracking: 0.18, opacity: 0.85 })}`,
    { extraDefs: `${GOLD_RULE}${GLOW}` });
}

async function rack({ id, label, items }) {
  RUNS = new Map();
  const rowH = 34, pad = 26, top = 40;
  const { body, rows } = chipRows(items, pad, W - pad, top, rowH);
  const H = top + rows * rowH + 10;
  return svgDoc(H, `
${text(label, pad, 20, 'label', 'gold', { size: 10, tracking: 0.16 })}
<line x1="${pad}" y1="26" x2="${W - pad}" y2="26" stroke="${col('brass')}" stroke-opacity="0.16"/>
${body}`);
}

async function footer() {
  RUNS = new Map();
  const H = 132, mid = W / 2;
  const avail = W - (narrow() ? 48 : 120);
  const size = fit(C.motto, 'body', avail, 17, 0.03);
  const sig = `${C.signature} · ${C.dwg} · REV ${C.rev}`;
  const sigSize = fit(sig, 'label', avail, 9.5, 0.16);
  return svgDoc(H, `
<rect width="${W}" height="${H}" fill="${col('plate')}"/>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" fill="none" stroke="${col('brass')}" stroke-opacity="0.2"/>
${cornerBrackets(W, H, 8, 14)}
${text(C.motto, mid, 54, 'body', 'gilt', { anchor: 'middle', size, tracking: 0.03, filter: 'glow', upper: false })}
<path d="M${mid - 8} 76 L${mid} 84 L${mid + 8} 76" fill="none" stroke="${col('gold')}" stroke-opacity="0.7" stroke-width="1.2"/>
<circle cx="${mid}" cy="80" r="2.4" fill="${col('gilt')}">
<animate attributeName="fill-opacity" values="1;0.4;1" dur="${T.motion.loops.glow}" repeatCount="indefinite"/></circle>
${text(sig, mid, 108, 'label', 'ash', { anchor: 'middle', size: sigSize, tracking: 0.16, opacity: 0.8 })}`,
    { extraDefs: GLOW });
}

// The data plate. This is what replaces the hosted streak card: same numbers, drawn in the
// sheet's own language instead of a foreign palette, and stamped with the date they were read
// so a stalled pipeline ages as a dated fact rather than a stale claim.
async function gaugePlate() {
  RUNS = new Map();
  const H = 152, inset = 9;
  const g = C.plate.gauges;
  const cellW = (W - 2 * inset) / g.length;
  const cells = g.map((d, i) => {
    const cx = inset + cellW * i + cellW / 2;
    // Everything in a cell is fitted to the cell, not just the value. At 360 the three labels
    // ran under the column dividers, which is the same collision in a smaller font.
    const size = fit(d.value, 'display', cellW - 40, 44, 0.02);
    const labelSize = fit(d.label, 'label', cellW - 18, 10, 0.18);
    const spanSize = fit(d.span, 'label', cellW - 18, 8.5, 0.14);
    return (
      text(d.value, cx, 74, 'display', 'gilt', { anchor: 'middle', size, tracking: 0.02 }) +
      text(d.label, cx, 98, 'label', 'brass', { anchor: 'middle', size: labelSize, tracking: 0.18 }) +
      text(d.span, cx, 116, 'label', 'ash', { anchor: 'middle', size: spanSize, tracking: 0.14, opacity: 0.7 })
    );
  }).join('');
  const dividers = g.slice(1).map((_, i) => {
    const x = inset + cellW * (i + 1);
    return `<line x1="${n(x)}" y1="34" x2="${n(x)}" y2="${H - 34}" stroke="${col('brass')}" stroke-opacity="0.22"/>`;
  }).join('');

  return svgDoc(H, `
${plateFrame(H, `SNAPSHOT ${C.plate.asOf}`, C.plate.source)}
${dividers}
${cells}`, { extraDefs: '' });
}

// The language census, drawn rather than hosted. The hosted card reads the same bytes and is
// honest, but one repo carries 6.2 MB of serialized .ipynb JSON and a notebook's bytes are not
// typed code — so the card renders as a single orange bar labelled Jupyter Notebook 96.65%.
// This plate reports the census over source files and prints the exclusion on its own face,
// so nothing is hidden by the choice of denominator. Data: tools/langs.mjs.
async function langLedger() {
  RUNS = new Map();
  const rows = LANGS.rows;
  const pad = narrow() ? 18 : 26;
  const rowH = 21, top = 48;
  const labelW = narrow() ? 96 : 128, pctW = narrow() ? 46 : 56;
  const barX = pad + labelW;
  const barW = W - pad - pctW - 12 - barX;
  const noteH = LANGS.excluded ? 26 : 0;
  const H = top + rows.length * rowH + noteH + 10;
  const max = Math.max(...rows.map((r) => r.pct));

  const bars = rows.map((r, i) => {
    const y = top + i * rowH;
    const w = Math.max(2, barW * r.pct / max);
    return (
      text(r.name, pad, y + 12, 'data', 'bone', { size: 11.5, tracking: 0.04 }) +
      `<rect x="${barX}" y="${y + 4}" width="${n(barW)}" height="9" fill="${col('recess')}" ` +
        `stroke="${col('brass')}" stroke-opacity="0.14"/>` +
      `<rect x="${barX}" y="${y + 4}" width="${n(w)}" height="9" fill="url(#bar)"/>` +
      text(r.pct.toFixed(2) + '%', W - pad, y + 12, 'data', 'gold',
        { anchor: 'end', size: 11, tracking: 0.04 })
    );
  }).join('');

  // The reason for the exclusion is the interesting half of the note, but at 360 it is also the
  // half that would have to shrink to 5 px — so the pocket plate states the fact and the master
  // states the fact and the reason.
  const ex = LANGS.excluded;
  const note = ex ? text(
    narrow()
      ? `EXCLUDED · ${ex.name} ${ex.pctOfAll}% OF ALL BYTES`
      : `EXCLUDED · ${ex.name.toUpperCase()} ${ex.pctOfAll}% OF ALL BYTES · ${ex.why}`,
    pad, H - 14, 'label', 'ash',
    { size: fit(`EXCLUDED ${ex.name} ${ex.pctOfAll}% ${ex.why}`, 'label', W - 2 * pad, 8.5, 0.14),
      tracking: 0.14, opacity: 0.72 }
  ) : '';

  // The full scope line is a 41-char note that only fits an 840 rail. At pocket width the
  // denominator and the repo count carry the meaning, so the census name and the date do.
  const noteLeft = narrow() ? 'LANGUAGE CENSUS · SOURCE BYTES' : `LANGUAGE CENSUS · ${LANGS.scope}`;
  const noteRight = narrow() ? `${LANGS.repos} REPOS · ${LANGS.asOf}` : `SNAPSHOT ${LANGS.asOf}`;

  return svgDoc(H, `
${plateFrame(H, noteLeft, noteRight)}
${bars}
${note}`, { extraDefs: BAR_FILL });
}


// FIELD WORK. Not fabricated: without the owner's survey there is no network to draw, and a
// plausible-looking topology on a hire-me page is the worst possible kind of decoration.
async function topologySheet() {
  RUNS = new Map();
  const { nodes, links, caption } = C.topology;
  const H = 320, inset = T.geometry.tickInset;
  const kindGlyph = {
    cloud: (x, y) => `<ellipse cx="${x}" cy="${y}" rx="22" ry="11" fill="none" stroke="${col('gold')}"/>`,
    router: (x, y) => `<circle cx="${x}" cy="${y}" r="13" fill="none" stroke="${col('gilt')}" stroke-width="1.4"/>`,
    switch: (x, y) => `<rect x="${x - 22}" y="${y - 8}" width="44" height="16" fill="none" stroke="${col('gilt')}" stroke-width="1.4"/>`,
    ap: (x, y) => `<path d="M${x - 12} ${y + 6} L${x} ${y - 8} L${x + 12} ${y + 6}" fill="none" stroke="${col('gilt')}" stroke-width="1.4"/>`,
    server: (x, y) => `<rect x="${x - 10}" y="${y - 14}" width="20" height="28" fill="none" stroke="${col('gilt')}" stroke-width="1.4"/>`,
    client: (x, y) => `<rect x="${x - 13}" y="${y - 9}" width="26" height="18" fill="none" stroke="${col('gold')}" stroke-width="1.2"/>`,
    firewall: (x, y) => `<path d="M${x - 12} ${y - 10} H${x + 12} V${y + 4} L${x} ${y + 12} L${x - 12} ${y + 4} Z" fill="none" stroke="${col('brass')}" stroke-width="1.4"/>`,
  };
  const byId = Object.fromEntries(nodes.map((d) => [d.id, d]));
  const linksOut = links.map((l) => {
    const a = byId[l.a], b = byId[l.b];
    const dash = l.kind === 'wireless' ? `stroke-dasharray="3 4"` : '';
    return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${col('brass')}"
  stroke-opacity="0.5" stroke-width="1.1" ${dash}/>` +
      (l.label ? text(l.label, (a.x + b.x) / 2, (a.y + b.y) / 2 - 5, 'label', 'ash',
        { anchor: 'middle', size: 8.5, tracking: 0.1, opacity: 0.75 }) : '');
  }).join('\n');
  const nodesOut = nodes.map((d) =>
    (kindGlyph[d.kind] ?? kindGlyph.client)(d.x, d.y) +
    text(d.label, d.x, d.y + 26, 'label', 'bone', { anchor: 'middle', size: 9, tracking: 0.1 })
  ).join('\n');

  return svgDoc(H, `
<rect width="${W}" height="${H}" fill="${col('sheet')}"/>
${tickBand(W, H, inset, T.geometry.tick, col('brass'))}
<rect x="${inset}" y="${inset}" width="${W - 2 * inset}" height="${H - 2 * inset}" fill="none"
      stroke="${col('brass')}" stroke-opacity="${T.color.ruleAlpha}"/>
${cornerBrackets(W, H, inset, 18)}
${linksOut}
${nodesOut}
${text(caption, inset + 14, H - inset - 14, 'label', 'gold', { size: 9, tracking: 0.16, opacity: 0.85 })}`,
    { extraDefs: '' });
}

// ── the hypergamy graph ─────────────────────────────────────────────────────
// A parody chart, not a measurement. The shares are authored in content.js and the sheet says
// so on its face. The drawing is a tree: the seal is the high-value node, six disciplines are
// the suitors, and line weight follows the share. Everything is vector except the seal raster,
// which is the same sealed logo the hero uses.
const ICONS = {
  spark: (cx, cy, color) => {
    const r = 9, m = 3.2;
    return `<path d="M${n(cx)} ${n(cy - r)} L${n(cx + m)} ${n(cy - m)} L${n(cx + r)} ${n(cy)} ` +
      `L${n(cx + m)} ${n(cy + m)} L${n(cx)} ${n(cy + r)} L${n(cx - m)} ${n(cy + m)} ` +
      `L${n(cx - r)} ${n(cy)} L${n(cx - m)} ${n(cy - m)} Z" fill="${color}" fill-opacity="0.9"/>`;
  },
  code: (cx, cy, color) =>
    text('</>', cx, cy + 4, 'label', color, { anchor: 'middle', size: 12, tracking: 0 }),
  cursor: (cx, cy, color) =>
    `<rect x="${n(cx - 9)}" y="${n(cy - 7)}" width="14" height="11" rx="1.5" fill="none" ` +
      `stroke="${color}" stroke-width="1.3"/>` +
    `<path d="M${n(cx + 1)} ${n(cy - 1)} L${n(cx + 9)} ${n(cy + 7)} L${n(cx + 4)} ${n(cy + 8)} ` +
      `L${n(cx + 6)} ${n(cy + 13)} L${n(cx + 2)} ${n(cy + 14)} L${n(cx)} ${n(cy + 9)} ` +
      `L${n(cx - 3)} ${n(cy + 12)} Z" fill="${color}" fill-opacity="0.9"/>`,
  rack: (cx, cy, color) => [-7, -1, 5].map((o) =>
    `<rect x="${n(cx - 8)}" y="${n(cy + o)}" width="16" height="4" rx="1" fill="none" ` +
      `stroke="${color}" stroke-width="1.2"/>` +
    `<circle cx="${n(cx + 6)}" cy="${n(cy + o + 2)}" r="0.9" fill="${color}"/>`
  ).join(''),
  db: (cx, cy, color) =>
    `<ellipse cx="${n(cx)}" cy="${n(cy - 6)}" rx="8" ry="3" fill="none" stroke="${color}" stroke-width="1.2"/>` +
    `<path d="M${n(cx - 8)} ${n(cy - 6)} V${n(cy + 5)} A8 3 0 0 0 ${n(cx + 8)} ${n(cy + 5)} ` +
      `V${n(cy - 6)}" fill="none" stroke="${color}" stroke-width="1.2"/>`,
  moon: (cx, cy, color) =>
    `<path d="M${n(cx + 3)} ${n(cy - 8)} A9 9 0 1 0 ${n(cx + 8)} ${n(cy + 5)} ` +
      `A7 7 0 1 1 ${n(cx + 3)} ${n(cy - 8)} Z" fill="none" stroke="${color}" stroke-width="1.4"/>`,
};

const FRAME_DEFS = `
<linearGradient id="fgrad" x1="0" y1="0" x2="1" y2="1">
  <stop stop-color="${col('brass')}"/><stop offset=".5" stop-color="${col('gilt')}"/><stop offset="1" stop-color="${col('gold')}"/>
</linearGradient>
<g id="deco">
  <path d="M0 0 H30 V10 H20 V20 H10 V30 H0" fill="none" stroke="url(#fgrad)" stroke-opacity="0.9" stroke-width="1.2"/>
  <path d="M0 0 H24 V8 H16 V16 H8 V24 H0" fill="none" stroke="${col('gold')}" stroke-opacity="0.35"/>
  <path d="M0 0 H18 V6 H12 V12 H6 V18 H0" fill="none" stroke="${col('plate')}" stroke-opacity="0.85" stroke-width="0.8"/>
  <path d="M20 0 A20 20 0 0 1 0 20" fill="none" stroke="${col('brass')}" stroke-opacity="0.3"/>
  <path d="M12 0 A12 12 0 0 1 0 12" fill="none" stroke="${col('brass')}" stroke-opacity="0.2"/>
  <path d="M0 -3 L3 0 L0 3 L-3 0 Z" fill="${col('plate')}" stroke="${col('gilt')}" stroke-opacity="0.55" stroke-width="0.7"/>
</g>
<g id="crest">
  <path d="M0 -4 L4 0 L0 4 L-4 0 Z" fill="${col('brass')}" fill-opacity="0.7"/>
  <path d="M-18 0 H-8 M8 0 H18" fill="none" stroke="${col('brass')}" stroke-opacity="0.35"/>
</g>`;

function premiumFrame(w, h, inset, s = 1) {
  const a = inset, z = w - inset, b = h - inset;
  // Engraved ruler band: hairline ticks in the 6 px channel between the two frame rules.
  // They start 40 px in from every corner, so the corner ornaments never paint over them,
  // and they live inside the frame band, where no text is placed to collide with.
  const band = (span) => {
    let d = '';
    for (let x = inset + 40; x <= span - inset - 40; x += 48) d += `M${n(x)} 1v2`;
    return d;
  };
  const runX = band(w), runY = band(h);
  // One geometry each in <defs>, four <use> placements — the ticks and the mid-edge
  // jewel are written to the SVG once, stroke included, like #deco and #crest above.
  const TICKS = `<defs>
    <path id="tx" d="${runX}" stroke="${col('brass')}" stroke-opacity=".24"/>
    <path id="ty" d="${runY}" stroke="${col('brass')}" stroke-opacity=".24"/>
    <g id="ej">
      <path d="M0 -3.4 L3.4 0 L0 3.4 L-3.4 0 Z" fill="${col('gilt')}"/>
      <path d="M0 -1.6 L1.6 0 L0 1.6 L-1.6 0 Z" fill="${col('plate')}"/>
    </g>
  </defs>`;
  const ticks =
    `${TICKS}
    <use href="#tx" transform="translate(${a} ${a})"/>` +
    `<use href="#ty" transform="translate(${a} ${a})"/>` +
    `<use href="#ty" transform="translate(${z} ${a}) scale(-1 1)"/>` +
    `<use href="#tx" transform="translate(${a} ${b}) scale(1 -1)"/>`;
  return ticks +
`<rect x="${a}" y="${a}" width="${z - a}" height="${b - a}" fill="none"
      stroke="url(#fgrad)" stroke-opacity="0.65" stroke-width="1.4"/>
<rect x="${a + 6}" y="${a + 6}" width="${z - a - 12}" height="${b - a - 12}" fill="none"
      stroke="${col('gold')}" stroke-opacity="0.3"/>
<use href="#deco" transform="translate(${a} ${a}) scale(${s})"/>
<use href="#deco" transform="translate(${z} ${a}) scale(${-s} ${s})"/>
<use href="#deco" transform="translate(${a} ${b}) scale(${s} ${-s})"/>
<use href="#deco" transform="translate(${z} ${b}) scale(${-s} ${-s})"/>
<use href="#ej" transform="translate(${a} ${n(h / 2)})"/>
<use href="#ej" transform="translate(${z} ${n(h / 2)})"/>
<use href="#crest" transform="translate(${n(w / 2)} ${a}) scale(${s})"/>
<use href="#crest" transform="translate(${n(w / 2)} ${b}) scale(${s})"/>`;
}
const GRAPH_CSS = `
@media (prefers-reduced-motion: no-preference){
  .spin{transform-box:fill-box;transform-origin:center;animation:spin 44s linear infinite}
  .ring{animation:breathe 5s ease-in-out infinite}
  .ring2{animation:breathe 8s ease-in-out infinite}
  .node{animation:node 4.5s ease-in-out infinite}
  .flow{animation:flow 2.6s linear infinite}
}
@media (prefers-reduced-motion: reduce){
  .pkt{display:none}
  .spin,.ring,.ring2,.node,.flow{animation:none}
}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes breathe{0%,100%{opacity:.55}50%{opacity:1}}
@keyframes node{0%,100%{stroke-opacity:.3}50%{stroke-opacity:.7}}
@keyframes flow{to{stroke-dashoffset:-20}}`;

async function hypergamySheet() {
  RUNS = new Map();
  const H = 596, inset = T.geometry.tickInset;
  const left = inset + 26, right = W - inset - 26;
  const seal = { cx: 168, cy: 320, r: 72 };
  const rowsTop = 188, pitch = 56;
  const barX = 570, barW = 150;
  const g = C.hypergamy;

  const rings = T.geometry.sealRings.map((rg, i) => {
    const r = seal.r + 6 + i * 7;
    return `<polygon points="${hex(seal.cx, seal.cy, r)}" fill="none" stroke="${col(rg.color)}" ` +
      `stroke-width="${rg.width}" stroke-opacity="${rg.opacity}" class="${i % 2 ? 'ring2' : 'ring'}"/>`;
  }).join('');

  const titleSize = fit(g.titleA + g.titleB + g.titleC, 'display', right - left, 44, 0.02);
  const t1 = g.titleA, t2 = g.titleB, t3 = g.titleC.trim();
  const w1 = widthOf('display', t1, titleSize, 0.02);
  const w2 = widthOf('display', t2, titleSize, 0.02);
  const titleGap = titleSize * 0.22;

  const subSize = fit(g.subtitle, 'body', right - left, 14, 0.01);

  const axis = text('ATTENTION SHARE', barX, 152, 'label', 'gold',
    { size: 8, tracking: 0.18 }) +
    [0, 25, 50, 75, 100].map((v, i) => text(String(v), barX + barW * v / 100, 166, 'label', 'ash', {
      anchor: i === 0 ? 'start' : i === 4 ? 'end' : 'middle', size: 7.5, tracking: 0.1, opacity: 0.6,
    })).join('');

  const grid = [25, 50, 75].map((v) =>
    `M${n(barX + barW * v / 100)} 170V486`
  ).join('');

  const rows = g.nodes.map((d, i) => {
    const cy = rowsTop + i * pitch;
    const edgeId = `edge-${d.id}`;
    const dead = d.id === 'sleep';
    const edge = `<path id="${edgeId}" d="M252 320 C286 320 302 ${n(cy)} 338 ${n(cy)}" fill="none" ` +
      `stroke="${col(dead ? 'ash' : 'gold')}" stroke-opacity="${dead ? 0.28 : 0.38}" ` +
      `stroke-width="${n(0.8 + d.pct * 0.035)}"${dead ? ' stroke-dasharray="2 6"' : ''}/>`;
    const pulse = dead ? '' :
      `<circle class="pkt" r="2.2" fill="${col('gilt')}" opacity="0">
        <animate attributeName="opacity" from="0" to="1" begin="${n(i * 0.55 + 0.05)}s" dur="0.01s" fill="freeze"/>
        <animateMotion dur="4.2s" begin="${n(i * 0.55)}s" repeatCount="indefinite">
          <mpath xlink:href="#${edgeId}"/></animateMotion>
      </circle>`;
    const chip = `<polygon points="${hex(354, cy, 18)}" fill="${col('plate')}" ` +
      `stroke="${col(dead ? 'ash' : 'brass')}" stroke-opacity="${dead ? 0.25 : 0.45}" ` +
      `stroke-width="1" class="node"/>` + ICONS[d.icon](354, cy, col(dead ? 'ash' : 'gilt'));
    const list = text(d.label, 382, cy - 1, 'head', dead ? 'ash' : 'bone', { size: 13, tracking: 0.04 }) +
      text(d.status, 382, cy + 14, 'body', 'ash',
        { size: 10.5, tracking: 0.01, upper: false, opacity: dead ? 0.6 : 0.9 });
    const fillW = Math.max(3, barW * d.pct / 100);
    const bar = `<rect x="${barX}" y="${n(cy - 4)}" width="${barW}" height="7" fill="${col('recess')}" ` +
      `stroke="${col('brass')}" stroke-opacity="0.16"/>` +
      `<rect x="${barX}" y="${n(cy - 4)}" width="${n(fillW)}" height="7" ` +
      `fill="${dead ? col('ash') : 'url(#bar)'}" fill-opacity="${dead ? 0.5 : 1}"/>`;
    const pct = text(`${d.pct}%`, right, cy + 4, 'label', dead ? 'ash' : 'gold',
      { anchor: 'end', size: 12, tracking: 0.04 });
    return edge + pulse + chip + list + bar + pct;
  }).join('');

  const seps = g.nodes.slice(1).map((_, i) =>
    `M320 ${n(rowsTop + (i + 1) * pitch - 28)}H${n(right)}`
  ).join('');

  // Graph paper, not the hero's tick band. The ticks are the sheet's signature on a portrait
  // plate; here the panel is a chart, and 24 hairlines cost a fifth of the 176 tick strokes.
  // Graph paper, not the hero tick band: 24 hairlines as ONE path instead of 24
  // <line> elements carrying the same stroke attributes each. Same geometry, same
  // opacity, a fraction of the bytes — this is what pays for the engraved frame.
  const paper = [];
  for (let x = 320; x <= right; x += 40) paper.push(`M${n(x)} 124V540`);
  for (let y = 124; y <= 540; y += 40) paper.push(`M320 ${n(y)}H${n(right)}`);

  const tagX = seal.cx - 52, tagY = 460, tagW = 104, tagH = 22, tagK = T.geometry.notch;
  const tag = `<path d="M${tagX + tagK} ${tagY} H${tagX + tagW} V${tagY + tagH - tagK} ` +
    `L${tagX + tagW - tagK} ${tagY + tagH} H${tagX} V${tagY + tagK} Z" ` +
    `fill="${col('block')}" stroke="${col('brass')}" stroke-opacity="0.3" stroke-width="1"/>` +
    text('THE CATCH', seal.cx, tagY + 15, 'label', 'bone',
      { anchor: 'middle', size: 9, tracking: 0.16 });

  return svgDoc(H, `
<rect width="${W}" height="${H}" fill="${col('sheet')}"/>
<path d="${paper.join('')}" fill="none" stroke="${col('brass')}" stroke-opacity="0.045"/>
${premiumFrame(W, H, inset, 0.8)}
${text(g.kicker, left, 27, 'label', 'gold', { size: 8.5, tracking: 0.2, opacity: 0.85 })}
${text(`${g.dwg} · ${g.rev}`, right, 27, 'label', 'ash', { anchor: 'end', size: 8.5, tracking: 0.16, opacity: 0.6 })}
<line x1="${inset + 20}" y1="35" x2="${W - inset - 20}" y2="35" stroke="${col('brass')}" stroke-opacity="0.2"/>
${text(t1, left, 86, 'display', 'ash', { size: titleSize, tracking: 0.02 })}
${text(t2, left + w1, 86, 'display', 'gold', { size: titleSize, tracking: 0.02 })}
${text(t3, left + w1 + w2 + titleGap, 86, 'display', 'gilt', { size: titleSize, tracking: 0.02, filter: 'glow' })}
${text(g.note, right, 86, 'label', 'brass', { anchor: 'end', size: 8, tracking: 0.16, opacity: 0.7 })}
${text(g.subtitle, left, 110, 'body', 'ash', { size: subSize, tracking: 0.01, upper: false, opacity: 0.85 })}
<line x1="${left}" y1="124" x2="${right}" y2="124" stroke="${col('gold')}" stroke-opacity="0.35"/>
${axis}
${`<path d="${grid}" fill="none" stroke="${col('brass')}" stroke-opacity="0.08"/>`}
${`<path d="${seps}" fill="none" stroke="${col('brass')}" stroke-opacity="0.07"/>`}
${rows}
<circle cx="${seal.cx}" cy="${seal.cy}" r="110" fill="url(#halo)"/>
<polygon points="${hex(seal.cx, seal.cy, seal.r)}" fill="${col('plate')}"
         stroke="${col('brass')}" stroke-opacity="0.4"/>
<g clip-path="url(#sealclip)">
  <image x="${n(seal.cx - 52)}" y="${n(seal.cy - 52)}" width="104" height="104"
         href="data:image/png;base64,${SEAL_POCKET_B64}"/>
</g>
${rings}
<circle cx="${seal.cx}" cy="${seal.cy}" r="100" fill="none" stroke="${col('gold')}"
        stroke-opacity="0.35" stroke-width="1" stroke-dasharray="2 10" class="spin"/>
${text(C.name, seal.cx, 437, 'display', 'gilt',
    { anchor: 'middle', size: 24, tracking: 0.06, filter: 'glow' })}
${text(C.role, seal.cx, 454, 'label', 'ash', { anchor: 'middle', size: 8.5, tracking: 0.12 })}
${tag}
<g transform="rotate(-4 ${seal.cx} 502)">
  <rect x="${seal.cx - 64}" y="490" width="128" height="24" fill="none"
        stroke="${col('gold')}" stroke-opacity="0.55"/>
  <rect x="${seal.cx - 60}" y="494" width="120" height="16" fill="none"
        stroke="${col('gold')}" stroke-opacity="0.22"/>
  ${text(g.status, seal.cx, 506, 'label', 'gilt', { anchor: 'middle', size: 9, tracking: 0.18 })}
</g>
${text(g.joke, seal.cx, 530, 'label', 'ash', { anchor: 'middle', size: 8, tracking: 0.14, opacity: 0.65 })}
<line x1="${left}" y1="540" x2="${right}" y2="540" stroke="${col('brass')}" stroke-opacity="0.2"/>
${text(g.caption, left, 554, 'body', 'gold', { size: 11.5, tracking: 0.01, upper: false })}
${text(g.punchline, right, 554, 'label', 'brass', { anchor: 'end', size: 8.5, tracking: 0.14 })}
${text(g.disclaimer, left, 572, 'label', 'ash', { size: 8, tracking: 0.14, opacity: 0.65 })}
`, {
    style: GRAPH_CSS,
    extraDefs: `${FRAME_DEFS}${GLOW}${BAR_FILL}
<radialGradient id="halo"><stop offset="0%" stop-color="${col('gold')}" stop-opacity="0.3"/>
<stop offset="60%" stop-color="${col('gold')}" stop-opacity="0.07"/>
<stop offset="100%" stop-color="${col('gold')}" stop-opacity="0"/></radialGradient>
<clipPath id="sealclip"><polygon points="${hex(seal.cx, seal.cy, 60)}"/></clipPath>`,
  });
}

async function hypergamyPocket() {
  RUNS = new Map();
  const H = 490, inset = T.geometry.tickInset;
  const left = inset + 20, right = W - inset - 20;
  const seal = { cx: 68, cy: 128, r: 28 };
  const rowsTop = 204, pitch = 40;
  const barX = 220, barW = 94;
  const g = C.hypergamy;

  const rings = T.geometry.sealRings.map((rg, i) => {
    const r = seal.r + 6 + i * 7;
    return `<polygon points="${hex(seal.cx, seal.cy, r)}" fill="none" stroke="${col(rg.color)}" ` +
      `stroke-width="${rg.width}" stroke-opacity="${rg.opacity}" class="${i % 2 ? 'ring2' : 'ring'}"/>`;
  }).join('');

  const titleSize = fit(g.titleA + g.titleB + g.titleC, 'display', W - 40, 19, 0.03);
  const subSize = fit(g.subtitle, 'body', W - 40, 8.5, 0.01);

  const rows = g.nodes.map((d, i) => {
    const cy = rowsTop + i * pitch;
    const dead = d.id === 'sleep';
    const fillW = Math.max(2, barW * d.pct / 100);
    const nameSize = fit(d.label, 'head', 86, 10.5, 0.04);
    const statusSize = fit(d.status, 'body', 90, 8, 0.01);
    return `<line x1="${seal.cx}" y1="${n(cy)}" x2="82" y2="${n(cy)}" ` +
      `stroke="${col(dead ? 'ash' : 'gold')}" stroke-opacity="${dead ? 0.22 : 0.34}"/>` +
      `<polygon points="${hex(94, cy, 12)}" fill="${col('plate')}" ` +
      `stroke="${col(dead ? 'ash' : 'brass')}" stroke-opacity="${dead ? 0.25 : 0.45}" class="node"/>` +
      `<g transform="translate(94 ${n(cy)}) scale(0.72) translate(-94 ${n(-cy)})">` +
      ICONS[d.icon](94, cy, col(dead ? 'ash' : 'gilt')) + `</g>` +
      text(d.label, 124, cy - 1, 'head', dead ? 'ash' : 'bone', { size: nameSize, tracking: 0.04 }) +
      text(d.status, 124, cy + 10, 'body', 'ash',
        { size: statusSize, tracking: 0.01, upper: false, opacity: dead ? 0.6 : 0.9 }) +
      `<rect x="${barX}" y="${n(cy - 2)}" width="${barW}" height="4" fill="${col('recess')}" ` +
      `stroke="${col('brass')}" stroke-opacity="0.16"/>` +
      `<rect x="${barX}" y="${n(cy - 2)}" width="${n(fillW)}" height="4" ` +
      `fill="${dead ? col('ash') : 'url(#bar)'}" fill-opacity="${dead ? 0.5 : 1}"/>` +
      text(`${d.pct}%`, right, cy + 4, 'label', dead ? 'ash' : 'gold', { anchor: 'end', size: 9, tracking: 0.04 });
  }).join('');

  return svgDoc(H, `
<rect width="${W}" height="${H}" fill="${col('sheet')}"/>
${premiumFrame(W, H, inset, 0.6)}
${text('HYPERGAMY', left, 27, 'label', 'gold', { size: 7.5, tracking: 0.18, opacity: 0.85 })}
${text(`${g.dwg} · REV B`, right, 27, 'label', 'ash', { anchor: 'end', size: 7.5, tracking: 0.14, opacity: 0.6 })}
<line x1="${inset + 16}" y1="35" x2="${W - inset - 16}" y2="35" stroke="${col('brass')}" stroke-opacity="0.2"/>
${text(g.titleA + g.titleB + g.titleC, W / 2, 60, 'display', 'gilt',
    { anchor: 'middle', size: titleSize, tracking: 0.03, filter: 'glow' })}
${text(g.subtitle, W / 2, 74, 'body', 'ash',
    { anchor: 'middle', size: subSize, tracking: 0.01, upper: false, opacity: 0.85 })}
<circle cx="${seal.cx}" cy="${seal.cy}" r="48" fill="url(#halo)"/>
<polygon points="${hex(seal.cx, seal.cy, seal.r)}" fill="${col('plate')}"
         stroke="${col('brass')}" stroke-opacity="0.4"/>
<g clip-path="url(#sealclip)">
  <image x="${n(seal.cx - 20)}" y="${n(seal.cy - 20)}" width="40" height="40"
         href="data:image/png;base64,${SEAL_POCKET_B64}"/>
</g>
${rings}
<circle cx="${seal.cx}" cy="${seal.cy}" r="51" fill="none" stroke="${col('gold')}"
        stroke-opacity="0.35" stroke-width="1" stroke-dasharray="2 9" class="spin"/>
${text(C.name, 124, 124, 'display', 'gilt', { size: 21, tracking: 0.06, filter: 'glow' })}
${text(C.role, 124, 140, 'label', 'ash', { size: 8, tracking: 0.1 })}
${text('THE CATCH', 124, 154, 'label', 'brass', { size: 8, tracking: 0.16, opacity: 0.85 })}
${text(g.status, 124, 168, 'label', 'gilt', { size: 8, tracking: 0.16 })}
<path id="spine" d="M${seal.cx} 176 V420" fill="none" stroke="${col('gold')}"
      stroke-opacity="0.3" stroke-width="1" stroke-dasharray="3 7" class="flow"/>
<circle class="pkt" r="2" fill="${col('gilt')}" opacity="0">
  <animate attributeName="opacity" from="0" to="1" begin="0.05s" dur="0.01s" fill="freeze"/>
  <animateMotion dur="5s" repeatCount="indefinite"><mpath xlink:href="#spine"/></animateMotion>
</circle>
${rows}
<line x1="${left}" y1="432" x2="${right}" y2="432" stroke="${col('brass')}" stroke-opacity="0.2"/>
${text(g.caption, left, 444, 'body', 'gold', { size: 8, tracking: 0.01, upper: false })}
${text(g.punchline, left, 456, 'label', 'brass', { size: 8, tracking: 0.12 })}
${text(g.disclaimer, left, 468, 'label', 'ash', { size: 7, tracking: 0.12, opacity: 0.65 })}
`, {
    style: GRAPH_CSS,
    extraDefs: `${FRAME_DEFS}${GLOW}${BAR_FILL}
<radialGradient id="halo"><stop offset="0%" stop-color="${col('gold')}" stop-opacity="0.28"/>
<stop offset="60%" stop-color="${col('gold')}" stop-opacity="0.06"/>
<stop offset="100%" stop-color="${col('gold')}" stop-opacity="0"/></radialGradient>
<clipPath id="sealclip"><polygon points="${hex(seal.cx, seal.cy, 23)}"/></clipPath>`,
  });
}

// ── run ─────────────────────────────────────────────────────────────────────
// tools/seal/, not tools/tmp/: these two rasters are build inputs, not scratch. They live where
// the committed generator can find them, so `node tools/build.mjs` reproduces the shipped assets
// on a fresh clone without a Chrome install. mk-seal.mjs regenerates them from logo.svg.
const b64 = async (name) => existsSync(path.join(HERE, 'seal', name))
  ? (await readFile(path.join(HERE, 'seal', name))).toString('base64') : null;
SEAL_B64 = await b64('seal.png');
SEAL_POCKET_B64 = await b64('seal-pocket.png');
if (!SEAL_B64 || !SEAL_POCKET_B64) {
  console.error('  missing tools/seal/seal.png or seal-pocket.png — run: node tools/mk-seal.mjs');
  process.exit(2);
}

// Which assets get a pocket twin. `rule` and `rule-cap` carry no type, so scaling them is
// harmless and a second file would be dead weight; everything with a label under ~12 px does.
// The page is now one sheet, with a pocket twin. The retired hero, activity/tooling/shipped/
// spec plates are still in this generator for rollback, but they are not built: a dead asset is
// checkout weight and a second palette waiting to drift.
const POCKET = new Set(['hypergamy']);

async function buildSet(width) {
  setWidth(width);
  const a = {};
  a['hypergamy'] = width === T.meta.designWidth ? await hypergamySheet() : await hypergamyPocket();
  return a;
}

const assets = {};
for (const [k, v] of Object.entries(await buildSet(T.meta.designWidth))) assets[`${k}.svg`] = v;
for (const [k, v] of Object.entries(await buildSet(T.meta.pocketWidth))) {
  if (POCKET.has(k)) assets[`${k}-pocket.svg`] = v;
}
setWidth(T.meta.designWidth);

// Two different numbers, because they cost two different things. `transfer` is what one visitor
// downloads: a browser picks exactly one branch of a <picture>, so the master and the pocket set
// are alternatives, not a sum. `repo` is checkout and delivery weight for the whole folder, which
// is paid by anyone who clones it, not by anyone who reads it. The 48 KB per-asset line is set by
// the hero: four subset faces (~14 KB) plus the seal raster as base64 (~16 KB) on top of markup.
const BUDGET = { perAsset: 48_000, transfer: 160_000, repo: 320_000 };
const names = Object.keys(assets);
const pocket = names.filter((n) => n.endsWith('-pocket.svg'));
let total = 0, pocketTotal = 0, fail = 0;
console.log(`\n  asset                    bytes   faces embedded`);
console.log(`  ${'─'.repeat(76)}`);
for (const name of names) {
  const { markup, faces } = assets[name];
  const bytes = Buffer.byteLength(markup);
  total += bytes;
  if (name.endsWith('-pocket.svg')) pocketTotal += bytes;
  const over = bytes > BUDGET.perAsset;
  if (over) fail++;
  const p = path.join(OUT, name);
  const drift = existsSync(p) && (await readFile(p)).toString() !== markup;
  if (!CHECK) await mkdir(OUT, { recursive: true }), await writeFile(p, markup);
  console.log(
    `  ${name.padEnd(23)}${String(bytes).padStart(7)}   ` +
    `${over ? 'OVER BUDGET ' : 'ok         '}${CHECK && drift ? '(drift) ' : ''}${faces || '—'}`
  );
}
const transfer = Math.max(total - pocketTotal, pocketTotal);
console.log(`  ${'─'.repeat(76)}`);
console.log(`  one visitor ${String(transfer).padStart(6)} B / ${BUDGET.transfer} B  ·  whole folder ${total} B / ${BUDGET.repo} B`);
console.log(`  ${names.length} assets: ${names.length - pocket.length} master, ${pocket.length} pocket`);
if (transfer > BUDGET.transfer) { console.log('  TRANSFER OVER BUDGET'); fail++; }
if (total > BUDGET.repo) { console.log('  REPO OVER BUDGET'); fail++; }

// What this build actually pulled from the subset cache. The cache is keyed by charset hash, so
// it goes on holding faces after the copy that needed them is gone; prune-fonts.mjs deletes
// anything not listed here. Written last, so a failed build leaves the previous manifest alone.
if (!CHECK && !fail) {
  await writeFile(
    path.join(HERE, 'fonts', 'embed', 'used.json'),
    JSON.stringify([...USED].sort(), null, 1) + '\n'
  );
}

console.log(fail ? `\n  ${fail} failure(s)\n` : '\n  all within budget\n');
process.exit(fail ? 1 : 0);
