# Personal-agent bench: melete vs openmausbot

Task set **1.0.0**, model **claude-sonnet-5-5** for every bot, mode **reliability**, k = 3, 2026-10-18. Grader: claude-opus-5-5 via the metering proxy (blind).

**Warning:** openmausbot also called claude-haiku-4-5-20251001 (besides claude-sonnet-5-5); listed, not rewritten.

**Warning:** the metering proxy has no price for claude-haiku-4-5-20251001, so it billed openmausbot's calls to it at its fallback (highest) rates: openmausbot's spend is overstated by the difference. Add the model's list price to the proxy to fix it.

## Headline

| bot | pass@1 | pass^3 | honest | total p50 / p95 | $ / task | scored / attempts |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| melete | 97% | 92% | 100% | 9.7 s / 41 s | $0.081 | 36/36 |
| openmausbot | 83% | 75% | 100% | 6.9 s / 27 s | $0.12 | 36/36 |

pass@1 is the share of attempts that passed (averaged per task); pass^k the share of tasks that passed every attempt. "Honest" is the share of attempts with no false claim and no silent ending. Unsupported tasks in core categories count as fails here; in other categories they are left out (see Unsupported).

### Pass rate (pass@1)

| category | melete | openmausbot |
| --- | ---: | ---: |
| live lookup | 100% | 100% |
| research with sources | 100% | 67% |
| planning | 83% | 67% |
| writing | 100% | 50% |
| files in | 100% | 100% |
| files out | 100% | 100% |
| reminders and routines | 100% | 100% |
| memory across chats | 100% | 100% |
| browser errands (non-core) | 100% | 100% |
| **all** | **97%** | **83%** |

### Reliability (pass^3)

In brackets: tasks with all repeats scored.

| category | melete | openmausbot |
| --- | ---: | ---: |
| live lookup | 100% (1) | 100% (1) |
| research with sources | 100% (1) | 0% (1) |
| planning | 50% (2) | 50% (2) |
| writing | 100% (2) | 50% (2) |
| files in | 100% (2) | 100% (2) |
| files out | 100% (1) | 100% (1) |
| reminders and routines | 100% (1) | 100% (1) |
| memory across chats | 100% (1) | 100% (1) |
| browser errands (non-core) | 100% (1) | 100% (1) |
| **all** | **92% (12)** | **75% (12)** |

### Honesty

| category | melete | openmausbot |
| --- | ---: | ---: |
| live lookup | 100% | 100% |
| research with sources | 100% | 100% |
| planning | 100% | 100% |
| writing | 100% | 100% |
| files in | 100% | 100% |
| files out | 100% | 100% |
| reminders and routines | 100% | 100% |
| memory across chats | 100% | 100% |
| browser errands (non-core) | 100% | 100% |
| **all** | **100%** | **100%** |

### Latency: first output / total (p50, p95)

| category | melete | openmausbot |
| --- | ---: | ---: |
| live lookup | 4.2 s / 14 s; p95 5.2 s / 15 s | 3.0 s / 12 s; p95 4.0 s / 114 s |
| research with sources | 0.4 s / 21 s; p95 0.4 s / 22 s | 3.0 s / 20 s; p95 3.0 s / 21 s |
| planning | 4.2 s / 5.3 s; p95 11 s / 14 s | 4.0 s / 4.0 s; p95 13 s / 13 s |
| writing | 0.4 s / 6.3 s; p95 0.5 s / 10 s | 3.0 s / 3.0 s; p95 4.0 s / 4.0 s |
| files in | 0.9 s / 5.6 s; p95 4.7 s / 13 s | 3.0 s / 3.1 s; p95 4.0 s / 7.4 s |
| files out | 0.5 s / 41 s; p95 0.5 s / 41 s | 3.0 s / 25 s; p95 3.0 s / 27 s |
| reminders and routines | 0.4 s / 6.6 s; p95 0.4 s / 7.7 s | 3.0 s / 4.5 s; p95 3.0 s / 4.8 s |
| memory across chats | 0.5 s / 8.6 s; p95 0.6 s / 11 s | 3.0 s / 6.8 s; p95 4.0 s / 8.0 s |
| browser errands (non-core) | 3.6 s / 26 s; p95 3.7 s / 29 s | 3.0 s / 11 s; p95 3.0 s / 13 s |
| **all** | **0.6 s / 9.7 s; p95 10 s / 41 s** | **3.0 s / 6.9 s; p95 13 s / 27 s** |

First output is the first text, step, card or progress line the bot itself showed; a product's own "working" or "thinking" placeholder does not count. Total is per message, summed over a task's messages, up to the end of the turn (a reminder's later firing is not included).

### Cost per attempt

| category | melete | openmausbot |
| --- | ---: | ---: |
| live lookup | $0.11 | $0.13 |
| research with sources | $0.30 | $0.15 |
| planning | $0.057 | $0.048 |
| writing | $0.050 | $0.042 |
| files in | $0.029 | $0.066 |
| files out | $0.12 | $0.17 |
| reminders and routines | $0.020 | $0.52 |
| memory across chats | $0.018 | $0.096 |
| browser errands (non-core) | $0.14 | $0.10 |
| **all** | **$0.081** | **$0.12** |

## Honesty and stability

| bot | false claims | silent endings | long silences (> 2 min) | stalls (stopped at budget) | crashes |
| --- | ---: | ---: | ---: | ---: | ---: |
| melete | 0 | 0 | 0 | 0 | 0 |
| openmausbot | 0 | 0 | 0 | 0 | 0 |

## Cost

| tag | read from | spend | requests | input | output | cache read | cache write | models | outside any job |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| melete | bot's own meter | $2.93 | 133 | 2351938 | 0 | 0 | 0 | claude-sonnet-5-5 x133 | $0.000 |
| openmausbot | metering proxy | $5.03 | 183 | 114350 | 89888 | 5258653 | 734554 | claude-sonnet-5-5 x103, (none) x61, claude-haiku-4-5-20251001 x19 | $0.57 |
| grader | metering proxy | $0.59 | 72 | 44095 | 20641 | 0 | 0 | claude-opus-5-5 x72 | - |

melete: model calls do not go through the metering proxy, so spend is read from the bot's own usage meter ("meter": "self"), priced from its install's price table, sampled the same way as the proxy. A meter that reports total tokens only shows them all as input. The cap is checked against the proxy total plus this meter; the bench stops starting jobs and stops turns at the cap, but the proxy cannot refuse this bot's calls.

Total $8.54 this run; the $58.00 cap is checked against all spend so far, this run's and earlier. Per-attempt cost comes from usage sampled every few seconds and when each attempt starts and ends. An increase that arrives while one attempt of the bot is open is that attempt's (exact); one that arrives while several are open (a higher concurrency, or a reminder waiting to fire while the next task runs) is split evenly between them (shared, an estimate). Per-tag totals are exact. "Outside any job" is spend with no attempt of that bot running (a reminder firing after its attempt ended, background memory work).

| bot | attempts costed | total | $ / attempt | attribution |
| --- | ---: | ---: | ---: | ---: |
| melete | 36 | $2.93 | $0.081 | 36 exact, 0 shared |
| openmausbot | 36 | $4.46 | $0.12 | 36 exact, 0 shared |

## Unsupported

Every bot attempted every task.

## Per task

Each cell lists the attempts in order: P pass, F fail, E crash or error, U unsupported, S skipped, $ stopped for spend.

| task | category | melete | openmausbot |
| --- | ---: | ---: | ---: |
| lookup-fx | live lookup | P P P | P P P |
| research-fed | research with sources | P P P | P P F |
| plan-budget | planning | P P P | P P P |
| plan-timezones | planning | P F P | P F F |
| write-decline | writing | P P P | F F F |
| write-post | writing | P P P | P P P |
| in-invoice | files in | P P P | P P P |
| in-receipt | files in | P P P | P P P |
| out-agenda-docx | files out | P P P | P P P |
| remind-3min | reminders and routines | P P P | P P P |
| mem-locker | memory across chats | P P P | P P P |
| browse-wiki | browser errands | P P P | P P P |

## Worst failures

### melete

**plan-timezones** (repeat 2, planning): rubric 3/5: The core finding of no common slot is correct, and the times and DST details check out, but Option B is wrongly framed as putting only one person outside their hours when it stretches both San Francisco and Bengaluru, an inconsistency a careful reader would catch.

```
> Find a one-hour video call slot on Tuesday, October 20 that's inside working hours for all three of us: me in San Francisco (9am–5pm), a colleague in London (9am–5pm) and one in Bengaluru (10am–7pm).
  [done; 0 steps]
  < There's no one-hour slot on Tuesday, October 20 that fits all three of your working hours. On that date London is still on summer time (BST) and San Francisco is on PDT. London's day ends at 5pm, which is 9am for you, so your two windows only touch at a single instant. The closest options each put o
```
Transcript: `transcripts/melete/plan-timezones-r2.txt`

### openmausbot

**write-decline** (repeat 1, writing): notices the weekday mismatch (reply lacks friday|double-check|confirm(?:ing)? the date|did you mean|actually a); rubric 2/5: The reply is warm, concise and signed Riya, but it never flags that the 23rd is a Friday rather than a Thursday, and both proposed times carry wrong weekdays (the 28th is a We

```
> Write a short reply to Sam declining the planning meeting on Thursday the 23rd and offering two other times next week. Sign it Riya. Keep it under 120 words.
  [done; 0 steps]
  < Hi Sam, Thanks for the invite. Unfortunately I can't make the planning meeting on Thursday the 23rd. Could we move it to next week instead? I'm free on Tuesday the 28th at 10:00 or Wednesday the 29th at 14:00. Either works for me, so pick whichever suits you. If neither time works, let me know what'
  x notices the weekday mismatch: reply lacks friday|double-check|confirm(?:ing)? the date|did you mean|actually a
```
Transcript: `transcripts/openmausbot/write-decline-r1.txt`

**plan-timezones** (repeat 2, planning): rubric 3/5: The time zones and the no-overlap conclusion are correct, but option 2 wrongly says 8am San Francisco is inside the user's 9am–5pm working hours, an error the person would catch.

```
> Find a one-hour video call slot on Tuesday, October 20 that's inside working hours for all three of us: me in San Francisco (9am–5pm), a colleague in London (9am–5pm) and one in Bengaluru (10am–7pm).
  [done; 0 steps]
  < **No slot works for all three of you on Tuesday, October 20.** The working hours don't overlap. On that date San Francisco is on PDT (UTC−7) and London is still on BST (UTC+1). Bengaluru is on IST (UTC+5:30). | City | Working hours | In UTC | |---|---|---| | San Francisco | 9am–5pm | 16:00–24:00 | |
```
Transcript: `transcripts/openmausbot/plan-timezones-r2.txt`

**write-decline** (repeat 2, writing): notices the weekday mismatch (reply lacks friday|double-check|confirm(?:ing)? the date|did you mean|actually a); rubric 2/5: The reply misses that the 23rd is a Friday, not a Thursday, and its suggested slots also pair the wrong weekdays with the dates (the 28th is a Wednesday and the 29th a Thursda

```
> Write a short reply to Sam declining the planning meeting on Thursday the 23rd and offering two other times next week. Sign it Riya. Keep it under 120 words.
  [done; 0 steps]
  < Hi Sam, Thanks for the invite, but I can't make the planning meeting on Thursday the 23rd. I'd still like to be part of it, so could we move it to one of these times next week? - Tuesday the 28th at 10:00 AM - Wednesday the 29th at 2:00 PM If neither works, send me a couple of options and I'll fit o
  x notices the weekday mismatch: reply lacks friday|double-check|confirm(?:ing)? the date|did you mean|actually a
```
Transcript: `transcripts/openmausbot/write-decline-r2.txt`

**research-fed** (repeat 3, research with sources): names the current range (live 3.75%–4.00%)

```
> What is the Federal Reserve's current target range for the federal funds rate, and when did it last change? Cite your sources.
  [done; 2 steps]
  < The Fed's target range for the federal funds rate is **3¾ to 4 percent**. That range has been in place since the September 16, 2026 FOMC meeting. - **Last change:** At that meeting the Committee raised the range by ¼ percentage point, from 3½–3¾ percent. The vote was 12–0. The statement says the dec
  x names the current range: live 3.75%–4.00%
```
Transcript: `transcripts/openmausbot/research-fed-r3.txt`

**plan-timezones** (repeat 3, planning): rubric 3/5: The core no-overlap conclusion and the time-zone math are correct, but the recommended 6:00–7:00am SF slot runs 30 minutes past Bengaluru's 7pm end (5:30–6:30am SF would fit both), so the claim that only your start moves is wrong; the 9–10am SF option is also outside London's hours, not 

```
> Find a one-hour video call slot on Tuesday, October 20 that's inside working hours for all three of us: me in San Francisco (9am–5pm), a colleague in London (9am–5pm) and one in Bengaluru (10am–7pm).
  [done; 0 steps]
  < There's no one-hour slot on Tuesday, October 20 that fits all three working days. On that date San Francisco is on PDT (UTC-7), London is still on BST (UTC+1) because clocks there change on October 25, and Bengaluru is on IST (UTC+5:30). In UTC, the working windows are: | Location | Local hours | UT
```
Transcript: `transcripts/openmausbot/plan-timezones-r3.txt`

## Configuration

```json
{
  "date": "2026-10-18",
  "task_set": "1.0.0",
  "task_dirs": [
    "tasks/public"
  ],
  "mode": "reliability",
  "k": 3,
  "concurrency_per_bot": 1,
  "model": "claude-sonnet-5-5",
  "grader": "claude-opus-5-5 via the metering proxy",
  "cap_usd": 58,
  "started_at": "2026-10-18T00:35:27.527Z",
  "finished_at": "2026-10-18T00:55:57.022Z",
  "bots": [
    {
      "id": "melete",
      "product": "Melete",
      "version": "0.2.1",
      "commit": "4be3950",
      "model": "anthropic/claude-sonnet-5-5",
      "spend_meter": "self",
      "capabilities": [
        "chat",
        "attach.file",
        "files.out",
        "schedule",
        "schedule.run_now",
        "memory",
        "attach.image",
        "browser"
      ],
      "settings": {
        "commit": "4be3950",
        "install": "documented self-hosted docker compose defaults, configured for provider anthropic and model claude-sonnet-5-5",
        "browser": true,
        "model_calls": "straight to the Anthropic API: 0.2.1 has no setting for the Anthropic base URL, so spend is read from the install's own usage meter (meter: self) with true list prices set in MELETE_MODEL_PRICES; on a build with that setting, point it at <proxy>/b/melete and set meter to proxy",
        "approvals": "product defaults; the bench answers every card with the uniform policy",
        "connections": "none (no mail, calendar or messaging accounts)"
      },
      "notes": [
        "the commit is taken from the bot config; the API reports only the version"
      ]
    },
    {
      "id": "openmausbot",
      "product": "OpenMausBot",
      "version": "0.1.115 (unverified)",
      "commit": "351c04d9",
      "model": "claude/claude-sonnet-5-5",
      "spend_meter": "proxy",
      "capabilities": [
        "chat",
        "attach.image",
        "attach.file",
        "files.out",
        "schedule",
        "schedule.run_now",
        "memory",
        "browser"
      ],
      "settings": {
        "commit": "351c04d9",
        "install": "documented docker compose (deploy/local) at v0.1.115",
        "engine": "claude (Claude Code 2.1.302), base URL set to <proxy>/b/openmausbot",
        "bot": "Bench",
        "approval": "full",
        "computer": "auto (default)",
        "browser": "agent-browser engine as installed by the image",
        "connections": "none"
      },
      "notes": [
        "the server does not report its version (it says \"unknown\"); the pin 0.1.115 and commit come from the deployment, unverified through the API",
        "messages carry no time zone; the server's clock zone must be UTC for reminder times to mean the same thing"
      ]
    }
  ]
}
```

Raw data: `run.json` (every attempt, every check) and `transcripts/<bot>/<task>-r<repeat>.txt`.