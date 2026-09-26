import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { expect, test } from 'bun:test';

import {
  compileReadPlan,
  READ_CLOSURE_REQUEST_SCHEMA,
  READ_PLAN_INPUT_SCHEMA,
  type ReadPlan,
  type ReadPlanInput
} from '../../src/adapters/self-hosting/control/agent/read-plan.ts';
import {
  compileTaskCapsule,
  TASK_CAPSULE_COMPILE_REQUEST_SCHEMA,
  TASK_CAPSULE_INPUT_SCHEMA,
  type TaskCapsuleDigest,
  type TaskCapsulePlanningContext
} from '../../src/adapters/self-hosting/control/agent/task-capsule.ts';

const REPOSITORY_ROOT = path.resolve(import.meta.dir, '../..');
const digest = (character: string): TaskCapsuleDigest => `sha256:${character.repeat(64)}`;

function capsule(planningContext: TaskCapsulePlanningContext): ReadPlanInput['taskCapsule'] {
  return compileTaskCapsule({
    schema: TASK_CAPSULE_INPUT_SCHEMA,
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

function input(): ReadPlanInput {
  const head = gitHead();
  return {
    schema: READ_PLAN_INPUT_SCHEMA,
    taskCapsule: capsule({
      operationId: 'issue-346-contract',
      role: 'worker',
      operationKind: 'implement',
      goalDigest: digest('b'),
      trustedRevision: head,
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
        writePaths: ['platform/shared/'],
        forbiddenPaths: ['.agents/skills/'],
        authorizedResources: [],
        authorizedGates: [],
        changedPaths: []
      },
      verificationObligations: [{
        id: 'operation-read-plan-focused',
        revision: 'v1',
        reasonCode: 'public-contract-change'
      }],
      skillCandidateIds: ['worker-development']
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
    maxSkillBodies: 1,
    unresolvedFrontier: [],
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

test('pure compiler and verify CLI produce one content-bound Read Plan without claiming live authority', () => {
  const plan = compileReadPlan(input()) as ReadPlan;
  expect(plan.requiredRefs.map((reference) => reference.id)).toEqual(['development-governance']);
  expect(plan.preApplicabilitySkillBodiesRead).toBe(0);

  const verified = run('src/adapters/self-hosting/control/agent/operation-read-plan.ts', [
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
  const verified = run('src/adapters/self-hosting/control/agent/task-capsule-host.ts', [
    'verify', '--capsule', JSON.stringify(compiled)
  ]);
  expect(verified.status).toBe(0);
  expect(JSON.parse(verified.stdout)).toMatchObject({
    status: 'content-valid',
    authorityStatus: 'unbound-planning-content',
    effectAuthority: 'none',
    taskCapsuleDigest: compiled.digest
  });

  const rejected = run('src/adapters/self-hosting/control/agent/task-capsule-host.ts', [
    'compile',
    '--input',
    JSON.stringify({ schema: TASK_CAPSULE_COMPILE_REQUEST_SCHEMA, authority: {} }),
    '--candidate-root',
    REPOSITORY_ROOT
  ]);
  expect(rejected.status).not.toBe(0);
  expect(rejected.stderr).toContain('authority-free schema-only request');

  const blocked = run('src/adapters/self-hosting/control/agent/task-capsule-host.ts', [
    'compile',
    '--input',
    JSON.stringify({ schema: TASK_CAPSULE_COMPILE_REQUEST_SCHEMA }),
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
  const result = run('src/adapters/self-hosting/control/agent/operation-read-plan.ts', [
    'compile',
    '--input',
    JSON.stringify({ ...supplied, schema: READ_CLOSURE_REQUEST_SCHEMA }),
    '--candidate-root',
    REPOSITORY_ROOT
  ]);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('cannot provide taskCapsule authority');
});

test('compile CLI rejects caller-provided read refs and policy before live observation', () => {
  const result = run('src/adapters/self-hosting/control/agent/operation-read-plan.ts', [
    'compile',
    '--input',
    JSON.stringify({
      schema: READ_CLOSURE_REQUEST_SCHEMA,
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
  const result = run('src/adapters/self-hosting/control/agent/operation-read-plan.ts', [
    'compile',
    '--input',
    JSON.stringify({ schema: READ_CLOSURE_REQUEST_SCHEMA }),
    '--candidate-root',
    REPOSITORY_ROOT
  ]);
  expect(result.status).not.toBe(0);
  const blocked = JSON.parse(result.stderr);
  expect(blocked.status).toBe('blocked');
  expect(blocked.reasonCode).toMatch(/^activation-/u);
  expect(blocked.blockerDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
});

test('Skill CLI requires an explicit candidate root before live authority observation', () => {
  const plan = compileReadPlan(input());
  const selected = run('src/adapters/self-hosting/control/agent/skill-applicability.ts', [
    '--read-plan', JSON.stringify(plan)
  ]);
  expect(selected.status).not.toBe(0);
  expect(selected.stderr).toContain('--candidate-root <path> is required');
});
