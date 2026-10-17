/**
 * Melete (https://github.com/ychampion/melete), driven through the HTTP API
 * its web app uses. Written against v0.2.1 at commit 4be3950.
 *
 * Routes used (all under <BENCH_MELETE_URL>/api):
 *   GET  /health                               version (no commit is reported; the commit comes from the bot config)
 *   POST /login {email,password}               session cookie `melete_session`
 *   GET  /model-settings                       the active provider/model; PUT /model-settings/default to set it
 *   GET  /experience/connections               refuses an account with messaging connections
 *   POST /conversations {title}                a new chat
 *   POST /attachments (multipart file, preview) an upload, referenced by id in the message
 *   POST /conversations/:id/messages {text, attachments, time_zone} + Idempotency-Key -> {turn_id}
 *   GET  /conversations/:id/events?since=      SSE: text_delta, tool, action, say, note, receipt, card, permission, question, status
 *   GET  /permissions, POST /permissions/:id {option: allow_once|deny, version}
 *   GET  /quick-answers, POST /quick-answers/:id {text | option_id}
 *   GET  /conversations/:id/messages           turns (answer text, status, created_at); a wake turn has empty text
 *   GET  /conversations/:id                    status and waiting_until (a timer the chat set on itself)
 *   GET  /conversations/:id/cards, /receipts   result cards (download handles) and receipts
 *   POST /conversations/:id/stop               Stop
 *   GET  /files, GET /{artifacts|files|attachments}/:id/content, DELETE /files/:id
 *   GET  /automations, POST /automations/:id/test, DELETE /automations/:id
 *   GET  /runs                                 background runs; those with standing.kind "schedule" are routines too
 *   POST /runs/:id/stop
 *   GET  /memory/items                         pacing only (memoryHolds), never scored
 *   GET  /usage                                the install's own meter (usage), for "meter": "self"
 *   DELETE /conversations/:id?forget_memory=true
 *
 * Mapping to the bench's neutral shapes:
 * - tool kinds: web -> web, browser -> browser, sandbox -> shell, file/artifact -> file,
 *   memory_* -> memory; a receipt for something that left (sent, posted, paid…) -> send.
 * - A chat's own timer (waiting_until, and the wake turns it produced) is one "once" item;
 *   automations of the chat and new scheduled background runs are "recurring" items.
 * - A turn that ends needs-you with no open card while the chat waits on its own timer ends done.
 */
import { randomUUID } from 'node:crypto';
import type { Adapter, Attachment, BotConfig, Conversation, Preflight, Turn, TurnEvent, TurnResult } from '../adapter.ts';
import { EventQueue } from '../adapter.ts';
import type { TagUsage } from '../meter.ts';
import { readSse } from '../sse.ts';
import type { Action, Capability, Card, FileOut, Scheduled, TurnStatus } from '../types.ts';
import { TIME_ZONE } from '../util.ts';

type ToolCall = {
  id: string;
  kind: string;
  title: string;
  status: string;
  input_summary?: { text?: string } | null;
  output_summary?: { text?: string } | null;
  detail?: { type: string; id: string; url?: string } | null;
};
type CardAction = { label: string; kind: string; handle: string; url?: string };
type ResultCard = { id: string; title: string; meta: string; primary_action: CardAction | null; secondary_actions: CardAction[] };
type Receipt = { id: string; what: string; where: string; when: string };
type Permission = { id: string; conversation_id?: string | null; version: string; created_at: string; title?: string; group?: string | null; [k: string]: unknown };
type Question = { id: string; conversation_id: string | null; text: string; options: { id: string; label: string }[]; free_text: boolean };
type MTurn = { id: string; text: string; answer: string; status: string; created_at: string };
type MEvent = { seq: number; conversation_id: string; turn_id: string | null; created_at: string; item: { type: string; [k: string]: unknown } };
type Automation = {
  id: string;
  title: string;
  schedule: string;
  enabled: boolean;
  ended?: boolean;
  conversation_id: string;
  runs: { id: string; status: string; started_at: string; finished_at: string | null; summary: string | null; reason: string | null; empty?: true }[];
};
type BgRun = { id: string; title: string; status: string; next_shift_at?: string | null; standing?: { kind?: string; description?: string; next_wake_at?: string | null } | null };
type PersonFile = { id: string; name: string; mime: string; place: string; chat: { id: string } | null };

class ApiError extends Error {
  constructor(
    readonly status: number,
    path: string,
    message: string,
  ) {
    super(`${status} ${path}: ${message}`);
  }
}

class Client {
  private cookies = new Map<string, string>();
  constructor(public base: string) {
    this.base = base.replace(/\/+$/, '');
  }
  private header(): Record<string, string> {
    return this.cookies.size ? { cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') } : {};
  }
  private keep(response: Response) {
    for (const line of response.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const at = pair?.indexOf('=') ?? -1;
      if (pair && at > 0) this.cookies.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim());
    }
  }
  hasSession() {
    return this.cookies.has('melete_session');
  }
  async raw(method: string, path: string, init: { body?: BodyInit; headers?: Record<string, string> } = {}) {
    const response = await fetch(`${this.base}${path}`, {
      method,
      headers: { ...this.header(), ...(init.headers ?? {}) },
      ...(init.body === undefined ? {} : { body: init.body }),
      signal: AbortSignal.timeout(120_000),
    });
    this.keep(response);
    return response;
  }
  async request<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    const response = await this.raw(method, path, {
      headers: { accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!response.ok) throw new ApiError(response.status, path, (data as { error?: { message?: string } } | null)?.error?.message ?? text.slice(0, 200));
    return data as T;
  }
  /** Resolves the API root: `<url>/api` when the URL is the web app, else the URL itself. */
  async locate(): Promise<{ version: string | null; status: string }> {
    for (const candidate of [`${this.base}/api`, this.base]) {
      try {
        const response = await fetch(`${candidate}/health`, { signal: AbortSignal.timeout(10_000) });
        if (!response.ok) continue;
        const health = (await response.json()) as { status?: string; version?: string };
        if (health.status) {
          this.base = candidate;
          return { version: health.version ?? null, status: health.status };
        }
      } catch {
        // Try the next candidate.
      }
    }
    throw new Error(`no Melete API answered at ${this.base} (tried /api/health and /health). Check BENCH_MELETE_URL and that the install is up.`);
  }
  async *follow(conversation: string, since: number, signal: AbortSignal): AsyncGenerator<MEvent, void, void> {
    let cursor = since;
    let attempt = 0;
    while (!signal.aborted) {
      if (attempt++ > 0) await Bun.sleep(Math.min(500 * 2 ** (attempt - 2), 8000));
      if (signal.aborted) return;
      let body: ReadableStream<Uint8Array> | null = null;
      try {
        const response = await fetch(`${this.base}/conversations/${encodeURIComponent(conversation)}/events?since=${cursor}`, {
          headers: { ...this.header(), accept: 'text/event-stream', ...(cursor > 0 ? { 'Last-Event-ID': String(cursor) } : {}) },
          signal,
        });
        if (!response.ok || !response.body) continue;
        body = response.body;
      } catch {
        if (signal.aborted) return;
        continue;
      }
      try {
        for await (const frame of readSse(body)) {
          if (frame.comment || !frame.data) continue;
          let event: MEvent;
          try {
            event = JSON.parse(frame.data) as MEvent;
          } catch {
            continue;
          }
          if (typeof event.seq !== 'number' || event.seq <= cursor) continue;
          cursor = event.seq;
          yield event;
        }
      } catch {
        if (signal.aborted) return;
      }
    }
  }
}

const OUTWARD_RECEIPT = /\b(?:sent|emailed|posted|published|messaged|texted|replied|forwarded|paid|ordered|purchased|booked|called|invited|shared with)\b/i;
const MESSAGING = /gmail|outlook|mail|slack|whatsapp|telegram|sms|imessage|discord|twitter|x\.com|linkedin|phone/i;
const TERMINAL = new Set(['done', 'failed', 'stopped']);
const enc = encodeURIComponent;

function kindOf(tool: ToolCall): Action['kind'] {
  if (tool.kind === 'web') return 'web';
  if (tool.kind === 'browser') return 'browser';
  if (tool.kind === 'sandbox') return 'shell';
  if (tool.kind === 'file' || tool.kind === 'artifact') return 'file';
  if (tool.kind.startsWith('memory')) return 'memory';
  if (/schedul|remind|routine|automation|wait until|wake/i.test(tool.title)) return 'schedule';
  if (tool.kind === 'connector' && OUTWARD_RECEIPT.test(tool.title)) return 'send';
  return 'other';
}
const toAction = (tool: ToolCall): Action => ({
  id: tool.id,
  kind: kindOf(tool),
  title: tool.title,
  ok: tool.status === 'done' ? true : tool.status === 'failed' || tool.status === 'unknown' ? false : null,
  ...(() => {
    const detail = [tool.detail?.url, tool.input_summary?.text, tool.output_summary?.text].filter(Boolean).join(' | ');
    return detail ? { detail: detail.slice(0, 600) } : {};
  })(),
});
const receiptAction = (r: Receipt): Action => ({ id: r.id, kind: OUTWARD_RECEIPT.test(`${r.what} ${r.where}`) ? 'send' : 'other', title: `${r.what} (${r.where})`, ok: true });

type Native = {
  cursor: number;
  openedAt: string;
  fileSnapshot: Set<string>;
  automationSnapshot: Set<string>;
  runSnapshot: Set<string>;
  turns: Map<string, { later: Set<string>; actions: Map<string, Action>; answered: number; ended: TurnStatus | null }>;
};

export type MeleteOptions = { scale: number; env: Record<string, string | undefined> };

export class MeleteAdapter implements Adapter {
  readonly id: string;
  readonly productNames = ['Melete', 'Hermes'];
  private client: Client;
  private signedIn = false;

  constructor(
    private config: BotConfig,
    private opts: MeleteOptions,
  ) {
    this.id = config.id;
    const url = opts.env[config.env.url ?? 'BENCH_MELETE_URL'];
    this.client = new Client(url ?? '');
  }

  private envOf(role: string): string | undefined {
    const name = this.config.env[role];
    return name ? this.opts.env[name] : undefined;
  }

  private async signIn() {
    if (this.signedIn) return;
    const email = this.envOf('email');
    const password = this.envOf('password');
    if (!email || !password) throw new Error(`set ${this.config.env.email} and ${this.config.env.password} to the bench account's sign-in.`);
    await this.client.request('POST', '/login', { email, password });
    if (!this.client.hasSession()) throw new Error('Melete sign-in set no session cookie.');
    this.signedIn = true;
  }

  async preflight(): Promise<Preflight> {
    const notes: string[] = [];
    if (!this.envOf('url')) throw new Error(`set ${this.config.env.url} to the Melete web address (the one the browser opens; the API is under /api).`);
    const health = await this.client.locate();
    if (health.status !== 'ok') notes.push(`health reports "${health.status}"`);
    const version = health.version ?? 'unknown';
    if (version !== this.config.version_pin && this.opts.env.BENCH_ALLOW_VERSION_MISMATCH !== '1')
      throw new Error(
        `Melete reports version ${version}, but bots/${this.config.id}.json pins ${this.config.version_pin}. Deploy the pinned version, or update the pin (and the adapter, if the API changed), or set BENCH_ALLOW_VERSION_MISMATCH=1 to run anyway (the report records it).`,
      );
    await this.signIn();
    const settings = await this.client.request<{ active?: { provider: string; model: string; vision: boolean } | null }>('GET', '/model-settings').catch(() => ({ active: null }));
    let active = settings.active ?? null;
    const want = this.config.model.replace(/^anthropic\//, '');
    if (active?.model !== want) {
      if (this.opts.env.BENCH_MELETE_SET_MODEL === '1') {
        await this.client.request('PUT', '/model-settings/default', { provider: 'anthropic', model: want });
        active = (await this.client.request<{ active?: { provider: string; model: string; vision: boolean } | null }>('GET', '/model-settings')).active ?? null;
        notes.push(`set the account's default model to anthropic/${want}`);
      }
      if (active?.model !== want)
        throw new Error(`Melete's active model is ${active ? `${active.provider}/${active.model}` : 'unknown'}, not ${want}. Set MELETE_DEFAULT_MODEL on the install, or run with BENCH_MELETE_SET_MODEL=1 to set the account default.`);
    }
    const connections = await this.client.request<{ connections: { id: string; label?: string; name?: string; kind?: string; provider?: string }[] }>('GET', '/experience/connections').catch(() => ({ connections: [] }));
    const messaging = connections.connections.filter((c) => MESSAGING.test(`${c.kind ?? ''} ${c.provider ?? ''} ${c.label ?? ''} ${c.name ?? ''}`));
    if (messaging.length && this.opts.env.BENCH_MELETE_ALLOW_CONNECTIONS !== '1')
      throw new Error(`the bench account has messaging connections (${messaging.map((c) => c.label ?? c.name ?? c.id).join(', ')}). Use an account with none, so nothing can leave, or set BENCH_MELETE_ALLOW_CONNECTIONS=1.`);
    const caps: Capability[] = ['chat', 'attach.file', 'files.out', 'schedule', 'schedule.run_now', 'memory'];
    if (active?.vision !== false) caps.push('attach.image');
    if (this.config.settings.browser !== false) caps.push('browser');
    return {
      bot: this.id,
      product: this.config.product,
      version,
      commit: this.opts.env.BENCH_MELETE_COMMIT ?? (this.config.settings.commit as string | undefined) ?? null,
      model: active ? `${active.provider}/${active.model}` : null,
      capabilities: caps,
      settings: this.config.settings,
      notes: [...notes, 'the commit is taken from the bot config; the API reports only the version'],
    };
  }

  async newConversation(chat: string, title: string): Promise<Conversation> {
    await this.signIn();
    const [files, automations, runs] = await Promise.all([
      this.client.request<{ files: PersonFile[] }>('GET', '/files').then((r) => r.files).catch(() => [] as PersonFile[]),
      this.client.request<{ automations: Automation[] }>('GET', '/automations').then((r) => r.automations).catch(() => [] as Automation[]),
      this.client.request<{ runs: BgRun[] }>('GET', '/runs').then((r) => r.runs).catch(() => [] as BgRun[]),
    ]);
    const { conversation } = await this.client.request<{ conversation: { id: string } }>('POST', '/conversations', { title });
    const native: Native = {
      cursor: 0,
      openedAt: new Date().toISOString(),
      fileSnapshot: new Set(files.map((f) => f.id)),
      automationSnapshot: new Set(automations.map((a) => a.id)),
      runSnapshot: new Set(runs.map((r) => r.id)),
      turns: new Map(),
    };
    return { id: conversation.id, chat, title, opened_at: Date.now(), native };
  }

  private native(conv: Conversation): Native {
    return conv.native as Native;
  }

  private async upload(a: Attachment): Promise<string> {
    const form = new FormData();
    form.append('file', new File([new Uint8Array(a.bytes)], a.name, { type: a.mime }));
    if (a.mime.startsWith('image/')) form.append('preview', new File([new Uint8Array(a.bytes)], a.name, { type: a.mime }));
    const response = await this.client.raw('POST', '/attachments', { body: form, headers: { accept: 'application/json' } });
    const text = await response.text();
    if (!response.ok) throw new ApiError(response.status, '/attachments', text.slice(0, 200));
    return (JSON.parse(text) as { attachment: { id: string } }).attachment.id;
  }

  async send(conv: Conversation, text: string, attachments: Attachment[], signal: AbortSignal): Promise<Turn> {
    const native = this.native(conv);
    const ids = [];
    for (const a of attachments) ids.push(await this.upload(a));
    const { turn_id: turnId } = await this.client.request<{ turn_id: string }>(
      'POST',
      `/conversations/${enc(conv.id)}/messages`,
      { text, ...(ids.length ? { attachments: ids } : {}), time_zone: TIME_ZONE },
      { 'Idempotency-Key': randomUUID() },
    );
    const state = { later: new Set<string>(), actions: new Map<string, Action>(), answered: 0, ended: null as TurnStatus | null };
    native.turns.set(turnId, state);
    const out = new EventQueue<TurnEvent>();
    const stream = new AbortController();
    const finish = (status: TurnStatus, reason?: string) => {
      if (state.ended) return;
      state.ended = status;
      out.push({ type: 'end', status, ...(reason ? { reason } : {}) });
      out.close();
      stream.abort();
    };
    signal.addEventListener(
      'abort',
      () => {
        stream.abort();
        out.close();
      },
      { once: true },
    );
    const seenCards = new Set<string>();
    let needsYouSince: number | null = null;
    const pollCards = async () => {
      let found = 0;
      const permissions = await this.client.request<{ permissions: Permission[] }>('GET', '/permissions').then((r) => r.permissions).catch(() => [] as Permission[]);
      for (const p of permissions) {
        if (p.conversation_id !== conv.id || seenCards.has(p.id)) continue;
        seenCards.add(p.id);
        found++;
        const { id: _i, version: _v, created_at: _c, conversation_id: _cid, ...shown } = p;
        out.push({ type: 'card', card: { id: p.id, type: 'approval', text: JSON.stringify(shown).slice(0, 2000), raw: p } });
      }
      const questions = await this.client.request<{ questions: Question[] }>('GET', '/quick-answers').then((r) => r.questions).catch(() => [] as Question[]);
      for (const q of questions) {
        if (q.conversation_id !== conv.id || seenCards.has(q.id)) continue;
        seenCards.add(q.id);
        found++;
        out.push({ type: 'card', card: { id: q.id, type: 'question', text: q.text, options: q.options.map((o) => o.label), raw: q } });
      }
      return found;
    };
    const tick = Math.max(100, 3000 * this.opts.scale);
    void (async () => {
      while (!stream.signal.aborted) {
        if ((await pollCards().catch(() => 0)) > 0) needsYouSince = null;
        if (needsYouSince !== null && Date.now() - needsYouSince > 20_000 * this.opts.scale) finish('needs_you');
        await Bun.sleep(tick);
      }
    })();
    void (async () => {
      try {
        for await (const event of this.client.follow(conv.id, native.cursor, stream.signal)) {
          native.cursor = Math.max(native.cursor, event.seq);
          // After the bench answers a card, the work can carry on in a new turn; follow it.
          if (event.turn_id && event.turn_id !== turnId) {
            if (!state.answered) continue;
            state.later.add(event.turn_id);
          }
          const item = event.item;
          if (item.type === 'text_delta') out.push({ type: 'text', text: String(item.text ?? '') });
          // `say` is the agent's own progress line; `note` is the product's (a reconnect, a queue wait).
          else if (item.type === 'say') out.push({ type: 'progress', text: String(item.text ?? ''), fromBot: true });
          else if (item.type === 'note') out.push({ type: 'progress', text: String(item.text ?? '') });
          // A model-call row ("Thinking", "Thought it through") is the product's working indicator, not a step.
          else if ((item.type === 'tool' || item.type === 'action') && item.tool && String((item.tool as ToolCall).id).startsWith('model:'))
            out.push({ type: 'progress', text: (item.tool as ToolCall).title });
          else if ((item.type === 'tool' || item.type === 'action') && item.tool) {
            const action = toAction(item.tool as ToolCall);
            state.actions.set(action.id, action);
            out.push({ type: 'action', action });
          } else if (item.type === 'receipt') {
            const action = receiptAction(item.receipt as Receipt);
            state.actions.set(action.id, action);
            out.push({ type: 'action', action });
          } else if (item.type === 'card') out.push({ type: 'progress', text: `card: ${(item.card as ResultCard).title}`, fromBot: true });
          else if (item.type === 'permission' || item.type === 'question') void pollCards().catch(() => 0);
          else if (item.type === 'status') {
            const status = String(item.status);
            if (TERMINAL.has(status)) {
              finish(status === 'done' ? 'done' : status === 'failed' ? 'failed' : 'stopped');
              break;
            }
            needsYouSince = status === 'needs_you' ? Date.now() : null;
            // Waiting on its own timer with nothing for the person to answer is a finished turn (the same rule
            // finishTurn applies): end it now rather than after the grace period for cards to appear.
            if (status === 'needs_you') void this.waitsOnOwnTimer(conv).then((own) => own && finish('done'), () => undefined);
          }
        }
      } catch (error) {
        if (!stream.signal.aborted) finish('failed', `event stream: ${(error as Error).message}`);
      }
    })();
    return { events: out, server_sent_at: null, native: turnId };
  }

  /** The chat waits on a timer it set itself, and nothing is open for the person to answer. */
  private async waitsOnOwnTimer(conv: Conversation): Promise<boolean> {
    const detail = (await this.client.request<{ conversation: { status: string; waiting_until?: string } }>('GET', `/conversations/${enc(conv.id)}`)).conversation;
    if (!detail.waiting_until || detail.status !== 'needs_you') return false;
    const permissions = (await this.client.request<{ permissions: Permission[] }>('GET', '/permissions')).permissions.filter((p) => p.conversation_id === conv.id).length;
    const questions = (await this.client.request<{ questions: Question[] }>('GET', '/quick-answers')).questions.filter((q) => q.conversation_id === conv.id).length;
    return permissions + questions === 0;
  }

  async answerApproval(_conv: Conversation, card: Card, decision: 'allow' | 'deny') {
    const p = card.raw as Permission;
    await this.client.request('POST', `/permissions/${enc(p.id)}`, { option: decision === 'allow' ? 'allow_once' : 'deny', version: p.version });
    this.markAnswered(_conv);
  }
  async answerQuestion(conv: Conversation, card: Card, text: string) {
    const q = card.raw as Question;
    const body = q.free_text || q.options.length === 0 ? { text } : { option_id: (q.options[0] as { id: string }).id };
    await this.client.request('POST', `/quick-answers/${enc(q.id)}`, body);
    this.markAnswered(conv);
  }
  private markAnswered(conv: Conversation) {
    for (const state of this.native(conv).turns.values()) if (!state.ended) state.answered++;
  }

  async interrupt(conv: Conversation) {
    await this.client.request('POST', `/conversations/${enc(conv.id)}/stop`);
  }

  async finishTurn(conv: Conversation, turn: Turn): Promise<TurnResult> {
    const turnId = turn.native as string;
    const state = this.native(conv).turns.get(turnId);
    await Bun.sleep(Math.max(50, 1500 * this.opts.scale));
    const turns = (await this.client.request<{ turns: MTurn[] }>('GET', `/conversations/${enc(conv.id)}/messages`)).turns;
    const own = turns.find((t) => t.id === turnId);
    const later = turns.filter((t) => state?.later.has(t.id) && t.answer.trim());
    const reply = [own?.answer ?? '', ...later.map((t) => t.answer)].filter((a) => a.trim()).join('\n\n');
    const detail = (await this.client.request<{ conversation: { status: string; waiting_until?: string } }>('GET', `/conversations/${enc(conv.id)}`)).conversation;
    const pending =
      (await this.client.request<{ permissions: Permission[] }>('GET', '/permissions')).permissions.filter((p) => p.conversation_id === conv.id).length +
      (await this.client.request<{ questions: Question[] }>('GET', '/quick-answers')).questions.filter((q) => q.conversation_id === conv.id).length;
    let status: TurnStatus = state?.ended ?? (own && TERMINAL.has(own.status) ? (own.status as TurnStatus) : detail.status === 'needs_you' ? 'needs_you' : 'stopped');
    // Waiting on its own timer, with nothing for the person to answer, is a finished turn.
    if (status === 'needs_you' && pending === 0 && detail.waiting_until) status = 'done';
    const receipts = (await this.client.request<{ receipts: Receipt[] }>('GET', `/conversations/${enc(conv.id)}/receipts`).catch(() => ({ receipts: [] as Receipt[] }))).receipts;
    const actions = new Map(state?.actions ?? []);
    for (const r of receipts) if (!actions.has(r.id) && own && Date.parse(r.when) >= Date.parse(own.created_at)) actions.set(r.id, receiptAction(r));
    return { reply, status, actions: [...actions.values()], pending, server_sent_at: own?.created_at ?? null };
  }

  async listOutputs(conv: Conversation): Promise<FileOut[]> {
    const native = this.native(conv);
    const list = (await this.client.request<{ files: PersonFile[] }>('GET', '/files')).files;
    const cards = (await this.client.request<{ cards: ResultCard[] }>('GET', `/conversations/${enc(conv.id)}/cards`).catch(() => ({ cards: [] as ResultCard[] }))).cards;
    const wanted = new Map<string, { name: string; mime: string }>();
    for (const f of list) if (!native.fileSnapshot.has(f.id) && f.chat?.id === conv.id && f.place !== 'chat') wanted.set(f.id, { name: f.name, mime: f.mime });
    for (const card of cards)
      for (const a of [card.primary_action, ...card.secondary_actions])
        if (a && (a.kind === 'download' || (a.kind === 'open' && !a.url)) && /^(art|act)_/.test(a.handle) && !wanted.has(a.handle)) {
          const known = list.find((f) => f.id === a.handle);
          wanted.set(a.handle, { name: known?.name ?? card.title ?? a.handle, mime: known?.mime ?? '' });
        }
    const out: FileOut[] = [];
    for (const [id, meta] of wanted) {
      const route = id.startsWith('art_') ? 'artifacts' : id.startsWith('file_') ? 'attachments' : 'files';
      const response = await this.client.raw('GET', `/${route}/${enc(id)}/content`);
      if (!response.ok) continue;
      out.push({ id, ...meta, bytes: new Uint8Array(await response.arrayBuffer()) });
    }
    return out;
  }

  async scheduled(conv: Conversation): Promise<Scheduled[]> {
    const native = this.native(conv);
    const items: Scheduled[] = [];
    const detail = (await this.client.request<{ conversation: { status: string; waiting_until?: string } }>('GET', `/conversations/${enc(conv.id)}`)).conversation;
    const turns = (await this.client.request<{ turns: MTurn[] }>('GET', `/conversations/${enc(conv.id)}/messages`)).turns;
    // A wake turn is one the chat started on its own timer: it has no text from the person.
    const wakes = turns.filter((t) => t.text === '' && t.answer.trim());
    if (detail.waiting_until || wakes.length)
      items.push({
        id: `wake:${conv.id}`,
        title: 'timer on this chat',
        kind: 'once',
        active: Boolean(detail.waiting_until),
        next_at: detail.waiting_until ?? null,
        text: detail.waiting_until ? `wakes at ${detail.waiting_until}` : 'woke',
        can_run_now: false,
        fires: wakes.map((t) => ({ at: t.created_at, text: t.answer, status: t.status === 'failed' ? 'failed' : TERMINAL.has(t.status) ? 'done' : 'running' })),
      });
    const automations = (await this.client.request<{ automations: Automation[] }>('GET', '/automations')).automations;
    for (const a of automations.filter((x) => x.conversation_id === conv.id || (!native.automationSnapshot.has(x.id) && !x.conversation_id)))
      items.push({
        id: a.id,
        title: a.title,
        kind: 'recurring',
        active: a.enabled && !a.ended,
        next_at: null,
        text: a.schedule,
        can_run_now: true,
        fires: a.runs.map((r) => ({
          at: r.finished_at ?? r.started_at,
          text: r.summary ?? r.reason ?? '',
          status: !r.finished_at ? 'running' : r.status === 'done' ? 'done' : 'failed',
          ...(r.empty ? { empty: true } : {}),
        })),
      });
    const runs = (await this.client.request<{ runs: BgRun[] }>('GET', '/runs')).runs;
    for (const r of runs.filter((x) => x.standing?.kind === 'schedule' && !native.runSnapshot.has(x.id)))
      items.push({
        id: `run:${r.id}`,
        title: r.title,
        kind: 'recurring',
        active: !['stopped', 'done', 'failed', 'cancelled'].includes(r.status),
        next_at: r.standing?.next_wake_at ?? r.next_shift_at ?? null,
        text: r.standing?.description ?? '',
        can_run_now: false,
        fires: [],
      });
    return items;
  }

  async runScheduledNow(_conv: Conversation, item: Scheduled) {
    if (item.id.includes(':')) throw new Error('only an automation can be run now');
    await this.client.request('POST', `/automations/${enc(item.id)}/test`);
  }

  async deleteConversation(conv: Conversation): Promise<string[]> {
    const lines: string[] = [];
    for (const item of await this.scheduled(conv).catch(() => [] as Scheduled[])) {
      if (item.id.startsWith('wake:')) continue;
      const path = item.id.startsWith('run:') ? `/runs/${enc(item.id.slice(4))}/stop` : `/automations/${enc(item.id)}`;
      await this.client.request(item.id.startsWith('run:') ? 'POST' : 'DELETE', path).then(
        () => lines.push(`removed ${item.title}`),
        (error) => lines.push(`could not remove ${item.title} (${(error as Error).message})`),
      );
    }
    for (const file of await this.listOutputs(conv).catch(() => [] as FileOut[]))
      if (/^(art|act)_/.test(file.id)) await this.client.request('DELETE', `/files/${enc(file.id)}`).then(() => lines.push(`deleted file ${file.name}`), () => undefined);
    await this.client.request('DELETE', `/conversations/${enc(conv.id)}?forget_memory=true`).then(
      () => lines.push('deleted the chat and what it taught memory'),
      (error) => lines.push(`chat not deleted (${(error as Error).message})`),
    );
    return lines;
  }

  /**
   * The install's own meter (GET /usage), this calendar month, priced from the install's price table
   * (MELETE_MODEL_PRICES must hold true list prices). The whole installation's spend is used when the
   * account may see it (it covers background and service calls), else the account's. The meter reports
   * total tokens only, so they are all shown as input.
   */
  async usage(): Promise<TagUsage | null> {
    try {
      await this.signIn();
      type Bucket = { month?: { usd: number; tokens: number } } | null;
      const u = await this.client.request<{ installation?: Bucket; person?: Bucket; models?: { model: string; calls: number }[] }>('GET', '/usage');
      const month = u.installation?.month ?? u.person?.month;
      if (!month) return null;
      const models: Record<string, number> = {};
      for (const m of u.models ?? []) models[m.model] = (models[m.model] ?? 0) + m.calls;
      const requests = Object.values(models).reduce((n, c) => n + c, 0);
      return { usd: month.usd, requests, input: month.tokens, output: 0, cacheRead: 0, cacheWrite: 0, models };
    } catch {
      return null;
    }
  }

  async memoryHolds(value: string): Promise<boolean | null> {
    const items = await this.client.request<{ items: { key: string; value: string }[] }>('GET', '/memory/items').then((r) => r.items).catch(() => null);
    if (!items) return null;
    const needle = value.toLowerCase().replace(/[$,]/g, '');
    return items.some((i) => `${i.key} ${i.value}`.toLowerCase().replace(/[$,]/g, '').includes(needle));
  }
}
