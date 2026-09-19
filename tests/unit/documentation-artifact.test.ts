import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs, { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  buildDocumentationArtifact,
  readDocumentationArtifactManifest
} from '../../src/adapters/release/documentation-artifact.ts';

const SOURCE_ROOTS = Object.freeze([
  'README.md',
  '.documentation',
  'alternatives',
  'docs',
  'examples'
] as const);
const SOURCE_EXCLUSIONS = Object.freeze([
  '.documentation/baseline.json',
  '.documentation/source-manifest.json'
] as const);

function git(repositoryRoot: string, args: readonly string[]): string {
  const result = spawnSync('git', [...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(' ')} failed`);
  return result.stdout.trim();
}

function hash(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function documentationMembers(root: string): Promise<Array<{
  path: string;
  bytes: number;
  sha256: string;
}>> {
  const paths: string[] = [];
  async function add(relativePath: string): Promise<void> {
    const absolutePath = path.join(root, ...relativePath.split('/'));
    const metadata = await fs.lstat(absolutePath);
    if (metadata.isDirectory()) {
      const entries = await fs.readdir(absolutePath);
      entries.sort();
      for (const entry of entries) await add(`${relativePath}/${entry}`);
      return;
    }
    if (!metadata.isFile()) throw new Error(`fixture source member is not a file: ${relativePath}`);
    if (!SOURCE_EXCLUSIONS.includes(relativePath as typeof SOURCE_EXCLUSIONS[number])) {
      paths.push(relativePath);
    }
  }
  for (const sourceRoot of SOURCE_ROOTS) await add(sourceRoot);
  paths.sort();

  const members = [];
  for (const relativePath of paths) {
    const bytes = await fs.readFile(path.join(root, ...relativePath.split('/')));
    members.push({
      path: relativePath,
      bytes: bytes.byteLength,
      sha256: hash(bytes)
    });
  }
  return members;
}

function sourceSetDigest(members: readonly {
  path: string;
  bytes: number;
  sha256: string;
}[]): string {
  return hash(Buffer.from(JSON.stringify(
    members.map(({ path: memberPath, bytes, sha256 }) => ({
      bytes,
      path: memberPath,
      sha256
    }))
  ), 'utf8'));
}

async function refreshDocumentationControl(root: string): Promise<string> {
  const members = await documentationMembers(root);
  const digest = sourceSetDigest(members);
  await fs.writeFile(
    path.join(root, '.documentation', 'source-manifest.json'),
    `${JSON.stringify({
      schema: 'sec.documentation-source-manifest/1',
      source_set_sha256: digest,
      members
    }, null, 2)}\n`
  );
  await fs.writeFile(
    path.join(root, '.documentation', 'baseline.json'),
    `${JSON.stringify({
      schema: 'sec.documentation-baseline/1',
      source_set_sha256: digest,
      source_roots: SOURCE_ROOTS,
      source_manifest: 'source-manifest.json',
      excluded_from_source_hash: SOURCE_EXCLUSIONS
    }, null, 2)}\n`
  );
  return digest;
}

async function createDocumentationRepository(root: string): Promise<string> {
  git(root, ['init', '--quiet']);
  git(root, ['config', 'user.email', 'tests@example.com']);
  git(root, ['config', 'user.name', 'SEC Tests']);
  await fs.writeFile(path.join(root, 'package.json'), `${JSON.stringify({
    name: 'sec-documentation-fixture',
    version: '1.2.3',
    author: 'Jeremy Yang'
  }, null, 2)}\n`);
  const files: Record<string, string> = {
    'README.md': '# Root\n',
    'docs/design.md': '# Design\n',
    'alternatives/model.sec': 'design alternative\n',
    '.documentation/documents.json': '{"schema":"fixture"}\n',
    'examples/guide.md': '# Example guide\n',
    'LICENSES/README.md': '# License map\n',
    'LICENSES/CC-BY-4.0.txt': 'Creative Commons Attribution 4.0\n',
    'LICENSE': 'Mozilla Public License Version 2.0\n',
    'REUSE.toml': 'version = 1\n',
    'CITATION.cff': 'cff-version: 1.2.0\n',
    'NOTICE': 'SEC notice\n',
    'src/code.ts': 'export const implementation = true;\n'
  };
  for (const [relativePath, value] of Object.entries(files)) {
    const absolutePath = path.join(root, ...relativePath.split('/'));
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, value);
  }
  const sourceSetDigest = await refreshDocumentationControl(root);
  git(root, ['add', '--all']);
  git(root, ['commit', '--quiet', '-m', 'documentation-fixture']);
  return sourceSetDigest;
}

test('documentation artifact packages the canonical source manifest plus release legal metadata', async () => {
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), 'sec-doc-release-source-'));
  const outputParent = await mkdtemp(path.join(tmpdir(), 'sec-doc-release-output-'));
  const destinationRoot = path.join(outputParent, 'documentation');
  try {
    const sourceSetDigest = await createDocumentationRepository(repositoryRoot);
    const sourceCommit = git(repositoryRoot, ['rev-parse', 'HEAD']);
    const sourceTree = git(repositoryRoot, ['rev-parse', 'HEAD^{tree}']);
    const receipt = await buildDocumentationArtifact(repositoryRoot, destinationRoot);
    const manifest = await readDocumentationArtifactManifest(destinationRoot);

    expect(receipt).toMatchObject({
      publicationStatus: 'accepted',
      packageVersion: '1.2.3',
      sourceCommit,
      sourceTree,
      manifestDigest: manifest.contentDigest
    });
    expect(manifest.documentationSourceSetDigest).toBe(`sha256:${sourceSetDigest}`);
    expect(manifest.license).toMatchObject({
      spdx: 'CC-BY-4.0',
      textPath: 'LICENSES/CC-BY-4.0.txt',
      softwareLicenseTextPath: 'LICENSE',
      classificationPath: 'REUSE.toml',
      creator: 'Jeremy Yang',
      work: 'Engineering Workspace Compiler (SEC)'
    });
    expect(manifest.files.map((file) => file.path)).toEqual([
      '.documentation/baseline.json',
      '.documentation/documents.json',
      '.documentation/source-manifest.json',
      'CITATION.cff',
      'LICENSE',
      'LICENSES/CC-BY-4.0.txt',
      'LICENSES/README.md',
      'NOTICE',
      'README.md',
      'REUSE.toml',
      'alternatives/model.sec',
      'docs/design.md',
      'examples/guide.md'
    ]);
    await expect(fs.lstat(path.join(destinationRoot, 'src/code.ts')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await Promise.all([
      rm(repositoryRoot, { recursive: true, force: true }),
      rm(outputParent, { recursive: true, force: true })
    ]);
  }
});

test('documentation artifact rejects a source revision different from the release member identity', async () => {
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), 'sec-doc-release-mismatch-'));
  const outputParent = await mkdtemp(path.join(tmpdir(), 'sec-doc-release-mismatch-output-'));
  const destinationRoot = path.join(outputParent, 'documentation');
  try {
    await createDocumentationRepository(repositoryRoot);
    await expect(buildDocumentationArtifact(repositoryRoot, destinationRoot, {
      sourceCommit: 'a'.repeat(40),
      sourceTree: 'b'.repeat(40)
    })).rejects.toThrow('differs from the expected release revision');
    await expect(fs.lstat(destinationRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await Promise.all([
      rm(repositoryRoot, { recursive: true, force: true }),
      rm(outputParent, { recursive: true, force: true })
    ]);
  }
});

test('documentation artifact rejects a committed stale canonical source manifest', async () => {
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), 'sec-doc-release-stale-'));
  const outputParent = await mkdtemp(path.join(tmpdir(), 'sec-doc-release-stale-output-'));
  const destinationRoot = path.join(outputParent, 'documentation');
  try {
    await createDocumentationRepository(repositoryRoot);
    await fs.writeFile(path.join(repositoryRoot, 'docs', 'design.md'), '# Changed without refresh\n');
    git(repositoryRoot, ['add', '--all']);
    git(repositoryRoot, ['commit', '--quiet', '-m', 'stale-documentation-manifest']);

    await expect(buildDocumentationArtifact(repositoryRoot, destinationRoot))
      .rejects.toThrow('Documentation source manifest bytes differ at docs/design.md');
    await expect(fs.lstat(destinationRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await Promise.all([
      rm(repositoryRoot, { recursive: true, force: true }),
      rm(outputParent, { recursive: true, force: true })
    ]);
  }
});
