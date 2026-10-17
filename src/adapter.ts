/**
 * The adapter contract. One adapter per bot product: it opens conversations,
 * sends the person's messages, streams what the bot does until the turn ends,
 * answers approval cards and questions when the bench tells it to, and reads
 * back what every bot can show: the answer, the files it made, the reminders
 * and routines it set (and what they said when they ran). Everything else a
 * product keeps (receipts, cards, logs) stays inside its adapter.
 *
 * Adding a bot means one file in src/adapters/ implementing `Adapter`, one
 * line in src/adapters/index.ts, and one bots/<id>.json. See ADDING_A_BOT.md.
 */
import type { TagUsage } from './meter.ts';
import type { FakeTurn } from './task.ts';
import type { Action, Capability, Card, FileOut, Scheduled, TurnStatus } from './types.ts';

/** bots/<id>.json */
export type BotConfig = {
  /** Short id, also the metering proxy tag: [a-z0-9-]. */
  id: string;
  /** Product name as its makers write it. */
  product: string;
  /** Which adapter drives it (a key of src/adapters/index.ts). */
  adapter: string;
  homepage?: string;
  /** The version the adapter was written against; preflight refuses another unless told. */
  version_pin: string;
  /** The model both bots must run (provider/model or bare model id). */
  model: string;
  /** Environment variable names the adapter reads, by role. Values never live in this file. */
  env: Record<string, string>;
  /** The product's settings for this bench, as documented defaults. Written into every report. */
  settings: Record<string, unknown>;
  /**
   * Where this bot's spend is read: "proxy" (default; its model calls go through the metering proxy under
   * the tag `id`) or "self" (its own usage meter, through the adapter's `usage()`, for a bot that cannot point
   * its model calls at the proxy). The cap covers both.
   */
  meter?: 'proxy' | 'self';
  notes?: string[];
};

export type Preflight = {
  bot: string;
  product: string;
  version: string;
  commit?: string | null;
  /** The model the bot says it will use. */
  model: string | null;
  capabilities: Capability[];
  settings: Record<string, unknown>;
  notes: string[];
};

/** Which job a primed fake turn belongs to, so a fake bot can misbehave on purpose in one of them. */
export type PrimeMeta = { task: string; repeat: number; step: number };

export type Attachment = { name: string; mime: string; bytes: Uint8Array };

export type Conversation = {
  id: string;
  /** The task's own name for this chat ("a", "b"). */
  chat: string;
  title: string;
  /** Local clock when it was opened. */
  opened_at: number;
  /** Adapter-private state. */
  native?: unknown;
};

export type TurnEvent =
  /** Answer text as it arrives (a delta, or a whole message). */
  | { type: 'text'; text: string }
  /** A step started, changed or finished. The same id may come again with a new status. */
  | { type: 'action'; action: Action }
  /**
   * A sign of work with no answer text. `fromBot` marks words or cards the bot itself put in front of the
   * person (a progress message it wrote, a source card). Without it the line is the product's own
   * placeholder ("working", "thinking", a reconnect note): kept in the transcript, but it does not count as
   * first output and does not break a silence, so every bot is timed on what it actually showed.
   */
  | { type: 'progress'; text?: string; fromBot?: boolean }
  /** Something for the person to answer. The bench answers it, then keeps reading. */
  | { type: 'card'; card: Card }
  /** The turn is over. */
  | { type: 'end'; status: TurnStatus; reason?: string };

export type Turn = {
  /** Ends after an `end` event, or when the signal given to `send` aborts. */
  events: AsyncIterable<TurnEvent>;
  /** The bot's own timestamp for the message, when it gives one. */
  server_sent_at: string | null;
  native?: unknown;
};

/** The turn as the bot recorded it, read back after it ended. */
export type TurnResult = {
  reply: string;
  status: TurnStatus;
  actions: Action[];
  /** Cards still open. */
  pending: number;
  reason?: string;
  server_sent_at?: string | null;
};

export interface Adapter {
  readonly id: string;
  /** Names that identify the product (and its engine), removed from what the grader reads. */
  readonly productNames: string[];
  /** Checks the bot answers, is the pinned version and runs the agreed model. Throws with a fix when not. */
  preflight(): Promise<Preflight>;
  newConversation(chat: string, title: string): Promise<Conversation>;
  send(conv: Conversation, text: string, attachments: Attachment[], signal: AbortSignal): Promise<Turn>;
  answerApproval(conv: Conversation, card: Card, decision: 'allow' | 'deny'): Promise<void>;
  answerQuestion(conv: Conversation, card: Card, text: string): Promise<void>;
  /** Presses Stop on the conversation's running turn. */
  interrupt(conv: Conversation): Promise<void>;
  finishTurn(conv: Conversation, turn: Turn): Promise<TurnResult>;
  /** Files the bot made in this conversation, downloaded. */
  listOutputs(conv: Conversation): Promise<FileOut[]>;
  /** Reminders, routines and watches set from this conversation, with what they said when they ran. */
  scheduled(conv: Conversation): Promise<Scheduled[]>;
  /** Starts a test run of a scheduled item now (capability schedule.run_now). */
  runScheduledNow?(conv: Conversation, item: Scheduled): Promise<void>;
  /** Removes the conversation and what it set up. Returns one line per thing removed or left. */
  deleteConversation(conv: Conversation): Promise<string[]>;
  /**
   * The bot's own usage meter, cumulative, priced at true list prices: needed when bots/<id>.json says
   * `"meter": "self"`. Null when it cannot be read.
   */
  usage?(): Promise<TagUsage | null>;
  /** Pacing only, never scored: whether the bot's memory already holds a value. */
  memoryHolds?(value: string): Promise<boolean | null>;
  /** Dry run only: what the fake bot plays for the next message in this conversation. */
  prime?(conv: Conversation, turn: FakeTurn, meta: PrimeMeta): void;
  close?(): Promise<void>;
}

/** An async queue an adapter can push events into while its readers run elsewhere. */
export class EventQueue<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private waiting: ((value: IteratorResult<T>) => void)[] = [];
  private closed = false;
  push(item: T) {
    if (this.closed) return;
    const next = this.waiting.shift();
    if (next) next({ value: item, done: false });
    else this.items.push(item);
  }
  close() {
    this.closed = true;
    for (const next of this.waiting.splice(0)) next({ value: undefined as never, done: true });
  }
  get isClosed() {
    return this.closed;
  }
  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const item = this.items.shift();
        if (item !== undefined) return Promise.resolve({ value: item, done: false });
        if (this.closed) return Promise.resolve({ value: undefined as never, done: true });
        return new Promise((resolve) => this.waiting.push(resolve));
      },
      return: () => {
        this.close();
        return Promise.resolve({ value: undefined as never, done: true });
      },
    };
  }
}

/** Sorts a tool or step name into the bench's action kinds. Adapters may use it or map their own. */
export function actionKind(name: string): Action['kind'] {
  const n = name.toLowerCase();
  if (/\b(?:send|sent|email|gmail|outlook|sms|text message|tweet|post(?:ed)? to|slack|whatsapp|telegram|pay|paid|purchase|order(?:ed)?)\b/.test(n)) return 'send';
  if (/memory|remember|recall|forget/.test(n)) return 'memory';
  if (/routine|schedul|remind|cron|automation|trigger|\bwatch\b|set a check/.test(n)) return 'schedule';
  if (/browser|playwright|navigate|click|typed into|screenshot|opened https?:|computer/.test(n)) return 'browser';
  if (/web ?search|web ?fetch|searched the web|fetch(?:ed)? a page|read page|search(?:ed)? (?:the )?web/.test(n)) return 'web';
  if (/^bash\b|ran a command|\bshell\b|terminal|ran `|\bexec\b|command/.test(n)) return 'shell';
  if (/\b(?:write|wrote|edit|edited|saved|artifact|file|multiedit)\b/.test(n)) return 'file';
  return 'other';
}
