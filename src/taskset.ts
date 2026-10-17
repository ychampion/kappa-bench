/**
 * Loads task sets from folders. A task set folder holds:
 * - `VERSION`: one line, the set's version (written into every result);
 * - `sets.json` (optional): named subsets, e.g. {"smoke": [...ids], "reliability": [...ids]};
 * - `*.ts` files that default-export `(k: Kit) => Task[]`.
 * Task files import only types, so a set can live anywhere on disk (a
 * held-out private set is passed with --tasks-dir and never committed).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { kit, type Kit } from './kit.ts';
import type { Task } from './task.ts';

export type TaskSet = { dirs: string[]; version: string; tasks: Task[]; sets: Record<string, string[]> };

export const PUBLIC_DIR = resolve(import.meta.dir, '..', 'tasks', 'public');

export async function loadTaskDir(dir: string): Promise<{ version: string; tasks: Task[]; sets: Record<string, string[]> }> {
  const root = resolve(dir);
  if (!existsSync(root)) throw new Error(`task folder not found: ${dir}`);
  const version = existsSync(join(root, 'VERSION')) ? readFileSync(join(root, 'VERSION'), 'utf8').trim() : 'unversioned';
  const sets = existsSync(join(root, 'sets.json')) ? (JSON.parse(readFileSync(join(root, 'sets.json'), 'utf8')) as Record<string, string[]>) : {};
  const tasks: Task[] = [];
  for (const file of readdirSync(root).filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts')).sort()) {
    const mod = (await import(join(root, file))) as { default?: (k: Kit) => Task[] };
    if (typeof mod.default !== 'function') throw new Error(`${file} in ${dir} has no default export (k) => Task[]`);
    tasks.push(...mod.default(kit));
  }
  return { version, tasks, sets };
}

export async function loadTaskSets(dirs: string[]): Promise<TaskSet> {
  const loaded = await Promise.all(dirs.map(loadTaskDir));
  const tasks = loaded.flatMap((l) => l.tasks);
  const seen = new Set<string>();
  for (const task of tasks) {
    if (seen.has(task.id)) throw new Error(`task id ${task.id} appears twice across ${dirs.join(', ')}`);
    seen.add(task.id);
  }
  const sets: Record<string, string[]> = {};
  for (const l of loaded) for (const [name, ids] of Object.entries(l.sets)) sets[name] = [...(sets[name] ?? []), ...ids];
  return { dirs: dirs.map((d) => resolve(d)), version: loaded.map((l) => l.version).join('+'), tasks, sets };
}
