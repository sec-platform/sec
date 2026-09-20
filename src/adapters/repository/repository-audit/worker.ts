#!/usr/bin/env bun
import {
  compileSourceProgramAuditOperation,
  encodeSourceProgramAuditOperationResult,
  parseSourceProgramAuditOperationInput
} from './source-program-audit-operation.ts';
import {
  compileRepositoryAuditWorkerHandshakeCandidate,
  compileRepositoryAuditWorkerResultCandidate,
  encodeRepositoryAuditWorkerCandidateStream,
  parseRepositoryAuditWorkerRequestStream,
  REPOSITORY_AUDIT_WORKER_PROTOCOL_LIMITS,
  repositoryAuditWorkerRequestPayload,
  type RepositoryAuditWorkerRequest
} from './worker-protocol.ts';
import { withOwnedByteStreamReader } from '../../../execution/stream-reader.ts';

async function readBoundedStandardInput(maximumBytes: number): Promise<Uint8Array> {
  return withOwnedByteStreamReader(Bun.stdin.stream(), async (read) => {
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const next = await read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maximumBytes) {
        throw new Error('Repository Audit worker request exceeds its operation input budget');
      }
      chunks.push(next.value);
    }
    return Buffer.concat(chunks, total);
  });
}

/**
 * The descriptor-owned pure child operation. It accepts only one strict
 * parent request and returns candidate bytes; it never signs authority or
 * performs repository, cache, provider, dependency or publication Effects.
 */
export function executeRepositoryAuditSourceProgramOperation(
  request: RepositoryAuditWorkerRequest
): Uint8Array {
  const operationInputBytes = repositoryAuditWorkerRequestPayload(
    request,
    REPOSITORY_AUDIT_WORKER_PROTOCOL_LIMITS.maximumOperationInputBytes
  );
  const operationInput = parseSourceProgramAuditOperationInput(
    operationInputBytes,
    REPOSITORY_AUDIT_WORKER_PROTOCOL_LIMITS.maximumOperationInputBytes
  );
  const operationResult = compileSourceProgramAuditOperation(operationInput);
  const operationResultBytes = encodeSourceProgramAuditOperationResult(operationResult);
  if (operationResultBytes.byteLength
      > REPOSITORY_AUDIT_WORKER_PROTOCOL_LIMITS.maximumOperationResultBytes) {
    throw new Error('Repository Audit operation result exceeds its bounded protocol payload');
  }
  const handshake = compileRepositoryAuditWorkerHandshakeCandidate(request);
  const result = compileRepositoryAuditWorkerResultCandidate(
    request,
    handshake,
    operationResultBytes
  );
  return encodeRepositoryAuditWorkerCandidateStream(request, handshake, result);
}

if (import.meta.main) {
  const requestBytes = await readBoundedStandardInput(
    REPOSITORY_AUDIT_WORKER_PROTOCOL_LIMITS.maximumRequestBytes
  );
  const request = parseRepositoryAuditWorkerRequestStream({
    bytes: requestBytes,
    eofObserved: true
  }, {
    maximumRequestBytes: REPOSITORY_AUDIT_WORKER_PROTOCOL_LIMITS.maximumRequestBytes,
    maximumResultBytes: REPOSITORY_AUDIT_WORKER_PROTOCOL_LIMITS.maximumCandidateStreamBytes
  });
  const candidateBytes = executeRepositoryAuditSourceProgramOperation(request);
  if (candidateBytes.byteLength
      > REPOSITORY_AUDIT_WORKER_PROTOCOL_LIMITS.maximumCandidateStreamBytes) {
    throw new Error('Repository Audit worker candidate stream exceeds its output budget');
  }
  await Bun.write(Bun.stdout, candidateBytes);
}
