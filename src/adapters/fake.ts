/**
 * A fake bot for the dry run and the self-test. It plays each task's scripted
 * good answer (FakeTurn) at a fraction of real time, never calls a model, and
 * charges the in-memory proxy what a real turn of that size would cost.
 *
 * It can wear either real bot's shape:
 * - `melete`: answer text streams in small pieces; steps arrive as they run;
 * - `openmausbot`: answer text arrives as whole messages after a run of
 *   progress notes, the way a job view reports it.
 * Both shapes say their product name in a step label, so the self-test can
 * prove the grader never sees it.
 *
 * Deliberately bad behaviours, for the self-test and for seeded flakiness in
 * the dry run: a false claim (says it emailed something, with no send step),
 * a silent ending (never ends the turn), an empty ending, a wrong answer, a
 * long silence, and a crash.
 */
import { randomBytes } from 'node:crypto';
import type { Adapter, Attachment, BotConfig, Conversation, Preflight, PrimeMeta, Turn, TurnEvent, TurnResult } from '../adapter.ts';
import { EventQueue } from '../adapter.ts';
import type { FakeProxy } from '../meter.ts';
import type { FakeTurn } from '../task.ts';
import { CAPABILITIES, type Action, type Capability, type Card, type FileOut, type Scheduled, type TurnStatus } from '../types.ts';
import { seeded } from '../util.ts';

export type Misbehaviour = 'false_claim' | 'silent' | 'empty' | 'wrong' | 'long_silence' | 'crash';

export type FakeOptions = {
  shape: 'melete' | 'openmausbot';
  /** Dry-run time scale: 0.01 plays a 60 s wait in 0.6 s. */
  scale: number;
  proxy: FakeProxy;
  config: BotConfig;
  /** Leave out capabilities to see "unsupported" reported. */
  capabilities?: Capability[];
  /** Picks a misbehaviour for a given message, or null to play it straight. */
  misbehave?: (meta: PrimeMeta) => Misbehaviour | null;
  /** Fraction of messages that go wrong at random (seeded), on top of `misbehave`. */
  flakiness?: number;
  seed?: number;
  /** Prompt tokens per model call: the product's fixed context. */
  baseTokens?: number;
};

type Conv = {
  id: string;
  title: string;
  queue: { turn: FakeTurn; meta: PrimeMeta }[];
  turns: { id: string; at: string; reply: string; status: TurnStatus; actions: Action[]; pending: Map<string, (answer: string) => void>; reason?: string; stopped: boolean }[];
  files: FileOut[];
  scheduled: (Scheduled & { fake?: { summary: string; empty?: boolean } })[];
  timers: Set<ReturnType<typeof setTimeout>>;
};

const id = (prefix: string) => `${prefix}_${randomBytes(5).toString('hex')}`;
const iso = (ms = Date.now()) => new Date(ms).toISOString();

const PRODUCT = { melete: 'Melete', openmausbot: 'OpenMausBot' } as const;

export class FakeAdapter implements Adapter {
  readonly id: string;
  readonly productNames: string[];
  private convs = new Map<string, Conv>();
  private random: () => number;
  /** Every misbehaviour played, for the self-test. */
  readonly played: { meta: PrimeMeta; misbehaviour: Misbehaviour }[] = [];

  constructor(private opts: FakeOptions) {
    this.id = opts.config.id;
    this.productNames = [PRODUCT[opts.shape], opts.config.product];
    this.random = seeded(opts.seed ?? 1);
  }

  private sleep(ms: number) {
    return Bun.sleep(Math.max(1, ms * this.opts.scale));
  }

  async preflight(): Promise<Preflight> {
    return {
      bot: this.id,
      product: `${this.opts.config.product} (fake, ${this.opts.shape} shape)`,
      version: this.opts.config.version_pin,
      commit: 'fake',
      model: this.opts.config.model,
      capabilities: this.opts.capabilities ?? [...CAPABILITIES],
      settings: this.opts.config.settings,
      notes: ['dry run: scripted answers, no model calls, spend charged to an in-memory proxy'],
    };
  }

  async newConversation(chat: string, title: string): Promise<Conversation> {
    const conv: Conv = { id: id('conv'), title, queue: [], turns: [], files: [], scheduled: [], timers: new Set() };
    this.convs.set(conv.id, conv);
    return { id: conv.id, chat, title, opened_at: Date.now() };
  }

  prime(conv: Conversation, turn: FakeTurn, meta: PrimeMeta) {
    this.convs.get(conv.id)?.queue.push({ turn, meta });
  }

  private pick(meta: PrimeMeta): Misbehaviour | null {
    const chosen = this.opts.misbehave?.(meta) ?? null;
    if (chosen) return chosen;
    if (this.opts.flakiness && this.random() < this.opts.flakiness) {
      const kinds: Misbehaviour[] = ['wrong', 'wrong', 'false_claim', 'empty', 'long_silence'];
      return kinds[Math.floor(this.random() * kinds.length)] ?? 'wrong';
    }
    return null;
  }

  async send(conv: Conversation, text: string, attachments: Attachment[], signal: AbortSignal): Promise<Turn> {
    const c = this.convs.get(conv.id);
    if (!c) throw new Error(`fake: no conversation ${conv.id}`);
    const next = c.queue.shift() ?? { turn: { reply: 'OK.' }, meta: { task: '?', repeat: 1, step: 0 } };
    const bad = this.pick(next.meta);
    if (bad) this.played.push({ meta: next.meta, misbehaviour: bad });
    if (bad === 'crash') throw new Error('fake bot crashed (connection reset)');
    let script: FakeTurn = { ...next.turn };
    if (bad === 'false_claim') script = { ...script, reply: `${script.reply}\n\nI've emailed you a copy as well.` };
    if (bad === 'silent') script = { ...script, status: 'silent' };
    if (bad === 'empty') script = { ...script, status: 'empty' };
    if (bad === 'wrong') script = { reply: "I looked into it but couldn't find anything useful on that, sorry.", tools: script.tools?.slice(0, 1) };

    const turn = { id: id('turn'), at: iso(), reply: '', status: 'stopped' as TurnStatus, actions: [] as Action[], pending: new Map<string, (answer: string) => void>(), stopped: false };
    c.turns.push(turn);
    const events = new EventQueue<TurnEvent>();
    signal.addEventListener('abort', () => events.close(), { once: true });
    void this.play(c, turn, script, events, attachments, bad === 'long_silence').catch((error) => {
      events.push({ type: 'end', status: 'failed', reason: (error as Error).message });
      events.close();
    });
    return { events, server_sent_at: turn.at, native: turn.id };
  }

  private async play(c: Conv, turn: Conv['turns'][number], script: FakeTurn, out: EventQueue<TurnEvent>, attachments: Attachment[], longSilence: boolean) {
    const live = () => !turn.stopped && this.convs.has(c.id);
    const tokens = (this.opts.baseTokens ?? 25_000) + attachments.reduce((n, a) => n + Math.min(20_000, a.bytes.length / 4), 0);
    this.charge(tokens, 300);
    if (this.opts.shape === 'openmausbot') out.push({ type: 'progress', text: 'Working' });
    await this.sleep(longSilence ? 150_000 : 800);
    const ask = async (type: Card['type'], text: string): Promise<string> => {
      const card: Card = { id: id('card'), type, text, ...(type === 'approval' ? { options: ['Allow', 'Deny'] } : {}) };
      const answer = new Promise<string>((resolve) => turn.pending.set(card.id, resolve));
      out.push({ type: 'card', card });
      return answer;
    };
    if (script.permission && live()) {
      const decision = await ask('approval', script.permission);
      if (decision !== 'allow') script = { ...script, reply: `You declined, so I didn't go ahead with that: ${script.permission.toLowerCase()}.`, tools: [] };
    }
    if (script.question && live()) await ask('question', script.question);
    const product = PRODUCT[this.opts.shape];
    for (const [i, tool] of (script.tools ?? []).entries()) {
      if (!live()) return;
      const action: Action = { id: id('act'), kind: tool.kind, title: i === 0 ? `${product}: ${tool.title}` : tool.title, ok: null, ...(tool.text ? { detail: tool.text } : {}) };
      turn.actions.push(action);
      out.push({ type: 'action', action: { ...action } });
      if (this.opts.shape === 'openmausbot') out.push({ type: 'progress', text: tool.title });
      await this.sleep(1500);
      action.ok = tool.ok ?? true;
      out.push({ type: 'action', action: { ...action } });
      this.charge(tokens + 2000 * (i + 1), 200);
    }
    if (!live()) return;
    const sentMs = Date.parse(turn.at);
    if (script.cancel) for (const item of c.scheduled) if (item.kind === 'once') item.active = false;
    if (script.once) this.scheduleOnce(c, script.once, sentMs);
    if (script.routine) {
      const r = script.routine;
      c.scheduled.push({
        id: id('sched'),
        title: r.title,
        kind: 'recurring',
        active: true,
        next_at: null,
        time: r.time ?? null,
        weekdays: r.weekdays ?? null,
        cron: null,
        text: r.text,
        can_run_now: true,
        fires: [],
        fake: { summary: r.run_summary, ...(r.empty ? { empty: true } : {}) },
      });
    }
    if (script.file) c.files.push({ id: id('file'), name: script.file.name, mime: script.file.mime, bytes: script.file.bytes });
    const reply = script.status === 'empty' ? '' : script.reply;
    if (this.opts.shape === 'melete') {
      for (let at = 0; at < reply.length; at += 24) {
        if (!live()) return;
        out.push({ type: 'text', text: reply.slice(at, at + 24) });
        await this.sleep(40);
      }
    } else if (reply) {
      await this.sleep(400);
      if (!live()) return;
      out.push({ type: 'text', text: reply });
    }
    turn.reply = reply;
    this.charge(tokens + 2000 * (script.tools?.length ?? 0), Math.max(100, Math.round(reply.length / 4)));
    if (script.status === 'silent') return;
    turn.status = script.status === 'failed' ? 'failed' : 'done';
    if (script.status === 'failed') turn.reason = 'the fake bot failed on purpose';
    out.push({ type: 'end', status: turn.status, ...(turn.reason ? { reason: turn.reason } : {}) });
    out.close();
  }

  private scheduleOnce(c: Conv, once: NonNullable<FakeTurn['once']>, sentMs: number) {
    const dueMs = sentMs + once.in_s * 1000 * this.opts.scale;
    const fireMs = sentMs + (once.fire_in_s ?? once.in_s) * 1000 * this.opts.scale;
    const item: Conv['scheduled'][number] = {
      id: id('sched'),
      title: once.title,
      kind: 'once',
      active: true,
      next_at: iso(dueMs),
      text: `once at ${iso(dueMs)}`,
      can_run_now: false,
      fires: [],
    };
    c.scheduled.push(item);
    const timer = setTimeout(() => {
      c.timers.delete(timer);
      if (!item.active || !this.convs.has(c.id)) return;
      item.active = false;
      item.fires.push({ at: iso(), text: once.answer ?? once.title, status: 'done' });
      this.charge(this.opts.baseTokens ?? 25_000, 120);
    }, Math.max(0, fireMs - Date.now()));
    c.timers.add(timer);
  }

  private charge(input: number, output: number) {
    // A cached prefix like a real agent loop: most of the context is a cache read.
    const cached = Math.round(input * 0.8);
    this.opts.proxy.charge(this.id, this.opts.config.model.replace(/^.*\//, ''), input - cached, output, cached, 0);
  }

  async answerApproval(conv: Conversation, card: Card, decision: 'allow' | 'deny') {
    this.resolve(conv, card, decision);
  }
  async answerQuestion(conv: Conversation, card: Card, text: string) {
    this.resolve(conv, card, text);
  }
  private resolve(conv: Conversation, card: Card, answer: string) {
    for (const turn of this.convs.get(conv.id)?.turns ?? []) {
      const pending = turn.pending.get(card.id);
      if (pending) {
        turn.pending.delete(card.id);
        pending(answer);
        return;
      }
    }
    throw new Error(`fake: no open card ${card.id}`);
  }

  async interrupt(conv: Conversation) {
    for (const turn of this.convs.get(conv.id)?.turns ?? [])
      if (!turn.stopped && turn.status === 'stopped') {
        turn.stopped = true;
        for (const resolve of turn.pending.values()) resolve('deny');
        turn.pending.clear();
      }
  }

  async finishTurn(conv: Conversation, turn: Turn): Promise<TurnResult> {
    const t = this.convs.get(conv.id)?.turns.find((x) => x.id === turn.native);
    if (!t) return { reply: '', status: 'stopped', actions: [], pending: 0 };
    return { reply: t.reply, status: t.status, actions: t.actions.map((a) => ({ ...a })), pending: t.pending.size, ...(t.reason ? { reason: t.reason } : {}), server_sent_at: t.at };
  }

  async listOutputs(conv: Conversation): Promise<FileOut[]> {
    return [...(this.convs.get(conv.id)?.files ?? [])];
  }

  async scheduled(conv: Conversation): Promise<Scheduled[]> {
    return (this.convs.get(conv.id)?.scheduled ?? []).map(({ fake: _f, ...item }) => ({ ...item, fires: [...item.fires] }));
  }

  async runScheduledNow(conv: Conversation, item: Scheduled) {
    const found = this.convs.get(conv.id)?.scheduled.find((s) => s.id === item.id);
    if (!found) throw new Error(`fake: no scheduled item ${item.id}`);
    const fire = { at: iso(), text: '', status: 'running' as const };
    found.fires.push(fire);
    setTimeout(() => {
      Object.assign(fire, { status: 'done', text: found.fake?.empty ? '' : (found.fake?.summary ?? 'Done.'), ...(found.fake?.empty ? { empty: true } : {}) });
      this.charge(this.opts.baseTokens ?? 25_000, 300);
    }, Math.max(1, 20_000 * this.opts.scale));
  }

  async deleteConversation(conv: Conversation): Promise<string[]> {
    const c = this.convs.get(conv.id);
    if (!c) return [];
    for (const timer of c.timers) clearTimeout(timer);
    this.convs.delete(conv.id);
    return [`deleted conversation${c.scheduled.length ? ` and ${c.scheduled.length} scheduled item(s)` : ''}`];
  }

  async memoryHolds(): Promise<boolean | null> {
    return true;
  }

  /** Conversations still open (the self-test checks clean-up). */
  get open(): number {
    return this.convs.size;
  }
}
