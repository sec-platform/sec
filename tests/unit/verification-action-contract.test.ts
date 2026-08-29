import { expect, test } from 'bun:test';

import { createVerificationActionKey, createVerificationActionPlan, createVerificationActionTerminal, encodeVerificationActionData, isVerificationActionRunnable, parseVerificationActionKey, verificationActionDependsOnChangedInputs, type VerificationActionKeyInput } from '../../src/verification/action/contract/action.ts';
import { CodexDevelopmentAssertVerificationGateResult } from '../../src/verification/result/contract/result.ts';
import { VERIFICATION_GATE_RESULT_SCHEMA } from '../../src/verification/result/contract/schema.ts';

const DIGEST_A = `sha256:${'a'.repeat(64)}` as const;
const DIGEST_B = `sha256:${'b'.repeat(64)}` as const;
const DIGEST_C = `sha256:${'c'.repeat(64)}` as const;

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
      { path: 'docs/work-packages/example-v1.md', digest: DIGEST_A },
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
      { path: 'docs/work-packages/example-v1.md', digest: DIGEST_A }
    ],
    upstreamActionKeys: [DIGEST_C]
  }));
  expect(first.actionKey).toBe(second.actionKey);
  expect(first.inputClosure.map(({ path }) => path)).toEqual([
    'docs/work-packages/example-v1.md',
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
    ['docs/work-packages/example-v1.md']
  )).toBe(true);
  expect(verificationActionDependsOnChangedInputs(action, ['tests/unit/other.test.ts'])).toBe(false);
  expect(verificationActionDependsOnChangedInputs(action, null)).toBe(true);
});

test('terminal action adapts canonical result status without adding a reuse status', () => {
  expect(createVerificationActionTerminal({
    status: 'passed',
    reasonCode: 'executed-success',
    resultDigest: DIGEST_A
  })).toEqual({
    status: 'passed',
    reasonCode: 'executed-success',
    resultDigest: DIGEST_A
  });
  expect(() => createVerificationActionTerminal({
    status: 'passed',
    reasonCode: 'executed-failure',
    resultDigest: null
  })).toThrow('passed status requires reasonCode executed-success');
  expect(createVerificationActionTerminal({
    status: 'failed',
    reasonCode: 'timeout',
    resultDigest: null
  }).reasonCode).toBe('timeout');
  expect(createVerificationActionTerminal({
    status: 'failed',
    reasonCode: 'cleanup-failed',
    resultDigest: null
  }).reasonCode).toBe('cleanup-failed');
  expect(createVerificationActionTerminal({
    status: 'failed',
    reasonCode: 'process-settlement-failed',
    resultDigest: null
  }).reasonCode).toBe('process-settlement-failed');
  expect(createVerificationActionTerminal({
    status: 'not-run',
    reasonCode: 'not-dispatched',
    resultDigest: null
  }).status).toBe('not-run');
  expect(() => createVerificationActionTerminal({
    status: 'not-run',
    reasonCode: 'timeout',
    resultDigest: null
  })).toThrow('not-run status requires a not-run reasonCode');
});

test('canonical Result preserves known failed reuse without promotion', () => {
  const reusedFailure = {
    schema: VERIFICATION_GATE_RESULT_SCHEMA, gateId: 'gate', gateRevision: 'v1', owner: 'owner',
    requirementKey: 'required', subjectRevision: 'subject', inputDigest: DIGEST_A,
    applicability: 'required', status: 'failed', disposition: 'reused', reasonCode: 'executed-failure',
    requiredForClaims: ['claim'], supportedClaims: [],
    environment: { runtime: 'bun', os: 'windows', arch: 'x64', filesystem: null, capabilities: [],
      toolchainRevision: 'bun@1.3.14', providerRevisions: [] },
    execution: null, evidenceRefs: ['evidence://original-failure'], invalidationRules: [], diagnostic: null
  };
  expect(() => CodexDevelopmentAssertVerificationGateResult(reusedFailure)).not.toThrow();
  expect(() => CodexDevelopmentAssertVerificationGateResult({ ...reusedFailure, status: 'passed',
    reasonCode: 'executed-failure' })).toThrow('passed status requires');
  expect(() => CodexDevelopmentAssertVerificationGateResult({ ...reusedFailure,
    evidenceRefs: [] })).toThrow('non-empty evidenceRefs');
  expect(() => CodexDevelopmentAssertVerificationGateResult({ ...reusedFailure,
    environment: null })).toThrow('non-null environment');
});
