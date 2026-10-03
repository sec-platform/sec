import { readVerificationDataRecord, snapshotVerificationData } from '../../../assurance/verification/contract/data.ts';
import { deepFreeze, rawSha256, sha256 } from '../../../contracts/canonical.ts';
import { sourceProgramTestChangedSharedInputPaths } from '../source-program-model/reconciliation-findings.ts';
import {
  compileSourceProgramSupersessionReceipt,
  compileSourceProgramTestRetirementFromFacts,
  evaluateSourceProgramTestRetirementDispositions,
  parseSourceProgramSupersessionEvidence,
  parseSourceProgramTestRetirementFacts,
  type SourceProgramSupersessionEvidence,
  type SourceProgramTestRetirementReceipt
} from '../source-program-model/reduction.ts';
import {
  assessSourceProgramTestAuthorDecision,
  parseSourceProgramTestAuthorDecisionPayload,
  qualifySourceProgramTestAuthorAssessment,
  type SourceProgramTestAuthorApproval,
  type SourceProgramTestAuthorAssessment,
  type SourceProgramTestAuthorDecisionPayload
} from '../source-program-model/test-disposition-decisions.ts';
import {
  reconcileSourceProgramTestValueWithSupersession,
  SOURCE_PROGRAM_BLOCKING_TEST_FINDING_CODES,
  summarizeSourceProgramTestUnknownDispositionClusters,
  type SourceProgramTestValueCompilation
} from '../source-program-model/test-value.ts';
import type { RepositoryAuditLoadedImplementationEvidence } from './loaded-implementation.ts';
import {
  compileSourceProgramAuditOperation,
  compileSourceProgramAuditOperationInput,
  encodeSourceProgramAuditOperationInput,
  encodeSourceProgramAuditOperationResult,
  isTestObligationsAuditFacts,
  type CompileTestObligationsAuditOperationInput,
  type CompileWholeSourceProgramAuditOperationInput,
  type SourceProgramAuditOperationResult
} from './source-program-audit-operation.ts';
import {
  compileRepositoryAuditWorkerHandshakeCandidate,
  compileRepositoryAuditWorkerRequest,
  compileRepositoryAuditWorkerResultCandidate,
  encodeRepositoryAuditWorkerCandidateStream
} from './worker-protocol.ts';

/** Serializable facts, not approval. The candidate and runtime are separate subjects. */
interface SourceProgramTransitionAssessmentFields {
  readonly runtimeSha: string;
  readonly baseSha: string;
  readonly baseTreeSha: string;
  readonly headSha: string;
  readonly headTreeSha: string;
  readonly baseline: SourceProgramSupersessionEvidence;
  readonly current: SourceProgramSupersessionEvidence;
  readonly changedPaths: readonly string[];
  readonly authorAssessment: SourceProgramTestAuthorAssessment | null;
  readonly currentTestValue: SourceProgramTestValueCompilation;
  readonly testRetirement: SourceProgramTestRetirementReceipt;
  readonly producerExecution: RepositoryAuditLoadedImplementationEvidence;
  readonly auditResult: SourceProgramAuditOperationResult;
  readonly status: 'accepted' | 'conditional-author-input' | 'blocked';
  readonly assessmentDigest: string;
}

export type SourceProgramTransitionAssessment = SourceProgramTransitionAssessmentFields & (
  | Readonly<{ schema: 'source-program-transition-assessment-v1'; auditFacts: CompileWholeSourceProgramAuditOperationInput }>
  | Readonly<{ schema: 'source-program-transition-assessment-v2' | 'source-program-transition-assessment-v3'; auditFacts: CompileTestObligationsAuditOperationInput }>
);

/** Semantic judgment facts only; the physical producer owner qualifies them. */
export interface SourceProgramTransitionAdoption {
  readonly status: 'accepted';
  readonly assessmentDigest: string;
  readonly approvalDigest: string | null;
  readonly auditResultDigest: string;
  readonly adoptionDigest: string;
}

/** A complete source result can still require a separate business decision. */
export class SourceProgramTransitionAdoptionBlockedError extends Error {
  readonly blockingReasons: readonly string[];
  readonly authorInputRequired: boolean;

  constructor(blockingReasons: readonly string[], authorInputRequired: boolean) {
    super(`Source transition remains blocked: ${blockingReasons.join(', ')}`);
    this.name = 'SourceProgramTransitionAdoptionBlockedError';
    this.blockingReasons = Object.freeze([...blockingReasons]);
    this.authorInputRequired = authorInputRequired;
  }
}

const SHA = /^[a-f0-9]{40}$/u;
const ASSESSMENT_KEYS = [
  'schema', 'runtimeSha', 'baseSha', 'baseTreeSha', 'headSha', 'headTreeSha',
  'baseline', 'current', 'changedPaths', 'authorAssessment', 'currentTestValue',
  'testRetirement', 'auditFacts', 'producerExecution', 'auditResult', 'status', 'assessmentDigest'
] as const;

type AssessmentInput = Omit<SourceProgramTransitionAssessment,
  'schema' | 'auditResult' | 'status' | 'assessmentDigest'>;

/** Compile transition facts under adopted code; this issues no authority. */
export function createSourceProgramTransitionAssessment(input: AssessmentInput): SourceProgramTransitionAssessment {
  for (const value of [input.runtimeSha, input.baseSha, input.baseTreeSha, input.headSha, input.headTreeSha]) {
    if (!SHA.test(value)) throw new Error('Source transition requires exact commit and tree pins');
  }
  if (input.runtimeSha !== input.baseSha) throw new Error('Source transition interpreter must be the adopted base');
  parseSourceProgramSupersessionEvidence(input.baseline);
  parseSourceProgramSupersessionEvidence(input.current);
  if (input.currentTestValue.compilationDigest !== input.current.source.testCompilationDigest
      || input.currentTestValue.sourceRevision !== input.current.identity.sourceRevision
      || input.testRetirement.currentTestCompilationDigest !== input.currentTestValue.compilationDigest) {
    throw new Error('Source transition test observations differ from compared evidence');
  }
  if (input.auditFacts.options.authorityScope !== 'test-obligations'
      || input.auditFacts.supersession.authorityScope !== 'test-obligations') {
    throw new Error('Test transition assessment cannot stand in for whole-program equivalence');
  }
  if (isTestObligationsAuditFacts(input.auditFacts) && (
    input.auditFacts.baselineCompilation.sourceRevision !== input.baseline.identity.sourceRevision
    || input.auditFacts.baselineCompilation.modelDigest !== input.baseline.source.modelDigest
    || input.auditFacts.sourceProgram.sourceRevision !== input.current.identity.sourceRevision
    || input.auditFacts.sourceProgram.modelDigest !== input.current.source.modelDigest
  )) {
    throw new Error('Scoped test facts differ from the actual compared source evidence');
  }
  if (input.auditFacts.testFindingDelta === undefined
      || sha256(input.auditFacts.testFindingDelta.changedSharedInputPaths) !== sha256(sourceProgramTestChangedSharedInputPaths(
        [input.baseline.testDefinitionContext, input.current.testDefinitionContext], input.changedPaths))) {
    throw new Error('Source transition shared test-input delta is not bound to exact compared paths');
  }
  if (input.testRetirement.structuralFacts !== undefined) {
    const structural = parseSourceProgramTestRetirementFacts(input.testRetirement.structuralFacts);
    const { receiptDigest, ...receiptFields } = input.testRetirement;
    if (structural.baselineSourceRevision !== input.baseline.identity.sourceRevision
        || structural.currentSourceRevision !== input.current.identity.sourceRevision
        || structural.baselineRegistrationCensusDigest !== sha256(input.baseline.tests)
        || structural.currentRegistrationCensusDigest !== sha256(input.current.tests)
        || receiptDigest !== sha256(receiptFields)
        || sha256(input.auditFacts.testRetirement) !== sha256(input.testRetirement)) {
      throw new Error('Source transition retirement facts differ from actual producer-bound facts');
    }
  }
  const operation = compileSourceProgramAuditOperationInput(input.auditFacts);
  const auditResult = compileSourceProgramAuditOperation(operation);
  const producer = input.producerExecution;
  const { evidenceDigest, ...producerFields } = producer;
  if (producer.schema !== 'repository-audit-loaded-implementation-history-v1'
      || producer.authority !== 'historical-evidence-only' || evidenceDigest !== sha256(producerFields)
      || producer.observation.operationIdentityDigest !== producer.operation.plan.identity.identityDigest
      || producer.observation.boundAttemptDigest !== producer.operation.boundAttemptDigest
      || producer.resources.operationIdentityDigest !== producer.observation.operationIdentityDigest
      || producer.resources.boundAttemptDigest !== producer.observation.boundAttemptDigest
      || producer.resources.failedProcessCount !== 0 || producer.resources.settledProcessCount !== 1
      || producer.process.code !== 0 || producer.process.stdoutDigest !== producer.streamDigest
      || producer.request.subjectDigest !== operation.binding.subjectDigest) {
    throw new Error('Source transition does not retain its exact settled producer execution');
  }
  // Rebuild the bounded protocol bytes from the retained canonical facts.
  // This verifies historical joins only; none of these pure constructors can
  // recreate the physical loaded-implementation observation used at issuance.
  const request = compileRepositoryAuditWorkerRequest({ ...producer.request,
    payload: encodeSourceProgramAuditOperationInput(operation) });
  const handshake = compileRepositoryAuditWorkerHandshakeCandidate(request);
  const result = compileRepositoryAuditWorkerResultCandidate(request, handshake,
    encodeSourceProgramAuditOperationResult(auditResult));
  const { payloadBase64: _requestPayload, ...requestIdentity } = request;
  const { payloadBase64: _resultPayload, ...resultIdentity } = result;
  const stream = encodeRepositoryAuditWorkerCandidateStream(request, handshake, result);
  if (sha256(requestIdentity) !== sha256(producer.request)
      || sha256(handshake) !== sha256(producer.handshake)
      || sha256(resultIdentity) !== sha256(producer.result)
      || rawSha256(stream) !== producer.streamDigest
      || stream.byteLength !== producer.process.stdoutBytes) {
    throw new Error('Source transition retained facts differ from actual producer protocol bytes');
  }
  const conditionalReasons = new Set(['test-author-qualification-required', 'test-retirement-blocked', 'test-value-finding-regression', 'test-finding-reconciliation-unresolved']);
  const status = operation.blockingReasons.length === 0 ? 'accepted' as const
    : input.authorAssessment !== null && operation.blockingReasons.every(reason => conditionalReasons.has(reason))
      ? 'conditional-author-input' as const : 'blocked' as const;
  const fields = { ...input, auditResult, status };
  const canonical = isTestObligationsAuditFacts(input.auditFacts)
    ? deepFreeze({ ...fields, schema: input.testRetirement.structuralFacts === undefined
      ? 'source-program-transition-assessment-v2' as const : 'source-program-transition-assessment-v3' as const, auditFacts: input.auditFacts })
    : deepFreeze({ ...fields, schema: 'source-program-transition-assessment-v1' as const, auditFacts: input.auditFacts });
  return deepFreeze({ ...canonical, assessmentDigest: sha256(canonical) });
}

/** Decode bounded producer data. This does not restore a provider observation. */
export function parseSourceProgramTransitionAssessment(value: unknown): SourceProgramTransitionAssessment {
  const data = readVerificationDataRecord(snapshotVerificationData(value, 'Source transition assessment'), 'Source transition assessment');
  const actual = Object.keys(data).sort(), expected = [...ASSESSMENT_KEYS].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error('Source transition assessment fields differ from the canonical contract');
  }
  const { schema, auditResult, status, assessmentDigest, ...input } = data;
  const parsed = createSourceProgramTransitionAssessment(input as unknown as AssessmentInput);
  if (schema !== parsed.schema || status !== parsed.status
      || assessmentDigest !== parsed.assessmentDigest || sha256(auditResult) !== sha256(parsed.auditResult)) {
    throw new Error('Source transition assessment bytes or interpretation are not canonical');
  }
  return parsed;
}

/** Interpret later author input over exact source facts; this issues no adoption authority. */
export function assessSourceProgramTransitionAuthorInput(input: Readonly<{
  assessment: Pick<SourceProgramTransitionAssessment,
    'runtimeSha' | 'baseSha' | 'baseTreeSha' | 'headSha' | 'headTreeSha'
    | 'baseline' | 'current' | 'changedPaths' | 'authorAssessment'>;
  payload: SourceProgramTestAuthorDecisionPayload;
}>): SourceProgramTestAuthorAssessment {
  const payload = parseSourceProgramTestAuthorDecisionPayload(input.payload);
  const assessment = input.assessment;
  if (payload.trustedRevision !== assessment.runtimeSha
      || payload.baseline.commitSha !== assessment.baseSha || payload.baseline.treeSha !== assessment.baseTreeSha
      || payload.current.commitSha !== assessment.headSha || payload.current.treeSha !== assessment.headTreeSha) {
    throw new Error('Test author decision audience, revisions or live observation drifted');
  }
  const authorAssessment = assessSourceProgramTestAuthorDecision({
    payload, baseline: assessment.baseline, current: assessment.current, changedPaths: assessment.changedPaths
  });
  // Historical conditional assessments retain their exact interpretation. An
  // author-free source assessment remains immutable while a new judgment is issued.
  if (assessment.authorAssessment !== null
      && sha256(authorAssessment) !== sha256(assessment.authorAssessment)) {
    throw new Error('Test author assessment differs from the observed conditional interpretation');
  }
  return authorAssessment;
}

/** Recompute adopted Test Value policy over supplied facts. The result does not
 * authenticate those facts or grant a Gate capability; that join belongs to
 * the existing trusted-runtime producer observation owner. */
export function compileSourceProgramTransitionAdoption(input: Readonly<{
  assessment: SourceProgramTransitionAssessment;
  approval?: SourceProgramTestAuthorApproval;
}>): SourceProgramTransitionAdoption {
  const assessment = parseSourceProgramTransitionAssessment(input.assessment);
  let authorAssessment: SourceProgramTestAuthorAssessment | undefined;
  if (input.approval !== undefined) {
    authorAssessment = assessSourceProgramTransitionAuthorInput({ assessment, payload: input.approval.payload });
    if (qualifySourceProgramTestAuthorAssessment({ approval: input.approval, assessment: authorAssessment }) !== 'qualified') {
      throw new Error('Test author assessment differs from the observed conditional interpretation');
    }
  } else if (assessment.authorAssessment !== null) {
    throw new Error('Conditional Source transition requires fresh live author adoption');
  }
  const supersession = compileSourceProgramSupersessionReceipt({
    authorityScope: 'test-obligations',
    baseline: assessment.baseline, current: assessment.current, changedPaths: assessment.changedPaths,
    ...(authorAssessment === undefined ? {} : { authorAssessment, authorApproval: input.approval! })
  });
  let facts = assessment.auditFacts;
  if (authorAssessment !== undefined) {
    const authorProjection = reconcileSourceProgramTestValueWithSupersession(assessment.currentTestValue, supersession);
    let testRetirement: SourceProgramTestRetirementReceipt;
    let testDisposition: typeof facts.testDisposition;
    if (assessment.testRetirement.structuralFacts !== undefined) {
      const retirementEvaluation = compileSourceProgramTestRetirementFromFacts({
        facts: assessment.testRetirement.structuralFacts, supersession, currentTestCompilation: assessment.currentTestValue
      });
      testRetirement = retirementEvaluation.report;
      testDisposition = evaluateSourceProgramTestRetirementDispositions(authorProjection, retirementEvaluation);
    } else {
      if ((supersession.retirements?.length ?? 0) > 0) {
        throw new SourceProgramTransitionAdoptionBlockedError(['retirement-structural-facts-unavailable'], false);
      }
      const rewrites = new Map(authorProjection.dispositions.filter(disposition =>
        disposition.disposition === 'rewrite' && disposition.evidence.ownerDecisionDigest === input.approval!.payload.payloadDigest)
        .map(disposition => [disposition.path, disposition] as const));
      // Excluding an explicitly rewritten module from the consumer-zero route
      // does not issue a DELETE proof. Every original proof that remains is kept.
      const { receiptDigest: _retirementDigest, ...priorRetirement } = assessment.testRetirement;
      const retirementData = deepFreeze({ ...priorRetirement,
        supersessionReceiptDigest: supersession.receiptDigest,
        proofs: priorRetirement.proofs.filter(proof => !rewrites.has(proof.path)) });
      testRetirement = deepFreeze({ ...retirementData, receiptDigest: sha256(retirementData) });
      const { projectionDigest: _projectionDigest, ...priorDisposition } = facts.testDisposition;
      const dispositionData = deepFreeze({ ...priorDisposition,
        dispositions: priorDisposition.dispositions.map(disposition => rewrites.get(disposition.path) ?? disposition),
        findings: priorDisposition.findings.filter(finding =>
          finding.code !== 'test-module-disposition-unknown' || !rewrites.has(finding.path)),
        supersessionReceiptDigest: rewrites.size === 0 ? null : supersession.receiptDigest,
        retirementReceiptDigest: testRetirement.receiptDigest });
      testDisposition = deepFreeze({ ...dispositionData, projectionDigest: sha256(dispositionData) });
    }
    const blockingCodes = new Set<string>(SOURCE_PROGRAM_BLOCKING_TEST_FINDING_CODES);
    facts = deepFreeze({ ...facts, supersession, testRetirement, testDisposition,
      blockingTestFindings: testDisposition.findings.filter(({ code }) => blockingCodes.has(code)),
      unknownDispositionClusters: summarizeSourceProgramTestUnknownDispositionClusters(testDisposition.dispositions, testDisposition.findings) });
  } else if (supersession.receiptDigest !== facts.supersession.receiptDigest) {
    throw new Error('Source transition receipt differs from adopted host interpretation');
  }
  const operation = compileSourceProgramAuditOperationInput(facts);
  if (operation.blockingReasons.length !== 0) {
    throw new SourceProgramTransitionAdoptionBlockedError(operation.blockingReasons,
      input.approval === undefined && operation.blockingReasons.some(reason => (
        reason === 'supersession-owner-decision' || reason === 'test-author-qualification-required'
      )));
  }
  const canonical = deepFreeze({
    status: 'accepted' as const, assessmentDigest: assessment.assessmentDigest,
    approvalDigest: input.approval?.approvalDigest ?? null,
    auditResultDigest: compileSourceProgramAuditOperation(operation).resultDigest
  });
  return deepFreeze({ ...canonical, adoptionDigest: sha256(canonical) });
}
