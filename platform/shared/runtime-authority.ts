import path from 'node:path';
import semver from 'semver';

import { rawSha256 } from './canonical-primitives.ts';
import { CompilerError } from './errors.ts';

export const TARGET_RUNTIME_PROFILE_SCHEMA = 'sec-target-runtime-profile-v1' as const;
export const RUNTIME_EXECUTION_EVIDENCE_SCHEMA = 'sec-runtime-execution-evidence-v1' as const;

export type HostRuntimeFamily = 'bun' | 'node';
export type ToolchainProvider = 'bun' | 'npm' | 'pnpm' | 'yarn';
export type TargetRuntimeFamily = 'bun' | 'node';
export type TargetModuleSystem = 'commonjs' | 'esm' | 'hybrid';
export type TargetPackageManager = 'bun' | 'npm' | 'pnpm' | 'yarn';

export interface HostRuntimeIdentity {
  readonly architecture: string;
  readonly executablePath: string;
  readonly family: HostRuntimeFamily;
  readonly platform: string;
  readonly version: string;
}

export interface ToolchainProviderIdentity {
  readonly executablePath: string;
  readonly provider: ToolchainProvider;
  readonly version: string;
}

export interface TargetRuntimeCapabilities {
  readonly filesystem: boolean;
  readonly nativeAddons: boolean;
  readonly serverApi: string;
  readonly subprocess: boolean;
  readonly webStreams: boolean;
  readonly workerThreads: boolean;
}

export interface TargetRuntimeProfile {
  readonly capabilities: Readonly<TargetRuntimeCapabilities>;
  readonly family: TargetRuntimeFamily;
  readonly moduleSystem: TargetModuleSystem;
  readonly packageManager: TargetPackageManager;
  readonly schema: typeof TARGET_RUNTIME_PROFILE_SCHEMA;
  readonly versionRange: string;
}

export interface RuntimeExecutionEvidence {
  readonly hostRuntime: Readonly<HostRuntimeIdentity>;
  readonly schema: typeof RUNTIME_EXECUTION_EVIDENCE_SCHEMA;
  readonly targetRuntimeProfileRevision: `sha256:${string}`;
  readonly toolchainProvider: Readonly<ToolchainProviderIdentity>;
}

type HostRuntimeIdentityInput = {
  readonly architecture: string;
  readonly executablePath: string;
  readonly family: HostRuntimeFamily;
  readonly platform: string;
  readonly version: string;
};

type ToolchainProviderIdentityInput = {
  readonly executablePath: string;
  readonly provider: ToolchainProvider;
  readonly version: string;
};

type TargetRuntimeProfileInput = {
  readonly capabilities: TargetRuntimeCapabilities;
  readonly family: TargetRuntimeFamily;
  readonly moduleSystem: TargetModuleSystem;
  readonly packageManager: TargetPackageManager;
  readonly versionRange: string;
};

const exactSemanticVersionPattern =
  /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;

function runtimeAuthorityError(message: string, details: Record<string, unknown> = {}): never {
  throw new CompilerError('RUNTIME-AUTHORITY-001', message, details);
}

function assertNonEmpty(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    runtimeAuthorityError(`${label} must be non-empty`);
  }
  return normalized;
}

function assertMember<const T extends string>(
  value: string,
  allowed: readonly T[],
  label: string
): T {
  if (!allowed.includes(value as T)) {
    runtimeAuthorityError(`${label} is unsupported`, { allowed, value });
  }
  return value as T;
}

function assertAbsoluteExecutablePath(value: string, label: string): string {
  const normalized = path.normalize(assertNonEmpty(value, label));
  if (!path.isAbsolute(normalized)) {
    runtimeAuthorityError(`${label} must be an absolute executable path`, { value });
  }
  return normalized;
}

function assertExactSemanticVersion(value: string, label: string): string {
  const normalized = assertNonEmpty(value, label);
  if (!exactSemanticVersionPattern.test(normalized) || semver.valid(normalized) === null) {
    runtimeAuthorityError(`${label} must be one exact semantic version`, { value });
  }
  return normalized;
}

function assertVersionRange(value: string): string {
  const normalized = assertNonEmpty(value, 'Target Runtime versionRange');
  const canonical = semver.validRange(normalized);
  if (canonical === null || canonical === '*') {
    runtimeAuthorityError('Target Runtime versionRange must be a bounded semantic version range', {
      value
    });
  }
  return canonical;
}

function cloneCapabilities(
  capabilities: TargetRuntimeCapabilities
): Readonly<TargetRuntimeCapabilities> {
  if (!capabilities || typeof capabilities !== 'object') {
    runtimeAuthorityError('Target Runtime capabilities must be a complete object');
  }
  for (const key of [
    'filesystem',
    'nativeAddons',
    'subprocess',
    'webStreams',
    'workerThreads'
  ] as const) {
    if (typeof capabilities[key] !== 'boolean') {
      runtimeAuthorityError(`Target Runtime capability "${key}" must be boolean`);
    }
  }
  return Object.freeze({
    filesystem: capabilities.filesystem,
    nativeAddons: capabilities.nativeAddons,
    serverApi: assertNonEmpty(capabilities.serverApi, 'Target Runtime capability serverApi'),
    subprocess: capabilities.subprocess,
    webStreams: capabilities.webStreams,
    workerThreads: capabilities.workerThreads
  });
}

export function buildHostRuntimeIdentity(
  input: HostRuntimeIdentityInput
): Readonly<HostRuntimeIdentity> {
  return Object.freeze({
    architecture: assertNonEmpty(input.architecture, 'Host Runtime architecture'),
    executablePath: assertAbsoluteExecutablePath(
      input.executablePath,
      'Host Runtime executablePath'
    ),
    family: assertMember(input.family, ['bun', 'node'], 'Host Runtime family'),
    platform: assertNonEmpty(input.platform, 'Host Runtime platform'),
    version: assertExactSemanticVersion(input.version, 'Host Runtime version')
  });
}

export function buildToolchainProviderIdentity(
  input: ToolchainProviderIdentityInput
): Readonly<ToolchainProviderIdentity> {
  return Object.freeze({
    executablePath: assertAbsoluteExecutablePath(
      input.executablePath,
      'Toolchain Provider executablePath'
    ),
    provider: assertMember(
      input.provider,
      ['bun', 'npm', 'pnpm', 'yarn'],
      'Toolchain Provider'
    ),
    version: assertExactSemanticVersion(input.version, 'Toolchain Provider version')
  });
}

export function buildTargetRuntimeProfile(
  input: TargetRuntimeProfileInput
): Readonly<TargetRuntimeProfile> {
  return Object.freeze({
    capabilities: cloneCapabilities(input.capabilities),
    family: assertMember(input.family, ['bun', 'node'], 'Target Runtime family'),
    moduleSystem: assertMember(
      input.moduleSystem,
      ['commonjs', 'esm', 'hybrid'],
      'Target Runtime moduleSystem'
    ),
    packageManager: assertMember(
      input.packageManager,
      ['bun', 'npm', 'pnpm', 'yarn'],
      'Target Runtime packageManager'
    ),
    schema: TARGET_RUNTIME_PROFILE_SCHEMA,
    versionRange: assertVersionRange(input.versionRange)
  });
}

export function targetRuntimeProfileRevision(
  profile: TargetRuntimeProfile
): `sha256:${string}` {
  const canonicalProfile = buildTargetRuntimeProfile(profile);
  return rawSha256(JSON.stringify(canonicalProfile));
}

export function buildRuntimeExecutionEvidence(input: {
  readonly hostRuntime: HostRuntimeIdentity;
  readonly targetRuntimeProfile: TargetRuntimeProfile;
  readonly toolchainProvider: ToolchainProviderIdentity;
}): Readonly<RuntimeExecutionEvidence> {
  return Object.freeze({
    hostRuntime: buildHostRuntimeIdentity(input.hostRuntime),
    schema: RUNTIME_EXECUTION_EVIDENCE_SCHEMA,
    targetRuntimeProfileRevision: targetRuntimeProfileRevision(input.targetRuntimeProfile),
    toolchainProvider: buildToolchainProviderIdentity(input.toolchainProvider)
  });
}
