# κ-bench: melete vs openmausbot

Task set **1.0.0**, model **claude-sonnet-5-5** for every bot, mode **reliability**, k = 3, 2026-10-18. Grader: claude-opus-5-5 via the metering proxy (blind).

**Warning:** openmausbot also called claude-haiku-4-5-20251001 (besides claude-sonnet-5-5); listed, not rewritten.

**Warning:** the metering proxy has no price for claude-haiku-4-5-20251001, so it billed openmausbot's calls to it at its fallback (highest) rates: openmausbot's spend is overstated by the difference. Add the model's list price to the proxy to fix it.

## Headline

| bot | pass@1 | pass^3 | honest | total p50 / p95 | $ / task | scored / attempts |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| melete | 94% | 83% | 100% | 10 s / 38 s | $0.094 | 36/36 |
| openmausbot | 86% | 83% | 100% | 7.6 s / 27 s | $0.094 | 36/36 |

pass@1 is the share of attempts that passed (averaged per task); pass^k the share of tasks that passed every attempt. "Honest" is the share of attempts with no false claim and no silent ending. Unsupported tasks in core categories count as fails here; in other categories they are left out (see Unsupported).

### Pass rate (pass@1)

| category | melete | openmausbot |
| --- | ---: | ---: |
| live lookup | 100% | 100% |
| research with sources | 100% | 100% |
| planning | 83% | 67% |
| writing | 83% | 50% |
| files in | 100% | 100% |
| files out | 100% | 100% |
| reminders and routines | 100% | 100% |
| memory across chats | 100% | 100% |
| browser errands (non-core) | 100% | 100% |
| **all** | **94%** | **86%** |

### Reliability (pass^3)

In brackets: tasks with all repeats scored.

| category | melete | openmausbot |
| --- | ---: | ---: |
| live lookup | 100% (1) | 100% (1) |
| research with sources | 100% (1) | 100% (1) |
| planning | 50% (2) | 50% (2) |
| writing | 50% (2) | 50% (2) |
| files in | 100% (2) | 100% (2) |
| files out | 100% (1) | 100% (1) |
| reminders and routines | 100% (1) | 100% (1) |
| memory across chats | 100% (1) | 100% (1) |
| browser errands (non-core) | 100% (1) | 100% (1) |
| **all** | **83% (12)** | **83% (12)** |

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
| live lookup | 3.6 s / 14 s; p95 5.1 s / 16 s | 3.0 s / 13 s; p95 4.0 s / 13 s |
| research with sources | 0.4 s / 24 s; p95 0.5 s / 24 s | 4.0 s / 17 s; p95 5.0 s / 23 s |
| planning | 3.9 s / 5.1 s; p95 10 s / 13 s | 4.0 s / 4.1 s; p95 16 s / 16 s |
| writing | 0.4 s / 5.7 s; p95 0.5 s / 9.7 s | 3.0 s / 3.3 s; p95 4.5 s / 4.5 s |
| files in | 1.1 s / 6.0 s; p95 4.6 s / 11 s | 3.4 s / 3.5 s; p95 4.0 s / 7.9 s |
| files out | 0.5 s / 38 s; p95 0.5 s / 38 s | 3.0 s / 27 s; p95 4.0 s / 27 s |
| reminders and routines | 0.5 s / 7.4 s; p95 0.5 s / 8.7 s | 3.0 s / 4.9 s; p95 4.0 s / 5.0 s |
| memory across chats | 0.4 s / 10 s; p95 0.5 s / 10 s | 4.0 s / 8.2 s; p95 4.0 s / 8.7 s |
| browser errands (non-core) | 3.9 s / 26 s; p95 4.0 s / 36 s | 3.0 s / 13 s; p95 4.0 s / 33 s |
| **all** | **0.5 s / 10 s; p95 9.0 s / 38 s** | **3.5 s / 7.6 s; p95 11 s / 27 s** |

First output is the first text, step, card or progress line the bot itself showed; a product's own "working" or "thinking" placeholder does not count. Total is per message, summed over a task's messages, up to the end of the turn (a reminder's later firing is not included).

### Cost per attempt

| category | melete | openmausbot |
| --- | ---: | ---: |
| live lookup | $0.11 | $0.13 |
| research with sources | $0.34 | $0.15 |
| planning | $0.052 | $0.056 |
| writing | $0.037 | $0.042 |
| files in | $0.029 | $0.059 |
| files out | $0.17 | $0.15 |
| reminders and routines | $0.059 | $0.17 |
| memory across chats | $0.056 | $0.096 |
| browser errands (non-core) | $0.15 | $0.12 |
| **all** | **$0.094** | **$0.094** |

## Honesty and stability

| bot | false claims | silent endings | long silences (> 2 min) | stalls (stopped at budget) | crashes |
| --- | ---: | ---: | ---: | ---: | ---: |
| melete | 0 | 0 | 0 | 0 | 0 |
| openmausbot | 0 | 0 | 0 | 0 | 0 |

## Cost

| tag | read from | spend | requests | input | output | cache read | cache write | models | outside any job |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| melete | metering proxy | $3.40 | 128 | 62020 | 34729 | 1325531 | 1064765 | claude-sonnet-5-5 x128 | $0.027 |
| openmausbot | metering proxy | $3.50 | 183 | 128598 | 88768 | 5006053 | 750535 | claude-sonnet-5-5 x99, (none) x63, claude-haiku-4-5-20251001 x21 | $0.12 |
| grader | metering proxy | $0.58 | 72 | 44168 | 20284 | 0 | 0 | claude-opus-5-5 x72 | - |

Total $7.48 this run; the $46.38 cap is checked against all spend so far, this run's and earlier. Per-attempt cost comes from usage sampled every few seconds and when each attempt starts and ends. An increase that arrives while one attempt of the bot is open is that attempt's (exact); one that arrives while several are open (a higher concurrency, or a reminder waiting to fire while the next task runs) is split evenly between them (shared, an estimate). Per-tag totals are exact. "Outside any job" is spend with no attempt of that bot running (a reminder firing after its attempt ended, background memory work).

| bot | attempts costed | total | $ / attempt | attribution |
| --- | ---: | ---: | ---: | ---: |
| melete | 36 | $3.37 | $0.094 | 36 exact, 0 shared |
| openmausbot | 36 | $3.39 | $0.094 | 36 exact, 0 shared |

## Unsupported

Every bot attempted every task.

## Per task

Each cell lists the attempts in order: P pass, F fail, E crash or error, U unsupported, S skipped, $ stopped for spend.

| task | category | melete | openmausbot |
| --- | ---: | ---: | ---: |
| lookup-fx | live lookup | P P P | P P P |
| research-fed | research with sources | P P P | P P P |
| plan-budget | planning | P P P | P P P |
| plan-timezones | planning | F P P | F F P |
| write-decline | writing | F P P | F F F |
| write-post | writing | P P P | P P P |
| in-invoice | files in | P P P | P P P |
| in-receipt | files in | P P P | P P P |
| out-agenda-docx | files out | P P P | P P P |
| remind-3min | reminders and routines | P P P | P P P |
| mem-locker | memory across chats | P P P | P P P |
| browse-wiki | browser errands | P P P | P P P |

## Worst failures

### melete

**plan-timezones** (repeat 1, planning): rubric 3/5: The main conclusion is correct: there is no common slot on October 20, and the PDT, BST and IST offsets and the 8am/4pm/8:30pm compromise are right, but the London–Bengaluru overlap is wrong (it is 9am–2:30pm BST / 1:30–7pm IST, not 10am–5pm BST, which runs to 9:30pm IST and past Bengalu

```
> Find a one-hour video call slot on Tuesday, October 20 that's inside working hours for all three of us: me in San Francisco (9am–5pm), a colleague in London (9am–5pm) and one in Bengaluru (10am–7pm).
  [done; 0 steps]
  < There's no one-hour slot on Tuesday, October 20 that fits all three of you. On that date San Francisco is on PDT (UTC−7), London is still on BST (UTC+1) until the clocks change on October 25, and Bengaluru is on UTC+5:30. - **San Francisco and London:** 9am–5pm PDT is 5pm–1am in London, so the two w
```
Transcript: `transcripts/melete/plan-timezones-r1.txt`

**write-decline** (repeat 1, writing): notices the weekday mismatch (reply lacks friday|double-check|confirm(?:ing)? the date|did you mean|actually a); rubric 2/5: The draft is warm, brief and signed Riya, but it misses that the 23rd is a Friday rather than a Thursday and leaves placeholders where the two concrete alternative times shoul

```
> Write a short reply to Sam declining the planning meeting on Thursday the 23rd and offering two other times next week. Sign it Riya. Keep it under 120 words.
  [done; 1 steps]
  < Here's a draft. I left the two times as gaps because I can't see your availability. --- Hi Sam, Thanks for the invite. Unfortunately I can't make the planning meeting on Thursday the 23rd. Could we meet one of these times next week instead? - [day, e.g. Tue 27 Oct] at [time] - [day, e.g. Thu 29 Oct]
  x notices the weekday mismatch: reply lacks friday|double-check|confirm(?:ing)? the date|did you mean|actually a
```
Transcript: `transcripts/melete/write-decline-r1.txt`

### openmausbot

**plan-timezones** (repeat 1, planning): rubric 3/5: The core finding is correct: there is no three-way slot, and the DST offsets and UTC windows are right. However, options 2 and 3 are mislabeled as breaking only Bengaluru's hours when they also fall before San Francisco's 9am start, contradicting the 'each breaks one person's hours' fram

```
> Find a one-hour video call slot on Tuesday, October 20 that's inside working hours for all three of us: me in San Francisco (9am–5pm), a colleague in London (9am–5pm) and one in Bengaluru (10am–7pm).
  [done; 0 steps]
  < **There's no one-hour slot on Tuesday, October 20 that fits all three working days.** On that date San Francisco is on PDT (UTC−7) and London is still on BST (UTC+1). London only goes back to GMT on October 25. Bengaluru is on IST (UTC+5:30). | Person | Working hours | In UTC | |---|---|---| | San F
```
Transcript: `transcripts/openmausbot/plan-timezones-r1.txt`

**write-decline** (repeat 1, writing): notices the weekday mismatch (reply lacks friday|double-check|confirm(?:ing)? the date|did you mean|actually a); rubric 2/5: The note is warm, under 120 words, and signed Riya, but it misses that the 23rd is a Friday, not a Thursday, and its own alternatives pair the wrong weekdays with the dates (O

```
> Write a short reply to Sam declining the planning meeting on Thursday the 23rd and offering two other times next week. Sign it Riya. Keep it under 120 words.
  [done; 0 steps]
  < Hi Sam, Thanks for the invite. Unfortunately I can't make the planning meeting on Thursday the 23rd. I have a conflict I can't move. I'd still like to be part of the planning, though. Could we do one of these times next week instead? - Tuesday the 28th at 10:00 AM - Wednesday the 29th at 2:00 PM If 
  x notices the weekday mismatch: reply lacks friday|double-check|confirm(?:ing)? the date|did you mean|actually a
```
Transcript: `transcripts/openmausbot/write-decline-r1.txt`

**plan-timezones** (repeat 2, planning): rubric 3/5: The timezone and DST maths and the 'no common slot' conclusion are correct, but Option 2 is mislabelled 'You and London fit' even though 8am is before your start, it repeats itself with '8:00–9:00am PDT, or 8am–9am', and the closing advice about other dates is muddled.

```
> Find a one-hour video call slot on Tuesday, October 20 that's inside working hours for all three of us: me in San Francisco (9am–5pm), a colleague in London (9am–5pm) and one in Bengaluru (10am–7pm).
  [done; 0 steps]
  < There's no one-hour slot on Tuesday, October 20 that falls inside all three sets of working hours. On that date San Francisco is on PDT (UTC−7), because US daylight saving doesn't end until Nov 1. London is still on BST (UTC+1), because the clocks there change on Oct 25. Bengaluru is UTC+5:30. | Per
```
Transcript: `transcripts/openmausbot/plan-timezones-r2.txt`

**write-decline** (repeat 2, writing): notices the weekday mismatch (reply lacks friday|double-check|confirm(?:ing)? the date|did you mean|actually a); rubric 2/5: The reply is warm, brief, and signed Riya, but it misses that the 23rd is a Friday, not a Thursday. It also gets its own alternatives wrong: the 28th is a Wednesday and the 29

```
> Write a short reply to Sam declining the planning meeting on Thursday the 23rd and offering two other times next week. Sign it Riya. Keep it under 120 words.
  [done; 0 steps]
  < Hi Sam, Thanks for the invite. Unfortunately I can't make the planning meeting on Thursday the 23rd. Could we meet at one of these times next week instead? - Tuesday the 28th at 10:00 UTC - Wednesday the 29th at 14:00 UTC If neither works, let me know what suits you and I'll fit around it. Best, Riy
  x notices the weekday mismatch: reply lacks friday|double-check|confirm(?:ing)? the date|did you mean|actually a
```
Transcript: `transcripts/openmausbot/write-decline-r2.txt`

**write-decline** (repeat 3, writing): notices the weekday mismatch (reply lacks friday|double-check|confirm(?:ing)? the date|did you mean|actually a); rubric 2/5: The tone, length, and sign-off are good, but it misses that October 23 is a Friday, and both proposed times have the wrong weekday (the 28th is a Wednesday and the 29th a Thur

```
> Write a short reply to Sam declining the planning meeting on Thursday the 23rd and offering two other times next week. Sign it Riya. Keep it under 120 words.
  [done; 0 steps]
  < Subject: Thursday's planning meeting Hi Sam, Thanks for the invite. Unfortunately I can't make the planning meeting on Thursday the 23rd. I'd still like to be part of the discussion, though. Could we meet at one of these times next week instead? - Tuesday the 28th at 10:00 - Wednesday the 29th at 14
  x notices the weekday mismatch: reply lacks friday|double-check|confirm(?:ing)? the date|did you mean|actually a
```
Transcript: `transcripts/openmausbot/write-decline-r3.txt`

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
  "cap_usd": 46.38,
  "started_at": "2026-10-18T16:11:37.680Z",
  "finished_at": "2026-10-18T16:31:08.266Z",
  "bots": [
    {
      "id": "melete",
      "product": "Melete",
      "version": "0.2.1",
      "commit": "61886fb",
      "model": "anthropic/claude-sonnet-5-5",
      "spend_meter": "proxy",
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
        "commit": "61886fb",
        "install": "documented self-hosted docker compose defaults, configured for provider anthropic and model claude-sonnet-5-5",
        "browser": true,
        "model_calls": "through the metering proxy: ANTHROPIC_BASE_URL set to <proxy>/b/melete with a dummy key",
        "approvals": "product defaults; the bench answers every card with the uniform policy",
        "connections": "none (no mail, calendar or messaging accounts)",
        "build": "main at 6b95da5 with pull requests #494 (Anthropic base URL), #518 (delivering binary files) and #519 (cancelling chat reminders) merged. Images built by the project CI: the service from 61886fb; the runtime, web, browser and sandbox from f0dcee8, whose sources for those images are identical (the two commits differ only in the service)"
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