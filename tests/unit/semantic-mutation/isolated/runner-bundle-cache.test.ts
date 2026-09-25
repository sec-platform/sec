import { expect, test } from 'bun:test';
import path from 'node:path';

import {
  createIsolatedRunnerBundleLoaderForTests,
  relocateIsolatedRunnerBundleForTests
} from '../../../../src/adapters/verification/semantic-mutation/isolated/child.ts';

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

test('isolated runner bundle loader single-flights and returns defensive bytes', async () => {
  const release = deferred();
  let builds = 0;
  const load = createIsolatedRunnerBundleLoaderForTests(async () => {
    builds += 1;
    await release.promise;
    return new Uint8Array([1, 2, 3]);
  });

  const first = load();
  const second = load();
  await Promise.resolve();
  expect(builds).toBe(1);
  release.resolve();

  const [firstBytes, secondBytes] = await Promise.all([first, second]);
  expect(firstBytes).toEqual(new Uint8Array([1, 2, 3]));
  expect(secondBytes).toEqual(new Uint8Array([1, 2, 3]));
  firstBytes[0] = 9;
  expect(await load()).toEqual(new Uint8Array([1, 2, 3]));
  expect(builds).toBe(1);
});

test('isolated runner bundle loader evicts a failed attempt', async () => {
  let builds = 0;
  const load = createIsolatedRunnerBundleLoaderForTests(async () => {
    builds += 1;
    if (builds === 1) throw new Error('injected bundle build failure');
    return new Uint8Array([4]);
  });

  await expect(load()).rejects.toThrow('injected bundle build failure');
  expect(await load()).toEqual(new Uint8Array([4]));
  expect(await load()).toEqual(new Uint8Array([4]));
  expect(builds).toBe(2);
});

test('isolated runner relocation retains only the compiler runtime and rejects an unrelated source', () => {
  const buildModulesRoot = path.resolve('synthetic-compiler-modules');
  const compilerRuntimeRoot = path.join(buildModulesRoot, 'typescript', 'lib');
  const assignment = (directory: string) => new TextEncoder().encode(
    `var __dirname = ${JSON.stringify(directory)}, ` +
    `__filename = ${JSON.stringify(path.join(directory, 'typescript.js'))};`
  );

  const relocated = new TextDecoder().decode(
    relocateIsolatedRunnerBundleForTests(
      assignment(compilerRuntimeRoot),
      buildModulesRoot
    )
  );
  expect(relocated).not.toContain(buildModulesRoot);
  expect(relocated).toContain('new URL(relativePath, import.meta.url)');

  expect(() => relocateIsolatedRunnerBundleForTests(
    assignment(path.resolve('foreign-compiler-runtime')),
    buildModulesRoot
  )).toThrow('unexpected relocation source');
});
