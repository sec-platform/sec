import {
  rawSha256,
  sha256
} from '../../../contracts/canonical.ts';
import {
  assertSecSemanticOperationProjection,
  type SecBoundSemanticOperation,
  type SecOperationDigest
} from '../../../execution/operation/semantic.ts';
import {
  assertProcessResourceRunResult,
  assertProcessResourceSessionReceipt,
  type ProcessResourceRunResult,
  type ProcessResourceSessionReceipt
} from '../../runtime-state/physical/runtime/process-resource-session.ts';
import type { RetainedCommandBoundary } from '../../runtime-state/physical/runtime/retained-command-boundary.ts';
import {
  assertRetainedSealedPhysicalExecutionTreeGeneration,
  assertSealedPhysicalExecutionTreeRetirementReceipt,
  compileSealedPhysicalExecutionTreeExactFileSetDigest,
  type RetainedSealedPhysicalExecutionTreeGeneration,
  type SealedPhysicalExecutionTreeRetirementReceipt
} from '../../runtime-state/physical/runtime/sealed-execution-tree-generation.ts';
import {
  assertCompilerDependencyReadGenerationRetirementReceipt,
  type CompilerDependencyReadGenerationRetirementReceipt
} from '../../toolchain/dependencies/runtime.ts';
import type {
  SourceProgramEntrypointAddress,
  SourceProgramOperationProducerClosure
} from '../source-program-model/contract.ts';
import {
  requireSourceProgramOperationProducerClosure
} from '../source-program-model/producer-closure.ts';
import {
  encodeRepositoryAuditWorkerCandidateStream,
  encodeRepositoryAuditWorkerRequest,
  requireRepositoryAuditWorkerCandidateStream,
  type RepositoryAuditWorkerCandidateStream,
  type RepositoryAuditWorkerRequest
} from './worker-protocol.ts';

type Digest = `sha256:${string}`;

export type RepositoryAuditLoadedImplementationObservation = Readonly<{
  kind: 'repository-audit-loaded-implementation-observation';
  entrypointAddress: SourceProgramEntrypointAddress;
  implementationDigest: Digest;
  operationIdentityDigest: SecOperationDigest;
  boundAttemptDigest: SecOperationDigest;
  observationDigest: Digest;
}>;

type ObservationRecord = Readonly<{
  operation: SecBoundSemanticOperation;
  producerClosure: SourceProgramOperationProducerClosure;
  generation: RetainedSealedPhysicalExecutionTreeGeneration;
  generationRetirement: SealedPhysicalExecutionTreeRetirementReceipt;
  dependencyRetirement: CompilerDependencyReadGenerationRetirementReceipt;
  processRunResult: ProcessResourceRunResult;
  processReceipt: ProcessResourceSessionReceipt;
  processBoundary: RetainedCommandBoundary;
  request: RepositoryAuditWorkerRequest;
  candidateStream: RepositoryAuditWorkerCandidateStream;
}>;

const issuedLoadedImplementationObservations = new WeakSet<object>();
const loadedImplementationObservationRecords = new WeakMap<object, ObservationRecord>();

function samePhysicalIdentity(
  left: CompilerDependencyReadGenerationRetirementReceipt['physicalRoot'],
  right: SealedPhysicalExecutionTreeRetirementReceipt['linkedSettlements'][number]['sourceRoot']
): boolean {
  return left.path === right.path
    && left.device === right.device
    && left.inode === right.inode
    && left.objectId === right.objectId;
}

function exactSourceFileSetDigest(
  producerClosure: SourceProgramOperationProducerClosure
): Digest {
  const files = producerClosure.implementationFiles;
  const paths = files.map(({ path }) => path);
  if (new Set(paths).size !== paths.length) {
    throw new Error('Repository Audit producer closure contains duplicate implementation paths.');
  }
  return compileSealedPhysicalExecutionTreeExactFileSetDigest(files.map(({ path, source, contentDigest }) => {
    if (rawSha256(source) !== contentDigest) {
      throw new Error(`Repository Audit producer closure source digest changed: ${path}`);
    }
    return Object.freeze({
      bytes: Buffer.from(source, 'utf8'),
      path
    });
  })) as Digest;
}

export function deriveRepositoryAuditImplementationDigest(
  producerClosure: SourceProgramOperationProducerClosure,
  generation: RetainedSealedPhysicalExecutionTreeGeneration,
  dependencyGenerationDigest: Digest
): Digest {
  requireSourceProgramOperationProducerClosure(producerClosure);
  assertRetainedSealedPhysicalExecutionTreeGeneration(generation);
  if (!/^sha256:[0-9a-f]{64}$/u.test(dependencyGenerationDigest)) {
    throw new Error('Repository Audit dependency generation digest is not canonical.');
  }
  const exactFileSetDigest = exactSourceFileSetDigest(producerClosure);
  if (generation.identity.exactFileSetDigest !== exactFileSetDigest) {
    throw new Error('Repository Audit sealed generation differs from the compiler-issued source closure.');
  }
  return sha256(Object.freeze({
    producerClosureDigest: producerClosure.closureDigest,
    entrypointAddress: producerClosure.entrypoint.address,
    exactFileSetDigest,
    dependencyGenerationDigest
  })) as Digest;
}

export type JoinRepositoryAuditLoadedImplementationObservationInput = Readonly<{
  operation: SecBoundSemanticOperation;
  producerClosure: SourceProgramOperationProducerClosure;
  generation: RetainedSealedPhysicalExecutionTreeGeneration;
  generationRetirement: SealedPhysicalExecutionTreeRetirementReceipt;
  dependencyGenerationDigest: Digest;
  dependencyRetirement: CompilerDependencyReadGenerationRetirementReceipt;
  processRunResult: ProcessResourceRunResult;
  processReceipt: ProcessResourceSessionReceipt;
  processBoundary: RetainedCommandBoundary;
  processArgs: readonly string[];
  processInput: Uint8Array;
  processEnvironment?: NodeJS.ProcessEnv;
  processEnvironmentMode?: 'inherit' | 'replace';
  request: RepositoryAuditWorkerRequest;
  candidateStream: RepositoryAuditWorkerCandidateStream;
}>;

export function joinRepositoryAuditLoadedImplementationObservation(
  input: JoinRepositoryAuditLoadedImplementationObservationInput
): RepositoryAuditLoadedImplementationObservation {
  assertSecSemanticOperationProjection(input.operation);
  const producerClosure = requireSourceProgramOperationProducerClosure(input.producerClosure);
  assertRetainedSealedPhysicalExecutionTreeGeneration(input.generation);
  assertSealedPhysicalExecutionTreeRetirementReceipt(
    input.generationRetirement,
    input.generation
  );
  assertCompilerDependencyReadGenerationRetirementReceipt(
    input.dependencyRetirement,
    input.dependencyGenerationDigest
  );
  const expectedRequirement = input.operation.plan.execution.requirements.find(
    ({ id }) => id === input.processReceipt.requirementId
  );
  if (expectedRequirement === undefined || !expectedRequirement.effectKinds.includes('process')) {
    throw new Error('Repository Audit process receipt does not settle its process requirement.');
  }
  assertProcessResourceSessionReceipt(input.processReceipt, {
    operationIdentityDigest: input.operation.plan.identity.identityDigest,
    boundAttemptDigest: input.operation.boundAttemptDigest,
    requirementId: expectedRequirement.id
  });
  if (input.processReceipt.processCount !== 1
      || input.processReceipt.settledProcessCount !== 1
      || input.processReceipt.successfulProcessRecordCount !== 1
      || input.processReceipt.failedProcessCount !== 0) {
    throw new Error('Repository Audit loaded implementation requires one successful settled child.');
  }
  if (input.processBoundary.workingDirectory !== input.generation.workingDirectory) {
    throw new Error('Repository Audit worker did not execute from the sealed generation.');
  }
  const expectedArgs = Object.freeze([
    '--no-env-file',
    producerClosure.entrypoint.path
  ]);
  if (input.processArgs.length !== expectedArgs.length
      || input.processArgs.some((argument, index) => argument !== expectedArgs[index])) {
    throw new Error('Repository Audit worker arguments do not select the exact compiler entrypoint.');
  }
  const requestBytes = encodeRepositoryAuditWorkerRequest(input.request);
  if (!Buffer.from(input.processInput).equals(Buffer.from(requestBytes))) {
    throw new Error('Repository Audit worker stdin differs from its exact request.');
  }
  assertProcessResourceRunResult(input.processRunResult, input.processReceipt, {
    operationIdentityDigest: input.operation.plan.identity.identityDigest,
    boundAttemptDigest: input.operation.boundAttemptDigest,
    requirementId: expectedRequirement.id,
    boundary: input.processBoundary,
    args: input.processArgs,
    input: input.processInput,
    env: input.processEnvironment,
    envMode: input.processEnvironmentMode,
    ordinal: 1
  });
  if (input.processRunResult.result.code !== 0
      || input.processRunResult.result.stderr.length !== 0) {
    throw new Error('Repository Audit loaded implementation child did not settle successfully.');
  }
  const candidateStream = requireRepositoryAuditWorkerCandidateStream(
    input.candidateStream,
    input.request
  );
  const candidateBytes = encodeRepositoryAuditWorkerCandidateStream(
    input.request,
    candidateStream.handshake,
    candidateStream.result
  );
  if (candidateStream.streamDigest !== rawSha256(input.processRunResult.result.stdout)
      || !Buffer.from(input.processRunResult.result.stdout).equals(Buffer.from(candidateBytes))) {
    throw new Error('Repository Audit parsed candidate stream differs from exact child stdout.');
  }

  const implementationDigest = deriveRepositoryAuditImplementationDigest(
    producerClosure,
    input.generation,
    input.dependencyGenerationDigest
  );
  if (input.request.operationIdentityDigest !== input.operation.plan.identity.identityDigest) {
    throw new Error('Repository Audit worker request belongs to another operation.');
  }
  if (input.request.boundAttemptDigest !== input.operation.boundAttemptDigest) {
    throw new Error('Repository Audit worker request belongs to another attempt.');
  }
  if (input.request.generationDigest !== input.generation.identity.generationDigest) {
    throw new Error('Repository Audit worker request belongs to another sealed generation.');
  }
  if (input.request.entrypointAddress !== producerClosure.entrypoint.address) {
    throw new Error('Repository Audit worker request belongs to another entrypoint.');
  }
  if (input.request.implementationDigest !== implementationDigest) {
    throw new Error('Repository Audit worker request belongs to another implementation.');
  }
  if (input.request.dependencyGenerationDigest !== input.dependencyGenerationDigest) {
    throw new Error('Repository Audit worker request belongs to another dependency generation.');
  }
  if (input.generationRetirement.linkedSettlements.length !== 1
      || !samePhysicalIdentity(
        input.dependencyRetirement.physicalRoot,
        input.generationRetirement.linkedSettlements[0]!.sourceRoot
      )) {
    throw new Error('Repository Audit sealed generation did not borrow the retired dependency generation.');
  }

  const unsigned = Object.freeze({
    kind: 'repository-audit-loaded-implementation-observation' as const,
    entrypointAddress: producerClosure.entrypoint.address,
    implementationDigest,
    operationIdentityDigest: input.operation.plan.identity.identityDigest,
    boundAttemptDigest: input.operation.boundAttemptDigest
  });
  const observation = Object.freeze({
    ...unsigned,
    observationDigest: sha256(Object.freeze({
      ...unsigned,
      producerClosureDigest: producerClosure.closureDigest,
      generationDigest: input.generation.identity.generationDigest,
      dependencyGenerationDigest: input.dependencyGenerationDigest,
      processReceiptDigest: input.processReceipt.receiptDigest,
      requestDigest: input.request.requestDigest,
      streamDigest: candidateStream.streamDigest,
      resultDigest: candidateStream.result.resultDigest
    })) as Digest
  });
  issuedLoadedImplementationObservations.add(observation);
  loadedImplementationObservationRecords.set(observation, Object.freeze({
    operation: input.operation,
    producerClosure,
    generation: input.generation,
    generationRetirement: input.generationRetirement,
    dependencyRetirement: input.dependencyRetirement,
    processRunResult: input.processRunResult,
    processReceipt: input.processReceipt,
    processBoundary: input.processBoundary,
    request: input.request,
    candidateStream
  }));
  return observation;
}

/** Persist the evidence already joined by this owner, without restoring any
 * process-local capability from the projection. Request/result payloads are
 * referenced by their exact protocol digests; the transition carrier retains
 * their canonical audit input/result once rather than duplicating base64. */
export function projectRepositoryAuditLoadedImplementationEvidence(
  observation: RepositoryAuditLoadedImplementationObservation
) {
  const record = loadedImplementationObservationRecords.get(observation);
  if (!issuedLoadedImplementationObservations.has(observation) || record === undefined) {
    throw new Error('Loaded implementation history requires an actual joined producer observation');
  }
  const { payloadBase64: _requestPayload, ...request } = record.request;
  const { payloadBase64: _resultPayload, ...result } = record.candidateStream.result;
  const identity = record.generationRetirement.generationIdentity;
  const generationIdentity = Object.freeze({
    borrowedGenerationDigest: identity.borrowedGenerationDigest,
    exactFileSetDigest: identity.exactFileSetDigest,
    generationDigest: identity.generationDigest,
    materializationOperationDigest: identity.materializationOperationDigest,
    protectedSubjectRootsDigest: identity.protectedSubjectRootsDigest,
    sealedRoot: identity.sealedRoot,
    treeDigest: identity.treeDigest,
    workingDirectoryGenerationDigest: identity.workingDirectoryGenerationDigest
  });
  const sourceIdentity = ({ path, contentDigest }: SourceProgramOperationProducerClosure['descriptor']) =>
    Object.freeze({ path, contentDigest });
  const canonical = Object.freeze({
    schema: 'repository-audit-loaded-implementation-history-v1' as const,
    authority: 'historical-evidence-only' as const,
    observation,
    operation: record.operation,
    producerClosure: Object.freeze({
      authority: record.producerClosure.authority,
      operation: record.producerClosure.operation,
      moduleId: record.producerClosure.moduleId,
      descriptor: sourceIdentity(record.producerClosure.descriptor),
      entrypoint: Object.freeze({ ...sourceIdentity(record.producerClosure.entrypoint), address: record.producerClosure.entrypoint.address }),
      implementationFiles: Object.freeze(record.producerClosure.implementationFiles.map(sourceIdentity)),
      closureDigest: record.producerClosure.closureDigest
    }),
    generationRetirement: Object.freeze({
      generationIdentity,
      linkedSettlements: record.generationRetirement.linkedSettlements,
      protectedRootSettlements: record.generationRetirement.protectedRootSettlements,
      treeAuthority: record.generationRetirement.treeAuthority,
      tree: record.generationRetirement.tree
    }),
    dependencyRetirement: record.dependencyRetirement,
    resources: record.processReceipt,
    process: Object.freeze({ ordinal: record.processRunResult.ordinal, code: record.processRunResult.result.code,
      stdoutBytes: record.processRunResult.result.stdout.byteLength,
      stdoutDigest: rawSha256(record.processRunResult.result.stdout),
      stderrBytes: Buffer.byteLength(record.processRunResult.result.stderr, 'utf8'),
      stderrDigest: rawSha256(record.processRunResult.result.stderr) }),
    request,
    handshake: record.candidateStream.handshake,
    result,
    streamDigest: record.candidateStream.streamDigest
  });
  return Object.freeze({ ...canonical, evidenceDigest: sha256(canonical) as Digest });
}

export type RepositoryAuditLoadedImplementationEvidence = ReturnType<
  typeof projectRepositoryAuditLoadedImplementationEvidence
>;
