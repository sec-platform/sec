import { expect, test } from 'bun:test';
import type { VerificationActionKeyInput } from '../../../src/execution/verification/action.ts';

import {
  createBoundedProcessDiagnosticObjectReceipt
} from '../../../src/adapters/runtime-state/workspace-state/bounded-process-diagnostic-contract.ts';
import { createVerificationActionKey, createVerificationActionPlan, createVerificationActionTerminal, encodeVerificationActionData, issueNonProcessVerificationActionTerminalSettlement, issueProcessVerificationActionTerminalSettlement, issueVerificationActionOwnerTerminalReceipt, isVerificationActionRunnable, parseVerificationActionKey, projectVerificationActionTerminal, VERIFICATION_ACTION_PROCESS_RESOURCE_POLICY, verificationActionDependsOnChangedInputs } from '../../../src/adapters/verification/platform/action/contract/action.ts';
import { sha256 } from '../../../src/contracts/canonical.ts';
import {
  bindSemanticOperation,
  compileCapabilityBinding,
  compileProviderSettlementSet,
  compileSemanticOperationPlan,
  issueNormalDomainReadbackReceipt,
  issueNormalOwnerTerminalJoinReceipt,
  issueProviderSettlementReceipt,
  issueSemanticOperationAttemptContext
} from '../../../src/execution/operation/semantic.ts';

const DIGEST_A = `sha256:${'a'.repeat(64)}` as const;
const DIGEST_B = `sha256:${'b'.repeat(64)}` as const;
const DIGEST_C = `sha256:${'c'.repeat(64)}` as const;

function diagnosticObject(boundAttemptDigest: typeof DIGEST_A | typeof DIGEST_B) {
  const receipt = createBoundedProcessDiagnosticObjectReceipt({
    operationIdentityDigest: DIGEST_A,
    executionPlanDigest: DIGEST_B,
    boundAttemptDigest,
    subjectDigest: DIGEST_C,
    settlementDigest: DIGEST_A,
    stream: 'stderr',
    bytes: new TextEncoder().encode('diagnostic'),
    retainedUntilUnixMs: 1_900_000_100_000
  });
  const readbackUnsigned = {
    disposition: 'current' as const,
    objectDigest: receipt.objectDigest,
    physicalIdentityDigest: DIGEST_B,
    contentDigest: receipt.contentDigest,
    byteLength: receipt.byteLength
  };
  return Object.freeze({
    receipt,
    readback: Object.freeze({
      ...readbackUnsigned,
      readbackDigest: sha256(readbackUnsigned)
    })
  });
}

function settlement(
  status: 'passed' | 'failed',
  deadlineAtUnixMs = 1_900_000_000_000
) {
  const plan = compileSemanticOperationPlan({
    operation: 'verification.action-test',
    intentDigest: DIGEST_A,
    decisionDigest: DIGEST_B,
    deadlineAtUnixMs,
    aggregateBudgets: [{ resource: 'processes', maximum: 1 }],
    requirements: [{
      id: 'verification.test-effect',
      contractDigest: DIGEST_C,
      effectKinds: ['process'],
      failureKinds: ['process.failed']
    }],
    attempt: issueSemanticOperationAttemptContext({
      authorityGrantDigest: DIGEST_C
    })
  });
  const bound = bindSemanticOperation(plan, [compileCapabilityBinding({
    requirementId: 'verification.test-effect',
    contractDigest: DIGEST_C,
    providerIdentityDigest: DIGEST_B
  })]);
  const provider = issueProviderSettlementReceipt(bound, {
    requirementId: 'verification.test-effect',
    physicalDisposition: 'settled',
    providerSettlementReferenceDigest: status === 'passed' ? DIGEST_A : DIGEST_B
  });
  const providerSet = compileProviderSettlementSet(bound, [provider]);
  const readback = issueNormalDomainReadbackReceipt(bound, providerSet, {
    readbackContractDigest: DIGEST_A,
    readbackReferenceDigest: DIGEST_B,
    currentPhysicalEpochDigest: DIGEST_C,
    disposition: 'applied'
  });
  const join = issueNormalOwnerTerminalJoinReceipt(bound, providerSet, readback, {
    ownerTerminalContractDigest: DIGEST_B,
    ownerTerminalReferenceDigest: status === 'passed' ? DIGEST_A : DIGEST_C
  });
  const action = createVerificationActionKey(actionInput({
    operation: {
      ...actionInput().operation,
      semanticDigest: bound.plan.identity.identityDigest
    }
  }));
  const ownerTerminalReceipt = issueVerificationActionOwnerTerminalReceipt({
    action,
    operation: bound,
    providerSettlementSet: providerSet,
    readback,
    ownerTerminalProjection: join
  });
  return issueNonProcessVerificationActionTerminalSettlement(ownerTerminalReceipt, {
    status,
    reasonCode: status === 'passed' ? 'executed-success' : 'executed-failure'
  });
}

function actionInput(overrides: Partial<VerificationActionKeyInput> = {}): VerificationActionKeyInput {
  return {
    actionKind: 'focused-contract',
    producer: { identity: 'sec-verification-action-test', revision: 'r1' },
    operation: {
      identity: 'bun-test',
      revision: 'normalizer-v1',
      semanticDigest: DIGEST_B,
      workingDirectory: '.',
      declaredEnvironment: [{ name: 'CI', digest: DIGEST_A }]
    },
    inputClosure: [
      { path: 'config/repository/work-packages/example-v1.md', digest: DIGEST_A },
      { path: 'scripts/codex/example.ts', digest: DIGEST_B }
    ],
    environment: {
      toolchainRevision: 'bun@1.3.14',
      providerRevision: 'local-windows',
      contractRevision: 'verification-result-v1'
    },
    requiredCheapPreflightActionKeys: [DIGEST_A],
    upstreamActionKeys: [DIGEST_C],
    resultSchemaRevision: 'sec-verification-result-v1',
    ...overrides
  };
}

function planFor(action: ReturnType<typeof createVerificationActionKey>) {
  const dependencies = [
    ...action.requiredCheapPreflightActionKeys.map((actionKey) => ({ actionKey, kind: 'cheap-preflight' as const })),
    ...action.upstreamActionKeys.map((actionKey) => ({ actionKey, kind: 'upstream' as const }))
  ];
  return createVerificationActionPlan({
    action,
    executionClass: action.requiredCheapPreflightActionKeys.length > 0 ? 'expensive' : 'cheap-preflight',
    dependencies
  });
}

test('ActionKey canonicalizes set-like closure and excludes scheduler lane identity', () => {
  const first = createVerificationActionKey(actionInput());
  const second = createVerificationActionKey(actionInput({
    operation: {
      identity: 'bun-test',
      revision: 'normalizer-v1',
      semanticDigest: DIGEST_B,
      workingDirectory: '.',
      declaredEnvironment: [{ name: 'CI', digest: DIGEST_A }]
    },
    inputClosure: [
      { path: 'scripts/codex/example.ts', digest: DIGEST_B },
      { path: 'config/repository/work-packages/example-v1.md', digest: DIGEST_A }
    ],
    upstreamActionKeys: [DIGEST_C]
  }));
  expect(first.actionKey).toBe(second.actionKey);
  expect(first.inputClosure.map(({ path }) => path)).toEqual([
    'config/repository/work-packages/example-v1.md',
    'scripts/codex/example.ts'
  ]);
  expect(parseVerificationActionKey(encodeVerificationActionData(first))).toEqual(first);
  expect(first.operation).not.toHaveProperty('executionClass');
  expect(planFor(first).executionClass).toBe('expensive');
});

test('semantic closure, producer, provider and contract changes change ActionKey', () => {
  const baseline = createVerificationActionKey(actionInput());
  expect(createVerificationActionKey(actionInput({
    inputClosure: [{ path: 'scripts/codex/example.ts', digest: DIGEST_C }]
  })).actionKey).not.toBe(baseline.actionKey);
  expect(createVerificationActionKey(actionInput({
    producer: { identity: 'sec-verification-action-test', revision: 'r2' }
  })).actionKey).not.toBe(baseline.actionKey);
  expect(createVerificationActionKey(actionInput({
    operation: {
      identity: 'bun-test',
      revision: 'normalizer-v1',
      semanticDigest: DIGEST_C,
      workingDirectory: '.',
      declaredEnvironment: [{ name: 'CI', digest: DIGEST_A }]
    }
  })).actionKey).not.toBe(baseline.actionKey);
  expect(createVerificationActionKey(actionInput({
    environment: {
      toolchainRevision: 'bun@1.3.15',
      providerRevision: 'local-windows',
      contractRevision: 'verification-result-v1'
    }
  })).actionKey).not.toBe(baseline.actionKey);
  expect(createVerificationActionKey(actionInput({
    upstreamActionKeys: [DIGEST_B]
  })).actionKey).not.toBe(baseline.actionKey);
  const loneSurrogate = createVerificationActionKey(actionInput({
    producer: { identity: '\uD800', revision: 'r1' }
  }));
  const replacementCharacter = createVerificationActionKey(actionInput({
    producer: { identity: '\uFFFD', revision: 'r1' }
  }));
  expect(loneSurrogate.actionKey).not.toBe(replacementCharacter.actionKey);
});

test('Action terminal preserves owner issuance, strict parsing, and process diagnostic requirements', () => {
  const completed = settlement('passed');
  const terminal = projectVerificationActionTerminal(completed);
  expect(terminal.status).toBe('passed');
  expect(terminal.executionKind).toBe('non-process');
  expect(terminal.boundAttemptDigest).toBe(
    completed.ownerTerminalReceipt.attempt.boundAttemptDigest
  );
  expect(terminal.ownerTerminalReceiptDigest).toBe(
    completed.ownerTerminalReceipt.terminalReceiptDigest
  );
  expect(terminal.diagnosticObjects).toEqual([]);
  expect(terminal.resultDigest).not.toBe(completed.ownerTerminalReceipt.terminalReceiptDigest);
  const failedSettlement = settlement('failed', 1_900_000_000_001);
  expect(completed.ownerTerminalReceipt.decision.actionKey)
    .toBe(failedSettlement.ownerTerminalReceipt.decision.actionKey);
  expect(completed.ownerTerminalReceipt.decision.operationIdentityDigest)
    .toBe(failedSettlement.ownerTerminalReceipt.decision.operationIdentityDigest);
  expect(completed.ownerTerminalReceipt.attempt.boundAttemptDigest)
    .not.toBe(failedSettlement.ownerTerminalReceipt.attempt.boundAttemptDigest);
  expect(completed.ownerTerminalReceipt.terminalReceiptDigest)
    .not.toBe(failedSettlement.ownerTerminalReceipt.terminalReceiptDigest);
  const failed = projectVerificationActionTerminal(failedSettlement);
  expect(failed.status).toBe('failed');
  expect(() => projectVerificationActionTerminal({
    status: 'passed',
    reasonCode: 'executed-success',
    resultDigest: null
  })).toThrow('not Verification-owner-issued');
  expect(() => projectVerificationActionTerminal({ ...completed }))
    .toThrow('not Verification-owner-issued');
  expect(createVerificationActionTerminal(terminal)).toEqual(terminal);
  expect(createVerificationActionTerminal(failed)).toEqual(failed);
  expect(() => createVerificationActionTerminal({
    ...terminal,
    reasonCode: 'executed-failure',
  })).toThrow('passed status requires reasonCode executed-success');
  expect(() => createVerificationActionTerminal({
    ...terminal,
    resultDigest: DIGEST_A
  })).toThrow('does not bind the terminal attempt and diagnostics');
  expect(() => createVerificationActionTerminal({
    ...terminal,
    unexpected: true
  })).toThrow('must contain exactly');
  expect(() => issueProcessVerificationActionTerminalSettlement(
    completed.ownerTerminalReceipt,
    { status: 'passed', reasonCode: 'executed-success', diagnosticObjects: [] }
  )).toThrow('must contain owner-issued diagnostic evidence');
});

test('Action terminal rejects a diagnostic receipt from another bound attempt', () => {
  const diagnosticObjects = [diagnosticObject(DIGEST_B)];
  const unsigned = {
    actionKey: DIGEST_C,
    executionKind: 'process' as const,
    status: 'failed' as const,
    reasonCode: 'executed-failure' as const,
    boundAttemptDigest: DIGEST_A,
    ownerTerminalReceiptDigest: DIGEST_A,
    diagnosticObjects
  };
  expect(() => createVerificationActionTerminal({
    ...unsigned,
    resultDigest: sha256({
      ...unsigned,
      diagnosticObjects: diagnosticObjects.map(({ receipt, readback }) => ({
        objectDigest: receipt.objectDigest,
        readbackDigest: readback.readbackDigest
      }))
    })
  })).toThrow('different operation attempt');
});

test('Action process resource policy is one immutable single-process bounded execution contract', () => {
  expect(Object.isFrozen(VERIFICATION_ACTION_PROCESS_RESOURCE_POLICY)).toBe(true);
  expect(VERIFICATION_ACTION_PROCESS_RESOURCE_POLICY.processes).toBe(1);
  expect(VERIFICATION_ACTION_PROCESS_RESOURCE_POLICY.durationMs).toBeGreaterThan(0);
  expect(VERIFICATION_ACTION_PROCESS_RESOURCE_POLICY.maxStdoutBytes).toBeGreaterThan(0);
  expect(VERIFICATION_ACTION_PROCESS_RESOURCE_POLICY.maxStderrBytes).toBeGreaterThan(0);
});

test('strict ordinary-data boundary rejects getters, proxies, symbols, custom prototypes, toJSON and cycles', () => {
  const getterInput = actionInput();
  Object.defineProperty(getterInput.operation, 'identity', {
    get: () => { throw new Error('getter executed'); },
    enumerable: true
  });
  expect(() => createVerificationActionKey(getterInput)).toThrow(/data property|accessors/);

  const proxied = new Proxy(actionInput(), {
    ownKeys: () => { throw new Error('proxy ownKeys executed'); }
  });
  expect(() => createVerificationActionKey(proxied)).toThrow(/ordinary data|inspect|proxies/);
  const transparentProxy = new Proxy(actionInput(), {});
  expect(() => createVerificationActionKey(transparentProxy)).toThrow('proxies are forbidden');

  const symbolInput = actionInput() as Record<PropertyKey, unknown>;
  symbolInput[Symbol('identity')] = 'forbidden';
  expect(() => createVerificationActionKey(symbolInput)).toThrow('symbol properties are forbidden');

  const customPrototype = Object.create({ inherited: true }) as Record<string, unknown>;
  Object.assign(customPrototype, actionInput());
  expect(() => createVerificationActionKey(customPrototype)).toThrow('object prototype is noncanonical');

  const toJsonInput = actionInput() as Record<string, unknown>;
  toJsonInput.toJSON = () => ({ actionKind: 'spoofed' });
  expect(() => createVerificationActionKey(toJsonInput)).toThrow('toJSON is forbidden');

  const cyclic = actionInput() as Record<string, unknown>;
  cyclic.cycle = cyclic;
  expect(() => createVerificationActionKey(cyclic)).toThrow('cyclic reference');
});

test('cheap preflight topology is exact, caller state is never accepted, and lane is derived', () => {
  const dependency = createVerificationActionKey(actionInput({
    actionKind: 'identity-preflight',
    operation: {
      identity: 'bun-test',
      revision: 'normalizer-v1',
      semanticDigest: DIGEST_B,
      workingDirectory: '.',
      declaredEnvironment: [{ name: 'CI', digest: DIGEST_A }]
    },
    requiredCheapPreflightActionKeys: [],
    upstreamActionKeys: []
  }));
  const action = createVerificationActionKey(actionInput({
    requiredCheapPreflightActionKeys: [dependency.actionKey],
    upstreamActionKeys: []
  }));
  expect(() => createVerificationActionPlan({
    action,
    executionClass: 'cheap-preflight',
    dependencies: [{ actionKey: dependency.actionKey, kind: 'cheap-preflight' }]
  })).toThrow('must match required cheap-preflight topology');
  expect(() => createVerificationActionPlan({
    action,
    executionClass: 'expensive',
    dependencies: []
  })).toThrow('cheap-preflight dependencies must exactly match');
  expect(() => createVerificationActionPlan({
    action,
    executionClass: 'expensive',
    dependencies: [{ actionKey: dependency.actionKey, kind: 'cheap-preflight', state: 'terminal-passed' } as never]
  })).toThrow('must contain exactly');
  const plan = planFor(action);
  expect(isVerificationActionRunnable(plan)).toEqual({
    runnable: false,
    reason: expect.stringContaining('cheap-preflight')
  });
  expect(isVerificationActionRunnable(plan, [{
    actionKey: dependency.actionKey,
    state: 'terminal-passed'
  }])).toEqual({ runnable: true, reason: null });
  expect(verificationActionDependsOnChangedInputs(
    action,
    ['config/repository/work-packages/example-v1.md']
  )).toBe(true);
  expect(verificationActionDependsOnChangedInputs(action, ['tests/unit/other.test.ts'])).toBe(false);
  expect(verificationActionDependsOnChangedInputs(action, null)).toBe(true);
});
