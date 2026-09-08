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
import { snapshotByteView } from '../../system-architecture/foundation/runtime/byte-snapshot.ts';
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
): Readonly<{ bytes: Uint8Array; frames: readonly Uint8Array[] }> {
  requirePositiveSafeInteger(maximumInputBytes, `${label} maximumInputBytes`);
  if (input.eofObserved !== true) {
    throw new RepositoryAuditWorkerProtocolError('eof-unobserved', label);
  }
  // Select and snapshot once. Framing, JSON and the final stream digest must
  // describe these same bounded bytes, not later reads of a caller's getter.
  const bytes = protocolBytes(input.bytes, maximumInputBytes, label);
  let source: string;
  try {
    source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch (error) {
    throw new RepositoryAuditWorkerProtocolError('invalid-utf8', label, error);
  }
  if (source.includes('\r') || !source.endsWith('\n')) {
    throw new RepositoryAuditWorkerProtocolError('trailing-data', `${label} is not exact LF-delimited framing`);
  }
  // Retain exact byte spans rather than splitting/re-encoding the entire text.
  const frames: Uint8Array[] = [];
  let start = 0;
  for (let end = bytes.indexOf(10); end !== -1; end = bytes.indexOf(10, start)) {
    if (end === start || frames.length === expectedFrames) {
      throw new RepositoryAuditWorkerProtocolError('frame-count-invalid', `${label} has excess or empty frames`);
    }
    frames.push(bytes.subarray(start, end));
    start = end + 1;
  }
  if (frames.length !== expectedFrames) {
    throw new RepositoryAuditWorkerProtocolError('frame-count-invalid', `${label} expected ${expectedFrames} frame(s), received ${frames.length}`);
  }
  return Object.freeze({ bytes, frames: Object.freeze(frames) });
}

function canonicalFrame(value: unknown, maximumBytes: number): Uint8Array {
  const text = `${JSON.stringify(canonicalJson(value))}\n`;
  if (Buffer.byteLength(text, 'utf8') > maximumBytes) {
    throw new RepositoryAuditWorkerProtocolError('input-too-large', 'encoded protocol frame');
  }
  return Buffer.from(text, 'utf8');
}

function protocolBytes(value: Uint8Array, maximumBytes: number, label: string): Uint8Array {
  try { return snapshotByteView(value, label, maximumBytes); }
  catch (error) {
    throw new RepositoryAuditWorkerProtocolError(
      error instanceof RangeError ? 'input-too-large' : 'payload-invalid', label, error
    );
  }
}

function captureFrameFields(record: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    throw new RepositoryAuditWorkerProtocolError('invalid-json', 'protocol frame must be an object');
  }
  return Object.fromEntries(keys.map(key => [key, record[key]]));
}

function requestIdentity(input: Omit<RepositoryAuditWorkerBinding, 'requestDigest'>) {
  return Object.freeze({
    operationIdentityDigest: requireDigest(input.operationIdentityDigest, 'operationIdentityDigest'),
    boundAttemptDigest: requireDigest(input.boundAttemptDigest, 'boundAttemptDigest'),
    generationDigest: requireDigest(input.generationDigest, 'generationDigest'),
    entrypointAddress: requireEntrypoint(input.entrypointAddress),
    implementationDigest: requireDigest(input.implementationDigest, 'implementationDigest'),
    dependencyGenerationDigest: requireDigest(input.dependencyGenerationDigest, 'dependencyGenerationDigest'),
    subjectDigest: requireDigest(input.subjectDigest, 'subjectDigest')
  });
}

function payloadFields(payload: Uint8Array) {
  // Only called with newly owned bytes. Use a buffer view, not another copy.
  return {
    payloadBase64: Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength).toString('base64'),
    payloadByteLength: payload.byteLength,
    payloadDigest: rawSha256(payload)
  };
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
  const identity = requestIdentity(input);
  const payload = protocolBytes(input.payload,
    REPOSITORY_AUDIT_WORKER_PROTOCOL_LIMITS.maximumOperationInputBytes, 'request payload');
  const unsigned = requestUnsigned({ kind: 'repository-audit-worker-request', ...identity, ...payloadFields(payload) });
  return Object.freeze({ ...unsigned, requestDigest: sha256(unsigned) as Digest });
}

function decodeRequest(
  input: Record<string, unknown>,
  maximumPayloadBytes = REPOSITORY_AUDIT_WORKER_PROTOCOL_LIMITS.maximumOperationInputBytes
): Readonly<{ request: RepositoryAuditWorkerRequest; payload: Uint8Array }> {
  const record = captureFrameFields(input, REQUEST_KEYS);
  if (record.kind !== 'repository-audit-worker-request') {
    throw new RepositoryAuditWorkerProtocolError('invalid-json', 'request kind differs');
  }
  const payload = decodePayload(record, Math.min(maximumPayloadBytes,
    REPOSITORY_AUDIT_WORKER_PROTOCOL_LIMITS.maximumOperationInputBytes));
  const unsigned = requestUnsigned({
    kind: 'repository-audit-worker-request',
    ...requestIdentity(record as unknown as RepositoryAuditWorkerBinding),
    payloadBase64: record.payloadBase64 as string,
    payloadByteLength: payload.byteLength,
    payloadDigest: record.payloadDigest as Digest
  });
  const request = Object.freeze({ ...unsigned, requestDigest: sha256(unsigned) as Digest });
  if (record.requestDigest !== request.requestDigest) {
    throw new RepositoryAuditWorkerProtocolError('digest-invalid', 'requestDigest differs');
  }
  return Object.freeze({ request, payload });
}

export function encodeRepositoryAuditWorkerRequest(
  request: RepositoryAuditWorkerRequest
): Uint8Array {
  return canonicalFrame(decodeRequest(request as unknown as Record<string, unknown>).request,
    REPOSITORY_AUDIT_WORKER_PROTOCOL_LIMITS.maximumRequestBytes);
}

/** Returns a defensive copy of the normalized plain input; it carries no authority. */
export function repositoryAuditWorkerRequestPayload(
  request: RepositoryAuditWorkerRequest,
  maximumPayloadBytes: number
): Uint8Array {
  const { payload } = decodeRequest(request as unknown as Record<string, unknown>,
    requirePositiveSafeInteger(maximumPayloadBytes, 'maximumPayloadBytes'));
  return new Uint8Array(payload);
}

export function parseRepositoryAuditWorkerRequestStream(
  input: ClosedBytes,
  budget: RepositoryAuditWorkerProtocolBudget,
  expected?: RepositoryAuditWorkerRequestInput
): RepositoryAuditWorkerRequest {
  const maximumRequestBytes = Math.min(
    requirePositiveSafeInteger(budget.maximumRequestBytes, 'maximumRequestBytes'),
    REPOSITORY_AUDIT_WORKER_PROTOCOL_LIMITS.maximumRequestBytes);
  const { frames } = splitClosedFrames(input, maximumRequestBytes, 1, 'Repository Audit worker request stream');
  const { request } = decodeRequest(parseFrame(frames[0]!, maximumRequestBytes,
    'Repository Audit worker request', REQUEST_KEYS), maximumRequestBytes);
  if (expected !== undefined) assertRequestBinding(request, compileRepositoryAuditWorkerRequest(expected));
  return request;
}

export function compileRepositoryAuditWorkerHandshakeCandidate(
  request: RepositoryAuditWorkerRequest
): RepositoryAuditWorkerHandshakeCandidate {
  return handshakeFromRequest(decodeRequest(request as unknown as Record<string, unknown>).request);
}

function handshakeFromRequest(request: RepositoryAuditWorkerRequest): RepositoryAuditWorkerHandshakeCandidate {
  const unsigned = Object.freeze({
    kind: 'repository-audit-worker-handshake-candidate' as const,
    authority: 'none-candidate-only' as const,
    ...requestIdentity(request),
    requestDigest: request.requestDigest
  });
  return Object.freeze({ ...unsigned, handshakeDigest: sha256(unsigned) as Digest });
}

export function compileRepositoryAuditWorkerResultCandidate(
  request: RepositoryAuditWorkerRequest,
  handshake: RepositoryAuditWorkerHandshakeCandidate,
  payload: Uint8Array
): RepositoryAuditWorkerResultCandidate {
  const rebuilt = decodeRequest(request as unknown as Record<string, unknown>).request;
  const admittedHandshake = decodeHandshake(handshake as unknown as Record<string, unknown>, rebuilt);
  const bytes = protocolBytes(payload,
    REPOSITORY_AUDIT_WORKER_PROTOCOL_LIMITS.maximumOperationResultBytes, 'result payload');
  return resultFromPayload(rebuilt, admittedHandshake, payloadFields(bytes));
}

function resultFromPayload(
  request: RepositoryAuditWorkerRequest,
  handshake: RepositoryAuditWorkerHandshakeCandidate,
  payload: Pick<RepositoryAuditWorkerResultCandidate, 'payloadBase64' | 'payloadByteLength' | 'payloadDigest'>
): RepositoryAuditWorkerResultCandidate {
  const unsigned = Object.freeze({
    kind: 'repository-audit-worker-result-candidate' as const,
    authority: 'none-candidate-only' as const,
    ...requestIdentity(request),
    requestDigest: request.requestDigest,
    handshakeDigest: handshake.handshakeDigest,
    ...payload
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
  input: Record<string, unknown>,
  request: RepositoryAuditWorkerRequest
): RepositoryAuditWorkerHandshakeCandidate {
  const record = captureFrameFields(input, HANDSHAKE_KEYS);
  if (record.kind !== 'repository-audit-worker-handshake-candidate') {
    throw new RepositoryAuditWorkerProtocolError('invalid-json', 'handshake kind differs');
  }
  if (record.authority !== 'none-candidate-only') {
    throw new RepositoryAuditWorkerProtocolError('authority-invalid', 'handshake authority differs');
  }
  const binding = { ...requestIdentity(record as unknown as RepositoryAuditWorkerBinding),
    requestDigest: requireDigest(record.requestDigest, 'requestDigest') };
  assertRequestBinding(binding, request);
  const candidate = handshakeFromRequest(request);
  if (record.handshakeDigest !== candidate.handshakeDigest) {
    throw new RepositoryAuditWorkerProtocolError('digest-invalid', 'handshakeDigest differs');
  }
  return candidate;
}

function decodePayload(record: Record<string, unknown>, maximumResultBytes: number): Uint8Array {
  const { payloadBase64: encoded, payloadByteLength: declared, payloadDigest } = record;
  if (typeof encoded !== 'string' || !Number.isSafeInteger(declared) || (declared as number) < 0) {
    throw new RepositoryAuditWorkerProtocolError('payload-invalid', 'payload fields are invalid');
  }
  // Canonical padded Base64 has exactly four characters per three input bytes.
  // Refuse impossible metadata/limits before Buffer allocates decoded storage;
  // the native decoder plus exact roundtrip still owns Base64 syntax.
  if ((declared as number) > maximumResultBytes
      || encoded.length !== 4 * Math.ceil((declared as number) / 3)) {
    throw new RepositoryAuditWorkerProtocolError('payload-invalid', 'payload bytes differ');
  }
  const payload = Buffer.from(encoded, 'base64');
  if (payload.toString('base64') !== encoded || payload.byteLength !== declared
      || payloadDigest !== rawSha256(payload)) {
    throw new RepositoryAuditWorkerProtocolError('payload-invalid', 'payload bytes differ');
  }
  return payload;
}

function decodeResult(
  input: Record<string, unknown>,
  request: RepositoryAuditWorkerRequest,
  handshake: RepositoryAuditWorkerHandshakeCandidate,
  maximumResultBytes: number
): Readonly<{ result: RepositoryAuditWorkerResultCandidate; payload: Uint8Array }> {
  const record = captureFrameFields(input, RESULT_KEYS);
  if (record.kind !== 'repository-audit-worker-result-candidate') {
    throw new RepositoryAuditWorkerProtocolError('invalid-json', 'result kind differs');
  }
  if (record.authority !== 'none-candidate-only') {
    throw new RepositoryAuditWorkerProtocolError('authority-invalid', 'result authority differs');
  }
  assertRequestBinding({ ...requestIdentity(record as unknown as RepositoryAuditWorkerBinding),
    requestDigest: requireDigest(record.requestDigest, 'requestDigest') }, request);
  if (record.handshakeDigest !== handshake.handshakeDigest) {
    throw new RepositoryAuditWorkerProtocolError('foreign-request', 'result handshakeDigest differs');
  }
  const payload = decodePayload(record, Math.min(maximumResultBytes,
    REPOSITORY_AUDIT_WORKER_PROTOCOL_LIMITS.maximumOperationResultBytes));
  const result = resultFromPayload(request, handshake, {
    payloadBase64: record.payloadBase64 as string,
    payloadByteLength: payload.byteLength,
    payloadDigest: record.payloadDigest as Digest
  });
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
  const rebuilt = decodeRequest(request as unknown as Record<string, unknown>).request;
  const admittedHandshake = decodeHandshake(handshake as unknown as Record<string, unknown>, rebuilt);
  if (result !== undefined) decodeResult(result as unknown as Record<string, unknown>, rebuilt,
    admittedHandshake, REPOSITORY_AUDIT_WORKER_PROTOCOL_LIMITS.maximumOperationResultBytes);
}

export function encodeRepositoryAuditWorkerCandidateStream(
  request: RepositoryAuditWorkerRequest,
  handshake: RepositoryAuditWorkerHandshakeCandidate,
  result: RepositoryAuditWorkerResultCandidate
): Uint8Array {
  const rebuilt = decodeRequest(request as unknown as Record<string, unknown>).request;
  const admittedHandshake = decodeHandshake(handshake as unknown as Record<string, unknown>, rebuilt);
  const admittedResult = decodeResult(result as unknown as Record<string, unknown>, rebuilt,
    admittedHandshake, REPOSITORY_AUDIT_WORKER_PROTOCOL_LIMITS.maximumOperationResultBytes).result;
  const maximumBytes = REPOSITORY_AUDIT_WORKER_PROTOCOL_LIMITS.maximumCandidateStreamBytes;
  const first = canonicalFrame(admittedHandshake, maximumBytes);
  const second = canonicalFrame(admittedResult, maximumBytes - first.byteLength);
  return Buffer.concat([first, second]);
}

export function parseRepositoryAuditWorkerCandidateStream(
  input: ClosedBytes,
  request: RepositoryAuditWorkerRequest,
  budget: RepositoryAuditWorkerProtocolBudget
): RepositoryAuditWorkerCandidateStream {
  const maximumResultBytes = Math.min(
    requirePositiveSafeInteger(budget.maximumResultBytes, 'maximumResultBytes'),
    REPOSITORY_AUDIT_WORKER_PROTOCOL_LIMITS.maximumCandidateStreamBytes);
  const { bytes, frames } = splitClosedFrames(input, maximumResultBytes, 2,
    'Repository Audit worker candidate stream');
  const rebuilt = decodeRequest(request as unknown as Record<string, unknown>).request;
  const handshake = decodeHandshake(parseFrame(frames[0]!, maximumResultBytes,
    'Repository Audit worker handshake', HANDSHAKE_KEYS), rebuilt);
  const decoded = decodeResult(parseFrame(frames[1]!, maximumResultBytes,
    'Repository Audit worker result', RESULT_KEYS), rebuilt, handshake, maximumResultBytes);
  const candidateStream = Object.freeze({
    handshake,
    result: decoded.result,
    payload: new Uint8Array(decoded.payload),
    streamDigest: rawSha256(bytes)
  });
  issuedRepositoryAuditWorkerCandidateStreams.add(candidateStream);
  repositoryAuditWorkerCandidateStreamRecords.set(candidateStream, Object.freeze({
    requestDigest: rebuilt.requestDigest,
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
  const rebuilt = decodeRequest(request as unknown as Record<string, unknown>).request;
  if (value === null || typeof value !== 'object'
      || !issuedRepositoryAuditWorkerCandidateStreams.has(value)) {
    throw new RepositoryAuditWorkerProtocolError('authority-invalid',
      'candidate stream was not issued by the strict protocol parser');
  }
  const stream = value as RepositoryAuditWorkerCandidateStream;
  const record = repositoryAuditWorkerCandidateStreamRecords.get(value);
  if (record === undefined || record.requestDigest !== rebuilt.requestDigest
      || record.streamDigest !== stream.streamDigest
      || record.payloadDigest !== stream.result.payloadDigest
      || rawSha256(stream.payload) !== record.payloadDigest) {
    throw new RepositoryAuditWorkerProtocolError('foreign-request',
      'candidate stream binding changed after parsing');
  }
  // Handshake/result are parser-owned frozen scalar records; mutable payload
  // bytes were just rechecked. Re-decoding both immutable Base64 frames would
  // repeat work without adding another physical-execution observation.
  return stream;
}
