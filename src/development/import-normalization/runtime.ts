import {
  compileSourceProgramOperationProducerClosure
} from '../../brownfield/source-program-model/repository.ts';
import {
  acquireExactGitTreeWorkspaceSourceSnapshot
} from '../../brownfield/source-program-model/workspace-source-snapshot.ts';
import { sha256 } from '../../system-architecture/foundation/runtime/canonical.ts';
import {
  bindSecSemanticOperation,
  compileSecCapabilityBinding,
  compileSecProviderSettlementSet,
  compileSecSemanticOperationPlan,
  issueSecNormalDomainReadbackReceipt,
  issueSecNormalOwnerTerminalJoinReceipt,
  issueSecProviderSettlementReceipt,
  issueSecSemanticOperationAttemptContext
} from '../../system-architecture/operation/semantic.ts';
import {
  issueNonProcessVerificationActionTerminalSettlement,
  issueVerificationActionOwnerTerminalReceipt,
  type VerificationActionKeyInput,
  type VerificationActionTerminalSettlement
} from '../../verification/action/contract/action.ts';
import {
  createVerificationActionRunner,
  type VerificationActionRunOutcome
} from '../../verification/action/runner.ts';
import { runStagedImportCheck } from '../runner/import-organizer.ts';
import {
  compileCandidateNormalizationActionKey,
  compileCandidateNormalizationSubject,
  IMPORT_NORMALIZATION_OPERATION,
  type CandidateNormalizationDigest,
  type CandidateNormalizationSubject
} from './contract.ts';

const candidateNormalizationActionRunner = createVerificationActionRunner();

async function settleNormalizationObservation(
  subject: CandidateNormalizationSubject,
  action: ReturnType<typeof compileCandidateNormalizationActionKey>,
  status: 'canonical' | 'needs-import-transform',
  files: readonly string[]
): Promise<VerificationActionTerminalSettlement> {
  const observationDigest = sha256({ status, files }) as CandidateNormalizationDigest;
  const plan = compileSecSemanticOperationPlan({
    operation: 'development.import-normalization',
    intentDigest: action.actionKey,
    decisionDigest: subject.subjectDigest,
    deadlineAtUnixMs: Date.now() + 300_000,
    aggregateBudgets: [
      { resource: 'duration-ms', maximum: 300_000 },
      { resource: 'processes', maximum: 64 },
      { resource: 'records', maximum: Math.max(1, files.length) }
    ],
    requirements: [{
      id: 'candidate-normalization-observation',
      contractDigest: subject.normalizationContractDigest,
      effectKinds: ['filesystem', 'process'],
      failureKinds: ['candidate-normalization-noncanonical']
    }],
    attempt: issueSecSemanticOperationAttemptContext({
      authorityGrantDigest: subject.subjectDigest
    })
  });
  const bound = bindSecSemanticOperation(plan, [compileSecCapabilityBinding({
    requirementId: 'candidate-normalization-observation',
    contractDigest: subject.normalizationContractDigest,
    providerIdentityDigest: subject.producerClosureDigest
  })]);
  const provider = issueSecProviderSettlementReceipt(bound, {
    requirementId: 'candidate-normalization-observation',
    physicalDisposition: 'settled',
    providerSettlementReferenceDigest: observationDigest
  });
  const providerSet = compileSecProviderSettlementSet(bound, [provider]);
  const passed = status === 'canonical';
  const readback = issueSecNormalDomainReadbackReceipt(bound, providerSet, {
    readbackContractDigest: subject.resultContractDigest,
    readbackReferenceDigest: observationDigest,
    currentPhysicalEpochDigest: subject.subjectDigest,
    disposition: passed ? 'applied' : 'not-applied'
  });
  const join = issueSecNormalOwnerTerminalJoinReceipt(bound, providerSet, readback, {
    ownerTerminalContractDigest: subject.resultContractDigest,
    ownerTerminalReferenceDigest: observationDigest
  });
  const receipt = issueVerificationActionOwnerTerminalReceipt({
    action,
    operation: bound,
    providerSettlementSet: providerSet,
    readback,
    ownerTerminalProjection: join
  });
  return issueNonProcessVerificationActionTerminalSettlement(receipt, {
    status: passed ? 'passed' : 'failed',
    reasonCode: passed ? 'executed-success' : 'executed-failure'
  });
}

/**
 * Commit admission over one immutable candidate commit. Source Program issues
 * the bounded producer closure from its exact snapshot graph; the existing
 * VerificationAction runner exclusively owns start/join/reuse and terminal
 * persistence. There is no caller-authored digest or local PASS projection.
 */
export async function verifyCandidateImportNormalization(input: Readonly<{
  repositoryRoot: string;
  candidateCommit: string;
}>): Promise<VerificationActionRunOutcome> {
  const snapshot = acquireExactGitTreeWorkspaceSourceSnapshot({
    repositoryRoot: input.repositoryRoot,
    commitSha: input.candidateCommit
  });
  const producerClosure = compileSourceProgramOperationProducerClosure(
    snapshot,
    IMPORT_NORMALIZATION_OPERATION
  );
  const subject = compileCandidateNormalizationSubject({ snapshot, producerClosure });
  const action = compileCandidateNormalizationActionKey(subject);
  const { schema: _schema, actionKey: _actionKey, ...actionInput } = action;
  return candidateNormalizationActionRunner.executeIdentity({
    repositoryRoot: input.repositoryRoot,
    actionInput: actionInput as VerificationActionKeyInput,
    executionClass: 'cheap-preflight',
    executionDomain: 'candidate-import-normalization',
    executor: async () => {
      const observation = await runStagedImportCheck(input.repositoryRoot);
      return settleNormalizationObservation(
        subject,
        action,
        observation.status,
        observation.files
      );
    }
  });
}
