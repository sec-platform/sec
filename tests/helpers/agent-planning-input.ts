import type { OperationReadPlanInput } from '../../src/adapters/self-hosting/control/agent/read-plan.ts';
import type { TaskCapsulePlanningContext } from '../../src/adapters/self-hosting/control/agent/task-capsule.ts';

// Fresh, authority-free fixture inputs. Compilation and expected results stay
// with each consumer; no produced decision is reused as an oracle.
export function agentPlanningContext(
  overrides: Partial<TaskCapsulePlanningContext> = {}
): TaskCapsulePlanningContext {
  return {
    operationId: 'issue-346-contract', role: 'worker', operationKind: 'implement',
    goalDigest: `sha256:${'b'.repeat(64)}`,
    trustedRevision: 'a'.repeat(40), targetCandidate: 'a'.repeat(40),
    workPackageProposalRef: 'config/repository/work-packages/task-capsule-compiler-v1.md',
    workPackageProposalDigest: `sha256:${'c'.repeat(64)}`,
    workPackageProjectionId: `sha256:${'e'.repeat(64)}`, scopeGrantId: null,
    ownerFacts: [{
      id: 'development-governance', ref: 'docs/开发/AI协作/规则装载与任务恢复.md',
      owner: 'development-governance-owner', revision: 'owner-revision-v1'
    }],
    scopeProposal: {
      readPaths: ['docs/开发/AI协作/规则装载与任务恢复.md'],
      writePaths: ['platform/shared/'], forbiddenPaths: ['.agents/skills/'],
      authorizedResources: [], authorizedGates: [], changedPaths: []
    },
    verificationObligations: [{
      id: 'operation-read-plan-focused', revision: 'v1', reasonCode: 'public-contract-change'
    }],
    skillCandidateIds: ['worker-development'],
    ...overrides
  };
}

export function agentReadPlanInput(
  taskCapsule: OperationReadPlanInput['taskCapsule'],
  overrides: Partial<Omit<OperationReadPlanInput, 'taskCapsule'>> = {}
): OperationReadPlanInput {
  return {
    schema: 'sec-operation-read-plan-input-v2', taskCapsule,
    requiredRefs: [{
      id: 'development-governance', ref: 'docs/开发/AI协作/规则装载与任务恢复.md',
      owner: 'development-governance-owner', revision: 'owner-revision-v1',
      reasonCode: 'canonical-operation-owner', projection: null
    }],
    conditionalRefs: [],
    forbiddenSources: [
      'assistant-memory', 'chat-history', 'full-issue-census', 'full-skill-corpus',
      'historical-pr-comments', 'unrelated-issue-census'
    ],
    maxSkillBodies: 1, unresolvedFrontier: [], readReceipts: [], invalidationInputs: [],
    ...overrides
  };
}
