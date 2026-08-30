import fs from 'node:fs/promises';
import path from 'node:path';

import { rawSha256, sha256 } from '../../system-architecture/foundation/runtime/canonical.ts';

export type TypeScriptCheckerDigest = `sha256:${string}`;

export type TypeScriptNativeCheckerProvider = Readonly<{
  capability: 'typescript-project-typecheck';
  providerId: 'typescript-native-cli';
  packageAlias: '@typescript/native';
  packageName: 'typescript';
  providerRevision: `typescript@${string}`;
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

export type TypeScriptNativeCheckerFailureReason =
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

type FailureStatus = Exclude<TypeScriptNativeCheckerSelection['status'], 'selected'>;

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
    value = JSON.parse(bytes.toString('utf8'));
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

const PLATFORM_PACKAGE_BY_RUNTIME = Object.freeze({
  'win32-x64': '@typescript/typescript-win32-x64',
  'win32-arm64': '@typescript/typescript-win32-arm64',
  'linux-x64': '@typescript/typescript-linux-x64',
  'linux-arm64': '@typescript/typescript-linux-arm64',
  'darwin-x64': '@typescript/typescript-darwin-x64',
  'darwin-arm64': '@typescript/typescript-darwin-arm64'
} as const);

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

function nativePackageName(): `@typescript/typescript-${string}` {
  const key = `${process.platform}-${process.arch}` as keyof typeof PLATFORM_PACKAGE_BY_RUNTIME;
  const value = PLATFORM_PACKAGE_BY_RUNTIME[key];
  if (value === undefined) {
    throw failure('unavailable', 'unsupported-platform', `No native TypeScript checker is admitted for ${key}`);
  }
  return value;
}

async function readRequired(filePath: string, native: boolean): Promise<Buffer> {
  try {
    return await fs.readFile(filePath);
  } catch (error) {
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

export async function resolveInstalledTypeScriptNativeChecker(
  nodeModulesPath: string
): Promise<InstalledTypeScriptNativeChecker> {
  const aliasRoot = path.join(path.resolve(nodeModulesPath), '@typescript', 'native');
  const packageManifestPath = path.join(aliasRoot, 'package.json');
  const packageBytes = await readRequired(packageManifestPath, false);
  const manifest = parseAliasManifest(packageBytes, packageManifestPath);
  const wrapperPath = path.join(aliasRoot, 'bin', 'tsc');
  const wrapperBytes = await readRequired(wrapperPath, false);
  const platformNativePackageName = nativePackageName();
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
  const nativeManifestBytes = await readRequired(platformNativeManifestPath, true);
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
  const nativeExecutableBytes = await readRequired(nativeExecutablePath, true);
  const withoutBinding = Object.freeze({
    capability: 'typescript-project-typecheck' as const,
    providerId: 'typescript-native-cli' as const,
    packageAlias: '@typescript/native' as const,
    packageName: 'typescript' as const,
    providerRevision: `typescript@${manifest.version}` as `typescript@${string}`,
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
  return Object.freeze({
    provider,
    packageManifestPath,
    wrapperPath,
    platformNativeManifestPath,
    nativeExecutablePath
  });
}

export async function selectInstalledTypeScriptNativeChecker(
  nodeModulesPath: string
): Promise<TypeScriptNativeCheckerSelection> {
  try {
    return Object.freeze({
      status: 'selected' as const,
      checker: await resolveInstalledTypeScriptNativeChecker(nodeModulesPath)
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
