import { uniqueSorted } from '../../../../contracts/canonical.ts';
import { canonicalAcceptanceTestPath } from '../../../../semantics/acceptance/source.ts';
import type { FastVerificationLaneReport, RuntimeVerificationLaneReport } from '../../contract/types.ts';

export interface AcceptanceProofBinding {
  readonly testPath: string;
  readonly acceptanceIds: readonly string[];
}

/** All required files must actually pass. Repeated declarations aggregate
 * requirements; a weaker declaration cannot bypass another declaration. */
export function acceptanceIdsProvenByVerificationReports(
  fast: FastVerificationLaneReport,
  runtime: RuntimeVerificationLaneReport,
  enabledAcceptanceIds: readonly string[],
  bindings: readonly AcceptanceProofBinding[]
): string[] {
  const fastPath = (file: string) => canonicalAcceptanceTestPath(file.startsWith('tests/') ? file : `tests/acceptance/${file}`);
  const passed = new Set([
    ...(fast.status !== 'skipped' && fast.acceptance.status !== 'skipped' ? fast.acceptance.passed.map(fastPath) : []),
    ...(runtime.status !== 'skipped' && runtime.acceptance.status !== 'skipped' && runtime.acceptance.command !== null
      ? runtime.acceptance.passed.map(canonicalAcceptanceTestPath) : [])
  ]);
  const failed = new Set([...fast.acceptance.failed.map(fastPath), ...runtime.acceptance.failed.map(canonicalAcceptanceTestPath)]);
  if ([...passed].some(path => failed.has(path))) throw new Error('Acceptance test cannot be both passed and failed');
  const required = new Map<string, Set<string>>();
  for (const binding of bindings) {
    const path = canonicalAcceptanceTestPath(binding.testPath);
    for (const id of binding.acceptanceIds) {
      const paths = required.get(id) ?? new Set<string>();
      paths.add(path);
      required.set(id, paths);
    }
  }
  return uniqueSorted(enabledAcceptanceIds.filter(id => {
    const paths = required.get(id);
    return paths !== undefined && paths.size > 0 && [...paths].every(path => passed.has(path));
  }));
}
