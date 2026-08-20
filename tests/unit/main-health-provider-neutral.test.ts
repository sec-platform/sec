import { expect, test } from 'bun:test';

import {
  createObservedMainHealthInputWithPolicyV1,
  createTrustedLocalMainHealthInputV1,
  createTrustedRuntimeMainHealthCheckProviderPolicyV1
} from '../../scripts/codex/main-health-observation.ts';
import type { GitHubCheckObservationV1 } from '../../scripts/codex/verification-session-github.ts';

const MAIN = '1'.repeat(40);
const MAIN_TREE = '2'.repeat(40);
const APP = Object.freeze({ id: 900001, nodeId: 'A_sec_integrator', slug: 'sec-integrator' });
const RUNTIME_REF = `scripts/codex/merge-gate.ts@${MAIN}`;

const policy = createTrustedRuntimeMainHealthCheckProviderPolicyV1({
  policyRevision: 'sec-main-health-trusted-runtime-v1',
  app: APP
});

function check(overrides: Partial<GitHubCheckObservationV1> = {}): GitHubCheckObservationV1 {
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

function observe(checks: readonly GitHubCheckObservationV1[], sourceRunId = '77') {
  return createObservedMainHealthInputWithPolicyV1({
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
  expect(() => observe([check()], '78')).toThrow('sourceRunId must equal the exact observed check id');
});

test('terminal non-success remains degraded and routes only to repair', () => {
  const ledger = observe([check({ conclusion: 'failure' })]);
  expect(ledger.status).toBe('degraded');
  expect(ledger.allowedLanes).toEqual(['repair']);
  expect(ledger.failureFingerprints).toHaveLength(1);
  expect(ledger.repairWorkPackage).not.toBeNull();
});

test('durable local runtime receipt projects healthy exact-main input without Actions', () => {
  const input = createTrustedLocalMainHealthInputV1({
    schema: 'sec-trusted-local-main-health-observation-v1',
    repository: 'sec-platform/sec',
    mainSha: MAIN,
    mainTreeSha: MAIN_TREE,
    trustRevision: MAIN,
    runtimeRef: RUNTIME_REF,
    executionId: 'trusted-main-health-example',
    verificationReceiptDigest: `sha256:${'a'.repeat(64)}`,
    observedAt: '2026-08-19T00:00:00.000Z',
    expiresAt: '2026-08-19T01:00:00.000Z'
  });
  expect(input).toMatchObject({
    status: 'healthy',
    allowedLanes: ['ordinary'],
    producer: {
      sourceTransport: 'trusted-local-readback',
      sourceRunId: 'trusted-main-health-example',
      sourceRef: RUNTIME_REF,
      sourceDigest: `sha256:${'a'.repeat(64)}`
    }
  });
  expect(() => createTrustedLocalMainHealthInputV1({
    schema: 'sec-trusted-local-main-health-observation-v1',
    repository: 'sec-platform/sec',
    mainSha: MAIN,
    mainTreeSha: MAIN_TREE,
    trustRevision: MAIN,
    runtimeRef: RUNTIME_REF,
    executionId: 'trusted-main-health-example',
    verificationReceiptDigest: `sha256:${'a'.repeat(64)}`,
    observedAt: '2026-08-19T01:00:00.000Z',
    expiresAt: '2026-08-19T00:00:00.000Z'
  })).toThrow('not exact or fresh');
});
