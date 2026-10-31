import { settleWorkspaceCallback } from '../../testkit/workspace-cleanup.ts';
import { mock, test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
type Format = typeof import('prettier').format;
type Resolve = typeof import('prettier').resolveConfig;
const formatter = {
  format: (async () => { throw new Error('Formatter fixture not selected'); }) as Format,
  resolveConfig: (async () => ({})) as Resolve
};
mock.module('prettier', () => ({ default: formatter }));
const { formatOutputFiles } = await import('../../../src/adapters/compilation/compose/format-output-files.ts');
async function fixture(format: Format, run: (root: string) => Promise<void>, resolve?: Resolve) {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-formatter-lifecycle-'));
  const beforeFormat = formatter.format;
  const beforeResolve = formatter.resolveConfig;
  await settleWorkspaceCallback(async () => {
    mkdirSync(path.join(root, 'src'));
    formatter.format = format;
    formatter.resolveConfig = resolve ?? (async () => ({}));
    await run(root);
  }, async () => {
    formatter.format = beforeFormat; formatter.resolveConfig = beforeResolve;
    rmSync(root, { recursive: true, force: true });
  });
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }

test('cancellation during format joins the provider and never publishes its late result', async () => {
  const gate = deferred(), started = deferred(), controller = new AbortController(); const reason = new Error('cancel');
  await fixture(async () => { started.resolve(); await gate.promise; return 'formatted'; }, async root => {
    writeFileSync(path.join(root, 'src/a.ts'), 'original');
    let settled = false;
    const pending = formatOutputFiles(root, ['src/a.ts'], undefined, controller.signal)
      .finally(() => { settled = true; });
    const rejected = assert.rejects(pending, error => error === reason);
    // Keep an unexpected early completion handled until the mandatory join below.
    void rejected.catch(() => {});
    try {
      await started.promise;
      controller.abort(reason);
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(settled, false);
    } finally {
      gate.resolve();
      await rejected;
    }
    assert.equal(readFileSync(path.join(root, 'src/a.ts'), 'utf8'), 'original');
  });
});

test('formatter admits every target before effects, rejects invalid output and deduplicates unchanged files', async () => {
  const effects: string[] = [];
  await fixture((async () => { effects.push('format'); return undefined; }) as unknown as Format, async root => {
    const target = path.join(root, 'src/a.ts');
    writeFileSync(target, 'original');
    await assert.rejects(formatOutputFiles(root, ['src/a.ts', '../escape.ts']));
    assert.deepEqual(effects, []);
    assert.equal(readFileSync(target, 'utf8'), 'original');

    await assert.rejects(formatOutputFiles(root, ['src/a.ts'], async () => assert.fail('invalid output published')), /did not return text/);
    assert.equal(readFileSync(target, 'utf8'), 'original');

    // Each invocation captures its own formatter and target bytes; a rejected
    // result must not become a cached success for the following no-op.
    let calls = 0;
    formatter.format = async source => { calls++; return source; };
    formatter.resolveConfig = async () => ({});
    writeFileSync(target, 'same');
    await formatOutputFiles(root, ['src/a.ts', 'src/a.ts'], async () => assert.fail('unchanged file written'));
    assert.equal(calls, 1);
  }, async () => { effects.push('config'); return {}; });
});

test('relative workspace and selected formatter remain fixed across asynchronous config lookup', async () => {
  const cwd = process.cwd();
  let calls = 0;
  await fixture(async () => { calls++; return 'selected'; }, async root => {
    writeFileSync(path.join(root, 'src/a.ts'), 'original');
    try {
      process.chdir(root);
      await formatOutputFiles('.', ['src/a.ts']);
      assert.equal(calls, 1);
      assert.equal(readFileSync(path.join(root, 'src/a.ts'), 'utf8'), 'selected');
    }
    finally { process.chdir(cwd); }
  }, async () => {
    formatter.format = async () => assert.fail('replacement formatter');
    process.chdir(tmpdir());
    return {};
  });
});
