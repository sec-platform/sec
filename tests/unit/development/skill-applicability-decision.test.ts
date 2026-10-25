import { expect, test } from 'bun:test';

import {
  AGENT_SKILL_IDS,
  AGENT_SKILL_METADATA,
  evaluateSkillApplicability,
  isAgentRole,
  isTaskCapsuleOperationKind,
  selectOperationAuthoritySourceRevision,
  type SkillApplicabilityEnvelope
} from '../../../src/adapters/self-hosting/control/agent/skill.ts';
import { TASK_CAPSULE_REVISION } from '../../../src/adapters/self-hosting/control/agent/task-capsule.ts';

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
  for (const skillId of AGENT_SKILL_IDS) {
    const metadata = AGENT_SKILL_METADATA[skillId];
    expect(metadata.id).toBe(skillId);
    expect(metadata.roles.length).toBeGreaterThan(0);
    for (const role of metadata.roles) expect(isAgentRole(role)).toBe(true);
    expect(metadata.operationKinds.length).toBeGreaterThan(0);
    for (const kind of metadata.operationKinds) expect(isTaskCapsuleOperationKind(kind)).toBe(true);
    expect(Object.keys(metadata).sort()).toEqual(['id', 'operationKinds', 'roles']);
  }
});

test('candidates filtered by metadata leaving none resolves none-required with exclusion evidence', () => {
  const decision = evaluateSkillApplicability(envelope({
    candidates: ['repository-audit']
  }));
  expect(decision.status).toBe('none-required');
  expect(decision.exclusionResults).toEqual([
    { skillId: 'repository-audit', reason: 'role-mismatch' }
  ]);
});

test('exactly one surviving candidate resolves applicable and selects it', () => {
  const decision = evaluateSkillApplicability(envelope({
    candidates: ['worker-development', 'repository-audit']
  }));
  expect(decision.status).toBe('applicable');
  expect(decision.selectedSkillId).toBe('worker-development');
  expect(decision.reasonCodes).toContain('applicable-selected');
  expect(decision.triggerEvidence).toEqual([
    { skillId: 'worker-development', role: true, operationKind: true },
    { skillId: 'repository-audit', role: false, operationKind: false }
  ]);
});

test('decision projects its binding and marks goal, role, operation and capsule changes stale', () => {
  const workPackageProposalRef = 'config/repository/work-packages/skill-applicability-gate-v1.md';
  const prior = evaluateSkillApplicability(envelope({
    workPackageProposalRef,
    candidates: ['worker-development'],
    taskCapsuleRef: 'capsule-1',
    taskCapsuleDigest: `sha256:${'a'.repeat(64)}`,
    taskCapsuleRevision: TASK_CAPSULE_REVISION
  }));
  expect(prior.status).toBe('applicable');
  expect(prior.selectedSkillId).toBe('worker-development');
  expect('scopeConflicts' in prior).toBeFalse();
  expect(prior.goalDigest).toBe('test-goal');
  expect(prior.trustedRevision).toBe(TRUSTED_REVISION);
  expect(prior.targetCandidate).toBe('feat/skill-applicability-gate-v1');
  expect(prior.workPackageProposalRef).toBe(
    'config/repository/work-packages/skill-applicability-gate-v1.md'
  );
  expect(prior.taskCapsuleRef).toBe('capsule-1');
  expect(prior.taskCapsuleDigest).toBe(`sha256:${'a'.repeat(64)}`);
  expect(prior.taskCapsuleRevision).toBe(TASK_CAPSULE_REVISION);
  expect(prior.candidateSkillIds).toEqual(['worker-development']);
  const stale = evaluateSkillApplicability(envelope({
    workPackageProposalRef,
    candidates: ['worker-development'],
    goalDigest: 'changed-goal',
    priorDecision: prior
  }));
  expect(stale.status).toBe('stale');
  expect(stale.selectedSkillId).toBeNull();
  expect(stale.invalidationConditions).toContain('goal-digest');
  expect(stale.reasonCodes).toEqual(['stale']);

  const roleStale = evaluateSkillApplicability(envelope({
    workPackageProposalRef,
    role: 'a0',
    operationKind: 'design',
    candidates: ['architecture-evolution'],
    priorDecision: prior
  }));
  expect(roleStale.status).toBe('stale');
  expect(roleStale.invalidationConditions).toEqual(
    expect.arrayContaining(['role', 'operation-kind', 'candidate-set'])
  );

  const capsuleStale = evaluateSkillApplicability(envelope({
    workPackageProposalRef,
    candidates: ['worker-development'],
    taskCapsuleRef: 'capsule-1',
    taskCapsuleDigest: `sha256:${'b'.repeat(64)}`,
    taskCapsuleRevision: TASK_CAPSULE_REVISION,
    priorDecision: prior
  }));
  expect(capsuleStale.status).toBe('stale');
  expect(capsuleStale.invalidationConditions).toContain('task-capsule-digest');
});

test('operation outside the Skill space resolves not-applicable', () => {
  const decision = evaluateSkillApplicability(envelope({
    operationKind: 'no-change',
    candidates: ['worker-development']
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

test('quarantined Skill guidance retains the metadata-selected decision', () => {
  const baseline = evaluateSkillApplicability(envelope({
    candidates: ['worker-development'],
    changedPaths: ['platform/shared/ci-contract.ts']
  }));
  const withSkillProse = evaluateSkillApplicability(envelope({
    candidates: ['worker-development'],
    changedPaths: ['.agents/skills/worker-development/SKILL.md'],
    trustedSkillRevisions: { '.agents/skills/worker-development/SKILL.md': 'prose-blob' },
    candidateSkillRevisions: { '.agents/skills/worker-development/SKILL.md': 'prose-blob' }
  }));
  expect(withSkillProse.status).toBe(baseline.status);
  expect(withSkillProse.selectedSkillId).toBe(baseline.selectedSkillId);
  expect(withSkillProse.quarantinePaths).toEqual([
    '.agents/skills/worker-development/SKILL.md'
  ]);
  expect(withSkillProse.reasonCodes).toEqual(
    expect.arrayContaining(['candidate-quarantine', 'quarantine-binds-trusted-revision'])
  );
});

test('unknown candidate IDs are ignored without breaking the decision', () => {
  const decision = evaluateSkillApplicability(envelope({
    candidates: ['worker-development', 'sec-not-a-real-skill']
  }));
  expect(decision.status).toBe('applicable');
  expect(decision.selectedSkillId).toBe('worker-development');
  expect(decision.candidateSkillIds).toEqual(['worker-development']);
  expect(decision.reasonCodes).toContain('unknown-candidate-ignored');
});

test('provider instruction candidates are quarantined without selecting a broader Skill', () => {
  for (const instruction of ['.codex/config.toml', '.codex/agents/implementation-worker.toml',
    '.codex/agents/custom-reviewer.toml', '.codex/custom-role.toml', '.codex/notes.txt']) {
    const decision = evaluateSkillApplicability(envelope({
      changedPaths: [instruction], candidates: ['worker-development'],
      trustedSkillRevisions: { [instruction]: 'trusted-role-blob' },
      candidateSkillRevisions: { [instruction]: 'candidate-role-blob' }
    }));
    expect(decision.quarantinePaths).toEqual([instruction]);
    expect(decision.trustedSkillRevision).toBe('trusted-role-blob');
    expect(decision.selectedSkillId).toBe('worker-development');
  }
  for (const unrelated of ['config/application.toml', '.codex-other/config.toml']) {
    expect(evaluateSkillApplicability(envelope({ changedPaths: [unrelated] })).quarantinePaths).toEqual([]);
  }
});

test('operation authority source selection keeps changed guidance trusted without freezing changed product specs', () => {
  const trustedRevision = '1'.repeat(40);
  const targetCandidate = '2'.repeat(40);
  const changedPaths = ['AGENTS.md', 'docs/开发/AI协作/规则装载与任务恢复.md',
    'docs/运行/权限与资源管理.md'];
  for (const [repositoryPath, expectedRevision] of [
    ['AGENTS.md', trustedRevision],
    ['docs/开发/AI协作/规则装载与任务恢复.md', trustedRevision],
    ['docs/运行/权限与资源管理.md', targetCandidate],
    ['docs/产品/产品要求与工作约束.md', trustedRevision]
  ] as const) {
    expect(selectOperationAuthoritySourceRevision({
      repositoryPath, changedPaths, trustedRevision, targetCandidate
    })).toBe(expectedRevision);
  }
});
