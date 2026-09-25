import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { compareDocumentationPaths, documentationSourceDigest } from '../../src/contracts/documentation-source.ts';

import {
  DOCUMENTATION_PACKAGE_MANIFEST,
  RELEASE_SET_MANIFEST,
  RUNTIME_PACKAGE_MANIFEST,
  assertReleaseSetReadback,
  parseDocumentationPackageManifestBytes,
  parseReleaseSetManifestBytes,
  parseRuntimePackageManifestBytes
} from '../../src/adapters/release/release-set.ts';
import { rawSha256Hex, sha256 } from '../../src/contracts/canonical.ts';

const builder = Object.freeze({
  schema: 'sec-release-builder-identity-v1' as const,
  runtime: 'bun' as const,
  version: '1.4.0',
  executableSha256: `sha256:${'a'.repeat(64)}` as const,
  platform: process.platform,
  architecture: process.arch
});

function file(pathName: string, bytes = 1, executable = false) {
  return Object.freeze({
    path: pathName,
    bytes,
    digest: `sha256:${'b'.repeat(64)}` as const,
    executable
  });
}

function runtimeMaterial() {
  return Object.freeze({
    schema: 'sec-runtime-package-manifest-v1' as const,
    packageVersion: '1.0.0',
    sourceCommit: '1'.repeat(40),
    sourceTree: '2'.repeat(40),
    dependencyLockDigest: `sha256:${'3'.repeat(64)}` as const,
    builder,
    entrypoint: 'dist/index.js',
    files: Object.freeze([
      file('.bun-version'),
      file('LICENSE'),
      file('NOTICE'),
      file('REUSE.toml'),
      file('THIRD_PARTY_NOTICES.json'),
      file('bun.lock'),
      file('dist/index.js', 1, true),
      file('package.json'),
      file('src/adapters/toolchain/runtime/package-source-launcher.ts')
    ])
  });
}

function documentationMaterial() {
  return Object.freeze({
    schema: 'sec-documentation-package-manifest-v2' as const,
    sourceCommit: '1'.repeat(40),
    sourceTree: '2'.repeat(40),
    sourceSetSha256: `sha256:${'4'.repeat(64)}` as const,
    entrypoint: 'README.md',
    files: Object.freeze([
      file('.documentation/baseline.json'),
      file('.documentation/source-manifest.json'),
      file('README.md'),
      file('REUSE.toml')
    ])
  });
}

function encode(material: Record<string, unknown>): Buffer {
  return Buffer.from(JSON.stringify({ ...material, contentDigest: sha256(material) }), 'utf8');
}

test('release package decoders reject duplicate and undeclared JSON fields', () => {
  const runtime = runtimeMaterial();
  expect(parseRuntimePackageManifestBytes(encode(runtime))).toMatchObject({
    schema: 'sec-runtime-package-manifest-v1',
    entrypoint: 'dist/index.js'
  });
  const duplicate = encode(runtime).toString('utf8').replace(
    '"packageVersion":"1.0.0"',
    '"packageVersion":"1.0.0","packageVersion":"1.0.0"'
  );
  expect(() => parseRuntimePackageManifestBytes(Buffer.from(duplicate))).toThrow('duplicate');
  const unknown = JSON.parse(encode(runtime).toString('utf8'));
  unknown.extra = true;
  expect(() => parseRuntimePackageManifestBytes(Buffer.from(JSON.stringify(unknown)))).toThrow();

  const documentation = documentationMaterial();
  expect(parseDocumentationPackageManifestBytes(encode(documentation))).toMatchObject({
    schema: 'sec-documentation-package-manifest-v2',
    entrypoint: 'README.md'
  });
});

test('release-set manifest binds exactly one runtime and one documentation manifest', () => {
  const material = Object.freeze({
    schema: 'sec-release-set-manifest-v1' as const,
    sourceCommit: '1'.repeat(40),
    sourceTree: '2'.repeat(40),
    members: Object.freeze([
      Object.freeze({
        name: 'documentation' as const,
        manifestPath: `documentation/${DOCUMENTATION_PACKAGE_MANIFEST}`,
        manifestDigest: `sha256:${'5'.repeat(64)}` as const,
        fileCount: 4
      }),
      Object.freeze({
        name: 'runtime' as const,
        manifestPath: `runtime/${RUNTIME_PACKAGE_MANIFEST}`,
        manifestDigest: `sha256:${'6'.repeat(64)}` as const,
        fileCount: 9
      })
    ])
  });
  expect(parseReleaseSetManifestBytes(encode(material)).members.map(({ name }) => name))
    .toEqual(['documentation', 'runtime']);
  const wrongPath = JSON.parse(encode(material).toString('utf8'));
  wrongPath.members[1].manifestPath = 'runtime/not-the-runtime-manifest.json';
  expect(() => parseReleaseSetManifestBytes(Buffer.from(JSON.stringify(wrongPath)))).toThrow();
  const wrong = JSON.parse(encode(material).toString('utf8'));
  wrong.members[1].name = 'documentation';
  expect(() => parseReleaseSetManifestBytes(Buffer.from(JSON.stringify(wrong)))).toThrow();
});

async function writePackageFile(root: string, relative: string, content: string, executable = false) {
  const target = path.join(root, ...relative.split('/'));
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content);
  if (executable) await fs.chmod(target, 0o755);
  const bytes = Buffer.from(content);
  return Object.freeze({
    path: relative,
    bytes: bytes.byteLength,
    digest: `sha256:${rawSha256Hex(bytes)}` as const,
    executable: executable && process.platform !== 'win32'
  });
}

test('release-set readback rejects physical tampering and undeclared top-level residue', async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'sec-release-set-readback-'));
  try {
    const runtimeRoot = path.join(root, 'runtime');
    const docsRoot = path.join(root, 'documentation');
    const runtimeFiles = [];
    for (const name of ['.bun-version', 'LICENSE', 'NOTICE', 'REUSE.toml', 'bun.lock', 'package.json']) {
      runtimeFiles.push(await writePackageFile(runtimeRoot, name, `${name}\n`));
    }
    runtimeFiles.push(await writePackageFile(runtimeRoot, 'THIRD_PARTY_NOTICES.json', '{}\n'));
    runtimeFiles.push(await writePackageFile(
      runtimeRoot,
      'src/adapters/toolchain/runtime/package-source-launcher.ts',
      'await import("../../../../dist/index.js");\n'
    ));
    runtimeFiles.push(await writePackageFile(runtimeRoot, 'dist/index.js', '#!/usr/bin/env bun\n', true));
    runtimeFiles.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    const runtime = Object.freeze({
      ...runtimeMaterial(),
      files: Object.freeze(runtimeFiles)
    });
    const runtimeBytes = encode(runtime);
    await fs.writeFile(path.join(runtimeRoot, RUNTIME_PACKAGE_MANIFEST), runtimeBytes);

    const docsFiles = [];
    const boundary = {
      schema: 'sec.documentation-baseline/2',
      source_root: '..',
      source_roots: ['.documentation', 'README.md', 'REUSE.toml'],
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
    };
    docsFiles.push(await writePackageFile(docsRoot, '.documentation/baseline.json', `${JSON.stringify(boundary, null, 2)}\n`));
    for (const name of ['README.md', 'REUSE.toml']) {
      docsFiles.push(await writePackageFile(docsRoot, name, `${name}\n`));
    }
    docsFiles.sort((a, b) => compareDocumentationPaths(a.path, b.path));
    const members = docsFiles.map(f => ({ path: f.path, bytes: f.bytes, sha256: f.digest.slice(7) }));
    const sourceSetSha256 = documentationSourceDigest(members);
    docsFiles.push(await writePackageFile(docsRoot, '.documentation/source-manifest.json', `${JSON.stringify({
      schema: 'sec.documentation-source-manifest/2', source_set_sha256: sourceSetSha256, members
    }, null, 2)}\n`));
    docsFiles.sort((a, b) => compareDocumentationPaths(a.path, b.path));
    const documentation = Object.freeze({
      ...documentationMaterial(),
      sourceSetSha256: `sha256:${sourceSetSha256}` as const,
      files: Object.freeze(docsFiles)
    });
    const documentationBytes = encode(documentation);
    await fs.writeFile(path.join(docsRoot, DOCUMENTATION_PACKAGE_MANIFEST), documentationBytes);

    const release = Object.freeze({
      schema: 'sec-release-set-manifest-v1' as const,
      sourceCommit: '1'.repeat(40),
      sourceTree: '2'.repeat(40),
      members: Object.freeze([
        Object.freeze({
          name: 'documentation' as const,
          manifestPath: `documentation/${DOCUMENTATION_PACKAGE_MANIFEST}`,
          manifestDigest: `sha256:${rawSha256Hex(documentationBytes)}` as const,
          fileCount: docsFiles.length
        }),
        Object.freeze({
          name: 'runtime' as const,
          manifestPath: `runtime/${RUNTIME_PACKAGE_MANIFEST}`,
          manifestDigest: `sha256:${rawSha256Hex(runtimeBytes)}` as const,
          fileCount: runtimeFiles.length
        })
      ])
    });
    await fs.writeFile(path.join(root, RELEASE_SET_MANIFEST), encode(release));

    const initialReadback = await assertReleaseSetReadback(root);
    expect(initialReadback).toMatchObject({ schema: 'sec-release-set-manifest-v1' });
    await fs.writeFile(path.join(root, 'unexpected.txt'), 'residue');
    await expect(assertReleaseSetReadback(root)).rejects.toThrow('undeclared top-level');
    await fs.rm(path.join(root, 'unexpected.txt'));
    await fs.appendFile(path.join(runtimeRoot, 'package.json'), 'tamper');
    await expect(assertReleaseSetReadback(root)).rejects.toThrow('physical inventory');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
