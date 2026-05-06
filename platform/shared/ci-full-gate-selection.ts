import { uniqueSorted } from './collections.ts';
import { getSlowTestSuitesSync, isSlowTestFile, slowTestSuiteIds } from './test-budget-contract.ts';
import { selectTestsForSources } from './test-impact-contract.ts';

type CiFullGateSlowSuiteSelection = {
  suites: string[];
  affectedSlowTests: string[];
  owners: string[];
  reason: 'all' | 'impact' | 'none';
};

const ALL_SLOW_SUITE_PATTERNS = [
  /^package\.json$/,
  /^bun\.lock$/,
  /^platform\/orchestrator\.ts$/
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

export function selectCiFullGateSlowSuites(files: string[] | null): CiFullGateSlowSuiteSelection {
  if (!files) {
    return { suites: allSlowSuiteIds(), affectedSlowTests: [], owners: [], reason: 'all' };
  }

  if (files.some((file) => ALL_SLOW_SUITE_PATTERNS.some((pattern) => pattern.test(file)))) {
    return { suites: allSlowSuiteIds(), affectedSlowTests: [], owners: ['all-slow-suites'], reason: 'all' };
  }

  const directlyChangedSlowTests = files.filter(isSlowTestFile);
  const sourceFiles = files.filter(sourceFileChanged);
  const impact = selectTestsForSources(sourceFiles);
  const affectedSlowTests = uniqueSorted([...directlyChangedSlowTests, ...impact.slow]);
  const suites = suitesForSlowTests(affectedSlowTests);

  return {
    suites,
    affectedSlowTests,
    owners: impact.owners,
    reason: suites.length > 0 ? 'impact' : 'none'
  };
}
