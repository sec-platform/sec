import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import fs, { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  buildDocumentationArtifact,
  isDocumentationReleasePath,
  readDocumentationArtifactManifest
} from '../../src/adapters/release/documentation-artifact.ts';

function git(repositoryRoot: string, args: readonly string[]): string {
  const result = spawnSync('git', [...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(' ')} failed`);
  return result.stdout.trim();
}

async function createDocumentationRepository(root: string): Promise<void> {
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
    'src/code.ts': 'export const implementation = true;\n'
  };
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, ...relativePath.split('/'));
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, content);
  }
  git(root, ['add', '--all']);
  git(root, ['commit', '--quiet', '-m', 'documentation-fixture']);
}

test('documentation release path follows the repository documentation/license boundary', () => {
  expect(isDocumentationReleasePath('README.md')).toBe(true);
  expect(isDocumentationReleasePath('examples/guide.md')).toBe(true);
  expect(isDocumentationReleasePath('alternatives/model.sec')).toBe(true);
  expect(isDocumentationReleasePath('.documentation/documents.json')).toBe(true);
  expect(isDocumentationReleasePath('LICENSES/CC-BY-4.0.txt')).toBe(true);
  expect(isDocumentationReleasePath('LICENSE')).toBe(true);
  expect(isDocumentationReleasePath('REUSE.toml')).toBe(true);
  expect(isDocumentationReleasePath('src/code.ts')).toBe(false);
  expect(isDocumentationReleasePath('package.json')).toBe(false);
});

test('documentation artifact packages exact revision documentation with CC BY attribution', async () => {
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), 'sec-doc-release-source-'));
  const outputParent = await mkdtemp(path.join(tmpdir(), 'sec-doc-release-output-'));
  const destinationRoot = path.join(outputParent, 'documentation');
  try {
    await createDocumentationRepository(repositoryRoot);
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
    expect(manifest.license).toMatchObject({
      spdx: 'CC-BY-4.0',
      textPath: 'LICENSES/CC-BY-4.0.txt',
      softwareLicenseTextPath: 'LICENSE',
      classificationPath: 'REUSE.toml',
      creator: 'Jeremy Yang',
      work: 'Engineering Workspace Compiler (SEC)'
    });
    expect(manifest.files.map((file) => file.path)).toEqual([
      '.documentation/documents.json',
      'CITATION.cff',
      'LICENSE',
      'LICENSES/CC-BY-4.0.txt',
      'LICENSES/README.md',
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
