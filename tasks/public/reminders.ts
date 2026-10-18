import type { Kit, Task } from 'kappa-bench';

/**
 * Reminders and routines: something must run later, on time, and say what it
 * was for. Checked from the bot's scheduled items and what they said when they
 * fired, never from the bot's own word that it set them.
 */
export default (k: Kit): Task[] => {
  const SET_S = 180;
  const due = (ev: Parameters<Task['check']>[0], index: number, seconds: number, scale: number) =>
    Date.parse(ev.steps[index]?.server_sent_at ?? '') + seconds * 1000 * scale;
  return [
    {
      id: 'remind-3min',
      category: 'reminders',
      title: 'Remind me in 3 minutes',
      budget_s: SET_S,
      requires: ['schedule'],
      steps: [{ text: () => 'Remind me in 3 minutes to stretch.' }],
      check: () => [],
      after: (ctx, ev) => k.reminderChecks(ctx, ev, 0, due(ev, 0, 180, ctx.scale), /stretch/i),
      fake: () => [{ tools: [k.fake.schedule('a reminder in 3 minutes')], reply: "Sure, I'll remind you to stretch in 3 minutes.", once: { in_s: 180, fire_in_s: 182, title: 'Stretch', answer: 'Time to stretch!' } }],
    },
    {
      id: 'remind-do-task',
      category: 'reminders',
      title: 'In 4 minutes, look something up and tell me',
      budget_s: SET_S,
      requires: ['schedule'],
      steps: [{ text: () => 'In 4 minutes, look up the current US dollar to Japanese yen rate and tell me what it is.' }],
      check: () => [],
      live: async (s) => ({ jpy: await s.fx_usd_jpy() }),
      after: async (ctx, ev) => {
        const jpy = await ctx.sources.fx_usd_jpy();
        return k.reminderChecks(ctx, ev, 0, due(ev, 0, 240, ctx.scale), (a) => k.near(a, jpy, 0.02) || k.near(a, 1 / jpy, 0.02));
      },
      fake: () => [
        {
          tools: [k.fake.schedule('a check in 4 minutes')],
          reply: "Will do. I'll check the dollar-yen rate in 4 minutes and tell you.",
          once: { in_s: 240, fire_in_s: 243, title: 'USD/JPY check', answer: `1 US dollar is ¥${k.FAKE_VALUES.fx_usd_jpy} right now.` },
        },
      ],
    },
    {
      id: 'schedule-weekday-brief',
      category: 'reminders',
      title: 'A weekday 8:30 weather routine that actually runs',
      budget_s: SET_S,
      requires: ['schedule'],
      automation: /weather|brief|forecast/i,
      steps: [{ text: () => 'Every weekday at 8:30 AM, send me a one-line weather brief for San Francisco.' }],
      check: () => [],
      after: async (ctx, ev) => {
        const routine = ev.scheduled.find((s) => s.kind === 'recurring' && /weather|brief|forecast|san francisco|\bsf\b/i.test(`${s.title} ${s.text}`)) ?? ev.scheduled.find((s) => s.kind === 'recurring');
        if (!routine) return [k.ok('a routine was created', false, `scheduled: ${ev.scheduled.map((s) => s.title).join(', ') || 'none'}`)];
        const when = `${routine.time ?? ''} ${routine.cron ?? ''} ${routine.text}`;
        const weekdays = routine.weekdays ? routine.weekdays.slice().sort().join(',') === '1,2,3,4,5' : /weekday|mon(?:day)?\s*(?:-|–|to|through)\s*fri|1-5|mon.*tue.*wed.*thu.*fri/i.test(when);
        const checks = [
          k.ok('a routine was created', true, `${routine.title} (${routine.text})`),
          k.ok('runs at 8:30', /\b0?8:30\b|^30 8 /.test(when.trim()) || /\b30 0?8\b/.test(routine.cron ?? ''), when.trim()),
          k.ok('on weekdays', weekdays, routine.weekdays ? routine.weekdays.join(',') : when.trim()),
        ];
        if (!routine.can_run_now || !ctx.adapter.runScheduledNow) return [...checks, k.info('a test run', false, 'the bot offers no way to run it now; schedule checked only')];
        const conv = Object.values(ctx.conversations)[0];
        if (!conv) return checks;
        const before = routine.fires.length;
        const startedAt = Date.now();
        await ctx.adapter.runScheduledNow(conv, routine);
        const deadline = Date.now() + 300_000 * ctx.scale + 2000;
        let fire: (typeof routine.fires)[number] | undefined;
        while (Date.now() < deadline) {
          const now = (await ctx.adapter.scheduled(conv)).find((s) => s.id === routine.id);
          fire = now?.fires.slice(before).find((f) => f.status !== 'running');
          if (fire) break;
          await Bun.sleep(Math.max(200, 5000 * ctx.scale));
        }
        return [
          ...checks,
          k.ok('a test run finished', Boolean(fire), fire ? `${fire.status} after ${((Date.now() - startedAt) / 1000 / ctx.scale).toFixed(0)} s` : 'no finished run'),
          k.ok(
            'the run produced a real brief',
            Boolean(fire && !fire.empty && fire.status === 'done' && /\d+\s*°|°f|degrees|sunny|cloud|rain|fog|clear|wind|mild|cool|warm/i.test(fire.text)),
            fire ? `${fire.empty ? 'EMPTY ' : ''}${fire.text.slice(0, 140)}` : '',
          ),
        ];
      },
      fake: () => [
        {
          tools: [k.fake.schedule('routine “SF weather brief”')],
          reply: "Done. Every weekday at 8:30 AM I'll send you a one-line San Francisco weather brief.",
          routine: { title: 'SF weather brief', time: '08:30', weekdays: [1, 2, 3, 4, 5], text: 'Weekdays at 08:30', run_summary: 'San Francisco today: 68°F, fog clearing by noon.' },
        },
      ],
    },
    {
      id: 'remind-cancel',
      category: 'reminders',
      title: 'Set a reminder, cancel it, and it does not fire',
      budget_s: SET_S,
      requires: ['schedule'],
      steps: [{ text: () => 'Remind me in 3 minutes to drink water.' }, { text: () => 'Actually, cancel that reminder.' }],
      check: (ev) => [
        k.ok('it was set first', (ev.steps[0]?.scheduled_after ?? 0) > 0, `${ev.steps[0]?.scheduled_after ?? 'unknown'} active after the first message`),
        k.ok('nothing still scheduled after cancelling', ev.steps[1]?.scheduled_after === 0, `${ev.steps[1]?.scheduled_after ?? 'unknown'} active after the second message`),
      ],
      after: async (ctx, ev) => {
        const first = ev.steps[0];
        if (!first?.server_sent_at) return [k.ok('reminder set', false, 'the turn never started')];
        const dueAt = Date.parse(first.server_sent_at) + 180_000 * ctx.scale;
        const skew = Date.parse(first.server_sent_at) - first.sent_at;
        const fire = await k.waitForFire(ctx, 'a', ev.steps[1]?.server_sent_at ?? first.server_sent_at, dueAt - skew + 75_000 * ctx.scale + 2000, (a) => /water/i.test(a));
        return [k.ok('the cancelled reminder never fired', !fire, fire ? `fired: ${fire.text.slice(0, 80)}` : 'quiet past the due time')];
      },
      fake: () => [
        { tools: [k.fake.schedule('a reminder in 3 minutes')], reply: "I'll remind you to drink water in 3 minutes.", once: { in_s: 180, title: 'Drink water', answer: 'Drink some water!' } },
        { tools: [{ kind: 'schedule', title: 'Cancelled the reminder' }], reply: 'Cancelled, no reminder.', cancel: true },
      ],
    },
  ];
};
