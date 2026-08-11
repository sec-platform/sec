import { expect, test } from 'bun:test';

import {
  evaluateSecSkillApplicabilityV1,
  isSecAgentRole,
  isSecAgentSkillId,
  isSecOperationKind,
  isSecSkillQuarantinePath,
  SEC_AGENT_SKILL_IDS,
  SEC_AGENT_SKILL_METADATA_V1,
  SEC_SKILL_APPLICABILITY_SCHEMA,
  SEC_SKILL_QUARANTINE_PATHS,
  type SecSkillApplicabilityEnvelopeV1
} from '../../platform/shared/agent-skill-contract.ts';

const TRUSTED_REVISION = '7543d37ad733432cbc2ddddd205c98f574e882c4';

function envelope(overrides: Partial<SecSkillApplicabilityEnvelopeV1> = {}): SecSkillApplicabilityEnvelopeV1 {
  return {
    role: 'worker',
    operationKind: 'implement',
    goalDigest: 'test-goal',
    trustedRevision: TRUSTED_REVISION,
    targetCandidate: 'feat/skill-applicability-gate-v1',
    availableCapabilities: ['git', 'github', 'hosted-gate'],
    ...overrides
  };
}

test('metadata table covers every registered Skill exactly once with valid vocabularies', () => {
  expect(Object.keys(SEC_AGENT_SKILL_METADATA_V1).sort()).toEqual([...SEC_AGENT_SKILL_IDS].sort());
  for (const skillId of SEC_AGENT_SKILL_IDS) {
    const metadata = SEC_AGENT_SKILL_METADATA_V1[skillId];
    expect(metadata.id).toBe(skillId);
    expect(metadata.roles.length).toBeGreaterThan(0);
    for (const role of metadata.roles) expect(isSecAgentRole(role)).toBe(true);
    expect(metadata.operationKinds.length).toBeGreaterThan(0);
    for (const kind of metadata.operationKinds) expect(isSecOperationKind(kind)).toBe(true);
    expect(metadata.supersededBy === null || isSecAgentSkillId(metadata.supersededBy)).toBe(true);
    for (const list of [
      metadata.requiredCapabilities,
      metadata.requiredResources,
      metadata.requiredGates,
      metadata.writeSurface
    ]) {
      expect(new Set(list).size).toBe(list.length);
    }
    for (const surface of metadata.writeSurface) {
      expect(surface.startsWith('/')).toBe(false);
      expect(surface.startsWith('./')).toBe(false);
      expect(surface.includes('\\')).toBe(false);
    }
  }
});

test('quarantine covers AGENTS, .agents, the registry, the CLI and the governance authority', () => {
  expect(SEC_SKILL_QUARANTINE_PATHS).toContain('AGENTS.md');
  expect(SEC_SKILL_QUARANTINE_PATHS).toContain('.agents/');
  expect(SEC_SKILL_QUARANTINE_PATHS).toContain('platform/shared/agent-operation-read-plan-contract.ts');
  expect(SEC_SKILL_QUARANTINE_PATHS).toContain('platform/shared/agent-skill-contract.ts');
  expect(SEC_SKILL_QUARANTINE_PATHS).toContain('scripts/codex/operation-read-plan.ts');
  expect(SEC_SKILL_QUARANTINE_PATHS).toContain('scripts/codex/skill-applicability.ts');
  expect(SEC_SKILL_QUARANTINE_PATHS).toContain('docs/development-governance.md');
  expect(isSecSkillQuarantinePath('AGENTS.md')).toBe(true);
  expect(isSecSkillQuarantinePath('.agents/skills/sec-worker-development/SKILL.md')).toBe(true);
  expect(isSecSkillQuarantinePath('platform/shared/agent-operation-read-plan-contract.ts')).toBe(true);
  expect(isSecSkillQuarantinePath('platform/shared/agent-skill-contract.ts')).toBe(true);
  expect(isSecSkillQuarantinePath('docs/development-governance.md')).toBe(true);
  expect(isSecSkillQuarantinePath('platform/shared/ci-contract.ts')).toBe(false);
  expect(isSecSkillQuarantinePath('docs/work/rolling-plan.md')).toBe(false);
});

test('zero candidates resolves none-required without synthesizing a catch-all Skill', () => {
  const decision = evaluateSecSkillApplicabilityV1(envelope({ candidates: [] }));
  expect(decision.schema).toBe(SEC_SKILL_APPLICABILITY_SCHEMA);
  expect(decision.status).toBe('none-required');
  expect(decision.selectedSkillId).toBeNull();
  expect(decision.reasonCodes).toContain('none-required');
  expect(decision.candidateSkillIds).toEqual([]);
});

test('candidates filtered by metadata leaving none resolves none-required with exclusion evidence', () => {
  const decision = evaluateSecSkillApplicabilityV1(envelope({
    candidates: ['sec-repository-audit']
  }));
  expect(decision.status).toBe('none-required');
  expect(decision.exclusionResults).toEqual([
    { skillId: 'sec-repository-audit', reason: 'role-mismatch' }
  ]);
});

test('exactly one surviving candidate resolves applicable and selects it', () => {
  const decision = evaluateSecSkillApplicabilityV1(envelope({
    candidates: ['sec-worker-development', 'sec-repository-audit']
  }));
  expect(decision.status).toBe('applicable');
  expect(decision.selectedSkillId).toBe('sec-worker-development');
  expect(decision.reasonCodes).toContain('applicable-selected');
  expect(decision.triggerEvidence).toEqual([
    { skillId: 'sec-worker-development', role: true, operationKind: true },
    { skillId: 'sec-repository-audit', role: false, operationKind: false }
  ]);
});

test('multiple surviving candidates without unique operation evidence resolve ambiguous', () => {
  const decision = evaluateSecSkillApplicabilityV1(envelope({
    role: 'a0',
    operationKind: 'govern',
    candidates: ['sec-work-package-lifecycle', 'sec-task-delegation']
  }));
  expect(decision.status).toBe('ambiguous');
  expect(decision.selectedSkillId).toBeNull();
  expect(decision.reasonCodes).toContain('ambiguous-multiple-candidates');
});

test('Skill requiring a forbidden write path resolves conflict and never selects', () => {
  const decision = evaluateSecSkillApplicabilityV1(envelope({
    role: 'maintainer',
    operationKind: 'govern',
    candidates: ['sec-documentation-governance'],
    forbiddenPaths: ['docs/']
  }));
  expect(decision.status).toBe('conflict');
  expect(decision.selectedSkillId).toBeNull();
  expect(decision.scopeConflicts).toEqual([
    { skillId: 'sec-documentation-governance', kind: 'write-path' }
  ]);
  expect(decision.reasonCodes).toContain('conflict-write-path');
});

test('Skill write surface beyond the authorized write paths resolves conflict', () => {
  const decision = evaluateSecSkillApplicabilityV1(envelope({
    role: 'maintainer',
    operationKind: 'govern',
    candidates: ['sec-documentation-governance'],
    authorizedWritePaths: ['AGENTS.md']
  }));
  expect(decision.status).toBe('conflict');
  expect(decision.reasonCodes).toContain('conflict-write-path');
});

test('any scope conflict fails closed even when another candidate would survive', () => {
  const decision = evaluateSecSkillApplicabilityV1(envelope({
    role: 'maintainer',
    operationKind: 'govern',
    candidates: ['sec-documentation-governance', 'sec-work-package-lifecycle'],
    forbiddenPaths: ['docs/']
  }));
  expect(decision.status).toBe('conflict');
  expect(decision.selectedSkillId).toBeNull();
  expect(decision.scopeConflicts).toEqual([
    { skillId: 'sec-documentation-governance', kind: 'write-path' }
  ]);
});

test('Skill requiring an unauthorized resource or Gate resolves conflict', () => {
  const resourceConflict = evaluateSecSkillApplicabilityV1(envelope({
    role: 'a0',
    operationKind: 'integrate',
    candidates: ['sec-ci-and-merge'],
    availableCapabilities: ['git', 'github', 'hosted-gate'],
    authorizedGates: ['hosted-gate']
  }));
  expect(resourceConflict.status).toBe('conflict');
  expect(resourceConflict.scopeConflicts).toEqual([
    { skillId: 'sec-ci-and-merge', kind: 'resource' }
  ]);

  const gateConflict = evaluateSecSkillApplicabilityV1(envelope({
    role: 'a0',
    operationKind: 'integrate',
    candidates: ['sec-ci-and-merge'],
    availableCapabilities: ['git', 'github', 'hosted-gate'],
    authorizedResources: ['github-api']
  }));
  expect(gateConflict.status).toBe('conflict');
  expect(gateConflict.scopeConflicts).toEqual([
    { skillId: 'sec-ci-and-merge', kind: 'gate' }
  ]);
});

test('missing required capability excludes the candidate before scope checks', () => {
  const decision = evaluateSecSkillApplicabilityV1(envelope({
    role: 'a0',
    operationKind: 'integrate',
    candidates: ['sec-ci-and-merge'],
    availableCapabilities: ['git', 'github'],
    authorizedResources: ['github-api'],
    authorizedGates: ['hosted-gate']
  }));
  expect(decision.status).toBe('none-required');
  expect(decision.exclusionResults).toEqual([
    { skillId: 'sec-ci-and-merge', reason: 'capability-unavailable' }
  ]);
});

test('goal, role, operation, capsule binding or trusted-revision change invalidates the prior decision as stale', () => {
  const prior = evaluateSecSkillApplicabilityV1(envelope({
    candidates: ['sec-worker-development'],
    taskCapsuleRef: 'capsule-1',
    taskCapsuleDigest: `sha256:${'a'.repeat(64)}`,
    taskCapsuleRevision: 'task-capsule-compiler-v1'
  }));
  expect(prior.status).toBe('applicable');
  const stale = evaluateSecSkillApplicabilityV1(envelope({
    candidates: ['sec-worker-development'],
    goalDigest: 'changed-goal',
    priorDecision: prior
  }));
  expect(stale.status).toBe('stale');
  expect(stale.selectedSkillId).toBeNull();
  expect(stale.invalidationConditions).toContain('goal-digest');
  expect(stale.reasonCodes).toEqual(['stale']);

  const roleStale = evaluateSecSkillApplicabilityV1(envelope({
    role: 'a0',
    operationKind: 'govern',
    candidates: ['sec-work-package-lifecycle'],
    priorDecision: prior
  }));
  expect(roleStale.status).toBe('stale');
  expect(roleStale.invalidationConditions).toEqual(
    expect.arrayContaining(['role', 'operation-kind', 'candidate-set'])
  );

  const capsuleStale = evaluateSecSkillApplicabilityV1(envelope({
    candidates: ['sec-worker-development'],
    taskCapsuleRef: 'capsule-1',
    taskCapsuleDigest: `sha256:${'b'.repeat(64)}`,
    taskCapsuleRevision: 'task-capsule-compiler-v1',
    priorDecision: prior
  }));
  expect(capsuleStale.status).toBe('stale');
  expect(capsuleStale.invalidationConditions).toContain('task-capsule-digest');
});

test('candidate touching a quarantine path binds trusted guidance and never self-authorizes', () => {
  const decision = evaluateSecSkillApplicabilityV1(envelope({
    candidates: ['sec-worker-development'],
    changedPaths: ['AGENTS.md', 'platform/shared/ci-contract.ts'],
    trustedSkillRevisions: { 'AGENTS.md': 'trusted-blob-a' },
    candidateSkillRevisions: { 'AGENTS.md': 'candidate-blob-b' }
  }));
  expect(decision.status).toBe('applicable');
  expect(decision.selectedSkillId).toBe('sec-worker-development');
  expect(decision.quarantinePaths).toEqual(['AGENTS.md']);
  expect(decision.trustedSkillRevision).toBe('trusted-blob-a');
  expect(decision.candidateSkillRevision).toBe('candidate-blob-b');
  expect(decision.reasonCodes).toEqual(
    expect.arrayContaining(['candidate-quarantine', 'quarantine-binds-trusted-revision'])
  );
});

test('superseded Skill is excluded even when its trigger and coverage would otherwise match', () => {
  const superseded = evaluateSecSkillApplicabilityV1(envelope({
    candidates: ['sec-worker-development'],
    metadataOverrides: {
      'sec-worker-development': {
        ...SEC_AGENT_SKILL_METADATA_V1['sec-worker-development'],
        supersededBy: 'sec-impact-and-validation'
      }
    }
  }));
  expect(superseded.status).toBe('none-required');
  expect(superseded.exclusionResults).toEqual([
    { skillId: 'sec-worker-development', reason: 'superseded' }
  ]);
});

test('operation outside the Skill space resolves not-applicable', () => {
  const decision = evaluateSecSkillApplicabilityV1(envelope({
    operationKind: 'no-change',
    candidates: ['sec-worker-development']
  }));
  expect(decision.status).toBe('not-applicable');
  expect(decision.selectedSkillId).toBeNull();
  expect(decision.reasonCodes).toContain('not-applicable-operation');
});

test('malformed envelopes resolve unresolved with reason codes', () => {
  const invalidRole = evaluateSecSkillApplicabilityV1(envelope({ role: 'root' }));
  expect(invalidRole.status).toBe('unresolved');
  expect(invalidRole.reasonCodes).toEqual(['unresolved-invalid-role']);

  const invalidKind = evaluateSecSkillApplicabilityV1(envelope({ operationKind: 'ship' }));
  expect(invalidKind.status).toBe('unresolved');
  expect(invalidKind.reasonCodes).toEqual(['unresolved-invalid-operation-kind']);

  const missingBinding = evaluateSecSkillApplicabilityV1(envelope({ trustedRevision: '' }));
  expect(missingBinding.status).toBe('unresolved');
  expect(missingBinding.reasonCodes).toEqual(['unresolved-missing-binding']);
});

test('Skill prose bytes never influence the machine decision', () => {
  const baseline = evaluateSecSkillApplicabilityV1(envelope({
    candidates: ['sec-worker-development'],
    changedPaths: ['platform/shared/ci-contract.ts']
  }));
  const withSkillProse = evaluateSecSkillApplicabilityV1(envelope({
    candidates: ['sec-worker-development'],
    changedPaths: ['.agents/skills/sec-worker-development/SKILL.md'],
    trustedSkillRevisions: { '.agents/skills/sec-worker-development/SKILL.md': 'prose-blob' },
    candidateSkillRevisions: { '.agents/skills/sec-worker-development/SKILL.md': 'prose-blob' }
  }));
  expect(withSkillProse.status).toBe(baseline.status);
  expect(withSkillProse.selectedSkillId).toBe(baseline.selectedSkillId);
  expect(withSkillProse.quarantinePaths).toEqual([
    '.agents/skills/sec-worker-development/SKILL.md'
  ]);
  expect(withSkillProse.reasonCodes).toEqual(
    expect.arrayContaining(['candidate-quarantine', 'quarantine-binds-trusted-revision'])
  );
});

test('decision V1 binds every required field', () => {
  const decision = evaluateSecSkillApplicabilityV1(envelope({
    candidates: ['sec-worker-development'],
    workPackageAuthorizationRef: 'docs/work-packages/skill-applicability-gate-v1.md',
    taskCapsuleRef: 'capsule-1',
    taskCapsuleDigest: `sha256:${'a'.repeat(64)}`,
    taskCapsuleRevision: 'task-capsule-compiler-v1'
  }));
  expect(decision.goalDigest).toBe('test-goal');
  expect(decision.trustedRevision).toBe(TRUSTED_REVISION);
  expect(decision.targetCandidate).toBe('feat/skill-applicability-gate-v1');
  expect(decision.workPackageAuthorizationRef).toBe(
    'docs/work-packages/skill-applicability-gate-v1.md'
  );
  expect(decision.taskCapsuleRef).toBe('capsule-1');
  expect(decision.taskCapsuleDigest).toBe(`sha256:${'a'.repeat(64)}`);
  expect(decision.taskCapsuleRevision).toBe('task-capsule-compiler-v1');
  expect(decision.candidateSkillIds).toEqual(['sec-worker-development']);
  expect(decision.capabilityAvailability.git).toBe(true);
});

test('unknown candidate IDs are ignored without breaking the decision', () => {
  const decision = evaluateSecSkillApplicabilityV1(envelope({
    candidates: ['sec-worker-development', 'sec-not-a-real-skill']
  }));
  expect(decision.status).toBe('applicable');
  expect(decision.selectedSkillId).toBe('sec-worker-development');
  expect(decision.candidateSkillIds).toEqual(['sec-worker-development']);
  expect(decision.reasonCodes).toContain('unknown-candidate-ignored');
});
