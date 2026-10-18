/**
 * OpenMausBot (https://github.com/milind-soni/OpenMausBot), driven through its
 * HTTP API. Written against v0.1.115, commit 351c04d9. Every route below was
 * read in that commit's source; line numbers are from it.
 *
 *   GET  /.well-known/openmausbot/environment   version and capabilities.jobs, no auth (server/environment.ts; server/index.ts:13822)
 *   GET  /api/health                            {app: "openmausbot"} (server/routes/status.ts:41)
 *   GET  /api/config                            browserEngine.kind === "engine" means bots have a browser (server/routes/config.ts:108)
 *   GET  /api/instances                         engines and their state (server/routes/instances.ts:57)
 *   GET  /api/bots?messages=0                   bots: id, name, threadId, tasks[], modelSelection (server/routes/threads.ts:73)
 *   POST /api/bots/:id/tasks {title}            a new conversation (task) -> {task: {threadId}} (server/routes/tasks.ts:156)
 *   DELETE /api/bots/:id/tasks/:threadId        removes it (server/routes/tasks.ts:379)
 *   POST /api/attachments?uploadId=<uuid>       raw image bytes -> {path} (server/routes/threads.ts:260)
 *   POST /api/files?name=<n>&uploadId=<uuid>    raw document bytes -> {path, name} (server/routes/threads.ts:315)
 *        Uploads ride in the message text as <attached-image path name /> / <attached-file path name />
 *        (src/lib/composer-attachments.ts).
 *   POST /api/bots/:id/messages {text, threadId, sendId} -> 202 {message: {id, at}} or {queued} (server/routes/bot-messages.ts)
 *   GET  /api/threads/:id/job?scope=turn&since=&wait=&version=   long-poll JobView: state running | needs-input |
 *        completed | failed | stalled | idle (server/routes/jobs.ts:65; server/job-view.ts). The same call the
 *        headless CLI and the MCP server make (server/headless/client.ts readJob; scripts/mcp-server.ts waitForJob).
 *   GET  /api/threads/:id/messages?limit=N      WireMessage[]: text, activity (tool {name, ok, summary, input, output}),
 *        options cards {requestId, requestType permission|question, answered…}, turnTerminal (server/routes/threads.ts:101; shared/wire.ts)
 *   POST /api/bots/:id/respond {threadId, requestId, behavior: allow|deny|answer, message?} (server/routes/bot-messages.ts:395)
 *   POST /api/bots/:id/interrupt {threadId}     Stop (server/routes/bot-messages.ts:584)
 *   POST /api/threads/:tid/messages/:mid/file {path[, entry]}  a file a bot message links to; a folder answers with
 *        x-openmausbot-folder: 1 and its entries (server/routes/threads.ts:142; server/message-file.ts messageFileTargets)
 *   GET  /api/routines                          {routines, runs} (server/index.ts:16098; server/routines.ts)
 *   POST /api/routines/:id/run, DELETE /api/routines/:id (server/index.ts:16127, 16159)
 *   GET  /api/bots/:id/memory                   index, topic and log files (server/routes/bot-memory.ts:60)
 *   GET|PUT|DELETE /api/bots/:id/memory/file?path=  one memory file: read for pacing (memoryHolds, never scored),
 *        and to put the bot's memory back as it was before each attempt
 *
 * Auth: `Authorization: Bearer <token>` (a token from `openmausbot connect`); a loopback caller needs none.
 *
 * Mapping to the bench's neutral shapes:
 * - tool names: Bash -> shell (browser when it drives agent-browser), WebSearch/WebFetch -> web,
 *   Write/Edit/MultiEdit/NotebookEdit -> file, mcp__browser__* and mcp__computer__* -> browser, others by name.
 * - the reply is the turn's terminal bot text (turnTerminal), else every bot text after the person's message.
 * - files are the targets bot messages link to (and bot attachments), fetched through the message file route.
 * - routines whose source or results thread is the conversation are its scheduled items; their runs are fires.
 *
 * Known limits (see the report): messages carry no time zone (the server's TZ must match BENCH_TIME_ZONE);
 * memory is per bot and outlives a deleted conversation, so the adapter snapshots the memory files before
 * its first conversation, puts them back when an attempt's last conversation is deleted, and checks them
 * again when the next attempt opens its first (the bot also takes notes from a chat in the background,
 * minutes later, which can land after the clean-up); each run of a routine opens a thread of its own, deleted
 * with the routine; a question card with several questions is answered
 * with one text; a routine proposal may wait on a confirmation card unless the bot has Full access.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import type { Adapter, Attachment, BotConfig, Conversation, Preflight, Turn, TurnEvent, TurnResult } from '../adapter.ts';
import { actionKind, EventQueue } from '../adapter.ts';
import type { Action, Capability, Card, Fire, FileOut, Scheduled, TurnStatus } from '../types.ts';

type Rec = Record<string, any>;
type Wire = {
  id: string;
  role: 'bot' | 'user';
  at: number;
  kind: string;
  text?: string;
  tool?: { name: string; ok?: boolean; summary?: string; input?: unknown; output?: unknown; terminal?: boolean };
  card?: { title?: string; subtitle?: string; options?: { label?: string }[] | string[]; requestType?: string; requestId?: string; answered?: unknown; dismissed?: boolean; expired?: boolean; quotaSwitch?: boolean; tool?: unknown };
  connector?: Rec;
  secret?: Rec;
  signIn?: Rec;
  attachments?: { kind: string; path: string; mime?: string; name?: string }[];
  turnTerminal?: boolean;
  turnSucceeded?: boolean;
  turnId?: string;
  turnCompletedAt?: number;
};
type Routine = {
  id: string;
  name: string;
  prompt: string;
  botId: string;
  enabled: boolean;
  schedule: { type: 'once'; at: number } | { type: 'daily'; time: string; weekdays: number[] } | { type: 'cron'; expression: string; timeZone?: string } | { type: 'interval'; everyMinutes: number; weekdays?: number[] };
  sourceThreadId?: string;
  resultsThreadId?: string;
  nextRunAt: number | null;
  createdAt: number;
};
type RoutineRun = { id: string; routineId: string; status: string; threadId?: string; startedAt?: number; finishedAt?: number; output?: string; error?: string; createdAt: number };

const enc = encodeURIComponent;
const iso = (ms: number | string | null | undefined) => (ms === null || ms === undefined ? null : new Date(typeof ms === 'number' ? ms : Date.parse(ms)).toISOString());
const FINAL = new Set(['needs-input', 'completed', 'failed', 'stalled', 'idle']);

/** The same test the product's MCP server uses for "this message waits on the person" (scripts/mcp-server.ts messageNeedsInput). */
function needsInput(m: Wire): boolean {
  const card = Boolean(m.card && m.card.requestId && !m.card.answered && !m.card.dismissed && !m.card.expired && !m.card.quotaSwitch);
  const connector = Boolean(m.connector && !m.connector.dismissed && !m.connector.resumed && m.connector.status !== 'connected');
  const secret = Boolean(m.secret && !m.secret.provided && !m.secret.dismissed && !m.secret.superseded);
  const signIn = Boolean(m.signIn && !m.signIn.done && !m.signIn.cancelled && !m.signIn.superseded);
  return card || connector || secret || signIn;
}

function kindOf(tool: NonNullable<Wire['tool']>): Action['kind'] {
  const name = tool.name;
  const said = `${tool.summary ?? ''} ${typeof tool.input === 'string' ? tool.input : JSON.stringify(tool.input ?? '')}`;
  if (name === 'Bash') return /\bagent-browser\b/.test(said) ? 'browser' : 'shell';
  if (name === 'WebSearch' || name === 'WebFetch') return 'web';
  if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(name)) return 'file';
  if (/^mcp__(?:browser|computer)__/.test(name)) return 'browser';
  return actionKind(`${name} ${tool.summary ?? ''}`);
}
const toAction = (m: Wire): Action => {
  const tool = m.tool as NonNullable<Wire['tool']>;
  const input = typeof tool.input === 'string' ? tool.input : tool.input ? JSON.stringify(tool.input) : '';
  const detail = [tool.summary, input].filter(Boolean).join(' | ').slice(0, 600);
  return { id: m.id, kind: kindOf(tool), title: tool.name, ok: tool.ok === undefined ? null : tool.ok, ...(detail ? { detail } : {}) };
};
const cardText = (m: Wire) => {
  const c = m.card ?? {};
  const options = (c.options ?? []).map((o) => (typeof o === 'string' ? o : (o.label ?? ''))).filter(Boolean);
  return [c.title, c.subtitle, typeof c.tool === 'string' ? c.tool : c.tool ? JSON.stringify(c.tool) : '', options.length ? `options: ${options.join(' / ')}` : ''].filter(Boolean).join(' | ').slice(0, 2000);
};

/** Link targets in a bot message that point at files, the rule the server applies (server/message-file.ts). */
export function fileTargets(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
    const target = m[1] as string;
    if (target.startsWith('#') || target.startsWith('//')) continue;
    if (/^[a-z]:[\\/]/i.test(target) || /^file:/i.test(target) || !/^[a-z][a-z\d+.-]*:/i.test(target)) out.add(target);
  }
  return [...out];
}

/**
 * Reminders the engine keeps in the conversation's own session (Claude Code's CronCreate / CronDelete tools)
 * rather than as routines. The product delivers them: when one fires, the bot posts into the conversation on
 * its own (a bot text that arrives after its turn completed, with no new message from the person). Each
 * CronCreate is an item; a later CronDelete naming its task id (or naming none) cancels it; unprompted bot
 * texts are its fires, each given to the latest cron created before it. Cron times are the server's clock.
 */
export function sessionCrons(messages: Wire[], now = Date.now()): Scheduled[] {
  const parse = (input: unknown): Rec => {
    if (input && typeof input === 'object') return input as Rec;
    try {
      return JSON.parse(String(input ?? '')) as Rec;
    } catch {
      return {};
    }
  };
  type Cron = Scheduled & { createdAt: number; taskId: string | null; due: number | null; deleted: boolean };
  const crons: Cron[] = [];
  const completed = new Map<string, number>();
  for (const m of messages) if (m.turnId && m.turnTerminal && m.turnCompletedAt) completed.set(m.turnId, m.turnCompletedAt);
  for (const m of messages) {
    if (m.role !== 'bot' || m.kind !== 'activity' || !m.tool || m.tool.ok === false) continue;
    const input = parse(m.tool.input);
    if (m.tool.name === 'CronCreate') {
      const expression = String(input.cron ?? '');
      const recurring = input.recurring === true;
      const taskId = String(m.tool.output ?? '').match(/task\s+([0-9a-f]{4,})/i)?.[1] ?? null;
      const due = recurring ? null : onceAt(expression, m.at);
      crons.push({
        id: `cron:${taskId ?? m.id}`,
        title: String(input.prompt ?? 'session reminder').slice(0, 120),
        kind: recurring ? 'recurring' : 'once',
        active: true,
        next_at: due === null ? null : new Date(due).toISOString(),
        cron: expression || null,
        text: `${recurring ? 'session cron' : 'one-shot session cron'} ${expression}`,
        can_run_now: false,
        fires: [],
        createdAt: m.at,
        taskId,
        due,
        deleted: false,
      });
    } else if (m.tool.name === 'CronDelete') {
      const target = String(input.id ?? input.task_id ?? input.taskId ?? '');
      for (const c of crons) if (c.createdAt <= m.at && (!target || target === c.taskId)) c.deleted = true;
    }
  }
  for (const m of messages) {
    if (m.role !== 'bot' || m.kind !== 'text' || m.turnTerminal || !m.text?.trim()) continue;
    const done = m.turnId ? completed.get(m.turnId) : undefined;
    if (done === undefined || m.at <= done) continue;
    const owner = crons.filter((c) => c.createdAt < m.at).at(-1);
    owner?.fires.push({ at: new Date(m.at).toISOString(), text: m.text, status: 'done' });
  }
  return crons.map(({ createdAt: _c, taskId: _t, due, deleted, ...item }) => ({
    ...item,
    active: !deleted && (item.kind === 'recurring' || (item.fires.length === 0 && (due === null || due > now - 120_000))),
  }));
}

/** The time a one-shot cron "m h dom mon *" next matches after `from` (server clock, UTC here), or null. */
function onceAt(expression: string, from: number): number | null {
  const [m, h, dom, mon] = expression.trim().split(/\s+/).map(Number);
  if ([m, h, dom, mon].some((n) => n === undefined || !Number.isInteger(n))) return null;
  const year = new Date(from).getUTCFullYear();
  const at = Date.UTC(year, (mon as number) - 1, dom as number, h as number, m as number);
  return at >= from - 60_000 ? at : Date.UTC(year + 1, (mon as number) - 1, dom as number, h as number, m as number);
}

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\t/g, '&#9;').replace(/\r/g, '&#13;').replace(/\n/g, '&#10;');

type Native = { botId: string; threadId: string; openedAt: number; routineSnapshot: Set<string>; turns: Map<string, TurnState> };
type TurnState = { userMessageId: string | null; sentAt: number; ended: TurnStatus | null; reason?: string; answered: Set<string> };

export type OpenMausBotOptions = { scale: number; env: Record<string, string | undefined> };

export class OpenMausBotAdapter implements Adapter {
  readonly id: string;
  readonly productNames = ['OpenMausBot', 'Open Maus Bot', 'MausBot', 'Maus', 'OMB', 'Claude Code'];
  private base: string;
  private token: string | undefined;
  private botId: string | null = null;
  /** Conversations opened and not yet deleted. */
  private open = new Set<string>();
  /** The bot's memory files before the bench's first conversation: every attempt starts from and returns to these. */
  private baseline: Map<string, string> | null = null;
  /** What the check at an attempt's start found and undid, reported with that attempt's clean-up. */
  private startLine: string | null = null;

  constructor(
    private config: BotConfig,
    private opts: OpenMausBotOptions,
  ) {
    this.id = config.id;
    this.base = (opts.env[config.env.url ?? 'BENCH_OPENMAUSBOT_URL'] ?? '').replace(/\/+$/, '');
    this.token = opts.env[config.env.token ?? 'BENCH_OPENMAUSBOT_TOKEN'];
  }

  private async call<T = Rec>(method: string, path: string, body?: unknown, extra: { raw?: boolean; headers?: Record<string, string>; bytes?: Uint8Array; timeoutMs?: number } = {}): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json', ...(this.token ? { authorization: `Bearer ${this.token}` } : {}), ...(extra.headers ?? {}) };
    let payload: BodyInit | undefined;
    if (extra.bytes) payload = new Uint8Array(extra.bytes);
    else if (body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const response = await fetch(`${this.base}${path}`, { method, headers, ...(payload === undefined ? {} : { body: payload }), signal: AbortSignal.timeout(extra.timeoutMs ?? 60_000) });
    if (extra.raw) return response as unknown as T;
    const text = await response.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!response.ok) throw new Error(`OpenMausBot ${response.status} ${method} ${path}: ${(data as Rec | null)?.error ?? text.slice(0, 200)}`);
    return data as T;
  }

  private async bot(): Promise<Rec> {
    const want = this.opts.env[this.config.env.bot ?? 'BENCH_OPENMAUSBOT_BOT'] ?? 'Bench';
    const fleet = await this.call('GET', '/api/bots?messages=0');
    const bot = (fleet.bots as Rec[]).find((b) => b.id === want || b.name === want);
    if (!bot) throw new Error(`no OpenMausBot bot named or with id "${want}". Create it (a new bot with the documented defaults, model ${this.config.model}) or set ${this.config.env.bot}.`);
    this.botId = bot.id as string;
    return bot;
  }

  async preflight(): Promise<Preflight> {
    if (!this.base) throw new Error(`set ${this.config.env.url ?? 'BENCH_OPENMAUSBOT_URL'} to the OpenMausBot server address (the one its web app opens).`);
    const notes: string[] = [];
    let env: Rec;
    try {
      env = await this.call('GET', '/.well-known/openmausbot/environment', undefined, { timeoutMs: 10_000 });
    } catch (error) {
      throw new Error(`no OpenMausBot server answered at ${this.base} (${(error as Error).message}). Check ${this.config.env.url} and that the server is up.`);
    }
    const health = await this.call('GET', '/api/health').catch(() => null);
    if (health?.app !== 'openmausbot') throw new Error(`the server at ${this.base} does not say it is OpenMausBot (/api/health app = ${String(health?.app)}).`);
    let version = String(env.version ?? 'unknown').replace(/^v/, '');
    // The Docker image ships no package.json, so a container install reports "unknown" (server/environment.ts
    // reads the version from it). Nothing contradicts the pin then: record it as unverified rather than refuse.
    if (version === 'unknown' || version === '0.0.0') {
      notes.push(`the server does not report its version (it says "${version}"); the pin ${this.config.version_pin} and commit come from the deployment, unverified through the API`);
      version = `${this.config.version_pin.replace(/^v/, '')} (unverified)`;
    } else if (version !== this.config.version_pin.replace(/^v/, '') && this.opts.env.BENCH_ALLOW_VERSION_MISMATCH !== '1')
      throw new Error(
        `OpenMausBot reports version ${version}, but bots/${this.config.id}.json pins ${this.config.version_pin}. The adapter was written against that version's API. Deploy ${this.config.version_pin}, or update the adapter and the pin, or set BENCH_ALLOW_VERSION_MISMATCH=1 to run anyway (the report records it).`,
      );
    if (env.capabilities?.jobs !== true) throw new Error('this OpenMausBot server does not report conversation jobs (capabilities.jobs); the adapter needs GET /api/threads/:id/job. Update the server to the pinned version.');
    try {
      await this.call('GET', '/api/auth/session');
    } catch (error) {
      if (/\b401\b|\b403\b/.test((error as Error).message)) throw new Error(`OpenMausBot refused the request: set ${this.config.env.token} to a token from \`openmausbot connect\` (scopes admin and client).`);
    }
    const bot = await this.bot();
    const selection = (bot.modelSelection ?? {}) as Rec;
    const model = selection.model ? `${selection.instanceId ?? ''}/${selection.model}` : null;
    const want = this.config.model.replace(/^.*\//, '');
    if (!model || !String(selection.model).endsWith(want))
      throw new Error(`OpenMausBot bot "${bot.name}" runs ${model ?? 'no model'}, not ${want}. Set the bot's model to ${want} (openmausbot bots update ${bot.name} --model …) and run again.`);
    const instances = await this.call('GET', '/api/instances').catch(() => null);
    const instance = ((instances?.instances ?? instances ?? []) as Rec[]).find?.((i: Rec) => i.id === selection.instanceId);
    if (instance && instance.snapshot?.state && instance.snapshot.state !== 'ready' && instance.snapshot.state !== 'available') notes.push(`engine ${selection.instanceId} reports ${instance.snapshot.state}`);
    const config = await this.call('GET', '/api/config').catch(() => null);
    const caps: Capability[] = ['chat', 'attach.image', 'attach.file', 'files.out', 'schedule', 'schedule.run_now', 'memory'];
    if (config?.browserEngine?.kind === 'engine') caps.push('browser');
    else notes.push('no browser engine installed: browser tasks are unsupported');
    notes.push(`messages carry no time zone; the server's clock zone must be ${process.env.BENCH_TIME_ZONE ?? 'America/Los_Angeles'} for reminder times to mean the same thing`);
    return {
      bot: this.id,
      product: this.config.product,
      version,
      commit: (this.config.settings.commit as string | undefined) ?? null,
      model,
      capabilities: caps,
      settings: { ...this.config.settings, bot: bot.name, approval: bot.approvalMode ?? this.config.settings.approval },
      notes,
    };
  }

  /** Every memory file of the bot (index, topics, daily logs) by path. */
  private async memoryFiles(): Promise<Map<string, string>> {
    const botId = this.botId ?? (await this.bot()).id;
    const overview = await this.call('GET', `/api/bots/${enc(botId)}/memory`);
    const index = await this.call('GET', `/api/bots/${enc(botId)}/memory/file`);
    const paths = [String(index.path), ...[...(overview.topics ?? []), ...(overview.logs ?? [])].map((f: Rec) => String(f.path))];
    const files = new Map<string, string>();
    for (const path of new Set(paths)) {
      const doc = await this.call('GET', `/api/bots/${enc(botId)}/memory/file?path=${enc(path)}`);
      if (doc.exists !== false) files.set(path, String(doc.text ?? ''));
    }
    return files;
  }

  /**
   * Puts the bot's memory back as it was before the bench began: files added since are deleted, changed ones
   * rewritten. The bench's equivalent of deleting a chat together with what it taught memory, so every attempt
   * starts from the same memory and nothing one attempt said (the bot also journals each chat) reaches the next.
   * Returns how many files it removed and rewrote.
   */
  private async restoreMemory(before: Map<string, string>): Promise<{ removed: number; rewritten: number }> {
    const botId = this.botId ?? (await this.bot()).id;
    const now = await this.memoryFiles();
    let removed = 0;
    let rewritten = 0;
    for (const path of now.keys())
      if (!before.has(path)) {
        await this.call('DELETE', `/api/bots/${enc(botId)}/memory/file?path=${enc(path)}`);
        removed++;
      }
    for (const [path, text] of before)
      if (now.get(path) !== text) {
        await this.call('PUT', `/api/bots/${enc(botId)}/memory/file`, { path, text });
        rewritten++;
      }
    return { removed, rewritten };
  }

  async newConversation(chat: string, title: string): Promise<Conversation> {
    const botId = this.botId ?? (await this.bot()).id;
    if (this.open.size === 0) {
      // The bot also learns from chats in the background, minutes after they end and after they are deleted,
      // so a note from an earlier attempt can land after that attempt's clean-up. Each attempt therefore starts
      // by checking memory against the bench's starting point and undoing any such late note.
      if (!this.baseline) this.baseline = await this.memoryFiles().catch(() => null);
      else {
        const undone = await this.restoreMemory(this.baseline).catch((error) => error as Error);
        this.startLine =
          undone instanceof Error
            ? `memory not checked at the start (${undone.message})`
            : undone.removed || undone.rewritten
              ? `at the start, undid memory the bot wrote after an earlier attempt's clean-up (${undone.removed} file(s) removed, ${undone.rewritten} rewritten)`
              : null;
      }
    }
    const routines = await this.call('GET', '/api/routines').catch(() => ({ routines: [] }));
    const made = await this.call('POST', `/api/bots/${enc(botId)}/tasks`, { title: title.slice(0, 120) });
    const threadId = String(made.task?.threadId ?? made.threadId);
    const native: Native = { botId, threadId, openedAt: Date.now(), routineSnapshot: new Set(((routines.routines ?? []) as Routine[]).map((r) => r.id)), turns: new Map() };
    this.open.add(threadId);
    return { id: threadId, chat, title, opened_at: Date.now(), native };
  }

  private native(conv: Conversation): Native {
    return conv.native as Native;
  }

  private async upload(a: Attachment): Promise<string> {
    const uploadId = randomUUID();
    if (a.mime.startsWith('image/')) {
      const r = await this.call('POST', `/api/attachments?uploadId=${uploadId}`, undefined, { bytes: a.bytes, headers: { 'content-type': a.mime } });
      return `<attached-image path="${escapeAttr(String(r.path))}" name="${escapeAttr(a.name)}" />`;
    }
    const r = await this.call('POST', `/api/files?name=${enc(a.name)}&uploadId=${uploadId}`, undefined, { bytes: a.bytes, headers: { 'content-type': a.mime } });
    return `<attached-file path="${escapeAttr(String(r.path))}" name="${escapeAttr(String(r.name ?? a.name))}" />`;
  }

  private async messages(threadId: string, limit = 200): Promise<Wire[]> {
    const page = await this.call('GET', `/api/threads/${enc(threadId)}/messages?limit=${limit}`);
    return (page.messages ?? []) as Wire[];
  }

  /** Messages of this turn: after the person's message, up to the next message from a person. */
  private turnMessages(all: Wire[], state: TurnState): Wire[] {
    let start = state.userMessageId ? all.findIndex((m) => m.id === state.userMessageId) : -1;
    if (start < 0) start = all.findLastIndex((m) => m.role === 'user' && m.at >= state.sentAt - 5000);
    if (start < 0) return [];
    const rest = all.slice(start + 1);
    const next = rest.findIndex((m) => m.role === 'user' && m.kind === 'text');
    return next < 0 ? rest : rest.slice(0, next);
  }

  async send(conv: Conversation, text: string, attachments: Attachment[], signal: AbortSignal): Promise<Turn> {
    const native = this.native(conv);
    const tags = [];
    for (const a of attachments) tags.push(await this.upload(a));
    const before = await this.call('GET', `/api/threads/${enc(native.threadId)}/job?scope=turn`);
    let since = Number(before.now ?? before.since ?? Date.now());
    const sendId = `bench-${randomBytes(12).toString('base64url')}`;
    const sentAt = Date.now();
    const receipt = await this.call('POST', `/api/bots/${enc(native.botId)}/messages`, { text: [text, ...tags].join('\n\n'), threadId: native.threadId, sendId });
    const state: TurnState = { userMessageId: receipt.message?.id ?? null, sentAt: Number(receipt.message?.at ?? sentAt), ended: null, answered: new Set() };
    const turnKey = sendId;
    native.turns.set(turnKey, state);
    const out = new EventQueue<TurnEvent>();
    const stop = new AbortController();
    signal.addEventListener(
      'abort',
      () => {
        stop.abort();
        out.close();
      },
      { once: true },
    );
    const finish = (status: TurnStatus, reason?: string) => {
      if (state.ended) return;
      state.ended = status;
      if (reason) state.reason = reason;
      out.push({ type: 'end', status, ...(reason ? { reason } : {}) });
      out.close();
      stop.abort();
    };
    const shownText = new Map<string, number>();
    const shownTool = new Map<string, boolean | null>();
    const shownCards = new Set<string>();
    // Scans run one at a time (a periodic reader and the job poll both call it), so no text is pushed twice.
    let scanning: Promise<Wire[]> = Promise.resolve([]);
    const scan = () => (scanning = scanning.catch(() => [] as Wire[]).then(() => scanNow()));
    const scanNow = async () => {
      const turn = this.turnMessages(await this.messages(native.threadId), state);
      for (const m of turn) {
        if (m.role !== 'bot') continue;
        if (m.kind === 'text' && m.text) {
          const seen = shownText.get(m.id) ?? 0;
          if (m.text.length > seen) {
            out.push({ type: 'text', text: (seen ? '' : shownText.size ? '\n\n' : '') + m.text.slice(seen) });
            shownText.set(m.id, m.text.length);
          }
        } else if (m.kind === 'activity' && m.tool) {
          const ok = m.tool.ok === undefined ? null : m.tool.ok;
          if (!shownTool.has(m.id) || shownTool.get(m.id) !== ok) {
            shownTool.set(m.id, ok);
            out.push({ type: 'action', action: toAction(m) });
          }
        }
        if (needsInput(m) && m.card?.requestId && !shownCards.has(m.card.requestId)) {
          shownCards.add(m.card.requestId);
          const type: Card['type'] = m.card.requestType === 'question' ? 'question' : 'approval';
          out.push({ type: 'card', card: { id: m.card.requestId, type, text: cardText(m), raw: { requestId: m.card.requestId, messageId: m.id } } });
        }
      }
      return turn;
    };
    // The job long-poll returns on state changes, not on every new message: read the thread as
    // well (every second), so text and steps show when the bot posts them (the web app shows them live too).
    void (async () => {
      while (!stop.signal.aborted) {
        await Bun.sleep(Math.max(200, 1000 * this.opts.scale));
        if (!stop.signal.aborted) await scan().catch(() => undefined);
      }
    })();
    void (async () => {
      let version: string | undefined;
      let waitingSince: number | null = null;
      try {
        while (!stop.signal.aborted) {
          const hold = version === undefined ? 0 : Math.max(500, Math.min(15_000, 15_000 * Math.min(1, this.opts.scale * 10)));
          const params = new URLSearchParams({ scope: 'turn', since: String(since), ...(hold ? { wait: String(hold) } : {}), ...(version ? { version } : {}) });
          const job = await this.call('GET', `/api/threads/${enc(native.threadId)}/job?${params}`, undefined, { timeoutMs: hold + 20_000 });
          since = Number(job.since ?? since);
          version = String(job.version);
          const turn = await scan();
          if (job.state === 'running') {
            waitingSince = null;
            // The job's own status line is the product's placeholder, not something the bot wrote.
            if (!turn.some((m) => m.role === 'bot')) out.push({ type: 'progress', text: String(job.reason ?? 'working') });
            continue;
          }
          if (!FINAL.has(String(job.state))) continue;
          if (job.state === 'completed' || job.state === 'idle') return finish('done');
          if (job.state === 'failed') return finish('failed', String(job.reason ?? 'the job failed'));
          if (job.state === 'stalled') return finish('failed', `stalled: ${String(job.reason ?? '')}`);
          // needs-input: cards the bench can answer are out; anything else (a sign-in, a secret) needs the person.
          const open = turn.filter(needsInput);
          const answerable = open.filter((m) => m.card?.requestId && !state.answered.has(m.card.requestId));
          if (!open.length || open.some((m) => !m.card?.requestId)) return finish('needs_you');
          waitingSince ??= Date.now();
          if (!answerable.length && Date.now() - waitingSince > 20_000 * this.opts.scale) return finish('needs_you');
          version = undefined;
          await Bun.sleep(Math.max(200, 1000 * this.opts.scale));
        }
      } catch (error) {
        if (!stop.signal.aborted) finish('failed', `job poll: ${(error as Error).message.slice(0, 200)}`);
      }
    })();
    return { events: out, server_sent_at: iso(state.sentAt), native: turnKey };
  }

  async answerApproval(conv: Conversation, card: Card, decision: 'allow' | 'deny') {
    const native = this.native(conv);
    const { requestId } = card.raw as { requestId: string };
    await this.call('POST', `/api/bots/${enc(native.botId)}/respond`, { threadId: native.threadId, requestId, behavior: decision });
    for (const t of native.turns.values()) if (!t.ended) t.answered.add(requestId);
  }

  async answerQuestion(conv: Conversation, card: Card, text: string) {
    const native = this.native(conv);
    const { requestId } = card.raw as { requestId: string };
    await this.call('POST', `/api/bots/${enc(native.botId)}/respond`, { threadId: native.threadId, requestId, behavior: 'answer', message: text });
    for (const t of native.turns.values()) if (!t.ended) t.answered.add(requestId);
  }

  async interrupt(conv: Conversation) {
    const native = this.native(conv);
    await this.call('POST', `/api/bots/${enc(native.botId)}/interrupt`, { threadId: native.threadId });
  }

  async finishTurn(conv: Conversation, turn: Turn): Promise<TurnResult> {
    const native = this.native(conv);
    const state = native.turns.get(turn.native as string);
    if (!state) return { reply: '', status: 'stopped', actions: [], pending: 0 };
    await Bun.sleep(Math.max(50, 1000 * this.opts.scale));
    const messages = this.turnMessages(await this.messages(native.threadId), state);
    const texts = messages.filter((m) => m.role === 'bot' && m.kind === 'text' && m.text?.trim());
    const terminal = texts.filter((m) => m.turnTerminal);
    const reply = (terminal.length ? terminal : texts).map((m) => m.text as string).join('\n\n');
    return {
      reply,
      status: state.ended ?? 'stopped',
      actions: messages.filter((m) => m.role === 'bot' && m.kind === 'activity' && m.tool).map(toAction),
      pending: messages.filter(needsInput).length,
      ...(state.reason ? { reason: state.reason } : {}),
      server_sent_at: iso(state.sentAt),
    };
  }

  async listOutputs(conv: Conversation): Promise<FileOut[]> {
    const native = this.native(conv);
    const out: FileOut[] = [];
    const seen = new Set<string>();
    for (const m of await this.messages(native.threadId, 500)) {
      if (m.role !== 'bot' || m.kind !== 'text') continue;
      const targets = [...fileTargets(m.text ?? ''), ...(m.attachments ?? []).map((a) => a.path)];
      for (const target of targets) {
        if (seen.has(target)) continue;
        seen.add(target);
        out.push(...(await this.fetchFile(native.threadId, m.id, target)));
      }
    }
    return out;
  }

  private async fetchFile(threadId: string, messageId: string, path: string, entry?: string): Promise<FileOut[]> {
    const response = await this.call<Response>('POST', `/api/threads/${enc(threadId)}/messages/${enc(messageId)}/file`, { path, ...(entry ? { entry } : {}) }, { raw: true });
    if (!response.ok) return [];
    if (response.headers.get('x-openmausbot-folder') === '1') {
      const listing = (await response.json()) as { entries?: (string | { name: string })[] };
      const files: FileOut[] = [];
      for (const e of listing.entries ?? []) files.push(...(await this.fetchFile(threadId, messageId, path, typeof e === 'string' ? e : e.name)));
      return files;
    }
    const disposition = response.headers.get('content-disposition') ?? '';
    const named = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1] ?? disposition.match(/filename="?([^";]+)"?/i)?.[1];
    const name = named ? decodeURIComponent(named) : (entry ?? basename(path));
    return [{ id: `${messageId}:${path}${entry ? `/${entry}` : ''}`, name, mime: (response.headers.get('content-type') ?? '').split(';')[0] ?? '', bytes: new Uint8Array(await response.arrayBuffer()) }];
  }

  private async routinesOf(conv: Conversation): Promise<{ routines: Routine[]; runs: RoutineRun[] }> {
    const native = this.native(conv);
    const all = (await this.call('GET', '/api/routines')) as { routines: Routine[]; runs: RoutineRun[] };
    let mine = all.routines.filter((r) => r.sourceThreadId === native.threadId || r.resultsThreadId === native.threadId);
    // A routine that names no thread: new since this conversation opened, on this bot.
    if (!mine.length) mine = all.routines.filter((r) => !native.routineSnapshot.has(r.id) && r.botId === native.botId && !r.sourceThreadId && r.createdAt >= native.openedAt - 5000);
    return { routines: mine, runs: all.runs ?? [] };
  }

  async scheduled(conv: Conversation): Promise<Scheduled[]> {
    const { routines, runs } = await this.routinesOf(conv);
    const items: Scheduled[] = [];
    for (const r of routines) {
      const s = r.schedule;
      const text =
        s.type === 'once'
          ? `once at ${iso(s.at)}`
          : s.type === 'daily'
            ? `daily at ${s.time}${s.weekdays?.length && s.weekdays.length < 7 ? ` on ${s.weekdays.join(',')}` : ''}`
            : s.type === 'cron'
              ? `cron ${s.expression}`
              : `every ${s.everyMinutes} minutes`;
      const fires: Fire[] = [];
      for (const run of runs.filter((x) => x.routineId === r.id)) {
        let said = run.output ?? '';
        if (!said && r.resultsThreadId && run.startedAt) {
          const msgs = await this.messages(r.resultsThreadId, 100).catch(() => [] as Wire[]);
          said = msgs
            .filter((m) => m.role === 'bot' && m.kind === 'text' && m.at >= (run.startedAt as number) && m.at <= (run.finishedAt ?? Date.now()))
            .map((m) => m.text ?? '')
            .join('\n\n');
        }
        const done = ['completed', 'done', 'succeeded'].includes(run.status);
        const failed = ['failed', 'cancelled', 'missed'].includes(run.status);
        // When the run began, as for every bot (Melete: the wake turn's start); its message lands seconds later.
        fires.push({ at: iso(run.startedAt ?? run.finishedAt ?? run.createdAt) as string, text: said || (run.error ?? ''), status: done ? 'done' : failed ? 'failed' : 'running', ...(done && !said ? { empty: true } : {}) });
      }
      items.push({
        id: r.id,
        title: r.name,
        kind: s.type === 'once' ? 'once' : 'recurring',
        active: r.enabled && r.nextRunAt !== null,
        next_at: iso(r.nextRunAt),
        time: s.type === 'daily' ? s.time : null,
        weekdays: s.type === 'daily' ? s.weekdays : s.type === 'interval' ? (s.weekdays ?? null) : null,
        cron: s.type === 'cron' ? s.expression : null,
        text,
        can_run_now: true,
        fires,
      });
    }
    items.push(...sessionCrons(await this.messages(this.native(conv).threadId, 500)));
    return items;
  }

  async runScheduledNow(_conv: Conversation, item: Scheduled) {
    if (item.id.startsWith('cron:')) throw new Error('a session cron cannot be run now');
    await this.call('POST', `/api/routines/${enc(item.id)}/run`);
  }

  async deleteConversation(conv: Conversation): Promise<string[]> {
    const native = this.native(conv);
    const lines: string[] = [];
    if (this.startLine) lines.push(this.startLine);
    this.startLine = null;
    const { routines, runs } = await this.routinesOf(conv).catch(() => ({ routines: [] as Routine[], runs: [] as RoutineRun[] }));
    for (const r of routines) {
      await this.call('DELETE', `/api/routines/${enc(r.id)}`).then(
        () => lines.push(`deleted routine ${r.name}`),
        (error) => lines.push(`routine ${r.name} not deleted (${(error as Error).message})`),
      );
      // Each run of a routine opens a thread of its own for its result; those go with the routine.
      const threads = new Set([...runs.filter((x) => x.routineId === r.id).map((x) => x.threadId), r.resultsThreadId].filter((t): t is string => Boolean(t) && t !== native.threadId));
      for (const thread of threads)
        await this.call('DELETE', `/api/bots/${enc(native.botId)}/tasks/${enc(thread)}`).then(
          () => lines.push(`deleted the thread of a run of ${r.name}`),
          (error) => lines.push(`thread of a run of ${r.name} not deleted (${(error as Error).message})`),
        );
    }
    await this.call('DELETE', `/api/bots/${enc(native.botId)}/tasks/${enc(native.threadId)}`).then(
      () => lines.push('deleted the conversation'),
      (error) => lines.push(`conversation not deleted (${(error as Error).message})`),
    );
    this.open.delete(native.threadId);
    if (this.open.size === 0 && this.baseline) {
      await this.restoreMemory(this.baseline).then(
        ({ removed, rewritten }) => lines.push(removed || rewritten ? `restored the bot's memory to before the attempt (${removed} file(s) removed, ${rewritten} rewritten)` : "the bot's memory was unchanged"),
        (error) => lines.push(`memory not restored (${(error as Error).message})`),
      );
    }
    return lines;
  }

  async memoryHolds(value: string): Promise<boolean | null> {
    const files = await this.memoryFiles().catch(() => null);
    if (!files) return null;
    const needle = value.toLowerCase().replace(/[$,]/g, '');
    return [...files.values()].some((text) => text.toLowerCase().replace(/[$,]/g, '').includes(needle));
  }
}
