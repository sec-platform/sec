import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { findPresentWorkspaceArtifacts } from '../../src/adapters/workspace/artifact-presence.ts';
import { resolveWorkspaceArtifactPath } from '../../src/adapters/workspace-context.ts';
import { buildDemoChecklist } from '../../src/bootstrap/cli/demo-checklist.ts';
import { formatDemoChecklist } from '../../src/entry/cli/demo-checklist.ts';
import { expectCliJson, expectCliSuccess } from '../testkit/cli.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

async function touch(root: string, artifactPath: string) {
  const file = resolveWorkspaceArtifactPath(root, artifactPath);
  await fs.mkdir(path.dirname(file), { recursive: true });
  // This query observes existence; empty content must not imply verification.
  await fs.writeFile(file, '');
}

test('presence captures canonical paths without retaining a mutable caller array', async () => {
  await withTempWorkspace(async root => {
    const present = '.sec/artifacts/generated/present.json';
    await touch(root, present);
    const paths = [present, present, '.sec/artifacts/generated/absent.json'];
    const query = findPresentWorkspaceArtifacts(root, paths);
    paths.fill('../outside');
    expect([...(await query)]).toEqual([present]);
    expect([...(await findPresentWorkspaceArtifacts(root, []))]).toEqual([]);
  });
});

test('noncanonical artifact identities are rejected rather than normalized into probes', async () => {
  await withTempWorkspace(async root => {
    for (const invalid of ['../outside', '/tmp/private', '.sec/artifacts/../outside', '.sec\\artifacts\\report']) {
      await expect(findPresentWorkspaceArtifacts(root, [invalid])).rejects.toThrow('canonical .sec/artifacts path');
    }
  });
});

test('demo CLI preserves missing and present checklists in text, JSON and compact JSON', async () => {
  await withTempWorkspace(async root => {
    const absent = await buildDemoChecklist(root);
    expect(absent.status).toBe('attention');
    expect(absent.itemCount).toBeGreaterThan(0);
    expect(absent.missingCount).toBe(absent.itemCount);
    expect(absent.nextCommand).toBe('bun run demo:quickstart');
    await expectCliJson(root, ['demo', 'checklist', '--json'], absent);
    for (const item of absent.items) await touch(root, item.artifactPath);
    const present = await buildDemoChecklist(root);
    expect(present.status).toBe('passed');
    expect(present.missingCount).toBe(0);
    expect(present.items.every(item => item.status === 'passed')).toBe(true);
    expect(present.nextCommand).toBe('bun run demo:closed-loop');
    await expectCliSuccess(root, ['demo', 'checklist'], formatDemoChecklist(present) + '\n');
    await expectCliJson(root, ['demo', 'checklist', '--json', '--compact'], present, { compact: true });
  });
});
