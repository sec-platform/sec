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
const { formatOutputFiles } = await import('../../src/adapters/compilation/compose/format-output-files.ts');
async function fixture(format: Format, run: (root: string) => Promise<void>, resolve?: Resolve) {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-formatter-lifecycle-')); mkdirSync(path.join(root, 'src'));
  const beforeFormat = formatter.format;
  const beforeResolve = formatter.resolveConfig;
  formatter.format = format;
  formatter.resolveConfig = resolve ?? (async () => ({}));
  try { await run(root); } finally {
    formatter.format = beforeFormat; formatter.resolveConfig = beforeResolve;
    rmSync(root, { recursive: true, force: true });
  }
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }

test('cancellation during format joins the provider and never publishes its late result', async () => {
  const gate = deferred(), started = deferred(), controller = new AbortController(); const reason = new Error('cancel');
  await fixture(async () => { started.resolve(); await gate.promise; return 'formatted'; }, async root => {
    writeFileSync(path.join(root, 'src/a.ts'), 'original');
    const pending = formatOutputFiles(root, ['src/a.ts'], undefined, controller.signal);
    const rejected = assert.rejects(pending, error => error === reason);
    await started.promise; controller.abort(reason); gate.resolve(); await rejected;
    assert.equal(readFileSync(path.join(root, 'src/a.ts'), 'utf8'), 'original');
  });
});

test('all target paths are admitted before formatter configuration or effects', async () => {
  await fixture(async () => assert.fail('format called'), async root => {
    writeFileSync(path.join(root, 'src/a.ts'), 'original');
    await assert.rejects(formatOutputFiles(root, ['src/a.ts', '../escape.ts']));
    assert.equal(readFileSync(path.join(root, 'src/a.ts'), 'utf8'), 'original');
  }, async () => assert.fail('configuration loaded before admission'));
});

test('duplicate paths format once and unchanged text never asks for a write grant', async () => {
  let calls = 0;
  await fixture(async source => { calls++; return source; }, async root => {
    writeFileSync(path.join(root, 'src/a.ts'), 'same');
    await formatOutputFiles(root, ['src/a.ts', 'src/a.ts'], async () => assert.fail('unchanged file written'));
    assert.equal(calls, 1);
  });
});

test('config loading cannot replace the selected formatter implementation', async () => {
  await fixture(async () => 'selected', async root => {
    writeFileSync(path.join(root, 'src/a.ts'), 'original'); await formatOutputFiles(root, ['src/a.ts']);
    assert.equal(readFileSync(path.join(root, 'src/a.ts'), 'utf8'), 'selected');
  }, async () => { formatter.format = async () => assert.fail('replacement formatter'); return {}; });
});

test('relative workspace remains fixed across asynchronous config lookup', async () => {
  const cwd = process.cwd();
  await fixture(async () => 'formatted', async root => {
    writeFileSync(path.join(root, 'src/a.ts'), 'original');
    try { process.chdir(root); await formatOutputFiles('.', ['src/a.ts']); assert.equal(readFileSync(path.join(root, 'src/a.ts'), 'utf8'), 'formatted'); }
    finally { process.chdir(cwd); }
  }, async () => { process.chdir(tmpdir()); return {}; });
});

test('invalid formatter output fails before requesting a publication grant', async () => {
  await fixture((async () => undefined) as unknown as Format, async root => {
    writeFileSync(path.join(root, 'src/a.ts'), 'original');
    await assert.rejects(formatOutputFiles(root, ['src/a.ts'], async () => assert.fail('invalid output published')), /did not return text/);
    assert.equal(readFileSync(path.join(root, 'src/a.ts'), 'utf8'), 'original');
  });
});
