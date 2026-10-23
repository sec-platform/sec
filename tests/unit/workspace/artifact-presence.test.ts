import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveWorkspaceArtifactPath } from '../../../src/adapters/workspace-context.ts';
import { findPresentWorkspaceArtifacts } from '../../../src/adapters/workspace/artifact-presence.ts';
import { buildDemoChecklist } from '../../../src/bootstrap/cli/demo-checklist.ts';
import { expectCliJson, expectCliSuccess } from '../../testkit/cli.ts';
import { withTempWorkspace } from '../../testkit/workspace.ts';

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
    const { stdout } = await expectCliSuccess(root, ['demo', 'checklist']);
    const lines = stdout.split(/\r?\n/u);
    const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const field = (value: string) => new RegExp(`(?:^|[\\s;,])${escape(value)}\\s*(?=$|[;,])`, 'u');
    const summary = lines.find(line => /Demo checklist\s+passed(?=$|[\s;,])/u.test(line));
    expect(summary).toBeDefined();
    expect(summary!).toMatch(field(`items=${absent.itemCount}`));
    expect(summary!).toMatch(field('missing=0'));
    expect(lines.some(line => /Next command:\s*bun run demo:closed-loop\s*$/u.test(line))).toBe(true);
    for (const item of absent.items) {
      const identity = new RegExp(`(?:^|\\s)${escape(item.id)}:\\s*passed(?=$|[\\s;,])`, 'u');
      const rows = lines.filter(line => identity.test(line));
      expect(rows).toHaveLength(1);
      expect(rows[0]!).toMatch(field(item.artifactPath));
      expect(rows[0]!).toMatch(field(`command=${item.command}`));
    }
    await expectCliJson(root, ['demo', 'checklist', '--json', '--compact'], present, { compact: true });
  });
});
