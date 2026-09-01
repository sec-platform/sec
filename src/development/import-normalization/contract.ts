import type { SourceProgramOperationProducerClosure } from '../../brownfield/source-program-model/contract.ts';
import {
  assertPhysicalWorkspaceSourceSnapshot,
  type PhysicalWorkspaceSourceSnapshot
} from '../../brownfield/source-program-model/workspace-source-snapshot.ts';
import { deepFreeze, sha256 } from '../../system-architecture/foundation/runtime/canonical.ts';
import {
  createVerificationActionKey,
  type VerificationActionKey,
  type VerificationActionKeyDigest
} from '../../verification/action/contract/action.ts';

export const CANDIDATE_NORMALIZATION_SUBJECT_SCHEMA =
  'sec-candidate-normalization-subject' as const;

export const IMPORT_NORMALIZATION_OPERATION = Object.freeze({
  capability: 'development.import-normalization',
  operation: 'verifyCandidateImportNormalization'
});

const ACTION_KIND = 'development.import-normalization';
const PRODUCER_IDENTITY = 'development.import-normalization';
const OPERATION_IDENTITY = 'development.import-normalization.verify';

export type CandidateNormalizationDigest = VerificationActionKeyDigest;
export type CandidateNormalizationBlob = Readonly<{
  path: string;
  digest: CandidateNormalizationDigest;
}>;

export type CandidateNormalizationSubject = Readonly<{
  schema: typeof CANDIDATE_NORMALIZATION_SUBJECT_SCHEMA;
  candidateCommitSha: string;
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
}>>();

const NORMALIZATION_CONTRACT_DIGEST = sha256({
  actionKind: ACTION_KIND,
  operationIdentity: OPERATION_IDENTITY,
  subjectSchema: CANDIDATE_NORMALIZATION_SUBJECT_SCHEMA,
  transform: 'typescript-organize-imports-sort-and-combine',
  subjectSelection: 'exact-base-to-candidate-typescript-diff',
  executionInput: 'owner-issued-immutable-workspace-snapshot',
  readback: 'exact-snapshot-subject-digest'
}) as CandidateNormalizationDigest;
const NORMALIZATION_RESULT_CONTRACT_DIGEST = sha256({
  authority: 'verification-action-owner-terminal',
  statuses: ['canonical', 'needs-import-transform'],
  passedRequires: ['exact-snapshot-execution', 'exact-snapshot-readback']
}) as CandidateNormalizationDigest;

function isCandidateNormalizationPath(value: string): boolean {
  return /\.[cm]?tsx?$/iu.test(value);
}

/**
 * Compile every semantic identity dimension from owner-issued projections.
 * Callers cannot submit paths, producer/config digests, or toolchain revisions.
 */
export function compileCandidateNormalizationSubject(input: Readonly<{
  snapshot: PhysicalWorkspaceSourceSnapshot;
  baseSnapshot: PhysicalWorkspaceSourceSnapshot;
  producerClosure: SourceProgramOperationProducerClosure;
  compilerIdentity: Readonly<{
    compilerRevision: CandidateNormalizationDigest;
    providerRevision: CandidateNormalizationDigest;
  }>;
}>): CandidateNormalizationSubject {
  assertPhysicalWorkspaceSourceSnapshot(input.snapshot);
  assertPhysicalWorkspaceSourceSnapshot(input.baseSnapshot);
  const producerClosure = input.producerClosure;
  if (producerClosure.operation.capability !== IMPORT_NORMALIZATION_OPERATION.capability
      || producerClosure.operation.operation !== IMPORT_NORMALIZATION_OPERATION.operation) {
    throw new Error('Candidate normalization producer closure does not bind the exact snapshot operation');
  }
  const provenance = input.snapshot.subject.provenance;
  if (provenance.kind !== 'git-tree') {
    throw new Error('Candidate normalization requires one exact Git tree snapshot');
  }
  const projectConfig = input.snapshot.file('tsconfig.json');
  if (projectConfig === null) {
    throw new Error('Candidate normalization exact snapshot has no tsconfig.json');
  }
  const configurationFiles = Object.freeze(input.snapshot.files
    .filter(({ path }) => path === 'bun.lock'
      || path.endsWith('.json') || path.endsWith('.jsonc'))
    .map(({ path, contentDigest }) => Object.freeze({ path, contentDigest }))
    .sort((left, right) => left.path.localeCompare(right.path)));
  const baseFiles = new Map(input.baseSnapshot.files.map((file) => [file.path, file.contentDigest]));
  const selectedBlobs = Object.freeze(input.snapshot.files
    .filter(({ path, contentDigest }) => isCandidateNormalizationPath(path)
      && baseFiles.get(path) !== contentDigest)
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
    candidateCommitSha: provenance.commitSha,
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
    targetPaths: Object.freeze(selectedBlobs.map(({ path }) => path))
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
  if (snapshot.subject.provenance.kind !== 'git-tree'
      || snapshot.subject.provenance.commitSha !== subject.candidateCommitSha) {
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
        normalizationContractDigest: subject.normalizationContractDigest
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
