import { describe, expect, test } from 'bun:test';

import { projectInstallManifest, type InstalledManifestEntry } from '../../src/application/install-manifest.ts';
import { formatInstallManifest } from '../../src/entry/cli/install-manifest.ts';

describe('install manifest presentation boundary', () => {
  test('application owns stable aggregation and entry only renders the finite view', () => {
    const source: InstalledManifestEntry[] = [
      { blockId: 'z/api', action: 'copy', registryKind: 'official', status: 'installed' as const },
      { blockId: 'a/db', action: 'generate', registryKind: 'private', status: 'installed' as const },
      { blockId: 'z/api', action: 'copy', registryKind: 'official', status: 'installed' as const }
    ];
    const view = projectInstallManifest(source);
    expect(view).toEqual({
      stepCount: 3,
      blocks: ['a/db', 'z/api'],
      actions: [
        { id: 'copy', count: 2 },
        { id: 'generate', count: 1 }
      ],
      registryKinds: [
        { id: 'official', count: 2 },
        { id: 'private', count: 1 }
      ],
      statuses: [{ id: 'installed', count: 3 }]
    });
    expect(source.map((entry) => entry.blockId)).toEqual(['z/api', 'a/db', 'z/api']);
    expect(formatInstallManifest(view)).toBe([
      'Install manifest 3 steps',
      'Blocks: a/db, z/api',
      'Actions: copy=2, generate=1',
      'Registry kinds: official=2, private=1',
      'Statuses: installed=3'
    ].join('\n'));
  });
});
