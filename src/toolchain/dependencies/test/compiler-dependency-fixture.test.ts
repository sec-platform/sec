import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import {
  issueCompilerDependencyFixtureOperation,
  rematerializeCompilerDependencyFixtureOperation,
  retireCompilerDependencyFixtureOperation,
  settleCompilerDependencyFixtureOperation
} from './compiler-dependency-fixture.ts';

function fixtureDescriptor(dependencyRootPath: string) {
  return {
    dependencies: { commander: '1.0.0' },
    dependencyRootPath,
    devDependencies: { 'ts-morph': '1.0.0', typescript: '1.0.0' },
    lockfileBytes: 'fixture-lock-v1\n',
    packages: [{ name: 'commander', version: '1.0.0' }, {
      main: 'dist/ts-morph-common.js',
      name: '@ts-morph/common',
      version: '1.0.0'
    }, {
      main: './script/mod.js',
      name: 'code-block-writer',
      version: '1.0.0'
    }, {
      main: 'dist/ts-morph.js',
      name: 'ts-morph',
      version: '1.0.0'
    }, {
      main: './lib/typescript.js',
      name: 'typescript',
      version: '1.0.0'
    }]
  } as const;
}

test('dependency fixture operation owns lifecycle-backed publication and retirement', async () => {
  const ownerRoot = await mkdtemp(path.join(tmpdir(), 'sec-dependency-fixture-owner-'));
  try {
    const operation = await issueCompilerDependencyFixtureOperation(
      fixtureDescriptor(path.join(ownerRoot, 'dependencies'))
    );
    await expect(settleCompilerDependencyFixtureOperation({ ...operation }))
      .rejects.toThrow('was not issued by the dependency test owner');

    const first = await settleCompilerDependencyFixtureOperation(operation);
    const second = await rematerializeCompilerDependencyFixtureOperation(
      operation,
      'fixture-lock-v2\n'
    );
    expect(first.nodeModulesPath).toBe(second.nodeModulesPath);
    expect(second.executionGenerationAuthority).not.toBe(first.executionGenerationAuthority);

    await retireCompilerDependencyFixtureOperation(operation);
    await expect(settleCompilerDependencyFixtureOperation(operation))
      .rejects.toThrow('operation is retired');
  } finally {
    await rm(ownerRoot, { recursive: true, force: true });
  }
}, 30_000);

test('dependency fixture rejects noncanonical package materialization before publication', async () => {
  const ownerRoot = await mkdtemp(path.join(tmpdir(), 'sec-dependency-fixture-invalid-'));
  try {
    await expect(issueCompilerDependencyFixtureOperation({
      ...fixtureDescriptor(path.join(ownerRoot, 'dependencies')),
      packages: [{ name: '../foreign', version: '1.0.0' }]
    })).rejects.toThrow('package name is noncanonical');
  } finally {
    await rm(ownerRoot, { recursive: true, force: true });
  }
});
