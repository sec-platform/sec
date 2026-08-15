import {
  canonicalJson,
  compareCodeUnits
} from '../../platform/shared/canonical-primitives.ts';
import {
  CodexDevelopmentClassifyWorkPackageCensusV1,
  type CodexDevelopmentWorkPackageCensusEntryV1
} from './document-control-plane-contract.ts';

const WORK_PACKAGE_PATH_PATTERN = /^docs\/work-packages\/[a-z0-9][a-z0-9-]*\.md$/u;

export function isCanonicalAgentOperationActivationWorkPackagePathV1(value: string): boolean {
  return WORK_PACKAGE_PATH_PATTERN.test(value);
}

/**
 * Pure hosted-PRE projection of the canonical Work Package census. It returns
 * only default-tree manifests that the proposal must delete; Git observation
 * and activation reason-code mapping remain adapter responsibilities.
 */
export function assertAgentOperationActivationWorkPackageCensusV1(input: Readonly<{
  selectedManifestPath: string;
  candidateEntries: readonly CodexDevelopmentWorkPackageCensusEntryV1[];
  defaultPackagePaths: readonly string[];
  roadmapSource?: string;
}>): readonly string[] {
  const defaultPackagePaths = [...input.defaultPackagePaths].sort(compareCodeUnits);
  if (defaultPackagePaths.some((entry) =>
    !isCanonicalAgentOperationActivationWorkPackagePathV1(entry))
      || new Set(defaultPackagePaths).size !== defaultPackagePaths.length) {
    throw new Error(`Default Work Package paths are noncanonical: ${JSON.stringify(defaultPackagePaths)}`);
  }
  const census = CodexDevelopmentClassifyWorkPackageCensusV1({
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
