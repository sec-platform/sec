import fs from 'node:fs/promises';
import path from 'node:path';

export interface TypecheckProviderV1 {
  readonly schema: 'sec-typecheck-provider-v1';
  readonly capability: 'typescript-project-typecheck';
  readonly providerId: 'typescript-cli';
  readonly packageName: 'typescript';
  readonly providerRevision: `typescript@${string}`;
  readonly binaryName: 'tsc';
  readonly cliEntryRelativePath: 'bin/tsc';
  readonly projectConfig: 'tsconfig.json';
  readonly noEmit: true;
}

type TypeScriptPackageManifest = Readonly<{
  bin?: unknown;
  name?: unknown;
  version?: unknown;
}>;

const TYPECHECK_DIAGNOSTIC_FLAGS = new Set([
  '--diagnostics',
  '--extendedDiagnostics',
  '--explainFiles',
  '--listFiles',
  '--noErrorTruncation',
  '--traceResolution'
]);
const TYPECHECK_DIAGNOSTIC_VALUE_FLAGS = new Set(['--locale']);

function exactVersion(value: unknown): string {
  if (typeof value !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(value)) {
    throw new Error('TypeCheck Provider package does not expose one exact semantic version');
  }
  return value;
}

function typecheckArgumentError(argument: string): never {
  throw new Error(
    `TypeCheck Provider rejects argument ${JSON.stringify(argument)} because project, emit and checking semantics are provider-owned`
  );
}

function diagnosticArguments(additionalArgs: readonly string[]): string[] {
  const accepted: string[] = [];
  for (let index = 0; index < additionalArgs.length; index += 1) {
    const argument = additionalArgs[index]!;
    if (TYPECHECK_DIAGNOSTIC_FLAGS.has(argument)) {
      accepted.push(argument);
      continue;
    }
    if (argument === '--pretty') {
      accepted.push(argument);
      const value = additionalArgs[index + 1];
      if (value === 'true' || value === 'false') {
        accepted.push(value);
        index += 1;
      }
      continue;
    }
    if (argument.startsWith('--pretty=')) {
      const value = argument.slice('--pretty='.length);
      if (value !== 'true' && value !== 'false') typecheckArgumentError(argument);
      accepted.push(argument);
      continue;
    }
    if (TYPECHECK_DIAGNOSTIC_VALUE_FLAGS.has(argument)) {
      const value = additionalArgs[index + 1];
      if (value === undefined || value.length === 0 || value.startsWith('-')) {
        typecheckArgumentError(argument);
      }
      accepted.push(argument, value);
      index += 1;
      continue;
    }
    typecheckArgumentError(argument);
  }
  return accepted;
}

/**
 * Resolve the currently installed CLI checker as one explicit package provider.
 *
 * This deliberately does not infer Program/TypeChecker, Language Service or
 * Printer capability from the `typescript` package name. Those are separate
 * #312 providers and may continue to use another implementation/revision.
 */
export async function resolveInstalledTypecheckProviderV1(
  nodeModulesPath: string
): Promise<TypecheckProviderV1> {
  const packagePath = path.join(nodeModulesPath, 'typescript', 'package.json');
  const raw = JSON.parse(await fs.readFile(packagePath, 'utf8')) as TypeScriptPackageManifest;
  if (raw.name !== 'typescript') {
    throw new Error(`TypeCheck Provider package identity mismatch: ${String(raw.name)}`);
  }
  if (raw.bin === null || typeof raw.bin !== 'object' || Array.isArray(raw.bin)
      || (raw.bin as Record<string, unknown>).tsc !== './bin/tsc') {
    throw new Error('TypeCheck Provider package does not expose the canonical tsc CLI entry');
  }
  const version = exactVersion(raw.version);
  return Object.freeze({
    schema: 'sec-typecheck-provider-v1' as const,
    capability: 'typescript-project-typecheck' as const,
    providerId: 'typescript-cli' as const,
    packageName: 'typescript' as const,
    providerRevision: `typescript@${version}` as `typescript@${string}`,
    binaryName: 'tsc' as const,
    cliEntryRelativePath: 'bin/tsc' as const,
    projectConfig: 'tsconfig.json' as const,
    noEmit: true as const
  });
}

export function typecheckProviderArguments(
  provider: TypecheckProviderV1,
  additionalArgs: readonly string[] = []
): string[] {
  return [
    ...(provider.noEmit ? ['--noEmit'] : []),
    '-p',
    provider.projectConfig,
    ...diagnosticArguments(additionalArgs)
  ];
}

export function typecheckProviderExecutionArguments(
  provider: TypecheckProviderV1,
  buildInfoFile: string,
  additionalArgs: readonly string[] = []
): string[] {
  if (!path.isAbsolute(buildInfoFile)) {
    throw new Error('TypeCheck Provider build-info path must be absolute');
  }
  return [
    ...typecheckProviderArguments(provider, additionalArgs),
    '--incremental',
    '--tsBuildInfoFile',
    path.resolve(buildInfoFile)
  ];
}
