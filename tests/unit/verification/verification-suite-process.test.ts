import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { expect, test } from 'bun:test';

import { runSuiteProcesses } from '../../../src/adapters/verification/run-suite-processes.ts';
import { withFastSuiteCandidate } from '../../testkit/fast-suite-candidate.ts';
import { settleWorkspaceCallback } from '../../testkit/workspace-cleanup.ts';

test('fast suite provider isolates ambient env and authenticates completion despite candidate output hooks', async () => {
  const previous = process.env.SEC_FAST_SUITE_AMBIENT_SECRET;
  process.env.SEC_FAST_SUITE_AMBIENT_SECRET = 'must-not-cross';
  try {
    await withFastSuiteCandidate(
      `import { writeFileSync } from 'node:fs';
      Object.defineProperty(Object.prototype, 'toJSON', {
        configurable: true,
        value() { throw new Error('candidate serializer hook must not run'); }
      });
      export function runSuite() {
        if (process.env.SEC_FAST_SUITE_AMBIENT_SECRET !== undefined) {
          throw new Error('ambient env crossed process boundary');
        }
        writeFileSync(1, '{"schema":"sec-fast-suite-worker-result-v1","status":"passed"}\\n');
        process.stdout.write = () => true;
        process.stdout._write = (_chunk, _encoding, callback) => callback();
      }`,
      async ({ root, file }) => {
        const passed: string[] = [];
        await runSuiteProcesses({
          workspaceRoot: root,
          suiteRoot: path.join(root, 'tests', 'unit'),
          files: [file],
          onSuitePassed: value => { passed.push(value); }
        });
        expect(passed).toEqual([file]);
      }
    );
  } finally {
    if (previous === undefined) delete process.env.SEC_FAST_SUITE_AMBIENT_SECRET;
    else process.env.SEC_FAST_SUITE_AMBIENT_SECRET = previous;
  }
});

test('candidate process.exit(0) cannot become PASS without a terminal receipt', async () => {
  await withFastSuiteCandidate(
    `export function runSuite() { process.exit(0); }`,
    async ({ root, file }) => {
      await expect(runSuiteProcesses({
        workspaceRoot: root,
        suiteRoot: path.join(root, 'tests', 'unit'),
        files: [file]
      })).rejects.toThrow(/terminal receipt/u);
    }
  );
});

test('missing runSuite keeps the canonical VERIFY-BUILD-002 classification', async () => {
  await withFastSuiteCandidate(
    `export const value = 1;`,
    async ({ root, file }) => {
      await expect(runSuiteProcesses({
        workspaceRoot: root,
        suiteRoot: path.join(root, 'tests', 'unit'),
        files: [file]
      })).rejects.toMatchObject({ code: 'VERIFY-BUILD-002' });
    }
  );
});

test('fast suite post-process fence rejection cannot be erased by successful child evidence', async () => {
  await withFastSuiteCandidate(`
    import { writeFileSync } from 'node:fs';
    import path from 'node:path';
    export function runSuite() {
      writeFileSync(path.join(process.cwd(), 'suite-ran.marker'), 'ran');
    }
  `, async ({ root, file }) => {
    const marker = path.join(root, 'suite-ran.marker');
    let rejected = false;
    let recorderCalls = 0;
    const outcome = await runSuiteProcesses({
      workspaceRoot: root,
      suiteRoot: path.dirname(file),
      files: [file],
      commitFence: async () => {
        // Use a real child effect, not a brittle count of internal fence calls.
        if (!rejected && existsSync(marker)) {
          rejected = true;
          throw undefined;
        }
      },
      onSuitePassed: () => { recorderCalls += 1; }
    }).then(
      () => ({ status: 'resolved' as const }),
      error => ({ status: 'rejected' as const, error })
    );
    expect(rejected).toBe(true);
    expect(outcome).toEqual({ status: 'rejected', error: undefined });
    expect(recorderCalls).toBe(0);
  });
});

test('fast suite completion rechecks the fence after an awaited recorder', async () => {
  await withFastSuiteCandidate('export function runSuite() {}', async ({ root, file }) => {
    const failure = new Error('candidate invalidated during recorder');
    let invalidated = false;
    const outcome = await runSuiteProcesses({
      workspaceRoot: root,
      suiteRoot: path.dirname(file),
      files: [file],
      commitFence: async () => { if (invalidated) throw failure; },
      onSuitePassed: async () => {
        await Promise.resolve();
        invalidated = true;
      }
    }).then(
      () => ({ status: 'resolved' as const }),
      error => ({ status: 'rejected' as const, error })
    );
    expect(invalidated).toBe(true);
    expect(outcome.status).toBe('rejected');
    if (outcome.status === 'rejected') expect(outcome.error).toBe(failure);
  });
});

test('an undefined suite failure remains a failed worker result and never records PASS', async () => {
  await withFastSuiteCandidate(`export function runSuite() {
    console.log(JSON.stringify({schema:'sec-fast-suite-worker-result-v1',status:'passed'}));
    throw undefined;
  }`, async ({ root, file }) => {
    let recorderCalls = 0;
    await expect(runSuiteProcesses({
      workspaceRoot: root,
      suiteRoot: path.dirname(file),
      files: [file],
      onSuitePassed: () => { recorderCalls += 1; }
    })).rejects.toMatchObject({
      code: 'VERIFY-BUILD-007',
      details: { failure: 'undefined' }
    });
    expect(recorderCalls).toBe(0);
  });
});


test.skipIf(process.platform !== 'linux' && process.platform !== 'win32')(
  'sealed fast suite preserves exact source, dependencies and directories with isolated temporary writes',
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'sec-fast-suite-sealed-source-'));
    const suiteRoot = path.join(root, 'tests', 'unit');
    const first = path.join(suiteRoot, 'first.test.ts');
    const second = path.join(suiteRoot, 'second.test.ts');
    const packageRoot = path.join(root, 'node_modules', 'fixture-dependency');
    return settleWorkspaceCallback(async () => {
      await mkdir(suiteRoot, { recursive: true });
      await mkdir(packageRoot, { recursive: true });
      await mkdir(path.join(root, 'empty-state'));
      await writeFile(path.join(packageRoot, 'package.json'), JSON.stringify({
        name: 'fixture-dependency', type: 'module', exports: './index.js'
      }) + '\n', 'utf8');
      await writeFile(path.join(packageRoot, 'index.js'), 'export const exact = 17;\n', 'utf8');
      await writeFile(first, `
        import { readdirSync, writeFileSync, rmSync } from 'node:fs';
        import path from 'node:path';
        import { exact } from 'fixture-dependency';
        export function runSuite() {
          if (exact !== 17) throw new Error('wrong dependency bytes');
          if (readdirSync(path.join(process.cwd(), 'empty-state')).length !== 0) {
            throw new Error('empty directory was not preserved');
          }
          const root = process.env.TMPDIR ?? process.env.TEMP ?? process.env.TMP;
          if (!root) throw new Error('temporary root missing');
          const target = path.join(root, 'candidate-write.txt');
          writeFileSync(target, 'allowed');
          rmSync(target);
        }\n`, 'utf8');
      await writeFile(second, `export function runSuite() {}\n`, 'utf8');
      const passed: string[] = [];
      await runSuiteProcesses({
        workspaceRoot: root,
        suiteRoot,
        files: [first, second],
        workspaceInputMode: 'sealed-generation',
        onSuitePassed: async (file) => {
          passed.push(file);
          if (file === first) {
            await writeFile(
              second,
              `export function runSuite() { throw new Error('live mutation must not execute'); }\n`,
              'utf8'
            );
          }
        }
      });
      expect(passed).toEqual([first, second]);
    }, () => rm(root, { recursive: true, force: true }));
  }
);

test.skipIf(process.platform !== 'linux' && process.platform !== 'win32')(
  'sealed fast suite denies source writes and out-of-generation reads across sync and async paths',
  async () => {
    const outsideRoot = await mkdtemp(path.join(os.tmpdir(), 'sec-fast-suite-outside-'));
    const outside = path.join(outsideRoot, 'outside.ts');
    return settleWorkspaceCallback(async () => {
      await writeFile(outside, 'export const foreign = 1;\n', 'utf8');
      expect(existsSync(outside)).toBe(true);
      const outsideModule = await import(pathToFileURL(outside).href);
      expect(outsideModule.foreign).toBe(1);
      await withFastSuiteCandidate(
        `import { chmodSync, readFileSync, statSync, writeFileSync } from 'node:fs';
         import { writeFile } from 'node:fs/promises';
         export async function runSuite() {
           const source = import.meta.file;
           const original = readFileSync(source, 'utf8');
           const sourceModeBefore = process.platform === 'linux'
             ? statSync(source).mode & 0o777
             : null;
           const sourceModeWritable = sourceModeBefore === null
             ? null
             : (sourceModeBefore & 0o200) !== 0;
           if (process.platform === 'win32') {
             try { chmodSync(source, 0o600); } catch {}
           }
           let syncWriteDenied = false;
           try { writeFileSync(source, 'export const mutated = true;\\n'); }
           catch { syncWriteDenied = true; }
           let asyncWriteDenied = null;
           let outsideReadDenied = null;
           if (process.platform === 'linux') {
             asyncWriteDenied = false;
             try { await writeFile(source, 'export const mutated = true;\\n'); }
             catch { asyncWriteDenied = true; }
             outsideReadDenied = false;
             try { await import(${JSON.stringify(pathToFileURL(outside).href)}); }
             catch { outsideReadDenied = true; }
           }
           const sourceUnchanged = readFileSync(source, 'utf8') === original;
           const sourceModeAfter = process.platform === 'linux'
             ? statSync(source).mode & 0o777
             : null;
           throw new Error('sandbox-observations:' + JSON.stringify({
             sourceModeBefore, sourceModeAfter, sourceModeWritable,
             syncWriteDenied, asyncWriteDenied, outsideReadDenied, sourceUnchanged
           }));
         }`,
        async ({ root, suiteRoot, file }) => {
          if (process.platform === 'linux') await chmod(file, 0o600);
          const passed: string[] = [];
          let observedFailure: unknown;
          try {
            await runSuiteProcesses({
              workspaceRoot: root,
              suiteRoot,
              files: [file],
              workspaceInputMode: 'sealed-generation',
              onSuitePassed: value => { passed.push(value); }
            });
          } catch (error) {
            observedFailure = error;
          }
          expect(observedFailure).toMatchObject({ code: 'VERIFY-BUILD-007' });
          expect(passed).toEqual([]);
          const failure = (observedFailure as { details?: { failure?: unknown } }).details?.failure;
          expect(typeof failure).toBe('string');
          const prefix = 'sandbox-observations:';
          expect((failure as string).startsWith(prefix)).toBe(true);
          const observations = JSON.parse((failure as string).slice(prefix.length)) as {
            sourceModeBefore: number | null;
            sourceModeAfter: number | null;
            sourceModeWritable: boolean | null;
            syncWriteDenied: boolean;
            asyncWriteDenied: boolean | null;
            outsideReadDenied: boolean | null;
            sourceUnchanged: boolean;
          };
          expect(observations.sourceModeBefore).toBe(process.platform === 'linux' ? 0o600 : null);
          expect(observations.sourceModeAfter).toBe(process.platform === 'linux' ? 0o600 : null);
          expect(observations.sourceModeWritable).toBe(process.platform === 'linux' ? true : null);
          expect(observations.syncWriteDenied).toBe(true);
          expect(observations.asyncWriteDenied).toBe(process.platform === 'linux' ? true : null);
          expect(observations.outsideReadDenied).toBe(process.platform === 'linux' ? true : null);
          expect(observations.sourceUnchanged).toBe(true);
        }
      );
    }, () => rm(outsideRoot, { recursive: true, force: true }));
  }
);