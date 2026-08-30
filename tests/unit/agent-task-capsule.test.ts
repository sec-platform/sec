import { expect, test } from 'bun:test';

import {
  compileSecTaskCapsule,
  parseSecTaskCapsule,
  SEC_TASK_CAPSULE_AUTHORITY_STATUS,
  SEC_TASK_CAPSULE_INPUT_SCHEMA,
  SEC_TASK_CAPSULE_REVISION,
  SEC_TASK_CAPSULE_SCHEMA,
  type SecDigest,
  type SecTaskCapsuleInputV1,
  type SecTaskCapsulePlanningContext
} from '../../src/control/agent/task-capsule.ts';

const digest = (character: string): SecDigest => `sha256:${character.repeat(64)}`;

function planningContext(): SecTaskCapsulePlanningContext {
  return {
    operationId: 'work-package-task-capsule-compiler-v1',
    role: 'worker',
    operationKind: 'implement',
    goalDigest: digest('a'),
    trustedRevision: '8ba2bf1fb39351124187130d60fa971e4802155a',
    targetCandidate: '375a3f95c4a949dcd418823e61b9488e4b4c4786',
    workPackageProposalRef: 'docs/work-packages/task-capsule-compiler-v1.md',
    workPackageProposalDigest: digest('b'),
    workPackageProjectionId: digest('c'),
    scopeGrantId: null,
    ownerFacts: [
      {
        id: 'task-capsule-owner',
        ref: 'docs/development-governance.md',
        owner: 'development-governance-owner',
        revision: 'owner-v1'
      },
      {
        id: 'work-package-owner',
        ref: 'docs/work-packages/task-capsule-compiler-v1.md',
        owner: 'development-governance-owner',
        revision: digest('b')
      }
    ],
    scopeProposal: {
      readPaths: ['platform/shared/', 'docs/'],
      writePaths: ['scripts/codex/', 'platform/shared/'],
      forbiddenPaths: ['.agents/skills/', '.github/workflows/'],
      availableCapabilities: ['git'],
      authorizedResources: [],
      authorizedGates: [],
      changedPaths: [
        'src/control/agent/task-capsule-host.ts',
        'src/control/agent/task-capsule.ts'
      ]
    },
    verificationObligations: [{
      id: 'task-capsule-focused',
      revision: 'v1',
      reasonCode: 'public-contract-change'
    }],
    skillCandidateIds: ['sec-worker-development']
  };
}

function input(overrides: Partial<SecTaskCapsuleInputV1> = {}): SecTaskCapsuleInputV1 {
  return {
    schema: SEC_TASK_CAPSULE_INPUT_SCHEMA,
    ref: 'urn:sec:task-capsule:work-package/task-capsule-compiler-v1',
    planningContext: planningContext(),
    ...overrides
  };
}

test('Task Capsule is a deterministic content-addressed pure compiler output', () => {
  const first = compileSecTaskCapsule(input());
  const source = planningContext();
  const second = compileSecTaskCapsule(input({
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
  expect(first.revision).toBe(SEC_TASK_CAPSULE_REVISION);
  expect(first.authorityStatus).toBe(SEC_TASK_CAPSULE_AUTHORITY_STATUS);
  expect(first.effectAuthority).toBe('none');
  expect(parseSecTaskCapsule(JSON.parse(JSON.stringify(first)))).toEqual(first);
});

test('Task Capsule rejects unknown caller fields and digest tampering', () => {
  expect(() => compileSecTaskCapsule({
    ...input(),
    currentState: 'candidate'
  })).toThrow(/keys must be exact/u);

  const capsule = compileSecTaskCapsule(input());
  expect(() => parseSecTaskCapsule({
    ...capsule,
    digest: digest('f')
  })).toThrow(/digest does not bind its complete planning content/u);
});

test('Task Capsule scope rejects write-forbidden overlap and changed-path escape', () => {
  const source = planningContext();
  expect(() => compileSecTaskCapsule(input({
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

  expect(() => compileSecTaskCapsule(input({
    planningContext: {
      ...source,
      scopeProposal: {
        ...source.scopeProposal,
        writePaths: ['docs/'],
        changedPaths: ['src/control/agent/task-capsule.ts']
      }
    }
  }))).toThrow(/outside every proposed write path/u);
});

test('Task Capsule requires exact Git and Work Package identities plus a real owner fact', () => {
  const source = planningContext();
  expect(() => compileSecTaskCapsule(input({
    planningContext: { ...source, trustedRevision: 'main' }
  }))).toThrow(/exact lowercase Git object ID/u);
  expect(() => compileSecTaskCapsule(input({
    planningContext: { ...source, workPackageProjectionId: 'freeze-latest' as SecDigest }
  }))).toThrow(/lowercase SHA-256 digest/u);
  expect(() => compileSecTaskCapsule(input({
    planningContext: { ...source, ownerFacts: [] }
  }))).toThrow(/at least one canonical owner/u);
  expect(() => compileSecTaskCapsule(input({
    planningContext: {
      ...source,
      workPackageProposalRef: '../outside.md'
    }
  }))).toThrow(/canonical repository path/u);
  expect(() => compileSecTaskCapsule(input({
    planningContext: {
      ...source,
      scopeGrantId: digest('d') as unknown as null
    }
  }))).toThrow(/scopeGrantId must remain null/u);
});
