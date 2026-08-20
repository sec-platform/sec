import { expect, test } from 'bun:test';
import fs, { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { buildReleaseArtifactV1 } from '../../platform/release/release-artifact.ts';

test('release publication rejects a non-directory accepted destination before source preparation', async () => {
  if (process.platform !== 'linux' && process.platform !== 'win32') return;
  const root = await mkdtemp(path.join(tmpdir(), 'sec-release-destination-file-'));
  try {
    const parent = path.join(root, 'package');
    await fs.mkdir(parent);
    const destination = path.join(parent, 'dist');
    await fs.writeFile(destination, 'not-an-artifact-directory\n');

    await expect(buildReleaseArtifactV1(path.join(root, 'not-a-repository'), destination))
      .rejects.toThrow('Existing release artifact destination is not one ordinary directory');
    await expect(fs.readFile(destination, 'utf8')).resolves.toBe('not-an-artifact-directory\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('release publication rejects a symlinked destination parent before source preparation', async () => {
  if (process.platform !== 'linux') return;
  const root = await mkdtemp(path.join(tmpdir(), 'sec-release-destination-link-'));
  try {
    const physicalParent = path.join(root, 'physical-package');
    const linkedParent = path.join(root, 'linked-package');
    await fs.mkdir(physicalParent);
    await fs.symlink(physicalParent, linkedParent);

    await expect(buildReleaseArtifactV1(
      path.join(root, 'not-a-repository'),
      path.join(linkedParent, 'dist')
    )).rejects.toMatchObject({
      name: 'PhysicalNoFollowError'
    });
    await expect(fs.lstat(path.join(physicalParent, 'dist')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
