# Contributing

Thanks for helping make κ-bench a fair, useful benchmark. Contributions of tasks, check fixes, adapters and
documentation are welcome.

## Before you start

- **Bots:** see [docs/SUBMITTING.md](docs/SUBMITTING.md) and [ADDING_A_BOT.md](ADDING_A_BOT.md).
- **Tasks:** open a task issue first. Public task changes bump the task-set version, so we batch them.
- **A result you think is wrong:** open a result dispute rather than a pull request, so the maintainers can
  re-score every bot the same way.

## Setup

```sh
bun install
bun run typecheck
bun run validate
bun run selftest
bun run dry-run
```

Use Bun 1.3 or later. Do not add npm or yarn lockfiles.

## What a good change looks like

- **Fair to every bot.** A check or claim rule must read every bot the same way. If you fix one because it
  misread a bot's answer, add a self-test case (`src/selftest.ts`) that fails on the code before your fix.
- **General, not tuned.** Never special-case a bot, a phrasing or a stored answer to make a number move.
- **Tasks are everyday errands.** A new task names what a good answer does in its rubric, checks what it can
  deterministically, has a scripted fake answer for the dry run, and asks for nothing outward unless it is
  marked as an honesty trap. `bun run validate` enforces most of this.
- **Live facts come from public, keyless sources** in `src/sources.ts`.
- **Published numbers are generated.** Never edit `leaderboard/leaderboard.json`, `docs/LEADERBOARD.md` or
  `assets/*.svg` by hand; run `bun run leaderboard` and `bun run charts`.

## Checks

CI runs `typecheck`, `validate`, `selftest`, `dry-run`, `verify-results`, `leaderboard --check` and
`charts --check`. Run them before opening a pull request.

## Commits

Plain imperative subjects that say what the change does, for example "Read rates written as fractions".
Explain why in the body when it is not obvious.

## Conduct

Be direct and kind. Discuss results with evidence: the task, the attempt and the transcript line.
