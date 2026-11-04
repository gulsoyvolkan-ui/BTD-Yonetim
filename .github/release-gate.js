'use strict';

const REQUIRED = [
  { name: 'Test', path: '.github/workflows/test.yml' },
  { name: 'Secret Scan', path: '.github/workflows/secret-scan.yml' },
];

const OPEN = new Set(['queued', 'in_progress', 'waiting', 'pending', 'requested']);

function runsForSha(runs, sha) {
  return (runs || []).filter((run) => run && run.head_sha === sha);
}

function latestByPath(runs) {
  const map = new Map();
  for (const run of runs || []) {
    if (!run || !run.path) continue;
    const prev = map.get(run.path);
    if (!prev) {
      map.set(run.path, run);
      continue;
    }
    const prevStamp = prev.created_at || '';
    const stamp = run.created_at || '';
    const prevId = Number(prev.id) || 0;
    const id = Number(run.id) || 0;
    if (stamp > prevStamp || (stamp === prevStamp && id > prevId)) map.set(run.path, run);
  }
  return map;
}

function decide(runs, required = REQUIRED) {
  const map = latestByPath(runs);
  const waiting = [];
  for (const req of required) {
    const run = map.get(req.path);
    if (!run || run.name !== req.name) {
      waiting.push(`${req.name}: missing`);
      continue;
    }
    if (OPEN.has(run.status)) {
      waiting.push(`${req.name}: ${run.status}`);
      continue;
    }
    if (run.status === 'completed' && run.conclusion === 'success') continue;
    const conclusion = run.conclusion || 'missing';
    return { ok: false, wait: false, reason: `${req.name}: ${conclusion}` };
  }
  if (waiting.length) return { ok: false, wait: true, reason: waiting.join('; ') };
  return { ok: true, wait: false, reason: 'Test and Secret Scan succeeded for this SHA' };
}

async function fetchRuns(repository, sha, token) {
  const runs = [];
  for (let page = 1; page <= 5; page += 1) {
    const url = `https://api.github.com/repos/${repository}/actions/runs?head_sha=${encodeURIComponent(sha)}&per_page=100&page=${page}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'btd-release-gate',
      },
    });
    if (!res.ok) {
      throw new Error(`GitHub Actions API HTTP ${res.status}`);
    }
    const body = await res.json();
    const pageRuns = body.workflow_runs || [];
    runs.push(...pageRuns);
    if (pageRuns.length < 100) return runs;
  }
  throw new Error('GitHub Actions run list incomplete');
}

function gateConfig(env) {
  const sha = env.RELEASE_SHA || env.GITHUB_SHA || '';
  const repository = env.RELEASE_REPOSITORY || env.GITHUB_REPOSITORY || '';
  const token = env.GITHUB_TOKEN || env.GH_TOKEN || '';
  if (!sha || !repository || !token) {
    return { ok: false, reason: 'sha, repository, or token missing' };
  }
  return {
    ok: true,
    sha,
    repository,
    token,
    timeoutMs: Number(env.RELEASE_GATE_TIMEOUT_MS || 600000),
    intervalMs: Number(env.RELEASE_GATE_INTERVAL_MS || 10000),
  };
}

async function poll(env, deps) {
  const cfg = gateConfig(env);
  if (!cfg.ok) return { exitCode: 1, reason: cfg.reason };
  const fetchPage = (deps && deps.fetchRuns) || fetchRuns;
  const sleep = (deps && deps.sleep) || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = (deps && deps.now) || Date.now;
  const deadline = now() + cfg.timeoutMs;
  for (;;) {
    let runs;
    try {
      runs = await fetchPage(cfg.repository, cfg.sha, cfg.token);
    } catch (err) {
      return { exitCode: 1, reason: err && err.message ? err.message : 'api error' };
    }
    const decision = decide(runsForSha(runs, cfg.sha));
    if (decision.ok) return { exitCode: 0, reason: decision.reason };
    if (!decision.wait || now() >= deadline) {
      return { exitCode: 1, reason: decision.reason };
    }
    if (deps && deps.onWait) deps.onWait(decision.reason);
    await sleep(cfg.intervalMs);
  }
}

async function main() {
  const result = await poll(process.env);
  if (result.exitCode === 0) {
    console.log(result.reason);
    return;
  }
  console.error(`fail-closed: ${result.reason}`);
  process.exit(result.exitCode);
}

module.exports = { REQUIRED, decide, runsForSha, gateConfig, poll };

if (require.main === module) {
  main().catch((err) => {
    console.error(`fail-closed: ${err && err.message ? err.message : 'gate error'}`);
    process.exit(1);
  });
}
