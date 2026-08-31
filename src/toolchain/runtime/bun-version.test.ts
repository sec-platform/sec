import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import {
  assertCanonicalBunPackageRunner,
  loadCanonicalBunRuntimeVersion,
  readCanonicalBunRuntimeProjection
} from './bun-version.ts';

test('the current Bun runtime projections are derived from the canonical version file', async () => {
  const canonicalVersion = await loadCanonicalBunRuntimeVersion();
  const projection = await readCanonicalBunRuntimeProjection();

  expect(projection).toEqual({
    version: canonicalVersion,
    packageManager: `bun@${canonicalVersion}`,
    miseVersion: canonicalVersion
  });
});

test('package-runner admission rejects a different executable and runtime generation', () => {
  const canonicalVersion = '8.1.0';
  expect(() => assertCanonicalBunPackageRunner(canonicalVersion, {
    executablePath: path.join('C:', 'runtime', 'bun.exe'),
    packageManifestPath: path.join('C:', 'package', 'package.json'),
    packageRunnerPath: path.join('C:', 'other-runtime', 'bun.exe'),
    runtimeVersion: canonicalVersion
  }, path.join('C:', 'package'))).toThrow('runner differs from the active Bun executable');
  expect(() => assertCanonicalBunPackageRunner(canonicalVersion, {
    executablePath: path.join('C:', 'runtime', 'bun.exe'),
    packageManifestPath: path.join('C:', 'package', 'package.json'),
    packageRunnerPath: path.join('C:', 'runtime', 'bun.exe'),
    runtimeVersion: '8.1.1'
  }, path.join('C:', 'package'))).toThrow('active Bun runtime does not match .bun-version');
  expect(() => assertCanonicalBunPackageRunner(canonicalVersion, {
    executablePath: path.join('C:', 'runtime', 'bun.exe'),
    packageManifestPath: path.join('C:', 'other-package', 'package.json'),
    packageRunnerPath: path.join('C:', 'runtime', 'bun.exe'),
    runtimeVersion: canonicalVersion
  }, path.join('C:', 'package'))).toThrow(
    'package command metadata does not identify the canonical package manifest'
  );
});

test('projection readback rejects a package-manager generation that diverges from the owner', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-bun-generation-'));
  try {
    await Promise.all([
      writeFile(path.join(root, '.bun-version'), '8.1.0\n', 'utf8'),
      writeFile(
        path.join(root, 'package.json'),
        `${JSON.stringify({
          packageManager: 'bun@8.1.1',
          scripts: { sec: '"$npm_execpath" ./entry.ts' }
        })}\n`,
        'utf8'
      ),
      writeFile(path.join(root, 'mise.toml'), '[tools]\nbun = "8.1.0"\n', 'utf8')
    ]);

    await expect(readCanonicalBunRuntimeProjection(root)).rejects.toThrow(
      'package.json packageManager does not project .bun-version'
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('projection readback rejects duplicate package metadata before projection', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-bun-generation-'));
  try {
    await Promise.all([
      writeFile(path.join(root, '.bun-version'), '8.1.0\n', 'utf8'),
      writeFile(
        path.join(root, 'package.json'),
        '{"packageManager":"bun@8.1.0","packageManager":"bun@8.1.0"}\n',
        'utf8'
      ),
      writeFile(path.join(root, 'mise.toml'), '[tools]\nbun = "8.1.0"\n', 'utf8')
    ]);

    await expect(readCanonicalBunRuntimeProjection(root)).rejects.toThrow('duplicate key');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('projection readback rejects package scripts that resolve Bun through PATH', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-bun-generation-'));
  try {
    await Promise.all([
      writeFile(path.join(root, '.bun-version'), '8.1.0\n', 'utf8'),
      writeFile(
        path.join(root, 'package.json'),
        '{"packageManager":"bun@8.1.0","scripts":{"typecheck":"bun ./src/check.ts"}}\n',
        'utf8'
      ),
      writeFile(path.join(root, 'mise.toml'), '[tools]\nbun = "8.1.0"\n', 'utf8')
    ]);

    await expect(readCanonicalBunRuntimeProjection(root)).rejects.toThrow(
      'package.json script "typecheck" resolves Bun through PATH'
    );
    await writeFile(
      path.join(root, 'package.json'),
      '{"packageManager":"bun@8.1.0","scripts":{"typecheck":"$npm_execpath ./src/check.ts"}}\n',
      'utf8'
    );
    await expect(readCanonicalBunRuntimeProjection(root)).rejects.toThrow(
      'package.json script "typecheck" does not quote the exact package runner'
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
