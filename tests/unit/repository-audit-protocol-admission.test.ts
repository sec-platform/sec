import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'bun:test';
import {
  assertRepositoryAuditWorkerCandidateBinding,
  compileRepositoryAuditWorkerHandshakeCandidate as handshakeFor,
  compileRepositoryAuditWorkerRequest as requestFor,
  compileRepositoryAuditWorkerResultCandidate as resultFor,
  encodeRepositoryAuditWorkerCandidateStream as encodeResult,
  encodeRepositoryAuditWorkerRequest as encodeRequest,
  parseRepositoryAuditWorkerCandidateStream as parseResult,
  parseRepositoryAuditWorkerRequestStream as parseRequest,
  repositoryAuditWorkerRequestPayload as requestPayload,
  requireRepositoryAuditWorkerCandidateStream as requireResult,
  REPOSITORY_AUDIT_WORKER_PROTOCOL_LIMITS as limits,
  RepositoryAuditWorkerProtocolError
} from '../../src/brownfield/repository-audit/worker-protocol.ts';

const digest = (text: string) => `sha256:${createHash('sha256').update(text).digest('hex')}` as const;
const budget = { maximumRequestBytes: 16_384, maximumResultBytes: 65_536 };
function input(payload: Uint8Array = Buffer.from('request')) {
  return { operationIdentityDigest: digest('operation'), boundAttemptDigest: digest('attempt'),
    generationDigest: digest('generation'), entrypointAddress: 'module-entrypoint:fixture' as const,
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
test('only literal true is accepted as the caller EOF observation at either public stream boundary', () => {
  const f = fixture(), requestBytes = encodeRequest(f.request);
  for (const eof of [false, undefined, null, 0, 1, 'false', 'true', {}, []]) {
    assert.throws(() => parseRequest({ bytes: requestBytes, eofObserved: eof as never }, budget), code('eof-unobserved'));
    assert.throws(() => parseResult({ bytes: f.bytes, eofObserved: eof as never }, f.request, budget), code('eof-unobserved'));
  }
});

test('unobserved EOF is refused before the stream byte getter runs', () => {
  const f = fixture(); let reads = 0;
  assert.throws(() => parseResult({ get bytes() { reads++; throw new Error('bytes'); }, eofObserved: 1 as never },
    f.request, budget), code('eof-unobserved'));
  assert.equal(reads, 0);
});

test('one captured byte stream supplies both the admitted frames and the recorded digest', () => {
  const f = fixture(); let reads = 0;
  const stream = parseResult({ get bytes() { return ++reads === 1 ? f.bytes : Buffer.from('other stream'); },
    eofObserved: true }, f.request, budget);
  assert.equal(reads, 1);
  assert.equal(stream.streamDigest, digest(Buffer.from(f.bytes).toString('utf8')));
  assert.equal(Buffer.from(stream.payload).toString(), 'result');
});

test('request stream and its byte budget are each selected once', () => {
  const f = fixture(), bytes = encodeRequest(f.request); let byteReads = 0, budgetReads = 0;
  const parsed = parseRequest({ get bytes() { byteReads++; return bytes; }, eofObserved: true }, {
    get maximumRequestBytes() { budgetReads++; return bytes.byteLength; },
    get maximumResultBytes() { assert.fail('unused result policy'); }
  });
  assert.deepEqual(parsed, f.request); assert.equal(byteReads, 1); assert.equal(budgetReads, 1);
});

test('exact stream limits reject the real view size rather than a caller byteLength override', () => {
  const f = fixture(), bytes = Buffer.from(f.bytes);
  Object.defineProperty(bytes, 'byteLength', { value: 0 });
  assert.throws(() => parseResult({ bytes, eofObserved: true }, f.request, { ...budget, maximumResultBytes: 1 }), code('input-too-large'));
});

test('shared stream memory is never accepted as one stable audit observation', () => {
  const f = fixture(), bytes = new Uint8Array(new SharedArrayBuffer(f.bytes.byteLength)); bytes.set(f.bytes);
  assert.throws(() => parseResult({ bytes, eofObserved: true }, f.request, budget), code('payload-invalid'));
  const requestBytes = encodeRequest(f.request), shared = new Uint8Array(new SharedArrayBuffer(requestBytes.byteLength));
  shared.set(requestBytes);
  assert.throws(() => parseRequest({ bytes: shared, eofObserved: true }, budget), code('payload-invalid'));
});

test('request identity fields and payload are captured once before publication', () => {
  const base = input(); const reads = new Map<string, number>();
  const view = Object.fromEntries(Object.entries(base));
  for (const [key, value] of Object.entries(base)) Object.defineProperty(view, key, {
    enumerable: true, get() { reads.set(key, (reads.get(key) ?? 0) + 1); return value; }
  });
  const request = requestFor(view as ReturnType<typeof input>);
  assert.deepEqual([...reads.values()], Object.keys(base).map(() => 1));
  assert.deepEqual(requestPayload(request, 4096), Uint8Array.from(Buffer.from('request')));
});

test('request hashing, Base64 and declared length all use the same actual native view', () => {
  const bytes = Uint8Array.from([0, 1, 2, 3]).subarray(1);
  Object.defineProperties(bytes, { length: { value: 0 }, byteLength: { value: 0 },
    [Symbol.iterator]: { value() { assert.fail('iterator'); } } });
  const request = requestFor(input(bytes));
  assert.equal(request.payloadBase64, 'AQID'); assert.equal(request.payloadByteLength, 3);
  assert.equal(request.payloadDigest, `sha256:${createHash('sha256').update(Buffer.from([1, 2, 3])).digest('hex')}`);
});

test('result hashing and length also use the actual native payload view', () => {
  const f = fixture(), bytes = Uint8Array.from([3, 2, 1]);
  Object.defineProperty(bytes, 'byteLength', { value: 0 });
  const result = resultFor(f.request, f.handshake, bytes);
  assert.equal(result.payloadByteLength, 3); assert.equal(result.payloadBase64, 'AwIB');
});

test('shared memory is rejected by both outgoing payload compilers', () => {
  const f = fixture(), shared = new Uint8Array(new SharedArrayBuffer(3));
  assert.throws(() => requestFor(input(shared)), code('payload-invalid'));
  assert.throws(() => resultFor(f.request, f.handshake, shared), code('payload-invalid'));
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

test('one stream encode and parse decode each request/result payload once, not recursively', () => {
  const f = fixture(); const from = Buffer.from; let decodes = 0;
  Buffer.from = ((...args: unknown[]) => {
    if (args[1] === 'base64') decodes++;
    return Reflect.apply(from, Buffer, args);
  }) as typeof Buffer.from;
  try {
    encodeResult(f.request, f.handshake, f.result); assert.equal(decodes, 2);
    decodes = 0; parseResult({ bytes: f.bytes, eofObserved: true }, f.request, budget); assert.equal(decodes, 2);
    decodes = 0; requestPayload(f.request, 4096); assert.equal(decodes, 1);
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
    const request = requestFor({ ...input(), [key]: key === 'entrypointAddress' ? 'module-entrypoint:other' : digest('foreign') });
    const handshake = handshakeFor(request), result = resultFor(request, handshake, Buffer.from('result'));
    assert.throws(() => parseResult({ bytes: encodeResult(request, handshake, result), eofObserved: true },
      expected.request, budget), code(error));
  }
});

test('partial, extra, CRLF and invalid UTF-8 streams are rejected rather than repaired', () => {
  const f = fixture();
  for (const bytes of [f.bytes.subarray(0, -1), Buffer.concat([f.bytes, Buffer.from('\n')]),
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
