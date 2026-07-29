import { CodexDevelopmentIsCanonicalRepositoryPathV1 } from './repository-path-contract.ts';

/**
 * Deterministic projection of docs/authority.json.
 *
 * docs/authority.json is the source of truth. docs-doctor and contract tests
 * require this projection to match the registry exactly.
 */
export const CODEX_DEVELOPMENT_ACTIVE_DOCUMENTATION_PATHS_V2 = [
  "AGENTS.md",
  "README.md",
  "docs/README.md",
  "docs/authority.json",
  "docs/brownfield-import.md",
  "docs/capability-and-block-model.md",
  "docs/change-management.md",
  "docs/compiler-target-ir.md",
  "docs/corpus/nexus/contract.md",
  "docs/delta-and-impact.md",
  "docs/development-governance.md",
  "docs/external-provider-policy.md",
  "docs/governance/external-capability-ledger.yaml",
  "docs/governance/nexus-absorption-ledger.yaml",
  "docs/product.md",
  "docs/proposals/development-run-kernel.md",
  "docs/proposals/engineering-workspace-domains.md",
  "docs/roadmap.md",
  "docs/runtime-and-distribution.md",
  "docs/semantic-model.md",
  "docs/semantic-mutation.md",
  "docs/system-architecture.md",
  "docs/verification-governance.md",
  "docs/work/README.md",
  "docs/work/active-work-package.md",
  "docs/work/current-state.yaml",
  "docs/work/rolling-plan.md",
  "docs/workbench-and-ai-operations.md"
] as const;

const ACTIVE_DOCUMENTATION_PATHS = new Set<string>(
  CODEX_DEVELOPMENT_ACTIVE_DOCUMENTATION_PATHS_V2
);

export function CodexDevelopmentIsActiveDocumentationPathV1(file: string): boolean {
  return CodexDevelopmentIsCanonicalRepositoryPathV1(file)
    && ACTIVE_DOCUMENTATION_PATHS.has(file);
}
