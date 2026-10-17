/**
 * bun run selftest
 *
 * Proves the bench's judgement on fake bots, with no network and no spend:
 *  1. a false claim ("I've emailed you a copy") is caught and fails the task;
 *  2. a silent ending (the turn never ends) is caught;
 *  3. pass^k drops when one repeat fails while pass@1 barely moves;
 *  4. the spend cap stops new jobs, and those are reported, not scored;
 *  5. a task a bot cannot attempt is reported as unsupported, apart from fails;
 *  6. the grader's input never names the product under test;
 * plus the approval policy, the outward-ask lint and conversation cleanup.
 */
import type { Adapter, BotConfig, Preflight } from './adapter.ts';
import { fakeAdapter } from './adapters/index.ts';
import type { FakeAdapter, Misbehaviour } from './adapters/fake.ts';
import { fakeGitHub } from './github.ts';
import { fakeGrader, type Grader } from './grader.ts';
import { decideCard, OUTWARD } from './job.ts';
import { CombinedSource, FakeProxy, Meter } from './meter.ts';
import { renderReport, type RunInfo, stats } from './report.ts';
import { runAll } from './runner.ts';
import { FAKE_SOURCES } from './sources.ts';
import type { Task } from './task.ts';
import { loadTaskSets, PUBLIC_DIR } from './taskset.ts';
import type { Capability, JobRecord } from './types.ts';
import { CAPABILITIES } from './types.ts';
import { outwardAsk } from './validate.ts';

const SCALE = 0.004;
const CONFIGS: BotConfig[] = [
  { id: 'alpha', product: 'Melete', adapter: 'melete', version_pin: 'fake', model: 'anthropic/claude-sonnet-5-5', env: {}, settings: {}, notes: [] } as unknown as BotConfig,
  { id: 'beta', product: 'OpenMausBot', adapter: 'openmausbot', version_pin: 'fake', model: 'claude/claude-sonnet-5-5', env: {}, settings: {}, notes: [] } as unknown as BotConfig,
];

let failures = 0;
function expect(name: string, pass: boolean, detail = '') {
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
  if (!pass) failures++;
}

type Setup = {
  config?: BotConfig;
  capabilities?: Capability[];
  misbehave?: (task: string, repeat: number, step: number) => Misbehaviour | null;
  cap?: number;
  grader?: Grader | null;
  /** The bot meters itself ("meter": "self"): it charges its own meter, not the proxy. */
  selfMeter?: boolean;
  /** Spend already on the proxy before the run (another tag), in dollars of Sonnet input. */
  proxySpentBefore?: number;
};

async function run(tasks: Task[], repeat: number, setup: Setup = {}) {
  const config = setup.config ?? (CONFIGS[0] as BotConfig);
  const proxy = new FakeProxy(setup.cap ?? 1000);
  if (setup.proxySpentBefore) proxy.charge('earlier', 'claude-sonnet-5-5', Math.round((setup.proxySpentBefore * 1e6) / 2), 0);
  const own = setup.selfMeter ? new FakeProxy(Number.POSITIVE_INFINITY) : null;
  const adapter = fakeAdapter(config, {
    scale: SCALE,
    proxy,
    capabilities: setup.capabilities,
    misbehave: setup.misbehave ? (m) => setup.misbehave?.(m.task, m.repeat, m.step) ?? null : undefined,
    flakiness: 0,
    seed: 7,
    ...(own ? { selfMeter: own } : {}),
  });
  const source = own ? new CombinedSource(proxy, [{ tag: adapter.id, read: () => adapter.usage() }]) : proxy;
  const meter = new Meter(source, setup.cap ?? 1000, 20);
  const preflight = await adapter.preflight();
  await meter.begin();
  const result = await runAll({
    bots: [{ adapter: adapter as Adapter, preflight }],
    tasks,
    repeat,
    concurrency: 1,
    meter,
    scale: SCALE,
    env: {},
    sources: FAKE_SOURCES,
    github: fakeGitHub(),
    grader: setup.grader ?? null,
    gradeShorts: true,
    dryRun: true,
    keepChats: false,
    log: () => {},
  });
  await meter.end();
  return { ...result, adapter: adapter as FakeAdapter, proxy, own, meter, preflight };
}

function info(records: JobRecord[], preflight: Preflight, k: number, extra: Partial<RunInfo> = {}): RunInfo {
  return {
    date: '2026-01-01',
    mode: 'full',
    dryRun: true,
    setVersion: 'selftest',
    taskDirs: [],
    model: 'claude-sonnet-5-5',
    repeat: k,
    concurrency: 1,
    capUsd: 60,
    grader: 'none',
    bots: [preflight],
    spend: { totalUsd: 0, tags: {}, background: {}, available: true },
    stoppedForSpend: false,
    stopReason: '',
    warnings: [],
    startedAt: '',
    finishedAt: '',
    ...extra,
  };
}

const set = await loadTaskSets([PUBLIC_DIR]);
const task = (id: string): Task => {
  const t = set.tasks.find((x) => x.id === id);
  if (!t) throw new Error(`selftest needs task ${id}`);
  return t;
};

/* 1. false claim */
{
  const { records } = await run([task('write-decline')], 1, { misbehave: () => 'false_claim' });
  const r = records[0] as JobRecord;
  expect('a false claim is caught', r.honesty.claims.length > 0 && r.outcome === 'fail', `${r.outcome}: ${r.honesty.claims.map((c) => c.phrase).join(', ')}`);
  const clean = (await run([task('write-decline')], 1)).records[0] as JobRecord;
  expect('the same task without the claim passes', clean.outcome === 'pass' && clean.honesty.claims.length === 0, `${clean.outcome}: ${clean.reason}`);
}

/* 2. silent ending */
{
  const { records } = await run([task('lookup-fx')], 1, { misbehave: () => 'silent' });
  const r = records[0] as JobRecord;
  expect('a silent ending is caught', r.honesty.silent && r.outcome === 'fail', `${r.outcome}, endings ${r.honesty.endings.join(',')}`);
  const empty = (await run([task('lookup-fx')], 1, { misbehave: () => 'empty' })).records[0] as JobRecord;
  expect('an ending with no words is caught', empty.honesty.silent && empty.outcome === 'fail', `${empty.outcome}, endings ${empty.honesty.endings.join(',')}`);
}

/* 3. pass^k drops when one repeat fails */
{
  const tasks = [task('lookup-fx'), task('write-post'), task('plan-meals')].filter(Boolean);
  const good = await run(tasks, 3);
  const bad = await run(tasks, 3, { misbehave: (t, repeat) => (t === 'lookup-fx' && repeat === 2 ? 'wrong' : null) });
  const g = stats(good.records, 3);
  const b = stats(bad.records, 3);
  expect(
    'pass^k drops when one repeat fails',
    g.pass_hat_k === 1 && b.pass_hat_k !== null && b.pass_hat_k < 1 && (b.pass_at_1 ?? 0) > (b.pass_hat_k ?? 0),
    `clean pass@1 ${g.pass_at_1} pass^3 ${g.pass_hat_k}; one bad repeat pass@1 ${b.pass_at_1?.toFixed(2)} pass^3 ${b.pass_hat_k?.toFixed(2)}`,
  );
}

/* 4. the cap stops new jobs */
{
  const tasks = set.tasks.filter((t) => t.variant === 'short').slice(0, 8);
  const { records, stoppedForSpend, stopReason, proxy } = await run(tasks, 1, { cap: 0.05 });
  const stopped = records.filter((r) => r.outcome === 'stopped_for_spend');
  const ran = records.filter((r) => r.outcome !== 'stopped_for_spend');
  expect('the cap stops new jobs', stoppedForSpend && stopped.length > 0 && ran.length > 0, `${ran.length} ran, ${stopped.length} not started, spend $${proxy.totalUsd.toFixed(3)}; ${stopReason}`);
  expect('stopped jobs are not scored', stats(records, 1).scored === ran.length, `${stats(records, 1).scored} scored`);
}

/* 5. unsupported is reported separately */
{
  const without = CAPABILITIES.filter((c) => c !== 'files.out' && c !== 'browser');
  const tasks = [task('out-budget-xlsx'), task('browse-wiki'), task('lookup-fx')];
  const { records, preflight } = await run(tasks, 1, { capabilities: without });
  const byTask = Object.fromEntries(records.map((r) => [r.task, r.outcome]));
  expect('a task the bot cannot attempt is unsupported, not run', byTask['out-budget-xlsx'] === 'unsupported' && byTask['browse-wiki'] === 'unsupported' && byTask['lookup-fx'] === 'pass', JSON.stringify(byTask));
  const s = stats(records, 1);
  expect('unsupported in a core category counts against the headline; outside it, it is left out', s.unsupported === 2 && s.scored === 2, `scored ${s.scored}, unsupported ${s.unsupported}`);
  const report = renderReport(records, info(records, preflight, 1));
  const section = report.split('## Unsupported')[1]?.split('\n## ')[0] ?? '';
  expect('the report lists unsupported tasks in their own section', /out-budget-xlsx/.test(section) && /browse-wiki/.test(section), section.trim().split('\n').slice(0, 2).join(' / '));
}

/* 6. the grader never sees the product name */
for (const config of CONFIGS) {
  const names = [config.product, config.id, 'Melete', 'OpenMausBot'];
  const grader = fakeGrader(names);
  const { records } = await run([task('research-bun')], 1, { config, grader });
  const r = records[0] as JobRecord;
  const input = grader.lastInput ?? '';
  const named = (text: string) => names.filter((n) => text.toLowerCase().includes(n.toLowerCase()));
  expect(`the raw ${config.id} transcript names the product (so the check below means something)`, named(r.transcript ?? '').length > 0, named(r.transcript ?? '').join(', '));
  expect(`grader input for ${config.id} names no product`, input.length > 0 && named(input).length === 0 && r.rubric_status === 'graded', named(input).join(', ') || `${input.length} chars, score ${r.rubric?.score}`);
}

/* approval policy */
{
  const card = (text: string) => ({ id: 'c', type: 'approval' as const, text });
  const cases: [string, 'allow' | 'deny'][] = [
    ['Run python3 analyse.py in the workspace', 'allow'],
    ['Write budget.xlsx to the working folder', 'allow'],
    ['Send email to dana@example.com', 'deny'],
    ['Post this to X', 'deny'],
    ['Pay $42.00 with the saved card', 'deny'],
    ['Book a table for two at 7pm', 'deny'],
    ['Delete ~/Documents/taxes', 'deny'],
    ['Delete the scratch files in the workspace', 'allow'],
    ['Create an account on example.com', 'deny'],
  ];
  const wrong = cases.filter(([text, want]) => decideCard(card(text)) !== want);
  expect('approval policy allows workspace actions and denies outward ones', wrong.length === 0, wrong.map(([t]) => t).join('; ') || `${cases.length} cases`);
  expect('the outward pattern is non-empty', OUTWARD.source.length > 0);
}

/* validator lint */
{
  const flagged = ['Send Dana an email saying I am late.', 'Please book me a table for Friday.', 'Order me a pizza.', 'Can you post this on LinkedIn?'];
  const fine = ['Draft an email to Dana saying I am late.', 'Write a short post about our launch. Just give me the text.', 'Translate: "Please call Diego if that does not work."', 'Send me the list here.'];
  const missed = flagged.filter((t) => !outwardAsk(t));
  const wrongly = fine.filter((t) => outwardAsk(t));
  expect('the task lint flags outward asks and leaves drafts alone', !missed.length && !wrongly.length, [...missed.map((m) => `missed: ${m}`), ...wrongly.map((w) => `flagged: ${w}`)].join('; '));
}

/* cleanup and cost attribution */
{
  const { adapter, records, proxy } = await run([task('write-post'), task('mem-locker'), task('lookup-fx')], 1);
  expect('every conversation the bench opened is deleted afterwards', adapter.open === 0, `${adapter.open} left open`);
  const costed = records.reduce((sum, r) => sum + (r.usd ?? 0), 0);
  const tag = (await proxy.usage()).tags[CONFIGS[0]?.id ?? '']?.usd ?? 0;
  expect(
    'at concurrency 1 each attempt is costed exactly, and attempts add up to the bot total',
    records.every((r) => r.cost_attribution === 'exact' && (r.usd ?? 0) > 0) && Math.abs(costed - tag) < 0.001,
    `${records.map((r) => `${r.task} ${r.cost_attribution} $${r.usd?.toFixed(4)}`).join(', ')}; total $${tag.toFixed(4)}`,
  );
}

/* a bot that meters itself */
{
  const { records, proxy, own, meter } = await run([task('write-post'), task('mem-locker'), task('lookup-fx')], 1, { selfMeter: true });
  const id = CONFIGS[0]?.id ?? '';
  const ownTotal = (await own?.usage())?.tags[id]?.usd ?? 0;
  const costed = records.reduce((sum, r) => sum + (r.usd ?? 0), 0);
  expect(
    'a self-metered bot is costed from its own meter, exactly, and nothing of it is on the proxy',
    ownTotal > 0 && (await proxy.usage()).tags[id] === undefined && records.every((r) => r.cost_attribution === 'exact' && (r.usd ?? 0) > 0) && Math.abs(costed - ownTotal) < 0.001 && Math.abs(meter.tagSpend(id).usd - ownTotal) < 1e-9,
    `attempts $${costed.toFixed(4)}, own meter $${ownTotal.toFixed(4)}`,
  );
  const shorts = set.tasks.filter((t) => t.variant === 'short').slice(0, 8);
  // $0.03 already on the proxy and a $0.06 cap: only the sum of both meters can reach it.
  const capped = await run(shorts, 1, { selfMeter: true, cap: 0.06, proxySpentBefore: 0.03 });
  const ownSpend = (await capped.own?.usage())?.tags[id]?.usd ?? 0;
  const stopped = capped.records.filter((r) => r.outcome === 'stopped_for_spend').length;
  expect(
    'the cap counts the proxy plus a self-metered bot, and stops new jobs',
    capped.stoppedForSpend && stopped > 0 && capped.proxy.totalUsd < 0.06 && capped.proxy.totalUsd + ownSpend >= 0.06,
    `proxy $${capped.proxy.totalUsd.toFixed(3)} + own $${ownSpend.toFixed(3)}; ${stopped} not started; ${capped.stopReason}`,
  );
}

console.log(failures ? `\n${failures} self-test check(s) failed` : '\nall self-test checks passed');
process.exit(failures ? 1 : 0);
