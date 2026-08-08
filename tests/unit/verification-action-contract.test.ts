import { expect, test } from 'bun:test';

import {
  createVerificationActionKeyV1,
  createVerificationActionPlanV1,
  createVerificationActionTerminalV1,
  isVerificationActionRunnableV1,
  parseVerificationActionKeyV1,
  verificationActionDependsOnChangedInputsV1,
  type VerificationActionKeyInputV1
} from '../../scripts/codex/verification-action-contract.ts';

const DIGEST_A = `sha256:${'a'.repeat(64)}` as const;
const DIGEST_B = `sha256:${'b'.repeat(64)}` as const;
const DIGEST_C = `sha256:${'c'.repeat(64)}` as const;

function actionInput(overrides: Partial<VerificationActionKeyInputV1> = {}): VerificationActionKeyInputV1 {
  return {
    actionKind: 'focused-contract',
    producer: { identity: 'sec-verification-action-test', revision: 'r1' },
    operation: {
      identity: 'bun-test',
      revision: 'normalizer-v1',
      semanticDigest: DIGEST_B,
      workingDirectory: '.',
      executionClass: 'expensive',
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

test('ActionKey canonicalizes set-like closure and environment ordering', () => {
  const first = createVerificationActionKeyV1(actionInput());
  const second = createVerificationActionKeyV1(actionInput({
    operation: {
      identity: 'bun-test',
      revision: 'normalizer-v1',
      semanticDigest: DIGEST_B,
      workingDirectory: '.',
      executionClass: 'expensive',
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
  expect(parseVerificationActionKeyV1(JSON.stringify(first))).toEqual(first);
});

test('semantic closure, producer, provider and contract changes change ActionKey', () => {
  const baseline = createVerificationActionKeyV1(actionInput());
  expect(createVerificationActionKeyV1(actionInput({
    inputClosure: [{ path: 'scripts/codex/example.ts', digest: DIGEST_C }]
  })).actionKey).not.toBe(baseline.actionKey);
  expect(createVerificationActionKeyV1(actionInput({
    producer: { identity: 'sec-verification-action-test', revision: 'r2' }
  })).actionKey).not.toBe(baseline.actionKey);
  expect(createVerificationActionKeyV1(actionInput({
    operation: {
      identity: 'bun-test',
      revision: 'normalizer-v1',
      semanticDigest: DIGEST_C,
      workingDirectory: '.',
      executionClass: 'expensive',
      declaredEnvironment: [{ name: 'CI', digest: DIGEST_A }]
    }
  })).actionKey).not.toBe(baseline.actionKey);
  expect(createVerificationActionKeyV1(actionInput({
    environment: {
      toolchainRevision: 'bun@1.3.15',
      providerRevision: 'local-windows',
      contractRevision: 'verification-result-v1'
    }
  })).actionKey).not.toBe(baseline.actionKey);
  expect(createVerificationActionKeyV1(actionInput({
    operation: {
      identity: 'bun-test',
      revision: 'normalizer-v1',
      semanticDigest: DIGEST_B,
      workingDirectory: 'scripts',
      executionClass: 'expensive',
      declaredEnvironment: [{ name: 'CI', digest: DIGEST_A }]
    }
  })).actionKey).not.toBe(baseline.actionKey);
  expect(createVerificationActionKeyV1(actionInput({
    upstreamActionKeys: [DIGEST_B]
  })).actionKey).not.toBe(baseline.actionKey);
});

test('identity rejects duplicate closure refs, raw operation selectors and foreign identity fields', () => {
  expect(() => createVerificationActionKeyV1(actionInput({
    inputClosure: [
      { path: 'scripts/codex/example.ts', digest: DIGEST_A },
      { path: 'scripts/codex/example.ts', digest: DIGEST_B }
    ]
  }))).toThrow('duplicate path');
  expect(() => createVerificationActionKeyV1(actionInput({
    operation: {
      identity: 'bun-test',
      revision: 'normalizer-v1',
      semanticDigest: DIGEST_A,
      workingDirectory: '.',
      executionClass: 'expensive',
      argv: ['--cwd=C:/Users/QzCrane/AppData/Local/Temp/run'],
      declaredEnvironment: []
    }
  } as never))).toThrow('forbidden semantic identity field argv');
  expect(() => createVerificationActionKeyV1(actionInput({
    operation: {
      identity: 'bun-test',
      revision: 'normalizer-v1',
      semanticDigest: DIGEST_A,
      workingDirectory: 'C:/outside',
      executionClass: 'expensive',
      declaredEnvironment: []
    }
  }))).toThrow('repository-relative directory');
  expect(() => createVerificationActionKeyV1(actionInput({
    requiredCheapPreflightActionKeys: []
  }))).toThrow('expensive actions must declare');
  expect(() => createVerificationActionKeyV1(actionInput({
    requiredCheapPreflightActionKeys: [DIGEST_C],
    upstreamActionKeys: [DIGEST_C]
  }))).toThrow('sets cannot overlap');
  expect(() => createVerificationActionKeyV1(actionInput({
    operation: {
      identity: 'bun-test',
      revision: 'normalizer-v1',
      semanticDigest: DIGEST_A,
      workingDirectory: 'scripts/',
      executionClass: 'expensive',
      declaredEnvironment: []
    }
  }))).toThrow('repository-relative directory');
  expect(() => createVerificationActionKeyV1(actionInput({
    operation: {
      identity: 'bun-test',
      revision: 'normalizer-v1',
      semanticDigest: DIGEST_A,
      workingDirectory: 'C:outside',
      executionClass: 'expensive',
      declaredEnvironment: []
    }
  }))).toThrow('repository-relative directory');
  expect(() => createVerificationActionKeyV1(actionInput({
    operation: {
      identity: 'bun-test',
      revision: 'normalizer-v1',
      semanticDigest: DIGEST_A,
      workingDirectory: '//server/share',
      executionClass: 'expensive',
      declaredEnvironment: []
    }
  }))).toThrow('repository-relative directory');
  expect(() => createVerificationActionKeyV1(actionInput({
    operation: {
      identity: 'bun-test',
      revision: 'normalizer-v1',
      semanticDigest: DIGEST_A,
      workingDirectory: '.',
      executionClass: 'expensive',
      branch: 'feature/ephemeral',
      declaredEnvironment: []
    }
  } as never))).toThrow('forbidden semantic identity field branch');
  expect(() => createVerificationActionKeyV1({
    ...actionInput(),
    branchName: 'feature/not-identity'
  } as VerificationActionKeyInputV1)).toThrow('forbidden semantic identity field');
});

test('cheap preflight gates expensive execution and input invalidation stays dependency-local', () => {
  const dependency = createVerificationActionKeyV1(actionInput({
    actionKind: 'identity-preflight',
    operation: {
      identity: 'bun-test',
      revision: 'normalizer-v1',
      semanticDigest: DIGEST_B,
      workingDirectory: '.',
      executionClass: 'cheap-preflight',
      declaredEnvironment: [{ name: 'CI', digest: DIGEST_A }]
    },
    requiredCheapPreflightActionKeys: []
  }));
  const action = createVerificationActionKeyV1(actionInput({
    upstreamActionKeys: [],
    requiredCheapPreflightActionKeys: [dependency.actionKey]
  }));
  expect(() => createVerificationActionPlanV1({
    action,
    expensive: true,
    dependencies: []
  })).toThrow('cheap-preflight dependencies must exactly match');
  expect(() => createVerificationActionPlanV1({
    action,
    expensive: 'true' as never,
    dependencies: []
  })).toThrow('expensive must be a boolean');
  expect(() => createVerificationActionPlanV1({
    action,
    expensive: false,
    dependencies: [{ actionKey: dependency.actionKey, kind: 'cheap-preflight' }]
  })).toThrow('must match action executionClass expensive');
  expect(() => createVerificationActionPlanV1({
    action,
    expensive: true,
    dependencies: [{ actionKey: action.actionKey, kind: 'upstream' }]
  })).toThrow('cannot contain the action itself');
  const upstream = createVerificationActionKeyV1(actionInput({
    actionKind: 'upstream',
    operation: {
      identity: 'bun-test',
      revision: 'normalizer-v1',
      semanticDigest: DIGEST_B,
      workingDirectory: '.',
      executionClass: 'cheap-preflight',
      declaredEnvironment: [{ name: 'CI', digest: DIGEST_A }]
    },
    requiredCheapPreflightActionKeys: []
  }));
  const actionWithUpstream = createVerificationActionKeyV1(actionInput({
    upstreamActionKeys: [upstream.actionKey],
    operation: {
      identity: 'bun-test',
      revision: 'normalizer-v1',
      semanticDigest: DIGEST_B,
      workingDirectory: '.',
      executionClass: 'cheap-preflight',
      declaredEnvironment: [{ name: 'CI', digest: DIGEST_A }]
    },
    requiredCheapPreflightActionKeys: []
  }));
  expect(() => createVerificationActionPlanV1({
    action: actionWithUpstream,
    dependencies: []
  })).toThrow('upstream dependencies must exactly match');
  expect(() => createVerificationActionPlanV1({
    action: action,
    expensive: true,
    dependencies: [{ actionKey: upstream.actionKey, kind: 'upstream' }]
  })).toThrow('upstream dependencies must exactly match');
  expect(() => createVerificationActionPlanV1({
    action,
    dependencies: [{ actionKey: upstream.actionKey, kind: 'cheap-preflight', state: 'terminal-passed' } as never]
  })).toThrow('must contain exactly');
  const otherDependency = createVerificationActionKeyV1(actionInput({
    actionKind: 'other-preflight',
    operation: {
      identity: 'bun-test',
      revision: 'normalizer-v1',
      semanticDigest: DIGEST_C,
      workingDirectory: '.',
      executionClass: 'cheap-preflight',
      declaredEnvironment: [{ name: 'CI', digest: DIGEST_A }]
    },
    requiredCheapPreflightActionKeys: []
  }));
  expect(() => createVerificationActionPlanV1({
    action,
    dependencies: [{ actionKey: otherDependency.actionKey, kind: 'cheap-preflight' }]
  })).toThrow('cheap-preflight dependencies must exactly match');
  expect(() => createVerificationActionPlanV1({
    action,
    dependencies: [
      { actionKey: dependency.actionKey, kind: 'cheap-preflight' },
      { actionKey: dependency.actionKey, kind: 'upstream' }
    ]
  })).toThrow('cannot declare one ActionKey under multiple dependency kinds');
  const blocked = createVerificationActionPlanV1({
    action,
    dependencies: [{ actionKey: dependency.actionKey, kind: 'cheap-preflight' }]
  });
  expect(isVerificationActionRunnableV1(blocked)).toEqual({
    runnable: false,
    reason: expect.stringContaining('cheap-preflight')
  });
  const runnable = createVerificationActionPlanV1({
    action,
    dependencies: [{ actionKey: dependency.actionKey, kind: 'cheap-preflight' }]
  });
  expect(isVerificationActionRunnableV1(runnable, [{
    actionKey: dependency.actionKey,
    state: 'terminal-passed'
  }])).toEqual({ runnable: true, reason: null });
  expect(verificationActionDependsOnChangedInputsV1(
    action,
    ['docs/work-packages/example-v1.md']
  )).toBe(true);
  expect(verificationActionDependsOnChangedInputsV1(action, ['tests/unit/other.test.ts'])).toBe(false);
  expect(verificationActionDependsOnChangedInputsV1(action, null)).toBe(true);
});

test('terminal action adapts canonical result status without adding a reuse status', () => {
  expect(createVerificationActionTerminalV1({
    status: 'passed',
    reasonCode: 'executed-success',
    resultDigest: DIGEST_A
  })).toEqual({
    status: 'passed',
    reasonCode: 'executed-success',
    resultDigest: DIGEST_A
  });
  expect(() => createVerificationActionTerminalV1({
    status: 'passed',
    reasonCode: 'executed-failure',
    resultDigest: null
  })).toThrow('passed status requires reasonCode executed-success');
  expect(createVerificationActionTerminalV1({
    status: 'failed',
    reasonCode: 'timeout',
    resultDigest: null
  }).reasonCode).toBe('timeout');
  expect(createVerificationActionTerminalV1({
    status: 'failed',
    reasonCode: 'cleanup-failed',
    resultDigest: null
  }).reasonCode).toBe('cleanup-failed');
  expect(createVerificationActionTerminalV1({
    status: 'failed',
    reasonCode: 'process-settlement-failed',
    resultDigest: null
  }).reasonCode).toBe('process-settlement-failed');
  expect(createVerificationActionTerminalV1({
    status: 'not-run',
    reasonCode: 'not-dispatched',
    resultDigest: null
  }).status).toBe('not-run');
  expect(createVerificationActionTerminalV1({
    status: 'unsupported',
    reasonCode: 'capability-unsupported',
    resultDigest: null
  }).status).toBe('unsupported');
  expect(createVerificationActionTerminalV1({
    status: 'invalidated',
    reasonCode: 'input-invalidated',
    resultDigest: null
  }).status).toBe('invalidated');
  expect(() => createVerificationActionTerminalV1({
    status: 'not-run',
    reasonCode: 'timeout',
    resultDigest: null
  })).toThrow('not-run status requires a not-run reasonCode');
});
