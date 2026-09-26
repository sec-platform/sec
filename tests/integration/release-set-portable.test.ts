import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  RELEASE_SET_MANIFEST,
  assertReleaseSetReadback,
  buildReleaseSet
} from '../../src/adapters/release/release-set.ts';
import {
  COMPILER_RUNTIME_RESOURCE_RELATIVE_PATHS,
  PACKAGE_SOURCE_LAUNCHER_RELATIVE_PATH,
  PACKAGE_SOURCE_LAUNCHER_SCRIPT,
  packageArtifactLauncherScript
} from '../../src/adapters/toolchain/runtime.ts';
import { sha256 } from '../../src/contracts/canonical.ts';

function command(root: string, executable: string, args: readonly string[]) {
  const result = spawnSync(executable, [...args], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `${executable} failed`);
  return result.stdout.trim();
}

async function write(root: string, relative: string, content: string) {
  const target = path.join(root, ...relative.split('/'));
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content);
  return Buffer.from(content);
}

test('release set is self-contained, relocatable and documentation-exact', async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'sec-release-set-fixture-'));
  const publicationParent = await fs.mkdtemp(path.join(tmpdir(), 'sec-release-set-publication-'));
  const destination = path.join(publicationParent, 'release-set');
  try {
    command(root, 'git', ['init', '--quiet']);
    command(root, 'git', ['config', 'user.email', 'tests@example.com']);
    command(root, 'git', ['config', 'user.name', 'SEC Tests']);
    await write(root, '.gitignore', 'node_modules/\nbuild/\n.tmp/\n');
    await write(root, '.bun-version', `${Bun.version}\n`);
    await write(root, 'LICENSE', 'fixture project license\n');
    await write(root, 'NOTICE', 'fixture notice\n');
    await write(root, 'REUSE.toml', 'version = 1\n');

    await write(root, 'vendor/fixture-dependency/package.json', `${JSON.stringify({
      name: 'fixture-dependency', version: '1.0.0', type: 'module', main: 'index.js', license: 'MIT'
    }, null, 2)}\n`);
    await write(root, 'vendor/fixture-dependency/index.js', 'export const value = "portable";\n');
    await write(root, 'vendor/fixture-dependency/LICENSE', 'fixture dependency license\n');
    const managedPackages = [
      ['yaml', 'yaml'],
      ['typescript', 'typescript'],
      ['@typescript/native', 'typescript-native'],
      ['@types/bun', 'types-bun'],
      ['@types/node', 'types-node']
    ] as const;
    for (const [name, directory] of managedPackages) {
      await write(root, `vendor/${directory}/package.json`, `${JSON.stringify({
        name, version: '1.0.0', type: 'module', license: 'MIT'
      }, null, 2)}\n`);
    }
    await write(root, 'src/bootstrap/cli/cli.ts', [
      '#!/usr/bin/env bun',
      'import { value } from "fixture-dependency";',
      'console.log(value);',
      ''
    ].join('\n'));
    await write(root, 'package.json', `${JSON.stringify({
      name: 'sec-release-fixture',
      version: '1.0.0',
      private: true,
      type: 'module',
      source: './src/bootstrap/cli/cli.ts',
      packageManager: `bun@${Bun.version}`,
      bin: { sec: './dist/index.js' },
      scripts: { sec: PACKAGE_SOURCE_LAUNCHER_SCRIPT },
      dependencies: {
        'fixture-dependency': 'file:./vendor/fixture-dependency',
        yaml: 'file:./vendor/yaml'
      },
      devDependencies: {
        typescript: 'file:./vendor/typescript',
        '@typescript/native': 'file:./vendor/typescript-native',
        '@types/bun': 'file:./vendor/types-bun',
        '@types/node': 'file:./vendor/types-node'
      }
    }, null, 2)}\n`);
    command(root, process.execPath, ['install', '--ignore-scripts', '--no-progress', '--no-summary']);

    for (const relative of Object.values(COMPILER_RUNTIME_RESOURCE_RELATIVE_PATHS)) {
      await write(root, `${relative.replaceAll('\\', '/')}/fixture.txt`, 'runtime-resource\n');
    }

    await write(root, 'README.md', '# Fixture docs\n');
    await write(root, 'docs/产品/产品要求与工作约束.md', [
      '<a id="req001"></a>',
      '',
      '### REQ001｜Fixture requirement',
      'fixture requirement body',
      ''
    ].join('\n'));
    await write(root, '.documentation/baseline.json', `${JSON.stringify({
      schema: 'sec.documentation-baseline/2',
      source_root: '..',
      source_roots: ['.documentation', 'README.md', 'LICENSE', 'REUSE.toml', 'docs'],
      source_manifest: 'source-manifest.json',
      audited_namespaces: ['.documentation', 'docs'],
      non_documentation_roots: [],
      excluded_from_source_hash: [
        '.documentation/figures.json', '.documentation/requirements.json', '.documentation/source-manifest.json'
      ],
      entry: '../README.md',
      delivery_number: 'fixture',
      archive_name: 'fixture.zip',
      scope: 'fixture',
      authority_limit: 'fixture'
    }, null, 2)}\n`);

    command(root, 'git', ['add', '--all']);
    command(root, 'git', ['commit', '--quiet', '-m', 'fixture']);
    await expect(fs.lstat(path.join(root, '.documentation', 'source-manifest.json')))
      .rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.lstat(path.join(root, '.documentation', 'requirements.json')))
      .rejects.toMatchObject({ code: 'ENOENT' });
    const receipt = await buildReleaseSet(root, destination);
    expect(receipt.cleanupFindings).toEqual([]);
    expect(receipt.publicationStatus).toBe('accepted');
    const exactRetry = await buildReleaseSet(root, destination);
    expect(exactRetry.manifestDigest).toBe(receipt.manifestDigest);
    expect(exactRetry.publicationStatus).toBe('accepted');
    expect(exactRetry.cleanupFindings).toEqual([]);
    expect((await fs.readdir(publicationParent)).filter(name => name.startsWith('.sec-release-set-stage-'))).toEqual([]);
    expect(await fs.readFile(path.join(destination, RELEASE_SET_MANIFEST), 'utf8')).toContain(receipt.sourceCommit);
    await expect(assertReleaseSetReadback(destination)).resolves.toMatchObject({
      sourceCommit: receipt.sourceCommit,
      sourceTree: receipt.sourceTree
    });
    const generatedSourceManifest = JSON.parse(await fs.readFile(
      path.join(destination, 'documentation', '.documentation', 'source-manifest.json'), 'utf8'
    ));
    expect(generatedSourceManifest.members.map((member: { path: string }) => member.path))
      .toContain('docs/产品/产品要求与工作约束.md');
    const generatedRequirements = JSON.parse(await fs.readFile(
      path.join(destination, 'documentation', '.documentation', 'requirements.json'), 'utf8'
    ));
    expect(generatedRequirements.items.map((item: { id: string }) => item.id)).toEqual(['REQ001']);
    await expect(fs.lstat(path.join(root, '.documentation', 'source-manifest.json')))
      .rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.lstat(path.join(root, '.documentation', 'requirements.json')))
      .rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.lstat(path.join(destination, 'runtime', 'node_modules')))
      .rejects.toMatchObject({ code: 'ENOENT' });
    const portablePackage = JSON.parse(await fs.readFile(
      path.join(destination, 'runtime', 'package.json'), 'utf8'
    ));
    expect(Object.hasOwn(portablePackage, 'source')).toBe(false);
    expect(portablePackage.scripts).toEqual({
      sec: packageArtifactLauncherScript('dist/index.js')
    });
    expect(Object.keys(portablePackage.dependencies)).toEqual(['yaml']);
    expect(Object.keys(portablePackage.devDependencies).sort()).toEqual([
      '@types/bun', '@types/node', '@typescript/native', 'typescript'
    ]);
    await expect(fs.lstat(path.join(
      destination,
      'runtime',
      PACKAGE_SOURCE_LAUNCHER_RELATIVE_PATH
    ))).rejects.toMatchObject({ code: 'ENOENT' });
    const fixtureDependencyEvidenceDirectory = `package-${sha256(Object.freeze({
      name: 'fixture-dependency',
      version: '1.0.0'
    })).slice('sha256:'.length)}`;
    expect(await fs.readdir(path.join(destination, 'runtime', 'THIRD_PARTY_LICENSES')))
      .toEqual([fixtureDependencyEvidenceDirectory]);
    await expect(fs.readFile(
      path.join(destination, 'runtime', 'THIRD_PARTY_LICENSES', fixtureDependencyEvidenceDirectory, 'LICENSE'),
      'utf8'
    )).resolves.toBe('fixture dependency license\n');

    const publicationKey = createHash('sha256').update('release-set').digest('hex');
    const previous = path.join(publicationParent, `.sec-release-set-previous-${publicationKey}`);
    await fs.rename(destination, previous);
    await fs.mkdir(destination);
    await fs.writeFile(path.join(destination, 'foreign.txt'), 'preserve this malformed preimage\n');
    const recovered = await buildReleaseSet(root, destination);
    const failed = recovered.cleanupFindings[0]!.path;
    expect(failed.startsWith(path.join(publicationParent, `.sec-release-set-failed-${publicationKey}-`))).toBe(true);
    expect(recovered.cleanupFindings).toMatchObject([{
      phase: 'failed-release-set',
      path: failed,
      state: 'cleanup-unconfirmed',
      retainedObjectId: expect.any(String)
    }]);
    expect(await fs.readFile(path.join(failed, 'foreign.txt'), 'utf8'))
      .toBe('preserve this malformed preimage\n');
    await expect(assertReleaseSetReadback(destination)).resolves.toMatchObject({
      sourceCommit: receipt.sourceCommit
    });
    await fs.rename(destination, previous);
    await fs.mkdir(destination);
    await fs.writeFile(path.join(destination, 'second-foreign.txt'), 'preserve the second malformed preimage\n');
    const retried = await buildReleaseSet(root, destination);
    expect(retried.cleanupFindings).toMatchObject([{
      phase: 'failed-release-set',
      path: failed,
      retainedObjectId: recovered.cleanupFindings[0]?.retainedObjectId
    }, { phase: 'failed-release-set', retainedObjectId: expect.any(String) }]);
    const secondFailed = retried.cleanupFindings[1]!.path;
    expect(secondFailed).not.toBe(failed);
    expect(await fs.readFile(path.join(secondFailed, 'second-foreign.txt'), 'utf8'))
      .toBe('preserve the second malformed preimage\n');
    await expect(assertReleaseSetReadback(destination)).resolves.toMatchObject({
      sourceCommit: receipt.sourceCommit
    });

    const relocated = path.join(publicationParent, 'relocated-runtime-set');
    await fs.rename(destination, relocated);
    const launched = spawnSync(process.execPath, ['run', 'sec'], {
      cwd: path.join(relocated, 'runtime'), encoding: 'utf8', windowsHide: true
    });
    expect(launched.status, launched.stderr).toBe(0);
    expect(launched.stdout).toBe('portable\n');
    await fs.writeFile(path.join(relocated, 'runtime', '.bun-version'), '0.0.0\n');
    const mismatched = spawnSync(process.execPath, ['dist/index.js'], {
      cwd: path.join(relocated, 'runtime'), encoding: 'utf8', windowsHide: true
    });
    expect(mismatched.status).not.toBe(0);
    expect(mismatched.stderr).toContain('RUNTIME-LAYOUT-001');
  } finally {
    await Promise.all([
      fs.rm(root, { recursive: true, force: true }),
      fs.rm(publicationParent, { recursive: true, force: true })
    ]);
  }
}, 30_000);
