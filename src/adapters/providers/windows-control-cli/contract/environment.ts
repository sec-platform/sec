import { deepFreeze, sha256 } from '../../../../contracts/canonical.ts';
import source from '../profile/default.json' with { type: 'json' };

const WINDOWS_CONTROL_CLI_ENVIRONMENT_SCHEMA =
  'sec-windows-control-cli-environment-authority-v2' as const;
export const WINDOWS_CONTROL_CLI_ENVIRONMENT_SPEC_PATH =
  'src/adapters/providers/windows-control-cli/profile/default.json' as const;
export const WINDOWS_CONTROL_CLI_PROFILE_ID = 'sec-windows-control-cli-v1' as const;
export const WINDOWS_CONTROL_CLI_SESSION_SURFACE =
  'windows-control-cli-session' as const;
const WINDOWS_CONTROL_CLI_ROOT_CLOSURE_STATUS =
  'live-adoption-required' as const;
export const WINDOWS_CONTROL_CLI_ROOT_CLOSURE_REASON =
  'installed-executable-capability-unproven' as const;
const WINDOWS_CONTROL_CLI_ROOT_CLOSURE_RECEIPT_SCHEMA =
  'sec-windows-control-cli-installed-adoption-receipt-v1' as const;

type WindowsControlCliExecutableRole = 'launcher' | 'effective';
type WindowsControlCliExecutableEntryAuthority = {
  roles: WindowsControlCliExecutableRole[];
  relativePath: string;
  observedSizeBytes: number;
  observedSha256: string;
};
type WindowsControlCliModuleEntryAuthority = {
  relativePath: string;
  observedSizeBytes: number;
  observedSha256: string;
};
type WindowsControlCliExecutableBinding = {
  id: string;
  kind: 'git-for-windows' | 'github-cli';
  version: string;
  executableName: 'git.exe' | 'gh.exe';
  candidateLayouts: Array<{
    candidateRelativePath: string;
    effectiveRelativePath: string;
  }>;
  executableEntries: WindowsControlCliExecutableEntryAuthority[];
  appLocalModules: WindowsControlCliModuleEntryAuthority[];
};
export type WindowsControlCliEnvironmentAuthority = {
  schema: typeof WINDOWS_CONTROL_CLI_ENVIRONMENT_SCHEMA;
  profileId: typeof WINDOWS_CONTROL_CLI_PROFILE_ID;
  platform: 'win32';
  architecture: 'x64';
  resourceContract: {
    maxSessionDurationMs: number;
  };
  adoptionContract: {
    discovery: {
      candidateSources: [
        'process-path-untrusted-hint',
        'windows-standard-location-untrusted-hint'
      ];
      maxPathEntries: number;
      maxCandidatesPerExecutable: number;
      maxPathBytes: number;
      selection: 'unique-authenticated-physical-closure';
    };
    physicalClosure: {
      maxRetainedFiles: number;
      maxObservedBytes: number;
      maxPeSections: number;
      maxImportedModules: number;
      resolveSystemModules: 'system32-loader-readback';
      runtimeProvisioning: 'forbidden';
      persistentExecutableCache: 'forbidden';
    };
  };
  rootClosure: {
    status: typeof WINDOWS_CONTROL_CLI_ROOT_CLOSURE_STATUS;
    reasonCode: typeof WINDOWS_CONTROL_CLI_ROOT_CLOSURE_REASON;
    liveAvailability: 'unknown';
    positiveReceiptContract: {
      schema: typeof WINDOWS_CONTROL_CLI_ROOT_CLOSURE_RECEIPT_SCHEMA;
      candidate: 'bounded-untrusted-locator-readback';
      executable: 'retained-exact-bytes-readback';
      loader: 'minimal-app-local-and-system-loader-readback';
      workingDirectory: 'retained-no-follow-working-directory-readback';
      authorization: 'owner-issued-live-capability';
      persistentExecutableCache: 'forbidden';
    };
  };
  executableBindings: WindowsControlCliExecutableBinding[];
};
type DeepReadonly<Value> = Value extends (...args: never[]) => unknown
  ? Value
  : Value extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : Value extends object
      ? { readonly [Key in keyof Value]: DeepReadonly<Value[Key]> }
      : Value;
type WindowsControlCliExecutableEntry = DeepReadonly<
  WindowsControlCliExecutableBinding['executableEntries'][number]
>;
type WindowsControlCliAppLocalModule = DeepReadonly<
  WindowsControlCliExecutableBinding['appLocalModules'][number]
>;
type WindowsControlCliResourceContract =
  WindowsControlCliEnvironmentAuthority['resourceContract'];
type WindowsControlCliAdoptionContract =
  WindowsControlCliEnvironmentAuthority['adoptionContract'];
type WindowsControlCliRootClosure =
  WindowsControlCliEnvironmentAuthority['rootClosure'];
type WindowsControlCliPositiveReceiptContract = DeepReadonly<
  WindowsControlCliRootClosure['positiveReceiptContract']
>;
export type WindowsControlCliEnvironmentSpec = Readonly<
  WindowsControlCliEnvironmentAuthority & { specDigest: `sha256:${string}` }
>;

type WindowsControlCliResourceBudget = Readonly<Pick<
  WindowsControlCliResourceContract,
  'maxSessionDurationMs'
>>;
type WindowsControlCliAdoptionBudget = DeepReadonly<
  WindowsControlCliAdoptionContract
>;
export type WindowsControlCliExecutableBindingProjection = Readonly<{
  readonly id: WindowsControlCliExecutableBinding['id'];
  readonly kind: WindowsControlCliExecutableBinding['kind'];
  readonly version: string;
  readonly executableName: 'git.exe' | 'gh.exe';
  readonly candidateLayouts: DeepReadonly<WindowsControlCliExecutableBinding['candidateLayouts']>;
  readonly launcherEntries: readonly WindowsControlCliExecutableEntry[];
  readonly effectiveEntry: WindowsControlCliExecutableEntry;
  readonly appLocalModules: readonly WindowsControlCliAppLocalModule[];
}>;
type WindowsControlCliRootClosureProjection = Readonly<{
  readonly status: WindowsControlCliRootClosure['status'];
  readonly reasonCode: WindowsControlCliRootClosure['reasonCode'];
  readonly liveAvailability: WindowsControlCliRootClosure['liveAvailability'];
  readonly requiredReceiptContract: WindowsControlCliPositiveReceiptContract;
}>;
export type WindowsControlCliEnvironmentProjection = Readonly<{
  readonly profileId: WindowsControlCliEnvironmentAuthority['profileId'];
  readonly platform: WindowsControlCliEnvironmentAuthority['platform'];
  readonly architecture: WindowsControlCliEnvironmentAuthority['architecture'];
  readonly specDigest: `sha256:${string}`;
  readonly resourceBudget: WindowsControlCliResourceBudget;
  readonly adoptionBudget: WindowsControlCliAdoptionBudget;
  readonly rootClosure: WindowsControlCliRootClosureProjection;
  readonly executableBindings: readonly WindowsControlCliExecutableBindingProjection[];
}>;

function fail(message: string): never {
  throw new Error(`SEC Windows control CLI environment authority: ${message}`);
}

function assertUniqueRelativePaths(
  entries: readonly Readonly<{ relativePath: string }>[],
  label: string
): void {
  const keys = new Set<string>();
  for (const entry of entries) {
    const key = entry.relativePath.toLocaleLowerCase('en-US');
    if (keys.has(key)) fail(`${label} has a duplicate case-insensitive path`);
    keys.add(key);
  }
}

function validateExecutableBinding(
  binding: WindowsControlCliExecutableBinding,
  index: number
): void {
  const label = `executableBindings[${index}]`;
  const expectedId = index === 0 ? 'git' : 'gh';
  const expectedKind = expectedId === 'git' ? 'git-for-windows' : 'github-cli';
  const expectedExecutable = expectedId === 'git' ? 'git.exe' : 'gh.exe';
  if (binding.id !== expectedId || binding.kind !== expectedKind
      || binding.executableName !== expectedExecutable) {
    fail(`${label} is outside the canonical executable ordering and identity`);
  }
  assertUniqueRelativePaths(binding.executableEntries, `${label}.executableEntries`);
  assertUniqueRelativePaths(binding.appLocalModules, `${label}.appLocalModules`);
  const effective = binding.executableEntries.filter(({ roles }) => roles.includes('effective'));
  const launchers = binding.executableEntries.filter(({ roles }) => roles.includes('launcher'));
  if (effective.length !== 1 || launchers.length === 0) {
    fail(`${label} must contain one effective executable and at least one launcher`);
  }
  const byPath = new Map(binding.executableEntries.map((entry) => [
    entry.relativePath.toLocaleLowerCase('en-US'), entry
  ] as const));
  const layoutKeys = new Set<string>();
  for (const layout of binding.candidateLayouts) {
    const key = layout.candidateRelativePath.toLocaleLowerCase('en-US');
    if (layoutKeys.has(key)) fail(`${label}.candidateLayouts contains a duplicate candidate`);
    layoutKeys.add(key);
    const launcher = byPath.get(key);
    const selectedEffective = byPath.get(layout.effectiveRelativePath.toLocaleLowerCase('en-US'));
    if (launcher?.roles.includes('launcher') !== true
        || selectedEffective?.roles.includes('effective') !== true) {
      fail(`${label}.candidateLayouts does not bind declared launcher/effective entries`);
    }
  }
  const modulePaths = new Set(binding.appLocalModules.map(({ relativePath }) =>
    relativePath.toLocaleLowerCase('en-US')));
  if ([...modulePaths].some((candidate) => byPath.has(candidate))) {
    fail(`${label}.appLocalModules overlaps executable entries`);
  }
  if (expectedId === 'git') {
    if (binding.appLocalModules.length === 0 || !binding.version.endsWith('.windows.3')) {
      fail('Git executable binding must declare its installed app-local closure');
    }
  } else if (binding.appLocalModules.length !== 0) {
    fail('GitHub CLI executable binding must not declare app-local modules');
  }
}

function schemaError(label: string, message: string): never {
  throw new Error(`${label}: ${message}`);
}

function exactRecord(
  input: unknown,
  label: string,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = []
): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    schemaError(label, 'expected an object');
  }
  const value = input as Record<string, unknown>;
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) schemaError(label, `unknown field ${key}`);
  }
  for (const key of requiredKeys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      schemaError(label, `missing field ${key}`);
    }
  }
  return value;
}

function boundedArray(
  input: unknown,
  label: string,
  minimum: number,
  maximum: number
): unknown[] {
  if (!Array.isArray(input) || input.length < minimum || input.length > maximum) {
    schemaError(label, `expected ${minimum}..${maximum} entries`);
  }
  return input;
}

function exactLiteral<const Value extends string>(
  input: unknown,
  expected: Value,
  label: string
): Value {
  if (input !== expected) schemaError(label, `expected ${expected}`);
  return expected;
}

function oneOf<const Values extends readonly string[]>(
  input: unknown,
  values: Values,
  label: string
): Values[number] {
  if (typeof input !== 'string' || !values.includes(input)) {
    schemaError(label, `expected one of ${values.join(', ')}`);
  }
  return input as Values[number];
}

function positiveBoundedInteger(input: unknown, label: string): number {
  if (!Number.isSafeInteger(input) || (input as number) < 1 || (input as number) > 2 ** 31 - 1) {
    schemaError(label, 'expected a positive bounded integer');
  }
  return input as number;
}

function boundedText(input: unknown, label: string): string {
  if (typeof input !== 'string' || input.length < 1 || input.length > 256
      || input.trim() !== input || /[\u0000-\u001f\u007f-\u009f]/u.test(input)) {
    schemaError(label, 'expected bounded canonical text');
  }
  return input;
}

function executableId(input: unknown, label: string): string {
  if (typeof input !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/u.test(input)) {
    schemaError(label, 'expected a canonical executable id');
  }
  return input;
}

function relativeLocator(input: unknown, label: string): string {
  if (typeof input !== 'string'
      || !/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/u.test(input)
      || input === '.' || input === '..'
      || input.split('/').some((component) => component === '.' || component === '..')) {
    schemaError(label, 'expected a canonical relative locator');
  }
  return input;
}

function sha256Hex(input: unknown, label: string): string {
  if (typeof input !== 'string' || !/^[0-9a-f]{64}$/u.test(input)) {
    schemaError(label, 'expected a lowercase SHA-256 digest');
  }
  return input;
}

function parseObservedEntry(
  input: unknown,
  label: string,
  executable: boolean
): WindowsControlCliExecutableEntryAuthority | WindowsControlCliModuleEntryAuthority {
  const value = exactRecord(
    input,
    label,
    executable
      ? ['roles', 'relativePath', 'observedSizeBytes', 'observedSha256']
      : ['relativePath', 'observedSizeBytes', 'observedSha256']
  );
  const common = {
    relativePath: relativeLocator(value.relativePath, `${label}.relativePath`),
    observedSizeBytes: positiveBoundedInteger(value.observedSizeBytes, `${label}.observedSizeBytes`),
    observedSha256: sha256Hex(value.observedSha256, `${label}.observedSha256`)
  };
  if (!executable) return common;
  const roles = boundedArray(value.roles, `${label}.roles`, 1, 2).map((role, index) =>
    oneOf(role, ['launcher', 'effective'] as const, `${label}.roles[${index}]`));
  if (new Set(roles).size !== roles.length) schemaError(`${label}.roles`, 'contains duplicate roles');
  return { roles, ...common };
}

function parseExecutableBindingSchema(
  input: unknown,
  index: number
): WindowsControlCliExecutableBinding {
  const label = `executableBindings[${index}]`;
  const value = exactRecord(input, label, [
    'id', 'kind', 'version', 'executableName', 'candidateLayouts',
    'executableEntries', 'appLocalModules'
  ]);
  return {
    id: executableId(value.id, `${label}.id`),
    kind: oneOf(value.kind, ['git-for-windows', 'github-cli'] as const, `${label}.kind`),
    version: boundedText(value.version, `${label}.version`),
    executableName: oneOf(value.executableName, ['git.exe', 'gh.exe'] as const, `${label}.executableName`),
    candidateLayouts: boundedArray(value.candidateLayouts, `${label}.candidateLayouts`, 1, 4)
      .map((entry, layoutIndex) => {
        const layoutLabel = `${label}.candidateLayouts[${layoutIndex}]`;
        const layout = exactRecord(entry, layoutLabel, ['candidateRelativePath', 'effectiveRelativePath']);
        return {
          candidateRelativePath: relativeLocator(layout.candidateRelativePath, `${layoutLabel}.candidateRelativePath`),
          effectiveRelativePath: relativeLocator(layout.effectiveRelativePath, `${layoutLabel}.effectiveRelativePath`)
        };
      }),
    executableEntries: boundedArray(value.executableEntries, `${label}.executableEntries`, 1, 4)
      .map((entry, entryIndex) => parseObservedEntry(
        entry,
        `${label}.executableEntries[${entryIndex}]`,
        true
      ) as WindowsControlCliExecutableEntryAuthority),
    appLocalModules: boundedArray(value.appLocalModules, `${label}.appLocalModules`, 0, 32)
      .map((entry, entryIndex) => parseObservedEntry(
        entry,
        `${label}.appLocalModules[${entryIndex}]`,
        false
      ) as WindowsControlCliModuleEntryAuthority)
  };
}

function parseAuthoritySchema(input: unknown): WindowsControlCliEnvironmentAuthority {
  const value = exactRecord(input, 'root', [
    'schema', 'profileId', 'platform', 'architecture', 'resourceContract',
    'adoptionContract', 'rootClosure', 'executableBindings'
  ]);
  const resource = exactRecord(value.resourceContract, 'resourceContract', [
    'maxSessionDurationMs'
  ]);
  const adoption = exactRecord(value.adoptionContract, 'adoptionContract', ['discovery', 'physicalClosure']);
  const discovery = exactRecord(adoption.discovery, 'adoptionContract.discovery', [
    'candidateSources', 'maxPathEntries', 'maxCandidatesPerExecutable', 'maxPathBytes', 'selection'
  ]);
  const sources = boundedArray(discovery.candidateSources, 'adoptionContract.discovery.candidateSources', 2, 2);
  const physical = exactRecord(adoption.physicalClosure, 'adoptionContract.physicalClosure', [
    'maxRetainedFiles', 'maxObservedBytes', 'maxPeSections', 'maxImportedModules',
    'resolveSystemModules', 'runtimeProvisioning', 'persistentExecutableCache'
  ]);
  const rootClosure = exactRecord(value.rootClosure, 'rootClosure', [
    'status', 'reasonCode', 'liveAvailability', 'positiveReceiptContract'
  ]);
  const receipt = exactRecord(rootClosure.positiveReceiptContract, 'rootClosure.positiveReceiptContract', [
    'schema', 'candidate', 'executable', 'loader', 'workingDirectory',
    'authorization', 'persistentExecutableCache'
  ]);
  return {
    schema: exactLiteral(value.schema, WINDOWS_CONTROL_CLI_ENVIRONMENT_SCHEMA, 'schema'),
    profileId: exactLiteral(value.profileId, WINDOWS_CONTROL_CLI_PROFILE_ID, 'profileId'),
    platform: exactLiteral(value.platform, 'win32', 'platform'),
    architecture: exactLiteral(value.architecture, 'x64', 'architecture'),
    resourceContract: {
      maxSessionDurationMs: positiveBoundedInteger(resource.maxSessionDurationMs, 'resourceContract.maxSessionDurationMs')
    },
    adoptionContract: {
      discovery: {
        candidateSources: [
          exactLiteral(sources[0], 'process-path-untrusted-hint', 'adoptionContract.discovery.candidateSources[0]'),
          exactLiteral(sources[1], 'windows-standard-location-untrusted-hint', 'adoptionContract.discovery.candidateSources[1]')
        ],
        maxPathEntries: positiveBoundedInteger(discovery.maxPathEntries, 'adoptionContract.discovery.maxPathEntries'),
        maxCandidatesPerExecutable: positiveBoundedInteger(
          discovery.maxCandidatesPerExecutable,
          'adoptionContract.discovery.maxCandidatesPerExecutable'
        ),
        maxPathBytes: positiveBoundedInteger(discovery.maxPathBytes, 'adoptionContract.discovery.maxPathBytes'),
        selection: exactLiteral(discovery.selection, 'unique-authenticated-physical-closure', 'adoptionContract.discovery.selection')
      },
      physicalClosure: {
        maxRetainedFiles: positiveBoundedInteger(physical.maxRetainedFiles, 'adoptionContract.physicalClosure.maxRetainedFiles'),
        maxObservedBytes: positiveBoundedInteger(physical.maxObservedBytes, 'adoptionContract.physicalClosure.maxObservedBytes'),
        maxPeSections: positiveBoundedInteger(physical.maxPeSections, 'adoptionContract.physicalClosure.maxPeSections'),
        maxImportedModules: positiveBoundedInteger(physical.maxImportedModules, 'adoptionContract.physicalClosure.maxImportedModules'),
        resolveSystemModules: exactLiteral(physical.resolveSystemModules, 'system32-loader-readback', 'adoptionContract.physicalClosure.resolveSystemModules'),
        runtimeProvisioning: exactLiteral(physical.runtimeProvisioning, 'forbidden', 'adoptionContract.physicalClosure.runtimeProvisioning'),
        persistentExecutableCache: exactLiteral(physical.persistentExecutableCache, 'forbidden', 'adoptionContract.physicalClosure.persistentExecutableCache')
      }
    },
    rootClosure: {
      status: exactLiteral(rootClosure.status, WINDOWS_CONTROL_CLI_ROOT_CLOSURE_STATUS, 'rootClosure.status'),
      reasonCode: exactLiteral(rootClosure.reasonCode, WINDOWS_CONTROL_CLI_ROOT_CLOSURE_REASON, 'rootClosure.reasonCode'),
      liveAvailability: exactLiteral(rootClosure.liveAvailability, 'unknown', 'rootClosure.liveAvailability'),
      positiveReceiptContract: {
        schema: exactLiteral(receipt.schema, WINDOWS_CONTROL_CLI_ROOT_CLOSURE_RECEIPT_SCHEMA, 'rootClosure.positiveReceiptContract.schema'),
        candidate: exactLiteral(receipt.candidate, 'bounded-untrusted-locator-readback', 'rootClosure.positiveReceiptContract.candidate'),
        executable: exactLiteral(receipt.executable, 'retained-exact-bytes-readback', 'rootClosure.positiveReceiptContract.executable'),
        loader: exactLiteral(receipt.loader, 'minimal-app-local-and-system-loader-readback', 'rootClosure.positiveReceiptContract.loader'),
        workingDirectory: exactLiteral(receipt.workingDirectory, 'retained-no-follow-working-directory-readback', 'rootClosure.positiveReceiptContract.workingDirectory'),
        authorization: exactLiteral(receipt.authorization, 'owner-issued-live-capability', 'rootClosure.positiveReceiptContract.authorization'),
        persistentExecutableCache: exactLiteral(receipt.persistentExecutableCache, 'forbidden', 'rootClosure.positiveReceiptContract.persistentExecutableCache')
      }
    },
    executableBindings: boundedArray(value.executableBindings, 'executableBindings', 2, 2)
      .map(parseExecutableBindingSchema)
  };
}

export function computeWindowsControlCliEnvironmentSpecDigest(
  input: WindowsControlCliEnvironmentAuthority
): `sha256:${string}` {
  return sha256(input) as `sha256:${string}`;
}

export function parseWindowsControlCliEnvironmentAuthority(
  input: unknown
): WindowsControlCliEnvironmentSpec {
  const candidate = typeof input === 'object' && input !== null && 'specDigest' in input
    ? Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'specDigest'))
    : input;
  let value: WindowsControlCliEnvironmentAuthority;
  try {
    value = parseAuthoritySchema(candidate);
  } catch (error) {
    fail(`schema validation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (value.resourceContract.maxSessionDurationMs > 120_000) {
    fail('resourceContract exceeds the bounded session envelope');
  }
  const discovery = value.adoptionContract.discovery;
  const closure = value.adoptionContract.physicalClosure;
  if (discovery.maxPathEntries > 128 || discovery.maxCandidatesPerExecutable > 16
      || discovery.maxPathBytes > 32_768 || closure.maxRetainedFiles > 64
      || closure.maxObservedBytes > 128 * 1024 * 1024
      || closure.maxPeSections > 96 || closure.maxImportedModules > 128) {
    fail('adoptionContract exceeds the bounded installed-capability envelope');
  }
  for (const [index, binding] of value.executableBindings.entries()) {
    validateExecutableBinding(binding, index);
  }
  const body = deepFreeze(value);
  return deepFreeze({
    ...body,
    specDigest: computeWindowsControlCliEnvironmentSpecDigest(body)
  });
}

function projectExecutableBinding(
  binding: WindowsControlCliExecutableBinding
): WindowsControlCliExecutableBindingProjection {
  const launcherEntries = Object.freeze(
    binding.executableEntries.filter(({ roles }) => roles.includes('launcher'))
  );
  const effectiveEntry = binding.executableEntries.find(({ roles }) => roles.includes('effective'));
  if (effectiveEntry === undefined) fail(`binding ${binding.id} has no effective executable`);
  return Object.freeze({
    id: binding.id,
    kind: binding.kind,
    version: binding.version,
    executableName: binding.executableName,
    candidateLayouts: binding.candidateLayouts,
    launcherEntries,
    effectiveEntry,
    appLocalModules: binding.appLocalModules
  });
}

export function getWindowsControlCliExecutableBinding(
  spec: WindowsControlCliEnvironmentSpec,
  id: string
): WindowsControlCliExecutableBindingProjection | null {
  const binding = spec.executableBindings.find((candidate) => candidate.id === id);
  return binding === undefined ? null : projectExecutableBinding(binding);
}

export function projectWindowsControlCliEnvironment(
  spec: WindowsControlCliEnvironmentSpec
): WindowsControlCliEnvironmentProjection {
  return Object.freeze({
    profileId: spec.profileId,
    platform: spec.platform,
    architecture: spec.architecture,
    specDigest: spec.specDigest,
    resourceBudget: Object.freeze({
      maxSessionDurationMs: spec.resourceContract.maxSessionDurationMs
    }),
    adoptionBudget: spec.adoptionContract,
    rootClosure: Object.freeze({
      status: spec.rootClosure.status,
      reasonCode: spec.rootClosure.reasonCode,
      liveAvailability: spec.rootClosure.liveAvailability,
      requiredReceiptContract: spec.rootClosure.positiveReceiptContract
    }),
    executableBindings: Object.freeze(spec.executableBindings.map(projectExecutableBinding))
  });
}

export const WINDOWS_CONTROL_CLI_ENVIRONMENT_AUTHORITY =
  parseWindowsControlCliEnvironmentAuthority(source);
export const WINDOWS_CONTROL_CLI_ENVIRONMENT_SPEC_DIGEST =
  WINDOWS_CONTROL_CLI_ENVIRONMENT_AUTHORITY.specDigest;
