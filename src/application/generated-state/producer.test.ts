import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openRuntimeStoreReadOnly } from '../../adapters/runtime-state/generated-state/registration-store.ts';
import { createGeneratedStateRegistrationBootstrap } from '../../bootstrap/runtime-state/generated-state.ts';
import { createGeneratedStateCleanupOperationSession } from '../../execution/generated-state/cleanup-budget.ts';

test('same producer retirement retry binds the active predecessor and preserves exact native chain bytes', async () => {
  const host = await mkdtemp(path.join(os.tmpdir(), 'generated-state-producer-retry-'));
  try {
    const repositoryRoot = path.join(host, 'repository');
    const relativePath = '.tmp/dependency-installs/c.staging-producer-retry';
    const generated = path.join(repositoryRoot, ...relativePath.split('/'));
    await mkdir(generated, { recursive: true });
    const sentinel = path.join(generated, 'sentinel');
    await writeFile(sentinel, 'owned physical generation');
    const environment = { ...process.env, SEC_STATE_HOME: path.join(host, 'state'), SEC_CACHE_HOME: path.join(host, 'cache') };
    const bootstrap = createGeneratedStateRegistrationBootstrap({ workspaceRoot: repositoryRoot, environment });
    const producer = bootstrap.createProducerRegistration(repositoryRoot);
    await producer.born(relativePath, 'producer-retry');
    const retired = await producer.retired(relativePath, 'original-outcome');
    const store = openRuntimeStoreReadOnly(repositoryRoot, { environment })!;
    const snapshot = async () => Promise.all((await readdir(store.registrationsRoot)).sort()
      .map(async name => [name, await readFile(path.join(store.registrationsRoot, name), 'utf8')]));
    const before = await snapshot();
    expect(await producer.retired(relativePath, 'original-outcome')).toEqual(retired);
    await expect(producer.retired(relativePath, 'foreign-outcome')).rejects.toThrow('different authority');
    await expect(bootstrap.createProducerRegistration(repositoryRoot).retired(relativePath, 'original-outcome'))
      .rejects.toThrow('same producer session');
    expect(await snapshot()).toEqual(before);
    expect(await readFile(sentinel, 'utf8')).toBe('owned physical generation');
    const controller = new AbortController();
    const operation = createGeneratedStateCleanupOperationSession({ deadlineAtMonotonicMs: performance.now() + 10000,
      signal: controller.signal, monotonicNowMs: () => { controller.abort(); return performance.now(); } });
    await expect(bootstrap.settle({ repositoryRoot, profile: 'all-rebuildable', relativePaths: [relativePath] },
      { cleanupOperation: operation })).rejects.toThrow('cleanup operation budget');
    expect(await snapshot()).toEqual(before);
    expect(await readFile(sentinel, 'utf8')).toBe('owned physical generation');
    // Record filenames bind record digests, so select the self-contained retired
    // record by its canonical body rather than inventing a registration filename.
    let retiredRecord: string | undefined;
    for (const name of await readdir(store.registrationsRoot)) {
      if ((await readFile(path.join(store.registrationsRoot, name), 'utf8')).includes(retired.registrationDigest)) retiredRecord = name;
    }
    if (retiredRecord === undefined) throw new Error('Native retirement did not publish its exact record.');
    await writeFile(path.join(store.registrationsRoot, retiredRecord), 'foreign bytes');
    const foreign = await snapshot();
    await expect(producer.retired(relativePath, 'original-outcome')).rejects.toBeDefined();
    expect(await snapshot()).toEqual(foreign);
    expect(await readFile(sentinel, 'utf8')).toBe('owned physical generation');
  } finally { await rm(host, { recursive: true, force: true }); }
});
