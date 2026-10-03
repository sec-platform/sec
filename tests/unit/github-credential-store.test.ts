import { afterEach, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, renameSync } from 'node:fs';
import { chmod, link, mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  githubCredentialBootstrapHandoffArguments,
  parseGitHubCredentialBootstrapArguments,
  withGitHubCredentialBootstrap
} from '../../src/adapters/providers/github-api/credential-bootstrap.ts';
import {
  currentGitHubCredentialStore,
  currentGitHubCredentialStoreIdentity,
  withGitHubCredentialStore
} from '../../src/adapters/providers/github-api/credential-store.ts';

import { ResourceCompositeSettlementError } from '../../src/execution/resource-settlement.ts';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});
async function fixture(): Promise<{ root: string; store: string; repository: string }> {
  const root = await mkdtemp(path.join(process.platform === 'linux' ? '/tmp' : os.tmpdir(), 'sec-gh-store-'));
  roots.push(root);
  const store = path.join(root, 'private');
  const repository = path.join(root, 'repository');
  await mkdir(store, { mode: 0o700 });
  await mkdir(repository);
  await mkdir(path.join(repository, '.git'));
  return { root, store, repository };
}

test('credential bootstrap rejects ambiguous or incomplete selections', () => {
  for (const args of [
    ['--github-credential-store'],
    ['--github-credential-store', '/one', '--github-credential-store', '/two'],
    ['--github-credential-store-identity', `sha256:${'a'.repeat(64)}`],
    ['--github-credential-store', '/one', '--github-credential-store-identity', 'wrong']
  ]) expect(() => parseGitHubCredentialBootstrapArguments(args)).toThrow();
});

test('no explicit selection creates no store binding', async () => {
  await withGitHubCredentialBootstrap(['status', '--json'], async args => {
    expect(args).toEqual(['status', '--json']);
    expect(currentGitHubCredentialStoreIdentity()).toBeUndefined();
    expect(githubCredentialBootstrapHandoffArguments(args)).toEqual(args);
  });
});

test.skipIf(process.platform !== 'linux')('binds a private external store and re-admits its physical identity', async () => {
  const { store, repository } = await fixture();
  await writeFile(path.join(store, 'hosts.yml'), 'fixture-only', { mode: 0o600 });
  let handoff: string[] = [];
  const argv = ['status', '--json', '--github-credential-store', store];
  await withGitHubCredentialBootstrap(argv, async args => {
    expect(args).toEqual(['status', '--json']);
    const binding = currentGitHubCredentialStore(repository)!;
    expect(binding.directory.childPath).toBe('/proc/self/fd/4');
    expect(binding.identityDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    handoff = githubCredentialBootstrapHandoffArguments(argv);
    expect(handoff).toContain(binding.identityDigest);
  });
  expect(currentGitHubCredentialStoreIdentity()).toBeUndefined();
  await withGitHubCredentialBootstrap(handoff, async () => {
    expect(currentGitHubCredentialStore(repository)).toBeDefined();
  });
  await rename(store, `${store}-old`);
  await mkdir(store, { mode: 0o700 });
  let entered = false;
  await expect(withGitHubCredentialBootstrap(handoff, async () => { entered = true; }))
    .rejects.toMatchObject({ code: 'github-credential-store-unavailable', reason: 'identity-drift' });
  expect(entered).toBe(false);
});

for (const failure of ['public-directory', 'public-file', 'symlink-file', 'hard-linked-file',
  'inside-repository', 'symlink-directory'] as const) {
  test.skipIf(process.platform !== 'linux')(`rejects ${failure} before entering the operation`, async () => {
    const { root, store, repository } = await fixture();
    let selected = store;
    const hosts = path.join(store, 'hosts.yml');
    if (failure === 'public-directory') await chmod(store, 0o755);
    if (failure === 'public-file') await writeFile(hosts, 'fixture-only', { mode: 0o644 });
    if (failure === 'symlink-file') await symlink(path.join(root, 'absent'), hosts);
    if (failure === 'hard-linked-file') {
      await writeFile(hosts, 'fixture-only', { mode: 0o600 });
      await link(hosts, path.join(root, 'alias'));
    }
    if (failure === 'inside-repository') {
      selected = path.join(repository, 'private');
      await mkdir(selected, { mode: 0o700 });
    }
    if (failure === 'symlink-directory') {
      selected = path.join(root, 'linked');
      await symlink(store, selected);
    }
    let entered = false;
    await expect(withGitHubCredentialStore({ directoryPath: selected, repositoryRoot: repository }, async () => { entered = true; }))
      .rejects.toMatchObject({ code: 'github-credential-store-unavailable' });
    expect(entered).toBe(false);
  });
}

test.skipIf(process.platform !== 'linux')('rejects repository overlap and in-scope identity drift', async () => {
  const { store, repository } = await fixture();
  await withGitHubCredentialStore({ directoryPath: store, repositoryRoot: repository }, async () => {
    expect(() => currentGitHubCredentialStore(store)).toThrow();
  });
  await expect(withGitHubCredentialStore({ directoryPath: store, repositoryRoot: repository }, async () => {
    await rename(store, `${store}-old`);
    await mkdir(store, { mode: 0o700 });
  })).rejects.toMatchObject({ code: 'github-credential-store-unavailable', reason: 'settlement' });
});

test.skipIf(process.platform !== 'linux')('settles separate concurrent store scopes without ambient rebinding', async () => {
  const first = await fixture();
  const second = await fixture();
  const identities = await Promise.all([first, second].map(async ({ store, repository }) =>
    withGitHubCredentialStore({ directoryPath: store, repositoryRoot: repository }, async () => {
      await Promise.resolve();
      return currentGitHubCredentialStore(repository)!.identityDigest;
    })));
  expect(identities[0]).not.toBe(identities[1]);
  expect(currentGitHubCredentialStoreIdentity()).toBeUndefined();
});


for (const asynchronous of [false, true]) {
  for (const drift of ['none', 'permissions', 'identity'] as const) {
    test.skipIf(process.platform !== 'linux')(
      `settles ${asynchronous ? 'async' : 'sync'} callback rejection with ${drift} drift`,
      async () => {
        const { store, repository } = await fixture();
        const failure = new Error('downstream operation failed');
        let retained: ReturnType<typeof currentGitHubCredentialStore>;
        const reject = (): never => {
          retained = currentGitHubCredentialStore(repository);
          if (drift === 'permissions') chmodSync(store, 0o755);
          if (drift === 'identity') {
            renameSync(store, `${store}-old`);
            mkdirSync(store, { mode: 0o700 });
          }
          throw failure;
        };
        const operation = asynchronous ? async () => { await Promise.resolve(); reject(); } : reject;
        const outcome = await withGitHubCredentialStore(
          { directoryPath: store, repositoryRoot: repository }, operation
        ).then(() => null, error => error);
        if (drift === 'none') expect(outcome).toBe(failure);
        else {
          expect(outcome).toBeInstanceOf(ResourceCompositeSettlementError);
          expect(outcome.errors[0]).toBe(failure);
          expect(outcome.errors[1]).toMatchObject({
            code: 'github-credential-store-unavailable', reason: 'settlement'
          });
        }
        expect(currentGitHubCredentialStoreIdentity()).toBeUndefined();
        expect(() => retained!.directory.assertCurrent()).toThrow();
        if (asynchronous && drift === 'none') {
          await withGitHubCredentialStore({ directoryPath: store, repositoryRoot: repository }, async () => {
            expect(currentGitHubCredentialStore(repository)).toBeDefined();
          });
        }
      }
    );
  }
}
