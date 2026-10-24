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
      .rejects.toMatchObject({ code: 'VERIFY-BUILD-007' });
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
    await expect(runSuiteProcesses(input)).rejects.toMatchObject({ code: 'VERIFY-BUILD-007' });
  });
});

test('suite invocation capture bounds candidate inventory and path resources', () => {
  const input = { workspaceRoot: '.', suiteRoot: 'tests/unit', files: [] as string[] };
  for (const files of [Array.from({ length: 10_001 }, (_, index) => `tests/unit/${index}.test.ts`), ['a'.repeat(16 * 1024 + 1)]]) {
    expect(() => captureFastSuiteProcessInput({ ...input, files })).toThrow();
  }
});
