import { expect, test } from 'bun:test';

import {
  compileSecOperationReadPlanV1,
  parseSecOperationReadPlanV1,
  projectSecSkillEnvelopeFromOperationReadPlanV1,
  resolveSecMaintainerMutationV1,
  SEC_OPERATION_READ_PLAN_INPUT_SCHEMA,
  SEC_TASK_CAPSULE_AUTHORITY_REVISION,
  SEC_TASK_CAPSULE_AUTHORITY_SCHEMA,
  type SecDigestV1,
  type SecOperationReadPlanInputV1,
  type SecTaskCapsuleAuthorityV1
} from '../../platform/shared/agent-operation-read-plan-contract.ts';
import { sha256 } from '../../platform/shared/canonical-primitives.ts';

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
    ref: 'urn:sec:task-capsule:issue-346',
    revision: SEC_TASK_CAPSULE_AUTHORITY_REVISION,
    authority: normalizedAuthority
  };
  return { ...projection, digest: sha256(projection) as SecDigestV1 };
}

function input(): SecOperationReadPlanInputV1 {
  return {
    schema: SEC_OPERATION_READ_PLAN_INPUT_SCHEMA,
    taskCapsule: capsule({
      operationId: 'issue-346-read-plan',
      role: 'worker',
      operationKind: 'implement',
      goalDigest: digest('b'),
      trustedRevision: '6b7f1a3f54b0b4bdd8eef4c065e1e83607f6bbcb',
      targetCandidate: 'ef922744393d451a037349197fe4dd57d6ae8497',
      workPackageAuthorizationRef: 'docs/work-packages/agent-operation-read-plan-v1.md',
      workPackageAuthorizationDigest: digest('c'),
      ownerFacts: [
        {
          id: 'work-package',
          ref: 'docs/work-packages/agent-operation-read-plan-v1.md',
          owner: 'development-governance-owner',
          revision: digest('c')
        },
        {
          id: 'authority-registry',
          ref: 'docs/authority.json',
          owner: 'documentation-authority-owner',
          revision: 'blob-authority-v1'
        }
      ],
      scope: {
        readPaths: ['docs/', 'platform/shared/'],
        writePaths: ['platform/shared/'],
        forbiddenPaths: ['.agents/skills/', '.github/workflows/'],
        availableCapabilities: ['git'],
        authorizedResources: ['github:issue/346/comments'],
        authorizedGates: [],
        changedPaths: ['platform/shared/agent-operation-read-plan-contract.ts']
      },
      verificationObligations: [
        { id: 'focused-contracts', revision: 'v1', reasonCode: 'public-contract-change' }
      ],
      skillCandidateIds: ['sec-worker-development']
    }),
    requiredRefs: [
      {
        id: 'authority',
        ref: 'docs/authority.json',
        owner: 'documentation-authority-owner',
        revision: 'blob-authority-v1',
        reasonCode: 'resolve-canonical-owner'
      },
      {
        id: 'manifest',
        ref: 'docs/work-packages/agent-operation-read-plan-v1.md',
        owner: 'development-governance-owner',
        revision: digest('c'),
        reasonCode: 'bind-operation-scope'
      }
    ],
    conditionalRefs: [
      {
        id: 'historical-issue-context',
        ref: 'github:issue/346/comments',
        owner: 'github-provider',
        revision: 'provider-snapshot-v1',
        reasonCode: 'resolve-missing-acceptance-detail',
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
  const first = compileSecOperationReadPlanV1(input());
  const source = input();
  const second = compileSecOperationReadPlanV1({
    ...source,
    taskCapsule: {
      ...source.taskCapsule,
      authority: {
        ...source.taskCapsule.authority,
        ownerFacts: [...source.taskCapsule.authority.ownerFacts].reverse(),
        scope: {
          ...source.taskCapsule.authority.scope,
          readPaths: [...source.taskCapsule.authority.scope.readPaths].reverse()
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
  expect(() => compileSecOperationReadPlanV1({
    ...malformed,
    unresolvedFrontier: []
  })).toThrow(/not admitted by frontier/u);
});

test('one operation context rejects duplicate source refs even under different ids', () => {
  const malformed = input();
  expect(() => compileSecOperationReadPlanV1({
    ...malformed,
    conditionalRefs: [{
      ...malformed.conditionalRefs[0]!,
      ref: malformed.requiredRefs[0]!.ref
    }]
  })).toThrow(/source ref may occur only once/u);
});

test('read refs stay inside Capsule scope and mandatory deny sources cannot be removed', () => {
  const source = input();
  expect(() => compileSecOperationReadPlanV1({
    ...source,
    requiredRefs: [{ ...source.requiredRefs[0]!, ref: 'README.md' }]
  })).toThrow(/outside the trusted Capsule read scope/u);
  expect(() => compileSecOperationReadPlanV1({
    ...source,
    forbiddenSources: source.forbiddenSources.filter((value) => value !== 'assistant-memory')
  })).toThrow(/omits mandatory baseline source/u);
});

test('read receipt binds planned owner revision reason and bytes', () => {
  const malformed = input();
  expect(() => compileSecOperationReadPlanV1({
    ...malformed,
    readReceipts: [{ ...malformed.readReceipts[0]!, owner: 'wrong-owner' }]
  })).toThrow(/planned owner, revision, and reason/u);
});

test('plan parser rejects tampering and Skill projection carries exact upstream capsule identity', () => {
  const plan = compileSecOperationReadPlanV1(input());
  const envelope = projectSecSkillEnvelopeFromOperationReadPlanV1(plan);
  expect(envelope.taskCapsuleRef).toBe(plan.taskCapsule.ref);
  expect(envelope.taskCapsuleDigest).toBe(plan.taskCapsule.digest);
  expect(envelope.taskCapsuleRevision).toBe(plan.taskCapsule.revision);
  expect(() => parseSecOperationReadPlanV1({
    ...plan,
    readPlanDigest: digest('f')
  })).toThrow(/readPlanDigest mismatch/u);
});

test('zero Skill-body budget rejects selectable candidates', () => {
  const malformed = input();
  expect(() => compileSecOperationReadPlanV1({
    ...malformed,
    maxSkillBodies: 0
  })).toThrow(/skillCandidateIds must be empty/u);
});

test('Task Capsule digest binds every authority field and scope rejects ancestor overlap or changed-path escape', () => {
  const malformed = input();
  expect(() => compileSecOperationReadPlanV1({
    ...malformed,
    taskCapsule: {
      ...malformed.taskCapsule,
      authority: { ...malformed.taskCapsule.authority, role: 'a0' }
    }
  })).toThrow(/complete authority projection/u);

  const authority = malformed.taskCapsule.authority;
  expect(() => compileSecOperationReadPlanV1({
    ...malformed,
    taskCapsule: capsule({
      ...authority,
      scope: {
        ...authority.scope,
        writePaths: ['scripts/'],
        forbiddenPaths: ['scripts/codex/protected.ts'],
        changedPaths: []
      }
    })
  })).toThrow(/overlaps forbidden/u);

  expect(() => compileSecOperationReadPlanV1({
    ...malformed,
    taskCapsule: capsule({
      ...authority,
      scope: {
        ...authority.scope,
        writePaths: ['docs/'],
        changedPaths: ['platform/shared/agent-operation-read-plan-contract.ts']
      }
    })
  })).toThrow(/outside every authorized write path/u);
});

test('maintainer mutation accepts current state or returns typed conflict without resurrection', () => {
  expect(resolveSecMaintainerMutationV1({
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
  expect(resolveSecMaintainerMutationV1({
    resourceKind: 'external-worktree',
    snapshotRevision: 'old',
    currentRevision: 'maintainer-new',
    conflictsWithOperation: true,
    restoreAuthority: 'none',
    casPrecondition: 'not-applicable'
  }).status).toBe('external-maintainer-mutation');
});

test('protected root rejects operation-owned CAS while explicit restore remains separate', () => {
  const blocked = resolveSecMaintainerMutationV1({
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
  expect(resolveSecMaintainerMutationV1({
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
