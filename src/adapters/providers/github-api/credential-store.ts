import { AsyncLocalStorage } from 'node:async_hooks';
import { closeSync, fstatSync } from 'node:fs';
import path from 'node:path';

import { sha256 } from '../../../contracts/canonical.ts';
import { withAcquiredResource } from '../../../execution/resource-settlement.ts';
import { linuxOpenLeafAt } from '../../runtime-state/physical/runtime/physical-no-follow-native.ts';
import {
  assertPhysicallyDisjointDirectoryChains,
  assertSameNoFollowDirectoryIdentity,
  inspectNoFollowDirectoryChain,
  PhysicalNoFollowError,
  retainNoFollowDirectoryForChildProcess,
  type PhysicalDirectoryChain,
  type RetainedNoFollowChildProcessDirectory
} from '../../runtime-state/physical/runtime/physical-no-follow.ts';
import { RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR } from '../../runtime-state/physical/runtime/process.ts';

export class GitHubCredentialStoreUnavailableError extends Error {
  readonly code = 'github-credential-store-unavailable' as const;
  constructor(readonly reason: 'unsupported-platform' | 'admission' | 'identity-drift' | 'settlement') {
    super(`GitHub credential store is unavailable (${reason})`);
    this.name = 'GitHubCredentialStoreUnavailableError';
  }
}

type BoundStore = Readonly<{
  chain: PhysicalDirectoryChain;
  directory: RetainedNoFollowChildProcessDirectory;
  identityDigest: string;
  assertCurrent(): void;
}>;

// Only the explicit bootstrap factory can populate this process-local scope.
// It contains a retained native directory, never credential bytes or an
// approval boolean. Environment variables cannot create a binding.
const storeScope = new AsyncLocalStorage<BoundStore>();

function storeObservation<T>(observe: () => T, reason: 'admission' | 'settlement' = 'admission'): T {
  try { return observe(); } catch (error) {
    if (error instanceof GitHubCredentialStoreUnavailableError && reason === 'admission') throw error;
    throw new GitHubCredentialStoreUnavailableError(reason);
  }
}

function absent(error: unknown): boolean {
  return error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_ABSENT';
}

function inspectPrivateStore(directory: RetainedNoFollowChildProcessDirectory): void {
  directory.assertCurrent();
  const fd = directory.stdioSourceDescriptor;
  if (fd === null || typeof process.geteuid !== 'function') {
    throw new GitHubCredentialStoreUnavailableError('unsupported-platform');
  }
  const uid = BigInt(process.geteuid());
  const stat = fstatSync(fd, { bigint: true });
  if (!stat.isDirectory() || stat.uid !== uid || (stat.mode & 0o7777n) !== 0o700n) {
    throw new GitHubCredentialStoreUnavailableError('admission');
  }
  // O_PATH + O_NOFOLLOW observes metadata only: no credential file is read,
  // hashed, copied, logged or admitted through a symlink/hard-link alias.
  for (const name of ['config.yml', 'hosts.yml']) {
    let leaf: number;
    try { leaf = linuxOpenLeafAt(fd, name, 'GitHub credential config metadata'); }
    catch (error) { if (absent(error)) continue; throw error; }
    try {
      const file = fstatSync(leaf, { bigint: true });
      if (!file.isFile() || file.uid !== uid || file.nlink !== 1n ||
          (file.mode & 0o7777n) !== 0o600n) {
        throw new GitHubCredentialStoreUnavailableError('admission');
      }
    } finally { closeSync(leaf); }
  }
  directory.assertCurrent();
}

/** Explicitly select an existing private external store for this operation. */
export async function withGitHubCredentialStore<T>(input: Readonly<{
  directoryPath: string;
  repositoryRoot: string;
  expectedIdentityDigest?: string;
}>, operation: () => T | PromiseLike<T>): Promise<T> {
  if (process.platform !== 'linux') throw new GitHubCredentialStoreUnavailableError('unsupported-platform');
  const { directoryPath, repositoryRoot, expectedIdentityDigest } = input;
  if (storeScope.getStore() !== undefined || !path.isAbsolute(directoryPath) ||
      path.resolve(directoryPath) !== directoryPath || directoryPath.includes('\0')) {
    throw new GitHubCredentialStoreUnavailableError('admission');
  }
  const chain = storeObservation(() => {
    const observed = inspectNoFollowDirectoryChain(directoryPath, 'GitHub credential store');
    assertPhysicallyDisjointDirectoryChains(observed,
      inspectNoFollowDirectoryChain(repositoryRoot, 'GitHub credential repository'),
      'GitHub credential store and repository');
    return observed;
  });
  const identityDigest = sha256({ source: 'explicit-private-gh-config', directory: chain.target });
  if (expectedIdentityDigest !== undefined && expectedIdentityDigest !== identityDigest) {
    throw new GitHubCredentialStoreUnavailableError('identity-drift');
  }
  let operationStarted = false;
  let validateSettlement: (() => void) | undefined;
  return withAcquiredResource({
    operationLabel: 'github-credential-store',
    resourceLabel: 'github-credential-directory',
    acquire: () => storeObservation(() => retainNoFollowDirectoryForChildProcess(
      chain, RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR, 'GitHub credential store'
    )),
    async use(directory) {
      const assertCurrent = (): void => storeObservation(() => {
        assertSameNoFollowDirectoryIdentity(chain.target, 'GitHub credential store binding');
        inspectPrivateStore(directory);
      }, operationStarted ? 'settlement' : 'admission');
      assertCurrent();
      const binding = Object.freeze({ chain, directory, identityDigest, assertCurrent });
      validateSettlement = assertCurrent;
      operationStarted = true;
      return await storeScope.run(binding, operation);
    },
    release: directory => withAcquiredResource({
      operationLabel: 'github-credential-store-validation',
      resourceLabel: 'github-credential-directory-disposal',
      acquire: () => directory,
      use: () => validateSettlement?.(),
      release: retained => storeObservation(
        () => retained.dispose(), operationStarted ? 'settlement' : 'admission'
      )
    })
  });
}

/** Internal consumer: every credential read binds its actual repository. */
export function currentGitHubCredentialStore(repositoryRoot: string): BoundStore | undefined {
  const binding = storeScope.getStore();
  if (binding === undefined) return undefined;
  binding.assertCurrent();
  assertPhysicallyDisjointDirectoryChains(
    binding.chain, inspectNoFollowDirectoryChain(repositoryRoot, 'GitHub credential repository'),
    'GitHub credential store and repository'
  );
  return binding;
}

export function currentGitHubCredentialStoreIdentity(): string | undefined {
  const binding = storeScope.getStore();
  binding?.assertCurrent();
  return binding?.identityDigest;
}
