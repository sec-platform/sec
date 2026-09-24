import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { expect, test } from 'bun:test';

import {
  compileSecOperationReadPlan,
  projectSecSkillEnvelopeFromOperationReadPlan,
  SEC_OPERATION_READ_PLAN_INPUT_SCHEMA,
  type SecOperationReadPlanInput
} from '../../src/adapters/self-hosting/control/agent/read-plan.ts';
import {
  evaluateSkillApplicability,
  isSkillQuarantinePath,
  SEC_SKILL_QUARANTINE_EXACT_PATHS,
  type AgentRole,
  type AgentSkillId,
  type TaskOperationKind,
  type SkillApplicabilityDecision
} from '../../src/adapters/self-hosting/control/agent/skill.ts';
import {
  compileTaskCapsule,
  TASK_CAPSULE_INPUT_SCHEMA,
  type SecDigest,
  type TaskCapsulePlanningContext
} from '../../src/adapters/self-hosting/control/agent/task-capsule.ts';

const REPOSITORY_ROOT = path.resolve(import.meta.dir, '../..');
const digest = (character: string): SecDigest => `sha256:${character.repeat(64)}`;

function capsule(planningContext: TaskCapsulePlanningContext): SecOperationReadPlanInput['taskCapsule'] {
  return compileTaskCapsule({
    schema: TASK_CAPSULE_INPUT_SCHEMA,
    ref: 'urn:sec:task-capsule:skill-applicability-contract',
    planningContext
  });
}

function gitOutput(args: readonly string[]): string {
  const result = spawnSync('git', args, {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

function gitOutputOrNull(args: readonly string[]): string | null {
  const result = spawnSync('git', args, {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
    windowsHide: true
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

function gitNulPaths(args: readonly string[]): string[] {
  const result = spawnSync('git', args, {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.split('\0').filter((entry) => entry.length > 0);
}

function changedPaths(base: string, head: string): string[] {
  return [...new Set(gitNulPaths(['diff', '--name-only', '-z', base, head]))].sort();
}

function planInput(overrides: {
  role?: AgentRole;
  operationKind?: TaskOperationKind;
  candidates?: readonly AgentSkillId[];
  authorizedResources?: readonly string[];
  authorizedGates?: readonly string[];
  writePaths?: readonly string[];
  forbiddenPaths?: readonly string[];
  base?: string;
  head?: string;
} = {}): SecOperationReadPlanInput {
  const head = overrides.head ?? gitOutput(['rev-parse', 'HEAD']);
  const base = overrides.base ?? head;
  const candidates = overrides.candidates ?? ['sec-worker-development'];
  const observedChangedPaths = changedPaths(base, head);
  return {
    schema: SEC_OPERATION_READ_PLAN_INPUT_SCHEMA,
    taskCapsule: capsule({
      operationId: 'skill-applicability-contract',
      role: overrides.role ?? 'worker',
      operationKind: overrides.operationKind ?? 'implement',
      goalDigest: digest('b'),
      trustedRevision: base,
      targetCandidate: head,
      workPackageProposalRef: 'config/repository/work-packages/task-capsule-compiler-v1.md',
      workPackageProposalDigest: digest('c'),
      workPackageProjectionId: digest('e'),
      scopeGrantId: null,
      ownerFacts: [{
        id: 'development-governance',
        ref: 'docs/开发/AI协作/规则装载与任务恢复.md',
        owner: 'development-governance-owner',
        revision: 'owner-revision-v1'
      }],
      scopeProposal: {
        readPaths: ['docs/开发/AI协作/规则装载与任务恢复.md'],
        writePaths: overrides.writePaths ?? (observedChangedPaths.length > 0
          ? observedChangedPaths
          : ['platform/shared/']),
        forbiddenPaths: overrides.forbiddenPaths ?? [],
        authorizedResources: overrides.authorizedResources ?? [],
        authorizedGates: overrides.authorizedGates ?? [],
        changedPaths: observedChangedPaths
      },
      verificationObligations: [],
      skillCandidateIds: candidates
    }),
    requiredRefs: [{
      id: 'development-governance',
      ref: 'docs/开发/AI协作/规则装载与任务恢复.md',
      owner: 'development-governance-owner',
      revision: 'owner-revision-v1',
      reasonCode: 'canonical-operation-owner',
      projection: null
    }],
    conditionalRefs: [],
    forbiddenSources: [
      'assistant-memory',
      'chat-history',
      'full-issue-census',
      'full-skill-corpus',
      'historical-pr-comments',
      'unrelated-issue-census'
    ],
    maxSkillBodies: candidates.length === 0 ? 0 : 1,
    unresolvedFrontier: [],
    readReceipts: [],
    invalidationInputs: []
  };
}

function evaluatePlan(input: SecOperationReadPlanInput): SkillApplicabilityDecision {
  const plan = compileSecOperationReadPlan(input);
  const envelope = projectSecSkillEnvelopeFromOperationReadPlan(plan);
  const trustedSkillRevisions: Record<string, string> = {};
  const candidateSkillRevisions: Record<string, string> = {};
  for (const repositoryPath of (envelope.changedPaths ?? []).filter(isSkillQuarantinePath)) {
    const trusted = gitOutputOrNull(['rev-parse', '--verify', `${envelope.trustedRevision}:${repositoryPath}`]);
    const candidate = gitOutputOrNull(['rev-parse', '--verify', `${envelope.targetCandidate}:${repositoryPath}`]);
    if (trusted !== null && /^[0-9a-f]{40,64}$/u.test(trusted)) {
      trustedSkillRevisions[repositoryPath] = trusted;
    }
    if (candidate !== null && /^[0-9a-f]{40,64}$/u.test(candidate)) {
      candidateSkillRevisions[repositoryPath] = candidate;
    }
  }
  const decision = evaluateSkillApplicability({
    ...envelope,
    trustedSkillRevisions,
    candidateSkillRevisions
  });
  return decision;
}

test('verified Read Plan selects the single trusted Skill', () => {
  const decision = evaluatePlan(planInput());
  expect(decision.status).toBe('applicable');
  expect(decision.selectedSkillId).toBe('sec-worker-development');
});

test('zero candidates and zero body budget resolve none-required', () => {
  const decision = evaluatePlan(planInput({ candidates: [] }));
  expect(decision.status).toBe('none-required');
  expect(decision.selectedSkillId).toBeNull();
});

test('multiple surviving metadata candidates resolve ambiguous before any body read', () => {
  const decision = evaluatePlan(planInput({
    role: 'a0',
    operationKind: 'design',
    candidates: ['sec-architecture-evolution', 'sec-heuristic-governance'],
    writePaths: []
  }));
  expect(decision.status).toBe('ambiguous');
  expect(decision.selectedSkillId).toBeNull();
});

test('Skill selection remains orthogonal to Task Capsule write and resource authority', () => {
  const decision = evaluatePlan(planInput({
    role: 'a0',
    operationKind: 'design',
    candidates: ['sec-architecture-evolution'],
    writePaths: [],
    forbiddenPaths: ['docs/'],
    authorizedResources: ['github-api'],
    authorizedGates: ['hosted-gate']
  }));
  expect(decision.status).toBe('applicable');
  expect(decision.selectedSkillId).toBe('sec-architecture-evolution');
  expect('scopeConflicts' in decision).toBeFalse();
});

test('candidate quarantine revisions are derived from exact Git objects', () => {
  const repositoryPath = SEC_SKILL_QUARANTINE_EXACT_PATHS[0];
  const historicalQuarantine = {
    repositoryPath,
    head: gitOutputOrNull(['log', '-1', '--format=%H', '--', repositoryPath])
  };
  if (!historicalQuarantine || historicalQuarantine.head === null) {
    throw new Error('No quarantined source has Git history');
  }
  const { head } = historicalQuarantine;
  const base = gitOutput(['rev-parse', `${head}^`]);
  const decision = evaluatePlan(planInput({ base, head }));
  expect(decision.quarantinePaths).toEqual(expect.arrayContaining([
    repositoryPath
  ]));
  expect(decision.reasonCodes).toEqual(
    expect.arrayContaining(['candidate-quarantine', 'quarantine-binds-trusted-revision'])
  );
});
