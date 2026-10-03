import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { resolveSecRuntimeStateForRepository } from '../../src/adapters/runtime-state/workspace-state/paths.ts';
import { runTrustedRuntimeOperatorCli, verifyWithTrustedRuntime } from '../../src/adapters/self-hosting/control/composition/trusted-runtime-closeout.ts';
import { CI_VERIFICATION_SESSION_REQUEST_SCHEMA } from '../../src/adapters/verification/platform/ci/contract/revision.ts';
import type { VerificationSessionHostedRequest } from '../../src/adapters/verification/platform/ci/contract/session-request.ts';
import {
  assertVerificationSessionLocalPreparationCurrent,
  createVerificationSessionLocalPreparationRequest,
  parseVerificationSessionLocalPreparationRequest
} from '../../src/adapters/verification/platform/ci/runtime/verification-session-runtime.ts';

const D = (n: string) => `sha256:${n.repeat(64)}` as const;
const REQUEST: VerificationSessionHostedRequest = Object.freeze({
  schema: CI_VERIFICATION_SESSION_REQUEST_SCHEMA,
  prNumber: 123, expectedBaseSha: '1'.repeat(40), expectedBaseTreeSha: '2'.repeat(40),
  expectedHeadSha: '3'.repeat(40), expectedHeadTreeSha: '4'.repeat(40),
  manifestPath: 'work-packages/local.json', manifestDigest: D('1'), profile: 'fast',
  expectedScopeProposalDigest: D('2'), expectedActionPlanDigest: D('3'),
  expectedSessionRevision: D('4'), reviewPolicyDigest: D('5'), requestOperationId: D('6')
});
const LOCAL = createVerificationSessionLocalPreparationRequest(REQUEST);
const SESSION_CLI = path.resolve("src/bootstrap/development/closeout/verification-session-cli.ts");
const OPERATOR_CLI = path.resolve('src/bootstrap/engineering/trusted-runtime-closeout.ts');

function fixture(operation: (input: { root: string; requestPath: string; state: string; cache: string }) => void) {
  const parent = mkdtempSync(path.join(tmpdir(), 'sec-local-stage-'));
  const root = path.join(parent, 'workspace');
  mkdirSync(root);
  const requestPath = path.join(root, 'request.json');
  writeFileSync(requestPath, JSON.stringify(LOCAL));
  try { operation({ root, requestPath, state: path.join(parent, 'state'), cache: path.join(parent, 'cache') }); }
  finally { rmSync(parent, { recursive: true, force: true }); }
}

function runCli(cli: string, args: string[], root: string, state: string, cache: string) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root, encoding: 'utf8', timeout: 15_000, maxBuffer: 1024 * 1024,
    env: { ...process.env, SEC_STATE_HOME: state, SEC_CACHE_HOME: cache }
  });
}

test('local request parser preserves frozen exact pins and rejects placement escalation', () => {
  const parsed = parseVerificationSessionLocalPreparationRequest(JSON.stringify(LOCAL));
  expect(parsed).toEqual(LOCAL);
  expect(Object.isFrozen(parsed)).toBe(true);
  expect(Object.isFrozen(parsed.request)).toBe(true);
  for (const invalid of [null, [], REQUEST, { ...LOCAL, executionPlacement: 'hosted' },
    { ...LOCAL, authorityStage: 'verification' }, { ...LOCAL, grant: true },
    { ...LOCAL, request: null }, { ...LOCAL, request: { ...REQUEST, unexpected: true } }]) {
    expect(() => parseVerificationSessionLocalPreparationRequest(JSON.stringify(invalid))).toThrow();
  }
});

test('local re-preparation rejects every changed saved identity before execution', () => {
  expect(() => assertVerificationSessionLocalPreparationCurrent(LOCAL, REQUEST)).not.toThrow();
  for (const key of Object.keys(REQUEST) as (keyof VerificationSessionHostedRequest)[]) {
    if (key === 'schema') continue;
    const value = REQUEST[key];
    const changed = typeof value === 'number' ? value + 1
      : value.startsWith('sha256:') ? D('f')
      : /^[0-9a-f]{40}$/u.test(value) ? 'f'.repeat(40) : `${value}-changed`;
    expect(() => assertVerificationSessionLocalPreparationCurrent(LOCAL, { ...REQUEST, [key]: changed }))
      .toThrow(/differs from current exact candidate, Session or Action environment/);
  }
});

test('local status and resume observe saved inputs without creating runtime state or executing work', () => {
  fixture(({ root, requestPath, state, cache }) => {
    for (const command of ['status', 'resume']) {
      const result = runCli(SESSION_CLI, [command, '--request', requestPath], root, state, cache);
      expect(result.status).toBe(0);
      const projection = JSON.parse(result.stdout);
      expect(projection).toMatchObject({ status: 'LOCAL_REQUEST_OBSERVED', execution: 'local',
        stage: 'read-only-projection', observationScope: 'saved-local-request-and-durable-records',
        savedRequest: LOCAL, verificationStatus: 'not-observed', evidenceRecord: 'not-observed',
        currentSubject: 'not-observed', sourceQualification: 'not-revalidated',
        integrationAuthorization: 'not-evaluated', executionStarted: false,
        operation: command === 'resume' ? 'resume-projection' : 'status' });
      expect(projection.nextVerification).toEqual({ entrypoint: 'sec:closeout',
        arguments: ['--verification-only', '--request', requestPath, '--repository', 'sec-platform/sec'],
        requiresSeparateExecutionAdmission: true });
      expect(existsSync(state)).toBe(false);
      expect(existsSync(cache)).toBe(false);
    }
    expect(JSON.parse(readFileSync(requestPath, 'utf8'))).toEqual(LOCAL);
  });
});

test('local readers reject a hosted request before observing runtime state', () => {
  fixture(({ root, requestPath, state, cache }) => {
    writeFileSync(requestPath, JSON.stringify(REQUEST));
    for (const command of ['status', 'resume']) {
      const result = runCli(SESSION_CLI, [command, '--request', requestPath], root, state, cache);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('exact local preparation-only envelope');
      expect(existsSync(state)).toBe(false);
      expect(existsSync(cache)).toBe(false);
    }
  });
});

test('local status rejects unsafe or malformed durable records without repairing them', () => {
  fixture(({ root, requestPath, state, cache }) => {
    const layout = resolveSecRuntimeStateForRepository({ repositoryRoot: root, repository: 'sec-platform/sec',
      environment: { SEC_STATE_HOME: state, SEC_CACHE_HOME: cache } });
    const records = path.join(layout.repositoryStateRoot, 'trusted-runtime', 'v1', REQUEST.expectedSessionRevision.slice(7));
    mkdirSync(records, { recursive: true });
    const action = path.join(records, 'verification-action.json');
    writeFileSync(action, '{}');
    const result = runCli(SESSION_CLI, ['status', '--request', requestPath], root, state, cache);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Action bundle shape is invalid');
    expect(readFileSync(action, 'utf8')).toBe('{}');
    expect(existsSync(cache)).toBe(false);
    rmSync(action);
    symlinkSync(requestPath, action);
    const unsafe = runCli(SESSION_CLI, ['status', '--request', requestPath], root, state, cache);
    expect(unsafe.status).toBe(1);
    expect(existsSync(cache)).toBe(false);
  });
});

test('verification-only operator requires the saved local envelope and rejects integration selectors', async () => {
  for (const args of [
    ['--verification-only'], ['--verification-only', '--pr', '123', '--request', 'unused.json'],
    ['--verification-only', '--main-health', '--request', 'unused.json'],
    ['--verification-only', '--runtime-canary', '--request', 'unused.json'],
    ['--verification-only', '--request', 'unused.json', '--dependencies'],
    ['--pr', '123', '--request', 'unused.json']
  ]) {
    await expect(runTrustedRuntimeOperatorCli(args)).rejects.toThrow();
  }
  await expect(verifyWithTrustedRuntime({ repositoryRoot: 'unused', repository: 'sec-platform/sec',
    request: REQUEST as never })).rejects.toThrow(/exact local preparation-only envelope/);
});

test('real verification-only bootstrap rejects hosted input before runtime or provider effects', () => {
  fixture(({ root, requestPath, state, cache }) => {
    writeFileSync(requestPath, JSON.stringify(REQUEST));
    const result = runCli(OPERATOR_CLI, ['--verification-only', '--request', requestPath], root, state, cache);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('exact local preparation-only envelope');
    expect(existsSync(state)).toBe(false);
    expect(existsSync(cache)).toBe(false);
  });
});


const COMPOSITION_FIXTURE = path.resolve('tests/helpers/local-stage/composition-fixture.ts');
interface CompositionObservation {
  result: { status: string; stage?: string; actionEvidenceReused?: boolean; integrationAuthorization?: string };
  failure: string | null;
  counters: { source: number; review: number; currentSubject: number; remoteWrite: number; platform: number; reprepare: number };
  files: string[];
  projection: Record<string, unknown> | null;
  leaseFiles: string[];
}
function compositionScenario(scenario: string): CompositionObservation {
  let observed: CompositionObservation | undefined;
  fixture(({ root, state, cache }) => {
    const result = runCli(COMPOSITION_FIXTURE, [scenario, root], root, state, cache);
    expect(result.status).toBe(0);
    observed = JSON.parse(result.stdout);
  });
  if (observed === undefined) throw new Error('Composition fixture returned no observation');
  return observed;
}

test('verification-only composition publishes through original journals and stops before integration', () => {
  const observed = compositionScenario('verified');
  expect(observed.failure).toBeNull();
  expect(observed.result).toMatchObject({ status: 'LOCAL_VERIFIED', stage: 'verification-only',
    integrationAuthorization: 'not-issued-by-this-operation', actionEvidenceReused: false });
  expect(observed.counters).toMatchObject({ source: 1, review: 1, currentSubject: 4,
    remoteWrite: 0, platform: 0 });
  expect(observed.files).toContain('verification-action.json');
  expect(observed.files.some((file: string) => file.startsWith('source-program-attempt-'))).toBe(true);
  expect(observed.files.some((file: string) => file.startsWith('source-program-adoption-'))).toBe(true);
  expect(observed.files.some((file: string) => file.startsWith('artifact-'))).toBe(true);
  expect(observed.files.some((file: string) => /^(status-|merge-gate-)/u.test(file))).toBe(false);
  expect(observed.leaseFiles).toEqual([]);
  expect(observed.projection).toMatchObject({ status: 'LOCAL_EVIDENCE_RECORDED',
    evidenceRecord: 'verification-action', verificationStatus: 'passed',
    currentSubject: 'not-observed', sourceQualification: 'not-revalidated', executionStarted: false });
});

test('full closeout still continues to its original pre-merge review boundary', () => {
  const observed = compositionScenario('full-closeout');
  expect(observed.failure).toContain('TEST_PRE_MERGE_BOUNDARY');
  expect(observed.counters).toMatchObject({ source: 1, review: 2, remoteWrite: 0, platform: 0 });
  expect(observed.files).toContain('verification-action.json');
  expect(observed.leaseFiles).toEqual([]);
});

test('local environment drift is rejected before the SourceTransition owner executes', () => {
  const observed = compositionScenario('environment-drift');
  expect(observed.failure).toContain('differs from current exact candidate, Session or Action environment');
  expect(observed.counters).toMatchObject({ source: 0, remoteWrite: 0, platform: 0 });
  expect(observed.files).toEqual([]);
  expect(observed.leaseFiles).toEqual([]);
});

test('verification-only cannot fall into merged integration recovery', () => {
  const observed = compositionScenario('merged-input');
  expect(observed.failure).toContain('cannot recover merged integration');
  expect(observed.counters).toMatchObject({ source: 0, review: 0, remoteWrite: 0, platform: 0, reprepare: 0 });
  expect(observed.files).toEqual([]);
  expect(observed.leaseFiles).toEqual([]);
});

test('local verification retains pending evidence and needs-author without inventing adoption', () => {
  const observed = compositionScenario('source-waiting');
  expect(observed.failure).toBeNull();
  expect(observed.result.status).toBe('needs-author');
  expect(observed.counters).toMatchObject({ source: 1, review: 1, remoteWrite: 0, platform: 0 });
  expect(observed.files).toContain('verification-pending-qualification.json');
  expect(observed.files).not.toContain('verification-action.json');
  expect(observed.files.some((file: string) => file.startsWith('source-program-adoption-'))).toBe(false);
  expect(observed.projection).toMatchObject({ evidenceRecord: 'pending-qualification', artifactDigest: null,
    currentSubject: 'not-observed', sourceQualification: 'not-revalidated', executionStarted: false });
  expect(observed.leaseFiles).toEqual([]);
});

test('local verification rechecks the subject after publication without entering integration', () => {
  const observed = compositionScenario('subject-drift');
  expect(observed.failure).toContain('candidate drifted after durable Verification');
  expect(observed.counters).toMatchObject({ source: 1, review: 1, remoteWrite: 0, platform: 0 });
  expect(observed.files).toContain('verification-action.json');
  expect(observed.leaseFiles).toEqual([]);
});

test('local verification reuse still invokes the original live SourceTransition owner', () => {
  const observed = compositionScenario('reuse');
  expect(observed.failure).toBeNull();
  expect(observed.result).toMatchObject({ status: 'LOCAL_VERIFIED', actionEvidenceReused: true,
    integrationAuthorization: 'not-issued-by-this-operation' });
  expect(observed.counters).toMatchObject({ source: 2, review: 2, remoteWrite: 0, platform: 0 });
  expect(observed.leaseFiles).toEqual([]);
});


test('local verification preserves the review wait and does not start source execution', () => {
  const observed = compositionScenario('review-waiting');
  expect(observed.failure).toBeNull();
  expect(observed.result.status).toBe('WAITING_REVIEW');
  expect(observed.counters).toMatchObject({ source: 0, review: 1, remoteWrite: 0, platform: 0 });
  expect(observed.files).toEqual([]);
  expect(observed.leaseFiles).toEqual([]);
});
