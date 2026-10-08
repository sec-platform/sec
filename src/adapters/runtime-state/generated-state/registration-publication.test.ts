import { afterEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generatedStateProducerHooks } from '../../../../tests/helpers/generated-state-fixture.ts';
import { createGeneratedStateRegistrationMutationBackend, openRuntimeStore,
  readRegistrationLedgerObservation, registrationKey } from './registration-store.ts';

const roots: string[] = [];
const relativePath = '.tmp/dependency-installs/c.staging-publication-recovery';
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const host = await mkdtemp(path.join(os.tmpdir(), 'sec-registration-publication-'));
  roots.push(host);
  const repositoryRoot = path.join(host, 'repository');
  const generated = path.join(repositoryRoot, ...relativePath.split('/'));
  await mkdir(generated, { recursive: true });
  await writeFile(path.join(generated, 'sentinel'), 'original physical generation');
  const options = { environment: { ...process.env, SEC_STATE_HOME: path.join(host, 'state'), SEC_CACHE_HOME: path.join(host, 'cache') } };
  const store = await openRuntimeStore(repositoryRoot, options);
  const producer = generatedStateProducerHooks({ repositoryRoot }, options);
  return { repositoryRoot, generated, options, store, producer };
}
async function registrationBytes(root: string) {
  const names = (await readdir(root)).sort();
  return Promise.all(names.map(async name => [name, await readFile(path.join(root, name), 'utf8')]));
}

test('current birth and retirement publish exact self-contained immutable ledger records', async () => {
  const value = await fixture();
  await value.producer.born(relativePath, 'native-publication-fixture');
  const original = await value.producer.bind(relativePath);
  const born = readRegistrationLedgerObservation(value.store, relativePath);
  expect(born.registration?.registrationDigest).toBe(original.registrationDigest);
  expect(born.tip).toMatchObject({ sequence: 1, event: 'registered', previousRecordDigest: null });
  expect(JSON.parse(born.tip!.registrationBytes)).toEqual(original);
  const retired = await value.producer.retired(relativePath, 'owner-completed');
  if (retired === undefined) throw new Error('Owner retirement returned no registration.');
  const terminal = readRegistrationLedgerObservation(value.store, relativePath);
  expect(terminal.registration?.registrationDigest).toBe(retired.registrationDigest);
  expect(terminal.tip).toMatchObject({ sequence: 2, event: 'registered', previousRecordDigest: born.tip!.recordDigest });
  expect(JSON.parse(terminal.tip!.registrationBytes)).toEqual(retired);
  const before = await registrationBytes(value.store.registrationsRoot);
  const repeated = await value.producer.retired(relativePath, 'owner-completed');
  expect(repeated?.registrationDigest).toBe(retired.registrationDigest);
  expect(await registrationBytes(value.store.registrationsRoot)).toEqual(before);
  expect(before).toHaveLength(2);
  expect(before.every(([name]) => name!.startsWith('registration-ledger-'))).toBe(true);
  expect(await readFile(path.join(value.generated, 'sentinel'), 'utf8')).toBe('original physical generation');
});

test('caller-shaped publication authority cannot publish through a live native resource', async () => {
  const value = await fixture();
  const backend = createGeneratedStateRegistrationMutationBackend();
  const resource = await backend.acquireMutation({ workspaceRoot: value.repositoryRoot, ...value.options });
  const before = await registrationBytes(value.store.registrationsRoot);
  try {
    for (const candidate of [{}, { kind: 'generated-state-publication-authority' }]) {
      expect(() => backend.publishRegistration(resource, candidate as never)).toThrow();
      expect(await registrationBytes(value.store.registrationsRoot)).toEqual(before);
    }
  } finally { await backend.settleMutation(resource); }
  expect(() => backend.publishRegistration(resource, { kind: 'generated-state-publication-authority' })).toThrow(/foreign or settled/);
  expect(await registrationBytes(value.store.registrationsRoot)).toEqual(before);
  expect(await readFile(path.join(value.generated, 'sentinel'), 'utf8')).toBe('original physical generation');
});

for (const residue of ['foreign-ledger', 'obsolete-pointer', 'orphan-generation'] as const) {
  test(`current publication preserves ${residue} instead of inventing migration authority`, async () => {
    const value = await fixture();
    const name = residue === 'foreign-ledger' ? `registration-ledger-${'a'.repeat(64)}-${'b'.repeat(64)}.json`
      : residue === 'obsolete-pointer' ? `${registrationKey(relativePath)}.json`
      : `registration-${'c'.repeat(64)}.json`;
    const bytes = '{"foreign":"unowned publication evidence"}\n';
    await writeFile(path.join(value.store.registrationsRoot, name), bytes);
    const before = await registrationBytes(value.store.registrationsRoot);
    await expect(value.producer.born(relativePath, 'must-not-adopt')).rejects.toThrow();
    expect(await registrationBytes(value.store.registrationsRoot)).toEqual(before);
    expect(await readFile(path.join(value.generated, 'sentinel'), 'utf8')).toBe('original physical generation');
  });
}

test('copied valid ledger bytes cannot confer a different physical workspace owner', async () => {
  const source = await fixture();
  await source.producer.born(relativePath, 'source-owner');
  const target = await fixture();
  for (const [name, bytes] of await registrationBytes(source.store.registrationsRoot)) {
    await writeFile(path.join(target.store.registrationsRoot, name!), bytes!);
  }
  const before = await registrationBytes(target.store.registrationsRoot);
  await expect(target.producer.born(relativePath, 'target-owner')).rejects.toThrow();
  expect(await registrationBytes(target.store.registrationsRoot)).toEqual(before);
  expect(await readFile(path.join(target.generated, 'sentinel'), 'utf8')).toBe('original physical generation');
});
