import { expect, test } from 'bun:test';

import { createContentIdentityRuntime } from '../../bootstrap/content-identity-runtime.ts';
import { sha256 } from '../../contracts/canonical.ts';
import { parseDigest } from '../../contracts/digest.ts';
import {
  assertOperationFoundationV2,
  createOperationFoundationV2,
  isOperationAttemptNonceV2,
  parseOperationIdentityReference
} from './foundation-v2.ts';

const identityRuntime = createContentIdentityRuntime().identity;
const foundation = createOperationFoundationV2(identityRuntime);

const legacyRef = (domain: string, schema: string, value: unknown) => foundation.createReference({
  domain,
  schema,
  digest: sha256(value)
});
const currentRef = (domain: string, schema: string, value: unknown) => foundation.createReference({
  domain,
  schema,
  digest: identityRuntime.structuredIdentity(domain, schema, value).digest
});

function plan() {
  const contract = legacyRef('provider', 'typescript-project-check/v1', { noEmit: true });
  const attempt = foundation.issueAttemptContext({
    authorityGrant: legacyRef('authority', 'effect-grant/v1', { grant: 1 }),
    run: currentRef('runtime', 'run/v2', { run: 7 })
  });
  return foundation.compilePlan({
    operation: 'verification.typecheck',
    intent: currentRef('intent', 'verification/v2', { target: 'candidate' }),
    decision: currentRef('decision', 'typescript/v2', { noEmit: true }),
    deadlineAtUnixMs: 1_900_000_000_000,
    aggregateBudgets: [
      { resource: 'duration-ms', maximum: 120_000 },
      { resource: 'processes', maximum: 1 }
    ],
    requirements: [{
      id: 'typescript.project-check',
      contract,
      effectKinds: ['process'],
      failureKinds: ['provider.unavailable']
    }],
    attempt
  });
}

test('v2 operation foundation emits framed BLAKE3 identities while preserving referenced algorithms', () => {
  const compiled = plan();
  expect(compiled.identity.profile).toBe('blake3-256-canonical-json-v1');
  expect(compiled.identity.digest.startsWith('blake3:')).toBe(true);
  expect(compiled.execution.identity.digest.startsWith('blake3:')).toBe(true);
  expect(compiled.attempt.identity.digest.startsWith('blake3:')).toBe(true);
  expect(compiled.execution.requirements[0]!.contract.digest.startsWith('sha256:')).toBe(true);
  expect(compiled.attempt.authorityGrant.digest.startsWith('sha256:')).toBe(true);
  expect(compiled.attempt.run?.digest.startsWith('blake3:')).toBe(true);
});

test('v2 attempt nonce is entropy representation rather than a mislabeled digest', () => {
  const context = foundation.issueAttemptContext({
    authorityGrant: legacyRef('authority', 'grant/v1', 1)
  });
  expect(isOperationAttemptNonceV2(context.nonce)).toBe(true);
  expect(context.nonce.startsWith('sha256:')).toBe(false);
  expect(context.nonce.startsWith('blake3:')).toBe(false);
});

test('v2 operation and execution identities are deterministic while attempts remain attempt-specific', () => {
  const left = plan();
  const right = plan();
  expect(left.identity).toEqual(right.identity);
  expect(left.execution.identity).toEqual(right.execution.identity);
  expect(left.attempt.identity).not.toEqual(right.attempt.identity);
});

test('v2 binding keeps provider replacement outside the stable plan identity', () => {
  const compiled = plan();
  const requirement = compiled.execution.requirements[0]!;
  const first = foundation.compileBinding({
    requirementId: requirement.id,
    contract: requirement.contract,
    provider: currentRef('provider', 'typescript-native/v2', { build: 'a' })
  });
  const second = foundation.compileBinding({
    requirementId: requirement.id,
    contract: requirement.contract,
    provider: currentRef('provider', 'typescript-native/v2', { build: 'b' })
  });
  const boundA = foundation.bind(compiled, [first]);
  const boundB = foundation.bind(compiled, [second]);
  expect(boundA.plan.identity).toEqual(boundB.plan.identity);
  expect(boundA.plan.execution.identity).toEqual(boundB.plan.execution.identity);
  expect(boundA.bindingSetIdentity).not.toEqual(boundB.bindingSetIdentity);
  expect(boundA.boundAttemptIdentity).not.toEqual(boundB.boundAttemptIdentity);
});

test('v2 foundation rejects structural authority copies and mixed reference representations', () => {
  expect(() => assertOperationFoundationV2({ ...foundation })).toThrow(/owner-issued/u);
  const issued = foundation.issueAttemptContext({
    authorityGrant: legacyRef('authority', 'grant/v1', 1)
  });
  expect(() => foundation.compilePlan({
    operation: 'verification.typecheck',
    intent: currentRef('intent', 'verification/v2', 1),
    decision: currentRef('decision', 'verification/v2', 1),
    deadlineAtUnixMs: 1_900_000_000_000,
    aggregateBudgets: [{ resource: 'processes', maximum: 1 }],
    requirements: [{
      id: 'typescript.project-check',
      contract: legacyRef('provider', 'typescript/v1', 1),
      effectKinds: ['process'], failureKinds: ['provider.unavailable']
    }],
    attempt: { ...issued }
  })).toThrow(/not foundation-issued/u);

  expect(() => parseOperationIdentityReference({
    domain: 'authority', schema: 'grant/v1', digest: parseDigest(`sha256:${'a'.repeat(64)}`, 'sha256'), extra: true
  })).toThrow(/unknown fields/u);
  expect(() => parseOperationIdentityReference({
    domain: 'authority', schema: 'grant/v1', digest: `sha1:${'a'.repeat(40)}`
  })).toThrow(/supported canonical digest/u);
});
