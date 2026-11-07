import path from 'node:path';
import { agentPlanningContext, agentReadPlanInput } from '../../helpers/agent-planning-input.ts';
import { runRetainedBunTestCommand } from '../../testkit/process-resource.ts';

import { expect, test } from 'bun:test';

import {
  compileOperationReadPlan,
  OPERATION_READ_CLOSURE_REQUEST_SCHEMA,
  type OperationReadPlan,
  type OperationReadPlanInput
} from '../../../src/adapters/self-hosting/control/agent/read-plan.ts';
import {
  compileTaskCapsule,
  TASK_CAPSULE_COMPILE_REQUEST_SCHEMA,
  TASK_CAPSULE_INPUT_SCHEMA,
  type TaskCapsulePlanningContext
} from '../../../src/adapters/self-hosting/control/agent/task-capsule.ts';

const REPOSITORY_ROOT = path.resolve(import.meta.dir, '../../..');

function capsule(planningContext: TaskCapsulePlanningContext): OperationReadPlanInput['taskCapsule'] {
  return compileTaskCapsule({
    schema: TASK_CAPSULE_INPUT_SCHEMA,
    ref: 'urn:sec:task-capsule:issue-346-contract',
    planningContext
  });
}

function input(): OperationReadPlanInput {
  // Verification checks content binding only; live authority is tested separately below.
  return agentReadPlanInput(capsule(agentPlanningContext()));
}

async function run(script: string, args: readonly string[]): Promise<{
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}> {
  const result = await runRetainedBunTestCommand([script, ...args], { cwd: REPOSITORY_ROOT });
  return { status: result.code, stdout: result.stdout, stderr: result.stderr };
}

test('pure compiler and verify CLI produce one content-bound Read Plan without claiming live authority', async () => {
  const plan = compileOperationReadPlan(input()) as OperationReadPlan;
  expect(plan.requiredRefs.map((reference) => reference.id)).toEqual(['development-governance']);
  expect(plan.preApplicabilitySkillBodiesRead).toBe(0);

  const verified = await run('src/adapters/self-hosting/control/agent/operation-read-plan.ts', [
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

test('Task Capsule verify is content-only and compile rejects caller authority before observation', async () => {
  const compiled = input().taskCapsule;
  const verified = await run('src/adapters/self-hosting/control/agent/task-capsule-host.ts', [
    'verify', '--capsule', JSON.stringify(compiled)
  ]);
  expect(verified.status).toBe(0);
  expect(JSON.parse(verified.stdout)).toMatchObject({
    status: 'content-valid',
    authorityStatus: 'unbound-planning-content',
    effectAuthority: 'none',
    taskCapsuleDigest: compiled.digest
  });

  const rejected = await run('src/adapters/self-hosting/control/agent/task-capsule-host.ts', [
    'compile',
    '--input',
    JSON.stringify({ schema: TASK_CAPSULE_COMPILE_REQUEST_SCHEMA, authority: {} }),
    '--candidate-root',
    REPOSITORY_ROOT
  ]);
  expect(rejected.status).toBe(2);
  expect(rejected.stderr).toContain('authority-free schema-only request');

  const blocked = await run('src/adapters/self-hosting/control/agent/task-capsule-host.ts', [
    'compile',
    '--input',
    JSON.stringify({ schema: TASK_CAPSULE_COMPILE_REQUEST_SCHEMA }),
    '--candidate-root',
    REPOSITORY_ROOT
  ]);
  expect(blocked.status).toBe(2);
  const blockedProjection = JSON.parse(blocked.stderr);
  expect(blockedProjection).toMatchObject({
    status: 'blocked',
    authorityStatus: 'unbound-planning-content',
    effectAuthority: 'none'
  });
  expect(blockedProjection.reasonCode).toMatch(/^activation-/u);
  expect(blockedProjection.blockerDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
});

test('compile CLI rejects caller-provided Capsule authority before live observation', async () => {
  const result = await run('src/adapters/self-hosting/control/agent/operation-read-plan.ts', [
    'compile',
    '--input',
    JSON.stringify({ schema: OPERATION_READ_CLOSURE_REQUEST_SCHEMA, taskCapsule: {} }),
    '--candidate-root',
    REPOSITORY_ROOT
  ]);
  expect(result.status).toBe(2);
  expect(result.stderr).toContain('cannot provide taskCapsule authority');
});

test('compile CLI rejects caller-provided read refs and policy before live observation', async () => {
  const result = await run('src/adapters/self-hosting/control/agent/operation-read-plan.ts', [
    'compile',
    '--input',
    JSON.stringify({
      schema: OPERATION_READ_CLOSURE_REQUEST_SCHEMA,
      requiredRefs: [],
      forbiddenSources: []
    }),
    '--candidate-root',
    REPOSITORY_ROOT
  ]);
  expect(result.status).toBe(2);
  expect(result.stderr).toContain('refs, receipts, and policy are trusted-derived');
});

test('schema-only Read Plan production compile fails closed without a trusted issuer', async () => {
  const result = await run('src/adapters/self-hosting/control/agent/operation-read-plan.ts', [
    'compile',
    '--input',
    JSON.stringify({ schema: OPERATION_READ_CLOSURE_REQUEST_SCHEMA }),
    '--candidate-root',
    REPOSITORY_ROOT
  ]);
  expect(result.status).toBe(2);
  const blocked = JSON.parse(result.stderr);
  expect(blocked.status).toBe('blocked');
  expect(blocked.reasonCode).toMatch(/^activation-/u);
  expect(blocked.blockerDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
});

test('Skill CLI requires an explicit candidate root before live authority observation', async () => {
  const selected = await run('src/adapters/self-hosting/control/agent/skill-applicability.ts', [
    '--read-plan', '{}'
  ]);
  expect(selected.status).toBe(2);
  expect(selected.stderr).toContain('--candidate-root <path> is required');
});
