import { canonicalJson, compareCodeUnits } from '../../../../contracts/canonical.ts';
import {
  ClassifyWorkPackageCensus,
  type WorkPackageCensusEntry
} from '../documentation/document-control-plane-contract.ts';

const WORK_PACKAGE_PATH_PATTERN = /^config\/repository\/work-packages\/[a-z0-9][a-z0-9-]*\.md$/u;

/** Validate the exact declared paths against one NUL-delimited Git tree read. */
export function assertAgentOperationActivationTestCensus(
  testPaths: readonly string[],
  treeBytes: Uint8Array
): void {
  if (treeBytes.length === 0 || treeBytes.at(-1) !== 0) {
    throw new Error('candidate-test-census-is-empty-or-unterminated');
  }
  const source = new TextDecoder('utf-8', { fatal: true }).decode(treeBytes.subarray(0, -1));
  const regularFiles = new Set<string>();
  const observedPaths = new Set<string>();
  for (const record of source.split('\0')) {
    const entry = /^([0-7]{6}) (blob|tree|commit) (?:[0-9a-f]{40}|[0-9a-f]{64})\t([^\0]+)$/u.exec(record);
    if (entry === null || observedPaths.has(entry[3]!)) {
      throw new Error('candidate-test-census-malformed');
    }
    const [, mode, kind, repositoryPath] = entry;
    observedPaths.add(repositoryPath!);
    if ((mode === '100644' || mode === '100755') && kind === 'blob') {
      regularFiles.add(repositoryPath!);
    }
  }
  const missing = testPaths.filter((testPath) => !regularFiles.has(testPath));
  if (missing.length > 0) {
    throw new Error(`work-package-test-blobs-missing:${JSON.stringify(missing)}`);
  }
}

export function isCanonicalAgentOperationActivationWorkPackagePath(value: string): boolean {
  return WORK_PACKAGE_PATH_PATTERN.test(value);
}

/**
 * Pure hosted-PRE projection of the canonical Work Package census. It returns
 * only default-tree manifests that the proposal must delete; Git observation
 * and activation reason-code mapping remain adapter responsibilities.
 */
export function assertAgentOperationActivationWorkPackageCensus(input: Readonly<{
  selectedManifestPath: string;
  candidateEntries: readonly WorkPackageCensusEntry[];
  defaultPackagePaths: readonly string[];
  roadmapSource?: string;
}>): readonly string[] {
  const defaultPackagePaths = [...input.defaultPackagePaths].sort(compareCodeUnits);
  if (defaultPackagePaths.some((entry) =>
    !isCanonicalAgentOperationActivationWorkPackagePath(entry))
      || new Set(defaultPackagePaths).size !== defaultPackagePaths.length) {
    throw new Error(`Default Work Package paths are noncanonical: ${JSON.stringify(defaultPackagePaths)}`);
  }
  const census = ClassifyWorkPackageCensus({
    selectedManifestPath: input.selectedManifestPath,
    entries: input.candidateEntries,
    ...(input.roadmapSource === undefined ? {} : { roadmapSource: input.roadmapSource })
  });
  if (census.ambiguousPredecessorPaths.length > 0 || census.stalePackagePaths.length > 0) {
    throw new Error(`Candidate Work Package census is not activatable: ${JSON.stringify(canonicalJson({
      ambiguousPredecessorPaths: census.ambiguousPredecessorPaths,
      stalePackagePaths: census.stalePackagePaths
    }))}`);
  }
  const candidatePaths = new Set(input.candidateEntries.map(({ path: entryPath }) => entryPath));
  return Object.freeze(defaultPackagePaths.filter((entry) => !candidatePaths.has(entry)));
}
