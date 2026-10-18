## What this changes

<!-- One or two sentences. -->

## Why

<!-- The answer, transcript or task that shows the problem, if any. -->

## Checklist

- [ ] `bun run typecheck`, `validate`, `selftest` and `dry-run` pass
- [ ] A check or claim-rule fix reads every bot the same way and has a self-test case that fails without it
- [ ] Task changes bump `tasks/public/VERSION` and the changelog
- [ ] If published numbers change: re-scored with `bun run rescore`, then `bun run leaderboard` and `bun run charts`, and `bun run verify-results` passes
- [ ] No secrets, hostnames, IP addresses or local paths in code, results or transcripts
