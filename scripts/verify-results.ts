/**
 * bun run verify-results
 *
 * For every published results folder that holds a rescore.json, re-scores each run's as-run folder
 * into a temporary folder with the recorded options and checks the published report.md, run.json and
 * transcripts are exactly what that gives. No network, no model calls.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { rescore } from '../src/rescore.ts';

const ROOT = resolve(import.meta.dir, '..');
type Spec = { date: string; runs: string[]; recheck: string[]; live?: string; reprice?: string; price?: Record<string, number[]> };

const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(join(dir, d.name)) : [join(dir, d.name)]));
const read = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

let problems = 0;
for (const folder of readdirSync(join(ROOT, 'results'), { withFileTypes: true }).filter((d) => d.isDirectory())) {
  const base = join(ROOT, 'results', folder.name);
  if (!existsSync(join(base, 'rescore.json'))) continue;
  const spec = JSON.parse(readFileSync(join(base, 'rescore.json'), 'utf8')) as Spec;
  for (const run of spec.runs) {
    const published = join(base, run);
    const out = mkdtempSync(join(tmpdir(), 'kappa-verify-'));
    const args = [join(published, 'as-run'), '--out', out, '--date', spec.date];
    if (spec.recheck.length) args.push('--recheck', spec.recheck.join(','));
    if (spec.live) args.push('--live', join(base, spec.live));
    if (spec.reprice) args.push('--reprice', join(published, 'as-run', spec.reprice));
    for (const [model, p] of Object.entries(spec.price ?? {})) args.push('--price', `${model}=${p.join(',')}`);
    await rescore(args, true);
    // leaderboard-entries.json is per-run scratch; the published numbers live in leaderboard/leaderboard.json.
    const made = files(out).map((f) => relative(out, f)).filter((f) => f !== 'leaderboard-entries.json');
    for (const name of made) {
      const have = join(published, name);
      if (!existsSync(have)) {
        console.error(`results/${folder.name}/${run}/${name}: missing`);
        problems++;
      } else if (read(have) !== read(join(out, name))) {
        console.error(`results/${folder.name}/${run}/${name}: differs from the re-score`);
        problems++;
      }
    }
    rmSync(out, { recursive: true, force: true });
    console.log(`results/${folder.name}/${run}: ${made.length} files checked`);
  }
}
if (problems) {
  console.error(`${problems} problem(s)`);
  process.exit(1);
}
console.log('published results match their re-score.');
