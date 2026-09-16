import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { applyOverrides } from '../../src/compiler/compose/apply-overrides.ts';
import {
  publishExclusiveCanonicalWorkspaceFile,
  publishExpectedCanonicalWorkspaceFile
} from '../../src/workspace/files.ts';
import { getWorkspacePaths } from '../../src/workspace/runtime/paths.ts';

test('exclusive workspace publication is idempotent for exact bytes and rejects conflicting bytes', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-workspace-publish-'));
  try {
    const targetPath = path.join(workspaceRoot, 'src', 'custom', 'demo.ts');
    const first = await publishExclusiveCanonicalWorkspaceFile({
      workspaceRoot,
      targetPath,
      bytes: Buffer.from('export const value = 1;\n'),
      label: 'test exclusive publication'
    });
    expect(first.created).toBe(true);

    const second = await publishExclusiveCanonicalWorkspaceFile({
      workspaceRoot,
      targetPath,
      bytes: Buffer.from('export const value = 1;\n'),
      label: 'test exclusive publication'
    });
    expect(second.created).toBe(false);

    await expect(publishExclusiveCanonicalWorkspaceFile({
      workspaceRoot,
      targetPath,
      bytes: Buffer.from('export const value = 2;\n'),
      label: 'test exclusive publication'
    })).rejects.toThrow();
    expect(await fs.readFile(targetPath, 'utf8')).toBe('export const value = 1;\n');
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('expected workspace publication rejects a changed preimage without overwriting it', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-workspace-preimage-publish-'));
  try {
    const targetPath = path.join(workspaceRoot, 'src', 'demo.ts');
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, 'version: one\n');

    await publishExpectedCanonicalWorkspaceFile({
      workspaceRoot,
      targetPath,
      expectedBytes: Buffer.from('version: one\n'),
      bytes: Buffer.from('version: two\n'),
      label: 'test expected publication'
    });
    expect(await fs.readFile(targetPath, 'utf8')).toBe('version: two\n');

    await expect(publishExpectedCanonicalWorkspaceFile({
      workspaceRoot,
      targetPath,
      expectedBytes: Buffer.from('version: one\n'),
      bytes: Buffer.from('version: three\n'),
      label: 'test expected publication'
    })).rejects.toThrow(/preimage changed/);
    expect(await fs.readFile(targetPath, 'utf8')).toBe('version: two\n');
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('override publication plans the complete preimage and rejects final-fence drift', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-override-publish-'));
  try {
    const overrideRoot = getWorkspacePaths(workspaceRoot).overridesRoot;
    const overridePath = path.join(overrideRoot, 'patches', 'demo.ts');
    const targetPath = path.join(workspaceRoot, 'src', 'demo.ts');
    await fs.mkdir(path.dirname(overridePath), { recursive: true });
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(path.join(overrideRoot, 'override-manifest.yaml'), [
      'overrides:',
      '  - id: demo',
      '    entry: patches/demo.ts',
      '    target: src/demo.ts',
      '    reason: exact publication',
      '    source: manual',
      '    conflictsWith: []',
      ''
    ].join('\n'));
    await fs.writeFile(overridePath, 'export const value = "override";\n');
    await fs.writeFile(targetPath, 'export const value = "original";\n');

    await applyOverrides(workspaceRoot);
    expect(await fs.readFile(targetPath, 'utf8')).toBe('export const value = "override";\n');

    await fs.writeFile(targetPath, 'export const value = "second-preimage";\n');
    let fenceCount = 0;
    await expect(applyOverrides(workspaceRoot, async () => {
      fenceCount += 1;
      if (fenceCount === 1) {
        await fs.writeFile(targetPath, 'export const value = "external-writer";\n');
      }
    })).rejects.toThrow(/target preimage changed after planning/);
    expect(await fs.readFile(targetPath, 'utf8')).toBe('export const value = "external-writer";\n');

    await fs.writeFile(targetPath, 'export const value = "source-race-preimage";\n');
    await fs.writeFile(overridePath, 'export const value = "override";\n');
    fenceCount = 0;
    await expect(applyOverrides(workspaceRoot, async () => {
      fenceCount += 1;
      if (fenceCount === 2) {
        await fs.writeFile(overridePath, 'export const value = "external-source";\n');
      }
    })).rejects.toThrow(/source changed before publication/);
    expect(await fs.readFile(targetPath, 'utf8'))
      .toBe('export const value = "source-race-preimage";\n');

    const secondOverridePath = path.join(overrideRoot, 'patches', 'second.ts');
    const secondTargetPath = path.join(workspaceRoot, 'src', 'second.ts');
    await fs.writeFile(path.join(overrideRoot, 'override-manifest.yaml'), [
      'overrides:',
      '  - id: demo',
      '    entry: patches/demo.ts',
      '    target: src/demo.ts',
      '    reason: exact publication',
      '    source: manual',
      '    conflictsWith: []',
      '  - id: second',
      '    entry: patches/second.ts',
      '    target: src/second.ts',
      '    reason: exact publication',
      '    source: manual',
      '    conflictsWith: []',
      ''
    ].join('\n'));
    await fs.writeFile(overridePath, 'export const value = "first-override";\n');
    await fs.writeFile(secondOverridePath, 'export const value = "second-override";\n');
    await fs.writeFile(targetPath, 'export const value = "first-preimage";\n');
    await fs.writeFile(secondTargetPath, 'export const value = "second-preimage";\n');
    const rejectAfterFirstPublication = async (): Promise<void> => {
      try {
        if (await fs.readFile(targetPath, 'utf8') !== 'export const value = "first-override";\n') {
          return;
        }
      } catch {
        return;
      }
      throw new Error('forward publication authorization revoked');
    };
    await expect(applyOverrides(workspaceRoot, rejectAfterFirstPublication))
      .rejects.toThrow('forward publication authorization revoked');
    expect(await fs.readFile(targetPath, 'utf8')).toBe('export const value = "first-preimage";\n');
    expect(await fs.readFile(secondTargetPath, 'utf8')).toBe('export const value = "second-preimage";\n');

    await fs.rm(targetPath);
    await expect(applyOverrides(workspaceRoot, rejectAfterFirstPublication))
      .rejects.toThrow('forward publication authorization revoked');
    await expect(fs.access(targetPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(secondTargetPath, 'utf8')).toBe('export const value = "second-preimage";\n');
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});
