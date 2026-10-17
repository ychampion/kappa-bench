/**
 * Task lint: bun run validate [--tasks-dir dir ...]
 *
 * Checks every task in the given folders (default tasks/public) for:
 * - unique ids, a known category and known capabilities;
 * - a positive budget and at least one step, with text that renders;
 * - attachments that name a known fixture;
 * - a scripted fake answer for every step (the dry run needs one per message);
 * - no outward asks (send, post, pay, book, order, delete, sign up...) unless
 *   the task is marked as an honesty trap. Outward actions are always denied,
 *   so an ordinary task that needs one could never pass. Traps test that the
 *   bot does not pretend: an outward ask, or a question about an account it
 *   cannot reach. Quoted material (text to translate or reply to) is ignored.
 * - every id in sets.json exists.
 */
import { FIXTURES } from './fixtures.ts';
import { loadTaskSets, PUBLIC_DIR } from './taskset.ts';
import type { Task } from './task.ts';
import { CAPABILITIES, CATEGORIES } from './types.ts';

/** A sentence (or clause after "please" / "can you") that tells the bot to act outward. */
export const OUTWARD_ASK =
  /(?:^|[.!?\n]\s*|\b(?:please|can you|could you|would you|go ahead and|then)\s+)(send|e-?mail|text|message|dm|post|tweet|publish|pay|order|book|reserve|call|phone|buy|purchase|submit|sign up|register|create an account|transfer|wire|venmo|delete|unsubscribe)\b/i;

/** "Send me ..." in chat is an answer, not an outward act. "Text me" or "email me" still is. */
const INWARD_OK = /^(send)\b/i;

/** Words in quotes are material to work on (translate this, reply to this), not the ask. */
const QUOTED = /"[^"]*"|“[^”]*”/g;

export function outwardAsk(raw: string): string | null {
  const text = raw.replace(QUOTED, '""');
  const m = text.match(OUTWARD_ASK);
  if (!m) return null;
  const verb = m[1] ?? '';
  const after = text.slice((m.index ?? 0) + m[0].length);
  if (INWARD_OK.test(verb) && /^\s+(?:me|it to me|it back)\b/i.test(after)) return null;
  return `${m[0].trim()}${after.slice(0, 30)}`;
}

export function lintTasks(tasks: Task[], sets: Record<string, string[]>): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const t of tasks) {
    const where = `${t.id}:`;
    if (!/^[a-z0-9][a-z0-9-]*$/.test(t.id)) problems.push(`${where} id must be lower-case words joined by dashes`);
    if (seen.has(t.id)) problems.push(`${where} duplicate id`);
    seen.add(t.id);
    if (!(CATEGORIES as readonly string[]).includes(t.category) && t.category !== 'short') problems.push(`${where} unknown category ${t.category}`);
    if (!(t.budget_s > 0)) problems.push(`${where} budget_s must be positive`);
    if (!t.title.trim()) problems.push(`${where} empty title`);
    for (const cap of t.requires ?? []) if (!(CAPABILITIES as readonly string[]).includes(cap)) problems.push(`${where} unknown capability ${cap}`);
    if (!t.steps.length) problems.push(`${where} no steps`);
    let vars: Record<string, string> = {};
    try {
      vars = t.vars?.() ?? {};
    } catch (error) {
      problems.push(`${where} vars() throws: ${(error as Error).message}`);
    }
    for (const [i, step] of t.steps.entries()) {
      let text = '';
      try {
        text = step.text(vars);
      } catch (error) {
        problems.push(`${where} step ${i + 1} text throws: ${(error as Error).message}`);
        continue;
      }
      if (!text.trim()) problems.push(`${where} step ${i + 1} is empty`);
      if (/\bundefined\b|\bNaN\b/.test(text)) problems.push(`${where} step ${i + 1} renders a missing var: ${text.slice(0, 80)}`);
      for (const a of step.attach ?? []) if (!FIXTURES[a]) problems.push(`${where} step ${i + 1} attaches unknown fixture ${a}`);
      if (step.attach?.length && !(t.requires ?? []).some((c) => c.startsWith('attach.'))) problems.push(`${where} attaches a file but does not require attach.*`);
      const ask = outwardAsk(text);
      if (ask && !t.trap) problems.push(`${where} step ${i + 1} asks for an outward action ("${ask}"); reword it, or mark the task trap: true`);
    }
    try {
      const fake = t.fake(vars);
      if (fake.length !== t.steps.length) problems.push(`${where} fake has ${fake.length} turn(s) for ${t.steps.length} step(s)`);
      if (fake.some((f) => !f.reply.trim())) problems.push(`${where} a fake turn has an empty reply`);
    } catch (error) {
      problems.push(`${where} fake() throws: ${(error as Error).message}`);
    }
    if (t.rubric_min !== undefined && !(t.rubric_min >= 1 && t.rubric_min <= 5)) problems.push(`${where} rubric_min must be 1-5`);
  }
  for (const [name, ids] of Object.entries(sets)) {
    for (const id of ids) if (!seen.has(id)) problems.push(`sets.json ${name}: unknown task ${id}`);
    if (new Set(ids).size !== ids.length) problems.push(`sets.json ${name}: duplicate ids`);
  }
  return problems;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const dirs: string[] = [];
  for (let i = 0; i < argv.length; i++) if (argv[i] === '--tasks-dir' && argv[i + 1]) dirs.push(...(argv[++i] as string).split(','));
  const groups = dirs.length ? [[PUBLIC_DIR], ...dirs.map((d) => [d]), [PUBLIC_DIR, ...dirs]] : [[PUBLIC_DIR]];
  let bad = 0;
  for (const group of groups) {
    try {
      const set = await loadTaskSets(group);
      const problems = lintTasks(set.tasks, set.sets);
      const label = group.length > 1 ? 'combined' : group[0] === PUBLIC_DIR ? 'tasks/public' : (group[0] as string);
      console.log(`${label}: ${set.tasks.length} tasks, set ${set.version}, ${problems.length} problem(s)`);
      for (const p of problems) console.log(`  ${p}`);
      bad += problems.length;
    } catch (error) {
      console.log(`${group.join(', ')}: ${(error as Error).message}`);
      bad++;
    }
  }
  process.exit(bad ? 1 : 0);
}
