import { compareDocumentationPaths, documentationSourceDigest } from '../../src/contracts/documentation-source.ts';
import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { digest } from '../../src/contracts/canonical.ts';
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

    const readme = await write(root, 'README.md', '# Fixture docs\n');
    const reuse = await fs.readFile(path.join(root, 'REUSE.toml'));
    const license = await fs.readFile(path.join(root, 'LICENSE'));
    const members = [
      { path: 'LICENSE', bytes: license.byteLength, sha256: digest(license) },
      { path: 'README.md', bytes: readme.byteLength, sha256: digest(readme) },
      { path: 'REUSE.toml', bytes: reuse.byteLength, sha256: digest(reuse) }
    ];
    const boundaryBytes = await write(root, '.documentation/baseline.json', `${JSON.stringify({
      schema: 'sec.documentation-baseline/2',
      source_root: '..',
      source_roots: ['.documentation', 'README.md', 'LICENSE', 'REUSE.toml'],
      source_manifest: 'source-manifest.json',
      audited_namespaces: ['.documentation'],
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
    members.push({ path: '.documentation/baseline.json', bytes: boundaryBytes.byteLength, sha256: digest(boundaryBytes) });
    members.sort((a, b) => compareDocumentationPaths(a.path, b.path));
    const sourceSetSha256 = documentationSourceDigest(members);
    await write(root, '.documentation/source-manifest.json', `${JSON.stringify({
      schema: 'sec.documentation-source-manifest/2', source_set_sha256: sourceSetSha256, members
    }, null, 2)}\n`);

    command(root, 'git', ['add', '--all']);
    command(root, 'git', ['commit', '--quiet', '-m', 'fixture']);
    const receipt = await buildReleaseSet(root, destination);
    expect(receipt.cleanupFindings).toEqual([]);
    expect(receipt.publicationStatus).toBe('accepted');
    expect(await fs.readFile(path.join(destination, RELEASE_SET_MANIFEST), 'utf8')).toContain(receipt.sourceCommit);
    await expect(assertReleaseSetReadback(destination)).resolves.toMatchObject({
      sourceCommit: receipt.sourceCommit,
      sourceTree: receipt.sourceTree
    });
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
    await expect(fs.readFile(
      path.join(destination, 'runtime', 'THIRD_PARTY_LICENSES', 'fixture-dependency@1.0.0', 'LICENSE'),
      'utf8'
    )).resolves.toBe('fixture dependency license\n');

    const relocated = path.join(publicationParent, 'relocated-runtime-set');
    await fs.rename(destination, relocated);
    const launched = spawnSync(process.execPath, ['run', 'sec'], {
      cwd: path.join(relocated, 'runtime'), encoding: 'utf8', windowsHide: true
    });
    expect(launched.status, launched.stderr).toBe(0);
    expect(launched.stdout).toBe('portable\n');
  } finally {
    await Promise.all([
      fs.rm(root, { recursive: true, force: true }),
      fs.rm(publicationParent, { recursive: true, force: true })
    ]);
  }
}, 5_000);
