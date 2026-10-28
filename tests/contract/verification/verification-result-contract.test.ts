import { expect, test } from 'bun:test';
import {
  readVerificationDataRecord,
  snapshotVerificationData,
  verificationDataEqual
} from '../../../src/assurance/verification/contract/data.ts';

import { CodexDevelopmentAggregateVerificationClaims, CodexDevelopmentAssertVerificationGateResult, CodexDevelopmentBuildVerificationGateResult, CodexDevelopmentSnapshotVerificationData, CodexDevelopmentVerificationDataEqual, type VerificationAggregateInput, type VerificationAggregateResult, type VerificationApplicability, type VerificationDisposition, type VerificationGateEnvironment, type VerificationGateExecution, type VerificationGateResult, type VerificationReasonCode, type VerificationResultStatus } from '../../../src/assurance/verification/result/contract/result.ts';
import { VERIFICATION_GATE_RESULT_SCHEMA } from '../../../src/assurance/verification/result/contract/schema.ts';

const INPUT_DIGEST = `sha256:${'a'.repeat(64)}`;
const SUBJECT_REVISION = 'b'.repeat(40);

type RecordedProxyTrap =
  | 'get'
  | 'getPrototypeOf'
  | 'ownKeys'
  | 'getOwnPropertyDescriptor'
  | 'has';

function recordingProxyHandler<T extends object>(
  trapCalls: RecordedProxyTrap[],
  throwOnTrap: boolean
): ProxyHandler<T> {
  const record = (trap: RecordedProxyTrap): void => {
    trapCalls.push(trap);
    if (throwOnTrap) throw new Error(`candidate Proxy trap executed: ${trap}`);
  };
  return {
    get(target, property, receiver) {
      record('get');
      return Reflect.get(target, property, receiver);
    },
    getPrototypeOf(target) {
      record('getPrototypeOf');
      return Reflect.getPrototypeOf(target);
    },
    ownKeys(target) {
      record('ownKeys');
      return Reflect.ownKeys(target);
    },
    getOwnPropertyDescriptor(target, property) {
      record('getOwnPropertyDescriptor');
      return Reflect.getOwnPropertyDescriptor(target, property);
    },
    has(target, property) {
      record('has');
      return Reflect.has(target, property);
    }
  };
}

function recordedProxy<T extends object>(target: T, throwOnTrap: boolean = false) {
  const trapCalls: RecordedProxyTrap[] = [];
  return {
    proxy: new Proxy(target, recordingProxyHandler(trapCalls, throwOnTrap)),
    trapCalls
  };
}

// ---------------------------------------------------------------------------
// Validator negative cases
// ---------------------------------------------------------------------------

function minimalValidInput() {
  return {
    gateId: 'gate-1',
    gateRevision: 'rev-1',
    owner: 'owner-1',
    requirementKey: 'req-1',
    subjectRevision: SUBJECT_REVISION,
    inputDigest: INPUT_DIGEST,
    applicability: 'required' as VerificationApplicability,
    status: 'passed' as VerificationResultStatus,
    disposition: 'executed' as VerificationDisposition,
    reasonCode: 'executed-success' as VerificationReasonCode,
    requiredForClaims: ['claim-1'],
    supportedClaims: ['claim-1'],
    environment: {
      runtime: 'bun@1.3.14',
      os: 'linux',
      arch: 'x64',
      filesystem: 'ext4',
      capabilities: ['typescript'],
      toolchainRevision: 'ci-verification-v19',
      providerRevisions: []
    } as VerificationGateEnvironment,
    execution: {
      argv: ['bun', 'test'],
      startedAt: '2026-07-30T10:00:00.000Z',
      finishedAt: '2026-07-30T10:00:01.000Z',
      durationMs: 1000,
      exitCode: 0,
      outputDigest: `sha256:${'c'.repeat(64)}`,
      failureFingerprint: null
    } as VerificationGateExecution,
    evidenceRefs: [],
    invalidationRules: [],
    diagnostic: null
  };
}

test('validator rejects unknown schema', () => {
  const input = minimalValidInput();
  const bad = { schema: 'wrong-schema', ...input } as unknown as VerificationGateResult;
  expect(() => CodexDevelopmentAssertVerificationGateResult(bad)).toThrow(/schema must be/);
});

test('validator rejects invalid digest format', () => {
  const input = minimalValidInput();
  const bad = { schema: VERIFICATION_GATE_RESULT_SCHEMA, ...input, inputDigest: 'not-a-digest' } as unknown as VerificationGateResult;
  expect(() => CodexDevelopmentAssertVerificationGateResult(bad)).toThrow(/inputDigest must be a sha256 digest/);
});

test('validator rejects unsupported status with wrong reasonCode', () => {
  const input = minimalValidInput();
  const bad = {
    schema: VERIFICATION_GATE_RESULT_SCHEMA,
    ...input,
    applicability: 'required',
    status: 'unsupported',
    disposition: 'not-executed',
    reasonCode: 'executed-success',
    environment: null,
    execution: null
  } as unknown as VerificationGateResult;
  expect(() => CodexDevelopmentAssertVerificationGateResult(bad)).toThrow(/unsupported status requires/);
});

test('validator rejects not-applicable applicability with passed status', () => {
  const input = minimalValidInput();
  const bad = {
    schema: VERIFICATION_GATE_RESULT_SCHEMA,
    ...input,
    applicability: 'not-applicable',
    status: 'passed'
  } as unknown as VerificationGateResult;
  expect(() => CodexDevelopmentAssertVerificationGateResult(bad)).toThrow(/not-applicable applicability requires not-run status/);
});

test('validator rejects executed disposition with null environment', () => {
  const input = minimalValidInput();
  const bad = {
    schema: VERIFICATION_GATE_RESULT_SCHEMA,
    ...input,
    environment: null
  } as unknown as VerificationGateResult;
  expect(() => CodexDevelopmentAssertVerificationGateResult(bad)).toThrow(/executed disposition requires non-null environment/);
});

test('validator rejects not-executed disposition with non-null execution', () => {
  const input = minimalValidInput();
  const bad = {
    schema: VERIFICATION_GATE_RESULT_SCHEMA,
    ...input,
    status: 'not-run',
    disposition: 'not-executed',
    reasonCode: 'not-applicable',
    applicability: 'not-applicable',
    environment: null,
    execution: input.execution
  } as unknown as VerificationGateResult;
  expect(() => CodexDevelopmentAssertVerificationGateResult(bad)).toThrow(/not-executed disposition must have null execution/);
});

// ---------------------------------------------------------------------------
// Builder contract
// ---------------------------------------------------------------------------

test('builder rejects invalid input', () => {
  const input = minimalValidInput();
  expect(() => CodexDevelopmentBuildVerificationGateResult({ ...input, status: 'invalid-status' as VerificationResultStatus })).toThrow();
});

// ---------------------------------------------------------------------------
// Aggregate contract
// ---------------------------------------------------------------------------

function canonicalAggregateFixture() {
  // Inputs and the expected aggregate are independent ordinary data.
  const gate: VerificationGateResult = { schema: VERIFICATION_GATE_RESULT_SCHEMA, ...minimalValidInput() };
  const claims = [{
    claimId: 'claim-1',
    requiredGateIds: ['gate-1'],
    owningEnvironments: ['linux-x64']
  }];
  const gates = [gate];
  const overall: VerificationAggregateResult = {
    overallStatus: 'passed',
    overallReasonCode: 'executed-success',
    claimResults: [{
      claimId: 'claim-1',
      status: 'passed',
      reasonCode: 'executed-success',
      contributingGateIds: ['gate-1'],
      coverageComplete: true
    }]
  };
  return { overall, claims, gates };
}

function aggregateInput(
  fixture: Pick<ReturnType<typeof canonicalAggregateFixture>, 'claims' | 'gates'>
): VerificationAggregateInput {
  return { claims: fixture.claims, gateResults: fixture.gates };
}

test('strict verification-data boundary accepts JSON data and rejects executable or exotic views', () => {
  const jsonData = JSON.parse('{"alpha":1,"nested":["value",null,true]}') as unknown;
  expect(CodexDevelopmentSnapshotVerificationData(jsonData)).toEqual(jsonData);
  const frozenData = Object.freeze({
    alpha: 1,
    nested: Object.freeze(['value', null, true])
  });
  expect(CodexDevelopmentSnapshotVerificationData(frozenData)).toEqual(jsonData);
  expect(CodexDevelopmentVerificationDataEqual(
    { alpha: 1, nested: ['value', null, true] },
    { nested: ['value', null, true], alpha: 1 }
  )).toBe(true);

  let candidateCodeExecutions = 0;
  const inheritedToJSON = Object.assign(Object.create({
    toJSON: () => { candidateCodeExecutions += 1; return {}; }
  }) as Record<string, unknown>, { value: 'inherited' });
  const hiddenToJSON = { value: 'hidden' };
  Object.defineProperty(hiddenToJSON, 'toJSON', {
    value: () => { candidateCodeExecutions += 1; return {}; },
    enumerable: false
  });
  const accessor = {};
  Object.defineProperty(accessor, 'value', {
    get: () => { candidateCodeExecutions += 1; return 'accessed'; },
    enumerable: true,
    configurable: true
  });
  const hiddenExtra = { value: 'visible' };
  Object.defineProperty(hiddenExtra, 'hidden', { value: true, enumerable: false });
  const symbolExtra = { value: 'visible', [Symbol('forged')]: true };
  const sparseArray = new Array<unknown>(2);
  sparseArray[1] = 'present';
  const overriddenArray = ['value'];
  (overriddenArray as unknown as Record<string, unknown>).map = () => {
    candidateCodeExecutions += 1;
    return [];
  };
  const accessorArray = ['value'];
  Object.defineProperty(accessorArray, '0', {
    get: () => { candidateCodeExecutions += 1; return 'accessed'; },
    enumerable: true,
    configurable: true
  });

  for (const candidate of [
    inheritedToJSON,
    hiddenToJSON,
    accessor,
    hiddenExtra,
    symbolExtra,
    sparseArray,
    overriddenArray,
    accessorArray
  ]) {
    expect(() => CodexDevelopmentSnapshotVerificationData(candidate)).toThrow();
  }
  expect(candidateCodeExecutions).toBe(0);

  // Executable views are a raw-data concern; product aggregation receives
  // ordinary claim literals and already-built gate snapshots.
  const directProxy = recordedProxy({ value: 'data' }, true);
  const nestedProxy = recordedProxy(['data'], true);
  for (const [candidate, calls] of [
    [directProxy.proxy, directProxy.trapCalls],
    [{ nested: nestedProxy.proxy }, nestedProxy.trapCalls]
  ] as const) {
    expect(() => CodexDevelopmentSnapshotVerificationData(candidate))
      .toThrow('Verification data must not contain Proxy values.');
    expect(calls).toEqual([]);
  }
  for (const target of [{ value: 'data' }, ['data']]) {
    const prototype = recordedProxy(Object.getPrototypeOf(target) as object);
    Object.setPrototypeOf(target, prototype.proxy);
    prototype.trapCalls.length = 0;
    expect(() => CodexDevelopmentSnapshotVerificationData(target))
      .toThrow(/must use the canonical (Object|Array) prototype/);
    expect(prototype.trapCalls).toEqual([]);
  }
});

test('canonical prototype toJSON guards reject without executing and restore exact descriptors', () => {
  let candidateCodeExecutions = 0;
  const cases = [
    {
      prototype: Object.prototype,
      candidate: { ordinary: 'object' },
      descriptor: {
        configurable: true, enumerable: false, writable: true,
        value: () => { candidateCodeExecutions += 1; return { executed: true }; }
      }
    },
    {
      prototype: Array.prototype,
      candidate: ['ordinary-array'],
      descriptor: {
        configurable: true, enumerable: false,
        get: () => {
          candidateCodeExecutions += 1;
          return () => { candidateCodeExecutions += 1; return { executed: true }; };
        }
      }
    }
  ];

  // Isolate the two ambient hooks: Object.prototype.toJSON must not mask a
  // missing Array.prototype guard. Restore before any matcher can observe it.
  for (const { prototype, candidate, descriptor } of cases) {
    const previous = Object.getOwnPropertyDescriptor(prototype, 'toJSON');
    let failure: unknown;
    try {
      Object.defineProperty(prototype, 'toJSON', descriptor);
      try {
        CodexDevelopmentSnapshotVerificationData(candidate);
      } catch (error) {
        failure = error;
      }
    } finally {
      if (previous) Object.defineProperty(prototype, 'toJSON', previous);
      else if (!Reflect.deleteProperty(prototype, 'toJSON')) {
        throw new Error('Unable to restore canonical toJSON descriptor absence.');
      }
    }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain('must not define or inherit toJSON');
    expect(Object.getOwnPropertyDescriptor(prototype, 'toJSON')).toEqual(previous);
  }
  expect(candidateCodeExecutions).toBe(0);
});

test('trusted claims cannot close vacuously', () => {
  const fixture = canonicalAggregateFixture();
  expect(() => CodexDevelopmentAggregateVerificationClaims({
    claims: [{ claimId: 'claim-1', requiredGateIds: [], owningEnvironments: ['linux'] }],
    gateResults: fixture.gates
  })).toThrow(/requiredGateIds must not be empty/);
  expect(() => CodexDevelopmentAggregateVerificationClaims({
    claims: [{ claimId: 'claim-1', requiredGateIds: ['gate-1'], owningEnvironments: [] }],
    gateResults: fixture.gates
  })).toThrow(/owningEnvironments must not be empty/);

  const missingInput = {
    claims: [{
      claimId: 'claim-1',
      requiredGateIds: ['missing-gate'],
      owningEnvironments: ['linux-x64']
    }],
    gateResults: []
  };
  const missing = CodexDevelopmentAggregateVerificationClaims(missingInput);
  expect(missing.claimResults[0]).toMatchObject({
    status: 'not-run',
    coverageComplete: false,
    contributingGateIds: []
  });

  const emptyInput = { claims: [], gateResults: [] };
  const empty = CodexDevelopmentAggregateVerificationClaims(emptyInput);
  expect(empty).toEqual({
    overallStatus: 'invalidated', overallReasonCode: 'selection-unresolved', claimResults: []
  });
});

test('aggregate input rejects empty, control, and missing gate linkage identities', () => {
  const candidates = [] as Array<ReturnType<typeof canonicalAggregateFixture>>;

  const emptyGate = canonicalAggregateFixture();
  emptyGate.gates[0]!.gateId = '';
  candidates.push(emptyGate);
  const controlGate = canonicalAggregateFixture();
  controlGate.gates[0]!.gateId = 'gate\u0000forged';
  candidates.push(controlGate);
  const missingGate = canonicalAggregateFixture();
  delete (missingGate.gates[0] as unknown as Record<string, unknown>).gateId;
  expect(() => CodexDevelopmentAggregateVerificationClaims(aggregateInput(missingGate))).toThrow(/unknown or missing fields/);

  const emptyRequiredLink = canonicalAggregateFixture();
  emptyRequiredLink.gates[0]!.requiredForClaims = [''];
  candidates.push(emptyRequiredLink);
  const controlSupportedLink = canonicalAggregateFixture();
  controlSupportedLink.gates[0]!.supportedClaims = ['claim\u0000forged'];
  candidates.push(controlSupportedLink);

  for (const candidate of candidates) {
    expect(() => CodexDevelopmentAggregateVerificationClaims(aggregateInput(candidate))).toThrow();
  }
});

test('aggregate input requires bidirectional claim linkage while allowing unrelated extra gates', () => {
  const missingRequiredLink = canonicalAggregateFixture();
  missingRequiredLink.gates[0]!.requiredForClaims = [];
  expect(() => CodexDevelopmentAggregateVerificationClaims(aggregateInput(missingRequiredLink))).toThrow(/lacks requiredForClaims linkage/);

  const missingSupportedLink = canonicalAggregateFixture();
  missingSupportedLink.gates[0]!.supportedClaims = [];
  expect(() => CodexDevelopmentAggregateVerificationClaims(aggregateInput(missingSupportedLink))).toThrow(/lacks supportedClaims linkage/);

  const { overall, claims, gates } = canonicalAggregateFixture();
  const extraGate: VerificationGateResult = {
    schema: VERIFICATION_GATE_RESULT_SCHEMA,
    ...minimalValidInput(),
    gateId: 'extra-gate',
    status: 'unsupported',
    disposition: 'not-executed',
    reasonCode: 'capability-unsupported',
    requiredForClaims: ['extra-claim'],
    supportedClaims: ['extra-claim'],
    environment: null,
    execution: null
  };
  const supportOnlyExtraGate: VerificationGateResult = {
    schema: VERIFICATION_GATE_RESULT_SCHEMA,
    ...minimalValidInput(),
    gateId: 'support-only-extra-gate',
    status: 'unsupported',
    disposition: 'not-executed',
    reasonCode: 'capability-unsupported',
    requiredForClaims: [],
    supportedClaims: ['optional-extra-claim'],
    environment: null,
    execution: null
  };

  const offPlanSelectedClaimGate: VerificationGateResult = {
    schema: VERIFICATION_GATE_RESULT_SCHEMA,
    ...minimalValidInput(),
    gateId: 'off-plan-selected-claim-gate',
    status: 'unsupported',
    disposition: 'not-executed',
    reasonCode: 'capability-unsupported',
    requiredForClaims: ['claim-1'],
    supportedClaims: [],
    environment: null,
    execution: null
  };
  expect(() => CodexDevelopmentAggregateVerificationClaims(
    { claims, gateResults: [...gates, offPlanSelectedClaimGate] }
  )).toThrow(/absent from the trusted claim plan/);
  expect(CodexDevelopmentAggregateVerificationClaims({
    claims, gateResults: [...gates, extraGate, supportOnlyExtraGate]
  })).toEqual(overall);
});

test('verification data preserves hostile own property names without prototype mutation', () => {
  const candidate = Object.fromEntries([
    ['__proto__', { marker: '__proto__' }],
    ['constructor', { marker: 'constructor' }],
    ['prototype', { marker: 'prototype' }]
  ]);
  const shallow = readVerificationDataRecord(candidate);
  const deep = snapshotVerificationData(candidate);
  expect(Object.getPrototypeOf(shallow)).toBe(Object.prototype);
  expect(Object.getPrototypeOf(deep as object)).toBe(Object.prototype);
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    expect(Object.prototype.hasOwnProperty.call(shallow, key)).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(deep as object, key)).toBe(true);
  }
  expect((shallow['__proto__'] as { marker: string }).marker).toBe('__proto__');
  expect(verificationDataEqual(candidate, deep)).toBe(true);
  expect(({} as Record<string, unknown>).marker).toBeUndefined();
});
