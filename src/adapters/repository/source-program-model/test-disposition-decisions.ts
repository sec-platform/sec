import { readVerificationDataRecord, snapshotVerificationData } from '../../../assurance/verification/contract/data.ts';
import {
  evaluateVerificationTestRetirement,
  parseVerificationRequirementDisposition,
  parseVerificationTestResponsibility,
  REPOSITORY_TEST_REQUIREMENT_OWNER_POLICY,
  type VerificationRequirementDisposition,
  type VerificationTestResponsibility
} from '../../../assurance/verification/contract/test-responsibility.ts';
import { compareCodeUnits, deepFreeze, sha256 } from '../../../contracts/canonical.ts';
import { parseExactJson } from '../../../contracts/exact-json.ts';
import {
  isSecRepositoryTestModulePath,
  normalizeSecRepositoryTestModulePath
} from '../../../contracts/repository-test-path.ts';
import {
  assertGitHubRepositoryCommentObservation,
  type GitHubRepositoryCommentObservation,
  type GitHubRepositoryRequirementSource
} from '../../providers/github-api/repository-comment.ts';
import { normalizeGitHubRepositoryPermission } from '../../providers/github-api/repository-permission.ts';
import type { SourceProgramSupersessionEvidence } from './reduction.ts';
import type {
  SourceProgramTestBaselineEvidence,
  SourceProgramTestValueCompilation
} from './test-value.ts';

const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const OWNER_ID = /^[A-Za-z][A-Za-z0-9._-]{0,127}$/u;

interface SourceProgramTestRewriteDecision {
  readonly path: string;
  readonly replacementPaths: readonly string[];
  readonly reason: string;
}

export interface SourceProgramTestRewriteDecisionBatch {
  /** Exact tracked-test baseline to which these one-way decisions apply. */
  readonly baselineDigest: string;
  readonly owner: string;
  readonly decisions: readonly SourceProgramTestRewriteDecision[];
}

function decisionError(field: string, detail: string): never {
  throw new Error(`invalid source-program test rewrite decision ${field}: ${detail}`);
}

function canonicalDecisionPath(value: string, field: string): string {
  if (typeof value !== 'string' || !isSecRepositoryTestModulePath(value)) {
    return decisionError(field, 'expected a canonical SEC test-module path');
  }
  const normalized = normalizeSecRepositoryTestModulePath(value);
  if (normalized !== value) return decisionError(field, 'path is not canonical');
  return normalized;
}

/**
 * Compile stable repository-owner rewrite decisions into the exact disposition
 * input consumed by Test Value.  The stable source records paths and reasons;
 * this compiler binds them to the current source revision, baseline census and
 * candidate registration ids.  DELETE/MERGE remain exclusive to Source Program
 * proof and cannot be authored through this route.
 */
export function compileSourceProgramTestRewriteDispositions(input: Readonly<{
  compilation: SourceProgramTestValueCompilation;
  baselineEvidence: readonly SourceProgramTestBaselineEvidence[];
  batches: readonly SourceProgramTestRewriteDecisionBatch[];
}>): readonly unknown[] {
  if (!Array.isArray(input.batches)) return decisionError('batches', 'expected an array');
  const batchDigests = new Set<string>();
  for (const [batchIndex, batch] of input.batches.entries()) {
    if (!DIGEST.test(batch.baselineDigest)) {
      decisionError(`batches[${batchIndex}].baselineDigest`, 'expected a sha256 digest');
    }
    if (batchDigests.has(batch.baselineDigest)) {
      decisionError(`batches[${batchIndex}].baselineDigest`, 'duplicate baseline digest');
    }
    batchDigests.add(batch.baselineDigest);
    if (!OWNER_ID.test(batch.owner)) {
      decisionError(`batches[${batchIndex}].owner`, 'expected a bounded owner id');
    }
    if (!Array.isArray(batch.decisions)) {
      decisionError(`batches[${batchIndex}].decisions`, 'expected an array');
    }
  }

  const active = input.batches.find(({ baselineDigest }) =>
    baselineDigest === input.compilation.baselineDigest);
  if (active === undefined) return Object.freeze([]);
  const activeDecisions: readonly SourceProgramTestRewriteDecision[] = active.decisions;

  const evidenceByPath = new Map(input.baselineEvidence.map((evidence) =>
    [evidence.path, evidence] as const));
  const unknownDispositionPaths = new Set(input.compilation.dispositions
    .filter(({ disposition }) => disposition === 'unknown')
    .map(({ path }) => path));
  const registrationsByPath = new Map<string, string[]>();
  for (const registration of input.compilation.records) {
    const ids = registrationsByPath.get(registration.path) ?? [];
    ids.push(registration.testId);
    registrationsByPath.set(registration.path, ids);
  }

  const seenPaths = new Set<string>();
  const dispositions = activeDecisions.map((
    decision: SourceProgramTestRewriteDecision,
    decisionIndex: number
  ) => {
    const field = `decision[${decisionIndex}]`;
    const decisionPath = canonicalDecisionPath(decision.path, `${field}.path`);
    if (seenPaths.has(decisionPath)) decisionError(`${field}.path`, 'duplicate decision path');
    seenPaths.add(decisionPath);
    if (!unknownDispositionPaths.has(decisionPath)) {
      decisionError(`${field}.path`, 'path is not one unresolved missing baseline test');
    }
    if (!Array.isArray(decision.replacementPaths) || decision.replacementPaths.length === 0) {
      decisionError(`${field}.replacementPaths`, 'expected at least one replacement test path');
    }
    if (typeof decision.reason !== 'string'
        || decision.reason.length === 0
        || decision.reason.length > 512
        || decision.reason !== decision.reason.normalize('NFC')
        || decision.reason.includes('\0')) {
      decisionError(`${field}.reason`, 'expected bounded non-empty NFC text without NUL');
    }
    const replacementPaths = decision.replacementPaths.map((
      replacementPath: string,
      replacementIndex: number
    ) => canonicalDecisionPath(
      replacementPath,
      `${field}.replacementPaths[${replacementIndex}]`
    ));
    if (new Set(replacementPaths).size !== replacementPaths.length) {
      decisionError(`${field}.replacementPaths`, 'duplicate replacement path');
    }
    if (replacementPaths.includes(decisionPath)) {
      decisionError(`${field}.replacementPaths`, 'a missing test cannot replace itself');
    }
    const replacementTestIds = replacementPaths.flatMap((replacementPath: string) => {
      const ids = registrationsByPath.get(replacementPath) ?? [];
      if (ids.length === 0) {
        decisionError(`${field}.replacementPaths`, `no current test registrations for ${replacementPath}`);
      }
      return ids;
    }).sort(compareCodeUnits);
    const baseline = evidenceByPath.get(decisionPath);
    if (baseline === undefined) {
      decisionError(`${field}.path`, 'missing exact baseline census evidence');
    }
    const ownerDecisionDigest = sha256({
      baselineDigest: active.baselineDigest,
      owner: active.owner,
      path: decisionPath,
      replacementPaths: [...replacementPaths].sort(compareCodeUnits),
      reason: decision.reason
    });
    return Object.freeze({
      path: decisionPath,
      disposition: 'rewrite' as const,
      evidence: Object.freeze({
        owner: active.owner,
        sourceRevision: input.compilation.sourceRevision,
        replacementTestIds: Object.freeze(replacementTestIds),
        census: baseline.census,
        supersession: null,
        ownerDecisionDigest
      })
    });
  }).sort((left, right) => compareCodeUnits(left.path, right.path));

  return Object.freeze(dispositions);
}

export const SOURCE_PROGRAM_TEST_AUTHOR_DECISION_MARKER = '<!-- sec-test-author-decision-v1 -->\n';
export const SOURCE_PROGRAM_TEST_AUTHOR_DECISION_V2_MARKER = '<!-- sec-test-author-decision-v2 -->\n';

interface TestDecisionSubject {
  readonly commitSha: string;
  readonly treeSha: string;
  readonly sourceRevision: string;
  readonly modelDigest: string;
  readonly testCompilationDigest: string;
}

interface TestDecisionResponsibility {
  readonly testId: string;
  readonly responsibility: VerificationTestResponsibility;
}

/** Data extracted from an explicitly accepted literal in the independently
 * adopted baseline. Digest validity alone is not producer provenance. */
export interface SourceProgramAcceptedTestResponsibility {
  readonly schema: 'source-program-accepted-test-responsibility-v1';
  readonly role: 'accepted-baseline-test-responsibility';
  readonly testId: string;
  readonly registrationContentDigest: string;
  readonly responsibility: VerificationTestResponsibility;
  readonly path: string;
  readonly sourceRevision: string;
  readonly sourceContentDigest: string;
  readonly definitionInputDigest: string;
  readonly acceptanceDigest: string;
}

export function parseSourceProgramAcceptedTestResponsibility(value: unknown): SourceProgramAcceptedTestResponsibility {
  const record = authorRecord(snapshotVerificationData(value, 'accepted baseline responsibility'), [
    'schema', 'role', 'testId', 'registrationContentDigest', 'responsibility', 'path',
    'sourceRevision', 'sourceContentDigest', 'definitionInputDigest', 'acceptanceDigest'
  ], 'accepted baseline responsibility');
  if (record.schema !== 'source-program-accepted-test-responsibility-v1'
      || record.role !== 'accepted-baseline-test-responsibility') return decisionError('accepted baseline responsibility', 'explicit accepted role required');
  const canonical = { schema: 'source-program-accepted-test-responsibility-v1' as const, role: 'accepted-baseline-test-responsibility' as const,
    testId: authorText(record.testId, 'accepted registration', DIGEST),
    registrationContentDigest: authorText(record.registrationContentDigest, 'accepted content', DIGEST),
    responsibility: parseVerificationTestResponsibility(record.responsibility),
    path: canonicalDecisionPath(String(record.path), 'accepted source path'),
    sourceRevision: authorText(record.sourceRevision, 'accepted source revision', DIGEST),
    sourceContentDigest: authorText(record.sourceContentDigest, 'accepted source content', DIGEST),
    definitionInputDigest: authorText(record.definitionInputDigest, 'accepted definition inputs', DIGEST) };
  if (record.acceptanceDigest !== sha256(canonical)) return decisionError('accepted baseline responsibility', 'digest mismatch');
  return deepFreeze({ ...canonical, acceptanceDigest: String(record.acceptanceDigest) });
}

export interface SourceProgramTestAuthorDecision {
  readonly owner: string;
  /** Explicit author adoption of any current test-owner transition. */
  readonly replacementOwners: readonly string[];
  readonly disposition: 'retain-unassessed' | 'rewrite' | 'introduce' | 'retire';
  readonly retirementDecisionIds?: readonly string[];
  readonly baselineResponsibilityRefs?: readonly Readonly<{ testId: string; acceptanceDigest: string }>[];
  readonly baselineTestIds: readonly string[];
  readonly currentTestIds: readonly string[];
  readonly changedInputPaths: readonly string[];
  readonly baselineResponsibilities: readonly TestDecisionResponsibility[];
  readonly currentResponsibilities: readonly TestDecisionResponsibility[];
  readonly reason: string;
}

/** Pure content transported outside the candidate. These fields confer no authority. */
export interface SourceProgramTestAuthorDecisionPayload {
  readonly schema: 'source-program-test-author-decision-v1' | 'source-program-test-author-decision-v2';
  readonly requirementPolicyDigest?: string;
  readonly requirementDecisions?: readonly VerificationRequirementDisposition[];
  readonly repository: string;
  readonly pullRequestNumber: number;
  readonly operationId: string;
  readonly trustedRevision: string;
  readonly baseline: TestDecisionSubject;
  readonly current: TestDecisionSubject;
  readonly decisions: readonly SourceProgramTestAuthorDecision[];
  readonly payloadDigest: string;
}

/** Live host-side adoption; never reconstructed from a container's JSON. */
export interface SourceProgramTestAuthorApproval {
  readonly providerOrigin: 'production' | 'test';
  readonly payload: SourceProgramTestAuthorDecisionPayload;
  readonly commentId: number;
  readonly authorNodeId: string;
  readonly bodyDigest: string;
  readonly providerObservationDigest: string;
  readonly approvalDigest: string;
  readonly requirementPolicyDigest?: string;
  readonly requirementSourcesDigest?: string;
}

/** A pure interpretation for the exact candidate, conditional until the host qualifies it. */
export interface SourceProgramTestAuthorAssessment {
  readonly authority: 'conditional-author-input';
  readonly payloadDigest: string;
  readonly operationId: string;
  readonly baselineSourceRevision: string;
  readonly currentSourceRevision: string;
  readonly baselineModelDigest: string;
  readonly currentModelDigest: string;
  readonly baselineTestCompilationDigest: string;
  readonly currentTestCompilationDigest: string;
  readonly decisions: readonly SourceProgramTestAuthorDecision[];
  readonly assessmentDigest: string;
}

const issuedAuthorApprovals = new WeakSet<object>();
// Relocated targets belong to this exact, privately issued assessment. They
// are neither a persisted identity registry nor a reusable approval.
const issuedAuthorAssessments = new WeakMap<object, ReadonlyMap<string, string>>();
const COMMIT = /^[0-9a-f]{40}$/u;

function authorRecord(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  const record = readVerificationDataRecord(value, label);
  const actual = Object.keys(record).sort(compareCodeUnits);
  const expected = [...keys].sort(compareCodeUnits);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    return decisionError(label, 'unexpected or missing fields');
  }
  return record;
}

function authorText(value: unknown, label: string, pattern?: RegExp): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048
      || value.normalize('NFC') !== value || value.trim() !== value
      || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(value)
      || pattern !== undefined && !pattern.test(value)) {
    return decisionError(label, 'expected bounded canonical text');
  }
  return value;
}

function authorArray(value: unknown, label: string, pattern?: RegExp): readonly string[] {
  if (!Array.isArray(value) || value.length > 512) return decisionError(label, 'expected a bounded array');
  const values = value.map((entry) => authorText(entry, label, pattern)).sort(compareCodeUnits);
  if (new Set(values).size !== values.length) return decisionError(label, 'duplicate entries');
  return Object.freeze(values);
}

function authorSubject(value: unknown): TestDecisionSubject {
  const record = authorRecord(value, [
    'commitSha', 'treeSha', 'sourceRevision', 'modelDigest', 'testCompilationDigest'
  ], 'author subject');
  return Object.freeze({
    commitSha: authorText(record.commitSha, 'commitSha', COMMIT),
    treeSha: authorText(record.treeSha, 'treeSha', COMMIT),
    sourceRevision: authorText(record.sourceRevision, 'sourceRevision', DIGEST),
    modelDigest: authorText(record.modelDigest, 'modelDigest', DIGEST),
    testCompilationDigest: authorText(record.testCompilationDigest, 'testCompilationDigest', DIGEST)
  });
}

function authorResponsibilities(value: unknown): readonly TestDecisionResponsibility[] {
  if (!Array.isArray(value) || value.length > 512) return decisionError('responsibilities', 'expected bounded array');
  const entries = value.map((item) => {
    const record = authorRecord(item, ['testId', 'responsibility'], 'author responsibility');
    return Object.freeze({
      testId: authorText(record.testId, 'responsibility testId', DIGEST),
      responsibility: parseVerificationTestResponsibility(record.responsibility)
    });
  }).sort((left, right) => compareCodeUnits(left.testId, right.testId));
  if (new Set(entries.map(({ testId }) => testId)).size !== entries.length) {
    return decisionError('responsibilities', 'duplicate registration binding');
  }
  return Object.freeze(entries);
}

function assertResponsibilityIdentities(
  decisions: readonly SourceProgramTestAuthorDecision[],
  requirements: readonly VerificationRequirementDisposition[] = [],
  acceptedResponsibilities: readonly VerificationTestResponsibility[] = []
): void {
  const identities = new Map<string, string>();
  const bind = (kind: string, ref: string, revision: string, digest: string): void => {
    const identity = JSON.stringify([kind, ref, revision]);
    const prior = identities.get(identity);
    if (prior !== undefined && prior !== digest) {
      decisionError('author responsibility', `${kind} identity/revision has conflicting canonical content`);
    }
    identities.set(identity, digest);
  };
  const responsibilities = [
    ...decisions.flatMap(decision => [...decision.baselineResponsibilities, ...decision.currentResponsibilities])
      .map(({ responsibility }) => responsibility),
    ...acceptedResponsibilities
  ];
  for (const responsibility of responsibilities) {
    bind('test', responsibility.testRef, responsibility.testRevision, responsibility.responsibilityDigest);
    for (const { specification } of responsibility.bindings) {
      const { claim, proofObligation, methodSelection } = specification;
      bind('claim', claim.claimRef, claim.claimRevision, claim.claimDigest);
      bind('obligation', proofObligation.obligationRef, proofObligation.obligationRevision, proofObligation.obligationDigest);
      bind('selection', methodSelection.selectionRef, methodSelection.selectionRevision, methodSelection.selectionDigest);
    }
  }
  for (const { currentClaim } of requirements) bind('claim', currentClaim.claimRef, currentClaim.claimRevision, currentClaim.claimDigest);
}

function compileAuthorPayload(value: unknown, checkDigests: boolean): SourceProgramTestAuthorDecisionPayload {
  const snapshot = readVerificationDataRecord(snapshotVerificationData(value, 'test author payload'), 'test author payload');
  const version2 = snapshot.schema === 'source-program-test-author-decision-v2';
  const record = authorRecord(snapshot, [
    'schema', 'repository', 'pullRequestNumber', 'operationId', 'trustedRevision',
    'baseline', 'current', 'decisions', 'payloadDigest',
    ...(version2 ? ['requirementPolicyDigest', 'requirementDecisions'] : [])
  ], 'test author payload');
  if ((!version2 && record.schema !== 'source-program-test-author-decision-v1')
      || !Number.isSafeInteger(record.pullRequestNumber) || Number(record.pullRequestNumber) < 1
      || !Array.isArray(record.decisions) || record.decisions.length === 0 || record.decisions.length > 128) {
    return decisionError('author payload', 'invalid schema, PR or bounded decision set');
  }
  const requirementDecisions = version2 ? (() => {
    if (record.requirementPolicyDigest !== REPOSITORY_TEST_REQUIREMENT_OWNER_POLICY.policyDigest
        || !Array.isArray(record.requirementDecisions) || record.requirementDecisions.length === 0
        || record.requirementDecisions.length > 128) return decisionError('requirement policy', 'adopted policy and bounded semantic decisions required');
    const parsed = record.requirementDecisions.map(parseVerificationRequirementDisposition);
    if (new Set(parsed.map(({ decisionId }) => decisionId)).size !== parsed.length) return decisionError('requirement decisions', 'duplicate decision');
    return Object.freeze(parsed);
  })() : undefined;
  const decisions = record.decisions.map((item): SourceProgramTestAuthorDecision => {
    const entry = readVerificationDataRecord(item, 'author decision');
    const retiring = version2 && entry.disposition === 'retire';
    const decision = authorRecord(entry, [
      'owner', 'replacementOwners', 'disposition', 'baselineTestIds', 'currentTestIds', 'changedInputPaths',
      'baselineResponsibilities', 'currentResponsibilities', 'reason', ...(retiring ? ['retirementDecisionIds', 'baselineResponsibilityRefs'] : [])
    ], 'author decision');
    if (decision.disposition !== 'retain-unassessed' && decision.disposition !== 'rewrite' && decision.disposition !== 'introduce' && !retiring) {
      return decisionError('author disposition', 'only retention assessment, REWRITE and explicit introduction are supported');
    }
    const changedInputPaths = authorArray(decision.changedInputPaths, 'changed input paths');
    if (changedInputPaths.some((path) => path.startsWith('/') || path.includes('\\')
      || path.split('/').some((part) => part === '' || part === '.' || part === '..'))) {
      return decisionError('changed input paths', 'expected exact repository-relative paths');
    }
    const baselineTestIds = authorArray(decision.baselineTestIds, 'baseline test ids', DIGEST);
    const currentTestIds = authorArray(decision.currentTestIds, 'current test ids', DIGEST);
    if (retiring ? currentTestIds.length !== 0 || baselineTestIds.length === 0
      : currentTestIds.length === 0 || (decision.disposition === 'introduce'
        ? baselineTestIds.length !== 0 : baselineTestIds.length === 0)) {
      return decisionError('author decision', 'introduction requires no baseline; retention/rewrite require one; all require current registrations');
    }
    return deepFreeze({
      owner: authorText(decision.owner, 'author owner', OWNER_ID),
      replacementOwners: authorArray(decision.replacementOwners, 'replacement owners', OWNER_ID),
      disposition: decision.disposition as SourceProgramTestAuthorDecision['disposition'],
      ...(retiring ? { retirementDecisionIds: authorArray(decision.retirementDecisionIds, 'retirement decisions', DIGEST),
        baselineResponsibilityRefs: (() => {
          if (!Array.isArray(decision.baselineResponsibilityRefs) || decision.baselineResponsibilityRefs.length > 512
              || !Array.isArray(decision.baselineResponsibilities) || decision.baselineResponsibilities.length !== 0) {
            return decisionError('author retirement', 'only independently accepted baseline locators are permitted');
          }
          return Object.freeze(decision.baselineResponsibilityRefs.map(value => {
            const ref = authorRecord(value, ['testId', 'acceptanceDigest'], 'accepted baseline locator');
            return Object.freeze({ testId: authorText(ref.testId, 'accepted test id', DIGEST),
              acceptanceDigest: authorText(ref.acceptanceDigest, 'accepted digest', DIGEST) });
          }).sort((left, right) => compareCodeUnits(left.testId, right.testId)));
        })() } : {}),
      baselineTestIds,
      currentTestIds,
      changedInputPaths,
      baselineResponsibilities: authorResponsibilities(decision.baselineResponsibilities),
      currentResponsibilities: authorResponsibilities(decision.currentResponsibilities),
      reason: authorText(decision.reason, 'author reason')
    });
  });
  assertResponsibilityIdentities(decisions, requirementDecisions);
  const canonical = deepFreeze({
    schema: version2 ? 'source-program-test-author-decision-v2' as const : 'source-program-test-author-decision-v1' as const,
    ...(version2 ? { requirementPolicyDigest: REPOSITORY_TEST_REQUIREMENT_OWNER_POLICY.policyDigest, requirementDecisions: requirementDecisions! } : {}),
    repository: authorText(record.repository, 'author repository', /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u),
    pullRequestNumber: Number(record.pullRequestNumber),
    operationId: authorText(record.operationId, 'author operationId', DIGEST),
    trustedRevision: authorText(record.trustedRevision, 'author trusted revision', COMMIT),
    baseline: authorSubject(record.baseline),
    current: authorSubject(record.current),
    decisions
  });
  const operationId = sha256({
    schema: version2 ? 'source-program-test-author-operation-v2' : 'source-program-test-author-operation-v1',
    repository: canonical.repository,
    pullRequestNumber: canonical.pullRequestNumber,
    trustedRevision: canonical.trustedRevision,
    baseline: canonical.baseline,
    current: canonical.current
  });
  if (checkDigests && canonical.operationId !== operationId) {
    return decisionError('author operation', 'does not bind the exact transition and trusted policy revision');
  }
  const normalized = deepFreeze({ ...canonical, operationId });
  const payloadDigest = sha256(normalized);
  if (checkDigests && record.payloadDigest !== payloadDigest) return decisionError('author payload', 'digest mismatch');
  return deepFreeze({ ...normalized, payloadDigest });
}

/** Strict data decoder. Authentication is deliberately a separate live-host step. */
export function parseSourceProgramTestAuthorDecisionPayload(value: unknown): SourceProgramTestAuthorDecisionPayload {
  return compileAuthorPayload(value, true);
}

/** Produce reviewable content without asking an author to calculate identity hashes. */
export function createSourceProgramTestAuthorDecisionPayload(input: Omit<
  SourceProgramTestAuthorDecisionPayload, 'schema' | 'operationId' | 'payloadDigest'
>): SourceProgramTestAuthorDecisionPayload {
  return compileAuthorPayload({
    ...readVerificationDataRecord(input, 'author decision proposal'),
    schema: input.requirementDecisions === undefined ? 'source-program-test-author-decision-v1' : 'source-program-test-author-decision-v2',
    ...(input.requirementDecisions === undefined ? {} : { requirementPolicyDigest: input.requirementPolicyDigest ?? REPOSITORY_TEST_REQUIREMENT_OWNER_POLICY.policyDigest }),
    operationId: `sha256:${'0'.repeat(64)}`,
    payloadDigest: `sha256:${'0'.repeat(64)}`
  }, false);
}

/** Adopt exactly one independently observed maintainer statement under this owner's policy. */
export function adoptSourceProgramTestAuthorDecision(
  observation: GitHubRepositoryCommentObservation
): SourceProgramTestAuthorApproval {
  assertGitHubRepositoryCommentObservation(observation);
  const permission = normalizeGitHubRepositoryPermission({
    permission: observation.author.permission,
    // This adoption policy requires an explicit role; absent observations retain null.
    role_name: observation.author.roleName
  });
  const authorHasAdoptionRole = permission === 'admin' || permission === 'maintain';
  if (observation.author.kind !== 'User'
      || !authorHasAdoptionRole
      || (!observation.body.startsWith(SOURCE_PROGRAM_TEST_AUTHOR_DECISION_MARKER)
        && !observation.body.startsWith(SOURCE_PROGRAM_TEST_AUTHOR_DECISION_V2_MARKER))) {
    return decisionError('author observation', 'requires an explicit test decision adopted by a current maintainer');
  }
  const payload = parseSourceProgramTestAuthorDecisionPayload(parseExactJson(
    observation.body.slice(observation.body.startsWith(SOURCE_PROGRAM_TEST_AUTHOR_DECISION_V2_MARKER)
      ? SOURCE_PROGRAM_TEST_AUTHOR_DECISION_V2_MARKER.length : SOURCE_PROGRAM_TEST_AUTHOR_DECISION_MARKER.length),
    'test author decision', undefined, 32
  ));
  if (payload.repository !== observation.repository || payload.pullRequestNumber !== observation.issueNumber) {
    return decisionError('author observation', 'repository or PR mismatch');
  }
  if (payload.schema === 'source-program-test-author-decision-v2') {
    if (!observation.body.startsWith(SOURCE_PROGRAM_TEST_AUTHOR_DECISION_V2_MARKER)
        || !REPOSITORY_TEST_REQUIREMENT_OWNER_POLICY.allowJointTestAuthorship
        || !REPOSITORY_TEST_REQUIREMENT_OWNER_POLICY.roles.some(role => role === permission)
        || sha256(observation.sourceBlobs) !== sha256(sourceProgramRequirementSourceRequests(payload))) {
      return decisionError('requirement adoption', 'current policy, actor and exact independently observed requirement sources required');
    }
  }
  const canonical = deepFreeze({
    providerOrigin: observation.origin,
    ...(payload.schema === 'source-program-test-author-decision-v2' ? {
      requirementPolicyDigest: REPOSITORY_TEST_REQUIREMENT_OWNER_POLICY.policyDigest,
      requirementSourcesDigest: sha256(observation.sourceBlobs)
    } : {}),
    payload,
    commentId: observation.commentId,
    authorNodeId: observation.author.nodeId,
    bodyDigest: observation.bodyDigest,
    providerObservationDigest: observation.observationDigest
  });
  const approval = deepFreeze({ ...canonical, approvalDigest: sha256(canonical) });
  issuedAuthorApprovals.add(approval);
  return approval;
}

export function assertSourceProgramTestAuthorApproval(value: SourceProgramTestAuthorApproval): void {
  if (!issuedAuthorApprovals.has(value)) return decisionError('author approval', 'live authenticated adoption required');
}

/**
 * Check the approved/proposed data against compiler facts. The returned data is
 * conditional; the live host must qualify it against its authenticated adoption.
 */
export function assessSourceProgramTestAuthorDecision(input: Readonly<{
  payload: SourceProgramTestAuthorDecisionPayload;
  baseline: SourceProgramSupersessionEvidence;
  current: SourceProgramSupersessionEvidence;
  changedPaths: readonly string[];
}>): SourceProgramTestAuthorAssessment {
  const payload = parseSourceProgramTestAuthorDecisionPayload(input.payload);
  for (const side of ['baseline', 'current'] as const) {
    const expected = payload[side];
    const evidence = input[side];
    if (expected.sourceRevision !== evidence.identity.sourceRevision
        || expected.modelDigest !== evidence.source.modelDigest
        || expected.testCompilationDigest !== evidence.source.testCompilationDigest) {
      return decisionError('author subject', `${side} compilation drift`);
    }
  }
  const before = new Map(input.baseline.tests.map((test) => [test.testId, test] as const));
  const after = new Map(input.current.tests.map((test) => [test.testId, test] as const));
  const changed = new Set(input.changedPaths);
  const beforeInputs = new Map(input.baseline.testDefinitionInputs.map((inputs) => [inputs.inputDigest, inputs] as const));
  const afterInputs = new Map(input.current.testDefinitionInputs.map((inputs) => [inputs.inputDigest, inputs] as const));
  const owners = new Set([...input.baseline.intentEvidence, ...input.current.intentEvidence].map(({ owner }) => owner));
  const seen = new Set<string>();
  const currentDecisionCounts = new Map<string, number>();
  const relocatedTargets = new Map<string, string>();
  const acceptedResponsibilities: VerificationTestResponsibility[] = [];
  const retentionKey = (test: SourceProgramSupersessionEvidence['tests'][number]): string =>
    JSON.stringify([test.owner, test.path, test.registrationContentDigest]);
  const uniqueRetentions = (tests: SourceProgramSupersessionEvidence['tests']) => {
    const targets = new Map<string, string | null>();
    for (const test of tests) {
      const key = retentionKey(test);
      targets.set(key, targets.has(key) ? null : test.testId);
    }
    return targets;
  };
  // Build these only for an explicitly authored relocation, never to discover
  // automatic retention or to change historical same-occurrence decisions.
  let uniqueBefore: ReturnType<typeof uniqueRetentions> | undefined;
  let uniqueAfter: ReturnType<typeof uniqueRetentions> | undefined;
  for (const decision of payload.decisions) {
    for (const id of decision.currentTestIds) currentDecisionCounts.set(id, (currentDecisionCounts.get(id) ?? 0) + 1);
  }
  for (const decision of payload.decisions) {
    if (!owners.has(decision.owner)) return decisionError('author owner', 'not a canonical compared owner');
    if (decision.changedInputPaths.some((path) => !changed.has(path))) {
      return decisionError('author scope', 'contains a path outside the exact Git transition');
    }
    for (const testId of decision.baselineTestIds) {
      if (!before.has(testId) || seen.has(testId)) return decisionError('author scope', 'missing or multiply decided baseline registration');
      if (before.get(testId)!.owner !== decision.owner) {
        return decisionError('author owner', 'does not own the exact baseline occurrence');
      }
      seen.add(testId);
    }
    if (decision.currentTestIds.some((testId) => !after.has(testId))) {
      return decisionError('author scope', 'replacement is absent from current discovery');
    }
    if (decision.disposition === 'introduce'
        && (decision.currentTestIds.some(id => before.has(id) || currentDecisionCounts.get(id) !== 1
          || after.get(id)!.owner !== decision.owner)
          || decision.baselineResponsibilities.length !== 0)) {
      return decisionError('author introduction', 'requires uniquely decided actually-new current occurrences owned by the exact author scope');
    }
    const replacementOwners = [...new Set(decision.currentTestIds.map((testId) => after.get(testId)!.owner))];
    if (replacementOwners.some((owner) => owner === null || !owners.has(owner))
        || sha256(replacementOwners.sort()) !== sha256(decision.replacementOwners)) {
      return decisionError('author owner', 'current occurrence owners differ from the explicitly adopted owner transition');
    }
    const reviewedInputs = new Set([
      ...(input.baseline.testDefinitionContext?.inputs.map(({ path }) => path) ?? []),
      ...(input.current.testDefinitionContext?.inputs.map(({ path }) => path) ?? []),
      ...decision.baselineTestIds.flatMap((testId) => {
        const test = before.get(testId)!;
        return beforeInputs.get(test.definitionInputDigest)!.inputs.map(({ path }) => path);
      }),
      ...decision.currentTestIds.flatMap((testId) => {
        const test = after.get(testId)!;
        return afterInputs.get(test.definitionInputDigest)!.inputs.map(({ path }) => path);
      })
    ]);
    const reviewedEnvelopes = [
      ...(input.baseline.testDefinitionContext?.readEnvelopes ?? []),
      ...(input.current.testDefinitionContext?.readEnvelopes ?? []),
      ...decision.baselineTestIds.flatMap((testId) =>
        beforeInputs.get(before.get(testId)!.definitionInputDigest)!.readEnvelopes),
      ...decision.currentTestIds.flatMap((testId) =>
        afterInputs.get(after.get(testId)!.definitionInputDigest)!.readEnvelopes)
    ];
    const requiredChangedInputs = [...changed].filter((path) => reviewedInputs.has(path)
      || reviewedEnvelopes.some(({ root, descendants }) => path === root
        || descendants && (root === '.' || path.startsWith(`${root}/`)))).sort(compareCodeUnits);
    if (sha256(requiredChangedInputs) !== sha256(decision.changedInputPaths)) {
      return decisionError('author scope', 'does not name the complete changed observed definition-input boundary');
    }
    if (decision.disposition === 'retain-unassessed') {
      if (sha256(decision.replacementOwners) !== sha256([decision.owner])
          || decision.baselineResponsibilities.length !== 0 || decision.currentResponsibilities.length !== 0) {
        return decisionError('author retention', 'unassessed retention cannot rewrite or certify a registration');
      }
      if (sha256(decision.baselineTestIds) === sha256(decision.currentTestIds)) {
        if (decision.baselineTestIds.some((testId) => {
            const old = before.get(testId)!;
            const next = after.get(testId)!;
            return old.path !== next.path || old.registrationContentDigest !== next.registrationContentDigest;
          })) return decisionError('author retention', 'unassessed retention cannot rewrite or certify a registration');
      } else {
        uniqueBefore ??= uniqueRetentions(input.baseline.tests);
        uniqueAfter ??= uniqueRetentions(input.current.tests);
        const selected = new Set(decision.currentTestIds);
        if (decision.baselineTestIds.length !== selected.size) {
          return decisionError('author retention', 'relocation requires one-to-one current registrations');
        }
        for (const testId of decision.baselineTestIds) {
          const key = retentionKey(before.get(testId)!);
          const target = uniqueAfter.get(key);
          if (uniqueBefore.get(key) !== testId || target === undefined || target === null
              || !selected.delete(target) || currentDecisionCounts.get(target) !== 1) {
            return decisionError('author retention', 'relocation requires unique same-owner path and registration content');
          }
          relocatedTargets.set(testId, target);
        }
      }
    } else if (decision.disposition === 'retire') {
      const refs = decision.baselineResponsibilityRefs ?? [];
      if (decision.baselineResponsibilities.length !== 0 || decision.currentResponsibilities.length !== 0
          || decision.currentTestIds.length !== 0
          || sha256(decision.baselineTestIds) !== sha256(refs.map(({ testId }) => testId))
          || decision.baselineTestIds.some(testId => after.has(testId))) {
        return decisionError('author retirement', 'requires locators for every exact removed registration, never new baseline contents');
      }
      const accepted = refs.map(({ testId, acceptanceDigest }) => {
        const original = before.get(testId)!;
        const artifact = original.acceptedResponsibility;
        if (artifact === undefined || artifact.acceptanceDigest !== acceptanceDigest
            || artifact.testId !== testId || artifact.path !== original.path
            || artifact.sourceRevision !== input.baseline.identity.sourceRevision
            || artifact.definitionInputDigest !== original.definitionInputDigest
            || artifact.registrationContentDigest !== original.registrationContentDigest
            || artifact.responsibility.ownerRef !== original.owner) {
          return decisionError('author retirement', 'independently accepted baseline responsibility missing or mismatched');
        }
        return parseSourceProgramAcceptedTestResponsibility(artifact);
      });
      acceptedResponsibilities.push(...accepted.map(({ responsibility }) => responsibility));
      const selected = (payload.requirementDecisions ?? []).filter(({ decisionId }) => decision.retirementDecisionIds?.includes(decisionId));
      if (selected.length !== decision.retirementDecisionIds?.length) return decisionError('author retirement', 'unknown requirement disposition');
      const covered = new Set<string>();
      for (const { responsibility } of accepted) {
        const bindings = new Set(responsibility.bindings.map(({ specification }) => specification.bindingDigest));
        const scoped = selected.filter(({ baselineBindingDigest }) => bindings.has(baselineBindingDigest));
        for (const { decisionId } of scoped) covered.add(decisionId);
        const evaluation = evaluateVerificationTestRetirement({ responsibility, decisions: scoped,
          currentSourceRevision: payload.current.sourceRevision });
        if (evaluation.status !== 'eligible') return decisionError('author retirement', evaluation.blockers.join(', '));
      }
      if (covered.size !== selected.length) return decisionError('author retirement', 'requirement decisions outside exact baseline bindings');
    } else {
      for (const [ids, responsibilities, occurrences] of [
        [decision.baselineTestIds, decision.baselineResponsibilities, before],
        [decision.currentTestIds, decision.currentResponsibilities, after]
      ] as const) {
        if (sha256(ids) !== sha256(responsibilities.map(({ testId }) => testId))
            || responsibilities.some(({ testId, responsibility }) =>
              responsibility.ownerRef !== occurrences.get(testId)?.owner
              || responsibility.bindings.some(({ specification }) =>
                specification.claim.ownerRef !== responsibility.ownerRef
                || specification.proofObligation.ownerRef !== responsibility.ownerRef))) {
          return decisionError('author rewrite', 'each exact occurrence requires its canonical responsibility and owner');
        }
      }
    }
  }
  if (payload.requirementDecisions !== undefined) {
    const used = new Set(payload.decisions.flatMap(decision => decision.retirementDecisionIds ?? []));
    if (used.size !== payload.requirementDecisions.length
        || payload.requirementDecisions.some(({ decisionId }) => !used.has(decisionId))) {
      return decisionError('author retirement', 'unconsumed semantic adoption is outside this operation');
    }
  }
  // Retire payloads carry locators rather than responsibility contents. Check
  // the exact BASE responsibilities together with every other decision and
  // renewed claim before issuing even a conditional author assessment.
  assertResponsibilityIdentities(payload.decisions, payload.requirementDecisions, acceptedResponsibilities);
  const canonical = deepFreeze({
    authority: 'conditional-author-input' as const,
    payloadDigest: payload.payloadDigest,
    operationId: payload.operationId,
    baselineSourceRevision: input.baseline.identity.sourceRevision,
    currentSourceRevision: input.current.identity.sourceRevision,
    baselineModelDigest: input.baseline.source.modelDigest,
    currentModelDigest: input.current.source.modelDigest,
    baselineTestCompilationDigest: input.baseline.source.testCompilationDigest,
    currentTestCompilationDigest: input.current.source.testCompilationDigest,
    decisions: payload.decisions
  });
  const assessment = deepFreeze({ ...canonical, assessmentDigest: sha256(canonical) });
  issuedAuthorAssessments.set(assessment, relocatedTargets);
  return assessment;
}

export function assertSourceProgramTestAuthorAssessment(value: SourceProgramTestAuthorAssessment): void {
  if (!issuedAuthorAssessments.has(value)) return decisionError('author assessment', 'exact compiler assessment required');
}

/** A data handoff from the existing author assessment, never an approval. */
export function sourceProgramTestAuthorRelocatedTarget(
  assessment: SourceProgramTestAuthorAssessment,
  baselineTestId: string
): string | undefined {
  assertSourceProgramTestAuthorAssessment(assessment);
  return issuedAuthorAssessments.get(assessment)!.get(baselineTestId);
}

export function qualifySourceProgramTestAuthorAssessment(input: Readonly<{
  approval: SourceProgramTestAuthorApproval;
  assessment: SourceProgramTestAuthorAssessment;
}>): 'qualified' | 'test-only-simulation' {
  assertSourceProgramTestAuthorApproval(input.approval);
  assertSourceProgramTestAuthorAssessment(input.assessment);
  const assessment = authorRecord(snapshotVerificationData(input.assessment, 'author assessment'), [
    'authority', 'payloadDigest', 'operationId', 'baselineSourceRevision',
    'currentSourceRevision', 'baselineModelDigest', 'currentModelDigest',
    'baselineTestCompilationDigest', 'currentTestCompilationDigest',
    'decisions', 'assessmentDigest'
  ], 'author assessment');
  const { assessmentDigest, ...canonical } = assessment;
  const payload = input.approval.payload;
  if (assessment.authority !== 'conditional-author-input'
      || assessmentDigest !== sha256(canonical)
      || assessment.baselineSourceRevision !== payload.baseline.sourceRevision
      || assessment.currentSourceRevision !== payload.current.sourceRevision
      || assessment.baselineModelDigest !== payload.baseline.modelDigest
      || assessment.currentModelDigest !== payload.current.modelDigest
      || assessment.baselineTestCompilationDigest !== payload.baseline.testCompilationDigest
      || assessment.currentTestCompilationDigest !== payload.current.testCompilationDigest
      || sha256(assessment.decisions) !== sha256(payload.decisions)) {
    return decisionError('author assessment', 'projection differs from the exact reviewed candidate');
  }
  if (input.approval.payload.payloadDigest !== input.assessment.payloadDigest
      || input.approval.payload.operationId !== input.assessment.operationId) {
    return decisionError('author assessment', 'does not bind the authenticated adoption');
  }
  return input.approval.providerOrigin === 'production' ? 'qualified' : 'test-only-simulation';
}

/** Exact immutable sources are reobserved with the same current comment/actor. */
export function sourceProgramRequirementSourceRequests(payload: SourceProgramTestAuthorDecisionPayload): readonly GitHubRepositoryRequirementSource[] {
  const entries = new Map<string, GitHubRepositoryRequirementSource>();
  for (const decision of payload.requirementDecisions ?? []) {
    for (const [source, commitSha] of [[decision.priorSource, payload.baseline.commitSha],
      [decision.currentSource, payload.current.commitSha]] as const) {
      const value = Object.freeze({ commitSha, path: source.path, blobSha: source.blobSha, contentDigest: source.contentDigest });
      const key = JSON.stringify([commitSha, source.path]);
      const previous = entries.get(key);
      if (previous !== undefined && sha256(previous) !== sha256(value)) return decisionError('requirement source', 'conflicting exact source binding');
      entries.set(key, value);
    }
  }
  return Object.freeze([...entries].sort(([left], [right]) => compareCodeUnits(left, right)).map(([, value]) => value));
}
