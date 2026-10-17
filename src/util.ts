/** Small helpers shared by tasks, graders and the runner. No network here. */
import { randomBytes } from 'node:crypto';

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** The person's time zone: prompts are written in it and sent with each message. */
export const TIME_ZONE = process.env.BENCH_TIME_ZONE || 'America/Los_Angeles';

/** A calendar day, free of time zones. */
export type Day = { y: number; m: number; d: number };

export function todayIn(tz = TIME_ZONE, now = new Date()): Day {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(now)
    .reduce<Record<string, string>>((acc, part) => ({ ...acc, [part.type]: part.value }), {});
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day) };
}
export const addDays = (day: Day, n: number): Day => {
  const t = new Date(Date.UTC(day.y, day.m - 1, day.d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
};
export const weekday = (day: Day) => new Date(Date.UTC(day.y, day.m - 1, day.d)).getUTCDay();
export const weekdayName = (day: Day) => WEEKDAYS[weekday(day)] as string;
export const monthName = (day: Day) => MONTHS[day.m - 1] as string;
/** "Saturday, November 14" */
export const longDay = (day: Day) => `${weekdayName(day)}, ${monthName(day)} ${day.d}`;
export const isoDay = (day: Day) =>
  `${day.y}-${String(day.m).padStart(2, '0')}-${String(day.d).padStart(2, '0')}`;
/** The next date after `from` (exclusive) that falls on `dow` (0 = Sunday). */
export function nextWeekday(from: Day, dow: number): Day {
  for (let i = 1; i <= 7; i++) {
    const day = addDays(from, i);
    if (weekday(day) === dow) return day;
  }
  return addDays(from, 7);
}
export const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};
/** Whether a reply names this day: "November 14", "Nov 14", "14 November", "11/14", "2026-11-14". */
export function mentionsDay(text: string, day: Day): boolean {
  const month = monthName(day);
  const short = month.slice(0, 3);
  const patterns = [
    new RegExp(`\\b(?:${month}|${short}\\.?)\\s+${day.d}(?:st|nd|rd|th)?\\b`, 'i'),
    new RegExp(`\\b${day.d}(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?:${month}|${short})\\b`, 'i'),
    new RegExp(`\\b0?${day.m}/0?${day.d}\\b`),
    new RegExp(`\\b${isoDay(day)}\\b`),
  ];
  return patterns.some((p) => p.test(text));
}
/** Local wall-clock HH:MM in a time zone, `minutes` from now. */
export function clockIn(minutes: number, tz = TIME_ZONE, now = new Date()): { hh: number; mm: number; text: string } {
  const t = new Date(now.getTime() + minutes * 60_000);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(t)
    .reduce<Record<string, string>>((acc, part) => ({ ...acc, [part.type]: part.value }), {});
  const hh = Number(parts.hour);
  const mm = Number(parts.minute);
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return { hh, mm, text: `${h12}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}` };
}
/** Offset in minutes of a zone from UTC at an instant. */
export function zoneOffsetMinutes(tz: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
    .formatToParts(at)
    .reduce<Record<string, string>>((acc, part) => ({ ...acc, [part.type]: part.value }), {});
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  return Math.round((asUtc - Math.floor(at.getTime() / 60_000) * 60_000) / 60_000);
}

/** A token nobody else's chat or memory will hold. */
export const token = (prefix = '') => `${prefix}${randomBytes(3).toString('hex').toUpperCase()}`;
export const pick = <T>(items: readonly T[], seed: string): T => {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return items[h % items.length] as T;
};

/** Every number in a text, commas dropped: "$1,850.00" gives 1850. */
export const numbersIn = (text: string): number[] =>
  (text.match(/-?\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => Number(n.replace(/,/g, ''))).filter(Number.isFinite);
/** Whether some number in the text is within `tolerance` (a fraction) of `want`. */
export const hasNumberNear = (text: string, want: number, tolerance: number) =>
  numbersIn(text).some((n) => Math.abs(n - want) <= Math.abs(want) * tolerance);
export const words = (text: string) => text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
export const links = (text: string) => [
  ...new Set((text.match(/https?:\/\/[^\s)\]>"'`]+/g) ?? []).map((l) => l.replace(/[.,;:!?]+$/, ''))),
];

export function percentile(values: readonly number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[rank] as number;
}

export class Semaphore {
  private queue: (() => void)[] = [];
  constructor(private free: number) {}
  async acquire(): Promise<() => void> {
    if (this.free > 0) {
      this.free--;
      return () => this.release();
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
    return () => this.release();
  }
  release() {
    const next = this.queue.shift();
    if (next) next();
    else this.free++;
  }
}

/** Seeded generator, so a sampled run can be repeated. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
export function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/** Per-million-token list prices, for estimates only (the metering proxy prices live spend). BENCH_PRICES adds or overrides. */
export type Price = { input: number; output: number; cache_read: number; cache_write: number };
const price = (input: number, output: number): Price => ({ input, output, cache_read: input * 0.1, cache_write: input * 1.25 });
export const PRICES: Record<string, Price> = {
  'claude-opus-5-5': { ...price(4, 20), cache_read: 0.2 },
  'claude-sonnet-5-5': price(2, 10),
  'claude-haiku-5-5': price(0.1, 0.5),
  ...(process.env.BENCH_PRICES ? (JSON.parse(process.env.BENCH_PRICES) as Record<string, Price>) : {}),
};
export const priceOf = (model: string): Price | null =>
  PRICES[model] ?? PRICES[Object.keys(PRICES).find((key) => model.includes(key)) ?? ''] ?? null;
