import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmod, cp, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  inspectNoFollowDirectoryChain,
  inspectNoFollowDirectoryLeaf,
  materializeRetainedNoFollowProvenDirectoryGeneration,
  retainNoFollowGenerationExecutable,
  retainNoFollowOrdinaryFile,
  retireNoFollowDirectoryTree,
  scanNoFollowDirectoryTreeInventory
} from '../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts';
import { settleWorkspaceCallback } from '../testkit/workspace-cleanup.ts';

const linuxTest = test.skipIf(process.platform !== 'linux' || process.arch !== 'x64');

for (const predecessorMode of [0o755, 0o555]) {
  linuxTest(`the locked native checker preserves package lookup and retires a ${predecessorMode.toString(8)} fixture`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sec-native-package-layout-'));
    const rootIdentity = inspectNoFollowDirectoryChain(root).target;
    const parent = inspectNoFollowDirectoryChain(path.dirname(root)).target;
    let generation: Awaited<ReturnType<typeof materializeRetainedNoFollowProvenDirectoryGeneration>> | undefined;
    await settleWorkspaceCallback(async () => {
      const nativeRoot = path.resolve('node_modules/@typescript/typescript-linux-x64');
      const nativeVersion = JSON.parse(await readFile(path.join(nativeRoot, 'package.json'), 'utf8')).version;
      const selectedVersion = JSON.parse(await readFile('node_modules/@typescript/native/package.json', 'utf8')).version;
      expect(nativeVersion).toBe(selectedVersion);
      const packageRoot = path.join(root, 'package');
      await cp(path.join(nativeRoot, 'lib'), packageRoot, { recursive: true });
      // Managed dependencies are read-only. Copying them must not make fixture
      // cleanup depend on a writable predecessor mode or a privileged runner.
      await chmod(packageRoot, predecessorMode);
      await writeFile(path.join(root, 'good.ts'), 'const count: number = 1;\n');
      await writeFile(path.join(root, 'bad.ts'), 'const count: number = "wrong";\n');
      const identity = inspectNoFollowDirectoryChain(packageRoot).target;
      const inventory = scanNoFollowDirectoryTreeInventory(identity, {
        deadlineAtMs: performance.now() + 30_000, maximumBytes: 256 * 1024 * 1024, maximumEntries: 1024
      });
      generation = await materializeRetainedNoFollowProvenDirectoryGeneration({
        root: identity, inventory, proofText: null, releaseMode: 'restore-owner-write',
        deadlineAtUnixMs: Date.now() + 30_000,
        binding: { generationDigest: `sha256:${'1'.repeat(64)}`, treeDigest: `sha256:${'2'.repeat(64)}`, treeEntryCount: inventory.length }
      });
      const args = ['--noEmit', '--skipLibCheck', '--lib', 'es5', path.join(root, 'good.ts')];
      const anonymous = retainNoFollowOrdinaryFile(inspectNoFollowDirectoryChain(packageRoot), 'tsc', undefined, 'anonymous test image', 3, 'executable');
      try {
        const result = spawnSync(anonymous.childPath, args, { cwd: root, encoding: 'utf8', timeout: 10_000,
          stdio: ['ignore', 'pipe', 'pipe', anonymous.stdioSourceDescriptor!] });
        expect(result.error).toBeUndefined();
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('lib.d.ts does not exist');
      } finally { anonymous.dispose(); }
      const retained = await retainNoFollowGenerationExecutable(generation.generation, 'tsc');
      try {
        const options = { cwd: root, encoding: 'utf8' as const, timeout: 10_000,
          stdio: ['ignore', 'pipe', 'pipe', retained.stdioSourceDescriptor!] as ['ignore', 'pipe', 'pipe', number] };
        const good = spawnSync(retained.childPath, args, options);
        expect(good.error).toBeUndefined();
        expect(good.status, good.stderr + good.stdout).toBe(0);
        const bad = spawnSync(retained.childPath, [...args.slice(0, -1), path.join(root, 'bad.ts')], options);
        expect(bad.error).toBeUndefined();
        expect(bad.status).not.toBe(0);
        expect(bad.stdout).toContain('TS2322');
        await generation.generation.assertAuthorityCurrent();
        await expect(retainNoFollowGenerationExecutable(generation.generation, '../good.ts')).rejects.toThrow('canonical contained path');
        await expect(retainNoFollowGenerationExecutable({ ...generation.generation }, 'tsc')).rejects.toThrow('was not issued');
        await expect(retainNoFollowGenerationExecutable(generation.generation, 'lib.d.ts')).rejects.toThrow('read-only executable');
      } finally { retained.dispose(); }
      const retirement = await generation.generation.retire();
      expect(await generation.generation.retire()).toBe(retirement);
      expect((await stat(packageRoot)).mode & 0o777).toBe(predecessorMode);
      await expect(retainNoFollowGenerationExecutable(generation.generation, 'tsc')).rejects.toThrow();
    }, async () => {
      if (generation) await generation.generation.retire();
      // Retirement restores predecessor modes, which may still be read-only.
      // Only the exact task-owned tree receives temporary owner permissions;
      // the external dependency source and any substituted root remain protected.
      const inventory = scanNoFollowDirectoryTreeInventory(rootIdentity, {
        includePermissionMode: true,
        deadlineAtMs: performance.now() + 30_000,
        maximumBytes: 256 * 1024 * 1024,
        maximumEntries: 1024
      });
      expect(retireNoFollowDirectoryTree({
        root: rootIdentity, parent, inventory, restoreOwnerPermissions: true,
        deadlineAtMonotonicMs: performance.now() + 30_000
      }).status).toBe('physically-absent');
      expect(inspectNoFollowDirectoryLeaf(parent, path.basename(root))).toBeNull();
    });
  }, 30_000);
}
