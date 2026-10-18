# κ-bench v1.0.0

κ-bench measures how reliably you can hand everyday work to a personal agent. This first release ships
**κ-bench Core 1.0** and the first leaderboard.

## What's in it

- **62 public tasks** across live lookup, research with sources, planning, writing, files in, files out,
  reminders and routines, monitoring, memory across chats and browser errands, plus 22 short asks with
  seven honesty traps.
- **pass^k as the headline.** A bot is scored on whether it gets the same errand right every time, not
  once. The reliability subset (12 tasks) runs at k = 3.
- **Honesty on every attempt.** False claims (saying it sent, booked, paid or saved something it did not)
  and silent endings are counted for every bot the same way.
- **One model, one approval policy, a blind grader.** Every bot runs on the same model at its documented
  defaults; outward actions are always denied; Claude Opus 5.5 grades against written rubrics with product
  names removed.
- **Metered spend** through a proxy with one cap for the whole run, and latency p50/p95.
- **Everything published:** tasks, harness, reports, run JSON and every transcript for the public tasks.
- **Reproducible numbers.** `bun run verify-results`, `bun run leaderboard --check` and
  `bun run charts --check` rebuild every published number and chart from the committed files, with no key.

## First leaderboard (2026-10-18, claude-sonnet-5-5)

| Bot | Full set pass@1 | Reliability pass^3 | Reliability pass@1 | Honest (full) | Turn p50 | $ / attempt (full) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| OpenMausBot 0.1.115 | 93% (57/61) | 83% (10/12) | 86% (31/36) | 98% (60/61) | 8.0 s | $0.059 |
| Melete 0.2.1 | 90% (55/61) | 92% (11/12) | 97% (35/36) | 100% (61/61) | 13 s | $0.063 |

On a single pass the two are level. Melete was more reliable on repeats; OpenMausBot was faster and lost fewer
tasks on reminders, files out, planning and memory. Full results, per-task failures and configuration:
[docs/LEADERBOARD.md](LEADERBOARD.md).

The stored answers were re-scored after check fixes found by reading the first answers by hand; every change
applies to both bots and is listed in [docs/METHODOLOGY.md](METHODOLOGY.md#re-scoring).

## Get started

```sh
bun install
bun run dry-run     # the whole pipeline on fake bots; needs no key
```

To add a bot: [docs/SUBMITTING.md](SUBMITTING.md).

## Disclosure

κ-bench is maintained by the team that builds Melete, one of the bots under test. Every bot runs on the same
model and settings, the grader is blind, all tasks, the harness and every transcript are public, and any bot's
maintainers can review their configuration or dispute a result in an issue.
