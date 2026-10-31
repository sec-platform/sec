import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { buildReleaseArtifact } from '../../../src/adapters/release/release-artifact.ts';
import { withTempWorkspace } from '../../testkit/workspace.ts';

test.skipIf(process.platform !== 'linux' && process.platform !== 'win32')('release publication rejects a non-directory accepted destination before source preparation', async () => {
  return withTempWorkspace(async root => {
    const parent = path.join(root, 'package');
    await fs.mkdir(parent);
    const destination = path.join(parent, 'dist');
    await fs.writeFile(destination, 'not-an-artifact-directory\n');

    await expect(buildReleaseArtifact(path.join(root, 'not-a-repository'), destination))
      .rejects.toThrow('Existing release artifact destination is not an ordinary non-reparse directory');
    await expect(fs.readFile(destination, 'utf8')).resolves.toBe('not-an-artifact-directory\n');
  }, 'sec-release-destination-file-');
});

test.skipIf(process.platform !== 'linux')('release publication rejects a symlinked destination parent before source preparation', async () => {
  return withTempWorkspace(async root => {
    const physicalParent = path.join(root, 'physical-package');
    const linkedParent = path.join(root, 'linked-package');
    await fs.mkdir(physicalParent);
    await fs.symlink(physicalParent, linkedParent);

    await expect(buildReleaseArtifact(
      path.join(root, 'not-a-repository'),
      path.join(linkedParent, 'dist')
    )).rejects.toMatchObject({
      name: 'PhysicalNoFollowError'
    });
    await expect(fs.lstat(path.join(physicalParent, 'dist')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  }, 'sec-release-destination-link-');
});
