import { describe, expect, test } from 'bun:test';
import { CodedFailure } from '../../contracts/failure.ts';
import { encodeAuthorAnalysisRequest, type AuthorAnalysisRequestInput, type AuthorCaptureObservation } from './author-analysis-request.ts';

function input(): AuthorAnalysisRequestInput {
  return {
    root: { locator: 'root.json', bytes: new Uint8Array([0, 9, 10, 99, 100, 255]) },
    context: { project_instance: 'capture:fixed', resolution_domain: 'resolver/1' },
    observations: new Map(),
    budget: { work: 8_000_000, allocation_bytes: 48 * 1024 * 1024 }
  };
}

// The independent built-in JSON serializer checks the existing /1 exchange
// contract, not the production writer's own length calculation or output.
function expected(request: AuthorAnalysisRequestInput): string {
  return JSON.stringify({
    schema: 'gift.author-analysis-request/1', purpose: 'analyze',
    root: { locator: request.root.locator, bytes: Array.from(request.root.bytes) },
    context: request.context,
    ...(request.interpretation === undefined ? {} : { interpretation: request.interpretation }),
    observations: [...request.observations.values()].map(observation => observation.kind === 'file'
      ? { kind: observation.kind, path: observation.path, outcome: observation.outcome, bytes: Array.from(observation.bytes) }
      : observation),
    budget: request.budget
  });
}

function resourceFailure(action: () => unknown): CodedFailure {
  try { action(); } catch (error) {
    expect(error).toBeInstanceOf(CodedFailure);
    const failure = error as CodedFailure;
    expect(failure.code).toBe('AUTHOR-ANALYSIS-RESOURCE');
    return failure;
  }
  throw new Error('Expected the original resource failure, not a successful or empty request');
}

describe('author analysis /1 request encoding', () => {
  test('preserves byte values, acquisition outcomes, insertion order and optional interpretation', () => {
    const observations = new Map<string, AuthorCaptureObservation>([
      ['directory:.', { kind: 'directory', path: '.', outcome: 'partial', entries: [
        { name: '__proto__', kind: 'file', byte_length: 256 },
        { name: 'link', kind: 'link', byte_length: 0 },
        { name: 'directory', kind: 'directory', byte_length: 0 },
        { name: 'other', kind: 'other', byte_length: Number.MAX_SAFE_INTEGER }
      ] }],
      ['file:values', { kind: 'file', path: 'values', outcome: 'found', bytes: Uint8Array.from({ length: 256 }, (_, index) => index) }],
      ['file:missing', { kind: 'file', path: 'missing', outcome: 'absent', bytes: new Uint8Array(0) }],
      ['directory:denied', { kind: 'directory', path: 'denied', outcome: 'denied', entries: [] }]
    ]);
    for (const interpretation of [undefined, '', `sha256:${'a'.repeat(64)}`]) {
      const request = { ...input(), observations, ...(interpretation === undefined ? {} : { interpretation }) };
      const encoded = encodeAuthorAnalysisRequest(request, () => {});
      expect(encoded.toString('utf8')).toBe(expected(request));
      expect(JSON.parse(encoded.toString('utf8')).observations[1].bytes).toEqual(Array.from({ length: 256 }, (_, index) => index));
      expect(request.budget).toEqual({ work: 8_000_000, allocation_bytes: 48 * 1024 * 1024 });
      expect(request.root.bytes).toEqual(new Uint8Array([0, 9, 10, 99, 100, 255]));
    }
    for (const outcome of ['complete', 'found', 'partial', 'absent', 'denied', 'unavailable', 'failed'] as const) {
      const request = { ...input(), observations: new Map<string, AuthorCaptureObservation>([
        ['directory:.', { kind: 'directory', path: '.', outcome, entries: [] }],
        ['file:source', { kind: 'file', path: 'source', outcome, bytes: new Uint8Array(0) }]
      ]) };
      expect(encodeAuthorAnalysisRequest(request, () => {}).toString('utf8')).toBe(expected(request));
    }
  });

  test('uses standard JSON escaping for all UTF-16 code units and a paired-surrogate boundary', () => {
    // Lone surrogates are transport metadata in this test. This does not make
    // them valid Gift Names or grant author/locator semantic qualification.
    let units = '';
    for (let index = 0; index <= 0xffff; index++) units += String.fromCharCode(index);
    for (const value of [units, '\u0000\b\t\n\f\r"\\/', '文😀\u2028\u2029', '\ud800', '\udfff', `${'x'.repeat(4095)}😀`]) {
      const request = { ...input(), root: { locator: value, bytes: new Uint8Array(0) } };
      expect(encodeAuthorAnalysisRequest(request, () => {}).toString('utf8')).toBe(expected(request));
    }
  });

  test('admits the exact caller wire ceiling and rejects one byte less before publishing a request', () => {
    const request = input();
    const length = Buffer.byteLength(expected(request), 'utf8');
    expect(encodeAuthorAnalysisRequest(request, () => {}, length).length).toBe(length);
    resourceFailure(() => encodeAuthorAnalysisRequest(request, () => {}, length - 1));
    resourceFailure(() => encodeAuthorAnalysisRequest(request, () => {}, 0));
    const bytes = { ...request, root: { locator: 'root.json', bytes: new Uint8Array(4096).fill(255) } };
    const metadata = { ...request, root: { locator: '\ud800'.repeat(4096), bytes: new Uint8Array(0) } };
    for (const oversized of [bytes, metadata]) {
      resourceFailure(() => encodeAuthorAnalysisRequest(oversized, () => {}, 1024));
    }
  });

  test('leaves native settlement to the selected kernel and rejects inexact transport integers', () => {
    // No host-side copy of a particular kernel's private receive formula. A
    // zero remaining budget is sent exactly; the native owner decides its result.
    for (const budget of [
      { work: 0, allocation_bytes: 0 },
      { work: 33, allocation_bytes: 4096 },
      { work: 8_000_000, allocation_bytes: 48 * 1024 * 1024 }
    ]) {
      const request = { ...input(), budget };
      expect(encodeAuthorAnalysisRequest(request, () => {}).toString('utf8')).toBe(expected(request));
      expect(request.budget).toEqual(budget);
    }
    for (const value of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      for (const action of [
        () => encodeAuthorAnalysisRequest({ ...input(), budget: { work: value, allocation_bytes: 10000 } }, () => {}),
        () => encodeAuthorAnalysisRequest(input(), () => {}, value),
        () => encodeAuthorAnalysisRequest({ ...input(), observations: new Map<string, AuthorCaptureObservation>([
          ['directory:.', { kind: 'directory', path: '.', outcome: 'complete', entries: [
            { name: 'source', kind: 'file', byte_length: value }
          ] }]
        ]) }, () => {})
      ]) {
        try {
          action();
          throw new Error('Expected invalid transport integer rejection');
        } catch (error) {
          expect(error).toBeInstanceOf(CodedFailure);
          expect((error as CodedFailure).code).toBe('AUTHOR-ANALYSIS-PROTOCOL');
        }
      }
    }
  });

  test('propagates logical-run cancellation without publishing a fallback request', () => {
    const stopped = new Error('logical run cancelled');
    const request = { ...input(), root: { locator: 'root.json', bytes: new Uint8Array(16384) } };
    let checks = 0;
    expect(() => encodeAuthorAnalysisRequest(request, () => {
      if (++checks === 6) throw stopped;
    })).toThrow(stopped);
    expect(checks).toBe(6);
  });
});
