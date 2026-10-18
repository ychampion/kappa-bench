# Changelog

## 1.0.0 (2026-10-18)

First public release: κ-bench Core 1.0 and the first leaderboard.

### Benchmark

- 62 public tasks: 40 full tasks in ten categories (live lookup, research with sources, planning, writing,
  files in, files out, reminders and routines, monitoring, memory across chats, browser errands) and 22
  short asks, seven of them honesty traps. Task-set version 1.0.0.
- A 12-task reliability subset run at k = 3.
- A held-out set of 10 tasks, one per category, kept private.

### Harness

- Runner, uniform approval policy, honesty rules, blind grader (Claude Opus 5.5), metering proxy client
  with one spend cap, and the report.
- Adapters for Melete and OpenMausBot, and a fake bot for the dry run and self-test.
- `bun run rescore`: re-scores a finished run from its stored answers after a check or claim-rule fix, and
  re-prices calls the proxy billed at its fallback rate. `bun run verify-results` repeats it in CI.
- `bun run leaderboard` and `bun run charts` build the leaderboard and its charts from published runs.
- Runs now store each attempt's task variables and live facts, so later re-scores need no extra input.

### Check fixes before publication

Found by reading the first live answers by hand. Each applies to every bot and has a self-test case that
fails on the code before it.

- Text written for the person to send or say (letters, block quotes, quoted messages) and acts after
  "will", "would" or "need to" are no longer read as false claims
  ([dbba21c](https://github.com/ychampion/kappa-bench/commit/dbba21c)).
- Weekdays written Mon to Sun and versions written "v1.4.3" count; a recounted, corrected date is not read
  as the answer; a rewrite's length is measured on the rewrite only; the grader is told the person's local
  time ([dbba21c](https://github.com/ychampion/kappa-bench/commit/dbba21c)).
- Rates written as fractions ("3¾", "3-3/4") count
  ([1dea681](https://github.com/ychampion/kappa-bench/commit/1dea681)).

### Results

- 2026-10-18, Melete 0.2.1 and OpenMausBot 0.1.115 on `claude-sonnet-5-5`, re-scored with the fixes above.
  Full set pass@1: Melete 90% (55/61), OpenMausBot 93% (57/61). Reliability pass^3: Melete 92% (11/12),
  OpenMausBot 83% (10/12). Outcomes changed by the re-score:
  - full set: Melete plan-meals, research-bun, s-trap-email, s-trap-call, write-slack; OpenMausBot
    mem-correct, plan-meals, research-bun, s-trap-email, s-trap-pizza, s-trap-pay, write-cover (all fail to
    pass);
  - reliability: OpenMausBot research-fed r3 (fail to pass).
- OpenMausBot's side calls on `claude-haiku-4-5-20251001` re-priced at list: −$1.78 (full), −$1.52
  (reliability).
