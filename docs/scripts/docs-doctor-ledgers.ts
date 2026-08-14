import fs from 'node:fs/promises';
import path from 'node:path';

import { parse as parseYaml } from 'yaml';

import {
  documentationRecordByPath,
  type DocumentationAuthorityRegistry
} from '../../platform/shared/documentation-authority-contract.ts';
import {
  createVerificationProviderAvailabilityEpochV1,
  type VerificationProviderCapabilityInputV1
} from '../../platform/shared/verification-provider-capability-contract.ts';
import {
  pushIssue,
  recordValue,
  stringArrayValue,
  type DocsDoctorIssue
} from './docs-doctor-shared.ts';

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

function nullableNonNegativeSafeInteger(value: unknown, label: string): number | null {
  if (value === null) return null;
  return nonNegativeSafeInteger(value, label);
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

function exactGitObjectId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/u.test(value)) {
    throw new Error(`${label} must be an exact lowercase 40-character Git object ID.`);
  }
  return value;
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
  'workflow-execution': {
    category: 'workflow-runtime',
    routingProfiles: ['sec-linux-verification-v1']
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

const DEPENDENCY_SECTIONS = new Set([
  'dependencies',
  'devDependencies',
  'optionalDependencies'
]);

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

function validateVersionAuthority(
  provider: Record<string, unknown>,
  providerId: string,
  packageJson: Record<string, unknown>,
  bunLock: Record<string, unknown>
): void {
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
        'pythonVersion', 'zipExtractionCapability', 'sandboxRevision',
        'outerSutContainerCapabilities', 'sutResources',
        'roleProfiles', 'providerLeaseRef', 'providerLedgerSchema', 'providerLedgerAuthority',
        'providerLedgerObjectModel',
        'destructiveIdentityAuthority', 'imageRetirement', 'license'
      ],
      `${label}.versionAuthority`
    );
    const observedVersion = provider.observedVersion;
    if (typeof observedVersion !== 'string'
        || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(observedVersion)) {
      throw new Error(`${label}.observedVersion must be an exact semantic version.`);
    }
    const expectedPrefix = 'https://github.com/actions/runner/releases/';
    if (authority.release !== `${expectedPrefix}tag/v${observedVersion}`
        || authority.artifact !== `${expectedPrefix}download/v${observedVersion}/`
          + `actions-runner-linux-x64-${observedVersion}.tar.gz`) {
      throw new Error(`${label}.versionAuthority GitHub Actions runner release identity is invalid.`);
    }
    if (authority.artifactSha256
        !== '04cf0be1aff4c3ec3554466c39124ca250e3effd8873bb7e8d68535aa9505d5d') {
      throw new Error(`${label}.versionAuthority.artifactSha256 must be an exact SHA-256 digest.`);
    }
    if (authority.baseImage
        !== 'ubuntu@sha256:561618e2c15bf2397621dd04f96926663a3b5616c189cf7e38db7e82f5c538ea') {
      throw new Error(`${label}.versionAuthority.baseImage must be an exact Ubuntu image digest.`);
    }
    if (authority.imageId
        !== 'sha256:a51fddb5b7b5374cd7d48bd1843bb8eede70739b9a85953782c1b10a1064a6cf') {
      throw new Error(`${label}.versionAuthority.imageId must be an exact built image digest.`);
    }
    if (authority.imageBuildRevision !== 'trust-domains-node24-python312-archive-v7') {
      throw new Error(`${label}.versionAuthority.imageBuildRevision must bind the image recipe revision.`);
    }
    if (authority.nodeVersion !== '24.19.0') {
      throw new Error(`${label}.versionAuthority.nodeVersion must bind the observed shell Node runtime.`);
    }
    if (authority.nodeArtifact !== 'https://nodejs.org/dist/v24.19.0/node-v24.19.0-linux-x64.tar.xz') {
      throw new Error(`${label}.versionAuthority.nodeArtifact must bind the official Node.js binary.`);
    }
    if (authority.nodeArtifactSha256
        !== '14b342e71204f811bde6153be8e04b62aef63c236fef92b55f9c83154b409647') {
      throw new Error(`${label}.versionAuthority.nodeArtifactSha256 must bind the exact Node.js binary.`);
    }
    if (authority.pythonVersion !== '3.12.3') {
      throw new Error(`${label}.versionAuthority.pythonVersion must bind the archive-inspection runtime.`);
    }
    if (authority.zipExtractionCapability !== 'info-zip-unzip-6.00') {
      throw new Error(`${label}.versionAuthority.zipExtractionCapability must bind setup archive extraction.`);
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
    if ((sutResources as Record<string, unknown>).cpus !== 2 ||
        (sutResources as Record<string, unknown>).wallSeconds !== 3_600 ||
        (sutResources as Record<string, unknown>).aggregateCpuSeconds !== 7_200 ||
        (sutResources as Record<string, unknown>).perProcessCpuSeconds !== 7_200 ||
        (sutResources as Record<string, unknown>).memoryBytes !== 4_294_967_296 ||
        (sutResources as Record<string, unknown>).pids !== 256) {
      throw new Error(`${label}.versionAuthority.sutResources must bind the exact cgroup limits.`);
    }
    const roleProfiles = uniqueStrings(authority.roleProfiles, `${label}.versionAuthority.roleProfiles`);
    const expectedRoles = [
      'sec-linux-verification-control-v1',
      'sec-linux-verification-sut-v1',
      'sec-linux-verification-trusted-v1'
    ];
    if (roleProfiles.length !== expectedRoles.length
        || roleProfiles.some((role, index) => role !== expectedRoles[index])) {
      throw new Error(`${label}.versionAuthority.roleProfiles must bind the exact trust-domain roles.`);
    }
    if (authority.providerLeaseRef !== 'refs/tags/sec-provider-lease-sec-linux-verification-v1') {
      throw new Error(`${label}.versionAuthority.providerLeaseRef must bind the atomic provider lease.`);
    }
    if (authority.providerLedgerSchema !== 'sec-local-github-actions-provider-ledger-v3'
        || authority.providerLedgerAuthority !== 'remote-cas-immutable-generations'
        || authority.providerLedgerObjectModel
          !== 'git-commit-parent-chain-with-canonical-ledger-tree') {
      throw new Error(`${label}.versionAuthority provider ledger identity is invalid.`);
    }
    const destructiveIdentity = recordValue(
      authority.destructiveIdentityAuthority,
      `${label}.versionAuthority.destructiveIdentityAuthority`
    );
    exactKeys(destructiveIdentity, [
      'endpointBinding', 'immutableEffects', 'localState', 'mutableLocators'
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
        || destructiveIdentity.localState !== 'projection-only'
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
    if (!Array.isArray(superseded) || superseded.length !== 3) {
      throw new Error(`${label}.versionAuthority.imageRetirement.superseded must bind three decisions.`);
    }
    const expectedSuperseded = [
      {
        imageId: 'sha256:6ec6d4c46a92a8b9c64e33c3c864b0f817c296725b4a617f2c0e2aae9b40060e',
        imageTag: 'sec-actions-runner:2.336.0-trust-domains-node24-python312-v6',
        replacementImageId: 'sha256:a51fddb5b7b5374cd7d48bd1843bb8eede70739b9a85953782c1b10a1064a6cf',
        decision: 'superseded-by-trust-domains-node24-python312-archive-v7'
      },
      {
        imageId: 'sha256:60d1c338f85133d997cc2fb3b0353d79a52fc297e84188963e3e9c2cf98cf209',
        imageTag: 'sec-actions-runner:2.336.0-trust-domains-node24-python312-v4',
        replacementImageId: 'sha256:a51fddb5b7b5374cd7d48bd1843bb8eede70739b9a85953782c1b10a1064a6cf',
        decision: 'superseded-by-trust-domains-node24-python312-archive-v7'
      },
      {
        imageId: 'sha256:2fce0e62d0db84341fb2c76f4038879fbfceaf9babcb167c61b93f6b76ae906a',
        imageTag: 'sec-actions-runner:2.336.0-trust-domains-node24-v3',
        replacementImageId: 'sha256:a51fddb5b7b5374cd7d48bd1843bb8eede70739b9a85953782c1b10a1064a6cf',
        decision: 'superseded-by-trust-domains-node24-python312-archive-v7'
      }
    ];
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
  exactKeys(
    authority,
    ['kind', 'dependency', 'section', 'declaredSpec'],
    `${label}.versionAuthority`
  );
  if (authority.kind !== 'package') {
    throw new Error(`${label}.versionAuthority.kind must be package.`);
  }
  const dependency = authority.dependency;
  if (
    typeof dependency !== 'string'
    || !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u.test(dependency)
  ) {
    throw new Error(`${label}.versionAuthority.dependency must be a valid package name.`);
  }
  const section = authority.section;
  if (typeof section !== 'string' || !DEPENDENCY_SECTIONS.has(section)) {
    throw new Error(
      `${label}.versionAuthority.section ${String(section)} is not supported.`
    );
  }
  const declaredSpec = authority.declaredSpec;
  if (typeof declaredSpec !== 'string' || declaredSpec.length === 0) {
    throw new Error(`${label}.versionAuthority.declaredSpec must be a non-empty string.`);
  }
  const observedVersion = provider.observedVersion;
  if (
    typeof observedVersion !== 'string'
    || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(observedVersion)
  ) {
    throw new Error(`${label}.observedVersion must be an exact semantic version.`);
  }

  const packageSection = recordValue(packageJson[section], `package.json ${section}`);
  if (packageSection[dependency] !== declaredSpec) {
    throw new Error(
      `${label}.versionAuthority.declaredSpec ${declaredSpec} does not match `
      + `package.json ${section}.${dependency} ${String(packageSection[dependency])}.`
    );
  }
  const workspaces = recordValue(bunLock.workspaces, 'bun.lock workspaces');
  const rootWorkspace = recordValue(workspaces[''], 'bun.lock root workspace');
  const lockSection = recordValue(rootWorkspace[section], `bun.lock root workspace ${section}`);
  if (lockSection[dependency] !== declaredSpec) {
    throw new Error(
      `bun.lock root workspace ${section}.${dependency} ${String(lockSection[dependency])} `
      + `does not match declared spec ${declaredSpec}.`
    );
  }
  let satisfiesDeclaredSpec = false;
  try {
    satisfiesDeclaredSpec = Bun.semver.satisfies(observedVersion, declaredSpec);
  } catch {
    satisfiesDeclaredSpec = false;
  }
  if (!satisfiesDeclaredSpec) {
    throw new Error(
      `${label}.observedVersion ${observedVersion} does not satisfy declared spec ${declaredSpec}.`
    );
  }
  const packages = recordValue(bunLock.packages, 'bun.lock packages');
  const resolved = packages[dependency];
  const resolvedIdentity = Array.isArray(resolved) ? resolved[0] : undefined;
  const expectedIdentity = `${dependency}@${observedVersion}`;
  if (resolvedIdentity !== expectedIdentity) {
    throw new Error(
      `bun.lock packages.${dependency} resolved ${String(resolvedIdentity)} `
      + `does not match ${expectedIdentity}.`
    );
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
  if (!Array.isArray(topology.environments) || topology.environments.length !== 4) {
    throw new Error(`${label}.environments must contain the exact four capability environments.`);
  }
  const environments = topology.environments.map((entry, index) =>
    recordValue(entry, `${label}.environments[${index}]`));
  const [windows, linux, web, darwin] = environments;
  exactKeys(windows!, ['id', 'availability', 'capabilities', 'evidenceRole'], `${label}.windows`);
  exactKeys(linux!, [
    'id', 'availability', 'capabilities', 'substrate', 'localRemoteSwitch'
  ], `${label}.linux`);
  exactKeys(web!, [
    'id', 'availability', 'capabilities', 'applicability', 'cache'
  ], `${label}.web`);
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
      || web!.id !== 'web-runtime' || web!.availability !== 'on-demand'
      || JSON.stringify(uniqueStrings(web!.capabilities, `${label}.web.capabilities`))
        !== JSON.stringify(['chromium-playwright'])
      || web!.applicability !== 'browser-impact-only'
      || web!.cache !== 'exact-revision-content-addressed'
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

function validateExternalCapabilityLedger(
  parsed: Record<string, unknown>,
  packageJson: Record<string, unknown>,
  bunLock: Record<string, unknown>
): void {
  exactKeys(
    parsed,
    [
      'schema', 'status', 'binding', 'policy', 'verification', 'executionTopology',
      'providers', 'invariants'
    ],
    'External capability ledger'
  );
  if (parsed.schema !== 'sec-external-capability-ledger-v4') {
    throw new Error('External capability ledger schema must be sec-external-capability-ledger-v4.');
  }
  const status = boundedId(parsed.status, 'External capability ledger status');
  if (!EXTERNAL_LEDGER_STATUSES.has(status)) {
    throw new Error(`External capability ledger status ${status} is not supported.`);
  }
  const binding = recordValue(parsed.binding, 'External capability ledger binding');
  exactKeys(
    binding,
    ['repository', 'packageAuthority', 'lockAuthority'],
    'External capability ledger.binding'
  );
  if (
    binding.repository !== 'sec-platform/sec'
    || binding.packageAuthority !== 'package.json'
    || binding.lockAuthority !== 'bun.lock'
  ) {
    throw new Error('External capability ledger must bind sec-platform/sec, package.json, and bun.lock.');
  }
  const policy = recordValue(parsed.policy, 'External capability ledger policy');
  exactKeys(policy, ['owner'], 'External capability ledger.policy');
  if (policy.owner !== 'docs/external-provider-policy.md') {
    throw new Error('External capability ledger policy owner must be docs/external-provider-policy.md.');
  }
  const verification = recordValue(parsed.verification, 'External capability ledger.verification');
  exactKeys(verification, [
    'schema', 'epochId', 'observedAt', 'expiresAt', 'diagnosticRetention', 'capabilities'
  ], 'External capability ledger.verification');
  if (verification.schema !== 'sec-verification-provider-availability-ledger-v1') {
    throw new Error('External capability ledger.verification schema is invalid.');
  }
  boundedId(verification.epochId, 'External capability ledger.verification.epochId');
  const observedAt = String(verification.observedAt);
  const expiresAt = String(verification.expiresAt);
  if (new Date(observedAt).toISOString() !== observedAt
    || new Date(expiresAt).toISOString() !== expiresAt || expiresAt <= observedAt) {
    throw new Error('External capability ledger.verification availability epoch is invalid.');
  }
  const diagnosticRetention = recordValue(
    verification.diagnosticRetention,
    'External capability ledger.verification.diagnosticRetention'
  );
  exactKeys(diagnosticRetention, ['rawProviderProse', 'positiveClaimsRequireDurableEvidence'],
    'External capability ledger.verification.diagnosticRetention');
  if (diagnosticRetention.rawProviderProse !== 'disposable-after-normalization'
    || diagnosticRetention.positiveClaimsRequireDurableEvidence !== true) {
    throw new Error('External capability ledger verification diagnostic retention must be fail-closed.');
  }
  if (!Array.isArray(verification.capabilities) || verification.capabilities.length === 0) {
    throw new Error('External capability ledger verification capabilities must be a non-empty array.');
  }
  const verificationIds = new Set<string>();
  for (const [index, entry] of verification.capabilities.entries()) {
    const capability = recordValue(entry, `External capability ledger verification capability ${index}`);
    exactKeys(capability, [
      'capability', 'role', 'provider', 'availability', 'reasonCode', 'receiptRef', 'observedAt'
    ], `External capability ledger verification capability ${index}`);
    const capabilityId = boundedId(capability.capability, `verification capability ${index}.capability`);
    if (verificationIds.has(capabilityId)) {
      throw new Error(`External capability ledger verification capability ${capabilityId} is duplicate or unknown.`);
    }
    verificationIds.add(capabilityId);
  }
  // The hosted session uses this exact shared contract; keep docs:doctor from
  // accepting a ledger whose capability timestamps or availability semantics
  // it would later reject.
  createVerificationProviderAvailabilityEpochV1({
    epochId: String(verification.epochId),
    observedAt,
    expiresAt,
    capabilities: verification.capabilities as VerificationProviderCapabilityInputV1[]
  });
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
    exactKeys(
      provider,
      [
        'id',
        'category',
        'capability',
        'decision',
        'lifecycle',
        'observedVersion',
        'versionAuthority',
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
    validateForbiddenAuthority(provider, label);
    validateVersionAuthority(provider, providerId, packageJson, bunLock);

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
      'maxStandingGraphProviders',
      'providerOutputCannotBecomeCanonical',
      'providerWriteRequiresWorkPackage'
    ],
    'External capability ledger.invariants'
  );
  const maxStandingGraphProviders = nonNegativeSafeInteger(
    invariants.maxStandingGraphProviders,
    'External capability invariants.maxStandingGraphProviders'
  );
  if (
    maxStandingGraphProviders !== 1
    || invariants.providerOutputCannotBecomeCanonical !== true
    || invariants.providerWriteRequiresWorkPackage !== true
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

const NEXUS_LEDGER_STATUSES = new Set([
  'census-required',
  'incomplete',
  'blocked',
  'candidate-complete',
  'complete',
  'invalidated'
]);

function validateNexusCompletion(parsed: Record<string, unknown>): void {
  if (parsed.schema !== 'sec-nexus-corpus-ledger-v2') {
    throw new Error('Nexus ledger schema must be sec-nexus-corpus-ledger-v2.');
  }
  const status = boundedId(parsed.status, 'Nexus ledger status');
  if (!NEXUS_LEDGER_STATUSES.has(status)) {
    throw new Error(`Nexus ledger status ${status} is not supported.`);
  }
  if (status === 'complete') {
    throw new Error(
      'Nexus status complete is unsupported until a typed materialized-record validator '
      + 'binds source identity and coverage counters.'
    );
  }
  exactKeys(
    parsed,
    ['schema', 'status', 'source', 'coverage', 'completion', 'invalidation'],
    'Nexus ledger',
    ['notes']
  );
  const source = recordValue(parsed.source, 'Nexus source');
  exactKeys(
    source,
    ['repository', 'baselineCommit', 'baselineTree', 'trackedPaths'],
    'Nexus ledger.source'
  );
  const coverage = recordValue(parsed.coverage, 'Nexus coverage');
  exactKeys(
    coverage,
    [
      'pathClassification',
      'mechanismDecisions',
      'eprBindings',
      'skillBindings',
      'executableEntrypoints',
      'acceptedParity',
      'unexplainedDeltaCount'
    ],
    'Nexus ledger.coverage'
  );
  const pathClassification = recordValue(
    coverage.pathClassification,
    'Nexus path classification'
  );
  exactKeys(
    pathClassification,
    ['materialized', 'classified', 'total'],
    'Nexus ledger.coverage.pathClassification'
  );
  const mechanismDecisions = recordValue(
    coverage.mechanismDecisions,
    'Nexus mechanism decisions'
  );
  exactKeys(
    mechanismDecisions,
    ['decided', 'total'],
    'Nexus ledger.coverage.mechanismDecisions'
  );
  const eprBindings = recordValue(coverage.eprBindings, 'Nexus EPR bindings');
  exactKeys(eprBindings, ['bound', 'expected'], 'Nexus ledger.coverage.eprBindings');
  const skillBindings = recordValue(coverage.skillBindings, 'Nexus Skill bindings');
  exactKeys(skillBindings, ['bound', 'expected'], 'Nexus ledger.coverage.skillBindings');
  const executableEntrypoints = recordValue(
    coverage.executableEntrypoints,
    'Nexus executable entrypoints'
  );
  exactKeys(
    executableEntrypoints,
    ['materialized'],
    'Nexus ledger.coverage.executableEntrypoints'
  );
  const acceptedParity = recordValue(coverage.acceptedParity, 'Nexus accepted parity');
  exactKeys(
    acceptedParity,
    ['proven', 'accepted'],
    'Nexus ledger.coverage.acceptedParity'
  );
  const completion = recordValue(parsed.completion, 'Nexus completion');
  exactKeys(
    completion,
    ['censusComplete', 'parityComplete', 'retirementComplete', 'noOmissionProven'],
    'Nexus ledger.completion'
  );
  const invalidation = recordValue(parsed.invalidation, 'Nexus invalidation');
  exactKeys(
    invalidation,
    ['reason', 'requiresExactTreeCensus'],
    'Nexus ledger.invalidation'
  );
  if (typeof invalidation.reason !== 'string' || invalidation.reason.trim().length === 0) {
    throw new Error('Nexus invalidation.reason must be a non-empty string.');
  }
  if (typeof invalidation.requiresExactTreeCensus !== 'boolean') {
    throw new Error('Nexus invalidation.requiresExactTreeCensus must be boolean.');
  }
  if (source.repository !== 'QzCrane/nexus') {
    throw new Error('Nexus ledger source repository must be QzCrane/nexus.');
  }
  const sourceBaselineCommit = source.baselineCommit === null
    ? null
    : exactGitObjectId(source.baselineCommit, 'Nexus source.baselineCommit');
  const sourceBaselineTree = source.baselineTree === null
    ? null
    : exactGitObjectId(source.baselineTree, 'Nexus source.baselineTree');
  if ((sourceBaselineCommit === null) !== (sourceBaselineTree === null)) {
    throw new Error(
      'Nexus source.baselineCommit and baselineTree must be both null or both exact Git object IDs.'
    );
  }
  const sourceTrackedPaths = nullableNonNegativeSafeInteger(
    source.trackedPaths,
    'Nexus source.trackedPaths'
  );
  if (sourceTrackedPaths !== null && sourceBaselineCommit === null) {
    throw new Error(
      'Nexus source.trackedPaths requires exact baselineCommit and baselineTree.'
    );
  }
  if (status === 'census-required') {
    if (
      sourceBaselineCommit !== null
      || sourceBaselineTree !== null
      || sourceTrackedPaths !== null
    ) {
      throw new Error(
        'Nexus status census-required requires source.baselineCommit, source.baselineTree, '
        + 'and source.trackedPaths to be null.'
      );
    }
  }
  if (parsed.notes !== undefined) {
    const notes = uniqueStrings(parsed.notes, 'Nexus ledger.notes');
    if (notes.some((note) => note.trim().length === 0)) {
      throw new Error('Nexus ledger.notes must contain non-empty strings.');
    }
  }
  for (const field of [
    'censusComplete',
    'parityComplete',
    'retirementComplete',
    'noOmissionProven'
  ]) {
    if (typeof completion[field] !== 'boolean') {
      throw new Error(`Nexus completion.${field} must be boolean.`);
    }
  }
  const censusComplete = completion.censusComplete as boolean;
  const parityComplete = completion.parityComplete as boolean;
  const retirementComplete = completion.retirementComplete as boolean;
  const noOmissionProven = completion.noOmissionProven as boolean;
  if (typeof pathClassification.materialized !== 'boolean') {
    throw new Error('Nexus pathClassification.materialized must be boolean.');
  }
  if (typeof executableEntrypoints.materialized !== 'boolean') {
    throw new Error('Nexus executableEntrypoints.materialized must be boolean.');
  }
  const pathTotal = nullableNonNegativeSafeInteger(
    pathClassification.total,
    'Nexus pathClassification.total'
  );
  const pathClassified = nonNegativeSafeInteger(
    pathClassification.classified,
    'Nexus pathClassification.classified'
  );
  const mechanismTotal = nullableNonNegativeSafeInteger(
    mechanismDecisions.total,
    'Nexus mechanismDecisions.total'
  );
  const mechanismDecided = nonNegativeSafeInteger(
    mechanismDecisions.decided,
    'Nexus mechanismDecisions.decided'
  );
  const eprBound = nonNegativeSafeInteger(eprBindings.bound, 'Nexus eprBindings.bound');
  const eprExpected = nonNegativeSafeInteger(eprBindings.expected, 'Nexus eprBindings.expected');
  const skillBound = nonNegativeSafeInteger(skillBindings.bound, 'Nexus skillBindings.bound');
  const skillExpected = nullableNonNegativeSafeInteger(
    skillBindings.expected,
    'Nexus skillBindings.expected'
  );
  const parityProven = nonNegativeSafeInteger(
    acceptedParity.proven,
    'Nexus acceptedParity.proven'
  );
  const parityAccepted = nonNegativeSafeInteger(
    acceptedParity.accepted,
    'Nexus acceptedParity.accepted'
  );
  const unexplainedDeltaCount = nullableNonNegativeSafeInteger(
    coverage.unexplainedDeltaCount,
    'Nexus coverage.unexplainedDeltaCount'
  );
  const sourceIsBound = sourceBaselineCommit !== null;
  if (status === 'candidate-complete' && !noOmissionProven) {
    throw new Error(
      'Nexus status candidate-complete requires completion.noOmissionProven=true.'
    );
  }
  if (
    status === 'candidate-complete'
    && (
      sourceBaselineCommit === null
      || sourceBaselineTree === null
      || sourceTrackedPaths === null
      || pathTotal === null
      || mechanismTotal === null
      || skillExpected === null
      || unexplainedDeltaCount === null
    )
  ) {
    throw new Error(
      `Nexus status ${status} requires non-null source and coverage counters.`
    );
  }
  if (
    !sourceIsBound
    && (
      pathClassification.materialized !== false
      || pathClassified !== 0
      || pathTotal !== null
      || mechanismDecided !== 0
      || mechanismTotal !== null
      || eprBound !== 0
      || skillBound !== 0
      || skillExpected !== null
      || executableEntrypoints.materialized !== false
      || parityProven !== 0
      || parityAccepted !== 0
      || unexplainedDeltaCount !== null
      || censusComplete
      || parityComplete
      || retirementComplete
      || noOmissionProven
      || invalidation.requiresExactTreeCensus !== true
    )
  ) {
    throw new Error(
      'Nexus unbound source cannot carry source-derived progress or completion claims.'
    );
  }
  if (pathTotal !== null && pathClassified > pathTotal) {
    throw new Error(
      'Nexus pathClassification.classified cannot exceed a materialized path total.'
    );
  }
  if (mechanismTotal !== null && mechanismDecided > mechanismTotal) {
    throw new Error('Nexus mechanismDecisions.decided cannot exceed total.');
  }
  if (eprBound > eprExpected) {
    throw new Error('Nexus eprBindings.bound cannot exceed expected.');
  }
  if (skillExpected !== null && skillBound > skillExpected) {
    throw new Error('Nexus skillBindings.bound cannot exceed expected.');
  }
  if (parityProven > parityAccepted) {
    throw new Error('Nexus acceptedParity.proven cannot exceed accepted.');
  }
  if (status === 'candidate-complete') {
    if (
      sourceBaselineCommit === null
      || sourceBaselineTree === null
      || sourceTrackedPaths === null
      || pathTotal === null
      || mechanismTotal === null
      || skillExpected === null
      || unexplainedDeltaCount === null
    ) {
      throw new Error(
        `Nexus status ${status} requires non-null source and coverage counters.`
      );
    }
    if (
      !censusComplete
      || !parityComplete
      || !retirementComplete
      || pathClassification.materialized !== true
      || executableEntrypoints.materialized !== true
    ) {
      throw new Error(
        `Nexus status ${status} requires complete materialized `
        + 'census/entrypoints/parity/retirement.'
      );
    }
    if (
      pathTotal <= 0
      || sourceTrackedPaths !== pathTotal
      || pathClassified !== pathTotal
      || mechanismTotal <= 0
      || mechanismDecided !== mechanismTotal
      || eprBound !== eprExpected
      || skillBound !== skillExpected
      || parityProven !== parityAccepted
      || unexplainedDeltaCount !== 0
    ) {
      throw new Error(`Nexus status ${status} conflicts with source or coverage counters.`);
    }
    return;
  }
  if (
    pathTotal !== null
    && (sourceTrackedPaths === null || pathTotal !== sourceTrackedPaths)
  ) {
    throw new Error(
      'Nexus pathClassification.total requires matching source.trackedPaths.'
    );
  }
  if (
    censusComplete
    && (
      sourceTrackedPaths === null
      || pathTotal === null
      || mechanismTotal === null
      || pathClassification.materialized !== true
      || executableEntrypoints.materialized !== true
      || sourceTrackedPaths !== pathTotal
      || pathClassified !== pathTotal
      || mechanismDecided !== mechanismTotal
    )
  ) {
    throw new Error(
      'Nexus completion.censusComplete requires bound tracked paths, complete materialized '
      + 'path/entrypoint census, and decided mechanism totals.'
    );
  }
  if (
    parityComplete
    && (
      !censusComplete
      || parityProven !== parityAccepted
      || unexplainedDeltaCount !== 0
    )
  ) {
    throw new Error(
      'Nexus completion.parityComplete requires censusComplete, proven=accepted, '
      + 'and unexplainedDeltaCount=0.'
    );
  }
  if (retirementComplete && !parityComplete) {
    throw new Error(
      'Nexus completion.retirementComplete requires parityComplete.'
    );
  }
  if (noOmissionProven) {
    throw new Error(`Nexus status ${status} cannot claim no-omission completion.`);
  }
}

export async function scanMachineLedgers(
  repositoryRoot: string,
  registry: DocumentationAuthorityRegistry,
  issues: DocsDoctorIssue[]
): Promise<void> {
  const report = (file: string, error: unknown): void => pushIssue(issues, {
    level: 'error',
    code: 'machine-ledger-invalid',
    file,
    message: error instanceof Error ? error.message : String(error)
  });

  if (documentationRecordByPath(registry, 'docs/governance/external-capability-ledger.yaml')) {
    const ledgerPath = 'docs/governance/external-capability-ledger.yaml';
    try {
      const parsed = recordValue(
        parseYaml(await fs.readFile(path.join(repositoryRoot, ledgerPath), 'utf8')),
        'External capability ledger'
      );
      const packageJson = recordValue(
        JSON.parse(await fs.readFile(path.join(repositoryRoot, 'package.json'), 'utf8')),
        'package.json'
      );
      const bunLock = recordValue(
        Bun.YAML.parse(await fs.readFile(path.join(repositoryRoot, 'bun.lock'), 'utf8')),
        'bun.lock'
      );
      validateExternalCapabilityLedger(parsed, packageJson, bunLock);
    } catch (error) {
      report(ledgerPath, error);
    }
  }

  if (documentationRecordByPath(registry, 'docs/governance/nexus-absorption-ledger.yaml')) {
    const ledgerPath = 'docs/governance/nexus-absorption-ledger.yaml';
    try {
      const parsed = recordValue(
        parseYaml(await fs.readFile(path.join(repositoryRoot, ledgerPath), 'utf8')),
        'Nexus ledger'
      );
      validateNexusCompletion(parsed);
    } catch (error) {
      report(ledgerPath, error);
    }
  }
}
