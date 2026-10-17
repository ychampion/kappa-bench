import type { Kit, Task } from 'agent-bench';

/** Monitoring: answer now, and leave a scheduled check behind that keeps watching. */
export default (k: Kit): Task[] => {
  const WATCH_S = 300;
  const V = k.FAKE_VALUES;
  return [
    {
      id: 'watch-python',
      category: 'monitoring',
      title: 'Watch for a new Python release; latest now',
      budget_s: WATCH_S,
      requires: ['schedule'],
      automation: /python/i,
      steps: [{ text: () => "Keep an eye on python.org and tell me when a new Python version comes out. Checking once a day is fine. What's the latest version right now?" }],
      live: async (s) => ({ py: await s.python_latest() }),
      check: (ev) => {
        const v = (ev.live.py as { version: string }).version;
        return [k.ok('names the current version', new RegExp(`\\b${v.replace(/\./g, '\\.')}\\b`).test(ev.reply), `live ${v}`), k.scheduledCheck(ev, /python/i)];
      },
      fake: () => [
        {
          tools: [k.fake.page('https://www.python.org/downloads/'), k.fake.schedule('a daily check of python.org')],
          reply: `The latest is Python ${V.python_latest.version}. I'll check python.org daily and tell you when a new version lands.`,
          routine: { title: 'Python release watch', time: '09:00', text: 'Daily at 09:00', run_summary: `No new release; latest is still ${V.python_latest.version}.` },
        },
      ],
    },
    {
      id: 'watch-btc',
      category: 'monitoring',
      title: 'Watch the Bitcoin price for a 5% move',
      budget_s: WATCH_S,
      requires: ['schedule'],
      automation: /bitcoin|btc/i,
      steps: [{ text: () => "Watch the Bitcoin price for me today and tell me if it moves more than 5% from where it is now. Checking every hour is fine. What's the price right now?" }],
      live: async (s) => ({ price: await s.btc_usd() }),
      check: (ev) => [k.ok('price matches a live source (±3%)', k.near(ev.reply, ev.live.price as number, 0.03), `live $${(ev.live.price as number).toFixed(0)}`), k.scheduledCheck(ev, /bitcoin|btc/i)],
      fake: () => [
        {
          tools: [k.fake.web('bitcoin price'), k.fake.schedule('an hourly Bitcoin check')],
          reply: `Bitcoin is at $${V.btc_usd.toLocaleString('en-US')}. I'll check hourly today and tell you if it moves 5%.`,
          routine: { title: 'Bitcoin 5% watch', text: 'Every 60 minutes', run_summary: 'Bitcoin is within 5% of the starting price.' },
        },
      ],
    },
    {
      id: 'watch-github-status',
      category: 'monitoring',
      title: 'Watch GitHub status; is it up now',
      budget_s: WATCH_S,
      requires: ['schedule'],
      automation: /github/i,
      steps: [{ text: () => 'Check githubstatus.com every 15 minutes this afternoon and tell me if anything on GitHub goes down. Is everything up right now?' }],
      live: async (s) => ({ st: await s.github_status() }),
      check: (ev) => {
        const st = ev.live.st as { indicator: string; description: string };
        return [
          st.indicator === 'none'
            ? k.replyHas(ev, 'says it is up (it is)', /operational|all (?:systems|good)|no (?:issues|incidents|problems)|everything(?:'s| is) up|up and running/i)
            : k.replyHas(ev, `reports the problem (${st.description})`, /degraded|incident|outage|partial|down|issue/i),
          k.scheduledCheck(ev, /github/i),
        ];
      },
      fake: () => [
        {
          tools: [k.fake.page('https://www.githubstatus.com/'), k.fake.schedule('a GitHub status check every 15 minutes')],
          reply: 'All systems operational right now. I’ll check every 15 minutes this afternoon.',
          routine: { title: 'GitHub status watch', text: 'Every 15 minutes', run_summary: 'All systems operational.' },
        },
      ],
    },
    {
      id: 'watch-github-issue',
      category: 'monitoring',
      title: 'Notice a new issue in the test repo within its interval',
      budget_s: WATCH_S,
      requires: ['schedule'],
      needs_env: ['BENCH_GITHUB_REPO', 'BENCH_GITHUB_TOKEN'],
      vars: () => ({ tag: k.token('BENCH-'), repo: process.env.BENCH_GITHUB_REPO ?? 'bench-org/bench-test' }),
      steps: [
        {
          text: (v) =>
            `Keep an eye on the open issues in https://github.com/${v.repo}: check every 5 minutes for the next half hour and tell me as soon as a new issue appears with "${v.tag}" in its title. For now, just tell me how many open issues it has.`,
        },
      ],
      check: (ev) => [k.scheduledCheck(ev)],
      after: async (ctx, ev) => {
        const before = await ctx.github.openIssues();
        const step = ev.steps[0];
        if (!step?.server_sent_at) return [k.ok('watch set', false, 'the turn never started')];
        const number = await ctx.github.createIssue(`${ctx.vars.tag} monitor check`, 'Opened by the benchmark grader; closed automatically.');
        ctx.vars.issue = String(number);
        const madeAt = Date.now();
        const skew = Date.parse(step.server_sent_at) - step.sent_at;
        const fire = await k.waitForFire(ctx, 'a', step.server_sent_at, madeAt + (5 * 60_000 + 3 * 60_000) * ctx.scale + 2000, (a) => a.includes(ctx.vars.tag as string));
        const latency = fire ? (Date.parse(fire.at) - (madeAt + skew)) / 1000 / ctx.scale : null;
        return [
          k.ok('open issue count was right', new RegExp(`\\b${before}\\b`).test(ev.reply) || (before === 0 && /\b(no|zero)\b/i.test(ev.reply)), `${before} open before the grader's issue`),
          k.ok('noticed the new issue', Boolean(fire), fire ? fire.text.slice(0, 120) : 'nothing it sent named it within 8 min'),
          k.ok('within the 5-minute interval (+60 s)', latency !== null && latency <= 360, latency === null ? '' : `${latency.toFixed(0)} s after it was opened`),
        ];
      },
      cleanup: async (ctx) => {
        if (!ctx.vars.issue) return [];
        await ctx.github.closeIssue(Number(ctx.vars.issue));
        return [`closed test issue #${ctx.vars.issue} in ${ctx.github.repo}`];
      },
      fake: (v) => [
        {
          tools: [k.fake.page(`https://github.com/${v.repo}/issues`), k.fake.schedule('an issue check every 5 minutes')],
          reply: `It has 2 open issues. I'll check every 5 minutes and tell you when "${v.tag}" shows up.`,
          once: { in_s: 300, fire_in_s: 200, title: 'Issue watch', answer: `New issue: "${v.tag} monitor check" was just opened.` },
        },
      ],
    },
  ];
};
