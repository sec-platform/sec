export type SharedBoundaryClassification =
  | 'mechanical-foundation'
  | 'cross-domain-contract'
  | 'domain-owner-review-required';

export interface SharedBoundaryEntry {
  readonly path: string;
  readonly classification: SharedBoundaryClassification;
}

/**
 * REM-004 explicit placement classification of every file physically present
 * under `platform/shared/**` in the current integration tree. This registry
 * owns placement classification only; it does not acquire the domain semantics
 * of any listed file.
 *
 * There is deliberately no fallback classification. Any added/removed/renamed
 * shared path must update this explicit inventory before contract tests pass.
 */
export const SHARED_MECHANICAL_FOUNDATION_PATHS = [
  'canonical-primitives.ts',
  'cli-output.ts',
  'collections.ts',
  'concurrency.ts',
  'diff-utils.ts',
  'errors.ts',
  'git-read-environment.ts',
  'iso-instant-input.ts',
  'logger.ts',
  'logical-path-component.ts',
  'path-imports.ts',
  'retained-file-read.ts',
  'spinner.ts',
  'yaml.ts',
] as const;

export const SHARED_CROSS_DOMAIN_CONTRACT_PATHS = [
  'acceptance-proof-contract.ts',
  'acceptance-types.ts',
  'active-documentation-contract.ts',
  'agent-operation-activation-contract.ts',
  'agent-operation-read-plan-contract.ts',
  'agent-skill-contract.ts',
  'agent-task-capsule-contract.ts',
  'benchmark-contract.ts',
  'ci-artifact-contract.ts',
  'ci-artifact-types.ts',
  'ci-contract.ts',
  'ci-evidence-contract.ts',
  'ci-evidence-reuse-contract.ts',
  'ci-hosted-sut-observation-contract.ts',
  'ci-trust-root-registry.json',
  'continuation-invalidation-contract.ts',
  'contract-freeze-contract.ts',
  'documentation-authority-contract.ts',
  'engineering-ir-types.ts',
  'engineering-ir/delta-types.ts',
  'engineering-ir/entity-types.ts',
  'engineering-ir/fact-types.ts',
  'engineering-ir/index.ts',
  'engineering-ir/predicate-signature-types.ts',
  'engineering-ir/root-types.ts',
  'engineering-ir/scenario-types.ts',
  'engineering-ir/validated-types.ts',
  'error-protocol-contract.ts',
  'explain-types.ts',
  'github-status-namespace-policy.ts',
  'integration-authorization-contract.ts',
  'issue-disposition-contract.ts',
  'local-continuation-checkpoint.ts',
  'lock-types.ts',
  'logical-path-identity.ts',
  'main-authority-ruleset-contract.ts',
  'main-health-contract.ts',
  'main-health-repair-contract.ts',
  'pipeline-types.ts',
  'plan-manifest-types.ts',
  'policy-types.ts',
  'provenance-types.ts',
  'registry-types.ts',
  'repair-types.ts',
  'repository-path-contract.ts',
  'review-stability-contract.ts',
  'review-types.ts',
  'scope-authorization-contract.ts',
  'sec-runtime-state-contract.ts',
  'semantic-contract-types.ts',
  'semantic-generator-types.ts',
  'semantic-impact-types.ts',
  'semantic-mutation-transaction-types.ts',
  'semantic-mutation-types.ts',
  'semantic-view-types.ts',
  'shared-boundary-contract.ts',
  'task-envelope-types.ts',
  'tcb-trust-root-contract.ts',
  'test-budget-contract.ts',
  'test-impact-contract.ts',
  'test-ownership-contract.ts',
  'test-responsibility-contract.ts',
  'text-byte-census-contract.ts',
  'tool-evidence-contract.ts',
  'types.ts',
  'upgrade-manifest-types.ts',
  'upgrade-types.ts',
  'verification-action-ci-contract.ts',
  'verification-action-contract.ts',
  'verification-action-provider-contract.ts',
  'verification-artifact-contract.ts',
  'verification-provider-capability-contract.ts',
  'verification-result-contract.ts',
  'verification-session-contract.ts',
  'verification-types.ts',
  'work-selection-contract.ts',
  'work-selection-live-contract.ts',
  'workspace-path-contract.ts',
  'workspace-types.ts',
  'worktree-settlement-contract.ts',
] as const;

export const SHARED_DOMAIN_OWNER_REVIEW_REQUIRED_PATHS = [
  'acceptance-coverage-authority.ts',
  'acceptance-identity.ts',
  'affected-test-inventory.ts',
  'block-identity.ts',
  'bun-runtime-version.ts',
  'ci-artifact-authority.ts',
  'ci-execution-environment.ts',
  'ci-git-changed-files.ts',
  'ci-pr-risk-selection.ts',
  'ci-verification-plan.ts',
  'ci-verification-revision.ts',
  'constants.ts',
  'default-branch-revision-health.ts',
  'dependency-environment.ts',
  'error-protocol.ts',
  'fs.ts',
  'heavy-verification-gate-lease.ts',
  'integration-platform-policy.ts',
  'lock-utils.ts',
  'observed-process.ts',
  'paths.ts',
  'physical-mutation-lease.ts',
  'physical-no-follow.ts',
  'pipeline-journal.ts',
  'pipeline-kernel.ts',
  'pipeline-pass-registry.ts',
  'pipeline-semantic-context.ts',
  'platform-command.ts',
  'policy-identity.ts',
  'policy-report-authority.ts',
  'process.ts',
  'product-verification-profile.ts',
  'project-base.ts',
  'project-baseline.ts',
  'project-file-hash.ts',
  'project-integrity-baseline.ts',
  'project-integrity.ts',
  'project-overview.ts',
  'project-provenance-inspection.ts',
  'project-runtime.ts',
  'project-tracked-files.ts',
  'project-write-boundary.ts',
  'provenance-authority.ts',
  'reference-check.ts',
  'reference-drift-scan.ts',
  'review-artifact.ts',
  'review-matrix.ts',
  'review-policy.ts',
  'review-upgrade.ts',
  'runtime-dependency-spec.ts',
  'runtime-layout.ts',
  'semantic-mutation-staging-boundary.ts',
  'semantic-pattern-report.ts',
  'slot-identity.ts',
  'tcb-closure-lock.ts',
  'test-impact-rules/governance.ts',
  'test-impact-rules/pipeline.ts',
  'test-impact-rules/semantic.ts',
  'test-impact-rules/verification.ts',
  'tool-evidence-adapters.ts',
  'verification-artifact-authority.ts',
  'verification-scope-inventory.ts',
  'windows-appcontainer-executor.ts',
  'windows-appcontainer-native-helper-settlement.ts',
  'windows-appcontainer-native-helper.ts',
  'windows-host-filesystem-authority.ts',
  'workspace-file-publication.ts',
  'workspace-write-lease.ts',
] as const;

export const SHARED_BOUNDARY_ENTRIES: readonly SharedBoundaryEntry[] = Object.freeze([
  ...SHARED_MECHANICAL_FOUNDATION_PATHS.map((path) => Object.freeze({
    path,
    classification: 'mechanical-foundation' as const
  })),
  ...SHARED_CROSS_DOMAIN_CONTRACT_PATHS.map((path) => Object.freeze({
    path,
    classification: 'cross-domain-contract' as const
  })),
  ...SHARED_DOMAIN_OWNER_REVIEW_REQUIRED_PATHS.map((path) => Object.freeze({
    path,
    classification: 'domain-owner-review-required' as const
  }))
].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0));

export function sharedBoundaryClassification(path: string): SharedBoundaryClassification | null {
  return SHARED_BOUNDARY_ENTRIES.find((entry) => entry.path === path)?.classification ?? null;
}
