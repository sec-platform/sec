import { afterEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { inspectNoFollowDirectoryChain } from '../physical/runtime/physical-no-follow.ts';
import { createGeneratedStateRegistration, generatedStateRuleForPath, retireGeneratedStateRegistration } from './contract.ts';
import {
  canonicalBytes, createRegistrationPublicationInterruptionActorForTests, identityOf, inspectRegistrationPointer,
  openRuntimeStore, persistRegistration, readRegistrationLedgerObservation, registrationPath, withGeneratedStateMutationLease,
  type GeneratedStateRuntimeStore
} from './registration-store.ts';

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
  const registration = createGeneratedStateRegistration({ repositoryRoot,
    workspace: identityOf(inspectNoFollowDirectoryChain(repositoryRoot, 'fixture workspace').target),
    root: identityOf(inspectNoFollowDirectoryChain(generated, 'fixture generation').target),
    rule: generatedStateRuleForPath(relativePath)!, relativePath, operationId: 'registration-publication-fixture'
  });
  const store = await openRuntimeStore(repositoryRoot, options);
  return { repositoryRoot, generated, options, registration, store, journal: path.join(store.transactionsRoot, 'registration-publication.json') };
}

async function publish(value: Awaited<ReturnType<typeof fixture>>, registration = value.registration,
  point?: 'generation' | 'ledger' | 'pointer') {
  const options = point === undefined ? value.options : { ...value.options,
    registrationPublicationInterruption: createRegistrationPublicationInterruptionActorForTests(point,
      () => { throw new Error(`publication-cut:${point}`); }) };
  await withGeneratedStateMutationLease(value.repositoryRoot, options, async store => {
    const observation = readRegistrationLedgerObservation(store, relativePath);
    persistRegistration(store, registration, inspectRegistrationPointer(store, relativePath).snapshot,
      observation.tip?.recordDigest ?? null);
  });
}

async function registrationBytes(store: GeneratedStateRuntimeStore) {
  const names = (await readdir(store.registrationsRoot)).filter(name => !name.startsWith('.')).sort();
  return Promise.all(names.map(async name => [name, await readFile(path.join(store.registrationsRoot, name), 'utf8')]));
}

for (const phase of ['birth', 'retirement'] as const) {
  for (const point of ['generation', 'ledger', 'pointer'] as const) {
    test(`original owner resumes ${phase} after ${point} publication and retires its exact intent`, async () => {
      const value = await fixture();
      if (phase === 'retirement') await publish(value);
      const registration = phase === 'birth' ? value.registration
        : retireGeneratedStateRegistration(value.registration, `sha256:${'a'.repeat(64)}`);
      await expect(publish(value, registration, point)).rejects.toThrow(`publication-cut:${point}`);
      expect(JSON.parse(await readFile(value.journal, 'utf8')).publication.record.registrationDigest).toBe(registration.registrationDigest);
      await withGeneratedStateMutationLease(value.repositoryRoot, value.options, async store => {
        const observed = readRegistrationLedgerObservation(store, relativePath);
        expect(observed.registration?.registrationDigest).toBe(registration.registrationDigest);
        expect(observed.tip?.sequence).toBe(phase === 'birth' ? 1 : 2);
      });
      expect(JSON.parse(await readFile(value.journal, 'utf8')).publication).toBeNull();
      const before = await registrationBytes(value.store);
      await withGeneratedStateMutationLease(value.repositoryRoot, value.options, async () => undefined);
      expect(await registrationBytes(value.store)).toEqual(before);
      expect(await readFile(path.join(value.generated, 'sentinel'), 'utf8')).toBe('original physical generation');
    });
  }
}

for (const mutation of ['wrong-preimage', 'changed-generation', 'deleted-pointer'] as const) {
  test(`publication recovery preserves ${mutation} instead of adopting it`, async () => {
    const value = await fixture();
    await publish(value);
    const retired = retireGeneratedStateRegistration(value.registration, `sha256:${'b'.repeat(64)}`);
    await expect(publish(value, retired, 'generation')).rejects.toThrow('publication-cut:generation');
    if (mutation === 'wrong-preimage') {
      const pending = JSON.parse(await readFile(value.journal, 'utf8'));
      pending.publication.expectedPointer.identity.inode += '-foreign';
      await writeFile(value.journal, canonicalBytes(pending));
    } else if (mutation === 'changed-generation') {
      await writeFile(path.join(value.store.registrationsRoot, `registration-${retired.registrationDigest.slice(7)}.json`), 'foreign generation');
    } else await unlink(registrationPath(value.store, relativePath));
    const before = await registrationBytes(value.store);
    const pendingBefore = await readFile(value.journal, 'utf8');
    await expect(withGeneratedStateMutationLease(value.repositoryRoot, value.options, async () => undefined))
      .rejects.toThrow(mutation === 'changed-generation' ? 'immutable preimage differs' : 'pointer preimage changed');
    expect(await registrationBytes(value.store)).toEqual(before);
    expect(await readFile(value.journal, 'utf8')).toBe(pendingBefore);
    expect(await readFile(path.join(value.generated, 'sentinel'), 'utf8')).toBe('original physical generation');
  });
}

test('caller-shaped intent without original journal admission cannot recover an orphan', async () => {
  const source = await fixture();
  await expect(publish(source, source.registration, 'generation')).rejects.toThrow('publication-cut:generation');
  const target = await fixture();
  await writeFile(target.journal, await readFile(source.journal));
  const before = await registrationBytes(target.store);
  await expect(withGeneratedStateMutationLease(target.repositoryRoot, target.options, async () => undefined))
    .rejects.toThrow('no original guarded journal admission');
  expect(await registrationBytes(target.store)).toEqual(before);
});

test('historical unbound v2 generation remains blocked without a publication intent', async () => {
  const value = await fixture();
  await writeFile(path.join(value.store.registrationsRoot, `registration-${value.registration.registrationDigest.slice(7)}.json`), canonicalBytes(value.registration));
  const before = await registrationBytes(value.store);
  await expect(withGeneratedStateMutationLease(value.repositoryRoot, value.options,
    async store => readRegistrationLedgerObservation(store, relativePath))).rejects.toThrow('not bound to the immutable ledger');
  expect(await registrationBytes(value.store)).toEqual(before);
});

test('completed intent never recreates a subsequently deleted active pointer', async () => {
  const value = await fixture();
  await publish(value);
  await unlink(registrationPath(value.store, relativePath));
  const before = await registrationBytes(value.store);
  await expect(withGeneratedStateMutationLease(value.repositoryRoot, value.options,
    async store => readRegistrationLedgerObservation(store, relativePath))).rejects.toThrow('active registration pointer is absent');
  expect(await registrationBytes(value.store)).toEqual(before);
  expect(JSON.parse(await readFile(value.journal, 'utf8')).publication).toBeNull();
});

test('a dead parent effect owner remains blocked even with a valid prepared publication', async () => {
  const value = await fixture();
  const modulePath = new URL('./registration-store.ts', import.meta.url).href;
  const child = Bun.spawnSync([process.execPath, '--no-env-file', '--eval', `
    import * as owner from ${JSON.stringify(modulePath)};
    const registration = ${JSON.stringify(value.registration)};
    const options = { environment: ${JSON.stringify(value.options.environment)},
      registrationPublicationInterruption: owner.createRegistrationPublicationInterruptionActorForTests('generation', () => process.exit(73)) };
    await owner.withGeneratedStateMutationLease(${JSON.stringify(value.repositoryRoot)}, options, async store => {
      owner.persistRegistration(store, registration, owner.inspectRegistrationPointer(store, ${JSON.stringify(relativePath)}).snapshot, null);
    });
  `], { cwd: path.dirname(value.repositoryRoot), stdout: 'pipe', stderr: 'pipe', timeout: 5000 });
  expect(child.exitCode).toBe(73);
  const lease = path.join(path.dirname(value.store.registrationsRoot), '.generated-state-registration-mutation.lock');
  const leaseBefore = await readFile(lease, 'utf8');
  const intentBefore = await readFile(value.journal, 'utf8');
  const registrationBefore = await registrationBytes(value.store);
  await expect(withGeneratedStateMutationLease(value.repositoryRoot, value.options, async () => undefined))
    .rejects.toThrow('mutation lease is unavailable');
  expect(await readFile(lease, 'utf8')).toBe(leaseBefore);
  expect(await readFile(value.journal, 'utf8')).toBe(intentBefore);
  expect(await registrationBytes(value.store)).toEqual(registrationBefore);
});

test('interrupted retirement of a migrated v2 pointer recovers without changing legacy source bytes', async () => {
  const value = await fixture();
  await mkdir(value.store.legacyRegistrationsRoot, { recursive: true });
  const legacyBytes = canonicalBytes(value.registration);
  const generationName = `registration-${value.registration.registrationDigest.slice(7)}.json`;
  const pointerName = path.basename(registrationPath(value.store, relativePath));
  await writeFile(path.join(value.store.legacyRegistrationsRoot, generationName), legacyBytes);
  await writeFile(path.join(value.store.legacyRegistrationsRoot, pointerName), legacyBytes);
  const retired = retireGeneratedStateRegistration(value.registration, `sha256:${'c'.repeat(64)}`);
  await expect(publish(value, retired, 'ledger')).rejects.toThrow('publication-cut:ledger');
  await withGeneratedStateMutationLease(value.repositoryRoot, value.options, async store => {
    expect(readRegistrationLedgerObservation(store, relativePath).registration?.registrationDigest).toBe(retired.registrationDigest);
  });
  expect(await readFile(path.join(value.store.legacyRegistrationsRoot, generationName), 'utf8')).toBe(legacyBytes);
  expect(await readFile(path.join(value.store.legacyRegistrationsRoot, pointerName), 'utf8')).toBe(legacyBytes);
  expect(JSON.parse(await readFile(value.journal, 'utf8')).publication).toBeNull();
});

test('original producer retries only its exact retirement while observers remain read-only', async () => {
  const value = await fixture();
  await publish(value);
  const { generatedStateProducerHooks } = await import('./lifecycle.ts');
  const options = { ...value.options, registrationPublicationInterruption:
    createRegistrationPublicationInterruptionActorForTests('ledger', () => { throw new Error('retirement-publication-cut'); }) };
  const producer = generatedStateProducerHooks({ repositoryRoot: value.repositoryRoot }, options);
  await producer.bind(relativePath);
  await expect(producer.retired(relativePath, 'original-outcome')).rejects.toThrow('retirement-publication-cut');
  const pending = await readFile(value.journal, 'utf8');
  const bytes = await registrationBytes(value.store);
  await expect(producer.observeRetirement(relativePath)).rejects.toThrow('pointer does not bind');
  expect(await readFile(value.journal, 'utf8')).toBe(pending);
  expect(await registrationBytes(value.store)).toEqual(bytes);
  await expect(producer.retired(relativePath, 'foreign-outcome')).rejects.toThrow('different authority');
  const recovered = await producer.retired(relativePath, 'original-outcome');
  expect(recovered?.registrationDigest).toBe(JSON.parse(pending).publication.record.registrationDigest);
  expect((await producer.retired(relativePath, 'original-outcome'))?.registrationDigest).toBe(recovered?.registrationDigest);
  const stranger = generatedStateProducerHooks({ repositoryRoot: value.repositoryRoot }, value.options);
  await expect(stranger.retired(relativePath, 'original-outcome')).rejects.toThrow('same producer session');
});

test('disposal explicitly settles interrupted registration before its admission census', async () => {
  const value = await fixture();
  await publish(value);
  const { generatedStateProducerHooks } = await import('./lifecycle.ts');
  const options = { ...value.options, registrationPublicationInterruption:
    createRegistrationPublicationInterruptionActorForTests('generation', () => { throw new Error('disposal-publication-cut'); }) };
  const producer = generatedStateProducerHooks({ repositoryRoot: value.repositoryRoot }, options);
  await producer.bind(relativePath);
  await expect(producer.retired(relativePath, 'dispose-original')).rejects.toThrow('disposal-publication-cut');
  const receipt = await producer.disposed(relativePath, { outcome: 'dispose-original', profile: 'automatic' });
  expect(receipt.terminal).toBe('disposed');
  expect(JSON.parse(await readFile(value.journal, 'utf8')).publication).toBeNull();
  expect(readRegistrationLedgerObservation(value.store, relativePath).registration).toBeNull();
  expect((await producer.observeRetirement(relativePath)).status).toBe('retired-domain-settled');
});

test('dependency recovery fences and settles prepared registration before lifecycle observation', async () => {
  const value = await fixture();
  // An empty compiler staging root is a legal legacy stage for the actual
  // migration consumer; unrelated fixture sentinels are foreign descendants.
  await unlink(path.join(value.generated, 'sentinel'));
  await expect(publish(value, value.registration, 'ledger')).rejects.toThrow('publication-cut:ledger');
  const modulePath = new URL('../../toolchain/dependencies/runtime/project-runtime.ts', import.meta.url).href;
  const run = (deny: boolean) => Bun.spawnSync([process.execPath, '--no-env-file', '--eval', `
    import { migrateDependencyTransitionJournal } from ${JSON.stringify(modulePath)};
    try { await migrateDependencyTransitionJournal(${JSON.stringify(value.repositoryRoot)}, {
      lockTimeoutMs: 10000,
      beforeCommit: async () => { if (${deny}) throw new Error('fixture-recovery-fence'); }
    }); } catch (error) { console.error(error); process.exit(75); }
  `], { cwd: path.dirname(value.repositoryRoot), env: value.options.environment, stdout: 'pipe', stderr: 'pipe', timeout: 15000 });
  const before = await registrationBytes(value.store);
  const intentBefore = await readFile(value.journal, 'utf8');
  const denied = run(true);
  expect(denied.exitCode).toBe(75);
  expect(Buffer.from(denied.stderr).toString()).toContain('fixture-recovery-fence');
  expect(await registrationBytes(value.store)).toEqual(before);
  expect(await readFile(value.journal, 'utf8')).toBe(intentBefore);
  const recovered = run(false);
  expect({ exitCode: recovered.exitCode, stderr: Buffer.from(recovered.stderr).toString() }).toEqual({ exitCode: 0, stderr: '' });
  expect(JSON.parse(await readFile(value.journal, 'utf8')).publication).toBeNull();
  const settled = readRegistrationLedgerObservation(value.store, relativePath);
  expect(settled.registration).toBeNull();
  expect(settled.retiredPredecessor?.phase).toBe('retired');
  expect(settled.previousRegistration?.registrationDigest).toBe(value.registration.registrationDigest);
});

for (const mode of ['cancelled', 'expired', 'clock-cancelled', 'cancel-during-admission', 'cancel-before-pointer'] as const) {
  test(`disposal with ${mode} operation preserves the original prepared publication`, async () => {
    const value = await fixture();
    await publish(value);
    const retired = retireGeneratedStateRegistration(value.registration, `sha256:${'d'.repeat(64)}`);
    await expect(publish(value, retired, 'ledger')).rejects.toThrow('publication-cut:ledger');
    const { createGeneratedStateCleanupOperationSession, generatedStateProducerHooks } = await import('./lifecycle.ts');
    const controller = new AbortController();
    if (mode === 'cancelled') controller.abort();
    let clockCalls = 0;
    const cleanupOperation = createGeneratedStateCleanupOperationSession({
      deadlineAtMonotonicMs: mode === 'expired' ? performance.now() - 1 : performance.now() + 10000,
      signal: controller.signal,
      monotonicNowMs: () => {
        clockCalls++;
        if (mode === 'clock-cancelled' || (mode === 'cancel-before-pointer' && clockCalls === 5)) controller.abort();
        if (mode === 'cancel-during-admission' && clockCalls === 1) queueMicrotask(() => controller.abort());
        return performance.now();
      }
    });
    const producer = generatedStateProducerHooks({ repositoryRoot: value.repositoryRoot }, { ...value.options, cleanupOperation });
    const before = await registrationBytes(value.store);
    const pending = await readFile(value.journal, 'utf8');
    await expect(producer.disposed(relativePath, { outcome: 'owner-disposal', profile: 'automatic' })).rejects.toThrow('cleanup operation budget');
    expect(await registrationBytes(value.store)).toEqual(before);
    expect(await readFile(value.journal, 'utf8')).toBe(pending);
  });
}
