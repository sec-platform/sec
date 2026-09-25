import { isRepositoryTestModulePath } from '../../../../contracts/repository-test-path.ts';
import { REPOSITORY_AUDIT_ENTRYPOINT_PATH } from '../../../repository/source-program-model/contract.ts';
import { activeDocumentationRecord } from '../documentation/active.ts';
import {
  isAgentRole,
  isTaskOperationKind,
  type AgentRole,
  type TaskOperationKind
} from './task-capsule.ts';

export {
  isAgentRole,
  isTaskOperationKind,


  type AgentRole,
  type TaskOperationKind
} from './task-capsule.ts';

export const AGENT_SKILL_IDS = [
  'architecture-evolution',
  'exact-head-review',
  'external-capability-governance',
  'failure-recovery',
  'heuristic-governance',
  'repository-audit',
  'task-delegation',
  'test-design',
  'worker-development'
] as const;

export type AgentSkillId = (typeof AGENT_SKILL_IDS)[number];

export const REPOSITORY_HEURISTIC_BEHAVIOR_IDS = [
  'architecture-evolution',
  'exact-head-review',
  'external-capability-governance',
  'failure-recovery',
  'governance-self-correction',
  'repository-audit',
  'task-delegation',
  'test-design',
  'worker-development'
] as const;

export type RepositoryHeuristicBehaviorId =
  (typeof REPOSITORY_HEURISTIC_BEHAVIOR_IDS)[number];

export interface RepositorySkillBehaviorRoute {
  readonly kind: 'skill';
  readonly owner: AgentSkillId;
  readonly authorityRef: `.agents/skills/${AgentSkillId}/SKILL.md`;
}

const skillRoute = <SkillId extends AgentSkillId>(
  owner: SkillId
): RepositorySkillBehaviorRoute => Object.freeze({
  kind: 'skill',
  owner,
  authorityRef: `.agents/skills/${owner}/SKILL.md` as const
});

/**
 * Only irreducible judgement is registered here. Machine capabilities and
 * operations are compiled from module descriptors and semantic operation
 * plans; copying them into the Skill registry would create a second graph.
 */
export const REPOSITORY_HEURISTIC_ROUTES = Object.freeze({
  'architecture-evolution': skillRoute('architecture-evolution'),
  'exact-head-review': skillRoute('exact-head-review'),
  'external-capability-governance': skillRoute('external-capability-governance'),
  'failure-recovery': skillRoute('failure-recovery'),
  'governance-self-correction': skillRoute('heuristic-governance'),
  'repository-audit': skillRoute('repository-audit'),
  'task-delegation': skillRoute('task-delegation'),
  'test-design': skillRoute('test-design'),
  'worker-development': skillRoute('worker-development')
} satisfies Record<RepositoryHeuristicBehaviorId, RepositorySkillBehaviorRoute>);

type MarkdownSurfaceKind =
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
  | 'repository-content';

export type MarkdownSkillCoverage = {
  kind: MarkdownSurfaceKind;
  skills: AgentSkillId[];
};

function skills(...ids: AgentSkillId[]): AgentSkillId[] {
  return [...new Set(ids)].sort();
}

function skillIdFromPath(path: string): AgentSkillId | null {
  const match = /^\.agents\/skills\/([a-z0-9]+(?:-[a-z0-9]+)*)\/SKILL\.md$/u.exec(path);
  if (!match) return null;
  return AGENT_SKILL_IDS.includes(match[1] as AgentSkillId)
    ? match[1] as AgentSkillId
    : null;
}

export function resolveRepositoryHeuristicRoute(
  behavior: RepositoryHeuristicBehaviorId
): RepositorySkillBehaviorRoute {
  return REPOSITORY_HEURISTIC_ROUTES[behavior];
}

export function resolveMarkdownSkillCoverage(path: string): MarkdownSkillCoverage | null {
  if (!path.endsWith('.md')) return null;

  const skillId = skillIdFromPath(path);
  if (skillId) return { kind: 'skill-definition', skills: [skillId] };

  if (path === 'AGENTS.md') {
    return {
      kind: 'agent-projection',
      skills: skills(
        'repository-audit',
        'task-delegation',
        'heuristic-governance'
      )
    };
  }
  if (path === 'README.md' || /^README\.[A-Za-z0-9-]+\.md$/u.test(path)
      || path === 'docs/README.md' || path === 'config/repository/README.md'
      || path === '.documentation/README.md') {
    return {
      kind: 'navigation',
      skills: []
    };
  }
  if (!path.includes('/')) {
    // Root policies, status, support and contributor material are tracked
    // repository content unless an earlier exact rule grants a narrower role.
    return { kind: 'repository-content', skills: [] };
  }
  if (/^tests\/.*\.md$/u.test(path)) {
    return { kind: 'verification-fixture', skills: [] };
  }
  if (/^\.github\/.*\.md$/u.test(path)) {
    // Repository collaboration templates are maintained content, not Agent or
    // product authority. Classify the complete surface so adding another
    // template cannot silently fall outside the tracked-Markdown census.
    return { kind: 'repository-content', skills: [] };
  }
  if (/^LICENSES\/.*\.md$/u.test(path)) {
    return { kind: 'repository-content', skills: [] };
  }
  if (/^config\/repository\/work-packages\/[^/]+\.md$/u.test(path)) {
    return { kind: 'frozen-work-package', skills: [] };
  }
  if (/^config\/repository\/(?:rolling-plan|active-work-package|work-selection)\.md$/u.test(path)) {
    return {
      kind: 'control-projection',
      skills: []
    };
  }
  if (/^docs\/evidence\/.*\.md$/u.test(path)) return { kind: 'evidence', skills: [] };
  if (/^docs\/(?:archive|superpowers)\//u.test(path)
    || /^docs\/scripts\/SEC_docs_v5_replacement\//u.test(path)) {
    return { kind: 'historical', skills: [] };
  }
  if (/^docs\/corpus\/.+\.md$/u.test(path)) {
    return { kind: 'repository-content', skills: [] };
  }
  if (/^(?:examples|alternatives)\//u.test(path)) {
    // Examples and alternatives remain source material, not adopted authority;
    // document registration is an independent identity boundary.
    return { kind: 'repository-content', skills: [] };
  }
  if (!/^docs\//u.test(path)) return null;

  if (path === 'docs/开发/用途与任务范围.md') {
    return {
      kind: 'active-authority',
      skills: skills(
        'architecture-evolution',
        'exact-head-review',
        'failure-recovery',
        'heuristic-governance',
        'repository-audit',
        'task-delegation',
        'test-design',
        'worker-development'
      )
    };
  }
  if (path === 'docs/运行/保证/要求证据与裁决.md') {
    return {
      kind: 'active-authority',
      skills: skills(
        'exact-head-review',
        'failure-recovery',
        'repository-audit',
        'test-design'
      )
    };
  }
  if (path === 'docs/开发/测试发现与执行.md') {
    return {
      kind: 'active-authority',
      skills: skills(
        'architecture-evolution',
        'repository-audit',
        'test-design'
      )
    };
  }
  if (path === 'docs/作者/工程源/资产与非源码.md'
      || path === 'docs/运行/宿主生态与技术约束.md') {
    return {
      kind: 'active-authority',
      skills: skills(
        'external-capability-governance',
        'repository-audit',
        'heuristic-governance'
      )
    };
  }
  if (activeDocumentationRecord(path) !== undefined) {
    return {
      kind: 'active-authority',
      skills: skills(
        'architecture-evolution',
        'repository-audit'
      )
    };
  }
  if (/^docs\/proposals\/.+\.md$/u.test(path)) {
    return {
      kind: 'active-proposal',
      skills: skills(
        'architecture-evolution',
        'repository-audit'
      )
    };
  }
  // Unregistered docs remain ordinary repository content. This classifies the
  // surface without granting authority or loading any Skill.
  return { kind: 'repository-content', skills: [] };
}

export type RepositorySurfaceKind =
  | 'markdown'
  | 'heuristic-runtime'
  | 'product-implementation'
  | 'verification-test'
  | 'configuration'
  | 'repository-content';

export type RepositorySurface = {
  kind: RepositorySurfaceKind;
  skills: AgentSkillId[];
};

export function resolveRepositoryHeuristicSkills(path: string): AgentSkillId[] {
  const skillId = skillIdFromPath(path);
  if (skillId) return [skillId];
  if (path === 'AGENTS.md') {
    return skills('heuristic-governance', 'repository-audit', 'task-delegation');
  }
  if (path.startsWith('.documentation/')
    || path === 'tools/check_docs.py'
    || path === 'tools/check_design.py'
    || path === 'tools/source_inventory.py'
    || path.startsWith('src/adapters/self-hosting/control/documentation/')) {
    return skills('heuristic-governance', 'repository-audit');
  }
  if (path === 'config/external-capabilities/ledger.yaml') {
    return skills('external-capability-governance', 'heuristic-governance');
  }
  if (path.startsWith('src/adapters/self-hosting/control/agent/')) {
    return skills('architecture-evolution', 'heuristic-governance', 'repository-audit');
  }
  if (/^\.codex\//u.test(path)) {
    return skills('exact-head-review', 'heuristic-governance', 'task-delegation');
  }
  if (path === REPOSITORY_AUDIT_ENTRYPOINT_PATH) {
    return skills('repository-audit', 'heuristic-governance');
  }
  return [];
}

export function isRepositoryHeuristicSurface(path: string): boolean {
  return resolveRepositoryHeuristicSkills(path).length > 0;
}

export function classifyRepositorySurface(path: string): RepositorySurface {
  const markdown = resolveMarkdownSkillCoverage(path);
  if (markdown) return { kind: 'markdown', skills: markdown.skills };
  if (isRepositoryTestModulePath(path)) return { kind: 'verification-test', skills: [] };
  const heuristicSkills = resolveRepositoryHeuristicSkills(path);
  if (heuristicSkills.length > 0) return { kind: 'heuristic-runtime', skills: heuristicSkills };
  if (/^src\//u.test(path)) return { kind: 'product-implementation', skills: [] };
  if (/^(?:package\.json|bun\.lock|bunfig\.toml|tsconfig\.json|\.bun-version|\.gitignore|\.gitattributes)$/u.test(path)) {
    return { kind: 'configuration', skills: [] };
  }
  return { kind: 'repository-content', skills: [] };
}

/**
 * Skill Applicability Decision.
 *
 * Runtime Skill selection is zero-or-one, trusted and operation-scoped. Path
 * coverage (`resolveMarkdownSkillCoverage` / `resolveRepositoryHeuristicSkills`)
 * is only a candidate hint and is never a runtime selector. The pure evaluator
 * below consumes an operation envelope plus trusted registry metadata and never
 * reads SKILL.md prose bytes, so candidate guidance can never expand machine
 * authorization.
 */

const SKILL_APPLICABILITY_STATUSES = [
  'applicable',
  'none-required',
  'ambiguous',
  'stale',
  'not-applicable',
  'unresolved'
] as const;

type SkillApplicabilityStatus = (typeof SKILL_APPLICABILITY_STATUSES)[number];

const SKILL_APPLICABILITY_SCHEMA = 'sec-skill-applicability-decision-v2' as const;

type SkillApplicabilityExclusionReason =
  | 'role-mismatch'
  | 'operation-kind-mismatch';

export function isAgentSkillId(value: unknown): value is AgentSkillId {
  return typeof value === 'string' && (AGENT_SKILL_IDS as readonly string[]).includes(value);
}

/**
 * Minimal machine metadata extracted from the real Skill registry. Prose
 * triggers remain agent guidance; only this table drives the machine decision.
 */
export interface AgentSkillMetadata {
  readonly id: AgentSkillId;
  readonly roles: readonly AgentRole[];
  readonly operationKinds: readonly TaskOperationKind[];
}

export const AGENT_SKILL_METADATA = {
  'architecture-evolution': {
    id: 'architecture-evolution',
    roles: ['a0', 'auditor', 'maintainer'],
    operationKinds: ['design']
  },
  'exact-head-review': {
    id: 'exact-head-review',
    roles: ['reviewer'],
    operationKinds: ['review']
  },
  'external-capability-governance': {
    id: 'external-capability-governance',
    roles: ['a0', 'maintainer'],
    operationKinds: ['govern']
  },
  'failure-recovery': {
    id: 'failure-recovery',
    roles: ['a0', 'worker', 'maintainer'],
    operationKinds: ['diagnose']
  },
  'heuristic-governance': {
    id: 'heuristic-governance',
    roles: ['a0', 'auditor', 'maintainer'],
    operationKinds: ['govern', 'design']
  },
  'repository-audit': {
    id: 'repository-audit',
    roles: ['auditor'],
    operationKinds: ['audit']
  },
  'task-delegation': {
    id: 'task-delegation',
    roles: ['a0'],
    operationKinds: ['govern', 'orient']
  },
  'test-design': {
    id: 'test-design',
    roles: ['a0'],
    operationKinds: ['design']
  },
  'worker-development': {
    id: 'worker-development',
    roles: ['worker'],
    operationKinds: ['implement']
  }
} as const satisfies Record<AgentSkillId, AgentSkillMetadata>;

/**
 * Candidate-quarantine surfaces: when a candidate changes these paths, the
 * applicability decision and any Review guidance bind the trusted base/main
 * revision; candidate bytes are only SUT differences and can never self-authorize.
 */
export const SKILL_QUARANTINE_EXACT_PATHS = [
  'AGENTS.md',
  'docs/开发/AI协作/规则装载与任务恢复.md'
] as const;

const SKILL_QUARANTINE_PATH_PREFIXES = [
  '.agents/',
  'docs/开发/AI协作/',
  'src/adapters/self-hosting/control/agent/',
  'scripts/codex/'
] as const;

export function isSkillQuarantinePath(path: string): boolean {
  return SKILL_QUARANTINE_EXACT_PATHS.includes(
    path as (typeof SKILL_QUARANTINE_EXACT_PATHS)[number]
  ) || SKILL_QUARANTINE_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

interface SkillApplicabilityTriggerEvidence {
  readonly skillId: AgentSkillId;
  readonly role: boolean;
  readonly operationKind: boolean;
}

interface SkillApplicabilityExclusionResult {
  readonly skillId: AgentSkillId;
  readonly reason: SkillApplicabilityExclusionReason;
}

export interface SkillApplicabilityDecision {
  readonly schema: typeof SKILL_APPLICABILITY_SCHEMA;
  readonly status: SkillApplicabilityStatus;
  readonly role: AgentRole | null;
  readonly operationKind: TaskOperationKind | null;
  readonly goalDigest: string;
  readonly trustedRevision: string;
  readonly targetCandidate: string;
  readonly workPackageProposalRef: string | null;
  readonly taskCapsuleRef: string | null;
  readonly taskCapsuleDigest: string | null;
  readonly taskCapsuleRevision: string | null;
  readonly candidateSkillIds: readonly AgentSkillId[];
  readonly selectedSkillId: AgentSkillId | null;
  readonly trustedSkillRevision: string | null;
  readonly candidateSkillRevision: string | null;
  readonly quarantinePaths: readonly string[];
  readonly triggerEvidence: readonly SkillApplicabilityTriggerEvidence[];
  readonly exclusionResults: readonly SkillApplicabilityExclusionResult[];
  readonly reasonCodes: readonly string[];
  readonly invalidationConditions: readonly string[];
}

export interface SkillApplicabilityEnvelope {
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
  readonly changedPaths?: readonly string[];
  readonly trustedSkillRevisions?: Readonly<Record<string, string>>;
  readonly candidateSkillRevisions?: Readonly<Record<string, string>>;
  readonly priorDecision?: SkillApplicabilityDecision;
}

function computeInvalidationConditions(
  prior: SkillApplicabilityDecision,
  input: SkillApplicabilityEnvelope
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
    const current = [...new Set((input.candidates ?? [...AGENT_SKILL_IDS]).filter(isAgentSkillId))];
    if (current.length !== priorSet.size || current.some((skillId) => !priorSet.has(skillId))) {
      conditions.push('candidate-set');
    }
  }
  return conditions;
}

function buildUnresolvedDecision(
  input: SkillApplicabilityEnvelope,
  reasonCode: string
): SkillApplicabilityDecision {
  return {
    schema: SKILL_APPLICABILITY_SCHEMA,
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
    reasonCodes: [reasonCode],
    invalidationConditions: []
  };
}

/**
 * Pure zero-or-one applicability decision (Issue #275). Reads only machine
 * metadata and the operation envelope; never reads Skill prose bytes.
 */
export function evaluateSkillApplicability(
  input: SkillApplicabilityEnvelope
): SkillApplicabilityDecision {
  const role = input.role;
  const operationKind = input.operationKind;
  if (!isAgentRole(role)) return buildUnresolvedDecision(input, 'unresolved-invalid-role');
  if (!isTaskOperationKind(operationKind)) {
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

  const prior = input.priorDecision;
  if (prior !== undefined && prior.schema === SKILL_APPLICABILITY_SCHEMA && prior.status !== 'stale') {
    const conditions = computeInvalidationConditions(prior, input);
    if (conditions.length > 0) {
      return {
        schema: SKILL_APPLICABILITY_SCHEMA,
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
        candidateSkillIds: [...new Set((input.candidates ?? [...AGENT_SKILL_IDS]).filter(isAgentSkillId))],
        selectedSkillId: null,
        trustedSkillRevision: null,
        candidateSkillRevision: null,
        quarantinePaths: [],
        triggerEvidence: [],
        exclusionResults: [],
        invalidationConditions: conditions,
        reasonCodes: ['stale']
      };
    }
  }

  const changedPaths = [...new Set(input.changedPaths ?? [])];
  const quarantinePaths = changedPaths.filter(isSkillQuarantinePath).sort();
  const quarantineActive = quarantinePaths.length > 0;

  const requested = [...(input.candidates ?? [...AGENT_SKILL_IDS])];
  const candidateSkillIds = [...new Set(requested.filter(isAgentSkillId))];
  const unknownCandidateCount = [...new Set(requested)].filter((candidate) => !isAgentSkillId(candidate)).length;

  const triggerEvidence: SkillApplicabilityTriggerEvidence[] = [];
  const exclusionResults: SkillApplicabilityExclusionResult[] = [];
  const survivors: AgentSkillId[] = [];

  for (const skillId of candidateSkillIds) {
    const skillMetadata = AGENT_SKILL_METADATA[skillId];
    const roleHit = (skillMetadata.roles as readonly AgentRole[]).includes(role);
    const kindHit = (
      skillMetadata.operationKinds as readonly TaskOperationKind[]
    ).includes(operationKind);
    triggerEvidence.push({ skillId, role: roleHit, operationKind: kindHit });
    if (!roleHit || !kindHit) {
      exclusionResults.push({
        skillId,
        reason: roleHit ? 'operation-kind-mismatch' : 'role-mismatch'
      });
      continue;
    }
    survivors.push(skillId);
  }

  const reasonCodes: string[] = [];
  if (quarantineActive) reasonCodes.push('candidate-quarantine', 'quarantine-binds-trusted-revision');
  if (unknownCandidateCount > 0) reasonCodes.push('unknown-candidate-ignored');

  let status: SkillApplicabilityStatus;
  let selectedSkillId: AgentSkillId | null = null;
  if (survivors.length === 0) {
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
    schema: SKILL_APPLICABILITY_SCHEMA,
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
    reasonCodes,
    invalidationConditions: []
  };
}
