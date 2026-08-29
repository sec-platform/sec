import { expect, test } from 'bun:test';

import {
  evaluateSecSkillApplicability,
  isSecAgentRole,
  isSecAgentSkillId,
  isSecOperationKind,
  SEC_AGENT_SKILL_IDS,
  SEC_AGENT_SKILL_METADATA,
  SEC_SKILL_APPLICABILITY_SCHEMA,
  type SecSkillApplicabilityEnvelope
} from '../../src/control/agent/skill.ts';

const TRUSTED_REVISION = '7543d37ad733432cbc2ddddd205c98f574e882c4';

function envelope(overrides: Partial<SecSkillApplicabilityEnvelope> = {}): SecSkillApplicabilityEnvelope {
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
  for (const skillId of SEC_AGENT_SKILL_IDS) {
    const metadata = SEC_AGENT_SKILL_METADATA[skillId];
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

test('zero candidates resolves none-required without synthesizing a catch-all Skill', () => {
  const decision = evaluateSecSkillApplicability(envelope({ candidates: [] }));
  expect(decision.status).toBe('none-required');
  expect(decision.selectedSkillId).toBeNull();
  expect(decision.reasonCodes).toContain('none-required');
  expect(decision.candidateSkillIds).toEqual([]);
});

test('candidates filtered by metadata leaving none resolves none-required with exclusion evidence', () => {
  const decision = evaluateSecSkillApplicability(envelope({
    candidates: ['sec-repository-audit']
  }));
  expect(decision.status).toBe('none-required');
  expect(decision.exclusionResults).toEqual([
    { skillId: 'sec-repository-audit', reason: 'role-mismatch' }
  ]);
});

test('exactly one surviving candidate resolves applicable and selects it', () => {
  const decision = evaluateSecSkillApplicability(envelope({
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
  const decision = evaluateSecSkillApplicability(envelope({
    role: 'a0',
    operationKind: 'design',
    candidates: ['sec-architecture-evolution', 'sec-heuristic-governance']
  }));
  expect(decision.status).toBe('ambiguous');
  expect(decision.selectedSkillId).toBeNull();
  expect(decision.reasonCodes).toContain('ambiguous-multiple-candidates');
});

test('Skill requiring a forbidden write path resolves conflict and never selects', () => {
  const decision = evaluateSecSkillApplicability(envelope({
    role: 'maintainer',
    operationKind: 'design',
    candidates: ['sec-architecture-evolution'],
    forbiddenPaths: ['docs/']
  }));
  expect(decision.status).toBe('conflict');
  expect(decision.selectedSkillId).toBeNull();
  expect(decision.scopeConflicts).toEqual([
    { skillId: 'sec-architecture-evolution', kind: 'write-path' }
  ]);
  expect(decision.reasonCodes).toContain('conflict-write-path');
});

test('Skill write surface beyond the authorized write paths resolves conflict', () => {
  const decision = evaluateSecSkillApplicability(envelope({
    role: 'maintainer',
    operationKind: 'design',
    candidates: ['sec-architecture-evolution'],
    authorizedWritePaths: ['AGENTS.md']
  }));
  expect(decision.status).toBe('conflict');
  expect(decision.reasonCodes).toContain('conflict-write-path');
});

test('any scope conflict fails closed even when another candidate would survive', () => {
  const decision = evaluateSecSkillApplicability(envelope({
    role: 'a0',
    operationKind: 'design',
    candidates: ['sec-architecture-evolution', 'sec-heuristic-governance'],
    forbiddenPaths: ['docs/']
  }));
  expect(decision.status).toBe('conflict');
  expect(decision.selectedSkillId).toBeNull();
  expect(decision.scopeConflicts).toEqual([
    { skillId: 'sec-architecture-evolution', kind: 'write-path' }
  ]);
});

test('Skill requiring an unauthorized resource or Gate resolves conflict', () => {
  const resourceConflict = evaluateSecSkillApplicability(envelope({
    candidates: ['sec-worker-development'],
    availableCapabilities: ['git', 'github', 'hosted-gate'],
    authorizedGates: ['hosted-gate'],
    metadataOverrides: {
      'sec-worker-development': {
        ...SEC_AGENT_SKILL_METADATA['sec-worker-development'],
        requiredResources: ['github-api']
      }
    }
  }));
  expect(resourceConflict.status).toBe('conflict');
  expect(resourceConflict.scopeConflicts).toEqual([
    { skillId: 'sec-worker-development', kind: 'resource' }
  ]);

  const gateConflict = evaluateSecSkillApplicability(envelope({
    candidates: ['sec-worker-development'],
    availableCapabilities: ['git', 'github', 'hosted-gate'],
    authorizedResources: ['github-api'],
    metadataOverrides: {
      'sec-worker-development': {
        ...SEC_AGENT_SKILL_METADATA['sec-worker-development'],
        requiredGates: ['hosted-gate']
      }
    }
  }));
  expect(gateConflict.status).toBe('conflict');
  expect(gateConflict.scopeConflicts).toEqual([
    { skillId: 'sec-worker-development', kind: 'gate' }
  ]);
});

test('missing required capability excludes the candidate before scope checks', () => {
  const decision = evaluateSecSkillApplicability(envelope({
    candidates: ['sec-worker-development'],
    availableCapabilities: ['git'],
    metadataOverrides: {
      'sec-worker-development': {
        ...SEC_AGENT_SKILL_METADATA['sec-worker-development'],
        requiredCapabilities: ['git', 'hosted-gate']
      }
    }
  }));
  expect(decision.status).toBe('none-required');
  expect(decision.exclusionResults).toEqual([
    { skillId: 'sec-worker-development', reason: 'capability-unavailable' }
  ]);
});

test('goal, role, operation, capsule binding or trusted-revision change invalidates the prior decision as stale', () => {
  const prior = evaluateSecSkillApplicability(envelope({
    candidates: ['sec-worker-development'],
    taskCapsuleRef: 'capsule-1',
    taskCapsuleDigest: `sha256:${'a'.repeat(64)}`,
    taskCapsuleRevision: 'task-capsule-compiler-v1'
  }));
  expect(prior.status).toBe('applicable');
  const stale = evaluateSecSkillApplicability(envelope({
    candidates: ['sec-worker-development'],
    goalDigest: 'changed-goal',
    priorDecision: prior
  }));
  expect(stale.status).toBe('stale');
  expect(stale.selectedSkillId).toBeNull();
  expect(stale.invalidationConditions).toContain('goal-digest');
  expect(stale.reasonCodes).toEqual(['stale']);

  const roleStale = evaluateSecSkillApplicability(envelope({
    role: 'a0',
    operationKind: 'design',
    candidates: ['sec-architecture-evolution'],
    priorDecision: prior
  }));
  expect(roleStale.status).toBe('stale');
  expect(roleStale.invalidationConditions).toEqual(
    expect.arrayContaining(['role', 'operation-kind', 'candidate-set'])
  );

  const capsuleStale = evaluateSecSkillApplicability(envelope({
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
  const decision = evaluateSecSkillApplicability(envelope({
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
  const superseded = evaluateSecSkillApplicability(envelope({
    candidates: ['sec-worker-development'],
    metadataOverrides: {
      'sec-worker-development': {
        ...SEC_AGENT_SKILL_METADATA['sec-worker-development'],
        supersededBy: 'sec-failure-recovery'
      }
    }
  }));
  expect(superseded.status).toBe('none-required');
  expect(superseded.exclusionResults).toEqual([
    { skillId: 'sec-worker-development', reason: 'superseded' }
  ]);
});

test('operation outside the Skill space resolves not-applicable', () => {
  const decision = evaluateSecSkillApplicability(envelope({
    operationKind: 'no-change',
    candidates: ['sec-worker-development']
  }));
  expect(decision.status).toBe('not-applicable');
  expect(decision.selectedSkillId).toBeNull();
  expect(decision.reasonCodes).toContain('not-applicable-operation');
});

test('malformed envelopes resolve unresolved with reason codes', () => {
  const invalidRole = evaluateSecSkillApplicability(envelope({ role: 'root' }));
  expect(invalidRole.status).toBe('unresolved');
  expect(invalidRole.reasonCodes).toEqual(['unresolved-invalid-role']);

  const invalidKind = evaluateSecSkillApplicability(envelope({ operationKind: 'ship' }));
  expect(invalidKind.status).toBe('unresolved');
  expect(invalidKind.reasonCodes).toEqual(['unresolved-invalid-operation-kind']);

  const missingBinding = evaluateSecSkillApplicability(envelope({ trustedRevision: '' }));
  expect(missingBinding.status).toBe('unresolved');
  expect(missingBinding.reasonCodes).toEqual(['unresolved-missing-binding']);
});

test('Skill prose bytes never influence the machine decision', () => {
  const baseline = evaluateSecSkillApplicability(envelope({
    candidates: ['sec-worker-development'],
    changedPaths: ['platform/shared/ci-contract.ts']
  }));
  const withSkillProse = evaluateSecSkillApplicability(envelope({
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
  const decision = evaluateSecSkillApplicability(envelope({
    candidates: ['sec-worker-development'],
    workPackageProposalRef: 'docs/work-packages/skill-applicability-gate-v1.md',
    taskCapsuleRef: 'capsule-1',
    taskCapsuleDigest: `sha256:${'a'.repeat(64)}`,
    taskCapsuleRevision: 'task-capsule-compiler-v1'
  }));
  expect(decision.goalDigest).toBe('test-goal');
  expect(decision.trustedRevision).toBe(TRUSTED_REVISION);
  expect(decision.targetCandidate).toBe('feat/skill-applicability-gate-v1');
  expect(decision.workPackageProposalRef).toBe(
    'docs/work-packages/skill-applicability-gate-v1.md'
  );
  expect(decision.taskCapsuleRef).toBe('capsule-1');
  expect(decision.taskCapsuleDigest).toBe(`sha256:${'a'.repeat(64)}`);
  expect(decision.taskCapsuleRevision).toBe('task-capsule-compiler-v1');
  expect(decision.candidateSkillIds).toEqual(['sec-worker-development']);
  expect(decision.capabilityAvailability.git).toBe(true);
});

test('unknown candidate IDs are ignored without breaking the decision', () => {
  const decision = evaluateSecSkillApplicability(envelope({
    candidates: ['sec-worker-development', 'sec-not-a-real-skill']
  }));
  expect(decision.status).toBe('applicable');
  expect(decision.selectedSkillId).toBe('sec-worker-development');
  expect(decision.candidateSkillIds).toEqual(['sec-worker-development']);
  expect(decision.reasonCodes).toContain('unknown-candidate-ignored');
});
