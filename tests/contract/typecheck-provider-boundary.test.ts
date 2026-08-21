import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  resolveInstalledTypecheckProviderV1,
  typecheckProviderArguments
} from '../../platform/toolchain/typecheck-provider.ts';

test('installed TypeCheck Provider revision comes from the actual package manifest', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-typecheck-provider-'));
  try {
    const nodeModulesPath = path.join(root, 'node_modules');
    const packageRoot = path.join(nodeModulesPath, 'typescript');
    await fs.mkdir(packageRoot, { recursive: true });
    await fs.writeFile(
      path.join(packageRoot, 'package.json'),
      `${JSON.stringify({ name: 'typescript', version: '6.0.3', bin: { tsc: './bin/tsc' } })}\n`,
      'utf8'
    );

    const provider = await resolveInstalledTypecheckProviderV1(nodeModulesPath);
    expect(provider.providerRevision).toBe('typescript@6.0.3');
    expect(provider.cliEntryRelativePath).toBe('bin/tsc');
    expect(typecheckProviderArguments(provider)).toEqual(['--noEmit', '-p', 'tsconfig.json']);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('TypeCheck Provider permits diagnostics but callers cannot override project or checking semantics', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-typecheck-provider-args-'));
  try {
    const nodeModulesPath = path.join(root, 'node_modules');
    const packageRoot = path.join(nodeModulesPath, 'typescript');
    await fs.mkdir(packageRoot, { recursive: true });
    await fs.writeFile(
      path.join(packageRoot, 'package.json'),
      `${JSON.stringify({ name: 'typescript', version: '6.0.3', bin: { tsc: './bin/tsc' } })}\n`,
      'utf8'
    );
    const provider = await resolveInstalledTypecheckProviderV1(nodeModulesPath);

    expect(typecheckProviderArguments(provider, [
      '--pretty', 'false', '--extendedDiagnostics', '--locale', 'en'
    ])).toEqual([
      '--noEmit', '-p', 'tsconfig.json',
      '--pretty', 'false', '--extendedDiagnostics', '--locale', 'en'
    ]);

    for (const args of [
      ['-p', 'other.json'],
      ['--project', 'other.json'],
      ['--noEmit'],
      ['--build'],
      ['--watch'],
      ['--incremental'],
      ['--emitDeclarationOnly'],
      ['--listFilesOnly'],
      ['src/file.ts']
    ]) {
      expect(() => typecheckProviderArguments(provider, args)).toThrow('provider-owned');
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('TypeCheck Provider fails closed on package identity or revision ambiguity', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-typecheck-provider-invalid-'));
  try {
    const nodeModulesPath = path.join(root, 'node_modules');
    const packageRoot = path.join(nodeModulesPath, 'typescript');
    await fs.mkdir(packageRoot, { recursive: true });

    await fs.writeFile(
      path.join(packageRoot, 'package.json'),
      `${JSON.stringify({ name: '@typescript/typescript6', version: '6.0.3' })}\n`,
      'utf8'
    );
    await expect(resolveInstalledTypecheckProviderV1(nodeModulesPath))
      .rejects.toThrow('TypeCheck Provider package identity mismatch');

    await fs.writeFile(
      path.join(packageRoot, 'package.json'),
      `${JSON.stringify({
        name: 'typescript', version: 'workspace:*', bin: { tsc: './bin/tsc' }
      })}\n`,
      'utf8'
    );
    await expect(resolveInstalledTypecheckProviderV1(nodeModulesPath))
      .rejects.toThrow('exact semantic version');

    await fs.writeFile(
      path.join(packageRoot, 'package.json'),
      `${JSON.stringify({ name: 'typescript', version: '6.0.3', bin: { tsc: './bin/other' } })}\n`,
      'utf8'
    );
    await expect(resolveInstalledTypecheckProviderV1(nodeModulesPath))
      .rejects.toThrow('canonical tsc CLI entry');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
