import { CodexDevelopmentIsActiveDocumentationPathV1 } from './active-documentation-contract.ts';
import { CodexDevelopmentBuildAffectedTestInventoryV1 } from './affected-test-inventory.ts';
import type { CodexDevelopmentTestImpactTransitionObservationV1 } from './ci-git-changed-files.ts';
import { uniqueSorted } from './collections.ts';
import {
  getSlowTestSuitesSync,
  isFastTestFile,
  isSlowTestFile,
  slowTestPrRiskBaselineSuiteIds,
  slowTestSuiteFiles
} from './test-budget-contract.ts';
import {
  hasTestImpactForFile,
  resolveTestImpactRiskPolicies,
  type CodexDevelopmentTestImpactSourceProviderV2
} from './test-impact-contract.ts';

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

function suitesForSlowTests(slowTests: string[]): string[] {
  const suites = getSlowTestSuitesSync();
  return uniqueSorted(
    slowTests.flatMap((file) =>
      suites.filter((suite) => suite.files.includes(file)).map((suite) => suite.id)
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
  const unresolvedFiles = files.filter((file) => {
    if (
      CodexDevelopmentIsActiveDocumentationPathV1(file)
      || isFastTestFile(file)
      || isSlowTestFile(file)
    ) return false;
    return !hasTestImpactForFile(file, provider, transition);
  });
  const selectionResolved = unresolvedFiles.length === 0;
  const affectedSlowTests = uniqueSorted([
    ...directlyChangedSlowTests,
    ...inventory.affectedSlowTests
  ]);
  const impactedSuites = suitesForSlowTests(affectedSlowTests);
  const baselineSuites = boundedBaselineRequired || !selectionResolved
    ? baselineSlowSuiteIds()
    : [];
  const suites = uniqueSorted([...baselineSuites, ...impactedSuites]);
  const slowTests = uniqueSorted(
    directlyChangedSlowTests.filter((file) =>
      !suites.some((suite) => slowTestSuiteFiles(suite).includes(file))
    )
  );
  const reasons = uniqueSorted([
    ...(boundedBaselineRequired ? ['bounded-baseline' as const] : []),
    ...(!selectionResolved ? ['changed-files-unresolved' as const] : []),
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
      ...(boundedBaselineRequired || !selectionResolved
        ? ['bounded-slow-risk']
        : []),
      ...inventory.affectedOwners
    ]),
    reasons,
    resolved: selectionResolved
  };
}
