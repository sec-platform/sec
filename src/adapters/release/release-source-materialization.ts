import fs from 'node:fs/promises';
import path from 'node:path';

import { inspectNoFollowDirectoryChain, retainNoFollowDirectoryForChildProcess, retainNoFollowOrdinaryFile } from '../../adapters/runtime-state/physical/runtime/physical-no-follow.ts';
import {
  assertProcessResourceSessionReceipt,
  openProcessResourceSession,
  type ProcessResourceSession,
  type ProcessResourceSessionReceipt
} from '../../adapters/runtime-state/physical/runtime/process-resource-session.ts';
import { RETAINED_EXECUTABLE_CHILD_DESCRIPTOR, RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR, issueRetainedCommandBoundary } from '../../adapters/runtime-state/physical/runtime/process.ts';
import { settlePhysicalResources } from '../../adapters/runtime-state/physical/runtime/resource-settlement.ts';
import { SecError } from '../../contracts/failure.ts';
import { digest, sha256 } from '../../contracts/canonical.ts';
import { issueSecOperationRequirementBindingContext } from '../../execution/operation/requirement-binding-context.ts';
import {
  bindSecSemanticOperation,
  compileSecCapabilityBinding,
  compileSecSemanticOperationPlan,
  issueSecSemanticOperationAttemptContext,
  type SecBoundSemanticOperation,
  type SecOperationDigest
} from '../../execution/operation/semantic.ts';
import {
  loadCanonicalBunRuntimeVersion,
  parseCompilerPackageEntrypointBinding,
  type CompilerPackageEntrypointBinding
} from '../../adapters/toolchain/runtime.ts';
import { materializeExactReleaseGitTree } from './release-git-tree-source.ts';

const RELEASE_BUILD_META_FILE_NAME = '.sec-release-build-metafile.json' as const;
const RELEASE_BUILDER_MAX_DURATION_MS = 10 * 60_000;
const RELEASE_BUILDER_MAX_STDOUT_BYTES = 512 * 1024 * 1024;
const RELEASE_BUILDER_MAX_STDERR_BYTES = 8 * 1024 * 1024;
const RELEASE_BUILDER_OPERATION = 'release.builder-command';
const RELEASE_BUILDER_REQUIREMENT = 'release.builder-process';

export interface ReleaseBuilderIdentity {
  readonly schema: 'sec-release-builder-identity-v1';
  readonly runtime: 'bun';
  readonly version: string;
  readonly executableSha256: `sha256:${string}`;
  readonly platform: NodeJS.Platform;
  readonly architecture: string;
}

export function assertReleaseBunRuntimeRequirement(
  requirement: ReleaseBuilderIdentity,
  observedVersion: string | null = process.versions.bun ?? null
): void {
  if (observedVersion !== requirement.version) {
    throw new SecError(
      'RUNTIME-LAYOUT-001',
      observedVersion === null
        ? 'SEC release artifact requires the canonical Bun host runtime'
        : 'SEC release artifact does not support this Bun host runtime generation',
      Object.freeze({
        disposition: 'unsupported',
        runtime: 'bun',
        requiredVersion: requirement.version,
        observedVersion
      })
    );
  }
}

export interface FrozenReleaseSource {
  readonly schema: 'sec-frozen-release-source-v1';
  readonly root: string;
  readonly sourceCommit: string;
  readonly sourceTree: string;
  readonly packageVersion: string;
  readonly entrypoint: CompilerPackageEntrypointBinding;
  readonly dependencies: readonly string[];
  readonly dependencyLockDigest: `sha256:${string}`;
  readonly builder: ReleaseBuilderIdentity;
  readonly stageRoot: string;
}

type BuildMetafile = Readonly<{
  inputs?: Record<string, unknown>;
}>;

function exactReleaseBuilderEnvironment(): Readonly<Record<string, string>> {
  return Object.freeze(Object.fromEntries(
    Object.entries(process.env)
      .filter((entry): entry is [string, string] => entry[1] !== undefined)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
  ));
}

function compileReleaseBuilderOperation(input: Readonly<{
  args: readonly string[];
  builder: ReleaseBuilderIdentity;
  cwd: string;
  deadlineAtUnixMs: number;
  environment: Readonly<Record<string, string>>;
  maximumStdoutBytes: number;
  providerIdentityDigest: SecOperationDigest;
}>): SecBoundSemanticOperation {
  const remainingDurationMs = input.deadlineAtUnixMs - Date.now();
  if (!Number.isSafeInteger(input.deadlineAtUnixMs)
      || !Number.isSafeInteger(remainingDurationMs)
      || remainingDurationMs < 1
      || remainingDurationMs > RELEASE_BUILDER_MAX_DURATION_MS) {
    throw new Error('Release builder absolute deadline elapsed during physical admission.');
  }
  const contractDigest = sha256({
    operation: RELEASE_BUILDER_OPERATION,
    runtime: 'bun',
    processCount: 1,
    maximumDurationMs: RELEASE_BUILDER_MAX_DURATION_MS,
    maximumStdoutBytes: input.maximumStdoutBytes,
    maximumStderrBytes: RELEASE_BUILDER_MAX_STDERR_BYTES
  }) as SecOperationDigest;
  const plan = compileSecSemanticOperationPlan({
    operation: RELEASE_BUILDER_OPERATION,
    intentDigest: sha256({
      args: input.args,
      builder: input.builder,
      cwd: input.cwd,
      environment: input.environment,
      providerIdentityDigest: input.providerIdentityDigest
    }) as SecOperationDigest,
    decisionDigest: contractDigest,
    deadlineAtUnixMs: input.deadlineAtUnixMs,
    attempt: issueSecSemanticOperationAttemptContext({
      authorityGrantDigest: contractDigest
    }),
    aggregateBudgets: [
      { resource: 'duration-ms', maximum: remainingDurationMs },
      { resource: 'input-bytes', maximum: 0 },
      {
        resource: 'output-bytes',
        maximum: input.maximumStdoutBytes + RELEASE_BUILDER_MAX_STDERR_BYTES
      },
      { resource: 'processes', maximum: 1 }
    ],
    requirements: [{
      id: RELEASE_BUILDER_REQUIREMENT,
      contractDigest,
      effectKinds: ['filesystem', 'process'],
      failureKinds: [
        'filesystem.identity-drift',
        'filesystem.materialization-failed',
        'process.cancelled',
        'process.deadline-exhausted',
        'process.identity-drift',
        'process.output-budget-exhausted',
        'process.settlement-unproven',
        'process.unavailable'
      ]
    }]
  });
  return bindSecSemanticOperation(plan, [compileSecCapabilityBinding({
    requirementId: RELEASE_BUILDER_REQUIREMENT,
    contractDigest,
    providerIdentityDigest: input.providerIdentityDigest
  })]);
}

function assertReleaseBuilderReceipt(
  receipt: ProcessResourceSessionReceipt,
  operation: SecBoundSemanticOperation,
  completed: boolean
): void {
  assertProcessResourceSessionReceipt(receipt, {
    operationIdentityDigest: operation.plan.identity.identityDigest,
    boundAttemptDigest: operation.boundAttemptDigest,
    requirementId: RELEASE_BUILDER_REQUIREMENT
  });
  if (receipt.processCount < (completed ? 1 : 0)
      || receipt.processCount > 1
      || receipt.settledProcessCount !== receipt.processCount
      || receipt.successfulProcessRecordCount !== (completed ? 1 : 0)
      || receipt.inputBytes !== 0
      || receipt.outputBytes > (operation.plan.execution.aggregateBudgets.find(
        ({ resource }) => resource === 'output-bytes'
      )?.maximum ?? -1)) {
    throw new Error('Release builder process receipt does not match the bound operation.');
  }
}

async function runReleaseBuilderCommand(
  cwd: string,
  args: readonly string[],
  builder: ReleaseBuilderIdentity,
  maxOutputBytes = 256 * 1024 * 1024
): Promise<Buffer> {
  if (!Number.isSafeInteger(maxOutputBytes)
      || maxOutputBytes < 1
      || maxOutputBytes > RELEASE_BUILDER_MAX_STDOUT_BYTES) {
    throw new Error('Release builder stdout budget exceeds the canonical owner ceiling.');
  }
  const deadlineAtUnixMs = Date.now() + RELEASE_BUILDER_MAX_DURATION_MS;
  const absoluteCwd = path.resolve(cwd);
  const executablePath = path.resolve(await fs.realpath(process.execPath));
  let executable: ReturnType<typeof retainNoFollowOrdinaryFile> | undefined;
  let workingDirectory: ReturnType<typeof retainNoFollowDirectoryForChildProcess> | undefined;
  let session: ProcessResourceSession | undefined;
  let operation: SecBoundSemanticOperation | undefined;
  let completed = false;
  let executionError: unknown | undefined;
  let result: Awaited<ReturnType<ProcessResourceSession['run']>> | undefined;
  try {
    const executableParent = inspectNoFollowDirectoryChain(
      path.dirname(executablePath),
      'release builder executable parent'
    );
    executable = retainNoFollowOrdinaryFile(
      executableParent,
      path.basename(executablePath),
      undefined,
      'release builder executable',
      RETAINED_EXECUTABLE_CHILD_DESCRIPTOR,
      'executable'
    );
    const workingDirectoryChain = inspectNoFollowDirectoryChain(
      absoluteCwd,
      'release builder working directory'
    );
    workingDirectory = retainNoFollowDirectoryForChildProcess(
      workingDirectoryChain,
      RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR,
      'release builder working directory'
    );
    if (executable.digest().byteDigest !== builder.executableSha256) {
      throw new Error('Retained release builder bytes differ from the frozen builder identity');
    }
    const providerIdentityDigest = sha256({
      domain: 'release.builder-command.physical-provider',
      executable: {
        path: executable.path,
        parent: executable.parent,
        physical: executable.physical,
        size: executable.size
      },
      workingDirectory: workingDirectoryChain.target
    }) as SecOperationDigest;
    const environment = exactReleaseBuilderEnvironment();
    operation = compileReleaseBuilderOperation({
      args,
      builder,
      cwd: absoluteCwd,
      deadlineAtUnixMs,
      environment,
      maximumStdoutBytes: maxOutputBytes,
      providerIdentityDigest
    });
    session = openProcessResourceSession({
      operation,
      requirementBindingContext: issueSecOperationRequirementBindingContext({
        operation,
        requirementId: RELEASE_BUILDER_REQUIREMENT,
        resourceCeilings: operation.plan.execution.aggregateBudgets
      })
    });
    result = await session.run(
      issueRetainedCommandBoundary({ executable, workingDirectory }),
      [...args],
      {
        env: environment,
        envMode: 'replace',
        maxStderrBytes: RELEASE_BUILDER_MAX_STDERR_BYTES,
        maxStdoutBytes: maxOutputBytes
      }
    );
    completed = true;
  } catch (error) {
    executionError = error;
  }

  let receipt: ProcessResourceSessionReceipt | undefined;
  let settlementError: unknown | undefined;
  try {
    settlePhysicalResources({
      ...(executionError === undefined ? {} : {
        primary: { label: 'release builder execution', error: executionError }
      }),
      cleanup: [
        ...(session === undefined ? [] : [{
          label: 'release builder process session close',
          settle: () => { receipt = session!.close(); }
        }]),
        ...(workingDirectory === undefined ? [] : [{
          label: 'release builder working directory dispose',
          settle: () => workingDirectory!.dispose()
        }]),
        ...(executable === undefined ? [] : [{
          label: 'release builder executable dispose',
          settle: () => executable!.dispose()
        }])
      ]
    });
  } catch (error) {
    settlementError = error;
  }
  if (session !== undefined) {
    if (operation === undefined) {
      throw new Error('Release builder did not issue one terminal process receipt.');
    }
    if (receipt === undefined) {
      if (settlementError !== undefined) throw settlementError;
      throw new Error('Release builder did not issue one terminal process receipt.');
    }
    assertReleaseBuilderReceipt(receipt, operation, completed);
  }
  if (settlementError !== undefined) throw settlementError;
  if (result === undefined) throw executionError;
  if (result.result.code !== 0) {
    const detail = result.result.stderr.trim();
    throw new Error(`bun ${args[0] ?? ''} failed${detail ? `: ${detail}` : ''}`);
  }
  return Buffer.from(result.result.stdout);
}

async function observeReleaseBuilderIdentity(): Promise<ReleaseBuilderIdentity> {
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
  left: ReleaseBuilderIdentity,
  right: ReleaseBuilderIdentity
): boolean {
  return left.schema === right.schema &&
    left.runtime === right.runtime &&
    left.version === right.version &&
    left.executableSha256 === right.executableSha256 &&
    left.platform === right.platform &&
    left.architecture === right.architecture;
}

async function assertBuilderIdentityUnchanged(
  expected: ReleaseBuilderIdentity,
  phase: string
): Promise<void> {
  const current = await observeReleaseBuilderIdentity();
  if (!sameBuilderIdentity(expected, current)) {
    throw new Error(`Release Bun builder identity changed ${phase}`);
  }
}

async function readFrozenPackageConfig(
  sourceRoot: string,
  builder: ReleaseBuilderIdentity
): Promise<{
  version: string;
  entrypoint: CompilerPackageEntrypointBinding;
  dependencies: readonly string[];
  dependencyLockDigest: `sha256:${string}`;
}> {
  const [packageBytes, lockBytes, canonicalBunVersion] = await Promise.all([
    fs.readFile(path.join(sourceRoot, 'package.json')),
    fs.readFile(path.join(sourceRoot, 'bun.lock')),
    loadCanonicalBunRuntimeVersion(sourceRoot)
  ]);
  const raw = JSON.parse(packageBytes.toString('utf8')) as {
    version?: unknown;
    packageManager?: unknown;
    source?: unknown;
    bin?: unknown;
    scripts?: unknown;
    dependencies?: Record<string, unknown>;
  };
  if (typeof raw.version !== 'string' || raw.version.length === 0) {
    throw new Error('Frozen package.json does not contain a valid version');
  }
  assertReleaseBunRuntimeRequirement(builder, canonicalBunVersion);
  if (raw.packageManager !== `bun@${builder.version}`) {
    throw new Error(
      `Release builder bun@${builder.version} does not match frozen packageManager ${String(raw.packageManager)}`
    );
  }
  const entrypoint = parseCompilerPackageEntrypointBinding(raw);
  return Object.freeze({
    version: raw.version,
    entrypoint,
    dependencies: Object.freeze(Object.keys(raw.dependencies ?? {}).sort()),
    dependencyLockDigest: `sha256:${digest(lockBytes)}` as `sha256:${string}`
  });
}

async function materializeFrozenDependencies(
  sourceRoot: string,
  builder: ReleaseBuilderIdentity
): Promise<void> {
  const packagePath = path.join(sourceRoot, 'package.json');
  const lockPath = path.join(sourceRoot, 'bun.lock');
  const [packageBefore, lockBefore] = await Promise.all([
    fs.readFile(packagePath),
    fs.readFile(lockPath)
  ]);

  await assertBuilderIdentityUnchanged(builder, 'before dependency materialization');
  await runReleaseBuilderCommand(
    sourceRoot,
    [
      'install',
      '--frozen-lockfile',
      '--ignore-scripts',
      '--backend',
      'copyfile',
      '--no-progress',
      '--no-summary'
    ],
    builder,
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

export async function prepareFrozenReleaseSource(repositoryRoot: string): Promise<FrozenReleaseSource> {
  const builder = await observeReleaseBuilderIdentity();
  const materialized = await materializeExactReleaseGitTree(repositoryRoot);
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
      entrypoint: frozenPackage.entrypoint,
      dependencies: frozenPackage.dependencies,
      dependencyLockDigest: frozenPackage.dependencyLockDigest,
      builder,
      stageRoot: materialized.stageRoot
    });
  } catch (error) {
    try {
      await fs.rm(materialized.stageRoot, { recursive: true, force: true });
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `Frozen release source preparation failed and staging cleanup did not converge: ${materialized.stageRoot}`
      );
    }
    throw error;
  }
}

export async function buildFrozenReleaseBundle(
  source: FrozenReleaseSource,
  stagedArtifactRoot: string
): Promise<void> {
  assertReleaseBunRuntimeRequirement(source.builder);
  const metafilePath = path.join(source.root, RELEASE_BUILD_META_FILE_NAME);
  const args = [
    'build',
    `./${source.entrypoint.source}`,
    `--outdir=${stagedArtifactRoot}`,
    `--entry-naming=${path.posix.basename(source.entrypoint.artifact)}`,
    '--target=bun',
    `--metafile=${metafilePath}`
  ];
  for (const external of frozenExternalImports(source.dependencies)) {
    args.push('--external', external);
  }
  await assertBuilderIdentityUnchanged(source.builder, 'before bundle execution');
  await runReleaseBuilderCommand(source.root, args, source.builder, 512 * 1024 * 1024);
  await assertBuilderIdentityUnchanged(source.builder, 'during bundle execution');
  await assertFrozenBuildInputs(source.root, metafilePath);
}

export async function disposeFrozenReleaseSource(source: FrozenReleaseSource): Promise<void> {
  await fs.rm(source.stageRoot, { recursive: true, force: true });
}
