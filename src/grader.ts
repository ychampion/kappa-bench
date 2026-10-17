/**
 * The blind rubric grader (1–5). It reads the request, the answers, the step
 * titles and the names of files made, with every product and engine name
 * replaced by "the assistant", and never which bot ran. Its calls go through
 * the metering proxy under the tag `grader`, so the run's spend cap covers it.
 * The dry run uses a fixed fake grade and calls nothing.
 */
import Anthropic from '@anthropic-ai/sdk';
import { QUESTION_ANSWER } from './job.ts';
import type { Task } from './task.ts';
import type { Evidence } from './types.ts';

export type Grade = { score: number; reason: string; model: string };
export type Grader = { model: string; grade: (task: Task, ev: Evidence) => Promise<Grade | null>; lastInput?: string };

export const DEFAULT_RUBRIC =
  'Correct and complete for what was asked; friendly and to the point; no padding, no talk about tools or plumbing; sources linked when sources were asked for; honest about anything it could not do.';

export const SYSTEM = `You grade a personal assistant's answer the way a demanding, busy person would.
Score 1-5:
5 = fully correct and complete, warm and to the point, nothing to fix.
4 = correct, minor style or completeness nits.
3 = usable but with a real gap, an error the person would notice, or noticeable padding.
2 = mostly wrong, incomplete, or hard to use.
1 = wrong, invented, or no real answer.
An answer that invents facts or claims something was done that was not is at most 2.
Reply with only a JSON object: {"score": <1-5>, "reason": "<one sentence>"}`;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Replaces every product or engine name (any case, as whole words) with a neutral word. */
export function normaliseNames(text: string, names: string[]): string {
  const sorted = [...new Set(names.filter((n) => n.trim().length >= 3))].sort((a, b) => b.length - a.length);
  let out = text;
  for (const name of sorted) out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escape(name).replace(/\\? /g, '[\\s_-]?')}(?![\\p{L}\\p{N}])`, 'giu'), 'the assistant');
  // Tool ids carry server names: mcp__<server>__<tool> keeps only the tool.
  return out.replace(/\bmcp__[\w-]+?__/g, '');
}

/** What the grader reads. */
export function transcript(task: Task, ev: Evidence, names: string[]): string {
  const parts: string[] = [];
  ev.steps.forEach((step, i) => {
    parts.push(`Message ${i + 1}${ev.steps.length > 1 ? ` (chat ${step.chat})` : ''}: ${step.prompt}`);
    const titles = step.actions.map((a) => `${a.title}${a.ok === false ? ' [failed]' : ''}`);
    if (titles.length) parts.push(`Steps it took: ${titles.slice(0, 25).join('; ')}`);
    // What it asked mid-turn and what it was told: the answer below may hold text from before and after.
    const asked = step.cards.map((card) =>
      card.type === 'question'
        ? `it asked "${card.text.slice(0, 300)}" and the person answered "${QUESTION_ANSWER}"`
        : `it asked permission for "${card.text.slice(0, 300)}" and the person chose ${step.approvals.find((a) => card.text.startsWith(a.card))?.decision === 'deny' ? 'deny' : 'allow'}`,
    );
    if (asked.length) parts.push(`While answering, ${asked.join('; then ')}. The answer below includes what it wrote before and after.`);
    parts.push(`Answer ${i + 1}:\n${step.reply.slice(0, 12_000) || '(no answer)'}`);
  });
  const fires = ev.scheduled.flatMap((s) => s.fires).filter((f) => f.text.trim());
  if (fires.length) parts.push(`Later messages it sent on its own:\n${fires.map((f) => `- ${f.text.slice(0, 600)}`).join('\n')}`);
  if (ev.files.length) parts.push(`Files it made: ${ev.files.map((f) => `${f.name} (${f.bytes.length} bytes)`).join(', ')}`);
  const today = new Date().toLocaleDateString('en-US', {
    timeZone: process.env.BENCH_TIME_ZONE ?? 'America/Los_Angeles',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  return normaliseNames(`The person asked on ${today}.\nWhat a good answer does: ${task.rubric ?? DEFAULT_RUBRIC}\n\n${parts.join('\n\n')}`, names);
}

export function parseGrade(text: string, model: string): Grade | null {
  const json = text.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as { score?: number; reason?: string };
    return typeof parsed.score === 'number' && parsed.score >= 1 && parsed.score <= 5
      ? { score: Math.round(parsed.score), reason: String(parsed.reason ?? ''), model }
      : null;
  } catch {
    return null;
  }
}

/**
 * The live grader. `proxyUrl` is the metering proxy; the SDK's requests go to
 * <proxy>/b/grader/v1/messages and the proxy supplies the real key.
 */
export function anthropicGrader(proxyUrl: string, model: string, names: string[]): Grader {
  const client = new Anthropic({ apiKey: 'bench-proxy-supplies-the-key', baseURL: `${proxyUrl.replace(/\/+$/, '')}/b/grader`, maxRetries: 3 });
  const grader: Grader = {
    model,
    grade: async (task, ev) => {
      const input = transcript(task, ev, names);
      grader.lastInput = input;
      const response = await client.messages.create({ model, max_tokens: 1000, system: SYSTEM, messages: [{ role: 'user', content: input }] });
      if (response.stop_reason === 'refusal') return null;
      return parseGrade(response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join(''), response.model);
    },
  };
  return grader;
}

/** The dry run's grader: a fixed grade from the answer's shape, with no model call. It still builds the blind input. */
export function fakeGrader(names: string[], onCall?: (input: string) => void): Grader {
  const grader: Grader = {
    model: 'fake-grader',
    grade: async (task, ev) => {
      const input = transcript(task, ev, names);
      grader.lastInput = input;
      onCall?.(input);
      return { score: ev.reply.trim() ? 4 : 1, reason: `fake grade for ${task.id}`, model: 'fake-grader' };
    },
  };
  return grader;
}
