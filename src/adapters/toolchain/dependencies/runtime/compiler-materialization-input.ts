import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { compilerDependencyManifestAuthority, compilerInputText } from './compiler-input-contract.ts';
export { compilerDependencyManifestAuthority } from './compiler-input-contract.ts';
;

import {
  canonicalJson,
  digest,
  sortedKeys
} from '../../../../contracts/canonical.ts';
import { FailureError } from '../../../../contracts/failure.ts';
import {
  assertSameNoFollowDirectoryIdentity,
  inspectNoFollowDirectoryChain,
  inspectNoFollowOrdinaryFileEntry,
  readNoFollowOrdinaryFile
} from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import { compilerRoot } from "../../../workspace-context.ts";
import { loadCanonicalBunRuntimeVersion } from '../../runtime.ts';
import { sameHostPath } from './host-path.ts';
import { runtimeDependencyOperationControls, runtimeDependencyOperationRemainingMs, type RuntimeDependencyOperationControlInput } from './operation-controls.ts';
import { measureRuntimeDependencyOperationPhaseAsync } from './operation-telemetry.ts';

export type CompilerDependencyMaterializationDigest = `sha256:${string}`;

export interface CompilerDependencyMaterializationInputProjection {
  readonly schema: 'sec-compiler-dependency-materialization-input-v1';
  readonly manifestHash: CompilerDependencyMaterializationDigest;
  readonly packageManifest: Readonly<{
    sourceDigest: CompilerDependencyMaterializationDigest;
    dependencyDigest: CompilerDependencyMaterializationDigest;
  }>;
  readonly lockDigest: CompilerDependencyMaterializationDigest;
  readonly installConfig: Readonly<{
    presence: 'absent' | 'present';
    semanticDigest: CompilerDependencyMaterializationDigest;
  }>;
  readonly toolchain: Readonly<{
    architecture: string;
    bunVersion: string;
    declaredBunVersion: string;
    executableContentDigest: CompilerDependencyMaterializationDigest;
    executablePathDigest: CompilerDependencyMaterializationDigest;
    executablePhysicalIdentityDigest: CompilerDependencyMaterializationDigest;
    platform: NodeJS.Platform;
  }>;
  readonly projectionDigest: CompilerDependencyMaterializationDigest;
}

export interface CompilerDependencyIdentity {
  architecture: string;
  bunExecutablePath: string;
  bunExecutablePhysicalIdentitySha256: string;
  bunExecutableSha256: string;
  bunVersion: string;
  declaredBunVersion: string;
  dependencyManifestSha256: string;
  installConfigSha256: string | null;
  installConfigPresent: boolean;
  lockSha256: string;
  manifestHash: string;
  packageNames: string[];
  packageSourceSha256: string;
  packageVersions: Record<string, string>;
  platform: NodeJS.Platform;
}

export type RuntimeExecutableIdentity = Readonly<{
  path: string;
  sha256: string;
  signature: string;
}>;

/** Sealing an owned generation must not chmod files shared with Bun's cache. */
export const COMPILER_DEPENDENCY_INSTALL_ARGS = Object.freeze([
  'install', '--frozen-lockfile', '--ignore-scripts', '--backend=copyfile'
]);

export function compilerInstallConfigSha256(bytes: Uint8Array | null): string {
  const install = bytes === null
    ? null
    : (Bun.TOML.parse(compilerInputText(bytes, 'Compiler installation configuration')) as Record<string, unknown>).install ?? null;
  return digest(JSON.stringify(canonicalJson({ install, argv: COMPILER_DEPENDENCY_INSTALL_ARGS })));
}

// Only coalesce observations that are currently in flight. A settled
// executable digest is never retained as a process-global positive cache;
// every later operation re-proves the physical file and its bytes.
let runtimeExecutableIdentityInFlight: Promise<RuntimeExecutableIdentity> | null = null;

export async function currentRuntimeExecutableIdentity(
  refresh = false
): Promise<RuntimeExecutableIdentity> {
  if (typeof refresh !== 'boolean') throw new TypeError('Executable refresh mode must be boolean');
  if (!refresh && runtimeExecutableIdentityInFlight !== null) {
    return runtimeExecutableIdentityInFlight;
  }
  const observation = (async (): Promise<RuntimeExecutableIdentity> => {
    const executablePath = await fs.realpath(process.execPath);
    const metadata = await fs.lstat(executablePath, { bigint: true });
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new FailureError('IMPORT-AUTHORITY-001', 'Bun runtime executable must be one physical file');
    }
    const signature = [
      executablePath,
      metadata.dev,
      metadata.ino,
      metadata.mode,
      metadata.size,
      metadata.mtimeNs
    ].join(':');
    const executableBytes = await fs.readFile(executablePath);
    const after = await fs.lstat(executablePath, { bigint: true });
    if (metadata.dev !== after.dev || metadata.ino !== after.ino || metadata.mode !== after.mode ||
      metadata.size !== after.size || metadata.mtimeNs !== after.mtimeNs ||
      !sameHostPath(await fs.realpath(process.execPath), executablePath)) {
      throw new FailureError('IMPORT-AUTHORITY-001', 'Bun runtime executable changed during observation');
    }
    return Object.freeze({
      path: executablePath,
      sha256: digest(executableBytes),
      signature
    });
  })();
  if (refresh) return observation;
  runtimeExecutableIdentityInFlight = observation;
  try {
    return await observation;
  } finally {
    if (runtimeExecutableIdentityInFlight === observation) {
      runtimeExecutableIdentityInFlight = null;
    }
  }
}

export async function compilerDependencyIdentity(root: string): Promise<CompilerDependencyIdentity> {
  root = path.resolve(root);
  const [packageJsonBytes, lockfileBytes, installConfigBytes, runtimeExecutable] = await Promise.all([
    fs.readFile(path.join(root, 'package.json')),
    fs.readFile(path.join(root, 'bun.lock')),
    fs.readFile(path.join(root, 'bunfig.toml')).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    }),
    currentRuntimeExecutableIdentity()
  ]);
  const manifestAuthority = compilerDependencyManifestAuthority(packageJsonBytes);
  const { dependencies, devDependencies } = manifestAuthority;
  const canonicalBunVersion = await loadCanonicalBunRuntimeVersion(root);
  const runtime = {
    architecture: process.arch,
    bunVersion: process.versions.bun ?? 'unknown',
    declaredBunVersion: manifestAuthority.declaredBunVersion,
    platform: process.platform
  };
  if (runtime.bunVersion === 'unknown') {
    throw new FailureError('IMPORT-AUTHORITY-001', 'Compiler dependency bootstrap must run under Bun');
  }
  if (runtime.declaredBunVersion !== canonicalBunVersion || runtime.bunVersion !== canonicalBunVersion) {
    throw new FailureError(
      'IMPORT-AUTHORITY-001',
      `Bun runtime identity mismatch: canonical=${canonicalBunVersion}, packageManager=${runtime.declaredBunVersion}, actual=${runtime.bunVersion}`
    );
  }
  const packageVersions = { ...dependencies, ...devDependencies };
  const lockSha256 = digest(lockfileBytes);
  const installConfigSha256 = compilerInstallConfigSha256(installConfigBytes);
  const manifestContent = (configSha256: string | null) => JSON.stringify({
    dependencyManifestSha256: manifestAuthority.dependencyManifestSha256,
    installConfigPresent: installConfigBytes !== null,
    installConfigSha256: configSha256,
    lockSha256,
    runtime: {
      ...runtime,
      bunExecutablePath: runtimeExecutable.path,
      bunExecutablePhysicalIdentitySha256: digest(runtimeExecutable.signature),
      bunExecutableSha256: runtimeExecutable.sha256
    }
  });
  return {
    ...runtime,
    bunExecutablePath: runtimeExecutable.path,
    bunExecutablePhysicalIdentitySha256: digest(runtimeExecutable.signature),
    bunExecutableSha256: runtimeExecutable.sha256,
    dependencyManifestSha256: manifestAuthority.dependencyManifestSha256,
    installConfigSha256,
    installConfigPresent: installConfigBytes !== null,
    lockSha256,
    manifestHash: digest(manifestContent(installConfigSha256)),
    packageNames: sortedKeys(packageVersions),
    packageSourceSha256: digest(packageJsonBytes),
    packageVersions
  };
}

export async function observeCompilerDependencyIdentity(
  root: string,
  input: RuntimeDependencyOperationControlInput
): Promise<CompilerDependencyIdentity> {
  root = path.resolve(root);
  const controls = runtimeDependencyOperationControls(input);
  runtimeDependencyOperationRemainingMs(controls, 'Compiler dependency identity admission');
  const result = await measureRuntimeDependencyOperationPhaseAsync(
    controls, 'identity', () => compilerDependencyIdentity(root)
  );
  runtimeDependencyOperationRemainingMs(controls, 'Compiler dependency identity readback');
  return result;
}

function materializationDigest(value: string): CompilerDependencyMaterializationDigest {
  return `sha256:${value}`;
}

function compilerDependencyMaterializationInputProjection(
  identity: CompilerDependencyIdentity
): CompilerDependencyMaterializationInputProjection {
  const unsigned = Object.freeze({
    schema: 'sec-compiler-dependency-materialization-input-v1' as const,
    manifestHash: materializationDigest(identity.manifestHash),
    packageManifest: Object.freeze({
      sourceDigest: materializationDigest(identity.packageSourceSha256),
      dependencyDigest: materializationDigest(identity.dependencyManifestSha256)
    }),
    lockDigest: materializationDigest(identity.lockSha256),
    installConfig: Object.freeze({
      presence: identity.installConfigPresent ? 'present' as const : 'absent' as const,
      semanticDigest: materializationDigest(identity.installConfigSha256 ?? digest('null'))
    }),
    toolchain: Object.freeze({
      architecture: identity.architecture,
      bunVersion: identity.bunVersion,
      declaredBunVersion: identity.declaredBunVersion,
      executableContentDigest: materializationDigest(identity.bunExecutableSha256),
      executablePathDigest: materializationDigest(digest(identity.bunExecutablePath)),
      executablePhysicalIdentityDigest: materializationDigest(
        identity.bunExecutablePhysicalIdentitySha256
      ),
      platform: identity.platform
    })
  });
  return Object.freeze({
    ...unsigned,
    projectionDigest: materializationDigest(
      digest(JSON.stringify(canonicalJson(unsigned)))
    )
  });
}

export async function observeCompilerDependencyMaterializationInput(
  root = compilerRoot
): Promise<CompilerDependencyMaterializationInputProjection> {
  return compilerDependencyMaterializationInputProjection(
    await compilerDependencyIdentity(path.resolve(root))
  );
}

type CompilerInputExpectation = Pick<CompilerDependencyIdentity,
  'packageSourceSha256' | 'lockSha256' | 'installConfigPresent' | 'installConfigSha256'
  | 'bunVersion' | 'declaredBunVersion' | 'dependencyManifestSha256'>;

function captureCompilerInputExpectation(input: CompilerInputExpectation): Readonly<CompilerInputExpectation> {
  const { packageSourceSha256, lockSha256, installConfigPresent, installConfigSha256,
    bunVersion, declaredBunVersion, dependencyManifestSha256 } = input;
  return Object.freeze({ packageSourceSha256, lockSha256, installConfigPresent, installConfigSha256,
    bunVersion, declaredBunVersion, dependencyManifestSha256 });
}

export function assertCompilerDependencyInputsCurrent(
  root: string,
  expectedInput: CompilerDependencyIdentity
): void {
  root = path.resolve(root);
  const expected = captureCompilerInputExpectation(expectedInput);
  const sourceRoot = inspectNoFollowDirectoryChain(
    root,
    'Compiler dependency input source root fence'
  ).target;
  const readInput = (name: 'package.json' | 'bun.lock' | 'bunfig.toml'): Uint8Array | null => {
    const entry = inspectNoFollowOrdinaryFileEntry(sourceRoot, name);
    if (entry === null) return null;
    if (entry.kind !== 'file' || entry.bytes === null) {
      throw new FailureError(
        'IMPORT-AUTHORITY-001',
        `Compiler dependency input ${name} is not an ordinary no-follow file`
      );
    }
    return entry.bytes;
  };
  const packageBytes = readInput('package.json');
  const lockBytes = readInput('bun.lock');
  const configBytes = readInput('bunfig.toml');
  if (packageBytes === null || digest(packageBytes) !== expected.packageSourceSha256 ||
      lockBytes === null || digest(lockBytes) !== expected.lockSha256 ||
      (configBytes !== null) !== expected.installConfigPresent ||
      compilerInstallConfigSha256(configBytes) !== expected.installConfigSha256) {
    throw new FailureError(
      'IMPORT-AUTHORITY-001',
      'Compiler dependency source inputs changed around materialization'
    );
  }
  const versionPath = path.join(sourceRoot.path, '.bun-version');
  let version: string;
  try {
    const versionBytes = readNoFollowOrdinaryFile(sourceRoot, '.bun-version');
    version = versionBytes === null ? '' : compilerInputText(versionBytes, 'Compiler Bun version marker').trim();
  } catch (error) {
    throw new FailureError(
      'IMPORT-AUTHORITY-001',
      'Compiler dependency version marker is not an ordinary no-follow file',
      { versionPath, cause: error instanceof Error ? error.message : String(error) }
    );
  }
  if (version !== expected.bunVersion) {
    throw new FailureError(
      'IMPORT-AUTHORITY-001',
      'Compiler dependency Bun version marker changed around materialization'
    );
  }
  assertSameNoFollowDirectoryIdentity(sourceRoot, 'Compiler dependency input source root readback');
}

export function compilerDependencyInputFenceMatches(
  root: string,
  expectedInput: CompilerDependencyIdentity
): boolean {
  try {
    root = path.resolve(root);
    const expected = captureCompilerInputExpectation(expectedInput);
    const packageJsonBytes = readFileSync(path.join(root, 'package.json'));
    const lockfileBytes = readFileSync(path.join(root, 'bun.lock'));
    let installConfigBytes: Buffer | null;
    try {
      installConfigBytes = readFileSync(path.join(root, 'bunfig.toml'));
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
      installConfigBytes = null;
    }
    const manifest = compilerDependencyManifestAuthority(packageJsonBytes);
    const canonicalBunVersion = compilerInputText(readFileSync(path.join(root, '.bun-version')), 'Compiler Bun version marker').trim();
    return manifest.declaredBunVersion === expected.declaredBunVersion &&
      manifest.dependencyManifestSha256 === expected.dependencyManifestSha256 &&
      digest(lockfileBytes) === expected.lockSha256 &&
      (installConfigBytes !== null) === expected.installConfigPresent &&
      compilerInstallConfigSha256(installConfigBytes) === expected.installConfigSha256 &&
      canonicalBunVersion === expected.bunVersion;
  } catch {
    return false;
  }
}
