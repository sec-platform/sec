import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { expect, test } from 'bun:test';

import {
  compileSecOperationReadPlanV1,
  SEC_OPERATION_READ_CLOSURE_REQUEST_SCHEMA,
  SEC_OPERATION_READ_PLAN_INPUT_SCHEMA,
  type SecOperationReadPlanInputV1,
  type SecOperationReadPlanV1
} from '../../platform/shared/agent-operation-read-plan-contract.ts';
import {
  compileSecTaskCapsuleV1,
  SEC_TASK_CAPSULE_COMPILE_REQUEST_SCHEMA,
  SEC_TASK_CAPSULE_INPUT_SCHEMA,
  type SecDigestV1,
  type SecTaskCapsulePlanningContextV1
} from '../../platform/shared/agent-task-capsule-contract.ts';

const REPOSITORY_ROOT = path.resolve(import.meta.dir, '../..');
const digest = (character: string): SecDigestV1 => `sha256:${character.repeat(64)}`;
const WORKER_SKILL_PATH = '.agents/skills/sec-worker-development/SKILL.md';
const WORKER_SKILL_REF_ID = 'skill-guidance-sec-worker-development';

function capsule(planningContext: SecTaskCapsulePlanningContextV1): SecOperationReadPlanInputV1['taskCapsule'] {
  return compileSecTaskCapsuleV1({
    schema: SEC_TASK_CAPSULE_INPUT_SCHEMA,
    ref: 'urn:sec:task-capsule:issue-346-contract',
    planningContext
  });
}

function gitHead(): string {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

function input(): SecOperationReadPlanInputV1 {
  const head = gitHead();
  return {
    schema: SEC_OPERATION_READ_PLAN_INPUT_SCHEMA,
    taskCapsule: capsule({
      operationId: 'issue-346-contract',
      role: 'worker',
      operationKind: 'implement',
      goalDigest: digest('b'),
      trustedRevision: head,
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
        readPaths: ['docs/development-governance.md', WORKER_SKILL_PATH],
        writePaths: ['platform/shared/'],
        forbiddenPaths: [],
        availableCapabilities: ['git'],
        authorizedResources: [],
        authorizedGates: [],
        changedPaths: []
      },
      verificationObligations: [{
        id: 'operation-read-plan-focused',
        revision: 'v1',
        reasonCode: 'public-contract-change'
      }],
      skillCandidateIds: ['sec-worker-development']
    }),
    requiredRefs: [{
      id: 'development-governance',
      ref: 'docs/development-governance.md',
      owner: 'development-governance-owner',
      revision: 'owner-revision-v1',
      reasonCode: 'canonical-operation-owner'
    }],
    conditionalRefs: [{
      id: WORKER_SKILL_REF_ID,
      ref: WORKER_SKILL_PATH,
      owner: 'sec-worker-development',
      revision: head,
      reasonCode: 'post-applicability-guidance',
      frontierId: 'skill-guidance-applicability'
    }],
    forbiddenSources: [
      'assistant-memory',
      'chat-history',
      'full-issue-census',
      'full-skill-corpus',
      'historical-pr-comments',
      'unrelated-issue-census'
    ],
    maxSkillBodies: 1,
    unresolvedFrontier: [{
      id: 'skill-guidance-applicability',
      reasonCode: 'post-applicability-guidance',
      allowedRefIds: [WORKER_SKILL_REF_ID]
    }],
    readReceipts: [],
    invalidationInputs: []
  };
}

function run(script: string, args: readonly string[]): {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
} {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
    windowsHide: true
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

test('pure compiler binds Skill guidance as conditional Read Plan input without pre-reading the body', () => {
  const plan = compileSecOperationReadPlanV1(input()) as SecOperationReadPlanV1;
  expect(plan.requiredRefs.map((reference) => reference.id)).toEqual(['development-governance']);
  expect(plan.conditionalRefs).toEqual([{
    id: WORKER_SKILL_REF_ID,
    ref: WORKER_SKILL_PATH,
    owner: 'sec-worker-development',
    revision: plan.taskCapsule.planningContext.trustedRevision,
    reasonCode: 'post-applicability-guidance',
    frontierId: 'skill-guidance-applicability'
  }]);
  expect(plan.unresolvedFrontier).toEqual([{
    id: 'skill-guidance-applicability',
    reasonCode: 'post-applicability-guidance',
    allowedRefIds: [WORKER_SKILL_REF_ID]
  }]);
  expect(plan.taskCapsule.planningContext.scopeProposal.readPaths).toContain(WORKER_SKILL_PATH);
  expect(plan.preApplicabilitySkillBodiesRead).toBe(0);
  expect(plan.maxSkillBodies).toBe(1);

  const verified = run('scripts/codex/operation-read-plan.ts', [
    'verify', '--plan', JSON.stringify(plan)
  ]);
  expect(verified.status).toBe(0);
  expect(JSON.parse(verified.stdout)).toMatchObject({
    status: 'content-valid',
    authorityStatus: 'unbound-planning-content',
    effectAuthority: 'none',
    taskCapsuleDigest: plan.taskCapsule.digest,
    readPlanDigest: plan.readPlanDigest
  });
});

test('Task Capsule verify is content-only and compile rejects caller authority before observation', () => {
  const compiled = input().taskCapsule;
  const verified = run('scripts/codex/task-capsule.ts', [
    'verify', '--capsule', JSON.stringify(compiled)
  ]);
  expect(verified.status).toBe(0);
  expect(JSON.parse(verified.stdout)).toMatchObject({
    status: 'content-valid',
    authorityStatus: 'unbound-planning-content',
    effectAuthority: 'none',
    taskCapsuleDigest: compiled.digest
  });

  const rejected = run('scripts/codex/task-capsule.ts', [
    'compile',
    '--input',
    JSON.stringify({ schema: SEC_TASK_CAPSULE_COMPILE_REQUEST_SCHEMA, authority: {} }),
    '--candidate-root',
    REPOSITORY_ROOT
  ]);
  expect(rejected.status).not.toBe(0);
  expect(rejected.stderr).toContain('authority-free schema-only request');

  const blocked = run('scripts/codex/task-capsule.ts', [
    'compile',
    '--input',
    JSON.stringify({ schema: SEC_TASK_CAPSULE_COMPILE_REQUEST_SCHEMA }),
    '--candidate-root',
    REPOSITORY_ROOT
  ]);
  expect(blocked.status).not.toBe(0);
  const blockedProjection = JSON.parse(blocked.stderr);
  expect(blockedProjection).toMatchObject({
    status: 'blocked',
    authorityStatus: 'unbound-planning-content',
    effectAuthority: 'none'
  });
  expect(blockedProjection.reasonCode).toMatch(/^activation-/u);
  expect(blockedProjection.blockerDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
});

test('compile CLI rejects caller-provided Capsule authority before live observation', () => {
  const supplied = input();
  const result = run('scripts/codex/operation-read-plan.ts', [
    'compile',
    '--input',
    JSON.stringify({ ...supplied, schema: SEC_OPERATION_READ_CLOSURE_REQUEST_SCHEMA }),
    '--candidate-root',
    REPOSITORY_ROOT
  ]);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('cannot provide taskCapsule authority');
});

test('compile CLI rejects caller-provided read refs and policy before live observation', () => {
  const result = run('scripts/codex/operation-read-plan.ts', [
    'compile',
    '--input',
    JSON.stringify({
      schema: SEC_OPERATION_READ_CLOSURE_REQUEST_SCHEMA,
      requiredRefs: [],
      forbiddenSources: []
    }),
    '--candidate-root',
    REPOSITORY_ROOT
  ]);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('refs, receipts, and policy are trusted-derived');
});

test('schema-only Read Plan production compile fails closed without a trusted issuer', () => {
  const result = run('scripts/codex/operation-read-plan.ts', [
    'compile',
    '--input',
    JSON.stringify({ schema: SEC_OPERATION_READ_CLOSURE_REQUEST_SCHEMA }),
    '--candidate-root',
    REPOSITORY_ROOT
  ]);
  expect(result.status).not.toBe(0);
  const blocked = JSON.parse(result.stderr);
  expect(blocked.status).toBe('blocked');
  expect(blocked.reasonCode).toMatch(/^activation-/u);
  expect(blocked.blockerDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
});

test('Skill CLI rejects the retired raw envelope path', () => {
  const result = run('scripts/codex/skill-applicability.ts', [
    '--envelope', JSON.stringify({ role: 'worker' })
  ]);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('unknown argument: --envelope');
});

test('Skill CLI requires an explicit candidate root before live authority observation', () => {
  const plan = compileSecOperationReadPlanV1(input());
  const selected = run('scripts/codex/skill-applicability.ts', [
    '--read-plan', JSON.stringify(plan)
  ]);
  expect(selected.status).not.toBe(0);
  expect(selected.stderr).toContain('--candidate-root <path> is required');
});
