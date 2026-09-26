import { expect, test } from 'bun:test';

import type { GitHubCheckObservation } from '../../src/adapters/providers/github-api/contract.ts';
import {
  createObservedMainHealthInputWithPolicy,
  createRegisteredHostedMainHealthInputs,
  createTrustedRuntimeMainHealthCheckProviderPolicy,
  GITHUB_ACTIONS_MAIN_HEALTH_CHECK_PROVIDER_POLICY
} from '../../src/adapters/self-hosting/control/main-health/main-health-observation.ts';
import { CI_MAIN_HEALTH_POLICY, createCiMainHealthRequestOperationId } from '../../src/adapters/self-hosting/control/main-health/provider-policy.ts';

const MAIN = '1'.repeat(40);
const MAIN_TREE = '2'.repeat(40);
const APP = Object.freeze({ id: 900001, nodeId: 'A_sec_integrator', slug: 'sec-integrator' });
const RUNTIME_REF = `src/adapters/self-hosting/control/integration/merge-gate.ts@${MAIN}`;

const policy = createTrustedRuntimeMainHealthCheckProviderPolicy({
  policyRevision: 'sec-main-health-trusted-runtime-v1',
  app: APP
});

function check(overrides: Partial<GitHubCheckObservation> = {}): GitHubCheckObservation {
  return {
    id: 77,
    name: 'sec/main-health',
    status: 'completed',
    conclusion: 'success',
    headSha: MAIN,
    detailsUrl: null,
    appId: APP.id,
    appNodeId: APP.nodeId,
    appSlug: APP.slug,
    workflowPath: null,
    workflowRef: null,
    eventName: null,
    workflowRunId: null,
    workflowRunDisplayTitle: null,
    ...overrides
  };
}

function actionsCheck(overrides: Partial<GitHubCheckObservation> = {}): GitHubCheckObservation {
  const operationId = createCiMainHealthRequestOperationId(MAIN);
  return {
    id: 123,
    name: CI_MAIN_HEALTH_POLICY.context,
    status: 'completed',
    conclusion: 'success',
    headSha: MAIN,
    detailsUrl: 'https://github.com/sec-platform/sec/actions/runs/123',
    appId: CI_MAIN_HEALTH_POLICY.app.id,
    appNodeId: CI_MAIN_HEALTH_POLICY.app.nodeId,
    appSlug: CI_MAIN_HEALTH_POLICY.app.slug,
    workflowPath: CI_MAIN_HEALTH_POLICY.producer.workflowPath,
    workflowRef: `${CI_MAIN_HEALTH_POLICY.producer.workflowPath}@${MAIN}`,
    eventName: CI_MAIN_HEALTH_POLICY.producer.eventNames[0],
    workflowRunId: '123',
    workflowRunDisplayTitle: `SEC main health ${MAIN} operation ${operationId}`,
    ...overrides
  };
}

function compileHosted(checks: readonly GitHubCheckObservation[]) {
  return createRegisteredHostedMainHealthInputs({
    repository: 'sec-platform/sec',
    mainSha: MAIN,
    mainTreeSha: MAIN_TREE,
    trustRevision: MAIN,
    observedAt: '2026-08-19T00:00:00.000Z',
    expiresAt: '2026-08-19T01:00:00.000Z',
    sourceRef: `github-check-runs:sec-platform/sec@${MAIN}`,
    checks
  });
}

function observe(checks: readonly GitHubCheckObservation[], sourceRunId = '77') {
  return createObservedMainHealthInputWithPolicy({
    repository: 'sec-platform/sec',
    mainSha: MAIN,
    mainTreeSha: MAIN_TREE,
    trustRevision: MAIN,
    observedAt: '2026-08-19T00:00:00.000Z',
    expiresAt: '2026-08-19T01:00:00.000Z',
    sourceRunId,
    sourceRef: RUNTIME_REF,
    checks,
    policy
  });
}

test('dedicated Integration App can produce healthy MainHealth without GitHub Actions workflow provenance', () => {
  const ledger = observe([check()]);
  expect(ledger.status).toBe('healthy');
  expect(ledger.allowedLanes).toEqual(['ordinary']);
  expect(ledger.producer).toMatchObject({
    sourceTransport: 'github-api',
    sourceRunId: '77',
    sourceRef: RUNTIME_REF,
    trustRevision: MAIN
  });
});

test('direct App MainHealth requires exact app identity and exact main subject', () => {
  expect(observe([check({ appId: APP.id + 1 })]).status).toBe('locked');
  expect(observe([check({ appNodeId: 'A_wrong' })]).status).toBe('locked');
  expect(observe([check({ appSlug: 'wrong-integrator' })]).status).toBe('locked');
  expect(observe([check({ headSha: '3'.repeat(40) })]).status).toBe('locked');
});

test('direct App MainHealth cannot be impersonated by a workflow-backed check', () => {
  const workflowBacked = check({
    workflowPath: '.github/workflows/compiler-pr-validation.yml',
    workflowRef: `.github/workflows/compiler-pr-validation.yml@${MAIN}`,
    eventName: 'repository_dispatch',
    workflowRunId: '123',
    workflowRunDisplayTitle: `SEC main health ${MAIN} operation sha256:${'a'.repeat(64)}`
  });
  expect(observe([workflowBacked]).status).toBe('locked');
});

test('duplicate direct App MainHealth checks remain ambiguous and locked', () => {
  expect(observe([check(), check({ id: 78 })])).toMatchObject({
    status: 'locked',
    allowedLanes: []
  });
});

test('direct App sourceRunId must bind the exact observed GitHub check id', () => {
  expect(() => observe([check()], '78')).toThrow('sourceRunId must equal the exact observed check or workflow run id');
});

test('hosted registry accepts the exact Actions principal and ignores an unregistered same-name App', () => {
  expect(compileHosted([check()])).toEqual([]);
  expect(compileHosted([actionsCheck()])).toMatchObject([{
    status: 'healthy',
    allowedLanes: ['ordinary'],
    producer: { sourceRunId: '123' }
  }]);
});

test('Actions sourceRunId must bind the exact observed workflow run id', () => {
  expect(() => createObservedMainHealthInputWithPolicy({
    repository: 'sec-platform/sec',
    mainSha: MAIN,
    mainTreeSha: MAIN_TREE,
    trustRevision: MAIN,
    observedAt: '2026-08-19T00:00:00.000Z',
    expiresAt: '2026-08-19T01:00:00.000Z',
    sourceRunId: '124',
    sourceRef: `github-check-runs:sec-platform/sec@${MAIN}`,
    checks: [actionsCheck()],
    policy: GITHUB_ACTIONS_MAIN_HEALTH_CHECK_PROVIDER_POLICY
  })).toThrow('sourceRunId must equal the exact observed check or workflow run id');
});

test('hosted registry does not enroll same-App near matches before producer provenance matches', () => {
  const skipped = { status: 'completed', conclusion: 'skipped' } as const;
  const operationId = createCiMainHealthRequestOperationId(MAIN);
  expect(compileHosted([actionsCheck({ ...skipped, headSha: '3'.repeat(40) })])).toEqual([]);
  expect(compileHosted([actionsCheck({ ...skipped, appId: CI_MAIN_HEALTH_POLICY.app.id + 1 })])).toEqual([]);
  expect(compileHosted([actionsCheck({ ...skipped, eventName: 'pull_request' })])).toEqual([]);
  expect(compileHosted([actionsCheck({ ...skipped, workflowPath: '.github/workflows/other.yml' })])).toEqual([]);
  expect(compileHosted([actionsCheck({ ...skipped, workflowRef: `${CI_MAIN_HEALTH_POLICY.producer.workflowPath}@${'4'.repeat(40)}` })])).toEqual([]);
  expect(compileHosted([actionsCheck({ ...skipped, workflowRunDisplayTitle: `SEC main health ${MAIN} operation sha256:${'f'.repeat(64)}` })])).toEqual([]);
  expect(compileHosted([actionsCheck({ ...skipped, workflowRunId: null })])).toEqual([]);
  expect(compileHosted([
    actionsCheck(),
    actionsCheck({ id: 124, workflowRunId: '124', workflowRunDisplayTitle: `SEC main health ${MAIN} operation ${operationId}` })
  ])).toMatchObject([{ status: 'locked', allowedLanes: [] }]);
});

test('terminal non-success remains degraded and routes only to repair', () => {
  const ledger = observe([check({ conclusion: 'failure' })]);
  expect(ledger.status).toBe('degraded');
  expect(ledger.allowedLanes).toEqual(['repair']);
  expect(ledger.failureFingerprints).toHaveLength(1);
  expect(ledger.repairWorkPackage).not.toBeNull();
});
