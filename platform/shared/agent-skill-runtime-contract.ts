import { rawSha256 } from './canonical-primitives.ts';
import {
  SEC_AGENT_SKILL_IDS,
  type SecAgentSkillId,
  type SecSkillApplicabilityDecisionV1
} from './agent-skill-contract.ts';
import type { SecDigestV1 } from './agent-task-capsule-contract.ts';

export const SEC_SKILL_RUNTIME_POLICY_SCHEMA_V1 = 'sec-skill-runtime-policy-v1' as const;
export const SEC_SKILL_GUIDANCE_SCHEMA_V1 = 'sec-skill-guidance-v1' as const;
export const SEC_SKILL_GUIDANCE_PROJECTION_SCHEMA_V1 =
  'sec-skill-guidance-projection-v1' as const;

/**
 * Common policy for every SEC Skill body. Applicability and Read Plan remain
 * separate owners; this contract only governs the final zero-or-one guidance
 * read and the semantic limits of that guidance.
 */
export const SEC_SKILL_RUNTIME_POLICY_V1 = Object.freeze({
  schema: SEC_SKILL_RUNTIME_POLICY_SCHEMA_V1,
  preApplicabilitySkillBodiesRead: 0 as const,
  maxSkillBodiesPerOperationEpoch: 1 as const,
  bodySource: 'exact-trusted-git-object' as const,
  inputAdmission: 'operation-read-plan-only' as const,
  authorityReferenceSemantics: 'precedence-only-not-auto-read' as const,
  toolCapabilitySemantics: 'operation-authority-only' as const,
  effectAuthority: 'none' as const,
  deterministicTransitions: 'machine-owner-only' as const
});

export const SEC_SKILL_JUDGMENT_OWNERS_V1 = {
  'sec-architecture-evolution': 'architecture-choice',
  'sec-exact-head-review': 'exact-head-adversarial-review',
  'sec-external-capability-governance': 'external-capability-choice',
  'sec-failure-recovery': 'root-cause-classification',
  'sec-heuristic-governance': 'heuristic-classification',
  'sec-repository-audit': 'repository-causal-audit',
  'sec-task-delegation': 'delegation-benefit',
  'sec-worker-development': 'implementation-choice'
} as const satisfies Record<SecAgentSkillId, string>;

export type SecSkillJudgmentId =
  (typeof SEC_SKILL_JUDGMENT_OWNERS_V1)[SecAgentSkillId];

export interface SecSkillGuidanceV1 {
  readonly schema: typeof SEC_SKILL_GUIDANCE_SCHEMA_V1;
  readonly runtimePolicy: typeof SEC_SKILL_RUNTIME_POLICY_SCHEMA_V1;
  readonly skillId: SecAgentSkillId;
  readonly judgmentId: SecSkillJudgmentId;
  readonly readPlanDigest: SecDigestV1;
  readonly readPlanRefId: string;
  readonly trustedRevision: string;
  readonly repositoryPath: `.agents/skills/${SecAgentSkillId}/SKILL.md`;
  readonly blobRevision: string;
  readonly contentDigest: `sha256:${string}`;
  readonly effectAuthority: 'none';
  readonly source: string;
}

export interface SecSkillGuidanceProjectionV1 {
  readonly schema: typeof SEC_SKILL_GUIDANCE_PROJECTION_SCHEMA_V1;
  readonly runtimePolicy: typeof SEC_SKILL_RUNTIME_POLICY_SCHEMA_V1;
  readonly decision: SecSkillApplicabilityDecisionV1;
  readonly guidance: SecSkillGuidanceV1 | null;
}

function fail(message: string): never {
  throw new Error(`SEC Skill Runtime V1: ${message}`);
}

function exactGitObject(value: string, label: string): string {
  if (!/^[0-9a-f]{40,64}$/u.test(value)) fail(`${label} must be one exact lowercase Git object id.`);
  return value;
}

function token(value: string, label: string): string {
  if (!/^[a-z0-9][a-z0-9._:/-]*$/u.test(value)) fail(`${label} must be one canonical token.`);
  return value;
}

export function secSkillRepositoryPathV1(
  skillId: SecAgentSkillId
): `.agents/skills/${SecAgentSkillId}/SKILL.md` {
  if (!SEC_AGENT_SKILL_IDS.includes(skillId)) fail(`unknown Skill id: ${skillId}`);
  return `.agents/skills/${skillId}/SKILL.md`;
}

export function createSecSkillGuidanceV1(input: Readonly<{
  decision: SecSkillApplicabilityDecisionV1;
  readPlanDigest: SecDigestV1;
  readPlanRefId: string;
  repositoryPath: string;
  blobRevision: string;
  source: string;
}>): SecSkillGuidanceV1 {
  if (input.decision.status !== 'applicable' || input.decision.selectedSkillId === null) {
    fail('guidance may be created only for one applicable selected Skill.');
  }
  const skillId = input.decision.selectedSkillId;
  const repositoryPath = secSkillRepositoryPathV1(skillId);
  if (input.repositoryPath !== repositoryPath) {
    fail(`guidance path does not match selected Skill ${skillId}.`);
  }
  if (!/^sha256:[0-9a-f]{64}$/u.test(input.readPlanDigest)) {
    fail('readPlanDigest must be one lowercase SHA-256 digest.');
  }
  const readPlanRefId = token(input.readPlanRefId, 'readPlanRefId');
  const trustedRevision = exactGitObject(input.decision.trustedRevision, 'trustedRevision');
  const blobRevision = exactGitObject(input.blobRevision, 'blobRevision');
  if (typeof input.source !== 'string' || input.source.length === 0 || input.source.length > 128 * 1024) {
    fail('Skill source must be one bounded nonempty text body.');
  }
  if (input.source.includes('\0') || input.source.includes('\r')) {
    fail('Skill source must be canonical LF text without NUL.');
  }
  if (!input.source.startsWith('---\n') || !input.source.includes(`\nname: ${skillId}\n`)) {
    fail('Skill source frontmatter does not bind the selected Skill identity.');
  }
  return Object.freeze({
    schema: SEC_SKILL_GUIDANCE_SCHEMA_V1,
    runtimePolicy: SEC_SKILL_RUNTIME_POLICY_SCHEMA_V1,
    skillId,
    judgmentId: SEC_SKILL_JUDGMENT_OWNERS_V1[skillId],
    readPlanDigest: input.readPlanDigest,
    readPlanRefId,
    trustedRevision,
    repositoryPath,
    blobRevision,
    contentDigest: rawSha256(input.source),
    effectAuthority: 'none',
    source: input.source
  });
}

export function createSecSkillGuidanceProjectionV1(input: Readonly<{
  decision: SecSkillApplicabilityDecisionV1;
  guidance: SecSkillGuidanceV1 | null;
}>): SecSkillGuidanceProjectionV1 {
  const applicable = input.decision.status === 'applicable'
    && input.decision.selectedSkillId !== null;
  if (applicable !== (input.guidance !== null)) {
    fail('guidance presence must exactly match one applicable selected Skill.');
  }
  if (input.guidance !== null) {
    if (input.guidance.skillId !== input.decision.selectedSkillId
        || input.guidance.trustedRevision !== input.decision.trustedRevision) {
      fail('guidance identity differs from applicability decision.');
    }
  }
  return Object.freeze({
    schema: SEC_SKILL_GUIDANCE_PROJECTION_SCHEMA_V1,
    runtimePolicy: SEC_SKILL_RUNTIME_POLICY_SCHEMA_V1,
    decision: input.decision,
    guidance: input.guidance
  });
}
