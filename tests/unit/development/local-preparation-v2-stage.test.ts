import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { withRetainedBunTestWorkspace } from '../../testkit/process-resource.ts';

const FIXTURE = path.resolve('tests/helpers/local-stage/v2-preparation-fixture.ts');
const CLI = path.resolve('src/bootstrap/development/closeout/verification-session-cli.ts');
async function scenario(name: string) {
  return withRetainedBunTestWorkspace('sec-v2-stage-', async (parent, run) => {
    const root = path.join(parent, 'workspace'), state = path.join(parent, 'state'), cache = path.join(parent, 'cache');
    mkdirSync(root);
    const env = { ...process.env, SEC_STATE_HOME: state, SEC_CACHE_HOME: cache };
    const result = await run([FIXTURE, name, root], { cwd: root, env, envMode: 'replace',
      timeoutMs: 15_000, maxStdoutBytes: 1024 * 1024, maxStderrBytes: 1024 * 1024 });
    expect(result.code).toBe(0);
    return JSON.parse(result.stdout);
  });
}

test('V2 explicit execution reports missing frozen native content without creating state or trying another backend', async () => {
  const observed = await scenario('verify-unresolved');
  expect(observed.failure).toBeNull();
  expect(observed.result).toMatchObject({ status: 'LOCAL_QUALIFICATION_UNAVAILABLE', stage: 'qualification-not-started',
    reason: 'native-runtime-content-not-accepted', executionStarted: false, integrationAuthorization: 'not-issued' });
  expect(observed.counters).toMatchObject({ source: 0, native: 0, healthObservation: 0 });
  expect(observed.stateCreated).toBe(false); expect(observed.cacheCreated).toBe(false);
});

for (const name of ['actor-drift', 'metadata-drift', 'forged-content', 'cancelled']) {
  test(`V2 ${name} cannot advance into qualification, source execution or operation state`, async () => {
    const observed = await scenario(name);
    expect(observed.failure).not.toBeNull();
    if (name === 'cancelled') expect(observed.failure).toBe('CANCELLED_PROVIDER_READ');
    expect(observed.counters).toMatchObject({ source: 0, native: 0, healthObservation: 0 });
    expect(observed.stateCreated).toBe(false); expect(observed.cacheCreated).toBe(false);
  });
}

test('real CLI status/resume accept V2 read-only and explicit hosted readers reject it before state', async () => {
  const observed = await scenario('prepare');
  expect(observed.failure).toBeNull();
  expect(observed.result).toMatchObject({ status: 'LOCAL_PREPARED', stage: 'preparation-only',
    qualification: 'not-run', unresolvedRequirements: ['native-runtime-content-not-accepted'],
    sourceQualification: 'not-run', integrationAuthorization: 'not-issued' });
  expect(observed.result.request.schema).toBe('sec-verification-session-local-preparation-v2');
  expect(observed.result.sessionRevision).toBeUndefined();
  expect(observed.counters).toMatchObject({ source: 0, native: 0, healthObservation: 0 });
  expect(observed.stateCreated).toBe(false); expect(observed.cacheCreated).toBe(false);
  const request = observed.result.request;
  await withRetainedBunTestWorkspace('sec-v2-cli-', async (parent, run) => {
    const root = path.join(parent, 'workspace'), state = path.join(parent, 'state'), cache = path.join(parent, 'cache');
    mkdirSync(root);
    const file = path.join(root, 'request.json'); writeFileSync(file, JSON.stringify(request));
    const env = { ...process.env, SEC_STATE_HOME: state, SEC_CACHE_HOME: cache };
    for (const command of ['status', 'resume']) {
      const read = await run([CLI, command, '--request', file], { cwd: root, env, envMode: 'replace',
        timeoutMs: 15_000, maxStdoutBytes: 1024 * 1024, maxStderrBytes: 1024 * 1024 });
      expect(read.code).toBe(0);
      expect(JSON.parse(read.stdout)).toMatchObject({ status: 'LOCAL_REQUEST_OBSERVED',
        stage: 'read-only-projection', sessionRevision: null, verificationStatus: 'not-observed',
        preparationInputMatched: false, sourceQualification: 'not-revalidated',
        currentSubject: 'not-observed', executionStarted: false });
      const hosted = await run([CLI, command, '--execution', 'hosted', '--request', file],
        { cwd: root, env, envMode: 'replace', timeoutMs: 15_000, maxStdoutBytes: 1024 * 1024, maxStderrBytes: 1024 * 1024 });
      expect(hosted.code).toBe(1); expect(hosted.stderr).toContain('cannot be consumed by a hosted operation');
      expect(existsSync(state)).toBe(false); expect(existsSync(cache)).toBe(false);
    }
  });
});

test('preparation reobserves mutable PR metadata even when all source SHAs remain equal', async () => {
  const observed = await scenario('metadata-read-window');
  expect(observed.failure).toBeNull();
  expect(observed.result.request.request.manifestPath).toBe('config/repository/work-packages/other.md');
  expect(observed.counters).toMatchObject({ native: 0, healthObservation: 0, source: 0 });
  expect(observed.stateCreated).toBe(false);
});
