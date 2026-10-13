import { expect, test } from 'bun:test';
import { createMainHealthLedger } from '../../src/adapters/self-hosting/control/main-health/contract.ts';
import { assertIntegrationMainHealthProducer, type TrustedRuntimeMainHealthPublicationAdmission } from '../../src/adapters/self-hosting/control/main-health/live-admission.ts';
import { createObservedMainHealthInput, createTrustedRuntimeMainHealthInput } from '../../src/adapters/self-hosting/control/main-health/main-health-observation.ts';
import { CI_MAIN_HEALTH_POLICY, createCiMainHealthRequestOperationId } from '../../src/adapters/self-hosting/control/main-health/provider-policy.ts';

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
    expect(() => assertIntegrationMainHealthProducer({ ...subject, ...changed, ledger: hosted })).toThrow();
  }
});

test('healthy local JSON and copied receipt data never acquire live integration authority', () => {
  for (const ledger of [local, structuredClone(local), JSON.parse(JSON.stringify(local))]) {
    expect(() => assertIntegrationMainHealthProducer({ ...subject, ledger }))
      .toThrow('original live publication admission');
    const fabricated = { authority: {}, receipt: { executionId: 'historical-data-only' },
      repositoryRoot: process.cwd() } as unknown as TrustedRuntimeMainHealthPublicationAdmission;
    for (const localAdmission of [fabricated, structuredClone(fabricated)]) {
      expect(() => assertIntegrationMainHealthProducer({ ...subject, ledger, localAdmission }))
        .toThrow('forged or not issued');
    }
  }
});

test('expired or different-subject local evidence is rejected before any local authority is consumed', () => {
  for (const changed of [{ now: '2026-10-05T12:10:00.001Z' }, { mainSha: '3'.repeat(40) },
    { mainTreeSha: '4'.repeat(40) }, { repository: 'other/repository' }]) {
    expect(() => assertIntegrationMainHealthProducer({ ...subject, ...changed, ledger: local }))
      .toThrow('not fresh and ordinary');
  }
});

test('a hosted observation cannot carry an out-of-band local admission to another producer lane', () => {
  expect(() => assertIntegrationMainHealthProducer({ ...subject, ledger: hosted,
    localAdmission: {} as TrustedRuntimeMainHealthPublicationAdmission }))
    .toThrow('fresh MainHealth producer provenance is not bound');
});
