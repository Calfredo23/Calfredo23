#!/usr/bin/env node
// Rasterize the owner's logo.svg into the seals that sit inside the hero sheets' hex plates.
//
//   node tools/mk-seal.mjs                 both, at their measured sizes
//   node tools/mk-seal.mjs <px> <name>     one
//
// logo.svg is not vector art — it is a <image> wrapper around an embedded raster, so keeping it
// as a raster is honest and re-rasterizing at the size it is actually painted is the only real
// saving available. 168 px is measured, not chosen: the sheet is authored at 840 and the seal
// image box is 120, and GitHub's profile container caps at 1216, so the widest a 100%-width
// sheet ever gets is ~1184 — 120 × 1184/840 ≈ 169 device px. Anything above that is bytes spent
// on pixels nobody sees. The pocket sheet is authored at 360 with a 66 px box, which is why it
// carries its own smaller raster rather than 15 KB of downsampled detail. Transparent background,
// so the hex clip does the shaping.
//
// Writes tools/seal/<name>.png, which build.mjs embeds as a data URI.
//
// Chrome is found in this order: $CHROME_PATH, the two usual Windows install dirs, then whatever
// `chromium`/`chrome` resolves to on PATH. This is the one step in the pipeline that needs a
// browser; everything after it is offline, which is why the rasters are committed.
//
// --screenshot is enough here even though preview.mjs needed a real-time capture: a logo has no
// animation clock to freeze.

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { SITE } from './site.mjs';

const execFileP = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = path.join(HERE, 'tmp');
const OUT = path.join(HERE, 'seal');

// name + device px, both derived above rather than picked.
const BOTH = [['seal', 168], ['seal-pocket', 92]];
const jobs = process.argv.length > 3
  ? [[String(process.argv[3]), +process.argv[2]]]
  : BOTH;

function chrome() {
  // A concrete install path beats a bare command name: on Windows there is no `chrome` on PATH
  // at all, and on the others PATH may hold a wrapper script that will not honour the flags.
  const paths = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA &&
      path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  const hit = paths.find((c) => existsSync(c));
  if (hit) return hit;
  return process.platform === 'win32' ? null : (process.env.CHROME ?? 'chromium');
}

const BIN = chrome();
if (!BIN) {
  console.error('  no Chrome found — set CHROME_PATH to your browser binary');
  process.exit(2);
}
const logo = path.join(SITE, 'logo.svg');
if (!existsSync(logo)) {
  console.error(`  no logo.svg at ${logo}`);
  process.exit(2);
}

await mkdir(TMP, { recursive: true });
await mkdir(OUT, { recursive: true });
// The page sits beside logo.svg's copy so the <img src> is a relative path, not a string
// interpolated into a URL.
await writeFile(path.join(TMP, 'logo.svg'), await readFile(logo));

for (const [name, px] of jobs) {
  const safe = name.replace(/[^a-z0-9_-]/gi, '');
  if (!safe || !Number.isFinite(+px) || +px < 1 || +px > 2048) {
    console.error(`  rejected job ${name} @ ${px}`);
    process.exit(2);
  }
  const page = path.join(TMP, `seal-${safe}.html`);
  await writeFile(
    page,
    `<!doctype html><meta charset=utf-8>` +
    `<style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}` +
    `img{display:block;width:${px}px;height:${px}px}</style><img src="logo.svg">`
  );
  const out = path.join(OUT, `${safe}.png`);
  await execFileP(BIN, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--default-background-color=00000000', `--window-size=${px},${px}`,
    `--screenshot=${out}`, 'file:///' + page.split(path.sep).join('/'),
  ]);
  const bytes = (await readFile(out)).length;
  console.log(
    `  ${safe.padEnd(12)} ${String(px).padStart(4)}px -> ${String(bytes).padStart(6)} B ` +
    `(base64 ${Math.ceil((bytes + 2) / 3) * 4} B in the sheet)`
  );
}
