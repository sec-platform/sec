export const SEC_AGENT_SKILL_IDS = [
  'sec-a0-integrator',
  'sec-architecture-evolution',
  'sec-ci-and-merge',
  'sec-context-resume',
  'sec-documentation-governance',
  'sec-exact-head-review',
  'sec-external-capability-governance',
  'sec-failure-recovery',
  'sec-heuristic-governance',
  'sec-impact-and-validation',
  'sec-repository-audit',
  'sec-repository-orientation',
  'sec-task-delegation',
  'sec-toolchain-and-dependencies',
  'sec-trust-root-bootstrap',
  'sec-work-package-lifecycle',
  'sec-worker-development'
] as const;

export type SecAgentSkillId = (typeof SEC_AGENT_SKILL_IDS)[number];

export const SEC_REPOSITORY_BEHAVIOR_IDS = [
  'a0-integration',
  'architecture-evolution',
  'ci-and-merge',
  'context-resume',
  'documentation-governance',
  'exact-head-review',
  'external-capability-governance',
  'failure-recovery',
  'heuristic-governance',
  'impact-and-validation',
  'repository-audit',
  'repository-orientation',
  'task-delegation',
  'toolchain-and-dependencies',
  'trust-root-bootstrap',
  'work-package-lifecycle',
  'worker-development'
] as const;

export type SecRepositoryBehaviorId = (typeof SEC_REPOSITORY_BEHAVIOR_IDS)[number];

export const SEC_REPOSITORY_BEHAVIOR_OWNERS = {
  'a0-integration': 'sec-a0-integrator',
  'architecture-evolution': 'sec-architecture-evolution',
  'ci-and-merge': 'sec-ci-and-merge',
  'context-resume': 'sec-context-resume',
  'documentation-governance': 'sec-documentation-governance',
  'exact-head-review': 'sec-exact-head-review',
  'external-capability-governance': 'sec-external-capability-governance',
  'failure-recovery': 'sec-failure-recovery',
  'heuristic-governance': 'sec-heuristic-governance',
  'impact-and-validation': 'sec-impact-and-validation',
  'repository-audit': 'sec-repository-audit',
  'repository-orientation': 'sec-repository-orientation',
  'task-delegation': 'sec-task-delegation',
  'toolchain-and-dependencies': 'sec-toolchain-and-dependencies',
  'trust-root-bootstrap': 'sec-trust-root-bootstrap',
  'work-package-lifecycle': 'sec-work-package-lifecycle',
  'worker-development': 'sec-worker-development'
} as const satisfies Record<SecRepositoryBehaviorId, SecAgentSkillId>;

export const SEC_AGENT_SKILL_STANDARD_SECTIONS = [
  '## 触发',
  '## 不触发',
  '## 输入',
  '## 权限与路径',
  '## 允许工具与操作',
  '## 前置门禁',
  '## 执行',
  '## 完成证据',
  '## 停止与恢复',
  '## 禁止捷径',
  '## 权威'
] as const;

export type SecMarkdownSurfaceKind =
  | 'skill-definition'
  | 'agent-projection'
  | 'active-authority'
  | 'active-proposal'
  | 'navigation'
  | 'frozen-work-package'
  | 'evidence'
  | 'historical'
  | 'verification-fixture'
  | 'repository-content';

export type SecMarkdownSkillCoverage = {
  kind: SecMarkdownSurfaceKind;
  skills: SecAgentSkillId[];
};

function skills(...ids: SecAgentSkillId[]): SecAgentSkillId[] {
  return [...new Set(ids)].sort();
}

function skillIdFromPath(path: string): SecAgentSkillId | null {
  const match = /^\.agents\/skills\/([a-z0-9]+(?:-[a-z0-9]+)*)\/SKILL\.md$/u.exec(path);
  if (!match) return null;
  return SEC_AGENT_SKILL_IDS.includes(match[1] as SecAgentSkillId)
    ? match[1] as SecAgentSkillId
    : null;
}

const ARCHITECTURE_DOCUMENTS = new Set([
  'docs/product.md',
  'docs/roadmap.md',
  'docs/system-architecture.md',
  'docs/semantic-model.md',
  'docs/delta-and-impact.md',
  'docs/semantic-mutation.md',
  'docs/compiler-target-ir.md',
  'docs/capability-and-block-model.md',
  'docs/brownfield-import.md',
  'docs/workbench-and-ai-operations.md',
  'docs/runtime-and-distribution.md',
  'docs/change-management.md'
]);

export function resolveSecRepositoryBehaviorOwner(
  behavior: SecRepositoryBehaviorId
): SecAgentSkillId {
  return SEC_REPOSITORY_BEHAVIOR_OWNERS[behavior];
}

export function resolveSecMarkdownSkillCoverage(path: string): SecMarkdownSkillCoverage | null {
  if (!path.endsWith('.md')) return null;

  const skillId = skillIdFromPath(path);
  if (skillId) return { kind: 'skill-definition', skills: [skillId] };

  if (path === 'AGENTS.md') {
    return {
      kind: 'agent-projection',
      skills: skills(
        'sec-repository-orientation',
        'sec-repository-audit',
        'sec-a0-integrator',
        'sec-context-resume',
        'sec-external-capability-governance',
        'sec-impact-and-validation',
        'sec-heuristic-governance'
      )
    };
  }
  if (path === 'README.md' || path === 'docs/README.md' || path === 'docs/work/README.md') {
    return {
      kind: 'navigation',
      skills: skills(
        'sec-documentation-governance',
        'sec-repository-orientation',
        'sec-repository-audit'
      )
    };
  }
  if (/^tests\/.*\.md$/u.test(path)) {
    return { kind: 'verification-fixture', skills: [] };
  }
  if (/^docs\/work-packages\/[^/]+\.md$/u.test(path)) {
    return { kind: 'frozen-work-package', skills: [] };
  }
  if (/^docs\/evidence\/.*\.md$/u.test(path)) return { kind: 'evidence', skills: [] };
  if (/^docs\/(?:archive|superpowers)\//u.test(path)
    || /^docs\/scripts\/SEC_docs_v5_replacement\//u.test(path)) {
    return { kind: 'historical', skills: [] };
  }
  if (!/^docs\//u.test(path)) return null;

  if (ARCHITECTURE_DOCUMENTS.has(path)) {
    return {
      kind: 'active-authority',
      skills: skills(
        'sec-architecture-evolution',
        'sec-worker-development',
        'sec-impact-and-validation',
        'sec-exact-head-review',
        'sec-documentation-governance',
        'sec-repository-audit'
      )
    };
  }
  if (path === 'docs/development-governance.md') {
    return {
      kind: 'active-authority',
      skills: skills(
        'sec-a0-integrator',
        'sec-architecture-evolution',
        'sec-ci-and-merge',
        'sec-context-resume',
        'sec-documentation-governance',
        'sec-exact-head-review',
        'sec-failure-recovery',
        'sec-heuristic-governance',
        'sec-impact-and-validation',
        'sec-repository-audit',
        'sec-repository-orientation',
        'sec-task-delegation',
        'sec-trust-root-bootstrap',
        'sec-work-package-lifecycle',
        'sec-worker-development'
      )
    };
  }
  if (path === 'docs/verification-governance.md') {
    return {
      kind: 'active-authority',
      skills: skills(
        'sec-impact-and-validation',
        'sec-ci-and-merge',
        'sec-trust-root-bootstrap',
        'sec-failure-recovery',
        'sec-repository-audit'
      )
    };
  }
  if (path === 'docs/external-provider-policy.md') {
    return {
      kind: 'active-authority',
      skills: skills(
        'sec-external-capability-governance',
        'sec-repository-audit',
        'sec-heuristic-governance'
      )
    };
  }
  if (path === 'docs/corpus/nexus/contract.md') {
    return {
      kind: 'active-authority',
      skills: skills(
        'sec-external-capability-governance',
        'sec-repository-orientation',
        'sec-repository-audit'
      )
    };
  }
  if (/^docs\/proposals\/.+\.md$/u.test(path)) {
    return {
      kind: 'active-proposal',
      skills: skills(
        'sec-architecture-evolution',
        'sec-documentation-governance',
        'sec-repository-audit'
      )
    };
  }
  if (/^docs\/work\/(?:rolling-plan|active-work-package)\.md$/u.test(path)) {
    return {
      kind: 'active-authority',
      skills: skills(
        'sec-a0-integrator',
        'sec-work-package-lifecycle',
        'sec-documentation-governance',
        'sec-repository-orientation',
        'sec-repository-audit'
      )
    };
  }

  // Unknown docs Markdown never receives active-authority coverage by fallback.
  return null;
}

export type SecRepositorySurfaceKind =
  | 'markdown'
  | 'heuristic-runtime'
  | 'product-implementation'
  | 'verification-test'
  | 'configuration'
  | 'repository-content';

export type SecRepositorySurface = {
  kind: SecRepositorySurfaceKind;
  skills: SecAgentSkillId[];
};

export function resolveSecRepositoryHeuristicSkills(path: string): SecAgentSkillId[] {
  const skillId = skillIdFromPath(path);
  if (skillId) return [skillId];
  if (path === 'AGENTS.md') {
    return skills(
      'sec-repository-orientation',
      'sec-repository-audit',
      'sec-a0-integrator',
      'sec-context-resume',
      'sec-external-capability-governance',
      'sec-impact-and-validation',
      'sec-heuristic-governance'
    );
  }
  if (/^docs\/work\//u.test(path)) {
    return skills(
      'sec-a0-integrator',
      'sec-documentation-governance',
      'sec-repository-orientation',
      'sec-repository-audit',
      'sec-work-package-lifecycle'
    );
  }
  if (path === 'docs/authority.json'
    || path === 'platform/shared/documentation-authority-contract.ts'
    || path === 'platform/shared/active-documentation-contract.ts'
    || path === 'docs/scripts/docs-doctor.ts') {
    return skills(
      'sec-documentation-governance',
      'sec-repository-audit',
      'sec-heuristic-governance',
      'sec-trust-root-bootstrap'
    );
  }
  if (path === 'docs/governance/external-capability-ledger.yaml') {
    return skills('sec-external-capability-governance', 'sec-heuristic-governance');
  }
  if (path === 'docs/governance/nexus-absorption-ledger.yaml') {
    return skills(
      'sec-external-capability-governance',
      'sec-repository-orientation',
      'sec-repository-audit'
    );
  }
  if (path === 'platform/shared/agent-skill-contract.ts') {
    return skills(
      'sec-documentation-governance',
      'sec-context-resume',
      'sec-trust-root-bootstrap',
      'sec-repository-audit',
      'sec-heuristic-governance'
    );
  }
  if (/^\.codex\//u.test(path)) {
    return skills(
      'sec-task-delegation',
      'sec-worker-development',
      'sec-exact-head-review',
      'sec-context-resume',
      'sec-heuristic-governance'
    );
  }
  if (/^\.github\//u.test(path)) {
    return skills('sec-ci-and-merge', 'sec-trust-root-bootstrap', 'sec-documentation-governance');
  }
  if (/^\.githooks\//u.test(path)) {
    return skills('sec-impact-and-validation', 'sec-toolchain-and-dependencies');
  }
  if (path === 'scripts/codex/ci-orchestration-core.ts') {
    return skills('sec-impact-and-validation', 'sec-ci-and-merge', 'sec-trust-root-bootstrap');
  }
  if (path === 'scripts/codex/repository-audit.ts') {
    return skills('sec-repository-audit', 'sec-heuristic-governance');
  }
  if (/^scripts\/codex\//u.test(path)) {
    return skills(
      'sec-a0-integrator',
      'sec-work-package-lifecycle',
      'sec-ci-and-merge',
      'sec-trust-root-bootstrap',
      'sec-context-resume',
      'sec-failure-recovery',
      'sec-heuristic-governance'
    );
  }
  if (/^docs\/scripts\//u.test(path)) {
    return skills(
      'sec-documentation-governance',
      'sec-trust-root-bootstrap',
      'sec-heuristic-governance'
    );
  }
  if (path === 'platform/dev-runner.ts' || /^platform\/dev-runner\//u.test(path)) {
    return skills('sec-impact-and-validation', 'sec-toolchain-and-dependencies');
  }
  if (/^scripts\/ci-[^/]+\.ts$/u.test(path) || path === 'scripts/run-work-package-gate.ts') {
    return skills('sec-ci-and-merge', 'sec-trust-root-bootstrap');
  }
  if (path === 'scripts/install-git-hooks.ts') {
    return skills('sec-impact-and-validation', 'sec-toolchain-and-dependencies');
  }
  if (path === 'scripts/discover-all.ts') {
    return skills(
      'sec-repository-audit',
      'sec-impact-and-validation',
      'sec-toolchain-and-dependencies'
    );
  }
  if (/^scripts\//u.test(path)) {
    return skills('sec-toolchain-and-dependencies', 'sec-impact-and-validation');
  }
  if (/^platform\/shared\/(?:active-documentation|affected-test|ci-|contract-freeze|documentation-authority|heavy-verification|repository-path|runtime-dependency|test-|verification-scope)/u.test(path)
    || /^platform\/shared\/test-impact-rules\//u.test(path)) {
    return skills('sec-impact-and-validation', 'sec-ci-and-merge', 'sec-trust-root-bootstrap');
  }
  if (/^(?:package\.json|bun\.lock|bunfig\.toml|tsconfig\.json|\.bun-version|\.gitignore|\.gitattributes|\.npmrc|\.dependency-cruiser\.json)$/u.test(path)) {
    return skills('sec-toolchain-and-dependencies', 'sec-repository-audit');
  }
  return [];
}

export function isSecRepositoryHeuristicSurface(path: string): boolean {
  return resolveSecRepositoryHeuristicSkills(path).length > 0;
}

export function classifySecRepositorySurface(path: string): SecRepositorySurface {
  const markdown = resolveSecMarkdownSkillCoverage(path);
  if (markdown) return { kind: 'markdown', skills: markdown.skills };
  const heuristicSkills = resolveSecRepositoryHeuristicSkills(path);
  if (heuristicSkills.length > 0) return { kind: 'heuristic-runtime', skills: heuristicSkills };
  if (/^tests\//u.test(path)) return { kind: 'verification-test', skills: [] };
  if (/^(?:platform|source)\//u.test(path)) return { kind: 'product-implementation', skills: [] };
  if (/^(?:package\.json|bun\.lock|bunfig\.toml|tsconfig\.json|\.bun-version|\.gitignore|\.gitattributes)$/u.test(path)) {
    return { kind: 'configuration', skills: [] };
  }
  return { kind: 'repository-content', skills: [] };
}

/**
 * Skill Applicability Decision V1 (Issue #275).
 *
 * Runtime Skill selection is zero-or-one, trusted and operation-scoped. Path
 * coverage (`resolveSecMarkdownSkillCoverage` / `resolveSecRepositoryHeuristicSkills`)
 * is only a candidate hint and is never a runtime selector. The pure evaluator
 * below consumes an operation envelope plus trusted registry metadata and never
 * reads SKILL.md prose bytes, so candidate guidance can never expand machine
 * authorization.
 */

export const SEC_AGENT_ROLES = [
  'a0',
  'worker',
  'reviewer',
  'auditor',
  'maintainer'
] as const;

export type SecAgentRole = (typeof SEC_AGENT_ROLES)[number];

export const SEC_OPERATION_KINDS = [
  'orient',
  'audit',
  'diagnose',
  'design',
  'implement',
  'review',
  'integrate',
  'govern',
  'no-change'
] as const;

export type SecOperationKind = (typeof SEC_OPERATION_KINDS)[number];

export const SEC_SKILL_APPLICABILITY_STATUSES = [
  'applicable',
  'none-required',
  'ambiguous',
  'stale',
  'conflict',
  'not-applicable',
  'unresolved'
] as const;

export type SecSkillApplicabilityStatus = (typeof SEC_SKILL_APPLICABILITY_STATUSES)[number];

export const SEC_SKILL_APPLICABILITY_SCHEMA = 'sec-skill-applicability-decision-v1' as const;

export type SecSkillApplicabilityExclusionReason =
  | 'role-mismatch'
  | 'operation-kind-mismatch'
  | 'superseded'
  | 'capability-unavailable';

export type SecSkillApplicabilityConflictKind =
  | 'write-path'
  | 'resource'
  | 'gate';

export function isSecAgentRole(value: unknown): value is SecAgentRole {
  return typeof value === 'string' && (SEC_AGENT_ROLES as readonly string[]).includes(value);
}

export function isSecOperationKind(value: unknown): value is SecOperationKind {
  return typeof value === 'string' && (SEC_OPERATION_KINDS as readonly string[]).includes(value);
}

export function isSecAgentSkillId(value: unknown): value is SecAgentSkillId {
  return typeof value === 'string' && (SEC_AGENT_SKILL_IDS as readonly string[]).includes(value);
}

/**
 * Minimal machine metadata extracted from the real Skill registry. Prose
 * triggers remain agent guidance; only this table drives the machine decision.
 */
export interface SecAgentSkillMetadataV1 {
  readonly id: SecAgentSkillId;
  readonly roles: readonly SecAgentRole[];
  readonly operationKinds: readonly SecOperationKind[];
  readonly requiredCapabilities: readonly string[];
  readonly requiredResources: readonly string[];
  readonly requiredGates: readonly string[];
  readonly writeSurface: readonly string[];
  readonly supersededBy: SecAgentSkillId | null;
}

export const SEC_AGENT_SKILL_METADATA_V1 = {
  'sec-a0-integrator': {
    id: 'sec-a0-integrator',
    roles: ['a0'],
    operationKinds: ['orient', 'govern', 'integrate'],
    requiredCapabilities: ['git', 'github'],
    requiredResources: [],
    requiredGates: [],
    writeSurface: ['docs/work/', 'docs/work-packages/'],
    supersededBy: null
  },
  'sec-architecture-evolution': {
    id: 'sec-architecture-evolution',
    roles: ['a0', 'auditor', 'maintainer'],
    operationKinds: ['design'],
    requiredCapabilities: ['git', 'github'],
    requiredResources: [],
    requiredGates: [],
    writeSurface: ['docs/'],
    supersededBy: null
  },
  'sec-ci-and-merge': {
    id: 'sec-ci-and-merge',
    roles: ['a0'],
    operationKinds: ['integrate'],
    requiredCapabilities: ['git', 'github', 'hosted-gate'],
    requiredResources: ['github-api'],
    requiredGates: ['hosted-gate'],
    writeSurface: [],
    supersededBy: null
  },
  'sec-context-resume': {
    id: 'sec-context-resume',
    roles: ['a0', 'worker', 'reviewer', 'auditor', 'maintainer'],
    operationKinds: ['orient'],
    requiredCapabilities: ['git'],
    requiredResources: [],
    requiredGates: [],
    writeSurface: [],
    supersededBy: null
  },
  'sec-documentation-governance': {
    id: 'sec-documentation-governance',
    roles: ['a0', 'maintainer'],
    operationKinds: ['govern'],
    requiredCapabilities: ['git'],
    requiredResources: [],
    requiredGates: [],
    writeSurface: ['docs/', 'AGENTS.md'],
    supersededBy: null
  },
  'sec-exact-head-review': {
    id: 'sec-exact-head-review',
    roles: ['reviewer'],
    operationKinds: ['review'],
    requiredCapabilities: ['git', 'github'],
    requiredResources: [],
    requiredGates: [],
    writeSurface: [],
    supersededBy: null
  },
  'sec-external-capability-governance': {
    id: 'sec-external-capability-governance',
    roles: ['a0', 'maintainer'],
    operationKinds: ['govern'],
    requiredCapabilities: ['git', 'github'],
    requiredResources: [],
    requiredGates: [],
    writeSurface: ['docs/governance/external-capability-ledger.yaml'],
    supersededBy: null
  },
  'sec-failure-recovery': {
    id: 'sec-failure-recovery',
    roles: ['a0', 'worker', 'maintainer'],
    operationKinds: ['diagnose'],
    requiredCapabilities: ['git', 'github'],
    requiredResources: [],
    requiredGates: [],
    writeSurface: [],
    supersededBy: null
  },
  'sec-heuristic-governance': {
    id: 'sec-heuristic-governance',
    roles: ['a0', 'auditor', 'maintainer'],
    operationKinds: ['govern', 'design'],
    requiredCapabilities: ['git'],
    requiredResources: [],
    requiredGates: [],
    writeSurface: ['.agents/skills/', 'platform/shared/agent-skill-contract.ts', 'AGENTS.md'],
    supersededBy: null
  },
  'sec-impact-and-validation': {
    id: 'sec-impact-and-validation',
    roles: ['worker', 'reviewer', 'maintainer'],
    operationKinds: ['implement', 'review', 'govern'],
    requiredCapabilities: ['git'],
    requiredResources: [],
    requiredGates: [],
    writeSurface: [],
    supersededBy: null
  },
  'sec-repository-audit': {
    id: 'sec-repository-audit',
    roles: ['auditor'],
    operationKinds: ['audit'],
    requiredCapabilities: ['git', 'github'],
    requiredResources: [],
    requiredGates: [],
    writeSurface: [],
    supersededBy: null
  },
  'sec-repository-orientation': {
    id: 'sec-repository-orientation',
    roles: ['a0', 'worker', 'reviewer', 'auditor', 'maintainer'],
    operationKinds: ['orient'],
    requiredCapabilities: ['git', 'github'],
    requiredResources: [],
    requiredGates: [],
    writeSurface: [],
    supersededBy: null
  },
  'sec-task-delegation': {
    id: 'sec-task-delegation',
    roles: ['a0'],
    operationKinds: ['govern', 'orient'],
    requiredCapabilities: ['git'],
    requiredResources: [],
    requiredGates: [],
    writeSurface: [],
    supersededBy: null
  },
  'sec-toolchain-and-dependencies': {
    id: 'sec-toolchain-and-dependencies',
    roles: ['maintainer'],
    operationKinds: ['govern'],
    requiredCapabilities: ['git', 'github'],
    requiredResources: [],
    requiredGates: [],
    writeSurface: ['package.json', 'bun.lock', 'bunfig.toml', 'tsconfig.json', '.github/workflows/', '.githooks/'],
    supersededBy: null
  },
  'sec-trust-root-bootstrap': {
    id: 'sec-trust-root-bootstrap',
    roles: ['a0', 'reviewer', 'maintainer'],
    operationKinds: ['govern', 'design', 'review', 'integrate'],
    requiredCapabilities: ['git', 'github', 'hosted-gate'],
    requiredResources: ['github-api'],
    requiredGates: ['hosted-gate'],
    writeSurface: [],
    supersededBy: null
  },
  'sec-work-package-lifecycle': {
    id: 'sec-work-package-lifecycle',
    roles: ['a0'],
    operationKinds: ['govern', 'orient'],
    requiredCapabilities: ['git'],
    requiredResources: [],
    requiredGates: [],
    writeSurface: ['docs/work/', 'docs/work-packages/'],
    supersededBy: null
  },
  'sec-worker-development': {
    id: 'sec-worker-development',
    roles: ['worker'],
    operationKinds: ['implement'],
    requiredCapabilities: ['git'],
    requiredResources: [],
    requiredGates: [],
    writeSurface: [],
    supersededBy: null
  }
} as const satisfies Record<SecAgentSkillId, SecAgentSkillMetadataV1>;

/**
 * Candidate-quarantine surfaces: when a candidate changes these paths, the
 * applicability decision and any Review guidance bind the trusted base/main
 * revision; candidate bytes are only SUT differences and can never self-authorize.
 */
export const SEC_SKILL_QUARANTINE_PATHS = [
  'AGENTS.md',
  '.agents/',
  'platform/shared/agent-skill-contract.ts',
  'scripts/codex/skill-applicability.ts',
  'docs/development-governance.md'
] as const;

export function isSecSkillQuarantinePath(path: string): boolean {
  return SEC_SKILL_QUARANTINE_PATHS.some((quarantine) => (
    quarantine.endsWith('/') ? path.startsWith(quarantine) : path === quarantine
  ));
}

export interface SecSkillApplicabilityTriggerEvidence {
  readonly skillId: SecAgentSkillId;
  readonly role: boolean;
  readonly operationKind: boolean;
}

export interface SecSkillApplicabilityExclusionResult {
  readonly skillId: SecAgentSkillId;
  readonly reason: SecSkillApplicabilityExclusionReason;
}

export interface SecSkillApplicabilityScopeConflict {
  readonly skillId: SecAgentSkillId;
  readonly kind: SecSkillApplicabilityConflictKind;
}

export interface SecSkillApplicabilityDecisionV1 {
  readonly schema: typeof SEC_SKILL_APPLICABILITY_SCHEMA;
  readonly status: SecSkillApplicabilityStatus;
  readonly role: SecAgentRole | null;
  readonly operationKind: SecOperationKind | null;
  readonly goalDigest: string;
  readonly trustedRevision: string;
  readonly targetCandidate: string;
  readonly workPackageAuthorizationRef: string | null;
  readonly taskCapsuleRef: string | null;
  readonly candidateSkillIds: readonly SecAgentSkillId[];
  readonly selectedSkillId: SecAgentSkillId | null;
  readonly trustedSkillRevision: string | null;
  readonly candidateSkillRevision: string | null;
  readonly quarantinePaths: readonly string[];
  readonly triggerEvidence: readonly SecSkillApplicabilityTriggerEvidence[];
  readonly exclusionResults: readonly SecSkillApplicabilityExclusionResult[];
  readonly capabilityAvailability: Readonly<Record<string, boolean>>;
  readonly scopeConflicts: readonly SecSkillApplicabilityScopeConflict[];
  readonly reasonCodes: readonly string[];
  readonly invalidationConditions: readonly string[];
}

export interface SecSkillApplicabilityEnvelopeV1 {
  readonly role: unknown;
  readonly operationKind: unknown;
  readonly goalDigest: string;
  readonly trustedRevision: string;
  readonly targetCandidate: string;
  readonly workPackageAuthorizationRef?: string | null;
  readonly taskCapsuleRef?: string | null;
  readonly candidates?: readonly unknown[];
  readonly availableCapabilities?: readonly string[];
  readonly authorizedResources?: readonly string[];
  readonly authorizedGates?: readonly string[];
  readonly authorizedWritePaths?: readonly string[];
  readonly forbiddenPaths?: readonly string[];
  readonly changedPaths?: readonly string[];
  readonly trustedSkillRevisions?: Readonly<Record<string, string>>;
  readonly candidateSkillRevisions?: Readonly<Record<string, string>>;
  readonly priorDecision?: SecSkillApplicabilityDecisionV1;
  readonly metadataOverrides?: Readonly<Record<string, SecAgentSkillMetadataV1>>;
}

function skillSurfaceWithin(surface: string, scopes: readonly string[]): boolean {
  return scopes.some((scope) => (
    scope.endsWith('/') ? surface.startsWith(scope) : surface === scope
  ));
}

function computeInvalidationConditions(
  prior: SecSkillApplicabilityDecisionV1,
  input: SecSkillApplicabilityEnvelopeV1
): string[] {
  const conditions: string[] = [];
  if (prior.goalDigest !== input.goalDigest) conditions.push('goal-digest');
  if (prior.role !== null && prior.role !== input.role) conditions.push('role');
  if (prior.operationKind !== null && prior.operationKind !== input.operationKind) {
    conditions.push('operation-kind');
  }
  if ((prior.workPackageAuthorizationRef ?? null) !== (input.workPackageAuthorizationRef ?? null)) {
    conditions.push('work-package-authorization');
  }
  if ((prior.taskCapsuleRef ?? null) !== (input.taskCapsuleRef ?? null)) conditions.push('task-capsule');
  if (prior.trustedRevision !== input.trustedRevision) conditions.push('trusted-revision');
  if (prior.candidateSkillIds.length > 0) {
    const priorSet = new Set(prior.candidateSkillIds);
    const current = [...new Set((input.candidates ?? [...SEC_AGENT_SKILL_IDS]).filter(isSecAgentSkillId))];
    if (current.length !== priorSet.size || current.some((skillId) => !priorSet.has(skillId))) {
      conditions.push('candidate-set');
    }
  }
  return conditions;
}

function buildUnresolvedDecision(
  input: SecSkillApplicabilityEnvelopeV1,
  reasonCode: string
): SecSkillApplicabilityDecisionV1 {
  return {
    schema: SEC_SKILL_APPLICABILITY_SCHEMA,
    status: 'unresolved',
    role: null,
    operationKind: null,
    goalDigest: input.goalDigest,
    trustedRevision: input.trustedRevision,
    targetCandidate: input.targetCandidate,
    workPackageAuthorizationRef: input.workPackageAuthorizationRef ?? null,
    taskCapsuleRef: input.taskCapsuleRef ?? null,
    candidateSkillIds: [],
    selectedSkillId: null,
    trustedSkillRevision: null,
    candidateSkillRevision: null,
    quarantinePaths: [],
    triggerEvidence: [],
    exclusionResults: [],
    capabilityAvailability: {},
    scopeConflicts: [],
    reasonCodes: [reasonCode],
    invalidationConditions: []
  };
}

/**
 * Pure zero-or-one applicability decision (Issue #275). Reads only machine
 * metadata and the operation envelope; never reads Skill prose bytes.
 */
export function evaluateSecSkillApplicabilityV1(
  input: SecSkillApplicabilityEnvelopeV1
): SecSkillApplicabilityDecisionV1 {
  const role = input.role;
  const operationKind = input.operationKind;
  if (!isSecAgentRole(role)) return buildUnresolvedDecision(input, 'unresolved-invalid-role');
  if (!isSecOperationKind(operationKind)) {
    return buildUnresolvedDecision(input, 'unresolved-invalid-operation-kind');
  }
  if (
    typeof input.goalDigest !== 'string'
    || input.goalDigest.trim().length === 0
    || typeof input.trustedRevision !== 'string'
    || input.trustedRevision.trim().length === 0
    || typeof input.targetCandidate !== 'string'
    || input.targetCandidate.trim().length === 0
  ) {
    return buildUnresolvedDecision(input, 'unresolved-missing-binding');
  }

  const metadata = {
    ...SEC_AGENT_SKILL_METADATA_V1,
    ...(input.metadataOverrides ?? {})
  } as Record<SecAgentSkillId, SecAgentSkillMetadataV1>;

  const prior = input.priorDecision;
  if (prior !== undefined && prior.schema === SEC_SKILL_APPLICABILITY_SCHEMA && prior.status !== 'stale') {
    const conditions = computeInvalidationConditions(prior, input);
    if (conditions.length > 0) {
      return {
        schema: SEC_SKILL_APPLICABILITY_SCHEMA,
        status: 'stale',
        role,
        operationKind,
        goalDigest: input.goalDigest,
        trustedRevision: input.trustedRevision,
        targetCandidate: input.targetCandidate,
        workPackageAuthorizationRef: input.workPackageAuthorizationRef ?? null,
        taskCapsuleRef: input.taskCapsuleRef ?? null,
        candidateSkillIds: [...new Set((input.candidates ?? [...SEC_AGENT_SKILL_IDS]).filter(isSecAgentSkillId))],
        selectedSkillId: null,
        trustedSkillRevision: null,
        candidateSkillRevision: null,
        quarantinePaths: [],
        triggerEvidence: [],
        exclusionResults: [],
        capabilityAvailability: {},
        scopeConflicts: [],
        invalidationConditions: conditions,
        reasonCodes: ['stale']
      };
    }
  }

  const changedPaths = [...new Set(input.changedPaths ?? [])];
  const quarantinePaths = changedPaths.filter(isSecSkillQuarantinePath).sort();
  const quarantineActive = quarantinePaths.length > 0;

  const availableCapabilities = new Set(input.availableCapabilities ?? []);
  const authorizedResources = new Set(input.authorizedResources ?? []);
  const authorizedGates = new Set(input.authorizedGates ?? []);
  const authorizedWritePaths = input.authorizedWritePaths ?? [];
  const forbiddenPaths = input.forbiddenPaths ?? [];

  const capabilityAvailability: Record<string, boolean> = {};
  for (const skillId of SEC_AGENT_SKILL_IDS) {
    for (const capability of metadata[skillId]!.requiredCapabilities) {
      capabilityAvailability[capability] = availableCapabilities.has(capability);
    }
  }

  const requested = [...(input.candidates ?? [...SEC_AGENT_SKILL_IDS])];
  const candidateSkillIds = [...new Set(requested.filter(isSecAgentSkillId))];
  const unknownCandidateCount = [...new Set(requested)].filter((candidate) => !isSecAgentSkillId(candidate)).length;

  const triggerEvidence: SecSkillApplicabilityTriggerEvidence[] = [];
  const exclusionResults: SecSkillApplicabilityExclusionResult[] = [];
  const scopeConflicts: SecSkillApplicabilityScopeConflict[] = [];
  const survivors: SecAgentSkillId[] = [];

  for (const skillId of candidateSkillIds) {
    const skillMetadata = metadata[skillId]!;
    const roleHit = skillMetadata.roles.includes(role);
    const kindHit = skillMetadata.operationKinds.includes(operationKind);
    triggerEvidence.push({ skillId, role: roleHit, operationKind: kindHit });
    if (!roleHit || !kindHit) {
      exclusionResults.push({
        skillId,
        reason: roleHit ? 'operation-kind-mismatch' : 'role-mismatch'
      });
      continue;
    }
    if (skillMetadata.supersededBy !== null) {
      exclusionResults.push({ skillId, reason: 'superseded' });
      continue;
    }
    const missingCapabilities = skillMetadata.requiredCapabilities.filter(
      (capability) => !availableCapabilities.has(capability)
    );
    if (missingCapabilities.length > 0) {
      exclusionResults.push({ skillId, reason: 'capability-unavailable' });
      continue;
    }
    if (skillMetadata.requiredResources.some((resource) => !authorizedResources.has(resource))) {
      scopeConflicts.push({ skillId, kind: 'resource' });
    }
    if (skillMetadata.requiredGates.some((gate) => !authorizedGates.has(gate))) {
      scopeConflicts.push({ skillId, kind: 'gate' });
    }
    const surfaceForbidden = skillMetadata.writeSurface.some(
      (surface) => forbiddenPaths.some(
        (forbidden) => skillSurfaceWithin(surface, [forbidden]) || skillSurfaceWithin(forbidden, [surface])
      )
    );
    const surfaceUnauthorized = authorizedWritePaths.length > 0
      && skillMetadata.writeSurface.some((surface) => !skillSurfaceWithin(surface, authorizedWritePaths));
    if (surfaceForbidden || surfaceUnauthorized) {
      scopeConflicts.push({ skillId, kind: 'write-path' });
    }
    if (scopeConflicts.some((conflict) => conflict.skillId === skillId)) continue;
    survivors.push(skillId);
  }

  const reasonCodes: string[] = [];
  if (quarantineActive) reasonCodes.push('candidate-quarantine', 'quarantine-binds-trusted-revision');
  if (unknownCandidateCount > 0) reasonCodes.push('unknown-candidate-ignored');

  let status: SecSkillApplicabilityStatus;
  let selectedSkillId: SecAgentSkillId | null = null;
  if (scopeConflicts.length > 0) {
    status = 'conflict';
    reasonCodes.push(...[...new Set(scopeConflicts.map((conflict) => conflict.kind))].map(
      (kind) => `conflict-${kind}`
    ));
  } else if (survivors.length === 0) {
    if (operationKind === 'no-change') {
      status = 'not-applicable';
      reasonCodes.push('not-applicable-operation');
    } else {
      status = 'none-required';
      reasonCodes.push('none-required');
    }
  } else if (survivors.length === 1) {
    status = 'applicable';
    selectedSkillId = survivors[0]!;
    reasonCodes.push('applicable-selected');
  } else {
    status = 'ambiguous';
    reasonCodes.push('ambiguous-multiple-candidates');
  }

  const trustedSkillRevision = quarantineActive
    ? (input.trustedSkillRevisions?.[quarantinePaths[0]!] ?? null)
    : null;
  const candidateSkillRevision = quarantineActive
    ? (input.candidateSkillRevisions?.[quarantinePaths[0]!] ?? null)
    : null;

  return {
    schema: SEC_SKILL_APPLICABILITY_SCHEMA,
    status,
    role,
    operationKind,
    goalDigest: input.goalDigest,
    trustedRevision: input.trustedRevision,
    targetCandidate: input.targetCandidate,
    workPackageAuthorizationRef: input.workPackageAuthorizationRef ?? null,
    taskCapsuleRef: input.taskCapsuleRef ?? null,
    candidateSkillIds,
    selectedSkillId,
    trustedSkillRevision,
    candidateSkillRevision,
    quarantinePaths,
    triggerEvidence,
    exclusionResults,
    capabilityAvailability,
    scopeConflicts,
    reasonCodes,
    invalidationConditions: []
  };
}
