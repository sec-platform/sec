import { CanonicalKeyConflictError, compareCodeUnits, isPlainObject, uniqueSorted, uniqueSortedByKey } from '../../contracts/canonical.ts';
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

function provenanceKey(provenance: FactProvenance): string {
  return [provenance.kind, provenance.sourceId, provenance.sourcePath ?? '', provenance.revision ?? ''].join('\u0000');
}

function evidenceKey(evidence: EvidenceReference): string {
  return [evidence.kind, evidence.ref, evidence.digest ?? ''].join('\u0000');
}

/** Duplicate comparison is deliberately flat and descriptor-based: do not call
 * toJSON/getters or let JSON omit competing fields. Unique legacy records never
 * pass through this narrower duplicate-comparison domain. */
function metadataWireFields(value: unknown): [string, string][] {
  if (!isPlainObject(value)) throw new TypeError('IR metadata duplicates require plain data records');
  return Reflect.ownKeys(value).map(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || descriptor === undefined || !descriptor.enumerable
      || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'string') {
      throw new TypeError('IR metadata duplicates require enumerable own string data');
    }
    return [key, descriptor.value];
  });
}

/** These legacy consumers include insertion-ordered metadata JSON in identity.
 * Preserve each unique record; equal canonical data with different wire bytes
 * is ambiguous here and must not silently choose a historical preimage. */
function uniqueSortedMetadataByKey<Value>(values: readonly Value[], keyOf: (value: Value) => string): Value[] {
  const byKey = new Map<string, Value>();
  return uniqueSortedByKey(values, value => {
    const key = keyOf(value);
    if (byKey.has(key)) {
      const previous = metadataWireFields(byKey.get(key));
      const current = metadataWireFields(value);
      if (previous.length !== current.length || previous.some(([field, data], index) =>
        field !== current[index]![0] || data !== current[index]![1])) throw new CanonicalKeyConflictError();
    } else {
      byKey.set(key, value);
    }
    return key;
  });
}

export function normalizeProvenance(provenance: readonly FactProvenance[]): FactProvenance[] {
  return uniqueSortedMetadataByKey(provenance, provenanceKey);
}

export function normalizeEvidence(evidence: readonly EvidenceReference[]): EvidenceReference[] {
  return uniqueSortedMetadataByKey(evidence, evidenceKey);
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
