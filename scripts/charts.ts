/**
 * bun run charts           writes assets/*-light.svg and assets/*-dark.svg from leaderboard/leaderboard.json
 * bun run charts --check   fails if a committed chart differs from what the leaderboard gives
 *
 * Plain SVG, no dependencies. Each chart comes in a light and a dark version on a solid background
 * (the README picks one with <picture> and prefers-color-scheme). Bots keep the same colour in every
 * chart (blue, then orange: a pair that stays apart for every common colour-vision deficiency), and
 * every bar carries its bot's name and value as text, so nothing depends on colour alone.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..');
const ASSETS = join(ROOT, 'assets');

type Theme = { surface: string; ink: string; ink2: string; muted: string; grid: string; axis: string; series: string[] };
const THEMES: Record<'light' | 'dark', Theme> = {
  light: { surface: '#fcfcfb', ink: '#0b0b0b', ink2: '#52514e', muted: '#6f6d68', grid: '#e1e0d9', axis: '#c3c2b7', series: ['#2a78d6', '#eb6834', '#1baf7a', '#6250d6'] },
  dark: { surface: '#1a1a19', ink: '#f0efec', ink2: '#c3c2b7', muted: '#a3a199', grid: '#2c2c2a', axis: '#383835', series: ['#3987e5', '#d95926', '#199e70', '#9085e9'] },
};

type Entry = {
  run: string;
  bot: string;
  product: string;
  k: number;
  scored: number;
  passed: number;
  pass_at_1: number;
  pass_hat_k: number | null;
  tasks_k: number;
  tasks_passed_every_attempt: number;
  honest: number;
  honest_attempts: number;
  ran: number;
  false_claims: number;
  silent_endings: number;
  first_text_p50_ms: number;
  first_text_p95_ms: number;
  total_p50_ms: number;
  total_p95_ms: number;
  usd_per_attempt: number;
  spend_meter: string;
  categories: Record<string, { passed: number; scored: number; pass_at_1: number; core: boolean }>;
};
type Board = { name: string; updated: string; model: string; category_labels: Record<string, string>; entries: Entry[] };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const pct = (n: number) => `${Math.round(n * 100)}%`;
const secs = (ms: number) => `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
const FONT = `font-family="system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"`;

type Bar = { series: number; value: number; label: string; title: string; whisker?: number };
type Group = { label: string; bars: Bar[] };

const W = 760;
const PAD = 24;
const BAR = 18;
const GAP = 4;

/** A bar with a 4px rounded end at the data end and a square end at the baseline. */
function bar(x: number, y: number, w: number, h: number, fill: string) {
  if (w <= 0) return '';
  const r = Math.min(4, w, h / 2);
  return `<path d="M${x},${y}h${w - r}a${r},${r} 0 0 1 ${r},${r}v${h - 2 * r}a${r},${r} 0 0 1 -${r},${r}h-${w - r}z" fill="${fill}"/>`;
}

/** Horizontal grouped bars on one shared axis. Returns the SVG body and its height. */
function panel(t: Theme, top: number, title: string, subtitle: string, groups: Group[], max: number, ticks: number[], tick: (n: number) => string, labelRoom = 230) {
  const x0 = PAD;
  const plotW = W - PAD * 2 - labelRoom;
  const sx = (v: number) => x0 + (Math.min(v, max) / max) * plotW;
  const out: string[] = [];
  let y = top;
  out.push(`<text x="${x0}" y="${y + 16}" font-size="16" font-weight="600" fill="${t.ink}">${esc(title)}</text>`);
  y += 24;
  if (subtitle) {
    out.push(`<text x="${x0}" y="${y + 13}" font-size="13" fill="${t.ink2}">${esc(subtitle)}</text>`);
    y += 22;
  }
  y += 8;
  const plotTop = y;
  const body: string[] = [];
  for (const g of groups) {
    body.push(`<text x="${x0}" y="${y + 12}" font-size="13" font-weight="500" fill="${t.ink2}" stroke="${t.surface}" stroke-width="5" stroke-linejoin="round" paint-order="stroke">${esc(g.label)}</text>`);
    y += 20;
    for (const b of g.bars) {
      const color = t.series[b.series] as string;
      const w = sx(b.value) - x0;
      body.push(`<g><title>${esc(b.title)}</title>`);
      body.push(bar(x0, y, w, BAR, color));
      let end = x0 + w;
      if (b.whisker !== undefined && b.whisker > b.value) {
        const xw = sx(b.whisker);
        body.push(`<line x1="${end}" y1="${y + BAR / 2}" x2="${xw}" y2="${y + BAR / 2}" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`);
        body.push(`<circle cx="${xw}" cy="${y + BAR / 2}" r="4" fill="${color}" stroke="${t.surface}" stroke-width="2"/>`);
        end = xw + 4;
      }
      body.push(`<text x="${end + 8}" y="${y + BAR / 2 + 4.5}" font-size="13" fill="${t.ink}">${esc(b.label)}</text></g>`);
      y += BAR + GAP;
    }
    y += 12;
  }
  const plotBottom = y - 12;
  const grid = ticks.map((v) => {
    const x = sx(v);
    return `<line x1="${x}" y1="${plotTop}" x2="${x}" y2="${plotBottom}" stroke="${v === 0 ? t.axis : t.grid}" stroke-width="1"/><text x="${x}" y="${plotBottom + 16}" font-size="11" fill="${t.muted}" text-anchor="middle" style="font-variant-numeric: tabular-nums">${esc(tick(v))}</text>`;
  });
  out.push(...grid, ...body);
  return { svg: out.join('\n'), height: plotBottom + 24 - top };
}

function legend(t: Theme, y: number, names: string[]) {
  let x = PAD;
  return names
    .map((n, i) => {
      const s = `<rect x="${x}" y="${y}" width="12" height="12" rx="3" fill="${t.series[i]}"/><text x="${x + 18}" y="${y + 10.5}" font-size="13" fill="${t.ink2}">${esc(n)}</text>`;
      x += 18 + n.length * 7.5 + 24;
      return s;
    })
    .join('\n');
}

function doc(t: Theme, title: string, desc: string, parts: string[], height: number) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}" role="img" aria-labelledby="t d" ${FONT}>
<title id="t">${esc(title)}</title>
<desc id="d">${esc(desc)}</desc>
<rect width="${W}" height="${height}" rx="12" fill="${t.surface}"/>
${parts.join('\n')}
</svg>
`;
}

function footer(t: Theme, y: number, text: string) {
  return `<text x="${PAD}" y="${y}" font-size="11" fill="${t.muted}">${esc(text)}</text>`;
}

export function charts(board: Board): Record<string, string> {
  const full = board.entries.filter((e) => e.run === 'full');
  const rel = board.entries.filter((e) => e.run === 'reliability');
  const bots = [...new Set(board.entries.map((e) => e.bot))];
  const names = bots.map((b) => (board.entries.find((e) => e.bot === b) as Entry).product);
  const idx = (e: Entry) => bots.indexOf(e.bot);
  const k = rel[0]?.k ?? 3;
  const source = `${board.name} · task set 1.0.0 · ${board.model} for every bot · ${board.updated} · data: leaderboard/leaderboard.json`;
  const out: Record<string, string> = {};

  for (const mode of ['light', 'dark'] as const) {
    const t = THEMES[mode];
    // 1. Headline
    {
      const groups: Group[] = [
        { label: `Full set: pass@1 (k = 1, ${full[0]?.scored} scored tasks each)`, bars: full.map((e) => ({ series: idx(e), value: e.pass_at_1, label: `${e.product}  ${pct(e.pass_at_1)} (${e.passed}/${e.scored})`, title: `${e.product}, full set pass@1: ${pct(e.pass_at_1)}, ${e.passed} of ${e.scored}` })) },
        { label: `Reliability subset: pass^${k} (${rel[0]?.tasks_k} tasks, each run ${k} times)`, bars: rel.map((e) => ({ series: idx(e), value: e.pass_hat_k ?? 0, label: `${e.product}  ${pct(e.pass_hat_k ?? 0)} (${e.tasks_passed_every_attempt}/${e.tasks_k} tasks)`, title: `${e.product}, reliability pass^${k}: ${e.tasks_passed_every_attempt} of ${e.tasks_k} tasks passed all ${k} attempts` })) },
        { label: `Reliability subset: pass@1 (${rel[0]?.scored} attempts)`, bars: rel.map((e) => ({ series: idx(e), value: e.pass_at_1, label: `${e.product}  ${pct(e.pass_at_1)} (${e.passed}/${e.scored})`, title: `${e.product}, reliability pass@1: ${e.passed} of ${e.scored} attempts` })) },
      ];
      const p = panel(t, 56, 'How often each bot got the job done', 'Share passed. pass^k counts a task only when every one of its k attempts passed.', groups, 1, [0, 0.25, 0.5, 0.75, 1], pct);
      const h = 56 + p.height + 30;
      out[`headline-${mode}.svg`] = doc(t, 'κ-bench Core leaderboard: pass@1 and pass^k', groups.flatMap((g) => g.bars.map((b) => b.title)).join('. '), [legend(t, 24, names), p.svg, footer(t, h - 14, source)], h);
    }
    // 2. Categories (full set)
    {
      const cats = Object.keys(full[0]?.categories ?? {});
      const groups: Group[] = cats.map((c) => ({
        label: `${board.category_labels[c] ?? c}${full[0]?.categories[c]?.core ? '' : ' (non-core)'}`,
        bars: full.map((e) => {
          const s = e.categories[c] as Entry['categories'][string];
          return { series: idx(e), value: s.pass_at_1, label: `${e.product}  ${s.passed}/${s.scored}`, title: `${e.product}, ${board.category_labels[c] ?? c}: ${s.passed} of ${s.scored} passed` };
        }),
      }));
      const p = panel(t, 56, 'Pass rate by category, full set (k = 1)', 'Four tasks per category, so one task moves a bar by 25 points (monitoring: 3 scored; short asks: 22).', groups, 1, [0, 0.25, 0.5, 0.75, 1], pct, 190);
      const h = 56 + p.height + 30;
      out[`categories-${mode}.svg`] = doc(t, 'κ-bench Core: pass rate by category', groups.flatMap((g) => g.bars.map((b) => b.title)).join('. '), [legend(t, 24, names), p.svg, footer(t, h - 14, source)], h);
    }
    // 3. Honesty, latency, cost
    {
      const parts: string[] = [legend(t, 24, names)];
      let y = 56;
      const honesty = panel(
        t,
        y,
        'Honesty, full set',
        'Attempts with no false claim (saying it did something it did not) and no silent ending.',
        [{ label: 'Honest attempts', bars: full.map((e) => ({ series: idx(e), value: e.honest, label: `${e.product}  ${pct(e.honest)} (${e.honest_attempts}/${e.ran}; ${e.false_claims} false claims, ${e.silent_endings} silent)`, title: `${e.product}: ${e.honest_attempts} of ${e.ran} attempts honest, ${e.false_claims} false claims, ${e.silent_endings} silent endings` })) }],
        1,
        [0, 0.25, 0.5, 0.75, 1],
        pct,
        330,
      );
      parts.push(honesty.svg);
      y += honesty.height + 20;
      const maxS = Math.ceil(Math.max(...full.map((e) => e.total_p95_ms)) / 10_000) * 10;
      const lat = panel(
        t,
        y,
        'Speed, full set (seconds, lower is better)',
        'Bar to the median (p50); line to the 95th percentile (p95).',
        [
          { label: 'First answer text', bars: full.map((e) => ({ series: idx(e), value: e.first_text_p50_ms / 1000, whisker: e.first_text_p95_ms / 1000, label: `${e.product}  p50 ${secs(e.first_text_p50_ms)} · p95 ${secs(e.first_text_p95_ms)}`, title: `${e.product}, first answer text: p50 ${secs(e.first_text_p50_ms)}, p95 ${secs(e.first_text_p95_ms)}` })) },
          { label: 'Whole turn', bars: full.map((e) => ({ series: idx(e), value: e.total_p50_ms / 1000, whisker: e.total_p95_ms / 1000, label: `${e.product}  p50 ${secs(e.total_p50_ms)} · p95 ${secs(e.total_p95_ms)}`, title: `${e.product}, whole turn: p50 ${secs(e.total_p50_ms)}, p95 ${secs(e.total_p95_ms)}` })) },
        ],
        maxS,
        Array.from({ length: maxS / 10 + 1 }, (_, i) => i * 10),
        (v) => `${v} s`,
        250,
      );
      parts.push(lat.svg);
      y += lat.height + 20;
      const maxC = Math.ceil(Math.max(...board.entries.map((e) => e.usd_per_attempt)) * 50) / 50;
      const cost = panel(
        t,
        y,
        'Model spend per attempt (US$, lower is better)',
        `List prices, every model a bot called. Read from: ${[...new Map(board.entries.map((e) => [e.product, e.spend_meter === 'self' ? 'its own meter' : 'the proxy'])).entries()].map(([p, m]) => `${p}, ${m}`).join('; ')}.`,
        [
          { label: 'Full set', bars: full.map((e) => ({ series: idx(e), value: e.usd_per_attempt, label: `${e.product}  $${e.usd_per_attempt.toFixed(3)}`, title: `${e.product}, full set: $${e.usd_per_attempt.toFixed(3)} per attempt` })) },
          { label: 'Reliability subset', bars: rel.map((e) => ({ series: idx(e), value: e.usd_per_attempt, label: `${e.product}  $${e.usd_per_attempt.toFixed(3)}`, title: `${e.product}, reliability subset: $${e.usd_per_attempt.toFixed(3)} per attempt` })) },
        ],
        maxC,
        Array.from({ length: Math.round(maxC / 0.02) + 1 }, (_, i) => Math.round(i * 0.02 * 100) / 100),
        (v) => `$${v.toFixed(2)}`,
        250,
      );
      parts.push(cost.svg);
      y += cost.height + 30;
      parts.push(footer(t, y - 14, source));
      out[`honesty-speed-cost-${mode}.svg`] = doc(t, 'κ-bench Core: honesty, speed and cost', 'Honesty, latency and cost per bot on the full set and the reliability subset.', parts, y);
    }
  }
  return out;
}

if (import.meta.main) {
  const board = JSON.parse(readFileSync(join(ROOT, 'leaderboard', 'leaderboard.json'), 'utf8')) as Board;
  const files = charts(board);
  if (process.argv.includes('--check')) {
    const stale = Object.entries(files).filter(([name, svg]) => !existsSync(join(ASSETS, name)) || readFileSync(join(ASSETS, name), 'utf8').replace(/\r\n/g, '\n') !== svg);
    if (stale.length) {
      console.error(`charts out of date: ${stale.map(([n]) => n).join(', ')}. Run \`bun run charts\` and commit the result.`);
      process.exit(1);
    }
    console.log(`${Object.keys(files).length} charts match leaderboard/leaderboard.json.`);
  } else {
    mkdirSync(ASSETS, { recursive: true });
    for (const [name, svg] of Object.entries(files)) writeFileSync(join(ASSETS, name), svg);
    console.log(`wrote ${Object.keys(files).map((n) => `assets/${n}`).join(', ')}`);
  }
}
