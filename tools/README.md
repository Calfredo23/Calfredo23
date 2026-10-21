# tools — the generator behind `../assets`

Nothing in `assets/` is hand-drawn. Every sheet is rendered from `tokens.json` (colour, type
scale, geometry) and `content.js` (every word that appears on the page), by `build.mjs`.

**To check that claim:**

```
node tools/build.mjs --check
```

It renders both assets to memory (the hypergamy graph, master and pocket), diffs each against the
file on disk, prints `(drift)` and exits non-zero if any differ. It writes nothing.

## Why a generator at all

GitHub loads README images as `<img>`, which isolates each SVG from the network and from the
page's CSS. Measured, not assumed:

| Constraint | Consequence |
| :-- | :-- |
| `<style>`, inline `<svg>`, `style=` and `class=` are stripped from README HTML | no styled HTML typography exists in the README; type identity lives inside the committed SVGs |
| a network-isolated SVG ignores `@import` for fonts but honours an embedded base64 `@font-face` | faces are embedded, subset to the exact characters each asset draws (1–3 KB instead of 10–22 KB) |
| a `width="100%"` sheet authored at 840 px renders at ~1184 px on desktop and ~358 px on a phone | the sheet carrying type has a second version re-authored natively at 360 px, offered as a `<picture>` branch — not downscaled |
| text laid out from an average-width guess collides with rules when the copy changes | widths come from real glyph advances via `fontkit`, so `fit()` can shrink a line before it overruns its plate |

The last one is the reason this has to be code: the layout is computed from the metrics of the
exact subset face that will render, so changing a word re-flows the sheet instead of breaking it.

The `T`-numbers in the source comments name one-off probes from a throwaway render harness — each
asked GitHub's own renderer one question and was discarded once it had an answer. The harness is
not committed; the answers are, and they are reproducible from the table above.

## Scripts

| | |
| :-- | :-- |
| `build.mjs` | render + write `../assets/*`, print the size manifest, enforce the budget |
| `content.js` | every string on the page — the hypergamy graph; retired identity and section copy remains for rollback |
| `tokens.json` | palette, type roles, widths, tick geometry |
| `fonts.mjs` | asks Google's `css2` API for a subset face per character set; caches by `sha1(family\|weight\|charset)` |
| `fetch-fonts.mjs` | one-time reference metrics for the three families, used for layout before any subset exists |
| `mk-seal.mjs` | rasterize `../logo.svg` into `tools/seal/` at the two measured sizes — needs Chrome |
| `langs.mjs` | recompute the language census from the GitHub API into `langs.json`, which the ledger plate reads |
| `prune-fonts.mjs` | delete cached subsets `build.mjs` no longer asks for |
| `preview.mjs` | render the README as GitHub would, at any width, into `tools/tmp/` — nothing here ships |
| `cdp.mjs` | DevTools capture at real elapsed time (see the note below) |
| `contrast.mjs` | check every foreground/background pair against WCAG |
| `gh-tokens.mjs`, `gh-page.mjs` | fetch GitHub's served colour tokens and rendered HTML — how `tokens.json` and the constraints above were derived |
| `site.mjs` | resolve the site root, so one copy of the generator works both here and in a larger workspace |

## Making a change

```
npm --prefix tools install
node tools/build.mjs            # writes ../assets/, prints the manifest
node tools/build.mjs --check    # prove the working tree matches
```

`build.mjs` runs offline against the committed font cache in `tools/fonts/embed/` and the rasters
in `tools/seal/`. Only `mk-seal.mjs` needs a browser, and only when `logo.svg` changes;
`langs.mjs` needs network and a GitHub rate-limit window.

**Budget**, printed on every run and measured rather than guessed: 48 KB per asset, 160 KB per
visitor (the larger of the two `<picture>` branches — a reader downloads exactly one), 320 KB for
the whole folder — the motto band rides the same branch logic, so a visitor downloads one
band + one graph. Currently 59,001 B / 113,834 B.

The hero and the retired activity, field-work, tooling, shipped and specification sheets were
removed from the page on 2026-10-21. Their generators remain in `build.mjs` and their copy remains
in `content.js` for rollback, but `buildSet()` no longer builds them: a dead asset is checkout
weight and a second palette waiting to drift.

## One trap worth knowing about

`chrome --headless --screenshot` runs on virtual time and freezes every animation clock at t=0,
so a card that animates in looks empty and you will debug something that isn't broken.
`cdp.mjs` is why `preview.mjs` exists: it attaches over the DevTools WebSocket and captures at
real wall-clock offsets. Also measured there: a CDP `clip` without `captureBeyondViewport: true`
is viewport-relative, not document-relative, which is how a "blank" page band is produced.
