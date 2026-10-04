import path from 'node:path';

import { sha256 } from '../../../contracts/canonical.ts';
import { parseExactJson } from '../../../contracts/exact-json.ts';
import {
  assertSameNoFollowDirectoryIdentity,
  type PhysicalDirectoryIdentity
} from '../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  decodeExactUtf8,
  readOptionalRetainedOrdinaryLeaf,
  retainOptionalDirectory
} from '../../runtime-state/physical/runtime/retained-file-read.ts';
import {
  currentSecRuntimePlatform,
  resolveSecRuntimeCacheRoot,
  secRuntimeStateEnvironment
} from '../../runtime-state/workspace-state/layout.ts';
import {
  parseSecLinuxVerificationNativeRuntimeManifest,
  SEC_LINUX_VERIFICATION_NATIVE_PROFILE,
  type SecLinuxVerificationNativeRuntimeManifest
} from './contract.ts';

const ENVIRONMENT_MATERIALIZATION_SPEC_SCHEMA =
  'sec-environment-materialization-spec-v1' as const;
const ENVIRONMENT_MATERIALIZATION_PLAN_SCHEMA =
  'sec-environment-materialization-plan-v1' as const;

export interface EnvironmentMaterializationComponent {
  readonly id: string;
  readonly version: string;
  readonly sourceDigest: `sha256:${string}`;
}

export interface EnvironmentMaterializationSpec {
  readonly schema: typeof ENVIRONMENT_MATERIALIZATION_SPEC_SCHEMA;
  readonly imageName: string;
  readonly acceptedImageDigest: `sha256:${string}`;
  readonly platform: 'linux/amd64';
  readonly sourcePolicyRevision: string;
  readonly providerRequirement: string;
  readonly components: readonly EnvironmentMaterializationComponent[];
  readonly specDigest: `sha256:${string}`;
}

export interface EnvironmentMaterializationObservation {
  readonly localTag: 'absent' | 'matching' | 'mismatched';
  readonly localImageDigest: `sha256:${string}` | null;
  readonly localArtifact: 'absent' | 'matching' | 'mismatched';
  readonly immutableBuildInputs: 'available' | 'missing' | 'unresolved';
  readonly providerCapability: 'available' | 'unavailable' | 'unresolved';
}

export interface EnvironmentMaterializationPlan {
  readonly schema: typeof ENVIRONMENT_MATERIALIZATION_PLAN_SCHEMA;
  readonly specDigest: `sha256:${string}`;
  readonly disposition: 'reuse-local' | 'restore-local' | 'materialize' | 'blocked';
  readonly reason:
    | 'exact-local-image'
    | 'exact-local-artifact'
    | 'exact-build-inputs-and-provider'
    | 'local-tag-digest-conflict'
    | 'local-artifact-digest-conflict'
    | 'immutable-build-inputs-missing'
    | 'immutable-build-inputs-unresolved'
    | 'provider-unavailable'
    | 'provider-unresolved';
  readonly planDigest: `sha256:${string}`;
}

function fail(message: string): never {
  throw new Error(`Environment materialization contract: ${message}`);
}

function bounded(value: unknown, label: string, maximum = 512): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum
      || value.trim() !== value || /[\u0000-\u001f]/u.test(value)) {
    fail(`${label} must be bounded non-control text`);
  }
  return value;
}

function digest(value: unknown, label: string): `sha256:${string}` {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    fail(`${label} must be a SHA-256 digest`);
  }
  return value as `sha256:${string}`;
}

function materializationDigest(value: unknown): `sha256:${string}` {
  return sha256(value) as `sha256:${string}`;
}

export function createEnvironmentMaterializationSpec(input: Readonly<{
  imageName: string;
  acceptedImageDigest: string;
  sourcePolicyRevision: string;
  providerRequirement: string;
  components: readonly EnvironmentMaterializationComponent[];
}>): EnvironmentMaterializationSpec {
  const components = input.components.map((component, index) => Object.freeze({
    id: bounded(component.id, `components[${index}].id`, 128),
    version: bounded(component.version, `components[${index}].version`, 128),
    sourceDigest: digest(component.sourceDigest, `components[${index}].sourceDigest`)
  })).sort((left, right) => left.id.localeCompare(right.id, 'en-US'));
  if (components.length === 0 || new Set(components.map(({ id }) => id)).size !== components.length) {
    fail('components must contain unique identities');
  }
  const body = Object.freeze({
    schema: ENVIRONMENT_MATERIALIZATION_SPEC_SCHEMA,
    imageName: bounded(input.imageName, 'imageName'),
    acceptedImageDigest: digest(input.acceptedImageDigest, 'acceptedImageDigest'),
    platform: 'linux/amd64' as const,
    sourcePolicyRevision: bounded(input.sourcePolicyRevision, 'sourcePolicyRevision'),
    providerRequirement: bounded(input.providerRequirement, 'providerRequirement'),
    components: Object.freeze(components)
  });
  return Object.freeze({ ...body, specDigest: materializationDigest(body) });
}

export function compileEnvironmentMaterializationPlan(input: Readonly<{
  spec: EnvironmentMaterializationSpec;
  observation: EnvironmentMaterializationObservation;
}>): EnvironmentMaterializationPlan {
  const { spec, observation } = input;
  if (createEnvironmentMaterializationSpec(spec).specDigest !== spec.specDigest) {
    fail('spec digest is invalid');
  }
  let disposition: EnvironmentMaterializationPlan['disposition'];
  let reason: EnvironmentMaterializationPlan['reason'];
  if (observation.localTag === 'matching') {
    if (observation.localImageDigest !== spec.acceptedImageDigest) {
      fail('matching local observation does not bind the accepted image digest');
    }
    disposition = 'reuse-local';
    reason = 'exact-local-image';
  } else if (observation.localTag === 'mismatched') {
    if (observation.localImageDigest === null
        || observation.localImageDigest === spec.acceptedImageDigest) {
      fail('mismatched local observation is invalid');
    }
    disposition = 'blocked';
    reason = 'local-tag-digest-conflict';
  } else if (observation.localImageDigest !== null) {
    fail('absent local tag cannot carry an image digest');
  } else if (observation.localArtifact === 'mismatched') {
    disposition = 'blocked';
    reason = 'local-artifact-digest-conflict';
  } else if (observation.localArtifact === 'matching') {
    if (observation.providerCapability !== 'available') {
      disposition = 'blocked';
      reason = observation.providerCapability === 'unavailable'
        ? 'provider-unavailable'
        : 'provider-unresolved';
    } else {
      disposition = 'restore-local';
      reason = 'exact-local-artifact';
    }
  } else if (observation.immutableBuildInputs !== 'available') {
    disposition = 'blocked';
    reason = observation.immutableBuildInputs === 'missing'
      ? 'immutable-build-inputs-missing'
      : 'immutable-build-inputs-unresolved';
  } else if (observation.providerCapability !== 'available') {
    disposition = 'blocked';
    reason = observation.providerCapability === 'unavailable'
      ? 'provider-unavailable'
      : 'provider-unresolved';
  } else {
    disposition = 'materialize';
    reason = 'exact-build-inputs-and-provider';
  }
  const body = Object.freeze({
    schema: ENVIRONMENT_MATERIALIZATION_PLAN_SCHEMA,
    specDigest: spec.specDigest,
    disposition,
    reason
  });
  return Object.freeze({ ...body, planDigest: materializationDigest(body) });
}


declare const nativeRuntimeInputBrand: unique symbol;

/** Retains transport identity only. The physical owner must copy and hash every
 * accepted manifest entry into its private read-only root before executing it. */
export interface SecLinuxVerificationNativeRuntimeInput {
  readonly [nativeRuntimeInputBrand]: true;
  readonly rootPath: string;
  readonly platform: 'linux/amd64';
  readonly manifestDigest: `sha256:${string}`;
  readonly manifest: SecLinuxVerificationNativeRuntimeManifest;
}

export class SecLinuxVerificationNativeRuntimeInputError extends Error {
  constructor(
    readonly kind: 'native-runtime-inputs-unresolved' | 'native-runtime-inputs-missing'
      | 'native-runtime-inputs-invalid',
    message: string
  ) {
    super(message);
    this.name = 'SecLinuxVerificationNativeRuntimeInputError';
  }
}

const retainedNativeInputs = new WeakMap<SecLinuxVerificationNativeRuntimeInput, PhysicalDirectoryIdentity>();

function acceptedNativeManifestDigest(): `sha256:${string}` {
  const accepted = SEC_LINUX_VERIFICATION_NATIVE_PROFILE.acceptedContent;
  if (accepted.status !== 'accepted') {
    throw new SecLinuxVerificationNativeRuntimeInputError('native-runtime-inputs-unresolved', accepted.reason);
  }
  return accepted.manifestDigest;
}

export function resolveSecLinuxVerificationNativeRuntimeInput(input: Readonly<{
  rootPath: string;
  manifest: unknown;
}>): SecLinuxVerificationNativeRuntimeInput {
  // Never accept a caller-supplied expected digest, authority, or capability.
  const acceptedDigest = acceptedNativeManifestDigest();
  const manifest = parseSecLinuxVerificationNativeRuntimeManifest(input.manifest);
  const manifestDigest = sha256(manifest) as `sha256:${string}`;
  if (manifestDigest !== acceptedDigest) {
    throw new SecLinuxVerificationNativeRuntimeInputError('native-runtime-inputs-invalid',
      'Native runtime manifest does not match the original accepted content identity.');
  }
  if (!path.isAbsolute(input.rootPath) || path.resolve(input.rootPath) !== input.rootPath) {
    throw new SecLinuxVerificationNativeRuntimeInputError('native-runtime-inputs-invalid',
      'Native runtime transport root must be a canonical absolute directory.');
  }
  const root = retainOptionalDirectory(input.rootPath, 'native runtime transport root');
  if (root === null) {
    throw new SecLinuxVerificationNativeRuntimeInputError('native-runtime-inputs-missing',
      'Accepted native runtime transport root is absent.');
  }
  const result = Object.freeze({
    rootPath: root.path,
    platform: manifest.platform,
    manifestDigest,
    manifest
  }) as SecLinuxVerificationNativeRuntimeInput;
  retainedNativeInputs.set(result, root);
  return result;
}

export function requireSecLinuxVerificationNativeRuntimeInput(
  input: SecLinuxVerificationNativeRuntimeInput
): SecLinuxVerificationNativeRuntimeInput {
  const root = retainedNativeInputs.get(input);
  if (root === undefined || input.manifestDigest !== acceptedNativeManifestDigest()) {
    throw new SecLinuxVerificationNativeRuntimeInputError('native-runtime-inputs-invalid',
      'Native runtime input must be issued by the original materialization owner.');
  }
  assertSameNoFollowDirectoryIdentity(root, 'native runtime transport root');
  return input;
}

/** Lookup only: this reader never installs packages, extracts archives, invokes
 * lifecycle hooks, launches candidate code, or changes host security settings. */
export function observeSecLinuxVerificationNativeRuntimeInput(input: Readonly<{
  repositoryRoot: string;
}>): SecLinuxVerificationNativeRuntimeInput {
  const acceptedDigest = acceptedNativeManifestDigest();
  const cacheRoot = resolveSecRuntimeCacheRoot({
    platform: currentSecRuntimePlatform(),
    environment: secRuntimeStateEnvironment(),
    repositoryRoot: input.repositoryRoot
  });
  const generationPath = path.join(cacheRoot, 'native-verification', 'v1', acceptedDigest.slice(7));
  const generation = retainOptionalDirectory(generationPath, 'accepted native runtime generation');
  const bytes = generation === null ? null : readOptionalRetainedOrdinaryLeaf(
    generation, 'manifest.json', { maximumBytes: 32 * 1024 * 1024 }
  );
  if (bytes === null) {
    throw new SecLinuxVerificationNativeRuntimeInputError('native-runtime-inputs-missing',
      'Accepted native runtime manifest is absent from its content-addressed cache generation.');
  }
  const manifest = parseExactJson(decodeExactUtf8(bytes, 'native runtime manifest'));
  const result = resolveSecLinuxVerificationNativeRuntimeInput({
    rootPath: path.join(generationPath, 'root'), manifest
  });
  assertSameNoFollowDirectoryIdentity(generation!, 'accepted native runtime generation');
  return result;
}
