import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { saveLock } from '../../src/adapters/workspace/lock.ts';
import { projectLockInspect } from '../../src/application/lock-inspect.ts';
import { formatLockInspect } from '../../src/entry/cli/lock-inspect.ts';
import { expectCliJson, expectCliSuccess } from '../testkit/cli.ts';
import { semanticArtifactLock } from '../testkit/semantic-lock.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

test('lock inspect routes canonical lock through application projection and entry rendering without changing JSON', async () => {
  // Nonempty block ordering and failed pass counts complement the persisted lock below.
  {
    const source = {
      app: { name: 'demo', stack: 'typescript', mode: 'service' },
      resolvedBlocks: [
        { id: 'zeta', version: '2.0.0', installOrder: 2 },
        { id: 'beta', version: '1.0.0', installOrder: 1 },
        { id: 'alpha', version: '1.1.0', installOrder: 1 }
      ],
      generatedPaths: ['src/a.ts', 'src/b.ts'],
      acceptancePlan: ['acceptance:a'],
      passStatus: {
        parse: 'succeeded',
        verify: 'failed',
        lock: 'succeeded'
      }
    } as const;
    const originalOrder = source.resolvedBlocks.map((block) => block.id);

    const view = projectLockInspect(source);

    expect(view).toEqual({
      appName: 'demo',
      stack: 'typescript',
      mode: 'service',
      blockCount: 3,
      generatedCount: 2,
      acceptanceCount: 1,
      blockOrder: ['1:alpha@1.1.0', '1:beta@1.0.0', '2:zeta@2.0.0'],
      passStates: ['succeeded', 'failed', 'succeeded']
    });
    expect(source.resolvedBlocks.map((block) => block.id)).toEqual(originalOrder);
    const text = formatLockInspect(view);
    expect(text).toMatch(/Graph lock\s+demo(?=$|[\s;,()])/u);
    for (const field of ['stack=typescript', 'mode=service', 'blocks=3', 'generated=2', 'acceptance=1']) {
      expect(text).toMatch(new RegExp(`${field}(?=$|[\\s;,()])`, 'u'));
    }
    expect(text).toMatch(/Block order[^\n]*1:alpha@1\.1\.0(?=$|[\s;,()]).*1:beta@1\.0\.0(?=$|[\s;,()]).*2:zeta@2\.0\.0(?=$|[\s;,()])/u);
    const passes = text.split('\n').find((line) => /^Pass status\b/u.test(line));
    expect(passes).toMatch(/\bfailed=1(?=$|[\s;,()])/u);
    expect(passes).toMatch(/\bsucceeded=2(?=$|[\s;,()])/u);
  }
  await withTempWorkspace(async (workspaceRoot) => {
    const lock = semanticArtifactLock('generated/lock-inspect-routing.ts');
    await fs.mkdir(path.join(workspaceRoot, '.sec'), { recursive: true });
    await saveLock(workspaceRoot, lock);

    const { stdout } = await expectCliSuccess(workspaceRoot, ['lock', 'inspect']);
    expect(stdout).toMatch(/semantic-artifact-test(?=$|[\s;,()])/u);
    expect(stdout).toMatch(/stack=typescript-library(?=$|[\s;,()])/u);
    expect(stdout).toMatch(/mode=single-tenant(?=$|[\s;,()])/u);
    expect(stdout).toMatch(/\bblocks=0(?=$|[\s;,()])/u);
    expect(stdout).toMatch(/\bgenerated=1(?=$|[\s;,()])/u);
    expect(stdout).toMatch(/\bacceptance=0(?=$|[\s;,()])/u);
    const passes = stdout.split('\n').find((line) => /^Pass status\b/u.test(line));
    expect(passes).toMatch(/\bpending=4(?=$|[\s;,()])/u);
    expect(passes).toMatch(/\bsucceeded=4(?=$|[\s;,()])/u);

    const json = await expectCliJson(workspaceRoot, ['lock', 'inspect', '--json']);
    expect(json).toEqual(lock);
  });
});
