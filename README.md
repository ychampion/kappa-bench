# agent-bench

A neutral benchmark for personal-agent bots: the assistants you chat with that look things up, write, read
your files, make documents, set reminders, watch for changes, remember you across chats and use a browser.

It runs the same tasks against several bots, on the same model, under the same approval policy, and reports
how often each one gets the job done, how reliably, how honestly, how fast and at what cost.

## Ground rules

- **Same model.** Every bot under test runs the same model (the model named in each `bots/<id>.json`). Preflight
  checks what each bot says it will use; the report lists every model the metering proxy saw per bot.
- **Same approvals.** Bots ask for permission in their own ways. The bench answers every approval card with one
  policy: work inside the bot's own workspace is allowed; anything outward (send, post, pay, book, order, delete
  outside the workspace, create accounts) is denied. Every question gets "Go ahead with your best judgement."
  The policy is `decideCard` in `src/job.ts`.
- **No outward asks.** Ordinary tasks never ask a bot to act on the world (`bun run validate` enforces it). Tasks
  marked `trap` do ask, on purpose; the approval is denied, and the task checks the bot does not pretend it did it.
- **Blind grading.** Deterministic checks decide most of each task. Where judgement is needed, a grader model
  scores the answer 1–5 against a written rubric. The grader's input has every product name replaced with
  "the assistant" and tool names stripped of product prefixes (`src/grader.ts`). The grader calls the model
  through the same metering proxy, so its spend counts toward the cap.
- **One spend cap.** Every bot and the grader call the model through a metering proxy that prices each call
  and refuses calls past the cap. The bench reads the proxy, attributes cost to attempts, stops starting new
  attempts once the cap is reached, and reports what it did not run.
- **Everything published is reproducible.** A result carries each bot's version and commit, the model, the
  date, the task-set version, k, every transcript and the full run JSON.

## Setup

```sh
bun install
bun run typecheck
bun run validate     # task lint
bun run selftest     # proves the judging on fake bots; no network, no spend
bun run dry-run      # the whole pipeline on fake bots, with a full report
bun run estimate     # what the standard plan costs at list prices
```

Bun 1.3 or later. The only runtime dependency is the Anthropic SDK (for the grader).

## Running against real bots

You need:

1. Each bot installed at its pinned version (`version_pin` in `bots/<id>.json`) with its documented defaults
   and the settings listed in that file, no messaging or mail accounts connected, and its model calls pointed
   at the metering proxy under its own tag (`<proxy>/b/<bot id>`).
2. A metering proxy (see below) holding the only real model key.
3. The environment variables each bot's config names, plus:

| variable | meaning |
| --- | --- |
| `BENCH_PROXY_URL` | the metering proxy; required for a live run |
| `BENCH_CAP_USD` | spend cap for the run (default 60); the proxy's own cap also applies |
| `BENCH_GRADER_MODEL` | grader model (default `claude-opus-5-5`) |
| `BENCH_TIME_ZONE` | the person's time zone for reminders (default `America/Los_Angeles`); bots that take no time zone must run in it |
| `BENCH_GITHUB_REPO`, `BENCH_GITHUB_TOKEN` | a throwaway test repo for the one task that opens an issue (skipped without them) |
| `BENCH_MELETE_URL`, `BENCH_MELETE_EMAIL`, `BENCH_MELETE_PASSWORD` | Melete |
| `BENCH_OPENMAUSBOT_URL`, `BENCH_OPENMAUSBOT_TOKEN`, `BENCH_OPENMAUSBOT_BOT` | OpenMausBot (the bot's name, default `Bench`) |
| `BENCH_ALLOW_VERSION_MISMATCH=1` | run a version other than the pin (the report says so) |

Then:

```sh
bun run bench --bots melete,openmausbot --mode smoke
bun run bench --bots melete,openmausbot --mode full
bun run bench --bots melete,openmausbot --mode reliability --repeat 3
```

Options: `--mode smoke|full|reliability`, `--repeat k`, `--tasks id,id`, `--with-shorts`, `--tasks-dir dir`
(repeatable), `--concurrency n` (per bot, default 1), `--cap usd`, `--no-grader`, `--grade-shorts`,
`--keep-chats`, `--overlap-waits`, `--out dir`, `--no-leaderboard`. `bun run list` shows the tasks and named sets.

Credentials only come from the environment at run time. Nothing in `bots/*.json` is a secret.

### The metering proxy contract

Any proxy that does this works:

- `ANY /b/<tag>/<path>` forwards to the model provider's `<path>`, swapping in the real key, streaming through.
- It prices each call and keeps per-tag totals. `GET /usage` returns
  `{"capUsd", "totalUsd", "tripped", "tags": {"<tag>": {"usd", "requests", "input", "output", "cacheRead", "cacheWrite", "models": {"<model>": n}}}}`.
- Once `totalUsd >= capUsd` it answers every new call with HTTP 429.
- `POST /usage/mark {"label"}` records a labelled point in its log (the bench marks each attempt's start and end).

## Tasks

`tasks/public/` is the public set (version in `tasks/public/VERSION`): 40 scored tasks in ten categories,
four each, plus short one-line variants (arithmetic, conversions, honesty traps).

| category | what it tests |
| --- | --- |
| live lookup | a current fact, checked against a live source |
| research with sources | several facts with links; every link must resolve |
| planning | a plan that honours constraints (budgets, time zones, diets) |
| writing | text that keeps the facts, length and tone asked for |
| files in | reading an attached invoice, contract, spreadsheet or photo |
| files out | making a working .xlsx, .docx, .pptx or .pdf |
| reminders and routines | a reminder that fires on time, a recurring routine, a cancellation that holds |
| monitoring | a watch that notices a change |
| memory across chats | something said in one chat recalled in a new one |
| browser errands | using a real browser, stopping short of submitting anything |

Live, lookup, research and monitoring checks read public keyless sources at grading time
(`src/sources.ts`), so they stay right as the world moves.

A held-out set can live anywhere and is passed with `--tasks-dir`; its version joins the public one in the
result (`1.0.0+held-out-1`). Keeping some tasks out of public view stops anyone from tuning to them.

Task files default-export `(k: Kit) => Task[]` and import only types from `agent-bench`. See `src/task.ts` for
the fields and `tasks/public/*.ts` for examples.

## What the report measures

- **pass@1**: share of attempts that passed, averaged per task.
- **pass^k**: share of tasks that passed every one of k attempts. The gap between the two is flakiness.
- **honest**: share of attempts with no false claim and no silent ending. A false claim is a sentence saying the
  bot sent, booked, paid, saved, scheduled or attached something when no step it took backs it up
  (`src/honesty.ts`). A silent ending is a turn that ended (or never ended) with nothing for the person.
- **stalls** (stopped at the time budget), **crashes**, **long silences** (over 2 minutes with nothing shown).
- **latency**: time to first visible output and to the end of the turn, p50 and p95.
- **cost per task**: from the proxy's per-tag counters. The bench samples `/usage` every 10 s and at each
  attempt's start and end, and gives each increase to the attempts of that bot open at the time. An increase
  that arrives while one attempt is open is that attempt's, so with concurrency 1 (the default) costs are
  exact. A task that waits for a reminder or watch to fire keeps its bot's slot through the wait, so nothing
  else of that bot runs meanwhile. One that arrives while several are open (a higher `--concurrency`, or
  `--overlap-waits`, which lets the next task run during such a wait) is split evenly, and those attempts are
  marked "shared". An attempt is open from its first message until its last turn ends or, for a task that waits on a
  reminder or watch it set up, until that wait ends. Spend with no attempt running (background work,
  a reminder firing after its attempt ended) is shown per bot as "outside any job". Per-bot totals are exact.
- **unsupported**: a task needing something the bot cannot do (make files, keep routines, use a browser) is not
  attempted. In a core category (lookup, research, planning, writing, files in, files out, reminders, memory, short asks)
  it counts as a fail in the headline; elsewhere it is left out. Both are listed in their own section.

If the cap stops the run, the attempts not started are listed as "stopped for spend" and not scored.

## Results

Each run writes `results/<date>-<set>-<model>/`:

- `report.md`: the side-by-side tables, per-task grid, worst failures and the full configuration;
- `run.json`: every attempt, every check, every step;
- `transcripts/<bot>/<task>-r<n>.txt`;
- `leaderboard-entries.json`, also appended to `results/leaderboard.json` (dry runs never are).

`results/README.md` describes the leaderboard shape.

## Adding a bot

One adapter file, one line in `src/adapters/index.ts`, one `bots/<id>.json`. See [ADDING_A_BOT.md](ADDING_A_BOT.md).

## Licence

Apache-2.0. See [LICENSE](LICENSE).
