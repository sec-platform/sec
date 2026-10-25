import { expect, test } from 'bun:test';
import {
  readVerificationDataRecord,
  snapshotVerificationData,
  verificationDataEqual
} from '../../../src/assurance/verification/contract/data.ts';

import { CodexDevelopmentAggregateVerificationClaims, CodexDevelopmentAssertVerificationAggregateResultV1, CodexDevelopmentAssertVerificationGateResult, CodexDevelopmentBuildVerificationGateResult, CodexDevelopmentSnapshotVerificationData, CodexDevelopmentVerificationDataEqual, type VerificationAggregateInput, type VerificationAggregateResult, type VerificationApplicability, type VerificationDisposition, type VerificationGateEnvironment, type VerificationGateExecution, type VerificationGateResult, type VerificationReasonCode, type VerificationResultStatus } from '../../../src/assurance/verification/result/contract/result.ts';
import { VERIFICATION_GATE_RESULT_SCHEMA } from '../../../src/assurance/verification/result/contract/schema.ts';

const INPUT_DIGEST = `sha256:${'a'.repeat(64)}`;
const SUBJECT_REVISION = 'b'.repeat(40);

type RecordedProxyTrap =
  | 'get'
  | 'getPrototypeOf'
  | 'ownKeys'
  | 'getOwnPropertyDescriptor'
  | 'has'
  | 'apply';

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
    },
    apply(target, thisArgument, argumentsList) {
      record('apply');
      return Reflect.apply(target as (...args: unknown[]) => unknown, thisArgument, argumentsList);
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

function recordedRevokedProxy<T extends object>(target: T) {
  const trapCalls: RecordedProxyTrap[] = [];
  const revocable = Proxy.revocable(target, recordingProxyHandler(trapCalls, true));
  revocable.revoke();
  return { proxy: revocable.proxy, trapCalls };
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
  // Reader fixtures are independent ordinary wire data, not writer self-checks.
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
  const customPrototype = Object.assign(Object.create({ inherited: true }), { value: 'custom' });
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
    customPrototype,
    hiddenExtra,
    symbolExtra,
    sparseArray,
    overriddenArray,
    accessorArray
  ]) {
    expect(() => CodexDevelopmentSnapshotVerificationData(candidate)).toThrow();
  }
  expect(candidateCodeExecutions).toBe(0);
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

test('strict verification-data boundary rejects every Proxy before installed traps execute', () => {
  const transparentObject = recordedProxy({ value: 'transparent' });
  const maliciousArray = recordedProxy(['stateful'], true);
  let functionExecutions = 0;
  const proxiedFunction = recordedProxy(() => {
    functionExecutions += 1;
    return 'executed';
  }, true);
  const revokedObject = recordedRevokedProxy({ value: 'revoked' });
  const revokedArray = recordedRevokedProxy(['revoked']);

  for (const candidate of [
    transparentObject,
    maliciousArray,
    proxiedFunction,
    revokedObject,
    revokedArray
  ]) {
    expect(() => CodexDevelopmentSnapshotVerificationData(candidate.proxy))
      .toThrow('Verification data must not contain Proxy values.');
    expect(candidate.trapCalls).toEqual([]);
  }
  expect(functionExecutions).toBe(0);
});

test('strict verification-data boundary rejects candidate-controlled prototypes without executing traps', () => {
  const candidates: Array<{
    value: unknown;
    trapCalls: RecordedProxyTrap[];
    expectedPrototype: 'Object' | 'Array';
  }> = [];

  const transparentPrototype = recordedProxy({ inherited: true });
  const transparentValue = Object.create(transparentPrototype.proxy) as Record<string, unknown>;
  Object.defineProperty(transparentValue, 'value', {
    value: 'transparent', enumerable: true, configurable: true, writable: true
  });
  transparentPrototype.trapCalls.length = 0;
  candidates.push({
    value: transparentValue,
    trapCalls: transparentPrototype.trapCalls,
    expectedPrototype: 'Object'
  });

  const statefulPrototype = recordedProxy({ inherited: true }, true);
  const statefulValue = Object.create(statefulPrototype.proxy) as Record<string, unknown>;
  Object.defineProperty(statefulValue, 'value', {
    value: 'stateful', enumerable: true, configurable: true, writable: true
  });
  statefulPrototype.trapCalls.length = 0;
  candidates.push({
    value: statefulValue,
    trapCalls: statefulPrototype.trapCalls,
    expectedPrototype: 'Object'
  });

  const deepPrototype = recordedProxy({ inherited: true }, true);
  const ordinaryImmediatePrototype = Object.create(deepPrototype.proxy) as object;
  const deepValue = Object.create(ordinaryImmediatePrototype) as Record<string, unknown>;
  Object.defineProperty(deepValue, 'value', {
    value: 'deep', enumerable: true, configurable: true, writable: true
  });
  deepPrototype.trapCalls.length = 0;
  candidates.push({
    value: deepValue,
    trapCalls: deepPrototype.trapCalls,
    expectedPrototype: 'Object'
  });

  const arrayPrototype = recordedProxy(Array.prototype);
  const arrayValue = ['array'];
  Object.setPrototypeOf(arrayValue, arrayPrototype.proxy);
  arrayPrototype.trapCalls.length = 0;
  candidates.push({
    value: arrayValue,
    trapCalls: arrayPrototype.trapCalls,
    expectedPrototype: 'Array'
  });

  const revokedTrapCalls: RecordedProxyTrap[] = [];
  const revokedPrototype = Proxy.revocable(
    { inherited: true },
    recordingProxyHandler(revokedTrapCalls, false)
  );
  const revokedValue = Object.create(revokedPrototype.proxy) as Record<string, unknown>;
  Object.defineProperty(revokedValue, 'value', {
    value: 'revoked', enumerable: true, configurable: true, writable: true
  });
  revokedTrapCalls.length = 0;
  revokedPrototype.revoke();
  candidates.push({
    value: revokedValue,
    trapCalls: revokedTrapCalls,
    expectedPrototype: 'Object'
  });

  for (const candidate of candidates) {
    expect(() => CodexDevelopmentSnapshotVerificationData(candidate.value))
      .toThrow(`must use the canonical ${candidate.expectedPrototype} prototype.`);
    expect(candidate.trapCalls).toEqual([]);
  }
});

test('aggregate input is an exact ordinary container and snapshots trusted views before reduction', () => {
  const fixture = canonicalAggregateFixture();
  const validInput = aggregateInput(fixture);
  expect(CodexDevelopmentAggregateVerificationClaims(validInput).overallStatus).toBe('passed');

  const extraField = { ...validInput, forged: true };
  const hiddenField = { ...validInput };
  Object.defineProperty(hiddenField, 'forged', { value: true, enumerable: false });
  const symbolField = { ...validInput, [Symbol('forged')]: true };
  const customPrototype = Object.assign(Object.create({ inherited: true }), validInput);
  const hiddenClaims = { gateResults: validInput.gateResults } as Record<string, unknown>;
  Object.defineProperty(hiddenClaims, 'claims', {
    value: validInput.claims,
    enumerable: false,
    configurable: true,
    writable: true
  });
  let getterCalls = 0;
  const accessorClaims = { gateResults: validInput.gateResults } as Record<string, unknown>;
  Object.defineProperty(accessorClaims, 'claims', {
    get: () => { getterCalls += 1; return validInput.claims; },
    enumerable: true,
    configurable: true
  });

  for (const candidate of [
    extraField,
    hiddenField,
    symbolField,
    customPrototype,
    hiddenClaims,
    accessorClaims
  ]) {
    expect(() => CodexDevelopmentAggregateVerificationClaims(
      candidate as unknown as VerificationAggregateInput
    )).toThrow();
  }
  expect(getterCalls).toBe(0);

  let trustedCoverageExecutions = 0;
  const mutableInput: VerificationAggregateInput = {
    claims: fixture.claims,
    gateResults: fixture.gates,
    isCoverageComplete: (claim, gates) => {
      trustedCoverageExecutions += 1;
      (mutableInput.claims[0]!.requiredGateIds as string[]).length = 0;
      claim.requiredGateIds.length = 0;
      gates.length = 0;
      return true;
    }
  };
  const snapshotted = CodexDevelopmentAggregateVerificationClaims(mutableInput);
  expect(snapshotted.overallStatus).toBe('passed');
  expect(snapshotted.claimResults[0]!.contributingGateIds).toEqual(['gate-1']);
  expect(trustedCoverageExecutions).toBe(1);
});

test('aggregate input rejects top-level and nested Proxy views without executing traps', () => {
  const fixture = canonicalAggregateFixture();
  const views: Array<{
    input: VerificationAggregateInput;
    trapCalls: RecordedProxyTrap[];
  }> = [];

  const topLevel = recordedProxy(aggregateInput(fixture), true);
  views.push({
    input: topLevel.proxy,
    trapCalls: topLevel.trapCalls
  });

  const claimObject = recordedProxy(fixture.claims[0]!, true);
  views.push({
    input: { claims: [claimObject.proxy], gateResults: fixture.gates },
    trapCalls: claimObject.trapCalls
  });

  const nestedGateArrayTarget = structuredClone(fixture.gates[0]!);
  const nestedGateArray = recordedProxy(nestedGateArrayTarget.requiredForClaims, true);
  nestedGateArrayTarget.requiredForClaims = nestedGateArray.proxy;
  views.push({
    input: { claims: fixture.claims, gateResults: [nestedGateArrayTarget] },
    trapCalls: nestedGateArray.trapCalls
  });

  let callbackExecutions = 0;
  const coverageCallback = recordedProxy(() => {
    callbackExecutions += 1;
    return true;
  }, true);
  views.push({
    input: {
      claims: fixture.claims,
      gateResults: fixture.gates,
      isCoverageComplete: coverageCallback.proxy
    },
    trapCalls: coverageCallback.trapCalls
  });

  for (const view of views) {
    expect(() => CodexDevelopmentAggregateVerificationClaims(view.input))
      .toThrow('Verification data must not contain Proxy values.');
    expect(view.trapCalls).toEqual([]);
  }
  expect(callbackExecutions).toBe(0);
});

test('aggregate input rejects Proxy prototypes at its root, claims and gate data boundaries', () => {
  const fixture = canonicalAggregateFixture();
  const views: Array<{
    input: VerificationAggregateInput;
    trapCalls: RecordedProxyTrap[];
  }> = [];

  const rootPrototype = recordedProxy({ inherited: true });
  const rootInput = aggregateInput(fixture);
  Object.setPrototypeOf(rootInput, rootPrototype.proxy);
  rootPrototype.trapCalls.length = 0;
  views.push({ input: rootInput, trapCalls: rootPrototype.trapCalls });

  const claimPrototype = recordedProxy({ inherited: true });
  const claimInput = aggregateInput(canonicalAggregateFixture());
  Object.setPrototypeOf(claimInput.claims[0]!, claimPrototype.proxy);
  claimPrototype.trapCalls.length = 0;
  views.push({ input: claimInput, trapCalls: claimPrototype.trapCalls });

  const nestedArrayPrototype = recordedProxy(Array.prototype);
  const nestedArrayInput = aggregateInput(canonicalAggregateFixture());
  Object.setPrototypeOf(
    nestedArrayInput.gateResults[0]!.requiredForClaims,
    nestedArrayPrototype.proxy
  );
  nestedArrayPrototype.trapCalls.length = 0;
  views.push({ input: nestedArrayInput, trapCalls: nestedArrayPrototype.trapCalls });

  for (const view of views) {
    expect(() => CodexDevelopmentAggregateVerificationClaims(view.input))
      .toThrow(/must use the canonical (Object|Array) prototype/);
    expect(view.trapCalls).toEqual([]);
  }
});

test('trusted claims and serialized passes cannot close vacuously', () => {
  const fixture = canonicalAggregateFixture();
  expect(() => CodexDevelopmentAggregateVerificationClaims({
    claims: [{ claimId: 'claim-1', requiredGateIds: [], owningEnvironments: ['linux'] }],
    gateResults: fixture.gates
  })).toThrow(/requiredGateIds must not be empty/);
  expect(() => CodexDevelopmentAggregateVerificationClaims({
    claims: [{ claimId: 'claim-1', requiredGateIds: ['gate-1'], owningEnvironments: [] }],
    gateResults: fixture.gates
  })).toThrow(/owningEnvironments must not be empty/);

  const forgedPass = fixture.overall;
  forgedPass.claimResults[0]!.contributingGateIds = [];
  expect(() => CodexDevelopmentAssertVerificationAggregateResultV1(
    forgedPass,
    aggregateInput(fixture)
  )).toThrow(/passed status requires non-empty contributingGateIds/);

  const missingInput = {
    claims: [{
      claimId: 'claim-1',
      requiredGateIds: ['missing-gate'],
      owningEnvironments: ['linux-x64']
    }],
    gateResults: [],
    isCoverageComplete: () => true
  };
  const callbackCannotCreateCoverage = CodexDevelopmentAggregateVerificationClaims(missingInput);
  expect(callbackCannotCreateCoverage.claimResults[0]).toMatchObject({
    status: 'not-run',
    coverageComplete: false,
    contributingGateIds: []
  });
  expect(() => CodexDevelopmentAssertVerificationAggregateResultV1(
    callbackCannotCreateCoverage, missingInput
  )).not.toThrow();

  const emptyInput = { claims: [], gateResults: [] };
  const empty = CodexDevelopmentAggregateVerificationClaims(emptyInput);
  expect(empty).toEqual({
    overallStatus: 'invalidated', overallReasonCode: 'selection-unresolved', claimResults: []
  });
  expect(() => CodexDevelopmentAssertVerificationAggregateResultV1(empty, emptyInput)).not.toThrow();

  const incompleteInput = { ...aggregateInput(fixture), isCoverageComplete: () => false };
  const incomplete = CodexDevelopmentAggregateVerificationClaims(incompleteInput);
  expect(incomplete).toMatchObject({
    overallStatus: 'invalidated', overallReasonCode: 'selection-unresolved',
    claimResults: [{ status: 'invalidated', reasonCode: 'selection-unresolved', coverageComplete: false }]
  });
  expect(() => CodexDevelopmentAssertVerificationAggregateResultV1(incomplete, incompleteInput)).not.toThrow();
});

test('aggregate assertion validates the trusted claim plan identities and exact shape', () => {
  const duplicateClaim = canonicalAggregateFixture();
  duplicateClaim.claims.push(structuredClone(duplicateClaim.claims[0]!));
  expect(() => CodexDevelopmentAssertVerificationAggregateResultV1(
    duplicateClaim.overall,
    aggregateInput(duplicateClaim)
  )).toThrow(/duplicate claimId claim-1/);

  const duplicateRequiredGate = canonicalAggregateFixture();
  duplicateRequiredGate.claims[0]!.requiredGateIds.push('gate-1');
  expect(() => CodexDevelopmentAssertVerificationAggregateResultV1(
    duplicateRequiredGate.overall,
    aggregateInput(duplicateRequiredGate)
  )).toThrow(/requiredGateIds must not contain duplicate identity gate-1/);

  const duplicateOwningEnvironment = canonicalAggregateFixture();
  duplicateOwningEnvironment.claims[0]!.owningEnvironments.push('linux-x64');
  expect(() => CodexDevelopmentAssertVerificationAggregateResultV1(
    duplicateOwningEnvironment.overall,
    aggregateInput(duplicateOwningEnvironment)
  )).toThrow(/owningEnvironments must not contain duplicate identity linux-x64/);

  const invalidOwningEnvironment = canonicalAggregateFixture();
  invalidOwningEnvironment.claims[0]!.owningEnvironments = [''];
  expect(() => CodexDevelopmentAssertVerificationAggregateResultV1(
    invalidOwningEnvironment.overall,
    aggregateInput(invalidOwningEnvironment)
  )).toThrow(/owningEnvironments\[0\] must be a non-empty/);

  const unknownPlanField = canonicalAggregateFixture();
  (unknownPlanField.claims[0] as unknown as Record<string, unknown>).forged = true;
  expect(() => CodexDevelopmentAssertVerificationAggregateResultV1(
    unknownPlanField.overall,
    aggregateInput(unknownPlanField)
  )).toThrow(/unknown or missing fields/);
});

test('aggregate assertion rejects nested unknown fields and status-reason contradictions', () => {
  const unknownAggregateField = canonicalAggregateFixture();
  (unknownAggregateField.overall as unknown as Record<string, unknown>).forged = true;
  expect(() => CodexDevelopmentAssertVerificationAggregateResultV1(
    unknownAggregateField.overall,
    aggregateInput(unknownAggregateField)
  )).toThrow(/unknown or missing fields/);

  const unknownField = canonicalAggregateFixture();
  (unknownField.overall.claimResults[0] as unknown as Record<string, unknown>).forged = true;
  expect(() => CodexDevelopmentAssertVerificationAggregateResultV1(
    unknownField.overall,
    aggregateInput(unknownField)
  )).toThrow(/unknown or missing fields/);

  const contradictoryReason = canonicalAggregateFixture();
  contradictoryReason.overall.claimResults[0]!.reasonCode = 'executed-failure';
  expect(() => CodexDevelopmentAssertVerificationAggregateResultV1(
    contradictoryReason.overall,
    aggregateInput(contradictoryReason)
  )).toThrow(/passed status requires reasonCode executed-success/);

  const unknownGateField = canonicalAggregateFixture();
  (unknownGateField.gates[0] as unknown as Record<string, unknown>).forged = true;
  expect(() => CodexDevelopmentAssertVerificationAggregateResultV1(
    unknownGateField.overall,
    aggregateInput(unknownGateField)
  )).toThrow(/unknown or missing fields/);

  const unknownEnvironmentField = canonicalAggregateFixture();
  (unknownEnvironmentField.gates[0]!.environment as unknown as Record<string, unknown>).forged = true;
  expect(() => CodexDevelopmentAssertVerificationAggregateResultV1(
    unknownEnvironmentField.overall,
    aggregateInput(unknownEnvironmentField)
  )).toThrow(/unknown or missing fields/);

  const unknownExecutionField = canonicalAggregateFixture();
  (unknownExecutionField.gates[0]!.execution as unknown as Record<string, unknown>).forged = true;
  expect(() => CodexDevelopmentAssertVerificationAggregateResultV1(
    unknownExecutionField.overall,
    aggregateInput(unknownExecutionField)
  )).toThrow(/unknown or missing fields/);
});

test('aggregate assertion rejects invalid and duplicate claim, gate, and contributor identities', () => {
  const controlClaim = canonicalAggregateFixture();
  controlClaim.overall.claimResults[0]!.claimId = 'claim\u0000forged';
  expect(() => CodexDevelopmentAssertVerificationAggregateResultV1(
    controlClaim.overall,
    aggregateInput(controlClaim)
  )).toThrow(/control-character-free/);

  const duplicateClaim = canonicalAggregateFixture();
  duplicateClaim.overall.claimResults.push(structuredClone(duplicateClaim.overall.claimResults[0]!));
  expect(() => CodexDevelopmentAssertVerificationAggregateResultV1(
    duplicateClaim.overall,
    aggregateInput(duplicateClaim)
  )).toThrow(/duplicate claimId/);

  const duplicateGate = canonicalAggregateFixture();
  duplicateGate.gates.push(structuredClone(duplicateGate.gates[0]!));
  expect(() => CodexDevelopmentAssertVerificationAggregateResultV1(
    duplicateGate.overall,
    aggregateInput(duplicateGate)
  )).toThrow(/duplicate gate observation/);

  const duplicateContributor = canonicalAggregateFixture();
  duplicateContributor.overall.claimResults[0]!.contributingGateIds.push('gate-1');
  expect(() => CodexDevelopmentAssertVerificationAggregateResultV1(
    duplicateContributor.overall,
    aggregateInput(duplicateContributor)
  )).toThrow(/duplicate identity gate-1/);
});

test('aggregate assertion rejects empty, control, and missing identities at every linkage layer', () => {
  const candidates = [] as Array<ReturnType<typeof canonicalAggregateFixture>>;

  const emptyClaim = canonicalAggregateFixture();
  emptyClaim.overall.claimResults[0]!.claimId = '';
  candidates.push(emptyClaim);
  const missingClaim = canonicalAggregateFixture();
  delete (missingClaim.overall.claimResults[0] as unknown as Record<string, unknown>).claimId;
  candidates.push(missingClaim);

  const emptyGate = canonicalAggregateFixture();
  emptyGate.gates[0]!.gateId = '';
  candidates.push(emptyGate);
  const controlGate = canonicalAggregateFixture();
  controlGate.gates[0]!.gateId = 'gate\u0000forged';
  candidates.push(controlGate);
  const missingGate = canonicalAggregateFixture();
  delete (missingGate.gates[0] as unknown as Record<string, unknown>).gateId;
  expect(() => CodexDevelopmentAssertVerificationAggregateResultV1(
    missingGate.overall, aggregateInput(missingGate)
  )).toThrow(/unknown or missing fields/);

  const emptyContributor = canonicalAggregateFixture();
  emptyContributor.overall.claimResults[0]!.contributingGateIds = [''];
  candidates.push(emptyContributor);
  const controlContributor = canonicalAggregateFixture();
  controlContributor.overall.claimResults[0]!.contributingGateIds = ['gate\u0000forged'];
  candidates.push(controlContributor);
  const missingContributors = canonicalAggregateFixture();
  delete (missingContributors.overall.claimResults[0] as unknown as Record<string, unknown>)
    .contributingGateIds;
  candidates.push(missingContributors);

  const emptyRequiredLink = canonicalAggregateFixture();
  emptyRequiredLink.gates[0]!.requiredForClaims = [''];
  candidates.push(emptyRequiredLink);
  const controlSupportedLink = canonicalAggregateFixture();
  controlSupportedLink.gates[0]!.supportedClaims = ['claim\u0000forged'];
  candidates.push(controlSupportedLink);
  const missingRequiredLinks = canonicalAggregateFixture();
  delete (missingRequiredLinks.gates[0] as unknown as Record<string, unknown>).requiredForClaims;
  candidates.push(missingRequiredLinks);
  const missingSupportedLinks = canonicalAggregateFixture();
  delete (missingSupportedLinks.gates[0] as unknown as Record<string, unknown>).supportedClaims;
  candidates.push(missingSupportedLinks);

  for (const candidate of candidates) {
    expect(() => CodexDevelopmentAssertVerificationAggregateResultV1(
      candidate.overall,
      aggregateInput(candidate)
    )).toThrow();
  }
});

test('aggregate assertion rejects unknown contributors, incomplete passed coverage, and overall contradictions', () => {
  const unknownContributor = canonicalAggregateFixture();
  unknownContributor.overall.claimResults[0]!.contributingGateIds = ['unknown-gate'];
  expect(() => CodexDevelopmentAssertVerificationAggregateResultV1(
    unknownContributor.overall,
    aggregateInput(unknownContributor)
  )).toThrow(/unknown contributing gateId/);

  const incompletePassed = canonicalAggregateFixture();
  incompletePassed.overall.claimResults[0]!.coverageComplete = false;
  expect(() => CodexDevelopmentAssertVerificationAggregateResultV1(
    incompletePassed.overall,
    aggregateInput(incompletePassed)
  )).toThrow(/passed status requires coverageComplete=true/);

  const contradictoryOverall = canonicalAggregateFixture();
  contradictoryOverall.overall.overallStatus = 'invalidated';
  contradictoryOverall.overall.overallReasonCode = 'selection-unresolved';
  expect(() => CodexDevelopmentAssertVerificationAggregateResultV1(
    contradictoryOverall.overall,
    aggregateInput(contradictoryOverall)
  )).toThrow(/does not exactly match the canonical aggregate writer output/);

  // Independent wire data also covers the unsafe opposite direction: the
  // required gate never ran, so an overall PASS cannot override its claim.
  const forgedPass = canonicalAggregateFixture();
  forgedPass.gates = [];
  Object.assign(forgedPass.overall.claimResults[0]!, {
    status: 'not-run', reasonCode: 'not-dispatched',
    contributingGateIds: [], coverageComplete: false
  });
  expect(() => CodexDevelopmentAssertVerificationAggregateResultV1(
    forgedPass.overall,
    aggregateInput(forgedPass)
  )).toThrow(/does not exactly match the canonical aggregate writer output/);
});

test('aggregate assertion requires bidirectional claim linkage while allowing unrelated extra gates', () => {
  const missingRequiredLink = canonicalAggregateFixture();
  missingRequiredLink.gates[0]!.requiredForClaims = [];
  expect(() => CodexDevelopmentAssertVerificationAggregateResultV1(
    missingRequiredLink.overall,
    aggregateInput(missingRequiredLink)
  )).toThrow(/lacks requiredForClaims linkage/);

  const missingSupportedLink = canonicalAggregateFixture();
  missingSupportedLink.gates[0]!.supportedClaims = [];
  expect(() => CodexDevelopmentAssertVerificationAggregateResultV1(
    missingSupportedLink.overall,
    aggregateInput(missingSupportedLink)
  )).toThrow(/lacks supportedClaims linkage/);

  const unknownClaim = canonicalAggregateFixture();
  unknownClaim.overall.claimResults[0]!.claimId = 'unknown-claim';
  expect(() => CodexDevelopmentAssertVerificationAggregateResultV1(
    unknownClaim.overall,
    aggregateInput(unknownClaim)
  )).toThrow(/does not exactly match the canonical aggregate writer output/);

  const { overall, claims, gates } = canonicalAggregateFixture();
  const extraGate = CodexDevelopmentBuildVerificationGateResult({
    ...minimalValidInput(),
    gateId: 'extra-gate',
    status: 'unsupported',
    disposition: 'not-executed',
    reasonCode: 'capability-unsupported',
    requiredForClaims: ['extra-claim'],
    supportedClaims: ['extra-claim'],
    environment: null,
    execution: null
  });
  const supportOnlyExtraGate = CodexDevelopmentBuildVerificationGateResult({
    ...minimalValidInput(),
    gateId: 'support-only-extra-gate',
    status: 'unsupported',
    disposition: 'not-executed',
    reasonCode: 'capability-unsupported',
    requiredForClaims: [],
    supportedClaims: ['optional-extra-claim'],
    environment: null,
    execution: null
  });

  const offPlanSelectedClaimGate = CodexDevelopmentBuildVerificationGateResult({
    ...minimalValidInput(),
    gateId: 'off-plan-selected-claim-gate',
    status: 'unsupported',
    disposition: 'not-executed',
    reasonCode: 'capability-unsupported',
    requiredForClaims: ['claim-1'],
    supportedClaims: [],
    environment: null,
    execution: null
  });
  expect(() => CodexDevelopmentAssertVerificationAggregateResultV1(
    overall,
    { claims, gateResults: [...gates, offPlanSelectedClaimGate] }
  )).toThrow(/absent from the trusted claim plan/);

  expect(() => CodexDevelopmentAssertVerificationAggregateResultV1(
    overall,
    { claims, gateResults: [...gates, extraGate, supportOnlyExtraGate] }
  )).not.toThrow();
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
