import {
  isSecAgentRole,
  isSecOperationKind,
  type SecAgentRole,
  type SecOperationKind
} from './agent-task-capsule-contract.ts';

export {
  isSecAgentRole,
  isSecOperationKind,
  SEC_AGENT_ROLES,
  SEC_OPERATION_KINDS,
  type SecAgentRole,
  type SecOperationKind
} from './agent-task-capsule-contract.ts';

export const SEC_AGENT_SKILL_IDS = [
  'sec-architecture-evolution',
  'sec-exact-head-review',
  'sec-external-capability-governance',
  'sec-failure-recovery',
  'sec-heuristic-governance',
  'sec-repository-audit',
  'sec-task-delegation',
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

export interface SecRepositorySkillBehaviorRoute {
  readonly kind: 'skill';
  readonly owner: SecAgentSkillId;
  readonly authorityRef: `.agents/skills/${SecAgentSkillId}/SKILL.md`;
}

export interface SecRepositoryDeterministicBehaviorRoute {
  readonly kind: 'deterministic';
  readonly owner: string;
  readonly authorityRef: string;
}

export type SecRepositoryBehaviorRoute =
  | SecRepositorySkillBehaviorRoute
  | SecRepositoryDeterministicBehaviorRoute;

const skillRoute = <SkillId extends SecAgentSkillId>(
  owner: SkillId
): SecRepositorySkillBehaviorRoute => Object.freeze({
  kind: 'skill',
  owner,
  authorityRef: `.agents/skills/${owner}/SKILL.md` as const
});

const deterministicRoute = (
  owner: string,
  authorityRef: string
): SecRepositoryDeterministicBehaviorRoute => Object.freeze({
  kind: 'deterministic',
  owner,
  authorityRef
});

/**
 * Repository behavior routing is deliberately not a behavior-to-Skill
 * bijection. Machine-decidable behavior has a deterministic code owner and
 * requires no Skill body; only irreducible judgement routes to one Skill.
 */
export const SEC_REPOSITORY_BEHAVIOR_ROUTES = Object.freeze({
  'a0-integration': deterministicRoute(
    'verification-session',
    'platform/shared/verification-session-contract.ts'
  ),
  'architecture-evolution': skillRoute('sec-architecture-evolution'),
  'ci-and-merge': deterministicRoute('integration-transaction', 'scripts/codex/merge-gate.ts'),
  'context-resume': deterministicRoute(
    'verification-session-runtime',
    'scripts/codex/verification-session-runtime.ts'
  ),
  'documentation-governance': deterministicRoute(
    'documentation-authority',
    'platform/shared/documentation-authority-contract.ts'
  ),
  'exact-head-review': skillRoute('sec-exact-head-review'),
  'external-capability-governance': skillRoute('sec-external-capability-governance'),
  'failure-recovery': skillRoute('sec-failure-recovery'),
  'heuristic-governance': skillRoute('sec-heuristic-governance'),
  'impact-and-validation': deterministicRoute(
    'test-impact-selector',
    'platform/shared/test-impact-contract.ts'
  ),
  'repository-audit': skillRoute('sec-repository-audit'),
  'repository-orientation': deterministicRoute(
    'document-control-plane',
    'scripts/codex/document-control-plane.ts'
  ),
  'task-delegation': skillRoute('sec-task-delegation'),
  'toolchain-and-dependencies': deterministicRoute(
    'runtime-dependency-spec',
    'platform/shared/runtime-dependency-spec.ts'
  ),
  'trust-root-bootstrap': deterministicRoute(
    'tcb-closure',
    'platform/shared/tcb-closure-lock.ts'
  ),
  'work-package-lifecycle': deterministicRoute(
    'document-control-plane',
    'scripts/codex/document-control-plane-contract.ts'
  ),
  'worker-development': skillRoute('sec-worker-development')
} satisfies Record<SecRepositoryBehaviorId, SecRepositoryBehaviorRoute>);

/**
 * Skill body V2 keeps only the information an irreducible judgement needs.
 * Permission, tools and deterministic prerequisite/state transitions belong to
 * machine owners and are intentionally not sections in Skill prose.
 */
export const SEC_AGENT_SKILL_STANDARD_SECTIONS = [
  '## 适用边界',
  '## 已准入输入',
  '## 判断职责',
  '## 判断输出',
  '## 停止与回退',
  '## 禁止',
  '## 语义权威（非自动读取）'
] as const;

export type SecMarkdownSurfaceKind =
  | 'skill-definition'
  | 'agent-projection'
  | 'active-authority'
  | 'active-proposal'
  | 'control-projection'
  | 'navigation'
  | 'frozen-work-package'
  | 'evidence'
  | 'historical'
  | 'verification-fixture'
  | 'public-projection'
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

export function resolveSecRepositoryBehaviorRoute(
  behavior: SecRepositoryBehaviorId
): SecRepositoryBehaviorRoute {
  return SEC_REPOSITORY_BEHAVIOR_ROUTES[behavior];
}

export function resolveSecMarkdownSkillCoverage(path: string): SecMarkdownSkillCoverage | null {
  if (!path.endsWith('.md')) return null;

  const skillId = skillIdFromPath(path);
  if (skillId) return { kind: 'skill-definition', skills: [skillId] };

  if (path === 'AGENTS.md') {
    return {
      kind: 'agent-projection',
      skills: skills(
        'sec-repository-audit',
        'sec-task-delegation',
        'sec-heuristic-governance'
      )
    };
  }
  if (path === 'README.md' || path === 'docs/README.md' || path === 'docs/work/README.md') {
    return {
      kind: 'navigation',
      skills: []
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
  if (/^public-docs\/[^/]+\.md$/u.test(path)) {
    // Public documentation is a zh-CN projection bound to canonical sources by
    // public-docs/manifest.json; it holds no authority and routes no Skill.
    return { kind: 'public-projection', skills: [] };
  }
  if (!/^docs\//u.test(path)) return null;

  if (ARCHITECTURE_DOCUMENTS.has(path)) {
    return {
      kind: 'active-authority',
      skills: skills(
        'sec-architecture-evolution',
        'sec-repository-audit'
      )
    };
  }
  if (path === 'docs/development-governance.md') {
    return {
      kind: 'active-authority',
      skills: skills(
        'sec-architecture-evolution',
        'sec-exact-head-review',
        'sec-failure-recovery',
        'sec-heuristic-governance',
        'sec-repository-audit',
        'sec-task-delegation',
        'sec-worker-development'
      )
    };
  }
  if (path === 'docs/verification-governance.md') {
    return {
      kind: 'active-authority',
      skills: skills(
        'sec-exact-head-review',
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
        'sec-repository-audit'
      )
    };
  }
  if (/^docs\/proposals\/.+\.md$/u.test(path)) {
    return {
      kind: 'active-proposal',
      skills: skills(
        'sec-architecture-evolution',
        'sec-repository-audit'
      )
    };
  }
  if (/^docs\/work\/(?:rolling-plan|active-work-package)\.md$/u.test(path)) {
    return {
      kind: 'control-projection',
      skills: []
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
    return skills('sec-heuristic-governance', 'sec-repository-audit', 'sec-task-delegation');
  }
  if (path === 'docs/authority.json'
    || path === 'platform/shared/documentation-authority-contract.ts'
    || path === 'platform/shared/active-documentation-contract.ts'
    || path === 'docs/scripts/docs-doctor.ts') {
    return skills('sec-heuristic-governance', 'sec-repository-audit');
  }
  if (path === 'docs/governance/external-capability-ledger.yaml') {
    return skills('sec-external-capability-governance', 'sec-heuristic-governance');
  }
  if (path === 'docs/governance/nexus-absorption-ledger.yaml') {
    return skills('sec-external-capability-governance', 'sec-repository-audit');
  }
  if (path === 'platform/shared/agent-skill-contract.ts'
    || path === 'platform/shared/agent-skill-runtime-contract.ts'
    || path === 'platform/shared/agent-operation-read-plan-contract.ts') {
    return skills('sec-architecture-evolution', 'sec-heuristic-governance', 'sec-repository-audit');
  }
  if (/^\.codex\//u.test(path)) {
    return skills('sec-exact-head-review', 'sec-heuristic-governance', 'sec-task-delegation');
  }
  if (path === 'scripts/codex/repository-audit.ts') {
    return skills('sec-repository-audit', 'sec-heuristic-governance');
  }
  if (path === 'scripts/discover-all.ts') {
    return skills('sec-repository-audit');
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

export function isSecAgentSkillId(value: unknown): value is SecAgentSkillId {
  return typeof value === 'string' && (SEC_AGENT_SKILL_IDS as readonly string[]).includes(value);
}

/**
 * Minimal machine metadata for irreducible judgement selection. A Skill body
 * has no tool, resource, gate or write authority; those belong to the current
 * operation and deterministic owners. Only role, operation kind and lifecycle
 * participate in Skill applicability.
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
  'sec-architecture-evolution': {
    id: 'sec-architecture-evolution',
    roles: ['a0', 'auditor', 'maintainer'],
    operationKinds: ['design'],
    requiredCapabilities: [],
    requiredResources: [],
    requiredGates: [],
    writeSurface: [],
    supersededBy: null
  },
  'sec-exact-head-review': {
    id: 'sec-exact-head-review',
    roles: ['reviewer'],
    operationKinds: ['review'],
    requiredCapabilities: [],
    requiredResources: [],
    requiredGates: [],
    writeSurface: [],
    supersededBy: null
  },
  'sec-external-capability-governance': {
    id: 'sec-external-capability-governance',
    roles: ['a0', 'maintainer'],
    operationKinds: ['govern'],
    requiredCapabilities: [],
    requiredResources: [],
    requiredGates: [],
    writeSurface: [],
    supersededBy: null
  },
  'sec-failure-recovery': {
    id: 'sec-failure-recovery',
    roles: ['a0', 'worker', 'maintainer'],
    operationKinds: ['diagnose'],
    requiredCapabilities: [],
    requiredResources: [],
    requiredGates: [],
    writeSurface: [],
    supersededBy: null
  },
  'sec-heuristic-governance': {
    id: 'sec-heuristic-governance',
    roles: ['a0', 'auditor', 'maintainer'],
    operationKinds: ['govern', 'design'],
    requiredCapabilities: [],
    requiredResources: [],
    requiredGates: [],
    writeSurface: [],
    supersededBy: null
  },
  'sec-repository-audit': {
    id: 'sec-repository-audit',
    roles: ['auditor'],
    operationKinds: ['audit'],
    requiredCapabilities: [],
    requiredResources: [],
    requiredGates: [],
    writeSurface: [],
    supersededBy: null
  },
  'sec-task-delegation': {
    id: 'sec-task-delegation',
    roles: ['a0'],
    operationKinds: ['govern', 'orient'],
    requiredCapabilities: [],
    requiredResources: [],
    requiredGates: [],
    writeSurface: [],
    supersededBy: null
  },
  'sec-worker-development': {
    id: 'sec-worker-development',
    roles: ['worker'],
    operationKinds: ['implement'],
    requiredCapabilities: [],
    requiredResources: [],
    requiredGates: [],
    writeSurface: [],
    supersededBy: null
  }
} as const satisfies Record<SecAgentSkillId, SecAgentSkillMetadataV1>;

/**
 * Candidate-quarantine surfaces: when a candidate changes guidance/runtime
 * paths, applicability and Review guidance bind the trusted base/main revision;
 * candidate bytes are only SUT differences and can never self-authorize.
 */
export const SEC_SKILL_QUARANTINE_PATHS = [
  'AGENTS.md',
  '.agents/',
  '.codex/agents/',
  'platform/shared/agent-operation-activation-contract.ts',
  'platform/shared/agent-operation-read-plan-contract.ts',
  'platform/shared/agent-skill-contract.ts',
  'platform/shared/agent-skill-runtime-contract.ts',
  'platform/shared/agent-task-capsule-contract.ts',
  'scripts/codex/agent-operation-activation.ts',
  'scripts/codex/operation-read-plan.ts',
  'scripts/codex/skill-applicability.ts',
  'scripts/codex/task-capsule.ts',
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
  readonly workPackageProposalRef: string | null;
  readonly taskCapsuleRef: string | null;
  readonly taskCapsuleDigest: string | null;
  readonly taskCapsuleRevision: string | null;
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
  readonly workPackageProposalRef?: string | null;
  readonly taskCapsuleRef?: string | null;
  readonly taskCapsuleDigest?: string | null;
  readonly taskCapsuleRevision?: string | null;
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
  if ((prior.workPackageProposalRef ?? null) !== (input.workPackageProposalRef ?? null)) {
    conditions.push('work-package-proposal');
  }
  if ((prior.taskCapsuleRef ?? null) !== (input.taskCapsuleRef ?? null)) conditions.push('task-capsule');
  if ((prior.taskCapsuleDigest ?? null) !== (input.taskCapsuleDigest ?? null)) {
    conditions.push('task-capsule-digest');
  }
  if ((prior.taskCapsuleRevision ?? null) !== (input.taskCapsuleRevision ?? null)) {
    conditions.push('task-capsule-revision');
  }
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
    workPackageProposalRef: input.workPackageProposalRef ?? null,
    taskCapsuleRef: input.taskCapsuleRef ?? null,
    taskCapsuleDigest: input.taskCapsuleDigest ?? null,
    taskCapsuleRevision: input.taskCapsuleRevision ?? null,
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
        workPackageProposalRef: input.workPackageProposalRef ?? null,
        taskCapsuleRef: input.taskCapsuleRef ?? null,
        taskCapsuleDigest: input.taskCapsuleDigest ?? null,
        taskCapsuleRevision: input.taskCapsuleRevision ?? null,
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
    workPackageProposalRef: input.workPackageProposalRef ?? null,
    taskCapsuleRef: input.taskCapsuleRef ?? null,
    taskCapsuleDigest: input.taskCapsuleDigest ?? null,
    taskCapsuleRevision: input.taskCapsuleRevision ?? null,
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
