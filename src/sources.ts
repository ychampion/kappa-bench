/**
 * Live sources the graders read at grading time, so a fact is checked against
 * the world as it is now rather than a value frozen in the task. All are free,
 * keyless public endpoints. A dry run swaps in FAKE_SOURCES and touches none.
 */

export type Sources = {
  fx_usd_eur: () => Promise<number>;
  fx_usd_jpy: () => Promise<number>;
  btc_usd: () => Promise<number>;
  /** Tomorrow's high in °F and precipitation probability % for a city. */
  weather: (city: keyof typeof CITIES) => Promise<{ high_f: number; low_f: number; rain_pct: number; day: string }>;
  sunrise: (city: keyof typeof CITIES) => Promise<{ day: string; time: string }>;
  python_latest: () => Promise<{ version: string; date: string }>;
  node_lts: () => Promise<{ version: string; cycle: string }>;
  go_latest: () => Promise<{ version: string }>;
  quake_day: () => Promise<{ mag: number; place: string; count45: number } | null>;
  fed_funds_upper: () => Promise<{ value: number; date: string }>;
  github_release: (repo: string) => Promise<{ tag: string; published: string; recent: string[] }>;
  github_stars: (repo: string) => Promise<number>;
  github_status: () => Promise<{ indicator: string; description: string }>;
  wikipedia_tfa: (day: string) => Promise<{ title: string } | null>;
  /** M4.5+ earthquakes in the USGS week or month feed: count and the biggest. */
  quakes: (window: 'week' | 'month') => Promise<{ count: number; mag: number; place: string }>;
  /** Newest observation of a FRED series, read from its public CSV. */
  fred: (series: string) => Promise<{ value: number; date: string }>;
  /** Supported release cycles of a product, from endoflife.date. */
  eol_cycles: (product: string) => Promise<{ cycle: string; latest: string; eol: string | boolean; lts: boolean }[]>;
  /** A GitHub repo's license id, stars, default branch and open issue count. */
  github_repo: (repo: string) => Promise<{ license: string; stars: number; branch: string; open_issues: number }>;
  /** Whether a link answers (2xx/3xx, or 401/403/429 from a page that exists but guards itself). */
  link_ok: (url: string) => Promise<boolean>;
};

export const CITIES = {
  'San Francisco': { lat: 37.7749, lon: -122.4194, tz: 'America/Los_Angeles' },
  Seattle: { lat: 47.6062, lon: -122.3321, tz: 'America/Los_Angeles' },
  Paris: { lat: 48.8566, lon: 2.3522, tz: 'Europe/Paris' },
  Chicago: { lat: 41.8781, lon: -87.6298, tz: 'America/Chicago' },
  Denver: { lat: 39.7392, lon: -104.9903, tz: 'America/Denver' },
} as const;

const UA = { 'user-agent': 'kappa-bench/0.1 (grader; read-only)' };
async function json<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const response = await fetch(url, { headers: { ...UA, accept: 'application/json', ...headers }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`${response.status} from ${new URL(url).host}`);
  return (await response.json()) as T;
}
const gh = (): Record<string, string> =>
  process.env.BENCH_GITHUB_TOKEN ? { authorization: `Bearer ${process.env.BENCH_GITHUB_TOKEN}` } : {};

/** Newest version from endoflife.date for a product. */
async function eol(product: string) {
  return json<{ cycle: string; latest: string; latestReleaseDate: string; lts: boolean | string; eol: boolean | string }[]>(
    `https://endoflife.date/api/${product}.json`,
  );
}

export const LIVE_SOURCES: Sources = {
  fx_usd_eur: async () => (await json<{ rates: { EUR: number } }>('https://api.frankfurter.app/latest?from=USD&to=EUR')).rates.EUR,
  fx_usd_jpy: async () => (await json<{ rates: { JPY: number } }>('https://api.frankfurter.app/latest?from=USD&to=JPY')).rates.JPY,
  btc_usd: async () => Number((await json<{ data: { amount: string } }>('https://api.coinbase.com/v2/prices/BTC-USD/spot')).data.amount),
  weather: async (city) => {
    const c = CITIES[city];
    const data = await json<{
      daily: { time: string[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: number[] };
    }>(
      `https://api.open-meteo.com/v1/forecast?latitude=${c.lat}&longitude=${c.lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&temperature_unit=fahrenheit&timezone=${encodeURIComponent(c.tz)}&forecast_days=2`,
    );
    return {
      day: data.daily.time[1] as string,
      high_f: data.daily.temperature_2m_max[1] as number,
      low_f: data.daily.temperature_2m_min[1] as number,
      rain_pct: data.daily.precipitation_probability_max[1] as number,
    };
  },
  sunrise: async (city) => {
    const c = CITIES[city];
    const data = await json<{ daily: { time: string[]; sunrise: string[] } }>(
      `https://api.open-meteo.com/v1/forecast?latitude=${c.lat}&longitude=${c.lon}&daily=sunrise&timezone=${encodeURIComponent(c.tz)}&forecast_days=2`,
    );
    return { day: data.daily.time[1] as string, time: (data.daily.sunrise[1] as string).slice(11, 16) };
  },
  python_latest: async () => {
    const cycles = await eol('python');
    const newest = cycles[0] as { latest: string; latestReleaseDate: string };
    return { version: newest.latest, date: newest.latestReleaseDate };
  },
  node_lts: async () => {
    const cycles = await eol('nodejs');
    const lts = cycles.find((c) => c.lts && c.eol !== true && (typeof c.eol !== 'string' || Date.parse(c.eol) > Date.now())) ?? cycles[0];
    return { version: (lts as { latest: string }).latest, cycle: (lts as { cycle: string }).cycle };
  },
  go_latest: async () => ({ version: ((await eol('go'))[0] as { latest: string }).latest }),
  quake_day: async () => {
    const data = await json<{ features: { properties: { mag: number; place: string } }[] }>(
      'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson',
    );
    if (!data.features.length) return null;
    const top = [...data.features].sort((a, b) => b.properties.mag - a.properties.mag)[0] as { properties: { mag: number; place: string } };
    return { mag: top.properties.mag, place: top.properties.place, count45: data.features.length };
  },
  fed_funds_upper: async () => {
    // FRED stalls requests that carry an unfamiliar user agent, so this one goes without.
    const response = await fetch('https://fred.stlouisfed.org/graph/fredgraph.csv?id=DFEDTARU', { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`${response.status} from fred`);
    const rows = (await response.text()).trim().split('\n').slice(1).filter((r) => !r.endsWith(','));
    const last = (rows.at(-1) as string).split(',');
    return { date: last[0] as string, value: Number(last[1]) };
  },
  github_release: async (repo) => {
    const releases = await json<{ tag_name: string; published_at: string; draft: boolean; prerelease: boolean }[]>(
      `https://api.github.com/repos/${repo}/releases?per_page=10`,
      gh(),
    );
    const stable = releases.filter((r) => !r.draft && !r.prerelease);
    return { tag: stable[0]?.tag_name ?? '', published: stable[0]?.published_at ?? '', recent: stable.slice(0, 3).map((r) => r.tag_name) };
  },
  github_stars: async (repo) => (await json<{ stargazers_count: number }>(`https://api.github.com/repos/${repo}`, gh())).stargazers_count,
  github_status: async () => {
    const data = await json<{ status: { indicator: string; description: string } }>('https://www.githubstatus.com/api/v2/status.json');
    return data.status;
  },
  wikipedia_tfa: async (day) => {
    const [y, m, d] = day.split('-');
    const data = await json<{ tfa?: { titles?: { normalized?: string } } }>(
      `https://en.wikipedia.org/api/rest_v1/feed/featured/${y}/${m}/${d}`,
    );
    return data.tfa?.titles?.normalized ? { title: data.tfa.titles.normalized } : null;
  },
  quakes: async (window) => {
    const data = await json<{ features: { properties: { mag: number; place: string } }[] }>(
      `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_${window}.geojson`,
    );
    const top = [...data.features].sort((a, b) => b.properties.mag - a.properties.mag)[0];
    return { count: data.features.length, mag: top?.properties.mag ?? 0, place: top?.properties.place ?? '' };
  },
  fred: async (series) => {
    const response = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(series)}`, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`${response.status} from fred`);
    const rows = (await response.text()).trim().split('\n').slice(1).filter((r) => !/,\.?$/.test(r.trim()));
    const last = (rows.at(-1) as string).trim().split(',');
    return { date: last[0] as string, value: Number(last[1]) };
  },
  eol_cycles: async (product) => {
    const now = Date.now();
    const cycles = await eol(product);
    return cycles
      .filter((c) => c.eol === false || (typeof c.eol === 'string' && Date.parse(c.eol) > now))
      .map((c) => ({ cycle: c.cycle, latest: c.latest, eol: c.eol, lts: Boolean(c.lts) }));
  },
  github_repo: async (repo) => {
    const r = await json<{ license: { spdx_id: string } | null; stargazers_count: number; default_branch: string; open_issues_count: number }>(`https://api.github.com/repos/${repo}`, gh());
    return { license: r.license?.spdx_id ?? 'none', stars: r.stargazers_count, branch: r.default_branch, open_issues: r.open_issues_count };
  },
  link_ok: async (url) => {
    const get = (method: string, ms: number) => fetch(url, { method, redirect: 'follow', headers: UA, signal: AbortSignal.timeout(ms) });
    const slow = (error: unknown) => ['TimeoutError', 'AbortError'].includes((error as Error)?.name);
    try {
      let response = await get('HEAD', 15_000);
      if (response.status === 405 || response.status === 404) response = await get('GET', 15_000);
      return response.status < 400 || [401, 403, 429].includes(response.status);
    } catch (error) {
      // A slow site is not a made-up link: retry once, and only a definite failure (no such host, refused) counts.
      if (!slow(error)) return false;
      try {
        const response = await get('GET', 30_000);
        return response.status < 400 || [401, 403, 429].includes(response.status);
      } catch (again) {
        return slow(again);
      }
    }
  },
};

/** Fixed values for the dry run; the fake bot's scripted replies use the same ones. */
export const FAKE_VALUES = {
  fx_usd_eur: 0.9213,
  fx_usd_jpy: 149.62,
  btc_usd: 61234.5,
  weather: { day: '2026-10-14', high_f: 68, low_f: 54, rain_pct: 20 },
  sunrise: { day: '2026-10-14', time: '07:58' },
  python_latest: { version: '3.15.0', date: '2026-10-09' },
  node_lts: { version: '24.9.0', cycle: '24' },
  go_latest: { version: '1.27.2' },
  quake_day: { mag: 6.1, place: '120 km S of Kokopo, Papua New Guinea', count45: 9 },
  fed_funds_upper: { value: 4.25, date: '2026-10-12' },
  github_release: { tag: 'bun-v1.3.13', published: '2026-10-01T00:00:00Z', recent: ['bun-v1.3.13', 'bun-v1.3.12', 'bun-v1.3.11'] },
  github_stars: { 'oven-sh/bun': 81234, 'denoland/deno': 104567 } as Record<string, number>,
  github_status: { indicator: 'none', description: 'All Systems Operational' },
  wikipedia_tfa: { title: 'Ada Lovelace' },
  fred: { DGS10: { value: 4.12, date: '2026-10-09' }, DFEDTARU: { value: 4.25, date: '2026-10-12' }, DGS2: { value: 3.95, date: '2026-10-09' } } as Record<string, { value: number; date: string }>,
  eol_cycles: {
    python: [{ cycle: '3.15', latest: '3.15.0', eol: '2031-10-31', lts: false }, { cycle: '3.10', latest: '3.10.19', eol: '2026-10-31', lts: false }],
    nodejs: [{ cycle: '26', latest: '26.1.0', eol: '2029-04-30', lts: false }, { cycle: '24', latest: '24.9.0', eol: '2028-04-30', lts: true }, { cycle: '22', latest: '22.20.0', eol: '2027-04-30', lts: true }],
    go: [{ cycle: '1.27', latest: '1.27.2', eol: false, lts: false }, { cycle: '1.26', latest: '1.26.8', eol: false, lts: false }],
    postgresql: [{ cycle: '18', latest: '18.1', eol: '2030-11-14', lts: false }, { cycle: '14', latest: '14.20', eol: '2026-11-12', lts: false }],
  } as Record<string, { cycle: string; latest: string; eol: string | boolean; lts: boolean }[]>,
  quakes: { week: { count: 31, mag: 6.4, place: '95 km SSE of Hihifo, Tonga' }, month: { count: 142, mag: 7.1, place: 'Kermadec Islands, New Zealand' } } as Record<string, { count: number; mag: number; place: string }>,
  github_repo: { license: 'MIT', stars: 81234, branch: 'main', open_issues: 4321 },
};

export const FAKE_SOURCES: Sources = {
  fx_usd_eur: async () => FAKE_VALUES.fx_usd_eur,
  fx_usd_jpy: async () => FAKE_VALUES.fx_usd_jpy,
  btc_usd: async () => FAKE_VALUES.btc_usd,
  weather: async () => FAKE_VALUES.weather,
  sunrise: async () => FAKE_VALUES.sunrise,
  python_latest: async () => FAKE_VALUES.python_latest,
  node_lts: async () => FAKE_VALUES.node_lts,
  go_latest: async () => FAKE_VALUES.go_latest,
  quake_day: async () => FAKE_VALUES.quake_day,
  fed_funds_upper: async () => FAKE_VALUES.fed_funds_upper,
  github_release: async () => FAKE_VALUES.github_release,
  github_stars: async (repo) => FAKE_VALUES.github_stars[repo] ?? 1000,
  github_status: async () => FAKE_VALUES.github_status,
  wikipedia_tfa: async () => FAKE_VALUES.wikipedia_tfa,
  quakes: async (window) => FAKE_VALUES.quakes[window] as { count: number; mag: number; place: string },
  fred: async (series) => FAKE_VALUES.fred[series] ?? { value: 1, date: '2026-10-01' },
  eol_cycles: async (product) => FAKE_VALUES.eol_cycles[product] ?? [],
  github_repo: async () => FAKE_VALUES.github_repo,
  link_ok: async (url) => !/broken|nonexistent/.test(url),
};
