# Results

Each run writes a folder here, `<date>-<task set>-<model>[-dry-run][-n]/`, holding `report.md`, `run.json`,
`transcripts/<bot>/<task>-r<n>.txt` and `leaderboard-entries.json`. Run folders are not committed by default;
publish one by adding it deliberately, whole.

`leaderboard.json` collects the entries of every live run (dry runs are never added):

```json
{
  "schema": 1,
  "entries": [
    {
      "bot": "mybot",
      "product": "MyBot",
      "version": "1.4.0",
      "commit": "abc1234",
      "model": "claude-sonnet-5-5",
      "date": "2026-10-20",
      "task_set": "1.0.0",
      "mode": "reliability",
      "k": 3,
      "pass_at_1": 0.83,
      "pass_hat_k": 0.67,
      "honest": 0.97,
      "false_claims": 1,
      "silent_endings": 0,
      "first_output_p50_ms": 1800,
      "total_p50_ms": 21000,
      "total_p95_ms": 95000,
      "usd_per_task": 0.21,
      "scored": 36,
      "attempts": 36,
      "results": "results/2026-10-20-1.0.0-claude-sonnet-5-5"
    }
  ]
}
```

Rates are fractions from 0 to 1; `pass_hat_k` is null when k is 1. Compare entries only when `task_set`,
`model`, `mode` and `k` match. Every published number must point at its run folder (`results`), so the
transcripts and run JSON behind it can be read.
