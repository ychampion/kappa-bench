/**
 * bun run leaderboard           builds leaderboard/leaderboard.json from the published run folders
 * bun run leaderboard --check   fails if the committed file differs from what the run folders give
 *
 * Every number comes from a committed run.json (`results/...`), computed with the same `stats()` the
 * report uses. `leaderboard/sources.json` names the run folders and holds the notes that go with each
 * bot. The schema is documented in docs/LEADERBOARD.md.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { type RunInfo, scoredOutcome, stats } from '../src/report.ts';
import { CATEGORIES, CATEGORY_LABEL, CORE_CATEGORIES, type Category, type JobRecord } from '../src/types.ts';
import { percentile } from '../src/util.ts';

const ROOT = resolve(import.meta.dir, '..');
export const LEADERBOARD = join(ROOT, 'leaderboard', 'leaderboard.json');

type Sources = {
  suite: string;
  runs: { run: string; results: string; about: string }[];
  bots: Record<string, { metering: string; notes: string[] }>;
  run_notes: string[];
};

const round = (n: number | null, places = 4) => (n === null ? null : Math.round(n * 10 ** places) / 10 ** places);

function entry(src: Sources, run: Sources['runs'][number], info: RunInfo, records: JobRecord[], bot: string) {
  const mine = records.filter((r) => r.bot === bot);
  const s = stats(mine, info.repeat);
  const p = info.bots.find((b) => b.bot === bot);
  if (!p) throw new Error(`${run.results}: no bot ${bot}`);
  const config = JSON.parse(readFileSync(join(ROOT, 'bots', `${bot}.json`), 'utf8')) as { homepage?: string };
  const ran = mine.filter((r) => r.steps.length > 0);
  const firstText = ran.map((r) => r.first_text_ms).filter((n): n is number => n !== null);
  const scored = mine.filter(scoredOutcome);
  const byTask = new Map<string, JobRecord[]>();
  for (const r of scored) byTask.set(r.task, [...(byTask.get(r.task) ?? []), r]);
  const categories: Record<string, { passed: number; scored: number; pass_at_1: number | null; core: boolean }> = {};
  for (const c of [...CATEGORIES, 'short' as Category]) {
    const rs = scored.filter((r) => r.category === c);
    if (!rs.length) continue;
    categories[c] = { passed: rs.filter((r) => r.outcome === 'pass').length, scored: rs.length, pass_at_1: round(stats(rs, info.repeat).pass_at_1), core: CORE_CATEGORIES.includes(c) };
  }
  const tag = info.spend.tags[bot];
  const otherModels = Object.fromEntries(Object.entries(tag?.models ?? {}).filter(([m, n]) => n > 0 && m !== '(none)' && m !== (p.model ?? info.model).replace(/^.*\//, '')));
  return {
    suite: src.suite,
    task_set: info.setVersion,
    run: run.run,
    date: info.date,
    k: info.repeat,
    bot,
    product: p.product,
    homepage: config.homepage ?? null,
    version: p.version,
    commit: p.commit ?? null,
    model: (p.model ?? info.model).replace(/^.*\//, ''),
    other_models_called: otherModels,
    settings: p.settings,
    spend_meter: info.spend.meters?.[bot] ?? 'proxy',
    metering: src.bots[bot]?.metering ?? '',
    grader: info.grader,
    results: run.results,
    rescored: Boolean(info.rescored),
    attempts: s.attempts,
    scored: s.scored,
    passed: scored.filter((r) => r.outcome === 'pass').length,
    pass_at_1: round(s.pass_at_1),
    tasks_k: s.tasks_k,
    tasks_passed_every_attempt: [...byTask.values()].filter((rs) => rs.length >= info.repeat && rs.every((r) => r.outcome === 'pass')).length,
    pass_hat_k: info.repeat > 1 ? round(s.pass_hat_k) : null,
    honest: round(s.honest),
    honest_attempts: ran.filter((r) => !r.honesty.claims.length && !r.honesty.silent).length,
    ran: ran.length,
    false_claims: s.false_claims,
    silent_endings: s.silent_endings,
    long_silences: s.long_silences,
    stalls: s.stalls,
    crashes: s.crashes,
    first_output_p50_ms: s.first_output_p50,
    first_output_p95_ms: s.first_output_p95,
    first_text_p50_ms: percentile(firstText, 50),
    first_text_p95_ms: percentile(firstText, 95),
    total_p50_ms: s.total_p50,
    total_p95_ms: s.total_p95,
    usd_per_attempt: round(s.usd_per_task),
    usd_total: round(s.usd_total),
    categories,
    notes: [...(src.bots[bot]?.notes ?? []), ...src.run_notes],
  };
}

export function build() {
  const src = JSON.parse(readFileSync(join(ROOT, 'leaderboard', 'sources.json'), 'utf8')) as Sources;
  const entries = [];
  let date = '';
  let model = '';
  for (const run of src.runs) {
    const path = join(ROOT, run.results, 'run.json');
    if (!existsSync(path)) throw new Error(`missing ${run.results}/run.json`);
    const { info, records } = JSON.parse(readFileSync(path, 'utf8')) as { info: RunInfo; records: JobRecord[] };
    if (info.dryRun) throw new Error(`${run.results} is a dry run; dry runs never enter the leaderboard`);
    for (const p of info.bots) entries.push(entry(src, run, info, records, p.bot));
    if (info.date > date) date = info.date;
    model = info.model;
  }
  return {
    schema: 1,
    name: src.suite,
    updated: date,
    model,
    category_labels: CATEGORY_LABEL,
    runs: src.runs,
    entries,
  };
}

const text = (board: unknown) => `${JSON.stringify(board, null, 2)}\n`;

export const LEADERBOARD_MD = join(ROOT, 'docs', 'LEADERBOARD.md');

type Board = ReturnType<typeof build>;
const pct = (n: number | null) => (n === null ? '-' : `${Math.round(n * 100)}%`);
const secs = (ms: number | null) => (ms === null ? '-' : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`);
const usd = (n: number | null) => (n === null ? '-' : `$${n.toFixed(3)}`);
const row = (cells: string[]) => `| ${cells.join(' | ')} |`;
const head = (cells: string[], numeric = true) => [row(cells), `|${cells.map((_, i) => (i === 0 || !numeric ? ' --- ' : ' ---: ')).join('|')}|`].join('\n');
const cell = (s: string) => s.replace(/\s+/g, ' ').replace(/\|/g, '/');

/** Every attempt that did not pass, from the run folder, with its reason. */
function misses(results: string, bot: string): string[] {
  const { records } = JSON.parse(readFileSync(join(ROOT, results, 'run.json'), 'utf8')) as { records: JobRecord[] };
  return records
    .filter((r) => r.bot === bot && r.outcome !== 'pass')
    .map((r) => {
      const transcript = `${results}/transcripts/${bot}/${r.task}-r${r.repeat}.txt`;
      const link = existsSync(join(ROOT, transcript)) ? ` ([transcript](../${transcript}))` : '';
      return `- \`${r.task}\` r${r.repeat} (${CATEGORY_LABEL[r.category]}, ${r.outcome === 'skipped' ? 'skipped, not scored' : r.outcome}): ${cell(r.reason).slice(0, 280)}${link}`;
    });
}

export function markdown(board: Board): string {
  const out: string[] = [];
  out.push(`# ${board.name} leaderboard`, '');
  out.push(
    `Updated ${board.updated}. Model: \`${board.model}\` for every bot. Generated by \`bun run leaderboard\` from the run folders below; the canonical data is [\`leaderboard/leaderboard.json\`](../leaderboard/leaderboard.json). Do not edit this file by hand.`,
    '',
    'Compare entries only when the task set, model, run and k match. Rates are rounded to whole percents here; the JSON keeps four decimals and the raw counts. The stored answers were re-scored after check fixes: see [METHODOLOGY.md](METHODOLOGY.md#re-scoring).',
    '',
  );
  for (const r of board.runs) {
    const entries = board.entries.filter((e) => e.run === r.run);
    const k = entries[0]?.k ?? 1;
    out.push(`## ${r.run === 'full' ? 'Full set' : r.run === 'reliability' ? 'Reliability subset' : r.run} (k = ${k})`, '', r.about, '', `Results: [\`${r.results}\`](../${r.results}/), [report](../${r.results}/report.md).`, '');
    out.push(head(['bot', 'version', 'pass@1', `pass^${k}`, 'honest', 'false claims', 'silent endings', 'first text p50 / p95', 'turn p50 / p95', '$ / attempt']));
    for (const e of entries)
      out.push(
        row([
          e.product,
          `${e.version} (${e.commit})`,
          `${pct(e.pass_at_1)} (${e.passed}/${e.scored})`,
          k > 1 ? `${pct(e.pass_hat_k)} (${e.tasks_passed_every_attempt}/${e.tasks_k})` : '-',
          `${pct(e.honest)} (${e.honest_attempts}/${e.ran})`,
          String(e.false_claims),
          String(e.silent_endings),
          `${secs(e.first_text_p50_ms)} / ${secs(e.first_text_p95_ms)}`,
          `${secs(e.total_p50_ms)} / ${secs(e.total_p95_ms)}`,
          usd(e.usd_per_attempt),
        ]),
      );
    out.push('', '### By category (passed / scored)', '');
    out.push(head(['category', ...entries.map((e) => e.product)]));
    for (const c of Object.keys(entries[0]?.categories ?? {})) {
      const core = entries[0]?.categories[c]?.core;
      out.push(row([`${board.category_labels[c as Category] ?? c}${core ? '' : ' (non-core)'}`, ...entries.map((e) => (e.categories[c] ? `${e.categories[c]?.passed}/${e.categories[c]?.scored}` : '-'))]));
    }
    out.push('', '### Attempts that did not pass', '');
    for (const e of entries) {
      const m = misses(r.results, e.bot);
      out.push(`**${e.product}**`, '', ...(m.length ? m : ['None.']), '');
    }
  }
  out.push('## Configuration of each entry', '');
  for (const e of board.entries) {
    out.push(`### ${e.product}, ${e.run}`, '');
    out.push(head(['field', 'value'], false));
    const fields: [string, string][] = [
      ['bot', `\`${e.bot}\`, ${e.homepage}`],
      ['version / commit', `${e.version} / ${e.commit}`],
      ['model', `\`${e.model}\`${Object.keys(e.other_models_called).length ? `; also called ${Object.entries(e.other_models_called).map(([m, n]) => `\`${m}\` (${n} calls)`).join(', ')}` : ''}`],
      ['date', e.date],
      ['task set', `${e.task_set} (${e.suite})`],
      ['run, k', `${e.run}, k = ${e.k}`],
      ['grader', e.grader],
      ['spend read from', e.spend_meter === 'self' ? "the bot's own meter" : 'the metering proxy'],
      ['metering', e.metering],
      ['re-scored', e.rescored ? 'yes (see the report)' : 'no'],
      ['results', `[\`${e.results}\`](../${e.results}/)`],
      ...Object.entries(e.settings).map(([key, v]) => [`setting: ${key}`, String(v)] as [string, string]),
    ];
    for (const [key, v] of fields) out.push(row([key, cell(v)]));
    out.push('', 'Notes:', '', ...e.notes.map((n) => `- ${n}`), '');
  }
  out.push('## Schema', '');
  out.push(
    '`leaderboard/leaderboard.json`, schema 1. Top level: `schema`, `name`, `updated` (latest run date), `model`, `category_labels`, `runs` (the run folders, from `leaderboard/sources.json`) and `entries`, one per bot per run:',
    '',
  );
  out.push(head(['fields', 'meaning'], false));
  const schema: [string, string][] = [
    ['suite, task_set, run, date, k', 'The suite and task-set version, the run (`full` or `reliability`), its date and the repeats per task.'],
    ['bot, product, homepage, version, commit', "The bot as its preflight reported it, and its config in `bots/<id>.json`."],
    ['model, other_models_called', 'The model under test, and any other model the meter saw the bot call, with call counts.'],
    ['settings, spend_meter, metering', 'The settings the bench used, where spend was read (`proxy` or `self`) and how.'],
    ['grader, results, rescored', 'The grader model, the run folder every number comes from, and whether the run was re-scored.'],
    ['attempts, scored, passed', 'Attempts made, attempts counted in the rates, attempts passed.'],
    ['pass_at_1', 'Share of attempts passed, averaged per task (0 to 1).'],
    ['tasks_k, tasks_passed_every_attempt, pass_hat_k', 'Tasks with all k attempts scored, how many passed every one, and that share (null when k = 1).'],
    ['honest, honest_attempts, ran', 'Share and count of attempts with no false claim and no silent ending, over attempts that ran.'],
    ['false_claims, silent_endings, long_silences, stalls, crashes', 'Counts over the run.'],
    ['first_output_p50_ms, first_output_p95_ms, first_text_p50_ms, first_text_p95_ms, total_p50_ms, total_p95_ms', 'Time to the first visible output, to the first answer text, and to the end of the turn.'],
    ['usd_per_attempt, usd_total', 'Model spend per costed attempt and in total, at list prices, in US dollars.'],
    ['categories', 'Per category: `passed`, `scored`, `pass_at_1`, and whether it is a `core` category.'],
    ['notes', 'Everything a reader needs to know about this entry.'],
  ];
  for (const [k, v] of schema) out.push(row([k.split(', ').map((f) => `\`${f}\``).join(', '), v]));
  out.push('');
  return out.join('\n');
}

if (import.meta.main) {
  const board = build();
  const files: [string, string][] = [
    [LEADERBOARD, text(board)],
    [LEADERBOARD_MD, markdown(board)],
  ];
  if (process.argv.includes('--check')) {
    const stale = files.filter(([path, want]) => (existsSync(path) ? readFileSync(path, 'utf8').replace(/\r\n/g, '\n') : '') !== want);
    if (stale.length) {
      console.error(`out of date: ${stale.map(([p]) => p.slice(ROOT.length + 1)).join(', ')}. Run \`bun run leaderboard\` and commit the result.`);
      process.exit(1);
    }
    console.log('leaderboard/leaderboard.json and docs/LEADERBOARD.md match the published runs.');
  } else {
    for (const [path, want] of files) writeFileSync(path, want);
    console.log('wrote leaderboard/leaderboard.json and docs/LEADERBOARD.md');
  }
}
