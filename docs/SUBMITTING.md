# Submitting a bot

κ-bench is open to any personal agent that a person can talk to and that exposes an API or a headless mode:
open-source projects, products and companies. Every entry runs under the same rules, on the same model,
graded by the same blind grader, and every transcript is published.

## 1. Write an adapter

A bot needs three files: `bots/<id>.json` (what it is, the version, the model, the settings the bench
uses), `src/adapters/<id>.ts` (a class implementing `Adapter` over your bot's own API) and one line in
`src/adapters/index.ts`. [ADDING_A_BOT.md](../ADDING_A_BOT.md) describes each method and how to map your
bot's records to the bench's neutral shapes.

Rules that keep entries comparable:

- Use the product's documented defaults. Record anything you set in `settings`, with a note saying why.
- Read only what the product shows its user or exposes through its documented API: no database reads, no
  log scraping, no patched builds.
- Point the bot's model calls at the metering proxy (`<proxy>/b/<id>`). If the product cannot, its adapter
  must read the bot's own usage meter, and the entry says so.
- Never answer an approval card or a question in the adapter; the bench's policy does.
- Do not tune the product to κ-bench or detect it. [INTEGRITY.md](INTEGRITY.md) has the rules; entries that break
  them are marked or removed.

## 2. Run it locally

```sh
bun run typecheck
bun run dry-run --bots <id>                                # the plumbing around your config, no spend
bun run bench --bots <id> --mode smoke --no-grader         # five real tasks against your bot
bun run bench --bots <id> --mode full --with-shorts        # the full public set, if you want to see it
```

Read a few transcripts in `results/.../transcripts/` against what your bot's own interface showed. If a
check or a claim rule reads your bot unfairly, open a task issue; fixes apply to every bot.

## 3. Open a submission issue

Open a [submission issue](https://github.com/ychampion/kappa-bench/issues/new?template=submit-a-bot.yml) with:

- a link to the pull request that adds your adapter and `bots/<id>.json`;
- how to install the pinned version at its documented defaults (a public image, a compose file or a
  package);
- a contact who can review the configuration before results are published;
- your smoke-run report, if you ran one.

## 4. The maintainers run it

The maintainers install the pinned version, run the full public set at k = 1, the reliability subset at
k = 3, and the private held-out set, on the same model and settings as the other entries, through the
metering proxy, with the blind grader. Your contact sees the configuration block before the run.

## 5. Publish

The results folder (report, run.json and every transcript for the public tasks) is committed under
`results/<date>/`, the leaderboard and charts are regenerated, and the entry goes live. The private
held-out results are reported as totals only, so the tasks stay hidden.

## Disputes

If you think a result is wrong, open a [result dispute](https://github.com/ychampion/kappa-bench/issues/new?template=result-dispute.yml)
naming the task, the attempt and the transcript line. If the check, a claim rule or the grader input was
wrong, the fix applies to every bot, the stored answers are re-scored (`bun run rescore`), and the change is
listed in the report and the changelog.

## Partners

Companies building agents can join as partners: a named contact for runs and disputes, and help writing an
adapter. Ask in a submission issue.
