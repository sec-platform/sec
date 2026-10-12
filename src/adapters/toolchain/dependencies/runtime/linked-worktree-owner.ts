import { lstatSync } from 'node:fs';
import path from 'node:path';
import { CodedFailure } from '../../../../contracts/failure.ts';
import {
  assertSameNoFollowDirectoryIdentity,
  inspectNoFollowDirectoryChain,
  retainNoFollowOrdinaryFile,
  type PhysicalDirectoryChain,
  type PhysicalDirectoryIdentity,
  type RetainedNoFollowOrdinaryFile
} from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  parseGitWorktreeAdminLocator,
  parseGitWorktreeAdminPath
} from '../../../runtime-state/worktree-closeout-contract.ts';
import { sameHostPath } from './host-path.ts';

/**
 * Git owns worktree membership; this boundary retains the native registry
 * files while a dependency consumer observes the selected owner. A path-only
 * `git rev-parse` result cannot replace the retained handles, reciprocal
 * identity checks and disposal/liveness contract. No second registry is kept.
 * Package readiness, generation custody and locator effects stay with the
 * dependency runtime; this admission never installs or deletes a generation.
 */
interface RetainedGitControlFile {
  readonly capability: RetainedNoFollowOrdinaryFile;
  readonly value: string;
  assertCurrent(): void;
}

interface LinkedWorktreeDependencyOwnerAuthority {
  readonly consumerRoot: string;
  readonly ownerRoot: string;
  assertCurrent(): void;
  dispose(): void;
}

function samePhysicalDirectory(
  left: PhysicalDirectoryIdentity,
  right: PhysicalDirectoryIdentity
): boolean {
  return left.device === right.device && left.inode === right.inode && left.objectId === right.objectId;
}

function retainGitControlFile(
  parent: PhysicalDirectoryChain,
  name: string,
  label: string,
  parse: (source: Uint8Array) => string
): RetainedGitControlFile {
  const capability = retainNoFollowOrdinaryFile(parent, name, undefined, label);
  try {
    if (capability.size > 32_768) {
      throw new Error(`${label} exceeds the bounded Git control-file domain.`);
    }
    const before = capability.digest();
    const value = parse(capability.readBytes());
    const after = capability.digest();
    if (before.size !== after.size || before.byteDigest !== after.byteDigest) {
      throw new Error(`${label} changed during retained parsing.`);
    }
    return Object.freeze({
      capability,
      value,
      assertCurrent: () => {
        capability.assertCurrent();
        const current = capability.digest();
        if (current.size !== before.size || current.byteDigest !== before.byteDigest) {
          throw new Error(`${label} bytes changed after retained parsing.`);
        }
      }
    });
  } catch (error) {
    capability.dispose();
    throw error;
  }
}

function disposeRetainedGitControlFiles(files: readonly RetainedGitControlFile[]): void {
  let failure: unknown = null;
  for (const file of [...files].reverse()) {
    try {
      file.capability.dispose();
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure !== null) throw failure;
}

/**
 * Derives the primary dependency owner from Git's physical linked-worktree
 * registry, without executing Git or trusting a caller/path projection.  The
 * root locator, admin `commondir`, and reciprocal `gitdir` back-reference are
 * retained for the whole dependency observation and content-fenced on every
 * readback.  A regular `.git` marker that is not one exact registry member is
 * therefore a typed authority failure, never a local-install fallback.
 */
export function linkedWorktreeDependencyOwnerRoot(
  consumerRoot: string
): LinkedWorktreeDependencyOwnerAuthority | null {
  const markerPath = path.join(consumerRoot, '.git');
  let markerMetadata: ReturnType<typeof lstatSync>;
  try {
    markerMetadata = lstatSync(markerPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  if (!markerMetadata.isFile() || markerMetadata.isSymbolicLink()) return null;

  const retained: RetainedGitControlFile[] = [];
  try {
    const consumer = inspectNoFollowDirectoryChain(consumerRoot, 'Linked worktree consumer root');
    const marker = retainGitControlFile(
      consumer,
      '.git',
      'Linked worktree .git locator',
      parseGitWorktreeAdminLocator
    );
    retained.push(marker);
    const adminDirectory = path.resolve(consumerRoot, marker.value);
    const admin = inspectNoFollowDirectoryChain(adminDirectory, 'Linked worktree registry admin');
    const commonLocator = retainGitControlFile(
      admin,
      'commondir',
      'Linked worktree commondir locator',
      (source) => parseGitWorktreeAdminPath(source, 'linked-worktree commondir')
    );
    retained.push(commonLocator);
    const backReference = retainGitControlFile(
      admin,
      'gitdir',
      'Linked worktree gitdir back-reference',
      (source) => parseGitWorktreeAdminPath(source, 'linked-worktree gitdir')
    );
    retained.push(backReference);

    const commonDirectory = path.resolve(adminDirectory, commonLocator.value);
    const common = inspectNoFollowDirectoryChain(commonDirectory, 'Linked worktree common Git directory');
    const worktreesDirectory = path.join(commonDirectory, 'worktrees');
    const worktrees = inspectNoFollowDirectoryChain(
      worktreesDirectory,
      'Linked worktree registry namespace'
    );
    const adminName = path.basename(adminDirectory);
    if (adminName.length === 0 || adminName === '.' || adminName === '..' ||
        !sameHostPath(path.dirname(adminDirectory), worktreesDirectory)) {
      throw new Error('Linked worktree admin is not one direct registry member.');
    }
    const registeredAdmin = inspectNoFollowDirectoryChain(
      path.join(worktreesDirectory, adminName),
      'Linked worktree registered admin'
    );
    if (!samePhysicalDirectory(admin.target, registeredAdmin.target)) {
      throw new Error('Linked worktree admin is not the registered physical directory.');
    }
    const registeredMarkerPath = path.resolve(adminDirectory, backReference.value);
    if (!sameHostPath(registeredMarkerPath, markerPath)) {
      throw new Error('Linked worktree registry back-reference does not bind this consumer.');
    }
    if (path.basename(commonDirectory).toLocaleLowerCase('en-US') !== '.git') {
      throw new Error('Linked worktree common directory is not an owner .git directory.');
    }
    const ownerRoot = path.dirname(commonDirectory);
    if (sameHostPath(ownerRoot, consumerRoot)) {
      throw new Error('Linked worktree dependency owner is not physically distinct.');
    }
    const owner = inspectNoFollowDirectoryChain(ownerRoot, 'Linked worktree dependency owner root');
    const ownerGit = inspectNoFollowDirectoryChain(
      path.join(ownerRoot, '.git'),
      'Linked worktree dependency owner Git directory'
    );
    if (!samePhysicalDirectory(common.target, ownerGit.target)) {
      throw new Error('Linked worktree common directory is not the owner registry root.');
    }

    const assertCurrent = (): void => {
      assertSameNoFollowDirectoryIdentity(consumer.target, 'Linked worktree consumer root');
      assertSameNoFollowDirectoryIdentity(admin.target, 'Linked worktree registry admin');
      assertSameNoFollowDirectoryIdentity(common.target, 'Linked worktree common Git directory');
      assertSameNoFollowDirectoryIdentity(worktrees.target, 'Linked worktree registry namespace');
      assertSameNoFollowDirectoryIdentity(owner.target, 'Linked worktree dependency owner root');
      assertSameNoFollowDirectoryIdentity(ownerGit.target, 'Linked worktree dependency owner Git directory');
      for (const file of retained) file.assertCurrent();
    };
    assertCurrent();
    let disposed = false;
    return Object.freeze({
      consumerRoot,
      ownerRoot,
      assertCurrent: () => {
        if (disposed) throw new Error('Linked worktree registry authority is disposed.');
        assertCurrent();
      },
      dispose: () => {
        if (disposed) return;
        disposed = true;
        disposeRetainedGitControlFiles(retained);
      }
    });
  } catch (error) {
    try {
      disposeRetainedGitControlFiles(retained);
    } catch (disposalError) {
      throw new CodedFailure(
        'IMPORT-AUTHORITY-004',
        'Linked worktree registry authority cleanup failed',
        {
          cause: error instanceof Error ? error.message : String(error),
          disposalCause: disposalError instanceof Error ? disposalError.message : String(disposalError)
        }
      );
    }
    throw new CodedFailure(
      'IMPORT-AUTHORITY-004',
      'Linked worktree registry authority is invalid',
      { cause: error instanceof Error ? error.message : String(error), markerPath }
    );
  }
}
