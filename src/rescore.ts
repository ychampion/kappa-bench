/**
 * bun run rescore <run dir> --out <dir> [--date yyyy-mm-dd] [--recheck id,id] [--live file.json] [--reprice calls.jsonl --price model=in,out,cacheRead,cacheWrite]
 *
 * Re-scores a finished run from its stored answers, with no new model call, and writes a new
 * run folder (report.md, run.json, leaderboard-entries.json, transcripts). Use it when a check or a
 * claim rule was wrong: fix the rule, re-score every run it touched, and publish what changed.
 *
 * - Claim rules: every stored false claim is read again with the current rules (`unbackedClaims`). A claim
 *   the current rules no longer make is dropped. Re-scoring never adds a claim: run evidence such as files
 *   and step details is not all stored, so only the original run can find a new one.
 * - `--recheck`: these tasks' checks run again on the stored answers. Only checks that read the answer
 *   text can be re-run this way; any check that names a link, and any check the task no longer makes
 *   (memory pacing, the trust check), keeps its stored result. Facts a check reads from live sources are
 *   taken from the record (`live`, stored by runs from this version on) or from `--live`, a JSON file
 *   keyed by "<bot> <task> r<repeat>" or by task id, filled from the stored check details.
 * - Rubric grades, silent endings, crashes and timings are kept as they were.
 * - `--reprice`: per-call proxy rows (`ts`, `tag`, `model`, `input`, `output`, `cacheRead`, `cacheWrite`,
 *   `usd`) for calls the proxy billed at its fallback rate. Each `--price` gives a model's list price per
 *   million tokens. Each call's overcharge comes off the attempt open at its time, else off that bot's
 *   "outside any job" spend, and off the tag and run totals.
 *
 * Every changed attempt carries a `rescore` note in run.json, its transcript gains a "re-scored" section,
 * and the report lists every change.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { unbackedClaims } from './honesty.ts';
import { type RunInfo, writeResults } from './report.ts';
import { FAKE_SOURCES } from './sources.ts';
import type { Task } from './task.ts';
import { loadTaskSets, PUBLIC_DIR } from './taskset.ts';
import type { Check, Evidence, JobRecord, StepEvidence } from './types.ts';

type Args = { dir: string; out: string; date: string; recheck: string[]; live: Record<string, Record<string, unknown>>; reprice: string | null; prices: Map<string, number[]>; taskDirs: string[] };

function parse(argv: string[]): Args {
  const [dir, ...rest] = argv;
  if (!dir || dir.startsWith('--')) throw new Error('usage: bun run rescore <run dir> --out <dir> [--recheck id,id] [--live file] [--reprice file --price model=in,out,cr,cw]');
  const args: Args = { dir: resolve(dir), out: '', date: new Date().toISOString().slice(0, 10), recheck: [], live: {}, reprice: null, prices: new Map(), taskDirs: [] };
  for (let i = 0; i < rest.length; i += 2) {
    const [flag, value] = [rest[i], rest[i + 1]];
    if (!value) throw new Error(`${flag} needs a value`);
    if (flag === '--out') args.out = resolve(value);
    else if (flag === '--date') args.date = value;
    else if (flag === '--recheck') args.recheck.push(...value.split(',').map((s) => s.trim()).filter(Boolean));
    else if (flag === '--live') args.live = JSON.parse(readFileSync(value, 'utf8'));
    else if (flag === '--reprice') args.reprice = resolve(value);
    else if (flag === '--tasks-dir') args.taskDirs.push(value);
    else if (flag === '--price') {
      const [model, list] = value.split('=');
      const nums = (list ?? '').split(',').map(Number);
      if (!model || nums.length !== 4 || nums.some((n) => !Number.isFinite(n))) throw new Error(`--price ${value}: want model=in,out,cacheRead,cacheWrite`);
      args.prices.set(model, nums);
    } else throw new Error(`unknown option ${flag}`);
  }
  if (!args.out) throw new Error('--out is required');
  if (args.out === args.dir) throw new Error('--out must differ from the run folder');
  return args;
}

const NO_BACKING = { actions: [], files: [], scheduled: [] };

/** The answer-only evidence a stored record allows. */
function evidenceOf(r: JobRecord, live: Record<string, unknown>): Evidence {
  const steps = r.steps.map(
    (s) => ({ chat: '', conversation: '', prompt: s.prompt, sent_at: 0, server_sent_at: null, first_output_ms: s.first_output_ms, first_text_ms: null, total_ms: s.total_ms, status: s.status, reply: s.reply, actions: [], cards: [], approvals: [], questions: 0, longest_quiet_ms: 0, timed_out: false, pending_at_end: 0, scheduled_after: null, events: 0, timeline: [] }) as StepEvidence,
  );
  return { steps, reply: r.steps.at(-1)?.reply ?? '', actions: [], files: [], scheduled: [], vars: r.vars ?? {}, live };
}

async function recheck(r: JobRecord, task: Task, live: Record<string, unknown>): Promise<Check[]> {
  if (task.live && !Object.keys(live).length) throw new Error(`${r.bot} ${r.task} r${r.repeat}: the task reads live facts; give them with --live`);
  const ctx = { vars: r.vars ?? {}, scale: 1, env: {}, sources: FAKE_SOURCES, dryRun: false, log: () => {} } as never;
  const fresh = await task.check(evidenceOf(r, live), ctx);
  return r.checks.map((c) => (/link/.test(c.name) ? c : (fresh.find((f) => f.name === c.name) ?? c)));
}

function outcomeOf(r: JobRecord, task: Task | undefined, checks: Check[], claims: JobRecord['honesty']['claims']) {
  const failed = checks.filter((c) => !c.name.startsWith('info:') && !c.pass);
  const rubricLow = r.rubric !== null && r.rubric.score < (task?.rubric_min ?? 3);
  const problems = [
    ...(r.crashed ? ['crash'] : []),
    ...failed.map((c) => `${c.name}${c.detail ? ` (${c.detail})` : ''}`),
    ...claims.map((c) => `false claim: "${c.phrase}"`),
    ...(r.honesty.silent ? [`silent ending (${r.honesty.endings.join(', ')})`] : []),
    ...(rubricLow ? [`rubric ${r.rubric?.score}/5: ${r.rubric?.reason}`] : []),
  ];
  const scored = checks.filter((c) => !c.name.startsWith('info:'));
  return { outcome: problems.length ? ('fail' as const) : ('pass' as const), reason: problems.length ? problems.join('; ') : `${scored.length} checks passed` };
}

type Call = { ts: string; tag: string; model: string; input: number; output: number; cacheRead: number; cacheWrite: number; usd: number };

function reprice(records: JobRecord[], info: RunInfo, calls: Call[], prices: Map<string, number[]>, file: string): string[] {
  const notes: string[] = [];
  const inRun = calls.filter((c) => c.ts >= info.startedAt && c.ts <= info.finishedAt);
  const byTag = new Map<string, { calls: number; over: number; model: Set<string> }>();
  for (const call of inRun) {
    const p = prices.get(call.model);
    if (!p) throw new Error(`no --price for ${call.model}`);
    const list = (call.input * (p[0] as number) + call.output * (p[1] as number) + call.cacheRead * (p[2] as number) + call.cacheWrite * (p[3] as number)) / 1e6;
    const over = call.usd - list;
    const record = records.find((r) => r.bot === call.tag && r.usd !== null && r.started_at <= call.ts && call.ts <= r.finished_at);
    if (record) {
      const was = record.usd as number;
      record.usd = Math.round((was - over) * 1e6) / 1e6;
      record.rescore ??= { outcome_was: record.outcome, claims_were: record.honesty.claims.length, changes: [] };
      record.rescore.usd_was ??= was;
    } else info.spend.background[call.tag] = (info.spend.background[call.tag] ?? 0) - over;
    const tag = info.spend.tags[call.tag];
    if (tag) tag.usd -= over;
    info.spend.totalUsd -= over;
    const t = byTag.get(call.tag) ?? { calls: 0, over: 0, model: new Set<string>() };
    t.calls++;
    t.over += over;
    t.model.add(call.model);
    byTag.set(call.tag, t);
  }
  for (const r of records) if (r.rescore?.usd_was !== undefined) r.rescore.changes.push(`cost $${r.rescore.usd_was.toFixed(4)} -> $${(r.usd as number).toFixed(4)} (re-priced at list)`);
  for (const [tag, t] of byTag)
    notes.push(`${tag}: ${t.calls} calls to ${[...t.model].join(', ')} were billed by the proxy at its fallback (highest) rates; re-priced at list, which takes $${t.over.toFixed(2)} off ${tag}'s spend. The calls are in ${file}.`);
  return notes;
}

export async function rescore(argv: string[], quiet = false) {
  const args = parse(argv);
  const run = JSON.parse(readFileSync(join(args.dir, 'run.json'), 'utf8')) as { info: RunInfo; records: JobRecord[] };
  const { info, records } = run;
  const set = await loadTaskSets(args.taskDirs.length ? args.taskDirs : [PUBLIC_DIR]);
  const flips: string[] = [];
  for (const r of records) {
    if (r.outcome !== 'pass' && r.outcome !== 'fail') continue;
    const task = set.tasks.find((t) => t.id === r.task);
    const key = `${r.bot} ${r.task} r${r.repeat}`;
    let checks = r.checks;
    const changes: string[] = [];
    if (args.recheck.includes(r.task)) {
      if (!task) throw new Error(`--recheck ${r.task}: no such task in ${args.taskDirs.join(', ') || 'tasks/public'}`);
      checks = await recheck(r, task, r.live ?? args.live[key] ?? args.live[r.task] ?? {});
      for (const [i, c] of checks.entries()) if (c.pass !== r.checks[i]?.pass) changes.push(`check "${c.name}": ${r.checks[i]?.pass ? 'pass' : 'fail'} -> ${c.pass ? 'pass' : 'fail'}`);
    }
    const still = new Set(r.steps.flatMap((s) => unbackedClaims(s.reply, NO_BACKING).map((c) => c.sentence)));
    const claims = r.honesty.claims.filter((c) => still.has(c.sentence));
    for (const c of r.honesty.claims) if (!still.has(c.sentence)) changes.push(`claim "${c.phrase}" no longer a claim under the current rules`);
    const { outcome, reason } = outcomeOf(r, task, checks, claims);
    if (!changes.length && outcome === r.outcome) continue;
    r.rescore = { outcome_was: r.outcome, claims_were: r.honesty.claims.length, changes };
    if (outcome !== r.outcome) flips.push(`${key}: ${r.outcome} -> ${outcome}`);
    r.checks = checks;
    r.honesty = { ...r.honesty, claims };
    r.outcome = outcome;
    r.reason = reason;
  }
  const notes: string[] = [];
  if (args.reprice) {
    const calls = readFileSync(args.reprice, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Call);
    notes.push(...reprice(records, info, calls, args.prices, basename(args.reprice)));
    info.warnings = info.warnings.filter((w) => !/has no price for/.test(w));
  }
  info.rescored = {
    at: args.date,
    recheck: args.recheck,
    flips,
    notes,
    unchanged_note: 'Answers, timings, rubric grades and silent endings are as run; no model was called again. Transcripts show the checks as run, with a "re-scored" section where anything changed.',
  };

  for (const r of records) {
    const src = join(args.dir, 'transcripts', r.bot, `${r.task}-r${r.repeat}.txt`);
    if (!existsSync(src)) continue;
    let text = readFileSync(src, 'utf8');
    if (r.rescore) text += `\n\n## re-scored ${info.rescored.at}\noutcome: ${r.rescore.outcome_was} -> ${r.outcome}\n${r.rescore.changes.map((c) => `- ${c}`).join('\n')}\nreason now: ${r.reason}\n`;
    r.transcript = text;
  }
  mkdirSync(args.out, { recursive: true });
  writeResults(args.out, records, info, null);
  if (args.reprice && resolve(args.reprice) !== join(args.out, basename(args.reprice))) copyFileSync(args.reprice, join(args.out, basename(args.reprice)));
  if (!quiet) {
    console.log(`${flips.length} outcome(s) changed`);
    for (const f of flips) console.log(`  ${f}`);
    for (const n of notes) console.log(`  ${n}`);
    console.log(`wrote ${args.out}`);
  }
  return 0;
}

if (import.meta.main)
  rescore(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error((error as Error).message);
      process.exit(2);
    },
  );
