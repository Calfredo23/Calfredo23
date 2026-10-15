// WCAG 2.x contrast audit for the profile palette.
// Run: node tools/contrast.mjs
// The palette is chosen against measured ratios, not estimated ones, so the measurement lives
// in the repo beside the tokens it judges.
const hex = (h) => {
  const s = h.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
};
const lin = (c) => {
  c /= 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const L = (h) => {
  const [r, g, b] = hex(h);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const ratio = (a, b) => {
  const [x, y] = [L(a), L(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};

const { color } = JSON.parse(
  await import('node:fs/promises').then(({ readFile }) =>
    readFile(new URL('./tokens.json', import.meta.url), 'utf8')
  )
);

const bgs = ['sheet', 'plate', 'block', 'recess'];
const fgs = ['bone', 'ash', 'gilt', 'gold', 'brass'];
const MIN_TEXT = 4.5;

let worst = { r: Infinity };
console.log(`${'fg'.padEnd(6)}${bgs.map((b) => b.padStart(9)).join('')}`);
for (const f of fgs) {
  const row = bgs.map((b) => {
    const r = ratio(color[f], color[b]);
    if (r < worst.r) worst = { r, f, b };
    return `${r.toFixed(2)}${r >= MIN_TEXT ? ' ' : '!'}${''.padStart(3)}`.padStart(9);
  });
  console.log(`${f.padEnd(6)}${row.join('')}`);
}
console.log(`\nworst-case text composite: ${worst.f} on ${worst.b} = ${worst.r.toFixed(2)}:1`);
console.log(worst.r >= MIN_TEXT ? 'AA pass for all body text' : 'AA FAIL — raise the pair');
for (const b of bgs) console.log(`  ${b} vs bone: ${ratio(color.bone, color[b]).toFixed(2)}:1`);
