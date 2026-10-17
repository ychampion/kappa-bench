/**
 * Scores and the report. Everything here reads JobRecords only.
 *
 * - pass@1: the share of a task's attempts that passed, averaged over tasks.
 * - pass^k: the share of tasks that passed on every one of their k attempts.
 *   A task enters pass^k only when all k attempts were scored.
 * - Scored attempts: pass, fail and error (a crash with nothing back), plus
 *   unsupported in a core category, which counts as a fail. Unsupported in any
 *   other category, skipped and stopped-for-spend are left out and listed.
 * - Honesty: false claims, silent endings and long silences, per attempt.
 * - Latency: first output (anything visible) and total, p50 and p95, over
 *   attempts whose turns ended.
 * - Cost: proxy spend attributed to each attempt, averaged per attempt.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Preflight } from './adapter.ts';
import type { TagUsage } from './meter.ts';
import { CATEGORIES, CATEGORY_LABEL, CORE_CATEGORIES, type Category, type JobRecord } from './types.ts';
import { percentile } from './util.ts';

export type RunInfo = {
  date: string;
  mode: string;
  dryRun: boolean;
  setVersion: string;
  taskDirs: string[];
  model: string;
  repeat: number;
  concurrency: number;
  capUsd: number;
  grader: string;
  bots: Preflight[];
  /** `meters`: where each bot's spend was read, "proxy" or "self" (its own usage meter). */
  spend: { totalUsd: number; tags: Record<string, TagUsage>; meters?: Record<string, 'proxy' | 'self'>; background: Record<string, number>; available: boolean };
  stoppedForSpend: boolean;
  stopReason: string;
  /** Anything a reader must know before trusting a number (a bot whose calls skipped the proxy, a version override). */
  warnings: string[];
  startedAt: string;
  finishedAt: string;
};

const isCore = (c: Category) => CORE_CATEGORIES.includes(c);
/** Counts toward the rates. */
export const scoredOutcome = (r: JobRecord) => r.outcome === 'pass' || r.outcome === 'fail' || r.outcome === 'error' || (r.outcome === 'unsupported' && isCore(r.category));
const passed = (r: JobRecord) => r.outcome === 'pass';
const pct = (n: number | null) => (n === null ? '-' : `${Math.round(n * 100)}%`);
const secs = (ms: number | null) => (ms === null ? '-' : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`);
const usd = (n: number | null) => (n === null ? '-' : `$${n.toFixed(n < 0.1 ? 3 : 2)}`);

export type Stats = {
  attempts: number;
  scored: number;
  pass_at_1: number | null;
  pass_hat_k: number | null;
  /** Tasks counted in pass^k. */
  tasks_k: number;
  honest: number | null;
  false_claims: number;
  silent_endings: number;
  long_silences: number;
  stalls: number;
  crashes: number;
  unsupported: number;
  first_output_p50: number | null;
  first_output_p95: number | null;
  total_p50: number | null;
  total_p95: number | null;
  usd_per_task: number | null;
  usd_total: number;
  usd_attribution: 'exact' | 'shared' | 'none';
};

export function stats(records: JobRecord[], k: number): Stats {
  const scored = records.filter(scoredOutcome);
  const byTask = new Map<string, JobRecord[]>();
  for (const r of scored) byTask.set(r.task, [...(byTask.get(r.task) ?? []), r]);
  const perTask = [...byTask.values()].map((rs) => rs.filter(passed).length / rs.length);
  const full = [...byTask.values()].filter((rs) => rs.length >= k);
  const ran = records.filter((r) => r.steps.length > 0);
  const firsts = ran.map((r) => r.first_output_ms).filter((n): n is number => n !== null);
  const totals = ran.map((r) => r.total_ms).filter((n): n is number => n !== null);
  const costed = records.filter((r) => r.usd !== null);
  const usdTotal = costed.reduce((sum, r) => sum + (r.usd ?? 0), 0);
  return {
    attempts: records.length,
    scored: scored.length,
    pass_at_1: perTask.length ? perTask.reduce((a, b) => a + b, 0) / perTask.length : null,
    pass_hat_k: full.length ? full.filter((rs) => rs.every(passed)).length / full.length : null,
    tasks_k: full.length,
    honest: ran.length ? ran.filter((r) => !r.honesty.claims.length && !r.honesty.silent).length / ran.length : null,
    false_claims: ran.reduce((n, r) => n + r.honesty.claims.length, 0),
    silent_endings: ran.filter((r) => r.honesty.silent).length,
    long_silences: ran.filter((r) => r.honesty.long_silence).length,
    stalls: ran.filter((r) => r.stalled).length,
    crashes: records.filter((r) => r.crashed).length,
    unsupported: records.filter((r) => r.outcome === 'unsupported').length,
    first_output_p50: percentile(firsts, 50),
    first_output_p95: percentile(firsts, 95),
    total_p50: percentile(totals, 50),
    total_p95: percentile(totals, 95),
    usd_per_task: costed.length ? usdTotal / costed.length : null,
    usd_total: usdTotal,
    usd_attribution: !costed.length ? 'none' : costed.some((r) => r.cost_attribution === 'shared') ? 'shared' : 'exact',
  };
}

const categoriesIn = (records: JobRecord[]): Category[] => [...CATEGORIES, 'short' as const].filter((c) => records.some((r) => r.category === c));

function table(head: string[], rows: string[][]): string {
  return [`| ${head.join(' | ')} |`, `|${head.map((_, i) => (i === 0 ? ' --- ' : ' ---: ')).join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
}

/** One table per metric: categories down, bots across. */
function sideBySide(records: JobRecord[], bots: string[], k: number, title: string, cell: (s: Stats) => string, note = ''): string {
  const cats = categoriesIn(records);
  const rows = cats.map((c) => [`${CATEGORY_LABEL[c]}${isCore(c) ? '' : ' (non-core)'}`, ...bots.map((b) => cell(stats(records.filter((r) => r.bot === b && r.category === c), k)))]);
  rows.push(['**all**', ...bots.map((b) => `**${cell(stats(records.filter((r) => r.bot === b), k))}**`)]);
  return `### ${title}\n\n${note ? `${note}\n\n` : ''}${table(['category', ...bots], rows)}`;
}

export function renderReport(records: JobRecord[], info: RunInfo): string {
  const bots = info.bots.map((b) => b.bot);
  const k = info.repeat;
  const out: string[] = [];
  out.push(`# Personal-agent bench: ${bots.join(' vs ')}`);
  out.push('');
  if (info.dryRun) out.push('> **Dry run.** Fake bots with scripted answers and seeded faults, a fake grader and an in-memory spend meter. These numbers say nothing about any real bot; they show the harness and the report work.\n');
  out.push(`Task set **${info.setVersion}**, model **${info.model}** for every bot, mode **${info.mode}**, k = ${k}, ${info.date}. Grader: ${info.grader} (blind).`);
  if (info.stoppedForSpend) out.push(`\n**The run stopped early:** ${info.stopReason}. Jobs not run are listed as stopped for spend and left out of every rate.`);
  for (const warning of info.warnings) out.push(`\n**Warning:** ${warning}`);
  out.push('');

  out.push('## Headline');
  out.push('');
  const headRows = bots.map((b) => {
    const s = stats(records.filter((r) => r.bot === b), k);
    return [b, pct(s.pass_at_1), k > 1 ? pct(s.pass_hat_k) : '-', pct(s.honest), `${secs(s.total_p50)} / ${secs(s.total_p95)}`, usd(s.usd_per_task), `${s.scored}/${s.attempts}`];
  });
  out.push(table(['bot', 'pass@1', `pass^${k}`, 'honest', 'total p50 / p95', '$ / task', 'scored / attempts'], headRows));
  out.push('');
  out.push(
    'pass@1 is the share of attempts that passed (averaged per task); pass^k the share of tasks that passed every attempt. "Honest" is the share of attempts with no false claim and no silent ending. Unsupported tasks in core categories count as fails here; in other categories they are left out (see Unsupported).',
  );
  out.push('');
  out.push(sideBySide(records, bots, k, 'Pass rate (pass@1)', (s) => pct(s.pass_at_1)));
  out.push('');
  if (k > 1) {
    out.push(sideBySide(records, bots, k, `Reliability (pass^${k})`, (s) => (s.tasks_k ? `${pct(s.pass_hat_k)} (${s.tasks_k})` : '-'), 'In brackets: tasks with all repeats scored.'));
    out.push('');
  }
  out.push(sideBySide(records, bots, k, 'Honesty', (s) => (s.honest === null ? '-' : `${pct(s.honest)}${s.false_claims || s.silent_endings ? ` (${s.false_claims} claims, ${s.silent_endings} silent)` : ''}`)));
  out.push('');
  out.push(sideBySide(records, bots, k, 'Latency: first output / total (p50, p95)', (s) => `${secs(s.first_output_p50)} / ${secs(s.total_p50)}; p95 ${secs(s.first_output_p95)} / ${secs(s.total_p95)}`));
  out.push('');
  out.push(sideBySide(records, bots, k, 'Cost per attempt', (s) => usd(s.usd_per_task)));
  out.push('');

  out.push('## Honesty and stability');
  out.push('');
  out.push(
    table(
      ['bot', 'false claims', 'silent endings', 'long silences (> 2 min)', 'stalls (stopped at budget)', 'crashes'],
      bots.map((b) => {
        const s = stats(records.filter((r) => r.bot === b), k);
        return [b, String(s.false_claims), String(s.silent_endings), String(s.long_silences), String(s.stalls), String(s.crashes)];
      }),
    ),
  );
  out.push('');

  out.push('## Cost');
  out.push('');
  const meters = info.spend.meters ?? {};
  const meterName = (tag: string) => (meters[tag] === 'self' ? "bot's own meter" : 'metering proxy');
  const tagRows = Object.entries(info.spend.tags).map(([tag, t]) => [
    tag,
    meterName(tag),
    usd(t.usd),
    String(t.requests),
    String(t.input),
    String(t.output),
    String(t.cacheRead),
    String(t.cacheWrite),
    Object.entries(t.models)
      .filter(([, n]) => n > 0)
      .map(([m, n]) => `${m} x${n}`)
      .join(', ') || '-',
    bots.includes(tag) ? usd(info.spend.background[tag] ?? 0) : '-',
  ]);
  out.push(info.spend.available ? table(['tag', 'read from', 'spend', 'requests', 'input', 'output', 'cache read', 'cache write', 'models', 'outside any job'], tagRows) : 'The metering proxy was not reachable; no spend figures.');
  out.push('');
  const own = Object.entries(meters).filter(([, m]) => m === 'self').map(([b]) => b);
  if (own.length)
    out.push(
      `${own.join(', ')}: model calls do not go through the metering proxy, so spend is read from the bot's own usage meter ("meter": "self"), priced from its install's price table, sampled the same way as the proxy. A meter that reports total tokens only shows them all as input. The cap is checked against the proxy total plus this meter; the bench stops starting jobs and stops turns at the cap, but the proxy cannot refuse this bot's calls.\n`,
    );
  out.push(
    `Total $${info.spend.totalUsd.toFixed(2)} this run; the $${info.capUsd.toFixed(2)} cap is checked against all spend so far, this run's and earlier. Per-attempt cost comes from usage sampled every few seconds and when each attempt starts and ends. An increase that arrives while one attempt of the bot is open is that attempt's (exact); one that arrives while several are open (a higher concurrency, or a reminder waiting to fire while the next task runs) is split evenly between them (shared, an estimate). Per-tag totals are exact. "Outside any job" is spend with no attempt of that bot running (a reminder firing after its attempt ended, background memory work).`,
  );
  out.push('');
  out.push(
    table(
      ['bot', 'attempts costed', 'total', '$ / attempt', 'attribution'],
      bots.map((b) => {
        const s = stats(records.filter((r) => r.bot === b), k);
        const costed = records.filter((r) => r.bot === b && r.usd !== null);
        const exact = costed.filter((r) => r.cost_attribution === 'exact').length;
        return [b, String(costed.length), usd(s.usd_total), usd(s.usd_per_task), costed.length ? `${exact} exact, ${costed.length - exact} shared` : 'none'];
      }),
    ),
  );
  out.push('');

  const unsupported = records.filter((r) => r.outcome === 'unsupported');
  out.push('## Unsupported');
  out.push('');
  if (!unsupported.length) out.push('Every bot attempted every task.');
  else {
    const seen = new Map<string, JobRecord>();
    for (const r of unsupported) seen.set(`${r.bot} ${r.task}`, r);
    out.push(
      table(
        ['bot', 'task', 'category', 'counted as', 'why'],
        [...seen.values()].map((r) => [r.bot, r.task, CATEGORY_LABEL[r.category], isCore(r.category) ? 'fail (core)' : 'left out', r.reason]),
      ),
    );
  }
  out.push('');
  const left = records.filter((r) => r.outcome === 'skipped' || r.outcome === 'stopped_for_spend');
  if (left.length) {
    out.push('## Not scored');
    out.push('');
    out.push(table(['bot', 'task', 'repeat', 'outcome', 'why'], left.map((r) => [r.bot, r.task, String(r.repeat), r.outcome, r.reason.slice(0, 160)])));
    out.push('');
  }

  out.push('## Per task');
  out.push('');
  out.push('Each cell lists the attempts in order: P pass, F fail, E crash or error, U unsupported, S skipped, $ stopped for spend.');
  out.push('');
  const letter: Record<JobRecord['outcome'], string> = { pass: 'P', fail: 'F', error: 'E', unsupported: 'U', skipped: 'S', stopped_for_spend: '$' };
  const taskIds = [...new Set(records.map((r) => r.task))];
  out.push(
    table(
      ['task', 'category', ...bots],
      taskIds.map((id) => {
        const any = records.find((r) => r.task === id) as JobRecord;
        return [
          id,
          CATEGORY_LABEL[any.category],
          ...bots.map((b) =>
            records
              .filter((r) => r.bot === b && r.task === id)
              .sort((x, y) => x.repeat - y.repeat)
              .map((r) => letter[r.outcome])
              .join(' ') || '-',
          ),
        ];
      }),
    ),
  );
  out.push('');

  out.push('## Worst failures');
  out.push('');
  const severity = (r: JobRecord) => (r.crashed ? 5 : 0) + (r.honesty.claims.length ? 4 : 0) + (r.honesty.silent ? 3 : 0) + (r.stalled ? 2 : 0) + (r.checks.filter((c) => !c.pass && !c.name.startsWith('info:')).length > 2 ? 1 : 0);
  for (const b of bots) {
    const bad = records.filter((r) => r.bot === b && (r.outcome === 'fail' || r.outcome === 'error')).sort((x, y) => severity(y) - severity(x)).slice(0, 5);
    out.push(`### ${b}`);
    out.push('');
    if (!bad.length) out.push('No failures.');
    for (const r of bad) {
      out.push(`**${r.task}** (repeat ${r.repeat}, ${CATEGORY_LABEL[r.category]}): ${r.reason.slice(0, 300)}`);
      out.push('');
      out.push('```');
      out.push(...r.key_lines.slice(0, 14));
      out.push('```');
      out.push(`Transcript: \`transcripts/${b}/${r.task}-r${r.repeat}.txt\``);
      out.push('');
    }
  }

  out.push('## Configuration');
  out.push('');
  out.push('```json');
  out.push(
    JSON.stringify(
      {
        date: info.date,
        task_set: info.setVersion,
        task_dirs: info.taskDirs.map((d) => d.replace(/\\/g, '/').split('/').slice(-2).join('/')),
        mode: info.mode,
        k: info.repeat,
        concurrency_per_bot: info.concurrency,
        model: info.model,
        grader: info.grader,
        cap_usd: info.capUsd,
        started_at: info.startedAt,
        finished_at: info.finishedAt,
        bots: info.bots.map((p) => ({ id: p.bot, product: p.product, version: p.version, commit: p.commit ?? null, model: p.model, spend_meter: info.spend.meters?.[p.bot] ?? 'proxy', capabilities: p.capabilities, settings: p.settings, notes: p.notes })),
      },
      null,
      2,
    ),
  );
  out.push('```');
  out.push('');
  out.push('Raw data: `run.json` (every attempt, every check) and `transcripts/<bot>/<task>-r<repeat>.txt`.');
  return out.join('\n');
}

export type LeaderboardEntry = {
  bot: string;
  product: string;
  version: string;
  commit: string | null;
  model: string;
  date: string;
  task_set: string;
  mode: string;
  k: number;
  pass_at_1: number | null;
  pass_hat_k: number | null;
  honest: number | null;
  false_claims: number;
  silent_endings: number;
  first_output_p50_ms: number | null;
  total_p50_ms: number | null;
  total_p95_ms: number | null;
  usd_per_task: number | null;
  scored: number;
  attempts: number;
  results: string;
};

export function leaderboardEntries(records: JobRecord[], info: RunInfo, resultsDir: string): LeaderboardEntry[] {
  return info.bots.map((p) => {
    const s = stats(records.filter((r) => r.bot === p.bot), info.repeat);
    return {
      bot: p.bot,
      product: p.product,
      version: p.version,
      commit: p.commit ?? null,
      model: p.model ?? info.model,
      date: info.date,
      task_set: info.setVersion,
      mode: info.mode,
      k: info.repeat,
      pass_at_1: s.pass_at_1,
      pass_hat_k: info.repeat > 1 ? s.pass_hat_k : null,
      honest: s.honest,
      false_claims: s.false_claims,
      silent_endings: s.silent_endings,
      first_output_p50_ms: s.first_output_p50,
      total_p50_ms: s.total_p50,
      total_p95_ms: s.total_p95,
      usd_per_task: s.usd_per_task,
      scored: s.scored,
      attempts: s.attempts,
      results: resultsDir,
    };
  });
}

/** results/<date>-<set>-<model>[-dry-run][-n] */
export function resultsDir(root: string, info: Pick<RunInfo, 'date' | 'setVersion' | 'model' | 'dryRun'>): string {
  const base = `${info.date}-${info.setVersion}-${info.model}${info.dryRun ? '-dry-run' : ''}`.replace(/[^\w.+-]+/g, '_');
  let dir = join(root, base);
  for (let n = 2; existsSync(dir); n++) dir = join(root, `${base}-${n}`);
  return dir;
}

export function writeResults(dir: string, records: JobRecord[], info: RunInfo, leaderboardPath: string | null): { report: string; entries: LeaderboardEntry[] } {
  mkdirSync(join(dir, 'transcripts'), { recursive: true });
  for (const r of records) {
    if (!r.transcript) continue;
    mkdirSync(join(dir, 'transcripts', r.bot), { recursive: true });
    writeFileSync(join(dir, 'transcripts', r.bot, `${r.task}-r${r.repeat}.txt`), r.transcript);
  }
  const report = renderReport(records, info);
  writeFileSync(join(dir, 'report.md'), report);
  const name = dir.replace(/\\/g, '/').split('/').at(-1) as string;
  const entries = leaderboardEntries(records, info, `results/${name}`);
  writeFileSync(
    join(dir, 'run.json'),
    JSON.stringify(
      {
        info,
        summary: Object.fromEntries(info.bots.map((p) => [p.bot, stats(records.filter((r) => r.bot === p.bot), info.repeat)])),
        records: records.map(({ transcript: _t, ...r }) => r),
      },
      null,
      2,
    ),
  );
  writeFileSync(join(dir, 'leaderboard-entries.json'), JSON.stringify(entries, null, 2));
  if (leaderboardPath) {
    const path = resolve(leaderboardPath);
    const board = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as { schema: number; entries: LeaderboardEntry[] }) : { schema: 1, entries: [] };
    board.entries.push(...entries);
    writeFileSync(path, `${JSON.stringify(board, null, 2)}\n`);
  }
  return { report, entries };
}
