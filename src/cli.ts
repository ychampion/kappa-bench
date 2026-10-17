/**
 * bun run bench   --bots a,b --mode smoke|full|reliability [--repeat k] [--tasks-dir dir ...] [--concurrency n]
 * bun run dry-run [--bots a,b] [same options]       fake bots, fake grader, in-memory meter; spends nothing
 * bun run list    [--tasks-dir dir ...]              the tasks and named sets
 * bun run fixtures                                   writes the attachment files to fixtures/ for a look
 *
 * Options:
 *   --bots a,b          bot ids from bots/<id>.json (default: every bot there)
 *   --mode m            smoke (the smoke set, k=1), full (every scored task), reliability (the reliability set, k=3)
 *   --with-shorts       full mode: add the short variants
 *   --tasks id,id       only these task ids (after the mode's selection)
 *   --repeat k          repeats per task (pass^k); default 1, 3 in reliability mode, 2 in a dry run
 *   --tasks-dir dir     a task set folder; repeat or comma-separate to combine (default tasks/public)
 *   --concurrency n     jobs at a time per bot (default 1, which keeps per-job cost exact)
 *   --cap usd           stop starting jobs at this spend (default BENCH_CAP_USD or 60); the proxy's own cap also applies
 *   --no-grader         skip the rubric grader
 *   --grade-shorts      grade short variants too
 *   --keep-chats        leave the bots' conversations in place
 *   --overlap-waits     run a bot's next job while a task waits for its reminder or watch to fire (faster; costs become shared)
 *   --out dir           results root (default results/)
 *   --no-leaderboard    do not append to results/leaderboard.json
 *   --scale x           dry run time scale (default 0.01)
 *
 * Environment: BENCH_PROXY_URL (required for a live run), each bot's variables (bots/<id>.json "env"),
 * BENCH_GRADER_MODEL (default claude-opus-5-5), BENCH_TIME_ZONE (default America/Los_Angeles),
 * BENCH_GITHUB_REPO and BENCH_GITHUB_TOKEN (the one task that opens an issue in a test repo).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import type { Adapter, BotConfig, Preflight } from './adapter.ts';
import { fakeAdapter, liveAdapter } from './adapters/index.ts';
import { writeFixtures } from './fixtures.ts';
import { fakeGitHub, liveGitHub } from './github.ts';
import { anthropicGrader, fakeGrader, type Grader } from './grader.ts';
import { CombinedSource, FakeProxy, Meter, ProxySource } from './meter.ts';
import { resultsDir, type RunInfo, writeResults } from './report.ts';
import { runAll } from './runner.ts';
import { FAKE_SOURCES, LIVE_SOURCES } from './sources.ts';
import type { Task } from './task.ts';
import { loadTaskSets, PUBLIC_DIR } from './taskset.ts';
import { CATEGORY_LABEL, type JobRecord } from './types.ts';
import { TIME_ZONE } from './util.ts';

const ROOT = resolve(import.meta.dir, '..');
export const BOTS_DIR = join(ROOT, 'bots');

export type Args = { command: string; flags: Map<string, string[]> };
export function parseArgs(argv: string[]): Args {
  const [command = 'help', ...rest] = argv;
  const flags = new Map<string, string[]>();
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i] as string;
    if (!arg.startsWith('--')) throw new Error(`unexpected argument ${arg}`);
    const [name, inline] = arg.slice(2).split('=', 2) as [string, string | undefined];
    const next = rest[i + 1];
    const value = inline ?? (next !== undefined && !next.startsWith('--') ? (i++, next) : 'true');
    flags.set(name, [...(flags.get(name) ?? []), value]);
  }
  return { command, flags };
}
const one = (a: Args, name: string) => a.flags.get(name)?.at(-1);
const list = (a: Args, name: string) => (a.flags.get(name) ?? []).flatMap((v) => v.split(',')).map((v) => v.trim()).filter(Boolean);

export function loadBots(ids: string[]): BotConfig[] {
  const all = readdirSync(BOTS_DIR).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(BOTS_DIR, f), 'utf8')) as BotConfig);
  if (!ids.length) return all;
  return ids.map((id) => {
    const bot = all.find((b) => b.id === id);
    if (!bot) throw new Error(`no bots/${id}.json (known: ${all.map((b) => b.id).join(', ')})`);
    return bot;
  });
}

export function selectTasks(all: Task[], sets: Record<string, string[]>, mode: string, withShorts: boolean, only: string[]): Task[] {
  let chosen: Task[];
  if (mode === 'smoke' || mode === 'reliability') {
    const ids = sets[mode];
    if (!ids?.length) throw new Error(`no "${mode}" set in the task folders' sets.json`);
    chosen = ids.map((id) => {
      const task = all.find((t) => t.id === id);
      if (!task) throw new Error(`sets.json ${mode} names ${id}, which no task file defines`);
      return task;
    });
  } else if (mode === 'full') chosen = all.filter((t) => withShorts || t.variant !== 'short');
  else throw new Error(`unknown mode ${mode} (smoke, full or reliability)`);
  if (only.length) chosen = chosen.filter((t) => only.includes(t.id));
  if (!chosen.length) throw new Error('no tasks selected');
  return chosen;
}

/** A task folder as a report may show it: relative inside this repo, else only its name (a held-out set's location stays private). */
const displayDir = (dir: string) => {
  const rel = relative(ROOT, dir).replace(/\\/g, '/');
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : `held-out set ${basename(dir)}`;
};

const localDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

export async function main(argv: string[]) {
  const args = parseArgs(argv);
  const log = (line: string) => console.log(line);
  if (args.command === 'fixtures') {
    for (const line of writeFixtures()) log(`wrote fixtures/${line}`);
    return 0;
  }
  const dirs = list(args, 'tasks-dir');
  const set = await loadTaskSets(dirs.length ? dirs : [PUBLIC_DIR]);
  if (args.command === 'list') {
    for (const t of set.tasks) log(`${t.id.padEnd(26)} ${CATEGORY_LABEL[t.category].padEnd(24)} ${t.variant === 'short' ? 'short ' : ''}${t.title}`);
    for (const [name, ids] of Object.entries(set.sets)) log(`\n${name}: ${ids.join(', ')}`);
    log(`\n${set.tasks.length} tasks, set ${set.version}`);
    return 0;
  }
  if (args.command !== 'bench' && args.command !== 'dry-run') {
    log('usage: bun run bench|dry-run|list|fixtures [options]; see src/cli.ts');
    return args.command === 'help' ? 0 : 2;
  }
  const dryRun = args.command === 'dry-run';
  const mode = one(args, 'mode') ?? 'full';
  const withShorts = args.flags.has('with-shorts') || dryRun;
  const tasks = selectTasks(set.tasks, set.sets, mode, withShorts, list(args, 'tasks'));
  const repeat = Number(one(args, 'repeat') ?? (dryRun ? 2 : mode === 'reliability' ? 3 : 1));
  const concurrency = Number(one(args, 'concurrency') ?? 1);
  const capUsd = Number(one(args, 'cap') ?? process.env.BENCH_CAP_USD ?? 60);
  const scale = dryRun ? Number(one(args, 'scale') ?? 0.01) : 1;
  if (!Number.isInteger(repeat) || repeat < 1) throw new Error('--repeat must be a whole number from 1');
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('--concurrency must be a whole number from 1');
  const configs = loadBots(list(args, 'bots'));
  const graderModel = process.env.BENCH_GRADER_MODEL ?? 'claude-opus-5-5';
  const warnings: string[] = [];

  let meter: Meter | null;
  let grader: Grader | null = null;
  let proxy: FakeProxy | null = null;
  const adapters: Adapter[] = [];
  const meterOf = (config: BotConfig) => config.meter ?? 'proxy';
  for (const config of configs)
    if (!['proxy', 'self'].includes(meterOf(config))) throw new Error(`bots/${config.id}.json: "meter" must be "proxy" or "self", not ${JSON.stringify(config.meter)}`);
  /** The bots that read spend from their own meter, joined to the proxy's reading. */
  const selfMetered = (source: ConstructorParameters<typeof CombinedSource>[0]) => {
    const own = adapters.filter((a, i) => meterOf(configs[i] as BotConfig) === 'self');
    for (const a of own) if (!a.usage) throw new Error(`bots/${a.id}.json says "meter": "self", but its adapter has no usage() to read the bot's own meter.`);
    return own.length ? new CombinedSource(source, own.map((a) => ({ tag: a.id, read: () => (a.usage as NonNullable<Adapter['usage']>).call(a) }))) : source;
  };
  if (dryRun) {
    proxy = new FakeProxy(capUsd);
    for (const [i, config] of configs.entries())
      adapters.push(
        fakeAdapter(config, {
          scale,
          proxy,
          flakiness: Number(process.env.BENCH_DRY_FLAKINESS ?? 0.06),
          seed: 1000 + i * 7919,
          baseTokens: config.adapter === 'openmausbot' ? 30_000 : 25_000,
          ...(meterOf(config) === 'self' ? { selfMeter: new FakeProxy(Number.POSITIVE_INFINITY) } : {}),
        }),
      );
    meter = new Meter(selfMetered(proxy), capUsd, Math.max(50, 10_000 * scale));
    const fake = proxy;
    const names = adapters.flatMap((a) => a.productNames).concat(configs.map((c) => c.id));
    if (!args.flags.has('no-grader')) grader = fakeGrader(names, () => fake.charge('grader', graderModel, 4000, 500));
  } else {
    const proxyUrl = process.env.BENCH_PROXY_URL;
    if (!proxyUrl) throw new Error('set BENCH_PROXY_URL to the metering proxy: the grader and every bot without "meter": "self" call the model through it, so spend is metered and capped.');
    for (const config of configs) adapters.push(liveAdapter(config, { scale, env: process.env }));
    meter = new Meter(selfMetered(new ProxySource(proxyUrl)), capUsd);
    const names = adapters.flatMap((a) => a.productNames).concat(configs.map((c) => c.id));
    if (!args.flags.has('no-grader')) grader = anthropicGrader(proxyUrl, graderModel, names);
  }
  if (process.env.BENCH_ALLOW_VERSION_MISMATCH === '1') warnings.push('BENCH_ALLOW_VERSION_MISMATCH=1: a bot may run a version other than its pin; check the configuration block.');

  const preflights: Preflight[] = [];
  for (const adapter of adapters) {
    try {
      const p = await adapter.preflight();
      preflights.push(p);
      log(`${p.bot}: ${p.product} ${p.version}${p.commit ? ` (${p.commit})` : ''}, model ${p.model}, can: ${p.capabilities.join(', ')}`);
      for (const note of p.notes) log(`  note: ${note}`);
    } catch (error) {
      log(`preflight failed for ${adapter.id}: ${(error as Error).message}`);
      return 2;
    }
  }
  if (meter && !(await meter.begin())) {
    if (!dryRun) {
      log(`the metering proxy did not answer GET /usage${meter.source instanceof CombinedSource ? ', or a self-metered bot\'s own meter could not be read' : ''}; refusing to run without a spend meter.`);
      return 2;
    }
  }
  const startedAt = new Date().toISOString();
  log(`running ${tasks.length} task(s) x ${repeat} on ${adapters.map((a) => a.id).join(', ')}${dryRun ? ' (dry run)' : ''}; cap $${capUsd}`);
  const result = await runAll({
    bots: adapters.map((adapter, i) => ({ adapter, preflight: preflights[i] as Preflight })),
    tasks,
    repeat,
    concurrency,
    meter,
    scale,
    env: process.env,
    sources: dryRun ? FAKE_SOURCES : LIVE_SOURCES,
    github: dryRun ? fakeGitHub() : liveGitHub(process.env),
    grader,
    gradeShorts: args.flags.has('grade-shorts'),
    dryRun,
    keepChats: args.flags.has('keep-chats'),
    overlapWaits: args.flags.has('overlap-waits'),
    log,
    onRecord: (r: JobRecord) => log(`${r.bot} ${r.task} r${r.repeat}: ${r.outcome}${r.outcome === 'pass' ? '' : ` (${r.reason.slice(0, 160)})`}`),
  });
  await meter?.end();
  for (const adapter of adapters) await adapter.close?.();

  const spend = await (meter ? meter.source.usage() : Promise.resolve(null));
  const tags: RunInfo['spend']['tags'] = {};
  if (meter) for (const tag of [...configs.flatMap((c) => (meterOf(c) === 'self' ? [c.id, `${c.id}.proxy`] : [c.id])), 'grader']) tags[tag] = meter.tagSpend(tag);
  for (const config of configs) {
    if (tags[`${config.id}.proxy`] && (tags[`${config.id}.proxy`]?.requests ?? 0) === 0) delete tags[`${config.id}.proxy`];
    const ran = result.records.some((r) => r.bot === config.id && r.steps.length > 0);
    if (ran && meter?.available() && (tags[config.id]?.requests ?? 0) === 0)
      warnings.push(
        meterOf(config) === 'self'
          ? `${config.id}'s own meter recorded no model call during the run: its spend and model are unverified.`
          : `no model call of ${config.id} reached the metering proxy under the tag "${config.id}": its spend is not counted or capped, and its model was not verified. Point its model base URL at <proxy>/b/${config.id}, or declare "meter": "self" if its adapter can read the bot's own meter.`,
      );
    const models = Object.keys(tags[config.id]?.models ?? {}).filter((m) => m !== '(none)' && (tags[config.id]?.models[m] ?? 0) > 0);
    const want = config.model.replace(/^.*\//, '');
    const other = models.filter((m) => m !== want);
    if (other.length) warnings.push(`${config.id} also called ${other.join(', ')} (besides ${want}); listed, not rewritten.`);
  }
  const models = [...new Set(configs.map((c) => c.model.replace(/^.*\//, '')))];
  const info: RunInfo = {
    date: localDate(),
    mode,
    dryRun,
    setVersion: set.version,
    taskDirs: set.dirs.map(displayDir),
    model: models.join('+'),
    repeat,
    concurrency,
    capUsd: Math.min(capUsd, spend?.capUsd ?? capUsd),
    grader: grader ? `${grader.model}${dryRun ? '' : ' via the metering proxy'}` : 'none',
    bots: preflights,
    spend: {
      totalUsd: meter?.total() ?? 0,
      tags,
      meters: Object.fromEntries(configs.map((c) => [c.id, meterOf(c)])),
      background: Object.fromEntries(meter?.background ?? []),
      available: Boolean(meter?.available()),
    },
    stoppedForSpend: result.stoppedForSpend,
    stopReason: result.stopReason,
    warnings,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
  const outRoot = resolve(one(args, 'out') ?? join(ROOT, 'results'));
  const dir = resultsDir(outRoot, info);
  const leaderboard = dryRun || args.flags.has('no-leaderboard') ? null : join(outRoot, 'leaderboard.json');
  writeResults(dir, result.records, info, leaderboard);
  log(`\nreport: ${dir}/report.md`);
  log(`spend: $${info.spend.totalUsd.toFixed(4)} of $${info.capUsd}`);
  return 0;
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error((error as Error).message);
      process.exit(2);
    },
  );
}
