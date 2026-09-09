import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import prettier from 'prettier';
import { formatOutputFiles } from '../../src/compiler/compose/format-output-files.ts';

type Format = typeof prettier.format;
type Resolve = typeof prettier.resolveConfig;
async function fixture(format: Format, run: (root: string) => Promise<void>, resolve?: Resolve) {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-formatter-lifecycle-')); mkdirSync(path.join(root, 'src'));
  const beforeFormat = Object.getOwnPropertyDescriptor(prettier, 'format')!;
  const beforeResolve = Object.getOwnPropertyDescriptor(prettier, 'resolveConfig')!;
  Object.defineProperty(prettier, 'format', { ...beforeFormat, value: format });
  Object.defineProperty(prettier, 'resolveConfig', { ...beforeResolve, value: resolve ?? (async () => ({})) });
  try { await run(root); } finally {
    Object.defineProperty(prettier, 'format', beforeFormat); Object.defineProperty(prettier, 'resolveConfig', beforeResolve);
    rmSync(root, { recursive: true, force: true });
  }
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }

test('formatter refuses to overwrite a file changed while its provider was running', async () => {
  await fixture(async (_source, options) => { writeFileSync(options!.filepath!, 'user change'); return 'formatted'; }, async root => {
    const target = path.join(root, 'src/a.ts'); writeFileSync(target, 'original');
    await assert.rejects(formatOutputFiles(root, ['src/a.ts']), /preimage changed/);
    assert.equal(readFileSync(target, 'utf8'), 'user change');
  });
});

test('one formatter failure cannot return while another formatter is still active', async () => {
  const gate = deferred(), started = deferred(), primary = new Error('parse failure');
  await fixture(async source => { if (source === 'bad') { await started.promise; throw primary; } started.resolve(); await gate.promise; return 'formatted'; }, async root => {
    writeFileSync(path.join(root, 'src/a.ts'), 'bad'); writeFileSync(path.join(root, 'src/b.ts'), 'original');
    let done = false;
    const pending = formatOutputFiles(root, ['src/a.ts', 'src/b.ts']).then(() => assert.fail('unexpected success'), () => { done = true; });
    await started.promise; await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(done, false);
    gate.resolve(); await pending; assert.equal(done, true);
    assert.equal(readFileSync(path.join(root, 'src/b.ts'), 'utf8'), 'original');
  });
});

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
  }, async () => { Object.defineProperty(prettier, 'format', { value: async () => assert.fail('replacement formatter'), configurable: true }); return {}; });
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
