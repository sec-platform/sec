import { afterEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { acquireWorkspaceWriteLease } from '../../adapters/filesystem/write-lease.ts';
import { createGeneratedStateJournalMutationBackend, verifyGeneratedStateNativeDisposalEvidence } from '../../adapters/runtime-state/generated-state/journals.ts';
import { createGeneratedStateRegistrationMutationBackend, readVerifiedGeneratedStateObservationFacts, retainedGeneratedStateMutationStore } from '../../adapters/runtime-state/generated-state/registration-store.ts';
import { inspectNoFollowDirectoryChain } from '../../adapters/runtime-state/physical/runtime/physical-no-follow.ts';
import { resolveSecWorkspaceRuntimeRoots } from '../../adapters/runtime-state/workspace-state/paths.ts';
import { ensureCompilerDependencyPreimageRetiredForRecovery } from '../../adapters/toolchain/dependencies/runtime/lifecycle-registration.ts';
import { createGeneratedStateRegistrationBootstrap } from '../../bootstrap/runtime-state/generated-state.ts';
import { createGeneratedStateRegistration, generatedStateDigest, generatedStateRuleForPath, retireGeneratedStateRegistration } from '../../execution/generated-state/contract.ts';
import {
  assertIssuedObservationMatchesFacts,
  inspectIssuedGeneratedStateObservation,
  issueGeneratedStateRetirementObservation
} from '../../execution/generated-state/observation.ts';
import { issueGeneratedStatePublication, withGeneratedStateMutationSession } from '../../execution/generated-state/registration-session.ts';
import { inspectIssuedGeneratedStateTerminalReceipt } from '../../execution/generated-state/terminal-receipt.ts';
import { withAcquiredResource } from '../../execution/resource-settlement.ts';
import { continueGeneratedStateRegistrationMigration } from './migration.ts';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

async function legacyFixture(relativePath = '.tmp/dependency-installs/c.staging-app-migration') {
  const host = await mkdtemp(path.join(os.tmpdir(), 'sec-app-migration-')); roots.push(host);
  const workspaceRoot = path.join(host, 'repository');
  const target = path.join(workspaceRoot, ...relativePath.split('/'));
  await mkdir(target, { recursive: true });
  const environment = { ...process.env, SEC_STATE_HOME: path.join(host, 'state'), SEC_CACHE_HOME: path.join(host, 'cache') };
  const locations = resolveSecWorkspaceRuntimeRoots({ repositoryRoot: workspaceRoot, environment });
  const sourceRoot = path.join(locations.workspaceStateRoot, 'generated-state', 'v1', 'registrations');
  await mkdir(sourceRoot, { recursive: true });
  const workspace = inspectNoFollowDirectoryChain(workspaceRoot, 'fixture workspace').target;
  const root = inspectNoFollowDirectoryChain(target, 'fixture target').target;
  const identity = (value: typeof root) => ({ device: value.device, inode: value.inode, objectId: value.objectId });
  const registration = createGeneratedStateRegistration({ repositoryRoot: workspaceRoot, workspace: identity(workspace),
    rule: generatedStateRuleForPath(relativePath)!, relativePath, root: identity(root), operationId: 'app-migration' });
  const bytes = `${JSON.stringify(registration, null, 2)}\n`;
  const key = generatedStateDigest({ schema: 'sec-generated-state-registration-key-v1', relativePath }).slice(7);
  await writeFile(path.join(sourceRoot, `registration-${registration.registrationDigest.slice(7)}.json`), bytes);
  await writeFile(path.join(sourceRoot, `${key}.json`), bytes);
  const names = (await readdir(sourceRoot)).sort();
  const backend = createGeneratedStateRegistrationMutationBackend();
  return { workspaceRoot, environment, sourceRoot, relativePath, registration, names, bytes, backend };
}

test('readonly retirement requires execution issuance and independent original native evidence', async () => {
  const { workspaceRoot, environment, relativePath, registration } = await legacyFixture();
  const producer = createGeneratedStateRegistrationBootstrap({ workspaceRoot, environment }).createProducerHooks(workspaceRoot);
  const observation = await producer.observeRetirement(relativePath, { physical: registration.root });
  const issued = inspectIssuedGeneratedStateObservation(observation);
  const facts = await readVerifiedGeneratedStateObservationFacts(issued.nativeEvidence, { workspaceRoot, relativePath, expectedPhysical: registration.root });
  assertIssuedObservationMatchesFacts(observation, facts);
  expect(observation.status).toBe('active');
  expect(() => inspectIssuedGeneratedStateObservation({ ...observation })).toThrow('not issued');
  await expect(readVerifiedGeneratedStateObservationFacts(issued.nativeEvidence, { workspaceRoot: path.dirname(workspaceRoot), relativePath })).rejects.toThrow('another exact scope');
  const fake = issueGeneratedStateRetirementObservation(issued.scope, facts, { kind: 'generated-state-native-observation-evidence' });
  await expect(readVerifiedGeneratedStateObservationFacts(inspectIssuedGeneratedStateObservation(fake).nativeEvidence,
    { workspaceRoot, relativePath })).rejects.toThrow('forged');
  let retirementCalls = 0;
  const callerLifecycle = {
    observeRetirement: async () => fake,
    assertObservation: async () => undefined,
    bind: async () => { retirementCalls++; return registration; },
    retired: async () => { retirementCalls++; }
  };
  await callerLifecycle.assertObservation();
  await expect(ensureCompilerDependencyPreimageRetiredForRecovery({ generatedStateLifecycle: callerLifecycle },
    registration.root, 'caller-self-certified-recovery', workspaceRoot)).rejects.toThrow('forged');
  expect(retirementCalls).toBe(0);
  await rm(path.join(workspaceRoot, ...relativePath.split('/')), { recursive: true });
  await expect(readVerifiedGeneratedStateObservationFacts(issued.nativeEvidence, { workspaceRoot, relativePath })).rejects.toThrow('facts changed');
});

test('true native evidence cannot retain mutable physical aliases at the dependency consumer', async () => {
  const { workspaceRoot, environment, relativePath, registration } = await legacyFixture('node_modules');
  const producer = createGeneratedStateRegistrationBootstrap({ workspaceRoot, environment }).createProducerHooks(workspaceRoot);
  await producer.bind(relativePath);
  await producer.retired(relativePath, 'owner retirement for exact recovery');
  const observation = await producer.observeRetirement(relativePath, { physical: registration.root });
  const issued = inspectIssuedGeneratedStateObservation(observation);
  const facts = await readVerifiedGeneratedStateObservationFacts(issued.nativeEvidence, { workspaceRoot, relativePath });
  const mutableFacts = structuredClone(facts);
  const reissued = issueGeneratedStateRetirementObservation(issued.scope, mutableFacts, issued.nativeEvidence);
  const originalPhysical = structuredClone(reissued.physical);
  Reflect.set(mutableFacts.physical.identity!, 'inode', 'caller replacement');
  expect(reissued.physical).toEqual(originalPhysical);
  expect(Reflect.set(reissued.physical!, 'inode', 'caller replacement')).toBe(false);
  assertIssuedObservationMatchesFacts(reissued, facts);
  let retirementCalls = 0;
  await ensureCompilerDependencyPreimageRetiredForRecovery({ generatedStateLifecycle: {
    observeRetirement: async () => reissued,
    bind: async () => { retirementCalls++; return registration; },
    retired: async () => { retirementCalls++; }
  } }, registration.root, 'exact owner recovery', workspaceRoot);
  expect(retirementCalls).toBe(0);
  expect(reissued.physical).toEqual(originalPhysical);
});

test('native publication rejects fake backend lifecycle facts with a true retained resource', async () => {
  const { workspaceRoot, environment, relativePath, backend } = await legacyFixture();
  await createGeneratedStateRegistrationBootstrap({ workspaceRoot, environment }).createProducerHooks(workspaceRoot).bind(relativePath);
  let settledResource: Parameters<typeof backend.readRegistrationCensus>[0] | undefined;
  const fakeBackend = { ...backend,
    readRegistrationCensus(resource: Parameters<typeof backend.readRegistrationCensus>[0]) {
      const census = backend.readRegistrationCensus(resource);
      const current = census.observations.get(relativePath)!;
      return { ...census, observations: new Map([[relativePath, { ...current, registration: null, retiredPredecessor: null }]]) };
    }
  };
  await withGeneratedStateMutationSession({ workspaceRoot, environment, backend: fakeBackend,
    use: async (session, resource) => {
      settledResource = resource;
      const before = backend.readRegistrationCensus(resource).observations.get(relativePath)!;
      const authority = issueGeneratedStatePublication(session, { kind: 'registration', event: 'registered',
        registration: before.registration!, previousRecordDigest: before.tip!.recordDigest });
      expect(() => backend.publishRegistration(resource, authority)).toThrow('outside the admitted predecessor lifecycle');
      expect(backend.readRegistrationCensus(resource).observations.get(relativePath)!.tip!.recordDigest).toBe(before.tip!.recordDigest);
    }
  });
  expect(() => backend.readRegistrationCensus(settledResource!)).toThrow('foreign or settled');
  expect(() => backend.readRegistrationCensus({ kind: 'generated-state-native-mutation-resource' })).toThrow('foreign or settled');
});

test('native publication rejects changed original lease and settlement retires the capability', async () => {
  const { workspaceRoot, environment, relativePath, backend } = await legacyFixture();
  await createGeneratedStateRegistrationBootstrap({ workspaceRoot, environment }).createProducerHooks(workspaceRoot).bind(relativePath);
  let staleResource: Parameters<typeof backend.readRegistrationCensus>[0] | undefined;
  let lockPath = '';
  await expect(withGeneratedStateMutationSession({ workspaceRoot, environment, backend,
    use: async (session, resource) => {
      staleResource = resource;
      const store = retainedGeneratedStateMutationStore(resource);
      const current = backend.readRegistrationCensus(resource).observations.get(relativePath)!;
      const retired = retireGeneratedStateRegistration(current.registration!, generatedStateDigest({ outcome: 'lease tamper fixture' }));
      const authority = issueGeneratedStatePublication(session, { kind: 'registration', event: 'registered',
        registration: retired, previousRecordDigest: current.tip!.recordDigest });
      lockPath = path.join(path.dirname(store.registrationsRoot), '.generated-state-registration-mutation.lock');
      await writeFile(lockPath, '{}\n');
      expect(() => backend.publishRegistration(resource, authority)).toThrow();
    }
  })).rejects.toThrow();
  expect(() => backend.readRegistrationCensus(staleResource!)).toThrow('foreign or settled');
  expect(await readFile(lockPath, 'utf8')).toBe('{}\n');
});

test('full producer disposal publishes and authenticates the terminal native receipt', async () => {
  const { workspaceRoot, environment, relativePath } = await legacyFixture();
  const producer = createGeneratedStateRegistrationBootstrap({ workspaceRoot, environment }).createProducerHooks(workspaceRoot);
  await producer.bind(relativePath);
  const receipt = await producer.disposed(relativePath, { outcome: 'complete producer disposal', profile: 'safe' });
  const issued = inspectIssuedGeneratedStateTerminalReceipt(receipt);
  await verifyGeneratedStateNativeDisposalEvidence(issued.nativeEvidence, { workspaceRoot, relativePath, receipt });
  expect(receipt.terminal).toBe('disposed');
  expect(() => inspectIssuedGeneratedStateTerminalReceipt({ ...receipt })).toThrow('not issued');
  await expect(verifyGeneratedStateNativeDisposalEvidence({ kind: 'generated-state-native-terminal-evidence' },
    { workspaceRoot, relativePath, receipt })).rejects.toThrow('forged');
  await mkdir(path.join(workspaceRoot, ...relativePath.split('/')), { recursive: true });
  await expect(verifyGeneratedStateNativeDisposalEvidence(issued.nativeEvidence, { workspaceRoot, relativePath, receipt })).rejects.toThrow('native terminal');
}, 30_000);

test('worktree flow preserves the exact ordinary root under one native operation', async () => {
  const { workspaceRoot, environment, relativePath, registration } = await legacyFixture();
  const repositoryRoot = path.join(path.dirname(workspaceRoot), 'primary');
  const head = 'a'.repeat(40), tree = 'b'.repeat(40);
  const runGit = async (_command: string, args: string[]) => ({ code: 0, stderr: new Uint8Array(), stdout: Buffer.from(
    args.includes('list') ? `worktree ${repositoryRoot}\0HEAD ${head}\0branch refs/heads/main\0\0worktree ${workspaceRoot}\0HEAD ${head}\0branch refs/heads/candidate\0\0`
      : args.includes('rev-parse') ? `${tree}\n` : '!! .tmp/\0') });
  const composition = createGeneratedStateRegistrationBootstrap({ workspaceRoot, environment, runGit });
  const request = { repositoryRoot, workspaceRoot, expectedBranch: 'candidate', expectedHeadSha: head, expectedTreeSha: tree };
  const receipt = await composition.settleForWorktreeRetirement(request);
  expect(receipt?.terminal).toBe('completed');
  expect(receipt?.entries.map(entry => entry.relativePath)).toEqual(['.tmp']);
  expect(() => composition.assertWorktreeRetirementEffectStart({ ...request, receipt: receipt! })).not.toThrow();
  const preserved = receipt!.entries[0]!;
  expect(preserved.action).toBe('preserved');
  if (preserved.action !== 'preserved') throw new Error('Fixture ordinary root was not preserved.');
  const retainedPath = path.join(receipt!.retentionRoot!.path, preserved.destinationName, ...relativePath.split('/').slice(1));
  const retained = inspectNoFollowDirectoryChain(retainedPath, 'fixture retained registered descendant').target;
  expect(retained.objectId).toBe(registration.root.objectId);
}, 30_000);

test('application migration uses retained native source and exact publication authority', async () => {
  const { workspaceRoot, environment, sourceRoot, relativePath, registration, names, bytes, backend } = await legacyFixture();
  await withGeneratedStateMutationSession({ workspaceRoot, environment, backend, use: async (session, resource) => {
    const original = backend.readMigrationSource(resource)!;
    // Public presentation data cannot alter the privately retained source.
    (original.pointers as Map<string, unknown>).clear();
    const preimage = backend.observeMigrationPhysicalPreimage(resource, original);
    const plan = backend.describeMigration(resource, original, preimage);
    expect(plan.records).toHaveLength(1);
    const forged = { ...plan.prepared, sourcePointerCount: 999 };
    expect(() => backend.publishMigrationPrepared(resource,
      issueGeneratedStatePublication(session, { kind: 'migration-prepared', intent: forged }))).toThrow('exact retained native plan');
    expect(() => backend.describeMigration(resource, { ...original }, preimage)).toThrow('foreign');
    continueGeneratedStateRegistrationMigration(backend, session, resource);
    expect(backend.readRegistrationCensus(resource).observations.get(relativePath)?.registration?.registrationDigest)
      .toBe(registration.registrationDigest);
  } });
  expect((await readdir(sourceRoot)).sort()).toEqual(names);
  for (const name of names) expect(await readFile(path.join(sourceRoot, name), 'utf8')).toBe(bytes);
  const currentNames = await readdir(path.join(path.dirname(sourceRoot), 'registrations-v3'));
  expect(currentNames.filter(name => /^[0-9a-f]{64}\.json$|^registration-[0-9a-f]{64}\.json$/u.test(name))).toEqual([]);
});

test('bootstrap producer binds, retires and restores the exact migrated predecessor', async () => {
  const { workspaceRoot, environment, relativePath, registration } = await legacyFixture();
  const composition = createGeneratedStateRegistrationBootstrap({ workspaceRoot, environment });
  const producer = composition.createProducerRegistration(workspaceRoot);
  const bound = await producer.bind(relativePath);
  expect(bound.registrationDigest).toBe(registration.registrationDigest);
  const retired = await producer.retired(relativePath, 'fixture operation completed');
  expect(retired.phase).toBe('retired');
  const restored = await producer.restore(relativePath, retired.registrationDigest, registration.root, 'fixture rollback');
  expect(restored.phase).toBe('active');
  expect(restored.operationId.startsWith('restore:sha256:')).toBe(true);
  const inventory = await composition.inspect(workspaceRoot, [relativePath]);
  expect(inventory.entries[0]?.registrationState).toBe('active');
  expect(composition.planCleanup({ inventory, profile: 'all-rebuildable' }).selected).toEqual([]);
});

test('active cleanup intent preserves its pointer and fences conflicting restore across coordination leases', async () => {
  const { workspaceRoot, environment, relativePath, backend } = await legacyFixture();
  const producer = createGeneratedStateRegistrationBootstrap({ workspaceRoot, environment }).createProducerRegistration(workspaceRoot);
  await producer.bind(relativePath);
  const retiredAgain = await producer.retired(relativePath, 'fixture cleanup');
  const journals = createGeneratedStateJournalMutationBackend();
  await withGeneratedStateMutationSession({ workspaceRoot, environment, backend, use: async (session, resource) => {
    const material = { schema: 'sec-generated-state-cleanup-intent-v2' as const,
      beforeInventoryDigest: generatedStateDigest({ fixture: 'inventory' }), profile: 'safe' as const,
      registrationDigest: retiredAgain.registrationDigest, relativePath, root: retiredAgain.root,
      tombstoneName: `q-${'a'.repeat(48)}` };
    const intent = { ...material, intentDigest: generatedStateDigest(material) };
    expect(journals.publishCleanupIntent(resource, issueGeneratedStatePublication(session,
      { kind: 'cleanup-intent', intent })).intentDigest).toBe(intent.intentDigest);
    expect(() => journals.completeCleanupIntent(resource, issueGeneratedStatePublication(session,
      { kind: 'cleanup-complete', relativePath, intentDigest: intent.intentDigest,
        registrationDigest: retiredAgain.registrationDigest }))).toThrow('exact disposed ledger and physical readback');
    expect(journals.readCleanupIntent(resource, relativePath)?.intentDigest).toBe(intent.intentDigest);
  } });
  await expect(producer.restore(relativePath, retiredAgain.registrationDigest, retiredAgain.root, 'conflicting rollback'))
    .rejects.toThrow('active cleanup responsibility');
});

test('application cleanup publishes disposed only after native quarantine deletion and preserves source history', async () => {
  const { workspaceRoot, environment, relativePath, backend } = await legacyFixture();
  const composition = createGeneratedStateRegistrationBootstrap({ workspaceRoot, environment });
  const producer = composition.createProducerRegistration(workspaceRoot);
  await producer.bind(relativePath);
  const retired = await producer.retired(relativePath, 'fixture cleanup closure');
  const before = await composition.inspect(workspaceRoot, [relativePath]);
  expect(before.entries[0]).toMatchObject({ registrationState: 'retired', settlement: 'ready', blockers: [] });
  expect(composition.planCleanup({ inventory: before, profile: 'safe' }).selected).toEqual([relativePath]);
  let observedRetiredBeforeDeletion = false;
  const settlement = await composition.settle({ repositoryRoot: workspaceRoot, relativePaths: [relativePath], profile: 'safe' }, {
    afterQuarantineEffect: async () => {
      // The physical Effect executes after the short mutation lease releases.
      await withGeneratedStateMutationSession({ workspaceRoot, environment, backend, use: async (_session, resource) => {
        const observation = backend.readRegistrationCensus(resource).observations.get(relativePath);
        expect(observation?.registration?.registrationDigest).toBe(retired.registrationDigest);
        expect(observation?.tip?.event).toBe('registered');
        observedRetiredBeforeDeletion = true;
      } });
    }
  });
  expect(settlement.blockers).toEqual([]);
  expect(observedRetiredBeforeDeletion).toBe(true);
  expect(settlement.terminal).toBe('completed');
  const inventory = await composition.inspect(workspaceRoot, [relativePath]);
  expect(inventory.entries[0]?.kind).toBe('missing');
  await withGeneratedStateMutationSession({ workspaceRoot, environment, backend, use: async (_session, resource) => {
    expect(backend.readRegistrationCensus(resource).observations.get(relativePath)?.retiredPredecessor?.registrationDigest)
      .toBe(retired.registrationDigest);
  } });
}, 30_000);

test('cleanup borrows the exact parent writer generation through native effects without releasing it', async () => {
  const { workspaceRoot, environment, relativePath } = await legacyFixture();
  await withAcquiredResource({ operationLabel: 'fixture parent operation', resourceLabel: 'fixture parent workspace lease',
    acquire: () => acquireWorkspaceWriteLease(workspaceRoot), release: parent => parent.release(),
    use: async parent => {
      const composition = createGeneratedStateRegistrationBootstrap({ workspaceRoot, environment, reentrantToken: parent.token });
      const producer = composition.createProducerRegistration(workspaceRoot);
      await producer.bind(relativePath); await producer.retired(relativePath, 'borrowed parent cleanup');
      let parentHeldDuringEffect = false;
      const settlement = await composition.settle({ repositoryRoot: workspaceRoot, relativePaths: [relativePath], profile: 'safe' }, {
        afterQuarantineEffect: async () => { await parent.assertOwned(); parentHeldDuringEffect = true; }
      });
      expect(settlement.terminal).toBe('completed');
      expect(parentHeldDuringEffect).toBe(true);
      await parent.assertOwned();
      expect((await parent.ownedNamespace()).workspaceRoot).toBe(workspaceRoot);
    }
  });
}, 30_000);
