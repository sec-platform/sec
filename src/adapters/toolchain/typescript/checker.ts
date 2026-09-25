import fs from 'node:fs/promises';
import path from 'node:path';

import { rawSha256, sha256 } from '../../../contracts/canonical.ts';
import { parseExactJson } from '../../../contracts/exact-json.ts';
import {
  assertSemanticOperationProjection,
  type BoundSemanticOperation
} from '../../../execution/operation/semantic.ts';
import {
  assertRetainedNoFollowCapability,
  assertRetainedNoFollowProvenDirectoryGeneration,
  assertRetainedNoFollowReadOnlyDirectoryGeneration,
  inspectNoFollowDirectoryChain,
  retainNoFollowGenerationExecutable,
  retainNoFollowOrdinaryFile,
  type RetainedNoFollowChildProcessDirectory,
  type RetainedNoFollowProvenDirectoryGeneration,
  type RetainedNoFollowSealedDirectoryGeneration
} from '../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  assertProcessResourceSession,
  type ProcessResourceSession
} from '../../runtime-state/physical/runtime/process-resource-session.ts';
import {
  RETAINED_EXECUTABLE_CHILD_DESCRIPTOR,
  issueRetainedCommandBoundary
} from '../../runtime-state/physical/runtime/process.ts';

type TypeScriptCheckerDigest = `sha256:${string}`;

export type TypeScriptNativeCheckerProvider = Readonly<{
  capability: 'typescript-project-typecheck';
  providerId: 'typescript-native-cli';
  packageAlias: '@typescript/native';
  packageName: 'typescript';
  packageManifestDigest: TypeScriptCheckerDigest;
  wrapperRelativePath: 'bin/tsc';
  wrapperDigest: TypeScriptCheckerDigest;
  platformNativePackageName: `@typescript/typescript-${string}`;
  platformNativeManifestDigest: TypeScriptCheckerDigest;
  platformNativeExecutableRelativePath: 'lib/tsc' | 'lib/tsc.exe';
  platformNativeExecutableDigest: TypeScriptCheckerDigest;
  toolchainBindingDigest: TypeScriptCheckerDigest;
  projectConfig: 'tsconfig.json';
  noEmit: true;
  incremental: true;
}>;

export type InstalledTypeScriptNativeChecker = Readonly<{
  provider: TypeScriptNativeCheckerProvider;
  packageManifestPath: string;
  wrapperPath: string;
  platformNativeManifestPath: string;
  nativeExecutablePath: string;
}>;

type TypeScriptNativeCheckerFailureReason =
  | 'cancelled'
  | 'deadline-exhausted'
  | 'package-not-installed'
  | 'native-package-not-installed'
  | 'unsupported-platform'
  | 'package-identity-mismatch'
  | 'provider-version-mismatch'
  | 'canonical-entry-mismatch'
  | 'artifact-unreadable'
  | 'manifest-invalid'
  | 'resolver-failure';

export type TypeScriptNativeCheckerSelection =
  | Readonly<{
    status: 'selected';
    checker: InstalledTypeScriptNativeChecker;
  }>
  | Readonly<{
    status: 'unavailable' | 'mismatch' | 'unverified';
    reason: TypeScriptNativeCheckerFailureReason;
    detail: string;
  }>;

export const TYPESCRIPT_NATIVE_CHECKER_EXECUTION_POLICY = Object.freeze({
  maximumStderrBytes: 32 * 1024 * 1024,
  maximumStdoutBytes: 32 * 1024 * 1024,
  timeoutMs: 120_000
});

export type TypeScriptNativeCheckerExecution =
  | Readonly<{
    status: 'exited';
    code: number;
    stdout: string;
    stderr: string;
  }>
  | Readonly<{
    status: 'unverified';
    reason: 'cancelled' | 'deadline-exhausted' | 'process-boundary-unavailable' | 'provider-drift';
    detail: string;
  }>;

type FailureStatus = Exclude<TypeScriptNativeCheckerSelection['status'], 'selected'>;

export type TypeScriptNativeCheckerSelectionOptions = Readonly<{
  deadlineAtUnixMs: number;
  signal?: AbortSignal;
}>;

// A selected checker is an authority-bearing capability, not a structural
// configuration object.  Keep its issuer private so a caller cannot turn a
// test fixture, JSON projection, or object spread into a production process
// provider.  Consumers must pass the exact object issued by the resolver.
const issuedTypeScriptCheckers = new WeakSet<object>();

declare const TYPESCRIPT_CHECKER_PROCESS_EXECUTION_ADMISSION: unique symbol;

/**
 * Process-local authority binding one exact provider-issued checker to the
 * foundation operation and live bounded process session admitted for it.
 * Object shape is intentionally not an authority surface.
 */
export type TypeScriptCheckerProcessExecutionAdmission = Readonly<{
  readonly [TYPESCRIPT_CHECKER_PROCESS_EXECUTION_ADMISSION]: true;
}>;

type TypeScriptCheckerProcessExecutionAdmissionState = Readonly<{
  checker: InstalledTypeScriptNativeChecker;
  operation: BoundSemanticOperation;
  processSession: ProcessResourceSession;
}>;

const TYPESCRIPT_CHECKER_PROCESS_EXECUTION_ADMISSIONS = new WeakMap<
  object,
  TypeScriptCheckerProcessExecutionAdmissionState
>();
const TYPESCRIPT_TYPECHECK_OPERATION = 'verification.typecheck' as const;
const TYPESCRIPT_PROJECT_CHECK_REQUIREMENT = 'typescript.project-check' as const;

type TypeScriptAliasManifest = Readonly<{
  name: 'typescript';
  version: string;
  bin: Readonly<{ tsc: './bin/tsc' }>;
  optionalDependencies: Readonly<Record<string, string>>;
}>;

type TypeScriptPlatformManifest = Readonly<{
  name: string;
  version: string;
}>;

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseJsonObject(bytes: Buffer, filePath: string): Record<string, unknown> {
  let value: unknown;
  try {
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    value = parseExactJson(source, `TypeScript checker manifest ${filePath}`);
  } catch (error) {
    throw failure('unverified', 'manifest-invalid', `TypeScript checker manifest is invalid JSON: ${filePath}`, error);
  }
  if (!isRecord(value)) {
    throw failure('mismatch', 'package-identity-mismatch', `TypeScript checker manifest is not an object: ${filePath}`);
  }
  return value;
}

/**
 * This parser is intentionally dependency-free: it runs before the compiler
 * dependency root has been admitted, so importing a schema package from that
 * same root would create a trust cycle. Normal repository JSON boundaries use
 * the canonical schema library after dependency admission.
 */
function parseAliasManifest(bytes: Buffer, filePath: string): TypeScriptAliasManifest {
  const value = parseJsonObject(bytes, filePath);
  const bin = value.bin;
  const dependencies = value.optionalDependencies;
  if (value.name !== 'typescript'
      || typeof value.version !== 'string'
      || !EXACT_VERSION.test(value.version)
      || !isRecord(bin)
      || bin.tsc !== './bin/tsc'
      || !isRecord(dependencies)
      || Object.values(dependencies).some((revision) => typeof revision !== 'string')) {
    throw failure('mismatch', 'package-identity-mismatch', `TypeScript checker manifest identity is invalid: ${filePath}`);
  }
  return Object.freeze({
    name: 'typescript',
    version: value.version,
    bin: Object.freeze({ tsc: './bin/tsc' }),
    optionalDependencies: Object.freeze(dependencies as Record<string, string>)
  });
}

function parsePlatformManifest(bytes: Buffer, filePath: string): TypeScriptPlatformManifest {
  const value = parseJsonObject(bytes, filePath);
  if (typeof value.name !== 'string'
      || !/^@typescript\/typescript-[A-Za-z0-9-]+$/u.test(value.name)
      || typeof value.version !== 'string'
      || !EXACT_VERSION.test(value.version)) {
    throw failure('mismatch', 'package-identity-mismatch', `TypeScript checker manifest identity is invalid: ${filePath}`);
  }
  return Object.freeze({ name: value.name, version: value.version });
}

const TYPECHECK_DIAGNOSTIC_FLAGS = new Set([
  '--diagnostics', '--extendedDiagnostics', '--explainFiles', '--listFiles',
  '--noErrorTruncation', '--traceResolution'
]);
const TYPECHECK_DIAGNOSTIC_ORDER = Object.freeze([
  '--diagnostics', '--extendedDiagnostics', '--explainFiles', '--listFiles',
  '--locale', '--noErrorTruncation', '--pretty', '--traceResolution'
] as const);

class TypeScriptNativeCheckerError extends Error {
  readonly status: FailureStatus;
  readonly reason: TypeScriptNativeCheckerFailureReason;

  constructor(
    status: FailureStatus,
    reason: TypeScriptNativeCheckerFailureReason,
    detail: string,
    options?: ErrorOptions
  ) {
    super(detail, options);
    this.name = 'TypeScriptNativeCheckerError';
    this.status = status;
    this.reason = reason;
  }
}

function failure(
  status: FailureStatus,
  reason: TypeScriptNativeCheckerFailureReason,
  detail: string,
  cause?: unknown
): TypeScriptNativeCheckerError {
  return new TypeScriptNativeCheckerError(
    status,
    reason,
    detail,
    cause instanceof Error ? { cause } : undefined
  );
}

function nativePackageName(
  manifest: TypeScriptAliasManifest
): `@typescript/typescript-${string}` {
  const runtimeIdentity = `${process.platform}-${process.arch}`;
  if (!/^[a-z0-9]+-[a-z0-9]+$/u.test(runtimeIdentity)) {
    throw failure(
      'unavailable',
      'unsupported-platform',
      `No canonical native TypeScript runtime identity exists for ${runtimeIdentity}`
    );
  }
  const candidate = `@typescript/typescript-${runtimeIdentity}` as const;
  if (manifest.optionalDependencies[candidate] === undefined) {
    throw failure(
      'unavailable',
      'unsupported-platform',
      `The selected TypeScript package does not publish a native checker for ${runtimeIdentity}`
    );
  }
  return candidate;
}

function assertSelectionActive(
  options: TypeScriptNativeCheckerSelectionOptions,
  label: string
): void {
  if (options.signal?.aborted === true) {
    throw failure('unverified', 'cancelled', `TypeScript checker ${label} was cancelled`);
  }
  if (!Number.isSafeInteger(options.deadlineAtUnixMs)
      || options.deadlineAtUnixMs <= Date.now()) {
    throw failure(
      'unverified',
      'deadline-exhausted',
      `TypeScript checker ${label} exhausted its operation deadline`
    );
  }
}

async function readRequired(
  filePath: string,
  native: boolean,
  options: TypeScriptNativeCheckerSelectionOptions
): Promise<Buffer> {
  assertSelectionActive(options, 'artifact observation');
  try {
    const bytes = await fs.readFile(filePath);
    assertSelectionActive(options, 'artifact observation readback');
    return bytes;
  } catch (error) {
    if (error instanceof TypeScriptNativeCheckerError) throw error;
    const code = error !== null && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code)
      : 'unknown';
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      throw failure(
        'unavailable',
        native ? 'native-package-not-installed' : 'package-not-installed',
        `TypeScript checker artifact is absent: ${filePath}`,
        error
      );
    }
    throw failure('unverified', 'artifact-unreadable', `TypeScript checker artifact is unreadable: ${filePath}`, error);
  }
}

async function resolveInstalledTypeScriptNativeChecker(
  nodeModulesPath: string,
  options: TypeScriptNativeCheckerSelectionOptions
): Promise<InstalledTypeScriptNativeChecker> {
  assertSelectionActive(options, 'selection admission');
  const aliasRoot = path.join(path.resolve(nodeModulesPath), '@typescript', 'native');
  const packageManifestPath = path.join(aliasRoot, 'package.json');
  const packageBytes = await readRequired(packageManifestPath, false, options);
  const manifest = parseAliasManifest(packageBytes, packageManifestPath);
  const wrapperPath = path.join(aliasRoot, 'bin', 'tsc');
  const wrapperBytes = await readRequired(wrapperPath, false, options);
  const platformNativePackageName = nativePackageName(manifest);
  if (manifest.optionalDependencies[platformNativePackageName] !== manifest.version) {
    throw failure(
      'mismatch',
      'provider-version-mismatch',
      'Native TypeScript package revision is not bound to the alias package'
    );
  }
  const nativeRoot = path.join(
    path.resolve(nodeModulesPath),
    ...platformNativePackageName.split('/')
  );
  const platformNativeManifestPath = path.join(nativeRoot, 'package.json');
  const nativeManifestBytes = await readRequired(platformNativeManifestPath, true, options);
  const resolvedNativeManifest = parsePlatformManifest(
    nativeManifestBytes,
    platformNativeManifestPath
  );
  if (resolvedNativeManifest.name !== platformNativePackageName
      || resolvedNativeManifest.version !== manifest.version) {
    throw failure('mismatch', 'provider-version-mismatch', 'Native TypeScript package identity does not match its alias');
  }
  const platformNativeExecutableRelativePath = process.platform === 'win32'
    ? 'lib/tsc.exe' as const
    : 'lib/tsc' as const;
  const nativeExecutablePath = path.join(
    nativeRoot,
    ...platformNativeExecutableRelativePath.split('/')
  );
  const nativeExecutableBytes = await readRequired(nativeExecutablePath, true, options);
  const withoutBinding = Object.freeze({
    capability: 'typescript-project-typecheck' as const,
    providerId: 'typescript-native-cli' as const,
    packageAlias: '@typescript/native' as const,
    packageName: 'typescript' as const,
    packageManifestDigest: rawSha256(packageBytes),
    wrapperRelativePath: 'bin/tsc' as const,
    wrapperDigest: rawSha256(wrapperBytes),
    platformNativePackageName,
    platformNativeManifestDigest: rawSha256(nativeManifestBytes),
    platformNativeExecutableRelativePath,
    platformNativeExecutableDigest: rawSha256(nativeExecutableBytes),
    projectConfig: 'tsconfig.json' as const,
    noEmit: true as const,
    incremental: true as const
  });
  const provider = Object.freeze({
    ...withoutBinding,
    toolchainBindingDigest: sha256(withoutBinding) as TypeScriptCheckerDigest
  });
  const checker = Object.freeze({
    provider,
    packageManifestPath,
    wrapperPath,
    platformNativeManifestPath,
    nativeExecutablePath
  });
  assertSelectionActive(options, 'selection settlement');
  issuedTypeScriptCheckers.add(checker);
  return checker;
}

/**
 * Assert that a checker was issued by this provider boundary.  The type
 * assertion is intentionally paired with a private runtime issuer check:
 * TypeScript structural typing alone cannot protect the command/effect edge.
 */
export function assertTypeScriptNativeChecker(
  checker: unknown
): asserts checker is InstalledTypeScriptNativeChecker {
  if (checker === null || typeof checker !== 'object'
      || !issuedTypeScriptCheckers.has(checker)) {
    throw failure(
      'unverified',
      'resolver-failure',
      'TypeScript checker capability was not issued by the native provider resolver'
    );
  }
}

export async function selectInstalledTypeScriptNativeChecker(
  nodeModulesPath: string,
  options: TypeScriptNativeCheckerSelectionOptions = Object.freeze({
    deadlineAtUnixMs: Date.now() + TYPESCRIPT_NATIVE_CHECKER_EXECUTION_POLICY.timeoutMs
  })
): Promise<TypeScriptNativeCheckerSelection> {
  try {
    return Object.freeze({
      status: 'selected' as const,
      checker: await resolveInstalledTypeScriptNativeChecker(nodeModulesPath, options)
    });
  } catch (error) {
    const typed = error instanceof TypeScriptNativeCheckerError
      ? error
      : failure(
          'unverified',
          'resolver-failure',
          error instanceof Error ? error.message : String(error),
          error
        );
    return Object.freeze({
      status: typed.status,
      reason: typed.reason,
      detail: typed.message
    });
  }
}

export function requireSelectedTypeScriptNativeChecker(
  selection: TypeScriptNativeCheckerSelection
): InstalledTypeScriptNativeChecker {
  if (selection.status !== 'selected') {
    throw failure(selection.status, selection.reason, selection.detail);
  }
  assertTypeScriptNativeChecker(selection.checker);
  return selection.checker;
}

function argumentError(argument: string): never {
  throw new Error(
    `Native TypeScript checker rejects argument ${JSON.stringify(argument)} because checking semantics are provider-owned`
  );
}

export function canonicalTypeScriptDiagnosticArguments(
  args: readonly string[]
): readonly string[] {
  const flags = new Set<string>();
  let pretty: 'true' | 'false' | null = null;
  let locale: string | null = null;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (TYPECHECK_DIAGNOSTIC_FLAGS.has(argument)) {
      if (flags.has(argument)) argumentError(argument);
      flags.add(argument);
      continue;
    }
    if (argument === '--pretty') {
      if (pretty !== null) argumentError(argument);
      const value = args[index + 1];
      if (value === 'true' || value === 'false') {
        pretty = value;
        index += 1;
      } else if (value !== undefined && !value.startsWith('-')) {
        argumentError(argument);
      } else {
        pretty = 'true';
      }
      continue;
    }
    if (argument.startsWith('--pretty=')) {
      const value = argument.slice('--pretty='.length);
      if ((value !== 'true' && value !== 'false') || pretty !== null) argumentError(argument);
      pretty = value;
      continue;
    }
    if (argument === '--locale') {
      const value = args[index + 1];
      if (value === undefined || value.length === 0 || value.startsWith('-') || locale !== null) {
        argumentError(argument);
      }
      locale = value;
      index += 1;
      continue;
    }
    if (argument.startsWith('--locale=')) {
      const value = argument.slice('--locale='.length);
      if (value.length === 0 || value.startsWith('-') || locale !== null) argumentError(argument);
      locale = value;
      continue;
    }
    argumentError(argument);
  }
  return Object.freeze(TYPECHECK_DIAGNOSTIC_ORDER.flatMap((flag) => {
    if (flag === '--pretty') return pretty === null ? [] : ['--pretty', pretty];
    if (flag === '--locale') return locale === null ? [] : ['--locale', locale];
    return flags.has(flag) ? [flag] : [];
  }));
}

export function typeScriptCheckerArguments(
  provider: TypeScriptNativeCheckerProvider,
  buildInfoFile: string,
  args: readonly string[] = []
): readonly string[] {
  if (!path.isAbsolute(buildInfoFile)) {
    throw new Error('Native TypeScript checker build-info path must be absolute');
  }
  return Object.freeze([
    '--noEmit', '-p', provider.projectConfig,
    ...canonicalTypeScriptDiagnosticArguments(args),
    '--incremental', '--tsBuildInfoFile', path.resolve(buildInfoFile)
  ]);
}

function typeScriptCheckerEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const read = (name: 'SYSTEMROOT' | 'WINDIR'): string | undefined => Object.entries(source)
    .find(([key]) => key.toUpperCase() === name)?.[1];
  return Object.freeze(Object.fromEntries([
    ['SYSTEMROOT', read('SYSTEMROOT')],
    ['WINDIR', read('WINDIR')]
  ].filter((entry): entry is [string, string] => entry[1] !== undefined)));
}

function executionFailure(
  reason: Extract<TypeScriptNativeCheckerExecution, { status: 'unverified' }>['reason'],
  detail: string
): TypeScriptNativeCheckerExecution {
  return Object.freeze({ status: 'unverified' as const, reason, detail });
}

function isStrictPathDescendant(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative.length > 0
    && !path.isAbsolute(relative)
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`);
}

function assertTypeScriptCheckerProcessExecutionBinding(
  state: TypeScriptCheckerProcessExecutionAdmissionState
): void {
  assertSemanticOperationProjection(state.operation);
  if (state.operation.plan.identity.operation !== TYPESCRIPT_TYPECHECK_OPERATION) {
    throw new Error('TypeScript checker process admission requires the verification.typecheck operation.');
  }
  const requirement = state.operation.plan.execution.requirements.find(
    ({ id }) => id === TYPESCRIPT_PROJECT_CHECK_REQUIREMENT
  );
  const providerBinding = state.operation.bindings.find(
    ({ requirementId }) => requirementId === TYPESCRIPT_PROJECT_CHECK_REQUIREMENT
  );
  if (requirement === undefined
      || providerBinding === undefined
      || providerBinding.contractDigest !== requirement.contractDigest
      || !requirement.effectKinds.includes('process')) {
    throw new Error('TypeScript checker process admission requires its exact process capability binding.');
  }
  assertProcessResourceSession(state.processSession, {
    semanticOperation: TYPESCRIPT_TYPECHECK_OPERATION,
    operationIdentityDigest: state.operation.plan.identity.identityDigest,
    boundAttemptDigest: state.operation.boundAttemptDigest,
    requirementId: TYPESCRIPT_PROJECT_CHECK_REQUIREMENT,
    providerIdentityDigest: providerBinding.providerIdentityDigest,
    maximumDurationMs: TYPESCRIPT_NATIVE_CHECKER_EXECUTION_POLICY.timeoutMs,
    maximumInputBytes: 0,
    maximumOutputBytes: TYPESCRIPT_NATIVE_CHECKER_EXECUTION_POLICY.maximumStdoutBytes
      + TYPESCRIPT_NATIVE_CHECKER_EXECUTION_POLICY.maximumStderrBytes,
    maximumProcesses: 1
  });
}

/**
 * Issue the only TypeScript-owner authority that may reach the checker process
 * Effect. The issuer derives operation, provider and budget bindings from
 * authentic capabilities; callers cannot restate them as strings or booleans.
 */
export function issueTypeScriptCheckerProcessExecutionAdmission(input: Readonly<{
  checker: InstalledTypeScriptNativeChecker;
  operation: BoundSemanticOperation;
  processSession: ProcessResourceSession;
}>): TypeScriptCheckerProcessExecutionAdmission {
  assertTypeScriptNativeChecker(input.checker);
  const state = Object.freeze({
    checker: input.checker,
    operation: input.operation,
    processSession: input.processSession
  });
  assertTypeScriptCheckerProcessExecutionBinding(state);
  const admission = Object.freeze({}) as TypeScriptCheckerProcessExecutionAdmission;
  TYPESCRIPT_CHECKER_PROCESS_EXECUTION_ADMISSIONS.set(admission, state);
  return admission;
}

/**
 * Execute through the exact provider-issued checker. The production caller
 * supplies its operation deadline plus owner-issued project, dependency,
 * action-private auxiliary and checker-process admission capabilities.
 * Checking arguments, environment, command bounds and the retained command
 * boundary remain owned here; aggregate process admission and settlement stay
 * with the session hidden behind the TypeScript-owner admission.
 */
export async function executeTypeScriptNativeChecker(
  checker: InstalledTypeScriptNativeChecker,
  input: Readonly<{
    args?: readonly string[];
    auxiliaryDirectory: RetainedNoFollowChildProcessDirectory;
    buildInfoFileName: string;
    deadlineAtUnixMs: number;
    dependencyDirectory: RetainedNoFollowProvenDirectoryGeneration;
    forwardOutput?: boolean;
    processExecutionAdmission: TypeScriptCheckerProcessExecutionAdmission;
    signal?: AbortSignal;
    workingDirectory: RetainedNoFollowSealedDirectoryGeneration | RetainedNoFollowProvenDirectoryGeneration;
  }>
): Promise<TypeScriptNativeCheckerExecution> {
  assertTypeScriptNativeChecker(checker);
  const admission = input.processExecutionAdmission !== null
      && typeof input.processExecutionAdmission === 'object'
    ? TYPESCRIPT_CHECKER_PROCESS_EXECUTION_ADMISSIONS.get(input.processExecutionAdmission)
    : undefined;
  if (admission === undefined) {
    throw new Error('TypeScript checker execution requires an owner-issued process admission.');
  }
  if (admission.checker !== checker) {
    throw new Error('TypeScript checker process admission belongs to a different checker capability.');
  }
  assertTypeScriptCheckerProcessExecutionBinding(admission);
  const processSession = admission.processSession;
  assertRetainedNoFollowReadOnlyDirectoryGeneration(
    input.workingDirectory,
    'TypeScript checker immutable working generation'
  );
  assertRetainedNoFollowProvenDirectoryGeneration(
    input.dependencyDirectory,
    'TypeScript checker dependency generation'
  );
  const providerPaths = [
    checker.packageManifestPath,
    checker.wrapperPath,
    checker.platformNativeManifestPath,
    checker.nativeExecutablePath
  ];
  if (providerPaths.some((providerPath) => (
    !isStrictPathDescendant(input.dependencyDirectory.root.path, providerPath)
  ))) {
    return executionFailure(
      'process-boundary-unavailable',
      'TypeScript checker provider is outside its retained dependency generation'
    );
  }
  if (input.auxiliaryDirectory === undefined || input.buildInfoFileName === undefined) {
    return executionFailure(
      'process-boundary-unavailable',
      'TypeScript checker requires one action-private auxiliary directory capability'
    );
  }
  assertRetainedNoFollowCapability(
    input.auxiliaryDirectory,
    'working-directory',
    'TypeScript checker action-private auxiliary directory'
  );
  if (input.buildInfoFileName.length === 0 || input.buildInfoFileName === '.'
      || input.buildInfoFileName === '..' || input.buildInfoFileName.includes('/')
      || input.buildInfoFileName.includes('\\') || input.buildInfoFileName.includes('\0')) {
    throw new Error('Native TypeScript checker build-info name must be one ordinary leaf');
  }
  if (!Number.isSafeInteger(input.deadlineAtUnixMs)) {
    throw new Error('Native TypeScript checker deadline must be an absolute safe integer');
  }
  const startedAtUnixMs = Date.now();
  const deadlineAtMonotonicMs = performance.now() + Math.max(
    0,
    input.deadlineAtUnixMs - startedAtUnixMs
  );
  const remaining = (): number => Math.floor(Math.min(
    TYPESCRIPT_NATIVE_CHECKER_EXECUTION_POLICY.timeoutMs,
    input.deadlineAtUnixMs - Date.now(),
    processSession.deadlineAtUnixMs - Date.now(),
    deadlineAtMonotonicMs - performance.now(),
    processSession.deadlineAtMonotonicMs - performance.now()
  ));
  const interruption = (): 'cancelled' | 'deadline-exhausted' | null => (
    input.signal?.aborted === true
      ? 'cancelled'
      : remaining() < 1
        ? 'deadline-exhausted'
        : processSession.signal.aborted
          ? 'cancelled'
        : null
  );
  const admitProgress = input.forwardOutput === true
    ? (chunk: Buffer, stream: 'stdout' | 'stderr'): boolean => {
        (stream === 'stdout' ? process.stdout : process.stderr).write(chunk);
        return true;
      }
    : undefined;
  const initialInterruption = interruption();
  if (initialInterruption !== null) {
    return executionFailure(initialInterruption, 'TypeScript checker operation ended before process admission');
  }
  const providerArtifacts = [
    [checker.packageManifestPath, checker.provider.packageManifestDigest, 'alias manifest'],
    [checker.wrapperPath, checker.provider.wrapperDigest, 'wrapper'],
    [
      checker.platformNativeManifestPath,
      checker.provider.platformNativeManifestDigest,
      'native manifest'
    ]
  ] as const;
  try {
    for (const [artifactPath, expectedDigest, label] of providerArtifacts) {
      const retained = retainNoFollowOrdinaryFile(
        inspectNoFollowDirectoryChain(
          path.dirname(artifactPath),
          `TypeScript checker ${label} parent`
        ),
        path.basename(artifactPath),
        undefined,
        `TypeScript checker ${label}`
      );
      try {
        if (retained.digest().byteDigest !== expectedDigest) {
          return executionFailure(
            'provider-drift',
            `TypeScript checker ${label} bytes changed before process admission`
          );
        }
      } finally {
        retained.dispose();
      }
    }
  } catch (error) {
    return executionFailure(
      'provider-drift',
      error instanceof Error ? error.message : String(error)
    );
  }
  const admittedInterruption = interruption();
  if (admittedInterruption !== null) {
    return executionFailure(admittedInterruption, 'TypeScript checker operation ended during provider admission');
  }
  const effectInterruption = interruption();
  if (effectInterruption !== null) {
    return executionFailure(effectInterruption, 'TypeScript checker operation ended before process effect');
  }

  let result: Awaited<ReturnType<ProcessResourceSession['run']>>;
  {
    let executable: ReturnType<typeof retainNoFollowOrdinaryFile> | null = null;
    try {
      input.workingDirectory.assertCurrent();
      input.dependencyDirectory.assertCurrent();
      input.auxiliaryDirectory.assertCurrent();
      await input.workingDirectory.assertAuthorityCurrent();
      await input.dependencyDirectory.assertAuthorityCurrent();
      executable = await retainNoFollowGenerationExecutable(
        input.dependencyDirectory,
        path.relative(input.dependencyDirectory.root.path, checker.nativeExecutablePath).split(path.sep).join('/'),
        RETAINED_EXECUTABLE_CHILD_DESCRIPTOR,
        'TypeScript checker executable'
      );
      if (executable.digest().byteDigest !== checker.provider.platformNativeExecutableDigest) {
        return executionFailure('provider-drift', 'TypeScript checker executable bytes changed before process admission');
      }
      const boundary = issueRetainedCommandBoundary({
        executable,
        workingDirectory: input.workingDirectory,
        auxiliaryInputs: [
          { capability: input.dependencyDirectory, kind: 'directory' },
          { capability: input.auxiliaryDirectory, kind: 'directory' }
        ]
      });
      result = await processSession.run(boundary, [
        ...typeScriptCheckerArguments(
          checker.provider,
          path.join(input.auxiliaryDirectory.childPath, input.buildInfoFileName),
          input.args ?? []
        )
      ], {
        ...(admitProgress === undefined ? {} : { admitProgress }),
        env: typeScriptCheckerEnvironment(process.env),
        envMode: 'replace',
        maxStderrBytes: TYPESCRIPT_NATIVE_CHECKER_EXECUTION_POLICY.maximumStderrBytes,
        maxStdoutBytes: TYPESCRIPT_NATIVE_CHECKER_EXECUTION_POLICY.maximumStdoutBytes
      });
    } catch (error) {
      return executionFailure(
        interruption()
          ?? 'process-boundary-unavailable',
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      try { executable?.dispose(); } catch { /* terminal result already settled */ }
    }
  }
  input.workingDirectory.assertCurrent();
  input.dependencyDirectory.assertCurrent();
  input.auxiliaryDirectory.assertCurrent();
  await input.workingDirectory.assertAuthorityCurrent();
  await input.dependencyDirectory.assertAuthorityCurrent();
  const finalInterruption = interruption();
  if (finalInterruption !== null) {
    return executionFailure(finalInterruption, 'TypeScript checker operation ended during settlement');
  }
  return Object.freeze({
    status: 'exited' as const,
    code: result.result.code,
    stdout: Buffer.from(result.result.stdout).toString('utf8'),
    stderr: result.result.stderr
  });
}
