import { expect, test } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  evaluateSecSkillApplicabilityV1,
  isSecSkillQuarantinePath,
  SEC_AGENT_SKILL_IDS,
  SEC_AGENT_SKILL_METADATA_V1,
  SEC_AGENT_SKILL_STANDARD_SECTIONS,
  type SecAgentSkillId,
  type SecSkillApplicabilityDecisionV1
} from '../../platform/shared/agent-skill-contract.ts';
import type { SecOperationReadPlanV1 } from '../../platform/shared/agent-operation-read-plan-contract.ts';
import {
  createSecSkillGuidanceProjectionV1,
  SEC_SKILL_JUDGMENT_OWNERS_V1,
  SEC_SKILL_RUNTIME_POLICY_V1
} from '../../platform/shared/agent-skill-runtime-contract.ts';
import { selectTestsForSources } from '../../platform/shared/test-impact-contract.ts';
import { readTrustedSecSkillGuidanceV1 } from '../../scripts/codex/skill-applicability.ts';

const REPOSITORY_ROOT = path.resolve(import.meta.dir, '../..');
const digest = (character: string): `sha256:${string}` => `sha256:${character.repeat(64)}`;

function git(cwd: string, args: readonly string[]): string {
  const result = spawnSync('git', [...args], {
    cwd,
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args[0] ?? ''} failed`);
  return result.stdout.trim();
}

function decision(input: Readonly<{
  status: SecSkillApplicabilityDecisionV1['status'];
  trustedRevision: string;
  targetCandidate?: string;
  selectedSkillId?: SecSkillApplicabilityDecisionV1['selectedSkillId'];
}>): SecSkillApplicabilityDecisionV1 {
  const selectedSkillId = input.selectedSkillId ?? null;
  return {
    schema: 'sec-skill-applicability-decision-v1',
    status: input.status,
    role: 'worker',
    operationKind: 'implement',
    goalDigest: digest('a'),
    trustedRevision: input.trustedRevision,
    targetCandidate: input.targetCandidate ?? input.trustedRevision,
    workPackageProposalRef: null,
    taskCapsuleRef: null,
    taskCapsuleDigest: null,
    taskCapsuleRevision: null,
    candidateSkillIds: selectedSkillId === null ? [] : [selectedSkillId],
    selectedSkillId,
    trustedSkillRevision: null,
    candidateSkillRevision: null,
    quarantinePaths: [],
    triggerEvidence: [],
    exclusionResults: [],
    capabilityAvailability: {},
    scopeConflicts: [],
    reasonCodes: [],
    invalidationConditions: []
  };
}

function admittedPlan(
  trustedRevision: string,
  skillId: SecAgentSkillId = 'sec-worker-development'
): SecOperationReadPlanV1 {
  const refId = `skill-guidance-${skillId}`;
  return {
    maxSkillBodies: 1,
    preApplicabilitySkillBodiesRead: 0,
    readPlanDigest: digest('9'),
    conditionalRefs: [{
      id: refId,
      ref: `.agents/skills/${skillId}/SKILL.md`,
      owner: skillId,
      revision: trustedRevision,
      reasonCode: 'post-applicability-guidance',
      frontierId: 'skill-guidance-applicability'
    }],
    unresolvedFrontier: [{
      id: 'skill-guidance-applicability',
      reasonCode: 'post-applicability-guidance',
      allowedRefIds: [refId]
    }]
  } as SecOperationReadPlanV1;
}

test('Skill Runtime is read-only, post-applicability and zero-or-one', () => {
  expect(SEC_SKILL_RUNTIME_POLICY_V1).toEqual({
    schema: 'sec-skill-runtime-policy-v1',
    preApplicabilitySkillBodiesRead: 0,
    maxSkillBodiesPerOperationEpoch: 1,
    bodySource: 'exact-trusted-git-object',
    inputAdmission: 'operation-read-plan-only',
    authorityReferenceSemantics: 'precedence-only-not-auto-read',
    toolCapabilitySemantics: 'operation-authority-only',
    effectAuthority: 'none',
    deterministicTransitions: 'machine-owner-only'
  });
  expect(Object.keys(SEC_SKILL_JUDGMENT_OWNERS_V1).sort()).toEqual([...SEC_AGENT_SKILL_IDS].sort());
  expect(new Set(Object.values(SEC_SKILL_JUDGMENT_OWNERS_V1)).size).toBe(SEC_AGENT_SKILL_IDS.length);
});

test('canonical Skill metadata owns no tool, resource, gate or write effect', () => {
  for (const skillId of SEC_AGENT_SKILL_IDS) {
    expect(SEC_AGENT_SKILL_METADATA_V1[skillId].requiredCapabilities).toEqual([]);
    expect(SEC_AGENT_SKILL_METADATA_V1[skillId].requiredResources).toEqual([]);
    expect(SEC_AGENT_SKILL_METADATA_V1[skillId].requiredGates).toEqual([]);
    expect(SEC_AGENT_SKILL_METADATA_V1[skillId].writeSurface).toEqual([]);
  }
  const result = evaluateSecSkillApplicabilityV1({
    role: 'a0',
    operationKind: 'design',
    goalDigest: digest('b'),
    trustedRevision: '1'.repeat(40),
    targetCandidate: '2'.repeat(40),
    candidates: ['sec-architecture-evolution'],
    availableCapabilities: [],
    authorizedResources: [],
    authorizedGates: [],
    authorizedWritePaths: [],
    forbiddenPaths: []
  });
  expect(result.status).toBe('applicable');
  expect(result.selectedSkillId).toBe('sec-architecture-evolution');
});

test('all Agent guidance/runtime surfaces participate in trusted candidate quarantine', () => {
  expect(isSecSkillQuarantinePath('platform/shared/agent-skill-runtime-contract.ts')).toBe(true);
  expect(isSecSkillQuarantinePath('.agents/skills/sec-worker-development/SKILL.md')).toBe(true);
  expect(isSecSkillQuarantinePath('.codex/agents/implementation-worker.toml')).toBe(true);
  expect(isSecSkillQuarantinePath('source/compiler/semantic.ts')).toBe(false);
});

test('non-applicable decisions physically read zero Skill bodies', () => {
  const missingRoot = path.join(tmpdir(), `sec-nonexistent-skill-root-${Date.now()}`);
  for (const status of ['none-required', 'not-applicable', 'ambiguous', 'stale', 'conflict', 'unresolved'] as const) {
    expect(readTrustedSecSkillGuidanceV1({
      repositoryRoot: missingRoot,
      plan: {} as SecOperationReadPlanV1,
      decision: decision({ status, trustedRevision: '1'.repeat(40) })
    })).toBeNull();
  }
});

test('applicable guidance without an exact conditional Read Plan ref is rejected before Git access', () => {
  const missingRoot = path.join(tmpdir(), `sec-nonexistent-skill-root-${Date.now()}-applicable`);
  expect(() => readTrustedSecSkillGuidanceV1({
    repositoryRoot: missingRoot,
    plan: {
      maxSkillBodies: 1,
      preApplicabilitySkillBodiesRead: 0,
      conditionalRefs: [],
      unresolvedFrontier: [],
      readPlanDigest: digest('8')
    } as SecOperationReadPlanV1,
    decision: decision({
      status: 'applicable',
      trustedRevision: '1'.repeat(40),
      selectedSkillId: 'sec-worker-development'
    })
  })).toThrow(/not exactly admitted/u);
});

test('applicable guidance reads the exact trusted Git blob admitted by the Read Plan, not candidate bytes', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-skill-guidance-trusted-'));
  try {
    git(root, ['init']);
    git(root, ['config', 'user.name', 'SEC Test']);
    git(root, ['config', 'user.email', 'sec-test@example.invalid']);
    const skillPath = '.agents/skills/sec-worker-development/SKILL.md';
    const absolute = path.join(root, ...skillPath.split('/'));
    mkdirSync(path.dirname(absolute), { recursive: true });
    const baseSource = [
      '---',
      'name: sec-worker-development',
      'description: trusted base',
      '---',
      '',
      '# sec-worker-development',
      '',
      'trusted guidance',
      ''
    ].join('\n');
    writeFileSync(absolute, baseSource, 'utf8');
    git(root, ['add', '--', skillPath]);
    git(root, ['commit', '-m', 'base skill']);
    const base = git(root, ['rev-parse', 'HEAD']);
    const baseBlob = git(root, ['rev-parse', `${base}:${skillPath}`]);

    const candidateSource = baseSource.replace('trusted guidance', 'candidate must not guide itself');
    writeFileSync(absolute, candidateSource, 'utf8');
    git(root, ['add', '--', skillPath]);
    git(root, ['commit', '-m', 'candidate skill']);
    const candidate = git(root, ['rev-parse', 'HEAD']);
    const plan = admittedPlan(base);

    const guidance = readTrustedSecSkillGuidanceV1({
      repositoryRoot: root,
      plan,
      decision: decision({
        status: 'applicable',
        trustedRevision: base,
        targetCandidate: candidate,
        selectedSkillId: 'sec-worker-development'
      })
    });
    expect(guidance).not.toBeNull();
    expect(guidance?.source).toBe(baseSource);
    expect(guidance?.source).not.toBe(readFileSync(absolute, 'utf8'));
    expect(guidance?.blobRevision).toBe(baseBlob);
    expect(guidance?.trustedRevision).toBe(base);
    expect(guidance?.readPlanDigest).toBe(plan.readPlanDigest);
    expect(guidance?.readPlanRefId).toBe('skill-guidance-sec-worker-development');
    expect(guidance?.effectAuthority).toBe('none');
    expect(guidance?.judgmentId).toBe('implementation-choice');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('guidance projection refuses body/decision mismatch', () => {
  const none = decision({ status: 'none-required', trustedRevision: '1'.repeat(40) });
  expect(createSecSkillGuidanceProjectionV1({ decision: none, guidance: null }).guidance).toBeNull();
  expect(() => createSecSkillGuidanceProjectionV1({
    decision: decision({
      status: 'applicable',
      trustedRevision: '1'.repeat(40),
      selectedSkillId: 'sec-worker-development'
    }),
    guidance: null
  })).toThrow(/guidance presence/);
});

test('Skill Runtime, loader and trusted producers are self-protected by existing Test Impact graph/owners', () => {
  const runtime = selectTestsForSources(['platform/shared/agent-skill-runtime-contract.ts']);
  expect(runtime.owners).toContain('module-graph');
  expect(runtime.fast).toContain('tests/contract/skill-runtime-policy.test.ts');

  for (const source of [
    'scripts/codex/skill-applicability.ts',
    'scripts/codex/task-capsule.ts',
    'scripts/codex/operation-read-plan.ts'
  ]) {
    const selection = selectTestsForSources([source]);
    expect(selection.fast).toContain('tests/contract/skill-runtime-policy.test.ts');
    expect(selection.fast).toContain('tests/contract/skill-applicability.test.ts');
    expect(selection.fast).toContain('tests/contract/operation-read-plan.test.ts');
  }
});

test('retained Skill corpus uses only V2 judgement sections and no dynamic operation facts', () => {
  for (const skillId of SEC_AGENT_SKILL_IDS) {
    const source = readFileSync(path.join(REPOSITORY_ROOT, '.agents', 'skills', skillId, 'SKILL.md'), 'utf8');
    let previous = -1;
    for (const section of SEC_AGENT_SKILL_STANDARD_SECTIONS) {
      const index = source.indexOf(section);
      expect(index).toBeGreaterThan(previous);
      previous = index;
    }
    expect(source).not.toMatch(/## (?:触发|不触发|输入|权限与路径|允许工具与操作|前置门禁|执行|完成证据|停止与恢复|禁止捷径|权威)(?:\n|$)/u);
    expect(source).not.toMatch(/#[1-9][0-9]*/u);
    expect(source).not.toContain('MEMORY.md');
    expect(source).not.toMatch(/[0-9a-f]{40}/u);
    expect(source).toContain('非自动读取');
    expect(source).toContain('effectAuthority=none');
  }
});
