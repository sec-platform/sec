import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { sha256 } from '../foundation/runtime/canonical.ts';
import {
  assertSecOperationSettlementEnvelope,
  bindSecSemanticOperation,
  compileSecCapabilityBinding,
  compileSecSemanticOperationPlan,
  issueSecDomainOutcomeReceipt,
  issueSecOperationSettlementEnvelope,
  issueSecProviderSettlementReceipt,
  issueSecSemanticOperationAttemptContext,
  projectSecCapabilityDiagnostic,
  type SecOperationDigest
} from './semantic.ts';

const digest = (value: unknown): SecOperationDigest => sha256(value) as SecOperationDigest;

function plan(
  deadlineAtUnixMs = 1_900_000_000_000,
  durationMs = 120_000,
  attempt = issueSecSemanticOperationAttemptContext({
    authorityGrantDigest: digest('verification-typecheck-authority-grant')
  })
) {
  return compileSecSemanticOperationPlan({
    operation: 'verification.typecheck',
    intentDigest: digest({ target: 'candidate' }),
    decisionDigest: digest({ noEmit: true }),
    deadlineAtUnixMs,
    aggregateBudgets: [
      { resource: 'duration-ms', maximum: durationMs },
      { resource: 'output-bytes', maximum: 16 * 1024 * 1024 },
      { resource: 'processes', maximum: 1 }
    ],
    requirements: [{
      id: 'typescript.project-check',
      contractDigest: digest({ semantics: 'no-emit-project-check' }),
      effectKinds: ['process'],
      failureKinds: ['provider.unavailable', 'provider.unverified']
    }],
    attempt
  });
}

function bound(deadlineAtUnixMs = 1_900_000_000_000) {
  const operationPlan = plan(deadlineAtUnixMs);
  return bindSecSemanticOperation(operationPlan, [compileSecCapabilityBinding({
    requirementId: 'typescript.project-check',
    contractDigest: operationPlan.execution.requirements[0]!.contractDigest,
    providerIdentityDigest: digest('native-checker')
  })]);
}

test('semantic plan remains provider-neutral while exact bindings are replaceable', () => {
  const operationPlan = plan();
  const native = compileSecCapabilityBinding({
    requirementId: 'typescript.project-check',
    contractDigest: operationPlan.execution.requirements[0]!.contractDigest,
    providerIdentityDigest: digest('native-checker')
  });
  const remote = compileSecCapabilityBinding({
    requirementId: 'typescript.project-check',
    contractDigest: operationPlan.execution.requirements[0]!.contractDigest,
    providerIdentityDigest: digest('remote-checker')
  });

  const nativeOperation = bindSecSemanticOperation(operationPlan, [native]);
  const remoteOperation = bindSecSemanticOperation(operationPlan, [remote]);
  expect(nativeOperation.plan.identity.identityDigest).toBe(remoteOperation.plan.identity.identityDigest);
  expect(nativeOperation.bindingSetIdentityDigest).not.toBe(remoteOperation.bindingSetIdentityDigest);
});

test('operation identity excludes the attempt deadline while the attempt remains deadline-bound', () => {
  const first = plan(1_900_000_000_000);
  const second = plan(1_900_000_000_001);
  expect(first.identity.identityDigest).toBe(second.identity.identityDigest);
  expect(first.attempt.attemptDigest).not.toBe(second.attempt.attemptDigest);
  expect(first.attempt.deadlineAtUnixMs).toBe(1_900_000_000_000);
  expect(second.attempt.deadlineAtUnixMs).toBe(1_900_000_000_001);
});

test('budget narrowing and attempt lineage never manufacture a new OperationKey', () => {
  const lineage = issueSecSemanticOperationAttemptContext({
    authorityGrantDigest: digest('verification-typecheck-authority-grant'),
    runIdDigest: digest('run-1'),
    resumeEpochDigest: digest('resume-1')
  });
  const first = plan(1_900_000_000_000, 120_000, lineage);
  const narrowed = plan(1_900_000_000_000, 60_000, lineage);
  const retried = plan(1_900_000_000_000, 120_000);

  expect(first.identity.identityDigest).toBe(narrowed.identity.identityDigest);
  expect(first.identity.identityDigest).toBe(retried.identity.identityDigest);
  expect(first.execution.executionPlanDigest).not.toBe(narrowed.execution.executionPlanDigest);
  expect(first.attempt.attemptDigest).not.toBe(narrowed.attempt.attemptDigest);
  expect(first.attempt.attemptNonceDigest).not.toBe(retried.attempt.attemptNonceDigest);
  expect(first.attempt.attemptDigest).not.toBe(retried.attempt.attemptDigest);
});

test('attempt context is an owner-issued capability rather than serializable authority', () => {
  const issued = issueSecSemanticOperationAttemptContext({
    authorityGrantDigest: digest('verification-typecheck-authority-grant')
  });
  const structural = structuredClone(issued);
  expect(() => compileSecSemanticOperationPlan({
    operation: 'verification.typecheck',
    intentDigest: digest({ target: 'candidate' }),
    decisionDigest: digest({ noEmit: true }),
    deadlineAtUnixMs: 1_900_000_000_000,
    aggregateBudgets: [{ resource: 'processes', maximum: 1 }],
    requirements: [{
      id: 'typescript.project-check',
      contractDigest: digest({ semantics: 'no-emit-project-check' }),
      effectKinds: ['process'],
      failureKinds: ['provider.unavailable']
    }],
    attempt: structural
  })).toThrow('not owner-issued');
});

test('binding rejects missing, duplicate and semantic-contract mismatches', () => {
  const operationPlan = plan();
  const wrong = compileSecCapabilityBinding({
    requirementId: 'typescript.project-check',
    contractDigest: digest('different-semantics'),
    providerIdentityDigest: digest('native-checker')
  });
  expect(() => bindSecSemanticOperation(operationPlan, [])).toThrow(/exactly one binding/u);
  expect(() => bindSecSemanticOperation(operationPlan, [wrong])).toThrow(/not exactly bound/u);
  expect(() => bindSecSemanticOperation(operationPlan, [wrong, wrong])).toThrow(/exactly one binding/u);
});

test('provider diagnostics expose typed identity and digest without raw evidence', () => {
  const operationPlan = plan();
  const binding = compileSecCapabilityBinding({
    requirementId: 'typescript.project-check',
    contractDigest: operationPlan.execution.requirements[0]!.contractDigest,
    providerIdentityDigest: digest('native-checker')
  });
  const raw = 'C:\\secret\\workspace --token visible-only-to-provider';
  const diagnostic = projectSecCapabilityDiagnostic({
    bindingDigest: binding.bindingDigest,
    code: 'typescript.provider-unverified',
    failureKind: 'provider.unverified',
    rawEvidence: raw
  });
  expect(JSON.stringify(diagnostic)).not.toContain(raw);
  expect(diagnostic.evidenceByteLength).toBeGreaterThan(0);
  expect(diagnostic.evidenceDigest).toBe(
    `sha256:${createHash('sha256').update(raw).digest('hex')}`
  );
});

test('settlement is owner-issued, attempt-bound and commits the opaque domain receipt', () => {
  const first = bound(1_900_000_000_000);
  const second = bound(1_900_000_000_001);
  const sharedObservation = { status: 'exited', exitCode: 0 };
  const firstProvider = issueSecProviderSettlementReceipt(first, {
    terminalClass: 'completed',
    providerSettlement: sharedObservation
  });
  const firstOutcome = issueSecDomainOutcomeReceipt(firstProvider, {
    terminalClass: 'completed',
    effectReadback: sharedObservation,
    domainOutcome: sharedObservation
  });
  const secondProvider = issueSecProviderSettlementReceipt(second, {
    terminalClass: 'completed',
    providerSettlement: { status: 'exited', exitCode: 0 }
  });
  const secondOutcome = issueSecDomainOutcomeReceipt(secondProvider, {
    terminalClass: 'completed',
    effectReadback: { candidateTree: digest('tree-after-effect') },
    domainOutcome: { status: 'passed', diagnosticCount: 0 }
  });
  const firstSettlement = issueSecOperationSettlementEnvelope(
    first,
    firstProvider,
    firstOutcome
  );
  const secondSettlement = issueSecOperationSettlementEnvelope(
    second,
    secondProvider,
    secondOutcome
  );

  expect(first.plan.identity.identityDigest).toBe(second.plan.identity.identityDigest);
  expect(first.boundAttemptDigest).not.toBe(second.boundAttemptDigest);
  expect(firstSettlement.settlementDigest).not.toBe(secondSettlement.settlementDigest);
  expect(new Set([
    firstSettlement.effectSettlementDigest,
    firstSettlement.effectReadbackDigest,
    firstSettlement.domainReceiptDigest
  ]).size).toBe(3);
  expect(() => assertSecOperationSettlementEnvelope(firstSettlement)).not.toThrow();
  expect(() => assertSecOperationSettlementEnvelope({ ...firstSettlement })).toThrow(
    'not owner-issued'
  );
});

test('settlement rejects structural clones, cross-attempt receipts and terminal upgrades', () => {
  const operation = bound();
  const provider = issueSecProviderSettlementReceipt(operation, {
    terminalClass: 'completed',
    providerSettlement: { status: 'exited', exitCode: 0 }
  });
  const domain = issueSecDomainOutcomeReceipt(provider, {
    terminalClass: 'completed',
    effectReadback: { exactTree: digest('tree') },
    domainOutcome: { status: 'passed' }
  });

  expect(() => issueSecDomainOutcomeReceipt({ ...provider }, {
    terminalClass: 'completed',
    effectReadback: { exactTree: digest('tree') },
    domainOutcome: { status: 'passed' }
  })).toThrow('not provider-issued');
  expect(() => issueSecOperationSettlementEnvelope(operation, provider, {
    ...domain
  })).toThrow('not domain-issued');

  const failedProvider = issueSecProviderSettlementReceipt(operation, {
    terminalClass: 'failed',
    providerSettlement: { status: 'exited', exitCode: 1 }
  });
  expect(() => issueSecDomainOutcomeReceipt(failedProvider, {
    terminalClass: 'completed',
    effectReadback: { exactTree: digest('tree') },
    domainOutcome: { status: 'passed' }
  })).toThrow('cannot upgrade');

  const structuralOperation = { ...operation };
  expect(() => issueSecOperationSettlementEnvelope(
    structuralOperation,
    provider,
    domain
  )).toThrow('owner-issued bound semantic operation');

  const otherOperation = bound(1_900_000_000_001);
  expect(() => issueSecOperationSettlementEnvelope(
    otherOperation,
    provider,
    domain
  )).toThrow('do not bind the exact operation attempt');
});
