import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

import { digest } from '../shared/canonical-primitives.ts';
import { materializeExactReleaseGitTreeV1 } from './release-git-tree-source.ts';

const RELEASE_BUILD_META_FILE_NAME = '.sec-release-build-metafile.json' as const;

export interface ReleaseBuilderIdentityV1 {
  readonly schema: 'sec-release-builder-identity-v1';
  readonly runtime: 'bun';
  readonly version: string;
  readonly executableSha256: `sha256:${string}`;
  readonly platform: NodeJS.Platform;
  readonly architecture: string;
}

export interface FrozenReleaseSourceV1 {
  readonly schema: 'sec-frozen-release-source-v1';
  readonly root: string;
  readonly sourceCommit: string;
  readonly sourceTree: string;
  readonly packageVersion: string;
  readonly dependencies: readonly string[];
  readonly dependencyLockDigest: `sha256:${string}`;
  readonly builder: ReleaseBuilderIdentityV1;
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
    stdout: Buffer.isBuffer(result.stdout) ? Buffer.from(result.stdout) : Buffer.from(String(result.stdout ?? '')),
    stderr: Buffer.isBuffer(result.stderr) ? Buffer.from(result.stderr) : Buffer.from(String(result.stderr ?? '')),
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

async function observeReleaseBuilderIdentityV1(): Promise<ReleaseBuilderIdentityV1> {
  const executablePath = await fs.realpath(process.execPath);
  const before = await fs.lstat(executablePath, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new Error('Release Bun executable must be one physical ordinary file');
  }
  const bytes = await fs.readFile(executablePath);
  const [after, afterPath] = await Promise.all([
    fs.lstat(executablePath, { bigint: true }),
    fs.realpath(process.execPath)
  ]);
  if (
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.mode !== after.mode ||
    before.size !== after.size ||
    before.mtimeNs !== after.mtimeNs ||
    path.resolve(afterPath) !== path.resolve(executablePath)
  ) {
    throw new Error('Release Bun executable changed during identity observation');
  }
  return Object.freeze({
    schema: 'sec-release-builder-identity-v1' as const,
    runtime: 'bun' as const,
    version: Bun.version,
    executableSha256: `sha256:${digest(bytes)}` as `sha256:${string}`,
    platform: process.platform,
    architecture: process.arch
  });
}

function sameBuilderIdentity(
  left: ReleaseBuilderIdentityV1,
  right: ReleaseBuilderIdentityV1
): boolean {
  return left.schema === right.schema &&
    left.runtime === right.runtime &&
    left.version === right.version &&
    left.executableSha256 === right.executableSha256 &&
    left.platform === right.platform &&
    left.architecture === right.architecture;
}

async function assertBuilderIdentityUnchanged(
  expected: ReleaseBuilderIdentityV1,
  phase: string
): Promise<void> {
  const current = await observeReleaseBuilderIdentityV1();
  if (!sameBuilderIdentity(expected, current)) {
    throw new Error(`Release Bun builder identity changed ${phase}`);
  }
}

async function readFrozenPackageConfig(
  sourceRoot: string,
  builder: ReleaseBuilderIdentityV1
): Promise<{
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
  if (raw.packageManager !== `bun@${builder.version}`) {
    throw new Error(
      `Release builder bun@${builder.version} does not match frozen packageManager ${String(raw.packageManager)}`
    );
  }
  return Object.freeze({
    version: raw.version,
    dependencies: Object.freeze(Object.keys(raw.dependencies ?? {}).sort()),
    dependencyLockDigest: `sha256:${digest(lockBytes)}` as `sha256:${string}`
  });
}

async function materializeFrozenDependencies(
  sourceRoot: string,
  builder: ReleaseBuilderIdentityV1
): Promise<void> {
  const packagePath = path.join(sourceRoot, 'package.json');
  const lockPath = path.join(sourceRoot, 'bun.lock');
  const [packageBefore, lockBefore] = await Promise.all([
    fs.readFile(packagePath),
    fs.readFile(lockPath)
  ]);

  await assertBuilderIdentityUnchanged(builder, 'before dependency materialization');
  commandBytes(
    sourceRoot,
    process.execPath,
    [
      'install',
      '--frozen-lockfile',
      '--ignore-scripts',
      '--backend',
      'copyfile',
      '--no-progress',
      '--no-summary'
    ],
    undefined,
    512 * 1024 * 1024
  );
  await assertBuilderIdentityUnchanged(builder, 'during dependency materialization');

  const [packageAfter, lockAfter, nodeModules, nodeModulesReal, sourceReal] = await Promise.all([
    fs.readFile(packagePath),
    fs.readFile(lockPath),
    fs.lstat(path.join(sourceRoot, 'node_modules')),
    fs.realpath(path.join(sourceRoot, 'node_modules')),
    fs.realpath(sourceRoot)
  ]);
  if (!packageAfter.equals(packageBefore) || !lockAfter.equals(lockBefore)) {
    throw new Error('Frozen dependency materialization changed package.json or bun.lock');
  }
  if (nodeModules.isSymbolicLink() || !nodeModules.isDirectory()) {
    throw new Error('Frozen dependency materialization did not produce one ordinary node_modules directory');
  }
  if (!isPathInside(path.resolve(sourceReal), path.resolve(nodeModulesReal))) {
    throw new Error('Frozen dependency materialization escaped the frozen source root');
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
  const physicalSourceRoot = path.resolve(await fs.realpath(sourceRoot));
  for (const inputPath of Object.keys(metafile.inputs)) {
    if (inputPath.startsWith('node:') || inputPath.startsWith('bun:')) continue;
    const absoluteInput = path.isAbsolute(inputPath)
      ? path.resolve(inputPath)
      : path.resolve(sourceRoot, inputPath);
    if (!isPathInside(path.resolve(sourceRoot), absoluteInput)) {
      throw new Error(`Release bundle consumed a lexical input outside frozen source: ${inputPath}`);
    }
    const [physicalInput, metadata] = await Promise.all([
      fs.realpath(absoluteInput),
      fs.stat(absoluteInput)
    ]);
    if (!metadata.isFile()) {
      throw new Error(`Release bundle input is not one ordinary file: ${inputPath}`);
    }
    if (!isPathInside(physicalSourceRoot, path.resolve(physicalInput))) {
      throw new Error(`Release bundle consumed a physical input outside frozen source: ${inputPath}`);
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
  const builder = await observeReleaseBuilderIdentityV1();
  const materialized = await materializeExactReleaseGitTreeV1(repositoryRoot);
  try {
    await assertBuilderIdentityUnchanged(builder, 'before frozen package observation');
    const frozenPackage = await readFrozenPackageConfig(materialized.root, builder);
    await materializeFrozenDependencies(materialized.root, builder);
    return Object.freeze({
      schema: 'sec-frozen-release-source-v1' as const,
      root: materialized.root,
      sourceCommit: materialized.sourceCommit,
      sourceTree: materialized.sourceTree,
      packageVersion: frozenPackage.version,
      dependencies: frozenPackage.dependencies,
      dependencyLockDigest: frozenPackage.dependencyLockDigest,
      builder,
      stageRoot: materialized.stageRoot
    });
  } catch (error) {
    await fs.rm(materialized.stageRoot, { recursive: true, force: true }).catch(() => undefined);
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
  await assertBuilderIdentityUnchanged(source.builder, 'before bundle execution');
  commandBytes(source.root, process.execPath, args, undefined, 512 * 1024 * 1024);
  await assertBuilderIdentityUnchanged(source.builder, 'during bundle execution');
  await assertFrozenBuildInputs(source.root, metafilePath);
}

export async function disposeFrozenReleaseSourceV1(source: FrozenReleaseSourceV1): Promise<void> {
  await fs.rm(source.stageRoot, { recursive: true, force: true });
}
