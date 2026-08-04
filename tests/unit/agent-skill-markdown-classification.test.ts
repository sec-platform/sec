import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from 'bun:test';

import {
  SEC_AGENT_SKILL_IDS,
  resolveSecMarkdownSkillCoverage,
  type SecAgentSkillId
} from '../../platform/shared/agent-skill-contract.ts';
import {
  SEC_AGENT_CAPABILITIES,
  SEC_AGENT_SKILL_APPLICABILITY_PROFILES,
  computeSecSkillSelectionDigest,
  evaluateSecSkillApplicability,
  revalidateSecSkillApplicabilityDecision,
  type SecSkillApplicabilityRequest,
  type SecSkillSelectionInput
} from '../../platform/shared/agent-skill-applicability-contract.ts';

const ROOT = path.resolve(import.meta.dir, '../..');

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const DIGEST_A = `sha256:${'1'.repeat(64)}`;
const DIGEST_B = `sha256:${'2'.repeat(64)}`;

function assessment(skillId: string) {
  return {
    triggerEvidence: [`operation matches ${skillId}`],
    exclusionChecks: ['trusted Skill 不触发 conditions checked'],
    excluded: false
  };
}

function request(
  patch: Partial<Omit<SecSkillApplicabilityRequest, 'selectionDigest'>> & {
    selectionDigest?: string;
  } = {}
): SecSkillApplicabilityRequest {
  const draft = {
    schema: 'sec-skill-applicability-request-v1' as const,
    repository: 'sec-platform/sec',
    trustedRevision: SHA_A,
    targetRevision: SHA_B,
    role: 'maintainer' as const,
    operation: 'implement' as const,
    goalDigest: DIGEST_A,
    envelopeDigest: DIGEST_B,
    writeIntent: true,
    candidateState: 'draft' as const,
    envelopeComplete: true,
    actorIndependent: false,
    candidateSkillIds: [],
    candidateAssessments: {},
    grantedCapabilities: [...SEC_AGENT_CAPABILITIES],
    trustedSkillBlobs: {},
    authorityConflicts: [],
    scopeConflicts: [],
    candidateModifiesSkillControlPlane: false,
    ...patch
  };
  const selection: SecSkillSelectionInput = {
    envelopeComplete: draft.envelopeComplete,
    actorIndependent: draft.actorIndependent,
    candidateSkillIds: draft.candidateSkillIds,
    candidateAssessments: draft.candidateAssessments,
    grantedCapabilities: draft.grantedCapabilities,
    trustedSkillBlobs: draft.trustedSkillBlobs,
    authorityConflicts: draft.authorityConflicts,
    scopeConflicts: draft.scopeConflicts,
    candidateModifiesSkillControlPlane: draft.candidateModifiesSkillControlPlane
  };
  return {
    ...draft,
    selectionDigest: patch.selectionDigest ?? computeSecSkillSelectionDigest(selection)
  };
}

test('all Skill bodies are applicability-gated and bounded', async () => {
  for (const skillId of SEC_AGENT_SKILL_IDS) {
    const source = await readFile(
      path.join(ROOT, '.agents', 'skills', skillId, 'SKILL.md'),
      'utf8'
    );
    expect(source).toContain('sec-skill-applicability-decision-v1');
    expect(source.split('\n').length).toBeLessThanOrEqual(70);
  }
  expect(await readFile(path.join(ROOT, 'AGENTS.md'), 'utf8')).toContain('零个或一个适用 Skill');
  expect(await readFile(path.join(ROOT, 'docs/development-governance.md'), 'utf8'))
    .toContain('零个或一个 Skill');
});

test('unknown root and docs-external Markdown fail closed', () => {
  for (const path of [
    'CONTRIBUTING.md',
    'SECURITY.md',
    '.github/PULL_REQUEST_TEMPLATE.md',
    'notes/architecture.md'
  ]) expect(resolveSecMarkdownSkillCoverage(path)).toBeNull();
});

test('every Skill has one explicit applicability profile', () => {
  expect(Object.keys(SEC_AGENT_SKILL_APPLICABILITY_PROFILES).sort()).toEqual(
    [...SEC_AGENT_SKILL_IDS].sort()
  );
  for (const profile of Object.values(SEC_AGENT_SKILL_APPLICABILITY_PROFILES)) {
    expect(profile.roles.length).toBeGreaterThan(0);
    expect(profile.operations.length).toBeGreaterThan(0);
    expect(profile.requiredCapabilities.length).toBeGreaterThan(0);
  }
});

test('zero or one Skill is explicit and incomplete writes cannot bypass guidance', () => {
  expect(evaluateSecSkillApplicability(request({
    role: 'integrator',
    operation: 'reconcile',
    writeIntent: false,
    candidateState: 'none',
    envelopeComplete: false
  }))).toMatchObject({ status: 'none-required', selectedSkillId: null });

  expect(evaluateSecSkillApplicability(request())).toMatchObject({
    status: 'none-required',
    selectedSkillId: null
  });

  expect(evaluateSecSkillApplicability(request({ envelopeComplete: false }))).toMatchObject({
    status: 'not-applicable',
    selectedSkillId: null
  });
});

test('path-order ambiguity and missing trusted trigger evidence fail closed', () => {
  const ambiguous = request({
    candidateSkillIds: ['sec-documentation-governance', 'sec-toolchain-and-dependencies'],
    candidateAssessments: {
      'sec-documentation-governance': assessment('sec-documentation-governance'),
      'sec-toolchain-and-dependencies': assessment('sec-toolchain-and-dependencies')
    },
    trustedSkillBlobs: {
      'sec-documentation-governance': SHA_A,
      'sec-toolchain-and-dependencies': SHA_B
    }
  });
  expect(evaluateSecSkillApplicability(ambiguous)).toMatchObject({
    status: 'ambiguous',
    selectedSkillId: null
  });

  const missingAssessment = request({
    role: 'worker',
    candidateSkillIds: ['sec-worker-development'],
    trustedSkillBlobs: { 'sec-worker-development': SHA_A }
  });
  expect(evaluateSecSkillApplicability(missingAssessment).reasons).toContain(
    'sec-worker-development:missing-trigger-assessment'
  );
});

test('exact-head review requires frozen independent read-only actor', () => {
  const common = {
    role: 'reviewer' as const,
    operation: 'review' as const,
    candidateSkillIds: ['sec-exact-head-review'] as SecAgentSkillId[],
    candidateAssessments: {
      'sec-exact-head-review': assessment('sec-exact-head-review')
    },
    trustedSkillBlobs: { 'sec-exact-head-review': SHA_A },
    writeIntent: false
  };
  const invalid = evaluateSecSkillApplicability(request({
    ...common,
    candidateState: 'draft',
    actorIndependent: false
  }));
  expect(invalid.reasons).toEqual(expect.arrayContaining([
    'sec-exact-head-review:actor-not-independent',
    'sec-exact-head-review:candidate-state'
  ]));

  const valid = evaluateSecSkillApplicability(request({
    ...common,
    candidateState: 'frozen',
    actorIndependent: true
  }));
  expect(valid).toMatchObject({
    status: 'applicable',
    selectedSkillId: 'sec-exact-head-review',
    trustedSkillBlob: SHA_A,
    guidanceRevision: SHA_A
  });
  expect(valid.triggerEvidence).toEqual(['operation matches sec-exact-head-review']);
});

test('candidate guidance is quarantined and authority/scope conflicts preempt it', () => {
  const quarantined = evaluateSecSkillApplicability(request({
    role: 'auditor',
    operation: 'audit',
    writeIntent: false,
    candidateSkillIds: ['sec-repository-audit'],
    candidateAssessments: { 'sec-repository-audit': assessment('sec-repository-audit') },
    trustedSkillBlobs: { 'sec-repository-audit': SHA_A },
    candidateModifiesSkillControlPlane: true
  }));
  expect(quarantined.reasons).toContain(
    'candidate-guidance-quarantined;trusted-base-guidance-selected'
  );

  const conflict = evaluateSecSkillApplicability(request({
    role: 'worker',
    candidateSkillIds: ['sec-worker-development'],
    candidateAssessments: { 'sec-worker-development': assessment('sec-worker-development') },
    trustedSkillBlobs: { 'sec-worker-development': SHA_A },
    authorityConflicts: ['semantic-model-owner'],
    scopeConflicts: ['platform/shared/']
  }));
  expect(conflict).toMatchObject({ status: 'conflict', selectedSkillId: null });
  expect(conflict.reasons).toEqual([
    'authority:semantic-model-owner',
    'scope:platform/shared/'
  ]);
});

test('request schema, candidate maps and selection digest reject malformed runtime input', () => {
  expect(() => evaluateSecSkillApplicability({ ...request(), unexpected: true })).toThrow(
    /Skill applicability request invalid/u
  );
  expect(() => evaluateSecSkillApplicability(request({
    selectionDigest: `sha256:${'0'.repeat(64)}`
  }))).toThrow(/selectionDigest/u);
  expect(() => evaluateSecSkillApplicability(request({
    candidateSkillIds: [],
    candidateAssessments: {
      'sec-worker-development': assessment('sec-worker-development')
    }
  }))).toThrow(/non-candidate Skill key/u);
});

test('Goal or selection-input changes stale old decisions', () => {
  const current = evaluateSecSkillApplicability(request({
    role: 'worker',
    candidateSkillIds: ['sec-worker-development'],
    candidateAssessments: { 'sec-worker-development': assessment('sec-worker-development') },
    trustedSkillBlobs: { 'sec-worker-development': SHA_A }
  }));
  const stale = revalidateSecSkillApplicabilityDecision(current, {
    repository: current.repository,
    trustedRevision: current.trustedRevision,
    targetRevision: current.targetRevision,
    role: current.role,
    operation: current.operation,
    goalDigest: `sha256:${'3'.repeat(64)}`,
    envelopeDigest: current.envelopeDigest,
    writeIntent: current.writeIntent,
    candidateState: current.candidateState,
    selectionDigest: `sha256:${'4'.repeat(64)}`
  });
  expect(stale).toMatchObject({
    status: 'stale',
    selectedSkillId: null,
    trustedSkillBlob: null
  });
  expect(stale.reasons).toEqual([
    'changed:goalDigest',
    'changed:selectionDigest'
  ]);
});
