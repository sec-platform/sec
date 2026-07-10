import { uniqueSorted } from './collections.ts';
import {
  getSlowTestSuitesSync,
  isSlowTestFile,
  slowTestPrRiskBaselineSuiteIds,
  slowTestSuiteFiles
} from './test-budget-contract.ts';
import { isTestImpactSourceFile, selectTestsForSources } from './test-impact-contract.ts';

type CiPrRiskSlowSuiteSelection = {
  suites: string[];
  slowTests: string[];
  affectedSlowTests: string[];
  owners: string[];
  reason: 'baseline' | 'impact' | 'none';
};

const BOUNDED_BASELINE_PATTERNS = [
  /^package\.json$/,
  /^bun\.lock$/,
  /^platform\/orchestrator\.ts$/,
  /^scripts\/ci-pr-risk\.ts$/,
  /^platform\/dev-runner\/test-runner\.ts$/,
  /^platform\/shared\/ci-pr-risk-selection\.ts$/,
  /^platform\/shared\/test-budget-contract\.ts$/,
  /^tests\/helpers\/workspace-fixtures\.ts$/,
  /^tests\/setup\//,
  /^tests\/testkit\/workspace\.ts$/
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

export function selectCiPrRiskSlowSuites(files: string[] | null): CiPrRiskSlowSuiteSelection {
  if (!files) {
    return { suites: baselineSlowSuiteIds(), slowTests: [], affectedSlowTests: [], owners: ['bounded-slow-risk'], reason: 'baseline' };
  }

  if (files.some((file) => BOUNDED_BASELINE_PATTERNS.some((pattern) => pattern.test(file)))) {
    return { suites: baselineSlowSuiteIds(), slowTests: [], affectedSlowTests: [], owners: ['bounded-slow-risk'], reason: 'baseline' };
  }

  const directlyChangedSlowTests = files.filter(isSlowTestFile);
  const sourceFiles = files.filter(isTestImpactSourceFile);
  const impact = selectTestsForSources(sourceFiles);
  const affectedSlowTests = uniqueSorted([...directlyChangedSlowTests, ...impact.slow]);
  const allAffectedSlow = [...directlyChangedSlowTests, ...impact.slow];
  const suites = suitesForSlowTests(allAffectedSlow);
  const slowTests = uniqueSorted(
    directlyChangedSlowTests.filter((file) => !suites.some((suite) => slowTestSuiteFiles(suite).includes(file)))
  );

  return {
    suites,
    slowTests,
    affectedSlowTests,
    owners: impact.owners,
    reason: suites.length > 0 || slowTests.length > 0 ? 'impact' : 'none'
  };
}
