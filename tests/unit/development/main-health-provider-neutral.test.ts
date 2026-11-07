import { expect, test } from 'bun:test';
import type { GitHubCheckObservation } from '../../../src/execution/verification/session.ts';


import { createMainHealthLedger } from '../../../src/adapters/self-hosting/control/main-health/contract.ts';
import {
  createObservedMainHealthInput,
  createRegisteredHostedMainHealthInputs,
  createTrustedRuntimeMainHealthInput
} from '../../../src/adapters/self-hosting/control/main-health/main-health-observation.ts';
import { CI_MAIN_HEALTH_POLICY, createCiMainHealthRequestOperationId } from '../../../src/adapters/self-hosting/control/main-health/provider-policy.ts';

const MAIN = '1'.repeat(40);
const MAIN_TREE = '2'.repeat(40);

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

test('direct Actions MainHealth derives producer identity independently of the observing caller', () => {
  const input = {
    repository: 'sec-platform/sec',
    mainSha: MAIN,
    mainTreeSha: MAIN_TREE,
    trustRevision: MAIN,
    observedAt: '2026-08-19T00:00:00.000Z',
    expiresAt: '2026-08-19T00:10:00.000Z',
    // Overspecified legacy callers cannot replace the observed producer.
    sourceRunId: '999',
    sourceRef: `.github/workflows/merge-gate.yml@${MAIN}`
  };
  const producer = actionsCheck({ id: 77, workflowRunId: '123' });
  const exact = createObservedMainHealthInput({ ...input, checks: [producer] });
  expect(exact).toMatchObject({
    status: 'healthy',
    allowedLanes: ['ordinary'],
    owner: null,
    repairWorkPackage: null,
    failureFingerprints: [],
    producer: {
      sourceRunId: '123',
      sourceRef: `github-check-runs:sec-platform/sec@${MAIN}`,
      trustRevision: MAIN
    }
  });
  expect(createObservedMainHealthInput({ ...input, checks: [
    actionsCheck({ id: 79, appId: 1 }),
    producer,
    actionsCheck({ id: 80, conclusion: 'skipped', workflowRunId: '31683485879',
      workflowRunDisplayTitle: 'activate prepare PR #376' }),
    actionsCheck({ id: 81, conclusion: 'skipped',
      workflowRunDisplayTitle: `SEC main health ${MAIN} operation sha256:${'a'.repeat(64)}` })
  ] })).toEqual(exact);
  for (const checks of [
    [],
    [actionsCheck({ workflowRunId: null })],
    [producer, actionsCheck({ id: 78, workflowRunId: '124' })],
    [actionsCheck({ status: 'in_progress', conclusion: null })],
    [actionsCheck({ conclusion: 'forged-terminal' })],
    [actionsCheck({ status: 'forged-status', conclusion: 'failure' })]
  ]) {
    expect(createObservedMainHealthInput({ ...input, checks })).toMatchObject({
      status: 'locked',
      allowedLanes: [],
      failureFingerprints: [expect.stringMatching(/^sha256:/)]
    });
  }
});

test('hosted registry does not enroll same-App near matches before producer provenance matches', () => {
  const skipped = { status: 'completed', conclusion: 'skipped' } as const;
  const operationId = createCiMainHealthRequestOperationId(MAIN);
  expect(compileHosted([actionsCheck({ ...skipped, headSha: '3'.repeat(40) })])).toEqual([]);
  expect(compileHosted([actionsCheck({ ...skipped, appId: CI_MAIN_HEALTH_POLICY.app.id + 1 })])).toEqual([]);
  expect(compileHosted([actionsCheck({ ...skipped, appNodeId: 'A_wrong' })])).toEqual([]);
  expect(compileHosted([actionsCheck({ ...skipped, appSlug: 'wrong-integrator' })])).toEqual([]);
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

test('hosted terminal success routes to ordinary work while non-success routes only to repair', () => {
  const hostedInputs = compileHosted([actionsCheck()]);
  expect(hostedInputs).toMatchObject([{
    status: 'healthy',
    allowedLanes: ['ordinary'],
    producer: { sourceRunId: '123' }
  }]);
  const hosted = createMainHealthLedger(hostedInputs[0]!);
  const observation = {
    schema: 'sec-trusted-runtime-main-health-observation-v1' as const,
    repository: 'sec-platform/sec',
    mainSha: MAIN,
    mainTreeSha: MAIN_TREE,
    trustRevision: MAIN,
    executionId: 'trusted-main-health-run',
    verificationReceiptDigest: `sha256:${'e'.repeat(64)}` as const,
    observedAt: '2026-08-19T00:00:00.000Z',
    expiresAt: '2026-08-19T01:00:00.000Z'
  };
  const schema = 'sec-trusted-runtime-main-health-receipt-v4';
  const projected = createTrustedRuntimeMainHealthInput(observation, schema);
  const local = createMainHealthLedger(projected);
  expect(local.status).toBe('healthy');
  expect(local.allowedLanes).toEqual(['ordinary']);
  expect(local.healthRevision).toBe(hosted.healthRevision);
  expect(local.ledgerDigest).not.toBe(hosted.ledgerDigest);
  expect(local.producer).toMatchObject({
    sourceTransport: 'trusted-runtime-live-readback',
    sourceRunId: 'trusted-main-health-run',
    sourceRef: `live-receipt:trusted-main-health/v4/${MAIN}/${'e'.repeat(64)}`
  });
  expect(projected.producer.sourceDigest).toBe(observation.verificationReceiptDigest);
  const changedDigest = createTrustedRuntimeMainHealthInput({ ...observation,
    verificationReceiptDigest: `sha256:${'f'.repeat(64)}` }, schema);
  expect(changedDigest.producer.sourceRef).toBe(
    `live-receipt:trusted-main-health/v4/${MAIN}/${'f'.repeat(64)}`
  );
  const changedMain = createTrustedRuntimeMainHealthInput({ ...observation,
    mainSha: '3'.repeat(40), trustRevision: '3'.repeat(40) }, schema);
  expect(changedMain.producer.sourceRef).toBe(
    `live-receipt:trusted-main-health/v4/${'3'.repeat(40)}/${'e'.repeat(64)}`
  );
  const ledger = createMainHealthLedger(compileHosted([actionsCheck({ conclusion: 'failure' })])[0]!);
  expect(ledger.status).toBe('degraded');
  expect(ledger.allowedLanes).toEqual(['repair']);
  expect(ledger.owner).toBe('ci-verification-maintainer');
  expect(ledger.failureFingerprints).toEqual([expect.stringMatching(/^sha256:/)]);
  expect(ledger.repairWorkPackage).toContain('default-branch-health-repair-');
});
