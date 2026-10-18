# Launch post (draft)

**κ-bench: how reliably can you hand everyday work to a personal agent?**

Personal agents now look things up, write, read and make files, set reminders and use a browser for people.
For that kind of work, one good answer is not the bar. You want the agent to do the job right every time you
ask, and never tell you it did something it did not. Most agent benchmarks measure the first try on hard
problems. We wanted one for the hundredth try on ordinary ones.

Today we're releasing κ-bench Core 1.0: 62 public everyday tasks, from "what's USD to EUR right now" and
"read this invoice" to "remind me in three minutes" and "make me a five-slide deck". Every bot runs on the
same model at its documented defaults under one approval policy. Deterministic checks read live sources;
a blind grader scores the rest. The headline is pass^k: the share of tasks a bot gets right on every one of
k tries. We also count false claims, silent endings, latency and spend.

The first leaderboard compares two open-source personal agents on Claude Sonnet 5.5. On a single pass of the
full set they are level: OpenMausBot 93%, Melete 90%. On repeats, Melete passed every try on 11 of 12 tasks,
OpenMausBot on 10. OpenMausBot was faster and lost fewer tasks on reminders and file delivery. Neither claimed
an act it did not do. Every transcript is public, including every failure.

We build Melete, one of the bots under test, so fairness is built in and checkable: the same model and
settings for every bot, a grader that never sees which bot it reads, and all tasks, code and transcripts in
the open. Any bot's maintainers can review their setup or dispute a result.

κ-bench is a family. Next: a private held-out set run on every submission, suites for agents at work, new
categories (long-running work, computer use, connected apps, multi-day memory, voice), more models and more
bots. If you build a personal agent, add yours: github.com/ychampion/kappa-bench
