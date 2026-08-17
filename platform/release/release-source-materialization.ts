import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { digest } from '../shared/canonical-primitives.ts';

const RELEASE_BUILD_META_FILE_NAME = '.sec-release-build-metafile.json' as const;
const GIT_LFS_POINTER_PREFIX = Buffer.from('version https://git-lfs.github.com/spec/v1\n', 'utf8');

export interface FrozenReleaseSourceV1 {
  readonly schema: 'sec-frozen-release-source-v1';
  readonly root: string;
  readonly sourceCommit: string;
  readonly sourceTree: string;
  readonly packageVersion: string;
  readonly dependencies: readonly string[];
  readonly dependencyLockDigest: `sha256:${string}`;
  readonly stageRoot: string;
}

type CommandResult = Readonly<{
  status: number | null;
  stdout: Buffer;
  stderr: Buffer;
  error: Error | undefined;
}>;

type BuildMetafile = Readonly<{
  inputs?: Record<string, unknown>;
}>;

function command(
  cwd: string,
  executable: string,
  args: readonly string[],
  input?: Buffer,
  maxBuffer = 256 * 1024 * 1024
): CommandResult {
  const result = spawnSync(executable, [...args], {
    cwd,
    encoding: 'buffer',
    input,
    maxBuffer,
    windowsHide: true
  });
  return Object.freeze({
    status: result.status,
    stdout: Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(String(result.stdout ?? '')),
    stderr: Buffer.isBuffer(result.stderr) ? result.stderr : Buffer.from(String(result.stderr ?? '')),
    error: result.error
  });
}

function commandBytes(
  cwd: string,
  executable: string,
  args: readonly string[],
  input?: Buffer,
  maxBuffer?: number
): Buffer {
  const result = command(cwd, executable, args, input, maxBuffer);
  if (result.error || result.status !== 0) {
    const detail = result.stderr.toString('utf8').trim();
    throw new Error(`${executable} ${args[0] ?? ''} failed${detail ? `: ${detail}` : ''}`, {
      cause: result.error
    });
  }
  return result.stdout;
}

function gitText(repositoryRoot: string, args: readonly string[]): string {
  return commandBytes(repositoryRoot, 'git', args, undefined, 16 * 1024 * 1024).toString('utf8').trim();
}

function assertGitObjectId(value: string, label: string): string {
  if (!/^[0-9a-f]{40,64}$/u.test(value)) {
    throw new Error(`${label} is not one exact Git object ID`);
  }
  return value;
}

function assertTrackedWorktreeMatchesCommit(repositoryRoot: string, sourceCommit: string): void {
  const result = command(
    repositoryRoot,
    'git',
    ['diff', '--quiet', sourceCommit, '--'],
    undefined,
    16 * 1024 * 1024
  );
  if (result.error) {
    throw new Error('Release tracked worktree comparison could not start', { cause: result.error });
  }
  if (result.status === 1) {
    throw new Error('Release tracked worktree/index differs from captured source commit');
  }
  if (result.status !== 0) {
    const detail = result.stderr.toString('utf8').trim();
    throw new Error(`Release tracked worktree comparison failed${detail ? `: ${detail}` : ''}`);
  }
}

function assertReleaseGitTreeOrdinary(repositoryRoot: string, sourceCommit: string): void {
  const output = commandBytes(
    repositoryRoot,
    'git',
    ['ls-tree', '-r', '-z', '--full-tree', sourceCommit],
    undefined,
    128 * 1024 * 1024
  );
  if (output.byteLength === 0) return;
  if (output[output.byteLength - 1] !== 0) {
    throw new Error('Release source Git tree did not return NUL-terminated records');
  }
  const payload = output.subarray(0, -1).toString('utf8');
  if (!Buffer.from(`${payload}\0`, 'utf8').equals(output)) {
    throw new Error('Release source Git tree contains a non-UTF-8 path');
  }
  for (const record of payload.split('\0')) {
    const separator = record.indexOf('\t');
    const header = separator < 0 ? '' : record.slice(0, separator);
    const filePath = separator < 0 ? '' : record.slice(separator + 1);
    const match = /^([0-7]{6}) ([a-z]+) ([0-9a-f]{40,64})$/u.exec(header);
    if (!match || filePath.length === 0) {
      throw new Error('Release source Git tree returned an invalid entry');
    }
    const mode = match[1]!;
    const type = match[2]!;
    if (type !== 'blob' || (mode !== '100644' && mode !== '100755')) {
      throw new Error(`Release source tree contains unsupported Git entry ${filePath} (${mode} ${type})`);
    }
  }
}

function materializeExactGitTree(repositoryRoot: string, sourceRoot: string, sourceCommit: string): void {
  const archive = commandBytes(
    repositoryRoot,
    'git',
    ['archive', '--format=tar', sourceCommit],
    undefined,
    512 * 1024 * 1024
  );
  commandBytes(
    repositoryRoot,
    'tar',
    ['-xf', '-', '-C', sourceRoot],
    archive,
    512 * 1024 * 1024
  );
}

async function assertFrozenSourceTree(sourceRoot: string): Promise<void> {
  async function walk(directory: string, prefix: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Frozen release source contains a symbolic link: ${relativePath}`);
      }
      if (entry.isDirectory()) {
        await walk(absolutePath, relativePath);
        continue;
      }
      if (!entry.isFile()) {
        throw new Error(`Frozen release source contains a non-ordinary entry: ${relativePath}`);
      }
      const handle = await fs.open(absolutePath, 'r');
      try {
        const prefixBytes = Buffer.alloc(GIT_LFS_POINTER_PREFIX.byteLength);
        const { bytesRead } = await handle.read(prefixBytes, 0, prefixBytes.byteLength, 0);
        if (
          bytesRead === GIT_LFS_POINTER_PREFIX.byteLength &&
          prefixBytes.equals(GIT_LFS_POINTER_PREFIX)
        ) {
          throw new Error(`Frozen release source contains a Git LFS pointer: ${relativePath}`);
        }
      } finally {
        await handle.close();
      }
    }
  }
  await walk(sourceRoot, '');
}

async function readFrozenPackageConfig(sourceRoot: string): Promise<{
  version: string;
  dependencies: readonly string[];
  dependencyLockDigest: `sha256:${string}`;
}> {
  const packageBytes = await fs.readFile(path.join(sourceRoot, 'package.json'));
  const lockBytes = await fs.readFile(path.join(sourceRoot, 'bun.lock'));
  const raw = JSON.parse(packageBytes.toString('utf8')) as {
    version?: unknown;
    packageManager?: unknown;
    dependencies?: Record<string, unknown>;
  };
  if (typeof raw.version !== 'string' || raw.version.length === 0) {
    throw new Error('Frozen package.json does not contain a valid version');
  }
  if (raw.packageManager !== `bun@${Bun.version}`) {
    throw new Error(
      `Release builder bun@${Bun.version} does not match frozen packageManager ${String(raw.packageManager)}`
    );
  }
  return Object.freeze({
    version: raw.version,
    dependencies: Object.freeze(Object.keys(raw.dependencies ?? {}).sort()),
    dependencyLockDigest: `sha256:${digest(lockBytes)}` as `sha256:${string}`
  });
}

async function materializeFrozenDependencies(sourceRoot: string): Promise<void> {
  const packagePath = path.join(sourceRoot, 'package.json');
  const lockPath = path.join(sourceRoot, 'bun.lock');
  const [packageBefore, lockBefore] = await Promise.all([
    fs.readFile(packagePath),
    fs.readFile(lockPath)
  ]);

  commandBytes(
    sourceRoot,
    process.execPath,
    ['install', '--frozen-lockfile', '--ignore-scripts'],
    undefined,
    512 * 1024 * 1024
  );

  const [packageAfter, lockAfter, nodeModules] = await Promise.all([
    fs.readFile(packagePath),
    fs.readFile(lockPath),
    fs.lstat(path.join(sourceRoot, 'node_modules'))
  ]);
  if (!packageAfter.equals(packageBefore) || !lockAfter.equals(lockBefore)) {
    throw new Error('Frozen dependency materialization changed package.json or bun.lock');
  }
  if (nodeModules.isSymbolicLink() || !nodeModules.isDirectory()) {
    throw new Error('Frozen dependency materialization did not produce one ordinary node_modules directory');
  }
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (
    !path.isAbsolute(relative) &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`)
  );
}

async function assertFrozenBuildInputs(sourceRoot: string, metafilePath: string): Promise<void> {
  const metafile = JSON.parse(await fs.readFile(metafilePath, 'utf8')) as BuildMetafile;
  if (metafile.inputs === undefined || typeof metafile.inputs !== 'object') {
    throw new Error('Release bundle metafile does not contain an input inventory');
  }
  for (const inputPath of Object.keys(metafile.inputs)) {
    if (inputPath.startsWith('node:') || inputPath.startsWith('bun:')) continue;
    const absoluteInput = path.isAbsolute(inputPath)
      ? path.resolve(inputPath)
      : path.resolve(sourceRoot, inputPath);
    if (!isPathInside(sourceRoot, absoluteInput)) {
      throw new Error(`Release bundle consumed an input outside frozen source: ${inputPath}`);
    }
  }
}

function frozenExternalImports(dependencies: readonly string[]): readonly string[] {
  return Object.freeze([
    ...dependencies,
    'bun',
    'typescript',
    'node:path',
    'node:fs',
    'node:child_process',
    'node:url',
    'node:os'
  ]);
}

export async function prepareFrozenReleaseSourceV1(repositoryRoot: string): Promise<FrozenReleaseSourceV1> {
  const absoluteRepositoryRoot = path.resolve(repositoryRoot);
  const sourceCommit = assertGitObjectId(
    gitText(absoluteRepositoryRoot, ['rev-parse', '--verify', 'HEAD^{commit}']),
    'Release source Git commit identity'
  );
  assertTrackedWorktreeMatchesCommit(absoluteRepositoryRoot, sourceCommit);
  const sourceTree = assertGitObjectId(
    gitText(absoluteRepositoryRoot, ['rev-parse', '--verify', `${sourceCommit}^{tree}`]),
    'Release source Git tree identity'
  );
  assertReleaseGitTreeOrdinary(absoluteRepositoryRoot, sourceCommit);

  const stageRoot = await fs.mkdtemp(path.join(tmpdir(), 'sec-release-source-'));
  const sourceRoot = path.join(stageRoot, 'source');
  try {
    await fs.mkdir(sourceRoot);
    materializeExactGitTree(absoluteRepositoryRoot, sourceRoot, sourceCommit);
    await assertFrozenSourceTree(sourceRoot);
    const frozenPackage = await readFrozenPackageConfig(sourceRoot);
    await materializeFrozenDependencies(sourceRoot);
    return Object.freeze({
      schema: 'sec-frozen-release-source-v1' as const,
      root: sourceRoot,
      sourceCommit,
      sourceTree,
      packageVersion: frozenPackage.version,
      dependencies: frozenPackage.dependencies,
      dependencyLockDigest: frozenPackage.dependencyLockDigest,
      stageRoot
    });
  } catch (error) {
    await fs.rm(stageRoot, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export async function buildFrozenReleaseBundleV1(
  source: FrozenReleaseSourceV1,
  stagedArtifactRoot: string
): Promise<void> {
  const metafilePath = path.join(source.root, RELEASE_BUILD_META_FILE_NAME);
  const args = [
    'build',
    './platform/cli/index.ts',
    '--outdir',
    stagedArtifactRoot,
    '--target',
    'node',
    '--metafile',
    metafilePath
  ];
  for (const external of frozenExternalImports(source.dependencies)) {
    args.push('--external', external);
  }
  commandBytes(source.root, process.execPath, args, undefined, 512 * 1024 * 1024);
  await assertFrozenBuildInputs(source.root, metafilePath);
}

export async function disposeFrozenReleaseSourceV1(source: FrozenReleaseSourceV1): Promise<void> {
  await fs.rm(source.stageRoot, { recursive: true, force: true });
}
