import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { expect, test } from 'bun:test';

import {
  compileSecOperationReadPlanV1,
  SEC_OPERATION_READ_CLOSURE_REQUEST_SCHEMA,
  SEC_OPERATION_READ_PLAN_INPUT_SCHEMA,
  SEC_TASK_CAPSULE_AUTHORITY_REVISION,
  SEC_TASK_CAPSULE_AUTHORITY_SCHEMA,
  type SecDigestV1,
  type SecOperationReadPlanInputV1,
  type SecOperationReadPlanV1,
  type SecTaskCapsuleAuthorityV1
} from '../../platform/shared/agent-operation-read-plan-contract.ts';
import { sha256 } from '../../platform/shared/canonical-primitives.ts';

const REPOSITORY_ROOT = path.resolve(import.meta.dir, '../..');
const digest = (character: string): SecDigestV1 => `sha256:${character.repeat(64)}`;

function capsule(authority: SecTaskCapsuleAuthorityV1): SecOperationReadPlanInputV1['taskCapsule'] {
  const projection = {
    schema: SEC_TASK_CAPSULE_AUTHORITY_SCHEMA,
    ref: 'urn:sec:task-capsule:issue-346-contract',
    revision: SEC_TASK_CAPSULE_AUTHORITY_REVISION,
    authority
  };
  return { ...projection, digest: sha256(projection) as SecDigestV1 };
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
        writePaths: ['platform/shared/'],
        forbiddenPaths: ['.agents/skills/'],
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
  const plan = compileSecOperationReadPlanV1(input()) as SecOperationReadPlanV1;
  expect(plan.requiredRefs.map((reference) => reference.id)).toEqual(['development-governance']);
  expect(plan.preApplicabilitySkillBodiesRead).toBe(0);

  const verified = run('scripts/codex/operation-read-plan.ts', [
    'verify', '--plan', JSON.stringify(plan)
  ]);
  expect(verified.status).toBe(0);
  expect(JSON.parse(verified.stdout)).toMatchObject({
    status: 'content-valid',
    authorityStatus: 'requires-trusted-consumer-live-binding',
    taskCapsuleDigest: plan.taskCapsule.digest,
    readPlanDigest: plan.readPlanDigest
  });
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
