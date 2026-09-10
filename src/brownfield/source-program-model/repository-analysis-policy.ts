import { compareCodeUnits, sha256 } from '../../system-architecture/foundation/runtime/canonical.ts';

type Digest = `sha256:${string}`;

/** Analysis input, not a grant. The repository model uses this inventory when
 * recognizing derived source addresses; it never authorizes native processes.
 * Keep it outside the TypeScript fact-shard key: syntax facts do not depend on it.
 */
export type RepositoryAnalysisPolicy = Readonly<{
  reviewedProcessDispatchers: readonly string[];
  policyDigest: Digest;
}>;

/** Select a deterministic set without invoking a caller's array iterator or
 * accessor slots. The repository/TCB owner still owns dispatcher address grammar.
 * This only captures the already-existing string inventory, not a new exception
 * registry, approval mechanism or more permissive process boundary.
 */
export function captureRepositoryAnalysisPolicy(
  input: readonly string[] | undefined
): RepositoryAnalysisPolicy {
  const selected = new Set<string>();
  if (input !== undefined) {
    if (!Array.isArray(input)) throw new TypeError('Reviewed process dispatchers must be a string array');
    const length = Object.getOwnPropertyDescriptor(input, 'length')!.value as number;
    for (let index = 0; index < length; index++) {
      const slot = Object.getOwnPropertyDescriptor(input, String(index));
      if (slot === undefined || !('value' in slot) || typeof slot.value !== 'string') {
        throw new TypeError('Reviewed process dispatchers require own string data entries');
      }
      selected.add(slot.value);
    }
  }
  const reviewedProcessDispatchers = Object.freeze([...selected].sort(compareCodeUnits));
  return Object.freeze({
    reviewedProcessDispatchers,
    policyDigest: sha256({
      schema: 'sec-repository-analysis-policy-v1',
      reviewedProcessDispatchers
    }) as Digest
  });
}

/** Read a comparison input, not authority. Missing legacy context, corrupted
 * digests and noncanonical inventories remain unknown; they do not mean an
 * explicitly empty policy. Receipt provenance is checked by reconciliation.
 */
export function repositoryAnalysisPolicyDigest(value: unknown): Digest | null {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
    const entries = Object.getOwnPropertyDescriptor(value, 'reviewedProcessDispatchers');
    const digest = Object.getOwnPropertyDescriptor(value, 'policyDigest');
    if (entries === undefined || !('value' in entries) || !Array.isArray(entries.value)
        || digest === undefined || !('value' in digest) || typeof digest.value !== 'string') return null;
    const canonical = captureRepositoryAnalysisPolicy(entries.value);
    if (canonical.policyDigest !== digest.value
        || canonical.reviewedProcessDispatchers.length !== entries.value.length
        || canonical.reviewedProcessDispatchers.some((entry, index) =>
          entry !== Object.getOwnPropertyDescriptor(entries.value, String(index))?.value)) return null;
    return canonical.policyDigest;
  } catch {
    return null;
  }
}
