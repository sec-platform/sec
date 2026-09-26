import { expect, test } from 'bun:test';

import { sha256 } from '../../../contracts/canonical.ts';
import type { SourceProgramEntrypointAddress } from '../source-program-model/contract.ts';
import {
  compileRepositoryAuditWorkerHandshakeCandidate,
  compileRepositoryAuditWorkerRequest,
  compileRepositoryAuditWorkerResultCandidate,
  encodeRepositoryAuditWorkerCandidateStream,
  encodeRepositoryAuditWorkerRequest,
  parseRepositoryAuditWorkerCandidateStream,
  parseRepositoryAuditWorkerRequestStream,
  RepositoryAuditWorkerProtocolError,
  type RepositoryAuditWorkerRequestInput
} from './worker-protocol.ts';

const digest = (value: unknown): `sha256:${string}` => sha256(value) as `sha256:${string}`;
const budget = Object.freeze({ maximumRequestBytes: 16_384, maximumResultBytes: 65_536 });

function request(overrides: Partial<RepositoryAuditWorkerRequestInput> = {}) {
  return compileRepositoryAuditWorkerRequest({
    operationIdentityDigest: digest('operation'),
    boundAttemptDigest: digest('attempt'),
    generationDigest: digest('generation'),
    entrypointAddress: (
      'module-entrypoint:src/fixture/module.json#fixture.audit:src/fixture/worker.ts'
    ) as SourceProgramEntrypointAddress,
    implementationDigest: digest('implementation'),
    dependencyGenerationDigest: digest('dependency'),
    subjectDigest: digest('subject'),
    payload: Buffer.from('{"mode":"worktree-source-program"}\n'),
    ...overrides
  });
}

function candidateStream(boundRequest = request(), payload = Buffer.from('{"status":"ok"}\n')) {
  const handshake = compileRepositoryAuditWorkerHandshakeCandidate(boundRequest);
  const result = compileRepositoryAuditWorkerResultCandidate(boundRequest, handshake, payload);
  return Object.freeze({
    handshake,
    result,
    bytes: encodeRepositoryAuditWorkerCandidateStream(boundRequest, handshake, result)
  });
}

test('worker protocol accepts exactly one request and one handshake/result candidate stream', () => {
  const boundRequest = request();
  const requestBytes = encodeRepositoryAuditWorkerRequest(boundRequest);
  expect(parseRepositoryAuditWorkerRequestStream({ bytes: requestBytes, eofObserved: true }, budget))
    .toEqual(boundRequest);

  const stream = candidateStream(boundRequest);
  const parsed = parseRepositoryAuditWorkerCandidateStream(
    { bytes: stream.bytes, eofObserved: true },
    boundRequest,
    budget
  );
  expect(parsed.handshake.authority).toBe('none-candidate-only');
  expect(parsed.result.authority).toBe('none-candidate-only');
  expect(Buffer.from(parsed.payload).toString('utf8')).toBe('{"status":"ok"}\n');
  expect(parsed.handshake.handshakeDigest).toBe(stream.handshake.handshakeDigest);
  expect(parsed.result.resultDigest).toBe(stream.result.resultDigest);
});

test('worker protocol rejects incomplete, duplicate, unknown, trailing and oversized streams', () => {
  const boundRequest = request();
  const requestBytes = encodeRepositoryAuditWorkerRequest(boundRequest);
  const noEof = () => parseRepositoryAuditWorkerRequestStream(
    { bytes: requestBytes, eofObserved: false },
    budget
  );
  expect(noEof).toThrow(RepositoryAuditWorkerProtocolError);
  expect(() => noEof()).toThrow('eof-unobserved');

  const source = Buffer.from(requestBytes).toString('utf8').trimEnd();
  const duplicate = Buffer.from(source.replace(
    '"subjectDigest":',
    `"subjectDigest":"${digest('duplicate')}","subjectDigest":`
  ) + '\n');
  expect(() => parseRepositoryAuditWorkerRequestStream(
    { bytes: duplicate, eofObserved: true }, budget
  )).toThrow('duplicate-field');

  const parsed = JSON.parse(source) as Record<string, unknown>;
  parsed.unknown = true;
  expect(() => parseRepositoryAuditWorkerRequestStream({
    bytes: Buffer.from(`${JSON.stringify(parsed)}\n`),
    eofObserved: true
  }, budget)).toThrow('unknown-field');

  expect(() => parseRepositoryAuditWorkerRequestStream({
    bytes: Buffer.concat([requestBytes, requestBytes]),
    eofObserved: true
  }, budget)).toThrow('frame-count-invalid');
  expect(() => parseRepositoryAuditWorkerRequestStream({
    bytes: Buffer.from(`${source} trailing\n`),
    eofObserved: true
  }, budget)).toThrow('trailing-data');
  expect(() => parseRepositoryAuditWorkerRequestStream({
    bytes: requestBytes,
    eofObserved: true
  }, { ...budget, maximumRequestBytes: requestBytes.byteLength - 1 })).toThrow('input-too-large');

  const stream = candidateStream(boundRequest);
  expect(() => parseRepositoryAuditWorkerCandidateStream({
    bytes: Buffer.concat([stream.bytes, Buffer.from('\n')]),
    eofObserved: true
  }, boundRequest, budget)).toThrow('frame-count-invalid');
});

test('worker protocol preserves typed rejection for every foreign binding dimension', () => {
  const expected = request();
  const foreignCases = [
    ['foreign-operation', { operationIdentityDigest: digest('foreign-operation') }],
    ['foreign-attempt', { boundAttemptDigest: digest('foreign-attempt') }],
    ['foreign-generation', { generationDigest: digest('foreign-generation') }],
    ['foreign-entrypoint', {
      entrypointAddress: (
        'module-entrypoint:src/foreign/module.json#foreign:src/foreign/worker.ts'
      ) as SourceProgramEntrypointAddress
    }],
    ['foreign-implementation', { implementationDigest: digest('foreign-implementation') }],
    ['foreign-dependency', { dependencyGenerationDigest: digest('foreign-dependency') }],
    ['foreign-subject', { subjectDigest: digest('foreign-subject') }]
  ] as const;
  for (const [code, overrides] of foreignCases) {
    const foreign = request(overrides);
    const stream = candidateStream(foreign);
    expect(() => parseRepositoryAuditWorkerCandidateStream(
      { bytes: stream.bytes, eofObserved: true },
      expected,
      budget
    )).toThrow(code);
  }
});

test('worker result payload is byte-bound and cannot claim authority', () => {
  const boundRequest = request();
  const stream = candidateStream(boundRequest, Buffer.alloc(64, 0x61));
  expect(() => parseRepositoryAuditWorkerCandidateStream(
    { bytes: stream.bytes, eofObserved: true },
    boundRequest,
    { ...budget, maximumResultBytes: 32 }
  )).toThrow('input-too-large');

  const lines = Buffer.from(stream.bytes).toString('utf8').trimEnd().split('\n');
  const result = JSON.parse(lines[1]!) as Record<string, unknown>;
  result.authority = 'loaded-implementation';
  const forged = Buffer.from(`${lines[0]}\n${JSON.stringify(result)}\n`);
  expect(() => parseRepositoryAuditWorkerCandidateStream(
    { bytes: forged, eofObserved: true },
    boundRequest,
    budget
  )).toThrow('authority-invalid');
});
