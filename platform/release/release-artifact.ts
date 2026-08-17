import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { digest, sha256 } from '../shared/canonical-primitives.ts';
import {
  COMPILER_RUNTIME_RESOURCE_RELATIVE_PATHS,
  RELEASE_ENTRYPOINT_RELATIVE_PATH,
  resolveCompilerRuntimeLayout
} from '../shared/runtime-layout.ts';

export const RELEASE_ARTIFACT_MANIFEST_RELATIVE_PATH = 'release-artifact-manifest.json' as const;
const RELEASE_BUILD_META_FILE_NAME = '.sec-release-build-metafile.json' as const;

export interface ReleaseArtifactFileV1 {
  readonly path: string;
  readonly bytes: number;
  readonly digest: `sha256:${string}`;
  readonly executable: boolean;
}

export interface ReleaseArtifactManifestV1 {
  readonly schema: 'sec-release-artifact-manifest-v1';
  readonly packageVersion: string;
  readonly sourceCommit: string;
  readonly sourceTree: string;
  readonly dependencyLockDigest: `sha256:${string}`;
  readonly builder: string;
  readonly files: readonly ReleaseArtifactFileV1[];
  readonly contentDigest: `sha256:${string}`;
}

export interface ReleaseArtifactBuildReceiptV1 {
  readonly schema: 'sec-release-artifact-build-receipt-v1';
  readonly sourceCommit: string;
  readonly sourceTree: string;
  readonly artifactRoot: string;
  readonly manifestDigest: `sha256:${string}`;
  readonly fileCount: number;
}

type CommandResult = Readonly<{
  status: number | null;
  stdout: Buffer;
  stderr: Buffer;
  error: Error | undefined;
}>;

type FrozenPackageConfig = Readonly<{
  version: string;
  dependencies: readonly string[];
  dependencyLockDigest: `sha256:${string}`;
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

function assertReleaseSourceClean(repositoryRoot: string): void {
  const status = commandBytes(
    repositoryRoot,
    'git',
    ['status', '--porcelain=v1', '--untracked-files=all', '-z'],
    undefined,
    64 * 1024 * 1024
  );
  if (status.byteLength !== 0) {
    throw new Error('Release artifact build requires a clean tracked and untracked repository surface');
  }
}

function materializeExactGitTree(repositoryRoot: string, sourceRoot: string): void {
  const archive = commandBytes(
    repositoryRoot,
    'git',
    ['archive', '--format=tar', 'HEAD'],
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

async function readFrozenPackageConfig(sourceRoot: string): Promise<FrozenPackageConfig> {
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
    throw new Error(`Release builder Bun version does not match frozen packageManager: expected bun@${Bun.version}`);
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
  const [packageBefore, lockBefore] = await Promise.all([fs.readFile(packagePath), fs.readFile(lockPath)]);
  commandBytes(sourceRoot, process.execPath, ['install', '--frozen-lockfile', '--ignore-scripts'], undefined, 512 * 1024 * 1024);
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
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

async function assertFrozenBuildInputs(sourceRoot: string, metafilePath: string): Promise<void> {
  const metafile = JSON.parse(await fs.readFile(metafilePath, 'utf8')) as BuildMetafile;
  if (metafile.inputs === undefined || typeof metafile.inputs !== 'object') {
    throw new Error('Release bundle metafile does not contain an input inventory');
  }
  for (const inputPath of Object.keys(metafile.inputs)) {
    if (inputPath.startsWith('node:') || inputPath.startsWith('bun:')) continue;
    const absoluteInput = path.isAbsolute(inputPath) ? path.resolve(inputPath) : path.resolve(sourceRoot, inputPath);
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

async function buildFrozenSourceBundle(sourceRoot: string, stagedArtifactRoot: string, dependencies: readonly string[]): Promise<void> {
  const metafilePath = path.join(sourceRoot, RELEASE_BUILD_META_FILE_NAME);
  const args = ['build', './platform/cli/index.ts', '--outdir', stagedArtifactRoot, '--target', 'node', '--metafile', metafilePath];
  for (const external of frozenExternalImports(dependencies)) args.push('--external', external);
  commandBytes(sourceRoot, process.execPath, args, undefined, 512 * 1024 * 1024);
  await assertFrozenBuildInputs(sourceRoot, metafilePath);
}

async function listArtifactFiles(root: string): Promise<ReleaseArtifactFileV1[]> {
  const files: ReleaseArtifactFileV1[] = [];
  async function walk(directory: string, prefix: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (relativePath === RELEASE_ARTIFACT_MANIFEST_RELATIVE_PATH) continue;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Release artifact contains a symbolic link: ${relativePath}`);
      if (entry.isDirectory()) {
        await walk(absolutePath, relativePath);
        continue;
      }
      if (!entry.isFile()) throw new Error(`Release artifact contains a non-ordinary entry: ${relativePath}`);
      const [bytes, metadata] = await Promise.all([fs.readFile(absolutePath), fs.stat(absolutePath)]);
      files.push(Object.freeze({
        path: relativePath,
        bytes: bytes.byteLength,
        digest: `sha256:${digest(bytes)}` as `sha256:${string}`,
        executable: (metadata.mode & 0o111) !== 0
      }));
    }
  }
  await walk(root, '');
  return files;
}

function manifestMaterial(input: Omit<ReleaseArtifactManifestV1, 'contentDigest'>) {
  return Object.freeze({ ...input });
}

function manifestMaterialFromReadback(readback: ReleaseArtifactManifestV1) {
  return manifestMaterial({
    schema: readback.schema,
    packageVersion: readback.packageVersion,
    sourceCommit: readback.sourceCommit,
    sourceTree: readback.sourceTree,
    dependencyLockDigest: readback.dependencyLockDigest,
    builder: readback.builder,
    files: readback.files
  });
}

async function assertReleaseArtifactReadback(artifactRoot: string, label: 'staged' | 'published'): Promise<ReleaseArtifactManifestV1> {
  const manifestPath = path.join(artifactRoot, RELEASE_ARTIFACT_MANIFEST_RELATIVE_PATH);
  const readback = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as ReleaseArtifactManifestV1;
  if (readback.schema !== 'sec-release-artifact-manifest-v1') throw new Error(`${label} release artifact manifest schema is invalid`);
  if (!/^sha256:[0-9a-f]{64}$/u.test(readback.dependencyLockDigest)) throw new Error(`${label} release artifact dependency lock digest is invalid`);
  if (sha256(manifestMaterialFromReadback(readback)) !== readback.contentDigest) throw new Error(`${label} release artifact manifest readback digest is invalid`);
  const physicalFiles = await listArtifactFiles(artifactRoot);
  if (sha256(physicalFiles) !== sha256(readback.files)) throw new Error(`${label} release artifact physical file inventory differs from manifest`);
  return readback;
}

async function writeAndVerifyManifest(artifactRoot: string, input: Omit<ReleaseArtifactManifestV1, 'files' | 'contentDigest'>): Promise<ReleaseArtifactManifestV1> {
  const files = Object.freeze(await listArtifactFiles(artifactRoot));
  const material = manifestMaterial({ ...input, files });
  const manifest: ReleaseArtifactManifestV1 = Object.freeze({ ...material, contentDigest: sha256(material) as `sha256:${string}` });
  const manifestPath = path.join(artifactRoot, RELEASE_ARTIFACT_MANIFEST_RELATIVE_PATH);
  await fs.writeFile(manifestPath, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'), { flag: 'wx' });
  return assertReleaseArtifactReadback(artifactRoot, 'staged');
}

async function publishAcceptedArtifact(stagedArtifactRoot: string, destinationRoot: string): Promise<void> {
  const parent = path.dirname(destinationRoot);
  const backupRoot = path.join(parent, `.sec-release-previous-${randomUUID()}`);
  let movedPrevious = false;
  try {
    try {
      await fs.rename(destinationRoot, backupRoot);
      movedPrevious = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    try {
      await fs.rename(stagedArtifactRoot, destinationRoot);
    } catch (error) {
      if (movedPrevious) await fs.rename(backupRoot, destinationRoot);
      throw error;
    }
    try {
      await assertReleaseArtifactReadback(destinationRoot, 'published');
    } catch (error) {
      const failedRoot = path.join(parent, `.sec-release-failed-${randomUUID()}`);
      await fs.rename(destinationRoot, failedRoot).catch(() => undefined);
      if (movedPrevious) await fs.rename(backupRoot, destinationRoot).catch(() => undefined);
      throw error;
    }
    if (movedPrevious) await fs.rm(backupRoot, { recursive: true, force: true });
  } catch (error) {
    throw error;
  }
}

export async function buildReleaseArtifactV1(repositoryRoot: string, destinationRoot: string): Promise<ReleaseArtifactBuildReceiptV1> {
  const absoluteRepositoryRoot = path.resolve(repositoryRoot);
  const absoluteDestinationRoot = path.resolve(destinationRoot);
  assertReleaseSourceClean(absoluteRepositoryRoot);
  const sourceCommit = gitText(absoluteRepositoryRoot, ['rev-parse', '--verify', 'HEAD^{commit}']);
  const sourceTree = gitText(absoluteRepositoryRoot, ['rev-parse', '--verify', 'HEAD^{tree}']);
  if (!/^[0-9a-f]{40,64}$/u.test(sourceCommit) || !/^[0-9a-f]{40,64}$/u.test(sourceTree)) throw new Error('Release source Git identity is invalid');

  const artifactStageRoot = await fs.mkdtemp(path.join(path.dirname(absoluteDestinationRoot), '.sec-release-artifact-stage-'));
  const sourceStageRoot = await fs.mkdtemp(path.join(tmpdir(), 'sec-release-source-'));
  const sourceRoot = path.join(sourceStageRoot, 'source');
  await fs.mkdir(sourceRoot);
  const stageRuntimeLayout = resolveCompilerRuntimeLayout(pathToFileURL(path.join(artifactStageRoot, RELEASE_ENTRYPOINT_RELATIVE_PATH)).href);
  const stagedArtifactRoot = stageRuntimeLayout.runtimeAssetRoot;

  try {
    materializeExactGitTree(absoluteRepositoryRoot, sourceRoot);
    const frozenPackage = await readFrozenPackageConfig(sourceRoot);
    await materializeFrozenDependencies(sourceRoot);
    await fs.mkdir(stagedArtifactRoot, { recursive: true });
    await buildFrozenSourceBundle(sourceRoot, stagedArtifactRoot, frozenPackage.dependencies);

    for (const relativePath of Object.values(COMPILER_RUNTIME_RESOURCE_RELATIVE_PATHS)) {
      const source = path.join(sourceRoot, relativePath);
      const destination = path.join(stagedArtifactRoot, relativePath);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.cp(source, destination, { recursive: true });
    }

    const entrypoint = stageRuntimeLayout.executableModulePath;
    let entrypointBytes = await fs.readFile(entrypoint);
    if (!entrypointBytes.toString('utf8').startsWith('#!/usr/bin/env node')) {
      entrypointBytes = Buffer.concat([Buffer.from('#!/usr/bin/env node\n', 'utf8'), entrypointBytes]);
      await fs.writeFile(entrypoint, entrypointBytes);
    }
    await fs.chmod(entrypoint, 0o755);

    const manifest = await writeAndVerifyManifest(stagedArtifactRoot, {
      schema: 'sec-release-artifact-manifest-v1',
      packageVersion: frozenPackage.version,
      sourceCommit,
      sourceTree,
      dependencyLockDigest: frozenPackage.dependencyLockDigest,
      builder: `bun@${Bun.version}`
    });
    await publishAcceptedArtifact(stagedArtifactRoot, absoluteDestinationRoot);
    return Object.freeze({
      schema: 'sec-release-artifact-build-receipt-v1' as const,
      sourceCommit,
      sourceTree,
      artifactRoot: absoluteDestinationRoot,
      manifestDigest: manifest.contentDigest,
      fileCount: manifest.files.length
    });
  } finally {
    await Promise.all([
      fs.rm(artifactStageRoot, { recursive: true, force: true }).catch(() => undefined),
      fs.rm(sourceStageRoot, { recursive: true, force: true }).catch(() => undefined)
    ]);
  }
}
