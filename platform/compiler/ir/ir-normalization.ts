import type {
  EvidenceReference,
  FactProvenance,
  ScenarioDefinition,
  SemanticAttribute,
  SemanticAttributeValue,
  SemanticFactObject,
  SemanticValue
} from '../../shared/engineering-ir-types.ts';
import type { EngineeringIRManifestInput } from './build-engineering-ir.ts';

export function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function uniqueSortedByKey<Value>(values: readonly Value[], keyOf: (value: Value) => string): Value[] {
  const byKey = new Map<string, Value>();
  for (const value of values) byKey.set(keyOf(value), value);
  return [...byKey.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, value]) => value);
}

export function normalizeSemanticValue(value: SemanticValue): SemanticValue {
  if (Array.isArray(value)) return value.map(normalizeSemanticValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalizeSemanticValue(entry)])
    );
  }
  return value;
}

export function normalizeFactObject(object: SemanticFactObject): SemanticFactObject {
  return object.kind === 'entity'
    ? object
    : { kind: 'value', value: normalizeSemanticValue(object.value) };
}

function normalizeAttributeValue(value: SemanticAttributeValue): SemanticAttributeValue {
  return Array.isArray(value) ? [...value] : value;
}

export function normalizeAttributes(attributes: readonly SemanticAttribute[]): SemanticAttribute[] {
  return [...attributes]
    .map((attribute) => ({ ...attribute, value: normalizeAttributeValue(attribute.value) }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

function provenanceKey(provenance: FactProvenance): string {
  return [provenance.kind, provenance.sourceId, provenance.sourcePath ?? '', provenance.revision ?? ''].join('\u0000');
}

function evidenceKey(evidence: EvidenceReference): string {
  return [evidence.kind, evidence.ref, evidence.digest ?? ''].join('\u0000');
}

export function normalizeProvenance(provenance: readonly FactProvenance[]): FactProvenance[] {
  return uniqueSortedByKey(provenance, provenanceKey);
}

export function normalizeEvidence(evidence: readonly EvidenceReference[]): EvidenceReference[] {
  return uniqueSortedByKey(evidence, evidenceKey);
}

export function normalizeScenario(scenario: ScenarioDefinition): ScenarioDefinition {
  return {
    ...scenario,
    factIds: uniqueSorted(scenario.factIds),
    steps: [...scenario.steps]
      .map((step) => ({ ...step, afterStepIds: uniqueSorted(step.afterStepIds) }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    acceptanceEntityIds: uniqueSorted(scenario.acceptanceEntityIds)
  };
}

export function manifestProvenance(entry: EngineeringIRManifestInput): FactProvenance[] {
  return [{
    kind: 'contract',
    sourceId: `manifest:${entry.blockId}`,
    ...(entry.manifestPath ? { sourcePath: entry.manifestPath } : {})
  }];
}

export function compilerProvenance(sourceId: string): FactProvenance[] {
  return [{ kind: 'compiler', sourceId }];
}
