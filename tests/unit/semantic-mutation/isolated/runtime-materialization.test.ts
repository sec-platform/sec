import { createHash } from 'node:crypto';
import {
  link,
  mkdir,
  mkdtemp,
  rename,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import {
  assertIsolatedRuntimeDestinationManifestForTests,
  runIsolatedRuntimeCanonicalBatchesForTests
} from '../../../../src/adapters/verification/semantic-mutation/isolated/runtime-plan.ts';

function deferred(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

test('runtime materialization scheduler starts exactly eight canonical items at a time', async () => {
  const releaseFirstBatch = deferred();
  const started: number[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const execution = runIsolatedRuntimeCanonicalBatchesForTests(
    Array.from({ length: 9 }, (_, index) => index),
    async (item, canonicalIndex) => {
      expect(item).toBe(canonicalIndex);
      started.push(canonicalIndex);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      if (canonicalIndex < 8) await releaseFirstBatch.promise;
      inFlight -= 1;
      return canonicalIndex;
    }
  );

  await Promise.resolve();
  expect(started).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  expect(maxInFlight).toBe(8);
  releaseFirstBatch.resolve();

  expect(await execution).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  expect(started).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  expect(maxInFlight).toBe(8);
});

test('runtime materialization scheduler proves lease only at canonical batch boundaries', async () => {
  let boundaryCalls = 0;
  const completed = await runIsolatedRuntimeCanonicalBatchesForTests(
    Array.from({ length: 1024 }, (_, index) => index),
    async (item) => item,
    async () => {
      boundaryCalls += 1;
    }
  );

  expect(completed).toHaveLength(1024);
  expect(boundaryCalls).toBe(129);
});

test('runtime materialization scheduler reports the lowest canonical rejection after the batch settles', async () => {
  const releaseLowerFailure = deferred();
  const execution = runIsolatedRuntimeCanonicalBatchesForTests(
    Array.from({ length: 8 }, (_, index) => index),
    async (_item, canonicalIndex) => {
      if (canonicalIndex === 2) {
        await releaseLowerFailure.promise;
        throw new Error('canonical failure 2');
      }
      if (canonicalIndex === 6) throw new Error('canonical failure 6');
      return canonicalIndex;
    }
  );

  releaseLowerFailure.resolve();
  await expect(execution).rejects.toThrow('canonical failure 2');
});

test('runtime materialization scheduler absorbs synchronous throw and settles every started batch item', async () => {
  const started: number[] = [];
  const settled: number[] = [];
  const execution = runIsolatedRuntimeCanonicalBatchesForTests(
    Array.from({ length: 8 }, (_, index) => index),
    (_item, canonicalIndex) => {
      started.push(canonicalIndex);
      if (canonicalIndex === 2) throw new Error('synchronous canonical failure 2');
      return Promise.resolve().then(() => {
        settled.push(canonicalIndex);
        return canonicalIndex;
      });
    }
  );

  await expect(execution).rejects.toThrow('synchronous canonical failure 2');
  expect(started).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  expect(settled).toEqual([0, 1, 3, 4, 5, 6, 7]);
});

test('runtime materialization scheduler does not schedule a later batch after failure or lease loss', async () => {
  const started: number[] = [];
  let supervisorStarted = false;
  const executeThenSupervise = async (): Promise<void> => {
    await runIsolatedRuntimeCanonicalBatchesForTests(
      Array.from({ length: 16 }, (_, index) => index),
      async (_item, canonicalIndex) => {
        started.push(canonicalIndex);
        if (canonicalIndex === 3) throw new Error('injected workspace lease loss');
      }
    );
    supervisorStarted = true;
  };

  await expect(executeThenSupervise()).rejects.toThrow('injected workspace lease loss');
  expect(started).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  expect(supervisorStarted).toBe(false);
});

test('runtime materialization scheduler stops before the next batch when its boundary fence is lost', async () => {
  const started: number[] = [];
  const settled: number[] = [];
  let boundaryCalls = 0;
  const execution = runIsolatedRuntimeCanonicalBatchesForTests(
    Array.from({ length: 16 }, (_, index) => index),
    async (_item, canonicalIndex) => {
      started.push(canonicalIndex);
      await Promise.resolve();
      settled.push(canonicalIndex);
      return canonicalIndex;
    },
    async () => {
      boundaryCalls += 1;
      if (boundaryCalls === 2) throw new Error('injected post-batch lease loss');
    }
  );

  await expect(execution).rejects.toThrow('injected post-batch lease loss');
  expect(started).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  expect(settled).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  expect(boundaryCalls).toBe(2);
});

test('runtime launch proof rejects byte, shape, link, reparse, and post-hash identity tamper', async () => {
  const root = await mkdtemp(path.join(tmpdir(), '.tmp-runtime-launch-proof-'));
  const compilerRoot = path.join(root, '.isolated-compiler');
  const projectDepsRoot = path.join(root, 'node_modules');
  const target = path.join(compilerRoot, 'runner.bin');
  const expectedBytes = Buffer.from('AAAA');
  const manifest = {
    stagingRoot: root,
    directories: [
      '.isolated-compiler',
      'node_modules'
    ],
    files: [{
      relativePath: '.isolated-compiler/runner.bin',
      rawDigest: `sha256:${createHash('sha256').update(expectedBytes).digest('hex')}`,
      size: expectedBytes.byteLength
    }]
  } as const;
  const reset = async (): Promise<void> => {
    await rm(compilerRoot, { recursive: true, force: true });
    await rm(projectDepsRoot, { recursive: true, force: true });
    await mkdir(compilerRoot, { recursive: true });
    await mkdir(projectDepsRoot, { recursive: true });
    await writeFile(target, expectedBytes);
  };

  try {
    await reset();
    await writeFile(target, Buffer.from('BBBB'));
    await expect(assertIsolatedRuntimeDestinationManifestForTests(manifest))
      .rejects.toThrow('destination manifest is not exact');

    await reset();
    await rm(target, { force: true });
    await expect(assertIsolatedRuntimeDestinationManifestForTests(manifest))
      .rejects.toThrow('destination structure is not exact');

    await reset();
    await writeFile(path.join(compilerRoot, 'extra.bin'), 'extra');
    await expect(assertIsolatedRuntimeDestinationManifestForTests(manifest))
      .rejects.toThrow('destination structure is not exact');

    await reset();
    const outsideHardlink = path.join(root, 'outside-hardlink.bin');
    await rm(outsideHardlink, { force: true });
    await link(target, outsideHardlink);
    await expect(assertIsolatedRuntimeDestinationManifestForTests(manifest))
      .rejects.toThrow('contains a hard link');
    await rm(outsideHardlink, { force: true });

    await reset();
    const outsideCompiler = path.join(root, 'outside-compiler');
    await rm(outsideCompiler, { recursive: true, force: true });
    await rename(compilerRoot, outsideCompiler);
    await symlink(outsideCompiler, compilerRoot, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(assertIsolatedRuntimeDestinationManifestForTests(manifest))
      .rejects.toThrow('contains a reparse entry');
    await rm(compilerRoot, { recursive: true, force: true });
    await rm(outsideCompiler, { recursive: true, force: true });

    await reset();
    const replacement = path.join(root, 'replacement.bin');
    await writeFile(replacement, expectedBytes);
    await expect(assertIsolatedRuntimeDestinationManifestForTests({
      ...manifest,
      afterHash: async () => {
        await rm(target, { force: true });
        await rename(replacement, target);
      }
    })).rejects.toThrow('changed during launch proof');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
