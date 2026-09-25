import { cloneAndDeepFreeze, compareCodeUnits } from '../../contracts/canonical.ts';
import { fail } from '../../contracts/failure.ts';
import { SEMANTIC_ENTITY_KINDS, type SemanticEntity } from '../../semantics/engineering-ir/entity-types.ts';
import { FACT_PROVENANCE_KINDS, SEMANTIC_AUTHORITIES, SEMANTIC_PREDICATES, type SemanticFact } from '../../semantics/engineering-ir/fact-types.ts';
import { assertEngineeringIRPredicateSignatures } from '../../semantics/engineering-ir/predicate-signatures.ts';
import { ENGINEERING_IR_FORMAT_VERSION, type EngineeringIR } from '../../semantics/engineering-ir/root-types.ts';
import { type ValidatedEngineeringIRSnapshot } from '../../semantics/engineering-ir/validated-types.ts';
import {
  buildEngineeringIR,
  type BuildEngineeringIRInput
} from './build-engineering-ir.ts';
import { factAssertionId } from './ir-fact-store.ts';
import {
  appEntityId,
  assertEngineeringIRReferences,
  engineeringGraphId,
  factIdentity
} from './ir-identity.ts';
import {
  normalizeAttributes,
  normalizeEvidence,
  normalizeFactObject,
  normalizeProvenance
} from './ir-normalization.ts';
import { rawSha256Hex, inputRevisionPayload, semanticRevisionPayload } from './ir-revision.ts';
import { deriveScenarioDefinitions } from './scenario-facts.ts';

const semanticEntityKinds = new Set<string>(SEMANTIC_ENTITY_KINDS);
const semanticPredicates = new Set<string>(SEMANTIC_PREDICATES);
const semanticAuthorities = new Set<string>(SEMANTIC_AUTHORITIES);
const factProvenanceKinds = new Set<string>(FACT_PROVENANCE_KINDS);

function assertCanonicalIds(values: readonly { id: string }[], collection: string): void {
  for (let index = 0; index < values.length; index += 1) {
    const current = values[index]!.id;
    const previous = values[index - 1]?.id;
    if (!current.trim() || (previous !== undefined && compareCodeUnits(previous, current) >= 0)) {
      fail(
        'IR-VALIDATION-005',
        `Engineering IR ${collection} must contain unique ids in canonical order`,
        { collection, previousId: previous, currentId: current, index }
      );
    }
  }
}

function entityIdMatchesKind(entity: SemanticEntity): boolean {
  if (entity.kind === 'scenario-step') {
    return /^scenario:.+#step:.+$/.test(entity.id);
  }
  if (entity.kind === 'port') {
    return /^port:.+:(?:input|output):.+$/.test(entity.id);
  }
  if (entity.kind === 'field') {
    return /^field:[^:]+:.+\..+$/.test(entity.id);
  }
  return entity.id.startsWith(`${entity.kind}:`) && entity.id.length > entity.kind.length + 1;
}

function assertEntityIdentities(ir: EngineeringIR): void {
  assertCanonicalIds(ir.entities, 'entities');
  for (const entity of ir.entities) {
    if (
      !semanticEntityKinds.has(entity.kind) ||
      !entityIdMatchesKind(entity) ||
      (entity.kind === 'app' && entity.id !== ir.appId)
    ) {
      fail(
        'IR-VALIDATION-006',
        `Semantic entity "${entity.id}" does not match canonical ${entity.kind} identity`,
        { entityId: entity.id, entityKind: entity.kind, appId: ir.appId }
      );
    }
    if (JSON.stringify(entity.attributes) !== JSON.stringify(normalizeAttributes(entity.attributes))) {
      fail(
        'IR-VALIDATION-005',
        `Semantic entity "${entity.id}" attributes are not canonically normalized`,
        { entityId: entity.id }
      );
    }
  }
}

function expectedFactId(fact: SemanticFact): string {
  return `fact:${rawSha256Hex(factIdentity(fact)).slice(0, 24)}`;
}

function assertFactIdentities(ir: EngineeringIR): void {
  assertCanonicalIds(ir.facts, 'facts');
  for (const fact of ir.facts) {
    if (!semanticPredicates.has(fact.predicate)) {
      fail(
        'IR-PREDICATE-006',
        `Semantic fact "${fact.id}" uses predicate "${String(fact.predicate)}" outside the total registry`,
        { factId: fact.id, predicate: fact.predicate, subject: fact.subject, object: fact.object }
      );
    }
    if (fact.id !== expectedFactId(fact)) {
      fail(
        'IR-VALIDATION-007',
        `Semantic fact "${fact.id}" does not match its canonical triple identity`,
        { factId: fact.id, expectedFactId: expectedFactId(fact) }
      );
    }
    if (JSON.stringify(fact.object) !== JSON.stringify(normalizeFactObject(fact.object))) {
      fail(
        'IR-VALIDATION-005',
        `Semantic fact "${fact.id}" object is not canonically normalized`,
        { factId: fact.id }
      );
    }

    assertCanonicalIds(fact.assertions, `fact:${fact.id}:assertions`);
    for (const assertion of fact.assertions) {
      if (
        !semanticAuthorities.has(assertion.authority) ||
        assertion.provenance.some((entry) => !factProvenanceKinds.has(entry.kind))
      ) {
        fail(
          'IR-VALIDATION-008',
          `Fact assertion "${assertion.id}" contains non-canonical authority or provenance kind`,
          {
            factId: fact.id,
            assertionId: assertion.id,
            authority: assertion.authority,
            provenanceKinds: assertion.provenance.map((entry) => entry.kind)
          }
        );
      }
      if (JSON.stringify(assertion.provenance) !== JSON.stringify(normalizeProvenance(assertion.provenance)) ||
        JSON.stringify(assertion.evidence) !== JSON.stringify(normalizeEvidence(assertion.evidence))) {
        fail(
          'IR-VALIDATION-005',
          `Fact assertion "${assertion.id}" is not canonically normalized`,
          { factId: fact.id, assertionId: assertion.id }
        );
      }
      const expectedAssertionId = factAssertionId(fact.id, assertion.authority, assertion.provenance);
      if (assertion.id !== expectedAssertionId) {
        fail(
          'IR-VALIDATION-008',
          `Fact assertion "${assertion.id}" does not match its canonical identity`,
          { factId: fact.id, assertionId: assertion.id, expectedAssertionId }
        );
      }
      if (assertion.validFromRevision !== ir.semanticRevision) {
        fail(
          'IR-VALIDATION-009',
          `Fact assertion "${assertion.id}" validity is not bound to the IR semantic revision`,
          {
            factId: fact.id,
            assertionId: assertion.id,
            validFromRevision: assertion.validFromRevision,
            semanticRevision: ir.semanticRevision
          }
        );
      }
    }
  }
}

function assertScenarioCache(ir: EngineeringIR): void {
  assertCanonicalIds(ir.scenarios, 'scenarios');
  const derived = deriveScenarioDefinitions(ir.entities, ir.facts);
  if (JSON.stringify(ir.scenarios) !== JSON.stringify(derived)) {
    fail(
      'IR-VALIDATION-010',
      'Engineering IR ScenarioDefinition cache does not match canonical Entities/Facts',
      { scenarioIds: ir.scenarios.map((scenario) => scenario.id) }
    );
  }
}

export function validateEngineeringIR(
  ir: EngineeringIR,
  input: BuildEngineeringIRInput
): ValidatedEngineeringIRSnapshot {
  if (ir.formatVersion !== ENGINEERING_IR_FORMAT_VERSION) {
    fail(
      'IR-VALIDATION-001',
      `Unsupported Engineering IR formatVersion "${String(ir.formatVersion)}"`,
      { expected: ENGINEERING_IR_FORMAT_VERSION, actual: ir.formatVersion }
    );
  }

  const expectedAppId = appEntityId(input.app.id);
  const expectedGraphId = engineeringGraphId(input.app.id);
  if (ir.appId !== expectedAppId || ir.graphId !== expectedGraphId) {
    fail(
      'IR-VALIDATION-002',
      'Engineering IR app/graph identity does not match the declared input domain',
      { appId: ir.appId, expectedAppId, graphId: ir.graphId, expectedGraphId }
    );
  }

  assertEntityIdentities(ir);
  assertFactIdentities(ir);
  assertEngineeringIRReferences(new Set(ir.entities.map((entity) => entity.id)), ir.facts, ir.scenarios);
  assertEngineeringIRPredicateSignatures(ir.entities, ir.facts);
  assertScenarioCache(ir);

  const expectedInputRevision = `sha256:${rawSha256Hex(inputRevisionPayload(input))}`;
  if (ir.inputRevision !== expectedInputRevision) {
    fail(
      'IR-VALIDATION-003',
      'Engineering IR inputRevision does not match the declared input domain',
      { inputRevision: ir.inputRevision, expectedInputRevision }
    );
  }

  const expectedSemanticRevision = `sha256:${rawSha256Hex(semanticRevisionPayload(
    ir.graphId,
    ir.appId,
    ir.entities,
    ir.facts,
    ir.scenarios
  ))}`;
  if (ir.semanticRevision !== expectedSemanticRevision) {
    fail(
      'IR-VALIDATION-004',
      'Engineering IR semanticRevision does not match the canonical semantic graph',
      { semanticRevision: ir.semanticRevision, expectedSemanticRevision }
    );
  }

  const frozenIR = cloneAndDeepFreeze(ir);
  return Object.freeze({ ir: frozenIR }) as ValidatedEngineeringIRSnapshot;
}

export function buildValidatedEngineeringIR(
  input: BuildEngineeringIRInput
): ValidatedEngineeringIRSnapshot {
  return validateEngineeringIR(buildEngineeringIR(input), input);
}
