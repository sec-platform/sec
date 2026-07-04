import { uniqueSorted } from './collections.ts';
import { getSlowTestSuitesSync, isSlowTestFile, slowTestSuiteFiles, slowTestSuiteIds } from './test-budget-contract.ts';
import { selectTestsForSources } from './test-impact-contract.ts';

type CiPrRiskSlowSuiteSelection = {
  suites: string[];
  slowTests: string[];
  affectedSlowTests: string[];
  owners: string[];
  reason: 'all' | 'impact' | 'none';
};

const ALL_SLOW_SUITE_PATTERNS = [
  /^package\.json$/,
  /^bun\.lock$/,
  /^platform\/orchestrator\.ts$/,
  /^tests\/helpers\//,
  /^tests\/setup\//
];

function sourceFileChanged(file: string): boolean {
  return /^(platform|scripts)\/.+\.[cm]?[tj]sx?$/.test(file);
}

function allSlowSuiteIds(): string[] {
  return slowTestSuiteIds();
}

function suitesForSlowTests(slowTests: string[]): string[] {
  const suites = getSlowTestSuitesSync();
  return uniqueSorted(
    slowTests.flatMap((file) => suites.filter((suite) => suite.files.includes(file)).map((suite) => suite.id))
  );
}

export function selectCiPrRiskSlowSuites(files: string[] | null): CiPrRiskSlowSuiteSelection {
  if (!files) {
    return { suites: allSlowSuiteIds(), slowTests: [], affectedSlowTests: [], owners: [], reason: 'all' };
  }

  if (files.some((file) => ALL_SLOW_SUITE_PATTERNS.some((pattern) => pattern.test(file)))) {
    return { suites: allSlowSuiteIds(), slowTests: [], affectedSlowTests: [], owners: ['all-slow-suites'], reason: 'all' };
  }

  const directlyChangedSlowTests = files.filter(isSlowTestFile);
  const sourceFiles = files.filter(sourceFileChanged);
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
