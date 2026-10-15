import { types as nodeTypes } from 'node:util';
import { canonicalJson, cloneAndDeepFreeze, compareCodeUnits } from '../../contracts/canonical.ts';
import { isDigest } from '../../contracts/digest.ts';
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
  assertEngineeringIRInputIdentities,
  assertEngineeringIRReferences,
  engineeringGraphId,
  factIdentity,
  isCanonicalSemanticEntityIdentity
} from './ir-identity.ts';
import {
  normalizeAttributes,
  normalizeEvidence,
  normalizeFactObject,
  normalizeProvenance
} from './ir-normalization.ts';
import { digest, inputRevisionPayload, semanticRevisionPayload } from './ir-revision.ts';
import { deriveScenarioDefinitions } from './scenario-facts.ts';

const semanticEntityKinds = new Set<string>(SEMANTIC_ENTITY_KINDS);
const semanticPredicates = new Set<string>(SEMANTIC_PREDICATES);
const semanticAuthorities = new Set<string>(SEMANTIC_AUTHORITIES);
const factProvenanceKinds = new Set<string>(FACT_PROVENANCE_KINDS);

/** Read identity without running caller-supplied getters or Proxy traps.
 * This is the shared reader for Entities, Facts, Assertions and Scenarios. */
function assertCanonicalIds(values: readonly { id: string }[], collection: string): void {
  if (nodeTypes.isProxy(values) || !Array.isArray(values)) {
    fail('IR-VALIDATION-005', `Engineering IR ${collection} must be an own-data array`, { collection });
  }
  let previous: string | undefined;
  for (let index = 0; index < values.length; index += 1) {
    const slot = Object.getOwnPropertyDescriptor(values, String(index));
    const item = slot?.value as unknown;
    if (!slot || !Object.hasOwn(slot, 'value') || !slot.enumerable
        || item === null || typeof item !== 'object' || nodeTypes.isProxy(item)) {
      fail('IR-VALIDATION-005', `Engineering IR ${collection} has a non-data identity entry`,
        { collection, index });
    }
    const descriptor = Object.getOwnPropertyDescriptor(item, 'id');
    if (!descriptor || !Object.hasOwn(descriptor, 'value')
        || !descriptor.enumerable || typeof descriptor.value !== 'string') {
      fail('IR-VALIDATION-005', `Engineering IR ${collection} identity must be own string data`,
        { collection, index });
    }
    const current = descriptor.value;
    if (!current.trim() || (previous !== undefined && compareCodeUnits(previous, current) >= 0)) {
      fail(
        'IR-VALIDATION-005',
        `Engineering IR ${collection} must contain unique ids in canonical order`,
        { collection, previousId: previous, currentId: current, index }
      );
    }
    previous = current;
  }
}

function assertEngineeringIRTopLevelData(ir: EngineeringIR): void {
  if (ir === null || typeof ir !== 'object' || nodeTypes.isProxy(ir) || Array.isArray(ir)) {
    fail('IR-VALIDATION-005', 'Engineering IR root must be an own-data record');
  }
  for (const key of ['formatVersion', 'appId', 'graphId', 'inputRevision',
    'semanticRevision', 'entities', 'facts', 'scenarios']) {
    const descriptor = Object.getOwnPropertyDescriptor(ir, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) {
      fail('IR-VALIDATION-005', `Engineering IR root field "${key}" must be own data`);
    }
  }
}

function entityIdMatchesKind(entity: SemanticEntity): boolean {
  return isCanonicalSemanticEntityIdentity(entity);
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

/** An evidence reference identifies a source claim, never a PASS receipt.
 * Identity is the exact (kind, ref, optional digest) tuple; formats remain open
 * under a bounded lexical domain, with only real 256-bit digests accepted. */
function assertEvidenceReferences(
  value: unknown,
  factId: string,
  assertionId: string
): void {
  if (!Array.isArray(value) || value.length > 1_024) {
    fail('IR-VALIDATION-008', 'Fact assertion evidence must be a bounded array',
      { factId, assertionId });
  }
  const evidence = value as unknown[];
  for (let index = 0; index < evidence.length; index += 1) {
    const slot = Object.getOwnPropertyDescriptor(evidence, String(index));
    if (slot === undefined || !Object.hasOwn(slot, 'value')) {
      fail('IR-VALIDATION-008', 'Fact assertion evidence requires own data entries',
        { factId, assertionId, index });
    }
    const ref = slot.value as unknown;
    if (ref === null || typeof ref !== 'object' || Array.isArray(ref)) {
      fail('IR-VALIDATION-008', 'Fact assertion evidence entry must be a data record',
        { factId, assertionId, index });
    }
    const descriptors = Object.getOwnPropertyDescriptors(ref);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== 'string' || !['kind', 'ref', 'digest'].includes(key)
        || !descriptors[key]?.enumerable || !Object.hasOwn(descriptors[key], 'value'))) {
      fail('IR-VALIDATION-008', 'Fact assertion evidence entry has unknown or non-data fields',
        { factId, assertionId, index });
    }
    const kind = descriptors.kind?.value;
    const reference = descriptors.ref?.value;
    const digestValue = descriptors.digest?.value;
    if (typeof kind !== 'string' || !/^[a-z][a-z0-9._-]{0,63}$/u.test(kind)
        || typeof reference !== 'string' || reference.length === 0
        || reference.trim() !== reference || Buffer.byteLength(reference, 'utf8') > 2_048
        || /[\u0000-\u001f\u007f]/u.test(reference)
        || (descriptors.digest !== undefined
          && !isDigest(digestValue, 'sha256') && !isDigest(digestValue, 'blake3'))) {
      fail('IR-VALIDATION-008', 'Fact assertion evidence identity or digest is not canonical',
        { factId, assertionId, index });
    }
  }
}

function expectedFactId(fact: SemanticFact): string {
  return `fact:${digest(factIdentity(fact)).slice(0, 24)}`;
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
      // Read descriptors first: an oversized array must be refused before the
      // canonical traversal allocates a normalized copy of its contents.
      if (assertion === null || typeof assertion !== 'object'
          || Array.isArray(assertion) || nodeTypes.isProxy(assertion)) {
        fail('IR-VALIDATION-008', 'Fact assertion must be an ordinary data record',
          { factId: fact.id });
      }
      const provenanceDescriptor = Object.getOwnPropertyDescriptor(assertion, 'provenance');
      const evidenceDescriptor = Object.getOwnPropertyDescriptor(assertion, 'evidence');
      if (!provenanceDescriptor || !Object.hasOwn(provenanceDescriptor, 'value')
          || !Array.isArray(provenanceDescriptor.value)
          || nodeTypes.isProxy(provenanceDescriptor.value)
          || provenanceDescriptor.value.length === 0
          || provenanceDescriptor.value.length > 1_024
          || !evidenceDescriptor || !Object.hasOwn(evidenceDescriptor, 'value')
          || !Array.isArray(evidenceDescriptor.value)
          || nodeTypes.isProxy(evidenceDescriptor.value)
          || evidenceDescriptor.value.length > 1_024) {
        fail('IR-VALIDATION-008', 'Fact assertion source/evidence arrays are invalid or exceed V1 limits',
          { factId: fact.id });
      }
      // Validate own-data shape before JSON.stringify, which otherwise invokes
      // attacker-controlled getters/toJSON and can launder invalid authority.
      try {
        canonicalJson(assertion);
      } catch {
        fail('IR-VALIDATION-008', 'Fact assertion must contain canonical own data',
          { factId: fact.id, assertionId: assertion.id });
      }
      if (!Number.isFinite(assertion.confidence)
          || assertion.confidence < 0 || assertion.confidence > 1
          || !Array.isArray(assertion.provenance)
          || assertion.provenance.length === 0) {
        fail('IR-VALIDATION-008', 'Fact assertion has invalid confidence or empty provenance',
          { factId: fact.id, assertionId: assertion.id });
      }
      assertEvidenceReferences(assertion.evidence, fact.id, assertion.id);
      if (Object.hasOwn(assertion, 'validToRevision')) {
        fail('IR-VALIDATION-009',
          'Engineering IR V1 cannot validate unsupported closed assertion validity',
          { factId: fact.id, assertionId: assertion.id });
      }
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
  assertEngineeringIRTopLevelData(ir);
  assertEngineeringIRInputIdentities(input);
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

  const expectedInputRevision = `sha256:${digest(inputRevisionPayload(input))}`;
  if (ir.inputRevision !== expectedInputRevision) {
    fail(
      'IR-VALIDATION-003',
      'Engineering IR inputRevision does not match the declared input domain',
      { inputRevision: ir.inputRevision, expectedInputRevision }
    );
  }

  const expectedSemanticRevision = `sha256:${digest(semanticRevisionPayload(
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
