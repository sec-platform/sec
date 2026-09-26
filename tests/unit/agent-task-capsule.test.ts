import { expect, test } from 'bun:test';

import {
  compileTaskCapsule,
  parseTaskCapsule,
  TASK_CAPSULE_AUTHORITY_STATUS,
  TASK_CAPSULE_INPUT_SCHEMA,
  TASK_CAPSULE_REVISION,
  type TaskCapsuleDigest,
  type TaskCapsuleInput,
  type TaskCapsulePlanningContext
} from '../../src/adapters/self-hosting/control/agent/task-capsule.ts';

const digest = (character: string): TaskCapsuleDigest => `sha256:${character.repeat(64)}`;

function planningContext(): TaskCapsulePlanningContext {
  return {
    operationId: 'work-package-task-capsule-compiler-v1',
    role: 'worker',
    operationKind: 'implement',
    goalDigest: digest('a'),
    trustedRevision: '8ba2bf1fb39351124187130d60fa971e4802155a',
    targetCandidate: '375a3f95c4a949dcd418823e61b9488e4b4c4786',
    workPackageProposalRef: 'config/repository/work-packages/task-capsule-compiler-v1.md',
    workPackageProposalDigest: digest('b'),
    workPackageProjectionId: digest('c'),
    scopeGrantId: null,
    ownerFacts: [
      {
        id: 'task-capsule-owner',
        ref: 'docs/开发/AI协作/规则装载与任务恢复.md',
        owner: 'development-governance-owner',
        revision: 'owner-v1'
      },
      {
        id: 'work-package-owner',
        ref: 'config/repository/work-packages/task-capsule-compiler-v1.md',
        owner: 'development-governance-owner',
        revision: digest('b')
      }
    ],
    scopeProposal: {
      readPaths: ['docs/', 'src/adapters/self-hosting/control/agent/'],
      writePaths: ['src/adapters/self-hosting/control/agent/'],
      forbiddenPaths: ['.agents/skills/', '.github/workflows/'],
      authorizedResources: [],
      authorizedGates: [],
      changedPaths: [
        'src/adapters/self-hosting/control/agent/task-capsule-host.ts',
        'src/adapters/self-hosting/control/agent/task-capsule.ts'
      ]
    },
    verificationObligations: [{
      id: 'task-capsule-focused',
      revision: 'v1',
      reasonCode: 'public-contract-change'
    }],
    skillCandidateIds: ['worker-development']
  };
}

function input(overrides: Partial<TaskCapsuleInput> = {}): TaskCapsuleInput {
  return {
    schema: TASK_CAPSULE_INPUT_SCHEMA,
    ref: 'urn:sec:task-capsule:work-package/task-capsule-compiler-v1',
    planningContext: planningContext(),
    ...overrides
  };
}

test('Task Capsule is a deterministic content-addressed pure compiler output', () => {
  const first = compileTaskCapsule(input());
  const source = planningContext();
  const second = compileTaskCapsule(input({
    planningContext: {
      ...source,
      ownerFacts: [...source.ownerFacts].reverse(),
      scopeProposal: {
        ...source.scopeProposal,
        readPaths: [...source.scopeProposal.readPaths].reverse(),
        writePaths: [...source.scopeProposal.writePaths].reverse(),
        changedPaths: [...source.scopeProposal.changedPaths].reverse()
      }
    }
  }));
  expect(second).toEqual(first);
  expect(first.revision).toBe(TASK_CAPSULE_REVISION);
  expect(first.authorityStatus).toBe(TASK_CAPSULE_AUTHORITY_STATUS);
  expect(first.effectAuthority).toBe('none');
  expect(parseTaskCapsule(JSON.parse(JSON.stringify(first)))).toEqual(first);
});

test('Task Capsule rejects unknown caller fields and digest tampering', () => {
  expect(() => compileTaskCapsule({
    ...input(),
    currentState: 'candidate'
  })).toThrow(/keys must be exact/u);

  const capsule = compileTaskCapsule(input());
  expect(() => parseTaskCapsule({
    ...capsule,
    digest: digest('f')
  })).toThrow(/digest does not bind its complete planning content/u);
});

test('Task Capsule scope rejects write-forbidden overlap and changed-path escape', () => {
  const source = planningContext();
  expect(() => compileTaskCapsule(input({
    planningContext: {
      ...source,
      scopeProposal: {
        ...source.scopeProposal,
        writePaths: ['scripts/'],
        forbiddenPaths: ['scripts/codex/protected.ts'],
        changedPaths: []
      }
    }
  }))).toThrow(/overlaps forbidden/u);

  expect(() => compileTaskCapsule(input({
    planningContext: {
      ...source,
      scopeProposal: {
        ...source.scopeProposal,
        writePaths: ['docs/'],
        changedPaths: ['src/adapters/self-hosting/control/agent/task-capsule.ts']
      }
    }
  }))).toThrow(/outside every proposed write path/u);
});

test('Task Capsule requires exact Git and Work Package identities plus a real owner fact', () => {
  const source = planningContext();
  expect(() => compileTaskCapsule(input({
    planningContext: { ...source, trustedRevision: 'main' }
  }))).toThrow(/exact lowercase Git object ID/u);
  expect(() => compileTaskCapsule(input({
    planningContext: { ...source, workPackageProjectionId: 'freeze-latest' as TaskCapsuleDigest }
  }))).toThrow(/lowercase SHA-256 digest/u);
  expect(() => compileTaskCapsule(input({
    planningContext: { ...source, ownerFacts: [] }
  }))).toThrow(/at least one canonical owner/u);
  expect(() => compileTaskCapsule(input({
    planningContext: {
      ...source,
      workPackageProposalRef: '../outside.md'
    }
  }))).toThrow(/canonical repository path/u);
  expect(() => compileTaskCapsule(input({
    planningContext: {
      ...source,
      scopeGrantId: digest('d') as unknown as null
    }
  }))).toThrow(/scopeGrantId must remain null/u);
});
