import { validateProvenanceFile } from '../../semantics/provenance/authority.ts';
import type { ProvenanceFile } from '../../semantics/provenance/types.ts';
import { readOptionalRetainedJson } from '../runtime-state/physical/runtime/retained-file-read.ts';

/**
 * Canonical retained read owner for Provenance V1. Only physical absence maps
 * to null; malformed JSON, linked/non-ordinary paths and invalid Provenance
 * shape all fail closed.
 */
export function readOptionalProvenanceFile(
  filePath: string,
  label = 'Provenance'
): ProvenanceFile | null {
  const raw = readOptionalRetainedJson<unknown>(filePath, label);
  return raw === null ? null : validateProvenanceFile(raw);
}
