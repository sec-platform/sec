import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { printRequiredJson } from '../../src/bootstrap/cli/artifact-command-read.ts';
import { readRequiredJson } from '../../src/adapters/workspace/required-artifact-read.ts';

async function fixture(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-artifact-read-'));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}

for (const value of [null, false, 0, '', [], { value: 7 }]) {
  test(`required JSON reads valid ${JSON.stringify(value)} without truthiness-based absence`, async () => {
    await fixture(async root => {
      const file = path.join(root, 'value.json'); await writeFile(file, JSON.stringify(value));
      assert.deepEqual(await readRequiredJson(file, 'missing fixture'), value);
    });
  });
}

test('only an actual absent file is translated to the selected missing diagnostic', async () => {
  await fixture(async root => {
    await assert.rejects(readRequiredJson(path.join(root, 'missing.json'), 'selected missing message'),
      (error: unknown) => error instanceof Error && error.message === 'selected missing message'
        && (error.cause as {code?: string})?.code === 'ENOENT');
  });
});

test('malformed JSON remains its original parse failure, not a missing-file error', async () => {
  await fixture(async root => {
    const file = path.join(root, 'malformed.json'); await writeFile(file, '{');
    await assert.rejects(readRequiredJson(file, 'must not replace parse error'), SyntaxError);
  });
});

test('native path errors retain their platform code and only ENOENT is translated', async () => {
  await fixture(async root => {
    const file = path.join(root, 'ordinary'); await writeFile(file, '{}');
    const child = path.join(file, 'child.json');
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
  await fixture(async root => {
    let writes = 0; const log = console.log; console.log = () => { writes++; };
    try {
      await assert.rejects(printRequiredJson(path.join(root, 'missing.json'), 'missing fixture',
        { json: true, compact: true }, () => assert.fail('format on missing value')));
      assert.equal(writes, 0);
    } finally { console.log = log; }
  });
});
