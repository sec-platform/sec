import { createHash } from 'node:crypto';

import { z } from 'zod';

import { SEC_AGENT_SKILL_IDS, type SecAgentSkillId } from './agent-skill-contract.ts';

export const SEC_AGENT_ROLES = [
  'integrator', 'worker', 'reviewer', 'auditor', 'maintainer'
] as const;

export const SEC_AGENT_OPERATIONS = [
  'orient', 'reconcile', 'plan', 'audit', 'design', 'implement', 'review',
  'validate', 'recover', 'delegate', 'integrate', 'govern', 'resume'
] as const;

export const SEC_AGENT_CAPABILITIES = [
  'repository-read', 'repository-write', 'github-read', 'github-write',
  'verification-read', 'verification-run', 'merge', 'network-read',
  'toolchain-write', 'agent-spawn', 'control-plane-write', 'archive-write'
] as const;

export const SEC_SKILL_APPLICABILITY_STATUSES = [
  'applicable', 'none-required', 'ambiguous', 'stale', 'conflict', 'not-applicable'
] as const;

export const SEC_CANDIDATE_STATES = ['none', 'draft', 'frozen', 'merged'] as const;

export type SecAgentRole = typeof SEC_AGENT_ROLES[number];
export type SecAgentOperation = typeof SEC_AGENT_OPERATIONS[number];
export type SecAgentCapability = typeof SEC_AGENT_CAPABILITIES[number];
export type SecSkillApplicabilityStatus = typeof SEC_SKILL_APPLICABILITY_STATUSES[number];
export type SecCandidateState = typeof SEC_CANDIDATE_STATES[number];
export type SecSkillAccess = 'read-only' | 'write' | 'either';

export type SecAgentSkillApplicabilityProfile = Readonly<{
  roles: readonly SecAgentRole[];
  operations: readonly SecAgentOperation[];
  access: SecSkillAccess;
  candidateStates: readonly SecCandidateState[];
  requiresCompleteEnvelope: boolean;
  requiresIndependentActor: boolean;
  requiredCapabilities: readonly SecAgentCapability[];
}>;

const p = (
  roles: readonly SecAgentRole[],
  operations: readonly SecAgentOperation[],
  access: SecSkillAccess,
  candidateStates: readonly SecCandidateState[],
  requiredCapabilities: readonly SecAgentCapability[],
  options: Readonly<{
    complete?: boolean;
    independent?: boolean;
  }> = {}
): SecAgentSkillApplicabilityProfile => ({
  roles,
  operations,
  access,
  candidateStates,
  requiresCompleteEnvelope: options.complete ?? false,
  requiresIndependentActor: options.independent ?? false,
  requiredCapabilities
});

const ALL_ROLES = SEC_AGENT_ROLES;
const ALL_STATES = SEC_CANDIDATE_STATES;

export const SEC_AGENT_SKILL_APPLICABILITY_PROFILES = {
  'sec-a0-integrator': p(
    ['integrator'], ['reconcile', 'plan', 'integrate'], 'either',
    ['none', 'draft', 'frozen'], ['repository-read', 'github-read']
  ),
  'sec-architecture-evolution': p(
    ['integrator', 'auditor', 'maintainer'], ['design'], 'either',
    ['none', 'draft'], ['repository-read']
  ),
  'sec-ci-and-merge': p(
    ['integrator'], ['integrate'], 'write', ['frozen'],
    ['repository-read', 'github-read', 'github-write', 'verification-read', 'verification-run', 'merge'],
    { complete: true }
  ),
  'sec-context-resume': p(ALL_ROLES, ['resume'], 'either', ALL_STATES, ['repository-read']),
  'sec-documentation-governance': p(
    ['worker', 'maintainer'], ['implement', 'govern'], 'write', ['none', 'draft'],
    ['repository-read', 'repository-write'], { complete: true }
  ),
  'sec-exact-head-review': p(
    ['reviewer', 'auditor'], ['review'], 'read-only', ['frozen'],
    ['repository-read', 'github-read', 'verification-read'],
    { complete: true, independent: true }
  ),
  'sec-external-capability-governance': p(
    ['integrator', 'auditor', 'maintainer'], ['audit', 'design', 'govern'], 'either',
    ['none', 'draft'], ['repository-read', 'network-read']
  ),
  'sec-failure-recovery': p(
    ALL_ROLES, ['recover'], 'either', ['none', 'draft', 'frozen'],
    ['repository-read', 'verification-read']
  ),
  'sec-heuristic-governance': p(
    ['auditor', 'maintainer'], ['audit', 'implement', 'govern'], 'either',
    ['none', 'draft'], ['repository-read'], { complete: true }
  ),
  'sec-impact-and-validation': p(
    ['worker', 'reviewer', 'auditor', 'maintainer'], ['validate'], 'read-only',
    ['none', 'draft', 'frozen'], ['repository-read', 'verification-read', 'verification-run']
  ),
  'sec-repository-audit': p(
    ['auditor'], ['audit'], 'read-only', ['none', 'draft', 'frozen'],
    ['repository-read', 'github-read']
  ),
  'sec-repository-orientation': p(
    ALL_ROLES, ['orient'], 'read-only', ALL_STATES, ['repository-read', 'github-read']
  ),
  'sec-task-delegation': p(
    ['integrator'], ['delegate'], 'write', ['none', 'draft'],
    ['repository-read', 'agent-spawn', 'control-plane-write'], { complete: true }
  ),
  'sec-toolchain-and-dependencies': p(
    ['worker', 'maintainer'], ['implement', 'govern'], 'write', ['none', 'draft'],
    ['repository-read', 'repository-write', 'toolchain-write'], { complete: true }
  ),
  'sec-trust-root-bootstrap': p(
    ['integrator', 'reviewer', 'auditor'], ['review', 'validate', 'integrate'], 'either',
    ['frozen'], ['repository-read', 'github-read', 'verification-read'], { complete: true }
  ),
  'sec-work-package-lifecycle': p(
    ['integrator'], ['plan', 'govern', 'integrate'], 'write', ['none', 'draft', 'frozen'],
    ['repository-read', 'repository-write', 'control-plane-write', 'archive-write'],
    { complete: true }
  ),
  'sec-worker-development': p(
    ['worker', 'maintainer'], ['implement'], 'write', ['draft'],
    ['repository-read', 'repository-write', 'verification-run'], { complete: true }
  )
} as const satisfies Record<SecAgentSkillId, SecAgentSkillApplicabilityProfile>;

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;
const CleanTextSchema = z.string().min(1).refine(
  (value) => value.trim() === value && !CONTROL_CHARACTER.test(value),
  { message: 'must be trimmed and contain no control characters' }
);
const ShaSchema = z.string().regex(/^[0-9a-f]{40}$/u);
const DigestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const SkillIdSchema = z.enum(SEC_AGENT_SKILL_IDS);
const RoleSchema = z.enum(SEC_AGENT_ROLES);
const OperationSchema = z.enum(SEC_AGENT_OPERATIONS);
const CapabilitySchema = z.enum(SEC_AGENT_CAPABILITIES);
const CandidateStateSchema = z.enum(SEC_CANDIDATE_STATES);

function uniqueArray<T>(item: z.ZodType<T>, label: string) {
  return z.array(item).superRefine((values, context) => {
    if (new Set(values).size !== values.length) {
      context.addIssue({ code: 'custom', message: `${label} must contain unique values` });
    }
  });
}

const AssessmentSchema = z.object({
  triggerEvidence: uniqueArray(CleanTextSchema, 'triggerEvidence'),
  exclusionChecks: uniqueArray(CleanTextSchema, 'exclusionChecks'),
  excluded: z.boolean()
}).strict();

const SelectionShape = {
  envelopeComplete: z.boolean(),
  actorIndependent: z.boolean(),
  candidateSkillIds: uniqueArray(SkillIdSchema, 'candidateSkillIds'),
  candidateAssessments: z.record(z.string(), AssessmentSchema),
  grantedCapabilities: uniqueArray(CapabilitySchema, 'grantedCapabilities'),
  trustedSkillBlobs: z.record(z.string(), ShaSchema),
  authorityConflicts: uniqueArray(CleanTextSchema, 'authorityConflicts'),
  scopeConflicts: uniqueArray(CleanTextSchema, 'scopeConflicts'),
  candidateModifiesSkillControlPlane: z.boolean()
} as const;

const RequestSchema = z.object({
  schema: z.literal('sec-skill-applicability-request-v1'),
  repository: CleanTextSchema,
  trustedRevision: ShaSchema,
  targetRevision: ShaSchema,
  role: RoleSchema,
  operation: OperationSchema,
  goalDigest: DigestSchema,
  envelopeDigest: DigestSchema,
  writeIntent: z.boolean(),
  candidateState: CandidateStateSchema,
  ...SelectionShape,
  selectionDigest: DigestSchema
}).strict();

export type SecSkillCandidateAssessment = z.infer<typeof AssessmentSchema>;
export type SecSkillApplicabilityRequest = z.infer<typeof RequestSchema>;
export type SecSkillSelectionInput = Pick<
  SecSkillApplicabilityRequest,
  keyof typeof SelectionShape
>;
export type SecSkillApplicabilityBinding = Pick<
  SecSkillApplicabilityRequest,
  | 'repository'
  | 'trustedRevision'
  | 'targetRevision'
  | 'role'
  | 'operation'
  | 'goalDigest'
  | 'envelopeDigest'
  | 'writeIntent'
  | 'candidateState'
  | 'selectionDigest'
>;

export type SecSkillApplicabilityDecision = SecSkillApplicabilityBinding & Readonly<{
  schema: 'sec-skill-applicability-decision-v1';
  status: SecSkillApplicabilityStatus;
  selectedSkillId: SecAgentSkillId | null;
  trustedSkillBlob: string | null;
  guidanceRevision: string;
  candidateModifiesSkillControlPlane: boolean;
  reasons: readonly string[];
  triggerEvidence: readonly string[];
  exclusionChecks: readonly string[];
  expiresOn: readonly [
    'trusted-revision-change',
    'target-revision-change',
    'goal-change',
    'envelope-change',
    'role-change',
    'operation-change',
    'write-intent-change',
    'candidate-state-change',
    'selection-input-change'
  ];
}>;

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function canonicalJson(value: unknown): string {
  const normalize = (input: unknown): JsonValue => {
    if (input === null || typeof input === 'boolean' || typeof input === 'string') return input;
    if (typeof input === 'number' && Number.isFinite(input)) return input;
    if (Array.isArray(input)) return input.map(normalize);
    if (typeof input === 'object') {
      return Object.fromEntries(
        Object.entries(input as Record<string, unknown>)
          .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
          .map(([key, nested]) => [key, normalize(nested)])
      );
    }
    throw new Error(`Skill applicability cannot canonicalize ${typeof input}.`);
  };
  return JSON.stringify(normalize(value));
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function canonicalSelection(input: SecSkillSelectionInput): SecSkillSelectionInput {
  return {
    ...input,
    candidateSkillIds: [...input.candidateSkillIds].sort(),
    grantedCapabilities: [...input.grantedCapabilities].sort(),
    authorityConflicts: [...input.authorityConflicts].sort(),
    scopeConflicts: [...input.scopeConflicts].sort(),
    candidateAssessments: Object.fromEntries(
      Object.entries(input.candidateAssessments)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([skillId, assessment]) => [skillId, {
          ...assessment,
          triggerEvidence: [...assessment.triggerEvidence].sort(),
          exclusionChecks: [...assessment.exclusionChecks].sort()
        }])
    ),
    trustedSkillBlobs: Object.fromEntries(
      Object.entries(input.trustedSkillBlobs)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    )
  };
}

export function computeSecSkillSelectionDigest(input: SecSkillSelectionInput): string {
  return sha256(canonicalJson(canonicalSelection(input)));
}

function selectionInput(request: SecSkillApplicabilityRequest): SecSkillSelectionInput {
  return Object.fromEntries(
    Object.keys(SelectionShape).map((key) => [
      key,
      request[key as keyof typeof SelectionShape]
    ])
  ) as SecSkillSelectionInput;
}

export function parseSecSkillApplicabilityRequest(input: unknown): SecSkillApplicabilityRequest {
  const result = RequestSchema.safeParse(input);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Skill applicability request invalid: ${details}`);
  }
  const request = result.data;
  const candidateSet = new Set<SecAgentSkillId>(request.candidateSkillIds);
  for (const key of [
    ...Object.keys(request.candidateAssessments),
    ...Object.keys(request.trustedSkillBlobs)
  ]) {
    if (!SEC_AGENT_SKILL_IDS.includes(key as SecAgentSkillId)) {
      throw new Error(`Skill applicability request contains unknown Skill key ${key}.`);
    }
    if (!candidateSet.has(key as SecAgentSkillId)) {
      throw new Error(`Skill applicability request contains non-candidate Skill key ${key}.`);
    }
  }
  const expectedDigest = computeSecSkillSelectionDigest(selectionInput(request));
  if (request.selectionDigest !== expectedDigest) {
    throw new Error('Skill applicability request selectionDigest does not match selection inputs.');
  }
  return request;
}

function mismatchReasons(
  skillId: SecAgentSkillId,
  request: SecSkillApplicabilityRequest
): string[] {
  const profile = SEC_AGENT_SKILL_APPLICABILITY_PROFILES[skillId];
  const assessment = request.candidateAssessments[skillId];
  const reasons: string[] = [];
  if (!assessment) reasons.push(`${skillId}:missing-trigger-assessment`);
  else {
    if (assessment.triggerEvidence.length === 0) reasons.push(`${skillId}:missing-trigger-evidence`);
    if (assessment.exclusionChecks.length === 0) reasons.push(`${skillId}:missing-exclusion-checks`);
    if (assessment.excluded) reasons.push(`${skillId}:excluded`);
  }
  if (!profile.roles.includes(request.role)) reasons.push(`${skillId}:role`);
  if (!profile.operations.includes(request.operation)) reasons.push(`${skillId}:operation`);
  if (profile.access === 'read-only' && request.writeIntent) reasons.push(`${skillId}:write-intent`);
  if (profile.access === 'write' && !request.writeIntent) reasons.push(`${skillId}:read-only-operation`);
  if (!profile.candidateStates.includes(request.candidateState)) reasons.push(`${skillId}:candidate-state`);
  if (profile.requiresCompleteEnvelope && !request.envelopeComplete) {
    reasons.push(`${skillId}:incomplete-envelope`);
  }
  if (profile.requiresIndependentActor && !request.actorIndependent) {
    reasons.push(`${skillId}:actor-not-independent`);
  }
  const granted = new Set(request.grantedCapabilities);
  for (const capability of profile.requiredCapabilities) {
    if (!granted.has(capability)) reasons.push(`${skillId}:missing-capability:${capability}`);
  }
  return reasons;
}

const EXPIRES_ON: SecSkillApplicabilityDecision['expiresOn'] = [
  'trusted-revision-change',
  'target-revision-change',
  'goal-change',
  'envelope-change',
  'role-change',
  'operation-change',
  'write-intent-change',
  'candidate-state-change',
  'selection-input-change'
];

function decision(
  request: SecSkillApplicabilityRequest,
  status: SecSkillApplicabilityStatus,
  selectedSkillId: SecAgentSkillId | null,
  reasons: readonly string[]
): SecSkillApplicabilityDecision {
  const assessment = selectedSkillId ? request.candidateAssessments[selectedSkillId] : undefined;
  return {
    schema: 'sec-skill-applicability-decision-v1',
    repository: request.repository,
    trustedRevision: request.trustedRevision,
    targetRevision: request.targetRevision,
    role: request.role,
    operation: request.operation,
    goalDigest: request.goalDigest,
    envelopeDigest: request.envelopeDigest,
    writeIntent: request.writeIntent,
    candidateState: request.candidateState,
    selectionDigest: request.selectionDigest,
    status,
    selectedSkillId,
    trustedSkillBlob: selectedSkillId ? request.trustedSkillBlobs[selectedSkillId] ?? null : null,
    guidanceRevision: request.trustedRevision,
    candidateModifiesSkillControlPlane: request.candidateModifiesSkillControlPlane,
    reasons: [...new Set(reasons)].sort(),
    triggerEvidence: assessment ? [...new Set(assessment.triggerEvidence)].sort() : [],
    exclusionChecks: assessment ? [...new Set(assessment.exclusionChecks)].sort() : [],
    expiresOn: EXPIRES_ON
  };
}

export function evaluateSecSkillApplicability(input: unknown): SecSkillApplicabilityDecision {
  const request = parseSecSkillApplicabilityRequest(input);
  const globalConflicts = [
    ...request.authorityConflicts.map((item) => `authority:${item}`),
    ...request.scopeConflicts.map((item) => `scope:${item}`)
  ].sort();
  if (globalConflicts.length > 0) return decision(request, 'conflict', null, globalConflicts);

  if (request.candidateSkillIds.length === 0) {
    if (!request.writeIntent || request.envelopeComplete) {
      return decision(request, 'none-required', null, [
        request.writeIntent
          ? 'complete-envelope-without-extra-guidance'
          : 'read-only-operation-without-extra-guidance'
      ]);
    }
    return decision(
      request,
      'not-applicable',
      null,
      ['write-operation-requires-complete-envelope-or-applicable-skill']
    );
  }

  const applicable: SecAgentSkillId[] = [];
  const mismatches: string[] = [];
  for (const skillId of request.candidateSkillIds) {
    const reasons = mismatchReasons(skillId, request);
    if (reasons.length === 0) applicable.push(skillId);
    else mismatches.push(...reasons);
  }
  if (applicable.length > 1) {
    return decision(
      request,
      'ambiguous',
      null,
      applicable.map((skillId) => `applicable:${skillId}`)
    );
  }
  if (applicable.length === 0) return decision(request, 'not-applicable', null, mismatches);

  const selectedSkillId = applicable[0]!;
  if (!request.trustedSkillBlobs[selectedSkillId]) {
    return decision(request, 'conflict', null, [`missing-trusted-skill-blob:${selectedSkillId}`]);
  }
  return decision(request, 'applicable', selectedSkillId, [
    request.candidateModifiesSkillControlPlane
      ? 'candidate-guidance-quarantined;trusted-base-guidance-selected'
      : 'trusted-base-guidance-selected'
  ]);
}

export function revalidateSecSkillApplicabilityDecision(
  previous: SecSkillApplicabilityDecision,
  current: SecSkillApplicabilityBinding
): SecSkillApplicabilityDecision {
  const mismatches: string[] = [];
  for (const key of [
    'repository',
    'trustedRevision',
    'targetRevision',
    'role',
    'operation',
    'goalDigest',
    'envelopeDigest',
    'writeIntent',
    'candidateState',
    'selectionDigest'
  ] as const) {
    if (previous[key] !== current[key]) mismatches.push(`changed:${key}`);
  }
  if (mismatches.length === 0) return previous;
  return {
    ...previous,
    ...current,
    status: 'stale',
    selectedSkillId: null,
    trustedSkillBlob: null,
    reasons: mismatches.sort()
  };
}
