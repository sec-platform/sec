import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { saveLock } from '../../../src/adapters/workspace/lock.ts';
import { expectCliJson, expectCliSuccess } from '../../testkit/cli.ts';
import { semanticArtifactLock } from '../../testkit/semantic-lock.ts';
import { withTempWorkspace } from '../../testkit/workspace.ts';

test('lock inspect routes canonical lock through application projection and entry rendering without changing JSON', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const lock = semanticArtifactLock('generated/lock-inspect-routing.ts');
    lock.resolvedBlocks = [
      { id: 'zeta', version: '2.0.0', installOrder: 2 },
      { id: 'beta', version: '1.0.0', installOrder: 1 },
      { id: 'alpha', version: '1.1.0', installOrder: 1 }
    ].map(block => ({
      ...block, kind: 'capability', manifestPath: `model/blocks/${block.id}/block.yaml`,
      registrySourceId: 'official', registryKind: 'official', registryLocation: 'compiler',
      registryPath: `catalog/registry/official/${block.id}`
    } as const));
    lock.generatedPaths.push('generated/another.ts');
    lock.acceptancePlan = ['acceptance:a'];
    lock.passStatus.verify = 'failed';
    await fs.mkdir(path.join(workspaceRoot, '.sec'), { recursive: true });
    await saveLock(workspaceRoot, lock);

    const { stdout } = await expectCliSuccess(workspaceRoot, ['lock', 'inspect']);
    expect(stdout).toMatch(/semantic-artifact-test(?=$|[\s;,()])/u);
    expect(stdout).toMatch(/stack=typescript-library(?=$|[\s;,()])/u);
    expect(stdout).toMatch(/mode=single-tenant(?=$|[\s;,()])/u);
    expect(stdout).toMatch(/\bblocks=3(?=$|[\s;,()])/u);
    expect(stdout).toMatch(/\bgenerated=2(?=$|[\s;,()])/u);
    expect(stdout).toMatch(/\bacceptance=1(?=$|[\s;,()])/u);
    expect(stdout).toMatch(/Block order[^\n]*1:alpha@1\.1\.0(?=$|[\s;,()]).*1:beta@1\.0\.0(?=$|[\s;,()]).*2:zeta@2\.0\.0(?=$|[\s;,()])/u);
    const passes = stdout.split('\n').find((line) => /^Pass status\b/u.test(line));
    expect(passes).toMatch(/\bpending=3(?=$|[\s;,()])/u);
    expect(passes).toMatch(/\bfailed=1(?=$|[\s;,()])/u);
    expect(passes).toMatch(/\bsucceeded=4(?=$|[\s;,()])/u);

    const json = await expectCliJson(workspaceRoot, ['lock', 'inspect', '--json']);
    expect(json).toEqual(lock);
  });
});
