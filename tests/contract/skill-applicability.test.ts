import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { expect, test } from 'bun:test';

import {
  compileSecOperationReadPlanV1,
  projectSecSkillEnvelopeFromOperationReadPlanV1,
  SEC_OPERATION_READ_PLAN_INPUT_SCHEMA,
  type SecOperationReadPlanInputV1
} from '../../platform/shared/agent-operation-read-plan-contract.ts';
import {
  evaluateSecSkillApplicabilityV1,
  isSecSkillQuarantinePath,
  SEC_SKILL_APPLICABILITY_SCHEMA,
  type SecAgentRole,
  type SecAgentSkillId,
  type SecOperationKind,
  type SecSkillApplicabilityDecisionV1
} from '../../platform/shared/agent-skill-contract.ts';
import {
  compileSecTaskCapsuleV1,
  SEC_TASK_CAPSULE_INPUT_SCHEMA,
  type SecDigestV1,
  type SecTaskCapsulePlanningContextV1
} from '../../platform/shared/agent-task-capsule-contract.ts';

const REPOSITORY_ROOT = path.resolve(import.meta.dir, '../..');
const digest = (character: string): SecDigestV1 => `sha256:${character.repeat(64)}`;

function capsule(planningContext: SecTaskCapsulePlanningContextV1): SecOperationReadPlanInputV1['taskCapsule'] {
  return compileSecTaskCapsuleV1({
    schema: SEC_TASK_CAPSULE_INPUT_SCHEMA,
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

function changedPaths(base: string, head: string): string[] {
  const source = gitOutput(['diff', '--name-status', base, head]);
  return [...new Set(source.split(/\r?\n/u).filter(Boolean)
    .flatMap((line) => line.split('\t').slice(1)))].sort();
}

function planInput(overrides: {
  role?: SecAgentRole;
  operationKind?: SecOperationKind;
  candidates?: readonly SecAgentSkillId[];
  availableCapabilities?: readonly string[];
  authorizedResources?: readonly string[];
  authorizedGates?: readonly string[];
  writePaths?: readonly string[];
  forbiddenPaths?: readonly string[];
  base?: string;
  head?: string;
} = {}): SecOperationReadPlanInputV1 {
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
      workPackageProposalRef: 'docs/work-packages/task-capsule-compiler-v1.md',
      workPackageProposalDigest: digest('c'),
      workPackageProjectionId: digest('e'),
      scopeGrantId: null,
      ownerFacts: [{
        id: 'development-governance',
        ref: 'docs/development-governance.md',
        owner: 'development-governance-owner',
        revision: 'owner-revision-v1'
      }],
      scopeProposal: {
        readPaths: ['docs/development-governance.md'],
        writePaths: overrides.writePaths ?? (observedChangedPaths.length > 0
          ? observedChangedPaths
          : ['platform/shared/']),
        forbiddenPaths: overrides.forbiddenPaths ?? [],
        availableCapabilities: overrides.availableCapabilities ?? ['git', 'github', 'hosted-gate'],
        authorizedResources: overrides.authorizedResources ?? [],
        authorizedGates: overrides.authorizedGates ?? [],
        changedPaths: observedChangedPaths
      },
      verificationObligations: [],
      skillCandidateIds: candidates
    }),
    requiredRefs: [{
      id: 'development-governance',
      ref: 'docs/development-governance.md',
      owner: 'development-governance-owner',
      revision: 'owner-revision-v1',
      reasonCode: 'canonical-operation-owner'
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

function evaluatePlan(input: SecOperationReadPlanInputV1): SecSkillApplicabilityDecisionV1 {
  const plan = compileSecOperationReadPlanV1(input);
  const envelope = projectSecSkillEnvelopeFromOperationReadPlanV1(plan);
  const trustedSkillRevisions: Record<string, string> = {};
  const candidateSkillRevisions: Record<string, string> = {};
  for (const repositoryPath of (envelope.changedPaths ?? []).filter(isSecSkillQuarantinePath)) {
    const trusted = gitOutputOrNull(['rev-parse', '--verify', `${envelope.trustedRevision}:${repositoryPath}`]);
    const candidate = gitOutputOrNull(['rev-parse', '--verify', `${envelope.targetCandidate}:${repositoryPath}`]);
    if (trusted !== null && /^[0-9a-f]{40,64}$/u.test(trusted)) {
      trustedSkillRevisions[repositoryPath] = trusted;
    }
    if (candidate !== null && /^[0-9a-f]{40,64}$/u.test(candidate)) {
      candidateSkillRevisions[repositoryPath] = candidate;
    }
  }
  const decision = evaluateSecSkillApplicabilityV1({
    ...envelope,
    trustedSkillRevisions,
    candidateSkillRevisions
  });
  expect(decision.schema).toBe(SEC_SKILL_APPLICABILITY_SCHEMA);
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
    writePaths: ['.agents/skills/', 'AGENTS.md', 'docs/', 'platform/shared/agent-skill-contract.ts']
  }));
  expect(decision.status).toBe('ambiguous');
  expect(decision.selectedSkillId).toBeNull();
});

test('Skill write surface beyond frozen scope resolves conflict', () => {
  const decision = evaluatePlan(planInput({
    role: 'a0',
    operationKind: 'design',
    candidates: ['sec-architecture-evolution'],
    forbiddenPaths: ['docs/']
  }));
  expect(decision.status).toBe('conflict');
  expect(decision.reasonCodes).toContain('conflict-write-path');
});

test('candidate quarantine revisions are derived from exact Git objects', () => {
  const head = gitOutput([
    'log', '-1', '--format=%H', '--', 'platform/shared/agent-skill-contract.ts'
  ]);
  const base = gitOutput(['rev-parse', `${head}^`]);
  const decision = evaluatePlan(planInput({ base, head }));
  expect(decision.quarantinePaths).toEqual(expect.arrayContaining([
    'platform/shared/agent-skill-contract.ts'
  ]));
  expect(decision.reasonCodes).toEqual(
    expect.arrayContaining(['candidate-quarantine', 'quarantine-binds-trusted-revision'])
  );
});
