import { expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { loadManifestById } from '../../src/compiler/parse/load-manifest.ts';

const rootManifest = `id: example/basic
version: 2.0.0
kind: capability
stackProfiles:
  - typescript-library
requires: []
provides:
  - example/read
conflicts: []
installs:
  - kind: copy
    from: files/example.ts
    to: src/example.ts
pins:
  inputs: []
  outputs: []
slots: []
acceptance: []
routes: []
`;

const mismatchedVersionOverlay = `version: 1.0.0
`;

test('an existing explicit version manifest cannot fall back to a root manifest after declaring the wrong version', async () => {
  if (process.platform !== 'linux' && process.platform !== 'win32') return;
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-manifest-version-authority-'));
  try {
    const blockRoot = path.join(workspaceRoot, 'registry', 'example.basic');
    const versionRoot = path.join(blockRoot, 'versions', '2.0.0');
    await fs.mkdir(versionRoot, { recursive: true });
    await fs.writeFile(path.join(blockRoot, 'block.manifest.yaml'), rootManifest, 'utf8');
    await fs.writeFile(path.join(versionRoot, 'block.manifest.yaml'), mismatchedVersionOverlay, 'utf8');

    expect(() => loadManifestById('example/basic', {
      workspaceRoot,
      version: '2.0.0',
      registrySources: [{
        id: 'workspace-private',
        kind: 'private',
        location: 'workspace',
        path: 'registry'
      }]
    })).toThrow(expect.objectContaining({ code: 'MANIFEST-SCHEMA-022' }));
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});
