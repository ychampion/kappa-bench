# 2026-10-18: Melete and OpenMausBot on claude-sonnet-5-5

| Folder | What ran |
| --- | --- |
| [`full/`](full/) | Every public task once (k = 1), short asks included: 62 tasks, 61 scored per bot. |
| [`reliability/`](reliability/) | The 12-task reliability subset, three times each (k = 3). |

Both bots ran on `claude-sonnet-5-5` at their documented defaults, in UTC, with the blind grader on
`claude-opus-5-5`. Configuration: the end of each `report.md`, and [docs/LEADERBOARD.md](../../docs/LEADERBOARD.md).

## Re-scored

The published `report.md`, `run.json` and transcripts are a re-score of the stored answers in `as-run/`
after check and claim-rule fixes ([what changed and why](../../docs/METHODOLOGY.md#re-scoring)). No model was
called again; rubric grades, timings and silent endings are as run. OpenMausBot's side calls on
`claude-haiku-4-5-20251001`, which the metering proxy had billed at its highest rate, were re-priced at list
from the call list in `as-run/proxy-calls-haiku-4-5.jsonl`.

[`rescore.json`](rescore.json) records the options and [`rescore-live.json`](rescore-live.json) the live
facts the re-run checks read, copied from the stored check details (the Fed funds upper bound, 4.00%, and the
three latest Bun releases, 1.4.3, 1.4.2 and 1.4.1). To repeat the re-score and compare:

```sh
bun run verify-results
```

## The held-out set

A private held-out set of 10 tasks, one per category, was also run on both bots. Its tasks and transcripts are
not published, so it can keep testing for overfitting.
