import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const FIXTURE = path.resolve('tests/helpers/local-stage/v2-preparation-fixture.ts');
const CLI = path.resolve('src/bootstrap/development/closeout/verification-session-cli.ts');
function scenario(name: string) {
  const parent = mkdtempSync(path.join(tmpdir(), 'sec-v2-stage-'));
  const root = path.join(parent, 'workspace'), state = path.join(parent, 'state'), cache = path.join(parent, 'cache');
  mkdirSync(root);
  const env = { ...process.env, SEC_STATE_HOME: state, SEC_CACHE_HOME: cache };
  try {
    const result = spawnSync(process.execPath, [FIXTURE, name, root], { cwd: root, encoding: 'utf8', env,
      timeout: 15_000, maxBuffer: 1024 * 1024 });
    expect(result.status).toBe(0);
    return JSON.parse(result.stdout);
  } finally { rmSync(parent, { recursive: true, force: true }); }
}

test('public V2 prepare emits input while main health and native execution remain entirely uncalled', () => {
  const observed = scenario('prepare');
  expect(observed.failure).toBeNull();
  expect(observed.result).toMatchObject({ status: 'LOCAL_PREPARED', stage: 'preparation-only',
    qualification: 'not-run', unresolvedRequirements: ['native-runtime-content-not-accepted'],
    sourceQualification: 'not-run', integrationAuthorization: 'not-issued' });
  expect(observed.result.request.schema).toBe('sec-verification-session-local-preparation-v2');
  expect(observed.result.sessionRevision).toBeUndefined();
  expect(observed.counters).toMatchObject({ source: 0, native: 0, healthObservation: 0 });
  expect(observed.stateCreated).toBe(false); expect(observed.cacheCreated).toBe(false);
});

test('V2 explicit execution reports missing frozen native content without creating state or trying another backend', () => {
  const observed = scenario('verify-unresolved');
  expect(observed.failure).toBeNull();
  expect(observed.result).toMatchObject({ status: 'LOCAL_QUALIFICATION_UNAVAILABLE', stage: 'qualification-not-started',
    reason: 'native-runtime-content-not-accepted', executionStarted: false, integrationAuthorization: 'not-issued' });
  expect(observed.counters).toMatchObject({ source: 0, native: 0, healthObservation: 0 });
  expect(observed.stateCreated).toBe(false); expect(observed.cacheCreated).toBe(false);
});

for (const name of ['actor-drift', 'metadata-drift', 'forged-content', 'cancelled']) {
  test(`V2 ${name} cannot advance into qualification, source execution or operation state`, () => {
    const observed = scenario(name);
    expect(observed.failure).not.toBeNull();
    if (name === 'cancelled') expect(observed.failure).toBe('CANCELLED_PROVIDER_READ');
    expect(observed.counters).toMatchObject({ source: 0, native: 0, healthObservation: 0 });
    expect(observed.stateCreated).toBe(false); expect(observed.cacheCreated).toBe(false);
  });
}

test('real CLI status/resume accept V2 read-only and explicit hosted readers reject it before state', () => {
  const request = scenario('prepare').result.request;
  const parent = mkdtempSync(path.join(tmpdir(), 'sec-v2-cli-'));
  const root = path.join(parent, 'workspace'), state = path.join(parent, 'state'), cache = path.join(parent, 'cache');
  mkdirSync(root);
  const file = path.join(root, 'request.json'); writeFileSync(file, JSON.stringify(request));
  const env = { ...process.env, SEC_STATE_HOME: state, SEC_CACHE_HOME: cache };
  try {
    for (const command of ['status', 'resume']) {
      const read = spawnSync(process.execPath, [CLI, command, '--request', file], { cwd: root, encoding: 'utf8', env,
        timeout: 15_000, maxBuffer: 1024 * 1024 });
      expect(read.status).toBe(0);
      expect(JSON.parse(read.stdout)).toMatchObject({ stage: 'read-only-projection', sessionRevision: null,
        currentSubject: 'not-observed', executionStarted: false });
      const hosted = spawnSync(process.execPath, [CLI, command, '--execution', 'hosted', '--request', file],
        { cwd: root, encoding: 'utf8', env, timeout: 15_000, maxBuffer: 1024 * 1024 });
      expect(hosted.status).toBe(1); expect(hosted.stderr).toContain('cannot be consumed by a hosted operation');
      expect(existsSync(state)).toBe(false); expect(existsSync(cache)).toBe(false);
    }
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test('preparation reobserves mutable PR metadata even when all source SHAs remain equal', () => {
  const observed = scenario('metadata-read-window');
  expect(observed.failure).toBeNull();
  expect(observed.result.request.request.manifestPath).toBe('config/repository/work-packages/other.md');
  expect(observed.counters).toMatchObject({ native: 0, healthObservation: 0, source: 0 });
  expect(observed.stateCreated).toBe(false);
});
