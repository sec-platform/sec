import { expect, test } from 'bun:test';

import {
  evaluateSkillApplicability,
  isAgentRole,
  isTaskOperationKind,
  SEC_AGENT_SKILL_IDS,
  SEC_AGENT_SKILL_METADATA,
  type SkillApplicabilityEnvelope
} from '../../src/adapters/self-hosting/control/agent/skill.ts';
import { TASK_CAPSULE_REVISION } from '../../src/adapters/self-hosting/control/agent/task-capsule.ts';

const TRUSTED_REVISION = '7543d37ad733432cbc2ddddd205c98f574e882c4';

function envelope(overrides: Partial<SkillApplicabilityEnvelope> = {}): SkillApplicabilityEnvelope {
  return {
    role: 'worker',
    operationKind: 'implement',
    goalDigest: 'test-goal',
    trustedRevision: TRUSTED_REVISION,
    targetCandidate: 'feat/skill-applicability-gate-v1',
    ...overrides
  };
}

test('metadata table covers every registered Skill exactly once with valid vocabularies', () => {
  for (const skillId of SEC_AGENT_SKILL_IDS) {
    const metadata = SEC_AGENT_SKILL_METADATA[skillId];
    expect(metadata.id).toBe(skillId);
    expect(metadata.roles.length).toBeGreaterThan(0);
    for (const role of metadata.roles) expect(isAgentRole(role)).toBe(true);
    expect(metadata.operationKinds.length).toBeGreaterThan(0);
    for (const kind of metadata.operationKinds) expect(isTaskOperationKind(kind)).toBe(true);
    expect(Object.keys(metadata).sort()).toEqual(['id', 'operationKinds', 'roles']);
  }
});

test('zero candidates resolves none-required without synthesizing a catch-all Skill', () => {
  const decision = evaluateSkillApplicability(envelope({ candidates: [] }));
  expect(decision.status).toBe('none-required');
  expect(decision.selectedSkillId).toBeNull();
  expect(decision.reasonCodes).toContain('none-required');
  expect(decision.candidateSkillIds).toEqual([]);
});

test('candidates filtered by metadata leaving none resolves none-required with exclusion evidence', () => {
  const decision = evaluateSkillApplicability(envelope({
    candidates: ['sec-repository-audit']
  }));
  expect(decision.status).toBe('none-required');
  expect(decision.exclusionResults).toEqual([
    { skillId: 'sec-repository-audit', reason: 'role-mismatch' }
  ]);
});

test('exactly one surviving candidate resolves applicable and selects it', () => {
  const decision = evaluateSkillApplicability(envelope({
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
  const decision = evaluateSkillApplicability(envelope({
    role: 'a0',
    operationKind: 'design',
    candidates: ['sec-architecture-evolution', 'sec-heuristic-governance']
  }));
  expect(decision.status).toBe('ambiguous');
  expect(decision.selectedSkillId).toBeNull();
  expect(decision.reasonCodes).toContain('ambiguous-multiple-candidates');
});

test('Skill selection carries no resource, Gate, write-scope or replacement authority', () => {
  const metadata = SEC_AGENT_SKILL_METADATA['sec-worker-development'];
  expect(Object.keys(metadata).sort()).toEqual(['id', 'operationKinds', 'roles']);

  const decision = evaluateSkillApplicability(envelope({
    candidates: ['sec-worker-development']
  }));
  expect(decision.status).toBe('applicable');
  expect(decision.selectedSkillId).toBe('sec-worker-development');
  expect('scopeConflicts' in decision).toBeFalse();
});

test('goal, role, operation, capsule binding or trusted-revision change invalidates the prior decision as stale', () => {
  const prior = evaluateSkillApplicability(envelope({
    candidates: ['sec-worker-development'],
    taskCapsuleRef: 'capsule-1',
    taskCapsuleDigest: `sha256:${'a'.repeat(64)}`,
    taskCapsuleRevision: TASK_CAPSULE_REVISION
  }));
  expect(prior.status).toBe('applicable');
  const stale = evaluateSkillApplicability(envelope({
    candidates: ['sec-worker-development'],
    goalDigest: 'changed-goal',
    priorDecision: prior
  }));
  expect(stale.status).toBe('stale');
  expect(stale.selectedSkillId).toBeNull();
  expect(stale.invalidationConditions).toContain('goal-digest');
  expect(stale.reasonCodes).toEqual(['stale']);

  const roleStale = evaluateSkillApplicability(envelope({
    role: 'a0',
    operationKind: 'design',
    candidates: ['sec-architecture-evolution'],
    priorDecision: prior
  }));
  expect(roleStale.status).toBe('stale');
  expect(roleStale.invalidationConditions).toEqual(
    expect.arrayContaining(['role', 'operation-kind', 'candidate-set'])
  );

  const capsuleStale = evaluateSkillApplicability(envelope({
    candidates: ['sec-worker-development'],
    taskCapsuleRef: 'capsule-1',
    taskCapsuleDigest: `sha256:${'b'.repeat(64)}`,
    taskCapsuleRevision: TASK_CAPSULE_REVISION,
    priorDecision: prior
  }));
  expect(capsuleStale.status).toBe('stale');
  expect(capsuleStale.invalidationConditions).toContain('task-capsule-digest');
});

test('candidate touching a quarantine path binds trusted guidance and never self-authorizes', () => {
  const decision = evaluateSkillApplicability(envelope({
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

test('operation outside the Skill space resolves not-applicable', () => {
  const decision = evaluateSkillApplicability(envelope({
    operationKind: 'no-change',
    candidates: ['sec-worker-development']
  }));
  expect(decision.status).toBe('not-applicable');
  expect(decision.selectedSkillId).toBeNull();
  expect(decision.reasonCodes).toContain('not-applicable-operation');
});

test('malformed envelopes resolve unresolved with reason codes', () => {
  const invalidRole = evaluateSkillApplicability(envelope({ role: 'root' }));
  expect(invalidRole.status).toBe('unresolved');
  expect(invalidRole.reasonCodes).toEqual(['unresolved-invalid-role']);

  const invalidKind = evaluateSkillApplicability(envelope({ operationKind: 'ship' }));
  expect(invalidKind.status).toBe('unresolved');
  expect(invalidKind.reasonCodes).toEqual(['unresolved-invalid-operation-kind']);

  const missingBinding = evaluateSkillApplicability(envelope({ trustedRevision: '' }));
  expect(missingBinding.status).toBe('unresolved');
  expect(missingBinding.reasonCodes).toEqual(['unresolved-missing-binding']);
});

test('Skill prose bytes never influence the machine decision', () => {
  const baseline = evaluateSkillApplicability(envelope({
    candidates: ['sec-worker-development'],
    changedPaths: ['platform/shared/ci-contract.ts']
  }));
  const withSkillProse = evaluateSkillApplicability(envelope({
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

test('decision binds the operation and trusted guidance identity', () => {
  const decision = evaluateSkillApplicability(envelope({
    candidates: ['sec-worker-development'],
    workPackageProposalRef: 'config/repository/work-packages/skill-applicability-gate-v1.md',
    taskCapsuleRef: 'capsule-1',
    taskCapsuleDigest: `sha256:${'a'.repeat(64)}`,
    taskCapsuleRevision: TASK_CAPSULE_REVISION
  }));
  expect(decision.goalDigest).toBe('test-goal');
  expect(decision.trustedRevision).toBe(TRUSTED_REVISION);
  expect(decision.targetCandidate).toBe('feat/skill-applicability-gate-v1');
  expect(decision.workPackageProposalRef).toBe(
    'config/repository/work-packages/skill-applicability-gate-v1.md'
  );
  expect(decision.taskCapsuleRef).toBe('capsule-1');
  expect(decision.taskCapsuleDigest).toBe(`sha256:${'a'.repeat(64)}`);
  expect(decision.taskCapsuleRevision).toBe(TASK_CAPSULE_REVISION);
  expect(decision.candidateSkillIds).toEqual(['sec-worker-development']);
});

test('unknown candidate IDs are ignored without breaking the decision', () => {
  const decision = evaluateSkillApplicability(envelope({
    candidates: ['sec-worker-development', 'sec-not-a-real-skill']
  }));
  expect(decision.status).toBe('applicable');
  expect(decision.selectedSkillId).toBe('sec-worker-development');
  expect(decision.candidateSkillIds).toEqual(['sec-worker-development']);
  expect(decision.reasonCodes).toContain('unknown-candidate-ignored');
});
