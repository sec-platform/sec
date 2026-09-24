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

function twoRequirementPlan() {
  const attempt = foundation.issueAttemptContext({
    authorityGrant: legacyRef('authority', 'effect-grant/v1', { grant: 2 })
  });
  const compiled = foundation.compilePlan({
    operation: 'verification.multi-check',
    intent: currentRef('intent', 'verification/v2', { target: 'candidate' }),
    decision: currentRef('decision', 'multi-check/v2', { selected: true }),
    deadlineAtUnixMs: 1_900_000_000_000,
    aggregateBudgets: [{ resource: 'processes', maximum: 2 }],
    requirements: [
      { id: 'provider.alpha', contract: legacyRef('provider', 'alpha/v1', 1), effectKinds: ['process'], failureKinds: [] },
      { id: 'provider.beta', contract: currentRef('provider', 'beta/v2', 2), effectKinds: ['provider'], failureKinds: [] }
    ],
    attempt
  });
  const bindings = compiled.execution.requirements.map((requirement) => foundation.compileBinding({
    requirementId: requirement.id,
    contract: requirement.contract,
    provider: currentRef('provider-instance', `${requirement.id}/v2`, { selected: requirement.id })
  }));
  return foundation.bind(compiled, bindings);
}

test('v2 provider settlement set is exact and permutation-invariant', () => {
  const operation = twoRequirementPlan();
  const settlements = operation.plan.execution.requirements.map((requirement) => foundation.issueProviderSettlement(
    operation,
    {
      requirementId: requirement.id,
      physicalDisposition: 'settled',
      providerSettlementReference: legacyRef('provider-receipt', `${requirement.id}/v1`, { ok: true })
    }
  ));
  const forward = foundation.compileProviderSettlementSet(operation, settlements);
  const reversed = foundation.compileProviderSettlementSet(operation, [...settlements].reverse());
  expect(forward.identity).toEqual(reversed.identity);
  expect(forward.identity.digest.startsWith('blake3:')).toBe(true);
  expect(forward.settlements.map(({ requirementId }) => requirementId)).toEqual(['provider.alpha', 'provider.beta']);
  expect(() => foundation.compileProviderSettlementSet(operation, settlements.slice(0, 1))).toThrow(/exactly one/u);
  expect(() => foundation.compileProviderSettlementSet(operation, [{ ...settlements[0]! }, settlements[1]!]))
    .toThrow(/exact attempt/u);
});

test('v2 normal readback and terminal join bind the exact settlement set', () => {
  const operation = twoRequirementPlan();
  const settlements = operation.plan.execution.requirements.map((requirement) => foundation.issueProviderSettlement(
    operation,
    {
      requirementId: requirement.id,
      physicalDisposition: 'settled',
      providerSettlementReference: currentRef('provider-receipt', `${requirement.id}/v2`, { ok: true })
    }
  ));
  const set = foundation.compileProviderSettlementSet(operation, settlements);
  const readback = foundation.issueNormalReadback(operation, set, {
    readbackContract: legacyRef('readback-contract', 'workspace/v1', { exact: true }),
    readbackReference: currentRef('readback', 'workspace/v2', { applied: true }),
    currentPhysicalEpoch: legacyRef('physical-epoch', 'workspace/v1', { epoch: 3 }),
    disposition: 'applied'
  });
  const terminal = foundation.issueNormalTerminalJoin(operation, set, readback, {
    ownerTerminalContract: legacyRef('owner-terminal', 'contract/v1', { terminal: true }),
    ownerTerminalReference: currentRef('owner-terminal', 'reference/v2', { result: 'done' })
  });
  expect(readback.identity.digest.startsWith('blake3:')).toBe(true);
  expect(terminal.identity.digest.startsWith('blake3:')).toBe(true);
  const other = twoRequirementPlan();
  expect(() => foundation.issueNormalReadback(other, set, {
    readbackContract: legacyRef('readback-contract', 'workspace/v1', 1),
    readbackReference: legacyRef('readback', 'workspace/v1', 1),
    currentPhysicalEpoch: legacyRef('physical-epoch', 'workspace/v1', 1),
    disposition: 'applied'
  })).toThrow(/exact provider settlement/u);
});

test('v2 recovered readback is single-consumer and retry admission authorizes only the exact successor lineage', () => {
  const base = plan();
  const requirement = base.execution.requirements[0]!;
  const binding = foundation.compileBinding({
    requirementId: requirement.id,
    contract: requirement.contract,
    provider: currentRef('provider', 'typescript-native/v2', { build: 'recovery' })
  });
  const predecessor = foundation.bind(base, [binding]);
  const recoveryAuthority = legacyRef('authority', 'effect-grant/v1', { grant: 'recovery' });
  const recoveryEpoch = currentRef('recovery', 'epoch/v2', { epoch: 4 });
  const recoveryPlan = foundation.compilePlan({
    operation: base.operation,
    intent: base.intent,
    decision: base.decision,
    deadlineAtUnixMs: 1_900_000_000_000,
    aggregateBudgets: base.execution.aggregateBudgets,
    requirements: base.execution.requirements,
    attempt: foundation.issueAttemptContext({ authorityGrant: recoveryAuthority, resumeEpoch: recoveryEpoch })
  });
  const recovery = foundation.bind(recoveryPlan, [binding]);
  const physicalEpoch = currentRef('physical-epoch', 'workspace/v2', { epoch: 9 });
  const readback = foundation.issueRecoveredReadback(recovery, {
    predecessor: {
      operationIdentity: predecessor.plan.identity,
      executionIdentity: predecessor.plan.execution.identity,
      bindingSetIdentity: predecessor.bindingSetIdentity,
      boundAttemptIdentity: predecessor.boundAttemptIdentity,
      nonce: predecessor.plan.attempt.nonce,
      authorityGrant: predecessor.plan.attempt.authorityGrant,
      resumeEpoch: predecessor.plan.attempt.resumeEpoch,
      deadlineAtUnixMs: predecessor.plan.attempt.deadlineAtUnixMs
    },
    durableObservation: legacyRef('recovery-observation', 'journal/v1', { observed: true }),
    readbackContract: currentRef('readback-contract', 'workspace/v2', { exact: true }),
    readbackReference: currentRef('readback', 'workspace/v2', { applied: false }),
    currentPhysicalEpoch: physicalEpoch,
    disposition: 'not-applied'
  });
  const admission = foundation.issueRecoveredRetryAdmission(recovery, readback);
  expect(admission.identity.digest.startsWith('blake3:')).toBe(true);
  expect(() => foundation.issueRecoveredTerminalJoin(recovery, readback, {
    ownerTerminalContract: legacyRef('owner-terminal', 'contract/v1', 1),
    ownerTerminalReference: legacyRef('owner-terminal', 'reference/v1', 1)
  })).toThrow(/unconsumed/u);

  const successorPlan = foundation.compilePlan({
    operation: base.operation,
    intent: base.intent,
    decision: base.decision,
    deadlineAtUnixMs: 1_899_999_999_999,
    aggregateBudgets: base.execution.aggregateBudgets,
    requirements: base.execution.requirements,
    attempt: foundation.issueAttemptContext({ authorityGrant: recoveryAuthority, resumeEpoch: recoveryEpoch })
  });
  const successor = foundation.bind(successorPlan, [binding]);
  foundation.consumeRecoveredRetryAdmission(admission, successor, physicalEpoch);
  expect(() => foundation.consumeRecoveredRetryAdmission(admission, successor, physicalEpoch)).toThrow(/already consumed/u);
});
