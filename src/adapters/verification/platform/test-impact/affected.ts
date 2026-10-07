import { uniqueSorted } from '../../../../contracts/canonical.ts';
import { isFastTestFile, isSlowTestFile } from './contract/budget.ts';
import {
  isTestImpactModuleGraphInputFile,
  isTestImpactSourceFile,
  resolveTestImpactSelectionTrustBoundary,
  selectTestsForSources,
  type CodexDevelopmentTestImpactSourceProvider
} from './runtime/impact.ts';

export type CodexDevelopmentAffectedTestInventory = {
  changedFastTests: string[];
  changedSlowTests: string[];
  affectedFastTests: string[];
  affectedSlowTests: string[];
  selectedFastTests: string[];
  selectedSlowTests: string[];
  affectedOwners: string[];
  sourceChanged: boolean;
  /**
   * Whether the reverse-import-map closure used to compute `affectedFastTests`
   * was fully resolved. False when a repository module could not be read or a
   * local code import could not be resolved, meaning the affected closure may be
   * incomplete. When `sourceChanged && !selectionResolved`, callers MUST fail
   * closed instead of treating an empty `selectedFastTests` as "no impact".
   */
  selectionResolved: boolean;
  /**
   * Repository modules whose import graph could not be resolved. Always empty when
   * `selectionResolved` is true. Surfaced for diagnostics and projection to
   * the unified verification result model.
   */
  unresolvedModuleFiles: string[];
};

export function CodexDevelopmentAffectedInventoryInputs(
  changedPaths: readonly string[],
  currentTestPathIsRunnable: (file: string) => boolean
): string[] {
  return uniqueSorted(changedPaths.filter((file) => (
    (!isFastTestFile(file) && !isSlowTestFile(file)) || currentTestPathIsRunnable(file)
  )));
}

export function CodexDevelopmentBuildAffectedTestInventory(
  files: readonly string[],
  provider: CodexDevelopmentTestImpactSourceProvider
): CodexDevelopmentAffectedTestInventory {
  const changedFastTests = uniqueSorted(files.filter(isFastTestFile));
  const changedSlowTests = uniqueSorted(files.filter(isSlowTestFile));
  const impactSourceFiles = files.filter((file) => isTestImpactSourceFile(file, provider));
  const impact = selectTestsForSources(impactSourceFiles, provider);
  // The reverse-import-map is built once during selectTestsForSources (cached
  // for the default provider). Re-fetch the trust boundary from the same cache
  // to avoid a second scan; in provider mode it rebuilds but the provider's
  // test file set is stable for this call.
  // A direct test/slow-test or declarative non-source change has no reverse
  // module-graph frontier. Avoid constructing the graph (and, in the default
  // provider mode, touching its persistent cache) for that already-complete
  // empty source batch. Unknown source-like paths still enter the graph path
  // through `impactSourceFiles` and therefore remain fail-closed.
  const graphImpactSourceFiles = impactSourceFiles.filter((file) => (
    isTestImpactModuleGraphInputFile(file, provider)
  ));
  const resolution = graphImpactSourceFiles.length === 0
    ? { selectionResolved: true, unresolvedModuleFiles: [] }
    : resolveTestImpactSelectionTrustBoundary(provider);
  const affectedFastTests = uniqueSorted(impact.fast.filter(isFastTestFile));
  const affectedSlowTests = uniqueSorted(impact.slow.filter(isSlowTestFile));
  return {
    changedFastTests,
    changedSlowTests,
    affectedFastTests,
    affectedSlowTests,
    selectedFastTests: uniqueSorted([...changedFastTests, ...affectedFastTests]),
    selectedSlowTests: uniqueSorted([...changedSlowTests, ...affectedSlowTests]),
    affectedOwners: uniqueSorted(impact.owners),
    sourceChanged: impactSourceFiles.length > 0,
    selectionResolved: resolution.selectionResolved,
    unresolvedModuleFiles: resolution.unresolvedModuleFiles
  };
}

// ---------------------------------------------------------------------------
// Affected Selection Trust Boundary
// ---------------------------------------------------------------------------
//
// Classifies the result of an affected-test selection into a trust boundary
// and projects it to the unified VerificationGateResult model (PR #204).
//
// The core problem this solves: `test-runner.ts` used to return exit 0 when
// `sourceChanged=true && selectedFastTests=[]` even when the empty closure was
// caused by an unresolved selection (module read/stat failure, git discovery
// failure, or unmapped ownership). That silently treated "could not determine
// impact" as "no impact" — a false-green.
//
// The schema identity comes from its dependency-free canonical owner. The full
// verification-result implementation remains outside this runtime closure and
// is consumed only as a type here.

export { classifyAffectedSelectionTrustBoundary, defaultAffectedSelectionProjectionContext, isAffectedSelectionFailClosed, projectAffectedSelectionToVerificationGateResult, type AffectedSelectionClassificationInput, type AffectedSelectionProjectionContext, type AffectedSelectionTrustBoundary } from './contract/selection-boundary.ts';
