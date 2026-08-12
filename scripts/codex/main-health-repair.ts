import { createMainHealthLedgerV1 } from '../../platform/shared/main-health-contract.ts';
import {
  compileMainHealthRepairDecisionV1,
  type MainHealthRepairDecisionV1
} from '../../platform/shared/main-health-repair-contract.ts';
import { createObservedMainHealthInputV1 } from './main-health-observation.ts';
import { createVerificationSessionGitHubClientV1 } from './verification-session-github.ts';

export function observeMainHealthRepairDecisionV1(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  defaultBranch: string;
  exactMainSha: string;
  exactMainTreeSha: string;
  observedAt?: string;
}>): MainHealthRepairDecisionV1 {
  const observedAt = input.observedAt ?? new Date().toISOString();
  const expiresAt = new Date(new Date(observedAt).getTime() + 300_000).toISOString();
  const checks = createVerificationSessionGitHubClientV1(input.repositoryRoot)
    .observeChecks(input.repository, input.exactMainSha);
  const ledger = createMainHealthLedgerV1(createObservedMainHealthInputV1({
    repository: input.repository,
    mainSha: input.exactMainSha,
    mainTreeSha: input.exactMainTreeSha,
    trustRevision: input.exactMainSha,
    observedAt,
    expiresAt,
    sourceRunId: `main-health-repair-${input.exactMainSha}`,
    sourceRef: `github-check-runs:${input.repository}@${input.exactMainSha}`,
    checks
  }));
  return compileMainHealthRepairDecisionV1({
    ledger,
    now: observedAt,
    expectedRepository: input.repository,
    expectedDefaultBranch: input.defaultBranch,
    expectedMainSha: input.exactMainSha,
    expectedMainTreeSha: input.exactMainTreeSha,
    expectedTrustRevision: input.exactMainSha
  });
}
