import fs from 'node:fs/promises';
import path from 'node:path';

import {
  assertSameNoFollowDirectoryIdentity,
  inspectNoFollowDirectoryChain,
  inspectNoFollowOrdinaryFileEntry,
  retainNoFollowDirectoryForChildProcess,
  retainNoFollowOrdinaryFile
} from '../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  assertProcessResourceSessionReceipt,
  openProcessResourceSession,
  type ProcessResourceSession,
  type ProcessResourceSessionReceipt
} from '../runtime-state/physical/runtime/process-resource-session.ts';
import { RETAINED_EXECUTABLE_CHILD_DESCRIPTOR, RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR, issueRetainedCommandBoundary } from '../runtime-state/physical/runtime/process.ts';
import {
  loadCanonicalBunRuntimeVersion,
  parseCompilerPackageEntrypointBinding,
  type CompilerPackageEntrypointBinding
} from '../toolchain/runtime.ts';
import { rawSha256Hex, sha256 } from '../../contracts/canonical.ts';
import { FailureError } from '../../contracts/failure.ts';
import { issueOperationRequirementBindingContext } from '../../execution/operation/requirement-binding-context.ts';
import {
  bindSemanticOperation,
  compileCapabilityBinding,
  compileSemanticOperationPlan,
  issueSemanticOperationAttemptContext,
  type BoundSemanticOperation,
  type OperationDigest
} from '../../execution/operation/semantic.ts';
import { settleResources as settlePhysicalResources } from '../../execution/resource-settlement.ts';
import {
  disposeExactReleaseGitTree,
  materializeExactReleaseGitTree,
  type ExactReleaseGitTree
} from './release-git-tree-source.ts';

export const RELEASE_BUN_ENTRYPOINT_SHEBANG = '#!/usr/bin/env bun\n' as const;
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
    throw new FailureError(
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
  readonly entrypoint: CompilerPackageEntrypointBinding & Readonly<{ source: string }>;
  readonly dependencies: readonly string[];
  readonly dependencyLockDigest: `sha256:${string}`;
  readonly builder: ReleaseBuilderIdentity;
  readonly stageRoot: string;
}

const frozenReleaseSourceMaterializations =
  new WeakMap<object, ExactReleaseGitTree>();

type BuildMetafile = Readonly<{
  inputs?: Record<string, unknown>;
}>;

export interface FrozenReleaseBundleOptions {
  /**
   * Package imports that must remain external in the emitted bundle.  Omit to
   * preserve the repository-internal build contract.  An explicit empty
   * array produces a self-contained JavaScript payload while still leaving
   * host/runtime built-ins external.
   */
  readonly externalPackageNames?: readonly string[];
}

export interface FrozenReleaseBundleReceipt {
  readonly inputPaths: readonly string[];
}

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
  providerIdentityDigest: OperationDigest;
}>): BoundSemanticOperation {
  const remainingDurationMs = input.deadlineAtUnixMs - Date.now();
  if (!Number.isSafeInteger(input.deadlineAtUnixMs)
      || !Number.isSafeInteger(remainingDurationMs)
      || remainingDurationMs < 1
      || remainingDurationMs > RELEASE_BUILDER_MAX_DURATION_MS) {
    throw new Error('Release builder absolute deadline elapsed during physical admission.');
  }
  const effectKinds = input.args[0] === 'install'
    ? ['filesystem', 'network', 'process'] as const
    : ['filesystem', 'process'] as const;
  const contractDigest = sha256({
    operation: RELEASE_BUILDER_OPERATION,
    runtime: 'bun',
    effectKinds,
    processCount: 1,
    maximumDurationMs: RELEASE_BUILDER_MAX_DURATION_MS,
    maximumStdoutBytes: input.maximumStdoutBytes,
    maximumStderrBytes: RELEASE_BUILDER_MAX_STDERR_BYTES
  }) as OperationDigest;
  const plan = compileSemanticOperationPlan({
    operation: RELEASE_BUILDER_OPERATION,
    intentDigest: sha256({
      args: input.args,
      builder: input.builder,
      cwd: input.cwd,
      environment: input.environment,
      providerIdentityDigest: input.providerIdentityDigest
    }) as OperationDigest,
    decisionDigest: contractDigest,
    deadlineAtUnixMs: input.deadlineAtUnixMs,
    attempt: issueSemanticOperationAttemptContext({
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
      effectKinds,
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
  return bindSemanticOperation(plan, [compileCapabilityBinding({
    requirementId: RELEASE_BUILDER_REQUIREMENT,
    contractDigest,
    providerIdentityDigest: input.providerIdentityDigest
  })]);
}

function assertReleaseBuilderReceipt(
  receipt: ProcessResourceSessionReceipt,
  operation: BoundSemanticOperation,
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
  let operation: BoundSemanticOperation | undefined;
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
    }) as OperationDigest;
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
      requirementBindingContext: issueOperationRequirementBindingContext({
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
  const executablePath = path.resolve(await fs.realpath(process.execPath));
  const parent = inspectNoFollowDirectoryChain(
    path.dirname(executablePath),
    'Release Bun executable identity parent'
  );
  const retained = retainNoFollowOrdinaryFile(
    parent,
    path.basename(executablePath),
    undefined,
    'Release Bun executable identity',
    RETAINED_EXECUTABLE_CHILD_DESCRIPTOR,
    'executable'
  );
  try {
    const observed = retained.digest();
    retained.assertCurrent();
    const afterPath = path.resolve(await fs.realpath(process.execPath));
    if (afterPath !== retained.path) {
      throw new Error('Release Bun executable locator changed during identity observation');
    }
    return Object.freeze({
      schema: 'sec-release-builder-identity-v1' as const,
      runtime: 'bun' as const,
      version: Bun.version,
      executableSha256: observed.byteDigest,
      platform: process.platform,
      architecture: process.arch
    });
  } finally {
    retained.dispose();
  }
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

function retainFrozenControlFile(
  sourceRoot: string,
  name: string,
  label: string
) {
  const parent = inspectNoFollowDirectoryChain(path.resolve(sourceRoot), `${label} parent`);
  const entry = inspectNoFollowOrdinaryFileEntry(parent.target, name);
  if (entry === null) throw new Error(`${label} is missing`);
  return retainNoFollowOrdinaryFile(
    parent,
    name,
    { device: entry.device, inode: entry.inode },
    label
  );
}

function readFrozenControlFile(
  sourceRoot: string,
  name: string,
  label: string
): Buffer {
  const retained = retainFrozenControlFile(sourceRoot, name, label);
  try {
    return Buffer.from(retained.readBytes());
  } finally {
    retained.dispose();
  }
}

async function readFrozenPackageConfig(
  sourceRoot: string,
  builder: ReleaseBuilderIdentity
): Promise<{
  version: string;
  entrypoint: CompilerPackageEntrypointBinding & Readonly<{ source: string }>;
  dependencies: readonly string[];
  dependencyLockDigest: `sha256:${string}`;
}> {
  const packageBytes = readFrozenControlFile(sourceRoot, 'package.json', 'Frozen package.json');
  const lockBytes = readFrozenControlFile(sourceRoot, 'bun.lock', 'Frozen bun.lock');
  const canonicalBunVersion = await loadCanonicalBunRuntimeVersion(sourceRoot);
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
  const parsedEntrypoint = parseCompilerPackageEntrypointBinding(raw);
  if (parsedEntrypoint.source === null) {
    throw new Error('Frozen source package does not declare one source entrypoint');
  }
  const entrypoint = Object.freeze({ ...parsedEntrypoint, source: parsedEntrypoint.source });
  return Object.freeze({
    version: raw.version,
    entrypoint,
    dependencies: Object.freeze(Object.keys(raw.dependencies ?? {}).sort()),
    dependencyLockDigest: `sha256:${rawSha256Hex(lockBytes)}` as `sha256:${string}`
  });
}

async function materializeFrozenDependencies(
  sourceRoot: string,
  builder: ReleaseBuilderIdentity
): Promise<void> {
  const packageFile = retainFrozenControlFile(sourceRoot, 'package.json', 'Frozen dependency package.json');
  const lockFile = retainFrozenControlFile(sourceRoot, 'bun.lock', 'Frozen dependency bun.lock');
  try {
    const packageBefore = Buffer.from(packageFile.readBytes());
    const lockBefore = Buffer.from(lockFile.readBytes());

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

    packageFile.assertCurrent();
    lockFile.assertCurrent();
    const packageAfter = Buffer.from(packageFile.readBytes());
    const lockAfter = Buffer.from(lockFile.readBytes());
    if (!packageAfter.equals(packageBefore) || !lockAfter.equals(lockBefore)) {
      throw new Error('Frozen dependency materialization changed package.json or bun.lock');
    }

    const source = inspectNoFollowDirectoryChain(path.resolve(sourceRoot), 'Frozen dependency source root').target;
    const nodeModules = inspectNoFollowDirectoryChain(
      path.join(source.path, 'node_modules'),
      'Frozen dependency node_modules'
    );
    if (!nodeModules.ancestors.some((ancestor) =>
      ancestor.device === source.device &&
      ancestor.inode === source.inode &&
      ancestor.objectId === source.objectId
    )) {
      throw new Error('Frozen dependency materialization escaped the frozen source root');
    }
  } finally {
    packageFile.dispose();
    lockFile.dispose();
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

async function assertFrozenBuildInputs(
  sourceRoot: string,
  metafilePath: string
): Promise<readonly string[]> {
  const metafileName = path.basename(metafilePath);
  if (path.dirname(path.resolve(metafilePath)) !== path.resolve(sourceRoot)) {
    throw new Error('Release bundle metafile must remain a direct frozen-source control file');
  }
  const metafile = JSON.parse(
    readFrozenControlFile(sourceRoot, metafileName, 'Release bundle metafile').toString('utf8')
  ) as BuildMetafile;
  if (metafile.inputs === undefined || typeof metafile.inputs !== 'object') {
    throw new Error('Release bundle metafile does not contain an input inventory');
  }

  const source = inspectNoFollowDirectoryChain(path.resolve(sourceRoot), 'Frozen build source root').target;
  const inputPaths = Object.keys(metafile.inputs).sort();
  for (const inputPath of inputPaths) {
    if (inputPath.startsWith('node:') || inputPath.startsWith('bun:')) continue;
    const absoluteInput = path.isAbsolute(inputPath)
      ? path.resolve(inputPath)
      : path.resolve(sourceRoot, inputPath);
    if (!isPathInside(source.path, absoluteInput)) {
      throw new Error(`Release bundle consumed a lexical input outside frozen source: ${inputPath}`);
    }
    const parent = inspectNoFollowDirectoryChain(
      path.dirname(absoluteInput),
      `Release bundle input parent ${inputPath}`
    );
    if (!parent.ancestors.some((ancestor) =>
      ancestor.device === source.device &&
      ancestor.inode === source.inode &&
      ancestor.objectId === source.objectId
    )) {
      throw new Error(`Release bundle consumed a physical input outside frozen source: ${inputPath}`);
    }
    const leaf = inspectNoFollowOrdinaryFileEntry(
      parent.target,
      path.basename(absoluteInput)
    );
    if (leaf === null) {
      throw new Error(`Release bundle input is not one ordinary file: ${inputPath}`);
    }
  }
  assertSameNoFollowDirectoryIdentity(source, 'Frozen build source root');
  return Object.freeze(inputPaths);
}
function frozenEntrypointBannerArgs(source: FrozenReleaseSource): readonly string[] {
  const root = inspectNoFollowDirectoryChain(
    path.resolve(source.root),
    'Frozen release entrypoint source root'
  ).target;
  const absoluteEntrypoint = path.resolve(
    source.root,
    ...source.entrypoint.source.split('/')
  );
  if (!isPathInside(root.path, absoluteEntrypoint)) {
    throw new Error('Release entrypoint source escapes the frozen source root');
  }
  const parent = inspectNoFollowDirectoryChain(
    path.dirname(absoluteEntrypoint),
    'Frozen release entrypoint parent'
  );
  if (![...parent.ancestors, parent.target].some((ancestor) =>
    ancestor.device === root.device &&
    ancestor.inode === root.inode &&
    ancestor.objectId === root.objectId
  )) {
    throw new Error('Release entrypoint source is physically outside the frozen source root');
  }
  const entrypoint = inspectNoFollowOrdinaryFileEntry(
    parent.target,
    path.basename(absoluteEntrypoint)
  );
  if (entrypoint === null || entrypoint.bytes === null) {
    throw new Error('Release entrypoint source is not one ordinary file');
  }
  const bytes = Buffer.from(entrypoint.bytes);
  const firstLineEnd = bytes.indexOf(0x0a);
  const firstLine = bytes
    .subarray(0, firstLineEnd < 0 ? bytes.byteLength : firstLineEnd)
    .toString('utf8')
    .replace(/\r$/u, '');
  if (firstLine.startsWith('#!') && firstLine !== RELEASE_BUN_ENTRYPOINT_SHEBANG.trimEnd()) {
    throw new Error(`Release bundle contains a non-Bun interpreter directive: ${firstLine}`);
  }
  const artifactDepth = source.entrypoint.artifact.split('/').length - 1;
  const versionMarkerRelativePath = `${'../'.repeat(artifactDepth)}.bun-version`;
  const expectedMarker = `${source.builder.version}\n`;
  const runtimeGuard = [
    '{',
    `  const marker = await Bun.file(new URL(${JSON.stringify(versionMarkerRelativePath)}, import.meta.url)).text();`,
    `  if (marker !== ${JSON.stringify(expectedMarker)} || Bun.version !== ${JSON.stringify(source.builder.version)}) {`,
    '    const error = new Error("SEC release artifact does not support this Bun runtime generation");',
    '    error.code = "RUNTIME-LAYOUT-001";',
    '    throw error;',
    '  }',
    '}'
  ].join('\n');
  return Object.freeze(['--banner', firstLine.startsWith('#!')
    ? runtimeGuard
    : `${RELEASE_BUN_ENTRYPOINT_SHEBANG.trimEnd()}\n${runtimeGuard}`]);
}

function frozenExternalImports(
  dependencies: readonly string[],
  options: FrozenReleaseBundleOptions
): readonly string[] {
  const packageImports = options.externalPackageNames === undefined
    ? [...dependencies, 'typescript']
    : [...options.externalPackageNames];
  return Object.freeze([
    ...packageImports,
    'bun',
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
    const source = Object.freeze({
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
    frozenReleaseSourceMaterializations.set(source, materialized);
    return source;
  } catch (error) {
    try {
      await disposeExactReleaseGitTree(materialized);
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
  stagedArtifactRoot: string,
  options: FrozenReleaseBundleOptions = {}
): Promise<FrozenReleaseBundleReceipt> {
  assertReleaseBunRuntimeRequirement(source.builder);
  const metafilePath = path.join(source.root, RELEASE_BUILD_META_FILE_NAME);
  const args = [
    'build',
    `./${source.entrypoint.source}`,
    `--outdir=${stagedArtifactRoot}`,
    `--entry-naming=${path.posix.basename(source.entrypoint.artifact)}`,
    '--target=bun',
    `--metafile=${metafilePath}`,
    ...frozenEntrypointBannerArgs(source)
  ];
  for (const external of frozenExternalImports(source.dependencies, options)) {
    args.push('--external', external);
  }
  await assertBuilderIdentityUnchanged(source.builder, 'before bundle execution');
  await runReleaseBuilderCommand(source.root, args, source.builder, 512 * 1024 * 1024);
  await assertBuilderIdentityUnchanged(source.builder, 'during bundle execution');
  const inputPaths = await assertFrozenBuildInputs(source.root, metafilePath);
  return Object.freeze({ inputPaths });
}

export async function disposeFrozenReleaseSource(source: FrozenReleaseSource): Promise<void> {
  const materialized = frozenReleaseSourceMaterializations.get(source);
  if (materialized === undefined) {
    throw new Error('Frozen release source was not issued by its preparation owner');
  }
  await disposeExactReleaseGitTree(materialized);
}
