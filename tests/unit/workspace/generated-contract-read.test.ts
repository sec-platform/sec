import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readGeneratedContract } from '../../../src/adapters/workspace/generated-contract-read.ts';
import { saveLock } from '../../../src/adapters/workspace/lock.ts';
import { expectCliJson, expectCliSuccess } from '../../testkit/cli.ts';
import { projectPostgresContract } from '../../../src/application/postgres-contract.ts';
import { formatPostgresContract } from '../../../src/entry/cli/postgres-contract.ts';
import { semanticArtifactLock } from '../../testkit/semantic-lock.ts';
import { withTempWorkspace } from '../../testkit/workspace.ts';

const first = '.sec/artifacts/generated/first-contract.json';
const second = '.sec/artifacts/generated/second-contract.json';
const missing = 'selected contract is absent';
type Contract = { provider: string };
const matches = (value: Contract) => value.provider === 'postgres';

async function write(root: string, relative: string, text: string): Promise<void> {
  const target = path.join(root, relative);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, text);
}

async function declare(root: string, paths: string[]): Promise<void> {
  const lock = semanticArtifactLock(first);
  lock.generatedPaths = paths;
  await fs.mkdir(path.join(root, '.sec'), { recursive: true });
  await saveLock(root, lock);
}

test('selection follows lock membership, deduplicates paths and ignores undeclared matching files', async () => {
  await withTempWorkspace(async (root) => {
    await declare(root, [first, first, '.sec/artifacts/generated/missing-contract.json']);
    const contract = { provider: 'postgres', persistenceMode: 'database', tables: [
      { name: 'tickets', tenantScoped: true, columns: ['id', 'tenantId'] },
      { name: 'customers', tenantScoped: false, columns: ['id'] }
    ] };
    await write(root, first, JSON.stringify(contract));
    await write(root, second, JSON.stringify(contract));
    expect(await expectCliJson<typeof contract>(root, ['postgres', '--json'])).toEqual(contract);
    const { stdout: rendered } = await expectCliSuccess(root, ['postgres']);
    expect(rendered).toMatch(/(?:^|\s)postgres(?=\s|$)/u);
    expect(rendered).toMatch(/(?:^|\s)mode=database(?=;|\s|$)/u);
    expect(rendered).toMatch(/(?:^|\s)tables=2(?=;|\s|$)/u);
    expect(rendered).toMatch(/(?:^|\s)tenantScoped=1(?=;|\s|$)/u);
    expect(rendered).toMatch(/^Table list:\s*tickets\s*,\s*customers\s*$/mu);
    const empty = formatPostgresContract(projectPostgresContract({ ...contract, tables: [] }));
    for (const field of ['Postgres contract postgres', 'mode=database', 'tables=0', 'tenantScoped=0', 'Table list: none']) {
      expect(empty).toContain(field);
    }
  });
});

test('multiple matches are rejected rather than choosing the first declared artifact', async () => {
  await withTempWorkspace(async (root) => {
    await declare(root, [first, second]);
    for (const name of [first, second]) await write(root, name, '{"provider":"postgres"}');
    await expect(readGeneratedContract(root, missing, matches)).rejects.toThrow('selection is ambiguous');
  });
});

test('only absent lock or no matching candidate becomes the requested missing diagnostic', async () => {
  await withTempWorkspace(async (root) => {
    try { await readGeneratedContract(root, missing, matches); throw new Error('unexpected success'); }
    catch (error) {
      expect((error as Error).message).toBe(missing);
      expect(((error as Error).cause as NodeJS.ErrnoException).code).toBe('ENOENT');
    }
    await declare(root, [first]);
    await write(root, first, '{"provider":"sqlite"}');
    await expect(readGeneratedContract(root, missing, matches)).rejects.toThrow(missing);
  });
});

test('malformed JSON and null contract candidates retain their original parser or selector error', async () => {
  await withTempWorkspace(async (root) => {
    await declare(root, [first]);
    await write(root, first, '{');
    await expect(readGeneratedContract(root, missing, matches)).rejects.toBeInstanceOf(SyntaxError);
    await write(root, first, 'null');
    await expect(readGeneratedContract(root, missing, matches)).rejects.toBeInstanceOf(TypeError);
  });
});
