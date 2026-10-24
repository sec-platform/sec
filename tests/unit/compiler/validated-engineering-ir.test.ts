import { expect, test } from 'bun:test';

import { buildEngineeringIR, type BuildEngineeringIRInput } from '../../../src/compiler/ir/build-engineering-ir.ts';
import { indexValidatedEngineeringIR } from '../../../src/compiler/ir/index-engineering-ir.ts';
import { factAssertionId } from '../../../src/compiler/ir/ir-fact-store.ts';
import { factIdentity } from '../../../src/compiler/ir/ir-identity.ts';
import { digest } from '../../../src/compiler/ir/ir-revision.ts';
import { buildValidatedEngineeringIR, validateEngineeringIR } from '../../../src/compiler/ir/validate-engineering-ir.ts';
import { CodedFailure } from '../../../src/contracts/failure.ts';

function input(): BuildEngineeringIRInput {
  return {
    app: { id: 'validated-app', name: 'Validated App' },
    resolvedBlocks: [{
      id: 'ticket/basic',
      version: '0.1.0',
      kind: 'capability',
      installOrder: 1,
      manifestPath: 'catalog/registry/official/ticket.basic/block.manifest.yaml',
      registrySourceId: 'official',
      registryKind: 'official',
      registryLocation: 'compiler',
      registryPath: 'catalog/registry/official'
    }],
    manifests: [],
    acceptanceIds: [],
    policyDeclarations: []
  };
}

function clone<Value>(value: Value): Value {
  return structuredClone(value);
}

function expectCodedFailure(run: () => unknown, code: string): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(CodedFailure);
    expect((error as CodedFailure).code).toBe(code);
    return;
  }
  throw new Error(`Expected CodedFailure ${code}`);
}

test('validated snapshots are produced only after the full boundary and are deeply frozen', () => {
  const source = input();
  const snapshot = buildValidatedEngineeringIR(source);
  const index = indexValidatedEngineeringIR(snapshot);

  expect(index.entityById.has('app:validated-app')).toBe(true);
  expect(Object.isFrozen(snapshot)).toBe(true);
  expect(Object.isFrozen(snapshot.ir)).toBe(true);
  expect(Object.isFrozen(snapshot.ir.entities)).toBe(true);
  expect(Object.isFrozen(snapshot.ir.entities[0])).toBe(true);

  if (false) {
    const raw = buildEngineeringIR(source);
    // @ts-expect-error Ordinary EngineeringIR is not a ValidatedEngineeringIRSnapshot.
    indexValidatedEngineeringIR(raw);
  }
});

test('validator rejects stale input and semantic revisions', () => {
  const source = input();
  const staleInput = clone(buildEngineeringIR(source));
  staleInput.inputRevision = 'sha256:stale-input';
  expectCodedFailure(() => validateEngineeringIR(staleInput, source), 'IR-VALIDATION-003');

  const staleSemantic = clone(buildEngineeringIR(source));
  staleSemantic.entities[0]!.label = 'Tampered label';
  expectCodedFailure(() => validateEngineeringIR(staleSemantic, source), 'IR-VALIDATION-004');
});

test('validator rejects forged Entity, Fact, Assertion, and validity identities', () => {
  const source = input();

  const forgedEntity = clone(buildEngineeringIR(source));
  forgedEntity.entities[0]!.id = 'block:forged-app';
  expectCodedFailure(() => validateEngineeringIR(forgedEntity, source), 'IR-VALIDATION-006');

  const forgedFact = clone(buildEngineeringIR(source));
  forgedFact.facts[0]!.id = 'fact:forged';
  expectCodedFailure(() => validateEngineeringIR(forgedFact, source), 'IR-VALIDATION-007');

  const forgedAssertion = clone(buildEngineeringIR(source));
  forgedAssertion.facts[0]!.assertions[0]!.id = 'assertion:forged';
  expectCodedFailure(() => validateEngineeringIR(forgedAssertion, source), 'IR-VALIDATION-008');

  const staleValidity = clone(buildEngineeringIR(source));
  staleValidity.facts[0]!.assertions[0]!.validFromRevision = 'sha256:stale-validity';
  expectCodedFailure(() => validateEngineeringIR(staleValidity, source), 'IR-VALIDATION-009');
});

test('raw IR identity admission cannot execute getter or Proxy-controlled id reads', () => {
  const source = input();
  for (const pick of [
    (ir: ReturnType<typeof buildEngineeringIR>) => ir.entities[0]!,
    (ir: ReturnType<typeof buildEngineeringIR>) => ir.facts[0]!,
    (ir: ReturnType<typeof buildEngineeringIR>) => ir.facts[0]!.assertions[0]!
  ]) {
    const ir = clone(buildEngineeringIR(source));
    let getterCalls = 0;
    Object.defineProperty(pick(ir), 'id', {
      enumerable: true, configurable: true,
      get() { getterCalls += 1; throw new Error('identity getter must never run'); }
    });
    expectCodedFailure(() => validateEngineeringIR(ir, source), 'IR-VALIDATION-005');
    expect(getterCalls).toBe(0);
  }
  const withProxy = clone(buildEngineeringIR(source));
  let proxyTraps = 0;
  withProxy.facts[0]!.assertions[0] = new Proxy(withProxy.facts[0]!.assertions[0]!, {
    get() { proxyTraps += 1; throw new Error('identity Proxy trap must never run'); },
    getOwnPropertyDescriptor() { proxyTraps += 1; throw new Error('descriptor trap must never run'); }
  });
  expectCodedFailure(() => validateEngineeringIR(withProxy, source), 'IR-VALIDATION-005');
  expect(proxyTraps).toBe(0);
});

test('raw IR root field access refuses getters before reading semantics', () => {
  const source = input();
  const ir = clone(buildEngineeringIR(source));
  let reads = 0;
  Object.defineProperty(ir, 'facts', {
    enumerable: true, configurable: true,
    get() { reads += 1; throw new Error('root getter must never run'); }
  });
  expectCodedFailure(() => validateEngineeringIR(ir, source), 'IR-VALIDATION-005');
  expect(reads).toBe(0);
});

test('all nested raw IR properties reject accessors before semantic readers run', () => {
  const source = input();
  for (const select of [
    (ir: ReturnType<typeof buildEngineeringIR>) => ({ record: ir.entities[0]!, key: 'kind' }),
    (ir: ReturnType<typeof buildEngineeringIR>) => ({ record: ir.facts[0]!, key: 'predicate' }),
    (ir: ReturnType<typeof buildEngineeringIR>) => ({ record: ir.facts[0]!.object, key: 'kind' }),
    (ir: ReturnType<typeof buildEngineeringIR>) => ({
      record: ir.facts[0]!.assertions[0]!.provenance[0]!, key: 'sourceId'
    })
  ]) {
    const ir = clone(buildEngineeringIR(source));
    const { record, key } = select(ir);
    let calls = 0;
    Object.defineProperty(record, key, {
      configurable: true, enumerable: true,
      get() { calls += 1; throw Error('Raw IR property getter must not run'); }
    });
    expectCodedFailure(() => validateEngineeringIR(ir, source), 'IR-VALIDATION-005');
    expect(calls).toBe(0);
  }
});

test('raw IR rejects nested Proxy, custom iterators and executable toJSON without calling them', () => {
  const source = input();
  const proxied = clone(buildEngineeringIR(source));
  let proxyTraps = 0;
  proxied.facts[0]!.object = new Proxy(proxied.facts[0]!.object, {
    get() { proxyTraps += 1; throw Error('Nested Proxy get must not run'); },
    ownKeys() { proxyTraps += 1; throw Error('Nested Proxy ownKeys must not run'); }
  });
  expectCodedFailure(() => validateEngineeringIR(proxied, source), 'IR-VALIDATION-005');
  expect(proxyTraps).toBe(0);

  const iterable = clone(buildEngineeringIR(source));
  let iteratorCalls = 0;
  Object.defineProperty(iterable.entities, Symbol.iterator, {
    value() { iteratorCalls += 1; throw Error('Custom iterator must not run'); }
  });
  expectCodedFailure(() => validateEngineeringIR(iterable, source), 'IR-VALIDATION-005');
  expect(iteratorCalls).toBe(0);

  const hook = clone(buildEngineeringIR(source));
  let calls = 0;
  Object.defineProperty(hook.facts[0]!, 'toJSON', {
    value() { calls += 1; throw Error('toJSON must not run'); }
  });
  expectCodedFailure(() => validateEngineeringIR(hook, source), 'IR-VALIDATION-005');
  expect(calls).toBe(0);
});

test('raw validator rejects invalid confidence, empty provenance and unsupported closed validity', () => {
  const source = input();
  for (const confidence of [NaN, Infinity, -Infinity, -0.01, 1.01]) {
    const forged = clone(buildEngineeringIR(source));
    forged.facts[0]!.assertions[0]!.confidence = confidence;
    expectCodedFailure(() => validateEngineeringIR(forged, source), 'IR-VALIDATION-008');
  }
  const missingProvenance = clone(buildEngineeringIR(source));
  missingProvenance.facts[0]!.assertions[0]!.provenance = [];
  expectCodedFailure(() => validateEngineeringIR(missingProvenance, source), 'IR-VALIDATION-008');

  const closed = clone(buildEngineeringIR(source));
  closed.facts[0]!.assertions[0]!.validToRevision = closed.semanticRevision;
  expectCodedFailure(() => validateEngineeringIR(closed, source), 'IR-VALIDATION-009');
});

test('raw validator checks bounded evidence identities without letting JSON hooks execute', () => {
  const source = input();
  const valid = clone(buildEngineeringIR(source));
  valid.facts[0]!.assertions[0]!.evidence = [{
    kind: 'verification', ref: 'acceptance:case-a', digest: `sha256:${'a'.repeat(64)}`
  }];
  // A new evidence claim changes semantic meaning. It must not be accepted
  // against the unchanged revision; the identity itself is still well-formed.
  expectCodedFailure(() => validateEngineeringIR(valid, source), 'IR-VALIDATION-004');

  for (const record of [
    { kind: '', ref: 'case' }, { kind: 'verification', ref: '' },
    { kind: 'verification', ref: ' case ' },
    { kind: 'verification', ref: 'case', digest: 'not-a-digest' },
    { kind: 'verification', ref: 'x'.repeat(2_049) },
    { kind: 'verification', ref: 'case', unapproved: 'extra' }
  ]) {
    const forged = clone(buildEngineeringIR(source));
    forged.facts[0]!.assertions[0]!.evidence = [record] as never;
    expectCodedFailure(() => validateEngineeringIR(forged, source), 'IR-VALIDATION-008');
  }
  const excessive = clone(buildEngineeringIR(source));
  excessive.facts[0]!.assertions[0]!.evidence = Array.from({ length: 1_025 },
    (_, index) => ({ kind: 'test', ref: `case:${index}` }));
  expectCodedFailure(() => validateEngineeringIR(excessive, source), 'IR-VALIDATION-008');

  let getterCalls = 0;
  const dangerous = clone(buildEngineeringIR(source));
  dangerous.facts[0]!.assertions[0]!.evidence = [{
    kind: 'verification',
    ref: 'case',
    get digest() { getterCalls++; throw Error('must not execute'); }
  }] as never;
  expectCodedFailure(() => validateEngineeringIR(dangerous, source), 'IR-VALIDATION-005');
  expect(getterCalls).toBe(0);
});

test('a non-equivalent duplicated entity attribute cannot obtain a validated identity', () => {
  const source = input();
  const forged = clone(buildEngineeringIR(source));
  const owner = forged.entities.find((entity) => entity.attributes.length > 0)!;
  const first = owner.attributes[0]!;
  owner.attributes.push({ ...first, value: 'conflicting-value' });
  expect(() => validateEngineeringIR(forged, source)).toThrow();
});

test('validator reports stable diagnostics for forged runtime enum values', () => {
  const source = input();

  const unknownPredicate = clone(buildEngineeringIR(source));
  const predicateFact = unknownPredicate.facts[0]!;
  predicateFact.predicate = 'UNKNOWN' as typeof predicateFact.predicate;
  expectCodedFailure(() => validateEngineeringIR(unknownPredicate, source), 'IR-PREDICATE-006');

  const unknownAuthority = clone(buildEngineeringIR(source));
  const authorityFact = unknownAuthority.facts[0]!;
  const assertion = authorityFact.assertions[0]!;
  assertion.authority = 'unknown' as typeof assertion.authority;
  assertion.id = factAssertionId(authorityFact.id, assertion.authority, assertion.provenance);
  expectCodedFailure(() => validateEngineeringIR(unknownAuthority, source), 'IR-VALIDATION-008');

  const unknownProvenance = clone(buildEngineeringIR(source));
  const provenanceFact = unknownProvenance.facts[0]!;
  const provenanceAssertion = provenanceFact.assertions[0]!;
  provenanceAssertion.provenance[0]!.kind = 'unknown' as typeof provenanceAssertion.provenance[number]['kind'];
  provenanceAssertion.id = factAssertionId(
    provenanceFact.id,
    provenanceAssertion.authority,
    provenanceAssertion.provenance
  );
  expectCodedFailure(() => validateEngineeringIR(unknownProvenance, source), 'IR-VALIDATION-008');
});

test('validator rejects non-canonical collection ordering before issuing a snapshot', () => {
  const source = input();
  const reordered = clone(buildEngineeringIR(source));
  reordered.entities.reverse();
  expectCodedFailure(() => validateEngineeringIR(reordered, source), 'IR-VALIDATION-005');
});

test('illegal Predicate/Object shapes are rejected through the unified validator', () => {
  const source = input();
  const illegal = clone(buildEngineeringIR(source));
  const fact = illegal.facts[0]!;
  fact.predicate = 'WRITES';
  fact.id = `fact:${digest(factIdentity(fact)).slice(0, 24)}`;
  fact.assertions[0]!.id = factAssertionId(
    fact.id,
    fact.assertions[0]!.authority,
    fact.assertions[0]!.provenance
  );

  expectCodedFailure(() => validateEngineeringIR(illegal, source), 'IR-PREDICATE-002');
});
