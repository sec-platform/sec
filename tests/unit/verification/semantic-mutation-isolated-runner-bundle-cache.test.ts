import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  createSemanticMutationIsolatedRunnerBundleLoaderForTests,
  relocateSemanticMutationIsolatedRunnerBundleForTests
} from '../../../src/adapters/verification/run-semantic-mutation-isolated-child.ts';
import { SEMANTIC_MUTATION_ISOLATED_RUNNER_CORE_RELATIVE_PATH } from '../../../src/adapters/verification/isolation/isolated-verification-child-progress.ts';
import { SEMANTIC_MUTATION_ISOLATED_COMPILER_DEPS_RELATIVE_ROOT } from '../../../src/adapters/verification/semantic-mutation-isolated-runtime-plan.ts';

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
  const load = createSemanticMutationIsolatedRunnerBundleLoaderForTests(async () => {
    builds += 1;
    await release.promise;
    return new Uint8Array([1, 2, 3]);
  });

  const first = load();
  const second = load();
  try {
    await Promise.resolve();
    expect(builds).toBe(1);
  } finally {
    release.resolve();
    await Promise.allSettled([first, second]);
  }

  const [firstBytes, secondBytes] = await Promise.all([first, second]);
  expect(firstBytes).toEqual(new Uint8Array([1, 2, 3]));
  expect(secondBytes).toEqual(new Uint8Array([1, 2, 3]));
  firstBytes[0] = 9;
  expect(await load()).toEqual(new Uint8Array([1, 2, 3]));
  expect(builds).toBe(1);
});

test('isolated runner bundle loader evicts a failed attempt', async () => {
  let builds = 0;
  const load = createSemanticMutationIsolatedRunnerBundleLoaderForTests(async () => {
    builds += 1;
    if (builds === 1) throw new Error('injected bundle build failure');
    return new Uint8Array([4]);
  });

  await expect(load()).rejects.toThrow('injected bundle build failure');
  expect(await load()).toEqual(new Uint8Array([4]));
  expect(await load()).toEqual(new Uint8Array([4]));
  expect(builds).toBe(2);
});

test('isolated runner relocation resolves the compiler runtime from each deployed bundle and rejects an unrelated source', async () => {
  const buildModulesRoot = path.resolve('synthetic-compiler-modules');
  const compilerRuntimeRoot = path.join(buildModulesRoot, 'typescript', 'lib');
  const assignment = (directory: string) => new TextEncoder().encode(
    `var __dirname = ${JSON.stringify(directory)}, ` +
    `__filename = ${JSON.stringify(path.join(directory, 'typescript.js'))};`
  );

  const relocated = new TextDecoder().decode(
    relocateSemanticMutationIsolatedRunnerBundleForTests(
      assignment(compilerRuntimeRoot),
      buildModulesRoot
    )
  );
  expect(relocated).not.toContain(buildModulesRoot);
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'sec-runner-relocation-'));
  try {
    for (const name of ['first root#', 'second root%']) {
      const deploymentRoot = path.join(temporaryRoot, name);
      const modulePath = path.join(deploymentRoot, SEMANTIC_MUTATION_ISOLATED_RUNNER_CORE_RELATIVE_PATH);
      mkdirSync(path.dirname(modulePath), { recursive: true });
      writeFileSync(modulePath, `${relocated}\nexport { __dirname as directory, __filename as filename };\n`);
      const observed = await import(pathToFileURL(modulePath).href);
      const runtimeDirectory = path.join(deploymentRoot,
        SEMANTIC_MUTATION_ISOLATED_COMPILER_DEPS_RELATIVE_ROOT, 'typescript', 'lib');
      expect(observed.directory).toBe(runtimeDirectory);
      expect(observed.filename).toBe(path.join(runtimeDirectory, 'typescript.js'));
    }
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }

  expect(() => relocateSemanticMutationIsolatedRunnerBundleForTests(
    assignment(path.resolve('foreign-compiler-runtime')),
    buildModulesRoot
  )).toThrow('unexpected relocation source');
});
