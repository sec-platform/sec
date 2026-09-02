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
  acquireExactGitTreeWorkspaceSourceSnapshot,
  acquireStagedIndexWorkspaceSourceSnapshot,
  readBackStagedIndexWorkspaceSourceSnapshot,
  type PhysicalWorkspaceSourceSnapshot
} from '../../brownfield/source-program-model/workspace-source-snapshot.ts';
import { CodexDevelopmentListExactGitTreeEntries } from '../../external-capabilities/git-read/exact-blob.ts';
import type { GitReadSession } from '../../external-capabilities/git-read/runtime/session.ts';
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
const issuedCandidateNormalizationAdmissionReceipts = new WeakSet<object>();

export type CandidateNormalizationAdmissionReceipt = Readonly<{
  schema: 'sec-candidate-normalization-admission';
  status: 'admitted';
  subjectDigest: CandidateNormalizationDigest;
  actionKey: CandidateNormalizationDigest;
  terminalResultDigest: CandidateNormalizationDigest;
}>;

export function requireCandidateNormalizationAdmissionReceipt(
  value: unknown
): CandidateNormalizationAdmissionReceipt {
  if (value === null || typeof value !== 'object'
      || !issuedCandidateNormalizationAdmissionReceipts.has(value)) {
    throw new Error('Candidate normalization admission is not owner-issued');
  }
  return value as CandidateNormalizationAdmissionReceipt;
}

function issueCandidateNormalizationAdmissionReceipt(input: Readonly<{
  subject: CandidateNormalizationSubject;
  action: ReturnType<typeof compileCandidateNormalizationActionKey>;
  outcome: VerificationActionRunOutcome;
}>): CandidateNormalizationAdmissionReceipt {
  const terminal = input.outcome.terminal;
  if (input.outcome.actionKey !== input.action.actionKey
      || terminal === null
      || terminal.actionKey !== input.action.actionKey
      || terminal.status !== 'passed') {
    throw new Error('Candidate normalization terminal does not admit the exact subject and action');
  }
  const receipt = Object.freeze({
    schema: 'sec-candidate-normalization-admission' as const,
    status: 'admitted' as const,
    subjectDigest: input.subject.subjectDigest,
    actionKey: input.action.actionKey,
    terminalResultDigest: terminal.resultDigest
  });
  issuedCandidateNormalizationAdmissionReceipts.add(receipt);
  return receipt;
}

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

async function readBackNormalizationSubject(input: Readonly<{
  repositoryRoot: string;
  subject: CandidateNormalizationSubject;
  stagedSession?: GitReadSession;
}>): Promise<CandidateNormalizationDigest> {
  const { snapshot } = requireCandidateNormalizationSnapshot(input.subject);
  if (snapshot.subject.provenance.kind === 'staged-index-observation') {
    if (input.stagedSession === undefined) {
      throw new Error('Staged candidate normalization readback requires its original Git session');
    }
    await readBackStagedIndexWorkspaceSourceSnapshot(snapshot, input.stagedSession);
    return input.subject.subjectDigest;
  }
  return readBackCandidateNormalizationSnapshot(input);
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
  return executeCandidateNormalization({
    repositoryRoot: input.repositoryRoot,
    snapshot,
    subject,
    action
  });
}

async function executeCandidateNormalization(input: Readonly<{
  repositoryRoot: string;
  snapshot: PhysicalWorkspaceSourceSnapshot;
  subject: CandidateNormalizationSubject;
  action: ReturnType<typeof compileCandidateNormalizationActionKey>;
  stagedSession?: GitReadSession;
}>): Promise<VerificationActionRunOutcome> {
  const { subject, action } = input;
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
      const readbackSubjectDigest = await readBackNormalizationSubject({
        repositoryRoot: input.repositoryRoot,
        subject,
        stagedSession: input.stagedSession
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

/**
 * Verifies the exact staged index through the caller's one production
 * GitReadSession. The returned admission is a process-local normalization
 * capability only; it deliberately carries no commit Effect authority.
 */
export async function verifyStagedCandidateImportNormalization(input: Readonly<{
  session: GitReadSession;
}>): Promise<Readonly<{
  outcome: VerificationActionRunOutcome;
  admission: CandidateNormalizationAdmissionReceipt | null;
}>> {
  const snapshot = await acquireStagedIndexWorkspaceSourceSnapshot({ session: input.session });
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
    producerClosure,
    compilerIdentity
  });
  const action = compileCandidateNormalizationActionKey(subject);
  const outcome = await executeCandidateNormalization({
    repositoryRoot: input.session.cwd,
    snapshot,
    subject,
    action,
    stagedSession: input.session
  });
  await readBackStagedIndexWorkspaceSourceSnapshot(snapshot, input.session);
  return Object.freeze({
    outcome,
    admission: outcome.terminal?.status === 'passed'
      ? issueCandidateNormalizationAdmissionReceipt({ subject, action, outcome })
      : null
  });
}
