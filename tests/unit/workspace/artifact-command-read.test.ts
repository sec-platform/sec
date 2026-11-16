import { settleWorkspaceCallback } from '../../testkit/workspace-cleanup.ts';
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readRequiredJson } from '../../../src/adapters/workspace/required-artifact-read.ts';
import { executeArtifactCommandInput } from '../../../src/entry/cli/artifact-command-execution.ts';

async function fixture(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-artifact-read-'));
  await settleWorkspaceCallback(() => run(root), () => rm(root, { recursive: true, force: true }));
}

test('required JSON reads preserve values and distinguish absent, malformed and native path failures', async () => {
  await fixture(async root => {
    const file = path.join(root, 'value.json');
    for (const value of [null, false, 0, '', [], { value: 7 }]) {
      await writeFile(file, JSON.stringify(value));
      assert.deepEqual(await readRequiredJson(file, 'missing fixture'), value);
    }

    await assert.rejects(readRequiredJson(path.join(root, 'missing.json'), 'selected missing message'),
      (error: unknown) => error instanceof Error && error.message === 'selected missing message'
        && (error.cause as {code?: string})?.code === 'ENOENT');

    const malformed = path.join(root, 'malformed.json');
    await writeFile(malformed, '{');
    await assert.rejects(readRequiredJson(malformed, 'must not replace parse error'), SyntaxError);

    const ordinary = path.join(root, 'ordinary');
    await writeFile(ordinary, '{}');
    const child = path.join(ordinary, 'child.json');
    let nativeCode: string | undefined;
    try { await readFile(child); assert.fail('ordinary file cannot contain a child'); }
    catch (error) { nativeCode = (error as NodeJS.ErrnoException).code; }
    assert.ok(nativeCode);
    await assert.rejects(readRequiredJson(child, 'missing fixture'), (error: unknown) => {
      if (!(error instanceof Error)) return false;
      return nativeCode === 'ENOENT'
        ? error.message === 'missing fixture' && (error.cause as NodeJS.ErrnoException)?.code === nativeCode
        : error.message !== 'missing fixture' && (error as NodeJS.ErrnoException).code === nativeCode;
    });
  });
});

test('read failure emits no success frame', async () => {
  let writes = 0; const log = console.log; console.log = () => { writes++; };
  try {
    const failure = new Error('missing fixture');
    await assert.rejects(executeArtifactCommandInput(
      { kind: 'manifest', output: { json: true, compact: true } },
      {
        readManifest: async () => { throw failure; },
        observeManifest: async () => assert.fail('observe on manifest read'),
        generate: async () => assert.fail('generate on manifest read')
      }
    ), (error: unknown) => error === failure);
    assert.equal(writes, 0);
  } finally { console.log = log; }
});
