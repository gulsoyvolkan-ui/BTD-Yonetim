'use strict';

const assert = require('assert');
const { spawnSync } = require('child_process');
const path = require('path');
const { decide, poll, runsForSha } = require('./release-gate');

let calls = 0;
function ok(cond, msg) {
  assert.ok(cond, msg);
  calls += 1;
}

function run(name, workflowPath, status, conclusion, extra) {
  return Object.assign({
    name,
    path: workflowPath,
    status,
    conclusion,
    head_sha: 'abc',
    created_at: '2026-11-04T00:00:00Z',
    id: 1,
  }, extra || {});
}

const testPath = '.github/workflows/test.yml';
const scanPath = '.github/workflows/secret-scan.yml';

function main() {
  const success = decide([
    run('Test', testPath, 'completed', 'success', { id: 2 }),
    run('Secret Scan', scanPath, 'completed', 'success', { id: 3 }),
  ]);
  ok(success.ok === true && success.wait === false, 'both successes open the gate');

  const failed = decide([
    run('Test', testPath, 'completed', 'success'),
    run('Secret Scan', scanPath, 'completed', 'failure'),
  ]);
  ok(failed.ok === false && failed.wait === false && failed.reason === 'Secret Scan: failure', 'failure is fail-closed');

  const cancelled = decide([
    run('Test', testPath, 'completed', 'cancelled'),
    run('Secret Scan', scanPath, 'completed', 'success'),
  ]);
  ok(cancelled.ok === false && cancelled.wait === false && cancelled.reason === 'Test: cancelled', 'cancel is fail-closed');

  const missing = decide([
    run('Secret Scan', scanPath, 'completed', 'success'),
  ]);
  ok(missing.ok === false && missing.wait === true && missing.reason.indexOf('Test: missing') !== -1, 'missing result waits, then the caller times out closed');

  const pending = decide([
    run('Test', testPath, 'in_progress', null),
    run('Secret Scan', scanPath, 'queued', null),
  ]);
  ok(pending.wait === true && pending.ok === false, 'queued and in-progress wait');

  const failedWhileOtherRuns = decide([
    run('Test', testPath, 'completed', 'failure'),
    run('Secret Scan', scanPath, 'in_progress', null),
  ]);
  ok(failedWhileOtherRuns.wait === false && failedWhileOtherRuns.reason === 'Test: failure', 'a terminal failure does not wait');

  const skipped = decide([
    run('Test', testPath, 'completed', 'skipped'),
    run('Secret Scan', scanPath, 'completed', 'success'),
  ]);
  ok(skipped.wait === false && skipped.reason === 'Test: skipped', 'skipped is fail-closed');

  const timedOut = decide([
    run('Test', testPath, 'completed', 'timed_out'),
    run('Secret Scan', scanPath, 'completed', 'startup_failure'),
  ]);
  ok(timedOut.wait === false && timedOut.reason === 'Test: timed_out', 'timeout and startup failure are fail-closed');

  const renamed = decide([
    run('Other', testPath, 'completed', 'success'),
    run('Secret Scan', scanPath, 'completed', 'success'),
  ]);
  ok(renamed.wait === true && renamed.reason.indexOf('Test: missing') !== -1, 'name and path must both match');

  const newer = decide([
    run('Test', testPath, 'completed', 'failure', { id: 1, created_at: '2026-11-04T00:00:00Z' }),
    run('Test', testPath, 'completed', 'success', { id: 2, created_at: '2026-11-04T00:05:00Z' }),
    run('Secret Scan', scanPath, 'completed', 'success', { id: 3 }),
  ]);
  ok(newer.ok === true, 'a later success replaces an older failure for the same SHA');

  const wrongSha = runsForSha([
    run('Test', testPath, 'completed', 'success', { head_sha: 'other' }),
    run('Test', testPath, 'completed', 'success', { head_sha: 'abc' }),
    run('Secret Scan', scanPath, 'completed', 'success', { head_sha: 'abc' }),
  ], 'abc');
  ok(decide(wrongSha).ok === true, 'another SHA does not count');
  ok(decide(runsForSha([
    run('Test', testPath, 'completed', 'success', { head_sha: 'other' }),
    run('Secret Scan', scanPath, 'completed', 'success', { head_sha: 'other' }),
  ], 'abc')).wait === true, 'success on a different SHA is missing');

  const currentMain = decide(runsForSha([
    { name: 'Secret Scan', path: scanPath, status: 'completed', conclusion: 'failure', head_sha: 'b3ceea693b518697b5328e4b92e4e9554e420ce1', created_at: '2026-10-31T19:12:12Z', id: 10 },
    { name: 'Deploy Vercel', path: '.github/workflows/deploy-vercel.yml', status: 'completed', conclusion: 'success', head_sha: 'b3ceea693b518697b5328e4b92e4e9554e420ce1', created_at: '2026-10-31T19:12:12Z', id: 11 },
  ], 'b3ceea693b518697b5328e4b92e4e9554e420ce1'));
  ok(currentMain.ok === false && currentMain.wait === false && currentMain.reason === 'Secret Scan: failure', 'current main SHA stays closed');

  return poll(
    { RELEASE_SHA: 'abc', RELEASE_REPOSITORY: 'gulsoyvolkan-ui/BTD-Yonetim', GITHUB_TOKEN: 'test-token', RELEASE_GATE_TIMEOUT_MS: '0', RELEASE_GATE_INTERVAL_MS: '1' },
    {
      now: () => 1000,
      sleep: async () => {},
      fetchRuns: async () => {
        throw new Error('GitHub Actions API HTTP 403');
      },
    }
  ).then((denied) => {
    ok(denied.exitCode === 1 && denied.reason === 'GitHub Actions API HTTP 403', 'API 403 is fail-closed');
    return poll(
      { RELEASE_SHA: 'abc', RELEASE_REPOSITORY: 'gulsoyvolkan-ui/BTD-Yonetim', GITHUB_TOKEN: 'test-token', RELEASE_GATE_TIMEOUT_MS: '5000', RELEASE_GATE_INTERVAL_MS: '1' },
      {
        now: (() => {
          let n = 0;
          return () => {
            n += 1;
            return n === 1 ? 0 : 10000;
          };
        })(),
        sleep: async () => {},
        fetchRuns: async () => [
          run('Secret Scan', scanPath, 'completed', 'success'),
        ],
      }
    );
  }).then((timedOut) => {
    ok(timedOut.exitCode === 1 && timedOut.reason.indexOf('Test: missing') !== -1, 'timeout on a missing result is fail-closed');
    const childEnv = Object.assign({}, process.env);
    delete childEnv.GITHUB_TOKEN;
    delete childEnv.GH_TOKEN;
    delete childEnv.GITHUB_SHA;
    delete childEnv.RELEASE_SHA;
    delete childEnv.GITHUB_REPOSITORY;
    delete childEnv.RELEASE_REPOSITORY;
    const child = spawnSync(process.execPath, [path.join(__dirname, 'release-gate.js')], {
      env: childEnv,
      encoding: 'utf8',
    });
    ok(child.status === 1, 'missing token exits fail-closed without a deploy');
    ok((child.stderr || '').indexOf('token missing') !== -1, 'missing token reason is printed');
    console.log(`release-gate: ${calls} passed`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
