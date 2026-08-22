import type { MainHealthRepairDecisionV1 } from '../../platform/shared/main-health-repair-contract.ts';
import { observeCanonicalMainHealthForRepairV1 } from './work-selection-main-health.ts';

export function observeMainHealthRepairDecisionV1(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  defaultBranch: string;
  exactMainSha: string;
  exactMainTreeSha: string;
}>): MainHealthRepairDecisionV1 {
  return observeCanonicalMainHealthForRepairV1({
    repositoryRoot: input.repositoryRoot,
    repository: input.repository,
    defaultBranch: input.defaultBranch,
    mainSha: input.exactMainSha,
    mainTreeSha: input.exactMainTreeSha
  });
}
