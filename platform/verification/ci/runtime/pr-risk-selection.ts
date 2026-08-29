import { CodexDevelopmentIsActiveDocumentationPathV1 } from '../../../shared/active-documentation-contract.ts';
import { CodexDevelopmentBuildAffectedTestInventoryV1 } from '../../../shared/affected-test-inventory.ts';
import type { CodexDevelopmentTestImpactTransitionObservationV1 } from '../index.ts';
import { uniqueSorted } from '../../../foundation/collections.ts';
import {
  getSlowTestSuitesSync,
  isFastTestFile,
  isSlowTestFile,
  slowTestPrRiskBaselineSuiteIds,
  slowTestSuiteIdsForFile
} from '../../test-impact/index.ts';
import {
  resolveTestImpactForFilesV1,
  resolveTestImpactRiskPolicies,
  type CodexDevelopmentTestImpactSourceProviderV2
} from '../../test-impact/index.ts';

export type CiPrRiskSlowSuiteSelection = {
  suites: string[];
  slowTests: string[];
  affectedSlowTests: string[];
  owners: string[];
  reasons: Array<
    'bounded-baseline'
    | 'changed-files-unresolved'
    | 'direct-slow-test'
    | 'ownership-impact'
  >;
  resolved: boolean;
};

function baselineSlowSuiteIds(): string[] {
  return slowTestPrRiskBaselineSuiteIds();
}

function slowSuiteIdsForChangedPath(
  file: string,
  transition?: CodexDevelopmentTestImpactTransitionObservationV1
): string[] {
  const direct = slowTestSuiteIdsForFile(file);
  if (direct.length > 0 || transition === undefined) return direct;
  // A rename reports both endpoints. If the canonical suite registry was
  // updated to the new endpoint in the same transition, retain that suite's
  // risk identity for the old/base endpoint without ever making the deleted
  // path executable. Unknown endpoints remain unresolved below.
  return uniqueSorted(transition.records
    .filter((record) => record.status === 'renamed' && record.previousPath === file)
    .flatMap((record) => slowTestSuiteIdsForFile(record.path)));
}

function suitesForSlowTests(
  slowTests: string[],
  transition?: CodexDevelopmentTestImpactTransitionObservationV1
): string[] {
  const suites = getSlowTestSuitesSync();
  return uniqueSorted(
    slowTests.flatMap((file) =>
      uniqueSorted([
        ...suites.filter((suite) => suite.files.includes(file)).map((suite) => suite.id),
        // Keep the canonical registry identity for a removed/renamed path;
        // the active suite file list remains the only executable projection.
        ...slowSuiteIdsForChangedPath(file, transition)
      ])
    )
  );
}

export function selectCiPrRiskSlowSuites(
  files: string[] | null,
  provider?: CodexDevelopmentTestImpactSourceProviderV2,
  transition?: CodexDevelopmentTestImpactTransitionObservationV1
): CiPrRiskSlowSuiteSelection {
  if (!files) {
    return {
      suites: baselineSlowSuiteIds(),
      slowTests: [],
      affectedSlowTests: [],
      owners: ['bounded-slow-risk'],
      reasons: ['bounded-baseline', 'changed-files-unresolved'],
      resolved: false
    };
  }

  const boundedBaselineRequired = resolveTestImpactRiskPolicies(files, transition)
    .includes('slow-risk-baseline');
  const inventory = CodexDevelopmentBuildAffectedTestInventoryV1(files, provider, transition);
  const directlyChangedSlowTests = inventory.changedSlowTests;
  // Use the batch inventory + hasTestImpactForFile (which leverages the
  // reverse-import-map) instead of per-file CodexDevelopmentBuildAffectedTestInventoryV1
  // recomputation. The overall inventory provides aggregate impact; per-file
  // resolution is a cheap O(1) lookup against declarations/fallback/reverse-map.
  const resolvedImpactFiles = resolveTestImpactForFilesV1(files, provider, transition);
  const unresolvedFiles = files.filter((file) => {
    if (
      CodexDevelopmentIsActiveDocumentationPathV1(file)
      || isFastTestFile(file)
      || isSlowTestFile(file)
    ) return false;
    return !resolvedImpactFiles.has(file);
  });
  const selectionResolved = unresolvedFiles.length === 0;
  const affectedSlowTests = uniqueSorted([
    ...directlyChangedSlowTests,
    ...inventory.affectedSlowTests
  ]);
  const impactedSuites = suitesForSlowTests(affectedSlowTests, transition);
  const unresolvedSlowTests = directlyChangedSlowTests.filter((file) => (
    slowSuiteIdsForChangedPath(file, transition).length === 0
  ));
  // `tests/e2e/**` is a syntactic slow-test shape, not a suite authority.
  // A deleted/renamed path absent from the immutable registry cannot be
  // safely mapped to a risk owner; keep it typed-unresolved instead of
  // allowing a bare path to become a runnable slow selection.
  const finalSelectionResolved = selectionResolved && unresolvedSlowTests.length === 0;
  const baselineSuites = boundedBaselineRequired || !finalSelectionResolved
    ? baselineSlowSuiteIds()
    : [];
  const suites = uniqueSorted([...baselineSuites, ...impactedSuites]);
  const slowTests = uniqueSorted(
    directlyChangedSlowTests.filter((file) => slowSuiteIdsForChangedPath(file, transition).length === 0)
  );
  const reasons = uniqueSorted([
    ...(boundedBaselineRequired ? ['bounded-baseline' as const] : []),
    ...(!finalSelectionResolved ? ['changed-files-unresolved' as const] : []),
    ...(directlyChangedSlowTests.length > 0 ? ['direct-slow-test' as const] : []),
    ...(inventory.affectedOwners.length > 0 || inventory.affectedSlowTests.length > 0
      ? ['ownership-impact' as const]
      : [])
  ]);

  return {
    suites,
    slowTests,
    affectedSlowTests,
    owners: uniqueSorted([
      ...(boundedBaselineRequired || !finalSelectionResolved
        ? ['bounded-slow-risk']
        : []),
      ...inventory.affectedOwners
    ]),
    reasons,
    resolved: finalSelectionResolved
  };
}
