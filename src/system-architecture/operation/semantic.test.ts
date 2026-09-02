import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { sha256 } from '../foundation/runtime/canonical.ts';
import {
  assertSecDomainReadbackReceipt,
  assertSecOwnerTerminalJoinReceipt,
  assertSecProviderSettlementReceipt,
  assertSecRecoveredRetryAdmission,
  assertSecSemanticOperationPlan,
  bindSecSemanticOperation,
  compileSecCapabilityBinding,
  compileSecProviderSettlementSet,
  compileSecSemanticOperationPlan,
  consumeSecRecoveredRetryAdmission,
  issueSecNormalDomainReadbackReceipt,
  issueSecNormalOwnerTerminalJoinReceipt,
  issueSecProviderSettlementReceipt,
  issueSecRecoveredDomainReadbackReceipt,
  issueSecRecoveredOwnerTerminalJoinReceipt,
  issueSecRecoveredRetryAdmission,
  issueSecSemanticOperationAttemptContext,
  projectSecCapabilityDiagnostic,
  type SecBoundSemanticOperation,
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

function multiPlan(
  attempt = issueSecSemanticOperationAttemptContext({
    authorityGrantDigest: digest('repository-publish-authority-grant')
  }),
  operation = 'repository.publish'
) {
  return compileSecSemanticOperationPlan({
    operation,
    intentDigest: digest({ target: 'candidate-ref' }),
    decisionDigest: digest({ mode: 'fast-forward' }),
    deadlineAtUnixMs: 1_900_000_000_000,
    aggregateBudgets: [
      { resource: 'duration-ms', maximum: 30_000 },
      { resource: 'processes', maximum: 2 }
    ],
    requirements: [
      {
        id: 'git.object-write',
        contractDigest: digest('git-object-write-contract'),
        effectKinds: ['persistent-state', 'process'],
        failureKinds: ['provider.unavailable']
      },
      {
        id: 'git.ref-update',
        contractDigest: digest('git-ref-update-contract'),
        effectKinds: ['persistent-state', 'process'],
        failureKinds: ['provider.conflict']
      }
    ],
    attempt
  });
}

function recoveryOperation(authority = 'repository-recovery-authority', epoch = 'resume-epoch') {
  return bindMultiPlan(multiPlan(issueSecSemanticOperationAttemptContext({
    authorityGrantDigest: digest(authority),
    runIdDigest: digest('recovery-run'),
    resumeEpochDigest: digest(epoch)
  })));
}

function predecessorReference(operation: SecBoundSemanticOperation) {
  return Object.freeze({
    operationIdentityDigest: operation.plan.identity.identityDigest,
    executionPlanDigest: operation.plan.execution.executionPlanDigest,
    bindingSetIdentityDigest: operation.bindingSetIdentityDigest,
    boundAttemptDigest: operation.boundAttemptDigest,
    attemptNonceDigest: operation.plan.attempt.attemptNonceDigest,
    authorityGrantDigest: operation.plan.attempt.authorityGrantDigest,
    resumeEpochDigest: operation.plan.attempt.resumeEpochDigest,
    deadlineAtUnixMs: operation.plan.attempt.deadlineAtUnixMs
  });
}

function bindMultiPlan(
  operationPlan = multiPlan(),
  providerSuffix = 'canonical'
): SecBoundSemanticOperation {
  return bindSecSemanticOperation(operationPlan, operationPlan.execution.requirements.map(
    (requirement) => compileSecCapabilityBinding({
      requirementId: requirement.id,
      contractDigest: requirement.contractDigest,
      providerIdentityDigest: digest(`${requirement.id}:${providerSuffix}`)
    })
  ));
}

function providerSettlement(
  operation: SecBoundSemanticOperation,
  requirementId: string,
  reference: string
) {
  return issueSecProviderSettlementReceipt(operation, {
    requirementId,
    physicalDisposition: 'settled',
    providerSettlementReferenceDigest: digest(reference)
  });
}

test('caller-compiled attempts and provider bindings remain pure correlation projections', () => {
  const firstPlan = plan();
  const first = bindSecSemanticOperation(firstPlan, [compileSecCapabilityBinding({
    requirementId: 'typescript.project-check',
    contractDigest: firstPlan.execution.requirements[0]!.contractDigest,
    providerIdentityDigest: digest('caller-selected-provider')
  })]);
  const secondPlan = plan();
  const second = bindSecSemanticOperation(secondPlan, [compileSecCapabilityBinding({
    requirementId: 'typescript.project-check',
    contractDigest: secondPlan.execution.requirements[0]!.contractDigest,
    providerIdentityDigest: digest('different-caller-selected-provider')
  })]);

  expect(first.plan.identity.identityDigest).toBe(second.plan.identity.identityDigest);
  expect(first.bindingSetIdentityDigest).not.toBe(second.bindingSetIdentityDigest);
  expect(first.boundAttemptDigest).not.toBe(second.boundAttemptDigest);

  const foreignRequirement = compileSecCapabilityBinding({
    requirementId: 'git.ref-update',
    contractDigest: firstPlan.execution.requirements[0]!.contractDigest,
    providerIdentityDigest: digest('caller-selected-provider')
  });
  expect(() => bindSecSemanticOperation(firstPlan, [foreignRequirement]))
    .toThrow('not exactly bound');
});

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

test('semantic budgets represent static ceilings and allow only an explicit zero input ceiling', () => {
  const zeroInput = compileSecSemanticOperationPlan({
    operation: 'verification.typecheck',
    intentDigest: digest('zero-input-operation'),
    decisionDigest: digest('zero-input-decision'),
    deadlineAtUnixMs: 1_900_000_000_000,
    aggregateBudgets: [
      { resource: 'duration-ms', maximum: 1_000 },
      { resource: 'input-bytes', maximum: 0 },
      { resource: 'output-bytes', maximum: 1 },
      { resource: 'processes', maximum: 1 }
    ],
    requirements: [{
      id: 'typescript.project-check',
      contractDigest: digest('zero-input-contract'),
      effectKinds: ['process'],
      failureKinds: ['provider.unavailable']
    }],
    attempt: issueSecSemanticOperationAttemptContext({
      authorityGrantDigest: digest('zero-input-grant')
    })
  });
  expect(zeroInput.execution.aggregateBudgets).toContainEqual({
    resource: 'input-bytes',
    maximum: 0
  });

  expect(() => compileSecSemanticOperationPlan({
    operation: 'verification.typecheck',
    intentDigest: digest('zero-output-operation'),
    decisionDigest: digest('zero-output-decision'),
    deadlineAtUnixMs: 1_900_000_000_000,
    aggregateBudgets: [{ resource: 'output-bytes', maximum: 0 }],
    requirements: [{
      id: 'typescript.project-check',
      contractDigest: digest('zero-output-contract'),
      effectKinds: ['process'],
      failureKinds: ['provider.unavailable']
    }],
    attempt: issueSecSemanticOperationAttemptContext({
      authorityGrantDigest: digest('zero-output-grant')
    })
  })).toThrow('aggregate budget is not canonical');

  expect(() => compileSecSemanticOperationPlan({
    operation: 'verification.typecheck',
    intentDigest: digest('runtime-ledger-operation'),
    decisionDigest: digest('runtime-ledger-decision'),
    deadlineAtUnixMs: 1_900_000_000_000,
    aggregateBudgets: [{
      resource: 'input-bytes',
      maximum: 0,
      consumed: 0
    } as never],
    requirements: [{
      id: 'typescript.project-check',
      contractDigest: digest('runtime-ledger-contract'),
      effectKinds: ['process'],
      failureKinds: ['provider.unavailable']
    }],
    attempt: issueSecSemanticOperationAttemptContext({
      authorityGrantDigest: digest('runtime-ledger-grant')
    })
  })).toThrow('aggregate budget is not canonical');
});

test('attempt context is compiler-local correlation rather than serializable authority', () => {
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
  })).toThrow('not foundation-compiled');
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

test('binding rejects a structural copy that bypasses the foundation compiler', () => {
  const operationPlan = plan();
  const binding = compileSecCapabilityBinding({
    requirementId: 'typescript.project-check',
    contractDigest: operationPlan.execution.requirements[0]!.contractDigest,
    providerIdentityDigest: digest('native-checker')
  });

  expect(() => assertSecSemanticOperationPlan(operationPlan)).not.toThrow();
  const structuralPlan = structuredClone(operationPlan);
  expect(() => assertSecSemanticOperationPlan(structuralPlan))
    .toThrow('requires a foundation-compiled operation plan');
  expect(() => bindSecSemanticOperation(structuralPlan, [binding]))
    .toThrow('requires a foundation-compiled operation plan');
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

test('provider settlement set is permutation-invariant and exact before normal readback', () => {
  const operation = bindMultiPlan();
  const objectWrite = providerSettlement(
    operation,
    'git.object-write',
    'object-write-settlement'
  );
  const refUpdate = providerSettlement(operation, 'git.ref-update', 'ref-update-settlement');
  const forward = compileSecProviderSettlementSet(operation, [objectWrite, refUpdate]);
  const reverse = compileSecProviderSettlementSet(operation, [refUpdate, objectWrite]);

  expect(forward.providerSettlementSetDigest).toBe(reverse.providerSettlementSetDigest);
  expect(forward.settlements.map(({ requirementId }) => requirementId)).toEqual([
    'git.object-write',
    'git.ref-update'
  ]);

  const readback = issueSecNormalDomainReadbackReceipt(operation, reverse, {
    readbackContractDigest: digest('repository-ref-readback-contract'),
    readbackReferenceDigest: digest('exact-ref-and-object-readback'),
    currentPhysicalEpochDigest: digest('repository-physical-epoch'),
    disposition: 'applied'
  });
  const join = issueSecNormalOwnerTerminalJoinReceipt(operation, forward, readback, {
    ownerTerminalContractDigest: digest('repository-publication-terminal-contract'),
    ownerTerminalReferenceDigest: digest('repository-publication-terminal-reference')
  });

  expect(readback.recoveryMode).toBe('normal');
  expect(join.providerSettlementSetDigest).toBe(forward.providerSettlementSetDigest);
  expect(JSON.stringify(join)).not.toMatch(/status|success|failed|completed/u);
  // These are canonical correlation projections, deliberately serializable
  // and cloneable; a domain Effect owner must require its own opaque receipt.
  expect(() => assertSecProviderSettlementReceipt({ ...objectWrite })).not.toThrow();
  expect(() => assertSecDomainReadbackReceipt({ ...readback })).not.toThrow();
  expect(() => assertSecOwnerTerminalJoinReceipt({ ...join })).not.toThrow();
});

test('provider settlement set rejects missing duplicate extra foreign attempts and bindings', () => {
  const operationPlan = multiPlan();
  const operation = bindMultiPlan(operationPlan);
  const objectWrite = providerSettlement(operation, 'git.object-write', 'object-write');
  const refUpdate = providerSettlement(operation, 'git.ref-update', 'ref-update');

  expect(() => compileSecProviderSettlementSet(operation, [objectWrite])).toThrow(
    'exactly one receipt per requirement'
  );
  expect(() => compileSecProviderSettlementSet(operation, [objectWrite, objectWrite])).toThrow(
    'exactly one receipt per requirement'
  );
  expect(() => compileSecProviderSettlementSet(
    operation,
    [objectWrite, refUpdate, objectWrite]
  )).toThrow('exactly one receipt per requirement');

  const otherAttempt = bindMultiPlan(multiPlan());
  const foreignAttemptRef = providerSettlement(otherAttempt, 'git.ref-update', 'foreign-attempt');
  expect(() => compileSecProviderSettlementSet(
    operation,
    [objectWrite, foreignAttemptRef]
  )).toThrow('does not bind the exact requirement attempt');

  const otherBinding = bindMultiPlan(operationPlan, 'alternate');
  const foreignBindingRef = providerSettlement(otherBinding, 'git.ref-update', 'foreign-binding');
  expect(otherBinding.plan.attempt.attemptDigest).toBe(operation.plan.attempt.attemptDigest);
  expect(otherBinding.bindings[1]!.bindingDigest).not.toBe(operation.bindings[1]!.bindingDigest);
  expect(() => compileSecProviderSettlementSet(
    operation,
    [objectWrite, foreignBindingRef]
  )).toThrow('does not bind the exact requirement attempt');
});

test('recovered readback joins owner terminal without manufacturing provider settlement', () => {
  const predecessor = bindMultiPlan();
  const operation = recoveryOperation();
  const recovered = issueSecRecoveredDomainReadbackReceipt(operation, {
    predecessor: predecessorReference(predecessor),
    durableObservationDigest: digest('durable-attempt-observation'),
    readbackContractDigest: digest('repository-ref-readback-contract'),
    readbackReferenceDigest: digest('recovered-exact-ref-readback'),
    currentPhysicalEpochDigest: digest('repository-epoch-after-lost-handle'),
    disposition: 'applied'
  });
  const join = issueSecRecoveredOwnerTerminalJoinReceipt(operation, recovered, {
    ownerTerminalContractDigest: digest('repository-publication-terminal-contract'),
    ownerTerminalReferenceDigest: digest('recovered-publication-terminal-reference')
  });

  expect(recovered.recoveryMode).toBe('recovered');
  expect(recovered.providerSettlementSetDigest).toBeNull();
  expect(join.recoveryMode).toBe('recovered');
  expect(join.providerSettlementSetDigest).toBeNull();
  expect(() => assertSecOwnerTerminalJoinReceipt(join)).not.toThrow();

  const objectWrite = providerSettlement(operation, 'git.object-write', 'object-write');
  const refUpdate = providerSettlement(operation, 'git.ref-update', 'ref-update');
  const settlementSet = compileSecProviderSettlementSet(operation, [objectWrite, refUpdate]);
  expect(() => issueSecNormalOwnerTerminalJoinReceipt(
    operation,
    settlementSet,
    recovered as never,
    {
      ownerTerminalContractDigest: digest('terminal-contract'),
      ownerTerminalReferenceDigest: digest('terminal-reference')
    }
  )).toThrow('requires its exact provider settlement set');
});

test('retry correlation is recovered-only and cannot authorize a foreign operation', () => {
  const operation = bindMultiPlan();
  const objectWrite = providerSettlement(operation, 'git.object-write', 'object-write');
  const refUpdate = providerSettlement(operation, 'git.ref-update', 'ref-update');
  const settlementSet = compileSecProviderSettlementSet(operation, [objectWrite, refUpdate]);
  const normal = issueSecNormalDomainReadbackReceipt(operation, settlementSet, {
    readbackContractDigest: digest('readback-contract'),
    readbackReferenceDigest: digest('normal-not-applied-readback'),
    currentPhysicalEpochDigest: digest('physical-epoch'),
    disposition: 'not-applied'
  });
  expect(() => issueSecRecoveredRetryAdmission(operation, normal as never)).toThrow(
    'conclusive recovered not-applied'
  );

  for (const disposition of ['applied', 'unknown'] as const) {
    const recovery = recoveryOperation(`recovery-${disposition}`, `epoch-${disposition}`);
    const inconclusive = issueSecRecoveredDomainReadbackReceipt(recovery, {
      predecessor: predecessorReference(operation),
      durableObservationDigest: digest(`durable-${disposition}`),
      readbackContractDigest: digest('readback-contract'),
      readbackReferenceDigest: digest(`readback-${disposition}`),
      currentPhysicalEpochDigest: digest('physical-epoch'),
      disposition
    });
    expect(() => issueSecRecoveredRetryAdmission(recovery, inconclusive)).toThrow(
      'conclusive recovered not-applied'
    );
  }

  const recovery = recoveryOperation();
  const notApplied = issueSecRecoveredDomainReadbackReceipt(recovery, {
    predecessor: predecessorReference(operation),
    durableObservationDigest: digest('durable-not-applied'),
    readbackContractDigest: digest('readback-contract'),
    readbackReferenceDigest: digest('readback-not-applied'),
    currentPhysicalEpochDigest: digest('physical-epoch'),
    disposition: 'not-applied'
  });
  const admission = issueSecRecoveredRetryAdmission(recovery, notApplied);
  expect(() => issueSecRecoveredRetryAdmission(recovery, notApplied)).toThrow('already consumed');
  expect(() => assertSecRecoveredRetryAdmission({ ...admission })).toThrow('projection is invalid');
  const foreignSuccessor = bindMultiPlan(multiPlan(
    issueSecSemanticOperationAttemptContext({
      authorityGrantDigest: digest('repository-repair-authority')
    }),
    'repository.repair'
  ));
  expect(() => consumeSecRecoveredRetryAdmission(
    admission, foreignSuccessor, notApplied.currentPhysicalEpochDigest
  )).toThrow(
    'does not authorize this successor attempt'
  );

  const successor = bindMultiPlan(multiPlan(issueSecSemanticOperationAttemptContext({
    authorityGrantDigest: recovery.plan.attempt.authorityGrantDigest,
    runIdDigest: digest('successor-run'),
    resumeEpochDigest: recovery.plan.attempt.resumeEpochDigest
  })));
  const authorityDriftSuccessor = bindMultiPlan(multiPlan(issueSecSemanticOperationAttemptContext({
    authorityGrantDigest: digest('foreign-recovery-authority'),
    runIdDigest: digest('authority-drift-run'),
    resumeEpochDigest: recovery.plan.attempt.resumeEpochDigest
  })));
  expect(() => consumeSecRecoveredRetryAdmission(
    admission, authorityDriftSuccessor, notApplied.currentPhysicalEpochDigest
  )).toThrow('does not authorize');
  const epochDriftSuccessor = bindMultiPlan(multiPlan(issueSecSemanticOperationAttemptContext({
    authorityGrantDigest: recovery.plan.attempt.authorityGrantDigest,
    runIdDigest: digest('epoch-drift-run'),
    resumeEpochDigest: digest('foreign-resume-epoch')
  })));
  expect(() => consumeSecRecoveredRetryAdmission(
    admission, epochDriftSuccessor, notApplied.currentPhysicalEpochDigest
  )).toThrow('does not authorize');
  expect(() => consumeSecRecoveredRetryAdmission(
    admission, successor, digest('foreign-physical-epoch')
  )).toThrow('does not authorize');
  expect(() => consumeSecRecoveredRetryAdmission(
    admission, successor, notApplied.currentPhysicalEpochDigest
  )).not.toThrow();
  expect(() => consumeSecRecoveredRetryAdmission(
    admission, bindMultiPlan(multiPlan()), notApplied.currentPhysicalEpochDigest
  ))
    .toThrow();
  expect(() => consumeSecRecoveredRetryAdmission(
    admission, successor, notApplied.currentPhysicalEpochDigest
  )).toThrow('already consumed');
  expect(() => issueSecRecoveredRetryAdmission(recovery, { ...notApplied }))
    .toThrow('conclusive recovered not-applied');
});
