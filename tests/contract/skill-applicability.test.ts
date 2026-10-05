import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gitProtocolSuccess, inGitProtocolRepository } from '../testkit/git-protocol.ts';

import { expect, test } from 'bun:test';
import { canonicalGitChildEnvironment } from '../../src/adapters/providers/git/environment.ts';
import { observeOperationAuthorityOwners } from '../../src/adapters/self-hosting/control/agent/agent-operation-activation.ts';
import { assertWorkerOperationReadPlanMatches, projectWorkerOperationReadClosure } from '../../src/adapters/self-hosting/control/agent/operation-read-plan.ts';
import { projectWorkerTaskCapsuleObservation } from '../../src/adapters/self-hosting/control/agent/task-capsule-host.ts';
import { parseDocumentationIdentityRegistry } from '../../src/adapters/self-hosting/control/documentation/active.ts';
import { CodexDevelopmentParseCurrentWorkPackageManifest } from '../../src/adapters/self-hosting/control/task/contract/work-package.ts';
import { rawSha256 } from '../../src/contracts/canonical.ts';


import {
  compileSecOperationReadPlan,
  projectSecSkillEnvelopeFromOperationReadPlan,
  SEC_OPERATION_READ_PLAN_INPUT_SCHEMA,
  type SecOperationReadPlanInput
} from '../../src/adapters/self-hosting/control/agent/read-plan.ts';
import {
  evaluateSecSkillApplicability,
  isSecSkillQuarantinePath,
  SEC_SKILL_QUARANTINE_EXACT_PATHS,
  type SecAgentRole,
  type SecAgentSkillId,
  type SecOperationKind,
  type SecSkillApplicabilityDecision
} from '../../src/adapters/self-hosting/control/agent/skill.ts';
import {
  compileSecTaskCapsule,
  SEC_TASK_CAPSULE_INPUT_SCHEMA,
  type SecDigest,
  type SecTaskCapsulePlanningContext
} from '../../src/adapters/self-hosting/control/agent/task-capsule.ts';

const REPOSITORY_ROOT = path.resolve(import.meta.dir, '../..');
const digest = (character: string): SecDigest => `sha256:${character.repeat(64)}`;

function capsule(planningContext: SecTaskCapsulePlanningContext): SecOperationReadPlanInput['taskCapsule'] {
  return compileSecTaskCapsule({
    schema: SEC_TASK_CAPSULE_INPUT_SCHEMA,
    ref: 'urn:sec:task-capsule:skill-applicability-contract',
    planningContext
  });
}

function gitOutput(args: readonly string[]): string {
  const result = spawnSync('git', args, {
    cwd: REPOSITORY_ROOT,
    env: canonicalGitChildEnvironment(),
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

function gitOutputOrNull(args: readonly string[]): string | null {
  const result = spawnSync('git', args, {
    cwd: REPOSITORY_ROOT,
    env: canonicalGitChildEnvironment(),
    encoding: 'utf8',
    windowsHide: true
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

function gitNulPaths(args: readonly string[]): string[] {
  const result = spawnSync('git', args, {
    cwd: REPOSITORY_ROOT,
    env: canonicalGitChildEnvironment(),
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.split('\0').filter((entry) => entry.length > 0);
}

function changedPaths(base: string, head: string): string[] {
  return [...new Set(gitNulPaths(['diff', '--name-only', '-z', base, head]))].sort();
}

function planInput(overrides: {
  role?: SecAgentRole;
  operationKind?: SecOperationKind;
  candidates?: readonly SecAgentSkillId[];
  authorizedResources?: readonly string[];
  authorizedGates?: readonly string[];
  writePaths?: readonly string[];
  forbiddenPaths?: readonly string[];
  base?: string;
  head?: string;
  changedPaths?: readonly string[];
} = {}): SecOperationReadPlanInput {
  const head = overrides.head ?? gitOutput(['rev-parse', 'HEAD']);
  const base = overrides.base ?? head;
  const candidates = overrides.candidates ?? ['worker-development'];
  const observedChangedPaths = overrides.changedPaths ?? changedPaths(base, head);
  return {
    schema: SEC_OPERATION_READ_PLAN_INPUT_SCHEMA,
    taskCapsule: capsule({
      operationId: 'skill-applicability-contract',
      role: overrides.role ?? 'worker',
      operationKind: overrides.operationKind ?? 'implement',
      goalDigest: digest('b'),
      trustedRevision: base,
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
        writePaths: overrides.writePaths ?? (observedChangedPaths.length > 0
          ? observedChangedPaths
          : ['platform/shared/']),
        forbiddenPaths: overrides.forbiddenPaths ?? [],
        authorizedResources: overrides.authorizedResources ?? [],
        authorizedGates: overrides.authorizedGates ?? [],
        changedPaths: observedChangedPaths
      },
      verificationObligations: [],
      skillCandidateIds: candidates
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
    maxSkillBodies: candidates.length === 0 ? 0 : 1,
    unresolvedFrontier: [],
    readReceipts: [],
    invalidationInputs: []
  };
}

function evaluatePlan(input: SecOperationReadPlanInput): SecSkillApplicabilityDecision {
  const plan = compileSecOperationReadPlan(input);
  const envelope = projectSecSkillEnvelopeFromOperationReadPlan(plan);
  const trustedSkillRevisions: Record<string, string> = {};
  const candidateSkillRevisions: Record<string, string> = {};
  for (const repositoryPath of (envelope.changedPaths ?? []).filter(isSecSkillQuarantinePath)) {
    const trusted = gitOutputOrNull(['rev-parse', '--verify', `${envelope.trustedRevision}:${repositoryPath}`]);
    const candidate = gitOutputOrNull(['rev-parse', '--verify', `${envelope.targetCandidate}:${repositoryPath}`]);
    if (trusted !== null && /^[0-9a-f]{40,64}$/u.test(trusted)) {
      trustedSkillRevisions[repositoryPath] = trusted;
    }
    if (candidate !== null && /^[0-9a-f]{40,64}$/u.test(candidate)) {
      candidateSkillRevisions[repositoryPath] = candidate;
    }
  }
  const decision = evaluateSecSkillApplicability({
    ...envelope,
    trustedSkillRevisions,
    candidateSkillRevisions
  });
  return decision;
}

test('verified Read Plan selects the single trusted Skill', () => {
  const decision = evaluatePlan(planInput());
  expect(decision.status).toBe('applicable');
  expect(decision.selectedSkillId).toBe('worker-development');
});

test('zero candidates and zero body budget resolve none-required', () => {
  const decision = evaluatePlan(planInput({ candidates: [] }));
  expect(decision.status).toBe('none-required');
  expect(decision.selectedSkillId).toBeNull();
});

test('multiple surviving metadata candidates resolve ambiguous before any body read', () => {
  const decision = evaluatePlan(planInput({
    role: 'a0',
    operationKind: 'design',
    candidates: ['architecture-evolution', 'heuristic-governance'],
    writePaths: []
  }));
  expect(decision.status).toBe('ambiguous');
  expect(decision.selectedSkillId).toBeNull();
});

test('Skill selection remains orthogonal to Task Capsule write and resource authority', () => {
  const decision = evaluatePlan(planInput({
    role: 'a0',
    operationKind: 'design',
    candidates: ['architecture-evolution'],
    writePaths: [],
    forbiddenPaths: ['docs/'],
    authorizedResources: ['github-api'],
    authorizedGates: ['hosted-gate']
  }));
  expect(decision.status).toBe('applicable');
  expect(decision.selectedSkillId).toBe('architecture-evolution');
  expect('scopeConflicts' in decision).toBeFalse();
});

test('candidate quarantine revisions are derived from exact Git objects', async () => {
  await inGitProtocolRepository(async (root, git) => {
    const repositoryPath = SEC_SKILL_QUARANTINE_EXACT_PATHS[0];
    writeFileSync(path.join(root, repositoryPath), 'Trusted fixture guidance\n');
    gitProtocolSuccess(git(['add', '--', repositoryPath]));
    gitProtocolSuccess(git(['commit', '--quiet', '-m', 'trusted fixture']));
    const base = gitProtocolSuccess(git(['rev-parse', 'HEAD'])).trim();
    const trustedBlob = gitProtocolSuccess(git(['rev-parse', `${base}:${repositoryPath}`])).trim();
    writeFileSync(path.join(root, repositoryPath), 'Candidate fixture guidance\n');
    gitProtocolSuccess(git(['add', '--', repositoryPath]));
    gitProtocolSuccess(git(['commit', '--quiet', '-m', 'candidate fixture']));
    const head = gitProtocolSuccess(git(['rev-parse', 'HEAD'])).trim();
    const candidateBlob = gitProtocolSuccess(git(['rev-parse', `${head}:${repositoryPath}`])).trim();
    const changed = gitProtocolSuccess(git(['diff', '--name-only', '-z', base, head])).split('\0').filter(Boolean);
    const plan = compileSecOperationReadPlan(planInput({ base, head, changedPaths: changed }));
    const decision = evaluateSecSkillApplicability({
      ...projectSecSkillEnvelopeFromOperationReadPlan(plan),
      trustedSkillRevisions: { [repositoryPath]: trustedBlob },
      candidateSkillRevisions: { [repositoryPath]: candidateBlob }
    });
    expect(trustedBlob).not.toBe(candidateBlob);
    expect(decision.quarantinePaths).toEqual([repositoryPath]);
    expect(decision.trustedSkillRevision).toBe(trustedBlob);
    expect(decision.candidateSkillRevision).toBe(candidateBlob);
    expect(decision.reasonCodes).toEqual(
      expect.arrayContaining(['candidate-quarantine', 'quarantine-binds-trusted-revision'])
    );
  });
});


test.skipIf(process.platform !== 'linux')('FINAL successor rule-loading owner stays trusted through real observation, Capsule and Read Plan comparison', async () => {
  const manifestPath = 'config/repository/work-packages/repository-closeout-20260927-v1.md';
  const manifestBytes = readFileSync(path.join(REPOSITORY_ROOT, manifestPath));
  const baseManifest = CodexDevelopmentParseCurrentWorkPackageManifest(manifestBytes.toString('utf8'), manifestPath);
  const guidance = 'docs/开发/AI协作/规则装载与任务恢复.md';
  expect(baseManifest.tasks.some(task => task.ownedPaths.includes(guidance))).toBe(true);
  expect(baseManifest.forbiddenPaths).toContain('AGENTS.md');
  const registryPath = '.documentation/documents.json';
  const registryBytes = readFileSync(path.join(REPOSITORY_ROOT, registryPath));
  const registry = parseDocumentationIdentityRegistry(registryBytes.toString('utf8'));
  const manifest = { ...baseManifest, authorityRefs: [registry.documents.find(record => record.path === guidance)!.documentId] };
  const observedPaths = [...new Set(['AGENTS.md', guidance, ...registry.documents
    .filter(record => manifest.authorityRefs?.includes(record.documentId)).map(record => record.path)])];
  await inGitProtocolRepository(async (root, git) => {
    mkdirSync(path.join(root, '.documentation'), { recursive: true });
    writeFileSync(path.join(root, registryPath), registryBytes);
    for (const repositoryPath of observedPaths) {
      mkdirSync(path.dirname(path.join(root, repositoryPath)), { recursive: true });
      writeFileSync(path.join(root, repositoryPath), `trusted ${repositoryPath}\n`);
    }
    gitProtocolSuccess(git(['add', '--', registryPath, ...observedPaths]));
    gitProtocolSuccess(git(['commit', '--quiet', '-m', 'trusted registered owner fixtures']));
    const trustedRevision = gitProtocolSuccess(git(['rev-parse', 'HEAD'])).trim();
    writeFileSync(path.join(root, guidance), 'candidate replacement guidance\n');
    gitProtocolSuccess(git(['add', '--', guidance]));
    gitProtocolSuccess(git(['commit', '--quiet', '-m', 'FINAL rule-loading fixture']));
    const targetCandidate = gitProtocolSuccess(git(['rev-parse', 'HEAD'])).trim();
    // Current published package is not activation-ready: preserve its missing-authorityRefs refusal.
    expect(() => observeOperationAuthorityOwners(root, trustedRevision, targetCandidate, baseManifest, [guidance]))
      .toThrow('activation-scope-conflict');
    // This successor fixture supplies the required registry-bound refs, without
    // claiming a hosted activation receipt or current-main package adoption.
    const authorityOwners = observeOperationAuthorityOwners(root, trustedRevision, targetCandidate, manifest, [guidance]);
    const trustedBlob = gitProtocolSuccess(git(['rev-parse', `${trustedRevision}:${guidance}`])).trim();
    const candidateBlob = gitProtocolSuccess(git(['rev-parse', `${targetCandidate}:${guidance}`])).trim();
    const owner = authorityOwners.find(entry => entry.ref === guidance)!;
    expect(owner.revision).toBe(trustedBlob);
    expect(owner.contentDigest).toBe(rawSha256(`trusted ${guidance}\n`));
    const activation = {
      phase: 'finalize' as const, manifest, manifestPath,
      manifestRevision: digest('1'), manifestDigest: rawSha256(manifestBytes),
      authorityOwners, activationDigest: digest('2'), targetCandidate, trustedRevision,
      changedPaths: [guidance], runtimeRoot: root, candidateRoot: root,
      preparation: {
        operationId: 'fixture-final-operation', role: 'worker' as const, operationKind: 'implement' as const,
        currentSpecRevision: digest('3'), trustedBaseSha: trustedRevision,
        proposal: { number: 1, baseSha: trustedRevision, headSha: trustedRevision,
          headTreeSha: gitProtocolSuccess(git(['rev-parse', `${trustedRevision}^{tree}`])).trim(),
          headRef: 'fixture', manifestPath, manifestDigest: rawSha256(manifestBytes) },
        controlDigests: { currentState: digest('4'), pointer: digest('5'), rollingPlan: digest('6') }
      }
    };
    // Only resolved-input projection is under test. This fixture neither
    // authenticates a hosted receipt nor grants an operation to an agent.
    const observation = projectWorkerOperationReadClosure(projectWorkerTaskCapsuleObservation(activation));
    expect(observation.taskCapsule.planningContext.ownerFacts.find(fact => fact.ref === guidance)?.revision)
      .toBe(trustedBlob);
    expect(observation.readClosure.requiredRefs.find(ref => ref.ref === guidance)?.revision).toBe(trustedBlob);
    expect(observation.readClosure.readReceipts.find(receipt => receipt.refId === owner.id)?.contentDigest)
      .toBe(rawSha256(`trusted ${guidance}\n`));
    const plan = compileSecOperationReadPlan({ ...observation.readClosure,
      schema: SEC_OPERATION_READ_PLAN_INPUT_SCHEMA, taskCapsule: observation.taskCapsule });
    expect(() => assertWorkerOperationReadPlanMatches(plan, observation)).not.toThrow();
    const candidateBound = projectWorkerOperationReadClosure(projectWorkerTaskCapsuleObservation({
      ...activation,
      authorityOwners: authorityOwners.map(entry => entry.ref === guidance
        ? { ...entry, revision: candidateBlob, contentDigest: rawSha256('candidate replacement guidance\n') }
        : entry)
    }));
    const forgedPlan = compileSecOperationReadPlan({ ...candidateBound.readClosure,
      schema: SEC_OPERATION_READ_PLAN_INPUT_SCHEMA, taskCapsule: candidateBound.taskCapsule });
    expect(() => assertWorkerOperationReadPlanMatches(forgedPlan, observation))
      .toThrow('Read Plan was not fully produced by the exact trusted-resolver');
  });
});
