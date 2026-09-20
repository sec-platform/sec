import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { SecError } from '../../../contracts/failure.ts';
import { isPlainObject } from '../../../contracts/canonical.ts';
import { parseExactJson } from '../../../contracts/exact-json.ts';
import { compilerRuntimeLayout } from './layout.ts';

const compilerRoot = compilerRuntimeLayout.packageRoot;

export type CanonicalBunRuntimeVersion = `${number}.${number}.${number}`;

export interface CanonicalBunRuntimeProjectionReadback {
  readonly version: CanonicalBunRuntimeVersion;
  readonly packageManager: `bun@${CanonicalBunRuntimeVersion}`;
  readonly miseVersion: CanonicalBunRuntimeVersion;
}

export interface CanonicalBunPackageRunnerObservation {
  readonly executablePath: string;
  readonly packageManifestPath: string | undefined;
  readonly packageRunnerPath: string | undefined;
  readonly runtimeVersion: string | undefined;
}

function fail(message: string): never {
  throw new SecError('IMPORT-AUTHORITY-001', message);
}

function canonicalVersion(source: string): CanonicalBunRuntimeVersion {
  if (!/^\d+\.\d+\.\d+\n$/u.test(source)) {
    fail('.bun-version must contain one exact Bun version followed by one line feed');
  }
  return source.slice(0, -1) as CanonicalBunRuntimeVersion;
}

export function assertCanonicalBunPackageRunner(
  version: CanonicalBunRuntimeVersion,
  observation: CanonicalBunPackageRunnerObservation = {
    executablePath: process.execPath,
    packageManifestPath: process.env.npm_package_json,
    packageRunnerPath: process.env.npm_execpath,
    runtimeVersion: process.versions.bun
  },
  root = compilerRoot
): void {
  if (observation.runtimeVersion !== version) {
    fail('active Bun runtime does not match .bun-version');
  }
  if (observation.packageRunnerPath === undefined || observation.packageRunnerPath.length === 0) {
    fail('package command has no exact Bun package-runner identity');
  }
  if (path.relative(
    path.resolve(observation.executablePath),
    path.resolve(observation.packageRunnerPath)
  ) !== '') {
    fail('package command runner differs from the active Bun executable');
  }
  if (observation.packageManifestPath === undefined
    || path.relative(
      path.resolve(root, 'package.json'),
      path.resolve(observation.packageManifestPath)
    ) !== '') {
    fail('package command metadata does not identify the canonical package manifest');
  }
}

function assertCanonicalPackageScripts(packageValue: Record<string, unknown>): void {
  if (!isPlainObject(packageValue.scripts)) fail('package.json scripts must contain one object');
  const rawBunCommand = /(?:^|&&|\|\||;)\s*bun(?:\.exe)?(?=\s|$)/u;
  const unquotedPackageRunner = /(?:^|&&|\|\||;)\s*\$npm_execpath(?=\s|$)/u;
  for (const [name, command] of Object.entries(packageValue.scripts)) {
    if (typeof command !== 'string' || command.length === 0) {
      fail(`package.json script ${JSON.stringify(name)} must be one command string`);
    }
    if (rawBunCommand.test(command)) {
      fail(`package.json script ${JSON.stringify(name)} resolves Bun through PATH`);
    }
    if (unquotedPackageRunner.test(command)) {
      fail(`package.json script ${JSON.stringify(name)} does not quote the exact package runner`);
    }
  }
}

export async function loadCanonicalBunRuntimeVersion(
  root = compilerRoot
): Promise<CanonicalBunRuntimeVersion> {
  return canonicalVersion(await readFile(path.join(root, '.bun-version'), 'utf8'));
}

/**
 * Reads the two declarative projections that external launchers require.
 * `.bun-version` remains the semantic owner; package.json and mise.toml are
 * accepted only when they project that exact generation.
 */
export async function readCanonicalBunRuntimeProjection(
  root = compilerRoot
): Promise<CanonicalBunRuntimeProjectionReadback> {
  const [versionSource, packageSource, miseSource] = await Promise.all([
    readFile(path.join(root, '.bun-version'), 'utf8'),
    readFile(path.join(root, 'package.json'), 'utf8'),
    readFile(path.join(root, 'mise.toml'), 'utf8')
  ]);
  const version = canonicalVersion(versionSource);
  const packageValue = parseExactJson(packageSource, 'Bun runtime package projection');
  if (!isPlainObject(packageValue)) fail('package.json must contain one object');
  assertCanonicalPackageScripts(packageValue);
  const packageManager = packageValue.packageManager;
  if (packageManager !== `bun@${version}`) {
    fail('package.json packageManager does not project .bun-version');
  }
  let miseValue: unknown;
  try {
    miseValue = Bun.TOML.parse(miseSource);
  } catch (error) {
    throw new SecError('IMPORT-AUTHORITY-001', 'mise.toml is not canonical TOML', {}, {
      cause: error
    });
  }
  if (!isPlainObject(miseValue) || !isPlainObject(miseValue.tools) || miseValue.tools.bun !== version) {
    fail('mise.toml tools.bun does not project .bun-version');
  }
  return Object.freeze({
    version,
    packageManager: packageManager as `bun@${CanonicalBunRuntimeVersion}`,
    miseVersion: version
  });
}
