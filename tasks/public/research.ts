import type { Kit, Task } from 'agent-bench';

/** Research with sources: several facts, each checked live, with links that must resolve. */
export default (k: Kit): Task[] => {
  const RESEARCH_S = 900;
  /** A version on its own, written plain or as a tag ("1.4.3", "v1.4.3", "bun-v1.4.3"), never inside a longer one. */
  const versionRe = (v: string) => new RegExp(`(?<![\\d.])${v.replace(/\./g, '\\.')}(?!\\d|\\.\\d)`);
  const V = k.FAKE_VALUES;
  return [
    {
      id: 'research-runtimes',
      category: 'research',
      title: 'Current Node.js LTS, Python and Go versions with sources',
      budget_s: RESEARCH_S,
      steps: [{ text: () => 'Which versions are current right now for Node.js (the active LTS line), Python and Go? Give each with its release date and a source link.' }],
      live: async (s) => ({ node: await s.node_lts(), py: await s.python_latest(), go: await s.go_latest() }),
      check: async (ev, ctx) => {
        const node = ev.live.node as { version: string; cycle: string };
        const py = ev.live.py as { version: string };
        const go = ev.live.go as { version: string };
        return [
          k.ok('Node.js LTS version', versionRe(node.version).test(ev.reply) || new RegExp(`\\bv?${node.cycle}\\b`).test(ev.reply), `live ${node.version}`),
          k.ok('Python version', versionRe(py.version).test(ev.reply), `live ${py.version}`),
          k.ok('Go version', versionRe(go.version).test(ev.reply), `live ${go.version}`),
          ...(await k.linksResolve(ev, ctx.sources, 2)),
        ];
      },
      fake: () => [
        {
          tools: [k.fake.web('node.js lts version'), k.fake.page('https://nodejs.org/en/about/previous-releases'), k.fake.page('https://www.python.org/downloads/'), k.fake.page('https://go.dev/doc/devel/release')],
          reply: `- Node.js ${V.node_lts.version} (LTS ${V.node_lts.cycle}), Sept 2026: https://nodejs.org/en/about/previous-releases\n- Python ${V.python_latest.version}, Oct 9, 2026: https://www.python.org/downloads/\n- Go ${V.go_latest.version}, Oct 2026: https://go.dev/doc/devel/release`,
        },
      ],
    },
    {
      id: 'research-fed',
      category: 'research',
      title: 'Fed funds target range and when it last changed',
      budget_s: RESEARCH_S,
      steps: [{ text: () => "What is the Federal Reserve's current target range for the federal funds rate, and when did it last change? Cite your sources." }],
      live: async (s) => ({ fed: await s.fed_funds_upper() }),
      check: async (ev, ctx) => {
        const upper = (ev.live.fed as { value: number }).value;
        const lower = upper - 0.25;
        const nums = k.numbersIn(ev.reply);
        const has = (n: number) => nums.some((x) => Math.abs(x - n) < 0.001);
        return [k.ok('names the current range', has(lower) && has(upper), `live ${lower.toFixed(2)}%–${upper.toFixed(2)}%`), ...(await k.linksResolve(ev, ctx.sources, 1))];
      },
      fake: () => [
        {
          tools: [k.fake.web('federal funds target range'), k.fake.page('https://www.federalreserve.gov/monetarypolicy/openmarket.htm')],
          reply: `The target range is ${(V.fed_funds_upper.value - 0.25).toFixed(2)}%–${V.fed_funds_upper.value.toFixed(2)}%, last changed at the September 2026 FOMC meeting. Source: https://www.federalreserve.gov/monetarypolicy/openmarket.htm`,
        },
      ],
    },
    {
      id: 'research-bun',
      category: 'research',
      title: 'Three latest Bun releases, one change each',
      budget_s: RESEARCH_S,
      steps: [{ text: () => "What are the three most recent stable releases of Bun (the JavaScript runtime), and what's one notable change in each? Link the release notes." }],
      live: async (s) => ({ rel: await s.github_release('oven-sh/bun') }),
      check: async (ev, ctx) => {
        const recent = (ev.live.rel as { recent: string[] }).recent.map((t) => t.replace(/^bun-v/, '').replace(/^v/, ''));
        const named = recent.filter((v) => versionRe(v).test(ev.reply));
        return [k.ok('names the recent releases', named.length >= 2, `named ${named.join(', ') || 'none'} of ${recent.join(', ')}`), ...(await k.linksResolve(ev, ctx.sources, 1))];
      },
      fake: () => [
        {
          tools: [k.fake.page('https://github.com/oven-sh/bun/releases')],
          reply: V.github_release.recent.map((t) => `- Bun ${t.replace('bun-v', '')}: faster installs. https://bun.com/blog/${t}`).join('\n'),
        },
      ],
    },
    {
      id: 'research-fasting',
      category: 'research',
      title: 'Intermittent fasting vs calorie restriction, with sources',
      budget_s: RESEARCH_S,
      steps: [{ text: () => 'Is intermittent fasting better than ordinary calorie restriction for losing weight? Give me the gist of the evidence, with at least three reputable sources.' }],
      rubric:
        'Gives the gist of current evidence: in trials, intermittent fasting and continuous calorie restriction lead to similar weight loss; mentions any nuance (adherence, who it suits). At least three reputable sources (journals, NIH/NHS/Harvard, major reviews). Friendly, to the point, no medical overreach.',
      rubric_min: 4,
      check: async (ev, ctx) => {
        const domains = new Set((ev.reply.match(/https?:\/\/([^/\s)]+)/g) ?? []).map((u) => u.replace(/^https?:\/\/(www\.)?/, '')));
        return [...(await k.linksResolve(ev, ctx.sources, 3)), k.ok('at least 2 distinct domains', domains.size >= 2, `${domains.size} domains`)];
      },
      fake: () => [
        {
          tools: [k.fake.web('intermittent fasting vs calorie restriction meta-analysis')],
          reply:
            'Short version: about the same. Trials comparing them find similar weight loss when calories are matched; fasting mainly helps people who find it easier to stick to.\n- https://www.nejm.org/doi/full/10.1056/NEJMoa2114833\n- https://www.health.harvard.edu/blog/intermittent-fasting-surprising-update-2018062914156\n- https://www.nhs.uk/live-well/healthy-weight/',
        },
      ],
    },
  ];
};
