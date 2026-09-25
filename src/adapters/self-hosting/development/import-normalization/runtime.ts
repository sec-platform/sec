import { sha256 } from '../../../../contracts/canonical.ts';
import { observeExecutionProgressPhase } from '../../../../execution/execution-progress.ts';
import {
  bindSemanticOperation,
  compileCapabilityBinding,
  compileProviderSettlementSet,
  compileSemanticOperationPlan,
  issueNormalDomainReadbackReceipt,
  issueNormalOwnerTerminalJoinReceipt,
  issueProviderSettlementReceipt,
  issueSemanticOperationAttemptContext
} from '../../../../execution/operation/semantic.ts';
import {
  withAuthorityGitReadSession,
  type AuthorityGitReadOperation
} from '../../../providers/git-read/authority.ts';
import {
  ListExactGitTreeEntriesFromSession
} from '../../../providers/git-read/exact-blob.ts';
import {
  GIT_READ_EXACT_TREE_OPERATION_BUDGET,
  type GitReadSession
} from '../../../providers/git-read/runtime/session.ts';
import {
  compileProducerClosureFromSnapshot,
  requireProducerClosure
} from '../../../repository/source-program-model/producer-closure.ts';
import {
  assertTypeScriptCompilerIdentity,
  typeScriptCompilerIdentity
} from '../../../repository/source-program-model/typescript.ts';
import {
  acquireExactGitTreeSnapshot,
  acquireStagedIndexSnapshot,
  readBackStagedIndexSnapshot,
  selectStagedSnapshot,
  type PhysicalWorkspaceSourceSnapshot
} from '../../../repository/source-program-model/workspace-source-snapshot.ts';
import {
  issueNonProcessVerificationActionTerminalSettlement,
  issueVerificationActionOwnerTerminalReceipt,
  type VerificationActionKeyInput,
  type VerificationActionTerminalSettlement
} from '../../../verification/platform/action/contract/action.ts';
import {
  createVerificationActionRunner,
  type VerificationActionRunOutcome
} from '../../../verification/platform/action/runner.ts';
import {
  CANDIDATE_NORMALIZATION_DURATION_MS,
  compileCandidateNormalizationActionKey,
  compileCandidateNormalizationSubject,
  IMPORT_NORMALIZATION_OPERATION,
  isCandidateNormalizationPath,
  requireCandidateNormalizationSnapshot,
  type CandidateNormalizationDigest,
  type CandidateNormalizationSubject
} from './contract.ts';
import type { ImportCheckOutcome } from './kernel.ts';
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

async function readBackCandidateNormalizationSnapshot(input: Readonly<{
  session: GitReadSession;
  subject: CandidateNormalizationSubject;
}>): Promise<CandidateNormalizationDigest> {
  const { snapshot } = requireCandidateNormalizationSnapshot(input.subject);
  const provenance = snapshot.subject.provenance;
  if (provenance.kind !== 'git-tree') {
    throw new Error('Candidate normalization readback requires exact Git provenance');
  }
  const entries = await ListExactGitTreeEntriesFromSession(
    input.session,
    provenance.commitSha
  );
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
  subject: CandidateNormalizationSubject;
  stagedOperation?: AuthorityGitReadOperation;
  gitSession?: GitReadSession;
}>): Promise<CandidateNormalizationDigest> {
  const { snapshot } = requireCandidateNormalizationSnapshot(input.subject);
  if (snapshot.subject.provenance.kind === 'staged-index-observation') {
    if (input.stagedOperation === undefined) {
      throw new Error('Staged candidate normalization readback requires its Git operation');
    }
    await input.stagedOperation.runPhase('normalization-readback', (session) => (
      readBackStagedIndexSnapshot(snapshot, session)
    ));
    return input.subject.subjectDigest;
  }
  if (input.gitSession === undefined) {
    throw new Error('Exact-tree candidate normalization readback requires its Git session');
  }
  return readBackCandidateNormalizationSnapshot({
    session: input.gitSession,
    subject: input.subject
  });
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
  const plan = compileSemanticOperationPlan({
    operation: 'development.import-normalization',
    intentDigest: action.actionKey,
    decisionDigest: subject.subjectDigest,
    deadlineAtUnixMs: Date.now() + CANDIDATE_NORMALIZATION_DURATION_MS,
    aggregateBudgets: [
      { resource: 'duration-ms', maximum: CANDIDATE_NORMALIZATION_DURATION_MS },
      { resource: 'processes', maximum: 64 },
      { resource: 'records', maximum: Math.max(1, files.length) }
    ],
    requirements: [{
      id: 'candidate-normalization-observation',
      contractDigest: subject.normalizationContractDigest,
      effectKinds: ['filesystem', 'process'],
      failureKinds: ['candidate-normalization-noncanonical']
    }],
    attempt: issueSemanticOperationAttemptContext({
      authorityGrantDigest: subject.subjectDigest
    })
  });
  const bound = bindSemanticOperation(plan, [compileCapabilityBinding({
    requirementId: 'candidate-normalization-observation',
    contractDigest: subject.normalizationContractDigest,
    providerIdentityDigest: subject.producerClosureDigest
  })]);
  const provider = issueProviderSettlementReceipt(bound, {
    requirementId: 'candidate-normalization-observation',
    physicalDisposition: 'settled',
    providerSettlementReferenceDigest: observationDigest
  });
  const providerSet = compileProviderSettlementSet(bound, [provider]);
  const passed = status === 'canonical';
  const readback = issueNormalDomainReadbackReceipt(bound, providerSet, {
    readbackContractDigest: subject.resultContractDigest,
    readbackReferenceDigest: observationDigest,
    currentPhysicalEpochDigest: readbackSubjectDigest,
    disposition: passed ? 'applied' : 'not-applied'
  });
  const join = issueNormalOwnerTerminalJoinReceipt(bound, providerSet, readback, {
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
  return withAuthorityGitReadSession({
    cwd: input.repositoryRoot,
    budget: GIT_READ_EXACT_TREE_OPERATION_BUDGET
  }, async (session) => {
    const snapshot = await acquireExactGitTreeSnapshot({
      session,
      commitSha: input.candidateCommit
    });
    const baseSnapshot = await acquireExactGitTreeSnapshot({
      session,
      commitSha: input.candidateBase
    });
    const producerClosure = compileProducerClosureFromSnapshot(
      snapshot,
      IMPORT_NORMALIZATION_OPERATION
    );
    requireProducerClosure(producerClosure);
    const compilerIdentity = typeScriptCompilerIdentity();
    assertTypeScriptCompilerIdentity(compilerIdentity);
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
      action,
      gitSession: session
    });
  });
}

async function executeCandidateNormalization(input: Readonly<{
  repositoryRoot: string;
  snapshot: PhysicalWorkspaceSourceSnapshot;
  subject: CandidateNormalizationSubject;
  action: ReturnType<typeof compileCandidateNormalizationActionKey>;
  stagedOperation?: AuthorityGitReadOperation;
  gitSession?: GitReadSession;
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
        subject,
        stagedOperation: input.stagedOperation,
        gitSession: input.gitSession
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
 * Verifies the exact staged index through phases of the caller's Git operation.
 * Semantic computation does not retain a short-lived read session. The admission is a process-local normalization
 * capability only; it deliberately carries no commit Effect authority.
 */
export async function verifyStagedCandidateImportNormalization(input: Readonly<{
  gitOperation: AuthorityGitReadOperation;
  candidateBase?: string;
}>): Promise<Readonly<{
  outcome: VerificationActionRunOutcome;
  admission: CandidateNormalizationAdmissionReceipt | null;
}>> {
  const gitOperation = input.gitOperation;
  const candidateBase = input.candidateBase;
  const { snapshot, stagedSelection, repositoryRoot } = await gitOperation.runPhase(
    'normalization-source',
    async (session) => {
      const snapshot = await acquireStagedIndexSnapshot({ session });
      const stagedSelection = await selectStagedSnapshot({
        snapshot, session,
        ...(candidateBase === undefined ? {} : { candidateBase })
      });
      return { snapshot, stagedSelection, repositoryRoot: session.cwd };
    }
  );
  const producerClosure = compileProducerClosureFromSnapshot(
    snapshot,
    IMPORT_NORMALIZATION_OPERATION
  );
  requireProducerClosure(producerClosure);
  const compilerIdentity = typeScriptCompilerIdentity();
  assertTypeScriptCompilerIdentity(compilerIdentity);
  const subject = compileCandidateNormalizationSubject({
    snapshot,
    stagedSelection,
    producerClosure,
    compilerIdentity
  });
  const action = compileCandidateNormalizationActionKey(subject);
  const outcome = await executeCandidateNormalization({
    repositoryRoot,
    snapshot,
    subject,
    action,
    stagedOperation: gitOperation
  });
  await gitOperation.runPhase('normalization-final-readback', (session) => (
    readBackStagedIndexSnapshot(snapshot, session)
  ));
  return Object.freeze({
    outcome,
    admission: outcome.terminal?.status === 'passed'
      ? issueCandidateNormalizationAdmissionReceipt({ subject, action, outcome })
      : null
  });
}

/**
 * Pure staged-index authoring check. It consumes the same Source Program
 * snapshot and Git-owned selection as commit admission, but intentionally
 * issues no Verification Action or commit authority. This keeps hooks cheap
 * without creating a second source reader or normalization implementation.
 */
export async function checkStagedCandidateImportNormalization(input: Readonly<{
  session: GitReadSession;
  candidateBase?: string;
  progressCommand?: 'imports:check' | 'imports:freeze';
}>): Promise<ImportCheckOutcome> {
  const progressCommand = input.progressCommand ?? 'imports:check';
  const snapshot = await observeExecutionProgressPhase(progressCommand, 'staged-source-snapshot',
    () => acquireStagedIndexSnapshot({ session: input.session }));
  const selection = await observeExecutionProgressPhase(progressCommand, 'staged-source-selection',
    () => selectStagedSnapshot({
      snapshot,
      session: input.session,
      ...(input.candidateBase === undefined ? {} : { candidateBase: input.candidateBase })
    }));
  const files = snapshot.files.map(({ path, source, contentDigest }) => Object.freeze({
    relativePath: path,
    source,
    contentDigest: contentDigest as CandidateNormalizationDigest
  }));
  const outcome = await observeExecutionProgressPhase(progressCommand, 'normalize-selected-imports',
    () => checkImmutableImportSnapshot({
      projectRoot: input.session.cwd,
      files,
      targetPaths: selection.selectedPaths.filter(isCandidateNormalizationPath),
      expectedInputClosure: files.map(({ relativePath, contentDigest }) => Object.freeze({
        path: relativePath,
        digest: contentDigest
      }))
    }));
  await observeExecutionProgressPhase(progressCommand, 'staged-source-readback',
    () => readBackStagedIndexSnapshot(snapshot, input.session));
  return outcome;
}
