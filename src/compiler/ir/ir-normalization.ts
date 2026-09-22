import type { SemanticAttribute, SemanticAttributeValue } from '../../semantics/engineering-ir/entity-types.ts';
import type { EvidenceReference, FactProvenance, SemanticFactObject, SemanticValue } from '../../semantics/engineering-ir/fact-types.ts';
import { compareCodeUnits, uniqueSorted, uniqueSortedByKey } from '../../contracts/canonical.ts';

export { uniqueSorted };

interface ManifestProvenanceInput {
  blockId: string;
  manifestPath?: string;
}

export function normalizeSemanticValue(value: SemanticValue): SemanticValue {
  if (Array.isArray(value)) return value.map(normalizeSemanticValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => compareCodeUnits(left, right))
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
    .sort((left, right) => compareCodeUnits(left.key, right.key));
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


export function manifestProvenance(entry: ManifestProvenanceInput): FactProvenance[] {
  return [{
    kind: 'contract',
    sourceId: `manifest:${entry.blockId}`,
    ...(entry.manifestPath ? { sourcePath: entry.manifestPath } : {})
  }];
}

export function compilerProvenance(sourceId: string): FactProvenance[] {
  return [{ kind: 'compiler', sourceId }];
}
