import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  deleteRetainedNoFollowEntryV1,
  deleteRetainedNoFollowInventoryV1,
  inspectNoFollowDirectoryChainV1,
  scanNoFollowDirectoryTreeMetadataV1,
  type PhysicalDirectoryChainV1
} from '../shared/physical-no-follow.ts';
import { assertGitObjectId, parseNulUtf8 } from './objects.ts';
import {
  readGitTransportBytes,
  readGitTransportText
} from './transport.ts';

export interface GitTextAttributes {
  readonly textAttr: 'set' | 'unset' | 'unspecified';
  readonly eolAttr: 'lf' | 'crlf' | 'unspecified';
}

function parseTextAttribute(value: string): GitTextAttributes['textAttr'] {
  if (value === 'set') return 'set';
  if (value === 'unset') return 'unset';
  return 'unspecified';
}

function parseEolAttribute(value: string): GitTextAttributes['eolAttr'] {
  if (value === 'lf' || value === 'crlf') return value;
  return 'unspecified';
}

interface IsolatedAttributeReader {
  readonly read: (paths: readonly string[]) => ReadonlyMap<string, GitTextAttributes>;
  readonly dispose: () => void;
}

function deleteIsolatedAttributeGenerationV1(generation: PhysicalDirectoryChainV1): void {
  const inventory = scanNoFollowDirectoryTreeMetadataV1(generation.target, {
    deadlineAtMs: performance.now() + 5_000,
    maximumEntries: 16
  });
  deleteRetainedNoFollowInventoryV1({ root: generation.target, inventory });
  const parent = generation.ancestors.at(-2);
  if (parent === undefined) {
    throw new Error('Isolated Git attribute generation has no retained parent identity');
  }
  deleteRetainedNoFollowEntryV1({
    root: parent,
    relativePath: path.basename(generation.target.path),
    kind: 'directory',
    device: generation.target.device,
    inode: generation.target.inode,
    ancestorDirectories: []
  });
}

function createIsolatedAttributeReader(
  repositoryRoot: string,
  sourceCommit: string
): IsolatedAttributeReader {
  const exactCommit = assertGitObjectId(sourceCommit, 'Attribute source commit');
  const gitObjectsPath = readGitTransportText(
    repositoryRoot,
    ['rev-parse', '--git-path', 'objects'],
    { maxBuffer: 1024 * 1024, label: 'git object directory' }
  ).trim();
  if (gitObjectsPath.length === 0) {
    throw new Error('Git object directory could not be resolved');
  }
  const objectDirectory = path.isAbsolute(gitObjectsPath)
    ? path.resolve(gitObjectsPath)
    : path.resolve(repositoryRoot, gitObjectsPath);
  const shadowGitDir = mkdtempSync(path.join(tmpdir(), 'sec-git-attributes-'));
  const shadowGeneration = inspectNoFollowDirectoryChainV1(
    shadowGitDir,
    'Isolated Git attribute generation'
  );
  try {
    mkdirSync(path.join(shadowGitDir, 'refs'), { recursive: true });
    mkdirSync(path.join(shadowGitDir, 'info'), { recursive: true });
    writeFileSync(path.join(shadowGitDir, 'HEAD'), 'ref: refs/heads/sec-attribute-source\n', 'utf8');
    writeFileSync(
      path.join(shadowGitDir, 'config'),
      '[core]\n\trepositoryformatversion = 0\n\tbare = true\n',
      'utf8'
    );
  } catch (error) {
    deleteIsolatedAttributeGenerationV1(shadowGeneration);
    throw error;
  }

  const env = Object.freeze({
    GIT_DIR: shadowGitDir,
    GIT_COMMON_DIR: shadowGitDir,
    GIT_OBJECT_DIRECTORY: objectDirectory,
    GIT_ATTR_NOSYSTEM: '1',
    GIT_CONFIG_NOSYSTEM: '1'
  });

  const read = (paths: readonly string[]): ReadonlyMap<string, GitTextAttributes> => {
    if (paths.length === 0) return new Map();
    for (const filePath of paths) {
      if (filePath.length === 0 || filePath.includes('\0')) {
        throw new Error('Attribute input contains an invalid path');
      }
    }
    const input = Buffer.from(`${paths.join('\0')}\0`, 'utf8');
    const fields = parseNulUtf8(
      readGitTransportBytes(
        repositoryRoot,
        ['-c', 'core.attributesFile=', 'check-attr', '-z', '--stdin', '--source', exactCommit, 'text', 'eol'],
        {
          input,
          maxBuffer: Math.max(1024 * 1024, input.byteLength * 8 + 1024 * 1024),
          label: 'git check-attr',
          environmentOverrides: env
        }
      ),
      'git check-attr'
    );
    if (fields.length !== paths.length * 6) {
      throw new Error('git check-attr returned an unexpected attribute record count');
    }
    const attributes = new Map<string, GitTextAttributes>();
    for (let index = 0; index < fields.length; index += 6) {
      const expectedPath = paths[index / 6]!;
      const pathA = fields[index]!;
      const attrA = fields[index + 1]!;
      const valueA = fields[index + 2]!;
      const pathB = fields[index + 3]!;
      const attrB = fields[index + 4]!;
      const valueB = fields[index + 5]!;
      if (pathA !== expectedPath || pathB !== expectedPath || attrA !== 'text' || attrB !== 'eol') {
        throw new Error(`git check-attr returned an unexpected record order for ${expectedPath}`);
      }
      attributes.set(expectedPath, Object.freeze({
        textAttr: parseTextAttribute(valueA),
        eolAttr: parseEolAttribute(valueB)
      }));
    }
    return attributes;
  };

  return Object.freeze({
    read,
    dispose: () => deleteIsolatedAttributeGenerationV1(shadowGeneration)
  });
}

export function withIsolatedTextAttributeReader<Value>(
  repositoryRoot: string,
  sourceCommit: string,
  execute: (readBatch: (paths: readonly string[]) => ReadonlyMap<string, GitTextAttributes>) => Value
): Value {
  const reader = createIsolatedAttributeReader(repositoryRoot, sourceCommit);
  try {
    return execute(reader.read);
  } finally {
    reader.dispose();
  }
}

export function readTextAttributesBatch(
  repositoryRoot: string,
  sourceCommit: string,
  paths: readonly string[]
): ReadonlyMap<string, GitTextAttributes> {
  return withIsolatedTextAttributeReader(repositoryRoot, sourceCommit, (readBatch) => readBatch(paths));
}
