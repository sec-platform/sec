import { expect, test } from 'bun:test';
import { captureFastSuiteProcessInput } from '../../../src/adapters/verification/fast-suite-input.ts';
import { runSuiteProcesses } from '../../../src/adapters/verification/run-suite-processes.ts';
import { withFastSuiteCandidate } from '../../testkit/fast-suite-candidate.ts';

test('candidate top-level Reflect.apply replacement cannot skip its failing runSuite', async () => {
  await withFastSuiteCandidate(`
    Reflect.apply = () => undefined;
    export function runSuite() { throw new Error('suite must execute'); }
  `, async ({ input }) => {
    const passed: string[] = [];
    await expect(runSuiteProcesses({ ...input, onSuitePassed: file => passed.push(file) }))
      .rejects.toMatchObject({
        code: 'VERIFY-BUILD-007',
        details: { failure: 'suite must execute' }
      });
    expect(passed).toEqual([]);
  });
});

test('candidate error accessors cannot terminate the harness during failure projection', async () => {
  await withFastSuiteCandidate(`
    export function runSuite() {
      const failure = new Error('failure');
      Object.defineProperty(failure, 'message', { get() { process.exit(0); } });
      throw failure;
    }
  `, async ({ input }) => {
    const passed: string[] = [];
    await expect(runSuiteProcesses({ ...input, onSuitePassed: file => passed.push(file) }))
      .rejects.toMatchObject({
        code: 'VERIFY-BUILD-007',
        details: { failure: '[non-Error suite failure]' }
      });
    expect(passed).toEqual([]);
  });
});

test('suite invocation capture bounds candidate inventory and path resources', () => {
  const input = { workspaceRoot: '.', suiteRoot: 'tests/unit', files: [] as string[] };
  for (const files of [Array.from({ length: 10_001 }, (_, index) => `tests/unit/${index}.test.ts`), ['a'.repeat(16 * 1024 + 1)]]) {
    expect(() => captureFastSuiteProcessInput({ ...input, files })).toThrow();
  }
  // Reject untrusted descriptors without executing their getters or proxy traps.
  const accessorInput = Object.defineProperty({ ...input }, 'workspaceRoot', {
    get() { throw new Error('workspaceRoot getter executed'); }
  });
  expect(() => captureFastSuiteProcessInput(accessorInput)).toThrow('own data property');
  expect(() => captureFastSuiteProcessInput(new Proxy({ ...input }, {}))).toThrow('own-data object');
  expect(() => captureFastSuiteProcessInput({ ...input, files: new Proxy([], {}) }))
    .toThrow('non-proxy array');
  expect(() => captureFastSuiteProcessInput({ ...input, files: Array(1) }))
    .toThrow('dense own data');
  const accessorFile = Object.defineProperty(['safe.test.ts'], 0, {
    get() { throw new Error('file getter executed'); }
  });
  expect(() => captureFastSuiteProcessInput({ ...input, files: accessorFile }))
    .toThrow('dense own data');
});
