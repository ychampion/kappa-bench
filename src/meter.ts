/**
 * Spend, read from the metering proxy every bot and the grader call the model
 * through. The proxy counts tokens per tag (one tag per bot, plus `grader`),
 * prices them, and refuses calls once the run's cap is reached.
 *
 * Cost per job: the bench samples `GET /usage` every 10 s and when a job
 * starts or ends. A tag's increase between two samples belongs to the jobs of
 * that bot that were running in between:
 * - a job that ran alone (concurrency 1 per bot, the default) gets the whole
 *   increase: its cost is "exact";
 * - when an increase arrives while two or more jobs of the same bot are open
 *   (concurrency above 1, or a reminder task still waiting for its fire while
 *   the next job runs), it is split evenly between them, and their costs are
 *   marked "shared", an estimate. A job whose open time overlapped another's
 *   but never shared an increase (its grading and clean-up spend nothing on
 *   the bot) stays exact.
 * Per-bot totals are exact either way.
 * Increases with no job of that bot running are kept as that bot's
 * "background" spend. The grader tag is reported on its own.
 *
 * The cap: once the proxy says `tripped`, or its total reaches the cap, no new
 * job starts and running turns are stopped.
 */
import { priceOf } from './util.ts';

export type TagUsage = {
  usd: number;
  requests: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  models: Record<string, number>;
};
export type UsageSnapshot = { capUsd: number; totalUsd: number; tripped: boolean; tags: Record<string, TagUsage> };

export interface UsageSource {
  usage(): Promise<UsageSnapshot | null>;
  mark(label: string): Promise<void>;
  readonly url: string;
}

const emptyTag = (): TagUsage => ({ usd: 0, requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, models: {} });

/** The real proxy (`BENCH_PROXY_URL`). */
export class ProxySource implements UsageSource {
  constructor(readonly url: string) {}
  async usage(): Promise<UsageSnapshot | null> {
    try {
      const res = await fetch(`${this.url.replace(/\/+$/, '')}/usage`, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) return null;
      return (await res.json()) as UsageSnapshot;
    } catch {
      return null;
    }
  }
  async mark(label: string) {
    await fetch(`${this.url.replace(/\/+$/, '')}/usage/mark`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => undefined);
  }
}

/** An in-memory proxy for dry runs and the self-test: fake bots and the fake grader charge it. */
export class FakeProxy implements UsageSource {
  readonly url = 'fake://proxy';
  readonly marks: { label: string; at: string; totalUsd: number }[] = [];
  private tags: Record<string, TagUsage> = {};
  constructor(readonly capUsd: number) {}
  get totalUsd() {
    return Object.values(this.tags).reduce((sum, t) => sum + t.usd, 0);
  }
  get tripped() {
    return this.totalUsd >= this.capUsd;
  }
  /** Prices a call like the proxy does. Returns false (a 429) when the cap is reached. */
  charge(tag: string, model: string, input: number, output: number, cacheRead = 0, cacheWrite = 0): boolean {
    if (this.tripped) return false;
    const price = priceOf(model) ?? { input: 2, output: 10, cache_read: 0.2, cache_write: 2.5 };
    const t = (this.tags[tag] ??= emptyTag());
    t.usd += (input * price.input + output * price.output + cacheRead * price.cache_read + cacheWrite * price.cache_write) / 1e6;
    t.requests += 1;
    t.input += input;
    t.output += output;
    t.cacheRead += cacheRead;
    t.cacheWrite += cacheWrite;
    t.models[model] = (t.models[model] ?? 0) + 1;
    return true;
  }
  async usage(): Promise<UsageSnapshot> {
    return { capUsd: this.capUsd, totalUsd: this.totalUsd, tripped: this.tripped, tags: structuredClone(this.tags) };
  }
  async mark(label: string) {
    this.marks.push({ label, at: new Date().toISOString(), totalUsd: this.totalUsd });
  }
}

type JobKey = string;

export class Meter {
  private start: UsageSnapshot | null = null;
  private last: UsageSnapshot | null = null;
  /** tag -> running job keys */
  private active = new Map<string, Set<JobKey>>();
  /** Jobs that shared a spend increase with another job of the same bot. */
  private overlapped = new Set<JobKey>();
  readonly perJob = new Map<JobKey, number>();
  readonly background = new Map<string, number>();
  tripped = false;
  trippedReason = '';
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners: (() => void)[] = [];
  private sampling: Promise<void> | null = null;

  constructor(
    readonly source: UsageSource,
    /** The bench's own cap; the lower of this and the proxy's cap applies. */
    readonly capUsd: number,
    private intervalMs = 10_000,
  ) {}

  async begin(): Promise<boolean> {
    this.start = await this.source.usage();
    this.last = this.start;
    if (!this.start) return false;
    this.timer = setInterval(() => void this.sample(), this.intervalMs);
    this.check();
    return true;
  }

  onTrip(listener: () => void) {
    this.listeners.push(listener);
  }

  get cap(): number {
    return Math.min(this.capUsd, this.last?.capUsd ?? Number.POSITIVE_INFINITY);
  }

  /** Samples first, so spend before the job began is not given to it. */
  async jobStarted(tag: string, job: JobKey) {
    if (this.start) await this.sample();
    const set = this.active.get(tag) ?? new Set();
    set.add(job);
    this.active.set(tag, set);
    if (!this.perJob.has(job)) this.perJob.set(job, 0);
    void this.source.mark(`start ${job}`);
  }
  async jobEnded(tag: string, job: JobKey) {
    await this.sample();
    this.active.get(tag)?.delete(job);
    void this.source.mark(`end ${job}`);
  }
  attribution(job: JobKey): 'exact' | 'shared' {
    return this.overlapped.has(job) ? 'shared' : 'exact';
  }

  /** Dollars spent since the run began, all tags. */
  total(): number {
    return this.start && this.last ? Math.max(0, this.last.totalUsd - this.start.totalUsd) : 0;
  }
  tagSpend(tag: string): TagUsage {
    const now = this.last?.tags[tag] ?? emptyTag();
    const was = this.start?.tags[tag] ?? emptyTag();
    const models: Record<string, number> = {};
    for (const [m, n] of Object.entries(now.models)) models[m] = n - (was.models[m] ?? 0);
    return {
      usd: now.usd - was.usd,
      requests: now.requests - was.requests,
      input: now.input - was.input,
      output: now.output - was.output,
      cacheRead: now.cacheRead - was.cacheRead,
      cacheWrite: now.cacheWrite - was.cacheWrite,
      models,
    };
  }
  available(): boolean {
    return this.start !== null;
  }

  async sample(): Promise<void> {
    if (this.sampling) return this.sampling;
    this.sampling = (async () => {
      const now = await this.source.usage();
      if (now && this.last) {
        for (const [tag, usage] of Object.entries(now.tags)) {
          const delta = Math.max(0, usage.usd - (this.last.tags[tag]?.usd ?? 0));
          if (delta <= 0) continue;
          const jobs = [...(this.active.get(tag) ?? [])];
          if (!jobs.length) this.background.set(tag, (this.background.get(tag) ?? 0) + delta);
          else {
            // Only a split that actually happened makes a job's cost an estimate.
            if (jobs.length > 1) for (const job of jobs) this.overlapped.add(job);
            for (const job of jobs) this.perJob.set(job, (this.perJob.get(job) ?? 0) + delta / jobs.length);
          }
        }
        this.last = now;
      }
      this.check();
    })().finally(() => {
      this.sampling = null;
    });
    return this.sampling;
  }

  /** True when no new job may start. */
  stopped(): boolean {
    this.check();
    return this.tripped;
  }

  private check() {
    if (this.tripped || !this.last) return;
    const reason = this.last.tripped ? 'the proxy reports its cap reached' : this.last.totalUsd >= this.cap ? `spend $${this.last.totalUsd.toFixed(2)} reached the $${this.cap.toFixed(2)} cap` : this.total() >= this.capUsd ? `run spend reached the $${this.capUsd.toFixed(2)} cap` : '';
    if (!reason) return;
    this.tripped = true;
    this.trippedReason = reason;
    for (const listener of this.listeners) listener();
  }

  async end() {
    if (this.timer) clearInterval(this.timer);
    await this.sample();
  }
}
