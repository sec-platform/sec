import { CanonicalKeyConflictError, compareCodeUnits, uniqueSorted } from '../../contracts/canonical.ts';
import type { SemanticAttribute, SemanticAttributeValue } from '../../semantics/engineering-ir/entity-types.ts';
import type { EvidenceReference, FactProvenance, SemanticFactObject, SemanticValue } from '../../semantics/engineering-ir/fact-types.ts';

export { uniqueSorted };

interface ManifestProvenanceInput {
  blockId: string;
  manifestPath?: string;
}

function normalizeSemanticValue(value: SemanticValue): SemanticValue {
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

function provenanceFields(provenance: FactProvenance): readonly (string | undefined)[] {
  return [provenance.kind, provenance.sourceId, provenance.sourcePath, provenance.revision];
}

function evidenceFields(evidence: EvidenceReference): readonly (string | undefined)[] {
  return [evidence.kind, evidence.ref, evidence.digest];
}

/** Keep the legacy key order and native JSON wire identity for stable metadata.
 * Tuple equality rejects delimiter/optional-field collisions; wire equality also
 * preserves property order and extension data. This is not a hostile-object boundary. */
function uniqueSortedMetadata<Value>(
  values: readonly Value[],
  fieldsOf: (value: Value) => readonly (string | undefined)[]
): Value[] {
  const byKey = new Map<string, { value: Value; fields: readonly (string | undefined)[] }>();
  for (const value of values) {
    const fields = fieldsOf(value);
    const key = fields.join('\u0000');
    const previous = byKey.get(key);
    if (previous !== undefined && (previous.fields.some((field, index) => field !== fields[index])
      || (previous.value !== value && JSON.stringify(previous.value) !== JSON.stringify(value)))) {
      throw new CanonicalKeyConflictError();
    }
    byKey.set(key, { value, fields });
  }
  return [...byKey.entries()].sort(([left], [right]) => compareCodeUnits(left, right)).map(([, entry]) => entry.value);
}

export function normalizeProvenance(provenance: readonly FactProvenance[]): FactProvenance[] {
  return uniqueSortedMetadata(provenance, provenanceFields);
}

export function normalizeEvidence(evidence: readonly EvidenceReference[]): EvidenceReference[] {
  return uniqueSortedMetadata(evidence, evidenceFields);
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
