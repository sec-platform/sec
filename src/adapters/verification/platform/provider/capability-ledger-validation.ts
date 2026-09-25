import fs from 'node:fs/promises';
import path from 'node:path';

import { parse as parseYaml } from 'yaml';

import { LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY } from '../../../providers/linux-verification/contract.ts';
import { WINDOWS_CONTROL_CLI_ENVIRONMENT_AUTHORITY, WINDOWS_CONTROL_CLI_ENVIRONMENT_SPEC_PATH, WINDOWS_CONTROL_CLI_ROOT_CLOSURE_REASON, WINDOWS_CONTROL_CLI_SESSION_SURFACE, parseWindowsControlCliEnvironmentAuthority, type WindowsControlCliEnvironmentSpec } from '../../../providers/windows-control-cli/contract/environment.ts';
import { inspectNoFollowDirectoryChain, inspectNoFollowOrdinaryFileEntry, scanNoFollowDirectoryTreeMetadata } from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import { VERIFICATION_PROVIDER_LEDGER_PATH, parseVerificationProviderCapabilityLedger, type VerificationProviderCapabilityLedgerProjection } from './capability-ledger.ts';

export interface CapabilityLedgerIssue {
  readonly level: 'error';
  readonly code: 'machine-ledger-invalid';
  readonly file: string;
  readonly message: string;
}

function recordValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function stringArrayValue(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`${label} must be a string array.`);
  }
  return value as string[];
}

function nonNegativeSafeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} must be a finite non-negative safe integer.`);
  }
  return value as number;
}

function boundedId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9-]*$/u.test(value)) {
    throw new Error(`${label} must be a lowercase kebab-case identifier.`);
  }
  return value;
}

function uniqueStrings(value: unknown, label: string): string[] {
  const entries = stringArrayValue(value, label);
  if (new Set(entries).size !== entries.length) throw new Error(`${label} contains duplicates.`);
  return entries;
}

const CANONICAL_SURFACE_ID_MAX_LENGTH = 128;
const FORBIDDEN_SURFACE_ID_CONTROLS =
  /[\p{Cc}\p{Bidi_Control}]/u;

function uniqueCanonicalSurfaceIds(value: unknown, label: string): string[] {
  return uniqueStrings(value, label).map((entry, index) => {
    const entryLabel = `${label}[${index}]`;
    if (entry.length === 0 || entry.trim() !== entry) {
      throw new Error(`${entryLabel} must be non-empty and trimmed.`);
    }
    if (entry.normalize('NFC') !== entry) {
      throw new Error(`${entryLabel} must be NFC-normalized.`);
    }
    if (FORBIDDEN_SURFACE_ID_CONTROLS.test(entry)) {
      throw new Error(
        `${entryLabel} must not contain C0, DEL, C1, or bidirectional control characters.`
      );
    }
    if ([...entry].length > CANONICAL_SURFACE_ID_MAX_LENGTH) {
      throw new Error(
        `${entryLabel} must be at most ${CANONICAL_SURFACE_ID_MAX_LENGTH} characters.`
      );
    }
    return entry;
  });
}

function exactKeys(
  value: Record<string, unknown>,
  requiredKeys: readonly string[],
  label: string,
  optionalKeys: readonly string[] = []
): void {
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  const unknownKey = Object.keys(value).find((key) => !allowed.has(key));
  if (unknownKey) throw new Error(`${label}.${unknownKey} is not allowed.`);
  const missingKey = requiredKeys.find(
    (key) => !Object.prototype.hasOwnProperty.call(value, key)
  );
  if (missingKey) throw new Error(`${label}.${missingKey} is required.`);
}

const EXTERNAL_PROVIDER_STATE_MACHINE: Readonly<Record<string, readonly string[]>> = {
  'absorb-design': ['decided', 'integrating', 'active', 'retired'],
  'integrate-provider': [
    'decided', 'integrating', 'active', 'revalidation-required', 'deprecated', 'retired'
  ],
  'integrate-adapter': [
    'decided', 'integrating', 'active', 'revalidation-required', 'deprecated', 'retired'
  ],
  'use-as-development-tool': [
    'decided', 'active', 'revalidation-required', 'deprecated', 'retired'
  ],
  'use-as-conformance-tool': [
    'decided', 'active', 'revalidation-required', 'deprecated', 'retired'
  ],
  'retain-project-specific': [
    'decided', 'active', 'revalidation-required', 'deprecated', 'retired'
  ],
  'watch-with-trigger': ['discovered', 'researching', 'benchmark-planned', 'benchmarked'],
  superseded: ['deprecated', 'retired'],
  'reject-with-rationale': ['retired'],
  retired: ['retired']
};

const ROUTABLE_PROVIDER_DECISIONS = new Set([
  'integrate-provider',
  'integrate-adapter',
  'use-as-development-tool',
  'use-as-conformance-tool',
  'retain-project-specific'
]);

const EXTERNAL_PROVIDER_CAPABILITIES: Readonly<Record<string, {
  category: string;
  routingProfiles: readonly string[];
}>> = {
  'source-context': { category: 'graph', routingProfiles: ['daily-context'] },
  'architecture-analysis': { category: 'graph', routingProfiles: ['architecture'] },
  'brownfield-census': { category: 'graph', routingProfiles: ['brownfield-census'] },
  'security-analysis': { category: 'security', routingProfiles: ['security'] },
  'conformance-check': { category: 'conformance', routingProfiles: [] },
  'runtime-observation': { category: 'runtime', routingProfiles: [] },
  'environment-materialization': { category: 'build-runtime', routingProfiles: [] },
  'workflow-execution': {
    category: 'workflow-runtime',
    routingProfiles: ['sec-linux-verification-v1']
  },
  'host-command-execution': {
    category: 'runtime',
    routingProfiles: ['sec-windows-control-cli-v1']
  }
};

const PROVIDER_FORBIDDEN_AUTHORITY_VOCABULARY = [
  'AgentOperationsAuthority',
  'EngineeringIR',
  'actualDelta',
  'canonicalImpact',
  'sourceWriter'
] as const;

const EXTERNAL_LEDGER_STATUSES = new Set([
  'evaluation-required',
  'revalidation-required',
  'active',
  'retired'
]);

type EnvironmentSpecDescriptor = Readonly<{
  readonly path: string;
  readonly spec: typeof WINDOWS_CONTROL_CLI_ENVIRONMENT_AUTHORITY;
}>;

// A single explicit registry maps the host-command capability to its parsed
// authority. The provider ledger names only the active routing profile; it
// never mirrors the EnvironmentSpec path, digest, revision, executable,
// layout, endpoint, or resource values.
const ENVIRONMENT_SPEC_REGISTRY: readonly EnvironmentSpecDescriptor[] = Object.freeze([
  Object.freeze({
    path: WINDOWS_CONTROL_CLI_ENVIRONMENT_SPEC_PATH,
    spec: WINDOWS_CONTROL_CLI_ENVIRONMENT_AUTHORITY
  })
]);

const ENVIRONMENT_SPEC_MAX_BYTES = 1024 * 1024;
const ENVIRONMENT_SPEC_MAX_PARENT_ENTRIES = 256;
const ENVIRONMENT_SPEC_READ_DEADLINE_MS = 5_000;

function canonicalEnvironmentSpecPath(
  repositoryRoot: string,
  descriptor: EnvironmentSpecDescriptor
): string {
  const root = path.resolve(repositoryRoot);
  const candidate = path.resolve(root, ...descriptor.path.split('/'));
  const relative = path.relative(root, candidate);
  if (relative.length === 0 || path.isAbsolute(relative)
      || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    throw new Error(
      `EnvironmentSpec ${descriptor.path} escapes the supplied repository root.`
    );
  }
  return candidate;
}

function parseEnvironmentSpecJson(raw: string, label: string): unknown {
  // The YAML parser is used only as a duplicate-key detector. JSON.parse is
  // still the grammar authority, so comments, aliases, and YAML scalars do
  // not become accepted EnvironmentSpec syntax.
  try {
    parseYaml(raw);
  } catch (error) {
    throw new Error(
      `${label} has duplicate or invalid object keys: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(
      `${label} must be strict JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function readEnvironmentSpecFromRepositoryRoot(
  repositoryRoot: string,
  descriptor: EnvironmentSpecDescriptor
): Promise<WindowsControlCliEnvironmentSpec> {
  const specPath = canonicalEnvironmentSpecPath(repositoryRoot, descriptor);
  const parentPath = path.dirname(specPath);
  const parent = inspectNoFollowDirectoryChain(
    parentPath,
    `EnvironmentSpec ${descriptor.path} parent`
  ).target;
  const metadata = scanNoFollowDirectoryTreeMetadata(parent, {
    deadlineAtMs: performance.now() + ENVIRONMENT_SPEC_READ_DEADLINE_MS,
    maximumEntries: ENVIRONMENT_SPEC_MAX_PARENT_ENTRIES,
    maximumBytes: ENVIRONMENT_SPEC_MAX_BYTES
  });
  const name = path.basename(specPath);
  const metadataEntry = metadata.find((entry) => entry.relativePath === name);
  if (metadataEntry === undefined) {
    throw new Error(`EnvironmentSpec ${descriptor.path} is missing.`);
  }
  if (metadataEntry.kind !== 'file') {
    throw new Error(`EnvironmentSpec ${descriptor.path} is not an ordinary file.`);
  }
  if (metadataEntry.size > ENVIRONMENT_SPEC_MAX_BYTES) {
    throw new Error(`EnvironmentSpec ${descriptor.path} exceeds the bounded raw-byte limit.`);
  }
  const entry = inspectNoFollowOrdinaryFileEntry(parent, name);
  if (entry === null || entry.kind !== 'file' || entry.bytes === null) {
    throw new Error(`EnvironmentSpec ${descriptor.path} is absent or not an ordinary file.`);
  }
  if (entry.device !== metadataEntry.device || entry.inode !== metadataEntry.inode
      || entry.size !== metadataEntry.size || entry.bytes.byteLength !== metadataEntry.size
      || entry.bytes.byteLength > ENVIRONMENT_SPEC_MAX_BYTES) {
    throw new Error(`EnvironmentSpec ${descriptor.path} changed during bounded raw readback.`);
  }
  let raw: string;
  try {
    raw = new TextDecoder('utf-8', { fatal: true }).decode(entry.bytes);
  } catch (error) {
    throw new Error(
      `EnvironmentSpec ${descriptor.path} must be valid UTF-8: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const parsed = parseWindowsControlCliEnvironmentAuthority(
    parseEnvironmentSpecJson(raw, `EnvironmentSpec ${descriptor.path}`)
  );
  if (parsed.specDigest !== descriptor.spec.specDigest) {
    throw new Error(`EnvironmentSpec ${descriptor.path} canonical payload drift.`);
  }
  return parsed;
}

function validateForbiddenAuthority(provider: Record<string, unknown>, label: string): void {
  const actual = uniqueStrings(provider.forbiddenAuthority, `${label}.forbiddenAuthority`);
  if (
    actual.length !== PROVIDER_FORBIDDEN_AUTHORITY_VOCABULARY.length
    || !PROVIDER_FORBIDDEN_AUTHORITY_VOCABULARY.every((authority) =>
      actual.includes(authority))
  ) {
    throw new Error(
      `${label}.forbiddenAuthority must contain exactly `
      + `${PROVIDER_FORBIDDEN_AUTHORITY_VOCABULARY.join(', ')}.`
    );
  }
}

async function validateVersionAuthority(
  provider: Record<string, unknown>,
  providerId: string
): Promise<void> {
  const label = `External capability provider ${providerId}`;
  const requiresWorkflowRunnerReleaseAuthority = provider.capability === 'workflow-execution'
    || provider.activeRoutingProfile === 'sec-linux-verification-v1';
  if (provider.versionAuthority === null) {
    if (requiresWorkflowRunnerReleaseAuthority) {
      throw new Error(
        `${label}.versionAuthority must use external-release for the workflow-execution capability.`
      );
    }
    if (provider.observedVersion !== null) {
      throw new Error(`${label}.observedVersion must be null when versionAuthority is null.`);
    }
    return;
  }

  const authority = recordValue(provider.versionAuthority, `${label}.versionAuthority`);
  if (requiresWorkflowRunnerReleaseAuthority && authority.kind !== 'external-release') {
    throw new Error(
      `${label}.versionAuthority.kind must be external-release for the workflow-execution capability.`
    );
  }
  if (authority.kind === 'external-release') {
    exactKeys(
      authority,
      [
        'kind', 'release', 'artifact', 'artifactSha256', 'baseImage', 'imageId',
        'imageBuildRevision', 'nodeVersion', 'nodeArtifact', 'nodeArtifactSha256',
        'githubCliVersion', 'githubCliArtifact', 'githubCliArtifactSha256',
        'pythonVersion', 'zipExtractionCapability', 'containerInitCapability', 'sandboxRevision',
        'outerSutContainerCapabilities', 'sutResources',
        'roleProfiles',
        'destructiveIdentityAuthority', 'imageRetirement', 'license'
      ],
      `${label}.versionAuthority`
    );
    const observedVersion = provider.observedVersion;
    if (typeof observedVersion !== 'string'
        || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(observedVersion)) {
      throw new Error(`${label}.observedVersion must be an exact semantic version.`);
    }
    const environment = LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY;
    if (observedVersion !== environment.archives.runner.version
        || authority.release !== `https://github.com/actions/runner/releases/tag/v${observedVersion}`
        || authority.artifact !== environment.archives.runner.url) {
      throw new Error(`${label}.versionAuthority GitHub Actions runner release identity is invalid.`);
    }
    if (authority.artifactSha256
        !== environment.archives.runner.digest.slice(7)) {
      throw new Error(`${label}.versionAuthority.artifactSha256 must be an exact SHA-256 digest.`);
    }
    if (authority.baseImage
        !== environment.ubuntu.baseReference) {
      throw new Error(`${label}.versionAuthority.baseImage must be an exact Ubuntu image digest.`);
    }
    if (authority.imageId
        !== environment.image.dockerProjectionDigest) {
      throw new Error(`${label}.versionAuthority.imageId must be an exact built image digest.`);
    }
    if (authority.imageBuildRevision !== environment.image.buildRevision) {
      throw new Error(`${label}.versionAuthority.imageBuildRevision must bind the image recipe revision.`);
    }
    if (authority.nodeVersion !== environment.archives.node.version) {
      throw new Error(`${label}.versionAuthority.nodeVersion must bind the observed shell Node runtime.`);
    }
    if (authority.nodeArtifact !== environment.archives.node.url) {
      throw new Error(`${label}.versionAuthority.nodeArtifact must bind the official Node.js binary.`);
    }
    if (authority.nodeArtifactSha256
        !== environment.archives.node.digest.slice(7)) {
      throw new Error(`${label}.versionAuthority.nodeArtifactSha256 must bind the exact Node.js binary.`);
    }
    if (authority.githubCliVersion !== environment.archives.githubCli.version
        || authority.githubCliArtifact !== environment.archives.githubCli.url
        || authority.githubCliArtifactSha256
          !== environment.archives.githubCli.digest.slice(7)) {
      throw new Error(`${label}.versionAuthority GitHub CLI identity is invalid.`);
    }
    if (authority.pythonVersion !== environment.runtime.pythonVersion) {
      throw new Error(`${label}.versionAuthority.pythonVersion must bind the archive-inspection runtime.`);
    }
    if (authority.zipExtractionCapability !== 'info-zip-unzip-6.00') {
      throw new Error(`${label}.versionAuthority.zipExtractionCapability must bind setup archive extraction.`);
    }
    if (authority.containerInitCapability !== environment.runtime.containerInitCapability) {
      throw new Error(`${label}.versionAuthority.containerInitCapability must bind persistent child reaping.`);
    }
    if (authority.sandboxRevision !== 'sandbox-v4') {
      throw new Error(`${label}.versionAuthority.sandboxRevision must bind the exact SUT sandbox.`);
    }
    const sutCapabilities = uniqueStrings(
      authority.outerSutContainerCapabilities,
      `${label}.versionAuthority.outerSutContainerCapabilities`
    );
    const expectedSutCapabilities = [
      'CHOWN', 'SETGID', 'SETPCAP', 'SETUID', 'SYS_ADMIN', 'SYS_CHROOT'
    ];
    if (sutCapabilities.length !== expectedSutCapabilities.length ||
        sutCapabilities.some((capability, index) => capability !== expectedSutCapabilities[index])) {
      throw new Error(
        `${label}.versionAuthority.outerSutContainerCapabilities must bind the exact constructor boundary.`
      );
    }
    const sutResources = authority.sutResources;
    if (sutResources === null || typeof sutResources !== 'object' || Array.isArray(sutResources)) {
      throw new Error(`${label}.versionAuthority.sutResources must be one exact resource object.`);
    }
    exactKeys(sutResources as Record<string, unknown>, [
      'cpus', 'wallSeconds', 'aggregateCpuSeconds', 'perProcessCpuSeconds', 'memoryBytes', 'pids'
    ],
      `${label}.versionAuthority.sutResources`);
    if ((sutResources as Record<string, unknown>).cpus !== environment.runtime.resources.sut.cpus ||
        (sutResources as Record<string, unknown>).wallSeconds !== 3_600 ||
        (sutResources as Record<string, unknown>).aggregateCpuSeconds !== 7_200 ||
        (sutResources as Record<string, unknown>).perProcessCpuSeconds !== 7_200 ||
        (sutResources as Record<string, unknown>).memoryBytes
          !== environment.runtime.resources.sut.memoryGiB * 1024 * 1024 * 1024 ||
        (sutResources as Record<string, unknown>).pids !== environment.runtime.resources.sut.pids) {
      throw new Error(`${label}.versionAuthority.sutResources must bind the exact cgroup limits.`);
    }
    const roleProfiles = uniqueStrings(authority.roleProfiles, `${label}.versionAuthority.roleProfiles`);
    const expectedRoles = Object.values(environment.runtime.roleLabels).sort();
    if (roleProfiles.length !== expectedRoles.length
        || roleProfiles.some((role, index) => role !== expectedRoles[index])) {
      throw new Error(`${label}.versionAuthority.roleProfiles must bind the exact trust-domain roles.`);
    }
    const destructiveIdentity = recordValue(
      authority.destructiveIdentityAuthority,
      `${label}.versionAuthority.destructiveIdentityAuthority`
    );
    exactKeys(destructiveIdentity, [
      'endpointBinding', 'immutableEffects', 'mutableLocators'
    ], `${label}.versionAuthority.destructiveIdentityAuthority`);
    const expectedEndpointBinding = [
      'github-api-host-principal-repository', 'docker-context-endpoint-daemon'
    ];
    const expectedImmutableEffects = ['exact-image-id', 'exact-container-id', 'exact-runner-id'];
    const expectedMutableLocators = ['image-tag', 'container-name', 'runner-name', 'labels'];
    if (JSON.stringify(uniqueStrings(
      destructiveIdentity.endpointBinding,
      `${label}.versionAuthority.destructiveIdentityAuthority.endpointBinding`
    )) !== JSON.stringify(expectedEndpointBinding)
        || JSON.stringify(uniqueStrings(
          destructiveIdentity.immutableEffects,
          `${label}.versionAuthority.destructiveIdentityAuthority.immutableEffects`
        )) !== JSON.stringify(expectedImmutableEffects)
        || JSON.stringify(uniqueStrings(
          destructiveIdentity.mutableLocators,
          `${label}.versionAuthority.destructiveIdentityAuthority.mutableLocators`
        )) !== JSON.stringify(expectedMutableLocators)) {
      throw new Error(`${label}.versionAuthority destructive identity authority is invalid.`);
    }
    const imageRetirement = recordValue(
      authority.imageRetirement,
      `${label}.versionAuthority.imageRetirement`
    );
    exactKeys(imageRetirement, ['ordinaryStopAuthority', 'superseded', 'requires'],
      `${label}.versionAuthority.imageRetirement`);
    const superseded = imageRetirement.superseded;
    const expectedSuperseded = environment.image.retirements;
    if (!Array.isArray(superseded) || superseded.length !== expectedSuperseded.length) {
      throw new Error(
        `${label}.versionAuthority.imageRetirement.superseded must bind the canonical decisions.`
      );
    }
    for (const [index, entry] of superseded.entries()) {
      const decision = recordValue(entry, `${label}.versionAuthority.imageRetirement.superseded[${index}]`);
      exactKeys(decision, ['imageId', 'imageTag', 'replacementImageId', 'decision'],
        `${label}.versionAuthority.imageRetirement.superseded[${index}]`);
      if (Object.entries(expectedSuperseded[index]!).some(([key, expected]) =>
        decision[key] !== expected)) {
        throw new Error(`${label}.versionAuthority.imageRetirement superseded decision is invalid.`);
      }
    }
    const expectedRetirementRequirements = [
      'canonical-superseded-decision',
      'exact-daemon-zero-reference-readback',
      'immutable-image-id-effect-and-readback'
    ];
    if (imageRetirement.ordinaryStopAuthority !== 'none'
        || JSON.stringify(uniqueStrings(
          imageRetirement.requires,
          `${label}.versionAuthority.imageRetirement.requires`
        )) !== JSON.stringify(expectedRetirementRequirements)) {
      throw new Error(`${label}.versionAuthority image retirement authority is invalid.`);
    }
    if (authority.license !== 'MIT') {
      throw new Error(`${label}.versionAuthority.license must be MIT.`);
    }
    return;
  }
  throw new Error(
    `${label}.versionAuthority.kind must be external-release or versionAuthority must be null.`
  );
}

async function validateWindowsControlCliProviderClosure(
  provider: Record<string, unknown>,
  providerId: string,
  repositoryRoot: string
): Promise<void> {
  const label = `External capability provider ${providerId}`;
  if (providerId !== 'windows-native-control-cli'
      || provider.category !== 'runtime'
      || provider.capability !== 'host-command-execution'
      || provider.decision !== 'integrate-provider'
      || provider.lifecycle !== 'revalidation-required'
      || provider.activeRoutingProfile !== WINDOWS_CONTROL_CLI_ENVIRONMENT_AUTHORITY.profileId) {
    throw new Error(`${label} host-command-execution provider closure is invalid.`);
  }
  const descriptors = ENVIRONMENT_SPEC_REGISTRY.filter(
    (entry) => entry.spec.profileId === provider.activeRoutingProfile
  );
  if (descriptors.length !== 1) {
    throw new Error(`${label} must resolve one canonical EnvironmentSpec.`);
  }
  const observed = await readEnvironmentSpecFromRepositoryRoot(
    repositoryRoot,
    descriptors[0]!
  );
  if (observed.specDigest !== descriptors[0]!.spec.specDigest) {
    throw new Error(`${label} canonical EnvironmentSpec readback drifted.`);
  }
  const unresolved = provider.unresolved === undefined
    ? []
    : uniqueStrings(provider.unresolved, `${label}.unresolved`);
  if (JSON.stringify(unresolved) !== JSON.stringify([WINDOWS_CONTROL_CLI_ROOT_CLOSURE_REASON])) {
    throw new Error(
      `${label}.unresolved must contain exactly ${WINDOWS_CONTROL_CLI_ROOT_CLOSURE_REASON}.`
    );
  }
  const surfaces = recordValue(provider.surfaces, `${label}.surfaces`);
  if (JSON.stringify(uniqueCanonicalSurfaceIds(surfaces.cli, `${label}.surfaces.cli`))
        !== JSON.stringify([WINDOWS_CONTROL_CLI_SESSION_SURFACE])
      || JSON.stringify(uniqueCanonicalSurfaceIds(surfaces.standingMcp, `${label}.surfaces.standingMcp`))
        !== JSON.stringify([])) {
    throw new Error(`${label} host-command-execution provider surfaces are invalid.`);
  }
}

function validateExecutionTopology(value: unknown): void {
  const label = 'External capability ledger.executionTopology';
  const topology = recordValue(value, label);
  exactKeys(topology, ['schema', 'semanticControlPlane', 'selection', 'environments', 'invariants'], label);
  if (topology.schema !== 'sec-verification-execution-topology-v1'
      || topology.semanticControlPlane !== 'platform-neutral'
      || topology.selection !== 'required-closure-intersect-missing-or-stale') {
    throw new Error(`${label} identity is invalid.`);
  }
  if (!Array.isArray(topology.environments) || topology.environments.length !== 3) {
    throw new Error(`${label}.environments must contain the exact three capability environments.`);
  }
  const environments = topology.environments.map((entry, index) =>
    recordValue(entry, `${label}.environments[${index}]`));
  const [windows, linux, darwin] = environments;
  exactKeys(windows!, ['id', 'availability', 'capabilities', 'evidenceRole'], `${label}.windows`);
  exactKeys(linux!, [
    'id', 'availability', 'capabilities', 'substrate', 'localRemoteSwitch'
  ], `${label}.linux`);
  exactKeys(darwin!, [
    'id', 'availability', 'capabilities', 'unrelatedDelta', 'requiredDelta'
  ], `${label}.darwin`);
  const linuxSubstrate = recordValue(linux!.substrate, `${label}.linux.substrate`);
  exactKeys(linuxSubstrate, ['wsl2'], `${label}.linux.substrate`);
  if (windows!.id !== 'windows-native-control' || windows!.availability !== 'available'
      || JSON.stringify(uniqueStrings(windows!.capabilities, `${label}.windows.capabilities`))
        !== JSON.stringify(['semantic-control', 'windows-native'])
      || windows!.evidenceRole !== 'owning-environment-only'
      || linux!.id !== 'docker-linux-x64' || linux!.availability !== 'available'
      || JSON.stringify(uniqueStrings(linux!.capabilities, `${label}.linux.capabilities`))
        !== JSON.stringify(['linux-native-runtime'])
      || linuxSubstrate.wsl2 !== 'implementation-only-not-independent-evidence'
      || linux!.localRemoteSwitch !== 'same-profile-conformance-no-workflow-change'
      || darwin!.id !== 'darwin-native' || darwin!.availability !== 'unavailable'
      || JSON.stringify(uniqueStrings(darwin!.capabilities, `${label}.darwin.capabilities`))
        !== JSON.stringify(['darwin-native'])
      || darwin!.unrelatedDelta !== 'not-applicable'
      || darwin!.requiredDelta !== 'typed-provider-unavailable') {
    throw new Error(`${label} capability mapping is invalid.`);
  }
  const invariants = recordValue(topology.invariants, `${label}.invariants`);
  exactKeys(invariants, [
    'noPlatformSubstitution', 'noSubstrateDoubleCounting',
    'noUnavailableProviderPass', 'noWorkflowEditForLocalRemoteSwitch'
  ], `${label}.invariants`);
  if (Object.values(invariants).some((entry) => entry !== true)) {
    throw new Error(`${label}.invariants must all be true.`);
  }
}

async function validateExternalCapabilityLedger(
  projection: VerificationProviderCapabilityLedgerProjection,
  repositoryRoot: string
): Promise<void> {
  const parsed = projection.document;
  exactKeys(
    parsed,
    [
      'schema', 'status', 'binding', 'policy', 'verification', 'executionTopology',
      'providers', 'invariants'
    ],
    'External capability ledger'
  );
  const status = boundedId(parsed.status, 'External capability ledger status');
  if (!EXTERNAL_LEDGER_STATUSES.has(status)) {
    throw new Error(`External capability ledger status ${status} is not supported.`);
  }
  const binding = recordValue(parsed.binding, 'External capability ledger binding');
  exactKeys(
    binding,
    ['repository'],
    'External capability ledger.binding'
  );
  if (binding.repository !== 'sec-platform/sec') {
    throw new Error('External capability ledger must bind sec-platform/sec.');
  }
  const policy = recordValue(parsed.policy, 'External capability ledger policy');
  exactKeys(policy, ['owner'], 'External capability ledger.policy');
  if (policy.owner !== 'docs/架构/实现供给与替换.md') {
    throw new Error('External capability ledger policy owner must be docs/架构/实现供给与替换.md.');
  }
  validateExecutionTopology(parsed.executionTopology);
  if (!Array.isArray(parsed.providers) || parsed.providers.length === 0) {
    throw new Error('External capability providers must be a non-empty array.');
  }

  const providers = parsed.providers.map((entry, index) =>
    recordValue(entry, `External capability provider ${index}`));
  const ids = providers.map((provider, index) => boundedId(
    provider.id,
    `External capability provider ${index}.id`
  ));
  if (new Set(ids).size !== ids.length) {
    throw new Error('External capability provider IDs must be unique.');
  }

  let standingGraphProviderCount = 0;
  const standingSurfaceOwners = new Map<string, string>();
  const routingProfileOwners = new Map<string, string>();
  const providerStates: Array<{
    decision: string;
    lifecycle: string;
    activeRoutingProfile: string | null;
  }> = [];
  for (const [index, provider] of providers.entries()) {
    const providerId = ids[index]!;
    const label = `External capability provider ${providerId}`;
    const category = boundedId(provider.category, `${label}.category`);
    const capability = boundedId(provider.capability, `${label}.capability`);
    const capabilityContract = EXTERNAL_PROVIDER_CAPABILITIES[capability];
    if (!capabilityContract) {
      throw new Error(`${label}.capability ${capability} is not supported.`);
    }
    if (capabilityContract.category !== category) {
      throw new Error(
        `${label}.capability ${capability} requires category ${capabilityContract.category}.`
      );
    }
    const decision = boundedId(provider.decision, `${label}.decision`);
    const lifecycle = boundedId(provider.lifecycle, `${label}.lifecycle`);
    const stateRequiredKeys: string[] = [];
    const stateOptionalKeys: string[] = [];
    if (decision === 'reject-with-rationale') {
      stateRequiredKeys.push('rationale');
    } else if (decision === 'watch-with-trigger') {
      stateRequiredKeys.push('unresolved');
    } else if (lifecycle === 'revalidation-required') {
      stateOptionalKeys.push('unresolved');
    }
    const hostCommandExecution = capability === 'host-command-execution';
    exactKeys(
      provider,
      [
        'id',
        'category',
        'capability',
        'decision',
        'lifecycle',
        ...(hostCommandExecution ? [] : ['observedVersion', 'versionAuthority']),
        'activeRoutingProfile',
        'surfaces',
        'forbiddenAuthority',
        ...stateRequiredKeys
      ],
      label,
      stateOptionalKeys
    );
    const allowedLifecycles = EXTERNAL_PROVIDER_STATE_MACHINE[decision];
    if (!allowedLifecycles) {
      throw new Error(`${label}.decision ${decision} is not supported.`);
    }
    if (!allowedLifecycles.includes(lifecycle)) {
      throw new Error(`${label}.decision ${decision} does not allow lifecycle ${lifecycle}.`);
    }
    if (!Object.prototype.hasOwnProperty.call(provider, 'activeRoutingProfile')) {
      throw new Error(`${label}.activeRoutingProfile must be explicit.`);
    }
    const activeRoutingProfile = provider.activeRoutingProfile === null
      ? null
      : boundedId(provider.activeRoutingProfile, `${label}.activeRoutingProfile`);
    const surfaces = recordValue(provider.surfaces, `${label}.surfaces`);
    exactKeys(surfaces, ['cli', 'standingMcp'], `${label}.surfaces`);
    const cli = uniqueCanonicalSurfaceIds(surfaces.cli, `${label}.surfaces.cli`);
    const standingMcp = uniqueCanonicalSurfaceIds(
      surfaces.standingMcp,
      `${label}.surfaces.standingMcp`
    );
    const hasActiveSurface = cli.length > 0 || standingMcp.length > 0;
    const unresolved = provider.unresolved === undefined
      ? []
      : uniqueStrings(provider.unresolved, `${label}.unresolved`);
    if (unresolved.some((entry) => entry.trim().length === 0)) {
      throw new Error(`${label}.unresolved must contain non-empty strings.`);
    }
    if (capability === 'host-command-execution') {
      await validateWindowsControlCliProviderClosure(provider, providerId, repositoryRoot);
    }
    validateForbiddenAuthority(provider, label);
    if (!hostCommandExecution) {
      await validateVersionAuthority(provider, providerId);
    }

    if (activeRoutingProfile !== null) {
      if (
        !ROUTABLE_PROVIDER_DECISIONS.has(decision)
        || !['active', 'revalidation-required'].includes(lifecycle)
        || !hasActiveSurface
      ) {
        throw new Error(`${label} active route conflicts with its decision, lifecycle, or surfaces.`);
      }
      if (!capabilityContract.routingProfiles.includes(activeRoutingProfile)) {
        throw new Error(
          `${label}.capability ${capability} does not permit routing profile `
          + `${activeRoutingProfile}.`
        );
      }
      const existingOwner = routingProfileOwners.get(activeRoutingProfile);
      if (existingOwner) {
        throw new Error(
          `Active routing profile ${activeRoutingProfile} is owned by both ${existingOwner} and ${providerId}.`
        );
      }
      routingProfileOwners.set(activeRoutingProfile, providerId);
    } else if (hasActiveSurface) {
      throw new Error(`${label} cannot expose active surfaces without an active routing profile.`);
    }

    if (decision === 'watch-with-trigger') {
      if (unresolved.length === 0) {
        throw new Error(`${label}.unresolved must explain why the provider remains under watch.`);
      }
    }
    if (decision === 'reject-with-rationale') {
      if (
        activeRoutingProfile !== null
        || cli.length > 0
        || standingMcp.length > 0
        || typeof provider.rationale !== 'string'
        || provider.rationale.trim().length === 0
      ) {
        throw new Error(`${label} rejected state must be retired, unrouted, and have a rationale.`);
      }
    }
    if (lifecycle === 'retired' && (activeRoutingProfile !== null || hasActiveSurface)) {
      throw new Error(`${label} retired lifecycle cannot own an active route or standing surface.`);
    }

    providerStates.push({ decision, lifecycle, activeRoutingProfile });
    if (category === 'graph' && standingMcp.length > 0) {
      standingGraphProviderCount += 1;
    }
    for (const surface of standingMcp) {
      const existingOwner = standingSurfaceOwners.get(surface);
      if (existingOwner) {
        throw new Error(
          `Standing MCP surface ${surface} is owned by both ${existingOwner} and ${providerId}.`
        );
      }
      standingSurfaceOwners.set(surface, providerId);
    }
  }

  const hasRevalidation = providerStates.some(
    ({ lifecycle }) => lifecycle === 'revalidation-required'
  );
  if (hasRevalidation && status !== 'revalidation-required') {
    throw new Error(
      'External capability ledger status must be revalidation-required while any '
      + 'provider requires revalidation.'
    );
  }
  if (status === 'revalidation-required' && !hasRevalidation) {
    throw new Error(
      'External capability ledger status revalidation-required requires at least one '
      + 'provider in lifecycle revalidation-required.'
    );
  }
  if (
    status === 'active'
    && !providerStates.some(({ lifecycle, activeRoutingProfile }) =>
      lifecycle === 'active' && activeRoutingProfile !== null)
  ) {
    throw new Error('External capability ledger status active requires an active routed provider.');
  }
  if (
    status === 'evaluation-required'
    && !providerStates.some(({ decision }) => decision === 'watch-with-trigger')
  ) {
    throw new Error(
      'External capability ledger status evaluation-required requires a provider under watch.'
    );
  }
  if (
    status === 'retired'
    && providerStates.some(({ lifecycle }) => lifecycle !== 'retired')
  ) {
    throw new Error('External capability ledger status retired requires every provider retired.');
  }

  const invariants = recordValue(parsed.invariants, 'External capability ledger invariants');
  exactKeys(
    invariants,
    [
      'deferCannotAuthorizeCustomSubstitute',
      'maxStandingGraphProviders',
      'providerOutputCannotBecomeCanonical',
      'providerWriteRequiresWorkPackage',
      'terminalConsumerHorizonRequired'
    ],
    'External capability ledger.invariants'
  );
  const maxStandingGraphProviders = nonNegativeSafeInteger(
    invariants.maxStandingGraphProviders,
    'External capability invariants.maxStandingGraphProviders'
  );
  if (
    maxStandingGraphProviders !== 1
    || invariants.deferCannotAuthorizeCustomSubstitute !== true
    || invariants.providerOutputCannotBecomeCanonical !== true
    || invariants.providerWriteRequiresWorkPackage !== true
    || invariants.terminalConsumerHorizonRequired !== true
  ) {
    throw new Error('External capability ledger security invariants are invalid.');
  }
  if (standingGraphProviderCount > maxStandingGraphProviders) {
    throw new Error(
      `External capability ledger has ${standingGraphProviderCount} standing graph providers; `
      + `maximum is ${maxStandingGraphProviders}.`
    );
  }
}

export async function scanMachineLedgers(
  repositoryRoot: string,
  issues: CapabilityLedgerIssue[]
): Promise<void> {
  try {
    const projection = parseVerificationProviderCapabilityLedger(
      await fs.readFile(path.join(repositoryRoot, VERIFICATION_PROVIDER_LEDGER_PATH), 'utf8')
    );
    await validateExternalCapabilityLedger(projection, repositoryRoot);
  } catch (error) {
    issues.push({
      level: 'error', code: 'machine-ledger-invalid', file: VERIFICATION_PROVIDER_LEDGER_PATH,
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

if (import.meta.main) {
  const issues: CapabilityLedgerIssue[] = [];
  await scanMachineLedgers(process.cwd(), issues);
  console.log(JSON.stringify({ issues }, null, 2));
  if (issues.length !== 0) process.exitCode = 1;
}
