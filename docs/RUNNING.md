# Running real bots

The dry run (`bun run dry-run`) needs nothing. A live run needs the bots, a metering proxy and a model key.

## What you need

1. Each bot installed at its pinned version (`version_pin` in `bots/<id>.json`) with its documented
   defaults and the settings listed in that file, no messaging or mail accounts connected, and its model
   calls pointed at the metering proxy under its own tag (`<proxy>/b/<bot id>`).
2. A metering proxy (contract below) holding the only real model key.
3. The environment variables each bot's config names, plus:

| Variable | Meaning |
| --- | --- |
| `BENCH_PROXY_URL` | The metering proxy; required for a live run |
| `BENCH_CAP_USD` | Spend cap for the run (default 60); the proxy's own cap also applies |
| `BENCH_GRADER_MODEL` | Grader model (default `claude-opus-5-5`) |
| `BENCH_TIME_ZONE` | The person's time zone for reminders (default `America/Los_Angeles`); bots that take no time zone must run in it. The published runs used `UTC`. |
| `BENCH_GITHUB_REPO`, `BENCH_GITHUB_TOKEN` | A throwaway test repo for the one task that opens an issue (skipped without them) |
| `BENCH_MELETE_URL`, `BENCH_MELETE_EMAIL`, `BENCH_MELETE_PASSWORD` | Melete |
| `BENCH_OPENMAUSBOT_URL`, `BENCH_OPENMAUSBOT_TOKEN`, `BENCH_OPENMAUSBOT_BOT` | OpenMausBot (the bot's name, default `Bench`) |
| `BENCH_ALLOW_VERSION_MISMATCH=1` | Run a version other than the pin (the report says so) |

Credentials only come from the environment at run time. Nothing in `bots/*.json` is a secret.

## Commands

```sh
bun run estimate                                                  # what the standard plan costs at list prices
bun run bench --bots melete,openmausbot --mode smoke
bun run bench --bots melete,openmausbot --mode full --with-shorts
bun run bench --bots melete,openmausbot --mode reliability --repeat 3
```

Options: `--mode smoke|full|reliability`, `--repeat k`, `--tasks id,id`, `--with-shorts`, `--tasks-dir dir`
(repeatable; a held-out set is passed this way), `--concurrency n` (per bot, default 1), `--cap usd`,
`--no-grader`, `--grade-shorts`, `--keep-chats`, `--overlap-waits`, `--out dir`. The header of
`src/cli.ts` documents each one.

## The metering proxy contract

Any proxy that does this works:

- `ANY /b/<tag>/<path>` forwards to the model provider's `<path>`, swapping in the real key and streaming
  through.
- It prices each call and keeps per-tag totals. `GET /usage` returns
  `{"capUsd", "totalUsd", "tripped", "tags": {"<tag>": {"usd", "requests", "input", "output", "cacheRead", "cacheWrite", "models": {"<model>": n}}}}`.
- Once `totalUsd >= capUsd` it answers every new call with HTTP 429.
- `POST /usage/mark {"label"}` records a labelled point in its log (the bench marks each attempt's start
  and end).
- It should log one line per call (time, tag, model, tokens, price, and whether the model had a price), with
  no prompt bodies and no keys. That log is what makes a re-price possible after the fact.

A bot whose model calls cannot be pointed at the proxy may declare `"meter": "self"` in its config, if its
adapter can read the bot's own usage meter. The report then says where each bot's spend was read.

## Output

Each run writes `results/<date>-<set>-<model>/`:

- `report.md`: the side-by-side tables, per-task grid, worst failures and the full configuration;
- `run.json`: every attempt, every check, every step;
- `transcripts/<bot>/<task>-r<n>.txt`;
- `leaderboard-entries.json`: the run's entries in short form.

Run folders are not committed by default. A run is published by adding its folder under
`results/<date>/`, listing it in `leaderboard/sources.json` and running `bun run leaderboard` and
`bun run charts`.

## Re-scoring a run

When a check or a claim rule turns out to be wrong, fix it, then re-score the stored answers instead of
paying for a new run:

```sh
bun run rescore results/<date>/<run>/as-run --out results/<date>/<run> \
  --recheck task-a,task-b --live rescore-live.json \
  [--reprice proxy-calls.jsonl --price model=in,out,cacheRead,cacheWrite]
```

The header of `src/rescore.ts` says exactly what is re-read and what is kept. Record the options in
`results/<date>/rescore.json` so `bun run verify-results` can repeat the re-score in CI.
