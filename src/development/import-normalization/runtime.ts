import {
  compileSourceProgramOperationProducerClosure,
  requireSourceProgramOperationProducerClosure
} from '../../brownfield/source-program-model/producer-closure.ts';
import { compileRepositorySourceProgramCompilation } from '../../brownfield/source-program-model/repository-compilation.ts';
import {
  assertSourceProgramTypeScriptCompilerIdentity,
  sourceProgramTypeScriptCompilerIdentity
} from '../../brownfield/source-program-model/typescript.ts';
import {
  acquireExactGitTreeWorkspaceSourceSnapshot
} from '../../brownfield/source-program-model/workspace-source-snapshot.ts';
import { CodexDevelopmentListExactGitTreeEntries } from '../../external-capabilities/git-read/exact-blob.ts';
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
import {
  compileCandidateNormalizationActionKey,
  compileCandidateNormalizationSubject,
  IMPORT_NORMALIZATION_OPERATION,
  requireCandidateNormalizationSnapshot,
  type CandidateNormalizationDigest,
  type CandidateNormalizationSubject
} from './contract.ts';
import { checkImmutableImportSnapshot } from './kernel.ts';

const candidateNormalizationActionRunner = createVerificationActionRunner();

function readBackCandidateNormalizationSnapshot(input: Readonly<{
  repositoryRoot: string;
  subject: CandidateNormalizationSubject;
}>): CandidateNormalizationDigest {
  const { snapshot } = requireCandidateNormalizationSnapshot(input.subject);
  const provenance = snapshot.subject.provenance;
  if (provenance.kind !== 'git-tree') {
    throw new Error('Candidate normalization readback requires exact Git provenance');
  }
  const entries = CodexDevelopmentListExactGitTreeEntries({
    repositoryRoot: input.repositoryRoot,
    commitSha: provenance.commitSha
  });
  const ordinaryEntries = entries.filter(({ mode, type }) => (
    (mode === '100644' || mode === '100755') && type === 'blob'
  ));
  if (sha256(entries) !== provenance.identityDigest
      || sha256(ordinaryEntries.map(({ blobSha, mode, repositoryPath }) => ({
        blobSha,
        mode,
        repositoryPath
      }))) !== provenance.objectCensusDigest) {
    throw new Error('Candidate normalization exact Git tree changed before terminal readback');
  }
  return input.subject.subjectDigest;
}

async function settleNormalizationObservation(
  subject: CandidateNormalizationSubject,
  action: ReturnType<typeof compileCandidateNormalizationActionKey>,
  status: 'canonical' | 'needs-import-transform',
  files: readonly string[],
  readbackSubjectDigest: CandidateNormalizationDigest
): Promise<VerificationActionTerminalSettlement> {
  if (readbackSubjectDigest !== subject.subjectDigest) {
    throw new Error('Candidate normalization exact snapshot changed before terminal readback');
  }
  const observationDigest = sha256({
    status,
    files,
    executionSubjectDigest: subject.subjectDigest,
    readbackSubjectDigest
  }) as CandidateNormalizationDigest;
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
    currentPhysicalEpochDigest: readbackSubjectDigest,
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
  candidateBase: string;
  candidateCommit: string;
}>): Promise<VerificationActionRunOutcome> {
  const snapshot = acquireExactGitTreeWorkspaceSourceSnapshot({
    repositoryRoot: input.repositoryRoot,
    commitSha: input.candidateCommit
  });
  const baseSnapshot = acquireExactGitTreeWorkspaceSourceSnapshot({
    repositoryRoot: input.repositoryRoot,
    commitSha: input.candidateBase
  });
  const sourceProgramCompilation = compileRepositorySourceProgramCompilation({
    workspaceSnapshot: snapshot
  });
  const producerClosure = compileSourceProgramOperationProducerClosure(
    sourceProgramCompilation,
    IMPORT_NORMALIZATION_OPERATION
  );
  requireSourceProgramOperationProducerClosure(producerClosure);
  const compilerIdentity = sourceProgramTypeScriptCompilerIdentity();
  assertSourceProgramTypeScriptCompilerIdentity(compilerIdentity);
  const subject = compileCandidateNormalizationSubject({
    snapshot,
    baseSnapshot,
    producerClosure,
    compilerIdentity
  });
  const action = compileCandidateNormalizationActionKey(subject);
  const { schema: _schema, actionKey: _actionKey, ...actionInput } = action;
  return candidateNormalizationActionRunner.executeIdentity({
    repositoryRoot: input.repositoryRoot,
    actionInput: actionInput as VerificationActionKeyInput,
    executionClass: 'cheap-preflight',
    executionDomain: 'candidate-import-normalization',
    executor: async () => {
      const execution = requireCandidateNormalizationSnapshot(subject);
      const observation = checkImmutableImportSnapshot({
        projectRoot: input.repositoryRoot,
        files: execution.snapshot.files.map(({ path, source, contentDigest }) => Object.freeze({
          relativePath: path,
          source,
          contentDigest: contentDigest as CandidateNormalizationDigest
        })),
        targetPaths: execution.targetPaths,
        expectedInputClosure: action.inputClosure
      });
      const readbackSubjectDigest = readBackCandidateNormalizationSnapshot({
        repositoryRoot: input.repositoryRoot,
        subject
      });
      return settleNormalizationObservation(
        subject,
        action,
        observation.status,
        observation.files,
        readbackSubjectDigest
      );
    }
  });
}
