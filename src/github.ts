/**
 * The grader's own GitHub hands, for the one task that needs a real change to
 * notice. Every write goes to BENCH_GITHUB_REPO and nowhere else: the
 * repository is read from the environment here, never passed in.
 */
export type GitHub = {
  repo: string | null;
  openIssues: () => Promise<number>;
  createIssue: (title: string, body: string) => Promise<number>;
  closeIssue: (number: number) => Promise<void>;
};

export function liveGitHub(env: Record<string, string | undefined>): GitHub {
  const repo = env.BENCH_GITHUB_REPO ?? null;
  const tokenValue = env.BENCH_GITHUB_TOKEN;
  if (repo && !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('BENCH_GITHUB_REPO must be <account>/<repo>');
  const call = async (method: string, path: string, body?: unknown) => {
    if (!repo || !tokenValue) throw new Error('GitHub test repo not configured');
    const response = await fetch(`https://api.github.com/repos/${repo}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${tokenValue}`,
        accept: 'application/vnd.github+json',
        'user-agent': 'agent-bench',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`GitHub ${response.status} on ${path}`);
    return response.json() as Promise<Record<string, unknown>>;
  };
  return {
    repo,
    openIssues: async () => Number((await call('GET', ''))['open_issues_count'] ?? 0),
    createIssue: async (title, body) => Number((await call('POST', '/issues', { title, body }))['number']),
    closeIssue: async (number) => {
      await call('PATCH', `/issues/${number}`, { state: 'closed' });
    },
  };
}

export function fakeGitHub(): GitHub & { created: string[] } {
  const created: string[] = [];
  return {
    repo: 'bench-org/bench-test',
    created,
    openIssues: async () => 2,
    createIssue: async (title) => {
      created.push(title);
      return 100 + created.length;
    },
    closeIssue: async () => undefined,
  };
}
