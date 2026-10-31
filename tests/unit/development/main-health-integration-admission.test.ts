import { expect, test } from 'bun:test';
import { createMainHealthLedger } from '../../../src/adapters/self-hosting/control/main-health/contract.ts';
import { assertIntegrationMainHealthProducer, type TrustedRuntimeMainHealthPublicationAdmission } from '../../../src/adapters/self-hosting/control/main-health/live-admission.ts';
import { createObservedMainHealthInput, createTrustedRuntimeMainHealthInput } from '../../../src/adapters/self-hosting/control/main-health/main-health-observation.ts';
import { CI_MAIN_HEALTH_POLICY, createCiMainHealthRequestOperationId } from '../../../src/adapters/self-hosting/control/main-health/provider-policy.ts';
import type { GitHubCheckObservation } from '../../../src/adapters/providers/github-api/contract.ts';
import { compilePostMainIssueDispositionHealthReadback } from '../../../src/adapters/verification/platform/ci/runtime/verification-session-runtime.ts';

const MAIN = '1'.repeat(40);
const TREE = '2'.repeat(40);
const NOW = '2026-10-05T12:00:00.000Z';
const EXPIRES = '2026-10-05T12:10:00.000Z';
const subject = { repository: 'sec-platform/sec', mainSha: MAIN, mainTreeSha: TREE, now: NOW };
const local = createMainHealthLedger(createTrustedRuntimeMainHealthInput({
  schema: 'sec-trusted-runtime-main-health-observation-v1', repository: subject.repository,
  mainSha: MAIN, mainTreeSha: TREE, trustRevision: MAIN, executionId: 'historical-data-only',
  verificationReceiptDigest: `sha256:${'e'.repeat(64)}`, observedAt: NOW, expiresAt: EXPIRES
}));
const hosted = createMainHealthLedger(createObservedMainHealthInput({
  repository: subject.repository, mainSha: MAIN, mainTreeSha: TREE, trustRevision: MAIN,
  observedAt: NOW, expiresAt: EXPIRES,
  checks: [{ id: 123, name: CI_MAIN_HEALTH_POLICY.context, status: 'completed', conclusion: 'success',
    headSha: MAIN, detailsUrl: null, appId: CI_MAIN_HEALTH_POLICY.app.id,
    appNodeId: CI_MAIN_HEALTH_POLICY.app.nodeId, appSlug: CI_MAIN_HEALTH_POLICY.app.slug,
    workflowPath: CI_MAIN_HEALTH_POLICY.producer.workflowPath,
    workflowRef: `${CI_MAIN_HEALTH_POLICY.producer.workflowPath}@${MAIN}`,
    eventName: 'repository_dispatch', workflowRunId: '123',
    workflowRunDisplayTitle: `SEC main health ${MAIN} operation ${createCiMainHealthRequestOperationId(MAIN)}` }]
}));

// These are codec/consumer tests. No object below is a production live proof.
test('hosted integration retains exact existing provenance and ordinary-lane checks', () => {
  expect(() => assertIntegrationMainHealthProducer({ ...subject, ledger: hosted })).not.toThrow();
  for (const changed of [{ mainSha: '3'.repeat(40) }, { mainTreeSha: '4'.repeat(40) },
    { repository: 'other/repository' }, { now: '2026-10-05T12:10:00.001Z' }]) {
    expect(() => assertIntegrationMainHealthProducer({ ...subject, ...changed, ledger: hosted }))
      .toThrow('not fresh and ordinary');
  }
});

test('healthy local JSON and copied receipt data never acquire live integration authority', () => {
  // Keep owner-produced data and its plain JSON transport copy. Neither is a
  // live publication authority; cloning an already fabricated authority adds
  // no second admission boundary.
  for (const ledger of [local, JSON.parse(JSON.stringify(local))]) {
    expect(() => assertIntegrationMainHealthProducer({ ...subject, ledger }))
      .toThrow('original live publication admission');
    const fabricated = { authority: {}, receipt: { executionId: 'historical-data-only' },
      repositoryRoot: process.cwd() } as unknown as TrustedRuntimeMainHealthPublicationAdmission;
    expect(() => assertIntegrationMainHealthProducer({ ...subject, ledger, localAdmission: fabricated }))
      .toThrow('forged or not issued');
  }
});

test('expired local evidence is rejected before any local authority is consumed', () => {
  expect(() => assertIntegrationMainHealthProducer({ ...subject,
    now: '2026-10-05T12:10:00.001Z', ledger: local }))
    .toThrow('not fresh and ordinary');
});

test('a hosted observation cannot carry an out-of-band local admission to another producer lane', () => {
  expect(() => assertIntegrationMainHealthProducer({ ...subject, ledger: hosted,
    localAdmission: {} as TrustedRuntimeMainHealthPublicationAdmission }))
    .toThrow('fresh MainHealth producer provenance is not bound');
});

// Independent canonical provider fixture for the MainHealth consumer boundary.
function mainHealthCheck(overrides: Partial<GitHubCheckObservation> = {}): GitHubCheckObservation {
  const eventName = overrides.eventName ?? CI_MAIN_HEALTH_POLICY.producer.eventNames[0];
  const workflowRunDisplayTitle = CI_MAIN_HEALTH_POLICY.producer.runTitleFormats.repositoryDispatch
    .replace('<exact-main-sha>', MAIN)
    .replace('<request-operation-id>', createCiMainHealthRequestOperationId(MAIN));
  return {
    id: 7, name: CI_MAIN_HEALTH_POLICY.context, status: 'completed', conclusion: 'success',
    headSha: MAIN, detailsUrl: 'https://github.example/actions/runs/7', appId: CI_MAIN_HEALTH_POLICY.app.id,
    appNodeId: CI_MAIN_HEALTH_POLICY.app.nodeId, appSlug: CI_MAIN_HEALTH_POLICY.app.slug,
    workflowPath: CI_MAIN_HEALTH_POLICY.producer.workflowPath,
    workflowRef: `${CI_MAIN_HEALTH_POLICY.producer.workflowPath}@${MAIN}`,
    eventName,
    workflowRunId: '7',
    workflowRunDisplayTitle,
    ...overrides
  };
}

test('IssueDisposition post-main readback consumes the canonical exact MainHealth decision', () => {
  const common = {
    repository: 'sec-platform/sec', newMainSha: MAIN, newMainTreeSha: TREE,
    observedAt: '2026-08-09T14:00:00.000Z'
  };
  const dispatched = mainHealthCheck({ id: 8 });
  const single = compilePostMainIssueDispositionHealthReadback({ ...common, checks: [dispatched] });
  expect(single).toMatchObject({
    repository: common.repository, mainSha: common.newMainSha, mainTreeSha: common.newMainTreeSha,
    trustRevision: common.newMainSha, status: 'healthy', allowedLanes: ['ordinary'],
    producer: { sourceRunId: '7', sourceRef: `github-check-runs:${common.repository}@${MAIN}` }
  });
  for (const checks of [
    [mainHealthCheck({ appId: 1 })],
    [mainHealthCheck({ eventName: 'workflow_run' })],
    [dispatched, mainHealthCheck({ id: 9 })],
    [mainHealthCheck({ status: 'forged-status', conclusion: 'success' })],
    [mainHealthCheck({ eventName: 'push' })]
  ]) {
    expect(() => compilePostMainIssueDispositionHealthReadback({ ...common, checks }))
      .toThrow('canonical fresh healthy ordinary-only MainHealth');
  }
});
