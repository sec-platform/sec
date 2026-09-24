import path from 'node:path';

import { sha256 } from '../../../../contracts/canonical.ts';
import {
  createOperationEffectGrantAuthority,
  type ConsumedOperationEffectGrantBinding,
  type OperationEffectGrant
} from '../../../../execution/operation/effect-grant.ts';
import {
  compileSemanticOperationIntent,
  issueSemanticOperationAttemptContext,
  type BoundSemanticOperation,
  type OperationDigest,
  type SemanticOperationIntent
} from '../../../../execution/operation/semantic.ts';
import { withAuthorityGitReadOperation, type AuthorityGitReadOperation } from '../../../providers/git-read/authority.ts';
import {
  bindGitDevelopmentCommitOperation,
  compileGitDevelopmentCommitContractDigest,
  type GitCommitIdentity,
  type GitDevelopmentCommitContract,
  type GitReadSession
} from '../../../providers/git-read/runtime/session.ts';
import {
  CANDIDATE_NORMALIZATION_DURATION_MS,
  IMPORT_NORMALIZATION_OPERATION
} from '../import-normalization/contract.ts';
import {
  requireCandidateNormalizationAdmissionReceipt,
  verifyStagedCandidateImportNormalization,
  type CandidateNormalizationAdmissionReceipt
} from '../import-normalization/runtime.ts';
import { GIT_READ_OPERATION_BUDGET } from '../tooling/git/git-read.ts';
import {
  assertDevelopmentCommitCandidateCurrent,
  freezeDevelopmentCommitCandidate,
  requireDevelopmentCommitCandidate,
  type DevelopmentCommitCandidate,
  type DevelopmentCommitCandidateDetails,
  type DevelopmentCommitRequest
} from './candidate.ts';

const OPERATION = 'development.commit';
const REQUIREMENT = 'repository.commit';
// Provider admission, exact-candidate reads, common-directory read, object/CAS,
// five readback commands, and the Windows commit-tree stdin worker.
export const DEVELOPMENT_COMMIT_EXECUTION_PROCESS_COUNT = 13;
const ADMISSION_DEADLINE_MS = 30_000;

const effectGrantAuthority = createOperationEffectGrantAuthority({
  semanticOperation: OPERATION,
  issuerIdentityDigest: sha256({
    domain: 'development.commit-admission',
    candidateSchema: 'sec-development-commit-candidate',
    normalizationOperation: IMPORT_NORMALIZATION_OPERATION
  }) as OperationDigest
});

declare const DEVELOPMENT_COMMIT_ADMISSION_BRAND: unique symbol;

export type DevelopmentCommitAdmission = Readonly<{
  readonly [DEVELOPMENT_COMMIT_ADMISSION_BRAND]: true;
}>;

export type ConsumedDevelopmentCommitAdmission = Readonly<{
  readonly request: DevelopmentCommitRequest;
  readonly candidate: DevelopmentCommitCandidate;
  readonly candidateDetails: DevelopmentCommitCandidateDetails;
  readonly normalization: CandidateNormalizationAdmissionReceipt;
  readonly contract: GitDevelopmentCommitContract;
  readonly operation: BoundSemanticOperation;
  readonly effectGrantBinding: ConsumedOperationEffectGrantBinding;
}>;

export type PreparedDevelopmentCommitAdmission = Readonly<{
  readonly request: DevelopmentCommitRequest;
  readonly admission: DevelopmentCommitAdmission;
}>;

type DevelopmentCommitAdmissionRecord = Readonly<{
  readonly request: DevelopmentCommitRequest;
  readonly candidate: DevelopmentCommitCandidate;
  readonly candidateDetails: DevelopmentCommitCandidateDetails;
  readonly normalization: CandidateNormalizationAdmissionReceipt;
  readonly contract: GitDevelopmentCommitContract;
  readonly intent: SemanticOperationIntent;
  readonly operation: BoundSemanticOperation;
  readonly currentEpochDigest: OperationDigest;
  readonly grant: OperationEffectGrant;
}>;

const issuedAdmissions = new WeakMap<object, DevelopmentCommitAdmissionRecord>();

async function commandText(
  session: GitReadSession,
  args: readonly string[],
  label: string
): Promise<string> {
  const command = await session.run(args);
  if (command.kind !== 'completed' || command.result.code !== 0) {
    throw new Error(`Development commit admission could not ${label}.`);
  }
  const value = Buffer.from(command.result.stdout).toString('utf8').trim();
  if (value.length === 0 || /[\r\n\0]/u.test(value)) {
    throw new Error(`Development commit admission ${label} is not one exact line.`);
  }
  return value;
}

function parseCommitIdentity(value: string, label: string): GitCommitIdentity {
  const match = /^(.*?) <([^<>\r\n]+)> ((?:0|[1-9][0-9]*) [+-][0-9]{4})$/u.exec(value);
  if (match === null || match[1]!.length === 0) {
    throw new Error(`Development commit admission ${label} is noncanonical.`);
  }
  return Object.freeze({ name: match[1]!, email: match[2]!, date: match[3]! });
}

function compileCommitIntent(input: Readonly<{
  contract: GitDevelopmentCommitContract;
  candidate: DevelopmentCommitCandidate;
  normalization: CandidateNormalizationAdmissionReceipt;
}>): SemanticOperationIntent {
  const contractDigest = compileGitDevelopmentCommitContractDigest(input.contract);
  return compileSemanticOperationIntent({
    operation: OPERATION,
    intentDigest: sha256({
      repositoryRoot: input.contract.repositoryRoot,
      ref: input.contract.ref,
      preimage: input.contract.expectedOld,
      target: input.contract.target,
      tree: input.contract.tree,
      candidateDigest: input.candidate.candidateDigest
    }) as OperationDigest,
    decisionDigest: sha256({
      message: input.contract.message,
      author: input.contract.author,
      committer: input.contract.committer,
      signing: input.contract.signing,
      hooks: input.contract.hooks,
      normalizationSubjectDigest: input.normalization.subjectDigest,
      normalizationActionKey: input.normalization.actionKey,
      normalizationTerminalResultDigest: input.normalization.terminalResultDigest
    }) as OperationDigest,
    aggregateBudgets: [
      { resource: 'duration-ms', maximum: ADMISSION_DEADLINE_MS },
      { resource: 'input-bytes', maximum: 64 * 1024 },
      { resource: 'output-bytes', maximum: 256 * 1024 },
      { resource: 'processes', maximum: DEVELOPMENT_COMMIT_EXECUTION_PROCESS_COUNT },
      { resource: 'records', maximum: 32 }
    ],
    requirements: [{
      id: REQUIREMENT,
      contractDigest,
      effectKinds: ['filesystem', 'process'],
      failureKinds: [
        'development.commit.cas-conflict',
        'development.commit.index-drift',
        'development.commit.lost-handle',
        'development.commit.provider-failed'
      ]
    }]
  });
}

async function issueWithOperation(input: Readonly<{
  request: DevelopmentCommitRequest;
  gitOperation: AuthorityGitReadOperation;
}>): Promise<DevelopmentCommitAdmission> {
  const candidate = await input.gitOperation.runPhase('freeze-commit-candidate', (session) => (
    freezeDevelopmentCommitCandidate({ request: input.request, session })
  ));
  const normalizationResult = await verifyStagedCandidateImportNormalization({
    gitOperation: input.gitOperation,
    candidateBase: candidate.preimage
  });
  if (normalizationResult.admission === null) {
    const { outcome } = normalizationResult;
    throw new Error(
      `Candidate import normalization blocked commit: ${outcome.terminal?.status ?? outcome.state}; `
      + `action ${outcome.actionKey}; ${outcome.reason}. `
      + 'Run bun run imports:check --staged to inspect the exact staged candidate.'
    );
  }
  const normalization = requireCandidateNormalizationAdmissionReceipt(
    normalizationResult.admission
  );
  const candidateDetails = await input.gitOperation.runPhase('commit-candidate-readback', (session) => (
    assertDevelopmentCommitCandidateCurrent({ candidate, request: input.request, session })
  ));
  const contract: GitDevelopmentCommitContract = Object.freeze({
    repositoryRoot: candidate.repositoryRoot,
    worktreeRoot: candidate.repositoryRoot,
    ref: candidate.ref,
    expectedOld: candidate.preimage,
    target: candidate.target,
    tree: candidate.tree,
    parents: Object.freeze([candidate.preimage]),
    message: input.request.message,
    author: input.request.author,
    committer: input.request.committer,
    signing: 'disabled',
    hooks: 'disabled',
    preflightReceiptDigest: candidateDetails.preflightReceiptDigest
  });
  const intent = compileCommitIntent({ contract, candidate, normalization });
  const currentEpochDigest = sha256({
    candidateDigest: candidate.candidateDigest,
    providerIdentityDigest: candidateDetails.providerIdentityDigest,
    normalizationSubjectDigest: normalization.subjectDigest,
    normalizationTerminalResultDigest: normalization.terminalResultDigest
  }) as OperationDigest;
  const deadlineAtUnixMs = Date.now() + ADMISSION_DEADLINE_MS;
  const issued = effectGrantAuthority.issuer.issue({
    operation: intent,
    currentEpochDigest,
    deadlineAtUnixMs
  });
  const operation = bindGitDevelopmentCommitOperation({
    intent,
    attempt: issueSemanticOperationAttemptContext({
      authorityGrantDigest: issued.authorityGrantDigest
    }),
    providerIdentityDigest: candidateDetails.providerIdentityDigest,
    deadlineAtUnixMs
  });
  const admission = Object.freeze({}) as DevelopmentCommitAdmission;
  issuedAdmissions.set(admission, Object.freeze({
    request: input.request,
    candidate,
    candidateDetails,
    normalization,
    contract,
    intent,
    operation,
    currentEpochDigest,
    grant: issued.grant
  }));
  return admission;
}

/**
 * The independent staged-candidate owner freezes the exact index, consumes the
 * canonical normalization terminal and issues one process-local commit grant.
 */
export async function issueDevelopmentCommitAdmission(input:
  | Readonly<{ request: DevelopmentCommitRequest }>
  | Readonly<{ repositoryRoot: string; message: string }>
): Promise<PreparedDevelopmentCommitAdmission> {
  const repositoryRoot = path.resolve(
    'request' in input ? input.request.repositoryRoot : input.repositoryRoot
  );
  return withAuthorityGitReadOperation(
    {
      cwd: repositoryRoot,
      budget: GIT_READ_OPERATION_BUDGET,
      deadlineAtUnixMs: Date.now() + CANDIDATE_NORMALIZATION_DURATION_MS
    },
    async (gitOperation) => {
      const request = await gitOperation.runPhase('commit-request', async (session) => ('request' in input
        ? input.request
        : Object.freeze({
            repositoryRoot,
            message: input.message,
            author: parseCommitIdentity(
              await commandText(session, ['var', 'GIT_AUTHOR_IDENT'], 'resolve author identity'),
              'author identity'
            ),
            committer: parseCommitIdentity(
              await commandText(session, ['var', 'GIT_COMMITTER_IDENT'], 'resolve committer identity'),
              'committer identity'
            )
          })));
      const admission = await issueWithOperation({ request, gitOperation });
      return Object.freeze({ request, admission });
    }
  );
}

/** Consumed by the commit Effect owner immediately before its final physical fence. */
export function consumeDevelopmentCommitAdmission(input: Readonly<{
  admission: unknown;
  request: DevelopmentCommitRequest;
}>): ConsumedDevelopmentCommitAdmission {
  if (input.admission === null || typeof input.admission !== 'object') {
    throw new Error('Development commit requires one owner-issued staged admission.');
  }
  const record = issuedAdmissions.get(input.admission);
  if (record === undefined) {
    throw new Error('Development commit admission is foreign or structurally reproduced.');
  }
  requireDevelopmentCommitCandidate(record.candidate, input.request);
  const effectGrantBinding = effectGrantAuthority.consumer.consume({
    grant: record.grant,
    operation: record.operation.plan,
    currentEpochDigest: record.currentEpochDigest
  });
  return Object.freeze({
    request: record.request,
    candidate: record.candidate,
    candidateDetails: record.candidateDetails,
    normalization: record.normalization,
    contract: record.contract,
    operation: record.operation,
    effectGrantBinding
  });
}

export type { DevelopmentCommitRequest };
