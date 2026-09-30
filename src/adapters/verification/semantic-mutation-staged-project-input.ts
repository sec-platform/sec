import { createHash } from 'node:crypto';
import path from 'node:path';

import { compareCodeUnits } from '../../contracts/canonical.ts';
import {
  inspectNoFollowDirectoryChain,
  retainNoFollowOrdinaryFile,
  scanNoFollowDirectoryTreeInventory
} from '../runtime-state/physical/runtime/physical-no-follow.ts';

const PROJECT_ROOT_EXCLUSIONS = Object.freeze([
  '.runtime-deps.stamp.json',
  'coverage',
  'node_modules',
  'test-results'
] as const);

function rawByteDigest(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

export async function stagedVerificationProjectInputDigest(
  projectRoot: string
): Promise<`sha256:${string}`> {
  const resolvedRoot = path.resolve(projectRoot);
  const root = inspectNoFollowDirectoryChain(
    resolvedRoot,
    'Staged Verification proof project root'
  );
  if (root.target.path !== resolvedRoot) {
    throw new Error('Staged Verification proof project root must be canonical');
  }

  const inventory = scanNoFollowDirectoryTreeInventory(root.target, {
    maximumEntries: Number.MAX_SAFE_INTEGER,
    maximumBytes: Number.MAX_SAFE_INTEGER,
    includeByteDigest: true,
    excludeRelativePaths: PROJECT_ROOT_EXCLUSIONS
  });
  if (inventory.some((entry) => entry.kind === 'link')) {
    throw new Error('Staged Verification proof input contains an alias');
  }

  const files = inventory
    .filter((entry) => entry.kind === 'file')
    .sort((left, right) => compareCodeUnits(left.relativePath, right.relativePath));

  const digest = createHash('sha256');
  digest.update('staged-verification-project-input-v1\0');
  for (const entry of files) {
    if (entry.byteDigest === undefined || entry.byteDigest === null) {
      throw new Error('Staged Verification proof input file has no retained byte digest');
    }
    if (!entry.relativePath || entry.relativePath.includes('\\')
      || entry.relativePath.split('/').some((segment) =>
        segment.length === 0 || segment === '.' || segment === '..')) {
      throw new Error('Staged Verification proof input contains a non-canonical relative path');
    }
    const absolutePath = path.join(resolvedRoot, ...entry.relativePath.split('/'));
    const parent = inspectNoFollowDirectoryChain(
      path.dirname(absolutePath),
      `Staged Verification proof input parent ${entry.relativePath}`
    );
    const retained = retainNoFollowOrdinaryFile(
      parent,
      path.basename(absolutePath),
      Object.freeze({ device: entry.device, inode: entry.inode }),
      `Staged Verification proof input ${entry.relativePath}`
    );
    try {
      if (retained.linkCount !== 1) {
        throw new Error('Staged Verification proof input must be one host-owned regular file');
      }
      const bytes = Buffer.from(retained.readBytes());
      retained.assertCurrent();
      if (bytes.byteLength !== entry.size || rawByteDigest(bytes) !== entry.byteDigest) {
        throw new Error('Staged Verification proof input changed after retained tree observation');
      }
      digest.update(`file\0${entry.relativePath}\0${entry.size}\0`);
      digest.update(bytes);
      digest.update('\0');
    } finally {
      retained.dispose();
    }
  }
  return `sha256:${digest.digest('hex')}`;
}
