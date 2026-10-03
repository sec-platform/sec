import { afterEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ensureGeneratedStateRegistrationLedger, generatedStateProducerHooks, inspectGeneratedState } from '../../../../tests/helpers/generated-state-fixture.ts';
import {
  createGeneratedStateRegistration,
  generatedStateDigest,
  generatedStateRuleForPath,
  retireGeneratedStateRegistration
} from '../../../execution/generated-state/contract.ts';
import { inspectNoFollowDirectoryChain } from '../physical/runtime/physical-no-follow.ts';
import { resolveSecWorkspaceRuntimeRoots } from '../workspace-state/paths.ts';

import { withMigratedGeneratedStateMutation } from '../../../application/generated-state/registration.ts';
import { issueGeneratedStatePublication } from '../../../execution/generated-state/registration-session.ts';
import { createGeneratedStateRegistrationMutationBackend } from './registration-store.ts';

const roots: string[] = [];
const relativePath = '.tmp/dependency-installs/c.staging-registration-migration';

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { force: true, recursive: true });
});

function canonicalBytes(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function legacyFixture() {
  const hostRoot = await mkdtemp(path.join(os.tmpdir(), 'sec-generated-registration-migration-'));
  roots.push(hostRoot);
  const repositoryRoot = path.join(hostRoot, 'repository');
  const stateRoot = path.join(hostRoot, 'state');
  const cacheRoot = path.join(hostRoot, 'cache');
  const generatedRoot = path.join(repositoryRoot, ...relativePath.split('/'));
  await mkdir(generatedRoot, { recursive: true });
  await writeFile(path.join(generatedRoot, 'payload.bin'), 'current-generation');
  const environment = { ...process.env, SEC_STATE_HOME: stateRoot, SEC_CACHE_HOME: cacheRoot };
  const runtimeRoots = resolveSecWorkspaceRuntimeRoots({ repositoryRoot, environment });
  const registrationsRoot = path.join(
    runtimeRoots.workspaceStateRoot,
    'generated-state',
    'v1',
    'registrations'
  );
  const registrationsV2Root = path.join(
    runtimeRoots.workspaceStateRoot,
    'generated-state',
    'v1',
    'registrations-v3'
  );
  await mkdir(registrationsRoot, { recursive: true });
  const workspace = inspectNoFollowDirectoryChain(repositoryRoot, 'fixture workspace').target;
  const generated = inspectNoFollowDirectoryChain(generatedRoot, 'fixture generation').target;
  const rule = generatedStateRuleForPath(relativePath);
  if (rule === null) throw new Error('Fixture generated-state rule is unavailable.');
  const identity = (value: typeof workspace) => Object.freeze({
    device: value.device,
    inode: value.inode,
    objectId: value.objectId
  });
  const current = createGeneratedStateRegistration({
    repositoryRoot,
    workspace: identity(workspace),
    rule,
    relativePath,
    root: identity(generated),
    operationId: 'registration-migration-current'
  }, { clock: () => new Date('2026-08-29T00:01:00.000Z') });
  const historical = createGeneratedStateRegistration({
    repositoryRoot,
    workspace: identity(workspace),
    rule,
    relativePath,
    root: identity(generated),
    operationId: 'registration-migration-historical'
  }, { clock: () => new Date('2026-08-29T00:00:00.000Z') });
  const currentBytes = canonicalBytes(current);
  const historicalBytes = canonicalBytes(historical);
  await writeFile(
    path.join(registrationsRoot, `registration-${current.registrationDigest.slice('sha256:'.length)}.json`),
    currentBytes
  );
  await writeFile(
    path.join(registrationsRoot, `registration-${historical.registrationDigest.slice('sha256:'.length)}.json`),
    historicalBytes
  );
  const pointerKey = generatedStateDigest(Object.freeze({
    schema: 'sec-generated-state-registration-key-v1',
    relativePath
  })).slice('sha256:'.length);
  await writeFile(path.join(registrationsRoot, `${pointerKey}.json`), currentBytes);
  return {
    environment,
    repositoryRoot,
    registrationsRoot,
    registrationsV2Root,
    current,
    historical
  } as const;
}

test('legacy registrations migrate once without inventing a historical ledger chain', async () => {
  const fixture = await legacyFixture();
  const beforeNames = await readdir(fixture.registrationsRoot);
  const beforeBytes = await Promise.all(beforeNames.sort().map(async (name) => [
    name,
    await readFile(path.join(fixture.registrationsRoot, name), 'utf8')
  ] as const));

  const hooks = generatedStateProducerHooks(
    { repositoryRoot: fixture.repositoryRoot },
    { environment: fixture.environment }
  );
  await hooks.bind(relativePath);

  const afterNames = await readdir(fixture.registrationsRoot);
  const afterBytes = await Promise.all(afterNames.sort().map(async (name) => [
    name,
    await readFile(path.join(fixture.registrationsRoot, name), 'utf8')
  ] as const));
  expect(afterBytes).toEqual(beforeBytes);
  const targetNames = await readdir(fixture.registrationsV2Root);
  expect(targetNames.filter((name) => name.startsWith('registration-migration-')).length).toBe(2);
  expect(targetNames.filter((name) => name.startsWith('registration-ledger-')).length).toBe(1);
  expect(targetNames.filter(name => /^registration-[0-9a-f]{64}\.json$/u.test(name))).toEqual([]);
  expect(targetNames.filter(name => /^[0-9a-f]{64}\.json$/u.test(name))).toEqual([]);
  expect((await inspectGeneratedState({
    repositoryRoot: fixture.repositoryRoot,
    relativePaths: [relativePath]
  }, { environment: fixture.environment })).entries[0]).toMatchObject({
    registrationState: 'active',
    registrationDigest: fixture.current.registrationDigest
  });

  const resumed = generatedStateProducerHooks(
    { repositoryRoot: fixture.repositoryRoot },
    { environment: fixture.environment }
  );
  await resumed.bind(relativePath);
  const retired = await resumed.retired(relativePath, 'migration-test-retired');
  expect(retired?.phase).toBe('retired');
  expect((await readdir(fixture.registrationsV2Root))
    .filter((name) => name.startsWith('registration-ledger-')).length).toBe(2);
});

test('unknown legacy residue blocks before publishing migration authority', async () => {
  const fixture = await legacyFixture();
  await writeFile(path.join(fixture.registrationsRoot, 'foreign.txt'), 'foreign');

  const hooks = generatedStateProducerHooks(
    { repositoryRoot: fixture.repositoryRoot },
    { environment: fixture.environment }
  );
  await expect(hooks.bind(relativePath)).rejects.toThrow('unknown residue');

  // Invalid source is rejected by the same strict read-only census before
  // mutation admission, so no target namespace or authority is materialized.
  await expect(readdir(fixture.registrationsV2Root)).rejects.toMatchObject({ code: 'ENOENT' });
});

test('a completed migration re-censuses the target before allowing another mutation', async () => {
  const fixture = await legacyFixture();
  const hooks = generatedStateProducerHooks(
    { repositoryRoot: fixture.repositoryRoot },
    { environment: fixture.environment }
  );
  await hooks.bind(relativePath);
  await writeFile(path.join(fixture.registrationsV2Root, 'foreign-target-residue.txt'), 'foreign');

  const resumed = generatedStateProducerHooks(
    { repositoryRoot: fixture.repositoryRoot },
    { environment: fixture.environment }
  );
  await expect(resumed.bind(relativePath)).rejects.toThrow('unknown residue');
});


test('current chain preserves migration source and rejects any pointer or generation writer', async () => {
  const fixture = await legacyFixture();
  const legacyNames = (await readdir(fixture.registrationsRoot)).sort();
  const legacyBytes = await Promise.all(legacyNames.map(name => readFile(path.join(fixture.registrationsRoot, name))));
  await ensureGeneratedStateRegistrationLedger({ repositoryRoot: fixture.repositoryRoot }, { environment: fixture.environment });
  const backend = createGeneratedStateRegistrationMutationBackend();
  await withMigratedGeneratedStateMutation({ workspaceRoot: fixture.repositoryRoot, environment: fixture.environment, backend, use: async (_, resource) => {
    expect(backend.readRegistrationCensus(resource).observations.get(relativePath)?.registration?.registrationDigest).toBe(fixture.current.registrationDigest);
  } });
  expect((await readdir(fixture.registrationsRoot)).sort()).toEqual(legacyNames);
  for (let index = 0; index < legacyNames.length; index += 1) {
    expect(await readFile(path.join(fixture.registrationsRoot, legacyNames[index]!))).toEqual(legacyBytes[index]);
  }
  const foreign = path.join(fixture.registrationsV2Root, `${'f'.repeat(64)}.json`);
  await writeFile(foreign, '{}');
  await expect(ensureGeneratedStateRegistrationLedger({ repositoryRoot: fixture.repositoryRoot }, { environment: fixture.environment }))
    .rejects.toThrow('forbidden pointer');
  expect(await readFile(foreign, 'utf8')).toBe('{}');
});

/** Independent old-format fixture. No production writer is used to create v2 bytes. */
async function rawV2Fixture(kind: 'current' | 'one-hop' | 'disposed' | 'gap' | 'foreign' | 'fork' | 'missing-predecessor') {
  const fixture = await legacyFixture();
  await rm(fixture.registrationsRoot, { recursive: true });
  const source = path.join(path.dirname(fixture.registrationsRoot), 'registrations-v2');
  await mkdir(source);
  const pointerKey = generatedStateDigest({ schema: 'sec-generated-state-registration-key-v1', relativePath }).slice(7);
  const retired = retireGeneratedStateRegistration(fixture.current, generatedStateDigest('raw-retirement'), {
    clock: () => new Date('2026-08-29T00:02:00.000Z')
  });
  const foreign = retireGeneratedStateRegistration(fixture.historical, generatedStateDigest('raw-foreign-retirement'), {
    clock: () => new Date('2026-08-29T00:02:00.000Z')
  });
  const registrations = kind === 'current' ? [fixture.current] :
    kind === 'gap' ? [fixture.current, retired, foreign] :
    kind === 'foreign' ? [fixture.current, foreign] :
    kind === 'fork' ? [fixture.current, retired, foreign] : [fixture.current, retired];
  const records: Array<Record<string, unknown> & { recordDigest: `sha256:${string}` }> = [];
  for (const registration of registrations) {
    const previous = kind === 'fork' && records.length === 2 ? records[0] : records.at(-1);
    const material = {
      schema: 'sec-generated-state-registration-ledger-v2',
      previousRecordDigest: kind === 'missing-predecessor' && records.length === 1
        ? generatedStateDigest('missing-predecessor') : previous?.recordDigest ?? null,
      sequence: previous === undefined ? 1 : Number(previous.sequence) + 1,
      relativePath, registrationDigest: registration.registrationDigest,
      registrationBytes: Buffer.from(canonicalBytes(registration)).toString('base64')
    };
    const record = { ...material, recordDigest: generatedStateDigest(material) };
    records.push(record);
    await writeFile(path.join(source, `registration-${registration.registrationDigest.slice(7)}.json`), canonicalBytes(registration));
    await writeFile(path.join(source, `registration-ledger-${pointerKey}-${record.recordDigest.slice(7)}.json`), canonicalBytes(record));
  }
  if (kind !== 'disposed') {
    await writeFile(path.join(source, `${pointerKey}.json`), canonicalBytes({
      schema: 'sec-generated-state-registration-pointer-v2',
      registrationDigest: fixture.current.registrationDigest, ledgerRecordDigest: records[0]!.recordDigest
    }));
  }
  const sourceNames = (await readdir(source)).sort();
  const sourceBytes = await Promise.all(sourceNames.map(name => readFile(path.join(source, name))));
  return { ...fixture, source, sourceNames, sourceBytes, retired };
}

for (const kind of ['current', 'one-hop', 'disposed'] as const) {
  test(`raw unguarded v2 ${kind} migrates without rewriting its source`, async () => {
    const fixture = await rawV2Fixture(kind);
    await ensureGeneratedStateRegistrationLedger({ repositoryRoot: fixture.repositoryRoot }, { environment: fixture.environment });
    const backend = createGeneratedStateRegistrationMutationBackend();
    await withMigratedGeneratedStateMutation({ workspaceRoot: fixture.repositoryRoot, environment: fixture.environment, backend, use: async (_, resource) => {
      const observation = backend.readRegistrationCensus(resource).observations.get(relativePath)!;
      expect(observation.registration?.registrationDigest ?? observation.retiredPredecessor?.registrationDigest)
        .toBe(kind === 'current' ? fixture.current.registrationDigest : fixture.retired.registrationDigest);
      expect(observation.registration === null).toBe(kind === 'disposed');
      if (kind !== 'current') expect(observation.previousRegistration?.registrationDigest).toBe(fixture.current.registrationDigest);
    } });
    expect((await readdir(fixture.source)).sort()).toEqual(fixture.sourceNames);
    for (let index = 0; index < fixture.sourceNames.length; index += 1) {
      expect(await readFile(path.join(fixture.source, fixture.sourceNames[index]!))).toEqual(fixture.sourceBytes[index]);
    }
    const names = await readdir(fixture.registrationsV2Root);
    expect(names.some(name => /^[0-9a-f]{64}\.json$/u.test(name) || /^registration-[0-9a-f]{64}\.json$/u.test(name))).toBe(false);
    if (kind === 'disposed') {
      // Old disposal does not certify that the old physical object is absent now.
      const hooks = generatedStateProducerHooks({ repositoryRoot: fixture.repositoryRoot }, { environment: fixture.environment });
      await expect(hooks.born(relativePath, 'must-not-resign')).rejects.toThrow('disposed predecessor physical identity');
    }
  });
}

for (const kind of ['gap', 'foreign', 'fork', 'missing-predecessor'] as const) {
  test(`raw v2 ${kind} preserves all source bytes and refuses migration`, async () => {
    const fixture = await rawV2Fixture(kind);
    await expect(ensureGeneratedStateRegistrationLedger({ repositoryRoot: fixture.repositoryRoot }, { environment: fixture.environment }))
      .rejects.toThrow();
    for (let index = 0; index < fixture.sourceNames.length; index += 1) {
      expect(await readFile(path.join(fixture.source, fixture.sourceNames[index]!))).toEqual(fixture.sourceBytes[index]);
    }
    expect(await readdir(fixture.registrationsV2Root)).toEqual([]);
  });
}

test('prepared migration resumes every partial record publication and preserves source', async () => {
  const fixture = await rawV2Fixture('one-hop');
  await ensureGeneratedStateRegistrationLedger({ repositoryRoot: fixture.repositoryRoot }, { environment: fixture.environment });
  const names = (await readdir(fixture.registrationsV2Root)).sort();
  const records = names.filter(name => name.startsWith('registration-ledger-'));
  const complete = names.find(name => name.endsWith('-complete.json'))!;
  const originals = new Map(await Promise.all(names.map(async name => [name, await readFile(path.join(fixture.registrationsV2Root, name))] as const)));
  for (const keep of [0, 1, records.length]) {
    await rm(path.join(fixture.registrationsV2Root, complete));
    for (let index = keep; index < records.length; index += 1) await rm(path.join(fixture.registrationsV2Root, records[index]!));
    await ensureGeneratedStateRegistrationLedger({ repositoryRoot: fixture.repositoryRoot }, { environment: fixture.environment });
    for (const [name, bytes] of originals) expect(await readFile(path.join(fixture.registrationsV2Root, name))).toEqual(bytes);
  }
});

test('migration preserves a foreign physical replacement before publishing an intent', async () => {
  const fixture = await rawV2Fixture('one-hop');
  const generated = path.join(fixture.repositoryRoot, ...relativePath.split('/'));
  await rename(generated, `${generated}-original`);
  await mkdir(generated);
  await writeFile(path.join(generated, 'foreign.txt'), 'preserve');
  await expect(ensureGeneratedStateRegistrationLedger({ repositoryRoot: fixture.repositoryRoot }, { environment: fixture.environment }))
    .rejects.toThrow('physical preimage is foreign');
  expect(await readFile(path.join(generated, 'foreign.txt'), 'utf8')).toBe('preserve');
  expect(await readdir(fixture.registrationsV2Root)).toEqual([]);
});

test('a first producer observation reads legal old retirement without publishing the new namespace', async () => {
  const fixture = await rawV2Fixture('one-hop');
  const hooks = generatedStateProducerHooks({ repositoryRoot: fixture.repositoryRoot }, { environment: fixture.environment });
  const observation = await hooks.observeRetirement(relativePath);
  expect(observation.status).toBe('retired-present');
  expect(observation.registrationDigest).toBe(fixture.retired.registrationDigest);
  expect((await hooks.inspect([relativePath])).entries[0]?.registrationState).toBe('retired');
  await expect(readdir(fixture.registrationsV2Root)).rejects.toMatchObject({ code: 'ENOENT' });
  for (let index = 0; index < fixture.sourceNames.length; index += 1) {
    expect(await readFile(path.join(fixture.source, fixture.sourceNames[index]!))).toEqual(fixture.sourceBytes[index]);
  }
  await ensureGeneratedStateRegistrationLedger({ repositoryRoot: fixture.repositoryRoot }, { environment: fixture.environment });
  expect((await hooks.observeRetirement(relativePath)).registrationDigest).toBe(observation.registrationDigest);
});

test('a first v1 producer observation remains read-only and retains the exact source registration', async () => {
  const fixture = await legacyFixture();
  const hooks = generatedStateProducerHooks({ repositoryRoot: fixture.repositoryRoot }, { environment: fixture.environment });
  expect(await hooks.observeRetirement(relativePath)).toMatchObject({
    status: 'active', registrationDigest: fixture.current.registrationDigest
  });
  expect((await hooks.inspect([relativePath])).entries[0]?.registrationState).toBe('active');
  await expect(readdir(fixture.registrationsV2Root)).rejects.toMatchObject({ code: 'ENOENT' });
});

test('an invalid existing v3 namespace never falls back to a valid old source', async () => {
  const fixture = await rawV2Fixture('one-hop');
  await mkdir(fixture.registrationsV2Root);
  await writeFile(path.join(fixture.registrationsV2Root, 'foreign.txt'), 'preserve');
  const hooks = generatedStateProducerHooks({ repositoryRoot: fixture.repositoryRoot }, { environment: fixture.environment });
  await expect(hooks.observeRetirement(relativePath)).rejects.toThrow('unknown residue');
  expect(await readFile(path.join(fixture.registrationsV2Root, 'foreign.txt'), 'utf8')).toBe('preserve');
});

test('a workspace state root without any registration namespace observes an empty ledger', async () => {
  const fixture = await rawV2Fixture('current');
  await rm(fixture.source, { recursive: true });
  const hooks = generatedStateProducerHooks({ repositoryRoot: fixture.repositoryRoot }, { environment: fixture.environment });
  expect(await hooks.observeRetirement(relativePath)).toMatchObject({ status: 'mismatch', registrationDigest: null });
  await expect(readdir(fixture.registrationsV2Root)).rejects.toMatchObject({ code: 'ENOENT' });
});

test('a retired registration cannot publish disposal while its physical source remains present', async () => {
  const fixture = await rawV2Fixture('one-hop');
  await ensureGeneratedStateRegistrationLedger({ repositoryRoot: fixture.repositoryRoot }, { environment: fixture.environment });
  const backend = createGeneratedStateRegistrationMutationBackend();
  await withMigratedGeneratedStateMutation({ workspaceRoot: fixture.repositoryRoot, environment: fixture.environment, backend, use: async (session, resource) => {
    const before = backend.readRegistrationCensus(resource).observations.get(relativePath)!;
    expect(() => issueGeneratedStatePublication(session, { kind: 'registration', registration: before.registration!,
      previousRecordDigest: before.tip!.recordDigest, event: 'disposed' })).toThrow('physical absence');
    expect(backend.readRegistrationCensus(resource).observations.get(relativePath)?.tip?.recordDigest).toBe(before.tip!.recordDigest);
  } });
});

test('completed migration retains historical physical preimage across a legitimate later absence', async () => {
  const fixture = await rawV2Fixture('one-hop');
  await ensureGeneratedStateRegistrationLedger({ repositoryRoot: fixture.repositoryRoot }, { environment: fixture.environment });
  await rm(path.join(fixture.repositoryRoot, ...relativePath.split('/')), { recursive: true });
  await expect(ensureGeneratedStateRegistrationLedger({ repositoryRoot: fixture.repositoryRoot }, { environment: fixture.environment })).resolves.toBeUndefined();
  // An unfinished migration must instead retain its original physical input.
  const names = await readdir(fixture.registrationsV2Root);
  await rm(path.join(fixture.registrationsV2Root, names.find(name => name.endsWith('-complete.json'))!));
  await expect(ensureGeneratedStateRegistrationLedger({ repositoryRoot: fixture.repositoryRoot }, { environment: fixture.environment }))
    .rejects.toThrow('does not bind the current legacy inventory');
});

test('one bounded migration settles 128 independent old chains without path-multiplied namespace work', async () => {
  const fixture = await legacyFixture();
  await rm(fixture.registrationsRoot, { recursive: true });
  const source = path.join(path.dirname(fixture.registrationsRoot), 'registrations-v2');
  await mkdir(source);
  const workspace = inspectNoFollowDirectoryChain(fixture.repositoryRoot, 'scale workspace').target;
  const expected = new Map<string, string>();
  for (let index = 0; index < 128; index += 1) {
    const relative = `.tmp/dependency-installs/c.staging-registration-scale-${index}`;
    const generated = path.join(fixture.repositoryRoot, ...relative.split('/'));
    await mkdir(generated);
    const root = inspectNoFollowDirectoryChain(generated, 'scale generation').target;
    const rule = generatedStateRuleForPath(relative)!;
    const active = createGeneratedStateRegistration({
      repositoryRoot: fixture.repositoryRoot, workspace: { device: workspace.device, inode: workspace.inode, objectId: workspace.objectId },
      rule, relativePath: relative, root: { device: root.device, inode: root.inode, objectId: root.objectId }, operationId: `scale-${index}`
    }, { clock: () => new Date('2026-08-29T00:00:00.000Z') });
    const retired = retireGeneratedStateRegistration(active, generatedStateDigest(`scale-retirement-${index}`), {
      clock: () => new Date('2026-08-29T00:01:00.000Z')
    });
    const key = generatedStateDigest({ schema: 'sec-generated-state-registration-key-v1', relativePath: relative }).slice(7);
    let previous: `sha256:${string}` | null = null;
    let first: `sha256:${string}` | null = null;
    let sequence = 0;
    for (const registration of [active, retired]) {
      const material = { schema: 'sec-generated-state-registration-ledger-v2', previousRecordDigest: previous,
        sequence: ++sequence, relativePath: relative, registrationDigest: registration.registrationDigest,
        registrationBytes: Buffer.from(canonicalBytes(registration)).toString('base64') };
      const record = { ...material, recordDigest: generatedStateDigest(material) };
      await writeFile(path.join(source, `registration-${registration.registrationDigest.slice(7)}.json`), canonicalBytes(registration));
      await writeFile(path.join(source, `registration-ledger-${key}-${record.recordDigest.slice(7)}.json`), canonicalBytes(record));
      previous = record.recordDigest;
      first ??= record.recordDigest;
    }
    await writeFile(path.join(source, `${key}.json`), canonicalBytes({ schema: 'sec-generated-state-registration-pointer-v2',
      registrationDigest: active.registrationDigest, ledgerRecordDigest: first }));
    expected.set(relative, retired.registrationDigest);
  }
  const started = performance.now();
  await ensureGeneratedStateRegistrationLedger({ repositoryRoot: fixture.repositoryRoot }, { environment: fixture.environment });
  const elapsed = performance.now() - started;
  expect(elapsed).toBeLessThan(30_000);
  const names = await readdir(fixture.registrationsV2Root);
  expect(names.length).toBe(258);
  const records = await Promise.all(names.filter(name => name.startsWith('registration-ledger-'))
    .map(async name => JSON.parse(await readFile(path.join(fixture.registrationsV2Root, name), 'utf8')) as {
      relativePath: string; sequence: number; registrationDigest: string; event: string
    }));
  for (const record of records.filter(record => record.sequence === 2)) {
    expect(record.registrationDigest).toBe(expected.get(record.relativePath));
    expect(record.event).toBe('registered');
    expected.delete(record.relativePath);
  }
  expect(expected.size).toBe(0);
}, 30_000);
