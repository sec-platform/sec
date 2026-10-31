import { expect, test } from 'bun:test';
import {
  createProofObligation,
  createVerificationClaim,
  createVerificationMethodSelection,
  createVerificationSpecificationBinding
} from '../../../assurance/verification/contract/specification.ts';
import {
  createVerificationTestResponsibility
} from '../../../assurance/verification/contract/test-responsibility.ts';
import { rawSha256, sha256 } from '../../../contracts/canonical.ts';
import { observeGitHubRepositoryComment } from '../../providers/github-api/repository-comment.ts';
import {
  issueGitHubApiTestCapability,
  withGitHubApiTestSession
} from '../../providers/github-api/test/operation-session.ts';
import { assessSourceProgramTransitionAuthorInput } from '../repository-audit/transition.ts';
import { compileSourceProgramSupersessionReceipt } from './reduction.ts';
import {
  adoptSourceProgramTestAuthorDecision,
  assessSourceProgramTestAuthorDecision,
  createSourceProgramTestAuthorDecisionPayload,
  qualifySourceProgramTestAuthorAssessment,
  SOURCE_PROGRAM_TEST_AUTHOR_DECISION_MARKER,
  type SourceProgramTestAuthorDecision,
  type SourceProgramTestAuthorDecisionPayload
} from './test-disposition-decisions.ts';
import { compileSupersessionFixture, compileSupersessionSnapshot } from './test/supersession-fixture.ts';

function testAuthorPayload(
  baseline: ReturnType<typeof compileSupersessionSnapshot>,
  current: ReturnType<typeof compileSupersessionSnapshot>,
  decisions: readonly SourceProgramTestAuthorDecision[]
) {
  const subject = (evidence: typeof baseline, commit: string, tree: string) => ({
    commitSha: commit.repeat(40), treeSha: tree.repeat(40),
    sourceRevision: evidence.identity.sourceRevision, modelDigest: evidence.source.modelDigest,
    testCompilationDigest: evidence.source.testCompilationDigest
  });
  return createSourceProgramTestAuthorDecisionPayload({
    repository: 'sec-platform/sec', pullRequestNumber: 7, trustedRevision: 'a'.repeat(40),
    baseline: subject(baseline, 'a', 'b'), current: subject(current, 'c', 'd'), decisions
  });
}

async function observeTestAuthor(
  payload: SourceProgramTestAuthorDecisionPayload,
  permission: { permission: 'admin' | 'maintain' | 'write'; role_name?: string } = { permission: 'write', role_name: 'maintain' }
) {
  const user = { login: 'maintainer', node_id: 'maintainer-node', id: 900001, type: 'User' };
  const comment = { id: 77, issue_url: 'https://api.github.com/repos/sec-platform/sec/issues/7', user,
    body: SOURCE_PROGRAM_TEST_AUTHOR_DECISION_MARKER + JSON.stringify(payload), updated_at: '2026-09-30T00:00:00Z' };
  const capability = issueGitHubApiTestCapability({
    repository: 'sec-platform/sec', token: 'test-owner-boundary-token-0123456789', effect: 'read',
    principal: { transport: 'github-rest-token', login: user.login, nodeId: user.node_id,
      userId: user.id, permission: 'maintain' },
    transport: async target => {
      const pathname = new URL(String(target)).pathname;
      if (pathname === '/repos/sec-platform/sec/issues/comments/77') return Response.json(comment);
      if (pathname === '/repos/sec-platform/sec/collaborators/maintainer/permission') {
        return Response.json({ user, ...permission });
      }
      return new Response('unexpected fixture operation', { status: 404 });
    }
  });
  return withGitHubApiTestSession({ capability, operation: async () => {
    const observation = await observeGitHubRepositoryComment({ capability, issueNumber: 7, commentId: 77 });
    expect(observation.author.permission).toBe(permission.permission);
    expect(observation.author.roleName).toBe(permission.role_name ?? null);
    return adoptSourceProgramTestAuthorDecision(observation);
  } });
}

function constantResultResponsibility(testId: string, owner: string) {
  const valueDigest = sha256('the accepted public result is the literal ok') as `sha256:${string}`;
  const scopeDigest = sha256('one deterministic synthetic operation with no external resource') as `sha256:${string}`;
  const claim = createVerificationClaim({ claimRef: 'claim:constant-result', claimRevision: 'accepted-1',
    source: { kind: 'explicit-check-request', ref: 'check:constant-result', revision: 'accepted-1' },
    ownerRef: owner, subjectRef: 'subject:example-operation', subjectRevision: 'source-1',
    propositionDigest: valueDigest, applicabilityScopeDigest: scopeDigest, assumptionsDigest: scopeDigest,
    requiredAssuranceDigest: scopeDigest, lifecycleAndInvalidationDigest: scopeDigest });
  const proofObligation = createProofObligation({ obligationRef: 'obligation:constant-result', obligationRevision: 'accepted-1',
    claimRef: claim.claimRef, claimRevision: claim.claimRevision, claimDigest: claim.claimDigest, ownerRef: owner,
    requiredObservationOrPredicateDigest: valueDigest, applicabilityScopeDigest: scopeDigest,
    requiredIndependenceDigest: valueDigest, admissibleMethodFamilies: ['test'],
    environmentAndCapabilityConstraintsDigest: scopeDigest, coverageAndFailureSpaceDigest: scopeDigest,
    lifecycleAndInvalidationDigest: scopeDigest });
  const methodSelection = createVerificationMethodSelection({ selectionRef: 'selection:constant-result', selectionRevision: 'accepted-1',
    proofObligationRef: proofObligation.obligationRef, proofObligationRevision: proofObligation.obligationRevision,
    proofObligationDigest: proofObligation.obligationDigest, methodFamily: 'test',
    methodContractRef: 'method:fixed-literal-comparison', methodContractRevision: 'accepted-1',
    environmentAndCapabilityRequirementsDigest: scopeDigest, oracleCheckerOrReferenceRefs: ['literal:ok'],
    executionRequired: true, evidenceQualificationDigest: scopeDigest, lifecycleAndInvalidationDigest: scopeDigest });
  return createVerificationTestResponsibility({ testRef: `test:${testId}`, testRevision: 'source-1', ownerRef: owner,
    bindings: [{ specification: createVerificationSpecificationBinding({ claim, proofObligation, methodSelection }),
      failureMeaning: 'The accepted literal result changed', observationBoundary: 'one public execute return value',
      oracleAndIndependenceRefs: ['literal:ok'] }],
    environmentAndResourceRequirementsDigest: scopeDigest, impactAndLifecycleDigest: scopeDigest,
    retirementConditionsDigest: scopeDigest });
}

test('introduce judgment joins only genuine new occurrences and cannot clear an old obligation', async () => {
  const production = { 'src/example/operation.ts': "export function execute() { return 'ok'; }\n" };
  const newPath = 'src/example/new.test.ts';
  const source = "import { expect, test } from 'bun:test';\nimport { execute } from './operation.ts';\ntest('executes', () => expect(execute()).toBe('ok'));\n";
  const baseline = compileSupersessionSnapshot(production);
  const current = compileSupersessionSnapshot({ ...production, [newPath]: source });
  const testId = current.tests[0]!.testId;
  const unapproved = compileSourceProgramSupersessionReceipt({ authorityScope: 'test-obligations',
    baseline, current, changedPaths: [newPath] });
  expect(unapproved.status).toBe('owner-decision-required');
  expect(unapproved.findings).toEqual([expect.objectContaining({
    code: 'test-introduction-decision-required', baselineId: null, currentCandidateIds: [testId]
  })]);
  const decision: SourceProgramTestAuthorDecision = { owner: 'example', replacementOwners: ['example'], disposition: 'introduce',
    baselineTestIds: [], currentTestIds: [testId], changedInputPaths: [newPath], baselineResponsibilities: [],
    currentResponsibilities: [{ testId, responsibility: constantResultResponsibility(testId, 'example') }],
    reason: 'This newly discovered occurrence checks the accepted fixed public result.' };
  const payload = testAuthorPayload(baseline, current, [decision]);
  const assessment = assessSourceProgramTestAuthorDecision({ payload, baseline, current, changedPaths: [newPath] });
  const approval = await observeTestAuthor(payload);
  const receipt = compileSourceProgramSupersessionReceipt({ authorityScope: 'test-obligations', baseline, current,
    changedPaths: [newPath], authorAssessment: assessment, authorApproval: approval });
  expect(receipt.status).toBe('author-decision-conditional');
  expect(receipt.findings).toEqual([]);
  expect(receipt.replacements).toEqual([]);
  expect(receipt.authorAssessedCurrentPaths).toEqual([]);
  const counterfeit = testAuthorPayload(current, current, [{ ...decision, changedInputPaths: [] }]);
  expect(() => assessSourceProgramTestAuthorDecision({ payload: counterfeit, baseline: current, current, changedPaths: [] }))
    .toThrow('actually-new');
  const old = compileSupersessionSnapshot({ ...production, 'src/example/old.test.ts': source });
  const changedPaths = ['src/example/old.test.ts', newPath];
  const proposed = testAuthorPayload(old, current, [decision]);
  const proposedAssessment = assessSourceProgramTestAuthorDecision({ payload: proposed, baseline: old, current, changedPaths });
  const incomplete = compileSourceProgramSupersessionReceipt({ authorityScope: 'test-obligations', baseline: old, current,
    changedPaths, authorAssessment: proposedAssessment });
  expect(incomplete.status).toBe('owner-decision-required');
  expect(incomplete.findings).toContainEqual(expect.objectContaining({ code: 'required-test-boundary-missing', baselineId: old.tests[0]!.testId }));
  const priorId = old.tests[0]!.testId;
  const rewritePayload = testAuthorPayload(old, current, [{ ...decision, disposition: 'rewrite',
    baselineTestIds: [priorId], changedInputPaths: changedPaths,
    baselineResponsibilities: [{ testId: priorId, responsibility: constantResultResponsibility(priorId, 'example') }],
    reason: 'Relocate the existing accepted obligation without introducing a new one.' }]);
  const rewriteAssessment = assessSourceProgramTestAuthorDecision({ payload: rewritePayload,
    baseline: old, current, changedPaths });
  const rewrite = compileSourceProgramSupersessionReceipt({ authorityScope: 'test-obligations',
    baseline: old, current, changedPaths, authorAssessment: rewriteAssessment });
  expect(rewrite.status).toBe('author-decision-conditional');
  expect(rewrite.findings).toEqual([]);
  expect(rewrite.replacements).toEqual([expect.objectContaining({ baselineId: priorId,
    currentIds: [testId], proof: 'owner-rewrite-judgment' })]);
});

function lateTransitionAuthorFixture() {
  const testPath = 'src/example/behavior.test.ts';
  const source = "import { expect, test } from 'bun:test';\nimport { execute } from './operation.ts';\ntest('executes', () => expect(execute()).toBe('ok'));\n";
  const baseline = compileSupersessionSnapshot({
    'src/example/operation.ts': "export function execute() { return 'ok'; }\n", [testPath]: source
  });
  const current = compileSupersessionSnapshot({
    'src/example/operation.ts': "export function execute() { const result = 'ok'; return result; }\n", [testPath]: source
  });
  const changedPaths = ['src/example/operation.ts'];
  const decision: SourceProgramTestAuthorDecision = { owner: 'example', replacementOwners: ['example'],
    disposition: 'retain-unassessed', baselineTestIds: [baseline.tests[0]!.testId],
    currentTestIds: [current.tests[0]!.testId], changedInputPaths: changedPaths,
    baselineResponsibilities: [], currentResponsibilities: [],
    reason: 'Retain the unchanged test definition; changed SUT inputs still require their own verification.' };
  const payload = testAuthorPayload(baseline, current, [decision]);
  const assessment = Object.freeze({ runtimeSha: 'a'.repeat(40), baseSha: 'a'.repeat(40),
    baseTreeSha: 'b'.repeat(40), headSha: 'c'.repeat(40), headTreeSha: 'd'.repeat(40),
    baseline, current, changedPaths, authorAssessment: null });
  return { assessment, payload, decision };
}

test('late conditional author input preserves immutable facts, exact history and drift rejection without adoption authority', async () => {
  const { assessment, payload, decision } = lateTransitionAuthorFixture();
  const original = JSON.stringify(assessment);
  const proposed = assessSourceProgramTransitionAuthorInput({ assessment, payload });
  expect(proposed.authority).toBe('conditional-author-input');
  expect(proposed.decisions[0]).toMatchObject({ baselineTestIds: decision.baselineTestIds,
    currentTestIds: decision.currentTestIds, disposition: 'retain-unassessed' });
  expect(assessment.authorAssessment).toBeNull();
  expect(JSON.stringify(assessment)).toBe(original);
  const approval = await observeTestAuthor(payload);
  await expect(observeTestAuthor(payload, { permission: 'maintain', role_name: 'maintain' }))
    .resolves.toBeDefined();
  await expect(observeTestAuthor(payload, { permission: 'maintain' }))
    .rejects.toThrow('current maintainer');
  expect(qualifySourceProgramTestAuthorAssessment({ approval, assessment: proposed })).toBe('test-only-simulation');
  const receipt = compileSourceProgramSupersessionReceipt({
    authorityScope: 'test-obligations', baseline: assessment.baseline, current: assessment.current,
    changedPaths: assessment.changedPaths, authorAssessment: proposed, authorApproval: approval
  });
  expect(receipt.status).toBe('author-decision-conditional');
  expect(receipt.findings).toEqual([]);
  expect(receipt.authorAssessedCurrentPaths).toEqual([]);
  expect(receipt.replacements).toEqual([expect.objectContaining({ kind: 'test', proof: 'retained-unassessed' })]);
  const wrongOwner = testAuthorPayload(assessment.baseline, assessment.current,
    [{ ...decision, owner: 'another-owner' }]);
  expect(() => assessSourceProgramTransitionAuthorInput({ assessment, payload: wrongOwner })).toThrow();
  expect(() => qualifySourceProgramTestAuthorAssessment({ approval, assessment: { ...proposed } }))
    .toThrow('exact compiler assessment required');
  const historical = { ...assessment, authorAssessment: proposed };
  const renewed = assessSourceProgramTransitionAuthorInput({ assessment: historical, payload });
  expect(renewed).toEqual(proposed);
  expect(renewed).not.toBe(proposed);
  expect(() => assessSourceProgramTransitionAuthorInput({
    assessment: { ...assessment, headSha: 'e'.repeat(40) }, payload
  })).toThrow('revisions');
  const sourceDrift = createSourceProgramTestAuthorDecisionPayload({ ...payload,
    current: { ...payload.current, modelDigest: sha256('foreign model') } });
  expect(() => assessSourceProgramTransitionAuthorInput({ assessment, payload: sourceDrift }))
    .toThrow('compilation drift');
  const laterPayload = testAuthorPayload(assessment.baseline, assessment.current,
    [{ ...decision, reason: 'A different later author statement retains the same test.' }]);
  expect(() => assessSourceProgramTransitionAuthorInput({ assessment: historical, payload: laterPayload }))
    .toThrow('conditional interpretation');
  expect(assessSourceProgramTransitionAuthorInput({ assessment, payload: laterPayload }).payloadDigest)
    .toBe(laterPayload.payloadDigest);
});

test('authored relocation retains exact counterpart pairs without reusing approval or input evidence', async () => {
  const testPath = 'src/example/behavior.test.ts';
  const operationPath = 'src/example/operation.ts';
  const bodies = [
    "test('first', () => expect(execute()).toBe('ok'))",
    "test('second', () => expect(execute()).toEqual('ok'))"
  ];
  const source = "import { expect, test } from 'bun:test';\nimport { execute } from './operation.ts';\n"
    + bodies.join(';\n') + ';\n';
  const baseline = compileSupersessionSnapshot({
    [operationPath]: "export function execute() { return 'ok'; }\n", [testPath]: source
  });
  const current = compileSupersessionSnapshot({
    [operationPath]: "export function execute() { const result = 'ok'; return result; }\n",
    [testPath]: '// shifted source location\n' + source
  });
  const pairs = bodies.map(body => {
    const digest = rawSha256(body);
    const before = baseline.tests.find(test => test.registrationContentDigest === digest)!;
    const after = current.tests.find(test => test.registrationContentDigest === digest)!;
    expect(before.testId).not.toBe(after.testId);
    expect(before.definitionInputDigest).not.toBe(after.definitionInputDigest);
    return { before: before.testId, after: after.testId };
  });
  const changedPaths = [operationPath, testPath];
  const decision: SourceProgramTestAuthorDecision = {
    owner: 'example', replacementOwners: ['example'], disposition: 'retain-unassessed',
    baselineTestIds: pairs.map(pair => pair.before), currentTestIds: pairs.map(pair => pair.after),
    changedInputPaths: changedPaths, baselineResponsibilities: [], currentResponsibilities: [],
    reason: 'Retain these exact definitions after a reviewed location shift; changed inputs still require verification.'
  };
  const payload = testAuthorPayload(baseline, current, [decision]);
  const assessment = assessSourceProgramTestAuthorDecision({ payload, baseline, current, changedPaths });
  const approval = await observeTestAuthor(payload);
  expect(qualifySourceProgramTestAuthorAssessment({ assessment, approval })).toBe('test-only-simulation');
  const receipt = compileSourceProgramSupersessionReceipt({ authorityScope: 'test-obligations',
    baseline, current, changedPaths, authorAssessment: assessment, authorApproval: approval });
  expect(receipt.status).toBe('author-decision-conditional');
  expect(receipt.findings).toEqual([]);
  expect(receipt.authorAssessedCurrentPaths).toEqual([]);
  for (const pair of pairs) {
    expect(receipt.replacements.find(({ baselineId }) => baselineId === pair.before))
      .toMatchObject({ currentIds: [pair.after], proof: 'retained-unassessed' });
  }
  const automatic = compileSourceProgramSupersessionReceipt({ authorityScope: 'test-obligations',
    baseline, current, changedPaths });
  expect(automatic.status).toBe('owner-decision-required');
  expect(automatic.replacements).toEqual([]);
  const partialPayload = testAuthorPayload(baseline, current, [{ ...decision,
    baselineTestIds: [pairs[0]!.before], currentTestIds: [pairs[0]!.after] }]);
  const partialAssessment = assessSourceProgramTestAuthorDecision({ payload: partialPayload,
    baseline, current, changedPaths });
  const partial = compileSourceProgramSupersessionReceipt({ authorityScope: 'test-obligations',
    baseline, current, changedPaths, authorAssessment: partialAssessment });
  expect(partial.status).toBe('owner-decision-required');
  expect(partial.findings.filter(({ code }) => code === 'test-introduction-decision-required'))
    .toEqual([expect.objectContaining({ currentCandidateIds: [pairs[1]!.after] })]);
  const missingInput = testAuthorPayload(baseline, current, [{ ...decision, changedInputPaths: [testPath] }]);
  expect(() => assessSourceProgramTestAuthorDecision({ payload: missingInput, baseline, current, changedPaths })).toThrow();
  const priorPayload = testAuthorPayload(baseline, baseline, [{
    ...decision, currentTestIds: decision.baselineTestIds, changedInputPaths: []
  }]);
  const priorApproval = await observeTestAuthor(priorPayload);
  expect(() => qualifySourceProgramTestAuthorAssessment({ assessment, approval: priorApproval })).toThrow();
});

test('authored relocation rejects ambiguous identical registrations rather than using source order', () => {
  const testPath = 'src/example/behavior.test.ts';
  const production = { 'src/example/operation.ts': "export function execute() { return 'ok'; }\n" };
  const body = "test('same', () => expect(execute()).toBe('ok'));\n";
  const source = "import { expect, test } from 'bun:test';\nimport { execute } from './operation.ts';\n" + body + body;
  const baseline = compileSupersessionSnapshot({ ...production, [testPath]: source });
  const current = compileSupersessionSnapshot({ ...production, [testPath]: '\n' + source });
  expect(baseline.tests).toHaveLength(2);
  expect(current.tests).toHaveLength(2);
  const payload = testAuthorPayload(baseline, current, [{
    owner: 'example', replacementOwners: ['example'], disposition: 'retain-unassessed',
    baselineTestIds: baseline.tests.map(test => test.testId), currentTestIds: current.tests.map(test => test.testId),
    changedInputPaths: [testPath], baselineResponsibilities: [], currentResponsibilities: [],
    reason: 'The duplicate definitions do not identify a unique counterpart.'
  }]);
  expect(() => assessSourceProgramTestAuthorDecision({ payload, baseline, current, changedPaths: [testPath] })).toThrow();
});

test('authored relocation cannot retain a changed oracle under the same title', () => {
  const testPath = 'src/example/behavior.test.ts';
  const production = { 'src/example/operation.ts': "export function execute() { return 'ok'; }\n" };
  const source = "import { expect, test } from 'bun:test';\nimport { execute } from './operation.ts';\ntest.each([111])('same', () => expect(execute()).toBe('ok'));\n";
  const fixture = compileSupersessionFixture({ ...production, [testPath]: source });
  const baseline = fixture.evidence;
  const current = compileSupersessionSnapshot({ ...production,
    [testPath]: '\n' + source.replace("toBe('ok')", "toBe('changed')") });
  expect(baseline.tests[0]!.registrationContentDigest).not.toBe(current.tests[0]!.registrationContentDigest);
  const payload = testAuthorPayload(baseline, current, [{
    owner: 'example', replacementOwners: ['example'], disposition: 'retain-unassessed',
    baselineTestIds: [baseline.tests[0]!.testId], currentTestIds: [current.tests[0]!.testId],
    changedInputPaths: [testPath], baselineResponsibilities: [], currentResponsibilities: [],
    reason: 'A title is only a locator and cannot authorize a changed oracle.'
  }]);
  expect(() => assessSourceProgramTestAuthorDecision({ payload, baseline, current, changedPaths: [testPath] })).toThrow();

  // Same-length literal replacement preserves the occurrence ID, not its
  // definition. Known expansion growth cannot hide behind that unchanged ID.
  const expandedFixture = compileSupersessionFixture({ ...production,
    [testPath]: source.replace('[111]', '[1,2]') });
  const expanded = expandedFixture.evidence;
  expect(fixture.full.tests.records[0]!.potentialExpansion).toEqual({ status: 'known', count: 1 });
  expect(expandedFixture.full.tests.records[0]!.potentialExpansion).toEqual({ status: 'known', count: 2 });
  const testId = baseline.tests[0]!.testId;
  expect(expanded.tests[0]!.testId).toBe(testId);
  expect(expanded.tests[0]!.registrationContentDigest).not.toBe(baseline.tests[0]!.registrationContentDigest);
  const unapproved = compileSourceProgramSupersessionReceipt({ authorityScope: 'test-obligations',
    baseline, current: expanded, changedPaths: [testPath] });
  expect(unapproved.status).toBe('owner-decision-required');
  expect(unapproved.findings).toContainEqual(expect.objectContaining({
    code: 'required-test-boundary-missing', baselineId: testId
  }));
  const retained = testAuthorPayload(baseline, expanded, [{ ...payload.decisions[0]!,
    currentTestIds: [testId] }]);
  expect(() => assessSourceProgramTestAuthorDecision({ payload: retained,
    baseline, current: expanded, changedPaths: [testPath] }))
    .toThrow('unassessed retention cannot rewrite');
  const responsibility = constantResultResponsibility(testId, 'example');
  const rewrite = testAuthorPayload(baseline, expanded, [{ ...retained.decisions[0]!,
    disposition: 'rewrite', baselineResponsibilities: [{ testId, responsibility }],
    currentResponsibilities: [{ testId, responsibility }],
    reason: 'The exact changed definition requires an explicit responsibility judgment, not automatic count acceptance.' }]);
  const assessed = assessSourceProgramTestAuthorDecision({ payload: rewrite,
    baseline, current: expanded, changedPaths: [testPath] });
  const conditional = compileSourceProgramSupersessionReceipt({ authorityScope: 'test-obligations',
    baseline, current: expanded, changedPaths: [testPath], authorAssessment: assessed });
  expect(conditional.status).toBe('author-decision-conditional');
  expect(conditional.findings).toEqual([]);
});
