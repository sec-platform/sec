import path from 'node:path';
import { generatedStateDigest, type GeneratedStatePhysicalIdentity } from '../../../../execution/generated-state/contract.ts';
import { assertSameNoFollowDirectoryIdentity, inspectExactNoFollowDirectoryPresence, inspectNoFollowDirectoryChain, inspectNoFollowLinkEntry, PhysicalNoFollowError } from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import { compilerDependencyStoragePaths } from './dependency-storage-layout.ts';
import type { RuntimeDependencySourceGeneration } from './dependency-transition/contract.ts';
import { sameHostPath } from './host-path.ts';

/** Read-only locator observation and exact owner-qualified generation selection. */
export function isManagedCompilerDependencyGenerationPath(generationPath: string): boolean {
  const resolved = path.resolve(generationPath);
  const envelope = path.basename(resolved) === 'node_modules' ? path.dirname(resolved) : resolved;
  return /^generation-[0-9a-f]{24}$/u.test(path.basename(envelope));
}

/** Persisted topology only; the original owner still proves physical content
 * and publisher authority before any recovery or retirement effect. */
export function isExactRecordedManagedCompilerDependencySource(
  source: Pick<RuntimeDependencySourceGeneration, 'sourcePath' | 'epoch'>
): boolean {
  const selected = path.resolve(source.sourcePath);
  const envelope = path.basename(selected) === 'node_modules' ? path.dirname(selected) : selected;
  return isManagedCompilerDependencyGenerationPath(selected) &&
    path.basename(envelope) === `generation-${source.epoch.slice(7, 31)}`;
}

export function canonicalCompilerDependencyGenerationOwnerRoot(
  generationPath: string,
  ownerRoot?: string
): string | null {
  const resolvedGeneration = path.resolve(generationPath);
  const packageLayout = path.basename(resolvedGeneration) === 'node_modules';
  const generationEnvelope = packageLayout ? path.dirname(resolvedGeneration) : resolvedGeneration;
  if (!/^generation-[0-9a-f]{24}$/u.test(path.basename(generationEnvelope))) return null;
  const generationParent = path.dirname(generationEnvelope);
  if (ownerRoot !== undefined) {
    const owner = path.resolve(ownerRoot);
    if (sameHostPath(compilerDependencyStoragePaths(owner).generationRoot, generationParent)) return owner;
  }
  // Only the historical workspace-local topology permits owner inference.
  if (packageLayout) return null;
  let candidateOwner = generationParent;
  while (true) {
    if (sameHostPath(path.join(candidateOwner, '.tmp', 'dependency-installs', 'compiler-backups'), generationParent)) return candidateOwner;
    const parent = path.dirname(candidateOwner);
    if (parent === candidateOwner) return null;
    candidateOwner = parent;
  }
}

export function isCanonicalLocalCompilerDependencyGeneration(
  consumerRoot: string,
  generationPath: string
): boolean {
  const ownerRoot = canonicalCompilerDependencyGenerationOwnerRoot(generationPath, consumerRoot);
  return ownerRoot !== null && sameHostPath(ownerRoot, consumerRoot);
}

export function compilerDependencyLocatorObservation(
  consumerRoot: string,
  relativePath: string
): Readonly<{ source: GeneratedStatePhysicalIdentity; linkTarget: string }> | null {
  if (relativePath !== 'node_modules') {
    throw new Error('Compiler dependency locator provider only owns node_modules.');
  }
  const root = inspectNoFollowDirectoryChain(consumerRoot, 'Compiler dependency locator consumer root').target;
  try {
    const ordinaryDirectory = inspectExactNoFollowDirectoryPresence(
      path.join(root.path, relativePath),
      'Compiler dependency ordinary node_modules'
    );
    if (ordinaryDirectory.state === 'present') {
      assertSameNoFollowDirectoryIdentity(root, 'Compiler dependency locator consumer root readback');
      return null;
    }
  } catch (error) {
    // A retained reparse/symlink leaf is intentionally rejected by the
    // ordinary-directory observer and must then be observed by the exact link
    // capability below. Other kinds and physical failures remain blockers.
    if (!(error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_UNSAFE_PATH')) {
      throw error;
    }
  }
  const locator = inspectNoFollowLinkEntry(root, relativePath);
  if (locator === null || locator.kind !== 'link' || locator.linkTarget === null) return null;
  return Object.freeze({
    source: Object.freeze({
      device: locator.device,
      inode: locator.inode,
      objectId: generatedStateDigest({ kind: 'link', target: locator.linkTarget })
    }),
    linkTarget: locator.linkTarget
  });
}
