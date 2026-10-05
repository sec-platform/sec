import fs from 'node:fs/promises';
import path from 'node:path';

import { parse as parseYaml } from 'yaml';

import { SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY } from '../../../providers/linux-verification/contract.ts';
import { SEC_WINDOWS_CONTROL_CLI_ENVIRONMENT_AUTHORITY, SEC_WINDOWS_CONTROL_CLI_ENVIRONMENT_SPEC_PATH, SEC_WINDOWS_CONTROL_CLI_ROOT_CLOSURE_REASON, SEC_WINDOWS_CONTROL_CLI_SESSION_SURFACE, parseSecWindowsControlCliEnvironmentAuthority, type WindowsControlCliEnvironmentSpec } from '../../../providers/windows-control-cli/contract/environment.ts';
import { inspectNoFollowDirectoryChain, inspectNoFollowOrdinaryFileEntry, scanNoFollowDirectoryTreeMetadata } from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import { EXTERNAL_CAPABILITY_LEDGER_PATH, parseExternalCapabilityLedger, type ExternalCapabilityLedgerProjection } from './capability-ledger.ts';

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
  readonly spec: typeof SEC_WINDOWS_CONTROL_CLI_ENVIRONMENT_AUTHORITY;
}>;

// A single explicit registry maps the host-command capability to its parsed
// authority. The provider ledger names only the active routing profile; it
// never mirrors the EnvironmentSpec path, digest, revision, executable,
// layout, endpoint, or resource values.
const ENVIRONMENT_SPEC_REGISTRY: readonly EnvironmentSpecDescriptor[] = Object.freeze([
  Object.freeze({
    path: SEC_WINDOWS_CONTROL_CLI_ENVIRONMENT_SPEC_PATH,
    spec: SEC_WINDOWS_CONTROL_CLI_ENVIRONMENT_AUTHORITY
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
  const parsed = parseSecWindowsControlCliEnvironmentAuthority(
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

function validateLinuxVerificationProviderClosure(
  provider: Record<string, unknown>,
  providerId: string
): void {
  const label = `External capability provider ${providerId}`;
  const environment = SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY;
  if (providerId !== 'github-actions-local-runner'
      || provider.category !== 'workflow-runtime'
      || provider.capability !== 'workflow-execution'
      || provider.decision !== 'integrate-adapter'
      || provider.lifecycle !== 'active'
      || provider.activeRoutingProfile !== environment.environmentId) {
    throw new Error(`${label} workflow-execution provider closure is invalid.`);
  }
  const surfaces = recordValue(provider.surfaces, `${label}.surfaces`);
  if (JSON.stringify(uniqueCanonicalSurfaceIds(surfaces.cli, `${label}.surfaces.cli`))
        !== JSON.stringify([
          'src/adapters/verification/platform/ci/runtime/local-github-actions-runner.ts'
        ])
      || JSON.stringify(uniqueCanonicalSurfaceIds(
        surfaces.standingMcp,
        `${label}.surfaces.standingMcp`
      )) !== JSON.stringify([])) {
    throw new Error(`${label} workflow-execution provider surfaces are invalid.`);
  }
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
      || provider.activeRoutingProfile !== SEC_WINDOWS_CONTROL_CLI_ENVIRONMENT_AUTHORITY.profileId) {
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
  if (JSON.stringify(unresolved) !== JSON.stringify([SEC_WINDOWS_CONTROL_CLI_ROOT_CLOSURE_REASON])) {
    throw new Error(
      `${label}.unresolved must contain exactly ${SEC_WINDOWS_CONTROL_CLI_ROOT_CLOSURE_REASON}.`
    );
  }
  const surfaces = recordValue(provider.surfaces, `${label}.surfaces`);
  if (JSON.stringify(uniqueCanonicalSurfaceIds(surfaces.cli, `${label}.surfaces.cli`))
        !== JSON.stringify([SEC_WINDOWS_CONTROL_CLI_SESSION_SURFACE])
      || JSON.stringify(uniqueCanonicalSurfaceIds(surfaces.standingMcp, `${label}.surfaces.standingMcp`))
        !== JSON.stringify([])) {
    throw new Error(`${label} host-command-execution provider surfaces are invalid.`);
  }
}

async function validateExternalCapabilityLedger(
  projection: ExternalCapabilityLedgerProjection,
  repositoryRoot: string
): Promise<void> {
  const parsed = projection.document;
  exactKeys(
    parsed,
    [
      'schema', 'status', 'binding', 'policy',
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
    } else if (capability === 'workflow-execution') {
      validateLinuxVerificationProviderClosure(provider, providerId);
    }
    validateForbiddenAuthority(provider, label);

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
    const projection = parseExternalCapabilityLedger(
      await fs.readFile(path.join(repositoryRoot, EXTERNAL_CAPABILITY_LEDGER_PATH), 'utf8')
    );
    await validateExternalCapabilityLedger(projection, repositoryRoot);
  } catch (error) {
    issues.push({
      level: 'error', code: 'machine-ledger-invalid', file: EXTERNAL_CAPABILITY_LEDGER_PATH,
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