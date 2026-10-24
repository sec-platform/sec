import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sha256 } from '../../../contracts/canonical.ts';
import {
  assertRepositoryAuditWorkerCandidateBinding,
  encodeRepositoryAuditWorkerRequest as encodeRequest,
  encodeRepositoryAuditWorkerCandidateStream as encodeResult,
  compileRepositoryAuditWorkerHandshakeCandidate as handshakeFor,
  REPOSITORY_AUDIT_WORKER_PROTOCOL_LIMITS as limits,
  parseRepositoryAuditWorkerRequestStream as parseRequest,
  parseRepositoryAuditWorkerCandidateStream as parseResult,
  RepositoryAuditWorkerProtocolError,
  compileRepositoryAuditWorkerRequest as requestFor,
  repositoryAuditWorkerRequestPayload as requestPayload,
  requireRepositoryAuditWorkerCandidateStream as requireResult,
  compileRepositoryAuditWorkerResultCandidate as resultFor
} from './worker-protocol.ts';

const digest = (text: string) => `sha256:${createHash('sha256').update(text).digest('hex')}` as const;
const budget = { maximumRequestBytes: 16_384, maximumResultBytes: 65_536 };
function input(payload: Uint8Array = Buffer.from('request')) {
  return { operationIdentityDigest: digest('operation'), boundAttemptDigest: digest('attempt'),
    generationDigest: digest('generation'), entrypointAddress: 'module-entrypoint:fixture#default' as const,
    implementationDigest: digest('implementation'), dependencyGenerationDigest: digest('dependency'),
    subjectDigest: digest('subject'), payload };
}
function fixture() {
  const request = requestFor(input()), handshake = handshakeFor(request);
  const result = resultFor(request, handshake, Buffer.from('result'));
  return { request, handshake, result, bytes: encodeResult(request, handshake, result) };
}
const code = (expected: string) => (error: unknown) => error instanceof RepositoryAuditWorkerProtocolError && error.code === expected;

// Wire vectors, byte hashes and expected payloads below are independent of the
// protocol implementation. Fixtures are plain data: no actual worker execution,
// physical closeout or audit success is inferred from successful parsing.
test('worker request, handshake and result bind the independent canonical field vectors', () => {
  const { payload, ...identity } = input();
  const expectedRequestBody = {
    kind: 'repository-audit-worker-request', ...identity,
    payloadBase64: Buffer.from(payload).toString('base64'),
    payloadByteLength: payload.byteLength,
    payloadDigest: `sha256:${createHash('sha256').update(payload).digest('hex')}`
  };
  const expectedRequest = { ...expectedRequestBody, requestDigest: sha256(expectedRequestBody) };
  const f = fixture();
  assert.deepEqual(f.request, expectedRequest);
  const parsed = parseResult({ bytes: f.bytes, eofObserved: true }, f.request, budget);
  const expectedHandshakeBody = {
    kind: 'repository-audit-worker-handshake-candidate', authority: 'none-candidate-only',
    ...identity, requestDigest: expectedRequest.requestDigest
  };
  const expectedHandshake = { ...expectedHandshakeBody, handshakeDigest: sha256(expectedHandshakeBody) };
  const resultPayload = Buffer.from('result');
  const expectedResultBody = {
    kind: 'repository-audit-worker-result-candidate', authority: 'none-candidate-only',
    ...identity, requestDigest: expectedRequest.requestDigest, handshakeDigest: expectedHandshake.handshakeDigest,
    payloadBase64: resultPayload.toString('base64'), payloadByteLength: resultPayload.byteLength,
    payloadDigest: `sha256:${createHash('sha256').update(resultPayload).digest('hex')}`
  };
  assert.deepEqual(parsed.handshake, expectedHandshake);
  assert.deepEqual(parsed.result, { ...expectedResultBody, resultDigest: sha256(expectedResultBody) });
  assert.deepEqual(Buffer.from(parsed.payload), resultPayload);
});

test('the existing outgoing payload ceilings apply before copying or Base64 encoding', () => {
  const f = fixture();
  assert.throws(() => requestFor(input(new Uint8Array(limits.maximumOperationInputBytes + 1))), code('input-too-large'));
  assert.throws(() => resultFor(f.request, f.handshake, new Uint8Array(limits.maximumOperationResultBytes + 1)), code('input-too-large'));
});

test('Base64 length and declared byte limits are rejected before native decoded allocation', () => {
  const f = fixture(); const from = Buffer.from; let decodes = 0;
  Buffer.from = ((...args: unknown[]) => {
    if (args[1] === 'base64') decodes++;
    return Reflect.apply(from, Buffer, args);
  }) as typeof Buffer.from;
  try {
    assert.throws(() => requestPayload(f.request, 1), code('payload-invalid'));
    assert.throws(() => requestPayload({ ...f.request, payloadByteLength: 0 }, 4096), code('payload-invalid'));
    assert.equal(decodes, 0);
  } finally { Buffer.from = from; }
});

test('canonical request and result bytes roundtrip for empty, binary and UTF-8 payloads', () => {
  for (const payload of [Buffer.alloc(0), Buffer.from([0, 1, 254, 255]), Buffer.from('中文🙂\n')]) {
    const request = requestFor(input(payload)), handshake = handshakeFor(request), result = resultFor(request, handshake, payload);
    const rb = encodeRequest(request), bytes = encodeResult(request, handshake, result);
    assert.deepEqual(parseRequest({ bytes: rb, eofObserved: true }, budget), request);
    const parsed = parseResult({ bytes, eofObserved: true }, request, budget);
    assert.deepEqual(parsed.payload, Uint8Array.from(payload));
    assert.deepEqual(encodeResult(request, parsed.handshake, parsed.result), bytes);
  }
});

test('every binding dimension is checked before a candidate can cross into this request', () => {
  const expected = fixture();
  const dimensions = [['operationIdentityDigest', 'foreign-operation'], ['boundAttemptDigest', 'foreign-attempt'],
    ['generationDigest', 'foreign-generation'], ['entrypointAddress', 'foreign-entrypoint'],
    ['implementationDigest', 'foreign-implementation'], ['dependencyGenerationDigest', 'foreign-dependency'],
    ['subjectDigest', 'foreign-subject']] as const;
  for (const [key, error] of dimensions) {
    const request = requestFor({ ...input(), [key]: key === 'entrypointAddress' ? 'module-entrypoint:other#default' : digest('foreign') });
    const handshake = handshakeFor(request), result = resultFor(request, handshake, Buffer.from('result'));
    assert.throws(() => parseResult({ bytes: encodeResult(request, handshake, result), eofObserved: true },
      expected.request, budget), code(error));
  }
});

test('partial, extra, CRLF and invalid UTF-8 streams are rejected rather than repaired', () => {
  const f = fixture();
  assert.throws(() => parseResult({ bytes: f.bytes, eofObserved: true }, f.request,
    { ...budget, maximumResultBytes: f.bytes.byteLength - 1 }), code('input-too-large'));
  const requestBytes = encodeRequest(f.request);
  const requestSource = Buffer.from(requestBytes).toString('utf8').trimEnd();
  assert.throws(() => parseRequest({ bytes: Buffer.concat([requestBytes, requestBytes]), eofObserved: true },
    budget), code('frame-count-invalid'));
  assert.throws(() => parseRequest({ bytes: Buffer.from(`${requestSource} trailing\n`), eofObserved: true },
    budget), code('trailing-data'));
  assert.throws(() => parseRequest({ bytes: requestBytes, eofObserved: true },
    { ...budget, maximumRequestBytes: requestBytes.byteLength - 1 }), code('input-too-large'));

  assert.throws(() => parseResult({ bytes: Buffer.concat([f.bytes, Buffer.from('\n')]), eofObserved: true },
    f.request, budget), code('frame-count-invalid'));
  for (const bytes of [f.bytes.subarray(0, -1),
    Buffer.from(Buffer.from(f.bytes).toString().replace(/\n/g, '\r\n')),
    Buffer.concat([f.bytes, f.bytes]), Uint8Array.of(255, 10)]) {
    assert.throws(() => parseResult({ bytes, eofObserved: true }, f.request, budget), RepositoryAuditWorkerProtocolError);
  }
});

test('unknown fields, duplicate keys and noncanonical JSON continue to reject', () => {
  const f = fixture(), text = Buffer.from(encodeRequest(f.request)).toString();
  const duplicate = text.replace('"subjectDigest":', `"subjectDigest":"${digest('duplicate')}","subjectDigest":`);
  assert.throws(() => parseRequest({ bytes: Buffer.from(duplicate), eofObserved: true }, budget), code('duplicate-field'));
  const unknown = JSON.stringify({ ...f.request, unknown: true }) + '\n';
  assert.throws(() => parseRequest({ bytes: Buffer.from(unknown), eofObserved: true }, budget), code('unknown-field'));
  assert.throws(() => parseRequest({ bytes: Buffer.from(' ' + text), eofObserved: true }, budget), code('invalid-json'));
});

test('the native Base64 roundtrip still rejects permissive padding and nonzero padding bits', () => {
  const request = requestFor(input(Buffer.from([0])));
  for (const payloadBase64 of ['AA', 'AA= ', 'AB==', '====', '!!!!', '_A==']) {
    assert.throws(() => requestPayload({ ...request, payloadBase64 }, 4096), code('payload-invalid'));
  }
});

test('candidate-only cannot be promoted by JSON copies, object spreads or an authority field', () => {
  const f = fixture(), stream = parseResult({ bytes: f.bytes, eofObserved: true }, f.request, budget);
  assert.equal(requireResult(stream, f.request), stream);
  for (const clone of [{ ...stream }, JSON.parse(JSON.stringify(stream))]) {
    assert.throws(() => requireResult(clone, f.request), code('authority-invalid'));
  }
  assert.throws(() => assertRepositoryAuditWorkerCandidateBinding(f.request,
    { ...f.handshake, authority: 'loaded-implementation' as never }), code('authority-invalid'));
  const lines = Buffer.from(f.bytes).toString('utf8').trimEnd().split('\n');
  const forgedResult = { ...JSON.parse(lines[1]!), authority: 'loaded-implementation' };
  const forgedBytes = Buffer.from(`${lines[0]}\n${JSON.stringify(forgedResult)}\n`);
  assert.throws(() => parseResult({ bytes: forgedBytes, eofObserved: true }, f.request, budget), code('authority-invalid'));
});

test('later mutation of exposed payload bytes invalidates the parsed-stream token', () => {
  const f = fixture(), stream = parseResult({ bytes: f.bytes, eofObserved: true }, f.request, budget);
  stream.payload.fill(0);
  assert.throws(() => requireResult(stream, f.request), code('foreign-request'));
});

test('callers never receive an alias of input memory or an earlier payload return', () => {
  const bytes = Buffer.from('request'), request = requestFor(input(bytes)); bytes.fill(0);
  const one = requestPayload(request, 4096); one.fill(0);
  assert.equal(Buffer.from(requestPayload(request, 4096)).toString(), 'request');
  const f = fixture(), stream = parseResult({ bytes: f.bytes, eofObserved: true }, f.request, budget);
  f.bytes.fill(0); assert.equal(Buffer.from(stream.payload).toString(), 'result');
  assert.equal(requireResult(stream, f.request), stream);
});
