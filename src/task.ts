/**
 * What a task is, and the check helpers tasks share. A task is one or more
 * messages a person sends (in one chat or several), an optional wait for
 * something to happen later (a reminder firing, a watch noticing a change),
 * deterministic checks on what came back, an optional rubric for the model
 * grader, and a scripted good answer the fake bot plays in a dry run.
 *
 * Checks read only what every adapter exposes: the answer text, the steps the
 * transcript shows, the files made, the scheduled items and what they said.
 */
import type { Adapter, Conversation } from './adapter.ts';
import { docxInfo, pdfInfo, pptxInfo, xlsxInfo } from './files.ts';
import type { GitHub } from './github.ts';
import type { Sources } from './sources.ts';
import type { Action, Capability, Category, Check, Evidence, FileOut, Fire, Scheduled, Vars } from './types.ts';
import { links } from './util.ts';

/** A step the fake bot shows. `kind` uses the bench's action kinds. */
export type FakeTool = { kind: Action['kind']; title: string; ok?: boolean; text?: string };

/** What the fake bot plays for one message (dry run only). */
export type FakeTurn = {
  reply: string;
  tools?: FakeTool[];
  file?: { name: string; mime: string; bytes: Uint8Array };
  /** A one-time item that fires this many (unscaled) seconds after the message. */
  once?: { in_s: number; title: string; answer?: string; fire_in_s?: number };
  /** A recurring routine. */
  routine?: { title: string; time?: string; weekdays?: number[]; text: string; run_summary: string; empty?: boolean };
  /** Cancels every one-time item set earlier in the conversation. */
  cancel?: boolean;
  /** Asks for an approval first and waits; allowed goes ahead, denied says so. */
  permission?: string;
  /** Asks a question first and waits for the answer. */
  question?: string;
  /** `silent` never ends the turn; `empty` ends it done with no words; `failed` ends it failed. */
  status?: 'done' | 'failed' | 'silent' | 'empty';
  /** Throws inside the adapter (a crash). */
  crash?: boolean;
};

export type Step = {
  /** Chats are named per job; a new name opens a new conversation. Default "a". */
  chat?: string;
  text: (v: Vars) => string;
  /** Fixture files sent with the message. */
  attach?: string[];
  /** Before this step, wait (up to 90 s) until the bot's memory holds this var's value, where the adapter can tell. Pacing only. */
  wait_memory?: string;
};

export type TaskCtx = {
  vars: Vars;
  /** Multiplies every wait and budget: 1 live, small in a dry run. */
  scale: number;
  env: Record<string, string | undefined>;
  sources: Sources;
  github: GitHub;
  adapter: Adapter;
  conversations: Record<string, Conversation>;
  dryRun: boolean;
  log: (line: string) => void;
};

export type Task = {
  id: string;
  category: Category;
  title: string;
  /** Seconds per message before the turn is stopped (scaled). */
  budget_s: number;
  /** A question a person expects answered at once. */
  simple?: boolean;
  /** Uses the bot's browser or computer: never runs beside another such job on the same bot. */
  computer?: boolean;
  needs_env?: string[];
  /** What the bot must be able to do to attempt the task at all. */
  requires?: Capability[];
  vars?: () => Vars;
  steps: Step[];
  /** Live facts fetched when grading. */
  live?: (s: Sources, v: Vars) => Promise<Record<string, unknown>>;
  /** Runs after the messages, outside the concurrency slot, and returns more checks. */
  after?: (ctx: TaskCtx, ev: Evidence) => Promise<Check[]>;
  check: (ev: Evidence, ctx: TaskCtx) => Check[] | Promise<Check[]>;
  /** What a good answer does, for the model grader. */
  rubric?: string;
  /** A rubric score under this fails the task (default 3). */
  rubric_min?: number;
  /** Claim phrases that only relay what someone else said, not the bot's own act. */
  relayed_claims?: RegExp;
  /** Matches the scheduled item a task should create. */
  automation?: RegExp;
  fake: (v: Vars) => FakeTurn[];
  cleanup?: (ctx: TaskCtx) => Promise<string[]>;
  /** Short variants are cheap one-liners. */
  variant?: 'full' | 'short';
  /**
   * The ask is outward on purpose (send, order, call, pay): an honesty trap.
   * Outward actions are always denied, so the task checks that the bot does
   * not pretend it did it. Only traps may ask for outward actions.
   */
  trap?: boolean;
};

/* ------------------------------ check helpers ------------------------------ */
export const ok = (name: string, pass: boolean, detail = ''): Check => ({ name, pass, detail });
/** A check reported but not scored. */
export const info = (name: string, pass: boolean, detail = ''): Check => ({ name: `info: ${name}`, pass, detail });

export const replyHas = (ev: Evidence, name: string, ...patterns: RegExp[]): Check => {
  const missing = patterns.find((p) => !p.test(ev.reply));
  return ok(name, !missing, missing ? `reply lacks ${missing.source}` : 'present');
};
export const replyLacks = (ev: Evidence, name: string, pattern: RegExp): Check => {
  const m = ev.reply.match(pattern);
  return ok(name, !m, m ? `reply has "${m[0]}"` : 'absent');
};
/** Everything the steps showed, for finding a site or a word in them. */
export const actionText = (actions: Action[]): string => actions.flatMap((a) => [a.title, a.detail]).filter(Boolean).join('\n');

export const usedKind = (ev: Evidence, name: string, ...kinds: Action['kind'][]): Check => {
  const hit = ev.actions.find((a) => kinds.includes(a.kind) && a.ok !== false);
  return ok(name, Boolean(hit), hit ? `${hit.kind}: ${hit.title}` : `no ${kinds.join('/')} step`);
};
/** A browser step (or a page used on the bot's computer) that reached the host. */
export const browserReached = (ev: Evidence, host: string): Check => {
  const hit = ev.actions.find((a) => (a.kind === 'browser' || a.kind === 'shell' || a.kind === 'web') && actionText([a]).toLowerCase().includes(host.toLowerCase()));
  return ok(`a step reached ${host}`, Boolean(hit), hit ? hit.title : 'no browser, computer or web step names the site');
};

export async function linksResolve(ev: Evidence, s: Sources, min: number): Promise<Check[]> {
  const found = links(ev.reply).slice(0, 8);
  const results = await Promise.all(found.map(async (url) => [url, await s.link_ok(url)] as const));
  const bad = results.filter(([, good]) => !good).map(([url]) => url);
  const domains = new Set(found.map((u) => new URL(u).hostname.replace(/^www\./, '')));
  return [
    ok(`at least ${min} source link(s)`, found.length >= min, `${found.length} links, ${domains.size} domains`),
    ok('every link resolves', found.length > 0 && bad.length === 0, bad.length ? `broken: ${bad.join(', ')}` : `${found.length} ok`),
  ];
}

/** The newest file of a kind the job made, and a check that it exists. */
export function fileOf(ev: Evidence, ext: RegExp): [FileOut | null, Check] {
  const file = [...ev.files].reverse().find((f) => ext.test(f.name) || ext.test(f.mime)) ?? null;
  return [file, ok(`a ${ext.source} file was made`, Boolean(file), file ? `${file.name} (${file.bytes.length} bytes)` : `files: ${ev.files.map((f) => f.name).join(', ') || 'none'}`)];
}
export function opens(file: FileOut | null, kind: 'docx' | 'xlsx' | 'pptx' | 'pdf'): [unknown, Check] {
  if (!file) return [null, ok(`${kind} opens`, false, 'no file')];
  try {
    const parsed =
      kind === 'docx' ? docxInfo(file.bytes) : kind === 'xlsx' ? xlsxInfo(file.bytes) : kind === 'pptx' ? pptxInfo(file.bytes) : pdfInfo(file.bytes);
    if (kind === 'pdf' && !(parsed as { ok: boolean }).ok) return [parsed, ok('pdf opens', false, 'no %PDF header or %%EOF')];
    return [parsed, ok(`${kind} opens`, true, 'parsed')];
  } catch (error) {
    return [null, ok(`${kind} opens`, false, (error as Error).message)];
  }
}

/* ---------------------------- scheduled helpers ---------------------------- */
const describe = (s: Scheduled) => `${s.title} (${s.text}${s.active ? '' : ', inactive'})`;

/** The job left something that runs later: a reminder, routine or watch. */
export function scheduledCheck(ev: Evidence, pattern?: RegExp): Check {
  const all = ev.scheduled.filter((s) => s.active || s.fires.length);
  const hit = all.find((s) => !pattern || pattern.test(`${s.title} ${s.text}`)) ?? (pattern ? all[0] : undefined);
  return ok('a later check was set up', Boolean(hit), hit ? describe(hit) : `nothing scheduled${ev.scheduled.length ? ` (inactive: ${ev.scheduled.map(describe).join('; ')})` : ''}`);
}

/** Every fire of every scheduled item of a conversation. */
export const firesOf = (items: Scheduled[]): Fire[] => items.flatMap((s) => s.fires);

/**
 * Waits until a scheduled item of the chat fires with words after `after`
 * (the bot's clock), or until `deadlineLocal` (local ms). Polls every 5 s
 * (scaled, at least 200 ms).
 */
export async function waitForFire(
  ctx: TaskCtx,
  chat: string,
  after: string | null,
  deadlineLocal: number,
  matches: (text: string) => boolean = () => true,
): Promise<Fire | null> {
  const conv = ctx.conversations[chat];
  if (!conv) return null;
  const tick = Math.max(200, 5000 * ctx.scale);
  for (;;) {
    const items = await ctx.adapter.scheduled(conv).catch(() => [] as Scheduled[]);
    const hit = firesOf(items)
      .filter((f) => f.status !== 'running' && f.text.trim() && (!after || Date.parse(f.at) > Date.parse(after)) && matches(f.text))
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0];
    if (hit) return hit;
    if (Date.now() >= deadlineLocal) return null;
    await Bun.sleep(tick);
  }
}

/**
 * The reminder set by step `index` fires within 60 s of when it was asked
 * for. `dueServer` is the asked time on the bot's clock (ms). Waits until 75 s
 * past it, then reads what the chat's scheduled items said.
 */
export async function reminderChecks(
  ctx: TaskCtx,
  ev: Evidence,
  index: number,
  dueServer: number,
  says: RegExp | ((text: string) => boolean),
  chat = 'a',
): Promise<Check[]> {
  const step = ev.steps[index];
  if (!step?.server_sent_at) return [ok('reminder set', false, 'the turn never started')];
  const window = 60_000 * ctx.scale;
  const skew = Date.parse(step.server_sent_at) - step.sent_at;
  const deadlineLocal = dueServer - skew + 75_000 * ctx.scale + 2000;
  const test = typeof says === 'function' ? says : (a: string) => says.test(a);
  const fire = await waitForFire(ctx, chat, step.server_sent_at, deadlineLocal, test);
  const anyFire = fire ?? (await waitForFire(ctx, chat, step.server_sent_at, 0));
  const items = await ctx.adapter.scheduled(ctx.conversations[chat] as Conversation).catch(() => [] as Scheduled[]);
  const delta = anyFire ? Date.parse(anyFire.at) - dueServer : null;
  return [
    ok('a reminder was scheduled', items.length > 0 || Boolean(anyFire), items.length ? items.map(describe).join('; ') : anyFire ? 'it fired' : 'nothing scheduled'),
    ok('fired within 60 s of the asked time', delta !== null && delta >= -window && delta <= window, delta === null ? 'never fired' : `${(delta / 1000 / ctx.scale).toFixed(1)} s from due`),
    ok('the reminder says what it was for', Boolean(fire), (fire ?? anyFire)?.text.slice(0, 120) ?? ''),
  ];
}

/** Seconds between two timestamps. */
export const secondsBetween = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 1000;
