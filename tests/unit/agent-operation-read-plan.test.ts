import { expect, test } from 'bun:test';

import {
  compileReadPlan,
  parseReadPlan,
  projectSkillEnvelopeFromReadPlan,
  resolveMaintainerMutation,
  READ_PLAN_INPUT_SCHEMA,
  type ReadPlanInput
} from '../../src/adapters/self-hosting/control/agent/read-plan.ts';
import {
  compileTaskCapsule,
  TASK_CAPSULE_INPUT_SCHEMA,
  type TaskCapsuleDigest,
  type TaskCapsulePlanningContext
} from '../../src/adapters/self-hosting/control/agent/task-capsule.ts';

const digest = (character: string): TaskCapsuleDigest => `sha256:${character.repeat(64)}`;

function capsule(planningContext: TaskCapsulePlanningContext): ReadPlanInput['taskCapsule'] {
  return compileTaskCapsule({
    schema: TASK_CAPSULE_INPUT_SCHEMA,
    ref: 'urn:sec:task-capsule:issue-346',
    planningContext
  });
}

function input(): ReadPlanInput {
  return {
    schema: READ_PLAN_INPUT_SCHEMA,
    taskCapsule: capsule({
      operationId: 'issue-346-read-plan',
      role: 'worker',
      operationKind: 'implement',
      goalDigest: digest('b'),
      trustedRevision: '6b7f1a3f54b0b4bdd8eef4c065e1e83607f6bbcb',
      targetCandidate: 'ef922744393d451a037349197fe4dd57d6ae8497',
      workPackageProposalRef: 'config/repository/work-packages/task-capsule-compiler-v1.md',
      workPackageProposalDigest: digest('c'),
      workPackageProjectionId: digest('e'),
      scopeGrantId: null,
      ownerFacts: [
        {
          id: 'work-package',
          ref: 'config/repository/work-packages/task-capsule-compiler-v1.md',
          owner: 'development-governance-owner',
          revision: digest('c')
        },
        {
          id: 'authority-registry',
          ref: '.documentation/documents.json',
          owner: 'documentation-authority-owner',
          revision: 'blob-authority-v1'
        }
      ],
      scopeProposal: {
        readPaths: ['.documentation/', 'config/repository/work-packages/', 'docs/', 'src/adapters/self-hosting/control/agent/'],
        writePaths: ['src/adapters/self-hosting/control/agent/'],
        forbiddenPaths: ['.agents/skills/', '.github/workflows/'],
        authorizedResources: ['github:issue/346/comments'],
        authorizedGates: [],
        changedPaths: ['src/adapters/self-hosting/control/agent/read-plan.ts']
      },
      verificationObligations: [
        { id: 'focused-contracts', revision: 'v1', reasonCode: 'public-contract-change' }
      ],
      skillCandidateIds: ['worker-development']
    }),
    requiredRefs: [
      {
        id: 'authority',
        ref: '.documentation/documents.json',
        owner: 'documentation-authority-owner',
        revision: 'blob-authority-v1',
        reasonCode: 'resolve-canonical-owner',
        projection: null
      },
      {
        id: 'manifest',
        ref: 'config/repository/work-packages/task-capsule-compiler-v1.md',
        owner: 'development-governance-owner',
        revision: digest('c'),
        reasonCode: 'bind-operation-scope',
        projection: null
      }
    ],
    conditionalRefs: [
      {
        id: 'historical-issue-context',
        ref: 'github:issue/346/comments',
        owner: 'github-provider',
        revision: 'provider-snapshot-v1',
        reasonCode: 'resolve-missing-acceptance-detail',
        projection: null,
        frontierId: 'missing-acceptance-detail'
      }
    ],
    forbiddenSources: [
      'assistant-memory',
      'chat-history',
      'full-issue-census',
      'full-skill-corpus',
      'historical-pr-comments',
      'unrelated-issue-census'
    ],
    maxSkillBodies: 1,
    unresolvedFrontier: [
      {
        id: 'missing-acceptance-detail',
        reasonCode: 'required-owner-ref-insufficient',
        allowedRefIds: ['historical-issue-context']
      }
    ],
    readReceipts: [
      {
        refId: 'authority',
        owner: 'documentation-authority-owner',
        revision: 'blob-authority-v1',
        reasonCode: 'resolve-canonical-owner',
        contentDigest: digest('d')
      }
    ],
    invalidationInputs: [{ id: 'toolchain-profile', revision: 'bun-1.3.14' }]
  };
}

test('Read Plan compiles deterministically while referencing rather than redefining Task Capsule', () => {
  const first = compileReadPlan(input());
  const source = input();
  const second = compileReadPlan({
    ...source,
    taskCapsule: {
      ...source.taskCapsule,
      planningContext: {
        ...source.taskCapsule.planningContext,
        ownerFacts: [...source.taskCapsule.planningContext.ownerFacts].reverse(),
        scopeProposal: {
          ...source.taskCapsule.planningContext.scopeProposal,
          readPaths: [...source.taskCapsule.planningContext.scopeProposal.readPaths].reverse()
        }
      }
    },
    requiredRefs: [...source.requiredRefs].reverse(),
    forbiddenSources: [...source.forbiddenSources].reverse()
  });
  expect(second).toEqual(first);
  expect(first.taskCapsule).toEqual(input().taskCapsule);
  expect(first.preApplicabilitySkillBodiesRead).toBe(0);
  expect(first.maxSkillBodies).toBe(1);
  expect(first.maintainerMutationPolicy).toBe('current-physical-state-authoritative-v1');
  expect(first.protectedRootPolicy).toBe('outside-candidate-write-authority-v1');
});

test('conditional reads require an explicit bidirectional frontier', () => {
  const malformed = input();
  expect(() => compileReadPlan({
    ...malformed,
    unresolvedFrontier: []
  })).toThrow(/not admitted by frontier/u);
});

test('one operation context rejects duplicate source refs even under different ids', () => {
  const malformed = input();
  expect(() => compileReadPlan({
    ...malformed,
    conditionalRefs: [{
      ...malformed.conditionalRefs[0]!,
      ref: malformed.requiredRefs[0]!.ref
    }]
  })).toThrow(/source ref may occur only once/u);
});

test('read refs stay inside Capsule scope and mandatory deny sources cannot be removed', () => {
  const source = input();
  expect(() => compileReadPlan({
    ...source,
    requiredRefs: [{ ...source.requiredRefs[0]!, ref: 'README.md' }]
  })).toThrow(/outside the Capsule read proposal/u);
  expect(() => compileReadPlan({
    ...source,
    forbiddenSources: source.forbiddenSources.filter((value) => value !== 'assistant-memory')
  })).toThrow(/omits mandatory baseline source/u);
});

test('read receipt binds planned owner revision reason and bytes', () => {
  const malformed = input();
  expect(() => compileReadPlan({
    ...malformed,
    readReceipts: [{ ...malformed.readReceipts[0]!, owner: 'wrong-owner' }]
  })).toThrow(/planned owner, revision, and reason/u);
});

test('retired documentation clause projections cannot re-enter the read contract', () => {
  const source = input();
  expect(() => compileReadPlan({
    ...source,
    requiredRefs: [{
      ...source.requiredRefs[0]!,
      projection: { kind: 'markdown-clauses' } as never
    }]
  })).toThrow(/projection is unsupported/u);
});

test('plan parser rejects tampering and Skill projection carries exact upstream capsule identity', () => {
  const plan = compileReadPlan(input());
  const envelope = projectSkillEnvelopeFromReadPlan(plan);
  expect(envelope.taskCapsuleRef).toBe(plan.taskCapsule.ref);
  expect(envelope.taskCapsuleDigest).toBe(plan.taskCapsule.digest);
  expect(envelope.taskCapsuleRevision).toBe(plan.taskCapsule.revision);
  expect(() => parseReadPlan({
    ...plan,
    readPlanDigest: digest('f')
  })).toThrow(/readPlanDigest mismatch/u);
});

test('zero Skill-body budget rejects selectable candidates', () => {
  const malformed = input();
  expect(() => compileReadPlan({
    ...malformed,
    maxSkillBodies: 0
  })).toThrow(/skillCandidateIds must be empty/u);
});

test('Skill registry validates Capsule guidance candidates without owning Capsule identity', () => {
  const source = input();
  const planningContext = source.taskCapsule.planningContext;
  const plan = compileReadPlan({
    ...source,
    taskCapsule: capsule({
      ...planningContext,
      skillCandidateIds: ['candidate-defined-skill']
    })
  });
  expect(() => projectSkillEnvelopeFromReadPlan(plan))
    .toThrow(/not in the trusted Skill registry/u);
});

test('Task Capsule digest binds all planning content and scope proposal rejects escape', () => {
  const malformed = input();
  expect(() => compileReadPlan({
    ...malformed,
    taskCapsule: {
      ...malformed.taskCapsule,
      planningContext: { ...malformed.taskCapsule.planningContext, role: 'a0' }
    }
  })).toThrow(/complete planning content/u);

  const planningContext = malformed.taskCapsule.planningContext;
  expect(() => compileReadPlan({
    ...malformed,
    taskCapsule: capsule({
      ...planningContext,
      scopeProposal: {
        ...planningContext.scopeProposal,
        writePaths: ['scripts/'],
        forbiddenPaths: ['scripts/codex/protected.ts'],
        changedPaths: []
      }
    })
  })).toThrow(/overlaps forbidden/u);

  expect(() => compileReadPlan({
    ...malformed,
    taskCapsule: capsule({
      ...planningContext,
      scopeProposal: {
        ...planningContext.scopeProposal,
        writePaths: ['docs/'],
        changedPaths: ['src/adapters/self-hosting/control/agent/read-plan.ts']
      }
    })
  })).toThrow(/outside every proposed write path/u);
});

test('maintainer mutation accepts current state or returns typed conflict without resurrection', () => {
  expect(resolveMaintainerMutation({
    resourceKind: 'external-worktree',
    snapshotRevision: 'old',
    currentRevision: 'maintainer-new',
    conflictsWithOperation: false,
    restoreAuthority: 'none',
    casPrecondition: 'not-applicable'
  })).toMatchObject({
    status: 'accept-current',
    authoritativeRevision: 'maintainer-new',
    oldObservationStale: true,
    effectDisposition: 'no-effect'
  });
  expect(resolveMaintainerMutation({
    resourceKind: 'external-worktree',
    snapshotRevision: 'old',
    currentRevision: 'maintainer-new',
    conflictsWithOperation: true,
    restoreAuthority: 'none',
    casPrecondition: 'not-applicable'
  }).status).toBe('external-maintainer-mutation');
});

test('protected root rejects operation-owned CAS while explicit restore remains separate', () => {
  const blocked = resolveMaintainerMutation({
    resourceKind: 'protected-interactive-root',
    snapshotRevision: 'old',
    currentRevision: 'current',
    conflictsWithOperation: true,
    restoreAuthority: 'operation-owned-cas-claimed',
    casPrecondition: 'matched'
  });
  expect(blocked).toMatchObject({
    status: 'external-maintainer-mutation',
    effectDisposition: 'separate-verified-executor-required',
    reasonCode: 'protected-root-outside-candidate-authority'
  });
  expect(resolveMaintainerMutation({
    resourceKind: 'protected-interactive-root',
    snapshotRevision: 'old',
    currentRevision: 'current',
    conflictsWithOperation: true,
    restoreAuthority: 'explicit-user-request-claimed',
    casPrecondition: 'not-applicable'
  })).toMatchObject({
    status: 'external-maintainer-mutation',
    effectDisposition: 'separate-verified-executor-required'
  });
});
