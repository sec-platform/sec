import { uniqueSorted } from './collections.ts';
import { isFastTestFile, isSlowTestFile } from './test-budget-contract.ts';
import {
  isTestImpactSourceFile,
  selectTestsForSources,
  type CodexDevelopmentTestImpactSourceProviderV1
} from './test-impact-contract.ts';

export type CodexDevelopmentAffectedTestInventoryV1 = {
  changedFastTests: string[];
  changedSlowTests: string[];
  affectedFastTests: string[];
  affectedSlowTests: string[];
  selectedFastTests: string[];
  selectedSlowTests: string[];
  affectedOwners: string[];
  sourceChanged: boolean;
};

export function CodexDevelopmentBuildAffectedTestInventoryV1(
  files: readonly string[],
  provider?: CodexDevelopmentTestImpactSourceProviderV1
): CodexDevelopmentAffectedTestInventoryV1 {
  const changedFastTests = uniqueSorted(files.filter(isFastTestFile));
  const changedSlowTests = uniqueSorted(files.filter(isSlowTestFile));
  const impactSourceFiles = files.filter(isTestImpactSourceFile);
  const impact = selectTestsForSources(impactSourceFiles, provider);
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
    sourceChanged: impactSourceFiles.length > 0
  };
}
