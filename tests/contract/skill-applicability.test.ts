import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { expect, test } from 'bun:test';

import {
  compileSecOperationReadPlanV1,
  projectSecSkillEnvelopeFromOperationReadPlanV1,
  SEC_OPERATION_READ_PLAN_INPUT_SCHEMA,
  SEC_TASK_CAPSULE_AUTHORITY_REVISION,
  SEC_TASK_CAPSULE_AUTHORITY_SCHEMA,
  type SecDigestV1,
  type SecOperationReadPlanInputV1,
  type SecTaskCapsuleAuthorityV1
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
import { sha256 } from '../../platform/shared/canonical-primitives.ts';

const REPOSITORY_ROOT = path.resolve(import.meta.dir, '../..');
const digest = (character: string): SecDigestV1 => `sha256:${character.repeat(64)}`;

function capsule(authority: SecTaskCapsuleAuthorityV1): SecOperationReadPlanInputV1['taskCapsule'] {
  const normalizedAuthority: SecTaskCapsuleAuthorityV1 = {
    ...authority,
    ownerFacts: [...authority.ownerFacts].sort((left, right) => left.id.localeCompare(right.id)),
    scope: {
      ...authority.scope,
      readPaths: [...authority.scope.readPaths].sort(),
      writePaths: [...authority.scope.writePaths].sort(),
      forbiddenPaths: [...authority.scope.forbiddenPaths].sort(),
      availableCapabilities: [...authority.scope.availableCapabilities].sort(),
      authorizedResources: [...authority.scope.authorizedResources].sort(),
      authorizedGates: [...authority.scope.authorizedGates].sort(),
      changedPaths: [...authority.scope.changedPaths].sort()
    },
    verificationObligations: [...authority.verificationObligations]
      .sort((left, right) => left.id.localeCompare(right.id)),
    skillCandidateIds: [...authority.skillCandidateIds].sort()
  };
  const projection = {
    schema: SEC_TASK_CAPSULE_AUTHORITY_SCHEMA,
    ref: 'urn:sec:task-capsule:skill-applicability-contract',
    revision: SEC_TASK_CAPSULE_AUTHORITY_REVISION,
    authority: normalizedAuthority
  };
  return { ...projection, digest: sha256(projection) as SecDigestV1 };
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
      workPackageAuthorizationRef: 'docs/work-packages/agent-operation-read-plan-v1.md',
      workPackageAuthorizationDigest: digest('c'),
      ownerFacts: [{
        id: 'development-governance',
        ref: 'docs/development-governance.md',
        owner: 'development-governance-owner',
        revision: 'owner-revision-v1'
      }],
      scope: {
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
    const trusted = gitOutput(['rev-parse', '--verify', `${envelope.trustedRevision}:${repositoryPath}`]);
    const candidate = gitOutput(['rev-parse', '--verify', `${envelope.targetCandidate}:${repositoryPath}`]);
    if (/^[0-9a-f]{40,64}$/u.test(trusted)) trustedSkillRevisions[repositoryPath] = trusted;
    if (/^[0-9a-f]{40,64}$/u.test(candidate)) candidateSkillRevisions[repositoryPath] = candidate;
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
    operationKind: 'govern',
    candidates: ['sec-work-package-lifecycle', 'sec-task-delegation'],
    writePaths: ['docs/work/', 'docs/work-packages/']
  }));
  expect(decision.status).toBe('ambiguous');
  expect(decision.selectedSkillId).toBeNull();
});

test('resource beyond frozen scope resolves conflict', () => {
  const decision = evaluatePlan(planInput({
    role: 'a0',
    operationKind: 'integrate',
    candidates: ['sec-ci-and-merge'],
    authorizedGates: ['hosted-gate']
  }));
  expect(decision.status).toBe('conflict');
  expect(decision.reasonCodes).toContain('conflict-resource');
});

test('candidate quarantine revisions are derived from exact Git objects', () => {
  const head = gitOutput(['rev-parse', 'HEAD']);
  const base = gitOutput(['rev-parse', 'HEAD^']);
  const decision = evaluatePlan(planInput({ base, head }));
  expect(decision.quarantinePaths).toEqual(expect.arrayContaining(['AGENTS.md']));
  expect(decision.reasonCodes).toEqual(
    expect.arrayContaining(['candidate-quarantine', 'quarantine-binds-trusted-revision'])
  );
});
