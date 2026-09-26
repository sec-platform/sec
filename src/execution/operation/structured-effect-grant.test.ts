import { expect, test } from 'bun:test';

import { createContentIdentityRuntime } from '../../bootstrap/content-identity-runtime.ts';
import { sha256 } from '../../contracts/canonical.ts';
import { createOperationEffectGrantAuthority, OperationEffectGrantError } from './structured-effect-grant.ts';
import { createOperationFoundation } from './identity-foundation.ts';

const identityRuntime = createContentIdentityRuntime().identity;
const foundation = createOperationFoundation(identityRuntime);
const ref = (domain: string, schema: string, value: unknown) => foundation.createReference({
  domain, schema, digest: sha256(value)
});

function intent() {
  return foundation.compileIntent({
    operation: 'development.commit',
    intent: ref('intent', 'development-commit', { candidate: 1 }),
    decision: ref('decision', 'development-commit', { message: 'm' }),
    aggregateBudgets: [{ resource: 'processes', maximum: 1 }],
    requirements: [{
      id: 'repository.commit',
      contract: ref('provider', 'git-commit', { exact: true }),
      effectKinds: ['filesystem', 'process'],
      failureKinds: ['provider.failed']
    }]
  });
}

function authority() {
  return createOperationEffectGrantAuthority({
    foundation,
    identities: identityRuntime,
    semanticOperation: 'development.commit',
    issuer: ref('authority', 'development-commit-admission', { owner: 'admission' })
  });
}

test('effect grant binds one foundation-issued intent to one attempt without serializable authority', () => {
  const owner = authority();
  const operation = intent();
  const epoch = ref('runtime', 'development-commit-epoch', { epoch: 1 });
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
    .toThrow(OperationEffectGrantError);
});

test('effect grant rejects structural copies, epoch drift and foreign authorities', () => {
  const owner = authority();
  const operation = intent();
  const epoch = ref('runtime', 'development-commit-epoch', { epoch: 1 });
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
    currentEpoch: ref('runtime', 'development-commit-epoch', { epoch: 2 })
  })).toThrow(/epoch/u);
  const foreign = authority();
  expect(() => foreign.consumer.consume({ grant: issued.grant, operation: plan, currentEpoch: epoch }))
    .toThrow(/not issued by this authority/u);
});
