import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { expect, test } from 'bun:test';

import {
  SEC_SKILL_APPLICABILITY_SCHEMA,
  type SecSkillApplicabilityDecisionV1,
  type SecSkillApplicabilityEnvelopeV1
} from '../../platform/shared/agent-skill-contract.ts';

const REPOSITORY_ROOT = path.resolve(import.meta.dir, '../..');

function gitOutput(args: string[]): string {
  const result = spawnSync('git', args, { cwd: REPOSITORY_ROOT, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

function runCli(
  envelope: SecSkillApplicabilityEnvelopeV1,
  extraArgs: string[] = []
): SecSkillApplicabilityDecisionV1 {
  const result = spawnSync(
    process.execPath,
    ['scripts/codex/skill-applicability.ts', '--envelope', JSON.stringify(envelope), ...extraArgs],
    { cwd: REPOSITORY_ROOT, encoding: 'utf8', windowsHide: true }
  );
  if (result.status !== 0) {
    throw new Error(`skill-applicability CLI failed (${result.status}): ${result.stderr.trim()}`);
  }
  const decision = JSON.parse(result.stdout) as SecSkillApplicabilityDecisionV1;
  expect(decision.schema).toBe(SEC_SKILL_APPLICABILITY_SCHEMA);
  return decision;
}

const HEAD = gitOutput(['rev-parse', 'HEAD']);

function envelope(overrides: Partial<SecSkillApplicabilityEnvelopeV1> = {}): SecSkillApplicabilityEnvelopeV1 {
  return {
    role: 'worker',
    operationKind: 'implement',
    goalDigest: 'contract-goal',
    trustedRevision: HEAD,
    targetCandidate: 'feat/skill-applicability-gate-v1',
    availableCapabilities: ['git', 'github', 'hosted-gate'],
    ...overrides
  };
}

test('CLI consumes a real operation envelope and selects the single trusted Skill', () => {
  const decision = runCli(envelope({
    candidates: ['sec-worker-development', 'sec-repository-audit'],
    authorizedWritePaths: ['platform/shared/']
  }), ['--base', HEAD, '--head', HEAD]);
  expect(decision.status).toBe('applicable');
  expect(decision.selectedSkillId).toBe('sec-worker-development');
  expect(decision.trustedRevision).toBe(HEAD);
});

test('CLI resolves none-required for a simple operation with zero candidates', () => {
  const decision = runCli(envelope({ candidates: [] }));
  expect(decision.status).toBe('none-required');
  expect(decision.selectedSkillId).toBeNull();
  expect(decision.reasonCodes).toContain('none-required');
});

test('CLI resolves ambiguous when multiple candidates survive without unique evidence', () => {
  const decision = runCli(envelope({
    role: 'a0',
    operationKind: 'govern',
    candidates: ['sec-work-package-lifecycle', 'sec-task-delegation']
  }));
  expect(decision.status).toBe('ambiguous');
  expect(decision.selectedSkillId).toBeNull();
});

test('CLI resolves conflict when a candidate requires beyond the authorized scope', () => {
  const decision = runCli(envelope({
    role: 'a0',
    operationKind: 'integrate',
    candidates: ['sec-ci-and-merge'],
    availableCapabilities: ['git', 'github', 'hosted-gate'],
    authorizedGates: ['hosted-gate']
  }));
  expect(decision.status).toBe('conflict');
  expect(decision.reasonCodes).toContain('conflict-resource');
});

test('CLI binds trusted and candidate blob revisions for quarantined changed paths', () => {
  const expectedTrustedBlob = gitOutput(['rev-parse', `HEAD:AGENTS.md`]);
  const decision = runCli(envelope({
    candidates: ['sec-worker-development'],
    changedPaths: ['AGENTS.md', 'platform/shared/ci-contract.ts']
  }), ['--base', HEAD, '--head', HEAD]);
  expect(decision.status).toBe('applicable');
  expect(decision.quarantinePaths).toEqual(['AGENTS.md']);
  expect(decision.trustedSkillRevision).toBe(expectedTrustedBlob);
  expect(decision.candidateSkillRevision).toBe(expectedTrustedBlob);
  expect(decision.reasonCodes).toEqual(
    expect.arrayContaining(['candidate-quarantine', 'quarantine-binds-trusted-revision'])
  );
});

test('CLI marks a prior decision stale when goal or envelope bindings change', () => {
  const prior = runCli(envelope({
    candidates: ['sec-worker-development'],
    authorizedWritePaths: ['platform/shared/']
  }));
  expect(prior.status).toBe('applicable');
  const stale = runCli(envelope({
    candidates: ['sec-worker-development'],
    authorizedWritePaths: ['platform/shared/'],
    goalDigest: 'changed-goal',
    priorDecision: prior
  }));
  expect(stale.status).toBe('stale');
  expect(stale.selectedSkillId).toBeNull();
  expect(stale.invalidationConditions).toContain('goal-digest');
  expect(stale.reasonCodes).toEqual(['stale']);
});

test('CLI fails closed for malformed envelopes', () => {
  const result = spawnSync(
    process.execPath,
    ['scripts/codex/skill-applicability.ts', '--envelope', JSON.stringify({ role: 'root' })],
    { cwd: REPOSITORY_ROOT, encoding: 'utf8', windowsHide: true }
  );
  expect(result.status).toBe(0);
  const decision = JSON.parse(result.stdout) as SecSkillApplicabilityDecisionV1;
  expect(decision.status).toBe('unresolved');
  expect(decision.reasonCodes).toEqual(['unresolved-invalid-role']);
});
