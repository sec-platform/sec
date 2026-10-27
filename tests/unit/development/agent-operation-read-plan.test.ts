import { expect, test } from 'bun:test';
import { agentPlanningContext, agentReadPlanInput } from '../../helpers/agent-planning-input.ts';
import { evaluateSkillApplicability } from '../../../src/adapters/self-hosting/control/agent/skill.ts';

import {
  compileOperationReadPlan,
  parseOperationReadPlan,
  projectSkillApplicabilityEnvelopeFromOperationReadPlan,
  type OperationReadPlanInput
} from '../../../src/adapters/self-hosting/control/agent/read-plan.ts';
import {
  compileTaskCapsule,
  TASK_CAPSULE_INPUT_SCHEMA,
  type AgentContentDigest,
  type TaskCapsulePlanningContext
} from '../../../src/adapters/self-hosting/control/agent/task-capsule.ts';

const digest = (character: string): AgentContentDigest => `sha256:${character.repeat(64)}`;

function capsule(planningContext: TaskCapsulePlanningContext): OperationReadPlanInput['taskCapsule'] {
  return compileTaskCapsule({
    schema: TASK_CAPSULE_INPUT_SCHEMA,
    ref: 'urn:sec:task-capsule:issue-346',
    planningContext
  });
}

// The Capsule is immutable planning content, not a live activation or read-plan result.
const baselineCapsule = capsule(agentPlanningContext({
    operationId: 'issue-346-read-plan',
    skillCandidateIds: ['worker-development', 'repository-audit'],
    trustedRevision: '6b7f1a3f54b0b4bdd8eef4c065e1e83607f6bbcb',
    targetCandidate: 'ef922744393d451a037349197fe4dd57d6ae8497',
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
      writePaths: ['src/adapters/self-hosting/control/agent/', 'AGENTS.md', 'product.ts'],
      forbiddenPaths: ['.agents/skills/', '.github/workflows/'],
      authorizedResources: ['github:issue/346/comments'],
      authorizedGates: ['hosted-gate'],
      changedPaths: ['AGENTS.md', 'product.ts']
    },
    verificationObligations: [
      { id: 'focused-contracts', revision: 'v1', reasonCode: 'public-contract-change' }
    ]
  }));

function input(): OperationReadPlanInput {
  return agentReadPlanInput(baselineCapsule, {
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
  });
}

test('Read Plan compiles deterministically while referencing rather than redefining Task Capsule', () => {
  const first = compileOperationReadPlan(input());
  const source = input();
  const second = compileOperationReadPlan({
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
  expect(first.taskCapsule).toEqual(source.taskCapsule);
  expect(first.preApplicabilitySkillBodiesRead).toBe(0);
  expect(first.maxSkillBodies).toBe(1);
  expect(first.maintainerMutationPolicy).toBe('current-physical-state-authoritative-v1');
  expect(first.protectedRootPolicy).toBe('outside-candidate-write-authority-v1');
  const envelope = projectSkillApplicabilityEnvelopeFromOperationReadPlan(first);
  expect(envelope.taskCapsuleRef).toBe(first.taskCapsule.ref);
  expect(envelope.taskCapsuleDigest).toBe(first.taskCapsule.digest);
  expect(envelope.taskCapsuleRevision).toBe(first.taskCapsule.revision);
  expect(envelope.candidates).toEqual(['repository-audit', 'worker-development']);
  expect(envelope.changedPaths).toEqual(['AGENTS.md', 'product.ts']);
  const decision = evaluateSkillApplicability(envelope);
  expect(decision.status).toBe('applicable');
  expect(decision.selectedSkillId).toBe('worker-development');
  expect(decision.quarantinePaths).toEqual(['AGENTS.md']);
  expect('scopeConflicts' in decision).toBeFalse();
  expect(() => parseOperationReadPlan({
    ...first,
    readPlanDigest: digest('f')
  })).toThrow(/readPlanDigest mismatch/u);
});

test('conditional reads require an explicit bidirectional frontier', () => {
  const malformed = input();
  expect(() => compileOperationReadPlan({
    ...malformed,
    unresolvedFrontier: []
  })).toThrow(/not admitted by frontier/u);
});

test('one operation context rejects duplicate source refs even under different ids', () => {
  const malformed = input();
  expect(() => compileOperationReadPlan({
    ...malformed,
    conditionalRefs: [{
      ...malformed.conditionalRefs[0]!,
      ref: malformed.requiredRefs[0]!.ref
    }]
  })).toThrow(/source ref may occur only once/u);
});

test('read refs stay inside Capsule scope and mandatory deny sources cannot be removed', () => {
  const source = input();
  expect(() => compileOperationReadPlan({
    ...source,
    requiredRefs: [{ ...source.requiredRefs[0]!, ref: 'README.md' }]
  })).toThrow(/outside the Capsule read proposal/u);
  expect(() => compileOperationReadPlan({
    ...source,
    forbiddenSources: source.forbiddenSources.filter((value) => value !== 'assistant-memory')
  })).toThrow(/omits mandatory baseline source/u);
});

test('read receipt rejects an owner different from the planned reference', () => {
  const malformed = input();
  expect(() => compileOperationReadPlan({
    ...malformed,
    readReceipts: [{ ...malformed.readReceipts[0]!, owner: 'wrong-owner' }]
  })).toThrow(/planned owner, revision, and reason/u);
});

test('retired documentation clause projections cannot re-enter the read contract', () => {
  const source = input();
  expect(() => compileOperationReadPlan({
    ...source,
    requiredRefs: [{
      ...source.requiredRefs[0]!,
      projection: { kind: 'markdown-clauses' } as never
    }]
  })).toThrow(/projection is unsupported/u);
});

test('zero Skill-body budget admits only an empty selection before any body read', () => {
  const malformed = input();
  const empty = compileOperationReadPlan({
    ...malformed,
    taskCapsule: capsule({ ...malformed.taskCapsule.planningContext, skillCandidateIds: [] }),
    maxSkillBodies: 0
  });
  expect(empty.preApplicabilitySkillBodiesRead).toBe(0);
  const decision = evaluateSkillApplicability(projectSkillApplicabilityEnvelopeFromOperationReadPlan(empty));
  expect(decision.status).toBe('none-required');
  expect(decision.selectedSkillId).toBeNull();
  expect(decision.reasonCodes).toContain('none-required');
  expect(decision.candidateSkillIds).toEqual([]);
  expect(() => compileOperationReadPlan({
    ...malformed,
    maxSkillBodies: 0
  })).toThrow(/skillCandidateIds must be empty/u);
});

test('Skill registry validates Capsule guidance candidates without owning Capsule identity', () => {
  const source = input();
  const planningContext = source.taskCapsule.planningContext;
  const plan = compileOperationReadPlan({
    ...source,
    taskCapsule: capsule({
      ...planningContext,
      skillCandidateIds: ['candidate-defined-skill']
    })
  });
  expect(() => projectSkillApplicabilityEnvelopeFromOperationReadPlan(plan))
    .toThrow(/not in the trusted Skill registry/u);
});

test('Read Plan rejects a Capsule whose role changed without rebinding its digest', () => {
  const malformed = input();
  expect(() => compileOperationReadPlan({
    ...malformed,
    taskCapsule: {
      ...malformed.taskCapsule,
      planningContext: { ...malformed.taskCapsule.planningContext, role: 'a0' }
    }
  })).toThrow(/complete planning content/u);
});
