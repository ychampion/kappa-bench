/**
 * Runs a task list on several bots. Bots run side by side; each bot works
 * through its own queue with `concurrency` jobs at a time (default 1, which
 * keeps per-job cost exact), and never runs two computer or browser jobs at
 * once. Repeats run in rounds: every task once, then every task again, so a
 * bad hour on the bot's side hits one round, not all repeats of one task.
 *
 * Before each job starts the spend meter is read; once the proxy says the cap
 * is reached, nothing new starts, running turns are stopped, and the rest of
 * the queue is recorded as stopped for spend.
 */
import type { Adapter, Preflight } from './adapter.ts';
import type { GitHub } from './github.ts';
import type { Grader } from './grader.ts';
import { finishJob, type JobEnv, jobKey, runSteps } from './job.ts';
import type { Meter } from './meter.ts';
import type { Sources } from './sources.ts';
import type { Task } from './task.ts';
import type { JobRecord } from './types.ts';
import { Semaphore } from './util.ts';

export type BotRun = { adapter: Adapter; preflight: Preflight };

export type RunOptions = {
  bots: BotRun[];
  tasks: Task[];
  repeat: number;
  concurrency: number;
  meter: Meter | null;
  scale: number;
  env: Record<string, string | undefined>;
  sources: Sources;
  github: GitHub;
  grader: Grader | null;
  gradeShorts: boolean;
  dryRun: boolean;
  keepChats: boolean;
  /** Let other jobs of a bot run while a task waits for a reminder or watch to fire (faster; costs become shared). */
  overlapWaits?: boolean;
  log: (line: string) => void;
  /** Called with each record as it finishes. */
  onRecord?: (record: JobRecord) => void;
};

export async function runAll(opts: RunOptions): Promise<{ records: JobRecord[]; stoppedForSpend: boolean; stopReason: string }> {
  const stop = new AbortController();
  let stopReason = '';
  opts.meter?.onTrip(() => {
    stopReason = opts.meter?.trippedReason ?? 'spend cap reached';
    opts.log(`spend cap: ${stopReason}; no new jobs start, running turns are stopped`);
    stop.abort();
  });
  const records: JobRecord[] = [];
  const add = (record: JobRecord) => {
    records.push(record);
    opts.onRecord?.(record);
  };

  await Promise.all(
    opts.bots.map(async ({ adapter, preflight }) => {
      const env: JobEnv = {
        adapter,
        capabilities: preflight.capabilities,
        meter: opts.meter,
        scale: opts.scale,
        env: opts.env,
        sources: opts.sources,
        github: opts.github,
        grader: opts.grader,
        gradeShorts: opts.gradeShorts,
        dryRun: opts.dryRun,
        keepChats: opts.keepChats,
        stop: stop.signal,
        log: opts.log,
      };
      const queue: { task: Task; repeat: number; index: number }[] = [];
      let index = 0;
      for (let repeat = 1; repeat <= opts.repeat; repeat++) for (const task of opts.tasks) queue.push({ task, repeat, index: ++index });
      const slots = new Semaphore(Math.max(1, opts.concurrency));
      const computer = new Semaphore(1);
      const pending: Promise<void>[] = [];
      for (const item of queue) {
        await slots.acquire();
        const blocked = stop.signal.aborted || (opts.meter ? opts.meter.stopped() : false);
        if (blocked) {
          slots.release();
          add(notStarted(adapter.id, item.task, item.repeat, item.index));
          continue;
        }
        const run = (async () => {
          const usesComputer = Boolean(item.task.computer);
          if (usesComputer) await computer.acquire();
          // A task that waits for something it set up (a reminder firing, a watch noticing) keeps the bot's
          // slot through that wait unless overlapWaits is set: slower, but no other job of the bot runs while
          // the fire's spend comes in, so every cost stays exact.
          const holdSlot = Boolean(item.task.after) && !opts.overlapWaits;
          let slotHeld = true;
          let state;
          try {
            if (stop.signal.aborted) {
              add(notStarted(adapter.id, item.task, item.repeat, item.index));
              return;
            }
            await opts.meter?.jobStarted(adapter.id, jobKey(adapter.id, item.index));
            state = await runSteps(item.task, item.index, item.repeat, env);
            // The bot spends nothing more for this job unless the task waits for something it set up to run
            // later (`after`); close its cost window now, before the next job of this bot starts.
            if (!item.task.after) await opts.meter?.jobEnded(adapter.id, jobKey(adapter.id, item.index));
          } finally {
            if (usesComputer) computer.release();
            if (!holdSlot || state === undefined) {
              slots.release();
              slotHeld = false;
            }
          }
          try {
            add(await finishJob(state, env));
          } catch (error) {
            opts.log(`  [${adapter.id} ${item.task.id}] could not finish: ${(error as Error).message}`);
          } finally {
            if (slotHeld) slots.release();
          }
        })();
        pending.push(run);
      }
      await Promise.all(pending);
    }),
  );
  return { records, stoppedForSpend: stop.signal.aborted, stopReason };
}

function notStarted(bot: string, task: Task, repeat: number, index: number): JobRecord {
  const now = new Date().toISOString();
  return {
    bot,
    job: index,
    task: task.id,
    category: task.category,
    variant: task.variant ?? 'full',
    repeat,
    title: task.title,
    outcome: 'stopped_for_spend',
    reason: 'the spend cap was reached before this job started',
    checks: [],
    honesty: { claims: [], endings: [], silent: false, long_silence: false },
    rubric: null,
    rubric_status: 'none',
    first_output_ms: null,
    first_text_ms: null,
    total_ms: null,
    stalled: false,
    crashed: false,
    steps: [],
    usd: null,
    cost_attribution: 'none',
    started_at: now,
    finished_at: now,
    key_lines: [],
    cleanup: [],
  };
}
