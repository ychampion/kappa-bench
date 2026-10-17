/**
 * The shapes every part of the bench shares. Nothing here is specific to one
 * bot: adapters translate their product's own records into these, and tasks,
 * honesty checks, the grader and the report read only these.
 */

export const CATEGORIES = [
  'lookup',
  'research',
  'planning',
  'writing',
  'files_in',
  'files_out',
  'reminders',
  'monitoring',
  'memory',
  'browser',
] as const;
export type Category = (typeof CATEGORIES)[number] | 'short';

/**
 * Categories every personal agent is expected to handle. A task in one of
 * these that a bot cannot attempt at all counts as a fail in the headline; in
 * any other category it is reported as unsupported and left out of the rate.
 */
export const CORE_CATEGORIES: readonly Category[] = [
  'lookup',
  'research',
  'planning',
  'writing',
  'files_in',
  'files_out',
  'reminders',
  'memory',
  'short',
];

export const CATEGORY_LABEL: Record<Category, string> = {
  lookup: 'live lookup',
  research: 'research with sources',
  planning: 'planning',
  writing: 'writing',
  files_in: 'files in',
  files_out: 'files out',
  reminders: 'reminders and routines',
  monitoring: 'monitoring',
  memory: 'memory across chats',
  browser: 'browser errands',
  short: 'short asks',
};

/** What an adapter can do. A task lists what it needs; a bot without it scores "unsupported". */
export const CAPABILITIES = [
  'chat',
  'attach.image',
  'attach.file',
  'files.out',
  'schedule',
  'schedule.run_now',
  'memory',
  'browser',
] as const;
export type Capability = (typeof CAPABILITIES)[number];

/** A step the bot took, as the bench classifies it. */
export type ActionKind = 'web' | 'browser' | 'shell' | 'file' | 'memory' | 'schedule' | 'send' | 'other';
export type Action = {
  id: string;
  kind: ActionKind;
  /** The step's own label, as the bot's transcript shows it. */
  title: string;
  /** true finished, false failed, null still running or unknown. */
  ok: boolean | null;
  /** Any further text the transcript gives (inputs, URLs, a summary). */
  detail?: string;
};

/** Something the bot left for the person to answer. */
export type Card = {
  id: string;
  type: 'approval' | 'question';
  /** Everything the card says, for the approval policy and the transcript. */
  text: string;
  options?: string[];
  /** The adapter's own record, passed back when the bench answers it. */
  raw?: unknown;
};

/** A file the bot made, downloaded for checking. */
export type FileOut = { id: string; name: string; mime: string; bytes: Uint8Array };

/** One time a scheduled item ran and said something, on the bot's server clock. `at`: when the run began (when the bot shows no start, when its message arrived). */
export type Fire = { at: string; text: string; status: 'done' | 'failed' | 'running'; empty?: boolean };

/** A reminder, routine or watch the bot set up, and what it produced so far. */
export type Scheduled = {
  id: string;
  title: string;
  kind: 'once' | 'recurring';
  /** Still going to run (not cancelled, disabled or used up). */
  active: boolean;
  /** Next run, ISO, when known. */
  next_at: string | null;
  /** Local clock time "HH:MM" for daily-style schedules. */
  time?: string | null;
  /** 0 = Sunday … 6 = Saturday, for weekday schedules. */
  weekdays?: number[] | null;
  cron?: string | null;
  /** A readable description, e.g. "Weekdays at 08:30". */
  text: string;
  /** The bench may start a test run now. */
  can_run_now: boolean;
  fires: Fire[];
};

/** One claim in a reply that names an action or a method with nothing behind it. */
export type Claim = { kind: string; phrase: string; sentence: string; wanted: string };

export type Check = { name: string; pass: boolean; detail: string };
export type Vars = Record<string, string>;

/** How a turn ended, as the adapter reads it. */
export type TurnStatus = 'done' | 'needs_you' | 'failed' | 'stopped';

/** One line of a step's timeline, for transcripts. `t` is ms from the send. */
export type TimelineLine = { t: number; type: string; text: string };

/** What one message in a job produced. */
export type StepEvidence = {
  chat: string;
  conversation: string;
  prompt: string;
  /** Local clock, ms. */
  sent_at: number;
  /** The bot's own timestamp for the person's message, for timing against its clock. */
  server_sent_at: string | null;
  /** ms from send to the first visible output of any kind (text, a step, a progress note). */
  first_output_ms: number | null;
  /** ms from send to the first answer text. */
  first_text_ms: number | null;
  /** ms from send to the end of the turn; null when it never ended. */
  total_ms: number | null;
  status: TurnStatus | 'timeout' | 'error';
  reply: string;
  actions: Action[];
  cards: Card[];
  approvals: { card: string; decision: 'allow' | 'deny' }[];
  questions: number;
  /** Longest stretch, in ms, with nothing visible while the turn was under way. */
  longest_quiet_ms: number;
  timed_out: boolean;
  /** Cards still open when the turn ended. */
  pending_at_end: number;
  /** Scheduled items of this conversation still active right after the turn, when the adapter can tell. */
  scheduled_after: number | null;
  /** Why it failed, when the bot said. */
  reason?: string;
  events: number;
  timeline: TimelineLine[];
};

/** Everything a check, the honesty rules and the grader may read. */
export type Evidence = {
  steps: StepEvidence[];
  /** The last step's reply, the one most checks read. */
  reply: string;
  actions: Action[];
  files: FileOut[];
  scheduled: Scheduled[];
  vars: Vars;
  /** Facts fetched from live sources at grading time. */
  live: Record<string, unknown>;
};

export type Honesty = {
  claims: Claim[];
  endings: ('done' | 'needs_you' | 'failed_with_reason' | 'silent')[];
  silent: boolean;
  /** A stretch over 2 min with nothing shown. */
  long_silence: boolean;
};

export type Outcome = 'pass' | 'fail' | 'error' | 'skipped' | 'unsupported' | 'stopped_for_spend';

export type JobRecord = {
  bot: string;
  job: number;
  task: string;
  category: Category;
  variant: 'full' | 'short';
  /** 1-based repeat number. */
  repeat: number;
  title: string;
  outcome: Outcome;
  reason: string;
  checks: Check[];
  honesty: Honesty;
  rubric: { score: number; reason: string; model: string } | null;
  rubric_status: 'graded' | 'not_run' | 'failed' | 'none';
  first_output_ms: number | null;
  first_text_ms: number | null;
  total_ms: number | null;
  /** A step stopped at its time budget. */
  stalled: boolean;
  /** The adapter threw (the bot or the bench crashed mid-job). */
  crashed: boolean;
  steps: { prompt: string; status: string; reply: string; actions: string[]; first_output_ms: number | null; total_ms: number | null }[];
  usd: number | null;
  /** exact: one job of this bot ran at a time; shared: spend split between overlapping jobs. */
  cost_attribution: 'exact' | 'shared' | 'none';
  started_at: string;
  finished_at: string;
  key_lines: string[];
  cleanup: string[];
  transcript?: string;
};
