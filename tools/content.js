// The only place a word is written for this profile.
// Every string here is either transcribed from details.txt or is a measured fact — with one
// deliberate exception: the hypergamy graph's shares are authored for the joke, and the asset
// prints "percentages are vibes, not telemetry" on its own face. Nothing is passed off as data.
// tools/build.mjs reads this and nothing else for copy.

export const identity = {
  // Handle engraved across the middle of the sheet; the legal name runs as the header rail at
  // the top, the way a drawing names its owner above the field rather than under the title.
  name: 'CALFREDO',
  legal: 'CEDRICK ALFREDO CATIMBANG',
  role: 'FULL-STACK DEV · IT INFRASTRUCTURE',
  motto: '“Meticulous Craftsmanship as Silent Virtue”',
  signature: 'C. A. CATIMBANG',
};

// ISO title block, bottom of the hero sheet. Three columns, two rows.
export const titleBlock = {
  dwg: 'CAL-PRF-2026-01',
  material: 'MARKDOWN + SVG / DARK',
  finish: 'DRAFTED, NOT ASSEMBLED',
  // The sheet is authored at 840 but GitHub stretches it to the container, so it is genuinely
  // not to scale — N.T.S. is the drafting term for that and it is the honest one here.
  scale: 'N.T.S. · 840 PX MASTER',
  location: 'LUCENA CITY, PH · UTC+8',
  rev: 'A · 2026-10-15',
};

// Right-hand margin note block. Short so it never collides with the caption line.
export const hud = [
  'STATUS: OPEN TO WORK',
  'EXP: 3+ YRS',
  'DISC: BSIT · GPA 3.7',
  'CSPE: PASSED 2026',
  'CN: PNP IT · 2025–26',
];

export const sections = [
  { id: 'activity', label: 'ACTIVITY',      sub: 'SUSTAINED, NOT PERFORMED' },
  { id: 'field',    label: 'FIELD WORK',    sub: 'INFRASTRUCTURE ACTUALLY BUILT' },
  { id: 'tooling',  label: 'TOOLING',       sub: 'THE RACK' },
  { id: 'shipped',  label: 'SHIPPED',       sub: 'SEVEN ARTIFACTS · OPEN TO INSPECTION' },
  { id: 'spec',     label: 'SPECIFICATION', sub: 'EDUCATION · LICENSURE · TRACK' },
];

export const racks = [
  { id: 'languages', label: 'LANGUAGES', items: [
    'Python', 'TypeScript', 'JavaScript', 'SQL', 'Embedded C',
  ] },
  { id: 'web', label: 'WEB & SOFTWARE', items: [
    'React', 'Django', 'Next.js', 'React Native', 'Astro', 'Flask',
    'Tailwind CSS', 'HTML5', 'CSS3', 'Cloudinary',
  ] },
  { id: 'data', label: 'DATA', items: [
    'PostgreSQL', 'MongoDB', 'Supabase', 'Convex', 'Data Cleaning', 'Excel',
  ] },
  { id: 'systems', label: 'SYSTEMS & NETWORKING', items: [
    'Cisco LAN', 'OS Config', 'VirtualBox', 'Arduino Uno', 'Hardware', 'Cybersecurity',
  ] },
  { id: 'craft', label: 'CRAFT & DOCUMENTATION', items: [
    'Figma', 'Lucidchart', 'SketchUp', 'Git', 'ClickUp', 'Tech Docs', 'Claude Code',
  ] },
];

// Measured 2026-10-15 from the text nodes of https://streak-stats.demolab.com?user=Calfredo23
// (the hosted card itself is NOT embedded — it hardcodes #FFFEFE/#151515 and ignores every
// colour parameter, so it cannot be brought to the sheet palette; only theme= works, and no
// theme is near it). The numbers are re-read by .github/workflows/plate.yml.
export const plate = {
  asOf: '2026-10-15',
  gauges: [
    { value: '1,297', label: 'CONTRIBUTIONS', span: 'MAY 2023 → PRESENT' },
    { value: '99', label: 'CURRENT STREAK', span: 'JUL 8 → OCT 14' },
    { value: '99', label: 'LONGEST STREAK', span: 'JUL 8 → OCT 14' },
  ],
  source: 'GITHUB CONTRIBUTION DATA',
};

// FIELD WORK is the one asset no generator can produce. It draws a network he actually built,
// so the node list must come from him — a plausible-looking topology invented here would be the
// single most damaging lie on the page. Null until the owner supplies the survey.
// Shape it needs:
//   { caption, nodes:[{id,label,kind:'cloud|router|switch|ap|server|client|firewall'}],
//     links:[{a,b,kind:'wireless|fiber|copper',label}], zones:[{label,x,y,w,h}] }
export const topology = null;

// THE HYPERGAMY GRAPH. A parody of the two-panel "hypergamy chart" meme, applied to stacks:
// the joke is that attention does not distribute evenly across a generalist's interests.
// These percentages are AUTHORED FOR THE JOKE, not measured — the asset says so on its own face
// ("percentages are vibes, not telemetry"), which is the condition for drawing them at all.
// Relationship-status lines describe technologies, never people. Keep it self-deprecating.
export const hypergamy = {
  kicker: 'ATTENTION TOPOLOGY',
  titleA: 'THE ',
  titleB: 'HYPERGAMY',
  titleC: ' GRAPH',
  subtitle: 'A totally scientific diagram of where a full-stack developer\'s attention actually goes.',
  note: 'NO DISCIPLINE WAS HARMED.',
  dwg: 'CAL-PRF-2026-02',
  rev: 'B · 2026-10-21',
  status: 'OPEN TO WORK',
  joke: '100% COMMITMENT ISSUES',
  caption: 'HYPERGAMY (n.) — dating up. Applied to stacks: refusing to specialize.',
  punchline: 'TOUCHING GRASS: 0% — NOT PICTURED.',
  disclaimer: 'PERCENTAGES ARE VIBES, NOT TELEMETRY.',
  // pct values are chart shares and sum to 100.
  nodes: [
    { id: 'ai',      label: 'AI',             status: 'the situationship',        pct: 41, icon: 'spark'  },
    { id: 'code',    label: 'PROGRAMMING',    status: 'the long-term commitment',  pct: 27, icon: 'code'   },
    { id: 'design',  label: 'UI/UX',          status: 'the side quest',            pct: 14, icon: 'cursor' },
    { id: 'infra',   label: 'INFRASTRUCTURE', status: 'the ex I still text',       pct: 9,  icon: 'rack'   },
    { id: 'data',    label: 'DATA',           status: 'the friendzone',            pct: 6,  icon: 'db'     },
    { id: 'sleep',   label: 'SLEEP',          status: 'blocked',                   pct: 3,  icon: 'moon'   },
  ],
};

export default {
  ...identity,
  dwg: titleBlock.dwg,
  material: titleBlock.material,
  finish: titleBlock.finish,
  scale: titleBlock.scale,
  location: titleBlock.location,
  rev: titleBlock.rev,
  hud,
  plate,
  sections,
  racks,
  topology,
  hypergamy,
};
