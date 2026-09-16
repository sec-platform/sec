import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { PhysicalNoFollowError } from '../../src/runtime-state/physical/runtime/physical-no-follow.ts';
import { ProjectIntegrityError } from '../../src/workspace/contract/project-integrity.ts';
import {
  getProjectBaselinePath,
  readProjectBaseline
} from '../../src/workspace/runtime/project-baseline.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

async function writeRawBaseline(workspaceRoot: string, value: unknown): Promise<void> {
  await writeRawBaselineSource(workspaceRoot, `${JSON.stringify(value)}\n`);
}

async function writeRawBaselineSource(
  workspaceRoot: string,
  source: string | Uint8Array
): Promise<void> {
  const baselinePath = getProjectBaselinePath(workspaceRoot);
  await fs.mkdir(path.dirname(baselinePath), { recursive: true });
  await fs.writeFile(baselinePath, source);
}

function expectDriftFailure(read: () => unknown): void {
  try {
    read();
    throw new Error('Expected Project baseline read to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(ProjectIntegrityError);
    expect(error).toMatchObject({ code: 'ERROR-DRIFT-001' });
  }
}

test('project baseline accepts only canonical unique portable artifact hash records', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await writeRawBaseline(workspaceRoot, {
      formatVersion: '1',
      artifacts: [
        { path: 'app/a.ts', hash: 'a'.repeat(64) },
        { path: 'app/b.ts', hash: 'b'.repeat(64) }
      ]
    });
    const baseline = readProjectBaseline(workspaceRoot);
    expect(baseline).not.toBeNull();
    expect(baseline!.artifacts.map((artifact) => artifact.path)).toEqual(['app/a.ts', 'app/b.ts']);
    expect(Object.isFrozen(baseline)).toBe(true);
    expect(Object.isFrozen(baseline!.artifacts)).toBe(true);

    const decomposedUnicodePath = `app/${'e\u0301'}.tsx`;
    for (const malformed of [
      { formatVersion: 'stale', artifacts: [] },
      { formatVersion: '1', artifacts: {} },
      { formatVersion: '1', artifacts: [{ path: 'app\\page.tsx', hash: 'a'.repeat(64) }] },
      { formatVersion: '1', artifacts: [{ path: '../page.tsx', hash: 'a'.repeat(64) }] },
      { formatVersion: '1', artifacts: [{ path: 'app/../page.tsx', hash: 'a'.repeat(64) }] },
      { formatVersion: '1', artifacts: [{ path: 'app/CON.txt', hash: 'a'.repeat(64) }] },
      { formatVersion: '1', artifacts: [{ path: decomposedUnicodePath, hash: 'a'.repeat(64) }] },
      { formatVersion: '1', artifacts: [{ path: 'app/page.tsx', hash: 'not-a-hash' }] },
      {
        formatVersion: '1',
        artifacts: [
          { path: 'app/page.tsx', hash: 'a'.repeat(64) },
          { path: 'app/page.tsx', hash: 'b'.repeat(64) }
        ]
      },
      {
        formatVersion: '1',
        artifacts: [
          { path: 'app/b.ts', hash: 'b'.repeat(64) },
          { path: 'app/a.ts', hash: 'a'.repeat(64) }
        ]
      },
      {
        formatVersion: '1',
        artifacts: [{ path: 'app/page.tsx', hash: 'a'.repeat(64) }],
        surprise: true
      },
      {
        formatVersion: '1',
        artifacts: [{ path: 'app/page.tsx', hash: 'a'.repeat(64), surprise: true }]
      }
    ]) {
      await writeRawBaseline(workspaceRoot, malformed);
      expectDriftFailure(() => readProjectBaseline(workspaceRoot));
    }

    for (const ambiguous of [
      '{"formatVersion":"1","formatVersion":"1","artifacts":[]}\n',
      `{"formatVersion":"1","artifacts":[{"path":"app/page.tsx","path":"app/page.tsx","hash":"${'a'.repeat(64)}"}]}\n`
    ]) {
      await writeRawBaselineSource(workspaceRoot, ambiguous);
      expectDriftFailure(() => readProjectBaseline(workspaceRoot));
    }

    await writeRawBaselineSource(workspaceRoot, Uint8Array.from([0xc3, 0x28]));
    expectDriftFailure(() => readProjectBaseline(workspaceRoot));
  });
});

test('project baseline reader rejects a linked cache ancestor instead of following external state', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const baselinePath = getProjectBaselinePath(workspaceRoot);
    const cachePath = path.dirname(baselinePath);
    const externalCache = path.join(workspaceRoot, 'external-cache');
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.mkdir(externalCache, { recursive: true });
    await fs.writeFile(
      path.join(externalCache, path.basename(baselinePath)),
      `${JSON.stringify({ formatVersion: '1', artifacts: [] })}\n`,
      'utf8'
    );
    await fs.symlink(
      externalCache,
      cachePath,
      process.platform === 'win32' ? 'junction' : 'dir'
    );

    expect(() => readProjectBaseline(workspaceRoot)).toThrow(PhysicalNoFollowError);
  });
});
