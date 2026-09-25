import path from 'node:path';
import ts from 'typescript';

import { compareCodeUnits } from '../../../contracts/canonical.ts';
import { isPathInside } from '../../../contracts/relative-path.ts';

/** 项目配置解释的语义输入；匹配器或基目录规则变化必须使旧证据失效。 */
export const TYPESCRIPT_SNAPSHOT_DIRECTORY_SEMANTICS = Object.freeze({
  matcher: 'typescript-match-files',
  entries: 'sealed-canonical-path-inventory',
  configBase: 'containing-directory',
  caseSensitive: true
});

export type TypeScriptSnapshotDirectoryReader = (
  rootDir: string,
  extensions: readonly string[] | undefined,
  excludes: readonly string[] | undefined,
  includes: readonly string[] | undefined,
  depth?: number
) => string[];

type DirectoryEntries = { files: string[]; directories: string[] };
type MatchFiles = (
  rootDir: string,
  extensions: readonly string[] | undefined,
  excludes: readonly string[] | undefined,
  includes: readonly string[] | undefined,
  caseSensitive: boolean,
  currentDirectory: string,
  depth: number | undefined,
  entries: (directory: string) => DirectoryEntries,
  realpath: (candidate: string) => string
) => string[];

/**
 * TypeScript 的运行时匹配能力并非稳定的公开类型 API。只有此 provider
 * 适配该能力；能力缺失时明确失败，不降级到另一套 glob 或宿主文件系统。
 * 目录数据来自已捕获路径的私有索引，不读取磁盘、不跟随符号链接。
 */
export function createTypeScriptSnapshotDirectoryReader(
  repositoryPaths: readonly string[],
  virtualRoot: string
): TypeScriptSnapshotDirectoryReader {
  const matchFiles = (ts as unknown as { matchFiles?: MatchFiles }).matchFiles;
  if (typeof matchFiles !== 'function') {
    throw new Error('TypeScript snapshot directory matching capability is unavailable');
  }
  const root = path.resolve(virtualRoot);
  const index = new Map<string, { files: Set<string>; directories: Set<string> }>();
  const directory = (key: string) => {
    let entries = index.get(key);
    if (entries === undefined) {
      entries = { files: new Set(), directories: new Set() };
      index.set(key, entries);
    }
    return entries;
  };
  directory('');
  for (const repositoryPath of repositoryPaths) {
    const components = repositoryPath.split('/');
    if (repositoryPath.includes('\\') || repositoryPath.includes('\0')
        || path.posix.isAbsolute(repositoryPath) || path.win32.isAbsolute(repositoryPath)
        || /^[A-Za-z]:/u.test(repositoryPath)
        || components.some((component) => component === '' || component === '.' || component === '..')) {
      throw new Error(`TypeScript snapshot directory path is not canonical: ${repositoryPath}`);
    }
    let parent = '';
    for (let offset = 0; offset < components.length; offset += 1) {
      const component = components[offset]!;
      const entries = directory(parent);
      const isFile = offset === components.length - 1;
      if ((isFile ? entries.directories : entries.files).has(component)) {
        throw new Error(`TypeScript snapshot contains a file/directory collision: ${repositoryPath}`);
      }
      (isFile ? entries.files : entries.directories).add(component);
      parent = parent === '' ? component : `${parent}/${component}`;
      if (!isFile) directory(parent);
    }
  }
  const getEntries = (candidate: string): DirectoryEntries => {
    const absolute = path.resolve(root, candidate);
    if (!isPathInside(root, absolute)) return { files: [], directories: [] };
    const key = path.relative(root, absolute).split(path.sep).join('/');
    const entries = index.get(key);
    // 不向 compiler 暴露可修改索引，也不接受未捕获目录的宿主回退。
    return entries === undefined ? { files: [], directories: [] } : {
      files: [...entries.files],
      directories: [...entries.directories]
    };
  };
  return (rootDir, extensions, excludes, includes, depth) => {
    const absolute = path.resolve(root, rootDir);
    if (!isPathInside(root, absolute)) return [];
    return matchFiles(
      absolute, extensions, excludes, includes, true, root, depth,
      getEntries, (candidate) => path.resolve(root, candidate)
    ).sort(compareCodeUnits);
  };
}
