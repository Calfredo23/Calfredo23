// Two homes for one tree.
//
// In the drafting workspace the profile is profile-repo/ sitting inside a larger project. In the
// published repo (Calfredo23/Calfredo23) the profile *is* the root. Resolving against whichever
// layout is present means one copy of the generator serves both — the alternative is a forked
// build script, and a forked build script is how committed assets and the code that claims to
// produce them stop agreeing.
//
// HERE is tools/ either way, so tools/tokens.json, tools/content.js and tools/fonts/ need no
// resolution and mk-seal.mjs finds logo.svg beside the site root in both layouts.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const TOOLS = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
export const SITE = existsSync(path.join(TOOLS, '..', 'profile-repo'))
  ? path.join(TOOLS, '..', 'profile-repo')
  : path.resolve(TOOLS, '..');
export const ASSETS = path.join(SITE, 'assets');
