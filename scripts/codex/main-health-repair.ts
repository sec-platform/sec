import type { MainHealthRepairDecisionV1 } from '../../platform/shared/main-health-repair-contract.ts';
import { observeCanonicalMainHealthForRepairV1 } from './main-health-provider-observation.ts';

export function observeMainHealthRepairDecisionV1(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  defaultBranch: string;
  exactMainSha: string;
  exactMainTreeSha: string;
  observedAt?: string;
}>): MainHealthRepairDecisionV1 {
  return observeCanonicalMainHealthForRepairV1({
    repositoryRoot: input.repositoryRoot,
    repository: input.repository,
    defaultBranch: input.defaultBranch,
    mainSha: input.exactMainSha,
    mainTreeSha: input.exactMainTreeSha,
    ...(input.observedAt === undefined ? {} : { observedAt: input.observedAt })
  });
}
