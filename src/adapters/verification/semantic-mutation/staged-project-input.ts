import { lstat, open, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';

import { createSha256Hasher, type Hasher } from '../../../contracts/digest.ts';
import { compareCodeUnits } from '../../../contracts/canonical.ts';

const PROJECT_ROOT_EXCLUSIONS = new Set([
  '.runtime-deps.stamp.json',
  'coverage',
  'node_modules',
  'test-results'
]);

function metadataIdentity(metadata: Awaited<ReturnType<typeof lstat>>): string {
  return [
    metadata.dev,
    metadata.ino,
    metadata.mode,
    metadata.nlink,
    metadata.size,
    metadata.mtimeMs
  ].join(':');
}

async function updateFileDigest(
  digest: Hasher<'sha256'>,
  projectRoot: string,
  filePath: string
): Promise<void> {
  const beforePath = await lstat(filePath);
  if (!beforePath.isFile() || beforePath.isSymbolicLink() || beforePath.nlink !== 1) {
    throw new Error('Staged Verification proof input must be one host-owned regular file');
  }
  const handle = await open(filePath, 'r');
  try {
    const beforeHandle = await handle.stat();
    if (metadataIdentity(beforeHandle) !== metadataIdentity(beforePath)) {
      throw new Error('Staged Verification proof input identity changed before read');
    }
    const relativePath = path.relative(projectRoot, filePath).split(path.sep).join('/');
    if (!relativePath || relativePath.startsWith('../') || path.isAbsolute(relativePath)) {
      throw new Error('Staged Verification proof input escaped the project root');
    }
    digest.update(`file\0${relativePath}\0${beforeHandle.size}\0`);
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let position = 0;
    while (position < beforeHandle.size) {
      const length = Math.min(buffer.byteLength, beforeHandle.size - position);
      const { bytesRead } = await handle.read(buffer, 0, length, position);
      if (bytesRead <= 0) throw new Error('Staged Verification proof input ended during read');
      digest.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    const [afterHandle, afterPath] = await Promise.all([handle.stat(), lstat(filePath)]);
    if (position !== beforeHandle.size ||
      metadataIdentity(afterHandle) !== metadataIdentity(beforeHandle) ||
      metadataIdentity(afterPath) !== metadataIdentity(beforeHandle)) {
      throw new Error('Staged Verification proof input changed during read');
    }
    digest.update('\0');
  } finally {
    await handle.close();
  }
}

async function updateDirectoryDigest(
  digest: Hasher<'sha256'>,
  projectRoot: string,
  directory: string,
  root: boolean
): Promise<void> {
  const before = await lstat(directory);
  if (!before.isDirectory() || before.isSymbolicLink()) {
    throw new Error('Staged Verification proof input directory changed identity');
  }
  const entries = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => !(root && PROJECT_ROOT_EXCLUSIONS.has(entry.name)))
    .sort((left, right) => compareCodeUnits(left.name, right.name));
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error('Staged Verification proof input contains an alias');
    }
    if (entry.isDirectory()) {
      await updateDirectoryDigest(digest, projectRoot, target, false);
    } else if (entry.isFile()) {
      await updateFileDigest(digest, projectRoot, target);
    } else {
      throw new Error('Staged Verification proof input contains an unsupported entry');
    }
  }
  const after = await lstat(directory);
  if (metadataIdentity(after) !== metadataIdentity(before)) {
    throw new Error('Staged Verification proof input directory changed during capture');
  }
}

export async function stagedVerificationProjectInputDigest(
  projectRoot: string
): Promise<`sha256:${string}`> {
  const canonicalRoot = await realpath(projectRoot);
  if (path.resolve(canonicalRoot) !== path.resolve(projectRoot)) {
    throw new Error('Staged Verification proof project root must be canonical');
  }
  const digest = createSha256Hasher();
  try {
    digest.update('staged-verification-project-input-v1\0');
    await updateDirectoryDigest(digest, projectRoot, projectRoot, true);
    return digest.finish();
  } finally {
    digest.dispose();
  }
}
