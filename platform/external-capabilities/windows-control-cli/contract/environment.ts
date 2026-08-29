import { deepFreeze, sha256 } from '../../../foundation/canonical.ts';
import source from '../profile/sec-windows-control-cli-v1.json' with { type: 'json' };

export const SEC_WINDOWS_CONTROL_CLI_ENVIRONMENT_SCHEMA_V2 =
  'sec-windows-control-cli-environment-authority-v2' as const;
export const SEC_WINDOWS_CONTROL_CLI_ENVIRONMENT_SPEC_PATH_V1 =
  'platform/external-capabilities/windows-control-cli/profile/sec-windows-control-cli-v1.json' as const;
export const SEC_WINDOWS_CONTROL_CLI_PROFILE_ID_V1 = 'sec-windows-control-cli-v1' as const;
export const SEC_WINDOWS_CONTROL_CLI_SESSION_SURFACE_V1 =
  'windows-control-cli-session' as const;
export const SEC_WINDOWS_CONTROL_CLI_ROOT_CLOSURE_STATUS_V1 =
  'live-adoption-required' as const;
export const SEC_WINDOWS_CONTROL_CLI_ROOT_CLOSURE_REASON_V1 =
  'installed-executable-capability-unproven' as const;
export const SEC_WINDOWS_CONTROL_CLI_ROOT_CLOSURE_RECEIPT_SCHEMA_V1 =
  'sec-windows-control-cli-installed-adoption-receipt-v1' as const;

export type WindowsControlCliExecutableRoleV1 = 'launcher' | 'effective';
export type WindowsControlCliExecutableEntryAuthorityV1 = {
  roles: WindowsControlCliExecutableRoleV1[];
  relativePath: string;
  observedSizeBytes: number;
  observedSha256: string;
};
export type WindowsControlCliModuleEntryAuthorityV1 = {
  relativePath: string;
  observedSizeBytes: number;
  observedSha256: string;
};
export type WindowsControlCliCommandBindingV1 = {
  id: string;
  kind: 'git-for-windows' | 'github-cli';
  version: string;
  executableName: 'git.exe' | 'gh.exe';
  candidateLayouts: Array<{
    candidateRelativePath: string;
    effectiveRelativePath: string;
  }>;
  executableEntries: WindowsControlCliExecutableEntryAuthorityV1[];
  appLocalModules: WindowsControlCliModuleEntryAuthorityV1[];
  versionProbe: { args: string[]; exactFirstLine: string };
  commandContract: {
    maxArguments: number;
    maxTimeoutMs: number;
    maxStdoutBytes: number;
    maxStderrBytes: number;
  };
  endpoints?: {
    host: 'github.com';
    apiBaseUrl: 'https://api.github.com';
    graphqlUrl: 'https://api.github.com/graphql';
  };
};
export type WindowsControlCliEnvironmentAuthorityV1 = {
  schema: typeof SEC_WINDOWS_CONTROL_CLI_ENVIRONMENT_SCHEMA_V2;
  profileId: typeof SEC_WINDOWS_CONTROL_CLI_PROFILE_ID_V1;
  platform: 'win32';
  architecture: 'x64';
  resourceContract: {
    maxSessionDurationMs: number;
    maxCommandsPerSession: number;
    maxTotalOutputBytes: number;
  };
  adoptionContract: {
    discovery: {
      candidateSources: [
        'process-path-untrusted-hint',
        'windows-standard-location-untrusted-hint'
      ];
      maxPathEntries: number;
      maxCandidatesPerCommand: number;
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
    status: typeof SEC_WINDOWS_CONTROL_CLI_ROOT_CLOSURE_STATUS_V1;
    reasonCode: typeof SEC_WINDOWS_CONTROL_CLI_ROOT_CLOSURE_REASON_V1;
    liveAvailability: 'unknown';
    positiveReceiptContract: {
      schema: typeof SEC_WINDOWS_CONTROL_CLI_ROOT_CLOSURE_RECEIPT_SCHEMA_V1;
      candidate: 'bounded-untrusted-locator-readback';
      executable: 'retained-exact-bytes-version-readback';
      loader: 'minimal-app-local-and-system-loader-readback';
      workingDirectory: 'retained-no-follow-working-directory-readback';
      authorization: 'owner-issued-live-capability';
      persistentExecutableCache: 'forbidden';
    };
  };
  commandBindings: WindowsControlCliCommandBindingV1[];
};
type DeepReadonlyV1<Value> = Value extends (...args: never[]) => unknown
  ? Value
  : Value extends readonly (infer Item)[]
    ? readonly DeepReadonlyV1<Item>[]
    : Value extends object
      ? { readonly [Key in keyof Value]: DeepReadonlyV1<Value[Key]> }
      : Value;
export type WindowsControlCliExecutableEntryV1 = DeepReadonlyV1<
  WindowsControlCliCommandBindingV1['executableEntries'][number]
>;
export type WindowsControlCliAppLocalModuleV1 = DeepReadonlyV1<
  WindowsControlCliCommandBindingV1['appLocalModules'][number]
>;
export type WindowsControlCliResourceContractV1 =
  WindowsControlCliEnvironmentAuthorityV1['resourceContract'];
export type WindowsControlCliCommandContractV1 =
  WindowsControlCliCommandBindingV1['commandContract'];
export type WindowsControlCliAdoptionContractV1 =
  WindowsControlCliEnvironmentAuthorityV1['adoptionContract'];
export type WindowsControlCliRootClosureV1 =
  WindowsControlCliEnvironmentAuthorityV1['rootClosure'];
export type WindowsControlCliPositiveReceiptContractV1 = DeepReadonlyV1<
  WindowsControlCliRootClosureV1['positiveReceiptContract']
>;
export type WindowsControlCliEnvironmentSpecV1 = Readonly<
  WindowsControlCliEnvironmentAuthorityV1 & { specDigest: `sha256:${string}` }
>;

export type WindowsControlCliCommandBudgetV1 = Readonly<Pick<
  WindowsControlCliCommandContractV1,
  'maxArguments' | 'maxTimeoutMs' | 'maxStdoutBytes' | 'maxStderrBytes'
>>;
export type WindowsControlCliResourceBudgetV1 = Readonly<Pick<
  WindowsControlCliResourceContractV1,
  'maxSessionDurationMs' | 'maxCommandsPerSession' | 'maxTotalOutputBytes'
>>;
export type WindowsControlCliAdoptionBudgetV1 = DeepReadonlyV1<
  WindowsControlCliAdoptionContractV1
>;
export type WindowsControlCliBindingProjectionV1 = Readonly<{
  readonly id: WindowsControlCliCommandBindingV1['id'];
  readonly kind: WindowsControlCliCommandBindingV1['kind'];
  readonly version: string;
  readonly executableName: 'git.exe' | 'gh.exe';
  readonly candidateLayouts: DeepReadonlyV1<WindowsControlCliCommandBindingV1['candidateLayouts']>;
  readonly launcherEntries: readonly WindowsControlCliExecutableEntryV1[];
  readonly effectiveEntry: WindowsControlCliExecutableEntryV1;
  readonly appLocalModules: readonly WindowsControlCliAppLocalModuleV1[];
  readonly versionProbe: DeepReadonlyV1<WindowsControlCliCommandBindingV1['versionProbe']>;
  readonly commandBudget: WindowsControlCliCommandBudgetV1;
  readonly endpoints: DeepReadonlyV1<WindowsControlCliCommandBindingV1['endpoints']>;
}>;
export type WindowsControlCliRootClosureProjectionV1 = Readonly<{
  readonly status: WindowsControlCliRootClosureV1['status'];
  readonly reasonCode: WindowsControlCliRootClosureV1['reasonCode'];
  readonly liveAvailability: WindowsControlCliRootClosureV1['liveAvailability'];
  readonly requiredReceiptContract: WindowsControlCliPositiveReceiptContractV1;
}>;
export type WindowsControlCliEnvironmentProjectionV1 = Readonly<{
  readonly profileId: WindowsControlCliEnvironmentAuthorityV1['profileId'];
  readonly platform: WindowsControlCliEnvironmentAuthorityV1['platform'];
  readonly architecture: WindowsControlCliEnvironmentAuthorityV1['architecture'];
  readonly specDigest: `sha256:${string}`;
  readonly resourceBudget: WindowsControlCliResourceBudgetV1;
  readonly adoptionBudget: WindowsControlCliAdoptionBudgetV1;
  readonly rootClosure: WindowsControlCliRootClosureProjectionV1;
  readonly commandBindings: readonly WindowsControlCliBindingProjectionV1[];
}>;

type WindowsControlCliEnvironmentInputV1 =
  | WindowsControlCliEnvironmentAuthorityV1
  | WindowsControlCliEnvironmentSpecV1;

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

function validateCommandBinding(
  binding: WindowsControlCliCommandBindingV1,
  index: number,
  resource: WindowsControlCliResourceContractV1
): void {
  const label = `commandBindings[${index}]`;
  const expectedId = index === 0 ? 'git' : 'gh';
  const expectedKind = expectedId === 'git' ? 'git-for-windows' : 'github-cli';
  const expectedExecutable = expectedId === 'git' ? 'git.exe' : 'gh.exe';
  if (binding.id !== expectedId || binding.kind !== expectedKind
      || binding.executableName !== expectedExecutable) {
    fail(`${label} is outside the canonical command ordering and identity`);
  }
  if (binding.commandContract.maxArguments > 128
      || binding.commandContract.maxTimeoutMs > resource.maxSessionDurationMs
      || binding.commandContract.maxStdoutBytes + binding.commandContract.maxStderrBytes
        > resource.maxTotalOutputBytes) {
    fail(`${label}.commandContract exceeds the resource envelope`);
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
    if (binding.endpoints !== undefined || binding.appLocalModules.length === 0
        || !binding.version.endsWith('.windows.3')) {
      fail('Git binding must declare its installed app-local closure without GitHub endpoints');
    }
  } else if (binding.endpoints === undefined || binding.appLocalModules.length !== 0) {
    fail('GitHub CLI binding must declare canonical endpoints and no app-local modules');
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

function commandId(input: unknown, label: string): string {
  if (typeof input !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/u.test(input)) {
    schemaError(label, 'expected a canonical command id');
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
): WindowsControlCliExecutableEntryAuthorityV1 | WindowsControlCliModuleEntryAuthorityV1 {
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

function parseCommandBindingSchema(
  input: unknown,
  index: number
): WindowsControlCliCommandBindingV1 {
  const label = `commandBindings[${index}]`;
  const value = exactRecord(input, label, [
    'id', 'kind', 'version', 'executableName', 'candidateLayouts',
    'executableEntries', 'appLocalModules', 'versionProbe', 'commandContract'
  ], ['endpoints']);
  const versionProbe = exactRecord(value.versionProbe, `${label}.versionProbe`, ['args', 'exactFirstLine']);
  const commandContract = exactRecord(value.commandContract, `${label}.commandContract`, [
    'maxArguments', 'maxTimeoutMs', 'maxStdoutBytes', 'maxStderrBytes'
  ]);
  const endpoints = value.endpoints === undefined
    ? undefined
    : exactRecord(value.endpoints, `${label}.endpoints`, ['host', 'apiBaseUrl', 'graphqlUrl']);
  return {
    id: commandId(value.id, `${label}.id`),
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
      ) as WindowsControlCliExecutableEntryAuthorityV1),
    appLocalModules: boundedArray(value.appLocalModules, `${label}.appLocalModules`, 0, 32)
      .map((entry, entryIndex) => parseObservedEntry(
        entry,
        `${label}.appLocalModules[${entryIndex}]`,
        false
      ) as WindowsControlCliModuleEntryAuthorityV1),
    versionProbe: {
      args: boundedArray(versionProbe.args, `${label}.versionProbe.args`, 1, 8)
        .map((argument, argumentIndex) => boundedText(
          argument,
          `${label}.versionProbe.args[${argumentIndex}]`
        )),
      exactFirstLine: boundedText(versionProbe.exactFirstLine, `${label}.versionProbe.exactFirstLine`)
    },
    commandContract: {
      maxArguments: positiveBoundedInteger(commandContract.maxArguments, `${label}.commandContract.maxArguments`),
      maxTimeoutMs: positiveBoundedInteger(commandContract.maxTimeoutMs, `${label}.commandContract.maxTimeoutMs`),
      maxStdoutBytes: positiveBoundedInteger(commandContract.maxStdoutBytes, `${label}.commandContract.maxStdoutBytes`),
      maxStderrBytes: positiveBoundedInteger(commandContract.maxStderrBytes, `${label}.commandContract.maxStderrBytes`)
    },
    ...(endpoints === undefined ? {} : {
      endpoints: {
        host: exactLiteral(endpoints.host, 'github.com', `${label}.endpoints.host`),
        apiBaseUrl: exactLiteral(endpoints.apiBaseUrl, 'https://api.github.com', `${label}.endpoints.apiBaseUrl`),
        graphqlUrl: exactLiteral(endpoints.graphqlUrl, 'https://api.github.com/graphql', `${label}.endpoints.graphqlUrl`)
      }
    })
  };
}

function parseAuthoritySchema(input: unknown): WindowsControlCliEnvironmentAuthorityV1 {
  const value = exactRecord(input, 'root', [
    'schema', 'profileId', 'platform', 'architecture', 'resourceContract',
    'adoptionContract', 'rootClosure', 'commandBindings'
  ]);
  const resource = exactRecord(value.resourceContract, 'resourceContract', [
    'maxSessionDurationMs', 'maxCommandsPerSession', 'maxTotalOutputBytes'
  ]);
  const adoption = exactRecord(value.adoptionContract, 'adoptionContract', ['discovery', 'physicalClosure']);
  const discovery = exactRecord(adoption.discovery, 'adoptionContract.discovery', [
    'candidateSources', 'maxPathEntries', 'maxCandidatesPerCommand', 'maxPathBytes', 'selection'
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
    schema: exactLiteral(value.schema, SEC_WINDOWS_CONTROL_CLI_ENVIRONMENT_SCHEMA_V2, 'schema'),
    profileId: exactLiteral(value.profileId, SEC_WINDOWS_CONTROL_CLI_PROFILE_ID_V1, 'profileId'),
    platform: exactLiteral(value.platform, 'win32', 'platform'),
    architecture: exactLiteral(value.architecture, 'x64', 'architecture'),
    resourceContract: {
      maxSessionDurationMs: positiveBoundedInteger(resource.maxSessionDurationMs, 'resourceContract.maxSessionDurationMs'),
      maxCommandsPerSession: positiveBoundedInteger(resource.maxCommandsPerSession, 'resourceContract.maxCommandsPerSession'),
      maxTotalOutputBytes: positiveBoundedInteger(resource.maxTotalOutputBytes, 'resourceContract.maxTotalOutputBytes')
    },
    adoptionContract: {
      discovery: {
        candidateSources: [
          exactLiteral(sources[0], 'process-path-untrusted-hint', 'adoptionContract.discovery.candidateSources[0]'),
          exactLiteral(sources[1], 'windows-standard-location-untrusted-hint', 'adoptionContract.discovery.candidateSources[1]')
        ],
        maxPathEntries: positiveBoundedInteger(discovery.maxPathEntries, 'adoptionContract.discovery.maxPathEntries'),
        maxCandidatesPerCommand: positiveBoundedInteger(discovery.maxCandidatesPerCommand, 'adoptionContract.discovery.maxCandidatesPerCommand'),
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
      status: exactLiteral(rootClosure.status, SEC_WINDOWS_CONTROL_CLI_ROOT_CLOSURE_STATUS_V1, 'rootClosure.status'),
      reasonCode: exactLiteral(rootClosure.reasonCode, SEC_WINDOWS_CONTROL_CLI_ROOT_CLOSURE_REASON_V1, 'rootClosure.reasonCode'),
      liveAvailability: exactLiteral(rootClosure.liveAvailability, 'unknown', 'rootClosure.liveAvailability'),
      positiveReceiptContract: {
        schema: exactLiteral(receipt.schema, SEC_WINDOWS_CONTROL_CLI_ROOT_CLOSURE_RECEIPT_SCHEMA_V1, 'rootClosure.positiveReceiptContract.schema'),
        candidate: exactLiteral(receipt.candidate, 'bounded-untrusted-locator-readback', 'rootClosure.positiveReceiptContract.candidate'),
        executable: exactLiteral(receipt.executable, 'retained-exact-bytes-version-readback', 'rootClosure.positiveReceiptContract.executable'),
        loader: exactLiteral(receipt.loader, 'minimal-app-local-and-system-loader-readback', 'rootClosure.positiveReceiptContract.loader'),
        workingDirectory: exactLiteral(receipt.workingDirectory, 'retained-no-follow-working-directory-readback', 'rootClosure.positiveReceiptContract.workingDirectory'),
        authorization: exactLiteral(receipt.authorization, 'owner-issued-live-capability', 'rootClosure.positiveReceiptContract.authorization'),
        persistentExecutableCache: exactLiteral(receipt.persistentExecutableCache, 'forbidden', 'rootClosure.positiveReceiptContract.persistentExecutableCache')
      }
    },
    commandBindings: boundedArray(value.commandBindings, 'commandBindings', 2, 2)
      .map(parseCommandBindingSchema)
  };
}

export function computeSecWindowsControlCliEnvironmentSpecDigestV1(
  input: WindowsControlCliEnvironmentAuthorityV1
): `sha256:${string}` {
  return sha256(input) as `sha256:${string}`;
}

export function parseSecWindowsControlCliEnvironmentAuthorityV1(
  input: unknown
): WindowsControlCliEnvironmentSpecV1 {
  const candidate = typeof input === 'object' && input !== null && 'specDigest' in input
    ? Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'specDigest'))
    : input;
  let value: WindowsControlCliEnvironmentAuthorityV1;
  try {
    value = parseAuthoritySchema(candidate);
  } catch (error) {
    fail(`schema validation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (value.resourceContract.maxSessionDurationMs > 120_000
      || value.resourceContract.maxCommandsPerSession > 128
      || value.resourceContract.maxTotalOutputBytes > 16 * 1024 * 1024) {
    fail('resourceContract exceeds the bounded session envelope');
  }
  const discovery = value.adoptionContract.discovery;
  const closure = value.adoptionContract.physicalClosure;
  if (discovery.maxPathEntries > 128 || discovery.maxCandidatesPerCommand > 16
      || discovery.maxPathBytes > 32_768 || closure.maxRetainedFiles > 64
      || closure.maxObservedBytes > 128 * 1024 * 1024
      || closure.maxPeSections > 96 || closure.maxImportedModules > 128) {
    fail('adoptionContract exceeds the bounded installed-capability envelope');
  }
  for (const [index, binding] of value.commandBindings.entries()) {
    validateCommandBinding(binding, index, value.resourceContract);
  }
  const body = deepFreeze(value);
  return deepFreeze({
    ...body,
    specDigest: computeSecWindowsControlCliEnvironmentSpecDigestV1(body)
  });
}

function projectBinding(
  binding: WindowsControlCliCommandBindingV1
): WindowsControlCliBindingProjectionV1 {
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
    appLocalModules: binding.appLocalModules,
    versionProbe: binding.versionProbe,
    commandBudget: Object.freeze({
      maxArguments: binding.commandContract.maxArguments,
      maxTimeoutMs: binding.commandContract.maxTimeoutMs,
      maxStdoutBytes: binding.commandContract.maxStdoutBytes,
      maxStderrBytes: binding.commandContract.maxStderrBytes
    }),
    endpoints: binding.endpoints
  });
}

export function getSecWindowsControlCliBindingV1(
  spec: WindowsControlCliEnvironmentSpecV1,
  id: string
): WindowsControlCliBindingProjectionV1 | null {
  const binding = spec.commandBindings.find((candidate) => candidate.id === id);
  return binding === undefined ? null : projectBinding(binding);
}

export function projectSecWindowsControlCliEnvironmentV1(
  spec: WindowsControlCliEnvironmentSpecV1
): WindowsControlCliEnvironmentProjectionV1 {
  return Object.freeze({
    profileId: spec.profileId,
    platform: spec.platform,
    architecture: spec.architecture,
    specDigest: spec.specDigest,
    resourceBudget: Object.freeze({
      maxSessionDurationMs: spec.resourceContract.maxSessionDurationMs,
      maxCommandsPerSession: spec.resourceContract.maxCommandsPerSession,
      maxTotalOutputBytes: spec.resourceContract.maxTotalOutputBytes
    }),
    adoptionBudget: spec.adoptionContract,
    rootClosure: Object.freeze({
      status: spec.rootClosure.status,
      reasonCode: spec.rootClosure.reasonCode,
      liveAvailability: spec.rootClosure.liveAvailability,
      requiredReceiptContract: spec.rootClosure.positiveReceiptContract
    }),
    commandBindings: Object.freeze(spec.commandBindings.map(projectBinding))
  });
}

export const SEC_WINDOWS_CONTROL_CLI_ENVIRONMENT_AUTHORITY_V1 =
  parseSecWindowsControlCliEnvironmentAuthorityV1(source);
export const SEC_WINDOWS_CONTROL_CLI_ENVIRONMENT_SPEC_DIGEST_V1 =
  SEC_WINDOWS_CONTROL_CLI_ENVIRONMENT_AUTHORITY_V1.specDigest;
