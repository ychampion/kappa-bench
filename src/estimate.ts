/**
 * bun run estimate [--bots a,b] [--cap 60] [--tasks-dir dir ...] [--with-shorts]
 *
 * A worst-case-leaning spend estimate for the standard plan: a smoke run, one
 * full pass and a reliability run (the reliability set, k = 3) per bot, each
 * attempt graded once by the grader model. Nothing is called; it multiplies a
 * per-category usage profile by list prices.
 *
 * Profile per attempt: `calls` model calls; each call re-sends the bot's fixed
 * context (system prompt and tool definitions, `base` tokens, read from cache
 * after the first call) plus everything earlier in the turn (cache reads), and
 * adds `fresh` new tokens (the message, tool results, pages) and writes `out`
 * tokens. Reminders and watches add the calls their later runs make. On top,
 * 15% for work outside any attempt (memory upkeep, titles, summaries).
 *
 * Override prices with BENCH_PRICES='{"model":{"input":..,"output":..,"cache_read":..,"cache_write":..}}'
 * and a bot's fixed context with BENCH_BASE_TOKENS_<ID>=n.
 */
import { loadBots, selectTasks } from './cli.ts';
import { loadTaskSets, PUBLIC_DIR } from './taskset.ts';
import type { Task } from './task.ts';
import { CATEGORY_LABEL, type Category } from './types.ts';
import { priceOf } from './util.ts';

type Profile = { calls: number; fresh: number; out: number; later?: { runs: number; calls: number } };
export const PROFILE: Record<Category, Profile> = {
  lookup: { calls: 4, fresh: 3000, out: 400 },
  research: { calls: 12, fresh: 5000, out: 600 },
  planning: { calls: 6, fresh: 3000, out: 900 },
  writing: { calls: 3, fresh: 1500, out: 700 },
  files_in: { calls: 5, fresh: 6000, out: 500 },
  files_out: { calls: 9, fresh: 3000, out: 900 },
  reminders: { calls: 4, fresh: 1500, out: 300, later: { runs: 2, calls: 3 } },
  monitoring: { calls: 6, fresh: 3000, out: 400, later: { runs: 2, calls: 4 } },
  memory: { calls: 6, fresh: 1500, out: 300 },
  browser: { calls: 14, fresh: 6000, out: 300 },
  short: { calls: 2, fresh: 1000, out: 200 },
};
/** Fixed context per model call, by adapter, when BENCH_BASE_TOKENS_<ID> is not set. */
const BASE: Record<string, number> = { melete: 25_000, openmausbot: 30_000 };
const BACKGROUND = 0.15;
const GRADER = { input: 4000, output: 500 };

/** Dollars for one attempt of a task category on a bot with `base` fixed context. */
export function attemptUsd(category: Category, base: number, model: string): number {
  const p = PROFILE[category];
  const price = priceOf(model);
  if (!price) throw new Error(`no price for ${model}; set BENCH_PRICES`);
  const turn = (calls: number) => {
    let usd = 0;
    for (let i = 0; i < calls; i++) {
      const cacheWrite = i === 0 ? base : p.fresh;
      const cacheRead = i === 0 ? 0 : base + (i - 1) * p.fresh;
      usd += (p.fresh * price.input + cacheRead * price.cache_read + cacheWrite * price.cache_write + p.out * price.output) / 1e6;
    }
    return usd;
  };
  return turn(p.calls) + (p.later ? p.later.runs * turn(p.later.calls) : 0);
}

export function graderUsd(model: string): number {
  const price = priceOf(model);
  if (!price) throw new Error(`no price for ${model}; set BENCH_PRICES`);
  return (GRADER.input * price.input + GRADER.output * price.output) / 1e6;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const arg = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const dirs: string[] = [];
  for (let i = 0; i < argv.length; i++) if (argv[i] === '--tasks-dir' && argv[i + 1]) dirs.push(...(argv[++i] as string).split(','));
  const cap = Number(arg('cap') ?? process.env.BENCH_CAP_USD ?? 60);
  const withShorts = argv.includes('--with-shorts');
  const bots = loadBots((arg('bots') ?? '').split(',').filter(Boolean));
  const set = await loadTaskSets(dirs.length ? dirs : [PUBLIC_DIR]);
  const graderModel = process.env.BENCH_GRADER_MODEL ?? 'claude-opus-5-5';
  const runs: { name: string; tasks: Task[]; k: number }[] = [
    { name: 'smoke', tasks: selectTasks(set.tasks, set.sets, 'smoke', false, []), k: 1 },
    { name: withShorts ? 'full pass (with shorts)' : 'full pass', tasks: selectTasks(set.tasks, set.sets, 'full', withShorts, []), k: 1 },
    { name: 'reliability', tasks: selectTasks(set.tasks, set.sets, 'reliability', false, []), k: 3 },
  ];
  const rows: string[][] = [];
  let total = 0;
  for (const run of runs) {
    let runTotal = 0;
    const cells: string[] = [];
    for (const bot of bots) {
      const model = bot.model.replace(/^.*\//, '');
      const base = Number(process.env[`BENCH_BASE_TOKENS_${bot.id.toUpperCase()}`] ?? BASE[bot.adapter] ?? 25_000);
      const usd = run.tasks.reduce((sum, t) => sum + attemptUsd(t.category, base, model), 0) * run.k * (1 + BACKGROUND);
      cells.push(`$${usd.toFixed(2)}`);
      runTotal += usd;
    }
    const graded = run.tasks.filter((t) => t.variant !== 'short').length * run.k * bots.length;
    const grade = graded * graderUsd(graderModel);
    runTotal += grade;
    total += runTotal;
    rows.push([run.name, `${run.tasks.length} x ${run.k}`, ...cells, `$${grade.toFixed(2)}`, `$${runTotal.toFixed(2)}`]);
  }
  const header = ['run', 'tasks x k', ...bots.map((b) => b.id), `grader (${graderModel})`, 'total'];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i] ?? 0)).join('  ');
  console.log(`Estimate on ${[...new Set(bots.map((b) => b.model.replace(/^.*\//, '')))].join(', ')}, task set ${set.version}; ${Math.round(BACKGROUND * 100)}% added for work outside attempts.\n`);
  console.log(line(header));
  for (const row of rows) console.log(line(row));
  console.log(`\nTotal $${total.toFixed(2)} against a $${cap.toFixed(2)} cap: ${total <= cap ? `fits, $${(cap - total).toFixed(2)} spare` : `over by $${(total - cap).toFixed(2)}`}.`);
  console.log('\nPer attempt, by category (first bot):');
  const first = bots[0];
  if (first) {
    const base = Number(process.env[`BENCH_BASE_TOKENS_${first.id.toUpperCase()}`] ?? BASE[first.adapter] ?? 25_000);
    for (const cat of Object.keys(PROFILE) as Category[]) console.log(`  ${CATEGORY_LABEL[cat].padEnd(28)} $${attemptUsd(cat, base, first.model.replace(/^.*\//, '')).toFixed(3)}`);
  }
  process.exit(total <= cap ? 0 : 1);
}
