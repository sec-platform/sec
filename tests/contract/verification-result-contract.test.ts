import { expect, test } from 'bun:test';

import { aggregateVerificationClaims, assertVerificationAggregateResult, AssertVerificationGateResult, BuildVerificationGateResult, snapshotVerificationData, verificationDataEqual, mapProductVerificationStatus, type VerificationAggregateInput, type VerificationApplicability, type VerificationDisposition, type VerificationGateEnvironment, type VerificationGateExecution, type VerificationGateResult, type VerificationReasonCode, type VerificationResultStatus } from '../../src/assurance/verification/result/contract/result.ts';
import { VERIFICATION_GATE_RESULT_SCHEMA } from '../../src/assurance/verification/result/contract/schema.ts';

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
  expect(() => AssertVerificationGateResult(bad)).toThrow(/schema must be/);
});

test('validator rejects missing required field', () => {
  const input = minimalValidInput();
  const { gateId, ...withoutGateId } = input;
  expect(() => AssertVerificationGateResult({ schema: VERIFICATION_GATE_RESULT_SCHEMA, ...withoutGateId })).toThrow(/unknown or missing fields/);
});

test('validator rejects invalid digest format', () => {
  const input = minimalValidInput();
  const bad = { schema: VERIFICATION_GATE_RESULT_SCHEMA, ...input, inputDigest: 'not-a-digest' } as unknown as VerificationGateResult;
  expect(() => AssertVerificationGateResult(bad)).toThrow(/inputDigest must be a sha256 digest/);
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
  expect(() => AssertVerificationGateResult(bad)).toThrow(/unsupported status requires/);
});

test('validator rejects not-applicable applicability with passed status', () => {
  const input = minimalValidInput();
  const bad = {
    schema: VERIFICATION_GATE_RESULT_SCHEMA,
    ...input,
    applicability: 'not-applicable',
    status: 'passed'
  } as unknown as VerificationGateResult;
  expect(() => AssertVerificationGateResult(bad)).toThrow(/not-applicable applicability requires not-run status/);
});

test('validator rejects executed disposition with null environment', () => {
  const input = minimalValidInput();
  const bad = {
    schema: VERIFICATION_GATE_RESULT_SCHEMA,
    ...input,
    environment: null
  } as unknown as VerificationGateResult;
  expect(() => AssertVerificationGateResult(bad)).toThrow(/executed disposition requires non-null environment/);
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
  expect(() => AssertVerificationGateResult(bad)).toThrow(/not-executed disposition must have null execution/);
});

// ---------------------------------------------------------------------------
// Builder contract
// ---------------------------------------------------------------------------

test('builder adds schema and validates', () => {
  const gate = BuildVerificationGateResult(minimalValidInput());
  expect(gate.gateId).toBe('gate-1');
});

test('builder rejects invalid input', () => {
  const input = minimalValidInput();
  expect(() => BuildVerificationGateResult({ ...input, status: 'invalid-status' as VerificationResultStatus })).toThrow();
});

// ---------------------------------------------------------------------------
// Aggregate contract
// ---------------------------------------------------------------------------

test('aggregate fails closed for empty claims instead of manufacturing passed', () => {
  const result = aggregateVerificationClaims({
    claims: [],
    gateResults: []
  });
  expect(result.overallStatus).toBe('invalidated');
  expect(result.overallReasonCode).toBe('selection-unresolved');
  expect(result.claimResults).toEqual([]);
});

function canonicalAggregateFixture() {
  const gate = BuildVerificationGateResult(minimalValidInput());
  const claims = [{
    claimId: 'claim-1',
    requiredGateIds: ['gate-1'],
    owningEnvironments: ['linux-x64']
  }];
  const gates = [gate];
  const overall = aggregateVerificationClaims({ claims, gateResults: gates });
  return { overall, claims, gates };
}

function aggregateInput(
  fixture: Pick<ReturnType<typeof canonicalAggregateFixture>, 'claims' | 'gates'>
): VerificationAggregateInput {
  return { claims: fixture.claims, gateResults: fixture.gates };
}

test('aggregate assertion accepts the current aggregate writer output', () => {
  const fixture = canonicalAggregateFixture();
  expect(() => assertVerificationAggregateResult(
    fixture.overall,
    aggregateInput(fixture)
  )).not.toThrow();
});

test('strict verification-data boundary accepts JSON data and rejects executable or exotic views', () => {
  const jsonData = JSON.parse('{"alpha":1,"nested":["value",null,true]}') as unknown;
  expect(snapshotVerificationData(jsonData)).toEqual(jsonData);
  const frozenData = Object.freeze({
    alpha: 1,
    nested: Object.freeze(['value', null, true])
  });
  expect(snapshotVerificationData(frozenData)).toEqual(jsonData);
  expect(verificationDataEqual(
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
    expect(() => snapshotVerificationData(candidate)).toThrow();
  }
  expect(candidateCodeExecutions).toBe(0);
});

test('canonical prototype toJSON guards reject without executing and restore exact descriptors', () => {
  const objectDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON');
  const arrayDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, 'toJSON');
  let candidateCodeExecutions = 0;
  let objectError: unknown;
  let arrayError: unknown;
  const restoreDescriptor = (target: object, descriptor: PropertyDescriptor | undefined): void => {
    if (descriptor) {
      Object.defineProperty(target, 'toJSON', descriptor);
    } else if (!Reflect.deleteProperty(target, 'toJSON')) {
      throw new Error('Unable to restore canonical toJSON descriptor absence.');
    }
  };

  try {
    Object.defineProperty(Object.prototype, 'toJSON', {
      configurable: true,
      enumerable: false,
      writable: true,
      value: () => {
        candidateCodeExecutions += 1;
        return { executed: true };
      }
    });
    try {
      Object.defineProperty(Array.prototype, 'toJSON', {
        configurable: true,
        enumerable: false,
        get: () => {
          candidateCodeExecutions += 1;
          return () => {
            candidateCodeExecutions += 1;
            return { executed: true };
          };
        }
      });
      try {
        try {
          snapshotVerificationData({ ordinary: 'object' });
        } catch (error) {
          objectError = error;
        }
        try {
          snapshotVerificationData(['ordinary-array']);
        } catch (error) {
          arrayError = error;
        }
      } finally {
        restoreDescriptor(Array.prototype, arrayDescriptor);
      }
    } finally {
      restoreDescriptor(Object.prototype, objectDescriptor);
    }
  } finally {
    // Both nested restoration paths complete before any matcher, formatting,
    // logging, serialization, or asynchronous boundary can observe mutation.
  }

  expect(objectError).toBeInstanceOf(Error);
  expect((objectError as Error).message).toContain('must not define or inherit toJSON');
  expect(arrayError).toBeInstanceOf(Error);
  expect((arrayError as Error).message).toContain('must not define or inherit toJSON');
  expect(candidateCodeExecutions).toBe(0);
  expect(Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON')).toEqual(objectDescriptor);
  expect(Object.getOwnPropertyDescriptor(Array.prototype, 'toJSON')).toEqual(arrayDescriptor);
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
    expect(() => snapshotVerificationData(candidate.proxy))
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
    expect(() => snapshotVerificationData(candidate.value))
      .toThrow(`must use the canonical ${candidate.expectedPrototype} prototype.`);
    expect(candidate.trapCalls).toEqual([]);
  }
});

test('aggregate input is an exact ordinary container and snapshots trusted views before reduction', () => {
  const fixture = canonicalAggregateFixture();
  const validInput = aggregateInput(fixture);
  expect(aggregateVerificationClaims(validInput).overallStatus).toBe('passed');

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
    expect(() => aggregateVerificationClaims(
      candidate as unknown as VerificationAggregateInput
    )).toThrow();
  }
  expect(getterCalls).toBe(0);

  let trustedCoverageExecutions = 0;
  const mutableInput: VerificationAggregateInput = {
    claims: structuredClone(fixture.claims),
    gateResults: structuredClone(fixture.gates),
    isCoverageComplete: (claim, gates) => {
      trustedCoverageExecutions += 1;
      (mutableInput.claims[0]!.requiredGateIds as string[]).length = 0;
      claim.requiredGateIds.length = 0;
      gates.length = 0;
      return true;
    }
  };
  const snapshotted = aggregateVerificationClaims(mutableInput);
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

  const claimsArray = recordedProxy(structuredClone(fixture.claims), true);
  views.push({
    input: { claims: claimsArray.proxy, gateResults: structuredClone(fixture.gates) },
    trapCalls: claimsArray.trapCalls
  });

  const claimObject = recordedProxy(structuredClone(fixture.claims[0]!), true);
  views.push({
    input: { claims: [claimObject.proxy], gateResults: structuredClone(fixture.gates) },
    trapCalls: claimObject.trapCalls
  });

  const gatesArray = recordedProxy(structuredClone(fixture.gates), true);
  views.push({
    input: { claims: structuredClone(fixture.claims), gateResults: gatesArray.proxy },
    trapCalls: gatesArray.trapCalls
  });

  const gateObject = recordedProxy(structuredClone(fixture.gates[0]!), true);
  views.push({
    input: { claims: structuredClone(fixture.claims), gateResults: [gateObject.proxy] },
    trapCalls: gateObject.trapCalls
  });

  const nestedGateArrayTarget = structuredClone(fixture.gates[0]!);
  const nestedGateArray = recordedProxy(nestedGateArrayTarget.requiredForClaims, true);
  nestedGateArrayTarget.requiredForClaims = nestedGateArray.proxy;
  views.push({
    input: { claims: structuredClone(fixture.claims), gateResults: [nestedGateArrayTarget] },
    trapCalls: nestedGateArray.trapCalls
  });

  const revoked = recordedRevokedProxy(aggregateInput(fixture));
  views.push({
    input: revoked.proxy,
    trapCalls: revoked.trapCalls
  });

  let callbackExecutions = 0;
  const coverageCallback = recordedProxy(() => {
    callbackExecutions += 1;
    return true;
  }, true);
  views.push({
    input: {
      claims: structuredClone(fixture.claims),
      gateResults: structuredClone(fixture.gates),
      isCoverageComplete: coverageCallback.proxy
    },
    trapCalls: coverageCallback.trapCalls
  });

  for (const view of views) {
    expect(() => aggregateVerificationClaims(view.input))
      .toThrow('Verification data must not contain Proxy values.');
    expect(view.trapCalls).toEqual([]);
  }
  expect(callbackExecutions).toBe(0);
});

test('aggregate input rejects Proxy prototypes at every container depth without executing traps', () => {
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

  const claimsArrayPrototype = recordedProxy(Array.prototype);
  const claimsArrayInput = aggregateInput(canonicalAggregateFixture());
  Object.setPrototypeOf(claimsArrayInput.claims, claimsArrayPrototype.proxy);
  claimsArrayPrototype.trapCalls.length = 0;
  views.push({ input: claimsArrayInput, trapCalls: claimsArrayPrototype.trapCalls });

  const gatePrototype = recordedProxy({ inherited: true });
  const gateInput = aggregateInput(canonicalAggregateFixture());
  Object.setPrototypeOf(gateInput.gateResults[0]!, gatePrototype.proxy);
  gatePrototype.trapCalls.length = 0;
  views.push({ input: gateInput, trapCalls: gatePrototype.trapCalls });

  const nestedArrayPrototype = recordedProxy(Array.prototype);
  const nestedArrayInput = aggregateInput(canonicalAggregateFixture());
  Object.setPrototypeOf(
    nestedArrayInput.gateResults[0]!.requiredForClaims,
    nestedArrayPrototype.proxy
  );
  nestedArrayPrototype.trapCalls.length = 0;
  views.push({ input: nestedArrayInput, trapCalls: nestedArrayPrototype.trapCalls });

  for (const view of views) {
    expect(() => aggregateVerificationClaims(view.input))
      .toThrow(/must use the canonical (Object|Array) prototype/);
    expect(view.trapCalls).toEqual([]);
  }
});

test('trusted claims and serialized passes cannot close vacuously', () => {
  const fixture = canonicalAggregateFixture();
  expect(() => aggregateVerificationClaims({
    claims: [{ claimId: 'claim-1', requiredGateIds: [], owningEnvironments: ['linux'] }],
    gateResults: fixture.gates
  })).toThrow(/requiredGateIds must not be empty/);
  expect(() => aggregateVerificationClaims({
    claims: [{ claimId: 'claim-1', requiredGateIds: ['gate-1'], owningEnvironments: [] }],
    gateResults: fixture.gates
  })).toThrow(/owningEnvironments must not be empty/);

  const forgedPass = structuredClone(fixture.overall);
  forgedPass.claimResults[0]!.contributingGateIds = [];
  expect(() => assertVerificationAggregateResult(
    forgedPass,
    aggregateInput(fixture)
  )).toThrow(/passed status requires non-empty contributingGateIds/);

  const callbackCannotCreateCoverage = aggregateVerificationClaims({
    claims: [{
      claimId: 'claim-1',
      requiredGateIds: ['missing-gate'],
      owningEnvironments: ['linux-x64']
    }],
    gateResults: [],
    isCoverageComplete: () => true
  });
  expect(callbackCannotCreateCoverage.claimResults[0]).toMatchObject({
    status: 'not-run',
    coverageComplete: false,
    contributingGateIds: []
  });
});

test('aggregate assertion validates the trusted claim plan identities and exact shape', () => {
  const duplicateClaim = structuredClone(canonicalAggregateFixture());
  duplicateClaim.claims.push(structuredClone(duplicateClaim.claims[0]!));
  expect(() => assertVerificationAggregateResult(
    duplicateClaim.overall,
    aggregateInput(duplicateClaim)
  )).toThrow(/duplicate claimId claim-1/);

  const duplicateRequiredGate = structuredClone(canonicalAggregateFixture());
  duplicateRequiredGate.claims[0]!.requiredGateIds.push('gate-1');
  expect(() => assertVerificationAggregateResult(
    duplicateRequiredGate.overall,
    aggregateInput(duplicateRequiredGate)
  )).toThrow(/requiredGateIds must not contain duplicate identity gate-1/);

  const duplicateOwningEnvironment = structuredClone(canonicalAggregateFixture());
  duplicateOwningEnvironment.claims[0]!.owningEnvironments.push('linux-x64');
  expect(() => assertVerificationAggregateResult(
    duplicateOwningEnvironment.overall,
    aggregateInput(duplicateOwningEnvironment)
  )).toThrow(/owningEnvironments must not contain duplicate identity linux-x64/);

  const invalidOwningEnvironment = structuredClone(canonicalAggregateFixture());
  invalidOwningEnvironment.claims[0]!.owningEnvironments = [''];
  expect(() => assertVerificationAggregateResult(
    invalidOwningEnvironment.overall,
    aggregateInput(invalidOwningEnvironment)
  )).toThrow(/owningEnvironments\[0\] must be a non-empty/);

  const unknownPlanField = structuredClone(canonicalAggregateFixture());
  (unknownPlanField.claims[0] as unknown as Record<string, unknown>).forged = true;
  expect(() => assertVerificationAggregateResult(
    unknownPlanField.overall,
    aggregateInput(unknownPlanField)
  )).toThrow(/unknown or missing fields/);
});

test('aggregate assertion rejects nested unknown fields and status-reason contradictions', () => {
  const unknownAggregateField = structuredClone(canonicalAggregateFixture());
  (unknownAggregateField.overall as unknown as Record<string, unknown>).forged = true;
  expect(() => assertVerificationAggregateResult(
    unknownAggregateField.overall,
    aggregateInput(unknownAggregateField)
  )).toThrow(/unknown or missing fields/);

  const unknownField = structuredClone(canonicalAggregateFixture());
  (unknownField.overall.claimResults[0] as unknown as Record<string, unknown>).forged = true;
  expect(() => assertVerificationAggregateResult(
    unknownField.overall,
    aggregateInput(unknownField)
  )).toThrow(/unknown or missing fields/);

  const contradictoryReason = structuredClone(canonicalAggregateFixture());
  contradictoryReason.overall.claimResults[0]!.reasonCode = 'executed-failure';
  expect(() => assertVerificationAggregateResult(
    contradictoryReason.overall,
    aggregateInput(contradictoryReason)
  )).toThrow(/passed status requires reasonCode executed-success/);

  const unknownGateField = structuredClone(canonicalAggregateFixture());
  (unknownGateField.gates[0] as unknown as Record<string, unknown>).forged = true;
  expect(() => assertVerificationAggregateResult(
    unknownGateField.overall,
    aggregateInput(unknownGateField)
  )).toThrow(/unknown or missing fields/);

  const unknownEnvironmentField = structuredClone(canonicalAggregateFixture());
  (unknownEnvironmentField.gates[0]!.environment as unknown as Record<string, unknown>).forged = true;
  expect(() => assertVerificationAggregateResult(
    unknownEnvironmentField.overall,
    aggregateInput(unknownEnvironmentField)
  )).toThrow(/unknown or missing fields/);

  const unknownExecutionField = structuredClone(canonicalAggregateFixture());
  (unknownExecutionField.gates[0]!.execution as unknown as Record<string, unknown>).forged = true;
  expect(() => assertVerificationAggregateResult(
    unknownExecutionField.overall,
    aggregateInput(unknownExecutionField)
  )).toThrow(/unknown or missing fields/);
});

test('aggregate assertion rejects invalid and duplicate claim, gate, and contributor identities', () => {
  const controlClaim = structuredClone(canonicalAggregateFixture());
  controlClaim.overall.claimResults[0]!.claimId = 'claim\u0000forged';
  expect(() => assertVerificationAggregateResult(
    controlClaim.overall,
    aggregateInput(controlClaim)
  )).toThrow(/control-character-free/);

  const duplicateClaim = structuredClone(canonicalAggregateFixture());
  duplicateClaim.overall.claimResults.push(structuredClone(duplicateClaim.overall.claimResults[0]!));
  expect(() => assertVerificationAggregateResult(
    duplicateClaim.overall,
    aggregateInput(duplicateClaim)
  )).toThrow(/duplicate claimId/);

  const duplicateGate = structuredClone(canonicalAggregateFixture());
  duplicateGate.gates.push(structuredClone(duplicateGate.gates[0]!));
  expect(() => assertVerificationAggregateResult(
    duplicateGate.overall,
    aggregateInput(duplicateGate)
  )).toThrow(/duplicate gate observation/);

  const duplicateContributor = structuredClone(canonicalAggregateFixture());
  duplicateContributor.overall.claimResults[0]!.contributingGateIds.push('gate-1');
  expect(() => assertVerificationAggregateResult(
    duplicateContributor.overall,
    aggregateInput(duplicateContributor)
  )).toThrow(/duplicate identity gate-1/);
});

test('aggregate assertion rejects empty, control, and missing identities at every linkage layer', () => {
  const candidates = [] as Array<ReturnType<typeof canonicalAggregateFixture>>;

  const emptyClaim = structuredClone(canonicalAggregateFixture());
  emptyClaim.overall.claimResults[0]!.claimId = '';
  candidates.push(emptyClaim);
  const missingClaim = structuredClone(canonicalAggregateFixture());
  delete (missingClaim.overall.claimResults[0] as unknown as Record<string, unknown>).claimId;
  candidates.push(missingClaim);

  const emptyGate = structuredClone(canonicalAggregateFixture());
  emptyGate.gates[0]!.gateId = '';
  candidates.push(emptyGate);
  const controlGate = structuredClone(canonicalAggregateFixture());
  controlGate.gates[0]!.gateId = 'gate\u0000forged';
  candidates.push(controlGate);
  const missingGate = structuredClone(canonicalAggregateFixture());
  delete (missingGate.gates[0] as unknown as Record<string, unknown>).gateId;
  candidates.push(missingGate);

  const emptyContributor = structuredClone(canonicalAggregateFixture());
  emptyContributor.overall.claimResults[0]!.contributingGateIds = [''];
  candidates.push(emptyContributor);
  const controlContributor = structuredClone(canonicalAggregateFixture());
  controlContributor.overall.claimResults[0]!.contributingGateIds = ['gate\u0000forged'];
  candidates.push(controlContributor);
  const missingContributors = structuredClone(canonicalAggregateFixture());
  delete (missingContributors.overall.claimResults[0] as unknown as Record<string, unknown>)
    .contributingGateIds;
  candidates.push(missingContributors);

  const emptyRequiredLink = structuredClone(canonicalAggregateFixture());
  emptyRequiredLink.gates[0]!.requiredForClaims = [''];
  candidates.push(emptyRequiredLink);
  const controlSupportedLink = structuredClone(canonicalAggregateFixture());
  controlSupportedLink.gates[0]!.supportedClaims = ['claim\u0000forged'];
  candidates.push(controlSupportedLink);
  const missingRequiredLinks = structuredClone(canonicalAggregateFixture());
  delete (missingRequiredLinks.gates[0] as unknown as Record<string, unknown>).requiredForClaims;
  candidates.push(missingRequiredLinks);
  const missingSupportedLinks = structuredClone(canonicalAggregateFixture());
  delete (missingSupportedLinks.gates[0] as unknown as Record<string, unknown>).supportedClaims;
  candidates.push(missingSupportedLinks);

  for (const candidate of candidates) {
    expect(() => assertVerificationAggregateResult(
      candidate.overall,
      aggregateInput(candidate)
    )).toThrow();
  }
});

test('aggregate assertion rejects unknown contributors, incomplete passed coverage, and overall contradictions', () => {
  const unknownContributor = structuredClone(canonicalAggregateFixture());
  unknownContributor.overall.claimResults[0]!.contributingGateIds = ['unknown-gate'];
  expect(() => assertVerificationAggregateResult(
    unknownContributor.overall,
    aggregateInput(unknownContributor)
  )).toThrow(/unknown contributing gateId/);

  const incompletePassed = structuredClone(canonicalAggregateFixture());
  incompletePassed.overall.claimResults[0]!.coverageComplete = false;
  expect(() => assertVerificationAggregateResult(
    incompletePassed.overall,
    aggregateInput(incompletePassed)
  )).toThrow(/passed status requires coverageComplete=true/);

  const contradictoryOverall = structuredClone(canonicalAggregateFixture());
  contradictoryOverall.overall.overallStatus = 'invalidated';
  contradictoryOverall.overall.overallReasonCode = 'selection-unresolved';
  expect(() => assertVerificationAggregateResult(
    contradictoryOverall.overall,
    aggregateInput(contradictoryOverall)
  )).toThrow(/does not exactly match the canonical aggregate writer output/);
});

test('aggregate assertion requires bidirectional claim linkage while allowing unrelated extra gates', () => {
  const missingRequiredLink = structuredClone(canonicalAggregateFixture());
  missingRequiredLink.gates[0]!.requiredForClaims = [];
  expect(() => assertVerificationAggregateResult(
    missingRequiredLink.overall,
    aggregateInput(missingRequiredLink)
  )).toThrow(/lacks requiredForClaims linkage/);

  const missingSupportedLink = structuredClone(canonicalAggregateFixture());
  missingSupportedLink.gates[0]!.supportedClaims = [];
  expect(() => assertVerificationAggregateResult(
    missingSupportedLink.overall,
    aggregateInput(missingSupportedLink)
  )).toThrow(/lacks supportedClaims linkage/);

  const unknownClaim = structuredClone(canonicalAggregateFixture());
  unknownClaim.overall.claimResults[0]!.claimId = 'unknown-claim';
  expect(() => assertVerificationAggregateResult(
    unknownClaim.overall,
    aggregateInput(unknownClaim)
  )).toThrow(/does not exactly match the canonical aggregate writer output/);

  const { overall, claims, gates } = canonicalAggregateFixture();
  const extraGate = BuildVerificationGateResult({
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
  const supportOnlyExtraGate = BuildVerificationGateResult({
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

  const offPlanSelectedClaimGate = BuildVerificationGateResult({
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
  expect(() => assertVerificationAggregateResult(
    overall,
    { claims, gateResults: [...gates, offPlanSelectedClaimGate] }
  )).toThrow(/absent from the trusted claim plan/);

  expect(() => assertVerificationAggregateResult(
    overall,
    { claims, gateResults: [...gates, extraGate, supportOnlyExtraGate] }
  )).not.toThrow();
});

// ---------------------------------------------------------------------------
// Legacy mapping contract
// ---------------------------------------------------------------------------

test('mapProductVerificationStatus never promotes skipped to passed', () => {
  const contexts = [
    { requestedLane: 'fast' as const, lane: 'runtime' as const },
    { requestedLane: 'all' as const, lane: 'runtime' as const, fastFailed: true },
    { requestedLane: 'all' as const, lane: 'runtime' as const, currentRunnerOwning: false },
    { requestedLane: 'all' as const, lane: 'runtime' as const, currentRunnerOwning: true }
  ];
  for (const ctx of contexts) {
    const result = mapProductVerificationStatus('skipped', ctx);
    expect(result.status).not.toBe('passed');
  }
});
