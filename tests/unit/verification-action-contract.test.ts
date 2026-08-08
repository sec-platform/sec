import { expect, test } from 'bun:test';

import {
  createVerificationActionKeyV2,
  createVerificationActionPlanV2,
  createVerificationActionTerminalV2,
  encodeVerificationActionDataV2,
  isVerificationActionRunnableV2,
  parseVerificationActionKeyV2,
  verificationActionDependsOnChangedInputsV2,
  type VerificationActionKeyInputV2
} from '../../scripts/codex/verification-action-contract.ts';

const DIGEST_A = `sha256:${'a'.repeat(64)}` as const;
const DIGEST_B = `sha256:${'b'.repeat(64)}` as const;
const DIGEST_C = `sha256:${'c'.repeat(64)}` as const;

function actionInput(overrides: Partial<VerificationActionKeyInputV2> = {}): VerificationActionKeyInputV2 {
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

function planFor(action: ReturnType<typeof createVerificationActionKeyV2>) {
  const dependencies = [
    ...action.requiredCheapPreflightActionKeys.map((actionKey) => ({ actionKey, kind: 'cheap-preflight' as const })),
    ...action.upstreamActionKeys.map((actionKey) => ({ actionKey, kind: 'upstream' as const }))
  ];
  return createVerificationActionPlanV2({
    action,
    executionClass: action.requiredCheapPreflightActionKeys.length > 0 ? 'expensive' : 'cheap-preflight',
    dependencies
  });
}

test('ActionKey canonicalizes set-like closure and excludes scheduler lane identity', () => {
  const first = createVerificationActionKeyV2(actionInput());
  const second = createVerificationActionKeyV2(actionInput({
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
  expect(parseVerificationActionKeyV2(encodeVerificationActionDataV2(first))).toEqual(first);
  expect(first.operation).not.toHaveProperty('executionClass');
  expect(planFor(first).executionClass).toBe('expensive');
});

test('semantic closure, producer, provider and contract changes change ActionKey', () => {
  const baseline = createVerificationActionKeyV2(actionInput());
  expect(createVerificationActionKeyV2(actionInput({
    inputClosure: [{ path: 'scripts/codex/example.ts', digest: DIGEST_C }]
  })).actionKey).not.toBe(baseline.actionKey);
  expect(createVerificationActionKeyV2(actionInput({
    producer: { identity: 'sec-verification-action-test', revision: 'r2' }
  })).actionKey).not.toBe(baseline.actionKey);
  expect(createVerificationActionKeyV2(actionInput({
    operation: {
      identity: 'bun-test',
      revision: 'normalizer-v1',
      semanticDigest: DIGEST_C,
      workingDirectory: '.',
      declaredEnvironment: [{ name: 'CI', digest: DIGEST_A }]
    }
  })).actionKey).not.toBe(baseline.actionKey);
  expect(createVerificationActionKeyV2(actionInput({
    environment: {
      toolchainRevision: 'bun@1.3.15',
      providerRevision: 'local-windows',
      contractRevision: 'verification-result-v1'
    }
  })).actionKey).not.toBe(baseline.actionKey);
  expect(createVerificationActionKeyV2(actionInput({
    upstreamActionKeys: [DIGEST_B]
  })).actionKey).not.toBe(baseline.actionKey);
  const loneSurrogate = createVerificationActionKeyV2(actionInput({
    producer: { identity: '\uD800', revision: 'r1' }
  }));
  const replacementCharacter = createVerificationActionKeyV2(actionInput({
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
  expect(() => createVerificationActionKeyV2(getterInput)).toThrow(/data property|accessors/);

  const proxied = new Proxy(actionInput(), {
    ownKeys: () => { throw new Error('proxy ownKeys executed'); }
  });
  expect(() => createVerificationActionKeyV2(proxied)).toThrow(/ordinary data|inspect|proxies/);
  const transparentProxy = new Proxy(actionInput(), {});
  expect(() => createVerificationActionKeyV2(transparentProxy)).toThrow('proxies are forbidden');

  const symbolInput = actionInput() as Record<PropertyKey, unknown>;
  symbolInput[Symbol('identity')] = 'forbidden';
  expect(() => createVerificationActionKeyV2(symbolInput)).toThrow('symbol properties are forbidden');

  const customPrototype = Object.create({ inherited: true }) as Record<string, unknown>;
  Object.assign(customPrototype, actionInput());
  expect(() => createVerificationActionKeyV2(customPrototype)).toThrow('object prototype is noncanonical');

  const toJsonInput = actionInput() as Record<string, unknown>;
  toJsonInput.toJSON = () => ({ actionKind: 'spoofed' });
  expect(() => createVerificationActionKeyV2(toJsonInput)).toThrow('toJSON is forbidden');

  const cyclic = actionInput() as Record<string, unknown>;
  cyclic.cycle = cyclic;
  expect(() => createVerificationActionKeyV2(cyclic)).toThrow('cyclic reference');
});

test('V1 key wire records are deterministically rejected after schema migration', () => {
  const key = createVerificationActionKeyV2(actionInput());
  const oldWire = { ...key, schema: 'sec-verification-action-key-v1' };
  expect(() => parseVerificationActionKeyV2(encodeVerificationActionDataV2(oldWire)))
    .toThrow('V1 journals/keys are not reusable');
});

test('cheap preflight topology is exact, caller state is never accepted, and lane is derived', () => {
  const dependency = createVerificationActionKeyV2(actionInput({
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
  const action = createVerificationActionKeyV2(actionInput({
    requiredCheapPreflightActionKeys: [dependency.actionKey],
    upstreamActionKeys: []
  }));
  expect(() => createVerificationActionPlanV2({
    action,
    executionClass: 'cheap-preflight',
    dependencies: [{ actionKey: dependency.actionKey, kind: 'cheap-preflight' }]
  })).toThrow('must match required cheap-preflight topology');
  expect(() => createVerificationActionPlanV2({
    action,
    executionClass: 'expensive',
    dependencies: []
  })).toThrow('cheap-preflight dependencies must exactly match');
  expect(() => createVerificationActionPlanV2({
    action,
    executionClass: 'expensive',
    dependencies: [{ actionKey: dependency.actionKey, kind: 'cheap-preflight', state: 'terminal-passed' } as never]
  })).toThrow('must contain exactly');
  const plan = planFor(action);
  expect(isVerificationActionRunnableV2(plan)).toEqual({
    runnable: false,
    reason: expect.stringContaining('cheap-preflight')
  });
  expect(isVerificationActionRunnableV2(plan, [{
    actionKey: dependency.actionKey,
    state: 'terminal-passed'
  }])).toEqual({ runnable: true, reason: null });
  expect(verificationActionDependsOnChangedInputsV2(
    action,
    ['docs/work-packages/example-v1.md']
  )).toBe(true);
  expect(verificationActionDependsOnChangedInputsV2(action, ['tests/unit/other.test.ts'])).toBe(false);
  expect(verificationActionDependsOnChangedInputsV2(action, null)).toBe(true);
});

test('terminal action adapts canonical result status without adding a reuse status', () => {
  expect(createVerificationActionTerminalV2({
    status: 'passed',
    reasonCode: 'executed-success',
    resultDigest: DIGEST_A
  })).toEqual({
    status: 'passed',
    reasonCode: 'executed-success',
    resultDigest: DIGEST_A
  });
  expect(() => createVerificationActionTerminalV2({
    status: 'passed',
    reasonCode: 'executed-failure',
    resultDigest: null
  })).toThrow('passed status requires reasonCode executed-success');
  expect(createVerificationActionTerminalV2({
    status: 'failed',
    reasonCode: 'timeout',
    resultDigest: null
  }).reasonCode).toBe('timeout');
  expect(createVerificationActionTerminalV2({
    status: 'failed',
    reasonCode: 'cleanup-failed',
    resultDigest: null
  }).reasonCode).toBe('cleanup-failed');
  expect(createVerificationActionTerminalV2({
    status: 'failed',
    reasonCode: 'process-settlement-failed',
    resultDigest: null
  }).reasonCode).toBe('process-settlement-failed');
  expect(createVerificationActionTerminalV2({
    status: 'not-run',
    reasonCode: 'not-dispatched',
    resultDigest: null
  }).status).toBe('not-run');
  expect(() => createVerificationActionTerminalV2({
    status: 'not-run',
    reasonCode: 'timeout',
    resultDigest: null
  })).toThrow('not-run status requires a not-run reasonCode');
});
