import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'bun:test';
import { generateRuntimeLibraryScaffold } from '../../src/compiler/compose/generate-runtime-library.ts';
import { TemplateEngine } from '../../src/compiler/compose/template-engine.ts';

const lock = () => ({ resolvedBlocks: [] } as never);
async function fixture(run: (root: string, target: string) => Promise<void>) {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-runtime-scaffold-'));
  const target = path.join(root, 'src/runtime/store.ts'); mkdirSync(path.dirname(target), { recursive: true });
  const render = TemplateEngine.render;
  TemplateEngine.render = () => 'generated';
  try { await run(root, target); } finally { TemplateEngine.render = render; rmSync(root, { recursive: true, force: true }); }
}

test('runtime scaffold refuses a modified existing target instead of overwriting it', async () => fixture(async (root, target) => {
  writeFileSync(target, 'old');
  await assert.rejects(generateRuntimeLibraryScaffold(root, lock(), async () => { writeFileSync(target, 'user'); }), /preimage changed/);
  assert.equal(readFileSync(target, 'utf8'), 'user');
}));

test('a concurrently created scaffold file with different bytes is not overwritten', async () => fixture(async (root, target) => {
  await assert.rejects(generateRuntimeLibraryScaffold(root, lock(), async () => { writeFileSync(target, 'user'); }));
  assert.equal(readFileSync(target, 'utf8'), 'user');
}));

test('unchanged scaffold content needs no write grant', async () => fixture(async (root, target) => {
  writeFileSync(target, 'generated');
  const paths = await generateRuntimeLibraryScaffold(root, lock(), async () => assert.fail('no-op write'));
  assert.ok(paths.includes('src/runtime/store.ts')); assert.equal(readFileSync(target, 'utf8'), 'generated');
}));

test('an aborted scaffold invocation cannot render or acquire write authority', async () => fixture(async root => {
  const controller = new AbortController(), reason = new Error('cancelled'); controller.abort(reason);
  TemplateEngine.render = () => assert.fail('cancelled render');
  await assert.rejects(generateRuntimeLibraryScaffold(root, lock(), async () => assert.fail('cancelled write'), controller.signal), error => error === reason);
}));

test('render callbacks cannot change the selected workspace of this invocation', async () => fixture(async (root, target) => {
  const cwd = process.cwd();
  try {
    process.chdir(root); TemplateEngine.render = () => { process.chdir(tmpdir()); return 'generated'; };
    await generateRuntimeLibraryScaffold('.', lock()); assert.equal(readFileSync(target, 'utf8'), 'generated');
  } finally { process.chdir(cwd); }
}));
