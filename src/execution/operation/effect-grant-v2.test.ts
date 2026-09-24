import { expect, test } from 'bun:test';

import { createContentIdentityRuntime } from '../../bootstrap/content-identity-runtime.ts';
import { sha256 } from '../../contracts/canonical.ts';
import { createOperationEffectGrantAuthorityV2, OperationEffectGrantErrorV2 } from './effect-grant-v2.ts';
import { createOperationFoundationV2 } from './foundation-v2.ts';

const identityRuntime = createContentIdentityRuntime().identity;
const foundation = createOperationFoundationV2(identityRuntime);
const ref = (domain: string, schema: string, value: unknown) => foundation.createReference({
  domain, schema, digest: sha256(value)
});

function intent() {
  return foundation.compileIntent({
    operation: 'development.commit',
    intent: ref('intent', 'development-commit/v1', { candidate: 1 }),
    decision: ref('decision', 'development-commit/v1', { message: 'm' }),
    aggregateBudgets: [{ resource: 'processes', maximum: 1 }],
    requirements: [{
      id: 'repository.commit',
      contract: ref('provider', 'git-commit/v1', { exact: true }),
      effectKinds: ['filesystem', 'process'],
      failureKinds: ['provider.failed']
    }]
  });
}

function authority() {
  return createOperationEffectGrantAuthorityV2({
    foundation,
    identities: identityRuntime,
    semanticOperation: 'development.commit',
    issuer: ref('authority', 'development-commit-admission/v2', { owner: 'admission' })
  });
}

test('effect grant v2 binds one foundation-issued intent to one attempt without serializable authority', () => {
  const owner = authority();
  const operation = intent();
  const epoch = ref('runtime', 'development-commit-epoch/v1', { epoch: 1 });
  const deadlineAtUnixMs = Date.now() + 30_000;
  const issued = owner.issuer.issue({ operation, currentEpoch: epoch, deadlineAtUnixMs });
  expect(issued.authorityGrant.digest.startsWith('blake3:')).toBe(true);
  expect(Object.keys(issued.grant)).toEqual([]);
  const plan = foundation.compilePlan({
    operation: operation.operation,
    intent: operation.intent,
    decision: operation.decision,
    deadlineAtUnixMs,
    aggregateBudgets: operation.execution.aggregateBudgets,
    requirements: operation.execution.requirements,
    attempt: foundation.issueAttemptContext({ authorityGrant: issued.authorityGrant })
  });
  const consumed = owner.consumer.consume({ grant: issued.grant, operation: plan, currentEpoch: epoch });
  expect(consumed.identity.digest.startsWith('blake3:')).toBe(true);
  expect(() => owner.consumer.consume({ grant: issued.grant, operation: plan, currentEpoch: epoch }))
    .toThrow(OperationEffectGrantErrorV2);
});

test('effect grant v2 rejects structural copies, epoch drift and foreign authorities', () => {
  const owner = authority();
  const operation = intent();
  const epoch = ref('runtime', 'development-commit-epoch/v1', { epoch: 1 });
  const deadlineAtUnixMs = Date.now() + 30_000;
  const issued = owner.issuer.issue({ operation, currentEpoch: epoch, deadlineAtUnixMs });
  expect(() => owner.issuer.issue({ operation: { ...operation }, currentEpoch: epoch, deadlineAtUnixMs }))
    .toThrow(/not foundation-issued/u);
  const plan = foundation.compilePlan({
    operation: operation.operation,
    intent: operation.intent,
    decision: operation.decision,
    deadlineAtUnixMs,
    aggregateBudgets: operation.execution.aggregateBudgets,
    requirements: operation.execution.requirements,
    attempt: foundation.issueAttemptContext({ authorityGrant: issued.authorityGrant })
  });
  expect(() => owner.consumer.consume({
    grant: issued.grant,
    operation: plan,
    currentEpoch: ref('runtime', 'development-commit-epoch/v1', { epoch: 2 })
  })).toThrow(/epoch/u);
  const foreign = authority();
  expect(() => foreign.consumer.consume({ grant: issued.grant, operation: plan, currentEpoch: epoch }))
    .toThrow(/not issued by this authority/u);
});
