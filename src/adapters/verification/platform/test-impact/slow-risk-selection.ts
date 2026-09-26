import { uniqueSorted } from '../../../../contracts/canonical.ts';
import { BuildAffectedTestInventory } from './affected.ts';
import {
  compileTestBudgetProjection,
  getSlowTestSuitesSync,
  isFastTestFile,
  isSlowTestFile,
  slowTestPrRiskBaselineSuiteIds,
  slowTestSuiteIdsForFile,
  type TestBudgetProjection
} from './contract/budget.ts';
import { resolveTestImpactForFiles, resolveTestImpactRiskPolicies, type TestImpactSourceProvider } from './runtime/impact.ts';
import type { TestImpactTransitionObservation } from './runtime/transition.ts';

export type SlowTestRiskClosureSelection = {
  suites: string[];
  slowTests: string[];
  affectedSlowTests: string[];
  owners: string[];
  /** Canonical union of both unresolved frontiers; never a changed-path fallback. */
  unresolvedPaths: string[];
  reasons: Array<
    'bounded-baseline'
    | 'changed-files-unresolved'
    | 'direct-slow-test'
    | 'ownership-impact'
  >;
  resolved: boolean;
};

function baselineSlowSuiteIds(projection: TestBudgetProjection): readonly string[] {
  return slowTestPrRiskBaselineSuiteIds(projection);
}

function slowSuiteIdsForChangedPath(
  file: string,
  transition?: TestImpactTransitionObservation
): string[] {
  const direct = slowTestSuiteIdsForFile(file);
  if (direct.length > 0 || transition === undefined) return [...direct];
  // A rename reports both endpoints. If the canonical suite registry was
  // updated to the new endpoint in the same transition, retain that suite's
  // risk identity for the old/base endpoint without ever making the deleted
  // path executable. Unknown endpoints remain unresolved below.
  return uniqueSorted(transition.records
    .filter((record) => record.status === 'renamed' && record.previousPath === file)
    .flatMap((record) => slowTestSuiteIdsForFile(record.path)));
}

function suitesForSlowTests(
  projection: TestBudgetProjection,
  slowTests: string[],
  transition?: TestImpactTransitionObservation
): string[] {
  const suites = getSlowTestSuitesSync(projection);
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

export function selectSlowTestRiskClosure(
  files: string[] | null,
  provider: TestImpactSourceProvider,
  transition?: TestImpactTransitionObservation
): SlowTestRiskClosureSelection {
  if (provider === undefined) {
    throw new Error('Slow-test risk selection requires an owner-issued snapshot projection.');
  }
  const budgetProjection = compileTestBudgetProjection(provider.testInventory);
  if (!files) {
    return {
      suites: [...baselineSlowSuiteIds(budgetProjection)],
      slowTests: [],
      affectedSlowTests: [],
      owners: ['bounded-slow-risk'],
      unresolvedPaths: [],
      reasons: ['bounded-baseline', 'changed-files-unresolved'],
      resolved: false
    };
  }

  const boundedBaselineRequired = resolveTestImpactRiskPolicies(files, provider)
    .includes('slow-risk-baseline');
  const inventory = BuildAffectedTestInventory(files, provider);
  const directlyChangedSlowTests = inventory.changedSlowTests;
  // Use the batch inventory + hasTestImpactForFile (which leverages the
  // reverse-import-map) instead of per-file BuildAffectedTestInventory
  // recomputation. The overall inventory provides aggregate impact; per-file
  // resolution is a cheap O(1) lookup against declarations/fallback/reverse-map.
  const resolvedImpactFiles = resolveTestImpactForFiles(files, provider);
  const providerActiveDocumentationPaths = new Set(provider.activeDocumentationPaths);
  const unresolvedFiles = files.filter((file) => {
    if (
      providerActiveDocumentationPaths.has(file)
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
  const impactedSuites = suitesForSlowTests(budgetProjection, affectedSlowTests, transition);
  const unresolvedSlowTests = directlyChangedSlowTests.filter((file) => (
    slowSuiteIdsForChangedPath(file, transition).length === 0
  ));
  const unresolvedPaths = uniqueSorted([...unresolvedFiles, ...unresolvedSlowTests]);
  // `tests/e2e/**` is a syntactic slow-test shape, not a suite authority.
  // A deleted/renamed path absent from the immutable registry cannot be
  // safely mapped to a risk owner; keep it typed-unresolved instead of
  // allowing a bare path to become a runnable slow selection.
  const finalSelectionResolved = selectionResolved && unresolvedSlowTests.length === 0;
  const baselineSuites = boundedBaselineRequired || !finalSelectionResolved
    ? baselineSlowSuiteIds(budgetProjection)
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
    unresolvedPaths,
    reasons,
    resolved: finalSelectionResolved
  };
}
