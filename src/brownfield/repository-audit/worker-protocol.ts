import {
  canonicalJson,
  isPlainObject,
  rawSha256,
  sha256
} from '../../system-architecture/foundation/runtime/canonical.ts';
import {
  ExactJsonError,
  parseExactJsonBytes
} from '../../system-architecture/foundation/runtime/exact-json.ts';
import type { SourceProgramEntrypointAddress } from '../source-program-model/contract.ts';

type Digest = `sha256:${string}`;

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
export const REPOSITORY_AUDIT_WORKER_PROTOCOL_LIMITS = Object.freeze({
  maximumOperationInputBytes: 32 * 1024 * 1024,
  maximumRequestBytes: 48 * 1024 * 1024,
  maximumOperationResultBytes: 40 * 1024 * 1024,
  maximumCandidateStreamBytes: 60 * 1024 * 1024
});
const REQUEST_KEYS = Object.freeze([
  'boundAttemptDigest',
  'dependencyGenerationDigest',
  'entrypointAddress',
  'generationDigest',
  'implementationDigest',
  'kind',
  'operationIdentityDigest',
  'payloadBase64',
  'payloadByteLength',
  'payloadDigest',
  'requestDigest',
  'subjectDigest'
]);
const HANDSHAKE_KEYS = Object.freeze([
  'authority',
  'boundAttemptDigest',
  'dependencyGenerationDigest',
  'entrypointAddress',
  'generationDigest',
  'handshakeDigest',
  'implementationDigest',
  'kind',
  'operationIdentityDigest',
  'requestDigest',
  'subjectDigest'
]);
const RESULT_KEYS = Object.freeze([
  'authority',
  'boundAttemptDigest',
  'dependencyGenerationDigest',
  'entrypointAddress',
  'generationDigest',
  'handshakeDigest',
  'implementationDigest',
  'kind',
  'operationIdentityDigest',
  'payloadBase64',
  'payloadByteLength',
  'payloadDigest',
  'requestDigest',
  'resultDigest',
  'subjectDigest'
]);

export type RepositoryAuditWorkerProtocolErrorCode =
  | 'authority-invalid'
  | 'digest-invalid'
  | 'duplicate-field'
  | 'eof-unobserved'
  | 'foreign-attempt'
  | 'foreign-dependency'
  | 'foreign-entrypoint'
  | 'foreign-generation'
  | 'foreign-implementation'
  | 'foreign-operation'
  | 'foreign-request'
  | 'foreign-subject'
  | 'frame-count-invalid'
  | 'input-too-large'
  | 'invalid-json'
  | 'invalid-utf8'
  | 'payload-invalid'
  | 'trailing-data'
  | 'unknown-field';

export class RepositoryAuditWorkerProtocolError extends Error {
  readonly code: RepositoryAuditWorkerProtocolErrorCode;

  constructor(code: RepositoryAuditWorkerProtocolErrorCode, detail: string, cause?: unknown) {
    super(
      `Repository Audit worker protocol ${code}: ${detail}`,
      cause === undefined ? undefined : { cause }
    );
    this.name = 'RepositoryAuditWorkerProtocolError';
    this.code = code;
  }
}

export type RepositoryAuditWorkerProtocolBudget = Readonly<{
  maximumRequestBytes: number;
  maximumResultBytes: number;
}>;

export type RepositoryAuditWorkerRequest = Readonly<{
  kind: 'repository-audit-worker-request';
  operationIdentityDigest: Digest;
  boundAttemptDigest: Digest;
  generationDigest: Digest;
  entrypointAddress: SourceProgramEntrypointAddress;
  implementationDigest: Digest;
  dependencyGenerationDigest: Digest;
  subjectDigest: Digest;
  payloadBase64: string;
  payloadByteLength: number;
  payloadDigest: Digest;
  requestDigest: Digest;
}>;

export type RepositoryAuditWorkerRequestInput = Readonly<
  Omit<
    RepositoryAuditWorkerRequest,
    'kind' | 'payloadBase64' | 'payloadByteLength' | 'payloadDigest' | 'requestDigest'
  > & { payload: Uint8Array }
>;

export type RepositoryAuditWorkerHandshakeCandidate = Readonly<{
  kind: 'repository-audit-worker-handshake-candidate';
  authority: 'none-candidate-only';
  operationIdentityDigest: Digest;
  boundAttemptDigest: Digest;
  generationDigest: Digest;
  entrypointAddress: SourceProgramEntrypointAddress;
  implementationDigest: Digest;
  dependencyGenerationDigest: Digest;
  subjectDigest: Digest;
  requestDigest: Digest;
  handshakeDigest: Digest;
}>;

export type RepositoryAuditWorkerResultCandidate = Readonly<{
  kind: 'repository-audit-worker-result-candidate';
  authority: 'none-candidate-only';
  operationIdentityDigest: Digest;
  boundAttemptDigest: Digest;
  generationDigest: Digest;
  entrypointAddress: SourceProgramEntrypointAddress;
  implementationDigest: Digest;
  dependencyGenerationDigest: Digest;
  subjectDigest: Digest;
  requestDigest: Digest;
  handshakeDigest: Digest;
  payloadBase64: string;
  payloadByteLength: number;
  payloadDigest: Digest;
  resultDigest: Digest;
}>;

export type RepositoryAuditWorkerCandidateStream = Readonly<{
  handshake: RepositoryAuditWorkerHandshakeCandidate;
  result: RepositoryAuditWorkerResultCandidate;
  payload: Uint8Array;
  streamDigest: Digest;
}>;

const issuedRepositoryAuditWorkerCandidateStreams = new WeakSet<object>();
const repositoryAuditWorkerCandidateStreamRecords = new WeakMap<object, Readonly<{
  requestDigest: Digest;
  payloadDigest: Digest;
  streamDigest: Digest;
}>>();

type ClosedBytes = Readonly<{ bytes: Uint8Array; eofObserved: boolean }>;

function requirePositiveSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be one positive safe integer`);
  }
  return value;
}

function requireDigest(value: unknown, label: string): Digest {
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) {
    throw new RepositoryAuditWorkerProtocolError('digest-invalid', label);
  }
  return value as Digest;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new RepositoryAuditWorkerProtocolError('invalid-json', `${label} is not one non-empty string`);
  }
  return value;
}

function requireEntrypoint(value: unknown): SourceProgramEntrypointAddress {
  const address = requireString(value, 'entrypointAddress');
  if (!address.startsWith('module-entrypoint:')) {
    throw new RepositoryAuditWorkerProtocolError('invalid-json', 'entrypointAddress is not canonical');
  }
  return address as SourceProgramEntrypointAddress;
}

function mapExactJsonError(error: unknown): never {
  if (!(error instanceof ExactJsonError)) {
    throw error;
  }
  const code: RepositoryAuditWorkerProtocolErrorCode = error.kind === 'duplicate-key'
    ? 'duplicate-field'
    : error.kind === 'input-too-large'
      ? 'input-too-large'
      : error.kind === 'invalid-utf8'
        ? 'invalid-utf8'
        : error.message.includes('trailing data')
          ? 'trailing-data'
          : error.message.includes('unsupported root key')
            ? 'unknown-field'
            : 'invalid-json';
  throw new RepositoryAuditWorkerProtocolError(code, error.message, error);
}

function parseFrame(
  bytes: Uint8Array,
  maximumInputBytes: number,
  label: string,
  keys: readonly string[]
): Record<string, unknown> {
  try {
    const parsed = parseExactJsonBytes(bytes, label, {
      maximumDepth: 2,
      maximumInputBytes
    }, { rootObjectKeys: keys });
    if (!isPlainObject(parsed)) {
      throw new RepositoryAuditWorkerProtocolError('invalid-json', `${label} is not one object`);
    }
    if (!Buffer.from(JSON.stringify(canonicalJson(parsed)), 'utf8').equals(Buffer.from(bytes))) {
      throw new RepositoryAuditWorkerProtocolError(
        'invalid-json',
        `${label} is not one canonical JSON object`
      );
    }
    return parsed;
  } catch (error) {
    return mapExactJsonError(error);
  }
}

function splitClosedFrames(
  input: ClosedBytes,
  maximumInputBytes: number,
  expectedFrames: number,
  label: string
): readonly Uint8Array[] {
  requirePositiveSafeInteger(maximumInputBytes, `${label} maximumInputBytes`);
  if (!input.eofObserved) {
    throw new RepositoryAuditWorkerProtocolError('eof-unobserved', label);
  }
  if (!(input.bytes instanceof Uint8Array)) {
    throw new TypeError(`${label} bytes must be one Uint8Array`);
  }
  if (input.bytes.byteLength > maximumInputBytes) {
    throw new RepositoryAuditWorkerProtocolError('input-too-large', label);
  }
  let source: string;
  try {
    source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(input.bytes);
  } catch (error) {
    throw new RepositoryAuditWorkerProtocolError('invalid-utf8', label, error);
  }
  if (source.includes('\r') || !source.endsWith('\n')) {
    throw new RepositoryAuditWorkerProtocolError('trailing-data', `${label} is not exact LF-delimited framing`);
  }
  const frames = source.slice(0, -1).split('\n');
  if (frames.length !== expectedFrames || frames.some((frame) => frame.length === 0)) {
    throw new RepositoryAuditWorkerProtocolError(
      'frame-count-invalid',
      `${label} expected ${expectedFrames} frame(s), received ${frames.length}`
    );
  }
  return Object.freeze(frames.map((frame) => Buffer.from(frame, 'utf8')));
}

function canonicalFrame(value: unknown): Uint8Array {
  return Buffer.from(`${JSON.stringify(canonicalJson(value))}\n`, 'utf8');
}

function requestUnsigned(input: Omit<RepositoryAuditWorkerRequest, 'requestDigest'>) {
  return Object.freeze({
    kind: 'repository-audit-worker-request' as const,
    operationIdentityDigest: input.operationIdentityDigest,
    boundAttemptDigest: input.boundAttemptDigest,
    generationDigest: input.generationDigest,
    entrypointAddress: input.entrypointAddress,
    implementationDigest: input.implementationDigest,
    dependencyGenerationDigest: input.dependencyGenerationDigest,
    subjectDigest: input.subjectDigest,
    payloadBase64: input.payloadBase64,
    payloadByteLength: input.payloadByteLength,
    payloadDigest: input.payloadDigest
  });
}

export function compileRepositoryAuditWorkerRequest(
  input: RepositoryAuditWorkerRequestInput
): RepositoryAuditWorkerRequest {
  requireDigest(input.operationIdentityDigest, 'operationIdentityDigest');
  requireDigest(input.boundAttemptDigest, 'boundAttemptDigest');
  requireDigest(input.generationDigest, 'generationDigest');
  requireEntrypoint(input.entrypointAddress);
  requireDigest(input.implementationDigest, 'implementationDigest');
  requireDigest(input.dependencyGenerationDigest, 'dependencyGenerationDigest');
  requireDigest(input.subjectDigest, 'subjectDigest');
  if (!(input.payload instanceof Uint8Array)) {
    throw new RepositoryAuditWorkerProtocolError(
      'payload-invalid',
      'request payload must be bytes'
    );
  }
  let payloadBase64: string;
  try {
    payloadBase64 = Buffer.from(input.payload).toString('base64');
  } catch (error) {
    throw new RepositoryAuditWorkerProtocolError(
      'payload-invalid',
      'request payload could not be encoded',
      error
    );
  }
  const unsigned = requestUnsigned({
    kind: 'repository-audit-worker-request',
    operationIdentityDigest: input.operationIdentityDigest,
    boundAttemptDigest: input.boundAttemptDigest,
    generationDigest: input.generationDigest,
    entrypointAddress: input.entrypointAddress,
    implementationDigest: input.implementationDigest,
    dependencyGenerationDigest: input.dependencyGenerationDigest,
    subjectDigest: input.subjectDigest,
    payloadBase64,
    payloadByteLength: input.payload.byteLength,
    payloadDigest: rawSha256(input.payload)
  });
  try {
    return Object.freeze({ ...unsigned, requestDigest: sha256(unsigned) as Digest });
  } catch (error) {
    throw new RepositoryAuditWorkerProtocolError(
      'digest-invalid',
      'request identity could not be compiled',
      error
    );
  }
}

function decodeRequest(
  record: Record<string, unknown>,
  maximumPayloadBytes = Number.MAX_SAFE_INTEGER
): RepositoryAuditWorkerRequest {
  if (record.kind !== 'repository-audit-worker-request') {
    throw new RepositoryAuditWorkerProtocolError('invalid-json', 'request kind differs');
  }
  const payload = decodePayload(record, maximumPayloadBytes);
  const request = compileRepositoryAuditWorkerRequest({
    operationIdentityDigest: requireDigest(record.operationIdentityDigest, 'operationIdentityDigest'),
    boundAttemptDigest: requireDigest(record.boundAttemptDigest, 'boundAttemptDigest'),
    generationDigest: requireDigest(record.generationDigest, 'generationDigest'),
    entrypointAddress: requireEntrypoint(record.entrypointAddress),
    implementationDigest: requireDigest(record.implementationDigest, 'implementationDigest'),
    dependencyGenerationDigest: requireDigest(record.dependencyGenerationDigest, 'dependencyGenerationDigest'),
    subjectDigest: requireDigest(record.subjectDigest, 'subjectDigest'),
    payload
  });
  if (record.requestDigest !== request.requestDigest) {
    throw new RepositoryAuditWorkerProtocolError('digest-invalid', 'requestDigest differs');
  }
  return request;
}

export function encodeRepositoryAuditWorkerRequest(
  request: RepositoryAuditWorkerRequest
): Uint8Array {
  const rebuilt = decodeRequest(request as unknown as Record<string, unknown>);
  return canonicalFrame(rebuilt);
}

/** Returns a defensive copy of the normalized plain input; it carries no authority. */
export function repositoryAuditWorkerRequestPayload(
  request: RepositoryAuditWorkerRequest,
  maximumPayloadBytes: number
): Uint8Array {
  const rebuilt = decodeRequest(
    request as unknown as Record<string, unknown>,
    requirePositiveSafeInteger(maximumPayloadBytes, 'maximumPayloadBytes')
  );
  return new Uint8Array(decodePayload(
    rebuilt as unknown as Record<string, unknown>,
    maximumPayloadBytes
  ));
}

export function parseRepositoryAuditWorkerRequestStream(
  input: ClosedBytes,
  budget: RepositoryAuditWorkerProtocolBudget,
  expected?: RepositoryAuditWorkerRequestInput
): RepositoryAuditWorkerRequest {
  const [frame] = splitClosedFrames(
    input,
    requirePositiveSafeInteger(budget.maximumRequestBytes, 'maximumRequestBytes'),
    1,
    'Repository Audit worker request stream'
  );
  const request = decodeRequest(parseFrame(
    frame!,
    budget.maximumRequestBytes,
    'Repository Audit worker request',
    REQUEST_KEYS
  ), budget.maximumRequestBytes);
  if (expected !== undefined) assertRequestBinding(request, compileRepositoryAuditWorkerRequest(expected));
  return request;
}

export function compileRepositoryAuditWorkerHandshakeCandidate(
  request: RepositoryAuditWorkerRequest
): RepositoryAuditWorkerHandshakeCandidate {
  decodeRequest(request as unknown as Record<string, unknown>);
  const unsigned = Object.freeze({
    kind: 'repository-audit-worker-handshake-candidate' as const,
    authority: 'none-candidate-only' as const,
    operationIdentityDigest: request.operationIdentityDigest,
    boundAttemptDigest: request.boundAttemptDigest,
    generationDigest: request.generationDigest,
    entrypointAddress: request.entrypointAddress,
    implementationDigest: request.implementationDigest,
    dependencyGenerationDigest: request.dependencyGenerationDigest,
    subjectDigest: request.subjectDigest,
    requestDigest: request.requestDigest
  });
  return Object.freeze({ ...unsigned, handshakeDigest: sha256(unsigned) as Digest });
}

export function compileRepositoryAuditWorkerResultCandidate(
  request: RepositoryAuditWorkerRequest,
  handshake: RepositoryAuditWorkerHandshakeCandidate,
  payload: Uint8Array
): RepositoryAuditWorkerResultCandidate {
  assertRepositoryAuditWorkerCandidateBinding(request, handshake);
  if (!(payload instanceof Uint8Array)) throw new TypeError('Repository Audit worker payload must be bytes');
  const payloadBase64 = Buffer.from(payload).toString('base64');
  const unsigned = Object.freeze({
    kind: 'repository-audit-worker-result-candidate' as const,
    authority: 'none-candidate-only' as const,
    operationIdentityDigest: request.operationIdentityDigest,
    boundAttemptDigest: request.boundAttemptDigest,
    generationDigest: request.generationDigest,
    entrypointAddress: request.entrypointAddress,
    implementationDigest: request.implementationDigest,
    dependencyGenerationDigest: request.dependencyGenerationDigest,
    subjectDigest: request.subjectDigest,
    requestDigest: request.requestDigest,
    handshakeDigest: handshake.handshakeDigest,
    payloadBase64,
    payloadByteLength: payload.byteLength,
    payloadDigest: rawSha256(payload)
  });
  return Object.freeze({ ...unsigned, resultDigest: sha256(unsigned) as Digest });
}

type RepositoryAuditWorkerBinding = Pick<
  RepositoryAuditWorkerRequest,
  | 'operationIdentityDigest'
  | 'boundAttemptDigest'
  | 'generationDigest'
  | 'entrypointAddress'
  | 'implementationDigest'
  | 'dependencyGenerationDigest'
  | 'subjectDigest'
  | 'requestDigest'
>;

function assertRequestBinding(
  actual: RepositoryAuditWorkerBinding,
  expected: RepositoryAuditWorkerBinding
): void {
  const comparisons = [
    ['foreign-operation', 'operationIdentityDigest'],
    ['foreign-attempt', 'boundAttemptDigest'],
    ['foreign-generation', 'generationDigest'],
    ['foreign-entrypoint', 'entrypointAddress'],
    ['foreign-implementation', 'implementationDigest'],
    ['foreign-dependency', 'dependencyGenerationDigest'],
    ['foreign-subject', 'subjectDigest'],
    ['foreign-request', 'requestDigest']
  ] as const;
  for (const [code, key] of comparisons) {
    if (actual[key] !== expected[key]) {
      throw new RepositoryAuditWorkerProtocolError(code, key);
    }
  }
}

function decodeHandshake(
  record: Record<string, unknown>,
  request: RepositoryAuditWorkerRequest
): RepositoryAuditWorkerHandshakeCandidate {
  if (record.kind !== 'repository-audit-worker-handshake-candidate') {
    throw new RepositoryAuditWorkerProtocolError('invalid-json', 'handshake kind differs');
  }
  if (record.authority !== 'none-candidate-only') {
    throw new RepositoryAuditWorkerProtocolError('authority-invalid', 'handshake authority differs');
  }
  const candidate = compileRepositoryAuditWorkerHandshakeCandidate(Object.freeze({
    kind: 'repository-audit-worker-request',
    operationIdentityDigest: requireDigest(record.operationIdentityDigest, 'operationIdentityDigest'),
    boundAttemptDigest: requireDigest(record.boundAttemptDigest, 'boundAttemptDigest'),
    generationDigest: requireDigest(record.generationDigest, 'generationDigest'),
    entrypointAddress: requireEntrypoint(record.entrypointAddress),
    implementationDigest: requireDigest(record.implementationDigest, 'implementationDigest'),
    dependencyGenerationDigest: requireDigest(record.dependencyGenerationDigest, 'dependencyGenerationDigest'),
    subjectDigest: requireDigest(record.subjectDigest, 'subjectDigest'),
    payloadBase64: request.payloadBase64,
    payloadByteLength: request.payloadByteLength,
    payloadDigest: request.payloadDigest,
    requestDigest: requireDigest(record.requestDigest, 'requestDigest')
  }));
  assertRequestBinding(candidate, request);
  if (record.handshakeDigest !== candidate.handshakeDigest) {
    throw new RepositoryAuditWorkerProtocolError('digest-invalid', 'handshakeDigest differs');
  }
  return candidate;
}

function decodePayload(record: Record<string, unknown>, maximumResultBytes: number): Uint8Array {
  const encoded = typeof record.payloadBase64 === 'string' ? record.payloadBase64 : null;
  if (encoded === null || !Number.isSafeInteger(record.payloadByteLength)
      || (record.payloadByteLength as number) < 0) {
    throw new RepositoryAuditWorkerProtocolError('payload-invalid', 'payload fields are invalid');
  }
  const payload = Buffer.from(encoded, 'base64');
  if (payload.toString('base64') !== encoded
      || payload.byteLength !== record.payloadByteLength
      || payload.byteLength > maximumResultBytes
      || record.payloadDigest !== rawSha256(payload)) {
    throw new RepositoryAuditWorkerProtocolError('payload-invalid', 'payload bytes differ');
  }
  return payload;
}

function decodeResult(
  record: Record<string, unknown>,
  request: RepositoryAuditWorkerRequest,
  handshake: RepositoryAuditWorkerHandshakeCandidate,
  maximumResultBytes: number
): Readonly<{ result: RepositoryAuditWorkerResultCandidate; payload: Uint8Array }> {
  if (record.kind !== 'repository-audit-worker-result-candidate') {
    throw new RepositoryAuditWorkerProtocolError('invalid-json', 'result kind differs');
  }
  if (record.authority !== 'none-candidate-only') {
    throw new RepositoryAuditWorkerProtocolError('authority-invalid', 'result authority differs');
  }
  const payload = decodePayload(record, maximumResultBytes);
  const result = compileRepositoryAuditWorkerResultCandidate(request, handshake, payload);
  const bindingCandidate = Object.freeze({
    ...request,
    requestDigest: requireDigest(record.requestDigest, 'requestDigest'),
    operationIdentityDigest: requireDigest(record.operationIdentityDigest, 'operationIdentityDigest'),
    boundAttemptDigest: requireDigest(record.boundAttemptDigest, 'boundAttemptDigest'),
    generationDigest: requireDigest(record.generationDigest, 'generationDigest'),
    entrypointAddress: requireEntrypoint(record.entrypointAddress),
    implementationDigest: requireDigest(record.implementationDigest, 'implementationDigest'),
    dependencyGenerationDigest: requireDigest(record.dependencyGenerationDigest, 'dependencyGenerationDigest'),
    subjectDigest: requireDigest(record.subjectDigest, 'subjectDigest')
  });
  assertRequestBinding(bindingCandidate, request);
  if (record.handshakeDigest !== handshake.handshakeDigest) {
    throw new RepositoryAuditWorkerProtocolError('foreign-request', 'result handshakeDigest differs');
  }
  if (record.resultDigest !== result.resultDigest) {
    throw new RepositoryAuditWorkerProtocolError('digest-invalid', 'resultDigest differs');
  }
  return Object.freeze({ result, payload });
}

export function assertRepositoryAuditWorkerCandidateBinding(
  request: RepositoryAuditWorkerRequest,
  handshake: RepositoryAuditWorkerHandshakeCandidate,
  result?: RepositoryAuditWorkerResultCandidate
): void {
  const rebuiltRequest = decodeRequest(request as unknown as Record<string, unknown>);
  const rebuiltHandshake = decodeHandshake(
    handshake as unknown as Record<string, unknown>,
    rebuiltRequest
  );
  if (result !== undefined) {
    const maximumResultBytes = Math.max(1, result.payloadByteLength);
    decodeResult(result as unknown as Record<string, unknown>, rebuiltRequest, rebuiltHandshake, maximumResultBytes);
  }
}

export function encodeRepositoryAuditWorkerCandidateStream(
  request: RepositoryAuditWorkerRequest,
  handshake: RepositoryAuditWorkerHandshakeCandidate,
  result: RepositoryAuditWorkerResultCandidate
): Uint8Array {
  const rebuiltRequest = decodeRequest(request as unknown as Record<string, unknown>);
  const rebuiltHandshake = decodeHandshake(
    handshake as unknown as Record<string, unknown>,
    rebuiltRequest
  );
  const maximumResultBytes = Math.max(1, result.payloadByteLength);
  const rebuiltResult = decodeResult(
    result as unknown as Record<string, unknown>,
    rebuiltRequest,
    rebuiltHandshake,
    maximumResultBytes
  ).result;
  return Buffer.concat([canonicalFrame(rebuiltHandshake), canonicalFrame(rebuiltResult)]);
}

export function parseRepositoryAuditWorkerCandidateStream(
  input: ClosedBytes,
  request: RepositoryAuditWorkerRequest,
  budget: RepositoryAuditWorkerProtocolBudget
): RepositoryAuditWorkerCandidateStream {
  decodeRequest(request as unknown as Record<string, unknown>);
  const maximumResultBytes = requirePositiveSafeInteger(
    budget.maximumResultBytes,
    'maximumResultBytes'
  );
  const frames = splitClosedFrames(
    input,
    maximumResultBytes,
    2,
    'Repository Audit worker candidate stream'
  );
  const handshake = decodeHandshake(parseFrame(
    frames[0]!,
    maximumResultBytes,
    'Repository Audit worker handshake',
    HANDSHAKE_KEYS
  ), request);
  const decoded = decodeResult(parseFrame(
    frames[1]!,
    maximumResultBytes,
    'Repository Audit worker result',
    RESULT_KEYS
  ), request, handshake, maximumResultBytes);
  const candidateStream = Object.freeze({
    handshake,
    result: decoded.result,
    payload: new Uint8Array(decoded.payload),
    streamDigest: rawSha256(input.bytes)
  });
  issuedRepositoryAuditWorkerCandidateStreams.add(candidateStream);
  repositoryAuditWorkerCandidateStreamRecords.set(candidateStream, Object.freeze({
    requestDigest: request.requestDigest,
    payloadDigest: decoded.result.payloadDigest,
    streamDigest: candidateStream.streamDigest
  }));
  return candidateStream;
}

/**
 * Mechanical gate for one EOF-observed strict parse. This proves framing and
 * binding only; it deliberately does not prove which process produced bytes.
 * Loaded-implementation authority must additionally consume an owner-issued
 * run/output record from Runtime Physical or an indivisible domain executor.
 */
export function requireRepositoryAuditWorkerCandidateStream(
  value: unknown,
  request: RepositoryAuditWorkerRequest
): RepositoryAuditWorkerCandidateStream {
  decodeRequest(request as unknown as Record<string, unknown>);
  if (value === null || typeof value !== 'object'
      || !issuedRepositoryAuditWorkerCandidateStreams.has(value)) {
    throw new RepositoryAuditWorkerProtocolError(
      'authority-invalid',
      'candidate stream was not issued by the strict protocol parser'
    );
  }
  const stream = value as RepositoryAuditWorkerCandidateStream;
  const record = repositoryAuditWorkerCandidateStreamRecords.get(value);
  if (record === undefined
      || record.requestDigest !== request.requestDigest
      || record.streamDigest !== stream.streamDigest
      || record.payloadDigest !== stream.result.payloadDigest
      || rawSha256(stream.payload) !== record.payloadDigest) {
    throw new RepositoryAuditWorkerProtocolError(
      'foreign-request',
      'candidate stream binding changed after parsing'
    );
  }
  assertRepositoryAuditWorkerCandidateBinding(request, stream.handshake, stream.result);
  return stream;
}
