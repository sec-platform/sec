import { deepFreeze, sha256 } from '../../../../contracts/canonical.ts';
import {
  isSourceProgramInputPath,
  type OperationProducerClosure
} from '../../../repository/source-program-model/contract.ts';
import {
  assertPhysicalWorkspaceSourceSnapshot,
  requireStagedSourceSelection,
  type PhysicalWorkspaceSourceSnapshot,
  type StagedSourceSelection
} from '../../../repository/source-program-model/workspace-source-snapshot.ts';
import {
  createVerificationActionKey,
  type VerificationActionKey,
  type VerificationActionKeyDigest
} from '../../../verification/platform/action/contract/action.ts';

const CANDIDATE_NORMALIZATION_SUBJECT_SCHEMA =
  'sec-candidate-normalization-snapshot-subject' as const;
export const CANDIDATE_NORMALIZATION_DURATION_MS = 300_000;

export const IMPORT_NORMALIZATION_OPERATION = Object.freeze({
  capability: 'development.import-normalization',
  operation: 'verifyCandidateImportNormalization'
});

const ACTION_KIND = 'development.import-normalization';
const PRODUCER_IDENTITY = 'development.import-normalization';
const OPERATION_IDENTITY = 'development.import-normalization.verify';

export type CandidateNormalizationDigest = VerificationActionKeyDigest;
type CandidateNormalizationBlob = Readonly<{
  path: string;
  digest: CandidateNormalizationDigest;
}>;

export type CandidateNormalizationSubject = Readonly<{
  schema: typeof CANDIDATE_NORMALIZATION_SUBJECT_SCHEMA;
  candidateIdentity:
    | Readonly<{
        kind: 'git-tree';
        commitSha: string;
        snapshotIdentityDigest: CandidateNormalizationDigest;
      }>
    | Readonly<{
        kind: 'staged-index';
        candidateBase: string;
        indexDigest: CandidateNormalizationDigest;
        indexTreeDigest: CandidateNormalizationDigest;
        selectionDigest: CandidateNormalizationDigest;
        snapshotIdentityDigest: CandidateNormalizationDigest;
      }>;
  selectedBlobs: readonly CandidateNormalizationBlob[];
  observationBlobs: readonly CandidateNormalizationBlob[];
  producerClosureDigest: CandidateNormalizationDigest;
  normalizationContractDigest: CandidateNormalizationDigest;
  configurationDigest: CandidateNormalizationDigest;
  toolchainDigest: CandidateNormalizationDigest;
  providerContractDigest: CandidateNormalizationDigest;
  resultContractDigest: CandidateNormalizationDigest;
  subjectDigest: CandidateNormalizationDigest;
}>;

const issuedCandidateNormalizationSubjects = new WeakSet<object>();
const candidateNormalizationSnapshots = new WeakMap<object, Readonly<{
  snapshot: PhysicalWorkspaceSourceSnapshot;
  targetPaths: readonly string[];
  stagedSelectionDigest: CandidateNormalizationDigest | null;
}>>();

const NORMALIZATION_CONTRACT_DIGEST = sha256({
  actionKind: ACTION_KIND,
  operationIdentity: OPERATION_IDENTITY,
  subjectSchema: CANDIDATE_NORMALIZATION_SUBJECT_SCHEMA,
  transform: 'typescript-organize-imports-sort-and-combine',
  subjectSelection: 'exact-base-diff-or-staged-index-typescript-census',
  executionInput: 'owner-issued-immutable-workspace-snapshot',
  readback: 'exact-snapshot-subject-digest'
}) as CandidateNormalizationDigest;
const NORMALIZATION_RESULT_CONTRACT_DIGEST = sha256({
  authority: 'verification-action-owner-terminal',
  statuses: ['canonical', 'needs-import-transform'],
  passedRequires: ['exact-snapshot-execution', 'exact-snapshot-readback']
}) as CandidateNormalizationDigest;

export function isCandidateNormalizationPath(value: string): boolean {
  return isSourceProgramInputPath(value) && /\.[cm]?tsx?$/iu.test(value);
}

/**
 * Compile every semantic identity dimension from owner-issued projections.
 * Callers cannot submit paths, producer/config digests, or toolchain revisions.
 */
export function compileCandidateNormalizationSubject(input: Readonly<{
  snapshot: PhysicalWorkspaceSourceSnapshot;
  baseSnapshot?: PhysicalWorkspaceSourceSnapshot;
  stagedSelection?: StagedSourceSelection;
  producerClosure: OperationProducerClosure;
  compilerIdentity: Readonly<{
    compilerRevision: CandidateNormalizationDigest;
    providerRevision: CandidateNormalizationDigest;
  }>;
}>): CandidateNormalizationSubject {
  assertPhysicalWorkspaceSourceSnapshot(input.snapshot);
  if (input.baseSnapshot !== undefined) {
    assertPhysicalWorkspaceSourceSnapshot(input.baseSnapshot);
  }
  const producerClosure = input.producerClosure;
  if (producerClosure.operation.capability !== IMPORT_NORMALIZATION_OPERATION.capability
      || producerClosure.operation.operation !== IMPORT_NORMALIZATION_OPERATION.operation) {
    throw new Error('Candidate normalization producer closure does not bind the exact snapshot operation');
  }
  const provenance = input.snapshot.subject.provenance;
  if (provenance.kind !== 'git-tree' && provenance.kind !== 'staged-index-observation') {
    throw new Error('Candidate normalization requires one exact Git tree or staged-index snapshot');
  }
  if (provenance.kind === 'git-tree' && (input.baseSnapshot === undefined
      || input.stagedSelection !== undefined)) {
    throw new Error('Exact Git tree normalization requires one owner-issued base snapshot');
  }
  if (provenance.kind === 'staged-index-observation'
      && (input.baseSnapshot !== undefined || input.stagedSelection === undefined)) {
    throw new Error('Staged-index normalization requires one owner-issued staged selection');
  }
  const stagedSelection = input.stagedSelection === undefined
    ? undefined
    : requireStagedSourceSelection(input.stagedSelection, input.snapshot);
  const projectConfig = input.snapshot.file('tsconfig.json');
  if (projectConfig === null) {
    throw new Error('Candidate normalization exact snapshot has no tsconfig.json');
  }
  const configurationFiles = Object.freeze(input.snapshot.files
    .filter(({ path }) => path === 'bun.lock'
      || path.endsWith('.json') || path.endsWith('.jsonc'))
    .map(({ path, contentDigest }) => Object.freeze({ path, contentDigest }))
    .sort((left, right) => left.path.localeCompare(right.path)));
  const baseFiles = new Map(input.baseSnapshot?.files.map((file) => [file.path, file.contentDigest]) ?? []);
  const stagedPaths = new Set(stagedSelection?.selectedPaths ?? []);
  const selectedBlobs = Object.freeze(input.snapshot.files
    .filter(({ path, contentDigest }) => isCandidateNormalizationPath(path)
      && (provenance.kind === 'staged-index-observation'
        ? stagedPaths.has(path)
        : baseFiles.get(path) !== contentDigest))
    .map(({ path, contentDigest }) => Object.freeze({
      path,
      digest: contentDigest as CandidateNormalizationDigest
    }))
    .sort((left, right) => left.path.localeCompare(right.path)));
  const observationBlobs = Object.freeze(input.snapshot.files
    .map(({ path, contentDigest }) => Object.freeze({
      path,
      digest: contentDigest as CandidateNormalizationDigest
    }))
    .sort((left, right) => left.path.localeCompare(right.path)));
  const unsigned = deepFreeze({
    schema: CANDIDATE_NORMALIZATION_SUBJECT_SCHEMA,
    candidateIdentity: provenance.kind === 'git-tree'
      ? Object.freeze({
          kind: 'git-tree' as const,
          commitSha: provenance.commitSha,
          snapshotIdentityDigest: input.snapshot.identityDigest as CandidateNormalizationDigest
        })
      : Object.freeze({
          kind: 'staged-index' as const,
          candidateBase: stagedSelection!.candidateBase,
          indexDigest: provenance.indexDigest,
          indexTreeDigest: provenance.indexTreeDigest,
          selectionDigest: stagedSelection!.selectionDigest,
          snapshotIdentityDigest: input.snapshot.identityDigest as CandidateNormalizationDigest
        }),
    selectedBlobs,
    observationBlobs,
    producerClosureDigest: producerClosure.closureDigest as CandidateNormalizationDigest,
    normalizationContractDigest: NORMALIZATION_CONTRACT_DIGEST,
    configurationDigest: sha256({
      projectConfigPath: projectConfig.path,
      configurationFiles
    }) as CandidateNormalizationDigest,
    toolchainDigest: input.compilerIdentity.compilerRevision,
    providerContractDigest: input.compilerIdentity.providerRevision,
    resultContractDigest: NORMALIZATION_RESULT_CONTRACT_DIGEST
  });
  const subject = deepFreeze({
    ...unsigned,
    subjectDigest: sha256(unsigned) as CandidateNormalizationDigest
  }) as CandidateNormalizationSubject;
  issuedCandidateNormalizationSubjects.add(subject);
  candidateNormalizationSnapshots.set(subject, Object.freeze({
    snapshot: input.snapshot,
    targetPaths: Object.freeze(selectedBlobs.map(({ path }) => path)),
    stagedSelectionDigest: stagedSelection?.selectionDigest ?? null
  }));
  return subject;
}

export function requireCandidateNormalizationSubject(value: unknown): CandidateNormalizationSubject {
  if (value === null || typeof value !== 'object'
      || !issuedCandidateNormalizationSubjects.has(value)) {
    throw new Error('Candidate normalization subject is not owner-issued');
  }
  return value as CandidateNormalizationSubject;
}

export function requireCandidateNormalizationSnapshot(
  subjectInput: CandidateNormalizationSubject
): Readonly<{
  snapshot: PhysicalWorkspaceSourceSnapshot;
  targetPaths: readonly string[];
}> {
  const subject = requireCandidateNormalizationSubject(subjectInput);
  const execution = candidateNormalizationSnapshots.get(subject);
  if (execution === undefined) {
    throw new Error('Candidate normalization subject has no owner-issued immutable snapshot');
  }
  const { snapshot } = execution;
  assertPhysicalWorkspaceSourceSnapshot(snapshot);
  const provenance = snapshot.subject.provenance;
  const identityMatches = subject.candidateIdentity.kind === 'git-tree'
    ? provenance.kind === 'git-tree'
      && provenance.commitSha === subject.candidateIdentity.commitSha
    : provenance.kind === 'staged-index-observation'
      && provenance.indexDigest === subject.candidateIdentity.indexDigest
      && provenance.indexTreeDigest === subject.candidateIdentity.indexTreeDigest
      && execution.stagedSelectionDigest === subject.candidateIdentity.selectionDigest;
  if (!identityMatches || snapshot.identityDigest !== subject.candidateIdentity.snapshotIdentityDigest) {
    throw new Error('Candidate normalization immutable snapshot provenance is invalid');
  }
  const targetPaths = new Set(execution.targetPaths);
  const selectedBlobs = snapshot.files
    .filter(({ path }) => targetPaths.has(path))
    .map(({ path, contentDigest }) => ({ path, digest: contentDigest }))
    .sort((left, right) => left.path.localeCompare(right.path));
  if (JSON.stringify(selectedBlobs) !== JSON.stringify(subject.selectedBlobs)) {
    throw new Error('Candidate normalization immutable snapshot differs from its subject');
  }
  const observationBlobs = snapshot.files
    .map(({ path, contentDigest }) => ({ path, digest: contentDigest }))
    .sort((left, right) => left.path.localeCompare(right.path));
  if (JSON.stringify(observationBlobs) !== JSON.stringify(subject.observationBlobs)) {
    throw new Error('Candidate normalization observation closure differs from its subject');
  }
  return execution;
}

export function compileCandidateNormalizationActionKey(
  subjectInput: CandidateNormalizationSubject
): VerificationActionKey {
  const subject = requireCandidateNormalizationSubject(subjectInput);
  return createVerificationActionKey({
    actionKind: ACTION_KIND,
    producer: { identity: PRODUCER_IDENTITY, revision: subject.producerClosureDigest },
    operation: {
      identity: OPERATION_IDENTITY,
      revision: subject.normalizationContractDigest,
      semanticDigest: sha256({
        configurationDigest: subject.configurationDigest,
        normalizationContractDigest: subject.normalizationContractDigest,
        selectedBlobs: subject.selectedBlobs
      }),
      workingDirectory: '.',
      declaredEnvironment: [{
        name: 'normalization.configuration',
        digest: subject.configurationDigest
      }]
    },
    inputClosure: subject.observationBlobs,
    environment: {
      toolchainRevision: subject.toolchainDigest,
      providerRevision: subject.providerContractDigest,
      contractRevision: subject.normalizationContractDigest
    },
    requiredCheapPreflightActionKeys: [],
    upstreamActionKeys: [],
    resultSchemaRevision: subject.resultContractDigest
  });
}
