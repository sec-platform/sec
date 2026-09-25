import { expect, test } from 'bun:test';

import { CompilerError } from '../../src/compiler/errors.ts';
import { buildEngineeringIR, type BuildEngineeringIRInput } from '../../src/compiler/ir/build-engineering-ir.ts';
import { indexValidatedEngineeringIR } from '../../src/compiler/ir/index-engineering-ir.ts';
import { factAssertionId } from '../../src/compiler/ir/ir-fact-store.ts';
import { factIdentity } from '../../src/compiler/ir/ir-identity.ts';
import { rawSha256Hex } from '../../src/compiler/ir/ir-revision.ts';
import { buildValidatedEngineeringIR, validateEngineeringIR } from '../../src/compiler/ir/validate-engineering-ir.ts';

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

function expectCompilerError(run: () => unknown, code: string): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(CompilerError);
    expect((error as CompilerError).code).toBe(code);
    return;
  }
  throw new Error(`Expected CompilerError ${code}`);
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

  const raw = buildEngineeringIR(source);
  if (false) {
    // @ts-expect-error Ordinary EngineeringIR is not a ValidatedEngineeringIRSnapshot.
    indexValidatedEngineeringIR(raw);
  }
});

test('validator rejects stale input and semantic revisions', () => {
  const source = input();
  const staleInput = clone(buildEngineeringIR(source));
  staleInput.inputRevision = 'sha256:stale-input';
  expectCompilerError(() => validateEngineeringIR(staleInput, source), 'IR-VALIDATION-003');

  const staleSemantic = clone(buildEngineeringIR(source));
  staleSemantic.entities[0]!.label = 'Tampered label';
  expectCompilerError(() => validateEngineeringIR(staleSemantic, source), 'IR-VALIDATION-004');
});

test('validator rejects forged Entity, Fact, Assertion, and validity identities', () => {
  const source = input();

  const forgedEntity = clone(buildEngineeringIR(source));
  forgedEntity.entities[0]!.id = 'block:forged-app';
  expectCompilerError(() => validateEngineeringIR(forgedEntity, source), 'IR-VALIDATION-006');

  const forgedFact = clone(buildEngineeringIR(source));
  forgedFact.facts[0]!.id = 'fact:forged';
  expectCompilerError(() => validateEngineeringIR(forgedFact, source), 'IR-VALIDATION-007');

  const forgedAssertion = clone(buildEngineeringIR(source));
  forgedAssertion.facts[0]!.assertions[0]!.id = 'assertion:forged';
  expectCompilerError(() => validateEngineeringIR(forgedAssertion, source), 'IR-VALIDATION-008');

  const staleValidity = clone(buildEngineeringIR(source));
  staleValidity.facts[0]!.assertions[0]!.validFromRevision = 'sha256:stale-validity';
  expectCompilerError(() => validateEngineeringIR(staleValidity, source), 'IR-VALIDATION-009');
});

test('validator reports stable diagnostics for forged runtime enum values', () => {
  const source = input();

  const unknownPredicate = clone(buildEngineeringIR(source));
  const predicateFact = unknownPredicate.facts[0]!;
  predicateFact.predicate = 'UNKNOWN' as typeof predicateFact.predicate;
  expectCompilerError(() => validateEngineeringIR(unknownPredicate, source), 'IR-PREDICATE-006');

  const unknownAuthority = clone(buildEngineeringIR(source));
  const authorityFact = unknownAuthority.facts[0]!;
  const assertion = authorityFact.assertions[0]!;
  assertion.authority = 'unknown' as typeof assertion.authority;
  assertion.id = factAssertionId(authorityFact.id, assertion.authority, assertion.provenance);
  expectCompilerError(() => validateEngineeringIR(unknownAuthority, source), 'IR-VALIDATION-008');

  const unknownProvenance = clone(buildEngineeringIR(source));
  const provenanceFact = unknownProvenance.facts[0]!;
  const provenanceAssertion = provenanceFact.assertions[0]!;
  provenanceAssertion.provenance[0]!.kind = 'unknown' as typeof provenanceAssertion.provenance[number]['kind'];
  provenanceAssertion.id = factAssertionId(
    provenanceFact.id,
    provenanceAssertion.authority,
    provenanceAssertion.provenance
  );
  expectCompilerError(() => validateEngineeringIR(unknownProvenance, source), 'IR-VALIDATION-008');
});

test('validator rejects non-canonical collection ordering before issuing a snapshot', () => {
  const source = input();
  const reordered = clone(buildEngineeringIR(source));
  reordered.entities.reverse();
  expectCompilerError(() => validateEngineeringIR(reordered, source), 'IR-VALIDATION-005');
});

test('illegal Predicate/Object shapes are rejected through the unified validator', () => {
  const source = input();
  const illegal = clone(buildEngineeringIR(source));
  const fact = illegal.facts[0]!;
  fact.predicate = 'WRITES';
  fact.id = `fact:${rawSha256Hex(factIdentity(fact)).slice(0, 24)}`;
  fact.assertions[0]!.id = factAssertionId(
    fact.id,
    fact.assertions[0]!.authority,
    fact.assertions[0]!.provenance
  );

  expectCompilerError(() => validateEngineeringIR(illegal, source), 'IR-PREDICATE-002');
});
