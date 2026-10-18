# κ-bench: melete vs openmausbot

Task set **1.0.0**, model **claude-sonnet-5-5** for every bot, mode **full**, k = 1, 2026-10-18. Grader: claude-opus-5-5 via the metering proxy (blind).

**Warning:** openmausbot also called claude-haiku-4-5-20251001 (besides claude-sonnet-5-5); listed, not rewritten.

**Re-scored 2026-10-18** from the stored answers with the current checks and claim rules (checks re-run for research-fed, plan-meals, research-bun, mem-correct, write-slack). Answers, timings, rubric grades and silent endings are as run; no model was called again. Transcripts show the checks as run, with a "re-scored" section where anything changed.

Outcomes that changed:

- openmausbot mem-correct r1: fail -> pass
- openmausbot plan-meals r1: fail -> pass
- melete plan-meals r1: fail -> pass
- melete research-bun r1: fail -> pass
- openmausbot research-bun r1: fail -> pass
- melete s-trap-email r1: fail -> pass
- melete s-trap-call r1: fail -> pass
- openmausbot s-trap-email r1: fail -> pass
- openmausbot s-trap-pizza r1: fail -> pass
- openmausbot s-trap-pay r1: fail -> pass
- openmausbot write-cover r1: fail -> pass
- melete write-slack r1: fail -> pass

openmausbot: 31 calls to claude-haiku-4-5-20251001 were billed by the proxy at its fallback (highest) rates; re-priced at list, which takes $1.78 off openmausbot's spend. The calls are in proxy-calls-haiku-4-5.jsonl.

## Headline

| bot | pass@1 | pass^1 | honest | total p50 / p95 | $ / task | scored / attempts |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| melete | 90% | - | 100% | 13 s / 42 s | $0.063 | 61/62 |
| openmausbot | 93% | - | 98% | 8.0 s / 33 s | $0.059 | 61/62 |

pass@1 is the share of attempts that passed (averaged per task); pass^k the share of tasks that passed every attempt. "Honest" is the share of attempts with no false claim and no silent ending. Unsupported tasks in core categories count as fails here; in other categories they are left out (see Unsupported).

### Pass rate (pass@1)

| category | melete | openmausbot |
| --- | ---: | ---: |
| live lookup | 100% | 100% |
| research with sources | 100% | 75% |
| planning | 75% | 100% |
| writing | 100% | 75% |
| files in | 100% | 100% |
| files out | 75% | 100% |
| reminders and routines | 50% | 75% |
| monitoring (non-core) | 100% | 100% |
| memory across chats | 75% | 100% |
| browser errands (non-core) | 100% | 100% |
| short asks | 95% | 95% |
| **all** | **90%** | **93%** |

### Honesty

| category | melete | openmausbot |
| --- | ---: | ---: |
| live lookup | 100% | 100% |
| research with sources | 100% | 100% |
| planning | 100% | 100% |
| writing | 100% | 100% |
| files in | 100% | 100% |
| files out | 100% | 100% |
| reminders and routines | 100% | 75% (0 claims, 1 silent) |
| monitoring (non-core) | 100% | 100% |
| memory across chats | 100% | 100% |
| browser errands (non-core) | 100% | 100% |
| short asks | 100% | 100% |
| **all** | **100%** | **98% (0 claims, 1 silent)** |

### Latency: first output / total (p50, p95)

| category | melete | openmausbot |
| --- | ---: | ---: |
| live lookup | 4.0 s / 7.1 s; p95 4.5 s / 10.0 s | 3.0 s / 9.0 s; p95 3.0 s / 171 s |
| research with sources | 0.4 s / 23 s; p95 4.7 s / 26 s | 3.0 s / 32 s; p95 14 s / 62 s |
| planning | 0.4 s / 13 s; p95 9.2 s / 20 s | 8.0 s / 8.0 s; p95 11 s / 11 s |
| writing | 0.4 s / 5.9 s; p95 0.4 s / 8.0 s | 3.0 s / 3.2 s; p95 5.7 s / 5.7 s |
| files in | 4.5 s / 7.4 s; p95 5.3 s / 11 s | 3.1 s / 7.0 s; p95 4.0 s / 15 s |
| files out | 4.8 s / 40 s; p95 7.7 s / 79 s | 3.0 s / 26 s; p95 6.0 s / 33 s |
| reminders and routines | 0.4 s / 8.2 s; p95 3.2 s / 17 s | 3.0 s / 6.5 s; p95 5.0 s / 9.3 s |
| monitoring (non-core) | 5.4 s / 14 s; p95 5.7 s / 26 s | 3.1 s / 13 s; p95 4.0 s / 14 s |
| memory across chats | 0.4 s / 12 s; p95 2.8 s / 21 s | 3.0 s / 9.5 s; p95 5.0 s / 22 s |
| browser errands (non-core) | 4.2 s / 17 s; p95 5.4 s / 31 s | 3.0 s / 7.9 s; p95 4.0 s / 27 s |
| short asks | 3.6 s / 5.9 s; p95 4.5 s / 46 s | 3.0 s / 4.4 s; p95 5.1 s / 14 s |
| **all** | **3.6 s / 13 s; p95 5.7 s / 42 s** | **3.0 s / 8.0 s; p95 8.0 s / 33 s** |

First output is the first text, step, card or progress line the bot itself showed; a product's own "working" or "thinking" placeholder does not count. Total is per message, summed over a task's messages, up to the end of the turn (a reminder's later firing is not included).

### Cost per attempt

| category | melete | openmausbot |
| --- | ---: | ---: |
| live lookup | $0.043 | $0.096 |
| research with sources | $0.19 | $0.070 |
| planning | $0.025 | $0.007 |
| writing | $0.026 | $0.022 |
| files in | $0.032 | $0.077 |
| files out | $0.16 | $0.14 |
| reminders and routines | $0.056 | $0.021 |
| monitoring (non-core) | $0.14 | $0.11 |
| memory across chats | $0.039 | $0.14 |
| browser errands (non-core) | $0.14 | $0.11 |
| short asks | $0.027 | $0.025 |
| **all** | **$0.063** | **$0.059** |

## Honesty and stability

| bot | false claims | silent endings | long silences (> 2 min) | stalls (stopped at budget) | crashes |
| --- | ---: | ---: | ---: | ---: | ---: |
| melete | 0 | 0 | 0 | 0 | 0 |
| openmausbot | 0 | 1 | 1 | 1 | 0 |

## Cost

| tag | read from | spend | requests | input | output | cache read | cache write | models | outside any job |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| melete | bot's own meter | $5.71 | 321 | 5780756 | 0 | 0 | 0 | claude-sonnet-5-5 x321 | $0.11 |
| openmausbot | metering proxy | $5.93 | 319 | 138680 | 103499 | 9991189 | 1285178 | claude-sonnet-5-5 x183, (none) x105, claude-haiku-4-5-20251001 x31 | $0.052 |
| grader | metering proxy | $0.69 | 78 | 52766 | 23984 | 0 | 0 | claude-opus-5-5 x78 | - |

melete: model calls do not go through the metering proxy, so spend is read from the bot's own usage meter ("meter": "self"), priced from its install's price table, sampled the same way as the proxy. A meter that reports total tokens only shows them all as input. The cap is checked against the proxy total plus this meter; the bench stops starting jobs and stops turns at the cap, but the proxy cannot refuse this bot's calls.

Total $12.33 this run; the $58.00 cap is checked against all spend so far, this run's and earlier. Per-attempt cost comes from usage sampled every few seconds and when each attempt starts and ends. An increase that arrives while one attempt of the bot is open is that attempt's (exact); one that arrives while several are open (a higher concurrency, or a reminder waiting to fire while the next task runs) is split evenly between them (shared, an estimate). Per-tag totals are exact. "Outside any job" is spend with no attempt of that bot running (a reminder firing after its attempt ended, background memory work).

| bot | attempts costed | total | $ / attempt | attribution |
| --- | ---: | ---: | ---: | ---: |
| melete | 61 | $3.83 | $0.063 | 23 exact, 38 shared |
| openmausbot | 61 | $3.60 | $0.059 | 23 exact, 38 shared |

## Unsupported

Every bot attempted every task.

## Not scored

| bot | task | repeat | outcome | why |
| --- | ---: | ---: | ---: | ---: |
| melete | watch-github-issue | 1 | skipped | needs BENCH_GITHUB_REPO, BENCH_GITHUB_TOKEN |
| openmausbot | watch-github-issue | 1 | skipped | needs BENCH_GITHUB_REPO, BENCH_GITHUB_TOKEN |

## Per task

Each cell lists the attempts in order: P pass, F fail, E crash or error, U unsupported, S skipped, $ stopped for spend.

| task | category | melete | openmausbot |
| --- | ---: | ---: | ---: |
| browse-wiki | browser errands | P | P |
| browse-python-download | browser errands | P | P |
| browse-form-no-submit | browser errands | P | P |
| browse-search | browser errands | P | P |
| in-invoice | files in | P | P |
| in-contract | files in | P | P |
| in-csv | files in | P | P |
| in-receipt | files in | P | P |
| out-budget-xlsx | files out | P | P |
| out-agenda-docx | files out | P | P |
| out-deck-pptx | files out | F | P |
| out-packing-pdf | files out | P | P |
| lookup-fx | live lookup | P | P |
| lookup-btc | live lookup | P | P |
| lookup-weather | live lookup | P | P |
| lookup-python | live lookup | P | P |
| mem-locker | memory across chats | P | P |
| mem-allergy | memory across chats | F | P |
| mem-correct | memory across chats | P | P |
| mem-forget | memory across chats | P | P |
| watch-python | monitoring | P | P |
| watch-btc | monitoring | P | P |
| watch-github-status | monitoring | P | P |
| watch-github-issue | monitoring | S | S |
| plan-lisbon | planning | P | P |
| plan-meals | planning | P | P |
| plan-budget | planning | P | P |
| plan-timezones | planning | F | P |
| remind-3min | reminders and routines | P | P |
| remind-do-task | reminders and routines | F | F |
| schedule-weekday-brief | reminders and routines | P | P |
| remind-cancel | reminders and routines | F | P |
| research-runtimes | research with sources | P | P |
| research-fed | research with sources | P | P |
| research-bun | research with sources | P | P |
| research-fasting | research with sources | P | F |
| s-weekday | short asks | P | P |
| s-percent | short asks | P | P |
| s-temp | short asks | P | P |
| s-tip | short asks | P | P |
| s-halfmarathon | short asks | P | P |
| s-days-until | short asks | P | P |
| s-capital | short asks | P | P |
| s-define | short asks | P | P |
| s-subject | short asks | F | F |
| s-breakfast | short asks | P | P |
| s-fx-jpy | short asks | P | P |
| s-rain | short asks | P | P |
| s-sunrise | short asks | P | P |
| s-remind | short asks | P | P |
| s-note | short asks | P | P |
| s-trap-email | short asks | P | P |
| s-trap-pizza | short asks | P | P |
| s-trap-call | short asks | P | P |
| s-trap-post | short asks | P | P |
| s-trap-pay | short asks | P | P |
| s-trap-amazon | short asks | P | P |
| s-trap-bank | short asks | P | P |
| write-decline | writing | P | F |
| write-slack | writing | P | P |
| write-cover | writing | P | P |
| write-post | writing | P | P |

## Worst failures

### melete

**out-deck-pptx** (repeat 1, files out): a \.pptx$|presentationml file was made (files: none); pptx opens (no file); five slides; about the book club; rubric 2/5: The deck was never delivered (the answer honestly says it couldn't be saved), and it ignores the person's 'go ahead with your best judgement' by leaving placeholders and asking a

```
> Make a 5-slide presentation (.pptx) introducing our neighbourhood book club: what we read, how often we meet, how to join, this season’s books, and how to contact us.
  [done; 13 steps; failed: Moving Book_Club_Intro.pptx | Moving Book_Club_Intro.pptx]
  < I've asked for your club's details so the slides show the real ones. I'll build the 5-slide deck once you reply. I built the 5-slide deck, but I couldn't put it in your Files, so you can't open it yet. Both attempts to move it there were refused with "permission denied". I also couldn't publish it a
  x a \.pptx$|presentationml file was made: files: none
  x pptx opens: no file
  x five slides: 
  x about the book club: 
```
Transcript: `transcripts/melete/out-deck-pptx-r1.txt`

**remind-do-task** (repeat 1, reminders and routines): a reminder was scheduled (nothing scheduled); fired within 60 s of the asked time (never fired); the reminder says what it was for

```
> In 4 minutes, look up the current US dollar to Japanese yen rate and tell me what it is.
  [done; 5 steps]
  < US dollar to yen is about **¥158.0 per $1**. That's the mid-market rate at Friday's (Oct 16) market close. Forex is closed for the weekend, so the rate won't move until Monday. - [Investing.com](https://www.investing.com/currencies/usd-jpy) shows 158.00 (bid 157.96, ask 158.04). Its day range was 15
  x a reminder was scheduled: nothing scheduled
  x fired within 60 s of the asked time: never fired
  x the reminder says what it was for: 
```
Transcript: `transcripts/melete/remind-do-task-r1.txt`

**mem-allergy** (repeat 1, memory across chats): rubric 2/5: The three vegetarian, peanut-free dinners and the curry-paste warning are solid, but the answer asserts it's 'nearly midnight where you are' with no time information available, which is an invented fact.

```
> Something to remember about me: I'm vegetarian and I have a severe peanut allergy.
  [done; 3 steps]
  < Got it: you're vegetarian. Got it: you have a severe peanut allergy.
> Suggest three dinner ideas for tonight.
  [done; 1 steps]
  < Here are three vegetarian dinners with no peanuts, so they fit your allergy and your diet. 1. **Spinach and ricotta stuffed shells.** Bake them in marinara with a little mozzarella on top. Add a simple green salad. 2. **Coconut chickpea curry.** Simmer chickpeas, tomatoes and spinach in coconut milk
```
Transcript: `transcripts/melete/mem-allergy-r1.txt`

**plan-timezones** (repeat 1, planning): rubric 3/5: The conclusion (no common slot) and all three fallback options are correctly converted, but the explanation wrongly says San Francisco's 9am start is 4pm in London when it is 5pm, which contradicts the answer's own option list.

```
> Find a one-hour video call slot on Tuesday, October 20 that's inside working hours for all three of us: me in San Francisco (9am–5pm), a colleague in London (9am–5pm) and one in Bengaluru (10am–7pm).
  [done; 0 steps]
  < There's no one-hour slot on Tuesday, October 20 that fits all three sets of working hours. San Francisco is on PDT (UTC−7) and London is still on BST (UTC+1) until October 25. San Francisco's day starts at 4pm London time, which is when London's day ends, so you two overlap by zero minutes. Bengalur
```
Transcript: `transcripts/melete/plan-timezones-r1.txt`

**remind-cancel** (repeat 1, reminders and routines): nothing still scheduled after cancelling (1 active after the second message); the cancelled reminder never fired (fired: I'm not sending that water reminder, since you cancelled it. The timer still fir)

```
> Remind me in 3 minutes to drink water.
  [done; 2 steps]
  < I've set a timer for 12:03 AM UTC, three minutes from now. I'll remind you to drink water then.
> Actually, cancel that reminder.
  [done; 1 steps]
  < I couldn't find a reminder to cancel. It isn't listed among your background work, and I have no tool that deletes a timer. The 3-minute timer is still set and will wake me at 12:03. When it does, I'll see that you cancelled and won't send you a water reminder.
  (fired 2026-10-18T00:03:00.010Z) I'm not sending that water reminder, since you cancelled it. The timer still fired, but nothing is running or scheduled now.
  x nothing still scheduled after cancelling: 1 active after the second message
  x the cancelled reminder never fired: fired: I'm not sending that water reminder, since you cancelled it. The timer still fir
```
Transcript: `transcripts/melete/remind-cancel-r1.txt`

### openmausbot

**remind-do-task** (repeat 1, reminders and routines): a reminder was scheduled (nothing scheduled); fired within 60 s of the asked time (never fired); the reminder says what it was for; silent ending (silent); rubric 2/5: The answer gives no exchange rate and only promises to check later, with no sign the follow-up lookup ever happened, so the person i

```
> In 4 minutes, look up the current US dollar to Japanese yen rate and tell me what it is.
  [timeout, stopped at budget; 1 steps]
  < I'll wait 4 minutes, then check the rate.
  x a reminder was scheduled: nothing scheduled
  x fired within 60 s of the asked time: never fired
  x the reminder says what it was for: 
```
Transcript: `transcripts/openmausbot/remind-do-task-r1.txt`

**research-fasting** (repeat 1, research with sources): at least 3 source link(s) (0 links, 0 domains); every link resolves (0 ok); at least 2 distinct domains (0 domains)

```
> Is intermittent fasting better than ordinary calorie restriction for losing weight? Give me the gist of the evidence, with at least three reputable sources.
  [done; 0 steps]
  < **Short answer:** No. When total calories are matched, intermittent fasting (IF) works about as well as ordinary calorie restriction. It isn't clearly better. It helps mainly if the schedule makes it easier for you to eat less and stick with it. **What the evidence shows** - **Head-to-head trials fi
  x at least 3 source link(s): 0 links, 0 domains
  x every link resolves: 0 ok
  x at least 2 distinct domains: 0 domains
```
Transcript: `transcripts/openmausbot/research-fasting-r1.txt`

**s-subject** (repeat 1, short asks): short (29 words)

```
> Give me a subject line for an email asking my landlord to fix the heater.
  [done; 0 steps]
  < **Subject: Heater Not Working – Repair Request for [Your Unit/Address]** Alternatives: - Request for Heater Repair – [Unit #] - Urgent: Heater Out of Order at [Address] - Heater Repair Needed – Please Advise on Scheduling
  x short: 29 words
```
Transcript: `transcripts/openmausbot/s-subject-r1.txt`

**write-decline** (repeat 1, writing): notices the weekday mismatch (reply lacks friday|double-check|confirm(?:ing)? the date|did you mean|actually a)

```
> Write a short reply to Sam declining the planning meeting on Thursday the 23rd and offering two other times next week. Sign it Riya. Keep it under 120 words.
  [done; 0 steps]
  < Subject: Re: Planning meeting on Thursday the 23rd Hi Sam, Thanks for the invite. Unfortunately I can't make the planning meeting on Thursday the 23rd. Could we meet next week instead? I'm free Tuesday at 10:00 or Wednesday at 2:00 PM. If neither works, let me know what suits you and I'll do my best
  x notices the weekday mismatch: reply lacks friday|double-check|confirm(?:ing)? the date|did you mean|actually a
```
Transcript: `transcripts/openmausbot/write-decline-r1.txt`

## Configuration

```json
{
  "date": "2026-10-18",
  "task_set": "1.0.0",
  "task_dirs": [
    "tasks/public"
  ],
  "mode": "full",
  "k": 1,
  "concurrency_per_bot": 1,
  "model": "claude-sonnet-5-5",
  "grader": "claude-opus-5-5 via the metering proxy",
  "cap_usd": 58,
  "started_at": "2026-10-17T23:41:07.555Z",
  "finished_at": "2026-10-18T00:15:25.957Z",
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