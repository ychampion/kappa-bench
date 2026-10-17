# Adding a bot

A bot needs three things:

1. `bots/<id>.json`: what it is, which version, which model, its settings for the bench.
2. `src/adapters/<id>.ts`: a class implementing `Adapter` (`src/adapter.ts`) over the bot's own API.
3. One line in `src/adapters/index.ts` registering it.

The tasks, honesty rules, grader and report never see your bot's own records. The adapter translates them
into the bench's neutral shapes (`src/types.ts`), and that is the whole job.

## bots/&lt;id&gt;.json

```json
{
  "id": "mybot",
  "product": "MyBot",
  "adapter": "mybot",
  "homepage": "https://example.com/mybot",
  "version_pin": "1.4.0",
  "model": "claude-sonnet-5-5",
  "env": { "url": "BENCH_MYBOT_URL", "token": "BENCH_MYBOT_TOKEN" },
  "settings": { "commit": "abc1234", "install": "documented docker compose", "approvals": "defaults" },
  "notes": ["Anything a reader needs to know to reproduce the setup."]
}
```

- `id` is also the metering proxy tag: the bot's model calls go to `<proxy>/b/<id>`.
- `env` names environment variables, never values. Credentials only come from the environment at run time.
- `settings` and `notes` are copied into every report so a reader can reproduce the setup. Use the product's
  documented defaults; anything changed from a default needs a note saying why.

## The adapter

| method | what it does |
| --- | --- |
| `preflight()` | Checks the bot answers, is the pinned version (unless `BENCH_ALLOW_VERSION_MISMATCH=1`), runs the agreed model and has no messaging accounts connected. Returns version, commit, model and capabilities. Throws with a message that says how to fix it. |
| `newConversation(chat, title)` | A fresh conversation. |
| `send(conv, text, attachments, signal)` | Sends a message and returns a `Turn` whose `events` stream `text`, `action`, `progress`, `card` and finally `end`. Stop when `signal` aborts. |
| `answerApproval(conv, card, allow\|deny)` | Answers an approval card. The bench decides; the adapter only delivers. |
| `answerQuestion(conv, card, text)` | Answers a question card. |
| `interrupt(conv)` | Presses Stop. |
| `finishTurn(conv, turn)` | Reads the finished turn back from the bot's own record: reply text, status, actions, open cards. |
| `listOutputs(conv)` | Files the bot made in this conversation, downloaded as bytes. |
| `scheduled(conv)` | Reminders, routines and watches set from this conversation, each with its fires (when it ran and what it said). |
| `runScheduledNow?(conv, item)` | Starts a test run of a routine now, if the product can. |
| `deleteConversation(conv)` | Removes the conversation and anything it set up; returns one line per thing removed or left. |
| `memoryHolds?(value)` | Pacing only (never scored): whether memory already holds a value, so a recall test does not race the bot's memory writer. |

`productNames` lists every name that identifies the product or its engine. The grader's input has them all
replaced with "the assistant", so list brand names, internal tool prefixes and assistant names.

### Capabilities

Declare what the bot can do (`chat`, `attach.image`, `attach.file`, `files.out`, `schedule`,
`schedule.run_now`, `memory`, `browser`). A task requiring a capability the bot lacks is reported as
unsupported instead of failed. Read capabilities from the server where it says (a browser that is configured,
an engine that is up) rather than hard-coding them.

### Mapping guidance

- **Actions.** Map each tool step to a kind: `web` (search, fetch), `browser`, `shell`, `file`, `memory`,
  `schedule`, `send` (anything outward), `other`. Keep the step's own label as `title` and put URLs and inputs
  in `detail`: honesty rules and checks read them. A step that failed has `ok: false`.
- **Status.** `done`, `needs_you` (waiting on a card), `failed` (with the bot's reason), `stopped`.
- **Reply.** The turn's final answer text, as the person would read it.
- **Files.** Only files the bot made or offered in this conversation, not files the person attached.
- **Scheduled items.** `kind`, `active`, `next_at`, `time`, `weekdays`, `cron` and a readable `text`. Fires
  carry the time they ran and the words they produced; a run that produced nothing has an empty `text`.
- **Timestamps.** Return the bot's own timestamp for each message (`server_sent_at`) so reminder timing is
  measured on its clock.

### Rules

- Read only what the product shows its user or exposes through its documented API. No database reads, no
  log scraping, no patched builds.
- Cite the API you rely on in the adapter's header comment (route, and where it is defined), pinned to the
  version you wrote it against.
- Never answer a card yourself; the bench's policy does.
- Never change the product's settings beyond its documented defaults and what `settings` records.

## Checking your adapter

```sh
bun run typecheck
bun run dry-run --bots mybot      # the fake bot wearing your bot's config; checks the plumbing around it
bun run bench --bots mybot --mode smoke --no-grader
```

The fake bot (`src/adapters/fake.ts`) shows the event shapes an adapter should produce. Then read a few
transcripts in `results/.../transcripts/` against what the bot's own interface showed.
