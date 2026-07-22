import { CodexDevelopmentIsActiveDocumentationPathV1 } from './active-documentation-contract.ts';
import { CodexDevelopmentBuildAffectedTestInventoryV1 } from './affected-test-inventory.ts';
import { uniqueSorted } from './collections.ts';
import {
  getSlowTestSuitesSync,
  isFastTestFile,
  isSlowTestFile,
  slowTestPrRiskBaselineSuiteIds,
  slowTestSuiteFiles
} from './test-budget-contract.ts';
import {
  isTestImpactSourceFile,
  type CodexDevelopmentTestImpactSourceProviderV1
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
    | 'mandatory-sentinel'
    | 'ownership-impact'
  >;
  resolved: boolean;
};

const BOUNDED_BASELINE_PATTERNS = [
  /^package\.json$/,
  /^bun\.lock$/,
  /^platform\/orchestrator\.ts$/,
  /^tests\/helpers\/workspace-fixtures\.ts$/,
  /^tests\/setup\//,
  /^tests\/testkit\/workspace\.ts$/
];

const MANDATORY_SENTINEL_PATTERNS = [
  /^\.github\/workflows\//,
  /^scripts\/ci-[^/]+\.ts$/,
  /^scripts\/codex\/(?:merge-gate|work-package-contract)\.ts$/,
  /^platform\/dev-runner\//,
  /^platform\/shared\/ci-[^/]+\.ts$/,
  /^platform\/shared\/test-(?:budget|impact|ownership)-contract\.ts$/,
  /^platform\/shared\/test-impact-rules\//
];

function baselineSlowSuiteIds(): string[] {
  return slowTestPrRiskBaselineSuiteIds();
}

function suitesForSlowTests(slowTests: string[]): string[] {
  const suites = getSlowTestSuitesSync();
  return uniqueSorted(
    slowTests.flatMap((file) => suites.filter((suite) => suite.files.includes(file)).map((suite) => suite.id))
  );
}

export function selectCiPrRiskSlowSuites(
  files: string[] | null,
  provider?: CodexDevelopmentTestImpactSourceProviderV1
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

  const boundedBaselineRequired = files.some((file) => BOUNDED_BASELINE_PATTERNS.some((pattern) => pattern.test(file)));
  const mandatorySentinelsRequired = files.some((file) => MANDATORY_SENTINEL_PATTERNS.some((pattern) => pattern.test(file)));
  const inventory = CodexDevelopmentBuildAffectedTestInventoryV1(files, provider);
  const directlyChangedSlowTests = inventory.changedSlowTests;
  const unresolvedFiles = files.filter((file) => {
    if (
      CodexDevelopmentIsActiveDocumentationPathV1(file) || isFastTestFile(file) || isSlowTestFile(file) ||
      BOUNDED_BASELINE_PATTERNS.some((pattern) => pattern.test(file)) ||
      MANDATORY_SENTINEL_PATTERNS.some((pattern) => pattern.test(file))
    ) return false;
    if (!isTestImpactSourceFile(file)) return true;
    const fileImpact = CodexDevelopmentBuildAffectedTestInventoryV1([file], provider);
    return fileImpact.affectedFastTests.length === 0
      && fileImpact.affectedSlowTests.length === 0
      && fileImpact.affectedOwners.length === 0;
  });
  const selectionResolved = unresolvedFiles.length === 0;
  const affectedSlowTests = uniqueSorted([...directlyChangedSlowTests, ...inventory.affectedSlowTests]);
  const impactedSuites = suitesForSlowTests(affectedSlowTests);
  const baselineSuites = boundedBaselineRequired || mandatorySentinelsRequired || !selectionResolved
    ? baselineSlowSuiteIds()
    : [];
  const suites = uniqueSorted([...baselineSuites, ...impactedSuites]);
  const slowTests = uniqueSorted(
    directlyChangedSlowTests.filter((file) => !suites.some((suite) => slowTestSuiteFiles(suite).includes(file)))
  );
  const reasons = uniqueSorted([
    ...(boundedBaselineRequired ? ['bounded-baseline' as const] : []),
    ...(!selectionResolved ? ['changed-files-unresolved' as const] : []),
    ...(directlyChangedSlowTests.length > 0 ? ['direct-slow-test' as const] : []),
    ...(mandatorySentinelsRequired ? ['mandatory-sentinel' as const] : []),
    ...(inventory.affectedOwners.length > 0 || inventory.affectedSlowTests.length > 0
      ? ['ownership-impact' as const]
      : [])
  ]);

  return {
    suites,
    slowTests,
    affectedSlowTests,
    owners: uniqueSorted([
      ...(boundedBaselineRequired || mandatorySentinelsRequired || !selectionResolved
        ? ['bounded-slow-risk']
        : []),
      ...inventory.affectedOwners
    ]),
    reasons,
    resolved: selectionResolved
  };
}
