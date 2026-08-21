import { createHash } from 'node:crypto';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { isProxy } from 'node:util/types';

import ts from 'typescript';

import { compilerRoot } from '../../platform/shared/paths.ts';

export const DEV_RUNNER_HOST_MANIFEST_MAX_BYTES = 1024 * 1024;
export const DEV_RUNNER_HOST_MODULE_MAX_COUNT = 1024;
export const DEV_RUNNER_HOST_SOURCE_MAX_BYTES = 512 * 1024;
export const DEV_RUNNER_HOST_SOURCE_TOTAL_MAX_BYTES = 8 * 1024 * 1024;

export const DEV_RUNNER_EXECUTABLE_SOURCE_EXTENSIONS = Object.freeze([
  '.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx'
] as const);

const EXECUTABLE_SOURCE_EXTENSION_SET = new Set<string>(
  DEV_RUNNER_EXECUTABLE_SOURCE_EXTENSIONS
);

export interface TrackedDevRunnerHostModule {
  readonly relativePath: string;
  readonly source: string;
  readonly sourceBytes: number;
}

export interface TrackedDevRunnerHostInventory {
  readonly modules: readonly TrackedDevRunnerHostModule[];
  readonly manifestBytes: number;
  readonly totalSourceBytes: number;
  readonly largestSourceBytes: number;
}

export interface DevRunnerPackageSurface {
  readonly relativePath: string;
  readonly value: unknown;
}

export interface DevRunnerScenarioModule {
  readonly logicalPath: string;
  readonly source: string;
}

export interface DevRunnerAuthorityScenario {
  readonly scenarioId: string;
  readonly label: string;
  readonly moduleScope: string;
  readonly commandOwnerModuleId: string;
  readonly boundedOwnerModuleId: string;
  readonly processOwnerModuleId: string;
  readonly policyOwnerModuleIds: readonly string[];
  readonly modules: readonly DevRunnerScenarioModule[];
  readonly packageSurfaces: readonly DevRunnerPackageSurface[];
  readonly expectedValidation?: 'accepted' | 'rejected';
  readonly expectedViolationCodes?: readonly string[];
}

function assertExactOrdinaryKeys(
  record: Readonly<Record<string, CanonicalOrdinaryData>>,
  expectedKeys: readonly string[],
  label: string
): void {
  const actualKeys = Object.keys(record).sort(compareCanonicalText);
  const canonicalExpectedKeys = [...expectedKeys].sort(compareCanonicalText);
  if (actualKeys.length !== canonicalExpectedKeys.length || actualKeys.some(
    (key, index) => key !== canonicalExpectedKeys[index]
  )) {
    throw new Error(
      `${label} must contain exactly [${canonicalExpectedKeys.join(', ')}].`
    );
  }
}

function assertOrdinaryKeys(
  record: Readonly<Record<string, CanonicalOrdinaryData>>,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[],
  label: string
): void {
  const actualKeys = Object.keys(record);
  const allowedKeys = new Set([...requiredKeys, ...optionalKeys]);
  const missingKeys = requiredKeys.filter((key) => !Object.hasOwn(record, key));
  const unexpectedKeys = actualKeys.filter((key) => !allowedKeys.has(key));
  if (missingKeys.length > 0 || unexpectedKeys.length > 0) {
    throw new Error(
      `${label} has invalid keys; missing [${missingKeys.sort(compareCanonicalText).join(', ')}], ` +
      `unexpected [${unexpectedKeys.sort(compareCanonicalText).join(', ')}].`
    );
  }
}

function ordinaryRecord(
  candidate: CanonicalOrdinaryData,
  label: string
): Readonly<Record<string, CanonicalOrdinaryData>> {
  if (candidate === null || Array.isArray(candidate) || typeof candidate !== 'object') {
    throw new Error(`${label} must be an ordinary record.`);
  }
  return candidate as Readonly<Record<string, CanonicalOrdinaryData>>;
}

function ordinaryArray(
  candidate: CanonicalOrdinaryData,
  label: string
): readonly CanonicalOrdinaryData[] {
  if (!Array.isArray(candidate)) throw new Error(`${label} must be an ordinary array.`);
  return candidate as readonly CanonicalOrdinaryData[];
}

function ordinaryString(candidate: CanonicalOrdinaryData | undefined, label: string): string {
  if (typeof candidate !== 'string') throw new Error(`${label} must be a string.`);
  return candidate;
}

function ordinaryNullableString(
  candidate: CanonicalOrdinaryData | undefined,
  label: string
): string | null {
  if (candidate === null) return null;
  return ordinaryString(candidate, label);
}

function ordinaryBoolean(
  candidate: CanonicalOrdinaryData | undefined,
  label: string
): boolean {
  if (typeof candidate !== 'boolean') throw new Error(`${label} must be a boolean.`);
  return candidate;
}

function ordinaryNonNegativeInteger(
  candidate: CanonicalOrdinaryData | undefined,
  label: string
): number {
  if (typeof candidate !== 'number' || !Number.isSafeInteger(candidate) || candidate < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
  return candidate;
}

function snapshotTrackedDevRunnerHostInventory(
  input: TrackedDevRunnerHostInventory
): TrackedDevRunnerHostInventory {
  const record = ordinaryRecord(snapshotOrdinaryData(
    input,
    'tracked host inventory',
    TOPOLOGY_SNAPSHOT_OPTIONS
  ), 'tracked host inventory');
  assertExactOrdinaryKeys(record, [
    'modules',
    'manifestBytes',
    'totalSourceBytes',
    'largestSourceBytes'
  ], 'tracked host inventory');
  const modules = ordinaryArray(record.modules!, 'tracked host inventory.modules')
    .map((candidate, index): TrackedDevRunnerHostModule => {
      const module = ordinaryRecord(candidate, `tracked host inventory.modules[${index}]`);
      assertExactOrdinaryKeys(
        module,
        ['relativePath', 'source', 'sourceBytes'],
        `tracked host inventory.modules[${index}]`
      );
      const source = ordinaryString(
        module.source,
        `tracked host inventory.modules[${index}].source`
      );
      const sourceBytes = ordinaryNonNegativeInteger(
        module.sourceBytes,
        `tracked host inventory.modules[${index}].sourceBytes`
      );
      if (Buffer.byteLength(source, 'utf8') !== sourceBytes) {
        throw new Error(`tracked host inventory.modules[${index}] has a stale byte count.`);
      }
      return {
        relativePath: ordinaryString(
          module.relativePath,
          `tracked host inventory.modules[${index}].relativePath`
        ),
        source,
        sourceBytes
      };
    });
  const manifestBytes = ordinaryNonNegativeInteger(
    record.manifestBytes,
    'tracked host inventory.manifestBytes'
  );
  const totalSourceBytes = ordinaryNonNegativeInteger(
    record.totalSourceBytes,
    'tracked host inventory.totalSourceBytes'
  );
  const largestSourceBytes = ordinaryNonNegativeInteger(
    record.largestSourceBytes,
    'tracked host inventory.largestSourceBytes'
  );
  if (modules.some(({ relativePath }) => !isTrackedDevRunnerProgramResource(relativePath))) {
    throw new Error('Tracked host inventory contains a non-canonical program resource path.');
  }
  if (new Set(modules.map(({ relativePath }) => relativePath)).size !== modules.length) {
    throw new Error('Tracked host inventory contains duplicate resource paths.');
  }
  if (modules.reduce((total, module) => total + module.sourceBytes, 0) !== totalSourceBytes ||
    modules.reduce((largest, module) => Math.max(largest, module.sourceBytes), 0) !==
      largestSourceBytes) {
    throw new Error('Tracked host inventory aggregate byte counts are inconsistent.');
  }
  assertDevRunnerHostBudget('tracked host path manifest', manifestBytes,
    DEV_RUNNER_HOST_MANIFEST_MAX_BYTES);
  assertDevRunnerHostBudget('tracked host module count', modules.length,
    DEV_RUNNER_HOST_MODULE_MAX_COUNT);
  assertDevRunnerHostBudget('tracked host source total', totalSourceBytes,
    DEV_RUNNER_HOST_SOURCE_TOTAL_MAX_BYTES);
  assertDevRunnerHostBudget('tracked host largest source', largestSourceBytes,
    DEV_RUNNER_HOST_SOURCE_MAX_BYTES);
  return deepFreezeOwned({
    modules,
    manifestBytes,
    totalSourceBytes,
    largestSourceBytes
  });
}

function snapshotDevRunnerAuthorityScenarios(
  input: readonly DevRunnerAuthorityScenario[],
  onPackageJsonSnapshot: () => void
): readonly DevRunnerAuthorityScenario[] {
  const candidates = ordinaryArray(snapshotOrdinaryData(
    input,
    'Program proof scenarios',
    STRICT_JSON_SNAPSHOT_OPTIONS
  ), 'Program proof scenarios');
  const scenarios = candidates.map((candidate, scenarioIndex): DevRunnerAuthorityScenario => {
    const scenario = ordinaryRecord(candidate, `Program proof scenarios[${scenarioIndex}]`);
    assertExactOrdinaryKeys(scenario, [
      'scenarioId',
      'label',
      'moduleScope',
      'commandOwnerModuleId',
      'boundedOwnerModuleId',
      'processOwnerModuleId',
      'policyOwnerModuleIds',
      'modules',
      'packageSurfaces',
      'expectedValidation',
      'expectedViolationCodes'
    ], `Program proof scenarios[${scenarioIndex}]`);
    const stringArray = (field: string): readonly string[] => ordinaryArray(
      scenario[field]!,
      `Program proof scenarios[${scenarioIndex}].${field}`
    ).map((value, index) => ordinaryString(
      value,
      `Program proof scenarios[${scenarioIndex}].${field}[${index}]`
    ));
    const modules = ordinaryArray(
      scenario.modules!,
      `Program proof scenarios[${scenarioIndex}].modules`
    ).map((moduleCandidate, moduleIndex): DevRunnerScenarioModule => {
      const module = ordinaryRecord(
        moduleCandidate,
        `Program proof scenarios[${scenarioIndex}].modules[${moduleIndex}]`
      );
      assertExactOrdinaryKeys(
        module,
        ['logicalPath', 'source'],
        `Program proof scenarios[${scenarioIndex}].modules[${moduleIndex}]`
      );
      return {
        logicalPath: ordinaryString(
          module.logicalPath,
          `Program proof scenarios[${scenarioIndex}].modules[${moduleIndex}].logicalPath`
        ),
        source: ordinaryString(
          module.source,
          `Program proof scenarios[${scenarioIndex}].modules[${moduleIndex}].source`
        )
      };
    });
    const packageSurfaces = ordinaryArray(
      scenario.packageSurfaces!,
      `Program proof scenarios[${scenarioIndex}].packageSurfaces`
    ).map((surfaceCandidate, surfaceIndex): DevRunnerPackageSurface => {
      const surface = ordinaryRecord(
        surfaceCandidate,
        `Program proof scenarios[${scenarioIndex}].packageSurfaces[${surfaceIndex}]`
      );
      assertExactOrdinaryKeys(
        surface,
        ['relativePath', 'value'],
        `Program proof scenarios[${scenarioIndex}].packageSurfaces[${surfaceIndex}]`
      );
      const value = snapshotOrdinaryData(
        surface.value,
        `Program proof scenarios[${scenarioIndex}].packageSurfaces[${surfaceIndex}].value`,
        STRICT_JSON_SNAPSHOT_OPTIONS
      );
      onPackageJsonSnapshot();
      return {
        relativePath: ordinaryString(
          surface.relativePath,
          `Program proof scenarios[${scenarioIndex}].packageSurfaces[${surfaceIndex}].relativePath`
        ),
        value
      };
    });
    const expectedValidation = Object.hasOwn(scenario, 'expectedValidation')
      ? ordinaryStringChoice(
          scenario.expectedValidation!,
          ['accepted', 'rejected'] as const,
          `Program proof scenarios[${scenarioIndex}].expectedValidation`
        )
      : undefined;
    const expectedViolationCodes = Object.hasOwn(scenario, 'expectedViolationCodes')
      ? ordinaryArray(
          scenario.expectedViolationCodes!,
          `Program proof scenarios[${scenarioIndex}].expectedViolationCodes`
        ).map((value, index) => ordinaryString(
          value,
          `Program proof scenarios[${scenarioIndex}].expectedViolationCodes[${index}]`
        ))
      : undefined;
    return {
      scenarioId: ordinaryString(
        scenario.scenarioId,
        `Program proof scenarios[${scenarioIndex}].scenarioId`
      ),
      label: ordinaryString(
        scenario.label,
        `Program proof scenarios[${scenarioIndex}].label`
      ),
      moduleScope: ordinaryString(
        scenario.moduleScope,
        `Program proof scenarios[${scenarioIndex}].moduleScope`
      ),
      commandOwnerModuleId: ordinaryString(
        scenario.commandOwnerModuleId,
        `Program proof scenarios[${scenarioIndex}].commandOwnerModuleId`
      ),
      boundedOwnerModuleId: ordinaryString(
        scenario.boundedOwnerModuleId,
        `Program proof scenarios[${scenarioIndex}].boundedOwnerModuleId`
      ),
      processOwnerModuleId: ordinaryString(
        scenario.processOwnerModuleId,
        `Program proof scenarios[${scenarioIndex}].processOwnerModuleId`
      ),
      policyOwnerModuleIds: stringArray('policyOwnerModuleIds'),
      modules,
      packageSurfaces,
      ...(expectedValidation === undefined ? {} : { expectedValidation }),
      ...(expectedViolationCodes === undefined
        ? {}
        : { expectedViolationCodes })
    };
  });
  return deepFreezeOwned(scenarios);
}

export function compareCanonicalText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

type CanonicalOrdinaryData = null | boolean | number | string |
  readonly CanonicalOrdinaryData[] |
  { readonly [key: string]: CanonicalOrdinaryData };

interface OrdinarySnapshotOptions {
  readonly rejectUndefinedObjectProperties: boolean;
}

const STRICT_JSON_SNAPSHOT_OPTIONS: OrdinarySnapshotOptions = Object.freeze({
  rejectUndefinedObjectProperties: true
});

const TOPOLOGY_SNAPSHOT_OPTIONS: OrdinarySnapshotOptions = Object.freeze({
  rejectUndefinedObjectProperties: false
});

function snapshotOrdinaryData(
  candidate: unknown,
  label: string,
  options: OrdinarySnapshotOptions,
  ancestors = new Set<object>()
): CanonicalOrdinaryData {
  if (candidate === null || typeof candidate === 'string' ||
    typeof candidate === 'boolean') return candidate;
  if (typeof candidate === 'number') {
    if (!Number.isFinite(candidate)) {
      throw new Error(`${label} contains a non-finite number.`);
    }
    return Object.is(candidate, -0) ? 0 : candidate;
  }
  if (typeof candidate !== 'object') {
    throw new Error(`${label} is not strict ordinary data.`);
  }
  if (isProxy(candidate)) {
    throw new Error(`${label} must not contain a Proxy.`);
  }
  if (ancestors.has(candidate)) {
    throw new Error(`${label} contains a cyclic ordinary-data reference.`);
  }
  ancestors.add(candidate);
  try {
    const prototype = Object.getPrototypeOf(candidate);
    const descriptors = Object.getOwnPropertyDescriptors(candidate);
    const descriptorKeys = Reflect.ownKeys(descriptors);
    if (Array.isArray(candidate)) {
      if (prototype !== Array.prototype) {
        throw new Error(`${label} must use the intrinsic Array prototype.`);
      }
      const lengthDescriptor = descriptors.length;
      if (!lengthDescriptor || 'get' in lengthDescriptor ||
        !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0) {
        throw new Error(`${label} has an invalid ordinary array length.`);
      }
      const length = lengthDescriptor.value as number;
      const result: CanonicalOrdinaryData[] = [];
      for (const key of descriptorKeys) {
        if (typeof key !== 'string') {
          throw new Error(`${label} contains a symbol-keyed array property.`);
        }
        if (key === 'length') continue;
        const index = Number(key);
        if (!Number.isSafeInteger(index) || index < 0 || String(index) !== key ||
          index >= length) {
          throw new Error(`${label} contains a non-index array property ${key}.`);
        }
      }
      for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || 'get' in descriptor || !descriptor.enumerable) {
          throw new Error(`${label} contains a sparse or accessor array element at ${index}.`);
        }
        result.push(snapshotOrdinaryData(
          descriptor.value,
          `${label}[${index}]`,
          options,
          ancestors
        ));
      }
      return result;
    }
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`${label} must use an ordinary object prototype.`);
    }
    const canonicalKeys = descriptorKeys.map((key) => {
      if (typeof key !== 'string') {
        throw new Error(`${label} contains a symbol-keyed object property.`);
      }
      return key;
    }).sort(compareCanonicalText);
    const result: Record<string, CanonicalOrdinaryData> = {};
    for (const key of canonicalKeys) {
      const descriptor = descriptors[key]!;
      if ('get' in descriptor || !descriptor.enumerable) {
        throw new Error(`${label}.${key} must be an enumerable data property.`);
      }
      if (descriptor.value === undefined && !options.rejectUndefinedObjectProperties) {
        continue;
      }
      const value = snapshotOrdinaryData(
        descriptor.value,
        `${label}.${key}`,
        options,
        ancestors
      );
      Object.defineProperty(result, key, {
        value,
        enumerable: true,
        configurable: true,
        writable: true
      });
    }
    return result;
  } finally {
    ancestors.delete(candidate);
  }
}

function deepFreezeOwned<T>(candidate: T, visited = new Set<object>()): T {
  if (candidate === null || typeof candidate !== 'object' || visited.has(candidate)) {
    return candidate;
  }
  visited.add(candidate);
  for (const key of Reflect.ownKeys(candidate)) {
    const descriptor = Object.getOwnPropertyDescriptor(candidate, key)!;
    if ('value' in descriptor) deepFreezeOwned(descriptor.value, visited);
  }
  return Object.freeze(candidate);
}

function canonicalSerializeOrdinaryData(candidate: CanonicalOrdinaryData): string {
  if (candidate === null) return 'null';
  if (typeof candidate === 'boolean') return candidate ? 'true' : 'false';
  if (typeof candidate === 'number') {
    if (!Number.isFinite(candidate)) {
      throw new Error('Canonical ordinary data contains a non-finite number.');
    }
    return Object.is(candidate, -0) ? '0' : String(candidate);
  }
  if (typeof candidate === 'string') return JSON.stringify(candidate);
  const descriptors = Object.getOwnPropertyDescriptors(candidate);
  if (Array.isArray(candidate)) {
    const values: string[] = [];
    for (let index = 0; index < candidate.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !('value' in descriptor)) {
        throw new Error('Canonical ordinary array became sparse or accessor-backed.');
      }
      values.push(canonicalSerializeOrdinaryData(
        descriptor.value as CanonicalOrdinaryData
      ));
    }
    return `[${values.join(',')}]`;
  }
  const keys = Reflect.ownKeys(descriptors).map((key) => {
    if (typeof key !== 'string') {
      throw new Error('Canonical ordinary record contains a symbol key.');
    }
    return key;
  });
  const fields: string[] = [];
  for (const key of keys) {
    const descriptor = descriptors[key]!;
    if (!('value' in descriptor)) {
      throw new Error('Canonical ordinary record contains an accessor.');
    }
    fields.push(`${JSON.stringify(key)}:${canonicalSerializeOrdinaryData(
      descriptor.value as CanonicalOrdinaryData
    )}`);
  }
  return `{${fields.join(',')}}`;
}

function canonicalSnapshotBytes(candidate: unknown, label: string): string {
  return canonicalSerializeOrdinaryData(snapshotOrdinaryData(
    candidate,
    label,
    TOPOLOGY_SNAPSHOT_OPTIONS
  ));
}

function canonicalSerializeOrdinaryDataStream(
  candidate: unknown,
  write: (chunk: string) => void
): void {
  if (candidate === null) {
    write('null');
    return;
  }
  if (typeof candidate === 'boolean') {
    write(candidate ? 'true' : 'false');
    return;
  }
  if (typeof candidate === 'number') {
    if (!Number.isFinite(candidate)) {
      throw new Error('Canonical ordinary data contains a non-finite number.');
    }
    write(Object.is(candidate, -0) ? '0' : String(candidate));
    return;
  }
  if (typeof candidate === 'string') {
    write(JSON.stringify(candidate));
    return;
  }
  const descriptors = Object.getOwnPropertyDescriptors(candidate);
  if (Array.isArray(candidate)) {
    write('[');
    for (let index = 0; index < candidate.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !('value' in descriptor)) {
        throw new Error('Canonical ordinary array became sparse or accessor-backed.');
      }
      if (index > 0) write(',');
      canonicalSerializeOrdinaryDataStream(
        descriptor.value,
        write
      );
    }
    write(']');
    return;
  }
  const keys = Reflect.ownKeys(descriptors).map((key) => {
    if (typeof key !== 'string') {
      throw new Error('Canonical ordinary record contains a symbol key.');
    }
    return key;
  });
  write('{');
  for (let index = 0; index < keys.length; index += 1) {
    const descriptor = descriptors[keys[index]!]!;
    if (!('value' in descriptor)) {
      throw new Error('Canonical ordinary record contains an accessor.');
    }
    if (index > 0) write(',');
    write(JSON.stringify(keys[index]!));
    write(':');
    canonicalSerializeOrdinaryDataStream(descriptor.value, write);
  }
  write('}');
}

function canonicalDigestBytes(candidate: unknown, label: string): string {
  const hash = createHash('sha256');
  canonicalSerializeOrdinaryDataStream(candidate, (chunk) => hash.update(chunk));
  return hash.digest('hex');
}

function finiteConstraintSemanticKey(constraint: FiniteProofConstraintInput): string {
  return canonicalSnapshotBytes(
    Object.fromEntries(Object.entries(constraint).filter(([key]) => key !== 'id')),
    `finite constraint ${constraint.id} semantic identity`
  );
}

function dedupeFiniteConstraints(
  input: readonly FiniteProofConstraintInput[]
): FiniteProofConstraintInput[] {
  const seenSemantics = new Set<string>();
  const semanticById = new Map<string, string>();
  const result: FiniteProofConstraintInput[] = [];
  for (const constraint of input) {
    const semantic = finiteConstraintSemanticKey(constraint);
    const priorSemantic = semanticById.get(constraint.id);
    if (priorSemantic !== undefined && priorSemantic !== semantic) {
      throw new Error(`Conflicting finite constraint identity ${constraint.id}.`);
    }
    semanticById.set(constraint.id, semantic);
    if (!seenSemantics.has(semantic)) {
      seenSemantics.add(semantic);
      result.push(constraint);
    }
  }
  return result;
}

function dedupeFiniteUnknownFrontiers(
  input: readonly FiniteProofUnknownFrontierInput[]
): FiniteProofUnknownFrontierInput[] {
  const bytesById = new Map<string, string>();
  const result: FiniteProofUnknownFrontierInput[] = [];
  for (const frontier of input) {
    const bytes = canonicalSnapshotBytes(frontier, `unknown frontier ${frontier.id}`);
    const prior = bytesById.get(frontier.id);
    if (prior !== undefined && prior !== bytes) {
      throw new Error(`Conflicting unknown-frontier identity ${frontier.id}.`);
    }
    if (prior === undefined) {
      bytesById.set(frontier.id, bytes);
      result.push(frontier);
    }
  }
  return result;
}

function sortedCanonical<Value>(
  values: readonly Value[],
  key: (value: Value) => string
): readonly Value[] {
  return [...values].sort((left, right) => compareCanonicalText(key(left), key(right)));
}

function canonicalSortFiniteAuthorityTopology(
  input: NormalizedFiniteAuthorityModelInput
): NormalizedFiniteAuthorityModelInput {
  return {
    ...input,
    scenarioIds: sortedCanonical(input.scenarioIds, (id) => id),
    nodes: sortedCanonical(input.nodes, (node) =>
      `${node.scenarioId}\0${node.kind}\0${node.id}`),
    constraints: sortedCanonical(input.constraints, finiteConstraintSemanticKey),
    callables: sortedCanonical(input.callables, (callable) =>
      `${callable.scenarioId}\0${callable.id}`),
    directCalls: sortedCanonical(input.directCalls, (call) =>
      `${call.scenarioId}\0${call.id}`),
    callSites: sortedCanonical(input.callSites, (site) =>
      `${site.scenarioId}\0${site.id}`),
    canonicalRoleTargets: sortedCanonical(input.canonicalRoleTargets, (target) =>
      `${target.scenarioId}\0${target.role}\0${target.callableId}`),
    executionProjection: {
      components: sortedCanonical(input.executionProjection.components, (component) =>
        `${component.scenarioId}\0${component.id}`),
      condensationEdges: sortedCanonical(
        input.executionProjection.condensationEdges,
        (edge) => `${edge.scenarioId}\0${edge.sourceComponentId}\0${edge.targetComponentId}`
      ),
      roots: sortedCanonical(input.executionProjection.roots, (root) =>
        `${root.scenarioId}\0${root.callableId}`),
      terminalIngresses: sortedCanonical(input.executionProjection.terminalIngresses, (entry) =>
        `${entry.scenarioId}\0${entry.callableId}`),
      callableSeeds: sortedCanonical(input.executionProjection.callableSeeds, (seed) =>
        `${seed.scenarioId}\0${seed.callableId}`),
      demandEdges: sortedCanonical(input.executionProjection.demandEdges, (edge) =>
        `${edge.scenarioId}\0${edge.sourceNodeKey}\0${edge.targetNodeKey}\0${edge.kind}\0` +
        `${edge.gateCallSiteId ?? ''}\0${edge.id ?? ''}`),
      externalCallbackProbes: sortedCanonical(
        input.executionProjection.externalCallbackProbes ?? [],
        (probe) => `${probe.scenarioId}\0${probe.id}`
      )
    },
    unknownFrontiers: sortedCanonical(input.unknownFrontiers, (frontier) =>
      `${frontier.scenarioId}\0${frontier.id}`),
    findings: sortedCanonical(input.findings, (finding) =>
      `${finding.scenarioId}\0${finding.id}`),
    queries: sortedCanonical(input.queries, (query) =>
      `${query.scenarioId}\0${query.id}`),
    moduleSccTopology: {
      components: sortedCanonical(input.moduleSccTopology.components, (component) =>
        `${component.scenarioId}\0${component.id}`),
      condensationEdges: sortedCanonical(
        input.moduleSccTopology.condensationEdges,
        (edge) => `${edge.scenarioId}\0${edge.sourceComponentId}\0${edge.targetComponentId}`
      ),
      starExportClosures: sortedCanonical(
        input.moduleSccTopology.starExportClosures,
        (closure) => `${closure.scenarioId}\0${closure.componentId}`
      )
    },
    classTopology: sortedCanonical(input.classTopology, (entry) =>
      `${entry.scenarioId}\0${entry.id}`)
  };
}

export function devRunnerScenarioModuleId(scenarioId: string, logicalPath: string): string {
  return scenarioId === 'live'
    ? logicalPath
    : `__contract__/scenario/${scenarioId}/${logicalPath}`;
}

export function isDevRunnerExecutableSource(relativePath: string): boolean {
  return EXECUTABLE_SOURCE_EXTENSION_SET.has(path.posix.extname(relativePath).toLowerCase()) &&
    !/\.d\.(?:c|m)?ts$/iu.test(relativePath);
}

export function isTrackedDevRunnerHostSource(relativePath: string): boolean {
  if (relativePath.includes('\\') || path.posix.normalize(relativePath) !== relativePath) {
    return false;
  }
  const [root] = relativePath.split('/');
  return (root === 'platform' || root === 'scripts') &&
    isTrackedDevRunnerProgramResource(relativePath);
}

function isTrackedDevRunnerProgramResource(relativePath: string): boolean {
  if (relativePath.length === 0 || relativePath.includes('\\') ||
    path.posix.normalize(relativePath) !== relativePath || relativePath === '..' ||
    relativePath.startsWith('../') || path.posix.isAbsolute(relativePath)) return false;
  const extension = path.posix.extname(relativePath).toLowerCase();
  return extension === '.json' || EXECUTABLE_SOURCE_EXTENSION_SET.has(extension);
}

function liveOwnerModuleIds(scenario: DevRunnerAuthorityScenario): readonly string[] {
  if (scenario.scenarioId !== 'live' || scenario.moduleScope !== '') {
    throw new Error('Tracked host closure requires the exact live scenario.');
  }
  const roots = [
    scenario.commandOwnerModuleId,
    scenario.boundedOwnerModuleId,
    scenario.processOwnerModuleId,
    ...scenario.policyOwnerModuleIds
  ].sort(compareCanonicalText);
  const unique = [...new Set(roots)];
  if (unique.some((relativePath) => !isTrackedDevRunnerHostSource(relativePath) ||
    !isDevRunnerExecutableSource(relativePath))) {
    throw new Error('Live owner module ids must be canonical tracked executable resources.');
  }
  return Object.freeze(unique);
}

function parseTrackedClosureResource(
  relativePath: string,
  source: string
): ts.SourceFile | null {
  if (path.posix.extname(relativePath).toLowerCase() === '.json') {
    try {
      JSON.parse(source);
    } catch {
      throw new Error(`Malformed tracked JSON closure resource: ${relativePath}.`);
    }
    return null;
  }
  const sourceFile = ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true);
  if (/\.d\.(?:c|m)?ts$/iu.test(relativePath)) {
    const diagnostics = (
      sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }
    ).parseDiagnostics ?? [];
    if (diagnostics.length > 0) {
      const messages = diagnostics.map(({ messageText }) =>
        ts.flattenDiagnosticMessageText(messageText, '\n')).sort(compareCanonicalText);
      throw new Error(
        `Malformed tracked declaration closure resource: ${relativePath}: ${messages.join('; ')}`
      );
    }
  }
  return sourceFile;
}

type AmbientIdentifierClassifier = (
  identifier: ts.Identifier,
  expectedName: 'module' | 'require'
) => boolean;

function directAmbientRuntimeLoader(
  expression: ts.Expression,
  isAmbientIdentifier: AmbientIdentifierClassifier
): 'require' | null {
  const value = unwrapExpression(expression);
  if (ts.isIdentifier(value) && isAmbientIdentifier(value, 'require')) return 'require';
  if (!ts.isPropertyAccessExpression(value) || value.questionDotToken !== undefined ||
    value.name.text !== 'require' || !ts.isIdentifier(value.expression) ||
    !isAmbientIdentifier(value.expression, 'module')) return null;
  return 'require';
}

function lexicalAmbientIdentifierClassifier(
  sourceFile: ts.SourceFile
): AmbientIdentifierClassifier {
  const bindingsByScope = new Map<ts.Node, Set<string>>();
  const add = (scope: ts.Node, name: string): void => {
    const bindings = bindingsByScope.get(scope) ?? new Set<string>();
    bindings.add(name);
    bindingsByScope.set(scope, bindings);
  };
  const addBindingName = (scope: ts.Node, name: ts.BindingName): void => {
    if (ts.isIdentifier(name)) {
      add(scope, name.text);
      return;
    }
    for (const element of name.elements) {
      if (!ts.isOmittedExpression(element)) addBindingName(scope, element.name);
    }
  };
  const lexicalScope = (node: ts.Node): ts.Node => {
    let current: ts.Node | undefined = node;
    while (current) {
      if (ts.isBlock(current) || ts.isCaseBlock(current) || ts.isSourceFile(current) ||
        ts.isForStatement(current) || ts.isForInStatement(current) ||
        ts.isForOfStatement(current) || ts.isCatchClause(current)) return current;
      current = current.parent;
    }
    return sourceFile;
  };
  const functionScope = (node: ts.Node): ts.Node => {
    let current: ts.Node | undefined = node;
    while (current) {
      if (ts.isFunctionLike(current) || ts.isSourceFile(current)) return current;
      current = current.parent;
    }
    return sourceFile;
  };
  const visitBindings = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node)) {
      const declarationList = ts.isVariableDeclarationList(node.parent) ? node.parent : null;
      const scope = declarationList &&
        (declarationList.flags & ts.NodeFlags.BlockScoped) === 0
        ? functionScope(node)
        : lexicalScope(node);
      addBindingName(scope, node.name);
    } else if (ts.isParameter(node) && ts.isFunctionLike(node.parent)) {
      addBindingName(node.parent, node.name);
    } else if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) ||
      ts.isEnumDeclaration(node) || ts.isModuleDeclaration(node)) && node.name) {
      const name = ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)
        ? node.name.text
        : null;
      if (name !== null) add(lexicalScope(node.parent), name);
    } else if ((ts.isFunctionExpression(node) || ts.isClassExpression(node)) && node.name) {
      add(node, node.name.text);
    } else if (ts.isImportDeclaration(node) && node.importClause &&
      !node.importClause.isTypeOnly) {
      if (node.importClause.name) add(sourceFile, node.importClause.name.text);
      const bindings = node.importClause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) add(sourceFile, bindings.name.text);
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          if (!element.isTypeOnly) add(sourceFile, element.name.text);
        }
      }
    } else if (ts.isImportEqualsDeclaration(node) && !node.isTypeOnly) {
      add(sourceFile, node.name.text);
    } else if (ts.isCatchClause(node) && node.variableDeclaration) {
      addBindingName(node, node.variableDeclaration.name);
    }
    ts.forEachChild(node, visitBindings);
  };
  visitBindings(sourceFile);
  return (identifier, expectedName) => {
    if (identifier.text !== expectedName) return false;
    let current: ts.Node | undefined = identifier;
    while (current) {
      if (bindingsByScope.get(current)?.has(expectedName)) return false;
      current = current.parent;
    }
    return true;
  };
}

function literalRuntimeSpecifiers(relativePath: string, source: string): readonly string[] {
  const sourceFile = parseTrackedClosureResource(relativePath, source);
  if (!sourceFile) return Object.freeze([]);
  const isAmbientIdentifier = lexicalAmbientIdentifierClassifier(sourceFile);
  const specifiers = new Set<string>();
  const literalText = (expression: ts.Expression | undefined): string | null =>
    expression && (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression))
      ? expression.text
      : null;
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      const specifier = literalText(node.moduleSpecifier);
      if (specifier !== null) specifiers.add(specifier);
    } else if (ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)) {
      const specifier = literalText(node.moduleReference.expression);
      if (specifier !== null) specifiers.add(specifier);
    } else if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const directLoader = directAmbientRuntimeLoader(node.expression, isAmbientIdentifier);
      if (isDynamicImport || directLoader !== null) {
        const specifier = literalText(node.arguments[0]);
        if (specifier !== null) specifiers.add(specifier);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  for (const reference of ts.preProcessFile(source, true, true).referencedFiles) {
    specifiers.add(reference.fileName);
  }
  return Object.freeze([...specifiers].sort(compareCanonicalText));
}

interface ProgramResolutionKernel {
  readonly root: string;
  readonly options: ts.CompilerOptions;
  readonly baseHost: ts.CompilerHost;
  readonly canonicalFileName: (fileName: string) => string;
  readonly resolutionCache: ts.ModuleResolutionCache;
}

function createProgramResolutionKernel(
  lifecycle?: MutableDevRunnerAnalysisLifecycle
): ProgramResolutionKernel {
  const root = path.resolve(compilerRoot);
  const configPath = path.join(root, 'tsconfig.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) {
    throw new Error(
      `Unable to parse pinned tsconfig: ${ts.flattenDiagnosticMessageText(
        config.error.messageText,
        '\n'
      )}`
    );
  }
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root, undefined, configPath);
  if (parsed.errors.length > 0) {
    throw new Error(
      `Pinned tsconfig is invalid: ${parsed.errors.map((diagnostic) =>
        ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')).join('; ')}`
    );
  }
  const options: ts.CompilerOptions = {
    ...parsed.options,
    allowJs: true,
    checkJs: false,
    incremental: false,
    noEmit: true,
    tsBuildInfoFile: undefined
  };
  if (options.module !== ts.ModuleKind.NodeNext ||
    options.moduleResolution !== ts.ModuleResolutionKind.NodeNext) {
    throw new Error('Pinned tsconfig must use the NodeNext module and resolver pair.');
  }
  const baseHost = ts.createCompilerHost(options, true);
  const canonicalFileName = (fileName: string): string =>
    baseHost.getCanonicalFileName(path.resolve(fileName));
  const resolutionCache = ts.createModuleResolutionCache(root, canonicalFileName, options);
  if (lifecycle) lifecycle.moduleResolutionCacheBuildCount += 1;
  return Object.freeze({ root, options, baseHost, canonicalFileName, resolutionCache });
}

function resolveTrackedRuntimeSpecifier(
  containingPath: string,
  specifier: string,
  trackedPaths: ReadonlySet<string>,
  trackedDirectories: ReadonlySet<string>,
  kernel: ProgramResolutionKernel
): string | null {
  if (specifier.startsWith('.')) {
    const requested = path.posix.normalize(
      path.posix.join(path.posix.dirname(containingPath), specifier)
    );
    if (requested === '..' || requested.startsWith('../') || path.posix.isAbsolute(requested)) {
      throw new Error(
        `Tracked host dependency escapes the repository root: ${containingPath} -> ${specifier}.`
      );
    }
  } else if (specifier.startsWith('node:') || specifier.startsWith('bun:')) {
    return null;
  }
  const host: ts.ModuleResolutionHost = {
    fileExists: (fileName) => {
      const absolutePath = path.resolve(fileName);
      if (!isContainedPath(kernel.root, absolutePath)) return kernel.baseHost.fileExists(fileName);
      const relativePath = path.relative(kernel.root, absolutePath);
      if (relativePath === 'node_modules' || relativePath.startsWith(`node_modules${path.sep}`)) {
        return kernel.baseHost.fileExists(fileName);
      }
      return trackedPaths.has(relativePath.split(path.sep).join('/'));
    },
    readFile: (fileName) => {
      const absolutePath = path.resolve(fileName);
      if (!isContainedPath(kernel.root, absolutePath)) return kernel.baseHost.readFile(fileName);
      const relativePath = path.relative(kernel.root, absolutePath);
      return relativePath === 'node_modules' || relativePath.startsWith(`node_modules${path.sep}`)
        ? kernel.baseHost.readFile(fileName)
        : undefined;
    },
    directoryExists: (directoryName) => {
      const absolutePath = path.resolve(directoryName);
      if (!isContainedPath(kernel.root, absolutePath)) {
        return kernel.baseHost.directoryExists?.(directoryName) === true;
      }
      const relativePath = path.relative(kernel.root, absolutePath);
      if (relativePath === 'node_modules' || relativePath.startsWith(`node_modules${path.sep}`)) {
        return kernel.baseHost.directoryExists?.(directoryName) === true;
      }
      return trackedDirectories.has(kernel.canonicalFileName(absolutePath));
    },
    realpath: (fileName) => path.resolve(fileName),
    getCurrentDirectory: () => kernel.root,
    useCaseSensitiveFileNames: kernel.baseHost.useCaseSensitiveFileNames?.() ?? true
  };
  const containingFile = path.resolve(kernel.root, ...containingPath.split('/'));
  const resolution = ts.resolveModuleName(
    specifier,
    containingFile,
    kernel.options,
    host,
    kernel.resolutionCache
  ).resolvedModule;
  if (!resolution) {
    throw new Error(`Tracked host dependency is unresolved: ${containingPath} -> ${specifier}.`);
  }
  const absoluteResolved = path.resolve(resolution.resolvedFileName);
  if (!isContainedPath(kernel.root, absoluteResolved)) return null;
  const relativeResolved = path.relative(kernel.root, absoluteResolved);
  if (relativeResolved === 'node_modules' ||
    relativeResolved.startsWith(`node_modules${path.sep}`) || resolution.isExternalLibraryImport) {
    return null;
  }
  const relativePath = relativeResolved.split(path.sep).join('/');
  if (!isTrackedDevRunnerProgramResource(relativePath) || !trackedPaths.has(relativePath)) {
    throw new Error(
      `Tracked host dependency resolved outside the tracked runtime closure: ` +
      `${containingPath} -> ${specifier} -> ${relativePath}.`
    );
  }
  return relativePath;
}

async function collectTrackedDevRunnerHostClosure(
  trackedPaths: ReadonlySet<string>,
  manifestBytes: number,
  liveScenario: DevRunnerAuthorityScenario,
  kernel: ProgramResolutionKernel,
  readSource: (relativePath: string, remainingTotalBytes: number) =>
    Promise<{ readonly source: string; readonly sourceBytes: number }>
): Promise<TrackedDevRunnerHostInventory> {
  const pending = new Set(liveOwnerModuleIds(liveScenario));
  const accepted = new Set<string>();
  const trackedDirectories = virtualDirectorySet(
    [...trackedPaths].map((relativePath) => path.resolve(
      kernel.root,
      ...relativePath.split('/')
    )),
    kernel.canonicalFileName
  );
  const modules: TrackedDevRunnerHostModule[] = [];
  let totalSourceBytes = 0;
  let largestSourceBytes = 0;
  while (pending.size > 0) {
    const relativePath = [...pending].sort(compareCanonicalText)[0]!;
    pending.delete(relativePath);
    if (accepted.has(relativePath)) continue;
    if (!trackedPaths.has(relativePath)) {
      throw new Error(`Live owner or dependency is not tracked: ${relativePath}.`);
    }
    const read = await readSource(
      relativePath,
      DEV_RUNNER_HOST_SOURCE_TOTAL_MAX_BYTES - totalSourceBytes
    );
    if (Buffer.byteLength(read.source, 'utf8') !== read.sourceBytes) {
      throw new Error(`Tracked host source changed bytes during closure read: ${relativePath}.`);
    }
    accepted.add(relativePath);
    totalSourceBytes += read.sourceBytes;
    largestSourceBytes = Math.max(largestSourceBytes, read.sourceBytes);
    modules.push({ relativePath, ...read });
    for (const specifier of literalRuntimeSpecifiers(relativePath, read.source)) {
      const dependency = resolveTrackedRuntimeSpecifier(
        relativePath,
        specifier,
        trackedPaths,
        trackedDirectories,
        kernel
      );
      if (dependency !== null && !accepted.has(dependency)) pending.add(dependency);
    }
    assertDevRunnerHostBudget(
      'tracked host module count',
      accepted.size + pending.size,
      DEV_RUNNER_HOST_MODULE_MAX_COUNT
    );
  }
  modules.sort((left, right) => compareCanonicalText(left.relativePath, right.relativePath));
  assertDevRunnerHostBudget(
    'tracked host source total',
    totalSourceBytes,
    DEV_RUNNER_HOST_SOURCE_TOTAL_MAX_BYTES
  );
  return deepFreezeOwned({ modules, manifestBytes, totalSourceBytes, largestSourceBytes });
}

export function assertDevRunnerHostBudget(
  label: string,
  actual: number,
  maximum: number
): void {
  if (!Number.isSafeInteger(actual) || actual < 0 || actual > maximum) {
    throw new Error(`${label} exceeds its byte/count budget: ${actual} > ${maximum}.`);
  }
}

function sameFileIdentity(
  left: { readonly dev: bigint; readonly ino: bigint },
  right: { readonly dev: bigint; readonly ino: bigint }
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function isContainedPath(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (
    relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
  );
}

async function readIdentityBoundSource(
  root: string,
  canonicalRoot: string,
  relativePath: string,
  remainingTotalBytes: number
): Promise<{ readonly source: string; readonly sourceBytes: number }> {
  const absolutePath = path.resolve(root, ...relativePath.split('/'));
  if (!isContainedPath(root, absolutePath)) {
    throw new Error(`Tracked host source escapes the repository root: ${relativePath}.`);
  }
  const canonicalPath = await realpath(absolutePath);
  if (!isContainedPath(canonicalRoot, canonicalPath)) {
    throw new Error(
      `Tracked host source canonical path escapes the repository root: ${relativePath}.`
    );
  }
  const beforePath = await lstat(absolutePath, { bigint: true });
  if (!beforePath.isFile() || beforePath.isSymbolicLink()) {
    throw new Error(`Tracked host source must be a regular non-symlink file: ${relativePath}.`);
  }
  if (beforePath.size > BigInt(DEV_RUNNER_HOST_SOURCE_MAX_BYTES)) {
    throw new Error(
      `tracked host source ${relativePath} exceeds its byte/count budget: ` +
      `${beforePath.size} > ${DEV_RUNNER_HOST_SOURCE_MAX_BYTES}.`
    );
  }
  if (beforePath.size > BigInt(remainingTotalBytes)) {
    throw new Error(
      `tracked host source total exceeds its byte/count budget: ` +
      `${beforePath.size} > ${remainingTotalBytes}.`
    );
  }

  const handle = await open(absolutePath, 'r');
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || !sameFileIdentity(beforePath, opened) ||
      opened.size !== beforePath.size) {
      throw new Error(`Tracked host source changed identity before read: ${relativePath}.`);
    }
    const expectedBytes = Number(opened.size);
    const accepted = Buffer.alloc(expectedBytes + 1);
    let offset = 0;
    let reachedEof = false;
    while (offset < accepted.byteLength) {
      const result = await handle.read(accepted, offset, accepted.byteLength - offset, offset);
      if (result.bytesRead === 0) {
        reachedEof = true;
        break;
      }
      offset += result.bytesRead;
    }
    if (offset > expectedBytes) {
      throw new Error(`Tracked host source produced an extra byte after fstat: ${relativePath}.`);
    }
    if (offset < expectedBytes || !reachedEof) {
      throw new Error(`Tracked host source did not reach its exact opened size: ${relativePath}.`);
    }
    const source = new TextDecoder('utf-8', { fatal: true }).decode(
      accepted.subarray(0, expectedBytes)
    );

    const afterHandle = await handle.stat({ bigint: true });
    const afterPath = await lstat(absolutePath, { bigint: true });
    const afterCanonicalPath = await realpath(absolutePath);
    if (!afterPath.isFile() || afterPath.isSymbolicLink() ||
      !sameFileIdentity(opened, afterHandle) || !sameFileIdentity(opened, afterPath) ||
      afterHandle.size !== opened.size || afterPath.size !== opened.size ||
      afterCanonicalPath !== canonicalPath) {
      throw new Error(`Tracked host source changed identity or size during read: ${relativePath}.`);
    }
    return { source, sourceBytes: expectedBytes };
  } finally {
    await handle.close();
  }
}

export async function readTrackedDevRunnerHostSources(
  liveScenario: DevRunnerAuthorityScenario,
  kernel = createProgramResolutionKernel()
): Promise<TrackedDevRunnerHostInventory> {
  const tracked = Bun.spawnSync(['git', 'ls-files', '-z'], {
    cwd: compilerRoot,
    stdout: 'pipe',
    stderr: 'pipe',
    maxBuffer: DEV_RUNNER_HOST_MANIFEST_MAX_BYTES + 1
  });
  if (tracked.exitCode !== 0) {
    throw new Error(`Unable to enumerate tracked host sources: ${tracked.stderr.toString()}`);
  }
  assertDevRunnerHostBudget(
    'tracked host path manifest',
    tracked.stdout.byteLength,
    DEV_RUNNER_HOST_MANIFEST_MAX_BYTES
  );
  const manifest = new TextDecoder('utf-8', { fatal: true }).decode(tracked.stdout);
  if (manifest.length > 0 && !manifest.endsWith('\0')) {
    throw new Error('Tracked host path manifest is not NUL terminated.');
  }
  const relativePaths = manifest.split('\0')
    .filter((relativePath) => relativePath.length > 0)
    .filter(isTrackedDevRunnerProgramResource)
    .sort(compareCanonicalText);
  if (new Set(relativePaths).size !== relativePaths.length) {
    throw new Error('Tracked host path manifest contains duplicate canonical paths.');
  }

  const root = path.resolve(compilerRoot);
  const canonicalRoot = await realpath(root);
  return collectTrackedDevRunnerHostClosure(
    new Set(relativePaths),
    tracked.stdout.byteLength,
    liveScenario,
    kernel,
    (relativePath, remainingTotalBytes) => readIdentityBoundSource(
      root,
      canonicalRoot,
      relativePath,
      remainingTotalBytes
    )
  );
}

export async function collectTrackedDevRunnerHostClosureForTests(
  candidateInventory: TrackedDevRunnerHostInventory,
  liveScenario: DevRunnerAuthorityScenario
): Promise<TrackedDevRunnerHostInventory> {
  const candidates = snapshotTrackedDevRunnerHostInventory(candidateInventory);
  const modulesByPath = new Map(candidates.modules.map((module) => [
    module.relativePath,
    module
  ] as const));
  if (modulesByPath.size !== candidates.modules.length) {
    throw new Error('Tracked host closure candidates contain duplicate paths.');
  }
  return collectTrackedDevRunnerHostClosure(
    new Set(modulesByPath.keys()),
    candidates.manifestBytes,
    liveScenario,
    createProgramResolutionKernel(),
    async (relativePath, remainingTotalBytes) => {
      const module = modulesByPath.get(relativePath);
      if (!module) throw new Error(`Tracked host closure candidate disappeared: ${relativePath}.`);
      assertDevRunnerHostBudget(
        `tracked host source ${relativePath}`,
        module.sourceBytes,
        Math.min(DEV_RUNNER_HOST_SOURCE_MAX_BYTES, remainingTotalBytes)
      );
      return { source: module.source, sourceBytes: module.sourceBytes };
    }
  );
}

declare const scenarioPartitionBrand: unique symbol;
declare const valueIdBrand: unique symbol;
declare const exportSlotIdBrand: unique symbol;
declare const callableIdBrand: unique symbol;
declare const moduleIdBrand: unique symbol;
declare const constraintIdBrand: unique symbol;
declare const callSiteIdBrand: unique symbol;
declare const queryIdBrand: unique symbol;
declare const findingIdBrand: unique symbol;
declare const unknownFrontierIdBrand: unique symbol;

export type ScenarioPartition = string & { readonly [scenarioPartitionBrand]: true };
export type ValueId = string & { readonly [valueIdBrand]: true };
export type ExportSlotId = string & { readonly [exportSlotIdBrand]: true };
export type CallableId = string & { readonly [callableIdBrand]: true };
export type ModuleId = string & { readonly [moduleIdBrand]: true };
export type ConstraintId = string & { readonly [constraintIdBrand]: true };
export type CallSiteId = string & { readonly [callSiteIdBrand]: true };
export type QueryId = string & { readonly [queryIdBrand]: true };
export type FindingId = string & { readonly [findingIdBrand]: true };
export type UnknownFrontierId = string & { readonly [unknownFrontierIdBrand]: true };

export const HandleBit = Object.freeze({
  ChildAuthority: 1 << 0,
  ExactNodeChildSpawn: 1 << 1,
  ProcessEnvironment: 1 << 2,
  ExecutableLoader: 1 << 3,
  AvailableParallelism: 1 << 4,
  PolicyAuthority: 1 << 5,
  WorkerAuthority: 1 << 6,
  RuntimeBun: 1 << 7,
  RuntimeDeno: 1 << 8,
  RuntimeProcess: 1 << 9,
  RuntimeModule: 1 << 10,
  RuntimeGlobal: 1 << 11,
  RuntimeReflect: 1 << 12,
  RuntimeObject: 1 << 13,
  RequireLoader: 1 << 14,
  ReflectGet: 1 << 15,
  ObjectAssign: 1 << 16,
  ObjectDefineProperty: 1 << 17,
  RuntimeImportMeta: 1 << 18
} as const);

export const ProtectedRoleBit = Object.freeze({
  ReviewedDevCommand: 1 << 0,
  BoundedExecutor: 1 << 1,
  SharedProcessBytes: 1 << 2,
  SharedProcessAlternative: 1 << 3,
  SensitiveAggregate: 1 << 4,
  GitChangedFileObservationOwner: 1 << 5
} as const);

export const EffectBit = Object.freeze({
  InvokesReviewedDevCommand: 1 << 0,
  InvokesBoundedExecutor: 1 << 1,
  InvokesSharedProcessBytes: 1 << 2,
  InvokesSharedProcessAlternative: 1 << 3,
  InvokesChildAuthority: 1 << 4,
  ReadsProcessEnvironment: 1 << 5,
  UsesExecutableLoader: 1 << 6,
  ReadsAvailableParallelism: 1 << 7,
  ReadsPolicyAuthority: 1 << 8,
  UsesWorkerAuthority: 1 << 9,
  UnknownProtectedExecution: 1 << 10
} as const);

export const ExecutionRootBit = Object.freeze({
  CommandOwner: 1 << 0,
  BoundedOwner: 1 << 1,
  FastTestsEntry: 1 << 2,
  ProcessOwner: 1 << 3,
  ModuleInitialization: 1 << 4
} as const);

export const CallableShapeBit = Object.freeze({
  Callable: 1 << 0,
  BoundCallable: 1 << 1,
  NonExecutingBindIntrinsic: 1 << 2,
  ExactExternalCallable: 1 << 3,
  PotentialCallable: 1 << 4
} as const);

export const ExternalContractBit = Object.freeze({
  PromiseExecutor: 1 << 0
} as const);

export const UnknownExecutionBit = Object.freeze({
  UnresolvedTarget: 1 << 0,
  UnclassifiedExternalCallback: 1 << 1,
  RuntimeModuleTarget: 1 << 2,
  OpaqueApplyArgument: 1 << 3
} as const);

type HandleBitValue = typeof HandleBit[keyof typeof HandleBit];
type ProtectedRoleBitValue = typeof ProtectedRoleBit[keyof typeof ProtectedRoleBit];
type EffectBitValue = typeof EffectBit[keyof typeof EffectBit];
type ExecutionRootBitValue = typeof ExecutionRootBit[keyof typeof ExecutionRootBit];
export type FiniteValueFactDomain = 'handle' | 'role' | 'callable-shape' |
  'external-contract' | 'unknown-execution';

const HANDLE_BITS = Object.freeze(Object.values(HandleBit).sort((left, right) => left - right));
const PROTECTED_ROLE_BITS = Object.freeze(
  Object.values(ProtectedRoleBit).sort((left, right) => left - right)
);
const EFFECT_BITS = Object.freeze(Object.values(EffectBit).sort((left, right) => left - right));
const EXECUTION_ROOT_BITS = Object.freeze(
  Object.values(ExecutionRootBit).sort((left, right) => left - right)
);
const CALLABLE_SHAPE_BITS = Object.freeze(
  Object.values(CallableShapeBit).sort((left, right) => left - right)
);
const EXTERNAL_CONTRACT_BITS = Object.freeze(
  Object.values(ExternalContractBit).sort((left, right) => left - right)
);
const UNKNOWN_EXECUTION_BITS = Object.freeze(
  Object.values(UnknownExecutionBit).sort((left, right) => left - right)
);
const VALUE_FACT_DOMAINS: readonly {
  readonly domain: FiniteValueFactDomain;
  readonly bits: readonly number[];
}[] = Object.freeze([
  Object.freeze({ domain: 'handle', bits: HANDLE_BITS }),
  Object.freeze({ domain: 'role', bits: PROTECTED_ROLE_BITS }),
  Object.freeze({ domain: 'callable-shape', bits: CALLABLE_SHAPE_BITS }),
  Object.freeze({ domain: 'external-contract', bits: EXTERNAL_CONTRACT_BITS }),
  Object.freeze({ domain: 'unknown-execution', bits: UNKNOWN_EXECUTION_BITS })
]);

export type FiniteProofNodeRef =
  | { readonly kind: 'value'; readonly id: string }
  | { readonly kind: 'export-slot'; readonly id: string };

export interface FiniteProofNodeInput {
  readonly id: string;
  readonly scenarioId: string;
  readonly kind: 'value' | 'export-slot';
  readonly handles?: number;
  readonly roles?: number;
  readonly callableShapes?: number;
  readonly externalContracts?: number;
  readonly unknownExecutions?: number;
}

interface FiniteConstraintBase {
  readonly id: string;
  readonly scenarioId: string;
}

export type FiniteProofConstraintInput =
  | (FiniteConstraintBase & {
      readonly kind: 'alias' | 'join' | 'parameter' | 'return' | 'default';
      readonly source: FiniteProofNodeRef;
      readonly target: FiniteProofNodeRef;
    })
  | (FiniteConstraintBase & {
      readonly kind: 'property-write' | 'property-read';
      readonly owner: FiniteProofNodeRef;
      readonly property: string;
      readonly source: FiniteProofNodeRef;
      readonly target: FiniteProofNodeRef;
    })
  | (FiniteConstraintBase & {
      readonly kind: 'spread';
      readonly sourceOwner: FiniteProofNodeRef;
      readonly targetOwner: FiniteProofNodeRef;
      readonly property: string;
      readonly source: FiniteProofNodeRef;
      readonly target: FiniteProofNodeRef;
    })
  | (FiniteConstraintBase & {
      readonly kind: 'export-write' | 'export-read' | 'namespace-selection';
      readonly exportName: string;
      readonly source: FiniteProofNodeRef;
      readonly target: FiniteProofNodeRef;
    })
  | (FiniteConstraintBase & {
      readonly kind: 'capability-derivation';
      readonly source: FiniteProofNodeRef;
      readonly sourceDomain: FiniteValueFactDomain;
      readonly sourceBit: number;
      readonly target: FiniteProofNodeRef;
      readonly targetDomain: FiniteValueFactDomain;
      readonly targetBit: number;
    });

export interface FiniteProofCallableInput {
  readonly id: string;
  readonly scenarioId: string;
  readonly ownerKind?: 'callable' | 'module-initializer';
  readonly terminalEffectMask?: number;
  readonly parameterNodeKeys?: readonly string[];
}

export interface FiniteProofDirectCallInput {
  readonly id: string;
  readonly scenarioId: string;
  readonly callerCallableId: string;
  readonly calleeCallableId: string;
}

export type FiniteProofCanonicalCallTarget<CallableIdentity extends string = string> =
  | {
      readonly kind: 'known';
      readonly callableIds: readonly CallableIdentity[];
    }
  | {
      readonly kind: 'known-and-unknown';
      readonly callableIds: readonly CallableIdentity[];
    }
  | {
      readonly kind: 'unknown';
    };

export interface FiniteProofCallSiteInput {
  readonly id: string;
  readonly scenarioId: string;
  readonly callee: FiniteProofNodeRef;
  readonly ownerCallableId?: string;
  readonly target?: FiniteProofCanonicalCallTarget;
  readonly directCallableId?: string;
  readonly targetCallableIds?: readonly string[];
  readonly hasUnknownTarget?: boolean;
  readonly policyRequiredClosure?: boolean;
  readonly invocationKind?: 'direct' | 'module-initialization' | 'call' | 'apply' | 'bind' |
    'reflect-apply' | 'construct' | 'other';
  readonly moduleId?: string;
  readonly location: string;
}

export type ResolvedFiniteProofCallSiteInput = FiniteProofCallSiteInput & {
  readonly target: FiniteProofCanonicalCallTarget;
  readonly policyRequiredClosure?: boolean;
};

export interface FiniteProofCanonicalRoleTargetInput {
  readonly scenarioId: string;
  readonly role: number;
  readonly callableId: string;
}

export interface FiniteProofCallSccComponentInput {
  readonly id: number;
  readonly scenarioId: string;
  readonly callableIds: readonly string[];
}

export interface FiniteProofCallSccEdgeInput {
  readonly scenarioId: string;
  readonly sourceComponentId: number;
  readonly targetComponentId: number;
}

export interface FiniteProofExecutionRootInput {
  readonly scenarioId: string;
  readonly callableId: string;
  readonly rootBit: number;
}

export interface FiniteProofTerminalIngressInput {
  readonly scenarioId: string;
  readonly callableId: string;
  readonly canonicalSelfRootBit: number;
  readonly admittedDemandRootBits: readonly number[];
}

export interface FiniteProofCallableSeedInput {
  readonly scenarioId: string;
  readonly callableId: string;
  readonly node: FiniteProofNodeRef;
}

export interface FiniteProofExecutionRootFactInput {
  readonly scenarioId: string;
  readonly callableId: string;
  readonly ownerKind: 'callable' | 'module-initializer';
  readonly rootBits: number;
}

export interface FiniteProofCallableRootApplicationInput {
  readonly scenarioId: string;
  readonly rootBit: number;
  readonly sourceNodeKey: string;
  readonly callableId: string;
}

export interface FiniteProofInvocationDemandFactInput {
  readonly scenarioId: string;
  readonly nodeKey: string;
  readonly rootBit: number;
}

export interface FiniteProofInvocationDemandEdgeInput {
  readonly id?: string;
  readonly scenarioId: string;
  readonly sourceNodeKey: string;
  readonly targetNodeKey: string;
  readonly kind: 'fixed-flow' | 'parameter' | 'return' | 'default' | 'bind' |
    'apply' | 'construct' | 'external-callback' | 'runtime-module';
  readonly gateCallSiteId?: string;
}

export interface FiniteProofInvocationDemandApplicationInput {
  readonly scenarioId: string;
  readonly rootBit: number;
  readonly sourceNodeKey: string;
  readonly targetNodeKey: string;
  readonly kind: FiniteProofInvocationDemandEdgeInput['kind'];
  readonly gateCallSiteId: string | null;
}

export interface FiniteProofExternalCallbackProbeInput {
  readonly id: string;
  readonly scenarioId: string;
  readonly argumentNodeKey: string;
  readonly callableShapeMask: number;
  readonly gateCallSiteId: string;
  readonly unknownExecutionBit: number;
}

export interface FiniteProofExecutionReceipt {
  readonly scenarioId: ScenarioPartition;
  readonly rootBit: number;
  readonly nodeKey: string;
  readonly kind: 'known-callable' | 'known-terminal' | 'external-contract' |
    'known-effect' | 'known-intrinsic' | 'unknown';
  readonly callableId: CallableId | null;
  readonly bit: number;
}

export interface FiniteProofRootEffectProjection {
  readonly scenarioId: ScenarioPartition;
  readonly rootBit: number;
  readonly effects: number;
}

export interface FiniteProofRootedCallSiteInput {
  readonly scenarioId: string;
  readonly callSiteId: string;
  readonly rootBits: number;
}

export interface FiniteProofExecutionProjectionInput {
  readonly components: readonly FiniteProofCallSccComponentInput[];
  readonly condensationEdges: readonly FiniteProofCallSccEdgeInput[];
  readonly roots: readonly FiniteProofExecutionRootInput[];
  readonly terminalIngresses: readonly FiniteProofTerminalIngressInput[];
  readonly callableSeeds: readonly FiniteProofCallableSeedInput[];
  readonly demandEdges: readonly FiniteProofInvocationDemandEdgeInput[];
  readonly externalCallbackProbes?: readonly FiniteProofExternalCallbackProbeInput[];
}

export interface FiniteProofUnknownFrontierInput {
  readonly id: string;
  readonly scenarioId: string;
  readonly operation: 'property-read' | 'property-write' | 'property-copy' |
    'executable-specifier';
  readonly moduleId?: string;
  readonly ownerCallableId?: string;
  readonly policyRequiredClosure?: boolean;
  readonly base: FiniteProofNodeRef;
  readonly source?: FiniteProofNodeRef;
  readonly target?: FiniteProofNodeRef;
  readonly code: string;
  readonly message: string;
}

export interface FiniteProofFindingInput {
  readonly id: string;
  readonly scenarioId: string;
  readonly code: string;
  readonly ownerCallableId: string | null;
  readonly subjectId: string | null;
  readonly site: string | null;
  readonly message: string;
}

export type FiniteProofQueryInput =
  | {
      readonly id: string;
      readonly scenarioId: string;
      readonly kind: 'forbid-node-fact';
      readonly node: FiniteProofNodeRef;
      readonly domain: 'handle' | 'role';
      readonly mask: number;
      readonly code: string;
      readonly message: string;
    }
  | {
      readonly id: string;
      readonly scenarioId: string;
      readonly kind: 'require-call-pair-count';
      readonly role: number;
      readonly callSiteIds: readonly string[];
      readonly expectedCount: number;
      readonly code: string;
      readonly message: string;
    }
  | {
      readonly id: string;
      readonly scenarioId: string;
      readonly kind: 'forbid-triggered-frontier';
      readonly frontierIds: readonly string[];
      readonly code: string;
      readonly message: string;
    }
  | {
      readonly id: string;
      readonly scenarioId: string;
      readonly kind: 'require-effect' | 'forbid-effect';
      readonly callableId: string;
      readonly mask: number;
      readonly code: string;
      readonly message: string;
    };

export interface FiniteProofModuleSccComponentInput {
  readonly id: number;
  readonly scenarioId: string;
  readonly moduleIds: readonly string[];
}

export interface FiniteProofModuleSccEdgeInput {
  readonly scenarioId: string;
  readonly sourceComponentId: number;
  readonly targetComponentId: number;
}

export interface FiniteProofModuleStarExportClosureInput {
  readonly componentId: number;
  readonly scenarioId: string;
  readonly exportNames: readonly string[];
}

export interface FiniteProofModuleSccTopologyInput {
  readonly components: readonly FiniteProofModuleSccComponentInput[];
  readonly condensationEdges: readonly FiniteProofModuleSccEdgeInput[];
  readonly starExportClosures: readonly FiniteProofModuleStarExportClosureInput[];
}

export interface FiniteProofClassEvaluationSiteInput {
  readonly kind: 'heritage' | 'decorator' | 'computed-name' | 'static-field' |
    'static-block' | 'constructor-body' | 'constructor-default' | 'instance-field';
  readonly ownerCallableId: string;
  readonly location: string;
}

export interface FiniteProofClassTopologyInput {
  readonly id: string;
  readonly scenarioId: string;
  readonly moduleId: string;
  readonly classValueNodeKey: string;
  readonly constructorCallableId: string;
  readonly constructorExecutionSeedNodeKey: string;
  readonly constructorParameterNodeKeys: readonly string[];
  readonly constructorDefaultNodeKeys: readonly (string | null)[];
  readonly constructorReturnNodeKey: string;
  readonly constructorKind: 'explicit' | 'implicit';
  readonly implicitSuperCallSiteId: string | null;
  readonly definitionOwnerCallableId: string;
  readonly derived: boolean;
  readonly heritageResolution: 'none' | 'exact-internal' | 'exact-external' | 'unknown';
  readonly baseClassId: string | null;
  readonly evaluationSites: readonly FiniteProofClassEvaluationSiteInput[];
}

export interface FiniteAuthorityModelInput {
  readonly scenarioIds: readonly string[];
  readonly nodes: readonly FiniteProofNodeInput[];
  readonly constraints: readonly FiniteProofConstraintInput[];
  readonly callables?: readonly FiniteProofCallableInput[];
  readonly directCalls?: readonly FiniteProofDirectCallInput[];
  readonly callSites?: readonly FiniteProofCallSiteInput[];
  readonly canonicalRoleTargets?: readonly FiniteProofCanonicalRoleTargetInput[];
  readonly executionProjection?: FiniteProofExecutionProjectionInput;
  readonly unknownFrontiers?: readonly FiniteProofUnknownFrontierInput[];
  readonly findings?: readonly FiniteProofFindingInput[];
  readonly queries?: readonly FiniteProofQueryInput[];
  readonly moduleSccTopology?: FiniteProofModuleSccTopologyInput;
  readonly classTopology?: readonly FiniteProofClassTopologyInput[];
}

export interface FiniteProofFinding {
  readonly id: FindingId;
  readonly scenarioId: ScenarioPartition;
  readonly code: string;
  readonly ownerCallableId: CallableId | null;
  readonly subjectId: string | null;
  readonly site: string | null;
  readonly message: string;
}

export interface FiniteProofFactProjection {
  readonly scenarioId: ScenarioPartition;
  readonly nodeKind: 'value' | 'export-slot';
  readonly nodeId: ValueId | ExportSlotId;
  readonly handles: number;
  readonly roles: number;
  readonly callableShapes: number;
  readonly externalContracts: number;
  readonly unknownExecutions: number;
}

export interface FiniteProofEffectProjection {
  readonly scenarioId: ScenarioPartition;
  readonly callableId: CallableId;
  readonly effects: number;
}

export interface FiniteProofTriggeredUnknownFrontier {
  readonly id: UnknownFrontierId;
  readonly scenarioId: ScenarioPartition;
  readonly operation: FiniteProofUnknownFrontierInput['operation'];
  readonly ownerCallableId: CallableId | null;
  readonly code: string;
  readonly message: string;
}

export interface FiniteProofKnownCallablePair {
  readonly scenarioId: ScenarioPartition;
  readonly callSiteId: CallSiteId;
  readonly callableId: CallableId;
}


export interface FiniteProofCallSiteProjection {
  readonly scenarioId: ScenarioPartition;
  readonly callSiteId: CallSiteId;
  readonly ownerCallableId: CallableId | null;
  readonly target: FiniteProofCanonicalCallTarget<CallableId>;
  readonly invocationKind: NonNullable<FiniteProofCallSiteInput['invocationKind']>;
  readonly executionRootBits: number;
  readonly location: string;
}

export interface FiniteProofCounters {
  readonly topologyFreezeCount: number;
  readonly graphSolveCount: number;
  readonly postSolveTopologyMutationCount: number;
  readonly arbitraryCallableFactCount: number;
  readonly arbitraryNamespaceFactCount: number;
  readonly ambientCrossProductSeedCount: number;
  readonly emittedFactCount: number;
  readonly processedFactCount: number;
  readonly processedCallProtectedPairCount: number;
  readonly processedStructuralCallablePairCount: number;
  readonly processedExportProtectedPairCount: number;
  readonly processedUnknownFrontierCount: number;
  readonly structuralUnknownCallSiteCount: number;
  readonly executionRootCount: number;
  readonly callSccCondensationEdgeCount: number;
  readonly executionRootWork: number;
  readonly executionRootFactCount: number;
  readonly callableRootApplicationCount: number;
  readonly invocationDemandFactCount: number;
  readonly invocationDemandEdgeApplicationCount: number;
  readonly rootedCallSiteCount: number;
  readonly externalCallbackProbeApplicationCount: number;
  readonly triggeredExecutionFrontierApplicationCount: number;
  readonly edgeApplicationCount: number;
  readonly ruleApplicationCount: number;
}

export interface FiniteProofBounds {
  readonly proofBitCount: number;
  readonly valueFactBitCount: number;
  readonly effectBitCount: number;
  readonly executionRootBitCount: number;
  readonly valueCount: number;
  readonly edgeCount: number;
  readonly ruleCount: number;
  readonly effectFactUpperBound: number;
  readonly callProjectionCount: number;
  readonly structuralCallablePairUpperBound: number;
  readonly structuralUnknownCallSiteUpperBound: number;
  readonly executionRootWorkUpperBound: number;
  readonly callSccCondensationEdgeUpperBound: number;
  readonly executionRootFactUpperBound: number;
  readonly callableRootApplicationUpperBound: number;
  readonly invocationDemandFactUpperBound: number;
  readonly invocationDemandEdgeApplicationUpperBound: number;
  readonly rootedCallSiteUpperBound: number;
  readonly externalCallbackProbeApplicationUpperBound: number;
  readonly executionFrontierApplicationUpperBound: number;
  readonly unknownFrontierCount: number;
  readonly atomicFactUpperBound: number;
  readonly edgeApplicationUpperBound: number;
  readonly ruleApplicationUpperBound: number;
  readonly timeScope: 'fixed-bit delta solve over canonically ordered frozen topology';
  readonly canonicalOrderingTime: 'O(N log N)';
  readonly canonicalSerializationTime: 'O(N)';
  readonly time: 'O(P * (V + E + R) + F + C + X)';
  readonly memory: 'O(words(P) * V + E + R + F + C + X)';
}

export interface FiniteProofTopologyCardinalities {
  readonly scenarioCount: number;
  readonly nodeCount: number;
  readonly flowEdgeCount: number;
  readonly derivationRuleCount: number;
  readonly callableCount: number;
  readonly directCallCount: number;
  readonly callSiteCount: number;
  readonly canonicalRoleTargetCount: number;
  readonly callSccComponentCount: number;
  readonly callSccCondensationEdgeCount: number;
  readonly executionRootCount: number;
  readonly terminalIngressCount: number;
  readonly callableSeedCount: number;
  readonly invocationDemandEdgeCount: number;
  readonly externalCallbackProbeCount: number;
  readonly unknownFrontierCount: number;
  readonly findingCount: number;
  readonly queryCount: number;
  readonly moduleSccComponentCount: number;
  readonly moduleSccCondensationEdgeCount: number;
  readonly moduleStarExportClosureCount: number;
  readonly classCount: number;
  readonly classEvaluationSiteCount: number;
}

export interface FrozenFiniteAuthorityTopology {
  readonly scenarioIds: readonly string[];
  readonly nodes: readonly FiniteProofNodeInput[];
  readonly constraints: readonly FiniteProofConstraintInput[];
  readonly callables: readonly FiniteProofCallableInput[];
  readonly directCalls: readonly FiniteProofDirectCallInput[];
  readonly callSites: readonly ResolvedFiniteProofCallSiteInput[];
  readonly canonicalRoleTargets: readonly FiniteProofCanonicalRoleTargetInput[];
  readonly executionProjection: FiniteProofExecutionProjectionInput;
  readonly unknownFrontiers: readonly FiniteProofUnknownFrontierInput[];
  readonly findings: readonly FiniteProofFindingInput[];
  readonly queries: readonly FiniteProofQueryInput[];
  readonly moduleSccTopology: FiniteProofModuleSccTopologyInput;
  readonly classTopology: readonly FiniteProofClassTopologyInput[];
  readonly cardinalities: FiniteProofTopologyCardinalities;
  readonly preSolveBounds: FiniteProofBounds;
  readonly topologyFreezeCount: number;
  readonly canonicalBytes: string;
}

export interface FrozenFiniteAuthorityProof {
  readonly facts: readonly FiniteProofFactProjection[];
  readonly effects: readonly FiniteProofEffectProjection[];
  readonly rootEffects: readonly FiniteProofRootEffectProjection[];
  readonly executionReceipts: readonly FiniteProofExecutionReceipt[];
  readonly findings: readonly FiniteProofFinding[];
  readonly knownCallablePairs: readonly FiniteProofKnownCallablePair[];
  readonly structuralCallSites: readonly FiniteProofCallSiteProjection[];
  readonly executionRootFacts: readonly FiniteProofExecutionRootFactInput[];
  readonly callableRootApplications: readonly FiniteProofCallableRootApplicationInput[];
  readonly invocationDemandFacts: readonly FiniteProofInvocationDemandFactInput[];
  readonly invocationDemandApplications:
    readonly FiniteProofInvocationDemandApplicationInput[];
  readonly rootedCallSites: readonly FiniteProofRootedCallSiteInput[];
  readonly processedCallPairs: readonly string[];
  readonly processedExportPairs: readonly string[];
  readonly processedUnknownFrontiers: readonly string[];
  readonly triggeredUnknownFrontiers: readonly FiniteProofTriggeredUnknownFrontier[];
  readonly counters: FiniteProofCounters;
  readonly bounds: FiniteProofBounds;
  readonly topologyCardinalities: FiniteProofTopologyCardinalities;
  readonly executionTopologyIdentity: string;
  readonly canonicalBytes: string;
}

interface FrozenNode {
  readonly key: string;
  readonly id: ValueId | ExportSlotId;
  readonly kind: 'value' | 'export-slot';
  readonly scenarioId: ScenarioPartition;
  readonly seedHandles: number;
  readonly seedRoles: number;
  readonly seedCallableShapes: number;
  readonly seedExternalContracts: number;
  readonly seedUnknownExecutions: number;
}

interface FrozenEdge {
  readonly id: ConstraintId;
  readonly scenarioId: ScenarioPartition;
  readonly sourceKey: string;
  readonly targetKey: string;
}

interface FrozenDerivation {
  readonly id: ConstraintId;
  readonly scenarioId: ScenarioPartition;
  readonly sourceKey: string;
  readonly sourceDomain: FiniteValueFactDomain;
  readonly sourceBit: number;
  readonly targetKey: string;
  readonly targetDomain: FiniteValueFactDomain;
  readonly targetBit: number;
}

interface FrozenInvocationDemandEdge {
  readonly id: string;
  readonly scenarioId: ScenarioPartition;
  readonly sourceNodeKey: string;
  readonly targetNodeKey: string;
  readonly kind: FiniteProofInvocationDemandEdgeInput['kind'];
  readonly gateCallSiteId: string | null;
}

interface FrozenExternalCallbackProbe {
  readonly id: string;
  readonly scenarioId: ScenarioPartition;
  readonly argumentNodeKey: string;
  readonly callableShapeMask: number;
  readonly gateCallSiteId: string;
  readonly unknownExecutionBit: number;
}

type NormalizedFiniteAuthorityModelInput = Omit<FiniteAuthorityModelInput,
  'callables' | 'directCalls' | 'callSites' | 'canonicalRoleTargets' |
  'executionProjection' | 'unknownFrontiers' | 'findings' | 'queries' |
  'moduleSccTopology' | 'classTopology'> & {
    readonly callables: readonly FiniteProofCallableInput[];
    readonly directCalls: readonly FiniteProofDirectCallInput[];
    readonly callSites: readonly ResolvedFiniteProofCallSiteInput[];
    readonly canonicalRoleTargets: readonly FiniteProofCanonicalRoleTargetInput[];
    readonly executionProjection: FiniteProofExecutionProjectionInput;
    readonly unknownFrontiers: readonly FiniteProofUnknownFrontierInput[];
    readonly findings: readonly FiniteProofFindingInput[];
    readonly queries: readonly FiniteProofQueryInput[];
    readonly moduleSccTopology: FiniteProofModuleSccTopologyInput;
    readonly classTopology: readonly FiniteProofClassTopologyInput[];
  };

function ordinaryStringChoice<Choice extends string>(
  candidate: CanonicalOrdinaryData | undefined,
  choices: readonly Choice[],
  label: string
): Choice {
  const value = ordinaryString(candidate, label);
  if (!(choices as readonly string[]).includes(value)) {
    throw new Error(`${label} must be one of [${choices.join(', ')}].`);
  }
  return value as Choice;
}

function ordinaryOptionalString(
  record: Readonly<Record<string, CanonicalOrdinaryData>>,
  key: string,
  label: string
): string | undefined {
  return Object.hasOwn(record, key)
    ? ordinaryString(record[key], `${label}.${key}`)
    : undefined;
}

function ordinaryOptionalNonNegativeInteger(
  record: Readonly<Record<string, CanonicalOrdinaryData>>,
  key: string,
  label: string
): number | undefined {
  return Object.hasOwn(record, key)
    ? ordinaryNonNegativeInteger(record[key], `${label}.${key}`)
    : undefined;
}

function ordinaryStringArray(
  candidate: CanonicalOrdinaryData | undefined,
  label: string
): readonly string[] {
  if (candidate === undefined) throw new Error(`${label} is required.`);
  return ordinaryArray(candidate, label).map((value, index) =>
    ordinaryString(value, `${label}[${index}]`));
}

function normalizeFiniteProofNodeRef(
  candidate: CanonicalOrdinaryData | undefined,
  label: string
): FiniteProofNodeRef {
  if (candidate === undefined) throw new Error(`${label} is required.`);
  const record = ordinaryRecord(candidate, label);
  assertExactOrdinaryKeys(record, ['kind', 'id'], label);
  return {
    kind: ordinaryStringChoice(record.kind, ['value', 'export-slot'] as const, `${label}.kind`),
    id: ordinaryString(record.id, `${label}.id`)
  };
}

function normalizeFiniteProofNodeInput(
  candidate: CanonicalOrdinaryData,
  label: string
): FiniteProofNodeInput {
  const record = ordinaryRecord(candidate, label);
  assertOrdinaryKeys(record, ['id', 'scenarioId', 'kind'], [
    'handles',
    'roles',
    'callableShapes',
    'externalContracts',
    'unknownExecutions'
  ], label);
  const handles = ordinaryOptionalNonNegativeInteger(record, 'handles', label);
  const roles = ordinaryOptionalNonNegativeInteger(record, 'roles', label);
  const callableShapes = ordinaryOptionalNonNegativeInteger(record, 'callableShapes', label);
  const externalContracts = ordinaryOptionalNonNegativeInteger(
    record,
    'externalContracts',
    label
  );
  const unknownExecutions = ordinaryOptionalNonNegativeInteger(
    record,
    'unknownExecutions',
    label
  );
  return {
    id: ordinaryString(record.id, `${label}.id`),
    scenarioId: ordinaryString(record.scenarioId, `${label}.scenarioId`),
    kind: ordinaryStringChoice(record.kind, ['value', 'export-slot'] as const, `${label}.kind`),
    ...(handles === undefined ? {} : { handles }),
    ...(roles === undefined ? {} : { roles }),
    ...(callableShapes === undefined ? {} : { callableShapes }),
    ...(externalContracts === undefined ? {} : { externalContracts }),
    ...(unknownExecutions === undefined ? {} : { unknownExecutions })
  };
}

function normalizeFiniteProofConstraint(
  candidate: CanonicalOrdinaryData,
  label: string
): FiniteProofConstraintInput {
  const record = ordinaryRecord(candidate, label);
  const id = ordinaryString(record.id, `${label}.id`);
  const scenarioId = ordinaryString(record.scenarioId, `${label}.scenarioId`);
  const kind = ordinaryString(record.kind, `${label}.kind`);
  if (['alias', 'join', 'parameter', 'return', 'default'].includes(kind)) {
    assertExactOrdinaryKeys(record, ['id', 'scenarioId', 'kind', 'source', 'target'], label);
    return {
      id,
      scenarioId,
      kind: kind as 'alias' | 'join' | 'parameter' | 'return' | 'default',
      source: normalizeFiniteProofNodeRef(record.source, `${label}.source`),
      target: normalizeFiniteProofNodeRef(record.target, `${label}.target`)
    };
  }
  if (kind === 'property-write' || kind === 'property-read') {
    assertExactOrdinaryKeys(record, [
      'id', 'scenarioId', 'kind', 'owner', 'property', 'source', 'target'
    ], label);
    return {
      id,
      scenarioId,
      kind,
      owner: normalizeFiniteProofNodeRef(record.owner, `${label}.owner`),
      property: ordinaryString(record.property, `${label}.property`),
      source: normalizeFiniteProofNodeRef(record.source, `${label}.source`),
      target: normalizeFiniteProofNodeRef(record.target, `${label}.target`)
    };
  }
  if (kind === 'spread') {
    assertExactOrdinaryKeys(record, [
      'id', 'scenarioId', 'kind', 'sourceOwner', 'targetOwner', 'property', 'source', 'target'
    ], label);
    return {
      id,
      scenarioId,
      kind,
      sourceOwner: normalizeFiniteProofNodeRef(record.sourceOwner, `${label}.sourceOwner`),
      targetOwner: normalizeFiniteProofNodeRef(record.targetOwner, `${label}.targetOwner`),
      property: ordinaryString(record.property, `${label}.property`),
      source: normalizeFiniteProofNodeRef(record.source, `${label}.source`),
      target: normalizeFiniteProofNodeRef(record.target, `${label}.target`)
    };
  }
  if (kind === 'export-write' || kind === 'export-read' ||
    kind === 'namespace-selection') {
    assertExactOrdinaryKeys(record, [
      'id', 'scenarioId', 'kind', 'exportName', 'source', 'target'
    ], label);
    return {
      id,
      scenarioId,
      kind,
      exportName: ordinaryString(record.exportName, `${label}.exportName`),
      source: normalizeFiniteProofNodeRef(record.source, `${label}.source`),
      target: normalizeFiniteProofNodeRef(record.target, `${label}.target`)
    };
  }
  if (kind === 'capability-derivation') {
    assertExactOrdinaryKeys(record, [
      'id', 'scenarioId', 'kind', 'source', 'sourceDomain', 'sourceBit',
      'target', 'targetDomain', 'targetBit'
    ], label);
    const domains = [
      'handle', 'role', 'callable-shape', 'external-contract', 'unknown-execution'
    ] as const;
    return {
      id,
      scenarioId,
      kind,
      source: normalizeFiniteProofNodeRef(record.source, `${label}.source`),
      sourceDomain: ordinaryStringChoice(record.sourceDomain, domains, `${label}.sourceDomain`),
      sourceBit: ordinaryNonNegativeInteger(record.sourceBit, `${label}.sourceBit`),
      target: normalizeFiniteProofNodeRef(record.target, `${label}.target`),
      targetDomain: ordinaryStringChoice(record.targetDomain, domains, `${label}.targetDomain`),
      targetBit: ordinaryNonNegativeInteger(record.targetBit, `${label}.targetBit`)
    };
  }
  throw new Error(`${label}.kind is not a finite constraint discriminant.`);
}

function normalizeFiniteProofCallable(
  candidate: CanonicalOrdinaryData,
  label: string
): FiniteProofCallableInput {
  const record = ordinaryRecord(candidate, label);
  assertOrdinaryKeys(
    record,
    ['id', 'scenarioId'],
    ['ownerKind', 'terminalEffectMask', 'parameterNodeKeys'],
    label
  );
  const ownerKind = Object.hasOwn(record, 'ownerKind')
    ? ordinaryStringChoice(
        record.ownerKind,
        ['callable', 'module-initializer'] as const,
        `${label}.ownerKind`
      )
    : undefined;
  const terminalEffectMask = ordinaryOptionalNonNegativeInteger(
    record,
    'terminalEffectMask',
    label
  );
  const parameterNodeKeys = Object.hasOwn(record, 'parameterNodeKeys')
    ? ordinaryArray(record.parameterNodeKeys!, `${label}.parameterNodeKeys`)
        .map((value, index) =>
          ordinaryString(value, `${label}.parameterNodeKeys[${index}]`))
    : undefined;
  return {
    id: ordinaryString(record.id, `${label}.id`),
    scenarioId: ordinaryString(record.scenarioId, `${label}.scenarioId`),
    ...(ownerKind === undefined ? {} : { ownerKind }),
    ...(terminalEffectMask === undefined ? {} : { terminalEffectMask }),
    ...(parameterNodeKeys === undefined ? {} : { parameterNodeKeys })
  };
}

function normalizeFiniteProofDirectCall(
  candidate: CanonicalOrdinaryData,
  label: string
): FiniteProofDirectCallInput {
  const record = ordinaryRecord(candidate, label);
  assertExactOrdinaryKeys(
    record,
    ['id', 'scenarioId', 'callerCallableId', 'calleeCallableId'],
    label
  );
  return {
    id: ordinaryString(record.id, `${label}.id`),
    scenarioId: ordinaryString(record.scenarioId, `${label}.scenarioId`),
    callerCallableId: ordinaryString(record.callerCallableId, `${label}.callerCallableId`),
    calleeCallableId: ordinaryString(record.calleeCallableId, `${label}.calleeCallableId`)
  };
}

function normalizeFiniteProofCallSite(
  candidate: CanonicalOrdinaryData,
  label: string
): ResolvedFiniteProofCallSiteInput {
  const record = ordinaryRecord(candidate, label);
  assertOrdinaryKeys(record, ['id', 'scenarioId', 'callee', 'location'], [
    'ownerCallableId', 'invocationKind', 'moduleId', 'target',
    'directCallableId', 'targetCallableIds', 'hasUnknownTarget', 'policyRequiredClosure'
  ], label);
  const ownerCallableId = ordinaryOptionalString(record, 'ownerCallableId', label);
  const moduleId = ordinaryOptionalString(record, 'moduleId', label);
  const invocationKind = Object.hasOwn(record, 'invocationKind')
    ? ordinaryStringChoice(record.invocationKind, [
        'direct', 'module-initialization', 'call', 'apply', 'bind', 'reflect-apply',
        'construct', 'other'
      ] as const, `${label}.invocationKind`)
    : undefined;
  const policyRequiredClosure = Object.hasOwn(record, 'policyRequiredClosure')
    ? ordinaryBoolean(record.policyRequiredClosure, `${label}.policyRequiredClosure`)
    : undefined;
  let target: FiniteProofCanonicalCallTarget;
  if (Object.hasOwn(record, 'target')) {
    if (Object.hasOwn(record, 'directCallableId') ||
      Object.hasOwn(record, 'targetCallableIds') ||
      Object.hasOwn(record, 'hasUnknownTarget')) {
      throw new Error(`${label} must not mix a canonical target with flat call-target fields.`);
    }
    target = normalizeCanonicalCallTarget(record.target, `${label}.target`);
  } else {
    const directCallableId = ordinaryOptionalString(record, 'directCallableId', label);
    const targetCallableIds = Object.hasOwn(record, 'targetCallableIds')
      ? ordinaryStringArray(record.targetCallableIds, `${label}.targetCallableIds`)
      : undefined;
    const hasUnknownTarget = Object.hasOwn(record, 'hasUnknownTarget')
      ? ordinaryBoolean(record.hasUnknownTarget, `${label}.hasUnknownTarget`)
      : undefined;
    const knownIds: string[] = targetCallableIds !== undefined
      ? [...targetCallableIds]
      : (directCallableId !== undefined ? [directCallableId] : []);
    if (directCallableId !== undefined && targetCallableIds !== undefined &&
      !targetCallableIds.includes(directCallableId)) {
      throw new Error(`${label}.directCallableId must be included in targetCallableIds.`);
    }
    if (knownIds.length === 0 && hasUnknownTarget !== true) {
      throw new Error(`${label} must declare a known target or hasUnknownTarget: true.`);
    }
    target = canonicalCallTarget(knownIds, hasUnknownTarget ?? false);
  }
  return {
    id: ordinaryString(record.id, `${label}.id`),
    scenarioId: ordinaryString(record.scenarioId, `${label}.scenarioId`),
    callee: normalizeFiniteProofNodeRef(record.callee, `${label}.callee`),
    target,
    location: ordinaryString(record.location, `${label}.location`),
    ...(ownerCallableId === undefined ? {} : { ownerCallableId }),
    ...(invocationKind === undefined ? {} : { invocationKind }),
    ...(moduleId === undefined ? {} : { moduleId }),
    ...(policyRequiredClosure === undefined ? {} : { policyRequiredClosure })
  };
}

function normalizeFiniteProofCanonicalRoleTarget(
  candidate: CanonicalOrdinaryData,
  label: string
): FiniteProofCanonicalRoleTargetInput {
  const record = ordinaryRecord(candidate, label);
  assertExactOrdinaryKeys(record, ['scenarioId', 'role', 'callableId'], label);
  return {
    scenarioId: ordinaryString(record.scenarioId, `${label}.scenarioId`),
    role: ordinaryNonNegativeInteger(record.role, `${label}.role`),
    callableId: ordinaryString(record.callableId, `${label}.callableId`)
  };
}

function normalizeFiniteProofCallSccComponent(
  candidate: CanonicalOrdinaryData,
  label: string
): FiniteProofCallSccComponentInput {
  const record = ordinaryRecord(candidate, label);
  assertExactOrdinaryKeys(record, ['id', 'scenarioId', 'callableIds'], label);
  return {
    id: ordinaryNonNegativeInteger(record.id, `${label}.id`),
    scenarioId: ordinaryString(record.scenarioId, `${label}.scenarioId`),
    callableIds: ordinaryStringArray(record.callableIds, `${label}.callableIds`)
  };
}

function normalizeFiniteProofCallSccEdge(
  candidate: CanonicalOrdinaryData,
  label: string
): FiniteProofCallSccEdgeInput {
  const record = ordinaryRecord(candidate, label);
  assertExactOrdinaryKeys(
    record,
    ['scenarioId', 'sourceComponentId', 'targetComponentId'],
    label
  );
  return {
    scenarioId: ordinaryString(record.scenarioId, `${label}.scenarioId`),
    sourceComponentId: ordinaryNonNegativeInteger(
      record.sourceComponentId,
      `${label}.sourceComponentId`
    ),
    targetComponentId: ordinaryNonNegativeInteger(
      record.targetComponentId,
      `${label}.targetComponentId`
    )
  };
}

function normalizeFiniteProofExecutionRoot(
  candidate: CanonicalOrdinaryData,
  label: string
): FiniteProofExecutionRootInput {
  const record = ordinaryRecord(candidate, label);
  assertExactOrdinaryKeys(record, ['scenarioId', 'callableId', 'rootBit'], label);
  return {
    scenarioId: ordinaryString(record.scenarioId, `${label}.scenarioId`),
    callableId: ordinaryString(record.callableId, `${label}.callableId`),
    rootBit: ordinaryNonNegativeInteger(record.rootBit, `${label}.rootBit`)
  };
}

function normalizeFiniteProofTerminalIngress(
  candidate: CanonicalOrdinaryData,
  label: string
): FiniteProofTerminalIngressInput {
  const record = ordinaryRecord(candidate, label);
  assertExactOrdinaryKeys(
    record,
    ['scenarioId', 'callableId', 'canonicalSelfRootBit', 'admittedDemandRootBits'],
    label
  );
  return {
    scenarioId: ordinaryString(record.scenarioId, `${label}.scenarioId`),
    callableId: ordinaryString(record.callableId, `${label}.callableId`),
    canonicalSelfRootBit: ordinaryNonNegativeInteger(
      record.canonicalSelfRootBit,
      `${label}.canonicalSelfRootBit`
    ),
    admittedDemandRootBits: ordinaryArray(
      record.admittedDemandRootBits!,
      `${label}.admittedDemandRootBits`
    ).map((value, index) => ordinaryNonNegativeInteger(
      value,
      `${label}.admittedDemandRootBits[${index}]`
    ))
  };
}

function normalizeFiniteProofCallableSeed(
  candidate: CanonicalOrdinaryData,
  label: string
): FiniteProofCallableSeedInput {
  const record = ordinaryRecord(candidate, label);
  assertExactOrdinaryKeys(record, ['scenarioId', 'callableId', 'node'], label);
  return {
    scenarioId: ordinaryString(record.scenarioId, `${label}.scenarioId`),
    callableId: ordinaryString(record.callableId, `${label}.callableId`),
    node: normalizeFiniteProofNodeRef(record.node, `${label}.node`)
  };
}

function normalizeFiniteProofDemandEdge(
  candidate: CanonicalOrdinaryData,
  label: string
): FiniteProofInvocationDemandEdgeInput {
  const record = ordinaryRecord(candidate, label);
  assertOrdinaryKeys(record, [
    'scenarioId', 'sourceNodeKey', 'targetNodeKey', 'kind'
  ], ['id', 'gateCallSiteId'], label);
  const id = ordinaryOptionalString(record, 'id', label);
  const gateCallSiteId = ordinaryOptionalString(record, 'gateCallSiteId', label);
  return {
    scenarioId: ordinaryString(record.scenarioId, `${label}.scenarioId`),
    sourceNodeKey: ordinaryString(record.sourceNodeKey, `${label}.sourceNodeKey`),
    targetNodeKey: ordinaryString(record.targetNodeKey, `${label}.targetNodeKey`),
    kind: ordinaryStringChoice(record.kind, [
      'fixed-flow', 'parameter', 'return', 'default', 'bind', 'apply', 'construct',
      'external-callback', 'runtime-module'
    ] as const, `${label}.kind`),
    ...(id === undefined ? {} : { id }),
    ...(gateCallSiteId === undefined ? {} : { gateCallSiteId })
  };
}

function normalizeFiniteProofExternalCallbackProbe(
  candidate: CanonicalOrdinaryData,
  label: string
): FiniteProofExternalCallbackProbeInput {
  const record = ordinaryRecord(candidate, label);
  assertExactOrdinaryKeys(record, [
    'id', 'scenarioId', 'argumentNodeKey', 'callableShapeMask',
    'gateCallSiteId', 'unknownExecutionBit'
  ], label);
  return {
    id: ordinaryString(record.id, `${label}.id`),
    scenarioId: ordinaryString(record.scenarioId, `${label}.scenarioId`),
    argumentNodeKey: ordinaryString(record.argumentNodeKey, `${label}.argumentNodeKey`),
    callableShapeMask: ordinaryNonNegativeInteger(
      record.callableShapeMask,
      `${label}.callableShapeMask`
    ),
    gateCallSiteId: ordinaryString(record.gateCallSiteId, `${label}.gateCallSiteId`),
    unknownExecutionBit: ordinaryNonNegativeInteger(
      record.unknownExecutionBit,
      `${label}.unknownExecutionBit`
    )
  };
}

function normalizeFiniteProofExecutionProjection(
  candidate: CanonicalOrdinaryData | undefined,
  label: string
): FiniteProofExecutionProjectionInput {
  if (candidate === undefined) {
    return {
      components: [],
      condensationEdges: [],
      roots: [],
      terminalIngresses: [],
      callableSeeds: [],
      demandEdges: [],
      externalCallbackProbes: []
    };
  }
  const record = ordinaryRecord(candidate, label);
  assertOrdinaryKeys(record, [
    'components', 'condensationEdges', 'roots', 'terminalIngresses',
    'callableSeeds', 'demandEdges'
  ], ['externalCallbackProbes'], label);
  const array = <Value>(
    key: string,
    normalize: (entry: CanonicalOrdinaryData, entryLabel: string) => Value
  ): readonly Value[] => ordinaryArray(record[key]!, `${label}.${key}`).map(
    (entry, index) => normalize(entry, `${label}.${key}[${index}]`)
  );
  return {
    components: array('components', normalizeFiniteProofCallSccComponent),
    condensationEdges: array('condensationEdges', normalizeFiniteProofCallSccEdge),
    roots: array('roots', normalizeFiniteProofExecutionRoot),
    terminalIngresses: array('terminalIngresses', normalizeFiniteProofTerminalIngress),
    callableSeeds: array('callableSeeds', normalizeFiniteProofCallableSeed),
    demandEdges: array('demandEdges', normalizeFiniteProofDemandEdge),
    externalCallbackProbes: Object.hasOwn(record, 'externalCallbackProbes')
      ? array('externalCallbackProbes', normalizeFiniteProofExternalCallbackProbe)
      : []
  };
}

function normalizeFiniteProofUnknownFrontier(
  candidate: CanonicalOrdinaryData,
  label: string
): FiniteProofUnknownFrontierInput {
  const record = ordinaryRecord(candidate, label);
  assertOrdinaryKeys(record, [
    'id', 'scenarioId', 'operation', 'base', 'code', 'message'
  ], ['moduleId', 'ownerCallableId', 'policyRequiredClosure', 'source', 'target'], label);
  const moduleId = ordinaryOptionalString(record, 'moduleId', label);
  const ownerCallableId = ordinaryOptionalString(record, 'ownerCallableId', label);
  const policyRequiredClosure = Object.hasOwn(record, 'policyRequiredClosure')
    ? ordinaryBoolean(record.policyRequiredClosure, `${label}.policyRequiredClosure`)
    : undefined;
  return {
    id: ordinaryString(record.id, `${label}.id`),
    scenarioId: ordinaryString(record.scenarioId, `${label}.scenarioId`),
    operation: ordinaryStringChoice(
      record.operation,
      ['property-read', 'property-write', 'property-copy', 'executable-specifier'] as const,
      `${label}.operation`
    ),
    base: normalizeFiniteProofNodeRef(record.base, `${label}.base`),
    code: ordinaryString(record.code, `${label}.code`),
    message: ordinaryString(record.message, `${label}.message`),
    ...(moduleId === undefined ? {} : { moduleId }),
    ...(ownerCallableId === undefined ? {} : { ownerCallableId }),
    ...(policyRequiredClosure === undefined ? {} : { policyRequiredClosure }),
    ...(Object.hasOwn(record, 'source')
      ? { source: normalizeFiniteProofNodeRef(record.source, `${label}.source`) }
      : {}),
    ...(Object.hasOwn(record, 'target')
      ? { target: normalizeFiniteProofNodeRef(record.target, `${label}.target`) }
      : {})
  };
}

function normalizeFiniteProofFinding(
  candidate: CanonicalOrdinaryData,
  label: string
): FiniteProofFindingInput {
  const record = ordinaryRecord(candidate, label);
  assertExactOrdinaryKeys(record, [
    'id', 'scenarioId', 'code', 'ownerCallableId', 'subjectId', 'site', 'message'
  ], label);
  return {
    id: ordinaryString(record.id, `${label}.id`),
    scenarioId: ordinaryString(record.scenarioId, `${label}.scenarioId`),
    code: ordinaryString(record.code, `${label}.code`),
    ownerCallableId: ordinaryNullableString(
      record.ownerCallableId,
      `${label}.ownerCallableId`
    ),
    subjectId: ordinaryNullableString(record.subjectId, `${label}.subjectId`),
    site: ordinaryNullableString(record.site, `${label}.site`),
    message: ordinaryString(record.message, `${label}.message`)
  };
}

function normalizeFiniteProofQuery(
  candidate: CanonicalOrdinaryData,
  label: string
): FiniteProofQueryInput {
  const record = ordinaryRecord(candidate, label);
  const id = ordinaryString(record.id, `${label}.id`);
  const scenarioId = ordinaryString(record.scenarioId, `${label}.scenarioId`);
  const kind = ordinaryString(record.kind, `${label}.kind`);
  const code = ordinaryString(record.code, `${label}.code`);
  const message = ordinaryString(record.message, `${label}.message`);
  if (kind === 'forbid-node-fact') {
    assertExactOrdinaryKeys(record, [
      'id', 'scenarioId', 'kind', 'node', 'domain', 'mask', 'code', 'message'
    ], label);
    return {
      id,
      scenarioId,
      kind,
      node: normalizeFiniteProofNodeRef(record.node, `${label}.node`),
      domain: ordinaryStringChoice(record.domain, ['handle', 'role'] as const, `${label}.domain`),
      mask: ordinaryNonNegativeInteger(record.mask, `${label}.mask`),
      code,
      message
    };
  }
  if (kind === 'require-call-pair-count') {
    assertExactOrdinaryKeys(record, [
      'id', 'scenarioId', 'kind', 'role', 'callSiteIds', 'expectedCount',
      'code', 'message'
    ], label);
    return {
      id,
      scenarioId,
      kind,
      role: ordinaryNonNegativeInteger(record.role, `${label}.role`),
      callSiteIds: ordinaryStringArray(record.callSiteIds, `${label}.callSiteIds`),
      expectedCount: ordinaryNonNegativeInteger(record.expectedCount, `${label}.expectedCount`),
      code,
      message
    };
  }
  if (kind === 'forbid-triggered-frontier') {
    assertExactOrdinaryKeys(record, [
      'id', 'scenarioId', 'kind', 'frontierIds', 'code', 'message'
    ], label);
    return {
      id,
      scenarioId,
      kind,
      frontierIds: ordinaryStringArray(record.frontierIds, `${label}.frontierIds`),
      code,
      message
    };
  }
  if (kind === 'require-effect' || kind === 'forbid-effect') {
    assertExactOrdinaryKeys(record, [
      'id', 'scenarioId', 'kind', 'callableId', 'mask', 'code', 'message'
    ], label);
    return {
      id,
      scenarioId,
      kind,
      callableId: ordinaryString(record.callableId, `${label}.callableId`),
      mask: ordinaryNonNegativeInteger(record.mask, `${label}.mask`),
      code,
      message
    };
  }
  throw new Error(`${label}.kind is not a finite query discriminant.`);
}

function normalizeFiniteProofModuleSccComponent(
  candidate: CanonicalOrdinaryData,
  label: string
): FiniteProofModuleSccComponentInput {
  const record = ordinaryRecord(candidate, label);
  assertExactOrdinaryKeys(record, ['id', 'scenarioId', 'moduleIds'], label);
  return {
    id: ordinaryNonNegativeInteger(record.id, `${label}.id`),
    scenarioId: ordinaryString(record.scenarioId, `${label}.scenarioId`),
    moduleIds: ordinaryStringArray(record.moduleIds, `${label}.moduleIds`)
  };
}

function normalizeFiniteProofModuleSccEdge(
  candidate: CanonicalOrdinaryData,
  label: string
): FiniteProofModuleSccEdgeInput {
  const record = ordinaryRecord(candidate, label);
  assertExactOrdinaryKeys(
    record,
    ['scenarioId', 'sourceComponentId', 'targetComponentId'],
    label
  );
  return {
    scenarioId: ordinaryString(record.scenarioId, `${label}.scenarioId`),
    sourceComponentId: ordinaryNonNegativeInteger(
      record.sourceComponentId,
      `${label}.sourceComponentId`
    ),
    targetComponentId: ordinaryNonNegativeInteger(
      record.targetComponentId,
      `${label}.targetComponentId`
    )
  };
}

function normalizeFiniteProofModuleStarExportClosure(
  candidate: CanonicalOrdinaryData,
  label: string
): FiniteProofModuleStarExportClosureInput {
  const record = ordinaryRecord(candidate, label);
  assertExactOrdinaryKeys(record, ['componentId', 'scenarioId', 'exportNames'], label);
  return {
    componentId: ordinaryNonNegativeInteger(record.componentId, `${label}.componentId`),
    scenarioId: ordinaryString(record.scenarioId, `${label}.scenarioId`),
    exportNames: ordinaryStringArray(record.exportNames, `${label}.exportNames`)
  };
}

function normalizeFiniteProofModuleSccTopology(
  candidate: CanonicalOrdinaryData | undefined,
  label: string
): FiniteProofModuleSccTopologyInput {
  if (candidate === undefined) {
    return { components: [], condensationEdges: [], starExportClosures: [] };
  }
  const record = ordinaryRecord(candidate, label);
  assertExactOrdinaryKeys(
    record,
    ['components', 'condensationEdges', 'starExportClosures'],
    label
  );
  return {
    components: ordinaryArray(record.components!, `${label}.components`).map(
      (entry, index) => normalizeFiniteProofModuleSccComponent(
        entry,
        `${label}.components[${index}]`
      )
    ),
    condensationEdges: ordinaryArray(
      record.condensationEdges!,
      `${label}.condensationEdges`
    ).map((entry, index) => normalizeFiniteProofModuleSccEdge(
      entry,
      `${label}.condensationEdges[${index}]`
    )),
    starExportClosures: ordinaryArray(
      record.starExportClosures!,
      `${label}.starExportClosures`
    ).map((entry, index) => normalizeFiniteProofModuleStarExportClosure(
      entry,
      `${label}.starExportClosures[${index}]`
    ))
  };
}

function normalizeFiniteProofClassEvaluationSite(
  candidate: CanonicalOrdinaryData,
  label: string
): FiniteProofClassEvaluationSiteInput {
  const record = ordinaryRecord(candidate, label);
  assertExactOrdinaryKeys(record, ['kind', 'ownerCallableId', 'location'], label);
  return {
    kind: ordinaryStringChoice(record.kind, [
      'heritage', 'decorator', 'computed-name', 'static-field', 'static-block',
      'constructor-body', 'constructor-default', 'instance-field'
    ] as const, `${label}.kind`),
    ownerCallableId: ordinaryString(record.ownerCallableId, `${label}.ownerCallableId`),
    location: ordinaryString(record.location, `${label}.location`)
  };
}

function normalizeFiniteProofClassTopology(
  candidate: CanonicalOrdinaryData,
  label: string
): FiniteProofClassTopologyInput {
  const record = ordinaryRecord(candidate, label);
  assertExactOrdinaryKeys(record, [
    'id', 'scenarioId', 'moduleId', 'classValueNodeKey', 'constructorCallableId',
    'constructorExecutionSeedNodeKey', 'constructorParameterNodeKeys',
    'constructorDefaultNodeKeys', 'constructorReturnNodeKey', 'constructorKind',
    'implicitSuperCallSiteId', 'definitionOwnerCallableId', 'derived',
    'heritageResolution', 'baseClassId',
    'evaluationSites'
  ], label);
  return {
    id: ordinaryString(record.id, `${label}.id`),
    scenarioId: ordinaryString(record.scenarioId, `${label}.scenarioId`),
    moduleId: ordinaryString(record.moduleId, `${label}.moduleId`),
    classValueNodeKey: ordinaryString(record.classValueNodeKey, `${label}.classValueNodeKey`),
    constructorCallableId: ordinaryString(
      record.constructorCallableId,
      `${label}.constructorCallableId`
    ),
    constructorExecutionSeedNodeKey: ordinaryString(
      record.constructorExecutionSeedNodeKey,
      `${label}.constructorExecutionSeedNodeKey`
    ),
    constructorParameterNodeKeys: ordinaryStringArray(
      record.constructorParameterNodeKeys,
      `${label}.constructorParameterNodeKeys`
    ),
    constructorDefaultNodeKeys: ordinaryArray(
      record.constructorDefaultNodeKeys!,
      `${label}.constructorDefaultNodeKeys`
    ).map((entry, index) => ordinaryNullableString(
      entry,
      `${label}.constructorDefaultNodeKeys[${index}]`
    )),
    constructorReturnNodeKey: ordinaryString(
      record.constructorReturnNodeKey,
      `${label}.constructorReturnNodeKey`
    ),
    constructorKind: ordinaryStringChoice(
      record.constructorKind,
      ['explicit', 'implicit'] as const,
      `${label}.constructorKind`
    ),
    implicitSuperCallSiteId: ordinaryNullableString(
      record.implicitSuperCallSiteId,
      `${label}.implicitSuperCallSiteId`
    ),
    definitionOwnerCallableId: ordinaryString(
      record.definitionOwnerCallableId,
      `${label}.definitionOwnerCallableId`
    ),
    derived: ordinaryBoolean(record.derived, `${label}.derived`),
    heritageResolution: ordinaryStringChoice(record.heritageResolution, [
      'none', 'exact-internal', 'exact-external', 'unknown'
    ] as const, `${label}.heritageResolution`),
    baseClassId: ordinaryNullableString(record.baseClassId, `${label}.baseClassId`),
    evaluationSites: ordinaryArray(
      record.evaluationSites!,
      `${label}.evaluationSites`
    ).map((entry, index) => normalizeFiniteProofClassEvaluationSite(
      entry,
      `${label}.evaluationSites[${index}]`
    ))
  };
}

function normalizeFiniteAuthorityModelSnapshot(
  candidate: CanonicalOrdinaryData
): NormalizedFiniteAuthorityModelInput {
  const label = 'finite authority topology';
  const record = ordinaryRecord(candidate, label);
  assertOrdinaryKeys(record, ['scenarioIds', 'nodes', 'constraints'], [
    'callables',
    'directCalls',
    'callSites',
    'canonicalRoleTargets',
    'executionProjection',
    'unknownFrontiers',
    'findings',
    'queries',
    'moduleSccTopology',
    'classTopology'
  ], label);
  const array = <Value>(
    key: string,
    normalize: (entry: CanonicalOrdinaryData, entryLabel: string) => Value
  ): readonly Value[] => Object.hasOwn(record, key)
    ? ordinaryArray(record[key]!, `${label}.${key}`).map(
        (entry, index) => normalize(entry, `${label}.${key}[${index}]`)
      )
    : [];
  const constraints = dedupeFiniteConstraints(
    array('constraints', normalizeFiniteProofConstraint)
  );
  const unknownFrontiers = dedupeFiniteUnknownFrontiers(
    array('unknownFrontiers', normalizeFiniteProofUnknownFrontier)
  );
  return {
    scenarioIds: ordinaryStringArray(record.scenarioIds, `${label}.scenarioIds`),
    nodes: array('nodes', normalizeFiniteProofNodeInput),
    constraints,
    callables: array('callables', normalizeFiniteProofCallable),
    directCalls: array('directCalls', normalizeFiniteProofDirectCall),
    callSites: array('callSites', normalizeFiniteProofCallSite),
    canonicalRoleTargets: array(
      'canonicalRoleTargets',
      normalizeFiniteProofCanonicalRoleTarget
    ),
    executionProjection: normalizeFiniteProofExecutionProjection(
      record.executionProjection,
      `${label}.executionProjection`
    ),
    unknownFrontiers,
    findings: array('findings', normalizeFiniteProofFinding),
    queries: array('queries', normalizeFiniteProofQuery),
    moduleSccTopology: normalizeFiniteProofModuleSccTopology(
      record.moduleSccTopology,
      `${label}.moduleSccTopology`
    ),
    classTopology: array('classTopology', normalizeFiniteProofClassTopology)
  };
}

function validateFiniteAuthorityTopologyReferences(
  input: NormalizedFiniteAuthorityModelInput
): void {
  const duplicate = (kind: string, identity: string): never => {
    throw new Error(`Duplicate ${kind} identity ${identity}.`);
  };
  const scenarioIds = new Set<string>();
  for (const scenarioId of input.scenarioIds) {
    if (scenarioId.length === 0 || scenarioIds.has(scenarioId)) {
      duplicate('ScenarioPartition', scenarioId);
    }
    scenarioIds.add(scenarioId);
  }
  if (scenarioIds.size === 0) {
    throw new Error('Finite authority topology requires at least one ScenarioPartition.');
  }
  const requireScenario = (scenarioId: string, label: string): void => {
    if (!scenarioIds.has(scenarioId)) {
      throw new Error(`${label} references unknown ScenarioPartition ${scenarioId}.`);
    }
  };
  const supportedHandleMask = HANDLE_BITS.reduce((mask, bit) => mask | bit, 0);
  const supportedRoleMask = PROTECTED_ROLE_BITS.reduce((mask, bit) => mask | bit, 0);
  const supportedEffectMask = EFFECT_BITS.reduce((mask, bit) => mask | bit, 0);
  const supportedExecutionRootMask = EXECUTION_ROOT_BITS.reduce((mask, bit) => mask | bit, 0);
  const supportedCallableShapeMask = CALLABLE_SHAPE_BITS.reduce((mask, bit) => mask | bit, 0);
  const supportedExternalContractMask = EXTERNAL_CONTRACT_BITS
    .reduce((mask, bit) => mask | bit, 0);
  const supportedUnknownExecutionMask = UNKNOWN_EXECUTION_BITS
    .reduce((mask, bit) => mask | bit, 0);
  const supportedValueMask = (domain: FiniteValueFactDomain): number => {
    switch (domain) {
      case 'handle': return supportedHandleMask;
      case 'role': return supportedRoleMask;
      case 'callable-shape': return supportedCallableShapeMask;
      case 'external-contract': return supportedExternalContractMask;
      case 'unknown-execution': return supportedUnknownExecutionMask;
    }
  };
  const assertSingleBit = (value: number, supportedMask: number, label: string): void => {
    assertFixedMask(label, value, supportedMask);
    if (value === 0 || (value & (value - 1)) !== 0) {
      throw new Error(`${label} must contain exactly one fixed proof bit.`);
    }
  };

  const moduleComponents = new Map<number, FiniteProofModuleSccComponentInput>();
  const moduleScenarioById = new Map<string, string>();
  for (const component of input.moduleSccTopology.components) {
    requireScenario(component.scenarioId, `Module SCC component ${component.id}`);
    if (moduleComponents.has(component.id)) duplicate('module SCC component', String(component.id));
    if (component.moduleIds.length === 0) {
      throw new Error(`Module SCC component ${component.id} must not be empty.`);
    }
    moduleComponents.set(component.id, component);
    const localModules = new Set<string>();
    for (const moduleId of component.moduleIds) {
      if (moduleId.length === 0 || localModules.has(moduleId) || moduleScenarioById.has(moduleId)) {
        duplicate('module', moduleId);
      }
      localModules.add(moduleId);
      moduleScenarioById.set(moduleId, component.scenarioId);
    }
  }
  const moduleCondensationEdges = new Set<string>();
  for (const edge of input.moduleSccTopology.condensationEdges) {
    requireScenario(edge.scenarioId, 'Module SCC condensation edge');
    const source = moduleComponents.get(edge.sourceComponentId);
    const target = moduleComponents.get(edge.targetComponentId);
    const identity = `${edge.scenarioId}\0${edge.sourceComponentId}\0` +
      `${edge.targetComponentId}`;
    if (!source || !target || source.id === target.id ||
      source.scenarioId !== edge.scenarioId || target.scenarioId !== edge.scenarioId) {
      throw new Error(`Module SCC condensation edge ${identity} is invalid.`);
    }
    if (moduleCondensationEdges.has(identity)) duplicate('module SCC edge', identity);
    moduleCondensationEdges.add(identity);
  }
  const closureComponentIds = new Set<number>();
  for (const closure of input.moduleSccTopology.starExportClosures) {
    requireScenario(closure.scenarioId, `Module star-export closure ${closure.componentId}`);
    const component = moduleComponents.get(closure.componentId);
    if (!component || component.scenarioId !== closure.scenarioId) {
      throw new Error(
        `Module star-export closure ${closure.componentId} references an invalid component.`
      );
    }
    if (closureComponentIds.has(closure.componentId)) {
      duplicate('module star-export closure', String(closure.componentId));
    }
    closureComponentIds.add(closure.componentId);
    const exportNames = new Set<string>();
    for (const exportName of closure.exportNames) {
      if (exportNames.has(exportName)) {
        duplicate('module star-export name', `${closure.componentId}\0${exportName}`);
      }
      exportNames.add(exportName);
    }
  }
  if (closureComponentIds.size !== moduleComponents.size ||
    [...moduleComponents.keys()].some((id) => !closureComponentIds.has(id))) {
    throw new Error('Module SCC topology must own one star-export closure per component.');
  }

  const nodes = new Map<string, FiniteProofNodeInput>();
  for (const node of input.nodes) {
    requireScenario(node.scenarioId, `Finite node ${node.id}`);
    const key = nodeKey(node);
    if (nodes.has(key)) duplicate('finite node', key);
    assertFixedMask(`${key} HandleBit`, node.handles ?? 0, supportedHandleMask);
    assertFixedMask(`${key} ProtectedRoleBit`, node.roles ?? 0, supportedRoleMask);
    assertFixedMask(
      `${key} CallableShapeBit`,
      node.callableShapes ?? 0,
      supportedCallableShapeMask
    );
    assertFixedMask(
      `${key} ExternalContractBit`,
      node.externalContracts ?? 0,
      supportedExternalContractMask
    );
    assertFixedMask(
      `${key} UnknownExecutionBit`,
      node.unknownExecutions ?? 0,
      supportedUnknownExecutionMask
    );
    nodes.set(key, node);
  }
  const requireNodeKey = (
    key: string,
    scenarioId: string,
    label: string
  ): FiniteProofNodeInput => {
    const node = nodes.get(key);
    if (!node || node.scenarioId !== scenarioId) {
      throw new Error(`${label} references invalid finite node ${key}.`);
    }
    return node;
  };
  const requireNode = (
    reference: FiniteProofNodeRef,
    scenarioId: string,
    label: string
  ): FiniteProofNodeInput => requireNodeKey(nodeKey(reference), scenarioId, label);
  const requireNodeExists = (
    reference: FiniteProofNodeRef,
    label: string
  ): FiniteProofNodeInput => {
    const node = nodes.get(nodeKey(reference));
    if (!node) {
      throw new Error(`${label} references invalid finite node ${nodeKey(reference)}.`);
    }
    return node;
  };

  const constraintIds = new Set<string>();
  const constraintsBySemanticIdentity =
    new Map<string, FiniteProofConstraintInput[]>();
  for (const constraint of input.constraints) {
    requireScenario(constraint.scenarioId, `Finite constraint ${constraint.id}`);
    if (constraintIds.has(constraint.id)) duplicate('finite constraint', constraint.id);
    constraintIds.add(constraint.id);
    requireNodeExists(constraint.source, `Finite constraint ${constraint.id}`);
    requireNodeExists(constraint.target, `Finite constraint ${constraint.id}`);
    const semanticIdentity = `${constraint.scenarioId}\0${constraint.kind}\0` +
      `${nodeKey(constraint.source)}\0${nodeKey(constraint.target)}`;
    let semanticConstraints = constraintsBySemanticIdentity.get(semanticIdentity);
    if (!semanticConstraints) {
      semanticConstraints = [];
      constraintsBySemanticIdentity.set(semanticIdentity, semanticConstraints);
    }
    semanticConstraints.push(constraint);
    if (constraint.kind === 'property-read' || constraint.kind === 'property-write') {
      requireNodeExists(constraint.owner, `Finite constraint ${constraint.id}`);
    } else if (constraint.kind === 'spread') {
      requireNodeExists(constraint.sourceOwner, `Finite constraint ${constraint.id}`);
      requireNodeExists(constraint.targetOwner, `Finite constraint ${constraint.id}`);
    } else if (constraint.kind === 'capability-derivation') {
      assertSingleBit(
        constraint.sourceBit,
        supportedValueMask(constraint.sourceDomain),
        `${constraint.id} source bit`
      );
      assertSingleBit(
        constraint.targetBit,
        supportedValueMask(constraint.targetDomain),
        `${constraint.id} target bit`
      );
    }
  }

  const callables = new Map<string, FiniteProofCallableInput>();
  for (const callable of input.callables) {
    requireScenario(callable.scenarioId, `Callable ${callable.id}`);
    if (callable.id.length === 0 || callables.has(callable.id)) {
      duplicate('CallableId', callable.id);
    }
    assertFixedMask(
      `${callable.id} terminal EffectBit`,
      callable.terminalEffectMask ?? 0,
      supportedEffectMask
    );
    callables.set(callable.id, callable);
  }
  const requireCallable = (
    callableId: string,
    scenarioId: string,
    label: string
  ): FiniteProofCallableInput => {
    const callable = callables.get(callableId);
    if (!callable || callable.scenarioId !== scenarioId) {
      throw new Error(`${label} references invalid CallableId ${callableId}.`);
    }
    return callable;
  };
  const requireCallableExists = (
    callableId: string,
    label: string
  ): FiniteProofCallableInput => {
    const callable = callables.get(callableId);
    if (!callable) {
      throw new Error(`${label} references invalid CallableId ${callableId}.`);
    }
    return callable;
  };

  const directCallIds = new Set<string>();
  for (const call of input.directCalls) {
    requireScenario(call.scenarioId, `Direct call ${call.id}`);
    if (directCallIds.has(call.id)) duplicate('direct call', call.id);
    directCallIds.add(call.id);
    requireCallableExists(call.callerCallableId, `Direct call ${call.id}`);
    requireCallableExists(call.calleeCallableId, `Direct call ${call.id}`);
  }

  const callSites = new Map<string, FiniteProofCallSiteInput>();
  const callSitesByOwnerCallableId = new Map<string, FiniteProofCallSiteInput[]>();
  for (const callSite of input.callSites) {
    requireScenario(callSite.scenarioId, `Call site ${callSite.id}`);
    if (callSites.has(callSite.id)) duplicate('CallSiteId', callSite.id);
    requireNodeExists(callSite.callee, `Call site ${callSite.id}`);
    if (callSite.ownerCallableId !== undefined) {
      requireCallable(callSite.ownerCallableId, callSite.scenarioId, `Call site ${callSite.id}`);
    }
    if (callSite.moduleId !== undefined &&
      moduleScenarioById.get(callSite.moduleId) !== callSite.scenarioId) {
      throw new Error(`Call site ${callSite.id} references invalid module ${callSite.moduleId}.`);
    }
    for (const callableId of callTargetCallableIds(callSite.target)) {
      requireCallableExists(callableId, `Call site ${callSite.id}`);
    }
    callSites.set(callSite.id, callSite);
    if (callSite.ownerCallableId !== undefined) {
      let owned = callSitesByOwnerCallableId.get(callSite.ownerCallableId);
      if (!owned) {
        owned = [];
        callSitesByOwnerCallableId.set(callSite.ownerCallableId, owned);
      }
      owned.push(callSite);
    }
  }

  const roleTargets = new Set<string>();
  const roleOwners = new Set<string>();
  for (const target of input.canonicalRoleTargets) {
    requireScenario(target.scenarioId, `Canonical role target ${target.callableId}`);
    assertSingleBit(
      target.role,
      supportedRoleMask,
      `${target.callableId} canonical ProtectedRoleBit`
    );
    requireCallable(
      target.callableId,
      target.scenarioId,
      `Canonical role target ${target.callableId}`
    );
    const identity = `${target.scenarioId}\0${target.role}\0${target.callableId}`;
    const ownerIdentity = `${target.scenarioId}\0${target.role}`;
    if (roleTargets.has(identity)) duplicate('canonical role target', identity);
    if (roleOwners.has(ownerIdentity)) duplicate('canonical role owner', ownerIdentity);
    roleTargets.add(identity);
    roleOwners.add(ownerIdentity);
  }

  const execution = input.executionProjection;
  const callComponents = new Map<number, FiniteProofCallSccComponentInput>();
  const callComponentByCallableId = new Map<string, number>();
  for (const component of execution.components) {
    requireScenario(component.scenarioId, `Call SCC component ${component.id}`);
    if (callComponents.has(component.id)) duplicate('call SCC component', String(component.id));
    if (component.callableIds.length === 0) {
      throw new Error(`Call SCC component ${component.id} must not be empty.`);
    }
    callComponents.set(component.id, component);
    const localCallableIds = new Set<string>();
    for (const callableId of component.callableIds) {
      requireCallable(callableId, component.scenarioId, `Call SCC component ${component.id}`);
      if (localCallableIds.has(callableId) || callComponentByCallableId.has(callableId)) {
        duplicate('call SCC CallableId', callableId);
      }
      localCallableIds.add(callableId);
      callComponentByCallableId.set(callableId, component.id);
    }
  }
  if (callComponents.size > 0 && callComponentByCallableId.size !== callables.size) {
    throw new Error('Call SCC topology must cover every execution owner exactly once.');
  }
  const callCondensationEdges = new Set<string>();
  for (const edge of execution.condensationEdges) {
    requireScenario(edge.scenarioId, 'Call SCC condensation edge');
    const source = callComponents.get(edge.sourceComponentId);
    const target = callComponents.get(edge.targetComponentId);
    const identity = `${edge.scenarioId}\0${edge.sourceComponentId}\0` +
      `${edge.targetComponentId}`;
    if (!source || !target || source.id === target.id ||
      source.scenarioId !== edge.scenarioId || target.scenarioId !== edge.scenarioId) {
      throw new Error(`Call SCC condensation edge ${identity} is invalid.`);
    }
    if (callCondensationEdges.has(identity)) duplicate('call SCC edge', identity);
    callCondensationEdges.add(identity);
  }

  const executionRootIds = new Set<string>();
  for (const root of execution.roots) {
    requireScenario(root.scenarioId, `Execution root ${root.callableId}`);
    requireCallable(root.callableId, root.scenarioId, `Execution root ${root.callableId}`);
    assertSingleBit(root.rootBit, supportedExecutionRootMask, `${root.callableId} root bit`);
    const identity = `${root.scenarioId}\0${root.callableId}\0${root.rootBit}`;
    if (executionRootIds.has(identity)) duplicate('execution root', identity);
    executionRootIds.add(identity);
  }
  const terminalIngressIds = new Set<string>();
  for (const ingress of execution.terminalIngresses) {
    requireScenario(ingress.scenarioId, `Terminal ingress ${ingress.callableId}`);
    requireCallable(
      ingress.callableId,
      ingress.scenarioId,
      `Terminal ingress ${ingress.callableId}`
    );
    if (terminalIngressIds.has(ingress.callableId)) {
      duplicate('terminal ingress', ingress.callableId);
    }
    terminalIngressIds.add(ingress.callableId);
    assertSingleBit(
      ingress.canonicalSelfRootBit,
      supportedExecutionRootMask,
      `${ingress.callableId} canonical root bit`
    );
    const admitted = new Set<number>();
    for (const bit of ingress.admittedDemandRootBits) {
      assertSingleBit(bit, supportedExecutionRootMask, `${ingress.callableId} admitted root bit`);
      if (admitted.has(bit)) duplicate('terminal admitted root bit', `${ingress.callableId}\0${bit}`);
      admitted.add(bit);
    }
  }
  const callableSeedByCallableId = new Map<string, FiniteProofCallableSeedInput>();
  const callableSeedNodes = new Set<string>();
  for (const seed of execution.callableSeeds) {
    requireScenario(seed.scenarioId, `Callable seed ${seed.callableId}`);
    requireCallable(seed.callableId, seed.scenarioId, `Callable seed ${seed.callableId}`);
    const key = nodeKey(seed.node);
    requireNodeKey(key, seed.scenarioId, `Callable seed ${seed.callableId}`);
    if (callableSeedByCallableId.has(seed.callableId)) {
      duplicate('callable seed owner', seed.callableId);
    }
    if (callableSeedNodes.has(key)) duplicate('callable seed node', key);
    callableSeedByCallableId.set(seed.callableId, seed);
    callableSeedNodes.add(key);
  }

  const demandEdgeIds = new Set<string>();
  const demandEdgeSemanticIds = new Set<string>();
  const demandEdgesByGateCallSiteId =
    new Map<string, FiniteProofInvocationDemandEdgeInput[]>();
  for (const edge of execution.demandEdges) {
    requireScenario(edge.scenarioId, `Invocation-demand edge ${edge.id ?? ''}`);
    requireNodeKey(edge.sourceNodeKey, edge.scenarioId, `Invocation-demand edge ${edge.id ?? ''}`);
    requireNodeKey(edge.targetNodeKey, edge.scenarioId, `Invocation-demand edge ${edge.id ?? ''}`);
    const gate = edge.gateCallSiteId === undefined
      ? undefined
      : callSites.get(edge.gateCallSiteId);
    if (edge.kind === 'fixed-flow') {
      if (gate !== undefined || edge.gateCallSiteId !== undefined) {
        throw new Error(`Fixed-flow demand edge ${edge.id ?? ''} must not have a gate.`);
      }
    } else if (!gate || gate.scenarioId !== edge.scenarioId) {
      throw new Error(`Demand edge ${edge.id ?? ''} requires an exact same-scenario gate.`);
    }
    const semanticIdentity = `${edge.scenarioId}\0${edge.kind}\0${edge.sourceNodeKey}\0` +
      `${edge.targetNodeKey}\0${edge.gateCallSiteId ?? ''}`;
    const identity = edge.id ?? `demand:${semanticIdentity}`;
    if (demandEdgeIds.has(identity)) duplicate('invocation-demand edge ID', identity);
    if (demandEdgeSemanticIds.has(semanticIdentity)) {
      duplicate('invocation-demand edge semantics', semanticIdentity);
    }
    demandEdgeIds.add(identity);
    demandEdgeSemanticIds.add(semanticIdentity);
    if (edge.gateCallSiteId !== undefined) {
      let gated = demandEdgesByGateCallSiteId.get(edge.gateCallSiteId);
      if (!gated) {
        gated = [];
        demandEdgesByGateCallSiteId.set(edge.gateCallSiteId, gated);
      }
      gated.push(edge);
    }
  }

  const callbackProbeIds = new Set<string>();
  for (const probe of execution.externalCallbackProbes ?? []) {
    requireScenario(probe.scenarioId, `External callback probe ${probe.id}`);
    if (callbackProbeIds.has(probe.id)) duplicate('external callback probe', probe.id);
    callbackProbeIds.add(probe.id);
    requireNodeKey(probe.argumentNodeKey, probe.scenarioId, `External callback probe ${probe.id}`);
    if (callSites.get(probe.gateCallSiteId)?.scenarioId !== probe.scenarioId) {
      throw new Error(`External callback probe ${probe.id} has an invalid gate CallSiteId.`);
    }
    assertFixedMask(
      `${probe.id} CallableShapeBit`,
      probe.callableShapeMask,
      supportedCallableShapeMask
    );
    if (probe.callableShapeMask === 0) {
      throw new Error(`External callback probe ${probe.id} requires a non-zero shape mask.`);
    }
    assertSingleBit(
      probe.unknownExecutionBit,
      supportedUnknownExecutionMask,
      `${probe.id} UnknownExecutionBit`
    );
  }

  const unknownFrontiers = new Map<string, FiniteProofUnknownFrontierInput>();
  for (const frontier of input.unknownFrontiers) {
    requireScenario(frontier.scenarioId, `Unknown frontier ${frontier.id}`);
    if (unknownFrontiers.has(frontier.id)) duplicate('unknown frontier', frontier.id);
    if (frontier.moduleId !== undefined &&
      moduleScenarioById.get(frontier.moduleId) !== frontier.scenarioId) {
      throw new Error(`Unknown frontier ${frontier.id} has an invalid module.`);
    }
    if (frontier.ownerCallableId !== undefined) {
      requireCallable(
        frontier.ownerCallableId,
        frontier.scenarioId,
        `Unknown frontier ${frontier.id}`
      );
    }
    requireNode(frontier.base, frontier.scenarioId, `Unknown frontier ${frontier.id}`);
    if (frontier.source) {
      requireNode(frontier.source, frontier.scenarioId, `Unknown frontier ${frontier.id}`);
    }
    if (frontier.target) {
      requireNode(frontier.target, frontier.scenarioId, `Unknown frontier ${frontier.id}`);
    }
    unknownFrontiers.set(frontier.id, frontier);
  }

  const findingIds = new Set<string>();
  const findingSemanticIds = new Set<string>();
  for (const finding of input.findings) {
    requireScenario(finding.scenarioId, `Finding ${finding.id}`);
    if (finding.id.length === 0 || finding.code.length === 0) {
      throw new Error('Finite findings require non-empty identity and code.');
    }
    if (findingIds.has(finding.id)) duplicate('finding ID', finding.id);
    findingIds.add(finding.id);
    if (finding.ownerCallableId !== null) {
      requireCallable(finding.ownerCallableId, finding.scenarioId, `Finding ${finding.id}`);
    }
    const semanticIdentity = `${finding.scenarioId}\0${finding.code}\0` +
      `${finding.ownerCallableId ?? ''}\0${finding.subjectId ?? ''}\0${finding.site ?? ''}`;
    if (findingSemanticIds.has(semanticIdentity)) {
      duplicate('finding semantic', semanticIdentity);
    }
    findingSemanticIds.add(semanticIdentity);
  }

  const queryIds = new Set<string>();
  for (const query of input.queries) {
    requireScenario(query.scenarioId, `Finite query ${query.id}`);
    if (queryIds.has(query.id)) duplicate('finite query', query.id);
    queryIds.add(query.id);
    if (query.kind === 'forbid-node-fact') {
      requireNode(query.node, query.scenarioId, `Finite query ${query.id}`);
      assertFixedMask(
        `${query.id} ${query.domain} mask`,
        query.mask,
        query.domain === 'handle' ? supportedHandleMask : supportedRoleMask
      );
    } else if (query.kind === 'require-call-pair-count') {
      assertSingleBit(query.role, supportedRoleMask, `${query.id} role`);
      const ids = new Set<string>();
      for (const callSiteId of query.callSiteIds) {
        if (ids.has(callSiteId)) duplicate('query CallSiteId', `${query.id}\0${callSiteId}`);
        ids.add(callSiteId);
        if (callSites.get(callSiteId)?.scenarioId !== query.scenarioId) {
          throw new Error(`Finite query ${query.id} references invalid CallSiteId ${callSiteId}.`);
        }
      }
    } else if (query.kind === 'forbid-triggered-frontier') {
      const ids = new Set<string>();
      for (const frontierId of query.frontierIds) {
        if (ids.has(frontierId)) duplicate('query frontier ID', `${query.id}\0${frontierId}`);
        ids.add(frontierId);
        if (unknownFrontiers.get(frontierId)?.scenarioId !== query.scenarioId) {
          throw new Error(`Finite query ${query.id} references invalid frontier ${frontierId}.`);
        }
      }
    } else {
      requireCallable(query.callableId, query.scenarioId, `Finite query ${query.id}`);
      assertFixedMask(`${query.id} EffectBit`, query.mask, supportedEffectMask);
    }
  }

  const classes = new Map<string, FiniteProofClassTopologyInput>();
  const classByConstructorCallableId = new Map<string, FiniteProofClassTopologyInput>();
  const classByConstructNodes = new Map<string, FiniteProofClassTopologyInput>();
  for (const classInput of input.classTopology) {
    requireScenario(classInput.scenarioId, `Class topology ${classInput.id}`);
    if (classes.has(classInput.id)) duplicate('class topology', classInput.id);
    if (moduleScenarioById.get(classInput.moduleId) !== classInput.scenarioId) {
      throw new Error(`Class topology ${classInput.id} references invalid module.`);
    }
    const classValue = requireNodeKey(
      classInput.classValueNodeKey,
      classInput.scenarioId,
      `Class topology ${classInput.id}`
    );
    const constructorSeed = requireNodeKey(
      classInput.constructorExecutionSeedNodeKey,
      classInput.scenarioId,
      `Class topology ${classInput.id}`
    );
    const constructorReturn = requireNodeKey(
      classInput.constructorReturnNodeKey,
      classInput.scenarioId,
      `Class topology ${classInput.id}`
    );
    const constructorParameterKeys = new Set<string>();
    for (const parameterNodeKey of classInput.constructorParameterNodeKeys) {
      const parameter = requireNodeKey(
        parameterNodeKey,
        classInput.scenarioId,
        `Class topology ${classInput.id}`
      );
      if (parameter.kind !== 'value' || constructorParameterKeys.has(parameterNodeKey)) {
        throw new Error(`Class topology ${classInput.id} has an invalid parameter vector.`);
      }
      constructorParameterKeys.add(parameterNodeKey);
    }
    if (classInput.constructorDefaultNodeKeys.length !==
      classInput.constructorParameterNodeKeys.length) {
      throw new Error(`Class topology ${classInput.id} has a stale default vector width.`);
    }
    for (const defaultNodeKey of classInput.constructorDefaultNodeKeys) {
      if (defaultNodeKey === null) continue;
      const defaultNode = requireNodeKey(
        defaultNodeKey,
        classInput.scenarioId,
        `Class topology ${classInput.id}`
      );
      if (defaultNode.kind !== 'value') {
        throw new Error(`Class topology ${classInput.id} has an invalid default node.`);
      }
    }
    if (classValue.kind !== 'value' || constructorSeed.kind !== 'value' ||
      constructorReturn.kind !== 'value' ||
      classInput.classValueNodeKey === classInput.constructorExecutionSeedNodeKey) {
      throw new Error(
        `Class topology ${classInput.id} must separate ClassValue and ConstructorExecutionSeed.`
      );
    }
    const constructor = requireCallable(
      classInput.constructorCallableId,
      classInput.scenarioId,
      `Class topology ${classInput.id}`
    );
    if ((constructor.ownerKind ?? 'callable') !== 'callable') {
      throw new Error(`Class topology ${classInput.id} constructor is not callable-owned.`);
    }
    requireCallable(
      classInput.definitionOwnerCallableId,
      classInput.scenarioId,
      `Class topology ${classInput.id}`
    );
    const seed = callableSeedByCallableId.get(classInput.constructorCallableId);
    if (!seed || nodeKey(seed.node) !== classInput.constructorExecutionSeedNodeKey) {
      throw new Error(`Class topology ${classInput.id} has an inconsistent constructor seed.`);
    }
    if (classByConstructorCallableId.has(classInput.constructorCallableId)) {
      duplicate('class constructor owner', classInput.constructorCallableId);
    }
    classByConstructorCallableId.set(classInput.constructorCallableId, classInput);
    const constructNodes = `${classInput.scenarioId}\0` +
      `${classInput.constructorExecutionSeedNodeKey}\0${classInput.classValueNodeKey}`;
    if (classByConstructNodes.has(constructNodes)) duplicate('class construct topology', constructNodes);
    classByConstructNodes.set(constructNodes, classInput);
    const evaluationSiteIds = new Set<string>();
    let constructorBodyCount = 0;
    let heritageCount = 0;
    for (const site of classInput.evaluationSites) {
      requireCallable(site.ownerCallableId, classInput.scenarioId, `Class ${classInput.id} site`);
      const definitionOwned = site.kind === 'heritage' || site.kind === 'decorator' ||
        site.kind === 'computed-name' || site.kind === 'static-field' ||
        site.kind === 'static-block';
      const expectedOwner = definitionOwned
        ? classInput.definitionOwnerCallableId
        : classInput.constructorCallableId;
      if (site.ownerCallableId !== expectedOwner) {
        throw new Error(`Class ${classInput.id} ${site.kind} has the wrong execution owner.`);
      }
      const identity = `${site.kind}\0${site.ownerCallableId}\0${site.location}`;
      if (evaluationSiteIds.has(identity)) duplicate('class evaluation site', identity);
      evaluationSiteIds.add(identity);
      if (site.kind === 'constructor-body') constructorBodyCount += 1;
      if (site.kind === 'heritage') heritageCount += 1;
    }
    if (classInput.constructorKind === 'explicit' ? constructorBodyCount !== 1 :
      constructorBodyCount !== 0 || classInput.evaluationSites.some((site) =>
        site.kind === 'constructor-default')) {
      throw new Error(`Class topology ${classInput.id} has inconsistent constructor kind.`);
    }
    const requiresImplicitSuper = classInput.constructorKind === 'implicit' &&
      classInput.derived;
    if (requiresImplicitSuper !== (classInput.implicitSuperCallSiteId !== null)) {
      throw new Error(`Class topology ${classInput.id} has inconsistent implicit-super identity.`);
    }
    if (classInput.constructorKind === 'implicit' &&
      classInput.constructorDefaultNodeKeys.some((key) => key !== null)) {
      throw new Error(`Implicit constructor ${classInput.id} must not own parameter defaults.`);
    }
    if (classInput.derived) {
      if (heritageCount !== 1 || classInput.heritageResolution === 'none') {
        throw new Error(`Derived class ${classInput.id} has inconsistent heritage topology.`);
      }
    } else if (heritageCount !== 0 || classInput.heritageResolution !== 'none' ||
      classInput.baseClassId !== null) {
      throw new Error(`Base class ${classInput.id} must not carry heritage topology.`);
    }
    if (classInput.heritageResolution !== 'exact-internal' &&
      classInput.baseClassId !== null) {
      throw new Error(`Class ${classInput.id} exposes a base identity without exact heritage.`);
    }
    classes.set(classInput.id, classInput);
  }
  const requireExactFlow = (
    scenarioId: string,
    kind: FiniteProofConstraintInput['kind'],
    sourceNodeKey: string,
    targetNodeKey: string,
    label: string
  ): void => {
    const identity = `${scenarioId}\0${kind}\0${sourceNodeKey}\0${targetNodeKey}`;
    const matches = constraintsBySemanticIdentity.get(identity) ?? [];
    if (matches.length !== 1) {
      throw new Error(`${label} requires exactly one ${kind} flow constraint.`);
    }
  };
  const requireExactGatedDemands = (
    callSiteId: string,
    expected: ReadonlySet<string>,
    label: string
  ): void => {
    const actual = demandEdgesByGateCallSiteId.get(callSiteId) ?? [];
    const actualKeys = new Set(actual.map((edge) =>
      `${edge.kind}\0${edge.sourceNodeKey}\0${edge.targetNodeKey}`));
    if (actualKeys.size !== actual.length || actualKeys.size !== expected.size ||
      [...expected].some((identity) => !actualKeys.has(identity))) {
      throw new Error(`${label} has missing, duplicate, extra, or mismatched gated demand.`);
    }
  };
  for (const classInput of input.classTopology) {
    const base = classInput.baseClassId === null ? undefined : classes.get(classInput.baseClassId);
    if (classInput.heritageResolution === 'exact-internal' &&
      (!base || base.id === classInput.id || base.scenarioId !== classInput.scenarioId)) {
      throw new Error(`Class ${classInput.id} has an invalid exact internal base class.`);
    }
    if (classInput.constructorKind !== 'implicit' || !classInput.derived) continue;
    const callSiteId = classInput.implicitSuperCallSiteId!;
    const ownedSuperSites = (callSitesByOwnerCallableId.get(
      classInput.constructorCallableId
    ) ?? []).filter((callSite) => callSite.id === callSiteId);
    if (ownedSuperSites.length !== 1) {
      throw new Error(`Implicit constructor ${classInput.id} lacks one owned super callsite.`);
    }
    const superCallSite = ownedSuperSites[0]!;
    if (superCallSite.invocationKind !== 'construct') {
      throw new Error(`Implicit constructor ${classInput.id} super callsite is not construct.`);
    }
    const superTarget = superCallSite.target ?? canonicalCallTarget([], true);
    if (classInput.heritageResolution !== 'exact-internal') {
      const unknownCallee = nodes.get(nodeKey(superCallSite.callee));
      if (base !== undefined || superTarget.kind !== 'unknown' ||
        classInput.constructorParameterNodeKeys.length !== 0 ||
        (demandEdgesByGateCallSiteId.get(callSiteId)?.length ?? 0) !== 0 ||
        (unknownCallee?.unknownExecutions ?? 0) !== UnknownExecutionBit.UnresolvedTarget) {
        throw new Error(
          `Non-exact implicit heritage ${classInput.id} exposes exact forwarding topology.`
        );
      }
      continue;
    }
    if (!base || superTarget.kind !== 'known' ||
      superTarget.callableIds.length !== 1 ||
      superTarget.callableIds[0] !== base.constructorCallableId ||
      nodeKey(superCallSite.callee) !== base.classValueNodeKey) {
      throw new Error(`Implicit constructor ${classInput.id} has an inexact base target.`);
    }
    if (classInput.constructorParameterNodeKeys.length !==
      base.constructorParameterNodeKeys.length) {
      throw new Error(`Implicit constructor ${classInput.id} has a stale forwarding width.`);
    }
    const expectedDemands = new Set<string>([
      `construct\0${base.constructorExecutionSeedNodeKey}\0${base.classValueNodeKey}`,
      `return\0${base.constructorReturnNodeKey}\0${classInput.constructorReturnNodeKey}`
    ]);
    classInput.constructorParameterNodeKeys.forEach((derivedParameter, index) => {
      const baseParameter = base.constructorParameterNodeKeys[index]!;
      expectedDemands.add(`parameter\0${derivedParameter}\0${baseParameter}`);
      requireExactFlow(
        classInput.scenarioId,
        'parameter',
        derivedParameter,
        baseParameter,
        `Implicit constructor ${classInput.id} parameter ${index}`
      );
      const defaultNode = base.constructorDefaultNodeKeys[index];
      if (defaultNode === undefined) {
        throw new Error(`Implicit constructor ${classInput.id} has a stale base default vector.`);
      }
      if (defaultNode === null) return;
      expectedDemands.add(`default\0${defaultNode}\0${baseParameter}`);
    });
    requireExactFlow(
      classInput.scenarioId,
      'return',
      base.constructorReturnNodeKey,
      classInput.constructorReturnNodeKey,
      `Implicit constructor ${classInput.id} return`
    );
    requireExactGatedDemands(
      callSiteId,
      expectedDemands,
      `Implicit constructor ${classInput.id}`
    );
  }

  const matchedConstructCallSites = new Set<string>();
  for (const edge of execution.demandEdges) {
    if (edge.kind !== 'construct') continue;
    const identity = `${edge.scenarioId}\0${edge.sourceNodeKey}\0${edge.targetNodeKey}`;
    const classInput = classByConstructNodes.get(identity);
    const callSite = edge.gateCallSiteId === undefined
      ? undefined
      : callSites.get(edge.gateCallSiteId);
    if (!classInput || !callSite || callSite.invocationKind !== 'construct' ||
      nodeKey(callSite.callee) !== classInput.classValueNodeKey ||
      !callTargetCallableIds(callSite.target ?? canonicalCallTarget([], true))
        .includes(classInput.constructorCallableId)) {
      throw new Error(`Construct demand ${edge.id ?? identity} disagrees with class topology.`);
    }
    if (matchedConstructCallSites.has(callSite.id)) {
      duplicate('construct-demand CallSiteId', callSite.id);
    }
    matchedConstructCallSites.add(callSite.id);
  }
  for (const callSite of input.callSites) {
    if ((callSite.invocationKind ?? 'other') !== 'construct') continue;
    const exactClasses = callTargetCallableIds(callSite.target).map((callableId) =>
      classByConstructorCallableId.get(callableId)).filter(
      (entry): entry is FiniteProofClassTopologyInput => entry !== undefined &&
        entry.classValueNodeKey === nodeKey(callSite.callee)
    );
    if (exactClasses.length > 1) {
      throw new Error(`Construct call site ${callSite.id} has ambiguous exact class authority.`);
    }
    if (exactClasses.length === 1 && !matchedConstructCallSites.has(callSite.id)) {
      throw new Error(`Construct call site ${callSite.id} lacks its exact construct-demand edge.`);
    }
  }
}

function deriveFiniteProofTopologyMeasures(
  input: NormalizedFiniteAuthorityModelInput
): {
  readonly cardinalities: FiniteProofTopologyCardinalities;
  readonly bounds: FiniteProofBounds;
} {
  const execution = input.executionProjection;
  const flowEdgeCount = input.constraints.filter((constraint) =>
    constraint.kind !== 'capability-derivation').length;
  const derivationRuleCount = input.constraints.length - flowEdgeCount;
  const valueFactBitCount = HANDLE_BITS.length + PROTECTED_ROLE_BITS.length +
    CALLABLE_SHAPE_BITS.length + EXTERNAL_CONTRACT_BITS.length +
    UNKNOWN_EXECUTION_BITS.length;
  const effectBitCount = EFFECT_BITS.length;
  const executionRootBitCount = EXECUTION_ROOT_BITS.length;
  const proofBitCount = valueFactBitCount + effectBitCount + executionRootBitCount;
  const roleTargetCountByScenario = new Map<string, number>();
  for (const target of input.canonicalRoleTargets) {
    roleTargetCountByScenario.set(
      target.scenarioId,
      (roleTargetCountByScenario.get(target.scenarioId) ?? 0) + 1
    );
  }
  const structuralCallablePairUpperBound = input.callSites.reduce((bound, site) =>
    bound + callTargetCallableIds(site.target).length +
      (roleTargetCountByScenario.get(site.scenarioId) ?? 0), 0);
  const executionRootFactUpperBound = input.callables.length * executionRootBitCount;
  const callableRootApplicationUpperBound = execution.callableSeeds.length *
    executionRootBitCount;
  const invocationDemandFactUpperBound = input.nodes.length * executionRootBitCount;
  const invocationDemandEdgeApplicationUpperBound = execution.demandEdges.length *
    executionRootBitCount;
  const rootedCallSiteUpperBound = input.callSites.length * executionRootBitCount;
  const externalCallbackProbeApplicationUpperBound =
    (execution.externalCallbackProbes?.length ?? 0) * executionRootBitCount;
  const executionRootWorkUpperBound = executionRootFactUpperBound +
    callableRootApplicationUpperBound + invocationDemandFactUpperBound +
    invocationDemandEdgeApplicationUpperBound + rootedCallSiteUpperBound;
  const effectFactUpperBound = input.scenarioIds.length * executionRootBitCount *
    effectBitCount;
  const atomicFactUpperBound = valueFactBitCount * input.nodes.length +
    effectFactUpperBound + executionRootFactUpperBound +
    invocationDemandFactUpperBound + rootedCallSiteUpperBound;
  const edgeApplicationUpperBound = valueFactBitCount * flowEdgeCount +
    invocationDemandEdgeApplicationUpperBound;
  const ruleApplicationUpperBound = valueFactBitCount * derivationRuleCount +
    input.callSites.length * executionRootBitCount *
      (HANDLE_BITS.length + PROTECTED_ROLE_BITS.length) +
    input.unknownFrontiers.length * executionRootBitCount +
    externalCallbackProbeApplicationUpperBound;
  const executionFrontierApplicationUpperBound = input.unknownFrontiers.length *
    executionRootBitCount +
    invocationDemandFactUpperBound * UNKNOWN_EXECUTION_BITS.length +
    externalCallbackProbeApplicationUpperBound;
  const cardinalities: FiniteProofTopologyCardinalities = deepFreezeOwned({
    scenarioCount: input.scenarioIds.length,
    nodeCount: input.nodes.length,
    flowEdgeCount,
    derivationRuleCount,
    callableCount: input.callables.length,
    directCallCount: input.directCalls.length,
    callSiteCount: input.callSites.length,
    canonicalRoleTargetCount: input.canonicalRoleTargets.length,
    callSccComponentCount: execution.components.length,
    callSccCondensationEdgeCount: execution.condensationEdges.length,
    executionRootCount: execution.roots.length,
    terminalIngressCount: execution.terminalIngresses.length,
    callableSeedCount: execution.callableSeeds.length,
    invocationDemandEdgeCount: execution.demandEdges.length,
    externalCallbackProbeCount: execution.externalCallbackProbes?.length ?? 0,
    unknownFrontierCount: input.unknownFrontiers.length,
    findingCount: input.findings.length,
    queryCount: input.queries.length,
    moduleSccComponentCount: input.moduleSccTopology.components.length,
    moduleSccCondensationEdgeCount: input.moduleSccTopology.condensationEdges.length,
    moduleStarExportClosureCount: input.moduleSccTopology.starExportClosures.length,
    classCount: input.classTopology.length,
    classEvaluationSiteCount: input.classTopology.reduce(
      (count, entry) => count + entry.evaluationSites.length,
      0
    )
  });
  const bounds: FiniteProofBounds = deepFreezeOwned({
    proofBitCount,
    valueFactBitCount,
    effectBitCount,
    executionRootBitCount,
    valueCount: input.nodes.length,
    edgeCount: flowEdgeCount,
    ruleCount: derivationRuleCount,
    effectFactUpperBound,
    callProjectionCount: input.directCalls.length + input.callSites.length +
      structuralCallablePairUpperBound + execution.components.length +
      execution.condensationEdges.length + execution.roots.length +
      execution.demandEdges.length +
      (execution.externalCallbackProbes?.length ?? 0) + executionRootWorkUpperBound,
    structuralCallablePairUpperBound,
    structuralUnknownCallSiteUpperBound: input.callSites.length,
    executionRootWorkUpperBound,
    callSccCondensationEdgeUpperBound: input.directCalls.length,
    executionRootFactUpperBound,
    callableRootApplicationUpperBound,
    invocationDemandFactUpperBound,
    invocationDemandEdgeApplicationUpperBound,
    rootedCallSiteUpperBound,
    externalCallbackProbeApplicationUpperBound,
    executionFrontierApplicationUpperBound,
    unknownFrontierCount: input.unknownFrontiers.length,
    atomicFactUpperBound,
    edgeApplicationUpperBound,
    ruleApplicationUpperBound,
    timeScope: 'fixed-bit delta solve over canonically ordered frozen topology',
    canonicalOrderingTime: 'O(N log N)',
    canonicalSerializationTime: 'O(N)',
    time: 'O(P * (V + E + R) + F + C + X)',
    memory: 'O(words(P) * V + E + R + F + C + X)'
  });
  if (bounds.proofBitCount !== bounds.valueFactBitCount + bounds.effectBitCount +
    bounds.executionRootBitCount) {
    throw new Error('Finite proof bit-domain cardinalities are inconsistent.');
  }
  return { cardinalities, bounds };
}

function finiteAuthorityTopologyPayload(
  topology: Omit<FrozenFiniteAuthorityTopology, 'canonicalBytes'>
): unknown {
  return {
    scenarioIds: topology.scenarioIds,
    nodes: topology.nodes,
    constraints: topology.constraints.map((constraint) =>
      Object.fromEntries(
        Object.entries(constraint).filter(([key]) => key !== 'id')
      ) as CanonicalOrdinaryData
    ),
    callables: topology.callables,
    directCalls: topology.directCalls,
    callSites: topology.callSites,
    canonicalRoleTargets: topology.canonicalRoleTargets,
    executionProjection: topology.executionProjection,
    unknownFrontiers: topology.unknownFrontiers,
    findings: topology.findings,
    queries: topology.queries,
    moduleSccTopology: topology.moduleSccTopology,
    classTopology: topology.classTopology,
    cardinalities: topology.cardinalities,
    preSolveBounds: topology.preSolveBounds,
    topologyFreezeCount: topology.topologyFreezeCount
  };
}

function canonicalFiniteAuthorityTopologyBytes(
  topology: FrozenFiniteAuthorityTopology
): string {
  return canonicalDigestBytes(
    finiteAuthorityTopologyPayload(topology),
    'frozen finite authority topology'
  );
}

export function freezeFiniteAuthorityTopology(
  rawInput: FiniteAuthorityModelInput
): FrozenFiniteAuthorityTopology {
  let topologyFreezeCount = 0;
  const snapshot = snapshotOrdinaryData(
    rawInput,
    'finite authority topology',
    TOPOLOGY_SNAPSHOT_OPTIONS
  );
  const normalized = normalizeFiniteAuthorityModelSnapshot(snapshot);
  validateFiniteAuthorityTopologyReferences(normalized);
  const measures = deriveFiniteProofTopologyMeasures(normalized);
  topologyFreezeCount += 1;
  const sorted = canonicalSortFiniteAuthorityTopology(normalized);
  const payload = deepFreezeOwned({
    ...sorted,
    cardinalities: measures.cardinalities,
    preSolveBounds: measures.bounds,
    topologyFreezeCount
  });
  const canonicalBytes = canonicalDigestBytes(
    finiteAuthorityTopologyPayload(payload),
    'frozen finite authority topology'
  );
  return deepFreezeOwned({
    ...payload,
    canonicalBytes
  });
}

function asScenarioPartition(value: string): ScenarioPartition {
  return value as ScenarioPartition;
}

type FiniteProofNodeKey = `value\0${ValueId}` | `export-slot\0${ExportSlotId}`;

function nodeKey(reference: FiniteProofNodeRef): FiniteProofNodeKey {
  return `${reference.kind}\0${reference.id}` as FiniteProofNodeKey;
}

function callTargetCallableIds<CallableIdentity extends string>(
  target: FiniteProofCanonicalCallTarget<CallableIdentity>
): readonly CallableIdentity[] {
  return target.kind === 'unknown' ? [] : target.callableIds;
}

function callTargetHasUnknown(target: FiniteProofCanonicalCallTarget): boolean {
  return target.kind !== 'known';
}

function canonicalCallTarget<CallableIdentity extends string>(
  callableIds: readonly CallableIdentity[],
  hasUnknown: boolean
): FiniteProofCanonicalCallTarget<CallableIdentity> {
  const sortedCallableIds = [...callableIds].sort(compareCanonicalText);
  if (new Set(sortedCallableIds).size !== sortedCallableIds.length) {
    throw new Error('Canonical call target contains a duplicate CallableId.');
  }
  if (sortedCallableIds.length === 0) {
    if (!hasUnknown) throw new Error('Known canonical call target must not be empty.');
    return Object.freeze({ kind: 'unknown' as const });
  }
  if (hasUnknown) return Object.freeze({
    kind: 'known-and-unknown' as const,
    callableIds: Object.freeze(sortedCallableIds)
  });
  return Object.freeze({
    kind: 'known' as const,
    callableIds: Object.freeze(sortedCallableIds)
  });
}

function normalizeCanonicalCallTarget(
  candidate: unknown,
  label: string
): FiniteProofCanonicalCallTarget {
  const record = ordinaryRecord(snapshotOrdinaryData(
    candidate,
    label,
    TOPOLOGY_SNAPSHOT_OPTIONS
  ), label);
  const kind = ordinaryString(record.kind, `${label}.kind`);
  if (kind === 'unknown') {
    assertExactOrdinaryKeys(record, ['kind'], label);
    return canonicalCallTarget([], true);
  }
  if (kind !== 'known' && kind !== 'known-and-unknown') {
    throw new Error(`${label}.kind is not a canonical call-target discriminant.`);
  }
  assertExactOrdinaryKeys(record, ['kind', 'callableIds'], label);
  const callableIds = ordinaryArray(record.callableIds!, `${label}.callableIds`)
    .map((value, index) => ordinaryString(value, `${label}.callableIds[${index}]`));
  return canonicalCallTarget(callableIds, kind === 'known-and-unknown');
}

function eachSetBit(mask: number, bits: readonly number[], visit: (bit: number) => void): void {
  for (const bit of bits) {
    if ((mask & bit) !== 0) visit(bit);
  }
}

function assertFixedMask(label: string, value: number, supportedMask: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || (value & ~supportedMask) !== 0) {
    throw new Error(`${label} is outside the fixed proof-bit domain.`);
  }
}

function canonicalFindingKey(finding: {
  readonly id: string;
  readonly code: string;
  readonly ownerCallableId: string | null;
  readonly subjectId: string | null;
  readonly site: string | null;
}): string {
  return `${finding.id}\0${finding.code}\0${finding.ownerCallableId ?? ''}\0` +
    `${finding.subjectId ?? ''}\0${finding.site ?? ''}`;
}

function callEffectForHandle(bit: number): number {
  switch (bit) {
    case HandleBit.ChildAuthority:
    case HandleBit.ExactNodeChildSpawn:
      return EffectBit.InvokesChildAuthority;
    case HandleBit.ProcessEnvironment:
      return EffectBit.ReadsProcessEnvironment;
    case HandleBit.ExecutableLoader:
    case HandleBit.RequireLoader:
      return EffectBit.UsesExecutableLoader;
    case HandleBit.AvailableParallelism:
      return EffectBit.ReadsAvailableParallelism;
    case HandleBit.PolicyAuthority:
      return EffectBit.ReadsPolicyAuthority;
    case HandleBit.WorkerAuthority:
      return EffectBit.UsesWorkerAuthority;
    default:
      return 0;
  }
}

function callEffectForRole(bit: number): number {
  switch (bit) {
    case ProtectedRoleBit.ReviewedDevCommand:
      return EffectBit.InvokesReviewedDevCommand;
    case ProtectedRoleBit.BoundedExecutor:
      return EffectBit.InvokesBoundedExecutor;
    case ProtectedRoleBit.SharedProcessBytes:
      return EffectBit.InvokesSharedProcessBytes;
    case ProtectedRoleBit.SharedProcessAlternative:
      return EffectBit.InvokesSharedProcessAlternative;
    default:
      return 0;
  }
}

export function solveFiniteAuthorityModel(
  rawInput: FiniteAuthorityModelInput
): FrozenFiniteAuthorityProof {
  return solveFrozenFiniteAuthorityTopology(freezeFiniteAuthorityTopology(rawInput));
}

function solveFrozenFiniteAuthorityTopology(
  input: FrozenFiniteAuthorityTopology
): FrozenFiniteAuthorityProof {
  const scenarioIds = [...input.scenarioIds].sort(compareCanonicalText);
  if (scenarioIds.length === 0 || new Set(scenarioIds).size !== scenarioIds.length) {
    throw new Error('Finite authority model requires unique ScenarioPartition identities.');
  }
  const scenarioSet = new Set(scenarioIds);
  const supportedHandleMask = HANDLE_BITS.reduce((mask, bit) => mask | bit, 0);
  const supportedRoleMask = PROTECTED_ROLE_BITS.reduce((mask, bit) => mask | bit, 0);
  const supportedEffectMask = EFFECT_BITS.reduce((mask, bit) => mask | bit, 0);
  const supportedExecutionRootMask = EXECUTION_ROOT_BITS
    .reduce((mask, bit) => mask | bit, 0);
  const supportedCallableShapeMask = CALLABLE_SHAPE_BITS
    .reduce((mask, bit) => mask | bit, 0);
  const supportedExternalContractMask = EXTERNAL_CONTRACT_BITS
    .reduce((mask, bit) => mask | bit, 0);
  const supportedUnknownExecutionMask = UNKNOWN_EXECUTION_BITS
    .reduce((mask, bit) => mask | bit, 0);
  const supportedValueMask = (domain: FiniteValueFactDomain): number => {
    switch (domain) {
      case 'handle': return supportedHandleMask;
      case 'role': return supportedRoleMask;
      case 'callable-shape': return supportedCallableShapeMask;
      case 'external-contract': return supportedExternalContractMask;
      case 'unknown-execution': return supportedUnknownExecutionMask;
    }
  };

  const nodes = new Map<string, FrozenNode>();
  for (const candidate of [...input.nodes].sort((left, right) =>
    compareCanonicalText(`${left.kind}\0${left.id}`, `${right.kind}\0${right.id}`))) {
    if (!scenarioSet.has(candidate.scenarioId)) {
      throw new Error(`Node ${candidate.id} has an unknown ScenarioPartition.`);
    }
    const key = nodeKey(candidate);
    if (nodes.has(key)) throw new Error(`Duplicate finite proof node ${key}.`);
    const seedHandles = candidate.handles ?? 0;
    const seedRoles = candidate.roles ?? 0;
    const seedCallableShapes = candidate.callableShapes ?? 0;
    const seedExternalContracts = candidate.externalContracts ?? 0;
    const seedUnknownExecutions = candidate.unknownExecutions ?? 0;
    assertFixedMask(`${candidate.id} HandleBit seed`, seedHandles, supportedHandleMask);
    assertFixedMask(`${candidate.id} ProtectedRoleBit seed`, seedRoles, supportedRoleMask);
    assertFixedMask(
      `${candidate.id} CallableShapeBit seed`,
      seedCallableShapes,
      supportedCallableShapeMask
    );
    assertFixedMask(
      `${candidate.id} ExternalContractBit seed`,
      seedExternalContracts,
      supportedExternalContractMask
    );
    assertFixedMask(
      `${candidate.id} UnknownExecutionBit seed`,
      seedUnknownExecutions,
      supportedUnknownExecutionMask
    );
    nodes.set(key, Object.freeze({
      key,
      id: candidate.id as ValueId | ExportSlotId,
      kind: candidate.kind,
      scenarioId: asScenarioPartition(candidate.scenarioId),
      seedHandles,
      seedRoles,
      seedCallableShapes,
      seedExternalContracts,
      seedUnknownExecutions
    }));
  }

  const findingsByScenario = new Map<string, Map<string, FiniteProofFinding>>();
  const addFinding = (
    scenarioId: string,
    code: string,
    message: string,
    identity: string,
    ownerCallableId: string | null = null,
    subjectId: string | null = null,
    site: string | null = null
  ): void => {
    if (!scenarioSet.has(scenarioId)) {
      throw new Error(`Finding ${code} has an unknown ScenarioPartition.`);
    }
    let findings = findingsByScenario.get(scenarioId);
    if (!findings) {
      findings = new Map();
      findingsByScenario.set(scenarioId, findings);
    }
    if (identity.length === 0 || code.length === 0) {
      throw new Error('Finite finding identity and code must be non-empty.');
    }
    const finding = Object.freeze({
      id: identity as FindingId,
      scenarioId: asScenarioPartition(scenarioId),
      code,
      ownerCallableId: ownerCallableId as CallableId | null,
      subjectId,
      site,
      message
    });
    const key = canonicalFindingKey(finding);
    if (findings.has(key)) throw new Error(`Duplicate finite finding identity ${key}.`);
    findings.set(key, finding);
  };
  for (const finding of input.findings) {
    addFinding(
      finding.scenarioId,
      finding.code,
      finding.message,
      finding.id,
      finding.ownerCallableId,
      finding.subjectId,
      finding.site
    );
  }

  const edges: FrozenEdge[] = [];
  const derivations: FrozenDerivation[] = [];
  const seenConstraintIds = new Map<string, string>();
  for (const constraint of [...input.constraints].sort((left, right) =>
    compareCanonicalText(left.id, right.id))) {
    const serializedConstraint = canonicalSnapshotBytes(
      constraint,
      `finite constraint ${constraint.id}`
    );
    const priorConstraint = seenConstraintIds.get(constraint.id);
    if (priorConstraint !== undefined) {
      throw new Error(
        `${priorConstraint === serializedConstraint ? 'Duplicate' : 'Conflicting'} ` +
          `finite constraint identity ${constraint.id}.`
      );
    }
    seenConstraintIds.set(constraint.id, serializedConstraint);
    const source = nodes.get(nodeKey(constraint.source));
    const target = nodes.get(nodeKey(constraint.target));
    if (!source || !target) {
      throw new Error(`Constraint ${constraint.id} references an unknown node.`);
    }
    if (source.scenarioId !== constraint.scenarioId ||
      target.scenarioId !== constraint.scenarioId) {
      addFinding(
        constraint.scenarioId,
        'CROSS_SCENARIO_EDGE',
        `${constraint.id}: ${source.scenarioId} -> ${target.scenarioId}`,
        `cross:${constraint.id}`
      );
      continue;
    }
    if (constraint.kind === 'capability-derivation') {
      const sourceMask = supportedValueMask(constraint.sourceDomain);
      const targetMask = supportedValueMask(constraint.targetDomain);
      assertFixedMask(`${constraint.id} source bit`, constraint.sourceBit, sourceMask);
      assertFixedMask(`${constraint.id} target bit`, constraint.targetBit, targetMask);
      derivations.push(Object.freeze({
        id: constraint.id as ConstraintId,
        scenarioId: source.scenarioId,
        sourceKey: source.key,
        sourceDomain: constraint.sourceDomain,
        sourceBit: constraint.sourceBit,
        targetKey: target.key,
        targetDomain: constraint.targetDomain,
        targetBit: constraint.targetBit
      }));
    } else {
      edges.push(Object.freeze({
        id: constraint.id as ConstraintId,
        scenarioId: source.scenarioId,
        sourceKey: source.key,
        targetKey: target.key
      }));
    }
  }

  const callables = new Map<string, {
    readonly scenarioId: ScenarioPartition;
    readonly ownerKind: 'callable' | 'module-initializer';
    readonly terminalEffectMask: number;
    readonly parameterNodeKeys: readonly string[];
  }>();
  for (const callable of input.callables) {
    if (!scenarioSet.has(callable.scenarioId) || callables.has(callable.id)) {
      throw new Error(`Callable ${callable.id} has invalid structural identity.`);
    }
    const terminalEffectMask = callable.terminalEffectMask ?? 0;
    const parameterNodeKeys = Object.freeze([...(callable.parameterNodeKeys ?? [])]);
    const ownerKind = callable.ownerKind ?? 'callable';
    if (ownerKind !== 'callable' && ownerKind !== 'module-initializer') {
      throw new Error(`Callable ${callable.id} has an invalid execution-owner kind.`);
    }
    assertFixedMask(
      `${callable.id} terminal EffectBit`,
      terminalEffectMask,
      supportedEffectMask
    );
    if (new Set(parameterNodeKeys).size !== parameterNodeKeys.length) {
      throw new Error(`Callable ${callable.id} has a duplicate parameter node key.`);
    }
    for (const parameterNodeKey of parameterNodeKeys) {
      const parameter = nodes.get(parameterNodeKey);
      if (!parameter || parameter.scenarioId !== callable.scenarioId ||
        parameter.kind !== 'value') {
        throw new Error(
          `Callable ${callable.id} references an invalid parameter node ${parameterNodeKey}.`
        );
      }
    }
    callables.set(callable.id, Object.freeze({
      scenarioId: asScenarioPartition(callable.scenarioId),
      ownerKind,
      terminalEffectMask,
      parameterNodeKeys
    }));
  }
  const directCalls = [...input.directCalls].sort((left, right) =>
    compareCanonicalText(left.id, right.id));
  const directCallIds = new Set<string>();
  for (const edge of directCalls) {
    if (directCallIds.has(edge.id)) {
      throw new Error(`Duplicate direct-call identity ${edge.id}.`);
    }
    directCallIds.add(edge.id);
    const callerScenario = callables.get(edge.callerCallableId)?.scenarioId;
    const calleeScenario = callables.get(edge.calleeCallableId)?.scenarioId;
    if (!callerScenario || !calleeScenario) {
      throw new Error(`Direct call ${edge.id} references an unknown CallableId.`);
    }
    if (callerScenario !== edge.scenarioId || calleeScenario !== edge.scenarioId) {
      addFinding(
        edge.scenarioId,
        'CROSS_SCENARIO_CALL',
        `${edge.id}: ${callerScenario} -> ${calleeScenario}`,
        `cross-call:${edge.id}`
      );
    }
  }

  const canonicalRoleTargets = [...input.canonicalRoleTargets].sort((left, right) =>
    compareCanonicalText(
      `${left.scenarioId}\0${left.role}\0${left.callableId}`,
      `${right.scenarioId}\0${right.role}\0${right.callableId}`
    ));
  const roleTargetsByScenarioAndBit = new Map<string, CallableId[]>();
  const seenCanonicalRoleTargets = new Set<string>();
  const canonicalCallableByScenarioRole = new Map<string, string>();
  for (const target of canonicalRoleTargets) {
    assertFixedMask(
      `${target.callableId} canonical ProtectedRoleBit`,
      target.role,
      supportedRoleMask
    );
    if (target.role === 0 || (target.role & (target.role - 1)) !== 0) {
      throw new Error(`${target.callableId} canonical role target must own one fixed role bit.`);
    }
    if (callables.get(target.callableId)?.scenarioId !== target.scenarioId) {
      throw new Error(`${target.callableId} canonical role target crosses ScenarioPartition.`);
    }
    const identity = `${target.scenarioId}\0${target.role}\0${target.callableId}`;
    if (seenCanonicalRoleTargets.has(identity)) {
      throw new Error(`Duplicate canonical role target ${identity}.`);
    }
    seenCanonicalRoleTargets.add(identity);
    const key = `${target.scenarioId}\0${target.role}`;
    const prior = canonicalCallableByScenarioRole.get(key);
    if (prior !== undefined && prior !== target.callableId) {
      throw new Error(`${key} has more than one canonical role target.`);
    }
    canonicalCallableByScenarioRole.set(key, target.callableId);
    let targets = roleTargetsByScenarioAndBit.get(key);
    if (!targets) {
      targets = [];
      roleTargetsByScenarioAndBit.set(key, targets);
    }
    targets.push(target.callableId as CallableId);
  }
  for (const targets of roleTargetsByScenarioAndBit.values()) {
    targets.sort(compareCanonicalText);
  }

  const callSites = [...input.callSites].sort((left, right) =>
    compareCanonicalText(left.id, right.id));
  const seenCallSiteIds = new Set<string>();
  const callSiteById = new Map<string, FiniteProofCallSiteInput>();
  const knownCallablePairsByKey = new Map<string, FiniteProofKnownCallablePair>();
  const knownCallableIdsByCallSiteId = new Map<string, Set<CallableId>>();
  const addKnownCallablePair = (
    scenarioId: string,
    callSiteId: string,
    callableId: string
  ): void => {
    if (callables.get(callableId)?.scenarioId !== scenarioId) return;
    const key = `${scenarioId}\0${callSiteId}\0${callableId}`;
    if (knownCallablePairsByKey.has(key)) return;
    knownCallablePairsByKey.set(key, Object.freeze({
      scenarioId: asScenarioPartition(scenarioId),
      callSiteId: callSiteId as CallSiteId,
      callableId: callableId as CallableId
    }));
    let callableIds = knownCallableIdsByCallSiteId.get(callSiteId);
    if (!callableIds) {
      callableIds = new Set();
      knownCallableIdsByCallSiteId.set(callSiteId, callableIds);
    }
    callableIds.add(callableId as CallableId);
  };
  const structuralCallSites: FiniteProofCallSiteProjection[] = [];
  for (const callSite of callSites) {
    if (seenCallSiteIds.has(callSite.id)) {
      throw new Error(`Duplicate CallSiteId ${callSite.id}.`);
    }
    seenCallSiteIds.add(callSite.id);
    callSiteById.set(callSite.id, callSite);
    const callee = nodes.get(nodeKey(callSite.callee));
    if (!callee || callee.scenarioId !== callSite.scenarioId) {
      throw new Error(`Call site ${callSite.id} has an invalid callee partition.`);
    }
    if (callSite.ownerCallableId &&
      callables.get(callSite.ownerCallableId)?.scenarioId !== callSite.scenarioId) {
      throw new Error(`Call site ${callSite.id} has an invalid owner CallableId.`);
    }
    const targetCallableIds = callTargetCallableIds(callSite.target);
    for (const callableId of targetCallableIds) {
      const targetCallable = callables.get(callableId);
      if (!targetCallable) {
        throw new Error(`Call site ${callSite.id} has an unknown target CallableId ${callableId}.`);
      }
      if (targetCallable.scenarioId !== callSite.scenarioId) {
        addFinding(
          callSite.scenarioId,
          'CROSS_SCENARIO_CALL',
          `${callSite.id}: sparse callable target crosses ScenarioPartition`,
          `cross-call-target:${callSite.id}:${callableId}`
        );
      }
      addKnownCallablePair(callSite.scenarioId, callSite.id, callableId);
    }
    structuralCallSites.push(Object.freeze({
      scenarioId: asScenarioPartition(callSite.scenarioId),
      callSiteId: callSite.id as CallSiteId,
      ownerCallableId: (callSite.ownerCallableId ?? null) as CallableId | null,
      target: canonicalCallTarget(
        targetCallableIds as readonly CallableId[],
        callTargetHasUnknown(callSite.target)
      ),
      invocationKind: callSite.invocationKind ?? 'other',
      executionRootBits: 0,
      location: callSite.location
    }));
  }

  const executionProjection = input.executionProjection;
  const componentByCallableId = new Map<string, FiniteProofCallSccComponentInput>();
  const componentsById = new Map<number, FiniteProofCallSccComponentInput>();
  for (const component of executionProjection.components) {
    if (!scenarioSet.has(component.scenarioId) || componentsById.has(component.id)) {
      throw new Error(`Call SCC component ${component.id} has invalid structural identity.`);
    }
    componentsById.set(component.id, component);
    for (const callableId of component.callableIds) {
      if (componentByCallableId.has(callableId) ||
        callables.get(callableId)?.scenarioId !== component.scenarioId) {
        throw new Error(`Call SCC component ${component.id} has an invalid CallableId.`);
      }
      componentByCallableId.set(callableId, component);
    }
  }
  const condensationEdgeKeys = new Set<string>();
  for (const edge of executionProjection.condensationEdges) {
    const source = componentsById.get(edge.sourceComponentId);
    const target = componentsById.get(edge.targetComponentId);
    const key = `${edge.scenarioId}\0${edge.sourceComponentId}\0${edge.targetComponentId}`;
    if (!source || !target || source.scenarioId !== edge.scenarioId ||
      target.scenarioId !== edge.scenarioId || source.id === target.id ||
      condensationEdgeKeys.has(key)) {
      throw new Error(`Call SCC condensation edge ${key} is invalid.`);
    }
    condensationEdgeKeys.add(key);
  }
  if (executionProjection.components.length > 0) {
    if (componentByCallableId.size !== callables.size) {
      throw new Error('Observed call SCC projection does not cover every execution owner.');
    }
    const expectedCondensationEdgeKeys = new Set<string>();
    for (const edge of directCalls) {
      const source = componentByCallableId.get(edge.callerCallableId);
      const target = componentByCallableId.get(edge.calleeCallableId);
      if (!source || !target || source.scenarioId !== edge.scenarioId ||
        target.scenarioId !== edge.scenarioId || source.id === target.id) continue;
      expectedCondensationEdgeKeys.add(
        `${edge.scenarioId}\0${source.id}\0${target.id}`
      );
    }
    if (expectedCondensationEdgeKeys.size !== condensationEdgeKeys.size ||
      [...expectedCondensationEdgeKeys].some((key) => !condensationEdgeKeys.has(key))) {
      throw new Error('Observed call SCC condensation does not equal the exact direct-call graph.');
    }
  }
  const rootKeys = new Set<string>();
  for (const root of executionProjection.roots) {
    assertFixedMask(`${root.callableId} ExecutionRootBit`, root.rootBit, supportedExecutionRootMask);
    const key = `${root.scenarioId}\0${root.callableId}\0${root.rootBit}`;
    if (root.rootBit === 0 || (root.rootBit & (root.rootBit - 1)) !== 0 ||
      callables.get(root.callableId)?.scenarioId !== root.scenarioId || rootKeys.has(key)) {
      throw new Error(`Execution root ${key} is invalid.`);
    }
    rootKeys.add(key);
  }
  const terminalIngressByCallableId = new Map<string, {
    readonly canonicalSelfRootBit: number;
    readonly admittedDemandRootBits: ReadonlySet<number>;
  }>();
  for (const ingress of executionProjection.terminalIngresses) {
    assertFixedMask(
      `${ingress.callableId} terminal canonical self root`,
      ingress.canonicalSelfRootBit,
      supportedExecutionRootMask
    );
    if (ingress.canonicalSelfRootBit === 0 ||
      (ingress.canonicalSelfRootBit & (ingress.canonicalSelfRootBit - 1)) !== 0 ||
      callables.get(ingress.callableId)?.scenarioId !== ingress.scenarioId ||
      terminalIngressByCallableId.has(ingress.callableId)) {
      throw new Error(`Terminal ingress ${ingress.callableId} is invalid.`);
    }
    const admittedDemandRootBits = new Set<number>();
    for (const rootBit of ingress.admittedDemandRootBits) {
      assertFixedMask(
        `${ingress.callableId} admitted terminal demand root`,
        rootBit,
        supportedExecutionRootMask
      );
      if (rootBit === 0 || (rootBit & (rootBit - 1)) !== 0 ||
        admittedDemandRootBits.has(rootBit)) {
        throw new Error(`Terminal ingress ${ingress.callableId} has an invalid demand root.`);
      }
      admittedDemandRootBits.add(rootBit);
    }
    terminalIngressByCallableId.set(ingress.callableId, Object.freeze({
      canonicalSelfRootBit: ingress.canonicalSelfRootBit,
      admittedDemandRootBits
    }));
  }
  const callableSeedsByNodeKey = new Map<string, string[]>();
  const callableSeedKeys = new Set<string>();
  for (const seed of executionProjection.callableSeeds) {
    const seedNode = nodes.get(nodeKey(seed.node));
    const identity = `${seed.scenarioId}\0${seed.callableId}\0${nodeKey(seed.node)}`;
    if (!seedNode || seedNode.scenarioId !== seed.scenarioId ||
      callables.get(seed.callableId)?.scenarioId !== seed.scenarioId ||
      callableSeedKeys.has(identity)) {
      throw new Error(`Callable execution seed ${identity} is invalid.`);
    }
    callableSeedKeys.add(identity);
    let seeds = callableSeedsByNodeKey.get(nodeKey(seed.node));
    if (!seeds) {
      seeds = [];
      callableSeedsByNodeKey.set(nodeKey(seed.node), seeds);
    }
    seeds.push(seed.callableId);
  }
  for (const seeds of callableSeedsByNodeKey.values()) seeds.sort(compareCanonicalText);
  const demandEdgeKeys = new Set<string>();
  const demandEdgeIds = new Set<string>();
  const frozenDemandEdges: FrozenInvocationDemandEdge[] = [];
  const demandEdgesByTarget = new Map<string, FrozenInvocationDemandEdge[]>();
  const demandEdgesByGateCallSiteId = new Map<string, FrozenInvocationDemandEdge[]>();
  for (const edge of executionProjection.demandEdges) {
    const source = nodes.get(edge.sourceNodeKey);
    const target = nodes.get(edge.targetNodeKey);
    const gateCallSiteId = edge.gateCallSiteId ?? null;
    const gate = gateCallSiteId === null ? null : callSiteById.get(gateCallSiteId);
    const key = `${edge.scenarioId}\0${edge.kind}\0${edge.sourceNodeKey}\0` +
      `${edge.targetNodeKey}\0${gateCallSiteId ?? ''}`;
    const id = edge.id ?? `demand:${key}`;
    const requiresGate = edge.kind !== 'fixed-flow';
    if (!source || !target || source.scenarioId !== edge.scenarioId ||
      target.scenarioId !== edge.scenarioId || demandEdgeKeys.has(key) ||
      demandEdgeIds.has(id) || requiresGate !== (gateCallSiteId !== null) ||
      (gate === undefined || (gate !== null && gate.scenarioId !== edge.scenarioId))) {
      throw new Error(`Invocation-demand edge ${key} is invalid.`);
    }
    demandEdgeKeys.add(key);
    demandEdgeIds.add(id);
    const frozen = Object.freeze({
      id,
      scenarioId: asScenarioPartition(edge.scenarioId),
      sourceNodeKey: edge.sourceNodeKey,
      targetNodeKey: edge.targetNodeKey,
      kind: edge.kind,
      gateCallSiteId
    });
    frozenDemandEdges.push(frozen);
    let incoming = demandEdgesByTarget.get(edge.targetNodeKey);
    if (!incoming) {
      incoming = [];
      demandEdgesByTarget.set(edge.targetNodeKey, incoming);
    }
    incoming.push(frozen);
    if (gateCallSiteId !== null) {
      let gated = demandEdgesByGateCallSiteId.get(gateCallSiteId);
      if (!gated) {
        gated = [];
        demandEdgesByGateCallSiteId.set(gateCallSiteId, gated);
      }
      gated.push(frozen);
    }
  }
  frozenDemandEdges.sort((left, right) => compareCanonicalText(left.id, right.id));
  for (const incoming of demandEdgesByTarget.values()) {
    incoming.sort((left, right) => compareCanonicalText(left.id, right.id));
  }
  for (const gated of demandEdgesByGateCallSiteId.values()) {
    gated.sort((left, right) => compareCanonicalText(left.id, right.id));
  }
  const externalCallbackProbeIds = new Set<string>();
  const frozenExternalCallbackProbes: FrozenExternalCallbackProbe[] = [];
  const externalCallbackProbesByArgumentNodeKey =
    new Map<string, FrozenExternalCallbackProbe[]>();
  const externalCallbackProbesByGateCallSiteId =
    new Map<string, FrozenExternalCallbackProbe[]>();
  for (const probe of [...(executionProjection.externalCallbackProbes ?? [])]
    .sort((left, right) => compareCanonicalText(left.id, right.id))) {
    const argument = nodes.get(probe.argumentNodeKey);
    const gate = callSiteById.get(probe.gateCallSiteId);
    assertFixedMask(
      `${probe.id} external callback CallableShapeBit mask`,
      probe.callableShapeMask,
      supportedCallableShapeMask
    );
    assertFixedMask(
      `${probe.id} external callback UnknownExecutionBit`,
      probe.unknownExecutionBit,
      supportedUnknownExecutionMask
    );
    if (!argument || argument.scenarioId !== probe.scenarioId || !gate ||
      gate.scenarioId !== probe.scenarioId || probe.callableShapeMask === 0 ||
      probe.unknownExecutionBit === 0 ||
      (probe.unknownExecutionBit & (probe.unknownExecutionBit - 1)) !== 0 ||
      externalCallbackProbeIds.has(probe.id)) {
      throw new Error(`External callback probe ${probe.id} is invalid.`);
    }
    externalCallbackProbeIds.add(probe.id);
    const frozen = Object.freeze({
      id: probe.id,
      scenarioId: asScenarioPartition(probe.scenarioId),
      argumentNodeKey: probe.argumentNodeKey,
      callableShapeMask: probe.callableShapeMask,
      gateCallSiteId: probe.gateCallSiteId,
      unknownExecutionBit: probe.unknownExecutionBit
    });
    frozenExternalCallbackProbes.push(frozen);
    let byArgument = externalCallbackProbesByArgumentNodeKey.get(probe.argumentNodeKey);
    if (!byArgument) {
      byArgument = [];
      externalCallbackProbesByArgumentNodeKey.set(probe.argumentNodeKey, byArgument);
    }
    byArgument.push(frozen);
    let byGate = externalCallbackProbesByGateCallSiteId.get(probe.gateCallSiteId);
    if (!byGate) {
      byGate = [];
      externalCallbackProbesByGateCallSiteId.set(probe.gateCallSiteId, byGate);
    }
    byGate.push(frozen);
  }
  for (const probes of externalCallbackProbesByArgumentNodeKey.values()) {
    probes.sort((left, right) => compareCanonicalText(left.id, right.id));
  }
  for (const probes of externalCallbackProbesByGateCallSiteId.values()) {
    probes.sort((left, right) => compareCanonicalText(left.id, right.id));
  }
  const callSitesByOwner = new Map<string, FiniteProofCallSiteInput[]>();
  for (const site of callSites) {
    if (!site.ownerCallableId) continue;
    let owned = callSitesByOwner.get(site.ownerCallableId);
    if (!owned) {
      owned = [];
      callSitesByOwner.set(site.ownerCallableId, owned);
    }
    owned.push(site);
  }
  for (const owned of callSitesByOwner.values()) {
    owned.sort((left, right) => compareCanonicalText(left.id, right.id));
  }

  const frozenExecutionTopologyIdentity = input.canonicalBytes;
  const topologyFreezeCount = input.topologyFreezeCount;
  let graphSolveCount = 0;
  const unknownFrontiers = [...input.unknownFrontiers].sort((left, right) =>
    compareCanonicalText(left.id, right.id));
  const seenUnknowns = new Set<string>();
  const unknownFrontierById = new Map<string, FiniteProofUnknownFrontierInput>();
  const frontiersByWatchedNode = new Map<string, FiniteProofUnknownFrontierInput[]>();
  const frontiersByOwnerCallableId = new Map<string, FiniteProofUnknownFrontierInput[]>();
  const watchFrontierNode = (
    frontier: FiniteProofUnknownFrontierInput,
    reference: FiniteProofNodeRef | undefined
  ): void => {
    if (!reference) return;
    const node = nodes.get(nodeKey(reference));
    if (!node || node.scenarioId !== frontier.scenarioId) {
      throw new Error(`Unknown frontier ${frontier.id} references an invalid finite node.`);
    }
    let frontiers = frontiersByWatchedNode.get(node.key);
    if (!frontiers) {
      frontiers = [];
      frontiersByWatchedNode.set(node.key, frontiers);
    }
    frontiers.push(frontier);
  };
  for (const frontier of unknownFrontiers) {
    if (seenUnknowns.has(frontier.id)) {
      throw new Error(`Duplicate unknown-frontier identity ${frontier.id}.`);
    }
    seenUnknowns.add(frontier.id);
    unknownFrontierById.set(frontier.id, frontier);
    if (!scenarioSet.has(frontier.scenarioId)) {
      throw new Error(`Unknown frontier ${frontier.id} has an invalid ScenarioPartition.`);
    }
    if (frontier.ownerCallableId &&
      callables.get(frontier.ownerCallableId)?.scenarioId !== frontier.scenarioId) {
      throw new Error(`Unknown frontier ${frontier.id} has an invalid owner CallableId.`);
    }
    if (frontier.ownerCallableId) {
      let owned = frontiersByOwnerCallableId.get(frontier.ownerCallableId);
      if (!owned) {
        owned = [];
        frontiersByOwnerCallableId.set(frontier.ownerCallableId, owned);
      }
      owned.push(frontier);
    }
    watchFrontierNode(frontier, frontier.base);
    if (frontier.operation !== 'property-read') {
      watchFrontierNode(frontier, frontier.source);
    }
    if (frontier.target) {
      const target = nodes.get(nodeKey(frontier.target));
      if (!target || target.scenarioId !== frontier.scenarioId) {
        throw new Error(`Unknown frontier ${frontier.id} has an invalid target node.`);
      }
    }
  }
  for (const frontiers of frontiersByWatchedNode.values()) {
    frontiers.sort((left, right) => compareCanonicalText(left.id, right.id));
  }
  for (const frontiers of frontiersByOwnerCallableId.values()) {
    frontiers.sort((left, right) => compareCanonicalText(left.id, right.id));
  }

  const adjacency = new Map<string, FrozenEdge[]>();
  for (const edge of edges) {
    let outgoing = adjacency.get(edge.sourceKey);
    if (!outgoing) {
      outgoing = [];
      adjacency.set(edge.sourceKey, outgoing);
    }
    outgoing.push(edge);
  }
  for (const outgoing of adjacency.values()) {
    outgoing.sort((left, right) => compareCanonicalText(left.id, right.id));
  }
  const derivationsBySource = new Map<string, FrozenDerivation[]>();
  for (const rule of derivations) {
    let rules = derivationsBySource.get(rule.sourceKey);
    if (!rules) {
      rules = [];
      derivationsBySource.set(rule.sourceKey, rules);
    }
    rules.push(rule);
  }
  for (const rules of derivationsBySource.values()) {
    rules.sort((left, right) => compareCanonicalText(left.id, right.id));
  }
  const callsByCallee = new Map<string, FiniteProofCallSiteInput[]>();
  for (const site of callSites) {
    let sites = callsByCallee.get(nodeKey(site.callee));
    if (!sites) {
      sites = [];
      callsByCallee.set(nodeKey(site.callee), sites);
    }
    sites.push(site);
  }
  for (const sites of callsByCallee.values()) {
    sites.sort((left, right) => compareCanonicalText(left.id, right.id));
  }

  interface MutableFiniteValueState {
    handles: number;
    roles: number;
    callableShapes: number;
    externalContracts: number;
    unknownExecutions: number;
  }
  const emptyValueState = (): MutableFiniteValueState => ({
    handles: 0,
    roles: 0,
    callableShapes: 0,
    externalContracts: 0,
    unknownExecutions: 0
  });
  const valueDomainMask = (
    state: MutableFiniteValueState,
    domain: FiniteValueFactDomain
  ): number => {
    switch (domain) {
      case 'handle': return state.handles;
      case 'role': return state.roles;
      case 'callable-shape': return state.callableShapes;
      case 'external-contract': return state.externalContracts;
      case 'unknown-execution': return state.unknownExecutions;
    }
  };
  const insertValueDomainBit = (
    state: MutableFiniteValueState,
    domain: FiniteValueFactDomain,
    bit: number
  ): void => {
    switch (domain) {
      case 'handle': state.handles |= bit; break;
      case 'role': state.roles |= bit; break;
      case 'callable-shape': state.callableShapes |= bit; break;
      case 'external-contract': state.externalContracts |= bit; break;
      case 'unknown-execution': state.unknownExecutions |= bit; break;
    }
  };
  const hasAnyValueFact = (state: MutableFiniteValueState): boolean =>
    state.handles !== 0 || state.roles !== 0 || state.callableShapes !== 0 ||
    state.externalContracts !== 0 || state.unknownExecutions !== 0;

  type AtomicWork =
    | {
        readonly kind: 'node';
        readonly nodeKey: string;
        readonly domain: FiniteValueFactDomain;
        readonly bit: number;
      }
    | { readonly kind: 'callable-root'; readonly callableId: string; readonly rootBit: number }
    | { readonly kind: 'rooted-call-site'; readonly callSiteId: string; readonly rootBit: number }
    | { readonly kind: 'demand'; readonly nodeKey: string; readonly rootBit: number }
    | {
        readonly kind: 'root-effect';
        readonly scenarioId: string;
        readonly rootBit: number;
        readonly bit: number;
      };
  const queue: AtomicWork[] = [];
  const states = new Map<string, MutableFiniteValueState>();
  const callableRootBits = new Map<string, number>();
  const demandRootBits = new Map<string, number>();
  const rootedCallSiteBitsById = new Map<string, number>();
  const rootEffectStates = new Map<string, number>();
  const callableRootApplications: FiniteProofCallableRootApplicationInput[] = [];
  const invocationDemandApplications: FiniteProofInvocationDemandApplicationInput[] = [];
  const executionReceiptsByKey = new Map<string, FiniteProofExecutionReceipt>();
  const appliedDemandEdgeRootPairs = new Set<string>();
  const demandForwardedPairs = new Set<string>();
  const demandReceiptPairs = new Set<string>();
  const appliedExternalCallbackProbeRootPairs = new Set<string>();
  const locallyDerivedValueFacts = new Set<string>();
  const processedCallPairs = new Set<string>();
  const processedExportPairs = new Set<string>();
  const triggeredFrontierRootPairs = new Set<string>();
  const triggeredFrontierIds = new Set<string>();
  const triggeredUnknownFrontiers = new Map<string, FiniteProofTriggeredUnknownFrontier>();
  let emittedFactCount = 0;
  let processedFactCount = 0;
  let edgeApplicationCount = 0;
  let ruleApplicationCount = 0;
  const emitNodeFact = (key: string, domain: FiniteValueFactDomain, bit: number): void => {
    const state = states.get(key) ?? emptyValueState();
    const current = valueDomainMask(state, domain);
    if ((current & bit) !== 0) return;
    insertValueDomainBit(state, domain, bit);
    states.set(key, state);
    queue.push({ kind: 'node', nodeKey: key, domain, bit });
    emittedFactCount += 1;
  };
  const rootEffectKey = (scenarioId: string, rootBit: number): string =>
    `${scenarioId}\0${rootBit}`;
  const emitRootEffect = (scenarioId: string, rootBit: number, bit: number): void => {
    assertFixedMask(`${scenarioId}/${rootBit} root-local EffectBit`, bit, supportedEffectMask);
    const key = rootEffectKey(scenarioId, rootBit);
    const current = rootEffectStates.get(key) ?? 0;
    if ((current & bit) !== 0) return;
    rootEffectStates.set(key, current | bit);
    queue.push({ kind: 'root-effect', scenarioId, rootBit, bit });
    emittedFactCount += 1;
  };
  const addExecutionReceipt = (input: {
    readonly scenarioId: string;
    readonly rootBit: number;
    readonly nodeKey: string;
    readonly kind: FiniteProofExecutionReceipt['kind'];
    readonly callableId?: string;
    readonly bit: number;
  }): void => {
    const key = `${input.scenarioId}\0${input.rootBit}\0${input.nodeKey}\0${input.kind}\0` +
      `${input.callableId ?? ''}\0${input.bit}`;
    if (executionReceiptsByKey.has(key)) return;
    executionReceiptsByKey.set(key, Object.freeze({
      scenarioId: asScenarioPartition(input.scenarioId),
      rootBit: input.rootBit,
      nodeKey: input.nodeKey,
      kind: input.kind,
      callableId: (input.callableId ?? null) as CallableId | null,
      bit: input.bit
    }));
    demandReceiptPairs.add(`${input.nodeKey}\0${input.rootBit}`);
    if (input.kind === 'unknown') {
      addFinding(
        input.scenarioId,
        'UNRESOLVED_PROTECTED_CALL',
        `${input.nodeKey}: unresolved rooted execution receipt ` +
          `(ExecutionRootBit=${input.rootBit}, UnknownExecutionBit=${input.bit})`,
        `unknown-execution:${input.scenarioId}:${input.rootBit}:${input.nodeKey}:${input.bit}`
      );
    }
  };
  const admitsCallableRoot = (
    callableId: string,
    rootBit: number,
    ingress: 'self-root' | 'demand'
  ): boolean => {
    const terminal = terminalIngressByCallableId.get(callableId);
    if (!terminal) return true;
    return ingress === 'self-root'
      ? terminal.canonicalSelfRootBit === rootBit
      : terminal.admittedDemandRootBits.has(rootBit);
  };
  const emitCallableRoot = (
    callableId: string,
    rootBit: number,
    ingress: 'self-root' | 'demand'
  ): boolean => {
    if (!admitsCallableRoot(callableId, rootBit, ingress)) return false;
    const current = callableRootBits.get(callableId) ?? 0;
    if ((current & rootBit) !== 0) return false;
    callableRootBits.set(callableId, current | rootBit);
    queue.push({ kind: 'callable-root', callableId, rootBit });
    emittedFactCount += 1;
    return true;
  };
  const emitDemand = (key: string, rootBit: number): void => {
    const current = demandRootBits.get(key) ?? 0;
    if ((current & rootBit) !== 0) return;
    demandRootBits.set(key, current | rootBit);
    queue.push({ kind: 'demand', nodeKey: key, rootBit });
    emittedFactCount += 1;
  };
  const emitRootedCallSite = (callSiteId: string, rootBit: number): void => {
    const current = rootedCallSiteBitsById.get(callSiteId) ?? 0;
    if ((current & rootBit) !== 0) return;
    rootedCallSiteBitsById.set(callSiteId, current | rootBit);
    queue.push({ kind: 'rooted-call-site', callSiteId, rootBit });
    emittedFactCount += 1;
  };
  const tryApplyDemandEdge = (edge: FrozenInvocationDemandEdge, rootBit: number): void => {
    if (((demandRootBits.get(edge.targetNodeKey) ?? 0) & rootBit) === 0) return;
    if (edge.gateCallSiteId !== null &&
      ((rootedCallSiteBitsById.get(edge.gateCallSiteId) ?? 0) & rootBit) === 0) return;
    const applicationKey = `${edge.id}\0${rootBit}`;
    if (appliedDemandEdgeRootPairs.has(applicationKey)) return;
    appliedDemandEdgeRootPairs.add(applicationKey);
    demandForwardedPairs.add(`${edge.targetNodeKey}\0${rootBit}`);
    invocationDemandApplications.push(Object.freeze({
      scenarioId: edge.scenarioId,
      rootBit,
      sourceNodeKey: edge.sourceNodeKey,
      targetNodeKey: edge.targetNodeKey,
      kind: edge.kind,
      gateCallSiteId: edge.gateCallSiteId
    }));
    edgeApplicationCount += 1;
    emitDemand(edge.sourceNodeKey, rootBit);
    if (edge.kind === 'external-callback') {
      const targetState = states.get(edge.targetNodeKey) ?? emptyValueState();
      if ((targetState.externalContracts & ExternalContractBit.PromiseExecutor) !== 0) {
        for (const callableId of callableSeedsByNodeKey.get(edge.sourceNodeKey) ?? []) {
          const callable = callables.get(callableId);
          if (!callable) {
            throw new Error(
              `External callback edge ${edge.id} references an unknown CallableId ${callableId}.`
            );
          }
          for (const parameterNodeKey of callable.parameterNodeKeys) {
            emitNodeFact(
              parameterNodeKey,
              'external-contract',
              ExternalContractBit.PromiseExecutor
            );
            addExecutionReceipt({
              scenarioId: edge.scenarioId,
              rootBit,
              nodeKey: parameterNodeKey,
              kind: 'external-contract',
              bit: ExternalContractBit.PromiseExecutor
            });
          }
        }
      }
    }
  };
  const tryApplyExternalCallbackProbe = (
    probe: FrozenExternalCallbackProbe,
    rootBit: number
  ): void => {
    if (((rootedCallSiteBitsById.get(probe.gateCallSiteId) ?? 0) & rootBit) === 0) {
      return;
    }
    const state = states.get(probe.argumentNodeKey) ?? emptyValueState();
    if ((state.callableShapes & probe.callableShapeMask) === 0) return;
    const hasUnknownCallable =
      (state.callableShapes & CallableShapeBit.PotentialCallable) !== 0;
    const protectedFacts = state.roles !== 0 ||
      (state.handles & ~HandleBit.ProcessEnvironment) !== 0;
    if (!hasUnknownCallable || !protectedFacts) return;
    const applicationKey = `${probe.id}\0${rootBit}`;
    if (appliedExternalCallbackProbeRootPairs.has(applicationKey)) return;
    appliedExternalCallbackProbeRootPairs.add(applicationKey);
    ruleApplicationCount += 1;
    addExecutionReceipt({
      scenarioId: probe.scenarioId,
      rootBit,
      nodeKey: probe.argumentNodeKey,
      kind: 'unknown',
      bit: probe.unknownExecutionBit
    });
    emitRootEffect(probe.scenarioId, rootBit, EffectBit.UnknownProtectedExecution);
  };
  const triggerUnknownFrontier = (
    frontier: FiniteProofUnknownFrontierInput,
    rootBit: number
  ): void => {
    const pair = `${frontier.id}\0${rootBit}`;
    if (triggeredFrontierRootPairs.has(pair)) return;
    triggeredFrontierRootPairs.add(pair);
    triggeredFrontierIds.add(frontier.id);
    if (!triggeredUnknownFrontiers.has(frontier.id)) {
      triggeredUnknownFrontiers.set(frontier.id, Object.freeze({
        id: frontier.id as UnknownFrontierId,
        scenarioId: asScenarioPartition(frontier.scenarioId),
        operation: frontier.operation,
        ownerCallableId: (frontier.ownerCallableId ?? null) as CallableId | null,
        code: frontier.code,
        message: frontier.message
      }));
    }
    emitRootEffect(frontier.scenarioId, rootBit, EffectBit.UnknownProtectedExecution);
  };
  const processDemandValueFact = (
    nodeKeyValue: string,
    rootBit: number,
    domain: FiniteValueFactDomain,
    bit: number
  ): void => {
    const node = nodes.get(nodeKeyValue)!;
    const seedMask = domain === 'handle'
      ? node.seedHandles
      : domain === 'role'
        ? node.seedRoles
        : domain === 'callable-shape'
          ? node.seedCallableShapes
          : domain === 'external-contract'
            ? node.seedExternalContracts
            : node.seedUnknownExecutions;
    const localFactKey = `${nodeKeyValue}\0${domain}\0${bit}`;
    if ((seedMask & bit) === 0 && !locallyDerivedValueFacts.has(localFactKey)) return;
    const scenarioId = node.scenarioId;
    if (domain === 'unknown-execution') {
      addExecutionReceipt({
        scenarioId,
        rootBit,
        nodeKey: nodeKeyValue,
        kind: 'unknown',
        bit
      });
      emitRootEffect(scenarioId, rootBit, EffectBit.UnknownProtectedExecution);
      return;
    }
    if (domain === 'external-contract') {
      addExecutionReceipt({
        scenarioId,
        rootBit,
        nodeKey: nodeKeyValue,
        kind: 'external-contract',
        bit
      });
      return;
    }
    if (domain === 'callable-shape' &&
      (bit === CallableShapeBit.NonExecutingBindIntrinsic ||
        bit === CallableShapeBit.ExactExternalCallable)) {
      addExecutionReceipt({
        scenarioId,
        rootBit,
        nodeKey: nodeKeyValue,
        kind: 'known-intrinsic',
        bit
      });
      return;
    }
    if (domain === 'callable-shape' && bit === CallableShapeBit.PotentialCallable) {
      addExecutionReceipt({
        scenarioId,
        rootBit,
        nodeKey: nodeKeyValue,
        kind: 'unknown',
        bit: UnknownExecutionBit.UnresolvedTarget
      });
      emitRootEffect(scenarioId, rootBit, EffectBit.UnknownProtectedExecution);
      return;
    }
    const effect = domain === 'handle'
      ? callEffectForHandle(bit)
      : domain === 'role' ? callEffectForRole(bit) : 0;
    if (effect === 0) return;
    addExecutionReceipt({
      scenarioId,
      rootBit,
      nodeKey: nodeKeyValue,
      kind: 'known-effect',
      bit: effect
    });
    emitRootEffect(scenarioId, rootBit, effect);
  };
  const forEachStateFact = (
    state: MutableFiniteValueState,
    visit: (domain: FiniteValueFactDomain, bit: number) => void
  ): void => {
    for (const entry of VALUE_FACT_DOMAINS) {
      eachSetBit(valueDomainMask(state, entry.domain), entry.bits, (bit) =>
        visit(entry.domain, bit));
    }
  };
  const processRootedCallSiteFact = (
    site: FiniteProofCallSiteInput,
    rootBit: number,
    domain: FiniteValueFactDomain,
    bit: number
  ): void => {
    if (domain !== 'handle' && domain !== 'role') return;
    const pair = `${site.id}\0${rootBit}\0${domain}\0${bit}`;
    if (processedCallPairs.has(pair)) return;
    processedCallPairs.add(pair);
    if (domain === 'role') {
      for (const callableId of roleTargetsByScenarioAndBit.get(
        `${site.scenarioId}\0${bit}`
      ) ?? []) {
        addKnownCallablePair(site.scenarioId, site.id, callableId);
      }
    }
  };
  const frontierHasWatchedFact = (frontier: FiniteProofUnknownFrontierInput): boolean => {
    const references = frontier.operation === 'property-read'
      ? [frontier.base]
      : [frontier.base, frontier.source].filter(
        (reference): reference is FiniteProofNodeRef => reference !== undefined
      );
    return references.some((reference) => {
      const state = states.get(nodeKey(reference)) ?? emptyValueState();
      if (frontier.operation === 'executable-specifier') return hasAnyValueFact(state);
      return (state.handles & ~HandleBit.ProcessEnvironment) !== 0 ||
        state.roles !== 0 || state.unknownExecutions !== 0;
    });
  };

  graphSolveCount += 1;
  for (const root of executionProjection.roots) {
    const terminal = terminalIngressByCallableId.get(root.callableId);
    if (terminal && terminal.canonicalSelfRootBit !== root.rootBit) {
      throw new Error(`Terminal ${root.callableId} has a non-canonical explicit execution root.`);
    }
    emitCallableRoot(root.callableId, root.rootBit, 'self-root');
  }
  for (const node of nodes.values()) {
    eachSetBit(node.seedHandles, HANDLE_BITS, (bit) =>
      emitNodeFact(node.key, 'handle', bit));
    eachSetBit(node.seedRoles, PROTECTED_ROLE_BITS, (bit) =>
      emitNodeFact(node.key, 'role', bit));
    eachSetBit(node.seedCallableShapes, CALLABLE_SHAPE_BITS, (bit) =>
      emitNodeFact(node.key, 'callable-shape', bit));
    eachSetBit(node.seedExternalContracts, EXTERNAL_CONTRACT_BITS, (bit) =>
      emitNodeFact(node.key, 'external-contract', bit));
    eachSetBit(node.seedUnknownExecutions, UNKNOWN_EXECUTION_BITS, (bit) =>
      emitNodeFact(node.key, 'unknown-execution', bit));
  }

  let queueIndex = 0;
  let unresolvedDemandLeavesFinalized = false;
  while (queueIndex < queue.length || !unresolvedDemandLeavesFinalized) {
    if (queueIndex === queue.length) {
      unresolvedDemandLeavesFinalized = true;
      for (const [key, rootBits] of demandRootBits) {
        eachSetBit(rootBits, EXECUTION_ROOT_BITS, (rootBit) => {
          const pair = `${key}\0${rootBit}`;
          if (demandForwardedPairs.has(pair) || demandReceiptPairs.has(pair)) return;
          const leafState = states.get(key) ?? emptyValueState();
          if (!hasAnyValueFact(leafState)) return;
          const scenarioId = nodes.get(key)!.scenarioId;
          emitNodeFact(
            key,
            'unknown-execution',
            UnknownExecutionBit.UnresolvedTarget
          );
          addExecutionReceipt({
            scenarioId,
            rootBit,
            nodeKey: key,
            kind: 'unknown',
            bit: UnknownExecutionBit.UnresolvedTarget
          });
          emitRootEffect(scenarioId, rootBit, EffectBit.UnknownProtectedExecution);
        });
      }
      continue;
    }
    const work = queue[queueIndex++]!;
    processedFactCount += 1;
    if (work.kind === 'root-effect') continue;
    if (work.kind === 'callable-root') {
      const callable = callables.get(work.callableId)!;
      eachSetBit(callable.terminalEffectMask, EFFECT_BITS, (bit) =>
        emitRootEffect(callable.scenarioId, work.rootBit, bit));
      for (const site of callSitesByOwner.get(work.callableId) ?? []) {
        if (site.invocationKind === 'module-initialization' &&
          work.rootBit === ExecutionRootBit.ModuleInitialization) {
          continue;
        }
        emitRootedCallSite(site.id, work.rootBit);
      }
      for (const frontier of frontiersByOwnerCallableId.get(work.callableId) ?? []) {
        if (frontier.operation === 'executable-specifier' ||
          frontierHasWatchedFact(frontier)) {
          triggerUnknownFrontier(frontier, work.rootBit);
        }
      }
      continue;
    }
    if (work.kind === 'rooted-call-site') {
      const site = callSiteById.get(work.callSiteId)!;
      emitDemand(nodeKey(site.callee), work.rootBit);
      for (const edge of demandEdgesByGateCallSiteId.get(work.callSiteId) ?? []) {
        tryApplyDemandEdge(edge, work.rootBit);
      }
      for (const probe of externalCallbackProbesByGateCallSiteId.get(work.callSiteId) ?? []) {
        tryApplyExternalCallbackProbe(probe, work.rootBit);
      }
      forEachStateFact(states.get(nodeKey(site.callee)) ?? emptyValueState(), (domain, bit) =>
        processRootedCallSiteFact(site, work.rootBit, domain, bit));
      continue;
    }
    if (work.kind === 'demand') {
      for (const edge of demandEdgesByTarget.get(work.nodeKey) ?? []) {
        tryApplyDemandEdge(edge, work.rootBit);
      }
      for (const callableId of callableSeedsByNodeKey.get(work.nodeKey) ?? []) {
        const callable = callables.get(callableId)!;
        const terminal = terminalIngressByCallableId.get(callableId);
        const receiptKind: FiniteProofExecutionReceipt['kind'] = terminal
          ? 'known-terminal'
          : 'known-callable';
        addExecutionReceipt({
          scenarioId: callable.scenarioId,
          rootBit: work.rootBit,
          nodeKey: work.nodeKey,
          kind: receiptKind,
          callableId,
          bit: callable.terminalEffectMask
        });
        callableRootApplications.push(Object.freeze({
          scenarioId: callable.scenarioId,
          rootBit: work.rootBit,
          sourceNodeKey: work.nodeKey,
          callableId
        }));
        if (terminal && !admitsCallableRoot(callableId, work.rootBit, 'demand')) {
          eachSetBit(callable.terminalEffectMask, EFFECT_BITS, (bit) =>
            emitRootEffect(callable.scenarioId, work.rootBit, bit));
        } else {
          emitCallableRoot(callableId, work.rootBit, 'demand');
        }
      }
      forEachStateFact(states.get(work.nodeKey) ?? emptyValueState(), (domain, bit) =>
        processDemandValueFact(work.nodeKey, work.rootBit, domain, bit));
      continue;
    }
    for (const edge of adjacency.get(work.nodeKey) ?? []) {
      edgeApplicationCount += 1;
      emitNodeFact(edge.targetKey, work.domain, work.bit);
    }
    for (const rule of derivationsBySource.get(work.nodeKey) ?? []) {
      if (rule.sourceDomain !== work.domain || rule.sourceBit !== work.bit) continue;
      ruleApplicationCount += 1;
      locallyDerivedValueFacts.add(
        `${rule.targetKey}\0${rule.targetDomain}\0${rule.targetBit}`
      );
      emitNodeFact(rule.targetKey, rule.targetDomain, rule.targetBit);
      const targetDemandBits = demandRootBits.get(rule.targetKey) ?? 0;
      eachSetBit(targetDemandBits, EXECUTION_ROOT_BITS, (rootBit) =>
        processDemandValueFact(
          rule.targetKey,
          rootBit,
          rule.targetDomain,
          rule.targetBit
        ));
    }
    for (const frontier of frontiersByWatchedNode.get(work.nodeKey) ?? []) {
      if (!frontier.ownerCallableId) continue;
      if (!frontierHasWatchedFact(frontier)) continue;
      const ownerRootBits = callableRootBits.get(frontier.ownerCallableId) ?? 0;
      eachSetBit(ownerRootBits, EXECUTION_ROOT_BITS, (rootBit) =>
        triggerUnknownFrontier(frontier, rootBit));
    }
    if (work.domain === 'role' || work.domain === 'handle') {
      for (const frontier of frontiersByWatchedNode.get(work.nodeKey) ?? []) {
        if (frontier.ownerCallableId) continue;
        const pair = `${frontier.id}\0structural`;
        if (triggeredFrontierRootPairs.has(pair)) continue;
        triggeredFrontierRootPairs.add(pair);
        triggeredFrontierIds.add(frontier.id);
        if (!triggeredUnknownFrontiers.has(frontier.id)) {
          triggeredUnknownFrontiers.set(frontier.id, Object.freeze({
            id: frontier.id as UnknownFrontierId,
            scenarioId: asScenarioPartition(frontier.scenarioId),
            operation: frontier.operation,
            ownerCallableId: null,
            code: frontier.code,
            message: frontier.message
          }));
        }
      }
    }
    const node = nodes.get(work.nodeKey)!;
    if (node.kind === 'export-slot' && work.domain === 'role') {
      processedExportPairs.add(`${node.id}\0${work.bit}`);
    }
    for (const site of callsByCallee.get(work.nodeKey) ?? []) {
      const rootBits = rootedCallSiteBitsById.get(site.id) ?? 0;
      eachSetBit(rootBits, EXECUTION_ROOT_BITS, (rootBit) =>
        processRootedCallSiteFact(site, rootBit, work.domain, work.bit));
      if (work.domain === 'role') {
        const roleScenarioId = nodes.get(work.nodeKey)!.scenarioId;
        for (const callableId of roleTargetsByScenarioAndBit.get(
          `${roleScenarioId}\0${work.bit}`) ?? []) {
          addKnownCallablePair(roleScenarioId, site.id, callableId);
        }
      }
    }
    const demandBits = demandRootBits.get(work.nodeKey) ?? 0;
    eachSetBit(demandBits, EXECUTION_ROOT_BITS, (rootBit) =>
      processDemandValueFact(work.nodeKey, rootBit, work.domain, work.bit));
    if (work.domain === 'callable-shape') {
      for (const probe of externalCallbackProbesByArgumentNodeKey.get(work.nodeKey) ?? []) {
        const rootBits = rootedCallSiteBitsById.get(probe.gateCallSiteId) ?? 0;
        eachSetBit(rootBits, EXECUTION_ROOT_BITS, (rootBit) =>
          tryApplyExternalCallbackProbe(probe, rootBit));
      }
    }
  }
  if (emittedFactCount !== processedFactCount) {
    throw new Error('Finite authority solver did not process each emitted atomic fact exactly once.');
  }

  const executionRootFacts: FiniteProofExecutionRootFactInput[] = [];
  for (const callableId of [...callables.keys()].sort(compareCanonicalText)) {
    const callable = callables.get(callableId)!;
    executionRootFacts.push(Object.freeze({
      scenarioId: callable.scenarioId,
      callableId,
      ownerKind: callable.ownerKind,
      rootBits: callableRootBits.get(callableId) ?? 0
    }));
  }
  const invocationDemandFacts: FiniteProofInvocationDemandFactInput[] = [];
  for (const [key, rootBits] of [...demandRootBits]
    .sort(([left], [right]) => compareCanonicalText(left, right))) {
    const scenarioId = nodes.get(key)?.scenarioId;
    if (!scenarioId) throw new Error(`Invocation-demand fact ${key} has no frozen node.`);
    eachSetBit(rootBits, EXECUTION_ROOT_BITS, (rootBit) => {
      invocationDemandFacts.push(Object.freeze({ scenarioId, nodeKey: key, rootBit }));
    });
  }
  const rootedCallSites: FiniteProofRootedCallSiteInput[] = [...rootedCallSiteBitsById]
    .map(([callSiteId, rootBits]) => Object.freeze({
      scenarioId: callSiteById.get(callSiteId)!.scenarioId,
      callSiteId,
      rootBits
    }))
    .sort((left, right) => compareCanonicalText(left.callSiteId, right.callSiteId));
  callableRootApplications.sort((left, right) => compareCanonicalText(
    `${left.scenarioId}\0${left.rootBit}\0${left.sourceNodeKey}\0${left.callableId}`,
    `${right.scenarioId}\0${right.rootBit}\0${right.sourceNodeKey}\0${right.callableId}`
  ));
  invocationDemandApplications.sort((left, right) => compareCanonicalText(
    `${left.scenarioId}\0${left.rootBit}\0${left.kind}\0${left.targetNodeKey}\0` +
      `${left.sourceNodeKey}\0${left.gateCallSiteId ?? ''}`,
    `${right.scenarioId}\0${right.rootBit}\0${right.kind}\0${right.targetNodeKey}\0` +
      `${right.sourceNodeKey}\0${right.gateCallSiteId ?? ''}`
  ));
  const executionRootFactCount = executionRootFacts.reduce((count, fact) => {
    let next = count;
    eachSetBit(fact.rootBits, EXECUTION_ROOT_BITS, () => { next += 1; });
    return next;
  }, 0);
  const callableRootApplicationCount = callableRootApplications.length;
  const invocationDemandFactCount = invocationDemandFacts.length;
  const invocationDemandEdgeApplicationCount = invocationDemandApplications.length;
  const rootedCallSiteCount = rootedCallSites.reduce((count, site) => {
    let next = count;
    eachSetBit(site.rootBits, EXECUTION_ROOT_BITS, () => { next += 1; });
    return next;
  }, 0);
  const executionRootWork = executionRootFactCount + callableRootApplicationCount +
    invocationDemandFactCount + invocationDemandEdgeApplicationCount + rootedCallSiteCount;
  const executionRootFactUpperBound = callables.size * EXECUTION_ROOT_BITS.length;
  const callableRootApplicationUpperBound = executionProjection.callableSeeds.length *
    EXECUTION_ROOT_BITS.length;
  const invocationDemandFactUpperBound = nodes.size * EXECUTION_ROOT_BITS.length;
  const invocationDemandEdgeApplicationUpperBound = frozenDemandEdges.length *
    EXECUTION_ROOT_BITS.length;
  const rootedCallSiteUpperBound = callSites.length * EXECUTION_ROOT_BITS.length;
  const externalCallbackProbeApplicationUpperBound = frozenExternalCallbackProbes.length *
    EXECUTION_ROOT_BITS.length;
  const executionRootWorkUpperBound = executionRootFactUpperBound +
    callableRootApplicationUpperBound + invocationDemandFactUpperBound +
    invocationDemandEdgeApplicationUpperBound + rootedCallSiteUpperBound;
  if (executionRootWork > executionRootWorkUpperBound) {
    throw new Error('Execution-root projection exceeded its frozen input-derived bound.');
  }

  const structuralCallSiteEffects = new Map<string, number>();
  for (const site of callSites) {
    const owner = site.ownerCallableId;
    if (owner === undefined) continue;
    const calleeState = states.get(nodeKey(site.callee)) ?? emptyValueState();
    let localEffect = 0;
    eachSetBit(calleeState.roles, PROTECTED_ROLE_BITS, (bit) => {
      localEffect |= callEffectForRole(bit);
      processedCallPairs.add(`${site.id}\0${0}\0role\0${bit}`);
    });
    eachSetBit(calleeState.handles, HANDLE_BITS, (bit) => {
      localEffect |= callEffectForHandle(bit);
    });
    if (callTargetHasUnknown(site.target) && site.policyRequiredClosure === true) {
      localEffect |= EffectBit.UnknownProtectedExecution;
    }
    if (localEffect !== 0) {
      structuralCallSiteEffects.set(
        owner,
        (structuralCallSiteEffects.get(owner) ?? 0) | localEffect
      );
    }
  }
  const structuralLocalEffects = new Map<string, number>();
  for (const callable of callables.keys()) {
    structuralLocalEffects.set(
      callable,
      callables.get(callable)!.terminalEffectMask |
        (structuralCallSiteEffects.get(callable) ?? 0)
    );
  }
  const callersOf = new Map<string, string[]>();
  for (const call of directCalls) {
    const callerScenario = callables.get(call.callerCallableId)?.scenarioId;
    const calleeScenario = callables.get(call.calleeCallableId)?.scenarioId;
    if (callerScenario !== call.scenarioId || calleeScenario !== call.scenarioId) continue;
    let callers = callersOf.get(call.calleeCallableId);
    if (!callers) {
      callers = [];
      callersOf.set(call.calleeCallableId, callers);
    }
    callers.push(call.callerCallableId);
  }
  const structuralStateEffects = new Map<string, number>();
  const structuralExposedEffects = new Map<string, number>();
  for (const callable of callables.keys()) {
    const local = structuralLocalEffects.get(callable) ?? 0;
    const terminal = callables.get(callable)!.terminalEffectMask;
    structuralStateEffects.set(callable, local);
    structuralExposedEffects.set(callable, terminal !== 0 ? terminal : local);
  }
  const structuralWorklist = [...callables.keys()];
  const structuralInWorklist = new Set(structuralWorklist);
  while (structuralWorklist.length > 0) {
    const callee = structuralWorklist.pop()!;
    structuralInWorklist.delete(callee);
    for (const caller of callersOf.get(callee) ?? []) {
      const current = structuralStateEffects.get(caller) ?? 0;
      const next = current | (structuralExposedEffects.get(callee) ?? 0);
      if (next === current) continue;
      structuralStateEffects.set(caller, next);
      structuralExposedEffects.set(
        caller,
        callables.get(caller)!.terminalEffectMask !== 0
          ? callables.get(caller)!.terminalEffectMask
          : next
      );
      if (!structuralInWorklist.has(caller)) {
        structuralInWorklist.add(caller);
        structuralWorklist.push(caller);
      }
    }
  }

  const effectStates = new Map<string, number>();
  for (const [callableId, rootBits] of callableRootBits) {
    const scenarioId = callables.get(callableId)!.scenarioId;
    let effectMask = 0;
    eachSetBit(rootBits, EXECUTION_ROOT_BITS, (rootBit) => {
      effectMask |= rootEffectStates.get(rootEffectKey(scenarioId, rootBit)) ?? 0;
    });
    if (effectMask !== 0) effectStates.set(callableId, effectMask);
  }
  for (const [callableId, effectMask] of structuralStateEffects) {
    if (effectMask !== 0) {
      effectStates.set(callableId, (effectStates.get(callableId) ?? 0) | effectMask);
    }
  }

  const processedRoleCallSitesByBit = new Map<number, Set<string>>();
  for (const pair of processedCallPairs) {
    const [siteId, , domain, rawBit] = pair.split('\0');
    if (domain !== 'role' || siteId === undefined || rawBit === undefined) continue;
    const bit = Number(rawBit);
    let sites = processedRoleCallSitesByBit.get(bit);
    if (!sites) {
      sites = new Set();
      processedRoleCallSitesByBit.set(bit, sites);
    }
    sites.add(siteId);
  }

  const queryIds = new Set<string>();
  for (const query of [...input.queries].sort((left, right) =>
    compareCanonicalText(left.id, right.id))) {
    if (queryIds.has(query.id)) throw new Error(`Duplicate query identity ${query.id}.`);
    queryIds.add(query.id);
    if (!scenarioSet.has(query.scenarioId)) {
      throw new Error(`Query ${query.id} has an unknown ScenarioPartition.`);
    }
    let violated = false;
    if (query.kind === 'forbid-node-fact') {
      const queryNode = nodes.get(nodeKey(query.node));
      if (!queryNode || queryNode.scenarioId !== query.scenarioId) {
        throw new Error(`Query ${query.id} references an unknown node identity.`);
      }
      assertFixedMask(
        `${query.id} forbidden ${query.domain} mask`,
        query.mask,
        query.domain === 'handle' ? supportedHandleMask : supportedRoleMask
      );
      const state = states.get(queryNode.key) ?? emptyValueState();
      violated = ((query.domain === 'handle' ? state.handles : state.roles) & query.mask) !== 0;
    } else if (query.kind === 'require-call-pair-count') {
      assertFixedMask(`${query.id} role mask`, query.role, supportedRoleMask);
      if (query.role === 0 || (query.role & (query.role - 1)) !== 0 ||
        !Number.isSafeInteger(query.expectedCount) || query.expectedCount < 0) {
        throw new Error(`Query ${query.id} has an invalid call-pair cardinality contract.`);
      }
      const allowedSites = new Set(query.callSiteIds);
      if (allowedSites.size !== query.callSiteIds.length) {
        throw new Error(`Query ${query.id} contains duplicate CallSiteId values.`);
      }
      for (const siteId of query.callSiteIds) {
        if (callSiteById.get(siteId)?.scenarioId !== query.scenarioId) {
          throw new Error(`Query ${query.id} references an unknown CallSiteId ${siteId}.`);
        }
      }
      let count = 0;
      const processedSites = processedRoleCallSitesByBit.get(query.role);
      if (processedSites) {
        for (const siteId of allowedSites) {
          if (processedSites.has(siteId)) count += 1;
        }
      }
      violated = count !== query.expectedCount;
    } else if (query.kind === 'forbid-triggered-frontier') {
      const frontierIds = new Set(query.frontierIds);
      if (frontierIds.size !== query.frontierIds.length) {
        throw new Error(`Query ${query.id} contains duplicate unknown-frontier identities.`);
      }
      for (const frontierId of query.frontierIds) {
        if (unknownFrontierById.get(frontierId)?.scenarioId !== query.scenarioId) {
          throw new Error(`Query ${query.id} references an unknown frontier ${frontierId}.`);
        }
      }
      violated = query.frontierIds.some((frontierId) =>
        triggeredFrontierIds.has(frontierId));
    } else {
      if (callables.get(query.callableId)?.scenarioId !== query.scenarioId) {
        throw new Error(`Query ${query.id} references an unknown CallableId.`);
      }
      assertFixedMask(`${query.id} EffectBit mask`, query.mask, supportedEffectMask);
      const effects = effectStates.get(query.callableId) ?? 0;
      violated = query.kind === 'require-effect'
        ? (effects & query.mask) !== query.mask
        : (effects & query.mask) !== 0;
    }
    if (violated) addFinding(query.scenarioId, query.code, query.message, query.id);
  }

  const postSolveExecutionTopologyIdentity = canonicalFiniteAuthorityTopologyBytes(input);
  const postSolveTopologyMutationCount =
    frozenExecutionTopologyIdentity === postSolveExecutionTopologyIdentity ? 0 : 1;
  if (postSolveTopologyMutationCount !== 0) {
    throw new Error('Frozen execution topology changed after the graph solve began.');
  }

  const knownCallablePairs = [...knownCallablePairsByKey.values()]
    .sort((left, right) => compareCanonicalText(
      `${left.scenarioId}\0${left.callSiteId}\0${left.callableId}`,
      `${right.scenarioId}\0${right.callSiteId}\0${right.callableId}`
    ));
  const frozenStructuralCallSites = structuralCallSites.map((site) => {
    const callSite = callSiteById.get(site.callSiteId)!;
    const state = states.get(nodeKey(callSite.callee)) ??
      emptyValueState();
    return Object.freeze({
      ...site,
      target: canonicalCallTarget(
        [...(knownCallableIdsByCallSiteId.get(site.callSiteId) ?? [])],
        callTargetHasUnknown(callSite.target ?? canonicalCallTarget([], true)) ||
          state.unknownExecutions !== 0
      ),
      executionRootBits: rootedCallSiteBitsById.get(site.callSiteId) ?? 0
    });
  });

  const facts = [...nodes.values()].map((node): FiniteProofFactProjection => {
    const state = states.get(node.key) ?? emptyValueState();
    return Object.freeze({
      scenarioId: node.scenarioId,
      nodeKind: node.kind,
      nodeId: node.id,
      handles: state.handles,
      roles: state.roles,
      callableShapes: state.callableShapes,
      externalContracts: state.externalContracts,
      unknownExecutions: state.unknownExecutions
    });
  }).filter((fact) => fact.handles !== 0 || fact.roles !== 0 ||
      fact.callableShapes !== 0 || fact.externalContracts !== 0 ||
      fact.unknownExecutions !== 0)
    .sort((left, right) => compareCanonicalText(
      `${left.scenarioId}\0${left.nodeKind}\0${left.nodeId}`,
      `${right.scenarioId}\0${right.nodeKind}\0${right.nodeId}`
    ));
  const effects = [...callables.keys()].map((callableId): FiniteProofEffectProjection =>
    Object.freeze({
      scenarioId: callables.get(callableId)!.scenarioId,
      callableId: callableId as CallableId,
      effects: effectStates.get(callableId) ?? 0
    })).filter((effect) => effect.effects !== 0)
    .sort((left, right) => compareCanonicalText(
      `${left.scenarioId}\0${left.callableId}`,
      `${right.scenarioId}\0${right.callableId}`
    ));
  const rootEffects = scenarioIds.flatMap((scenarioId) => EXECUTION_ROOT_BITS.map((rootBit) =>
    Object.freeze({
      scenarioId: asScenarioPartition(scenarioId),
      rootBit,
      effects: rootEffectStates.get(rootEffectKey(scenarioId, rootBit)) ?? 0
    }))).sort((left, right) => compareCanonicalText(
    `${left.scenarioId}\0${left.rootBit}`,
    `${right.scenarioId}\0${right.rootBit}`
  ));
  const executionReceipts = [...executionReceiptsByKey.values()].sort((left, right) =>
    compareCanonicalText(
      `${left.scenarioId}\0${left.rootBit}\0${left.nodeKey}\0${left.kind}\0` +
        `${left.callableId ?? ''}\0${left.bit}`,
      `${right.scenarioId}\0${right.rootBit}\0${right.nodeKey}\0${right.kind}\0` +
        `${right.callableId ?? ''}\0${right.bit}`
    ));
  const findings = [...findingsByScenario.values()].flatMap((entries) => [...entries.values()])
    .sort((left, right) => compareCanonicalText(
      `${left.scenarioId}\0${canonicalFindingKey(left)}`,
      `${right.scenarioId}\0${canonicalFindingKey(right)}`
    ));
  const bounds = input.preSolveBounds;
  const atomicFactUpperBound = bounds.atomicFactUpperBound;
  const edgeApplicationUpperBound = bounds.edgeApplicationUpperBound;
  const ruleApplicationUpperBound = bounds.ruleApplicationUpperBound;
  const structuralCallablePairUpperBound = bounds.structuralCallablePairUpperBound;
  const factDomainFieldNames = new Set(facts.flatMap((fact) => Object.keys(fact)));
  const arbitraryCallableFactCount = [
    'callable', 'callableId', 'callableIds', 'callableTarget', 'callableTargets'
  ].filter((field) => factDomainFieldNames.has(field)).length;
  const arbitraryNamespaceFactCount = [
    'namespace', 'namespaceId', 'namespaceIds', 'namespaceTarget', 'namespaceTargets'
  ].filter((field) => factDomainFieldNames.has(field)).length;
  const inputSeedFieldNames = input.nodes.flatMap((node) => Object.keys(node));
  const ambientCrossProductSeedCount = inputSeedFieldNames.filter((field) =>
    field === 'ambientCallableIds' || field === 'ambientNamespaceIds' ||
    field === 'ambientCrossProduct').length;
  const structuralUnknownCallSiteCount = frozenStructuralCallSites.filter((site) =>
    callTargetHasUnknown(site.target)).length;
  const unknownReceiptCount = executionReceipts.filter((receipt) =>
    receipt.kind === 'unknown').length;
  if (emittedFactCount > atomicFactUpperBound ||
    edgeApplicationCount > edgeApplicationUpperBound ||
    ruleApplicationCount > ruleApplicationUpperBound ||
    knownCallablePairs.length > structuralCallablePairUpperBound ||
    structuralUnknownCallSiteCount > callSites.length ||
    executionProjection.condensationEdges.length > directCalls.length ||
    executionRootFactCount > executionRootFactUpperBound ||
    callableRootApplicationCount > callableRootApplicationUpperBound ||
    invocationDemandFactCount > invocationDemandFactUpperBound ||
    invocationDemandEdgeApplicationCount > invocationDemandEdgeApplicationUpperBound ||
    rootedCallSiteCount > rootedCallSiteUpperBound ||
    triggeredFrontierRootPairs.size + unknownReceiptCount >
      seenUnknowns.size * EXECUTION_ROOT_BITS.length +
        invocationDemandFactUpperBound * UNKNOWN_EXECUTION_BITS.length +
        externalCallbackProbeApplicationUpperBound) {
    throw new Error('Finite authority solve exceeded its frozen input-derived bound.');
  }
  if (bounds.valueCount < nodes.size || bounds.edgeCount < edges.length ||
    bounds.ruleCount < derivations.length ||
    bounds.executionRootFactUpperBound !== executionRootFactUpperBound ||
    bounds.callableRootApplicationUpperBound !== callableRootApplicationUpperBound ||
    bounds.invocationDemandFactUpperBound !== invocationDemandFactUpperBound ||
    bounds.invocationDemandEdgeApplicationUpperBound !==
      invocationDemandEdgeApplicationUpperBound ||
    bounds.rootedCallSiteUpperBound !== rootedCallSiteUpperBound ||
    bounds.externalCallbackProbeApplicationUpperBound !==
      externalCallbackProbeApplicationUpperBound ||
    bounds.proofBitCount !== bounds.valueFactBitCount + bounds.effectBitCount +
      bounds.executionRootBitCount) {
    throw new Error('Frozen pre-solve cardinalities diverged from the solved topology.');
  }
  if (topologyFreezeCount !== 1 || graphSolveCount !== 1) {
    throw new Error('Finite authority lifecycle did not perform exactly one freeze and solve.');
  }
  const counters: FiniteProofCounters = Object.freeze({
    topologyFreezeCount,
    graphSolveCount,
    postSolveTopologyMutationCount,
    arbitraryCallableFactCount,
    arbitraryNamespaceFactCount,
    ambientCrossProductSeedCount,
    emittedFactCount,
    processedFactCount,
    processedCallProtectedPairCount: processedCallPairs.size,
    processedStructuralCallablePairCount: knownCallablePairs.length,
    processedExportProtectedPairCount: processedExportPairs.size,
    processedUnknownFrontierCount: seenUnknowns.size,
    structuralUnknownCallSiteCount,
    executionRootCount: executionProjection.roots.length,
    callSccCondensationEdgeCount: executionProjection.condensationEdges.length,
    executionRootWork,
    executionRootFactCount,
    callableRootApplicationCount,
    invocationDemandFactCount,
    invocationDemandEdgeApplicationCount,
    rootedCallSiteCount,
    externalCallbackProbeApplicationCount: appliedExternalCallbackProbeRootPairs.size,
    triggeredExecutionFrontierApplicationCount: triggeredFrontierRootPairs.size +
      unknownReceiptCount,
    edgeApplicationCount,
    ruleApplicationCount
  });
  const compact = deepFreezeOwned({
    facts,
    effects,
    rootEffects,
    executionReceipts,
    knownCallablePairs,
    structuralCallSites: frozenStructuralCallSites,
    executionRootFacts,
    callableRootApplications,
    invocationDemandFacts,
    invocationDemandApplications,
    rootedCallSites,
    findings: findings.map(({
      id, scenarioId, code, ownerCallableId, subjectId, site, message
    }) => ({
      id,
      scenarioId,
      code,
      ownerCallableId,
      subjectId,
      site,
      message
    })),
    processedCallPairs: [...processedCallPairs].sort(compareCanonicalText),
    processedExportPairs: [...processedExportPairs].sort(compareCanonicalText),
    processedUnknownFrontiers: [...seenUnknowns].sort(compareCanonicalText),
    triggeredUnknownFrontiers: [...triggeredUnknownFrontiers.values()]
      .sort((left, right) => compareCanonicalText(left.id, right.id)),
    counters,
    bounds,
    topologyCardinalities: input.cardinalities,
    executionTopologyIdentity: frozenExecutionTopologyIdentity
  });
  return deepFreezeOwned({
    ...compact,
    canonicalBytes: canonicalDigestBytes(compact, 'finite authority proof')
  });
}

type SuiteSourceKind = 'executable' | 'data-package' | 'declaration';

interface SuiteSource {
  readonly scenarioId: string;
  readonly logicalPath: string;
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly source: string;
  readonly isVirtual: boolean;
  readonly kind: SuiteSourceKind;
}

interface ProgramResource {
  readonly scenarioId: string;
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly kind: SuiteSourceKind;
}

interface ProgramModule {
  readonly scenarioId: string;
  readonly id: ModuleId;
  readonly logicalPath: string;
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly sourceFile: ts.SourceFile;
  readonly isVirtual: boolean;
}

interface ProgramContext {
  readonly root: string;
  readonly scenarios: readonly DevRunnerAuthorityScenario[];
  readonly program: ts.Program;
  readonly checker: ts.TypeChecker;
  readonly host: ts.CompilerHost;
  readonly options: ts.CompilerOptions;
  readonly resolutionCache: ts.ModuleResolutionCache;
  readonly modules: readonly ProgramModule[];
  readonly modulesById: ReadonlyMap<string, ProgramModule>;
  readonly modulesByCanonicalPath: ReadonlyMap<string, ProgramModule>;
  readonly modulesBySourceFile: ReadonlyMap<ts.SourceFile, ProgramModule>;
  readonly resourcesByCanonicalPath: ReadonlyMap<string, ProgramResource>;
  readonly canonicalFileName: (fileName: string) => string;
}

export interface DevRunnerAuthorityModuleEdge {
  readonly scenarioId: string;
  readonly sourceModuleId: string;
  readonly targetModuleId: string;
  readonly kind: 'dynamic-import' | 'import' | 'package-surface' | 'require' | 'star-export';
}

export interface DevRunnerAuthorityFinding {
  readonly id: string;
  readonly scenarioId: string;
  readonly code: string;
  readonly ownerCallableId: string | null;
  readonly subjectId: string | null;
  readonly site: string | null;
  readonly message: string;
}

export interface DevRunnerAuthorityScenarioProof {
  readonly scenarioId: string;
  readonly moduleScope: string;
  readonly commandOwnerModuleId: string;
  readonly boundedOwnerModuleId: string;
  readonly processOwnerModuleId: string;
  readonly policyOwnerModuleIds: readonly string[];
  readonly violations: readonly DevRunnerAuthorityFinding[];
  readonly violationCodes: readonly string[];
}

export interface DevRunnerAuthorityProofCounters extends FiniteProofCounters {
  readonly inventoryReadCount: number;
  readonly injectedInventoryCount: number;
  readonly inventorySnapshotCount: number;
  readonly packageJsonSnapshotCount: number;
  readonly programBuildCount: number;
  readonly typeCheckerBuildCount: number;
  readonly moduleResolutionCacheBuildCount: number;
  readonly programSymbolIndexBuildCount: number;
  readonly moduleSccProjectionCount: number;
  readonly callSccProjectionCount: number;
  readonly compactValidationIndexBuildCount: number;
  readonly publicSuiteFreezeCount: number;
}

interface MutableDevRunnerAnalysisLifecycle {
  inventoryReadCount: number;
  injectedInventoryCount: number;
  inventorySnapshotCount: number;
  packageJsonSnapshotCount: number;
  programBuildCount: number;
  typeCheckerBuildCount: number;
  moduleResolutionCacheBuildCount: number;
  programSymbolIndexBuildCount: number;
  moduleSccProjectionCount: number;
  callSccProjectionCount: number;
  compactValidationIndexBuildCount: number;
  publicSuiteFreezeCount: number;
}

function createDevRunnerAnalysisLifecycle(): MutableDevRunnerAnalysisLifecycle {
  return {
    inventoryReadCount: 0,
    injectedInventoryCount: 0,
    inventorySnapshotCount: 0,
    packageJsonSnapshotCount: 0,
    programBuildCount: 0,
    typeCheckerBuildCount: 0,
    moduleResolutionCacheBuildCount: 0,
    programSymbolIndexBuildCount: 0,
    moduleSccProjectionCount: 0,
    callSccProjectionCount: 0,
    compactValidationIndexBuildCount: 0,
    publicSuiteFreezeCount: 0
  };
}

export interface DevRunnerAuthorityProofSuite {
  readonly inventory: TrackedDevRunnerHostInventory;
  readonly scenarioIds: readonly string[];
  readonly moduleIds: readonly string[];
  readonly moduleOwners: Readonly<Record<string, string>>;
  readonly moduleEdges: readonly DevRunnerAuthorityModuleEdge[];
  readonly scenarioProofs: readonly DevRunnerAuthorityScenarioProof[];
  readonly scenarioProofsById: ReadonlyMap<string, DevRunnerAuthorityScenarioProof>;
  readonly finiteProof: FrozenFiniteAuthorityProof;
  readonly counters: DevRunnerAuthorityProofCounters;
  readonly bounds: FiniteProofBounds;
  readonly canonicalBytes: string;
}

function assertCanonicalVirtualPath(root: string, relativePath: string): string {
  if (relativePath.includes('\\') || path.posix.normalize(relativePath) !== relativePath ||
    relativePath === '..' || relativePath.startsWith('../') || path.posix.isAbsolute(relativePath)) {
    throw new Error(`Virtual Program path is not canonical and contained: ${relativePath}.`);
  }
  const absolutePath = path.resolve(root, ...relativePath.split('/'));
  if (!isContainedPath(root, absolutePath)) {
    throw new Error(`Virtual Program path escapes the repository root: ${relativePath}.`);
  }
  return absolutePath;
}

function virtualDirectorySet(
  paths: readonly string[],
  canonical: (value: string) => string
): Set<string> {
  const directories = new Set<string>();
  for (const fileName of paths) {
    let current = path.dirname(fileName);
    while (!directories.has(canonical(current))) {
      directories.add(canonical(current));
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return directories;
}

function jsonProgramSource(value: unknown): string {
  return canonicalSnapshotBytes(value, 'JSON Program source');
}

function suiteSourceKind(relativePath: string): SuiteSourceKind {
  if (path.posix.extname(relativePath).toLowerCase() === '.json') return 'data-package';
  if (/\.d\.(?:c|m)?ts$/iu.test(relativePath)) return 'declaration';
  if (isDevRunnerExecutableSource(relativePath)) return 'executable';
  throw new Error(`Program suite source has an unsupported resource kind: ${relativePath}.`);
}

function buildProgramContext(
  inventory: TrackedDevRunnerHostInventory,
  inputScenarios: readonly DevRunnerAuthorityScenario[],
  lifecycle: MutableDevRunnerAnalysisLifecycle,
  preparedKernel?: ProgramResolutionKernel
): ProgramContext {
  const kernel = preparedKernel ?? createProgramResolutionKernel(lifecycle);
  const { root, options, baseHost, canonicalFileName, resolutionCache } = kernel;
  const scenarios = [...inputScenarios].sort((left, right) =>
    compareCanonicalText(left.scenarioId, right.scenarioId));
  const scenarioIds = new Set<string>();
  for (const scenario of scenarios) {
    if (scenarioIds.has(scenario.scenarioId)) {
      throw new Error(`Duplicate Program proof scenario id ${scenario.scenarioId}.`);
    }
    scenarioIds.add(scenario.scenarioId);
    const expectedScope = scenario.scenarioId === 'live'
      ? ''
      : `__contract__/scenario/${scenario.scenarioId}`;
    if (scenario.moduleScope !== expectedScope) {
      throw new Error(`Scenario ${scenario.scenarioId} has a non-canonical module scope.`);
    }
  }
  if (!scenarioIds.has('live')) {
    throw new Error('Program proof suite requires the exact live scenario.');
  }

  const sources = new Map<string, SuiteSource>();
  const addSource = (
    scenarioId: string,
    logicalPath: string,
    relativePath: string,
    source: string,
    isVirtual: boolean,
    allowExistingLiveRuntimeResource = false
  ): void => {
    const absolutePath = assertCanonicalVirtualPath(root, relativePath);
    const canonical = canonicalFileName(absolutePath);
    const existing = sources.get(canonical);
    if (existing && allowExistingLiveRuntimeResource && scenarioId === 'live' &&
      existing.scenarioId === 'live' && existing.kind === 'data-package') return;
    if (existing) {
      throw new Error(`Duplicate suite Program module identity ${relativePath}.`);
    }
    sources.set(canonical, {
      scenarioId,
      logicalPath,
      relativePath,
      absolutePath,
      source,
      isVirtual,
      kind: suiteSourceKind(relativePath)
    });
  };
  for (const module of inventory.modules) {
    addSource('live', module.relativePath, module.relativePath, module.source, false);
  }
  for (const scenario of scenarios) {
    for (const module of [...scenario.modules].sort((left, right) =>
      compareCanonicalText(left.logicalPath, right.logicalPath))) {
      addSource(
        scenario.scenarioId,
        module.logicalPath,
        devRunnerScenarioModuleId(scenario.scenarioId, module.logicalPath),
        module.source,
        scenario.scenarioId !== 'live'
      );
    }
    for (const surface of [...scenario.packageSurfaces].sort((left, right) =>
      compareCanonicalText(left.relativePath, right.relativePath))) {
      addSource(
        scenario.scenarioId,
        surface.relativePath,
        devRunnerScenarioModuleId(scenario.scenarioId, surface.relativePath),
        jsonProgramSource(surface.value),
        scenario.scenarioId !== 'live',
        true
      );
    }
  }
  const virtualDirectories = virtualDirectorySet(
    [...sources.values()].map(({ absolutePath }) => absolutePath),
    canonicalFileName
  );
  const isExternalProgramPath = (fileName: string): boolean => {
    const absolutePath = path.resolve(fileName);
    if (!isContainedPath(root, absolutePath)) return true;
    const relativePath = path.relative(root, absolutePath);
    return relativePath === 'node_modules' || relativePath.startsWith(`node_modules${path.sep}`);
  };
  let host: ts.CompilerHost;
  const readOverlay = (fileName: string): string | undefined =>
    sources.get(canonicalFileName(fileName))?.source;
  const createOverlaySourceFile = (
    fileName: string,
    languageVersionOrOptions: ts.ScriptTarget | ts.CreateSourceFileOptions,
    sourcePath = fileName
  ): ts.SourceFile | undefined => {
    const overlay = readOverlay(fileName) ?? readOverlay(sourcePath);
    const source = overlay ?? (isExternalProgramPath(fileName)
      ? baseHost.readFile(fileName)
      : undefined);
    if (source === undefined) return undefined;
    const sourceFileOptions: ts.CreateSourceFileOptions =
      typeof languageVersionOrOptions === 'number'
        ? {
            languageVersion: languageVersionOrOptions,
            impliedNodeFormat: ts.getImpliedNodeFormatForFile(fileName, undefined, host, options)
          }
        : {
            ...languageVersionOrOptions,
            impliedNodeFormat: languageVersionOrOptions.impliedNodeFormat ??
              ts.getImpliedNodeFormatForFile(fileName, undefined, host, options)
          };
    return ts.createSourceFile(fileName, source, sourceFileOptions, true);
  };
  host = {
    ...baseHost,
    getCurrentDirectory: () => root,
    getCanonicalFileName: canonicalFileName,
    fileExists: (fileName) => sources.has(canonicalFileName(fileName)) ||
      (isExternalProgramPath(fileName) && baseHost.fileExists(fileName)),
    readFile: (fileName) => readOverlay(fileName) ??
      (isExternalProgramPath(fileName) ? baseHost.readFile(fileName) : undefined),
    realpath: (fileName) => sources.get(canonicalFileName(fileName))?.absolutePath ??
      (isExternalProgramPath(fileName)
        ? baseHost.realpath?.(fileName) ?? path.resolve(fileName)
        : path.resolve(fileName)),
    directoryExists: (directoryName) =>
      virtualDirectories.has(canonicalFileName(directoryName)) ||
      (isExternalProgramPath(directoryName) && baseHost.directoryExists?.(directoryName) === true),
    getDirectories: (directoryName) => {
      const resolved = path.resolve(directoryName);
      const discovered = new Set(isExternalProgramPath(resolved)
        ? baseHost.getDirectories?.(resolved) ?? []
        : []);
      for (const source of sources.values()) {
        const relative = path.relative(resolved, source.absolutePath);
        if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) ||
          path.isAbsolute(relative)) continue;
        const first = relative.split(path.sep)[0];
        if (first && first !== path.basename(source.absolutePath)) discovered.add(first);
      }
      return [...discovered].sort(compareCanonicalText);
    },
    getSourceFile: (fileName, languageVersionOrOptions) =>
      createOverlaySourceFile(fileName, languageVersionOrOptions),
    getSourceFileByPath: (fileName, sourcePath, languageVersionOrOptions) =>
      createOverlaySourceFile(fileName, languageVersionOrOptions, sourcePath),
    resolveModuleNameLiterals: (
      moduleLiterals,
      containingFile,
      redirectedReference,
      compilerOptions,
      containingSourceFile
    ) => moduleLiterals.map((literal) => ts.resolveModuleName(
      literal.text,
      containingFile,
      compilerOptions,
      host,
      resolutionCache,
      redirectedReference,
      ts.getModeForUsageLocation(containingSourceFile, literal, compilerOptions)
    ))
  };
  const rootNames = [...sources.values()]
    .filter(({ kind }) => kind !== 'data-package')
    .map(({ absolutePath }) => absolutePath)
    .sort(compareCanonicalText);
  const program = ts.createProgram({ rootNames, options, host });
  lifecycle.programBuildCount += 1;
  const checker = program.getTypeChecker();
  lifecycle.typeCheckerBuildCount += 1;
  const modules: ProgramModule[] = [];
  const modulesById = new Map<string, ProgramModule>();
  const modulesByCanonicalPath = new Map<string, ProgramModule>();
  const modulesBySourceFile = new Map<ts.SourceFile, ProgramModule>();
  for (const source of sources.values()) {
    if (source.kind !== 'executable') continue;
    const sourceFile = program.getSourceFile(source.absolutePath) ??
      program.getSourceFiles().find((candidate) =>
        canonicalFileName(candidate.fileName) === canonicalFileName(source.absolutePath));
    if (!sourceFile) {
      throw new Error(`Program did not load bounded root ${source.relativePath}.`);
    }
    const canonical = canonicalFileName(sourceFile.fileName);
    if (modulesByCanonicalPath.has(canonical) || modulesById.has(source.relativePath)) {
      throw new Error(`Program contains duplicate canonical module identity ${source.relativePath}.`);
    }
    const module: ProgramModule = Object.freeze({
      scenarioId: source.scenarioId,
      id: source.relativePath as ModuleId,
      logicalPath: source.logicalPath,
      relativePath: source.relativePath,
      absolutePath: source.absolutePath,
      sourceFile,
      isVirtual: source.isVirtual
    });
    modules.push(module);
    modulesById.set(source.relativePath, module);
    modulesByCanonicalPath.set(canonical, module);
    modulesBySourceFile.set(sourceFile, module);
  }
  modules.sort((left, right) => compareCanonicalText(left.relativePath, right.relativePath));
  const resourcesByCanonicalPath = new Map<string, ProgramResource>();
  for (const source of sources.values()) {
    resourcesByCanonicalPath.set(canonicalFileName(source.absolutePath), Object.freeze({
      scenarioId: source.scenarioId,
      relativePath: source.relativePath,
      absolutePath: source.absolutePath,
      kind: source.kind
    }));
  }
  return Object.freeze({
    root,
    scenarios,
    program,
    checker,
    host,
    options,
    resolutionCache,
    modules,
    modulesById,
    modulesByCanonicalPath,
    modulesBySourceFile,
    resourcesByCanonicalPath,
    canonicalFileName
  });
}

function nodeHasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some(
    (modifier) => modifier.kind === kind
  );
}

function isFunctionLikeWithBody(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node) ||
    ts.isConstructorDeclaration(node) || ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node)) && node.body !== undefined;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) || ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current) || ts.isAwaitExpression(current)) {
    current = current.expression;
  }
  return current;
}

function semanticPropertyName(
  name: ts.PropertyName | ts.MemberName | undefined
): string | null {
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name) ||
    ts.isStringLiteral(name)) return name.text;
  if (ts.isNumericLiteral(name)) return String(Number(name.text));
  return null;
}

function isAssignmentOperator(kind: ts.SyntaxKind): boolean {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

function isTypePosition(node: ts.Node): boolean {
  let current: ts.Node | undefined = node;
  while (current?.parent) {
    if (ts.isTypeNode(current.parent) || ts.isImportTypeNode(current.parent)) return true;
    if (ts.isExpression(current.parent) || ts.isStatement(current.parent) ||
      ts.isSourceFile(current.parent)) return false;
    current = current.parent;
  }
  return false;
}

function isReferenceIdentifier(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (isTypePosition(node)) return false;
  if ((ts.isVariableDeclaration(parent) || ts.isParameter(parent) ||
    ts.isFunctionDeclaration(parent) || ts.isClassDeclaration(parent) ||
    ts.isInterfaceDeclaration(parent) || ts.isTypeAliasDeclaration(parent) ||
    ts.isImportClause(parent) || ts.isImportSpecifier(parent) ||
    ts.isNamespaceImport(parent) || ts.isImportEqualsDeclaration(parent) ||
    ts.isBindingElement(parent)) && parent.name === node) return false;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (ts.isQualifiedName(parent) && parent.right === node) return false;
  if ((ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent) ||
    ts.isPropertyDeclaration(parent)) && parent.name === node &&
    !ts.isShorthandPropertyAssignment(parent)) return false;
  return true;
}

class ProgramStaticStringEvaluator {
  private readonly assignedSymbols = new Set<ts.Symbol>();
  private readonly cache = new Map<ts.Symbol, string | null>();
  private readonly resolving = new Set<ts.Symbol>();

  constructor(
    private readonly checker: ts.TypeChecker,
    modules: readonly ProgramModule[]
  ) {
    const recordWrite = (node: ts.Node): void => {
      if (ts.isIdentifier(node)) {
        const symbol = this.checker.getSymbolAtLocation(node);
        if (symbol) this.assignedSymbols.add(symbol);
        return;
      }
      if (ts.isObjectLiteralExpression(node) || ts.isArrayLiteralExpression(node)) return;
      ts.forEachChild(node, recordWrite);
    };
    const visit = (node: ts.Node): void => {
      if (ts.isBinaryExpression(node) && isAssignmentOperator(node.operatorToken.kind)) {
        recordWrite(node.left);
      } else if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
        (node.operator === ts.SyntaxKind.PlusPlusToken ||
          node.operator === ts.SyntaxKind.MinusMinusToken)) {
        recordWrite(node.operand);
      }
      ts.forEachChild(node, visit);
    };
    for (const module of modules) ts.forEachChild(module.sourceFile, visit);
  }

  hasObservedWrite(symbol: ts.Symbol): boolean {
    return this.assignedSymbols.has(symbol);
  }

  evaluate(expression: ts.Expression): string | null {
    const value = unwrapExpression(expression);
    if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) return value.text;
    if (ts.isIdentifier(value)) return this.evaluateIdentifier(value);
    if (ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = this.evaluate(value.left);
      const right = this.evaluate(value.right);
      return left === null || right === null ? null : left + right;
    }
    if (ts.isTemplateExpression(value)) {
      let result = value.head.text;
      for (const span of value.templateSpans) {
        const replacement = this.evaluate(span.expression);
        if (replacement === null) return null;
        result += replacement + span.literal.text;
      }
      return result;
    }
    return null;
  }

  evaluatePropertyKeys(expression: ts.Expression): readonly string[] | null {
    const value = unwrapExpression(expression);
    if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
      return Object.freeze([value.text]);
    }
    if (ts.isNumericLiteral(value)) {
      return Object.freeze([String(Number(value.text))]);
    }
    if (ts.isPrefixUnaryExpression(value) &&
      (value.operator === ts.SyntaxKind.PlusToken ||
        value.operator === ts.SyntaxKind.MinusToken) &&
      ts.isNumericLiteral(value.operand)) {
      const numeric = Number(value.operand.text) *
        (value.operator === ts.SyntaxKind.MinusToken ? -1 : 1);
      return Object.freeze([String(numeric)]);
    }
    if (ts.isIdentifier(value)) {
      const symbol = this.checker.getSymbolAtLocation(value);
      if (symbol && this.assignedSymbols.has(symbol)) return null;
      if (symbol && !this.resolving.has(symbol)) {
        const declarations = symbol.declarations ?? [];
        if (declarations.length === 1 && ts.isVariableDeclaration(declarations[0]) &&
          declarations[0].initializer && ts.isVariableDeclarationList(declarations[0].parent) &&
          (declarations[0].parent.flags & ts.NodeFlags.Const) !== 0) {
          if (!this.isFiniteLiteralUnionType(this.checker.getTypeAtLocation(value))) {
            return null;
          }
          this.resolving.add(symbol);
          const initialized = this.evaluatePropertyKeys(declarations[0].initializer);
          this.resolving.delete(symbol);
          if (initialized !== null) return initialized;
        }
      }
    }
    const exactString = this.evaluate(value);
    if (exactString !== null) return Object.freeze([exactString]);
    const type = this.checker.getTypeAtLocation(value);
    const constituents = type.isUnion() ? type.types : [type];
    const keys: string[] = [];
    for (const constituent of constituents) {
      if ((constituent.flags & ts.TypeFlags.StringLiteral) !== 0) {
        keys.push((constituent as ts.StringLiteralType).value);
      } else if ((constituent.flags & ts.TypeFlags.NumberLiteral) !== 0) {
        keys.push(String((constituent as ts.NumberLiteralType).value));
      } else {
        return null;
      }
    }
    return keys.length === 0
      ? null
      : Object.freeze([...new Set(keys)].sort(compareCanonicalText));
  }

  private isFiniteLiteralUnionType(type: ts.Type): boolean {
    const constituents = type.isUnion() ? type.types : [type];
    return constituents.length > 0 && constituents.every((constituent) =>
      (constituent.flags & (ts.TypeFlags.StringLiteral | ts.TypeFlags.NumberLiteral)) !== 0);
  }

  private evaluateIdentifier(identifier: ts.Identifier): string | null {
    const symbol = this.checker.getSymbolAtLocation(identifier);
    if (!symbol || this.assignedSymbols.has(symbol)) return null;
    if (this.cache.has(symbol)) return this.cache.get(symbol) ?? null;
    if (this.resolving.has(symbol)) return null;
    const declarations = symbol.declarations ?? [];
    if (declarations.length !== 1 || !ts.isVariableDeclaration(declarations[0])) return null;
    const declaration = declarations[0];
    if (!declaration.initializer || !ts.isVariableDeclarationList(declaration.parent) ||
      (declaration.parent.flags & ts.NodeFlags.Const) === 0) return null;
    this.resolving.add(symbol);
    const result = this.evaluate(declaration.initializer);
    this.resolving.delete(symbol);
    this.cache.set(symbol, result);
    return result;
  }
}

export interface FiniteSccProjection {
  readonly components: readonly (readonly string[])[];
  readonly componentByNode: Readonly<Record<string, number>>;
}

export function computeFiniteSccProjection(
  inputNodes: readonly string[],
  inputEdges: readonly { readonly source: string; readonly target: string }[]
): FiniteSccProjection {
  const nodes = [...new Set(inputNodes)].sort(compareCanonicalText);
  const nodeSet = new Set(nodes);
  const outgoingSets = new Map<string, Set<string>>();
  const incomingSets = new Map<string, Set<string>>();
  for (const node of nodes) {
    outgoingSets.set(node, new Set());
    incomingSets.set(node, new Set());
  }
  for (const edge of inputEdges) {
    if (!nodeSet.has(edge.source) || !nodeSet.has(edge.target)) {
      throw new Error(`SCC edge references an unknown structural node: ${edge.source}.`);
    }
    outgoingSets.get(edge.source)!.add(edge.target);
    incomingSets.get(edge.target)!.add(edge.source);
  }
  const outgoing = new Map<string, readonly string[]>();
  const incoming = new Map<string, readonly string[]>();
  for (const node of nodes) {
    outgoing.set(node, [...outgoingSets.get(node)!].sort(compareCanonicalText));
    incoming.set(node, [...incomingSets.get(node)!].sort(compareCanonicalText));
  }

  const visited = new Set<string>();
  const finish: string[] = [];
  for (const root of nodes) {
    if (visited.has(root)) continue;
    const stack: Array<{ readonly node: string; next: number }> = [{ node: root, next: 0 }];
    visited.add(root);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const targets = outgoing.get(frame.node)!;
      if (frame.next < targets.length) {
        const target = targets[frame.next]!;
        frame.next += 1;
        if (!visited.has(target)) {
          visited.add(target);
          stack.push({ node: target, next: 0 });
        }
      } else {
        finish.push(frame.node);
        stack.pop();
      }
    }
  }

  const assigned = new Set<string>();
  const components: string[][] = [];
  for (let index = finish.length - 1; index >= 0; index -= 1) {
    const root = finish[index]!;
    if (assigned.has(root)) continue;
    const component: string[] = [];
    const stack = [root];
    assigned.add(root);
    while (stack.length > 0) {
      const current = stack.pop()!;
      component.push(current);
      for (const source of incoming.get(current)!) {
        if (!assigned.has(source)) {
          assigned.add(source);
          stack.push(source);
        }
      }
    }
    component.sort(compareCanonicalText);
    components.push(component);
  }
  components.sort((left, right) => compareCanonicalText(left[0]!, right[0]!));
  const componentEntries: Array<readonly [string, number]> = [];
  components.forEach((component, componentIndex) => {
    for (const node of component) componentEntries.push([node, componentIndex] as const);
  });
  const componentByNode = Object.fromEntries(componentEntries) as Record<string, number>;
  return deepFreezeOwned({
    components,
    componentByNode
  });
}

interface ExecutionOwnerBase {
  readonly id: CallableId;
  readonly scenarioId: string;
  readonly module: ProgramModule;
  readonly value: FiniteProofNodeRef;
}

interface CallableModel extends ExecutionOwnerBase {
  readonly ownerKind: 'callable';
  readonly declaration: ts.FunctionLikeDeclaration;
  readonly value: FiniteProofNodeRef;
  readonly returnValue: FiniteProofNodeRef;
  readonly parameters: readonly FiniteProofNodeRef[];
  readonly parameterSymbols: readonly (ts.Symbol | null)[];
  readonly symbol: ts.Symbol | null;
  readonly parentCallableId: CallableId | null;
}

interface ModuleInitializerModel extends ExecutionOwnerBase {
  readonly ownerKind: 'module-initializer';
  readonly value: FiniteProofNodeRef;
}

interface SyntheticBoundCallableModel extends ExecutionOwnerBase {
  readonly ownerKind: 'callable';
  readonly syntheticKind: 'bound';
  readonly returnValue: FiniteProofNodeRef;
  readonly parameters: readonly FiniteProofNodeRef[];
  readonly parameterDefaults: readonly (SyntheticBoundParameterDefault | null)[];
  readonly boundArguments: readonly SyntheticBoundArgument[];
  readonly constructKnownCallables: readonly ExecutableCallableModel[];
  readonly hasUnknownConstructTarget: boolean;
  readonly targetCallSiteId: string;
  readonly executesExactExternalTarget: boolean;
}

interface SyntheticBoundParameterDefault {
  readonly source: FiniteProofNodeRef;
  readonly target: FiniteProofNodeRef;
}

interface SyntheticBoundArgument {
  readonly source: FiniteProofNodeRef;
  readonly mayTriggerDefault: boolean;
}

interface SyntheticBoundConstructModel {
  readonly id: string;
  readonly scenarioId: string;
  readonly module: ProgramModule;
  readonly syntheticKind: 'bound-construct';
  readonly value: FiniteProofNodeRef;
  readonly constructClass: ClassModel | null;
  readonly boundArguments: readonly SyntheticBoundArgument[];
  readonly parameterDefaults: readonly (SyntheticBoundParameterDefault | null)[];
}

interface SyntheticImplicitConstructorModel extends ExecutionOwnerBase {
  readonly ownerKind: 'callable';
  readonly syntheticKind: 'implicit-constructor';
  readonly classId: string;
  readonly returnValue: FiniteProofNodeRef;
  readonly parameters: readonly FiniteProofNodeRef[];
  readonly derived: boolean;
}

type ConstructorCallableModel = CallableModel | SyntheticImplicitConstructorModel;

interface ClassModel {
  readonly id: string;
  readonly scenarioId: string;
  readonly module: ProgramModule;
  readonly declaration: ts.ClassLikeDeclaration;
  readonly symbol: ts.Symbol | null;
  readonly value: FiniteProofNodeRef;
  readonly constructorOwner: ConstructorCallableModel;
  readonly constructorKind: 'explicit' | 'implicit';
  readonly parentCallableId: CallableId | null;
  readonly heritageExpression: ts.Expression | null;
}

type ClassMethodKind = 'static' | 'ecmascript-private' | 'instance-override-capable';

interface ClassMethodTarget {
  readonly owner: ClassModel;
  readonly callable: CallableModel;
  readonly kind: ClassMethodKind;
  readonly symbol: ts.Symbol | null;
}

interface SparseClassMethodResolution {
  readonly target: FiniteProofCanonicalCallTarget<CallableId>;
  readonly callables: readonly CallableModel[];
}

type ExecutableCallableModel = CallableModel | SyntheticBoundCallableModel |
  SyntheticImplicitConstructorModel;
type ExecutionOwnerModel = CallableModel | ModuleInitializerModel | SyntheticBoundCallableModel |
  SyntheticImplicitConstructorModel;

function isSyntheticBoundCallable(
  callable: ExecutableCallableModel
): callable is SyntheticBoundCallableModel {
  return 'syntheticKind' in callable && callable.syntheticKind === 'bound';
}

class ProgramSymbolIndex {
  private readonly valueByNode = new Map<ts.Node, FiniteProofNodeRef>();
  private readonly valueBySymbol = new Map<ts.Symbol, FiniteProofNodeRef>();
  private readonly callableByDeclaration = new Map<ts.FunctionLikeDeclaration, CallableModel>();
  private readonly callablesBySymbol = new Map<ts.Symbol, CallableModel[]>();
  private readonly callables: CallableModel[] = [];
  private readonly classByDeclaration = new Map<ts.ClassLikeDeclaration, ClassModel>();
  private readonly classDeclarationsBySymbol =
    new Map<ts.Symbol, ts.ClassLikeDeclaration[]>();
  private readonly classesBySymbol = new Map<ts.Symbol, ClassModel[]>();
  private readonly classMethodByCallableId = new Map<CallableId, ClassMethodTarget>();
  private readonly classMethodsBySymbol = new Map<ts.Symbol, ClassMethodTarget[]>();
  private readonly classByConstructorId = new Map<string, ClassModel>();
  private readonly classes: ClassModel[] = [];
  private readonly implicitConstructors: SyntheticImplicitConstructorModel[] = [];

  constructor(private readonly context: ProgramContext) {
    const pendingClasses: Array<{
      readonly declaration: ts.ClassLikeDeclaration;
      readonly module: ProgramModule;
      readonly parentCallableId: CallableId | null;
    }> = [];
    const discover = (
      node: ts.Node,
      module: ProgramModule,
      parentCallableId: CallableId | null
    ): void => {
      let nestedParent = parentCallableId;
      if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
        pendingClasses.push({ declaration: node, module, parentCallableId });
      }
      if (isFunctionLikeWithBody(node)) {
        const callable = this.createCallable(node, module, parentCallableId);
        nestedParent = callable.id;
      }
      ts.forEachChild(node, (child) => discover(child, module, nestedParent));
    };
    for (const module of context.modules) discover(module.sourceFile, module, null);
    for (const pending of pendingClasses) {
      const symbol = this.classDeclarationSymbol(pending.declaration);
      if (!symbol) continue;
      const identities = new Set([
        symbol,
        ...this.context.checker.getRootSymbols(symbol).map((root) => this.canonicalAlias(root))
      ]);
      for (const identity of identities) {
        let declarations = this.classDeclarationsBySymbol.get(identity);
        if (!declarations) {
          declarations = [];
          this.classDeclarationsBySymbol.set(identity, declarations);
        }
        if (!declarations.includes(pending.declaration)) {
          declarations.push(pending.declaration);
        }
      }
    }
    this.callables.sort((left, right) => compareCanonicalText(left.id, right.id));
    for (const pending of pendingClasses.sort((left, right) => compareCanonicalText(
      `${left.module.relativePath}:${left.declaration.pos}:${left.declaration.end}`,
      `${right.module.relativePath}:${right.declaration.pos}:${right.declaration.end}`
    ))) {
      this.createClass(pending.declaration, pending.module, pending.parentCallableId);
    }
    this.classes.sort((left, right) => compareCanonicalText(left.id, right.id));
    this.implicitConstructors.sort((left, right) => compareCanonicalText(left.id, right.id));
  }

  allCallables(): readonly CallableModel[] {
    return this.callables;
  }

  allClasses(): readonly ClassModel[] {
    return this.classes;
  }

  allImplicitConstructors(): readonly SyntheticImplicitConstructorModel[] {
    return this.implicitConstructors;
  }

  classForDeclaration(declaration: ts.ClassLikeDeclaration): ClassModel | null {
    return this.classByDeclaration.get(declaration) ?? null;
  }

  classForConstructor(owner: { readonly id: string }): ClassModel | null {
    return this.classByConstructorId.get(owner.id) ?? null;
  }

  private exactClassDeclarationAt(
    expression: ts.Expression,
    seenSymbols = new Set<ts.Symbol>()
  ): ts.ClassLikeDeclaration | null {
    const unwrapped = unwrapExpression(expression);
    if (ts.isClassExpression(unwrapped)) return unwrapped;
    const symbol = this.symbolAt(unwrapped, true);
    if (!symbol) return null;
    const identities = new Set([
      symbol,
      ...this.context.checker.getRootSymbols(symbol).map((root) => this.canonicalAlias(root))
    ]);
    const matches = new Set<ts.ClassLikeDeclaration>();
    for (const identity of identities) {
      for (const declaration of this.classDeclarationsBySymbol.get(identity) ?? []) {
        matches.add(declaration);
      }
    }
    if (matches.size === 1) return [...matches][0]!;
    if (matches.size > 1 || seenSymbols.has(symbol)) return null;
    const declarations = symbol.declarations ?? [];
    if (declarations.length !== 1 || !ts.isVariableDeclaration(declarations[0]) ||
      !declarations[0].initializer || !ts.isVariableDeclarationList(declarations[0].parent) ||
      (declarations[0].parent.flags & ts.NodeFlags.Const) === 0) return null;
    seenSymbols.add(symbol);
    const resolved = this.exactClassDeclarationAt(declarations[0].initializer, seenSymbols);
    seenSymbols.delete(symbol);
    return resolved;
  }

  exactClassAt(
    expression: ts.Expression,
    seenSymbols = new Set<ts.Symbol>()
  ): ClassModel | null {
    const unwrapped = unwrapExpression(expression);
    if (ts.isClassExpression(unwrapped)) return this.classForDeclaration(unwrapped);
    const symbol = this.symbolAt(unwrapped, true);
    if (!symbol) return null;
    const identities = new Set([
      symbol,
      ...this.context.checker.getRootSymbols(symbol).map((root) => this.canonicalAlias(root))
    ]);
    const matches = new Set<ClassModel>();
    for (const identity of identities) {
      for (const candidate of this.classesBySymbol.get(identity) ?? []) matches.add(candidate);
    }
    if (matches.size === 1) return [...matches][0]!;
    if (matches.size > 1 || seenSymbols.has(symbol)) return null;
    const declarations = symbol.declarations ?? [];
    if (declarations.length !== 1 || !ts.isVariableDeclaration(declarations[0]) ||
      !declarations[0].initializer || !ts.isVariableDeclarationList(declarations[0].parent) ||
      (declarations[0].parent.flags & ts.NodeFlags.Const) === 0) return null;
    seenSymbols.add(symbol);
    const resolved = this.exactClassAt(declarations[0].initializer, seenSymbols);
    seenSymbols.delete(symbol);
    return resolved;
  }

  exactConstructorAt(expression: ts.Expression): ConstructorCallableModel | null {
    return this.exactClassAt(expression)?.constructorOwner ?? null;
  }

  callableForDeclaration(declaration: ts.FunctionLikeDeclaration): CallableModel | null {
    return this.callableByDeclaration.get(declaration) ?? null;
  }

  callableForExactSymbol(symbol: ts.Symbol | null): CallableModel | null {
    if (!symbol) return null;
    const canonical = this.canonicalAlias(symbol);
    const matches = this.callablesBySymbol.get(canonical) ?? [];
    return matches.length === 1 ? matches[0]! : null;
  }

  private classMethodTargetsForSymbol(symbol: ts.Symbol): readonly ClassMethodTarget[] {
    const identities = new Set([
      this.canonicalAlias(symbol),
      ...this.context.checker.getRootSymbols(symbol).map((root) => this.canonicalAlias(root))
    ]);
    const targets = new Map<CallableId, ClassMethodTarget>();
    for (const identity of identities) {
      for (const target of this.classMethodsBySymbol.get(identity) ?? []) {
        targets.set(target.callable.id, target);
      }
      for (const declaration of identity.declarations ?? []) {
        if (!ts.isMethodDeclaration(declaration) || !declaration.body) continue;
        const callable = this.callableForDeclaration(declaration);
        const target = callable ? this.classMethodByCallableId.get(callable.id) : undefined;
        if (target) targets.set(target.callable.id, target);
      }
    }
    return [...targets.values()].sort((left, right) =>
      compareCanonicalText(left.callable.id, right.callable.id));
  }

  private containingClass(node: ts.Node): ClassModel | null {
    let current: ts.Node | undefined = node;
    while (current) {
      if (ts.isClassDeclaration(current) || ts.isClassExpression(current)) {
        return this.classForDeclaration(current);
      }
      current = current.parent;
    }
    return null;
  }

  private exactClassChainContains(runtimeClass: ClassModel, owner: ClassModel): boolean {
    const visited = new Set<string>();
    let current: ClassModel | null = runtimeClass;
    while (current && !visited.has(current.id)) {
      if (current.id === owner.id) return true;
      visited.add(current.id);
      current = current.heritageExpression
        ? this.exactClassAt(current.heritageExpression)
        : null;
    }
    return false;
  }

  private exactRuntimeClassAt(
    expression: ts.Expression,
    seenSymbols = new Set<ts.Symbol>()
  ): ClassModel | null {
    const value = unwrapExpression(expression);
    if (ts.isNewExpression(value)) return this.exactClassAt(value.expression);
    if (value.kind === ts.SyntaxKind.ThisKeyword) {
      return this.containingClass(value);
    }
    if (!ts.isIdentifier(value)) return null;
    const symbol = this.symbolAt(value, true);
    if (!symbol || seenSymbols.has(symbol)) return null;
    const declarations = symbol.declarations ?? [];
    if (declarations.length !== 1 || !ts.isVariableDeclaration(declarations[0]) ||
      !declarations[0].initializer || !ts.isVariableDeclarationList(declarations[0].parent) ||
      (declarations[0].parent.flags & ts.NodeFlags.Const) === 0) return null;
    seenSymbols.add(symbol);
    const result = this.exactRuntimeClassAt(declarations[0].initializer, seenSymbols);
    seenSymbols.delete(symbol);
    return result;
  }

  resolveClassMethodInvocation(
    expression: ts.Expression
  ): SparseClassMethodResolution | null {
    const access = unwrapExpression(expression);
    if (!ts.isPropertyAccessExpression(access) && !ts.isElementAccessExpression(access)) {
      return null;
    }
    const memberSymbol = this.symbolAt(
      ts.isPropertyAccessExpression(access) ? access.name : access,
      true
    );
    if (!memberSymbol) return null;
    const scenarioId = this.moduleForNode(access).scenarioId;
    const candidates = this.classMethodTargetsForSymbol(memberSymbol)
      .filter((target) => target.owner.scenarioId === scenarioId);
    if (candidates.length === 0) return null;
    const exactPrivate = candidates.filter((target) =>
      target.kind === 'ecmascript-private' &&
      this.containingClass(access)?.id === target.owner.id);
    if (exactPrivate.length === 1) {
      const callable = exactPrivate[0]!.callable;
      return Object.freeze({
        target: canonicalCallTarget([callable.id], false),
        callables: Object.freeze([callable])
      });
    }
    const receiverClassValue = this.exactClassAt(access.expression);
    const exactStatic = receiverClassValue
      ? candidates.filter((target) => target.kind === 'static' &&
          this.exactClassChainContains(receiverClassValue, target.owner))
      : [];
    if (exactStatic.length === 1) {
      const callable = exactStatic[0]!.callable;
      return Object.freeze({
        target: canonicalCallTarget([callable.id], false),
        callables: Object.freeze([callable])
      });
    }
    if (access.expression.kind === ts.SyntaxKind.SuperKeyword) {
      const currentClass = this.containingClass(access);
      const exactBase = currentClass?.heritageExpression
        ? this.exactClassAt(currentClass.heritageExpression)
        : null;
      const exactSuper = exactBase
        ? candidates.filter((target) => this.exactClassChainContains(exactBase, target.owner))
        : [];
      if (exactSuper.length === 1) {
        const callable = exactSuper[0]!.callable;
        return Object.freeze({
          target: canonicalCallTarget([callable.id], false),
          callables: Object.freeze([callable])
        });
      }
    }
    const exactRuntimeClass = this.exactRuntimeClassAt(access.expression);
    const exactInstance = exactRuntimeClass
      ? candidates.filter((target) => target.kind === 'instance-override-capable' &&
          this.exactClassChainContains(exactRuntimeClass, target.owner))
      : [];
    if (exactInstance.length === 1) {
      const callable = exactInstance[0]!.callable;
      return Object.freeze({
        target: canonicalCallTarget([callable.id], false),
        callables: Object.freeze([callable])
      });
    }
    const callables = Object.freeze(candidates.map(({ callable }) => callable));
    return Object.freeze({
      target: canonicalCallTarget(callables.map(({ id }) => id), true),
      callables
    });
  }

  exactCallableAt(
    expression: ts.Expression,
    seenSymbols = new Set<ts.Symbol>()
  ): CallableModel | null {
    const unwrapped = unwrapExpression(expression);
    if (isFunctionLikeWithBody(unwrapped)) {
      return this.callableForDeclaration(unwrapped);
    }
    const symbol = this.symbolAt(unwrapped, true);
    const direct = this.callableForExactSymbol(symbol);
    if (direct && this.classMethodByCallableId.has(direct.id)) return null;
    if (direct || !symbol || seenSymbols.has(symbol)) return direct;
    const declarations = symbol.declarations ?? [];
    if (declarations.length !== 1) return null;
    const declaration = declarations[0]!;
    if (!ts.isVariableDeclaration(declaration) || !declaration.initializer ||
      !ts.isVariableDeclarationList(declaration.parent) ||
      (declaration.parent.flags & ts.NodeFlags.Const) === 0) return null;
    seenSymbols.add(symbol);
    const resolved = this.exactCallableAt(declaration.initializer, seenSymbols);
    seenSymbols.delete(symbol);
    return resolved;
  }

  lexicalSymbol(node: ts.Node | undefined): ts.Symbol | null {
    return node ? this.context.checker.getSymbolAtLocation(node) ?? null : null;
  }

  symbolAt(node: ts.Node | undefined, canonical = false): ts.Symbol | null {
    if (!node) return null;
    const symbol = ts.isIdentifier(node) && ts.isShorthandPropertyAssignment(node.parent) &&
      node.parent.name === node
      ? this.context.checker.getShorthandAssignmentValueSymbol(node.parent)
      : this.context.checker.getSymbolAtLocation(node);
    if (!symbol) return null;
    return canonical ? this.canonicalAlias(symbol) : symbol;
  }

  canonicalAlias(symbol: ts.Symbol): ts.Symbol {
    return (symbol.flags & ts.SymbolFlags.Alias) !== 0
      ? this.context.checker.getAliasedSymbol(symbol)
      : symbol;
  }

  moduleForNode(node: ts.Node): ProgramModule {
    const module = this.context.modulesBySourceFile.get(node.getSourceFile());
    if (!module) throw new Error('Program node is outside the bounded scenario modules.');
    return module;
  }

  valueForExpression(expression: ts.Expression, module: ProgramModule): FiniteProofNodeRef {
    const unwrapped = unwrapExpression(expression);
    if (ts.isClassExpression(unwrapped)) {
      const classModel = this.classForDeclaration(unwrapped);
      if (classModel) return classModel.value;
    }
    if (ts.isIdentifier(unwrapped)) {
      const symbol = this.symbolAt(unwrapped);
      if (symbol) {
        const value = this.valueForBoundedSymbol(symbol, module.scenarioId);
        if (value) return value;
      }
    }
    if (isFunctionLikeWithBody(unwrapped)) {
      const callable = this.callableForDeclaration(unwrapped);
      if (callable) return callable.value;
    }
    return this.valueForNode(unwrapped, module);
  }

  valueForDeclarationName(name: ts.BindingName, module: ProgramModule): FiniteProofNodeRef {
    if (ts.isIdentifier(name)) {
      const symbol = this.symbolAt(name);
      if (symbol) {
        const value = this.valueForBoundedSymbol(symbol, module.scenarioId);
        if (value) return value;
      }
    }
    return this.valueForNode(name, module);
  }

  valueForNode(node: ts.Node, module = this.moduleForNode(node)): FiniteProofNodeRef {
    let value = this.valueByNode.get(node);
    if (!value) {
      value = {
        kind: 'value',
        id: `${module.scenarioId}:value:node:${module.relativePath}:${node.pos}:${node.end}:${node.kind}`
      };
      this.valueByNode.set(node, value);
    }
    return value;
  }

  valueForBoundedSymbol(symbol: ts.Symbol, scenarioId: string): FiniteProofNodeRef | null {
    const declarations = [...(symbol.declarations ?? [])]
      .map((declaration) => ({
        declaration,
        module: this.context.modulesBySourceFile.get(declaration.getSourceFile())
      }))
      .filter((entry): entry is { declaration: ts.Declaration; module: ProgramModule } =>
        entry.module !== undefined && entry.module.scenarioId === scenarioId)
      .sort((left, right) => compareCanonicalText(
        `${left.module.relativePath}:${left.declaration.pos}:${left.declaration.end}`,
        `${right.module.relativePath}:${right.declaration.pos}:${right.declaration.end}`
      ));
    if (declarations.length === 0) return null;
    let value = this.valueBySymbol.get(symbol);
    if (!value) {
      const identity = declarations.map(({ declaration, module }) =>
        `${module.relativePath}:${declaration.pos}:${declaration.end}`).join('|');
      value = { kind: 'value', id: `${scenarioId}:value:symbol:${identity}` };
      this.valueBySymbol.set(symbol, value);
    }
    return value;
  }

  callableContaining(node: ts.Node): CallableModel | null {
    let current: ts.Node | undefined = node;
    while (current) {
      if (isFunctionLikeWithBody(current)) {
        return this.callableForDeclaration(current);
      }
      current = current.parent;
    }
    return null;
  }

  private createCallable(
    declaration: ts.FunctionLikeDeclaration,
    module: ProgramModule,
    parentCallableId: CallableId | null
  ): CallableModel {
    const id = (
      `${module.scenarioId}:callable:${module.relativePath}:${declaration.pos}:${declaration.end}`
    ) as CallableId;
    const value: FiniteProofNodeRef = {
      kind: 'value',
      id: `${module.scenarioId}:value:callable:${module.relativePath}:${declaration.pos}:${declaration.end}`
    };
    const returnValue: FiniteProofNodeRef = {
      kind: 'value',
      id: `${module.scenarioId}:value:return:${module.relativePath}:${declaration.pos}:${declaration.end}`
    };
    const parameters = declaration.parameters.map((parameter, index): FiniteProofNodeRef => ({
      kind: 'value',
      id: `${module.scenarioId}:value:parameter:${module.relativePath}:${declaration.pos}:${index}`
    }));
    const parameterSymbols = declaration.parameters.map((parameter) =>
      ts.isIdentifier(parameter.name) ? this.symbolAt(parameter.name) : null);
    const symbol = this.callableDeclarationSymbol(declaration);
    const callable: CallableModel = Object.freeze({
      id,
      scenarioId: module.scenarioId,
      module,
      ownerKind: 'callable',
      declaration,
      value,
      returnValue,
      parameters,
      parameterSymbols,
      symbol,
      parentCallableId
    });
    this.callableByDeclaration.set(declaration, callable);
    this.callables.push(callable);
    if (symbol) {
      const canonical = this.canonicalAlias(symbol);
      let entries = this.callablesBySymbol.get(canonical);
      if (!entries) {
        entries = [];
        this.callablesBySymbol.set(canonical, entries);
      }
      entries.push(callable);
    }
    return callable;
  }

  private createClass(
    declaration: ts.ClassLikeDeclaration,
    module: ProgramModule,
    parentCallableId: CallableId | null
  ): ClassModel {
    const id = `${module.scenarioId}:class:${module.relativePath}:` +
      `${declaration.pos}:${declaration.end}`;
    const symbol = this.classDeclarationSymbol(declaration);
    const value = symbol
      ? this.valueForBoundedSymbol(symbol, module.scenarioId) ?? this.valueForNode(declaration, module)
      : this.valueForNode(declaration, module);
    const constructorDeclarations = declaration.members.filter(ts.isConstructorDeclaration);
    const bodyBearingConstructors = constructorDeclarations.filter((member) =>
      member.body !== undefined);
    if (bodyBearingConstructors.length > 1 ||
      (constructorDeclarations.length > 0 && bodyBearingConstructors.length !== 1)) {
      throw new Error(
        `Class ${id} must have exactly one body-bearing constructor implementation; ` +
          `overload signatures are declarations only.`
      );
    }
    const explicitDeclaration = bodyBearingConstructors[0] ?? null;
    const explicitConstructor = explicitDeclaration
      ? this.callableForDeclaration(explicitDeclaration)
      : null;
    const heritageExpression = declaration.heritageClauses
      ?.find((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword)
      ?.types[0]?.expression ?? null;
    const implicitParameterCount = explicitConstructor ? 0 :
      this.forwardedConstructorParameterCount(declaration, module.scenarioId);
    const constructorOwner: ConstructorCallableModel = explicitConstructor ?? Object.freeze({
      id: (`${module.scenarioId}:implicit-constructor:${module.relativePath}:` +
        `${declaration.pos}:${declaration.end}`) as CallableId,
      scenarioId: module.scenarioId,
      module,
      ownerKind: 'callable' as const,
      syntheticKind: 'implicit-constructor' as const,
      classId: id,
      value: Object.freeze({
        kind: 'value' as const,
        id: `${module.scenarioId}:value:constructor-execution-seed:${module.relativePath}:` +
          `${declaration.pos}:${declaration.end}`
      }),
      returnValue: Object.freeze({
        kind: 'value' as const,
        id: `${module.scenarioId}:value:implicit-constructor-return:${module.relativePath}:` +
          `${declaration.pos}:${declaration.end}`
      }),
      parameters: Object.freeze(Array.from(
        { length: implicitParameterCount },
        (_, index): FiniteProofNodeRef => Object.freeze({
          kind: 'value',
          id: `${module.scenarioId}:value:implicit-constructor-parameter:` +
            `${module.relativePath}:${declaration.pos}:${index}`
        })
      )),
      derived: heritageExpression !== null
    });
    if (constructorOwner.value.id === value.id && constructorOwner.value.kind === value.kind) {
      throw new Error(`Class ${id} aliases its ClassValue and ConstructorExecutionSeed.`);
    }
    const model: ClassModel = Object.freeze({
      id,
      scenarioId: module.scenarioId,
      module,
      declaration,
      symbol,
      value,
      constructorOwner,
      constructorKind: explicitConstructor ? 'explicit' : 'implicit',
      parentCallableId,
      heritageExpression
    });
    this.classByDeclaration.set(declaration, model);
    this.classByConstructorId.set(constructorOwner.id, model);
    this.classes.push(model);
    this.registerClassMethods(model);
    if (!explicitConstructor) {
      if (!('syntheticKind' in constructorOwner) ||
        constructorOwner.syntheticKind !== 'implicit-constructor') {
        throw new Error(`Class ${id} implicit constructor has an invalid synthetic identity.`);
      }
      this.implicitConstructors.push(constructorOwner);
    }
    if (symbol) {
      const identities = new Set([
        symbol,
        ...this.context.checker.getRootSymbols(symbol).map((root) => this.canonicalAlias(root))
      ]);
      for (const identity of identities) {
        let entries = this.classesBySymbol.get(identity);
        if (!entries) {
          entries = [];
          this.classesBySymbol.set(identity, entries);
        }
        entries.push(model);
      }
    }
    return model;
  }

  private registerClassMethods(owner: ClassModel): void {
    for (const member of owner.declaration.members) {
      if (!ts.isMethodDeclaration(member) || !member.body) continue;
      const callable = this.callableForDeclaration(member);
      if (!callable || callable.scenarioId !== owner.scenarioId ||
        this.classMethodByCallableId.has(callable.id)) {
        throw new Error(`Class method ${owner.id}:${member.pos} has invalid callable identity.`);
      }
      const isStatic = nodeHasModifier(member, ts.SyntaxKind.StaticKeyword);
      const kind: ClassMethodKind = ts.isPrivateIdentifier(member.name)
        ? 'ecmascript-private'
        : isStatic
          ? 'static'
          : 'instance-override-capable';
      const symbol = this.symbolAt(member.name, true);
      const exactDeclarationSymbol = symbol !== null &&
        (symbol.declarations ?? []).some((declaration) => declaration === member)
        ? symbol
        : null;
      const target: ClassMethodTarget = Object.freeze({
        owner,
        callable,
        kind,
        symbol: exactDeclarationSymbol
      });
      this.classMethodByCallableId.set(callable.id, target);
      if (!exactDeclarationSymbol) continue;
      const identities = new Set([
        exactDeclarationSymbol,
        ...this.context.checker.getRootSymbols(exactDeclarationSymbol)
          .map((root) => this.canonicalAlias(root))
      ]);
      for (const identity of identities) {
        let targets = this.classMethodsBySymbol.get(identity);
        if (!targets) {
          targets = [];
          this.classMethodsBySymbol.set(identity, targets);
        }
        if (!targets.some((entry) => entry.callable.id === callable.id)) targets.push(target);
      }
    }
  }

  private forwardedConstructorParameterCount(
    declaration: ts.ClassLikeDeclaration,
    scenarioId: string,
    seen = new Set<ts.ClassLikeDeclaration>()
  ): number {
    if (seen.has(declaration)) return 0;
    seen.add(declaration);
    const constructors = declaration.members.filter(ts.isConstructorDeclaration);
    const implementations = constructors.filter((member) => member.body !== undefined);
    if (implementations.length === 1) {
      const callable = this.callableForDeclaration(implementations[0]!);
      return callable?.parameters.length ?? 0;
    }
    if (constructors.length > 0 || implementations.length > 1) return 0;
    const heritageExpression = declaration.heritageClauses
      ?.find((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword)
      ?.types[0]?.expression;
    if (!heritageExpression) return 0;
    const baseDeclaration = this.exactClassDeclarationAt(heritageExpression);
    if (!baseDeclaration || baseDeclaration === declaration) return 0;
    const baseModule = this.context.modulesBySourceFile.get(baseDeclaration.getSourceFile());
    if (!baseModule || baseModule.scenarioId !== scenarioId) return 0;
    return this.forwardedConstructorParameterCount(baseDeclaration, scenarioId, seen);
  }

  private classDeclarationSymbol(declaration: ts.ClassLikeDeclaration): ts.Symbol | null {
    if (ts.isClassExpression(declaration)) {
      const parent = declaration.parent;
      if (ts.isVariableDeclaration(parent) && parent.initializer === declaration &&
        ts.isIdentifier(parent.name)) {
        return this.symbolAt(parent.name, true);
      }
      if (ts.isPropertyAssignment(parent) && parent.initializer === declaration) {
        return this.symbolAt(parent.name, true);
      }
    }
    return declaration.name && ts.isIdentifier(declaration.name)
      ? this.symbolAt(declaration.name, true)
      : null;
  }

  private callableDeclarationSymbol(declaration: ts.FunctionLikeDeclaration): ts.Symbol | null {
    if (declaration.name && ts.isIdentifier(declaration.name)) {
      return this.symbolAt(declaration.name, true);
    }
    const parent = declaration.parent;
    if (ts.isVariableDeclaration(parent) && parent.initializer === declaration &&
      ts.isIdentifier(parent.name)) {
      return this.symbolAt(parent.name, true);
    }
    if (ts.isPropertyAssignment(parent) && parent.initializer === declaration) {
      return this.symbolAt(parent.name, true);
    }
    return null;
  }
}

class FiniteTopologyAssembler {
  readonly constraints: FiniteProofConstraintInput[] = [];
  readonly callables: FiniteProofCallableInput[] = [];
  readonly directCalls: FiniteProofDirectCallInput[] = [];
  readonly callSites: FiniteProofCallSiteInput[] = [];
  readonly canonicalRoleTargets: FiniteProofCanonicalRoleTargetInput[] = [];
  readonly unknownFrontiers: FiniteProofUnknownFrontierInput[] = [];
  readonly findings: FiniteProofFindingInput[] = [];
  readonly queries: FiniteProofQueryInput[] = [];

  private readonly nodes = new Map<string, FiniteProofNodeInput>();
  private readonly constraintIds = new Set<string>();
  private readonly propertySlots = new Map<string, FiniteProofNodeRef>();
  private readonly propertyNamesByOwner = new Map<string, Set<string>>();
  private readonly canonicalRoleTargetByScenarioRole = new Map<string, string>();
  private readonly unknownIds = new Set<string>();
  private readonly findingIds = new Set<string>();
  private frozen = false;

  ensureNode(
    reference: FiniteProofNodeRef,
    scenarioId: string,
    handles = 0,
    roles = 0,
    callableShapes = 0,
    externalContracts = 0,
    unknownExecutions = 0
  ): FiniteProofNodeRef {
    this.assertMutable();
    const key = nodeKey(reference);
    const current = this.nodes.get(key);
    if (current) {
      if (current.scenarioId !== scenarioId) {
        throw new Error(`Node ${reference.id} changed ScenarioPartition.`);
      }
      if ((current.handles ?? 0) !== ((current.handles ?? 0) | handles) ||
        (current.roles ?? 0) !== ((current.roles ?? 0) | roles) ||
        (current.callableShapes ?? 0) !==
          ((current.callableShapes ?? 0) | callableShapes) ||
        (current.externalContracts ?? 0) !==
          ((current.externalContracts ?? 0) | externalContracts) ||
        (current.unknownExecutions ?? 0) !==
          ((current.unknownExecutions ?? 0) | unknownExecutions)) {
        this.nodes.set(key, {
          ...current,
          handles: (current.handles ?? 0) | handles,
          roles: (current.roles ?? 0) | roles,
          callableShapes: (current.callableShapes ?? 0) | callableShapes,
          externalContracts: (current.externalContracts ?? 0) | externalContracts,
          unknownExecutions: (current.unknownExecutions ?? 0) | unknownExecutions
        });
      }
      return reference;
    }
    this.nodes.set(key, {
      id: reference.id,
      scenarioId,
      kind: reference.kind,
      handles,
      roles,
      callableShapes,
      externalContracts,
      unknownExecutions
    });
    return reference;
  }

  seed(
    reference: FiniteProofNodeRef,
    scenarioId: string,
    input: {
      readonly handles?: number;
      readonly roles?: number;
      readonly callableShapes?: number;
      readonly externalContracts?: number;
      readonly unknownExecutions?: number;
    }
  ): void {
    this.ensureNode(
      reference,
      scenarioId,
      input.handles ?? 0,
      input.roles ?? 0,
      input.callableShapes ?? 0,
      input.externalContracts ?? 0,
      input.unknownExecutions ?? 0
    );
  }

  addFlow(
    kind: 'alias' | 'join' | 'parameter' | 'return' | 'default',
    scenarioId: string,
    source: FiniteProofNodeRef,
    target: FiniteProofNodeRef,
    identity: string
  ): void {
    this.addConstraint({ id: identity, scenarioId, kind, source, target });
  }

  addCanonicalRoleTarget(
    scenarioId: string,
    role: ProtectedRoleBitValue,
    callableId: CallableId
  ): void {
    this.assertMutable();
    const identity = `${scenarioId}\0${role}`;
    const prior = this.canonicalRoleTargetByScenarioRole.get(identity);
    if (prior !== undefined && prior !== callableId) {
      throw new Error(`${identity} has more than one canonical CallableId.`);
    }
    if (prior === callableId) {
      throw new Error(`Duplicate canonical role target ${identity}.`);
    }
    this.canonicalRoleTargetByScenarioRole.set(identity, callableId);
    this.canonicalRoleTargets.push({ scenarioId, role, callableId });
  }

  markCallableTerminal(callableId: string, terminalEffectMask: number): void {
    this.assertMutable();
    const index = this.callables.findIndex(({ id }) => id === callableId);
    if (index < 0) throw new Error(`Unknown terminal CallableId ${callableId}.`);
    this.callables[index] = {
      ...this.callables[index]!,
      terminalEffectMask: (this.callables[index]!.terminalEffectMask ?? 0) | terminalEffectMask
    };
  }

  propertySlot(
    scenarioId: string,
    owner: FiniteProofNodeRef,
    property: string
  ): FiniteProofNodeRef {
    this.assertMutable();
    const key = `${scenarioId}\0${nodeKey(owner)}\0${property}`;
    let slot = this.propertySlots.get(key);
    if (!slot) {
      slot = {
        kind: 'value',
        id: `${scenarioId}:value:property:${owner.id}:${JSON.stringify(property)}`
      };
      this.propertySlots.set(key, slot);
      let properties = this.propertyNamesByOwner.get(`${scenarioId}\0${nodeKey(owner)}`);
      if (!properties) {
        properties = new Set();
        this.propertyNamesByOwner.set(`${scenarioId}\0${nodeKey(owner)}`, properties);
      }
      properties.add(property);
      this.ensureNode(slot, scenarioId);
    }
    return slot;
  }

  knownProperties(scenarioId: string, owner: FiniteProofNodeRef): readonly string[] {
    return [...(this.propertyNamesByOwner.get(`${scenarioId}\0${nodeKey(owner)}`) ?? [])]
      .sort(compareCanonicalText);
  }

  addPropertyWrite(
    scenarioId: string,
    owner: FiniteProofNodeRef,
    property: string,
    source: FiniteProofNodeRef,
    identity: string
  ): FiniteProofNodeRef {
    const slot = this.propertySlot(scenarioId, owner, property);
    this.addConstraint({
      id: `${identity}:write`,
      scenarioId,
      kind: 'property-write',
      owner,
      property,
      source,
      target: slot
    });
    for (const role of PROTECTED_ROLE_BITS.filter((bit) =>
      bit !== ProtectedRoleBit.SensitiveAggregate)) {
      this.addConstraint({
        id: `${identity}:aggregate-role:${role}`,
        scenarioId,
        kind: 'capability-derivation',
        source: slot,
        sourceDomain: 'role',
        sourceBit: role,
        target: owner,
        targetDomain: 'role',
        targetBit: ProtectedRoleBit.SensitiveAggregate
      });
    }
    for (const handle of HANDLE_BITS) {
      this.addConstraint({
        id: `${identity}:aggregate-handle:${handle}`,
        scenarioId,
        kind: 'capability-derivation',
        source: slot,
        sourceDomain: 'handle',
        sourceBit: handle,
        target: owner,
        targetDomain: 'role',
        targetBit: ProtectedRoleBit.SensitiveAggregate
      });
    }
    return slot;
  }

  addPropertyRead(
    scenarioId: string,
    owner: FiniteProofNodeRef,
    property: string,
    target: FiniteProofNodeRef,
    identity: string
  ): FiniteProofNodeRef {
    const slot = this.propertySlot(scenarioId, owner, property);
    this.addConstraint({
      id: `${identity}:read`,
      scenarioId,
      kind: 'property-read',
      owner,
      property,
      source: slot,
      target
    });
    return slot;
  }

  addDerivation(
    scenarioId: string,
    source: FiniteProofNodeRef,
    sourceDomain: FiniteValueFactDomain,
    sourceBit: number,
    target: FiniteProofNodeRef,
    targetDomain: FiniteValueFactDomain,
    targetBit: number,
    identity: string
  ): void {
    this.addConstraint({
      id: identity,
      scenarioId,
      kind: 'capability-derivation',
      source,
      sourceDomain,
      sourceBit,
      target,
      targetDomain,
      targetBit
    });
  }

  addConstraint(constraint: FiniteProofConstraintInput): void {
    this.assertMutable();
    this.ensureNode(constraint.source, constraint.scenarioId);
    this.ensureNode(constraint.target, constraint.scenarioId);
    if (constraint.kind === 'property-read' || constraint.kind === 'property-write') {
      this.ensureNode(constraint.owner, constraint.scenarioId);
    } else if (constraint.kind === 'spread') {
      this.ensureNode(constraint.sourceOwner, constraint.scenarioId);
      this.ensureNode(constraint.targetOwner, constraint.scenarioId);
    }
    if (this.constraintIds.has(constraint.id)) {
      const prior = this.constraints.find((entry) => entry.id === constraint.id);
      if (prior && canonicalSnapshotBytes(prior, 'constraint') !==
        canonicalSnapshotBytes(constraint, 'constraint')) {
        throw new Error(`Conflicting finite constraint identity ${constraint.id}.`);
      }
      return;
    }
    this.constraintIds.add(constraint.id);
    this.constraints.push(constraint);
  }

  addUnknown(frontier: FiniteProofUnknownFrontierInput): void {
    this.assertMutable();
    if (this.unknownIds.has(frontier.id)) {
      const prior = this.unknownFrontiers.find((entry) => entry.id === frontier.id);
      if (prior && canonicalSnapshotBytes(prior, 'unknown frontier') !==
        canonicalSnapshotBytes(frontier, 'unknown frontier')) {
        throw new Error(`Conflicting unknown-frontier identity ${frontier.id}.`);
      }
      return;
    }
    this.unknownIds.add(frontier.id);
    this.ensureNode(frontier.base, frontier.scenarioId);
    if (frontier.source) this.ensureNode(frontier.source, frontier.scenarioId);
    if (frontier.target) this.ensureNode(frontier.target, frontier.scenarioId);
    this.unknownFrontiers.push(frontier);
  }

  addFinding(finding: Omit<FiniteProofFindingInput,
    'ownerCallableId' | 'subjectId' | 'site'> & Partial<Pick<FiniteProofFindingInput,
      'ownerCallableId' | 'subjectId' | 'site'>>): void {
    this.assertMutable();
    if (this.findingIds.has(finding.id)) {
      const prior = this.findings.find((entry) => entry.id === finding.id);
      if (prior && canonicalSnapshotBytes(prior, 'finding') !==
        canonicalSnapshotBytes({
          ...finding,
          ownerCallableId: finding.ownerCallableId ?? null,
          subjectId: finding.subjectId ?? null,
          site: finding.site ?? null
        }, 'finding')) {
        throw new Error(`Conflicting finite finding identity ${finding.id}.`);
      }
      return;
    }
    this.findingIds.add(finding.id);
    this.findings.push({
      ...finding,
      ownerCallableId: finding.ownerCallableId ?? null,
      subjectId: finding.subjectId ?? null,
      site: finding.site ?? null
    });
  }

  releaseTopologyInput(
    scenarioIds: readonly string[],
    executionProjection: FiniteProofExecutionProjectionInput,
    moduleSccTopology: FiniteProofModuleSccTopologyInput,
    classTopology: readonly FiniteProofClassTopologyInput[]
  ): FiniteAuthorityModelInput {
    this.assertMutable();
    this.frozen = true;
    return {
      scenarioIds: [...scenarioIds],
      nodes: [...this.nodes.values()].sort((left, right) =>
        compareCanonicalText(`${left.kind}\0${left.id}`, `${right.kind}\0${right.id}`)),
      constraints: [...this.constraints].sort((left, right) =>
        compareCanonicalText(left.id, right.id)),
      callables: [...this.callables].sort((left, right) =>
        compareCanonicalText(left.id, right.id)),
      directCalls: [...this.directCalls].sort((left, right) =>
        compareCanonicalText(left.id, right.id)),
      callSites: [...this.callSites].sort((left, right) =>
        compareCanonicalText(left.id, right.id)),
      canonicalRoleTargets: [...this.canonicalRoleTargets]
        .sort((left, right) => compareCanonicalText(
          `${left.scenarioId}\0${left.role}\0${left.callableId}`,
          `${right.scenarioId}\0${right.role}\0${right.callableId}`
        )),
      executionProjection,
      unknownFrontiers: [...this.unknownFrontiers].sort((left, right) =>
        compareCanonicalText(left.id, right.id)),
      findings: [...this.findings].sort((left, right) =>
        compareCanonicalText(left.id, right.id)),
      queries: [...this.queries].sort((left, right) =>
        compareCanonicalText(left.id, right.id)),
      moduleSccTopology,
      classTopology
    };
  }

  private assertMutable(): void {
    if (this.frozen) {
      throw new Error('Finite proof topology is immutable after its single freeze.');
    }
  }
}

type CapabilityRegistryEntry =
  | {
      readonly kind: 'ambient-global';
      readonly name: string;
      readonly handles: number;
    }
  | {
      readonly kind: 'ambient-meta';
      readonly name: 'import.meta';
      readonly handles: number;
    }
  | {
      readonly kind: 'external-export';
      readonly specifier: string;
      readonly exportName: string;
      readonly handles: number;
    }
  | {
      readonly kind: 'external-namespace';
      readonly specifier: string;
      readonly handles: number;
    }
  | {
      readonly kind: 'property-derivation';
      readonly sourceHandle: HandleBitValue;
      readonly property: string;
      readonly targetHandles: number;
    }
  | {
      readonly kind: 'immutable-property';
      readonly sourceHandle: HandleBitValue;
      readonly property: string;
    }
  | {
      readonly kind: 'owner-binding';
      readonly moduleRole: 'bounded' | 'command' | 'process' | 'policy';
      readonly exportName: string;
      readonly handles?: number;
      readonly roles?: number;
    };

const CAPABILITY_REGISTRY: readonly CapabilityRegistryEntry[] = Object.freeze([
  { kind: 'ambient-global', name: 'Bun', handles: HandleBit.RuntimeBun },
  { kind: 'ambient-global', name: 'Deno', handles: HandleBit.RuntimeDeno },
  { kind: 'ambient-global', name: 'Function', handles: HandleBit.ExecutableLoader },
  { kind: 'ambient-global', name: 'Object', handles: HandleBit.RuntimeObject },
  { kind: 'ambient-global', name: 'Reflect', handles: HandleBit.RuntimeReflect },
  { kind: 'ambient-global', name: 'Worker', handles: HandleBit.WorkerAuthority },
  { kind: 'ambient-global', name: 'eval', handles: HandleBit.ExecutableLoader },
  { kind: 'ambient-global', name: 'global', handles: HandleBit.RuntimeGlobal },
  { kind: 'ambient-global', name: 'globalThis', handles: HandleBit.RuntimeGlobal },
  { kind: 'ambient-global', name: 'module', handles: HandleBit.RuntimeModule },
  { kind: 'ambient-global', name: 'process', handles: HandleBit.RuntimeProcess },
  {
    kind: 'ambient-meta',
    name: 'import.meta',
    handles: HandleBit.RuntimeImportMeta
  },
  {
    kind: 'ambient-global',
    name: 'require',
    handles: HandleBit.RequireLoader | HandleBit.ExecutableLoader
  },
  {
    kind: 'external-export',
    specifier: 'node:child_process',
    exportName: 'spawn',
    handles: HandleBit.ChildAuthority | HandleBit.ExactNodeChildSpawn
  },
  {
    kind: 'external-export',
    specifier: 'node:child_process',
    exportName: '*',
    handles: HandleBit.ChildAuthority
  },
  {
    kind: 'external-export',
    specifier: 'node:cluster',
    exportName: '*',
    handles: HandleBit.ChildAuthority
  },
  {
    kind: 'external-export',
    specifier: 'node:worker_threads',
    exportName: '*',
    handles: HandleBit.WorkerAuthority
  },
  {
    kind: 'external-export',
    specifier: 'node:os',
    exportName: 'availableParallelism',
    handles: HandleBit.AvailableParallelism
  },
  {
    kind: 'external-export',
    specifier: 'node:process',
    exportName: 'default',
    handles: HandleBit.RuntimeProcess
  },
  {
    kind: 'external-export',
    specifier: 'node:process',
    exportName: '*',
    handles: HandleBit.RuntimeProcess
  },
  {
    kind: 'external-export',
    specifier: 'node:process',
    exportName: 'env',
    handles: HandleBit.ProcessEnvironment
  },
  {
    kind: 'external-namespace',
    specifier: 'bun',
    handles: HandleBit.RuntimeBun
  },
  {
    kind: 'external-export',
    specifier: 'node:module',
    exportName: 'createRequire',
    handles: HandleBit.RequireLoader | HandleBit.ExecutableLoader
  },
  {
    kind: 'property-derivation',
    sourceHandle: HandleBit.RuntimeBun,
    property: '$',
    targetHandles: HandleBit.ChildAuthority
  },
  {
    kind: 'property-derivation',
    sourceHandle: HandleBit.RuntimeBun,
    property: 'env',
    targetHandles: HandleBit.ProcessEnvironment
  },
  {
    kind: 'property-derivation',
    sourceHandle: HandleBit.RuntimeBun,
    property: 'spawn',
    targetHandles: HandleBit.ChildAuthority
  },
  {
    kind: 'property-derivation',
    sourceHandle: HandleBit.RuntimeBun,
    property: 'spawnSync',
    targetHandles: HandleBit.ChildAuthority
  },
  {
    kind: 'property-derivation',
    sourceHandle: HandleBit.RuntimeDeno,
    property: 'Command',
    targetHandles: HandleBit.ChildAuthority
  },
  {
    kind: 'property-derivation',
    sourceHandle: HandleBit.RuntimeDeno,
    property: 'run',
    targetHandles: HandleBit.ChildAuthority
  },
  {
    kind: 'property-derivation',
    sourceHandle: HandleBit.RuntimeGlobal,
    property: 'Bun',
    targetHandles: HandleBit.RuntimeBun
  },
  {
    kind: 'property-derivation',
    sourceHandle: HandleBit.RuntimeGlobal,
    property: 'Deno',
    targetHandles: HandleBit.RuntimeDeno
  },
  {
    kind: 'property-derivation',
    sourceHandle: HandleBit.RuntimeGlobal,
    property: 'process',
    targetHandles: HandleBit.RuntimeProcess
  },
  {
    kind: 'property-derivation',
    sourceHandle: HandleBit.RuntimeGlobal,
    property: 'Worker',
    targetHandles: HandleBit.WorkerAuthority
  },
  {
    kind: 'property-derivation',
    sourceHandle: HandleBit.RuntimeImportMeta,
    property: 'env',
    targetHandles: HandleBit.ProcessEnvironment
  },
  ...['dir', 'dirname', 'file', 'filename', 'main', 'path', 'url'].map((property) => ({
    kind: 'immutable-property' as const,
    sourceHandle: HandleBit.RuntimeImportMeta,
    property
  })),
  {
    kind: 'property-derivation',
    sourceHandle: HandleBit.RuntimeProcess,
    property: 'env',
    targetHandles: HandleBit.ProcessEnvironment
  },
  {
    kind: 'property-derivation',
    sourceHandle: HandleBit.RuntimeProcess,
    property: 'getBuiltinModule',
    targetHandles: HandleBit.RequireLoader | HandleBit.ExecutableLoader
  },
  {
    kind: 'property-derivation',
    sourceHandle: HandleBit.RuntimeModule,
    property: 'require',
    targetHandles: HandleBit.RequireLoader | HandleBit.ExecutableLoader
  },
  {
    kind: 'property-derivation',
    sourceHandle: HandleBit.RuntimeReflect,
    property: 'get',
    targetHandles: HandleBit.ReflectGet
  },
  {
    kind: 'property-derivation',
    sourceHandle: HandleBit.RuntimeObject,
    property: 'assign',
    targetHandles: HandleBit.ObjectAssign
  },
  {
    kind: 'property-derivation',
    sourceHandle: HandleBit.RuntimeObject,
    property: 'defineProperty',
    targetHandles: HandleBit.ObjectDefineProperty
  },
  {
    kind: 'owner-binding',
    moduleRole: 'command',
    exportName: 'runDevCommand',
    roles: ProtectedRoleBit.ReviewedDevCommand
  },
  {
    kind: 'owner-binding',
    moduleRole: 'bounded',
    exportName: 'runBoundedFastTestInvocations',
    roles: ProtectedRoleBit.BoundedExecutor
  },
  {
    kind: 'owner-binding',
    moduleRole: 'bounded',
    exportName: 'gitChangedFiles',
    roles: ProtectedRoleBit.GitChangedFileObservationOwner
  },
  {
    kind: 'owner-binding',
    moduleRole: 'process',
    exportName: 'runCommandBytes',
    roles: ProtectedRoleBit.SharedProcessBytes
  },
  {
    kind: 'owner-binding',
    moduleRole: 'process',
    exportName: 'runCommand',
    roles: ProtectedRoleBit.SharedProcessAlternative
  },
  {
    kind: 'owner-binding',
    moduleRole: 'process',
    exportName: 'runCommandWithRetry',
    roles: ProtectedRoleBit.SharedProcessAlternative
  },
  {
    kind: 'owner-binding',
    moduleRole: 'policy',
    exportName: '*',
    handles: HandleBit.PolicyAuthority
  }
]);

interface ExternalCallbackExecutionContract {
  readonly invocation: 'construct';
  readonly ambientSymbolName: 'Promise';
  readonly parameterIndex: 0;
}

const EXTERNAL_CALLBACK_EXECUTION_CONTRACTS: readonly ExternalCallbackExecutionContract[] =
  Object.freeze([Object.freeze({
    invocation: 'construct',
    ambientSymbolName: 'Promise',
    parameterIndex: 0
  })]);

const BUILTIN_SPECIFIERS = new Set([
  'child_process', 'cluster', 'module', 'os', 'process', 'worker_threads'
]);

function normalizeBuiltinSpecifier(specifier: string): string {
  return specifier.startsWith('node:')
    ? specifier
    : BUILTIN_SPECIFIERS.has(specifier) ? `node:${specifier}` : specifier;
}

function externalCapabilityMask(specifier: string, exportName: string): number {
  const normalized = normalizeBuiltinSpecifier(specifier);
  let handles = 0;
  for (const entry of CAPABILITY_REGISTRY) {
    if (entry.kind === 'external-namespace') {
      if (entry.specifier !== normalized) continue;
      if (exportName === '*') {
        handles |= entry.handles;
      } else {
        eachSetBit(entry.handles, HANDLE_BITS, (sourceHandle) => {
          for (const projection of CAPABILITY_REGISTRY) {
            if (projection.kind === 'property-derivation' &&
              projection.sourceHandle === sourceHandle &&
              projection.property === exportName) {
              handles |= projection.targetHandles;
            }
          }
        });
      }
      continue;
    }
    if (entry.kind !== 'external-export') continue;
    if (entry.specifier !== normalized) continue;
    if (entry.exportName === exportName || entry.exportName === '*') handles |= entry.handles;
  }
  return handles;
}

function externalNamespaceProtectedExportNames(specifier: string): readonly string[] {
  const normalized = normalizeBuiltinSpecifier(specifier);
  const handles = new Set<HandleBitValue>();
  for (const entry of CAPABILITY_REGISTRY) {
    if (entry.kind !== 'external-namespace' || entry.specifier !== normalized) continue;
    eachSetBit(entry.handles, HANDLE_BITS, (handle) => handles.add(handle as HandleBitValue));
  }
  const names = new Set<string>();
  for (const entry of CAPABILITY_REGISTRY) {
    if (entry.kind === 'property-derivation' && handles.has(entry.sourceHandle)) {
      names.add(entry.property);
    }
  }
  return Object.freeze([...names].sort(compareCanonicalText));
}

interface ModuleAcquisition {
  readonly scenarioId: string;
  readonly target: { readonly kind: 'executable'; readonly moduleId: ModuleId } |
    { readonly kind: 'data-package' | 'declaration'; readonly resourceId: string } |
    { readonly kind: 'external'; readonly specifier: string };
}

type AmbientAuthorityUseKind =
  | 'computed-property'
  | 'fixed-property-read'
  | 'mutation'
  | 'whole-value';

interface CompactUseSite {
  readonly scenarioId: string;
  readonly node: FiniteProofNodeRef;
  readonly moduleId: string;
  readonly ownerCallableId: CallableId | null;
  readonly callSiteId: string | null;
  readonly kind: 'call-callee' | 'property-base' | 'whole';
  readonly ambientAuthorityUseKind: AmbientAuthorityUseKind;
  readonly ambientPropertyNames: readonly string[] | null;
  readonly location: string;
}

type GitChangedFileReadOperation =
  | 'changed-diff'
  | 'path-blob'
  | 'rev-parse-base'
  | 'rev-parse-head'
  | 'untracked-files'
  | 'worktree-status';

const GIT_CHANGED_FILE_READ_OPERATIONS = Object.freeze<readonly GitChangedFileReadOperation[]>([
  'changed-diff',
  'path-blob',
  'rev-parse-base',
  'rev-parse-head',
  'untracked-files',
  'worktree-status'
]);

interface CompactCallSite {
  readonly id: string;
  readonly scenarioId: string;
  readonly moduleId: string;
  readonly ownerCallableId: CallableId | null;
  readonly invocationKind: NonNullable<FiniteProofCallSiteInput['invocationKind']>;
  readonly callee: FiniteProofNodeRef;
  readonly exactCanonicalCallee: boolean;
  readonly boundedClosureNested: boolean;
  readonly location: string;
  readonly firstArgumentLiteral: string | null;
  readonly gitChangedFileReadOperation: GitChangedFileReadOperation | null;
  readonly directCapabilityHandles: number;
}

interface ValidatedCompactCallSite extends CompactCallSite {
  readonly target: FiniteProofCanonicalCallTarget<CallableId>;
}

interface CompactExternalAcquisition {
  readonly scenarioId: string;
  readonly moduleId: string;
  readonly specifier: string;
  readonly exportName: string;
  readonly kind: 'default' | 'named' | 'namespace' | 're-export';
  readonly location: string;
}

interface CompactNamespaceUse {
  readonly scenarioId: string;
  readonly targetModuleId: string;
  readonly location: string;
  readonly kind: 'whole' | 'package';
}

interface CompactScenarioBinding {
  readonly scenarioId: string;
  readonly moduleScope: string;
  readonly commandOwnerModuleId: string;
  readonly boundedOwnerModuleId: string;
  readonly processOwnerModuleId: string;
  readonly policyOwnerModuleIds: readonly string[];
  readonly commandCallableId: CallableId | null;
  readonly boundedCallableId: CallableId | null;
  readonly runFastTestsCallableId: CallableId | null;
  readonly affectedTestsBaseRefCallableId: CallableId | null;
  readonly affectedTestsBaseRefExact: boolean;
  readonly gitChangedFilesCallableId: CallableId | null;
  readonly gitChangedFilesPrivateOwner: boolean;
  readonly resolveAffectedTestExecutionCallableId: CallableId | null;
  readonly runCommandBytesCallableId: CallableId | null;
  readonly commandModuleId: string | null;
  readonly boundedModuleId: string | null;
  readonly processModuleId: string | null;
  readonly commandModuleInitializerId: CallableId | null;
  readonly boundedModuleInitializerId: CallableId | null;
  readonly processModuleInitializerId: CallableId | null;
}

interface CompactModuleExportSlots {
  readonly moduleId: string;
  readonly slots: readonly {
    readonly exportName: string;
    readonly node: FiniteProofNodeRef;
  }[];
}

interface CompactValidationPlan {
  readonly scenarioBindings: readonly CompactScenarioBinding[];
  readonly moduleIds: readonly { readonly scenarioId: string; readonly moduleId: string }[];
  readonly uses: readonly CompactUseSite[];
  readonly calls: readonly CompactCallSite[];
  readonly unknownFrontiers: readonly FiniteProofUnknownFrontierInput[];
  readonly namespaceUses: readonly CompactNamespaceUse[];
  readonly externalAcquisitions: readonly CompactExternalAcquisition[];
  readonly moduleExportSlots: readonly CompactModuleExportSlots[];
}


interface FrozenCompactValidationProjection extends CompactValidationPlan {
  readonly topology: FrozenFiniteAuthorityTopology;
  readonly proof: FrozenFiniteAuthorityProof;
}

interface RawModuleEdge {
  readonly scenarioId: string;
  readonly sourceModuleId: string;
  readonly targetModuleId: string;
  readonly kind: DevRunnerAuthorityModuleEdge['kind'];
}

interface RawStaticModuleActivationEdge {
  readonly scenarioId: string;
  readonly sourceModuleId: string;
  readonly targetModuleId: string;
  readonly kind: 'import' | 'star-export';
}

interface RawStarExport {
  readonly source: ProgramModule;
  readonly target: ProgramModule;
  readonly identity: string;
}

interface RawExternalStarExport {
  readonly source: ProgramModule;
  readonly specifier: string;
  readonly identity: string;
}

function programLocation(module: ProgramModule, node: ts.Node): string {
  const location = module.sourceFile.getLineAndCharacterOfPosition(Math.max(0, node.getStart()));
  return `${module.relativePath}:${location.line + 1}:${location.character + 1}`;
}

function programCallSiteId(
  module: ProgramModule,
  node: ts.CallExpression | ts.NewExpression
): string {
  return `${module.scenarioId}:call:${module.relativePath}:${node.pos}:${node.end}`;
}

interface RawCallSite {
  readonly input: FiniteProofCallSiteInput;
  readonly node: ts.CallExpression | ts.NewExpression;
  readonly module: ProgramModule;
  readonly owner: ExecutionOwnerModel;
  readonly knownCallables: readonly ExecutableCallableModel[];
}

interface RawStructuralCallEdge {
  readonly caller: ExecutionOwnerModel;
  readonly callee: ExecutableCallableModel;
  readonly identity: string;
}

interface RawInvocationDemandEdge {
  readonly scenarioId: string;
  readonly source: FiniteProofNodeRef;
  readonly target: FiniteProofNodeRef;
  readonly kind: Exclude<FiniteProofInvocationDemandEdgeInput['kind'], 'fixed-flow'>;
  readonly gateCallSiteId: string;
  readonly identity: string;
}

interface RawExternalCallbackProbe {
  readonly id: string;
  readonly scenarioId: string;
  readonly argument: FiniteProofNodeRef;
  readonly gateCallSiteId: string;
}

interface NormalizedInvocation {
  readonly kind: NonNullable<FiniteProofCallSiteInput['invocationKind']>;
  readonly targetExpression: ts.Expression;
  readonly argumentExpressions: readonly ts.Expression[];
  readonly hasOpaqueArgumentList: boolean;
  readonly target: FiniteProofCanonicalCallTarget<CallableId>;
  readonly knownCallables: readonly ExecutableCallableModel[];
}

class ProgramAuthorityLowerer {
  private readonly assembler = new FiniteTopologyAssembler();
  private readonly index: ProgramSymbolIndex;
  private readonly callableById = new Map<string, CallableModel>();
  private readonly evaluator: ProgramStaticStringEvaluator;
  private readonly moduleEdges: RawModuleEdge[] = [];
  private readonly staticModuleActivationEdges: RawStaticModuleActivationEdge[] = [];
  private readonly starExports: RawStarExport[] = [];
  private readonly starExportKeys = new Set<string>();
  private readonly externalStarExports: RawExternalStarExport[] = [];
  private readonly externalStarExportKeys = new Set<string>();
  private readonly directExportNamesByModule = new Map<string, Set<string>>();
  private readonly moduleEdgeKeys = new Set<string>();
  private readonly staticModuleActivationEdgeKeys = new Set<string>();
  private readonly namespaceExports: Array<{
    readonly source: ProgramModule;
    readonly target: ProgramModule;
    readonly exportName: string;
    readonly identity: string;
  }> = [];
  private readonly exportSlotsByModule = new Map<string, Map<string, FiniteProofNodeRef>>();
  private readonly acquisitionsByValue = new Map<string, ModuleAcquisition>();
  private readonly acquisitionsBySymbol = new Map<ts.Symbol, ModuleAcquisition>();
  private readonly externalMasksBySymbol = new Map<ts.Symbol, number>();
  private readonly staticCapabilityHintsByValue = new Map<string, number>();
  private readonly intrinsicInvocationSymbols =
    new Map<string, ReadonlySet<ts.Symbol>>();
  private readonly defaultLibraryValueSymbols =
    new Map<string, ReadonlySet<ts.Symbol>>();
  private readonly pinnedAmbientValueSymbols =
    new Map<string, ReadonlySet<ts.Symbol>>();
  private readonly ambientValueSymbols =
    new Map<string, ReadonlySet<ts.Symbol>>();
  private readonly pinnedTypeReferenceDeclarationSources: ReadonlySet<ts.SourceFile>;
  private readonly uses: CompactUseSite[] = [];
  private readonly rawCalls: RawCallSite[] = [];
  private readonly rawStructuralCallEdges: RawStructuralCallEdge[] = [];
  private readonly rawInvocationDemandEdges: RawInvocationDemandEdge[] = [];
  private readonly rawExternalCallbackProbes: RawExternalCallbackProbe[] = [];
  private readonly syntheticBoundCallables: SyntheticBoundCallableModel[] = [];
  private readonly syntheticBoundCallableByValueNodeKey =
    new Map<string, SyntheticBoundCallableModel>();
  private readonly syntheticBoundConstructByValueNodeKey =
    new Map<string, SyntheticBoundConstructModel>();
  private readonly classDefinitionOwnerById = new Map<string, CallableId>();
  private readonly classEvaluationSitesById =
    new Map<string, FiniteProofClassEvaluationSiteInput[]>();
  private readonly classHeritageResolutionById = new Map<
    string,
    FiniteProofClassTopologyInput['heritageResolution']
  >();
  private readonly terminalCallableIds = new Set<string>();
  private readonly moduleInitializersByModuleId = new Map<string, ModuleInitializerModel>();
  private readonly namespaceUses: CompactNamespaceUse[] = [];
  private readonly externalAcquisitions: CompactExternalAcquisition[] = [];
  private moduleSccTopology: FiniteProofModuleSccTopologyInput = deepFreezeOwned({
    components: [],
    condensationEdges: [],
    starExportClosures: []
  });

  constructor(
    private readonly context: ProgramContext,
    private readonly lifecycle: MutableDevRunnerAnalysisLifecycle
  ) {
    this.index = new ProgramSymbolIndex(context);
    for (const callable of this.index.allCallables()) {
      this.callableById.set(callable.id, callable);
    }
    this.lifecycle.programSymbolIndexBuildCount += 1;
    this.evaluator = new ProgramStaticStringEvaluator(context.checker, context.modules);
    this.pinnedTypeReferenceDeclarationSources =
      this.resolvePinnedTypeReferenceDeclarationSources();
    for (const module of context.modules) {
      const initializer = Object.freeze({
        id: `${module.scenarioId}:module-initializer:${module.relativePath}` as CallableId,
        scenarioId: module.scenarioId,
        module,
        ownerKind: 'module-initializer' as const,
        value: Object.freeze({
          kind: 'value' as const,
          id: `${module.scenarioId}:value:module-initializer:${module.relativePath}`
        })
      });
      this.moduleInitializersByModuleId.set(module.relativePath, initializer);
    }
    this.registerCallableTopology();
  }

  lower(): {
    readonly model: FiniteAuthorityModelInput;
    readonly moduleEdges: readonly RawModuleEdge[];
    readonly validationPlan: CompactValidationPlan;
    readonly moduleSccProjection: FiniteSccProjection;
    readonly callSccProjection: FiniteSccProjection;
  } {
    this.lowerStaticModuleSurfaces();
    for (const module of this.context.modules) {
      this.wireNode(
        module.sourceFile,
        module,
        this.moduleInitializersByModuleId.get(module.relativePath)!
      );
      for (const diagnostic of this.context.program.getSyntacticDiagnostics(module.sourceFile)) {
        this.assembler.addFinding({
          id: `syntax:${module.relativePath}:${diagnostic.start ?? -1}`,
          scenarioId: module.scenarioId,
          code: 'SYNTACTIC_DIAGNOSTIC',
          message: `${module.relativePath}: syntax diagnostic: ${ts.flattenDiagnosticMessageText(
            diagnostic.messageText,
            '\n'
          )}`
        });
      }
    }
    for (const use of this.uses) {
      this.assembler.ensureNode(use.node, use.scenarioId);
    }
    const moduleSccProjection = this.finalizeModuleSurfaces();
    const scenarioBindings = this.bindScenarioOwners();
    const callTopology = this.finalizeCallTopology(scenarioBindings);
    const model = this.assembler.releaseTopologyInput(
      this.context.scenarios.map(({ scenarioId }) => scenarioId),
      callTopology.executionProjection,
      this.moduleSccTopology,
      this.classTopologyInputs()
    );
    const frozenNode = (node: FiniteProofNodeRef): FiniteProofNodeRef =>
      Object.freeze({ ...node });
    const validationPlan: CompactValidationPlan = Object.freeze({
      scenarioBindings: Object.freeze(scenarioBindings),
      moduleIds: Object.freeze(this.context.modules.map((module) => Object.freeze({
        scenarioId: module.scenarioId,
        moduleId: module.relativePath
      })).sort((left, right) => compareCanonicalText(left.moduleId, right.moduleId))),
      uses: Object.freeze(this.uses.map((use) => Object.freeze({
        ...use,
        node: frozenNode(use.node)
      })).sort((left, right) => compareCanonicalText(
        `${left.scenarioId}\0${left.location}\0${left.kind}\0${left.callSiteId ?? ''}`,
        `${right.scenarioId}\0${right.location}\0${right.kind}\0${right.callSiteId ?? ''}`
      ))),
      calls: Object.freeze((() => {
        const rawCallByInputId = new Map(this.rawCalls.map(({ input }) => [
          input.id,
          input
        ] as const));
        const rawNodeByInputId = new Map(this.rawCalls.map(({ input, node }) => [
          input.id,
          node
        ] as const));
        const rawOwnerByInputId = new Map(this.rawCalls.map(({ input, owner }) => [
          input.id,
          owner
        ] as const));
        return [...this.assembler.callSites].map((input) => {
          const rawInput = rawCallByInputId.get(input.id);
          const rawNode = rawNodeByInputId.get(input.id);
          const rawOwner = rawOwnerByInputId.get(input.id);
          const module = rawInput
            ? this.context.modulesById.get(rawInput.moduleId ?? '')
            : input.moduleId
              ? this.context.modulesById.get(input.moduleId)
              : undefined;
          return Object.freeze({
            id: input.id,
            scenarioId: input.scenarioId,
            moduleId: module?.relativePath ?? input.moduleId ?? '',
            ownerCallableId: (input.ownerCallableId ?? null) as CallableId | null,
            invocationKind: input.invocationKind ?? 'other',
            callee: frozenNode(input.callee),
            exactCanonicalCallee: rawNode
              ? this.exactCanonicalCalleeFor(rawNode)
              : false,
            boundedClosureNested: rawOwner && module
              ? this.boundedClosureNestedOwner(rawOwner, module)
              : false,
            location: input.location,
            firstArgumentLiteral: rawNode?.arguments?.[0] &&
              ts.isStringLiteral(rawNode.arguments[0])
              ? rawNode.arguments[0].text
              : null,
            gitChangedFileReadOperation: rawNode
              ? this.gitChangedFileReadOperationFor(rawNode)
              : null,
            directCapabilityHandles: rawNode
              ? this.directCapabilityHandles(
                  this.normalizeInvocation(rawNode).targetExpression
                )
              : 0
          });
        }).sort((left, right) => compareCanonicalText(left.id, right.id));
      })()),
      unknownFrontiers: Object.freeze(this.assembler.unknownFrontiers
        .map((frontier) => Object.freeze({
          ...frontier,
          base: frozenNode(frontier.base),
          source: frontier.source ? frozenNode(frontier.source) : undefined,
          target: frontier.target ? frozenNode(frontier.target) : undefined
        }))
        .sort((left, right) => compareCanonicalText(left.id, right.id))),
      namespaceUses: Object.freeze(this.namespaceUses.map((entry) => Object.freeze({ ...entry }))
        .sort((left, right) =>
        compareCanonicalText(
          `${left.scenarioId}\0${left.targetModuleId}\0${left.location}\0${left.kind}`,
          `${right.scenarioId}\0${right.targetModuleId}\0${right.location}\0${right.kind}`
        ))),
      externalAcquisitions: Object.freeze(this.externalAcquisitions
        .map((entry) => Object.freeze({ ...entry })).sort((left, right) =>
        compareCanonicalText(
          `${left.scenarioId}\0${left.moduleId}\0${left.location}`,
          `${right.scenarioId}\0${right.moduleId}\0${right.location}`
        ))),
      moduleExportSlots: Object.freeze([...this.exportSlotsByModule]
        .map(([moduleId, slots]): CompactModuleExportSlots => Object.freeze({
          moduleId,
          slots: Object.freeze([...slots].map(([exportName, node]) => Object.freeze({
            exportName,
            node: frozenNode(node)
          })).sort((left, right) => compareCanonicalText(left.exportName, right.exportName)))
        }))
        .sort((left, right) => compareCanonicalText(left.moduleId, right.moduleId)))
    });
    return {
      model,
      moduleEdges: Object.freeze([...this.moduleEdges]),
      validationPlan,
      moduleSccProjection,
      callSccProjection: callTopology.callSccProjection
    };
  }

  private registerCallableTopology(): void {
    for (const initializer of this.moduleInitializersByModuleId.values()) {
      this.assembler.callables.push({
        id: initializer.id,
        scenarioId: initializer.scenarioId,
        ownerKind: initializer.ownerKind
      });
      this.assembler.seed(initializer.value, initializer.scenarioId, {
        callableShapes: CallableShapeBit.Callable
      });
    }
    for (const callable of this.index.allCallables()) {
      this.assembler.callables.push({
        id: callable.id,
        scenarioId: callable.scenarioId,
        ownerKind: callable.ownerKind,
        parameterNodeKeys: callable.parameters.map(nodeKey)
      });
      if (this.index.classForConstructor(callable)) {
        this.assembler.ensureNode(callable.value, callable.scenarioId);
      } else {
        this.assembler.seed(callable.value, callable.scenarioId, {
          callableShapes: CallableShapeBit.Callable
        });
      }
      this.assembler.ensureNode(callable.returnValue, callable.scenarioId);
      for (const parameter of callable.parameters) {
        this.assembler.ensureNode(parameter, callable.scenarioId);
      }
      if (callable.symbol) {
        const symbolValue = this.index.valueForBoundedSymbol(callable.symbol, callable.scenarioId);
        if (symbolValue) {
          this.assembler.addFlow(
            'alias',
            callable.scenarioId,
            callable.value,
            symbolValue,
            `callable-symbol:${callable.id}`
          );
        }
      }
      callable.declaration.parameters.forEach((parameter, index) => {
        if (parameter.initializer) {
          this.assembler.addFlow(
            'default',
            callable.scenarioId,
            this.index.valueForExpression(parameter.initializer, callable.module),
            callable.parameters[index]!,
            `parameter-default:${callable.id}:${index}`
          );
        }
        this.bindPattern(
          parameter.name,
          callable.parameters[index]!,
          callable.module,
          `parameter-binding:${callable.id}:${index}`,
          callable
        );
      });
      if (callable.declaration.body && !ts.isBlock(callable.declaration.body)) {
        const source = this.index.valueForExpression(callable.declaration.body, callable.module);
        this.assembler.addFlow(
          'return',
          callable.scenarioId,
          source,
          callable.returnValue,
          `expression-return:${callable.id}`
        );
      }
    }
    for (const constructor of this.index.allImplicitConstructors()) {
      this.assembler.callables.push({
        id: constructor.id,
        scenarioId: constructor.scenarioId,
        ownerKind: constructor.ownerKind,
        parameterNodeKeys: constructor.parameters.map(nodeKey)
      });
      this.assembler.ensureNode(constructor.value, constructor.scenarioId);
      this.assembler.ensureNode(constructor.returnValue, constructor.scenarioId);
    }
    for (const classModel of this.index.allClasses()) {
      this.assembler.ensureNode(classModel.value, classModel.scenarioId);
    }
  }

  private classTopologyInputs(): readonly FiniteProofClassTopologyInput[] {
    return this.index.allClasses().map((classModel): FiniteProofClassTopologyInput => {
      const definitionOwnerCallableId = this.classDefinitionOwnerById.get(classModel.id);
      if (!definitionOwnerCallableId) {
        throw new Error(`Class ${classModel.id} has no incoming execution owner.`);
      }
      if (nodeKey(classModel.value) === nodeKey(classModel.constructorOwner.value)) {
        throw new Error(`Class ${classModel.id} aliases ClassValue and ConstructorExecutionSeed.`);
      }
      const evaluationSites = [...(this.classEvaluationSitesById.get(classModel.id) ?? [])]
        .sort((left, right) => compareCanonicalText(
          `${left.location}\0${left.kind}\0${left.ownerCallableId}`,
          `${right.location}\0${right.kind}\0${right.ownerCallableId}`
        ));
      const heritageResolution = this.classHeritageResolutionById.get(classModel.id) ?? 'none';
      const exactBaseClass = heritageResolution === 'exact-internal' &&
        classModel.heritageExpression
        ? this.index.exactClassAt(classModel.heritageExpression)
        : null;
      return {
        id: classModel.id,
        scenarioId: classModel.scenarioId,
        moduleId: classModel.module.relativePath,
        classValueNodeKey: nodeKey(classModel.value),
        constructorCallableId: classModel.constructorOwner.id,
        constructorExecutionSeedNodeKey: nodeKey(classModel.constructorOwner.value),
        constructorParameterNodeKeys: classModel.constructorOwner.parameters.map(nodeKey),
        constructorDefaultNodeKeys: 'declaration' in classModel.constructorOwner
          ? classModel.constructorOwner.declaration.parameters.map((parameter) =>
              parameter.initializer
                ? nodeKey(this.index.valueForExpression(
                    parameter.initializer,
                    classModel.constructorOwner.module
                  ))
                : null)
          : classModel.constructorOwner.parameters.map(() => null),
        constructorReturnNodeKey: nodeKey(classModel.constructorOwner.returnValue),
        constructorKind: classModel.constructorKind,
        implicitSuperCallSiteId: classModel.constructorKind === 'implicit' &&
          classModel.heritageExpression
          ? `${classModel.id}:implicit-super`
          : null,
        definitionOwnerCallableId,
        derived: classModel.heritageExpression !== null,
        heritageResolution,
        baseClassId: exactBaseClass?.id ?? null,
        evaluationSites
      };
    }).sort((left, right) => compareCanonicalText(left.id, right.id));
  }

  private exportSlot(module: ProgramModule, exportName: string): FiniteProofNodeRef {
    let slots = this.exportSlotsByModule.get(module.relativePath);
    if (!slots) {
      slots = new Map();
      this.exportSlotsByModule.set(module.relativePath, slots);
    }
    let slot = slots.get(exportName);
    if (!slot) {
      slot = {
        kind: 'export-slot',
        id: `${module.scenarioId}:export:${module.relativePath}:${JSON.stringify(exportName)}`
      };
      slots.set(exportName, slot);
      this.assembler.ensureNode(slot, module.scenarioId);
    }
    return slot;
  }

  private lowerStaticModuleSurfaces(): void {
    for (const module of this.context.modules) {
      for (const statement of module.sourceFile.statements) {
        if (ts.isImportDeclaration(statement) && ts.isStringLiteralLike(statement.moduleSpecifier)) {
          this.lowerImportDeclaration(module, statement);
        } else if (ts.isImportEqualsDeclaration(statement) && !statement.isTypeOnly &&
          ts.isExternalModuleReference(statement.moduleReference) &&
          statement.moduleReference.expression &&
          ts.isStringLiteralLike(statement.moduleReference.expression)) {
          const acquisition = this.resolveAcquisition(
            module,
            statement.moduleReference.expression.text,
            'require',
            statement.moduleReference.expression,
            'import'
          );
          if (acquisition?.target.kind === 'executable') {
            this.addStaticModuleActivationEdge(
              module.scenarioId,
              module.relativePath,
              acquisition.target.moduleId,
              'import'
            );
          }
          const local = this.index.valueForDeclarationName(statement.name, module);
          this.assembler.ensureNode(local, module.scenarioId);
          this.bindAcquisitionToName(statement.name, acquisition, module);
          if (acquisition?.target.kind === 'external') {
            const handles = externalCapabilityMask(acquisition.target.specifier, '*');
            this.assembler.seed(local, module.scenarioId, { handles });
            const symbol = this.index.lexicalSymbol(statement.name);
            if (symbol) this.externalMasksBySymbol.set(symbol, handles);
            this.externalAcquisitions.push({
              scenarioId: module.scenarioId,
              moduleId: module.relativePath,
              specifier: acquisition.target.specifier,
              exportName: '*',
              kind: 'namespace',
              location: programLocation(module, statement)
            });
          }
        }
        this.lowerEsmExport(module, statement);
      }
    }
  }

  private lowerImportDeclaration(module: ProgramModule, statement: ts.ImportDeclaration): void {
    const clause = statement.importClause;
    if (clause?.isTypeOnly) return;
    if (!ts.isStringLiteralLike(statement.moduleSpecifier)) return;
    const target = this.resolveAcquisition(
      module,
      statement.moduleSpecifier.text,
      'import',
      statement.moduleSpecifier,
      'import'
    );
    if (!clause) return;
    if (clause.name) {
      this.bindImportedName(module, clause.name, 'default', target, 'default-import');
    }
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) {
      this.bindAcquisitionToName(bindings.name, target, module);
      const local = this.index.valueForDeclarationName(bindings.name, module);
      this.assembler.ensureNode(local, module.scenarioId);
      if (target?.target.kind === 'external') {
        const handles = externalCapabilityMask(target.target.specifier, '*');
        this.assembler.seed(local, module.scenarioId, { handles });
        const symbol = this.index.lexicalSymbol(bindings.name);
        if (symbol) this.externalMasksBySymbol.set(symbol, handles);
        this.externalAcquisitions.push({
          scenarioId: module.scenarioId,
          moduleId: module.relativePath,
          specifier: target.target.specifier,
          exportName: '*',
          kind: 'namespace',
          location: programLocation(module, bindings)
        });
      }
    } else if (bindings) {
      for (const element of bindings.elements) {
        if (element.isTypeOnly) continue;
        this.bindImportedName(
          module,
          element.name,
          element.propertyName?.text ?? element.name.text,
          target,
          `named-import:${element.pos}`
        );
      }
    }
  }

  private bindImportedName(
    module: ProgramModule,
    localName: ts.Identifier,
    importedName: string,
    acquisition: ModuleAcquisition | null,
    identity: string
  ): void {
    const local = this.index.valueForDeclarationName(localName, module);
    this.assembler.ensureNode(local, module.scenarioId);
    if (!acquisition) return;
    if (acquisition.target.kind === 'executable') {
      const target = this.context.modulesById.get(acquisition.target.moduleId);
      if (!target) return;
      const slot = this.exportSlot(target, importedName);
      this.assembler.addConstraint({
        id: `${module.relativePath}:${identity}:slot`,
        scenarioId: module.scenarioId,
        kind: 'export-read',
        exportName: importedName,
        source: slot,
        target: local
      });
    } else if (acquisition.target.kind === 'external') {
      const handles = externalCapabilityMask(acquisition.target.specifier, importedName);
      this.assembler.seed(local, module.scenarioId, { handles });
      const symbol = this.index.lexicalSymbol(localName);
      if (symbol) {
        this.acquisitionsBySymbol.set(symbol, acquisition);
        this.externalMasksBySymbol.set(symbol, handles);
      }
      this.externalAcquisitions.push({
        scenarioId: module.scenarioId,
        moduleId: module.relativePath,
        specifier: acquisition.target.specifier,
        exportName: importedName,
        kind: importedName === 'default' ? 'default' : 'named',
        location: programLocation(module, localName)
      });
    }
  }

  private lowerEsmExport(module: ProgramModule, statement: ts.Statement): void {
    if (ts.isFunctionDeclaration(statement) && !statement.name &&
      nodeHasModifier(statement, ts.SyntaxKind.ExportKeyword) &&
      nodeHasModifier(statement, ts.SyntaxKind.DefaultKeyword)) {
      const callable = this.index.callableForDeclaration(statement);
      if (callable) {
        this.addExportWrite(
          module,
          'default',
          callable.value,
          `anonymous-default-export:${statement.pos}`
        );
      }
      return;
    }
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
      statement.name && nodeHasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
      const source = this.index.valueForExpression(statement.name, module);
      const exportName = nodeHasModifier(statement, ts.SyntaxKind.DefaultKeyword)
        ? 'default'
        : statement.name.text;
      this.addExportWrite(module, exportName, source, `declaration-export:${statement.pos}`);
      return;
    }
    if (ts.isVariableStatement(statement) &&
      nodeHasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
      const bind = (name: ts.BindingName): void => {
        if (ts.isIdentifier(name)) {
          const source = this.index.valueForDeclarationName(name, module);
          this.addExportWrite(module, name.text, source, `variable-export:${name.pos}`);
          return;
        }
        for (const element of name.elements) {
          if (!ts.isOmittedExpression(element)) bind(element.name);
        }
      };
      for (const declaration of statement.declarationList.declarations) bind(declaration.name);
      return;
    }
    if (ts.isExportAssignment(statement)) {
      this.addExportWrite(
        module,
        'default',
        this.index.valueForExpression(statement.expression, module),
        `default-export:${statement.pos}`
      );
      return;
    }
    if (!ts.isExportDeclaration(statement) || statement.isTypeOnly) return;
    const literal = statement.moduleSpecifier && ts.isStringLiteralLike(statement.moduleSpecifier)
      ? statement.moduleSpecifier
      : null;
    const acquisition = literal
      ? this.resolveAcquisition(module, literal.text, 'import', literal, 'star-export')
      : null;
    if (!statement.exportClause) {
      if (acquisition?.target.kind === 'executable') {
        const target = this.context.modulesById.get(acquisition.target.moduleId);
        if (target) {
          this.addStarExport(
            module,
            target,
            `esm-star:${module.relativePath}:${statement.pos}:${statement.end}`
          );
        }
      } else if (acquisition?.target.kind === 'external') {
        this.addExternalStarExport(
          module,
          acquisition.target.specifier,
          `esm-external-star:${module.relativePath}:${statement.pos}:${statement.end}`
        );
        this.externalAcquisitions.push({
          scenarioId: module.scenarioId,
          moduleId: module.relativePath,
          specifier: acquisition.target.specifier,
          exportName: '*',
          kind: 're-export',
          location: programLocation(module, statement)
        });
      }
      return;
    }
    if (ts.isNamespaceExport(statement.exportClause)) {
      this.markDirectExportName(module, statement.exportClause.name.text);
      if (acquisition?.target.kind === 'executable') {
        const target = this.context.modulesById.get(acquisition.target.moduleId);
        if (target) {
          this.exportSlot(module, statement.exportClause.name.text);
          this.namespaceExports.push({
            source: module,
            target,
            exportName: statement.exportClause.name.text,
            identity: `namespace-export:${module.relativePath}:${statement.pos}`
          });
        }
      } else if (acquisition?.target.kind === 'external') {
        const ownName = statement.exportClause.name.text;
        const slot = this.exportSlot(module, ownName);
        this.assembler.seed(slot, module.scenarioId, {
          handles: externalCapabilityMask(acquisition.target.specifier, '*')
        });
        this.externalAcquisitions.push({
          scenarioId: module.scenarioId,
          moduleId: module.relativePath,
          specifier: acquisition.target.specifier,
          exportName: '*',
          kind: 're-export',
          location: programLocation(module, statement.exportClause)
        });
      }
      return;
    }
    for (const element of statement.exportClause.elements) {
      if (element.isTypeOnly) continue;
      const importedName = element.propertyName?.text ?? element.name.text;
      const ownName = element.name.text;
      this.markDirectExportName(module, ownName);
      if (acquisition?.target.kind === 'executable') {
        const target = this.context.modulesById.get(acquisition.target.moduleId);
        if (target) {
          const source = this.exportSlot(target, importedName);
          const own = this.exportSlot(module, ownName);
          this.assembler.addConstraint({
            id: `reexport:${module.relativePath}:${element.pos}`,
            scenarioId: module.scenarioId,
            kind: 'export-read',
            exportName: ownName,
            source,
            target: own
          });
        }
      } else if (acquisition?.target.kind === 'external') {
        const own = this.exportSlot(module, ownName);
        this.assembler.seed(own, module.scenarioId, {
          handles: externalCapabilityMask(acquisition.target.specifier, importedName)
        });
        this.externalAcquisitions.push({
          scenarioId: module.scenarioId,
          moduleId: module.relativePath,
          specifier: acquisition.target.specifier,
          exportName: importedName,
          kind: 're-export',
          location: programLocation(module, element)
        });
      } else if (!literal) {
        const localTarget = this.context.checker.getExportSpecifierLocalTargetSymbol(element);
        const source = localTarget
          ? this.index.valueForBoundedSymbol(localTarget, module.scenarioId)
          : null;
        if (!source) {
          this.assembler.addFinding({
            id: `unknown-local-export:${module.relativePath}:${element.pos}`,
            scenarioId: module.scenarioId,
            code: 'UNRESOLVED_EXPORT_TARGET',
            message: `${programLocation(module, element)}: local export has no exact checker target`
          });
          continue;
        }
        this.addExportWrite(module, ownName, source, `local-reexport:${element.pos}`);
      }
    }
  }

  private addExportWrite(
    module: ProgramModule,
    exportName: string,
    source: FiniteProofNodeRef,
    identity: string
  ): void {
    this.markDirectExportName(module, exportName);
    const slot = this.exportSlot(module, exportName);
    this.assembler.addConstraint({
      id: `${module.relativePath}:${identity}`,
      scenarioId: module.scenarioId,
      kind: 'export-write',
      exportName,
      source,
      target: slot
    });
  }

  private markDirectExportName(module: ProgramModule, exportName: string): void {
    let names = this.directExportNamesByModule.get(module.relativePath);
    if (!names) {
      names = new Set();
      this.directExportNamesByModule.set(module.relativePath, names);
    }
    names.add(exportName);
  }

  private addExternalStarExport(
    source: ProgramModule,
    specifier: string,
    identity: string
  ): void {
    const normalized = normalizeBuiltinSpecifier(specifier);
    const key = `${source.scenarioId}\0${source.relativePath}\0${normalized}`;
    if (this.externalStarExportKeys.has(key)) return;
    this.externalStarExportKeys.add(key);
    this.externalStarExports.push({ source, specifier: normalized, identity });
  }

  private addStarExport(source: ProgramModule, target: ProgramModule, identity: string): void {
    if (source.scenarioId !== target.scenarioId) {
      this.assembler.addFinding({
        id: `cross-star:${identity}`,
        scenarioId: source.scenarioId,
        code: 'CROSS_SCENARIO_EDGE',
        message: `${source.relativePath}: star export crosses into ${target.relativePath}`
      });
      return;
    }
    const key = `${source.scenarioId}\0${source.relativePath}\0${target.relativePath}`;
    if (this.starExportKeys.has(key)) return;
    this.starExportKeys.add(key);
    this.starExports.push({ source, target, identity });
    this.addModuleEdge(
      source.scenarioId,
      source.relativePath,
      target.relativePath,
      'star-export'
    );
  }

  private addModuleEdge(
    scenarioId: string,
    sourceModuleId: string,
    targetModuleId: string,
    kind: RawModuleEdge['kind']
  ): void {
    const key = `${scenarioId}\0${sourceModuleId}\0${targetModuleId}\0${kind}`;
    if (this.moduleEdgeKeys.has(key)) return;
    this.moduleEdgeKeys.add(key);
    this.moduleEdges.push({ scenarioId, sourceModuleId, targetModuleId, kind });
  }

  private addStaticModuleActivationEdge(
    scenarioId: string,
    sourceModuleId: string,
    targetModuleId: string,
    kind: 'import' | 'star-export'
  ): void {
    const key = `${scenarioId}\0${sourceModuleId}\0${targetModuleId}\0${kind}`;
    if (this.staticModuleActivationEdgeKeys.has(key)) return;
    this.staticModuleActivationEdgeKeys.add(key);
    this.staticModuleActivationEdges.push({
      scenarioId,
      sourceModuleId,
      targetModuleId,
      kind
    });
  }

  private resolveAcquisition(
    module: ProgramModule,
    specifier: string,
    mode: 'import' | 'require',
    literal: ts.StringLiteralLike | null,
    edgeKind: RawModuleEdge['kind']
  ): ModuleAcquisition | null {
    const normalized = normalizeBuiltinSpecifier(specifier);
    if (normalized.startsWith('node:') || specifier.startsWith('bun:')) {
      return {
        scenarioId: module.scenarioId,
        target: { kind: 'external', specifier: normalized }
      };
    }
    const resolution = ts.resolveModuleName(
      specifier,
      module.sourceFile.fileName,
      this.context.options,
      this.context.host,
      this.context.resolutionCache,
      undefined,
      mode === 'import' && literal
        ? ts.getModeForUsageLocation(module.sourceFile, literal, this.context.options)
        : mode === 'import' ? ts.ModuleKind.ESNext : ts.ModuleKind.CommonJS
    ).resolvedModule;
    if (!resolution) {
      if (specifier.startsWith('.') || specifier.startsWith('/')) {
        this.assembler.addFinding({
          id: `unresolved:${module.relativePath}:${literal?.pos ?? specifier}:${mode}`,
          scenarioId: module.scenarioId,
          code: 'UNRESOLVED_MODULE',
          message: `${module.relativePath}: unresolved executable module target ${specifier}`,
          subjectId: `${module.relativePath}:${specifier}`
        });
      }
      return specifier.startsWith('.') || specifier.startsWith('/')
        ? null
        : { scenarioId: module.scenarioId, target: { kind: 'external', specifier } };
    }
    const resolvedCanonicalPath = this.context.canonicalFileName(resolution.resolvedFileName);
    const resource = this.context.resourcesByCanonicalPath.get(resolvedCanonicalPath);
    if (resource && resource.scenarioId !== module.scenarioId) {
      this.assembler.addFinding({
        id: `cross-module:${module.relativePath}:${literal?.pos ?? specifier}:${mode}`,
        scenarioId: module.scenarioId,
        code: 'CROSS_SCENARIO_EDGE',
        message: `${module.relativePath}: ${mode} resolves outside ${module.scenarioId} to ${resource.relativePath}`
      });
      return null;
    }
    if (resource?.kind === 'data-package') {
      return {
        scenarioId: module.scenarioId,
        target: { kind: 'data-package', resourceId: resource.relativePath }
      };
    }
    if (resource?.kind === 'declaration') {
      this.assembler.addFinding({
        id: `runtime-declaration:${module.relativePath}:${literal?.pos ?? specifier}:${mode}`,
        scenarioId: module.scenarioId,
        code: 'UNBOUNDED_MODULE',
        message: `${module.relativePath}: runtime ${mode} resolves only to declaration ${specifier}`
      });
      return {
        scenarioId: module.scenarioId,
        target: { kind: 'declaration', resourceId: resource.relativePath }
      };
    }
    const target = this.context.modulesByCanonicalPath.get(resolvedCanonicalPath);
    if (!target) {
      const resolvedName = resolution.resolvedFileName.toLowerCase();
      const resolvedKind: 'data-package' | 'declaration' | 'executable' =
        resolvedName.endsWith('.json')
          ? 'data-package'
          : /\.d\.(?:c|m)?ts$/u.test(resolvedName)
            ? 'declaration'
            : 'executable';
      if (resolvedKind === 'data-package') {
        this.assembler.addFinding({
          id: `unbounded-data:${module.relativePath}:${literal?.pos ?? specifier}:${mode}`,
          scenarioId: module.scenarioId,
          code: 'UNBOUNDED_MODULE',
          message: `${module.relativePath}: data resource is outside bounded input ${specifier}`
        });
        return {
          scenarioId: module.scenarioId,
          target: { kind: 'data-package', resourceId: resolvedCanonicalPath }
        };
      }
      if (resolvedKind === 'declaration') {
        if (resolution.isExternalLibraryImport && !specifier.startsWith('.') &&
          !specifier.startsWith('/')) {
          return { scenarioId: module.scenarioId, target: { kind: 'external', specifier } };
        }
        this.assembler.addFinding({
          id: `runtime-declaration:${module.relativePath}:${literal?.pos ?? specifier}:${mode}`,
          scenarioId: module.scenarioId,
          code: 'UNBOUNDED_MODULE',
          message: `${module.relativePath}: runtime ${mode} resolves only to declaration ${specifier}`
        });
        return {
          scenarioId: module.scenarioId,
          target: { kind: 'declaration', resourceId: resolvedCanonicalPath }
        };
      }
      if (resolution.isExternalLibraryImport) {
        return { scenarioId: module.scenarioId, target: { kind: 'external', specifier } };
      }
      this.assembler.addFinding({
        id: `unbounded:${module.relativePath}:${literal?.pos ?? specifier}:${mode}`,
        scenarioId: module.scenarioId,
        code: 'UNBOUNDED_MODULE',
        message: `${module.relativePath}: executable target is outside bounded inventory ${specifier}`
      });
      return { scenarioId: module.scenarioId, target: { kind: 'external', specifier } };
    }
    this.addModuleEdge(module.scenarioId, module.relativePath, target.relativePath, edgeKind);
    if (mode === 'import' && (edgeKind === 'import' || edgeKind === 'star-export')) {
      this.addStaticModuleActivationEdge(
        module.scenarioId,
        module.relativePath,
        target.relativePath,
        edgeKind
      );
    }
    return {
      scenarioId: module.scenarioId,
      target: { kind: 'executable', moduleId: target.id }
    };
  }

  private bindPattern(
    pattern: ts.BindingName,
    source: FiniteProofNodeRef,
    module: ProgramModule,
    identity: string,
    owner: ExecutionOwnerModel
  ): void {
    if (ts.isIdentifier(pattern)) {
      const target = this.index.valueForDeclarationName(pattern, module);
      this.assembler.addFlow('alias', module.scenarioId, source, target, `${identity}:identifier`);
      const acquisition = this.acquisitionsByValue.get(nodeKey(source));
      if (acquisition) this.bindAcquisitionToName(pattern, acquisition, module);
      this.copyKnownProperties(module, source, target, `${identity}:properties`);
      return;
    }
    if (ts.isObjectBindingPattern(pattern)) {
      for (const element of pattern.elements) {
        if (element.dotDotDotToken) {
          const target = this.index.valueForDeclarationName(element.name, module);
          this.addUnknownProperty(module, element, 'opaque object rest', {
            operation: 'property-copy',
            owner,
            base: source,
            source,
            target
          });
          continue;
        }
        const properties = element.propertyName
          ? this.exactPropertyNames(element.propertyName)
          : ts.isIdentifier(element.name) ? Object.freeze([element.name.text]) : null;
        if (properties === null) {
          const target = this.index.valueForDeclarationName(element.name, module);
          this.addUnknownProperty(module, element, 'destructuring key', {
            operation: 'property-read',
            owner,
            base: source,
            target
          });
          continue;
        }
        const extracted: FiniteProofNodeRef = {
          kind: 'value',
          id: `${module.scenarioId}:value:binding:${module.relativePath}:${element.pos}`
        };
        this.assembler.ensureNode(extracted, module.scenarioId);
        this.readExactProperties(module, source, properties, extracted, `${identity}:${element.pos}`);
        if (element.initializer) {
          this.assembler.addFlow(
            'join',
            module.scenarioId,
            this.index.valueForExpression(element.initializer, module),
            extracted,
            `${identity}:${element.pos}:default`
          );
        }
        this.bindPattern(
          element.name,
          extracted,
          module,
          `${identity}:${element.pos}:nested`,
          owner
        );
      }
      return;
    }
    pattern.elements.forEach((element, index) => {
      if (ts.isOmittedExpression(element)) return;
      const extracted: FiniteProofNodeRef = {
        kind: 'value',
        id: `${module.scenarioId}:value:binding:${module.relativePath}:${element.pos}`
      };
      this.assembler.ensureNode(extracted, module.scenarioId);
      this.readExactProperty(module, source, String(index), extracted, `${identity}:${element.pos}`);
      if (element.initializer) {
        this.assembler.addFlow(
          'join',
          module.scenarioId,
          this.index.valueForExpression(element.initializer, module),
          extracted,
          `${identity}:${element.pos}:default`
        );
      }
      this.bindPattern(
        element.name,
        extracted,
        module,
        `${identity}:${element.pos}:nested`,
        owner
      );
    });
  }

  private bindAssignmentTarget(
    targetExpression: ts.Expression,
    source: FiniteProofNodeRef,
    module: ProgramModule,
    identity: string,
    ownerCallable: ExecutionOwnerModel
  ): void {
    const target = unwrapExpression(targetExpression);
    if (ts.isIdentifier(target)) {
      const targetValue = this.index.valueForExpression(target, module);
      this.assembler.addFlow('alias', module.scenarioId, source, targetValue, `${identity}:identifier`);
      const acquisition = this.acquisitionsByValue.get(nodeKey(source));
      if (acquisition) this.bindAcquisitionToName(target, acquisition, module);
      this.copyKnownProperties(module, source, targetValue, `${identity}:properties`);
      return;
    }
    if (ts.isObjectLiteralExpression(target)) {
      for (const property of target.properties) {
        if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) {
          continue;
        }
        const names = this.exactPropertyNames(property.name);
        if (names === null) {
          this.addUnknownProperty(module, property, 'assignment destructuring key', {
            operation: 'property-read',
            owner: ownerCallable,
            base: source,
            target: this.index.valueForNode(property, module)
          });
          continue;
        }
        const extracted: FiniteProofNodeRef = {
          kind: 'value',
          id: `${module.scenarioId}:value:assignment:${module.relativePath}:${property.pos}`
        };
        this.assembler.ensureNode(extracted, module.scenarioId);
        this.readExactProperties(module, source, names, extracted, `${identity}:${property.pos}`);
        const assigned = ts.isPropertyAssignment(property) ? property.initializer : property.name;
        this.bindAssignmentTarget(
          assigned,
          extracted,
          module,
          `${identity}:${property.pos}:nested`,
          ownerCallable
        );
      }
      return;
    }
    if (ts.isArrayLiteralExpression(target)) {
      target.elements.forEach((element, index) => {
        if (ts.isOmittedExpression(element) || ts.isSpreadElement(element)) return;
        const extracted: FiniteProofNodeRef = {
          kind: 'value',
          id: `${module.scenarioId}:value:assignment:${module.relativePath}:${element.pos}`
        };
        this.assembler.ensureNode(extracted, module.scenarioId);
        this.readExactProperty(module, source, String(index), extracted, `${identity}:${element.pos}`);
        this.bindAssignmentTarget(
          element,
          extracted,
          module,
          `${identity}:${element.pos}:nested`,
          ownerCallable
        );
      });
      return;
    }
    if (ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target)) {
      const owner = this.index.valueForExpression(target.expression, module);
      const properties = ts.isPropertyAccessExpression(target)
        ? Object.freeze([target.name.text])
        : target.argumentExpression
          ? this.evaluator.evaluatePropertyKeys(target.argumentExpression)
          : null;
      if (properties === null) {
        this.addUnknownProperty(module, target, 'assignment target', {
          operation: 'property-write',
          owner: ownerCallable,
          base: owner,
          source,
          target: owner
        });
      } else {
        for (const property of properties) {
          this.assembler.addPropertyWrite(
            module.scenarioId,
            owner,
            property,
            source,
            `${identity}:target-property:${JSON.stringify(property)}`
          );
        }
      }
      return;
    }
    const targetValue = this.index.valueForExpression(target, module);
    this.assembler.addFlow('alias', module.scenarioId, source, targetValue, `${identity}:opaque`);
  }

  private bindAcquisitionToName(
    name: ts.BindingName,
    acquisition: ModuleAcquisition | null,
    module: ProgramModule
  ): void {
    if (!acquisition) return;
    if (ts.isIdentifier(name)) {
      const symbol = this.index.lexicalSymbol(name);
      if (symbol) this.acquisitionsBySymbol.set(symbol, acquisition);
      const value = this.index.valueForDeclarationName(name, module);
      this.acquisitionsByValue.set(nodeKey(value), acquisition);
      return;
    }
    if (ts.isObjectBindingPattern(name)) {
      for (const element of name.elements) {
        if (element.dotDotDotToken) continue;
        const property = semanticPropertyName(element.propertyName) ??
          (ts.isIdentifier(element.name) ? element.name.text : null);
        if (property === null) continue;
        if (ts.isIdentifier(element.name) && acquisition.target.kind === 'executable') {
          const targetModule = this.context.modulesById.get(acquisition.target.moduleId);
          if (!targetModule) continue;
          const local = this.index.valueForDeclarationName(element.name, module);
          const slot = this.exportSlot(targetModule, property);
          this.assembler.addConstraint({
            id: `acquisition-binding:${module.relativePath}:${element.pos}`,
            scenarioId: module.scenarioId,
            kind: 'namespace-selection',
            exportName: property,
            source: slot,
            target: local
          });
        } else if (ts.isIdentifier(element.name) && acquisition.target.kind === 'external') {
          const local = this.index.valueForDeclarationName(element.name, module);
          const handles = externalCapabilityMask(acquisition.target.specifier, property);
          this.assembler.seed(local, module.scenarioId, { handles });
          const symbol = this.index.lexicalSymbol(element.name);
          if (symbol) {
            this.externalMasksBySymbol.set(symbol, handles);
          }
          this.externalAcquisitions.push({
            scenarioId: module.scenarioId,
            moduleId: module.relativePath,
            specifier: acquisition.target.specifier,
            exportName: property,
            kind: 'named',
            location: programLocation(module, element)
          });
        }
      }
    }
  }

  private acquisitionForExpression(expression: ts.Expression): ModuleAcquisition | null {
    const value = unwrapExpression(expression);
    const module = this.index.moduleForNode(value);
    const reference = this.index.valueForExpression(value, module);
    const direct = this.acquisitionsByValue.get(nodeKey(reference));
    if (direct) return direct;
    if (ts.isIdentifier(value)) {
      const symbol = this.index.lexicalSymbol(value);
      if (symbol) {
        const bySymbol = this.acquisitionsBySymbol.get(symbol);
        if (bySymbol) return bySymbol;
        const declarations = symbol.declarations ?? [];
        if (declarations.length === 1 && ts.isVariableDeclaration(declarations[0]) &&
          declarations[0].initializer && ts.isVariableDeclarationList(declarations[0].parent) &&
          (declarations[0].parent.flags & ts.NodeFlags.Const) !== 0) {
          return this.acquisitionForExpression(declarations[0].initializer);
        }
      }
    }
    if (ts.isPropertyAccessExpression(value) || ts.isElementAccessExpression(value)) {
      const propertyNames = ts.isPropertyAccessExpression(value)
        ? Object.freeze([value.name.text])
        : value.argumentExpression
          ? this.evaluator.evaluatePropertyKeys(value.argumentExpression)
          : null;
      if (propertyNames?.length === 1) {
        const base = this.acquisitionForExpression(value.expression);
        if (base?.target.kind === 'external') return base;
      }
    }
    return null;
  }

  private exactPropertyNames(
    name: ts.PropertyName | ts.MemberName | undefined
  ): readonly string[] | null {
    const semantic = semanticPropertyName(name);
    if (semantic !== null) return Object.freeze([semantic]);
    return name && ts.isComputedPropertyName(name)
      ? this.evaluator.evaluatePropertyKeys(name.expression)
      : null;
  }

  private readExactProperties(
    module: ProgramModule,
    owner: FiniteProofNodeRef,
    properties: readonly string[],
    target: FiniteProofNodeRef,
    identity: string
  ): void {
    for (const property of properties) {
      this.readExactProperty(
        module,
        owner,
        property,
        target,
        `${identity}:${JSON.stringify(property)}`
      );
    }
  }

  private copyKnownProperties(
    module: ProgramModule,
    source: FiniteProofNodeRef,
    target: FiniteProofNodeRef,
    identity: string
  ): void {
    for (const property of this.assembler.knownProperties(module.scenarioId, source)) {
      const sourceSlot = this.assembler.propertySlot(module.scenarioId, source, property);
      const targetSlot = this.assembler.propertySlot(module.scenarioId, target, property);
      this.assembler.addConstraint({
        id: `${identity}:${JSON.stringify(property)}`,
        scenarioId: module.scenarioId,
        kind: 'spread',
        sourceOwner: source,
        targetOwner: target,
        property,
        source: sourceSlot,
        target: targetSlot
      });
    }
  }

  private readExactProperty(
    module: ProgramModule,
    owner: FiniteProofNodeRef,
    property: string,
    target: FiniteProofNodeRef,
    identity: string
  ): void {
    this.assembler.addPropertyRead(module.scenarioId, owner, property, target, identity);
    for (const entry of CAPABILITY_REGISTRY) {
      if (entry.kind !== 'property-derivation' || entry.property !== property) continue;
      eachSetBit(entry.targetHandles, HANDLE_BITS, (targetBit) => {
        this.assembler.addDerivation(
          module.scenarioId,
          owner,
          'handle',
          entry.sourceHandle,
          target,
          'handle',
          targetBit,
          `${identity}:capability:${entry.sourceHandle}:${targetBit}`
        );
      });
    }
    const acquisition = this.acquisitionsByValue.get(nodeKey(owner));
    if (!acquisition) return;
    if (acquisition.target.kind === 'executable') {
      const targetModule = this.context.modulesById.get(acquisition.target.moduleId);
      if (!targetModule) return;
      const slot = this.exportSlot(targetModule, property);
      this.assembler.addConstraint({
        id: `${identity}:namespace-slot`,
        scenarioId: module.scenarioId,
        kind: 'namespace-selection',
        exportName: property,
        source: slot,
        target
      });
    } else if (acquisition.target.kind === 'external') {
      this.assembler.seed(target, module.scenarioId, {
        handles: externalCapabilityMask(acquisition.target.specifier, property)
      });
    }
  }

  private addUnknownProperty(
    module: ProgramModule,
    node: ts.Node,
    label: string,
    input: {
      readonly operation: FiniteProofUnknownFrontierInput['operation'];
      readonly owner: ExecutionOwnerModel;
      readonly base: FiniteProofNodeRef;
      readonly source?: FiniteProofNodeRef;
      readonly target?: FiniteProofNodeRef;
    }
  ): void {
    this.assembler.addUnknown({
      id: `unknown-property:${input.operation}:${module.relativePath}:${node.pos}:${node.end}`,
      scenarioId: module.scenarioId,
      operation: input.operation,
      moduleId: module.relativePath,
      ownerCallableId: input.owner.id,
      base: input.base,
      source: input.source,
      target: input.target,
      code: 'UNKNOWN_PROPERTY_FRONTIER',
      message: `${programLocation(module, node)}: ${label} is not an exact immutable property`
    });
  }

  private wireNode(
    node: ts.Node,
    module: ProgramModule,
    owner: ExecutionOwnerModel
  ): void {
    if (ts.isTypeNode(node) || ts.isImportTypeNode(node)) return;
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      this.wireClass(node, module, owner);
      return;
    }
    if (isFunctionLikeWithBody(node)) {
      const callable = this.index.callableForDeclaration(node)!;
      for (const parameter of node.parameters) {
        if (parameter.initializer) this.wireNode(parameter.initializer, module, callable);
      }
      if (node.body) this.wireNode(node.body, module, callable);
      return;
    }
    ts.forEachChild(node, (child) => this.wireNode(child, module, owner));

    if (ts.isIdentifier(node) && isReferenceIdentifier(node)) {
      this.wireIdentifierReference(node, module, owner);
    } else if (ts.isMetaProperty(node) &&
      node.keywordToken === ts.SyntaxKind.ImportKeyword && node.name.text === 'meta') {
      const value = this.index.valueForExpression(node, module);
      const entry = CAPABILITY_REGISTRY.find((candidate) =>
        candidate.kind === 'ambient-meta' && candidate.name === 'import.meta');
      if (entry?.kind !== 'ambient-meta') {
        throw new Error('Canonical import.meta capability is not registered.');
      }
      this.assembler.seed(value, module.scenarioId, { handles: entry.handles });
      this.recordExpressionUse(node, value, module, owner);
    } else if (ts.isPropertyAccessExpression(node)) {
      const base = this.index.valueForExpression(node.expression, module);
      const target = this.index.valueForExpression(node, module);
      this.readExactProperty(
        module,
        base,
        node.name.text,
        target,
        `property:${module.relativePath}:${node.pos}:${node.end}`
      );
      if (this.isExactExternalInvocationTarget(node)) {
        this.assembler.seed(
          this.assembler.propertySlot(module.scenarioId, base, node.name.text),
          module.scenarioId,
          { callableShapes: CallableShapeBit.ExactExternalCallable }
        );
      }
      this.recordExpressionUse(node, target, module, owner);
    } else if (ts.isElementAccessExpression(node)) {
      const base = this.index.valueForExpression(node.expression, module);
      const target = this.index.valueForExpression(node, module);
      const properties = node.argumentExpression
        ? this.evaluator.evaluatePropertyKeys(node.argumentExpression)
        : null;
      if (properties === null) {
        this.addUnknownProperty(module, node, 'element access key', {
          operation: 'property-read',
          owner,
          base,
          target
        });
      } else {
        this.readExactProperties(
          module,
          base,
          properties,
          target,
          `element:${module.relativePath}:${node.pos}:${node.end}`
        );
      }
      this.recordExpressionUse(node, target, module, owner);
    } else if (ts.isVariableDeclaration(node) && node.initializer) {
      const source = this.index.valueForExpression(node.initializer, module);
      this.bindPattern(
        node.name,
        source,
        module,
        `variable:${module.relativePath}:${node.pos}:${node.end}`,
        owner
      );
      this.bindAcquisitionToName(node.name, this.acquisitionForExpression(node.initializer), module);
    } else if (ts.isReturnStatement(node) && node.expression &&
      owner.ownerKind === 'callable') {
      const source = this.index.valueForExpression(node.expression, module);
      this.assembler.addFlow(
        'return',
        module.scenarioId,
        source,
        owner.returnValue,
        `return:${module.relativePath}:${node.pos}:${node.end}`
      );
    } else if (ts.isBinaryExpression(node)) {
      if (isAssignmentOperator(node.operatorToken.kind)) {
        const source = this.index.valueForExpression(node.right, module);
        this.bindAssignmentTarget(
          node.left,
          source,
          module,
          `assignment:${module.relativePath}:${node.pos}:${node.end}`,
          owner
        );
      } else if (node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
        node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
        const target = this.index.valueForExpression(node, module);
        this.assembler.addFlow(
          'join', module.scenarioId, this.index.valueForExpression(node.left, module), target,
          `binary-left:${module.relativePath}:${node.pos}:${node.end}`
        );
        this.assembler.addFlow(
          'join', module.scenarioId, this.index.valueForExpression(node.right, module), target,
          `binary-right:${module.relativePath}:${node.pos}:${node.end}`
        );
      }
      this.lowerCommonJsAssignment(node, module, owner);
    } else if (ts.isConditionalExpression(node)) {
      const target = this.index.valueForExpression(node, module);
      this.assembler.addFlow(
        'join', module.scenarioId, this.index.valueForExpression(node.whenTrue, module), target,
        `conditional-true:${module.relativePath}:${node.pos}:${node.end}`
      );
      this.assembler.addFlow(
        'join', module.scenarioId, this.index.valueForExpression(node.whenFalse, module), target,
        `conditional-false:${module.relativePath}:${node.pos}:${node.end}`
      );
    } else if (ts.isObjectLiteralExpression(node)) {
      this.wireObjectLiteral(node, module, owner);
    } else if (ts.isArrayLiteralExpression(node)) {
      const ownerValue = this.index.valueForExpression(node, module);
      node.elements.forEach((element, index) => {
        if (ts.isOmittedExpression(element)) return;
        if (ts.isSpreadElement(element)) {
          this.copyKnownProperties(
            module,
            this.index.valueForExpression(element.expression, module),
            ownerValue,
            `array-spread:${module.relativePath}:${element.pos}`
          );
        } else {
          this.assembler.addPropertyWrite(
            module.scenarioId,
            ownerValue,
            String(index),
            this.index.valueForExpression(element, module),
            `array-element:${module.relativePath}:${element.pos}`
          );
        }
      });
    } else if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      this.wireCall(node, module, owner);
      if (ts.isCallExpression(node)) this.lowerCommonJsCall(node, module, owner);
    } else if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) ||
      ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node) ||
      ts.isSatisfiesExpression(node) || ts.isAwaitExpression(node)) {
      const source = this.index.valueForExpression(node.expression, module);
      const target = this.index.valueForExpression(node, module);
      this.assembler.addFlow(
        'alias', module.scenarioId, source, target,
        `unwrap:${module.relativePath}:${node.pos}:${node.end}`
      );
      const acquisition = this.acquisitionForExpression(node.expression);
      if (acquisition) this.acquisitionsByValue.set(nodeKey(target), acquisition);
    }
  }

  private recordClassEvaluationSite(
    classModel: ClassModel,
    kind: FiniteProofClassEvaluationSiteInput['kind'],
    owner: ExecutionOwnerModel,
    node: ts.Node
  ): void {
    let sites = this.classEvaluationSitesById.get(classModel.id);
    if (!sites) {
      sites = [];
      this.classEvaluationSitesById.set(classModel.id, sites);
    }
    sites.push({
      kind,
      ownerCallableId: owner.id,
      location: programLocation(classModel.module, node)
    });
  }

  private wireClass(
    declaration: ts.ClassLikeDeclaration,
    module: ProgramModule,
    definitionOwner: ExecutionOwnerModel
  ): void {
    const classModel = this.index.classForDeclaration(declaration);
    if (!classModel) throw new Error('Class declaration has no exact TypeChecker-backed model.');
    const priorDefinitionOwner = this.classDefinitionOwnerById.get(classModel.id);
    if (priorDefinitionOwner !== undefined && priorDefinitionOwner !== definitionOwner.id) {
      throw new Error(`Class ${classModel.id} changed its incoming execution owner.`);
    }
    this.classDefinitionOwnerById.set(classModel.id, definitionOwner.id);
    let heritageResolution: FiniteProofClassTopologyInput['heritageResolution'] = 'none';
    if (classModel.heritageExpression) {
      this.recordClassEvaluationSite(
        classModel,
        'heritage',
        definitionOwner,
        classModel.heritageExpression
      );
      this.wireNode(classModel.heritageExpression, module, definitionOwner);
      const exactBase = this.index.exactClassAt(classModel.heritageExpression);
      heritageResolution = exactBase && exactBase.scenarioId === classModel.scenarioId
        ? 'exact-internal'
        : this.isExactExternalInvocationTarget(classModel.heritageExpression)
          ? 'exact-external'
          : 'unknown';
      if (heritageResolution === 'exact-external') {
        this.assembler.seed(
          this.index.valueForExpression(classModel.heritageExpression, module),
          module.scenarioId,
          { callableShapes: CallableShapeBit.ExactExternalCallable }
        );
      }
    }
    this.classHeritageResolutionById.set(classModel.id, heritageResolution);
    for (const decorator of ts.canHaveDecorators(declaration)
      ? ts.getDecorators(declaration) ?? []
      : []) {
      this.recordClassEvaluationSite(
        classModel,
        'decorator',
        definitionOwner,
        decorator.expression
      );
      this.wireNode(decorator.expression, module, definitionOwner);
    }
    for (const member of declaration.members) {
      const memberName = ts.isPropertyDeclaration(member) ||
        ts.isMethodDeclaration(member) || ts.isGetAccessorDeclaration(member) ||
        ts.isSetAccessorDeclaration(member)
        ? member.name
        : undefined;
      if (memberName && ts.isComputedPropertyName(memberName)) {
        this.recordClassEvaluationSite(
          classModel,
          'computed-name',
          definitionOwner,
          memberName.expression
        );
        this.wireNode(memberName.expression, module, definitionOwner);
      }
      for (const decorator of ts.canHaveDecorators(member)
        ? ts.getDecorators(member) ?? []
        : []) {
        this.recordClassEvaluationSite(
          classModel,
          'decorator',
          definitionOwner,
          decorator.expression
        );
        this.wireNode(decorator.expression, module, definitionOwner);
      }
      if (ts.isConstructorDeclaration(member)) {
        if (!member.body) continue;
        const constructorOwner = this.index.callableForDeclaration(member);
        if (!constructorOwner || constructorOwner.id !== classModel.constructorOwner.id) {
          throw new Error(`Class ${classModel.id} has an inconsistent explicit constructor.`);
        }
        this.recordClassEvaluationSite(classModel, 'constructor-body', constructorOwner, member);
        for (const parameter of member.parameters) {
          if (parameter.initializer) {
            this.recordClassEvaluationSite(
              classModel,
              'constructor-default',
              constructorOwner,
              parameter.initializer
            );
          }
        }
        this.wireNode(member, module, constructorOwner);
        continue;
      }
      if (ts.isPropertyDeclaration(member)) {
        if (!member.initializer) continue;
        const isStatic = nodeHasModifier(member, ts.SyntaxKind.StaticKeyword);
        const fieldOwner = isStatic ? definitionOwner : classModel.constructorOwner;
        this.recordClassEvaluationSite(
          classModel,
          isStatic ? 'static-field' : 'instance-field',
          fieldOwner,
          member.initializer
        );
        this.wireNode(member.initializer, module, fieldOwner);
        continue;
      }
      if (ts.isClassStaticBlockDeclaration(member)) {
        this.recordClassEvaluationSite(classModel, 'static-block', definitionOwner, member);
        this.wireNode(member, module, definitionOwner);
        continue;
      }
      if (isFunctionLikeWithBody(member)) {
        this.wireNode(member, module, definitionOwner);
      }
    }
    if (classModel.constructorKind === 'implicit' && classModel.heritageExpression) {
      this.registerImplicitDerivedConstructor(classModel, heritageResolution);
    }
  }

  private registerImplicitDerivedConstructor(
    classModel: ClassModel,
    heritageResolution: FiniteProofClassTopologyInput['heritageResolution']
  ): void {
    const constructor = classModel.constructorOwner;
    const callSiteId = `${classModel.id}:implicit-super`;
    const exactBase = classModel.heritageExpression
      ? this.index.exactClassAt(classModel.heritageExpression)
      : null;
    if (heritageResolution === 'exact-internal' && exactBase &&
      exactBase.scenarioId === classModel.scenarioId) {
      if (constructor.parameters.length !== exactBase.constructorOwner.parameters.length) {
        throw new Error(
          `Implicit derived constructor ${classModel.id} has a stale forwarding width.`
        );
      }
      this.assembler.callSites.push({
        id: callSiteId,
        scenarioId: classModel.scenarioId,
        callee: exactBase.value,
        ownerCallableId: constructor.id,
        target: canonicalCallTarget([exactBase.constructorOwner.id], false),
        invocationKind: 'construct',
        moduleId: classModel.module.relativePath,
        location: `${programLocation(classModel.module, classModel.declaration)}:implicit-super`
      });
      this.rawStructuralCallEdges.push({
        caller: constructor,
        callee: exactBase.constructorOwner,
        identity: `implicit-super-call:${classModel.id}:${exactBase.id}`
      });
      this.rawInvocationDemandEdges.push({
        scenarioId: classModel.scenarioId,
        source: exactBase.constructorOwner.value,
        target: exactBase.value,
        kind: 'construct',
        gateCallSiteId: callSiteId,
        identity: `implicit-super-demand:${classModel.id}:${exactBase.id}`
      });
      constructor.parameters.forEach((parameter, index) => {
        const baseParameter = exactBase.constructorOwner.parameters[index]!;
        this.assembler.addFlow(
          'parameter',
          classModel.scenarioId,
          parameter,
          baseParameter,
          `implicit-super-parameter:${classModel.id}:${exactBase.id}:${index}`
        );
        this.rawInvocationDemandEdges.push({
          scenarioId: classModel.scenarioId,
          source: parameter,
          target: baseParameter,
          kind: 'parameter',
          gateCallSiteId: callSiteId,
          identity: `implicit-super-parameter-demand:` +
            `${classModel.id}:${exactBase.id}:${index}`
        });
      });
      if ('declaration' in exactBase.constructorOwner) {
        exactBase.constructorOwner.declaration.parameters.forEach((parameter, index) => {
          if (!parameter.initializer) return;
          const target = exactBase.constructorOwner.parameters[index];
          if (!target) return;
          this.rawInvocationDemandEdges.push({
            scenarioId: classModel.scenarioId,
            source: this.index.valueForExpression(
              parameter.initializer,
              exactBase.constructorOwner.module
            ),
            target,
            kind: 'default',
            gateCallSiteId: callSiteId,
            identity: `implicit-super-default-demand:` +
              `${classModel.id}:${exactBase.id}:${index}`
          });
        });
      }
      this.assembler.addFlow(
        'return',
        classModel.scenarioId,
        exactBase.constructorOwner.returnValue,
        constructor.returnValue,
        `implicit-super-return:${classModel.id}:${exactBase.id}`
      );
      this.rawInvocationDemandEdges.push({
        scenarioId: classModel.scenarioId,
        source: exactBase.constructorOwner.returnValue,
        target: constructor.returnValue,
        kind: 'return',
        gateCallSiteId: callSiteId,
        identity: `implicit-super-return-demand:${classModel.id}:${exactBase.id}`
      });
      return;
    }
    const unknownBaseExecution: FiniteProofNodeRef = {
      kind: 'value',
      id: `${classModel.scenarioId}:value:unknown-derived-construction:` +
        `${classModel.module.relativePath}:${classModel.declaration.pos}`
    };
    this.assembler.seed(unknownBaseExecution, classModel.scenarioId, {
      unknownExecutions: UnknownExecutionBit.UnresolvedTarget
    });
    this.assembler.callSites.push({
      id: callSiteId,
      scenarioId: classModel.scenarioId,
      callee: unknownBaseExecution,
      ownerCallableId: constructor.id,
      target: canonicalCallTarget([], true),
      invocationKind: 'construct',
      moduleId: classModel.module.relativePath,
      location: `${programLocation(classModel.module, classModel.declaration)}:` +
        `unsupported-derived-construction`
    });
  }

  private wireIdentifierReference(
    node: ts.Identifier,
    module: ProgramModule,
    owner: ExecutionOwnerModel
  ): void {
    const value = this.index.valueForExpression(node, module);
    const ambientHandles = this.ambientCapabilityMask(node);
    if (ambientHandles !== 0) {
      this.assembler.seed(value, module.scenarioId, { handles: ambientHandles });
    }
    this.recordExpressionUse(node, value, module, owner);
  }

  private recordExpressionUse(
    node: ts.Expression,
    value: FiniteProofNodeRef,
    module: ProgramModule,
    owner: ExecutionOwnerModel
  ): void {
    const parent = node.parent;
    const callSite = ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) &&
      parent.expression === node) ? parent : null;
    const kind: CompactUseSite['kind'] =
      callSite
        ? 'call-callee'
        : ((ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
          parent.expression === node)
          ? 'property-base'
          : 'whole';
    const propertyUse = kind === 'property-base' &&
      (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent))
      ? parent
      : null;
    const ambientPropertyNames = propertyUse === null
      ? null
      : ts.isPropertyAccessExpression(propertyUse)
        ? Object.freeze([propertyUse.name.text])
        : propertyUse.argumentExpression
          ? this.evaluator.evaluatePropertyKeys(propertyUse.argumentExpression)
          : null;
    const mutationTarget = propertyUse ?? node;
    const mutationParent = mutationTarget.parent;
    const isMutation =
      (ts.isBinaryExpression(mutationParent) && mutationParent.left === mutationTarget &&
        isAssignmentOperator(mutationParent.operatorToken.kind)) ||
      ((ts.isPrefixUnaryExpression(mutationParent) ||
          ts.isPostfixUnaryExpression(mutationParent)) &&
        mutationParent.operand === mutationTarget) ||
      (ts.isDeleteExpression(mutationParent) &&
        mutationParent.expression === mutationTarget);
    const ambientAuthorityUseKind: AmbientAuthorityUseKind = isMutation
      ? 'mutation'
      : ts.isElementAccessExpression(node) && ambientPropertyNames === null
        ? 'computed-property'
        : kind === 'property-base'
          ? 'fixed-property-read'
          : 'whole-value';
    this.uses.push({
      scenarioId: module.scenarioId,
      node: value,
      moduleId: module.relativePath,
      ownerCallableId: owner.id,
      callSiteId: callSite ? programCallSiteId(module, callSite) : null,
      kind,
      ambientAuthorityUseKind,
      ambientPropertyNames,
      location: programLocation(module, node)
    });
    if (kind !== 'whole') return;
    const acquisition = this.acquisitionForExpression(node);
    if (acquisition?.target.kind === 'executable') {
      this.namespaceUses.push({
        scenarioId: module.scenarioId,
        targetModuleId: acquisition.target.moduleId,
        location: programLocation(module, node),
        kind: 'whole'
      });
    }
  }

  private wireObjectLiteral(
    node: ts.ObjectLiteralExpression,
    module: ProgramModule,
    ownerCallable: ExecutionOwnerModel
  ): void {
    const owner = this.index.valueForExpression(node, module);
    for (const property of node.properties) {
      if (ts.isPropertyAssignment(property)) {
        const names = this.exactPropertyNames(property.name);
        const source = this.index.valueForExpression(property.initializer, module);
        if (names === null) {
          this.addUnknownProperty(module, property, 'object property key', {
            operation: 'property-write',
            owner: ownerCallable,
            base: owner,
            source,
            target: owner
          });
          continue;
        }
        for (const name of names) {
          this.assembler.addPropertyWrite(
            module.scenarioId,
            owner,
            name,
            source,
            `object-property:${module.relativePath}:${property.pos}:${JSON.stringify(name)}`
          );
        }
      } else if (ts.isShorthandPropertyAssignment(property)) {
        const name = property.name.text;
        const shorthandSymbol = this.context.checker.getShorthandAssignmentValueSymbol(property);
        const source = shorthandSymbol
          ? this.index.valueForBoundedSymbol(shorthandSymbol, module.scenarioId) ??
            this.index.valueForExpression(property.name, module)
          : this.index.valueForExpression(property.name, module);
        this.assembler.addPropertyWrite(
          module.scenarioId,
          owner,
          name,
          source,
          `object-shorthand:${module.relativePath}:${property.pos}`
        );
      } else if (ts.isMethodDeclaration(property)) {
        const names = this.exactPropertyNames(property.name);
        const callable = this.index.callableForDeclaration(property);
        if (names === null || !callable) {
          this.addUnknownProperty(module, property, 'object method key', {
            operation: 'property-write',
            owner: ownerCallable,
            base: owner,
            source: callable?.value,
            target: owner
          });
          continue;
        }
        for (const name of names) {
          this.assembler.addPropertyWrite(
            module.scenarioId,
            owner,
            name,
            callable.value,
            `object-method:${module.relativePath}:${property.pos}:${JSON.stringify(name)}`
          );
        }
      } else if (ts.isSpreadAssignment(property)) {
        const source = this.index.valueForExpression(property.expression, module);
        const acquisition = this.acquisitionForExpression(property.expression);
        if (acquisition?.target.kind === 'executable') {
          const slots = this.exportSlotsByModule.get(acquisition.target.moduleId) ?? new Map();
          for (const [name, slot] of slots) {
            const targetSlot = this.assembler.propertySlot(module.scenarioId, owner, name);
            this.assembler.addConstraint({
              id: `object-module-spread:${module.relativePath}:${property.pos}:${JSON.stringify(name)}`,
              scenarioId: module.scenarioId,
              kind: 'spread',
              sourceOwner: source,
              targetOwner: owner,
              property: name,
              source: slot,
              target: targetSlot
            });
          }
        } else {
          this.copyKnownProperties(
            module,
            source,
            owner,
            `object-spread:${module.relativePath}:${property.pos}`
          );
        }
        this.addUnknownProperty(module, property, 'opaque spread property domain', {
          operation: 'property-copy',
          owner: ownerCallable,
          base: source,
          source,
          target: owner
        });
      }
    }
  }

  private capabilityHintForExpression(
    expression: ts.Expression,
    seenSymbols = new Set<ts.Symbol>()
  ): number {
    const value = unwrapExpression(expression);
    const module = this.index.moduleForNode(value);
    const staticHint = this.staticCapabilityHintsByValue.get(
      nodeKey(this.index.valueForExpression(value, module))
    );
    if (staticHint !== undefined) return staticHint;
    if (ts.isIdentifier(value)) {
      const ambient = this.ambientCapabilityMask(value);
      if (ambient !== 0) return ambient;
      const symbol = this.index.lexicalSymbol(value);
      if (!symbol || seenSymbols.has(symbol)) return 0;
      const external = this.externalMasksBySymbol.get(symbol);
      if (external !== undefined) return external;
      const declarations = symbol.declarations ?? [];
      if (declarations.length === 1 && ts.isVariableDeclaration(declarations[0]) &&
        declarations[0].initializer && ts.isVariableDeclarationList(declarations[0].parent) &&
        (declarations[0].parent.flags & ts.NodeFlags.Const) !== 0) {
        seenSymbols.add(symbol);
        const result = this.capabilityHintForExpression(declarations[0].initializer, seenSymbols);
        seenSymbols.delete(symbol);
        return result;
      }
      return 0;
    }
    if (ts.isPropertyAccessExpression(value) || ts.isElementAccessExpression(value)) {
      const base = this.capabilityHintForExpression(value.expression, seenSymbols);
      const properties = ts.isPropertyAccessExpression(value)
        ? Object.freeze([value.name.text])
        : value.argumentExpression
          ? this.evaluator.evaluatePropertyKeys(value.argumentExpression)
          : null;
      if (properties === null) return 0;
      let result = 0;
      eachSetBit(base, HANDLE_BITS, (sourceBit) => {
        for (const property of properties) {
          for (const entry of CAPABILITY_REGISTRY) {
            if (entry.kind === 'property-derivation' &&
              entry.sourceHandle === sourceBit && entry.property === property) {
              result |= entry.targetHandles;
            }
          }
        }
      });
      const acquisition = this.acquisitionForExpression(value.expression);
      if (acquisition?.target.kind === 'external') {
        for (const property of properties) {
          result |= externalCapabilityMask(acquisition.target.specifier, property);
        }
      }
      return result;
    }
    return 0;
  }

  private directCapabilityHandles(expression: ts.Expression): number {
    const value = unwrapExpression(expression);
    const module = this.index.moduleForNode(value);
    const staticHint = this.staticCapabilityHintsByValue.get(
      nodeKey(this.index.valueForExpression(value, module))
    );
    if (staticHint !== undefined) return staticHint;
    if (ts.isIdentifier(value)) {
      const ambient = this.ambientCapabilityMask(value);
      if (ambient !== 0) return ambient;
      const symbol = this.index.lexicalSymbol(value);
      return symbol ? this.externalMasksBySymbol.get(symbol) ?? 0 : 0;
    }
    if (ts.isPropertyAccessExpression(value) || ts.isElementAccessExpression(value)) {
      const base = this.directCapabilityHandles(value.expression);
      const properties = ts.isPropertyAccessExpression(value)
        ? Object.freeze([value.name.text])
        : value.argumentExpression
          ? this.evaluator.evaluatePropertyKeys(value.argumentExpression)
          : null;
      if (properties === null) return 0;
      let result = 0;
      eachSetBit(base, HANDLE_BITS, (sourceBit) => {
        for (const property of properties) {
          for (const entry of CAPABILITY_REGISTRY) {
            if (entry.kind === 'property-derivation' &&
              entry.sourceHandle === sourceBit && entry.property === property) {
              result |= entry.targetHandles;
            }
          }
        }
      });
      const acquisition = this.acquisitionForExpression(value.expression);
      if (acquisition?.target.kind === 'external') {
        for (const property of properties) {
          result |= externalCapabilityMask(acquisition.target.specifier, property);
        }
      }
      return result;
    }
    return 0;
  }

  private checkerSymbolIdentities(symbol: ts.Symbol): readonly ts.Symbol[] {
    return Object.freeze([...new Set([
      this.index.canonicalAlias(symbol),
      ...this.context.checker.getRootSymbols(symbol)
        .map((root) => this.index.canonicalAlias(root))
    ])]);
  }

  private resolvePinnedTypeReferenceDeclarationSources(): ReadonlySet<ts.SourceFile> {
    const sourceFilesByCanonicalName = new Map(
      this.context.program.getSourceFiles().map((sourceFile) => [
        this.context.canonicalFileName(sourceFile.fileName),
        sourceFile
      ] as const)
    );
    const sources = new Set<ts.SourceFile>();
    const pendingSourceFiles: ts.SourceFile[] = [];
    const enqueueResolvedSource = (fileName: string, identity: string): void => {
      const canonicalFileName = this.context.canonicalFileName(fileName);
      if (this.context.resourcesByCanonicalPath.has(canonicalFileName)) {
        throw new Error(
          `Pinned type-reference dependency ${identity} overlaps a bounded scenario resource.`
        );
      }
      const sourceFile = sourceFilesByCanonicalName.get(canonicalFileName);
      if (!sourceFile) {
        throw new Error(
          `Pinned type-reference dependency ${identity} is absent from the exact Program.`
        );
      }
      if (sources.has(sourceFile)) return;
      sources.add(sourceFile);
      pendingSourceFiles.push(sourceFile);
    };
    for (const typeReference of this.context.options.types ?? []) {
      const resolution = ts.resolveTypeReferenceDirective(
        typeReference,
        undefined,
        this.context.options,
        this.context.host
      ).resolvedTypeReferenceDirective;
      if (!resolution) {
        throw new Error(`Pinned type reference ${typeReference} has no exact resolution.`);
      }
      if (!resolution.resolvedFileName) {
        throw new Error(`Pinned type reference ${typeReference} has no resolved source identity.`);
      }
      enqueueResolvedSource(resolution.resolvedFileName, `types:${typeReference}`);
    }
    let pendingSourceFileIndex = 0;
    while (pendingSourceFileIndex < pendingSourceFiles.length) {
      const sourceFile = pendingSourceFiles[pendingSourceFileIndex++];
      for (const reference of sourceFile.referencedFiles) {
        enqueueResolvedSource(
          ts.resolveTripleslashReference(reference.fileName, sourceFile.fileName),
          `${sourceFile.fileName}:path:${reference.fileName}`
        );
      }
      for (const reference of sourceFile.typeReferenceDirectives) {
        const resolution = ts.resolveTypeReferenceDirective(
          reference.fileName,
          sourceFile.fileName,
          this.context.options,
          this.context.host
        ).resolvedTypeReferenceDirective;
        if (!resolution?.resolvedFileName) {
          throw new Error(
            `Pinned type-reference dependency ${sourceFile.fileName}:types:` +
            `${reference.fileName} has no exact resolution.`
          );
        }
        enqueueResolvedSource(
          resolution.resolvedFileName,
          `${sourceFile.fileName}:types:${reference.fileName}`
        );
      }
      const moduleSpecifiers: ts.StringLiteralLike[] = [];
      const collectModuleSpecifiers = (node: ts.Node): void => {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
          node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
          moduleSpecifiers.push(node.moduleSpecifier);
        } else if (ts.isImportEqualsDeclaration(node) &&
          ts.isExternalModuleReference(node.moduleReference) &&
          node.moduleReference.expression &&
          ts.isStringLiteralLike(node.moduleReference.expression)) {
          moduleSpecifiers.push(node.moduleReference.expression);
        }
        ts.forEachChild(node, collectModuleSpecifiers);
      };
      ts.forEachChild(sourceFile, collectModuleSpecifiers);
      for (const specifier of moduleSpecifiers) {
        const resolution = ts.resolveModuleName(
          specifier.text,
          sourceFile.fileName,
          this.context.options,
          this.context.host,
          this.context.resolutionCache,
          undefined,
          ts.getModeForUsageLocation(sourceFile, specifier, this.context.options)
        ).resolvedModule;
        if (resolution) {
          enqueueResolvedSource(
            resolution.resolvedFileName,
            `${sourceFile.fileName}:module:${specifier.text}`
          );
        }
      }
    }
    return new Set([...sources].sort((left, right) =>
      compareCanonicalText(left.fileName, right.fileName)));
  }

  private isExactDefaultLibrarySource(sourceFile: ts.SourceFile): boolean {
    if (!this.context.program.isSourceFileDefaultLibrary(sourceFile)) return false;
    if (this.context.resourcesByCanonicalPath.has(
      this.context.canonicalFileName(sourceFile.fileName)
    )) {
      throw new Error('An exact TypeScript default-library source overlaps scenario input.');
    }
    return true;
  }

  private isPinnedAmbientDeclarationSource(sourceFile: ts.SourceFile): boolean {
    if (this.isExactDefaultLibrarySource(sourceFile)) return true;
    return sourceFile.isDeclarationFile &&
      this.pinnedTypeReferenceDeclarationSources.has(sourceFile);
  }

  private defaultLibrarySourceFiles(): readonly ts.SourceFile[] {
    return Object.freeze(this.context.program.getSourceFiles()
      .filter((sourceFile) => this.isExactDefaultLibrarySource(sourceFile))
      .sort((left, right) => compareCanonicalText(left.fileName, right.fileName)));
  }

  private canonicalAmbientValueSymbols(name: string): ReadonlySet<ts.Symbol> {
    const cached = this.ambientValueSymbols.get(name);
    if (cached) return cached;
    const symbols = new Set<ts.Symbol>();
    const symbol = this.context.checker.resolveName(
      name,
      undefined,
      ts.SymbolFlags.Value,
      false
    );
    if (symbol) {
      const canonical = this.index.canonicalAlias(symbol);
      const declarations = canonical.declarations ?? [];
      const hasPinnedAmbientContributor = declarations.some((declaration) =>
        this.isPinnedAmbientDeclarationSource(declaration.getSourceFile()));
      if (hasPinnedAmbientContributor) {
        for (const identity of this.checkerSymbolIdentities(canonical)) symbols.add(identity);
      }
    }
    const frozen = new Set([...symbols]);
    this.ambientValueSymbols.set(name, frozen);
    return frozen;
  }

  private ambientCapabilityMask(node: ts.Identifier): number {
    const entry = CAPABILITY_REGISTRY.find((candidate) =>
      candidate.kind === 'ambient-global' && candidate.name === node.text);
    if (entry?.kind !== 'ambient-global') return 0;
    const symbol = this.index.symbolAt(node, true);
    if (entry.name === 'globalThis') {
      if (!symbol) return 0;
      return (symbol.flags & (ts.SymbolFlags.ValueModule | ts.SymbolFlags.NamespaceModule)) !== 0 &&
        (symbol.declarations?.length ?? 0) === 0
        ? entry.handles
        : 0;
    }
    if (!symbol || !this.checkerSymbolIdentities(symbol).some((identity) =>
      this.canonicalAmbientValueSymbols(entry.name).has(identity))) return 0;
    return entry.handles;
  }

  private canonicalIntrinsicInvocationSymbols(
    property: 'call' | 'apply' | 'bind',
    receiver: 'function' | 'reflect'
  ): ReadonlySet<ts.Symbol> {
    const cacheKey = `${receiver}\0${property}`;
    const cached = this.intrinsicInvocationSymbols.get(cacheKey);
    if (cached) return cached;
    const symbols = new Set<ts.Symbol>();
    const isDefaultLibrarySymbol = (symbol: ts.Symbol): boolean => {
      const declarations = symbol.declarations ?? [];
      return declarations.some((declaration) =>
        this.isExactDefaultLibrarySource(declaration.getSourceFile()));
    };
    for (const sourceFile of this.defaultLibrarySourceFiles()) {
      if (receiver === 'reflect') {
        const reflect = this.context.checker.resolveName(
          'Reflect',
          sourceFile,
          ts.SymbolFlags.Value,
          false
        );
        if (!reflect || !isDefaultLibrarySymbol(reflect)) continue;
        const member = this.context.checker
          .getTypeOfSymbolAtLocation(reflect, sourceFile)
          .getProperty(property);
        if (member && isDefaultLibrarySymbol(member)) {
          for (const identity of this.checkerSymbolIdentities(member)) {
            symbols.add(identity);
          }
        }
        continue;
      }
      for (const typeName of ['Function', 'CallableFunction', 'NewableFunction']) {
        const typeSymbol = this.context.checker.resolveName(
          typeName,
          sourceFile,
          ts.SymbolFlags.Type,
          false
        );
        if (!typeSymbol || !isDefaultLibrarySymbol(typeSymbol)) continue;
        const member = this.context.checker.getDeclaredTypeOfSymbol(typeSymbol)
          .getProperty(property);
        if (member && isDefaultLibrarySymbol(member)) {
          for (const identity of this.checkerSymbolIdentities(member)) {
            symbols.add(identity);
          }
        }
      }
    }
    const frozen = new Set([...symbols]);
    this.intrinsicInvocationSymbols.set(cacheKey, frozen);
    return frozen;
  }

  private exactInvocationMember(
    expression: ts.Expression,
    property: 'call' | 'apply' | 'bind',
    receiver: 'function' | 'reflect'
  ): ts.Expression | null {
    const value = unwrapExpression(expression);
    if (!ts.isPropertyAccessExpression(value) && !ts.isElementAccessExpression(value)) {
      return null;
    }
    const properties = ts.isPropertyAccessExpression(value)
      ? Object.freeze([value.name.text])
      : value.argumentExpression
        ? this.evaluator.evaluatePropertyKeys(value.argumentExpression)
        : null;
    if (properties?.length !== 1 || properties[0] !== property) return null;
    const memberSymbol = this.index.symbolAt(
      ts.isPropertyAccessExpression(value) ? value.name : value,
      true
    );
    const receiverType = this.context.checker.getTypeAtLocation(value.expression);
    const typeMember = receiverType.getProperty(property);
    const canonicalSymbols = this.canonicalIntrinsicInvocationSymbols(property, receiver);
    if (!memberSymbol || !typeMember) return null;
    const receiverSymbol = this.index.lexicalSymbol(value.expression);
    if (receiverSymbol && this.evaluator.hasObservedWrite(receiverSymbol)) return null;
    const accessIdentities = this.checkerSymbolIdentities(memberSymbol);
    const typeIdentities = new Set(this.checkerSymbolIdentities(typeMember));
    if (!accessIdentities.some((identity) => typeIdentities.has(identity)) ||
      !accessIdentities.some((identity) => canonicalSymbols.has(identity))) return null;
    if (receiver === 'reflect') {
      return this.exactAmbientIdentifier(value.expression, 'Reflect')
        ? value.expression
        : null;
    }
    return receiverType.getCallSignatures().length > 0 ||
      receiverType.getConstructSignatures().length > 0
      ? value.expression
      : null;
  }

  private exactAppliedArguments(
    expression: ts.Expression
  ): readonly ts.Expression[] | null {
    const value = unwrapExpression(expression);
    if (!ts.isArrayLiteralExpression(value) || value.elements.some((element) =>
      ts.isSpreadElement(element) || ts.isOmittedExpression(element))) return null;
    return Object.freeze([...value.elements] as ts.Expression[]);
  }

  private canonicalDefaultLibraryValueSymbols(name: string): ReadonlySet<ts.Symbol> {
    const cached = this.defaultLibraryValueSymbols.get(name);
    if (cached) return cached;
    const symbols = new Set<ts.Symbol>();
    for (const sourceFile of this.defaultLibrarySourceFiles()) {
      const symbol = this.context.checker.resolveName(
        name,
        sourceFile,
        ts.SymbolFlags.Value,
        false
      );
      if (!symbol) continue;
      const canonical = this.index.canonicalAlias(symbol);
      const declarations = canonical.declarations ?? [];
      if (declarations.some((declaration) =>
        this.isExactDefaultLibrarySource(declaration.getSourceFile()))) {
        for (const identity of this.checkerSymbolIdentities(canonical)) {
          symbols.add(identity);
        }
      }
    }
    const frozen = new Set([...symbols]);
    this.defaultLibraryValueSymbols.set(name, frozen);
    return frozen;
  }

  private canonicalPinnedAmbientValueSymbols(name: string): ReadonlySet<ts.Symbol> {
    const cached = this.pinnedAmbientValueSymbols.get(name);
    if (cached) return cached;
    const symbols = new Set<ts.Symbol>();
    for (const sourceFile of this.pinnedTypeReferenceDeclarationSources) {
      const symbol = this.context.checker.resolveName(
        name,
        sourceFile,
        ts.SymbolFlags.Value,
        false
      );
      if (!symbol) continue;
      const canonical = this.index.canonicalAlias(symbol);
      const declarations = canonical.declarations ?? [];
      if (declarations.length > 0 && declarations.every((declaration) =>
        this.isPinnedAmbientDeclarationSource(declaration.getSourceFile()))) {
        for (const identity of this.checkerSymbolIdentities(canonical)) {
          symbols.add(identity);
        }
      }
    }
    const frozen = new Set([...symbols]);
    this.pinnedAmbientValueSymbols.set(name, frozen);
    return frozen;
  }

  private isExactDefaultLibraryValue(
    expression: ts.Expression,
    name: string,
    seenSymbols = new Set<ts.Symbol>()
  ): boolean {
    const value = unwrapExpression(expression);
    if (!ts.isIdentifier(value)) return false;
    const symbol = this.index.symbolAt(value, true);
    if (!symbol) return false;
    if (this.checkerSymbolIdentities(symbol).some((identity) =>
      this.canonicalDefaultLibraryValueSymbols(name).has(identity))) return true;
    if (seenSymbols.has(symbol)) return false;
    const declarations = symbol.declarations ?? [];
    if (declarations.length !== 1 || !ts.isVariableDeclaration(declarations[0]) ||
      !declarations[0].initializer || !ts.isVariableDeclarationList(declarations[0].parent) ||
      (declarations[0].parent.flags & ts.NodeFlags.Const) === 0) return false;
    seenSymbols.add(symbol);
    const result = this.isExactDefaultLibraryValue(
      declarations[0].initializer,
      name,
      seenSymbols
    );
    seenSymbols.delete(symbol);
    return result;
  }

  private isExactPinnedAmbientValue(
    expression: ts.Expression,
    name: string,
    seenSymbols = new Set<ts.Symbol>()
  ): boolean {
    const value = unwrapExpression(expression);
    if (!ts.isIdentifier(value)) return false;
    const symbol = this.index.symbolAt(value, true);
    if (!symbol) return false;
    if (this.checkerSymbolIdentities(symbol).some((identity) =>
      this.canonicalPinnedAmbientValueSymbols(name).has(identity))) return true;
    if (seenSymbols.has(symbol)) return false;
    const declarations = symbol.declarations ?? [];
    if (declarations.length !== 1 || !ts.isVariableDeclaration(declarations[0]) ||
      !declarations[0].initializer || !ts.isVariableDeclarationList(declarations[0].parent) ||
      (declarations[0].parent.flags & ts.NodeFlags.Const) === 0) return false;
    seenSymbols.add(symbol);
    const result = this.isExactPinnedAmbientValue(
      declarations[0].initializer,
      name,
      seenSymbols
    );
    seenSymbols.delete(symbol);
    return result;
  }

  private callableShapeHintForType(type: ts.Type): number {
    const uncertainMask = ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.TypeParameter;
    if ((type.flags & uncertainMask) !== 0) return CallableShapeBit.PotentialCallable;
    if (type.isUnion()) {
      let hasCallable = false;
      let hasNonCallable = false;
      let hasUncertain = false;
      for (const constituent of type.types) {
        const hint = this.callableShapeHintForType(constituent);
        if (hint === CallableShapeBit.PotentialCallable) hasUncertain = true;
        else if (hint === CallableShapeBit.Callable) hasCallable = true;
        else hasNonCallable = true;
      }
      return hasUncertain || (hasCallable && hasNonCallable)
        ? CallableShapeBit.PotentialCallable
        : hasCallable ? CallableShapeBit.Callable : 0;
    }
    return type.getCallSignatures().length > 0 ||
      type.getConstructSignatures().length > 0
      ? CallableShapeBit.Callable
      : 0;
  }

  private callableShapeHintForExpression(expression: ts.Expression): number {
    return this.callableShapeHintForType(this.context.checker.getTypeAtLocation(expression));
  }

  private argumentMayTriggerDefault(expression: ts.Expression): boolean {
    const type = this.context.checker.getTypeAtLocation(expression);
    const uncertainOrUndefined = ts.TypeFlags.Any | ts.TypeFlags.Unknown |
      ts.TypeFlags.TypeParameter | ts.TypeFlags.Undefined | ts.TypeFlags.Void;
    if ((type.flags & uncertainOrUndefined) !== 0) return true;
    return type.isUnion() && type.types.some((constituent) =>
      (constituent.flags & uncertainOrUndefined) !== 0);
  }

  private syntheticBoundArguments(
    expressions: readonly ts.Expression[],
    module: ProgramModule
  ): readonly SyntheticBoundArgument[] {
    return Object.freeze(expressions.map((expression) => Object.freeze({
      source: Object.freeze({ ...this.index.valueForExpression(expression, module) }),
      mayTriggerDefault: this.argumentMayTriggerDefault(expression)
    })));
  }

  private parameterDefaultsForCallable(
    callable: ExecutableCallableModel
  ): readonly (SyntheticBoundParameterDefault | null)[] {
    if ('declaration' in callable) {
      return Object.freeze(callable.declaration.parameters.map((parameter, index) =>
        parameter.initializer
          ? Object.freeze({
              source: Object.freeze({ ...this.index.valueForExpression(
                parameter.initializer,
                callable.module
              ) }),
              target: Object.freeze({ ...callable.parameters[index]! })
            })
          : null));
    }
    return isSyntheticBoundCallable(callable)
      ? callable.parameterDefaults
      : Object.freeze([]);
  }

  private registerExternalCallbackProbe(
    argument: ts.Expression,
    module: ProgramModule,
    gateCallSiteId: string,
    identity: string
  ): void {
    const argumentNode = this.index.valueForExpression(argument, module);
    this.assembler.ensureNode(argumentNode, module.scenarioId);
    const callableShapeHint = this.callableShapeHintForExpression(argument);
    if (callableShapeHint !== 0) {
      this.assembler.seed(argumentNode, module.scenarioId, {
        callableShapes: callableShapeHint
      });
    }
    this.rawExternalCallbackProbes.push(Object.freeze({
      id: identity,
      scenarioId: module.scenarioId,
      argument: Object.freeze({ ...argumentNode }),
      gateCallSiteId
    }));
  }

  private registerOpaqueExternalCallbackProbe(
    node: ts.CallExpression | ts.NewExpression,
    module: ProgramModule,
    gateCallSiteId: string,
    identity: string
  ): void {
    const unknownArgument: FiniteProofNodeRef = Object.freeze({
      kind: 'value',
      id: `${module.scenarioId}:value:opaque-external-arguments:` +
        `${module.relativePath}:${node.pos}:${node.end}`
    });
    this.assembler.seed(unknownArgument, module.scenarioId, {
      callableShapes: CallableShapeBit.PotentialCallable
    });
    this.rawExternalCallbackProbes.push(Object.freeze({
      id: identity,
      scenarioId: module.scenarioId,
      argument: unknownArgument,
      gateCallSiteId
    }));
  }

  private externalCallbackParameterIndexes(
    node: ts.CallExpression | ts.NewExpression
  ): readonly number[] {
    if (!ts.isNewExpression(node)) return Object.freeze([]);
    const value = unwrapExpression(node.expression);
    if (!ts.isIdentifier(value)) return Object.freeze([]);
    const constructSignatures = this.context.checker.getTypeAtLocation(value)
      .getConstructSignatures();
    const indexes: number[] = [];
    for (const contract of EXTERNAL_CALLBACK_EXECUTION_CONTRACTS) {
      if (contract.invocation !== 'construct' ||
        !this.isExactDefaultLibraryValue(value, contract.ambientSymbolName) ||
        constructSignatures.length === 0 || !node.arguments?.[contract.parameterIndex]) continue;
      const hasExactCallableParameter = constructSignatures.some((signature) => {
        const declaration = signature.declaration;
        const parameter = signature.parameters[contract.parameterIndex];
        if (!declaration || !parameter ||
          !this.isExactDefaultLibrarySource(declaration.getSourceFile())) {
          return false;
        }
        const parameterType = this.context.checker.getTypeOfSymbolAtLocation(
          parameter,
          parameter.valueDeclaration ?? declaration
        );
        return parameterType.getCallSignatures().length > 0;
      });
      if (hasExactCallableParameter) indexes.push(contract.parameterIndex);
    }
    return Object.freeze([...new Set(indexes)].sort((left, right) => left - right));
  }

  private isExactExternalInvocationTarget(expression: ts.Expression): boolean {
    const targetType = this.context.checker.getTypeAtLocation(expression);
    if (targetType.getCallSignatures().length === 0 &&
      targetType.getConstructSignatures().length === 0) {
      const valueKind = unwrapExpression(expression).kind;
      if (valueKind !== ts.SyntaxKind.PropertyAccessExpression &&
        valueKind !== ts.SyntaxKind.ElementAccessExpression) {
        return false;
      }
    }
    const acquisition = this.acquisitionForExpression(expression);
    if (acquisition?.target.kind === 'external') return true;
    const value = unwrapExpression(expression);
    if (ts.isIdentifier(value)) {
      if (this.ambientCapabilityMask(value) !== 0) return true;
      return this.isExactDefaultLibraryValue(value, value.text) ||
        this.isExactPinnedAmbientValue(value, value.text);
    }
    if (value.kind === ts.SyntaxKind.SuperKeyword) {
      return this.isExactExternalSuperBase(value);
    }
    if (ts.isPropertyAccessExpression(value)) {
      if (this.directCapabilityHandles(value) !== 0) return true;
      const member = this.index.symbolAt(value.name, true);
      const memberDeclarations = member?.declarations ?? [];
      if (memberDeclarations.length > 0 && memberDeclarations.every((declaration) =>
        this.isPinnedAmbientDeclarationSource(declaration.getSourceFile()))) {
        const memberType = member
          ? this.context.checker.getTypeOfSymbolAtLocation(member, value)
          : null;
        if ((memberType?.getCallSignatures().length ?? 0) > 0 ||
          (memberType?.getConstructSignatures().length ?? 0) > 0) {
          return true;
        }
      }
      const receiver = value.expression;
      if (ts.isIdentifier(receiver) &&
        (this.isExactDefaultLibraryValue(receiver, receiver.text) ||
          this.isExactPinnedAmbientValue(receiver, receiver.text)) &&
        memberDeclarations.some((declaration) =>
          this.isPinnedAmbientDeclarationSource(declaration.getSourceFile()))) {
        return true;
      }
      return false;
    }
    return ts.isElementAccessExpression(value) && this.directCapabilityHandles(value) !== 0;
  }

  private isExactExternalSuperBase(expression: ts.Expression): boolean {
    let current: ts.Node | undefined = expression;
    while (current && !ts.isClassLike(current)) current = current.parent;
    const classLike = current as ts.ClassLikeDeclaration | undefined;
    if (!classLike?.heritageClauses) return false;
    for (const clause of classLike.heritageClauses) {
      if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue;
      for (const heritage of clause.types) {
        const symbol = this.index.symbolAt(heritage.expression, true);
        const declarations = symbol?.declarations ?? [];
        if (declarations.length > 0 && declarations.every((declaration) =>
          this.isPinnedAmbientDeclarationSource(declaration.getSourceFile()))) {
          return true;
        }
      }
    }
    return false;
  }

  private syntheticBoundCallableAt(
    expression: ts.Expression,
    module: ProgramModule,
    seenSymbols = new Set<ts.Symbol>()
  ): SyntheticBoundCallableModel | null {
    const value = unwrapExpression(expression);
    const direct = this.syntheticBoundCallableByValueNodeKey.get(
      nodeKey(this.index.valueForExpression(value, module))
    );
    if (direct) return direct;
    if (!ts.isIdentifier(value)) return null;
    const symbol = this.index.lexicalSymbol(value);
    if (!symbol || seenSymbols.has(symbol)) return null;
    const declarations = symbol.declarations ?? [];
    if (declarations.length !== 1 || !ts.isVariableDeclaration(declarations[0]) ||
      !declarations[0].initializer || !ts.isVariableDeclarationList(declarations[0].parent) ||
      (declarations[0].parent.flags & ts.NodeFlags.Const) === 0) return null;
    seenSymbols.add(symbol);
    const result = this.syntheticBoundCallableAt(
      declarations[0].initializer,
      module,
      seenSymbols
    );
    seenSymbols.delete(symbol);
    return result;
  }

  private syntheticBoundConstructAt(
    expression: ts.Expression,
    module: ProgramModule,
    seenSymbols = new Set<ts.Symbol>()
  ): SyntheticBoundConstructModel | null {
    const value = unwrapExpression(expression);
    const direct = this.syntheticBoundConstructByValueNodeKey.get(
      nodeKey(this.index.valueForExpression(value, module))
    );
    if (direct) return direct;
    if (!ts.isIdentifier(value)) return null;
    const symbol = this.index.lexicalSymbol(value);
    if (!symbol || seenSymbols.has(symbol)) return null;
    const declarations = symbol.declarations ?? [];
    if (declarations.length !== 1 || !ts.isVariableDeclaration(declarations[0]) ||
      !declarations[0].initializer || !ts.isVariableDeclarationList(declarations[0].parent) ||
      (declarations[0].parent.flags & ts.NodeFlags.Const) === 0) return null;
    seenSymbols.add(symbol);
    const result = this.syntheticBoundConstructAt(
      declarations[0].initializer,
      module,
      seenSymbols
    );
    seenSymbols.delete(symbol);
    return result;
  }

  private isExactCreateRequireFactory(expression: ts.Expression): boolean {
    const acquisition = this.acquisitionForExpression(expression);
    if (acquisition?.target.kind !== 'external' ||
      normalizeBuiltinSpecifier(acquisition.target.specifier) !== 'node:module') return false;
    return (this.capabilityHintForExpression(expression) & HandleBit.RequireLoader) !== 0;
  }

  private exactCanonicalCalleeFor(
    node: ts.CallExpression | ts.NewExpression
  ): boolean {
    const targetExpression = this.normalizeInvocation(node).targetExpression;
    const value = unwrapExpression(targetExpression);
    if (!ts.isIdentifier(value)) return false;
    const symbol = this.index.symbolAt(value, true);
    if (!symbol) return false;
    const callable = this.index.callableForExactSymbol(symbol);
    if (!callable || isSyntheticBoundCallable(callable)) return false;
    const declarations = symbol.declarations ?? [];
    return declarations.length === 1 &&
      (ts.isFunctionDeclaration(declarations[0]) ||
        ts.isClassDeclaration(declarations[0])) &&
      declarations[0].name?.text === value.text;
  }

  private isExactNamedImport(
    expression: ts.Expression,
    moduleSpecifier: string,
    importedName: string
  ): boolean {
    const value = unwrapExpression(expression);
    if (!ts.isIdentifier(value)) return false;
    const symbol = this.index.lexicalSymbol(value);
    const declarations = symbol?.declarations ?? [];
    if (declarations.length !== 1 || !ts.isImportSpecifier(declarations[0])) return false;
    const declaration = declarations[0];
    const namedImports = declaration.parent;
    if (!ts.isNamedImports(namedImports)) return false;
    const importClause = namedImports.parent;
    if (!ts.isImportClause(importClause) || importClause.isTypeOnly || declaration.isTypeOnly) {
      return false;
    }
    const importDeclaration = importClause.parent;
    return ts.isImportDeclaration(importDeclaration) &&
      ts.isStringLiteralLike(importDeclaration.moduleSpecifier) &&
      importDeclaration.moduleSpecifier.text === moduleSpecifier &&
      declaration.name.text === value.text &&
      (declaration.propertyName?.text ?? declaration.name.text) === importedName;
  }

  private hasExactGitObservationOptions(expression: ts.Expression): boolean {
    const value = unwrapExpression(expression);
    if (!ts.isObjectLiteralExpression(value) || value.properties.length !== 1) return false;
    const property = value.properties[0];
    return ts.isPropertyAssignment(property) && semanticPropertyName(property.name) === 'cwd' &&
      this.isExactNamedImport(property.initializer, '../shared/paths.ts', 'compilerRoot');
  }

  private exactLocalDeclaration(expression: ts.Expression): ts.Declaration | null {
    const value = unwrapExpression(expression);
    if (!ts.isIdentifier(value)) return null;
    const symbol = this.index.lexicalSymbol(value);
    const declarations = symbol?.declarations ?? [];
    return symbol && !this.evaluator.hasObservedWrite(symbol) && declarations.length === 1
      ? declarations[0]!
      : null;
  }

  private referencesDeclaration(
    expression: ts.Expression,
    declaration: ts.Declaration
  ): boolean {
    return this.exactLocalDeclaration(expression) === declaration;
  }

  private exactConstVariableDeclaration(expression: ts.Expression): ts.VariableDeclaration | null {
    const declaration = this.exactLocalDeclaration(expression);
    return declaration && ts.isVariableDeclaration(declaration) &&
      ts.isIdentifier(declaration.name) && declaration.initializer &&
      ts.isVariableDeclarationList(declaration.parent) &&
      (declaration.parent.flags & ts.NodeFlags.Const) !== 0
      ? declaration
      : null;
  }

  private isExactUndefined(expression: ts.Expression): boolean {
    const value = unwrapExpression(expression);
    if (!ts.isIdentifier(value) || value.text !== 'undefined') return false;
    const symbol = this.index.lexicalSymbol(value);
    return symbol !== null && (symbol.declarations?.length ?? 0) === 0;
  }

  private isExactNull(expression: ts.Expression): boolean {
    return unwrapExpression(expression).kind === ts.SyntaxKind.NullKeyword;
  }

  private isExactProcessEnvProperty(expression: ts.Expression, propertyName: string): boolean {
    const value = unwrapExpression(expression);
    if (!ts.isPropertyAccessExpression(value) || value.name.text !== propertyName) return false;
    const env = unwrapExpression(value.expression);
    return ts.isPropertyAccessExpression(env) && env.name.text === 'env' &&
      this.isExactPinnedAmbientValue(env.expression, 'process');
  }

  private isExactAffectedTestsBaseRefDeclaration(
    declaration: ts.Declaration
  ): declaration is ts.FunctionDeclaration {
    if (!ts.isFunctionDeclaration(declaration) ||
      declaration.parent !== declaration.getSourceFile() ||
      declaration.name?.text !== 'affectedTestsBaseRef' || declaration.parameters.length !== 0 ||
      nodeHasModifier(declaration, ts.SyntaxKind.ExportKeyword) ||
      nodeHasModifier(declaration, ts.SyntaxKind.DefaultKeyword) ||
      !declaration.body || declaration.body.statements.length !== 1) return false;
    const symbol = this.index.symbolAt(declaration.name, true);
    if (!symbol || symbol.declarations?.length !== 1 ||
      symbol.declarations[0] !== declaration) return false;
    const statement = declaration.body.statements[0];
    if (!ts.isReturnStatement(statement) || !statement.expression) return false;
    const returned = unwrapExpression(statement.expression);
    return ts.isBinaryExpression(returned) &&
      returned.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken &&
      this.isExactProcessEnvProperty(returned.left, 'SEC_AFFECTED_TESTS_BASE') &&
      this.isExactProcessEnvProperty(returned.right, 'SEC_CHANGED_BASE');
  }

  private isExactAffectedTestsBaseRefCall(expression: ts.Expression): boolean {
    const value = unwrapExpression(expression);
    if (!ts.isCallExpression(value) || value.arguments.length !== 0) return false;
    const callable = this.index.exactCallableAt(value.expression);
    const declaration = callable?.declaration;
    return declaration !== undefined &&
      this.isExactAffectedTestsBaseRefDeclaration(declaration);
  }

  private exactAffectedTestsBaseRefDeclaration(
    expression: ts.Expression
  ): ts.VariableDeclaration | null {
    const declaration = this.exactConstVariableDeclaration(expression);
    return declaration && declaration.initializer &&
      this.isExactAffectedTestsBaseRefCall(declaration.initializer)
      ? declaration
      : null;
  }

  private isExactRunCommandBytesCall(
    expression: ts.Expression,
    argv: (expression: ts.Expression) => boolean
  ): expression is ts.CallExpression {
    const value = unwrapExpression(expression);
    return ts.isCallExpression(value) && value.arguments.length === 3 &&
      this.isExactNamedImport(value.expression, '../shared/process.ts', 'runCommandBytes') &&
      ts.isStringLiteralLike(value.arguments[0]!) && value.arguments[0].text === 'git' &&
      argv(value.arguments[1]!) && this.hasExactGitObservationOptions(value.arguments[2]!);
  }

  private isExactRevParseCall(
    expression: ts.Expression,
    role: 'base' | 'head',
    baseRefDeclaration: ts.VariableDeclaration
  ): boolean {
    return this.isExactRunCommandBytesCall(expression, (argvExpression) => {
      const argv = unwrapExpression(argvExpression);
      if (!ts.isArrayLiteralExpression(argv) || argv.elements.length !== 3 ||
        argv.elements.some(ts.isSpreadElement) ||
        !ts.isStringLiteralLike(argv.elements[0]!) || argv.elements[0].text !== 'rev-parse' ||
        !ts.isStringLiteralLike(argv.elements[1]!) || argv.elements[1].text !== '--verify') {
        return false;
      }
      const revision = argv.elements[2]!;
      if (role === 'head') {
        return ts.isStringLiteralLike(revision) && revision.text === 'HEAD^{commit}';
      }
      return ts.isTemplateExpression(revision) && revision.head.text === '' &&
        revision.templateSpans.length === 1 &&
        this.referencesDeclaration(
          revision.templateSpans[0]!.expression,
          baseRefDeclaration
        ) && revision.templateSpans[0]!.literal.text === '^{commit}';
    });
  }

  private exactRevisionResultBinding(
    expression: ts.Expression,
    role: 'base' | 'head'
  ): ts.BindingElement | null {
    const declaration = this.exactLocalDeclaration(expression);
    if (!declaration || !ts.isBindingElement(declaration) ||
      !ts.isIdentifier(declaration.name) || !ts.isArrayBindingPattern(declaration.parent)) return null;
    const bindingPattern = declaration.parent;
    if (bindingPattern.elements.length !== 2 ||
      bindingPattern.elements.some(ts.isOmittedExpression) ||
      bindingPattern.elements[role === 'base' ? 0 : 1] !== declaration) return null;
    const variable = bindingPattern.parent;
    if (!ts.isVariableDeclaration(variable) || variable.name !== bindingPattern ||
      !variable.initializer || !ts.isVariableDeclarationList(variable.parent) ||
      (variable.parent.flags & ts.NodeFlags.Const) === 0) return null;
    const initializer = unwrapExpression(variable.initializer);
    if (!ts.isConditionalExpression(initializer)) return null;
    const condition = unwrapExpression(initializer.condition);
    if (!ts.isBinaryExpression(condition) ||
      condition.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken ||
      !this.isExactUndefined(condition.right)) return null;
    const baseRefDeclaration = this.exactAffectedTestsBaseRefDeclaration(condition.left);
    if (!baseRefDeclaration) return null;
    const whenTrue = unwrapExpression(initializer.whenTrue);
    if (!ts.isArrayLiteralExpression(whenTrue) || whenTrue.elements.length !== 2 ||
      !whenTrue.elements.every((element) => this.isExactNull(element))) return null;
    const whenFalse = unwrapExpression(initializer.whenFalse);
    if (!ts.isCallExpression(whenFalse) || !ts.isPropertyAccessExpression(whenFalse.expression) ||
      whenFalse.expression.name.text !== 'all' ||
      !this.isExactDefaultLibraryValue(whenFalse.expression.expression, 'Promise') ||
      whenFalse.arguments.length !== 1) return null;
    const observations = unwrapExpression(whenFalse.arguments[0]!);
    return ts.isArrayLiteralExpression(observations) && observations.elements.length === 2 &&
      this.isExactRevParseCall(observations.elements[0]!, 'base', baseRefDeclaration) &&
      this.isExactRevParseCall(observations.elements[1]!, 'head', baseRefDeclaration)
      ? declaration
      : null;
  }

  private isExactRevisionParserCall(
    expression: ts.Expression,
    resultDeclaration: ts.BindingElement
  ): boolean {
    const value = unwrapExpression(expression);
    if (!ts.isCallExpression(value) || value.arguments.length !== 1) return false;
    const callable = this.index.exactCallableAt(value.expression);
    const declaration = callable?.declaration;
    if (!declaration || !ts.isFunctionDeclaration(declaration) ||
      declaration.parent !== declaration.getSourceFile() ||
      declaration.name?.text !== 'exactRevision' || declaration.parameters.length !== 1 ||
      declaration.getSourceFile() !== value.getSourceFile() ||
      !this.isExactRevisionParserDeclaration(declaration) ||
      !this.isPrivateRevisionParserSymbol(declaration)) {
      return false;
    }
    const stdout = unwrapExpression(value.arguments[0]!);
    return ts.isPropertyAccessExpression(stdout) && stdout.name.text === 'stdout' &&
      this.referencesDeclaration(stdout.expression, resultDeclaration);
  }

  private isPrivateRevisionParserSymbol(declaration: ts.FunctionDeclaration): boolean {
    if (!declaration.name || nodeHasModifier(declaration, ts.SyntaxKind.ExportKeyword) ||
      nodeHasModifier(declaration, ts.SyntaxKind.DefaultKeyword)) return false;
    const symbol = this.index.symbolAt(declaration.name, true);
    if (!symbol || symbol.declarations?.length !== 1 ||
      symbol.declarations[0] !== declaration) return false;
    const module = this.context.modulesBySourceFile.get(declaration.getSourceFile());
    if (!module) return false;
    const owners = this.index.allCallables().filter((callable) => {
      const candidate = callable.declaration;
      return callable.module === module && callable.parentCallableId === null &&
        ts.isFunctionDeclaration(candidate) && candidate.parent === module.sourceFile &&
        candidate.name?.text === 'gitChangedFiles';
    });
    if (owners.length !== 1 || !this.isPrivateGitChangedFilesOwner(owners[0]!)) return false;
    const owner = owners[0]!;
    const parserIdentities = new Set(this.checkerSymbolIdentities(symbol));
    let escaped = false;
    const visit = (node: ts.Node): void => {
      if (escaped) return;
      if (ts.isIdentifier(node)) {
        const candidate = this.index.symbolAt(node, true);
        const isParser = candidate !== null && this.checkerSymbolIdentities(candidate)
          .some((identity) => parserIdentities.has(identity));
        if (isParser && node !== declaration.name) {
          const parent = node.parent;
          if (!ts.isCallExpression(parent) || parent.expression !== node ||
            this.enclosingCallable(parent)?.id !== owner.id) {
            escaped = true;
            return;
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(module.sourceFile);
    return !escaped;
  }

  private enclosingCallable(node: ts.Node): CallableModel | null {
    let current: ts.Node | undefined = node.parent;
    while (current && !ts.isSourceFile(current)) {
      if (isFunctionLikeWithBody(current)) {
        return this.index.callableForDeclaration(current);
      }
      current = current.parent;
    }
    return null;
  }

  private isPrivateGitChangedFilesOwner(callable: CallableModel): boolean {
    const declaration = callable.declaration;
    if (!ts.isFunctionDeclaration(declaration) || !declaration.name ||
      declaration.parent !== callable.module.sourceFile ||
      declaration.name.text !== 'gitChangedFiles' ||
      nodeHasModifier(declaration, ts.SyntaxKind.ExportKeyword) ||
      nodeHasModifier(declaration, ts.SyntaxKind.DefaultKeyword)) return false;
    const symbol = this.index.symbolAt(declaration.name, true);
    return symbol !== null && symbol.declarations?.length === 1 &&
      symbol.declarations[0] === declaration;
  }

  private isExactRevisionParserDeclaration(declaration: ts.FunctionDeclaration): boolean {
    if (!declaration.body || declaration.asteriskToken ||
      nodeHasModifier(declaration, ts.SyntaxKind.AsyncKeyword) ||
      declaration.parameters.length !== 1) return false;
    const parameter = declaration.parameters[0]!;
    if (!ts.isIdentifier(parameter.name) || parameter.initializer || parameter.dotDotDotToken ||
      parameter.questionToken) return false;
    const parameterSymbol = this.index.lexicalSymbol(parameter.name);
    if (!parameterSymbol || this.evaluator.hasObservedWrite(parameterSymbol)) return false;
    const statements = declaration.body.statements;
    if (statements.length !== 1 || !ts.isTryStatement(statements[0]!)) return false;
    const tryStatement = statements[0]!;
    if (tryStatement.finallyBlock || !tryStatement.catchClause ||
      tryStatement.catchClause.variableDeclaration ||
      tryStatement.catchClause.block.statements.length !== 1 ||
      !this.isExactNullReturn(tryStatement.catchClause.block.statements[0]!)) return false;
    if (tryStatement.tryBlock.statements.length !== 2) return false;
    const valueStatement = tryStatement.tryBlock.statements[0]!;
    if (!ts.isVariableStatement(valueStatement) ||
      valueStatement.declarationList.declarations.length !== 1 ||
      (valueStatement.declarationList.flags & ts.NodeFlags.Const) === 0) return false;
    const valueDeclaration = valueStatement.declarationList.declarations[0]!;
    if (!ts.isIdentifier(valueDeclaration.name) || !valueDeclaration.initializer ||
      !this.isExactDecodedTrimmedRevision(
        valueDeclaration.initializer,
        parameter,
        parameterSymbol
      )) return false;
    const valueSymbol = this.index.lexicalSymbol(valueDeclaration.name);
    if (!valueSymbol || this.evaluator.hasObservedWrite(valueSymbol)) return false;
    const returnStatement = tryStatement.tryBlock.statements[1]!;
    if (!ts.isReturnStatement(returnStatement) || !returnStatement.expression) return false;
    const returned = unwrapExpression(returnStatement.expression);
    if (!ts.isConditionalExpression(returned) || !this.isExactNull(returned.whenFalse) ||
      !this.referencesDeclaration(returned.whenTrue, valueDeclaration)) return false;
    const condition = unwrapExpression(returned.condition);
    if (!ts.isCallExpression(condition) || condition.arguments.length !== 1 ||
      !this.referencesDeclaration(condition.arguments[0]!, valueDeclaration) ||
      !ts.isPropertyAccessExpression(condition.expression) ||
      condition.expression.name.text !== 'test') return false;
    const pattern = unwrapExpression(condition.expression.expression);
    return ts.isRegularExpressionLiteral(pattern) &&
      pattern.text === '/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u';
  }

  private isExactNullReturn(statement: ts.Statement): boolean {
    return ts.isReturnStatement(statement) && statement.expression !== undefined &&
      this.isExactNull(statement.expression);
  }

  private isExactDecodedTrimmedRevision(
    expression: ts.Expression,
    parameter: ts.ParameterDeclaration,
    parameterSymbol: ts.Symbol
  ): boolean {
    const trimCall = unwrapExpression(expression);
    if (!ts.isCallExpression(trimCall) || trimCall.arguments.length !== 0 ||
      !ts.isPropertyAccessExpression(trimCall.expression) ||
      trimCall.expression.name.text !== 'trim') return false;
    const decodeCall = unwrapExpression(trimCall.expression.expression);
    if (!ts.isCallExpression(decodeCall) || decodeCall.arguments.length !== 1 ||
      !ts.isPropertyAccessExpression(decodeCall.expression) ||
      decodeCall.expression.name.text !== 'decode') return false;
    const stdout = unwrapExpression(decodeCall.arguments[0]!);
    if (!ts.isIdentifier(stdout) || this.index.lexicalSymbol(stdout) !== parameterSymbol ||
      this.index.lexicalSymbol(parameter.name) !== parameterSymbol) return false;
    const decoder = unwrapExpression(decodeCall.expression.expression);
    if (!ts.isNewExpression(decoder) || decoder.arguments?.length !== 2 ||
      !this.isExactPinnedAmbientValue(decoder.expression, 'TextDecoder') ||
      !ts.isStringLiteralLike(decoder.arguments[0]!) ||
      decoder.arguments[0].text !== 'utf-8') return false;
    const options = unwrapExpression(decoder.arguments[1]!);
    if (!ts.isObjectLiteralExpression(options) || options.properties.length !== 1) return false;
    const fatal = options.properties[0]!;
    return ts.isPropertyAssignment(fatal) && semanticPropertyName(fatal.name) === 'fatal' &&
      unwrapExpression(fatal.initializer).kind === ts.SyntaxKind.TrueKeyword;
  }

  private exactRevisionShaDeclaration(
    expression: ts.Expression,
    role: 'base' | 'head'
  ): ts.VariableDeclaration | null {
    const declaration = this.exactConstVariableDeclaration(expression);
    if (!declaration?.initializer) return null;
    const initializer = unwrapExpression(declaration.initializer);
    if (!ts.isConditionalExpression(initializer) || !this.isExactNull(initializer.whenFalse)) {
      return null;
    }
    const condition = unwrapExpression(initializer.condition);
    if (!ts.isBinaryExpression(condition) ||
      condition.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken ||
      !ts.isNumericLiteral(condition.right) || condition.right.text !== '0') return null;
    const code = unwrapExpression(condition.left);
    if (!ts.isPropertyAccessExpression(code) || code.name.text !== 'code' ||
      code.questionDotToken === undefined) return null;
    const resultDeclaration = this.exactRevisionResultBinding(code.expression, role);
    return resultDeclaration &&
      this.isExactRevisionParserCall(initializer.whenTrue, resultDeclaration)
      ? declaration
      : null;
  }

  private isExactChangedDiffBuilderCall(expression: ts.Expression): boolean {
    const value = unwrapExpression(expression);
    return ts.isCallExpression(value) && value.arguments.length === 2 &&
      this.isExactNamedImport(
        value.expression,
        '../shared/ci-git-changed-files.ts',
        'gitChangedFileDiffArgs'
      ) && (() => {
        const base = unwrapExpression(value.arguments[0]!);
        return ts.isBinaryExpression(base) &&
          base.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken &&
          this.exactRevisionShaDeclaration(base.left, 'base') !== null &&
          ts.isStringLiteralLike(base.right) && base.right.text === 'HEAD';
      })() && this.isExactNull(value.arguments[1]!);
  }

  private isExactUntrackedBuilderCall(expression: ts.Expression): boolean {
    const value = unwrapExpression(expression);
    return ts.isCallExpression(value) && value.arguments.length === 0 &&
      this.isExactNamedImport(
        value.expression,
        '../shared/ci-git-changed-files.ts',
        'gitUntrackedFileArgs'
      );
  }

  private isExactWorktreeStatusBuilderCall(expression: ts.Expression): boolean {
    const value = unwrapExpression(expression);
    return ts.isCallExpression(value) && value.arguments.length === 0 &&
      this.isExactNamedImport(
        value.expression,
        '../shared/ci-git-changed-files.ts',
        'gitWorkingTreeStatusArgs'
      );
  }

  private exactTrackedResultBinding(expression: ts.Expression): ts.BindingElement | null {
    const declaration = this.exactLocalDeclaration(expression);
    if (!declaration || !ts.isBindingElement(declaration) ||
      !ts.isIdentifier(declaration.name) || !ts.isArrayBindingPattern(declaration.parent)) return null;
    const bindingPattern = declaration.parent;
    if (bindingPattern.elements.length !== 3 || bindingPattern.elements[0] !== declaration ||
      bindingPattern.elements.some(ts.isOmittedExpression)) return null;
    const variable = bindingPattern.parent;
    if (!ts.isVariableDeclaration(variable) || !variable.initializer ||
      !ts.isVariableDeclarationList(variable.parent) ||
      (variable.parent.flags & ts.NodeFlags.Const) === 0) return null;
    const initializer = unwrapExpression(variable.initializer);
    if (!ts.isCallExpression(initializer) ||
      !ts.isPropertyAccessExpression(initializer.expression) ||
      initializer.expression.name.text !== 'all' ||
      !this.isExactDefaultLibraryValue(initializer.expression.expression, 'Promise') ||
      initializer.arguments.length !== 1) return null;
    const observations = unwrapExpression(initializer.arguments[0]!);
    return ts.isArrayLiteralExpression(observations) && observations.elements.length === 3 &&
      this.isExactRunCommandBytesCall(
        observations.elements[0]!,
        (argv) => this.isExactChangedDiffBuilderCall(argv)
      ) && this.isExactRunCommandBytesCall(
        observations.elements[1]!,
        (argv) => this.isExactUntrackedBuilderCall(argv)
      ) && this.isExactRunCommandBytesCall(
        observations.elements[2]!,
        (argv) => this.isExactWorktreeStatusBuilderCall(argv)
      )
      ? declaration
      : null;
  }

  private exactChangedRecordsDeclaration(
    expression: ts.Expression
  ): ts.VariableDeclaration | null {
    const declaration = this.exactConstVariableDeclaration(expression);
    if (!declaration?.initializer) return null;
    const initializer = unwrapExpression(declaration.initializer);
    if (!ts.isCallExpression(initializer) || initializer.arguments.length !== 1 ||
      !this.isExactNamedImport(
        initializer.expression,
        '../shared/ci-git-changed-files.ts',
        'parseGitChangedRecordsOutput'
      )) return null;
    const stdout = unwrapExpression(initializer.arguments[0]!);
    return ts.isPropertyAccessExpression(stdout) && stdout.name.text === 'stdout' &&
      this.exactTrackedResultBinding(stdout.expression)
      ? declaration
      : null;
  }

  private isExactRemovedRecordFilter(expression: ts.Expression): boolean {
    const value = unwrapExpression(expression);
    if (!ts.isArrowFunction(value) || value.parameters.length !== 1 ||
      !ts.isIdentifier(value.parameters[0]!.name)) return false;
    const body = unwrapExpression(value.body as ts.Expression);
    if (!ts.isBinaryExpression(body) ||
      body.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken ||
      !ts.isStringLiteralLike(body.right) || body.right.text !== 'removed') return false;
    const status = unwrapExpression(body.left);
    return ts.isPropertyAccessExpression(status) && status.name.text === 'status' &&
      this.referencesDeclaration(status.expression, value.parameters[0]!);
  }

  private isExactRemovedRecordPathMap(expression: ts.Expression): boolean {
    const value = unwrapExpression(expression);
    if (!ts.isArrowFunction(value) || value.parameters.length !== 1 ||
      !ts.isIdentifier(value.parameters[0]!.name)) return false;
    const body = unwrapExpression(value.body as ts.Expression);
    return ts.isPropertyAccessExpression(body) && body.name.text === 'path' &&
      this.referencesDeclaration(body.expression, value.parameters[0]!);
  }

  private exactRemovedPathsDeclaration(
    expression: ts.Expression
  ): ts.VariableDeclaration | null {
    const declaration = this.exactConstVariableDeclaration(expression);
    if (!declaration?.initializer) return null;
    const unique = unwrapExpression(declaration.initializer);
    if (!ts.isCallExpression(unique) || unique.arguments.length !== 1 ||
      !this.isExactNamedImport(unique.expression, '../shared/collections.ts', 'uniqueSorted')) {
      return null;
    }
    const mapped = unwrapExpression(unique.arguments[0]!);
    if (!ts.isCallExpression(mapped) || mapped.arguments.length !== 1 ||
      !ts.isPropertyAccessExpression(mapped.expression) || mapped.expression.name.text !== 'map' ||
      !this.isExactRemovedRecordPathMap(mapped.arguments[0]!)) return null;
    const filtered = unwrapExpression(mapped.expression.expression);
    if (!ts.isCallExpression(filtered) || filtered.arguments.length !== 1 ||
      !ts.isPropertyAccessExpression(filtered.expression) ||
      filtered.expression.name.text !== 'filter' ||
      !this.isExactRemovedRecordFilter(filtered.arguments[0]!)) return null;
    return this.exactChangedRecordsDeclaration(filtered.expression.expression)
      ? declaration
      : null;
  }

  private exactForOfVariable(
    expression: ts.Expression
  ): { readonly declaration: ts.VariableDeclaration; readonly loop: ts.ForOfStatement } | null {
    const declaration = this.exactLocalDeclaration(expression);
    if (!declaration || !ts.isVariableDeclaration(declaration) ||
      !ts.isIdentifier(declaration.name) || declaration.initializer ||
      !ts.isVariableDeclarationList(declaration.parent) ||
      (declaration.parent.flags & ts.NodeFlags.Const) === 0 ||
      declaration.parent.declarations.length !== 1 ||
      !ts.isForOfStatement(declaration.parent.parent)) return null;
    return Object.freeze({ declaration, loop: declaration.parent.parent });
  }

  private isNodeWithin(node: ts.Node, ancestor: ts.Node): boolean {
    let current: ts.Node | undefined = node;
    while (current) {
      if (current === ancestor) return true;
      current = current.parent;
    }
    return false;
  }

  private isExactPathBlobBuilderCall(
    expression: ts.Expression,
    callNode: ts.CallExpression
  ): boolean {
    const value = unwrapExpression(expression);
    if (!ts.isCallExpression(value) || value.arguments.length !== 2 ||
      !this.isExactNamedImport(
        value.expression,
        '../shared/ci-git-changed-files.ts',
        'gitPathBlobArgs'
      )) return false;
    const revision = this.exactForOfVariable(value.arguments[0]!);
    const repositoryPath = this.exactForOfVariable(value.arguments[1]!);
    if (!revision || !repositoryPath ||
      !this.isNodeWithin(callNode, revision.loop.statement) ||
      !this.isNodeWithin(revision.loop, repositoryPath.loop.statement)) return false;
    const revisions = unwrapExpression(revision.loop.expression);
    if (!ts.isArrayLiteralExpression(revisions) || revisions.elements.length !== 2 ||
      !this.exactRevisionShaDeclaration(revisions.elements[0]!, 'base') ||
      !this.exactRevisionShaDeclaration(revisions.elements[1]!, 'head')) return false;
    return this.exactRemovedPathsDeclaration(repositoryPath.loop.expression) !== null;
  }

  private gitChangedFileReadOperationFor(
    node: ts.CallExpression | ts.NewExpression
  ): GitChangedFileReadOperation | null {
    if (!ts.isCallExpression(node) || node.arguments.length !== 3 ||
      !this.hasExactGitObservationOptions(node.arguments[2]!)) return null;
    const argv = unwrapExpression(node.arguments[1]!);
    if (ts.isArrayLiteralExpression(argv) && argv.elements.length === 3 &&
      argv.elements.every((element) => !ts.isSpreadElement(element)) &&
      ts.isStringLiteralLike(argv.elements[0]!) && argv.elements[0].text === 'rev-parse' &&
      ts.isStringLiteralLike(argv.elements[1]!) && argv.elements[1].text === '--verify') {
      const revision = argv.elements[2]!;
      if (ts.isStringLiteralLike(revision) && revision.text === 'HEAD^{commit}') {
        return 'rev-parse-head';
      }
      if (ts.isTemplateExpression(revision) && revision.head.text === '' &&
        revision.templateSpans.length === 1 &&
        this.exactAffectedTestsBaseRefDeclaration(
          revision.templateSpans[0]!.expression
        ) && revision.templateSpans[0]!.literal.text === '^{commit}') {
        return 'rev-parse-base';
      }
      return null;
    }
    if (this.isExactChangedDiffBuilderCall(argv)) return 'changed-diff';
    if (this.isExactUntrackedBuilderCall(argv)) return 'untracked-files';
    if (this.isExactWorktreeStatusBuilderCall(argv)) return 'worktree-status';
    if (ts.isCallExpression(node) && this.isExactPathBlobBuilderCall(argv, node)) {
      return 'path-blob';
    }
    return null;
  }

  private specifierHasObservedWrite(expression: ts.Expression): boolean {
    const value = unwrapExpression(expression);
    if (!ts.isIdentifier(value)) return false;
    const symbol = this.index.lexicalSymbol(value);
    return symbol !== null && this.evaluator.hasObservedWrite(symbol);
  }

  private boundedClosureNestedOwner(
    owner: ExecutionOwnerModel,
    module: ProgramModule
  ): boolean {
    let current: ExecutionOwnerModel | null = owner;
    const seen = new Set<string>();
    while (current && 'parentCallableId' in current &&
      current.parentCallableId !== null) {
      const callable = current as CallableModel;
      if (seen.has(callable.id)) return false;
      seen.add(callable.id);
      const parentId = callable.parentCallableId;
      current = parentId ? this.callableById.get(parentId) ?? null : null;
    }
    if (!current || !('parentCallableId' in current)) return false;
    const root = current as CallableModel;
    if (root.parentCallableId !== null) return false;
    const declaration = root.declaration;
    return root.module === module &&
      ts.isFunctionDeclaration(declaration) &&
      declaration.parent === module.sourceFile &&
      declaration.name?.text === 'runBoundedFastTestInvocations';
  }

  private resolveInvocationTarget(
    expression: ts.Expression,
    exactCallable: ExecutableCallableModel | null = null
  ): Pick<NormalizedInvocation, 'target' | 'knownCallables'> {
    if (exactCallable) {
      return Object.freeze({
        target: canonicalCallTarget([exactCallable.id], false),
        knownCallables: Object.freeze([exactCallable])
      });
    }
    const classMethod = this.index.resolveClassMethodInvocation(expression);
    if (classMethod) return Object.freeze({
      target: classMethod.target,
      knownCallables: classMethod.callables
    });
    const value = unwrapExpression(expression);
    if (ts.isPropertyAccessExpression(value) || ts.isElementAccessExpression(value)) {
      const memberCallable = this.index.exactCallableAt(
        ts.isPropertyAccessExpression(value) ? value.name : value
      );
      if (memberCallable) {
        return Object.freeze({
          target: canonicalCallTarget([memberCallable.id], false),
          knownCallables: Object.freeze([memberCallable])
        });
      }
    }
    const callable = this.index.exactCallableAt(expression);
    if (callable) {
      return Object.freeze({
        target: canonicalCallTarget([callable.id], false),
        knownCallables: Object.freeze([callable])
      });
    }
    return Object.freeze({
      target: canonicalCallTarget([], true),
      knownCallables: Object.freeze([])
    });
  }

  private normalizeInvocation(
    node: ts.CallExpression | ts.NewExpression,
    exactConstructor: ConstructorCallableModel | null = null
  ): NormalizedInvocation {
    if (ts.isCallExpression(node)) {
      const reflectTarget = this.exactInvocationMember(
        node.expression,
        'apply',
        'reflect'
      );
      if (reflectTarget && node.arguments[0]) {
        const applied = node.arguments[2]
          ? this.exactAppliedArguments(node.arguments[2])
          : null;
        const targetExpression = node.arguments[0];
        const target = this.resolveInvocationTarget(targetExpression);
        return Object.freeze({
          kind: 'reflect-apply',
          targetExpression,
          argumentExpressions: applied ?? Object.freeze([]),
          hasOpaqueArgumentList: applied === null,
          ...target
        });
      }
      for (const property of ['call', 'apply', 'bind'] as const) {
        const targetExpression = this.exactInvocationMember(
          node.expression,
          property,
          'function'
        );
        if (!targetExpression) continue;
        const applied = property === 'apply'
          ? node.arguments[1]
            ? this.exactAppliedArguments(node.arguments[1])
            : Object.freeze([])
          : Object.freeze([...node.arguments.slice(1)]);
        const target = this.resolveInvocationTarget(targetExpression);
        return Object.freeze({
          kind: property,
          targetExpression,
          argumentExpressions: applied ?? Object.freeze([]),
          hasOpaqueArgumentList: applied === null,
          ...target
        });
      }
    }
    const target = this.resolveInvocationTarget(node.expression, exactConstructor);
    return Object.freeze({
      kind: ts.isNewExpression(node) ||
        node.expression.kind === ts.SyntaxKind.SuperKeyword
        ? 'construct'
        : target.target.kind === 'known' && target.knownCallables.length === 1
          ? 'direct'
          : 'other',
      targetExpression: node.expression,
      argumentExpressions: Object.freeze([...(node.arguments ?? [])]),
      hasOpaqueArgumentList: false,
      ...target
    });
  }

  private constructedClassForInvocation(
    node: ts.CallExpression | ts.NewExpression,
    owner: ExecutionOwnerModel
  ): ClassModel | null {
    if (ts.isNewExpression(node)) return this.index.exactClassAt(node.expression);
    if (node.expression.kind !== ts.SyntaxKind.SuperKeyword) return null;
    const ownerClass = this.index.classForConstructor(owner);
    return ownerClass?.heritageExpression
      ? this.index.exactClassAt(ownerClass.heritageExpression)
      : null;
  }

  private createSyntheticBoundConstruct(input: {
    readonly node: ts.CallExpression;
    readonly module: ProgramModule;
    readonly result: FiniteProofNodeRef;
    readonly constructClass: ClassModel | null;
    readonly boundArguments: readonly ts.Expression[];
  }): SyntheticBoundConstructModel {
    const value = Object.freeze({ ...input.result });
    const valueKey = nodeKey(value);
    if (this.syntheticBoundConstructByValueNodeKey.has(valueKey) ||
      this.syntheticBoundCallableByValueNodeKey.has(valueKey)) {
      throw new Error(`Bound construct ${valueKey} has duplicate synthetic ownership.`);
    }
    const model: SyntheticBoundConstructModel = Object.freeze({
      id: `${input.module.scenarioId}:bound-construct:` +
        `${input.module.relativePath}:${input.node.pos}:${input.node.end}`,
      scenarioId: input.module.scenarioId,
      module: input.module,
      syntheticKind: 'bound-construct',
      value,
      constructClass: input.constructClass,
      boundArguments: this.syntheticBoundArguments(input.boundArguments, input.module),
      parameterDefaults: input.constructClass
        ? this.parameterDefaultsForCallable(input.constructClass.constructorOwner)
        : Object.freeze([])
    });
    this.syntheticBoundConstructByValueNodeKey.set(valueKey, model);
    this.assembler.ensureNode(model.value, model.scenarioId);
    this.assembler.seed(model.value, model.scenarioId, {
      callableShapes: CallableShapeBit.BoundCallable | CallableShapeBit.PotentialCallable
    });
    return model;
  }

  private createSyntheticBoundCallable(input: {
    readonly id: string;
    readonly node: ts.CallExpression;
    readonly module: ProgramModule;
    readonly target: FiniteProofNodeRef;
    readonly result: FiniteProofNodeRef;
    readonly directCallable: ExecutableCallableModel | null;
    readonly knownCallables: readonly ExecutableCallableModel[];
    readonly boundArguments: readonly ts.Expression[];
    readonly targetHasConstructSignatures: boolean;
    readonly targetIsExactExternal: boolean;
  }): SyntheticBoundCallableModel {
    const callableId = `${input.module.scenarioId}:bound-callable:` +
      `${input.module.relativePath}:${input.node.pos}:${input.node.end}` as CallableId;
    const targetCallSiteId = `${input.id}:bound-target`;
    const executesExactExternalTarget = input.targetIsExactExternal || (
      input.directCallable !== null && isSyntheticBoundCallable(input.directCallable) &&
      input.directCallable.executesExactExternalTarget
    );
    const boundCount = input.boundArguments.length;
    const remainingParameterCount = input.directCallable
      ? Math.max(0, input.directCallable.parameters.length - boundCount)
      : 0;
    const targetParameterDefaults: readonly (SyntheticBoundParameterDefault | null)[] =
      !input.directCallable
        ? Object.freeze([])
        : this.parameterDefaultsForCallable(input.directCallable);
    const boundArguments = this.syntheticBoundArguments(
      input.boundArguments,
      input.module
    );
    const constructKnownCallables = input.targetHasConstructSignatures
      ? Object.freeze([...new Map(input.knownCallables.map((knownCallable) =>
          [knownCallable.id, knownCallable] as const)).values()]
          .sort((left, right) => compareCanonicalText(left.id, right.id)))
      : Object.freeze([]);
    const parameters = Object.freeze(Array.from(
      { length: remainingParameterCount },
      (_, index): FiniteProofNodeRef => Object.freeze({
        kind: 'value',
        id: `${input.module.scenarioId}:value:bound-parameter:` +
          `${input.module.relativePath}:${input.node.pos}:${index}`
      })
    ));
    const callable: SyntheticBoundCallableModel = Object.freeze({
      id: callableId,
      scenarioId: input.module.scenarioId,
      module: input.module,
      ownerKind: 'callable',
      syntheticKind: 'bound',
      value: Object.freeze({ ...input.result }),
      returnValue: Object.freeze({
        kind: 'value',
        id: `${input.module.scenarioId}:value:bound-return:` +
          `${input.module.relativePath}:${input.node.pos}`
      }),
      parameters,
      parameterDefaults: Object.freeze(
        targetParameterDefaults.slice(boundCount, boundCount + remainingParameterCount)
      ),
      boundArguments,
      constructKnownCallables,
      hasUnknownConstructTarget: input.targetHasConstructSignatures,
      targetCallSiteId,
      executesExactExternalTarget
    });
    const callableValueKey = nodeKey(callable.value);
    if (this.syntheticBoundCallableByValueNodeKey.has(callableValueKey) ||
      this.syntheticBoundConstructByValueNodeKey.has(callableValueKey)) {
      throw new Error(`Bound callable ${callableValueKey} has duplicate synthetic ownership.`);
    }
    this.syntheticBoundCallables.push(callable);
    this.syntheticBoundCallableByValueNodeKey.set(callableValueKey, callable);
    this.assembler.callables.push({
      id: callable.id,
      scenarioId: callable.scenarioId,
      ownerKind: callable.ownerKind,
      parameterNodeKeys: callable.parameters.map(nodeKey)
    });
    this.assembler.seed(callable.value, callable.scenarioId, {
      callableShapes: CallableShapeBit.Callable | CallableShapeBit.BoundCallable
    });
    this.assembler.ensureNode(callable.returnValue, callable.scenarioId);
    for (const parameter of callable.parameters) {
      this.assembler.ensureNode(parameter, callable.scenarioId);
    }

    this.assembler.callSites.push(Object.freeze({
      id: targetCallSiteId,
      scenarioId: callable.scenarioId,
      callee: Object.freeze({ ...input.target }),
      ownerCallableId: callable.id,
      target: canonicalCallTarget(
        input.directCallable ? [input.directCallable.id] : [],
        input.directCallable === null
      ),
      invocationKind: 'direct',
      moduleId: input.module.relativePath,
      location: `${programLocation(input.module, input.node)}:bound-target`
    }));
    if (executesExactExternalTarget) {
      input.boundArguments.forEach((argument, index) =>
        this.registerExternalCallbackProbe(
          argument,
          input.module,
          targetCallSiteId,
          `bound-external-callback-probe:${targetCallSiteId}:${index}`
        ));
    }
    if (input.directCallable?.scenarioId === callable.scenarioId) {
      this.rawStructuralCallEdges.push({
        caller: callable,
        callee: input.directCallable,
        identity: `bound-target-call:${targetCallSiteId}:${input.directCallable.id}`
      });
      input.boundArguments.forEach((argument, index) => {
        const targetParameter = input.directCallable!.parameters[index];
        if (!targetParameter) return;
        const source = this.index.valueForExpression(argument, input.module);
        this.assembler.addFlow(
          'parameter',
          callable.scenarioId,
          source,
          targetParameter,
          `bound-parameter:${targetCallSiteId}:${index}`
        );
        this.rawInvocationDemandEdges.push({
          scenarioId: callable.scenarioId,
          source,
          target: targetParameter,
          kind: 'bind',
          gateCallSiteId: targetCallSiteId,
          identity: `bound-parameter-demand:${targetCallSiteId}:${index}`
        });
      });
      callable.parameters.forEach((parameter, index) => {
        const targetParameter = input.directCallable!.parameters[boundCount + index];
        if (!targetParameter) return;
        this.assembler.addFlow(
          'parameter',
          callable.scenarioId,
          parameter,
          targetParameter,
          `bound-forwarded-parameter:${targetCallSiteId}:${index}`
        );
        this.rawInvocationDemandEdges.push({
          scenarioId: callable.scenarioId,
          source: parameter,
          target: targetParameter,
          kind: 'bind',
          gateCallSiteId: targetCallSiteId,
          identity: `bound-forwarded-demand:${targetCallSiteId}:${index}`
        });
      });
      input.boundArguments.forEach((boundArgument, index) => {
        const parameterDefault = targetParameterDefaults[index];
        if (!parameterDefault || !this.argumentMayTriggerDefault(boundArgument)) return;
        this.rawInvocationDemandEdges.push({
          scenarioId: callable.scenarioId,
          source: parameterDefault.source,
          target: parameterDefault.target,
          kind: 'default',
          gateCallSiteId: targetCallSiteId,
          identity: `bound-default-demand:${targetCallSiteId}:${index}`
        });
      });
      this.assembler.addFlow(
        'return',
        callable.scenarioId,
        input.directCallable.returnValue,
        callable.returnValue,
        `bound-return:${targetCallSiteId}`
      );
      this.rawInvocationDemandEdges.push({
        scenarioId: callable.scenarioId,
        source: input.directCallable.returnValue,
        target: callable.returnValue,
        kind: 'bind',
        gateCallSiteId: targetCallSiteId,
        identity: `bound-return-demand:${targetCallSiteId}`
      });
    }
    return callable;
  }

  private wireCall(
    node: ts.CallExpression | ts.NewExpression,
    module: ProgramModule,
    owner: ExecutionOwnerModel
  ): void {
    const directConstructedClass = this.constructedClassForInvocation(node, owner);
    const boundConstruct = this.syntheticBoundConstructAt(node.expression, module);
    const constructedClass = ts.isNewExpression(node) && boundConstruct?.constructClass
      ? boundConstruct.constructClass
      : directConstructedClass;
    const normalized = this.normalizeInvocation(
      node,
      constructedClass?.constructorOwner ?? null
    );
    const discoveredSyntheticBoundCallable = normalized.knownCallables.length === 0 &&
      normalized.target.kind === 'unknown'
      ? this.syntheticBoundCallableAt(normalized.targetExpression, module)
      : null;
    const syntheticBoundTarget = !ts.isNewExpression(node)
      ? discoveredSyntheticBoundCallable
      : null;
    const ambiguousBoundConstructTarget = ts.isNewExpression(node)
      ? discoveredSyntheticBoundCallable
      : null;
    const resolvedKnownCallables: readonly ExecutableCallableModel[] = syntheticBoundTarget
      ? Object.freeze([syntheticBoundTarget])
      : ambiguousBoundConstructTarget?.hasUnknownConstructTarget
        ? ambiguousBoundConstructTarget.constructKnownCallables
        : normalized.knownCallables;
    const resolvedTarget = syntheticBoundTarget
      ? canonicalCallTarget([syntheticBoundTarget.id], false)
      : ambiguousBoundConstructTarget
        ? canonicalCallTarget(
            ambiguousBoundConstructTarget.hasUnknownConstructTarget
              ? ambiguousBoundConstructTarget.constructKnownCallables.map(({ id }) => id)
              : [],
            true
          )
        : normalized.target;
    const bindCreation = normalized.kind === 'bind' && ts.isCallExpression(node);
    const bindTargetClass = bindCreation
      ? this.index.exactClassAt(normalized.targetExpression)
      : null;
    const bindTargetType = bindCreation
      ? this.context.checker.getTypeAtLocation(normalized.targetExpression)
      : null;
    const bindTargetHasCallSignatures =
      (bindTargetType?.getCallSignatures().length ?? 0) > 0;
    const bindTargetHasConstructSignatures =
      (bindTargetType?.getConstructSignatures().length ?? 0) > 0;
    const referencedBoundConstruct = this.syntheticBoundConstructAt(
      normalized.targetExpression,
      module
    );
    const exactBoundConstructInvocation = ts.isNewExpression(node) &&
      referencedBoundConstruct !== null &&
      referencedBoundConstruct.constructClass !== null;
    const unresolvedBoundInvocation = !bindCreation && (
      (referencedBoundConstruct !== null && !exactBoundConstructInvocation) ||
      ambiguousBoundConstructTarget !== null
    );
    const target = constructedClass?.value ??
      this.index.valueForExpression(normalized.targetExpression, module);
    const callee = constructedClass?.value ?? this.index.valueForExpression(
      bindCreation ? node.expression : normalized.targetExpression,
      module
    );
    const result = this.index.valueForExpression(node, module);
    this.assembler.ensureNode(target, module.scenarioId);
    this.assembler.ensureNode(callee, module.scenarioId);
    this.assembler.ensureNode(result, module.scenarioId);
    const boundConstructInvocation = ts.isNewExpression(node) && boundConstruct?.constructClass
      ? boundConstruct
      : null;
    const constructBoundArguments = boundConstructInvocation?.boundArguments ??
      ambiguousBoundConstructTarget?.boundArguments ?? Object.freeze([]);
    const invocationArguments: readonly SyntheticBoundArgument[] = Object.freeze([
      ...constructBoundArguments,
      ...this.syntheticBoundArguments(normalized.argumentExpressions, module)
    ]);
    if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      this.assembler.seed(callee, module.scenarioId, {
        handles: HandleBit.RequireLoader | HandleBit.ExecutableLoader
      });
    }
    if (bindCreation) {
      this.assembler.seed(callee, module.scenarioId, {
        callableShapes: CallableShapeBit.NonExecutingBindIntrinsic
      });
    }
    const knownCallables: readonly ExecutableCallableModel[] = bindCreation
      ? Object.freeze([])
      : resolvedKnownCallables;
    const callTarget: FiniteProofCanonicalCallTarget<CallableId> = bindCreation
      ? canonicalCallTarget<CallableId>([], true)
      : resolvedTarget;
    const canonicalKnownIds = callTargetCallableIds(callTarget);
    if (canonicalKnownIds.length !== knownCallables.length ||
      canonicalKnownIds.some((callableId, index) =>
        callableId !== knownCallables[index]?.id)) {
      throw new Error('Canonical invocation target disagrees with its sparse callable models.');
    }
    const exactKnownCallable = callTarget.kind === 'known' && knownCallables.length === 1
      ? knownCallables[0]!
      : null;
    const boundTargetCallable = resolvedTarget.kind === 'known' &&
      resolvedKnownCallables.length === 1
      ? resolvedKnownCallables[0]!
      : null;
    const id = programCallSiteId(module, node);
    const callbackParameterIndexes = this.externalCallbackParameterIndexes(node);
    const normalizedTargetIsExternal = this.isExactExternalInvocationTarget(
      normalized.targetExpression
    );
    if (normalizedTargetIsExternal) {
      this.assembler.seed(target, module.scenarioId, {
        callableShapes: CallableShapeBit.ExactExternalCallable
      });
    }
    const exactExternalTarget = !bindCreation && normalizedTargetIsExternal;
    if (exactExternalTarget || callbackParameterIndexes.length > 0) {
      this.assembler.seed(callee, module.scenarioId, {
        callableShapes: CallableShapeBit.ExactExternalCallable
      });
    }
    if (callbackParameterIndexes.length > 0) {
      this.assembler.seed(callee, module.scenarioId, {
        externalContracts: ExternalContractBit.PromiseExecutor
      });
    }
    if (callTarget.kind === 'known-and-unknown' || unresolvedBoundInvocation) {
      this.assembler.seed(callee, module.scenarioId, {
        unknownExecutions: UnknownExecutionBit.UnresolvedTarget
      });
    }
    const callInput: FiniteProofCallSiteInput = {
      id,
      scenarioId: module.scenarioId,
      callee,
      ownerCallableId: owner.id,
      target: callTarget,
      invocationKind: normalized.kind === 'other' && exactKnownCallable
        ? 'direct'
        : normalized.kind,
      moduleId: module.relativePath,
      location: programLocation(module, node)
    };
    this.rawCalls.push({
      input: callInput,
      node,
      module,
      owner,
      knownCallables
    });
    if (constructedClass &&
      knownCallables.some(({ id: callableId }) =>
        callableId === constructedClass.constructorOwner.id)) {
      this.rawInvocationDemandEdges.push({
        scenarioId: module.scenarioId,
        source: constructedClass.constructorOwner.value,
        target: constructedClass.value,
        kind: 'construct',
        gateCallSiteId: id,
        identity: `construct-demand:${id}:${constructedClass.id}`
      });
    }
    if (bindCreation) {
      if (bindTargetClass ||
        (bindTargetHasConstructSignatures && !bindTargetHasCallSignatures)) {
        this.createSyntheticBoundConstruct({
          node,
          module,
          result,
          constructClass: bindTargetClass,
          boundArguments: normalized.argumentExpressions
        });
      } else {
        this.createSyntheticBoundCallable({
          id,
          node,
          module,
          target,
          result,
          directCallable: boundTargetCallable,
          knownCallables: resolvedKnownCallables,
          boundArguments: normalized.argumentExpressions,
          targetHasConstructSignatures: bindTargetHasConstructSignatures,
          targetIsExactExternal: normalizedTargetIsExternal
        });
      }
    }
    if (exactKnownCallable && isSyntheticBoundCallable(exactKnownCallable) &&
      exactKnownCallable.executesExactExternalTarget) {
      normalized.argumentExpressions.forEach((argument, index) =>
        this.registerExternalCallbackProbe(
          argument,
          module,
          exactKnownCallable.targetCallSiteId,
          `bound-result-external-callback-probe:${id}:${index}`
        ));
      if (normalized.hasOpaqueArgumentList) {
        this.registerOpaqueExternalCallbackProbe(
          node,
          module,
          exactKnownCallable.targetCallSiteId,
          `bound-result-opaque-external-callback-probe:${id}`
        );
      }
    }
    for (const knownCallable of knownCallables) {
      if (knownCallable.scenarioId !== module.scenarioId) {
        throw new Error(`Call site ${id} has a cross-scenario known receiver target.`);
      }
      this.rawStructuralCallEdges.push({
        caller: owner,
        callee: knownCallable,
        identity: `direct-call:${id}:${knownCallable.id}`
      });
      invocationArguments.forEach((argument, index) => {
        const parameter = knownCallable.parameters[index];
        if (!parameter) return;
        this.assembler.addFlow(
          'parameter',
          module.scenarioId,
          argument.source,
          parameter,
          `call-parameter:${id}:${knownCallable.id}:${index}`
        );
        this.rawInvocationDemandEdges.push({
          scenarioId: module.scenarioId,
          source: argument.source,
          target: parameter,
          kind: normalized.kind === 'apply' || normalized.kind === 'reflect-apply'
            ? 'apply'
            : 'parameter',
          gateCallSiteId: id,
          identity: `call-parameter-demand:${id}:${knownCallable.id}:${index}`
        });
      });
      const boundConstructDefaults = boundConstructInvocation?.constructClass
        ?.constructorOwner.id === knownCallable.id
        ? boundConstructInvocation.parameterDefaults
        : null;
      if (boundConstructDefaults) {
        boundConstructDefaults.forEach((parameterDefault, index) => {
          const argument = invocationArguments[index];
          if (!parameterDefault || (argument !== undefined &&
            !argument.mayTriggerDefault)) return;
          this.rawInvocationDemandEdges.push({
            scenarioId: module.scenarioId,
            source: parameterDefault.source,
            target: parameterDefault.target,
            kind: 'default',
            gateCallSiteId: id,
            identity: `bound-construct-default-demand:` +
              `${id}:${knownCallable.id}:${index}`
          });
        });
      } else if (isSyntheticBoundCallable(knownCallable)) {
        knownCallable.parameterDefaults.forEach((parameterDefault, index) => {
          const argument = invocationArguments[index];
          if (!parameterDefault || (argument !== undefined &&
            !argument.mayTriggerDefault)) return;
          this.rawInvocationDemandEdges.push({
            scenarioId: module.scenarioId,
            source: parameterDefault.source,
            target: parameterDefault.target,
            kind: 'default',
            gateCallSiteId: id,
            identity: `bound-invocation-default-demand:` +
              `${id}:${knownCallable.id}:${index}`
          });
        });
      }
      if (normalized.hasOpaqueArgumentList) {
        knownCallable.parameters.forEach((parameter, index) => {
          const unknownArgument: FiniteProofNodeRef = Object.freeze({
            kind: 'value',
            id: `${module.scenarioId}:value:opaque-apply-argument:` +
              `${module.relativePath}:${node.pos}:${knownCallable.id}:${index}`
          });
          this.assembler.seed(unknownArgument, module.scenarioId, {
            unknownExecutions: UnknownExecutionBit.OpaqueApplyArgument
          });
          this.rawInvocationDemandEdges.push({
            scenarioId: module.scenarioId,
            source: unknownArgument,
            target: parameter,
            kind: 'apply',
            gateCallSiteId: id,
            identity: `opaque-apply-argument-demand:${id}:${knownCallable.id}:${index}`
          });
        });
      }
      this.assembler.addFlow(
        'return',
        module.scenarioId,
        knownCallable.returnValue,
        result,
        `call-return:${id}:${knownCallable.id}`
      );
      this.rawInvocationDemandEdges.push({
        scenarioId: module.scenarioId,
        source: knownCallable.returnValue,
        target: result,
        kind: 'return',
        gateCallSiteId: id,
        identity: `call-return-demand:${id}:${knownCallable.id}`
      });
      if (boundConstructDefaults === null && 'declaration' in knownCallable) {
        knownCallable.declaration.parameters.forEach((parameter, index) => {
          const argument = invocationArguments[index];
          if (!parameter.initializer || (argument !== undefined &&
            !argument.mayTriggerDefault)) {
            return;
          }
          this.rawInvocationDemandEdges.push({
            scenarioId: module.scenarioId,
            source: this.index.valueForExpression(parameter.initializer, knownCallable.module),
            target: knownCallable.parameters[index]!,
            kind: 'default',
            gateCallSiteId: id,
            identity: `call-default-demand:${id}:${knownCallable.id}:${index}`
          });
        });
      }
    }
    for (const parameterIndex of callbackParameterIndexes) {
      const argument = node.arguments?.[parameterIndex];
      if (!argument) continue;
      const callback = this.index.valueForExpression(argument, module);
      this.assembler.ensureNode(callback, module.scenarioId);
      const callableShapeHint = this.callableShapeHintForExpression(argument);
      if (callableShapeHint !== 0) {
        this.assembler.seed(callback, module.scenarioId, {
          callableShapes: callableShapeHint
        });
      }
      this.rawInvocationDemandEdges.push({
        scenarioId: module.scenarioId,
        source: callback,
        target: callee,
        kind: 'external-callback',
        gateCallSiteId: id,
        identity: `external-callback:${id}:${parameterIndex}`
      });
    }
    if (exactExternalTarget || callbackParameterIndexes.length > 0) {
      const classifiedArguments = new Set(callbackParameterIndexes.map((index) =>
        node.arguments?.[index]).filter((argument): argument is ts.Expression =>
        argument !== undefined));
      normalized.argumentExpressions.forEach((argument, index) => {
        if (classifiedArguments.has(argument)) return;
        this.registerExternalCallbackProbe(
          argument,
          module,
          id,
          `external-callback-probe:${id}:${index}`
        );
      });
      if (normalized.hasOpaqueArgumentList) {
        this.registerOpaqueExternalCallbackProbe(
          node,
          module,
          id,
          `opaque-external-callback-probe:${id}`
        );
      }
    }

    const calleeHint = node.expression.kind === ts.SyntaxKind.ImportKeyword
      ? HandleBit.RequireLoader | HandleBit.ExecutableLoader
      : this.capabilityHintForExpression(node.expression);
    const directAmbientLoader = node.expression.kind === ts.SyntaxKind.ImportKeyword
      ? null
      : directAmbientRuntimeLoader(node.expression, (identifier, expectedName) =>
          this.exactAmbientIdentifier(identifier, expectedName));
    const requireFactory = this.isExactCreateRequireFactory(normalized.targetExpression);
    if (requireFactory) {
      const handles = HandleBit.RequireLoader | HandleBit.ExecutableLoader;
      this.assembler.seed(result, module.scenarioId, { handles });
      this.staticCapabilityHintsByValue.set(nodeKey(result), handles);
    }
    const loaderMode: 'import' | 'require' | null =
      requireFactory
        ? null
        : node.expression.kind === ts.SyntaxKind.ImportKeyword
        ? 'import'
        : directAmbientLoader ??
          ((calleeHint & HandleBit.RequireLoader) !== 0 ? 'require' : null);
    if (loaderMode) {
      const first = node.arguments?.[0];
      const specifier = first ? this.evaluator.evaluate(first) : null;
      if (specifier === null) {
        const specifierNode = first;
        const mutableSpecifier = specifierNode !== undefined &&
          this.specifierHasObservedWrite(specifierNode);
        if (mutableSpecifier) {
          this.assembler.addFinding({
            id: `unknown-specifier:${module.relativePath}:${node.pos}:${node.end}`,
            scenarioId: module.scenarioId,
            code: 'UNTRUSTED_SPECIFIER',
            message: `${programLocation(module, node)}: executable module specifier is not an immutable lexical string`
          });
        } else {
          const base = specifierNode
            ? this.index.valueForExpression(specifierNode, module)
            : result;
          this.assembler.addUnknown({
            id: `executable-specifier:${module.relativePath}:${node.pos}:${node.end}`,
            scenarioId: module.scenarioId,
            operation: 'executable-specifier',
            moduleId: module.relativePath,
            ownerCallableId: owner.id,
            base,
            code: 'UNTRUSTED_SPECIFIER',
            message: `${programLocation(module, node)}: executable module specifier is not an immutable lexical string`
          });
        }
      } else {
        const acquisition = this.resolveAcquisition(
          module,
          specifier,
          loaderMode,
          first && ts.isStringLiteralLike(first) ? first : null,
          loaderMode === 'import' ? 'dynamic-import' : 'require'
        );
        if (acquisition) {
          this.acquisitionsByValue.set(nodeKey(result), acquisition);
          if (acquisition.target.kind === 'executable') {
            const targetInitializer = this.moduleInitializersByModuleId.get(
              acquisition.target.moduleId
            );
            if (!targetInitializer || targetInitializer.scenarioId !== module.scenarioId) {
              throw new Error(
                `Runtime module activation ${module.relativePath} -> ` +
                  `${acquisition.target.moduleId} has no exact initializer.`
              );
            }
            this.rawInvocationDemandEdges.push({
              scenarioId: module.scenarioId,
              source: targetInitializer.value,
              target: callee,
              kind: 'runtime-module',
              gateCallSiteId: id,
              identity: `runtime-module-demand:${id}:${targetInitializer.id}`
            });
          } else if (acquisition.target.kind === 'external') {
            this.assembler.seed(result, module.scenarioId, {
              handles: externalCapabilityMask(acquisition.target.specifier, '*')
            });
          }
        }
      }
    }

    if ((calleeHint & HandleBit.ReflectGet) !== 0 && (node.arguments?.length ?? 0) >= 2) {
      const base = this.index.valueForExpression(node.arguments![0]!, module);
      const properties = this.evaluator.evaluatePropertyKeys(node.arguments![1]!);
      if (properties === null) {
        this.addUnknownProperty(module, node, 'Reflect.get key', {
          operation: 'property-read',
          owner,
          base,
          target: result
        });
      } else {
        this.readExactProperties(
          module,
          base,
          properties,
          result,
          `reflect-get:${module.relativePath}:${node.pos}:${node.end}`
        );
      }
    }
    if ((calleeHint & HandleBit.ObjectAssign) !== 0 && (node.arguments?.length ?? 0) >= 2) {
      const target = this.index.valueForExpression(node.arguments![0]!, module);
      for (const sourceExpression of node.arguments!.slice(1)) {
        const source = this.index.valueForExpression(sourceExpression, module);
        this.copyKnownProperties(
          module,
          source,
          target,
          `object-assign:${module.relativePath}:${node.pos}:${node.end}:${sourceExpression.pos}`
        );
        this.addUnknownProperty(module, sourceExpression, 'opaque Object.assign property domain', {
          operation: 'property-copy',
          owner,
          base: source,
          source,
          target
        });
      }
    }
    if ((calleeHint & HandleBit.ObjectDefineProperty) !== 0 &&
      (node.arguments?.length ?? 0) >= 3) {
      const target = this.index.valueForExpression(node.arguments![0]!, module);
      const properties = this.evaluator.evaluatePropertyKeys(node.arguments![1]!);
      if (properties === null) {
        this.addUnknownProperty(module, node, 'Object.defineProperty key', {
          operation: 'property-write',
          owner,
          base: target,
          source: this.index.valueForExpression(node.arguments![2]!, module),
          target
        });
      } else {
        const descriptor = unwrapExpression(node.arguments![2]!);
        if (ts.isObjectLiteralExpression(descriptor)) {
          for (const entry of descriptor.properties) {
            if (!ts.isPropertyAssignment(entry)) continue;
            const descriptorName = semanticPropertyName(entry.name);
            if (descriptorName === 'value') {
              for (const property of properties) {
                this.assembler.addPropertyWrite(
                  module.scenarioId,
                  target,
                  property,
                  this.index.valueForExpression(entry.initializer, module),
                  `define-value:${module.relativePath}:${entry.pos}:${JSON.stringify(property)}`
                );
              }
            } else if (descriptorName === 'get' && isFunctionLikeWithBody(entry.initializer)) {
              const getter = this.index.callableForDeclaration(entry.initializer);
              if (getter) {
                for (const property of properties) {
                  this.assembler.addPropertyWrite(
                    module.scenarioId,
                    target,
                    property,
                    getter.returnValue,
                    `define-getter:${module.relativePath}:${entry.pos}:${JSON.stringify(property)}`
                  );
                }
              }
            }
          }
        } else {
          this.addUnknownProperty(module, descriptor, 'opaque property descriptor', {
            operation: 'property-copy',
            owner,
            base: this.index.valueForExpression(descriptor, module),
            source: this.index.valueForExpression(descriptor, module),
            target
          });
        }
      }
    }
  }

  private exactAmbientIdentifier(
    node: ts.Expression,
    name: string,
    seenSymbols = new Set<ts.Symbol>()
  ): boolean {
    const value = unwrapExpression(node);
    if (!ts.isIdentifier(value)) return false;
    const symbol = this.index.symbolAt(value, true);
    if (!symbol) return false;
    if (this.checkerSymbolIdentities(symbol).some((identity) =>
      this.canonicalAmbientValueSymbols(name).has(identity))) return true;
    if (seenSymbols.has(symbol)) return false;
    const declarations = symbol.declarations ?? [];
    if (declarations.length !== 1 || !ts.isVariableDeclaration(declarations[0]) ||
      !declarations[0].initializer || !ts.isVariableDeclarationList(declarations[0].parent) ||
      (declarations[0].parent.flags & ts.NodeFlags.Const) === 0) return false;
    seenSymbols.add(symbol);
    const result = this.exactAmbientIdentifier(
      declarations[0].initializer,
      name,
      seenSymbols
    );
    seenSymbols.delete(symbol);
    return result;
  }

  private wholeCommonJsExports(expression: ts.Expression): boolean {
    const value = unwrapExpression(expression);
    if (this.exactAmbientIdentifier(value, 'exports')) return true;
    return ts.isPropertyAccessExpression(value) && value.name.text === 'exports' &&
      this.exactAmbientIdentifier(value.expression, 'module');
  }

  private commonJsExportNames(expression: ts.Expression): readonly string[] | null {
    const value = unwrapExpression(expression);
    if (!ts.isPropertyAccessExpression(value) && !ts.isElementAccessExpression(value)) return null;
    if (!this.wholeCommonJsExports(value.expression)) return null;
    return ts.isPropertyAccessExpression(value)
      ? Object.freeze([value.name.text])
      : value.argumentExpression
        ? this.evaluator.evaluatePropertyKeys(value.argumentExpression)
        : null;
  }

  private lowerCommonJsAssignment(
    node: ts.BinaryExpression,
    module: ProgramModule,
    owner: ExecutionOwnerModel
  ): void {
    if (node.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return;
    const source = this.index.valueForExpression(node.right, module);
    if (this.wholeCommonJsExports(node.left)) {
      const acquisition = this.acquisitionForExpression(node.right);
      if (acquisition?.target.kind === 'executable') {
        const target = this.context.modulesById.get(acquisition.target.moduleId);
        if (target) this.addStarExport(module, target, `cjs-whole:${node.pos}:${node.end}`);
      } else {
        this.addExportWrite(
          module,
          'module.exports',
          source,
          `cjs-whole:${node.pos}:${node.end}`
        );
      }
    }
    const names = this.commonJsExportNames(node.left);
    if (names !== null) {
      for (const name of names) {
        this.addExportWrite(
          module,
          name,
          source,
          `cjs-named:${node.pos}:${node.end}:${JSON.stringify(name)}`
        );
      }
    } else if ((ts.isPropertyAccessExpression(node.left) ||
      ts.isElementAccessExpression(node.left)) &&
      this.wholeCommonJsExports(node.left.expression)) {
      const base = this.index.valueForExpression(node.left.expression, module);
      this.addUnknownProperty(module, node.left, 'CommonJS export key', {
        operation: 'property-write',
        owner,
        base,
        source,
        target: base
      });
    }
  }

  private lowerCommonJsCall(
    node: ts.CallExpression,
    module: ProgramModule,
    owner: ExecutionOwnerModel
  ): void {
    const hint = this.capabilityHintForExpression(node.expression);
    if ((hint & HandleBit.ObjectAssign) !== 0 && node.arguments.length >= 2 &&
      this.wholeCommonJsExports(node.arguments[0]!)) {
      for (const source of node.arguments.slice(1)) {
        const acquisition = this.acquisitionForExpression(source);
        if (acquisition?.target.kind === 'executable') {
          const target = this.context.modulesById.get(acquisition.target.moduleId);
          if (target) {
            this.addStarExport(
              module,
              target,
              `cjs-assign:${node.pos}:${node.end}:${source.pos}`
            );
          }
        } else {
          const sourceValue = this.index.valueForExpression(source, module);
          for (const property of this.assembler.knownProperties(
            module.scenarioId,
            sourceValue
          )) {
            const sourceSlot = this.assembler.propertySlot(
              module.scenarioId,
              this.index.valueForExpression(source, module),
              property
            );
            this.addExportWrite(
              module,
              property,
              sourceSlot,
              `cjs-assign-property:${node.pos}:${node.end}:${source.pos}:${JSON.stringify(property)}`
            );
          }
          this.addUnknownProperty(module, source, 'opaque CommonJS assign property domain', {
            operation: 'property-copy',
            owner,
            base: sourceValue,
            source: sourceValue,
            target: this.index.valueForExpression(node.arguments[0]!, module)
          });
        }
      }
    }
    if ((hint & HandleBit.ObjectDefineProperty) !== 0 && node.arguments.length >= 3 &&
      this.wholeCommonJsExports(node.arguments[0]!)) {
      const names = this.evaluator.evaluatePropertyKeys(node.arguments[1]!);
      const exportBase = this.index.valueForExpression(node.arguments[0]!, module);
      if (names === null) {
        this.addUnknownProperty(module, node, 'CommonJS defineProperty export key', {
          operation: 'property-write',
          owner,
          base: exportBase,
          source: this.index.valueForExpression(node.arguments[2]!, module),
          target: exportBase
        });
        return;
      }
      const descriptor = unwrapExpression(node.arguments[2]!);
      if (!ts.isObjectLiteralExpression(descriptor)) {
        const descriptorValue = this.index.valueForExpression(descriptor, module);
        this.addUnknownProperty(module, descriptor, 'CommonJS opaque export descriptor', {
          operation: 'property-copy',
          owner,
          base: descriptorValue,
          source: descriptorValue,
          target: exportBase
        });
        return;
      }
      for (const property of descriptor.properties) {
        if (!ts.isPropertyAssignment(property)) continue;
        const descriptorName = semanticPropertyName(property.name);
        if (descriptorName === 'value') {
          for (const name of names) {
            this.addExportWrite(
              module,
              name,
              this.index.valueForExpression(property.initializer, module),
              `cjs-define-value:${property.pos}:${JSON.stringify(name)}`
            );
          }
        } else if (descriptorName === 'get' && isFunctionLikeWithBody(property.initializer)) {
          const getter = this.index.callableForDeclaration(property.initializer);
          if (getter) {
            for (const name of names) {
              this.addExportWrite(
                module,
                name,
                getter.returnValue,
                `cjs-define-getter:${property.pos}:${JSON.stringify(name)}`
              );
            }
          }
        }
      }
    }
  }

  private finalizeModuleSurfaces(): FiniteSccProjection {
    for (const edge of this.externalStarExports) {
      const directNames = this.directExportNamesByModule.get(edge.source.relativePath) ?? new Set();
      for (const exportName of externalNamespaceProtectedExportNames(edge.specifier)) {
        if (exportName === 'default' || directNames.has(exportName)) continue;
        const slot = this.exportSlot(edge.source, exportName);
        this.assembler.seed(slot, edge.source.scenarioId, {
          handles: externalCapabilityMask(edge.specifier, exportName)
        });
      }
    }
    const moduleSccProjection = computeFiniteSccProjection(
      this.context.modules.map(({ relativePath }) => relativePath),
      this.starExports.map(({ source, target }) => ({
        source: source.relativePath,
        target: target.relativePath
      }))
    );
    this.lifecycle.moduleSccProjectionCount += 1;
    const modulesById = new Map(this.context.modules.map((module) => [
      module.relativePath,
      module
    ] as const));
    const componentScenarioIds: string[] = [];
    const componentExportNames = moduleSccProjection.components.map(
      (moduleIds, componentId) => {
        const scenarios = new Set(moduleIds.map((moduleId) => modulesById.get(moduleId)?.scenarioId));
        if (scenarios.size !== 1 || scenarios.has(undefined)) {
          throw new Error(`Module SCC component ${componentId} crosses ScenarioPartition.`);
        }
        componentScenarioIds[componentId] = [...scenarios][0]!;
        const exportNames = new Set<string>();
        for (const moduleId of moduleIds) {
          for (const exportName of this.exportSlotsByModule.get(moduleId)?.keys() ?? []) {
            if (exportName !== 'default') exportNames.add(exportName);
          }
        }
        return exportNames;
      }
    );
    const targetsBySource = new Map<number, Set<number>>();
    const sourcesByTarget = new Map<number, Set<number>>();
    const condensationEdgeKeys = new Set<string>();
    for (const edge of this.starExports) {
      const sourceComponentId = moduleSccProjection.componentByNode[edge.source.relativePath];
      const targetComponentId = moduleSccProjection.componentByNode[edge.target.relativePath];
      if (sourceComponentId === undefined || targetComponentId === undefined) {
        throw new Error(`Star export ${edge.identity} has no exact module SCC owner.`);
      }
      if (sourceComponentId === targetComponentId) continue;
      const key = `${sourceComponentId}\0${targetComponentId}`;
      if (condensationEdgeKeys.has(key)) continue;
      condensationEdgeKeys.add(key);
      let targets = targetsBySource.get(sourceComponentId);
      if (!targets) {
        targets = new Set();
        targetsBySource.set(sourceComponentId, targets);
      }
      targets.add(targetComponentId);
      let sources = sourcesByTarget.get(targetComponentId);
      if (!sources) {
        sources = new Set();
        sourcesByTarget.set(targetComponentId, sources);
      }
      sources.add(sourceComponentId);
    }
    const remainingTargets = moduleSccProjection.components.map((_, componentId) =>
      targetsBySource.get(componentId)?.size ?? 0);
    const ready: number[] = [];
    remainingTargets.forEach((count, componentId) => {
      if (count === 0) ready.push(componentId);
    });
    ready.sort((left, right) => left - right);
    let readyIndex = 0;
    let processedComponentCount = 0;
    while (readyIndex < ready.length) {
      const targetComponentId = ready[readyIndex++]!;
      processedComponentCount += 1;
      for (const sourceComponentId of sourcesByTarget.get(targetComponentId) ?? []) {
        for (const exportName of componentExportNames[targetComponentId]!) {
          componentExportNames[sourceComponentId]!.add(exportName);
        }
        const remainingTargetCount = remainingTargets[sourceComponentId];
        if (remainingTargetCount === undefined || remainingTargetCount <= 0) {
          throw new Error('Module SCC condensation target count is invalid.');
        }
        const nextRemainingTargetCount = remainingTargetCount - 1;
        remainingTargets[sourceComponentId] = nextRemainingTargetCount;
        if (nextRemainingTargetCount === 0) ready.push(sourceComponentId);
      }
    }
    if (processedComponentCount !== moduleSccProjection.components.length) {
      throw new Error('Module SCC condensation unexpectedly contains a cycle.');
    }
    for (let componentId = 0;
      componentId < moduleSccProjection.components.length;
      componentId += 1) {
      const exportNames = [...componentExportNames[componentId]!].sort(compareCanonicalText);
      for (const moduleId of moduleSccProjection.components[componentId]!) {
        const module = modulesById.get(moduleId)!;
        for (const exportName of exportNames) this.exportSlot(module, exportName);
      }
    }
    for (const edge of this.starExports) {
      const targetSlots = this.exportSlotsByModule.get(edge.target.relativePath) ?? new Map();
      for (const [name, targetSlot] of targetSlots) {
        if (name === 'default') continue;
        if (this.directExportNamesByModule.get(edge.source.relativePath)?.has(name)) continue;
        const sourceSlot = this.exportSlot(edge.source, name);
        this.assembler.addConstraint({
          id: `star-slot:${edge.identity}:${JSON.stringify(name)}`,
          scenarioId: edge.source.scenarioId,
          kind: 'export-read',
          exportName: name,
          source: targetSlot,
          target: sourceSlot
        });
      }
    }
    for (const edge of this.namespaceExports) {
      const namespaceSlot = this.exportSlot(edge.source, edge.exportName);
      const targetSlots = this.exportSlotsByModule.get(edge.target.relativePath) ?? new Map();
      for (const [name, targetSlot] of targetSlots) {
        this.assembler.addConstraint({
          id: `${edge.identity}:${JSON.stringify(name)}`,
          scenarioId: edge.source.scenarioId,
          kind: 'export-read',
          exportName: edge.exportName,
          source: targetSlot,
          target: namespaceSlot
        });
      }
    }
    this.lowerPackageSurfaces();
    this.moduleSccTopology = deepFreezeOwned({
      components: moduleSccProjection.components.map((moduleIds, id) => ({
        id,
        scenarioId: componentScenarioIds[id]!,
        moduleIds
      })),
      condensationEdges: [...condensationEdgeKeys].map((key) => {
        const [sourceComponentIdText, targetComponentIdText] = key.split('\0');
        const sourceComponentId = Number(sourceComponentIdText);
        const targetComponentId = Number(targetComponentIdText);
        return {
          scenarioId: componentScenarioIds[sourceComponentId]!,
          sourceComponentId,
          targetComponentId
        };
      }).sort((left, right) => compareCanonicalText(
        `${left.scenarioId}\0${left.sourceComponentId}\0${left.targetComponentId}`,
        `${right.scenarioId}\0${right.sourceComponentId}\0${right.targetComponentId}`
      )),
      starExportClosures: componentExportNames.map((exportNames, componentId) => ({
        componentId,
        scenarioId: componentScenarioIds[componentId]!,
        exportNames: [...exportNames].sort(compareCanonicalText)
      }))
    });
    return moduleSccProjection;
  }

  private lowerPackageSurfaces(): void {
    const collectTargets = (value: unknown, targets: string[], key = ''): void => {
      if (key === 'types' || key === 'typings') return;
      if (typeof value === 'string') {
        targets.push(value);
        return;
      }
      if (value === null || value === false) return;
      if (Array.isArray(value)) {
        for (const entry of value) collectTargets(entry, targets, key);
        return;
      }
      if (typeof value === 'object') {
        for (const [entryKey, entry] of Object.entries(value as Record<string, unknown>)) {
          collectTargets(entry, targets, entryKey);
        }
      }
    };
    for (const scenario of this.context.scenarios) {
      for (const surface of scenario.packageSurfaces) {
        if (!surface.value || typeof surface.value !== 'object' || Array.isArray(surface.value)) {
          this.assembler.addFinding({
            id: `package-shape:${scenario.scenarioId}:${surface.relativePath}`,
            scenarioId: scenario.scenarioId,
            code: 'PACKAGE_SURFACE',
            message: `${surface.relativePath}: package surface must be an object`
          });
          continue;
        }
        const record = surface.value as Record<string, unknown>;
        const targets: string[] = [];
        for (const field of ['exports', 'main', 'module', 'runtime', 'browser']) {
          if (Object.prototype.hasOwnProperty.call(record, field)) {
            collectTargets(record[field], targets, field);
          }
        }
        const surfaceModuleId = devRunnerScenarioModuleId(
          scenario.scenarioId,
          surface.relativePath
        );
        const packageDirectory = path.dirname(assertCanonicalVirtualPath(
          this.context.root,
          surfaceModuleId
        ));
        for (const target of [...new Set(targets)].sort(compareCanonicalText)) {
          if (!target.startsWith('.')) continue;
          for (const mode of [ts.ModuleKind.ESNext, ts.ModuleKind.CommonJS] as const) {
            const resolved = ts.resolveModuleName(
              target,
              path.join(
                packageDirectory,
                mode === ts.ModuleKind.ESNext ? '__surface.mts' : '__surface.cts'
              ),
              this.context.options,
              this.context.host,
              this.context.resolutionCache,
              undefined,
              mode
            ).resolvedModule;
            const resolvedCanonicalPath = resolved
              ? this.context.canonicalFileName(resolved.resolvedFileName)
              : null;
            const resource = resolvedCanonicalPath
              ? this.context.resourcesByCanonicalPath.get(resolvedCanonicalPath)
              : null;
            const module = resolvedCanonicalPath
              ? this.context.modulesByCanonicalPath.get(resolvedCanonicalPath)
              : null;
            if (!resolved) {
              this.assembler.addFinding({
                id: `package-unresolved:${scenario.scenarioId}:${surface.relativePath}:${mode}:${target}`,
                scenarioId: scenario.scenarioId,
                code: 'UNRESOLVED_MODULE',
                message: `${surfaceModuleId}: unresolved package runtime target ${target}`,
                subjectId: `${surfaceModuleId}:${target}`
              });
            } else if (resource && resource.scenarioId !== scenario.scenarioId) {
              this.assembler.addFinding({
                id: `package-cross:${scenario.scenarioId}:${surface.relativePath}:${mode}:${target}`,
                scenarioId: scenario.scenarioId,
                code: 'CROSS_SCENARIO_EDGE',
                message: `${surfaceModuleId}: package target crosses into ${resource.relativePath}`
              });
            } else if (module) {
              this.addModuleEdge(
                scenario.scenarioId,
                surfaceModuleId,
                module.relativePath,
                'package-surface'
              );
              this.namespaceUses.push({
                scenarioId: scenario.scenarioId,
                targetModuleId: module.relativePath,
                location: `${surfaceModuleId}:${target}:${mode}`,
                kind: 'package'
              });
            } else if (resource?.kind === 'declaration') {
              this.assembler.addFinding({
                id: `package-declaration:${scenario.scenarioId}:${surface.relativePath}:${mode}:${target}`,
                scenarioId: scenario.scenarioId,
                code: 'UNBOUNDED_MODULE',
                message: `${surfaceModuleId}: package runtime target resolves only to a declaration ${target}`
              });
            } else if (resource?.kind !== 'data-package') {
              this.assembler.addFinding({
                id: `package-unbounded:${scenario.scenarioId}:${surface.relativePath}:${mode}:${target}`,
                scenarioId: scenario.scenarioId,
                code: 'UNBOUNDED_MODULE',
                message: `${surfaceModuleId}: package runtime target is outside bounded input ${target}`
              });
            }
          }
        }
      }
    }
  }

  private bindScenarioOwners(): CompactScenarioBinding[] {
    const bindings: CompactScenarioBinding[] = [];
    for (const scenario of this.context.scenarios) {
      const commandModule = this.context.modulesById.get(scenario.commandOwnerModuleId) ?? null;
      const boundedModule = this.context.modulesById.get(scenario.boundedOwnerModuleId) ?? null;
      const processModule = this.context.modulesById.get(scenario.processOwnerModuleId) ?? null;
      const command = commandModule
        ? this.topLevelCallable(commandModule, 'runDevCommand')
        : null;
      const bounded = boundedModule
        ? this.topLevelCallable(boundedModule, 'runBoundedFastTestInvocations')
        : null;
      const runFastTests = boundedModule
        ? this.topLevelCallable(boundedModule, 'runFastTests')
        : null;
      const affectedTestsBaseRef = boundedModule
        ? this.topLevelCallable(boundedModule, 'affectedTestsBaseRef')
        : null;
      const gitChangedFiles = boundedModule
        ? this.topLevelCallable(boundedModule, 'gitChangedFiles')
        : null;
      const resolveAffectedTestExecution = boundedModule
        ? this.topLevelCallable(boundedModule, 'resolveAffectedTestExecution')
        : null;
      const runCommandBytes = processModule
        ? this.topLevelCallable(processModule, 'runCommandBytes')
        : null;
      if (command) {
        this.terminalCallableIds.add(command.id);
        this.assembler.markCallableTerminal(
          command.id,
          EffectBit.InvokesReviewedDevCommand
        );
      }

      const ownerByRole: Record<'bounded' | 'command' | 'process', ProgramModule | null> = {
        bounded: boundedModule,
        command: commandModule,
        process: processModule
      };
      for (const entry of CAPABILITY_REGISTRY) {
        if (entry.kind !== 'owner-binding' || entry.moduleRole === 'policy') continue;
        const module = ownerByRole[entry.moduleRole];
        if (!module) continue;
        const callable = this.topLevelCallable(module, entry.exportName);
        if (callable) {
          this.assembler.seed(callable.value, scenario.scenarioId, {
            handles: entry.handles,
            roles: entry.roles
          });
          eachSetBit(entry.roles ?? 0, PROTECTED_ROLE_BITS, (role) => {
            if (role !== ProtectedRoleBit.SharedProcessAlternative) {
              this.assembler.addCanonicalRoleTarget(
                scenario.scenarioId,
                role as ProtectedRoleBitValue,
                callable.id
              );
            }
          });
        }
      }
      for (const policyModuleId of scenario.policyOwnerModuleIds) {
        const policyModule = this.context.modulesById.get(policyModuleId);
        if (!policyModule) continue;
        for (const slot of this.exportSlotsByModule.get(policyModuleId)?.values() ?? []) {
          this.assembler.seed(slot, scenario.scenarioId, {
            handles: HandleBit.PolicyAuthority
          });
        }
      }
      if (!commandModule || !command) {
        this.assembler.addFinding({
          id: `owner-command:${scenario.scenarioId}`,
          scenarioId: scenario.scenarioId,
          code: 'COMMAND_OWNER_CONTRACT',
          message: `${scenario.commandOwnerModuleId}: missing exact local runDevCommand callable`
        });
      }
      if (!boundedModule || !bounded) {
        this.assembler.addFinding({
          id: `owner-bounded:${scenario.scenarioId}`,
          scenarioId: scenario.scenarioId,
          code: 'BOUNDED_OWNER_CONTRACT',
          message: `${scenario.boundedOwnerModuleId}: missing exact local runBoundedFastTestInvocations callable`
        });
      } else if (!nodeHasModifier(bounded.declaration, ts.SyntaxKind.AsyncKeyword)) {
        this.assembler.addFinding({
          id: `owner-bounded-async:${scenario.scenarioId}`,
          scenarioId: scenario.scenarioId,
          code: 'BOUNDED_OWNER_CONTRACT',
          message: `${scenario.boundedOwnerModuleId}: runBoundedFastTestInvocations must be async`
        });
      }
      if (!runFastTests) {
        this.assembler.addFinding({
          id: `owner-fast:${scenario.scenarioId}`,
          scenarioId: scenario.scenarioId,
          code: 'BOUNDED_OWNER_CONTRACT',
          message: `${scenario.boundedOwnerModuleId}: missing exact local runFastTests callable`
        });
      }
      if (!processModule || !runCommandBytes) {
        this.assembler.addFinding({
          id: `owner-process:${scenario.scenarioId}`,
          scenarioId: scenario.scenarioId,
          code: 'PROCESS_OWNER_CONTRACT',
          message: `${scenario.processOwnerModuleId}: missing exact local runCommandBytes callable`
        });
      }
      bindings.push(Object.freeze({
        scenarioId: scenario.scenarioId,
        moduleScope: scenario.moduleScope,
        commandOwnerModuleId: scenario.commandOwnerModuleId,
        boundedOwnerModuleId: scenario.boundedOwnerModuleId,
        processOwnerModuleId: scenario.processOwnerModuleId,
        policyOwnerModuleIds: Object.freeze([...scenario.policyOwnerModuleIds]),
        commandCallableId: command?.id ?? null,
        boundedCallableId: bounded?.id ?? null,
        runFastTestsCallableId: runFastTests?.id ?? null,
        affectedTestsBaseRefCallableId: affectedTestsBaseRef?.id ?? null,
        affectedTestsBaseRefExact: affectedTestsBaseRef !== null &&
          this.isExactAffectedTestsBaseRefDeclaration(affectedTestsBaseRef.declaration),
        gitChangedFilesCallableId: gitChangedFiles?.id ?? null,
        gitChangedFilesPrivateOwner: gitChangedFiles !== null &&
          this.isPrivateGitChangedFilesOwner(gitChangedFiles),
        resolveAffectedTestExecutionCallableId: resolveAffectedTestExecution?.id ?? null,
        runCommandBytesCallableId: runCommandBytes?.id ?? null,
        commandModuleId: commandModule?.relativePath ?? null,
        boundedModuleId: boundedModule?.relativePath ?? null,
        processModuleId: processModule?.relativePath ?? null,
        commandModuleInitializerId: commandModule
          ? this.moduleInitializersByModuleId.get(commandModule.relativePath)?.id ?? null
          : null,
        boundedModuleInitializerId: boundedModule
          ? this.moduleInitializersByModuleId.get(boundedModule.relativePath)?.id ?? null
          : null,
        processModuleInitializerId: processModule
          ? this.moduleInitializersByModuleId.get(processModule.relativePath)?.id ?? null
          : null
      }));
    }
    return bindings.sort((left, right) => compareCanonicalText(
      left.scenarioId,
      right.scenarioId
    ));
  }

  private topLevelCallable(module: ProgramModule, name: string): CallableModel | null {
    const matches = this.index.allCallables().filter((callable) => {
      if (callable.module !== module || callable.parentCallableId !== null) return false;
      const declaration = callable.declaration;
      if (ts.isFunctionDeclaration(declaration)) {
        return declaration.parent === module.sourceFile && declaration.name?.text === name;
      }
      const parent = declaration.parent;
      if (!ts.isVariableDeclaration(parent) || parent.initializer !== declaration ||
        !ts.isIdentifier(parent.name) || parent.name.text !== name ||
        !ts.isVariableDeclarationList(parent.parent)) return false;
      const statement = parent.parent.parent;
      return ts.isVariableStatement(statement) && statement.parent === module.sourceFile;
    });
    return matches.length === 1 ? matches[0]! : null;
  }

  private finalizeCallTopology(
    bindings: readonly CompactScenarioBinding[]
  ): {
    readonly callSccProjection: FiniteSccProjection;
    readonly executionProjection: FiniteProofExecutionProjectionInput;
  } {
    const edgeIdentities = new Set<string>();
    for (const edge of [...this.rawStructuralCallEdges].sort((left, right) =>
      compareCanonicalText(left.identity, right.identity))) {
      if (edge.caller.scenarioId !== edge.callee.scenarioId) {
        this.assembler.addFinding({
          id: `cross-call-topology:${edge.identity}`,
          scenarioId: edge.caller.scenarioId,
          code: 'CROSS_SCENARIO_CALL',
          message: `${edge.identity}: callable topology crosses ` +
            `${edge.caller.scenarioId} -> ${edge.callee.scenarioId}`
        });
        continue;
      }
      if (edgeIdentities.has(edge.identity)) {
        throw new Error(`Duplicate structural direct-call identity ${edge.identity}.`);
      }
      edgeIdentities.add(edge.identity);
      this.assembler.directCalls.push(Object.freeze({
        id: edge.identity,
        scenarioId: edge.caller.scenarioId,
        callerCallableId: edge.caller.id,
        calleeCallableId: edge.callee.id
      }));
    }
    const moduleActivationKeys = new Set<string>();
    for (const edge of [...this.staticModuleActivationEdges]
      .sort((left, right) => compareCanonicalText(
        `${left.scenarioId}\0${left.sourceModuleId}\0${left.targetModuleId}`,
        `${right.scenarioId}\0${right.sourceModuleId}\0${right.targetModuleId}`
      ))) {
      const key = `${edge.scenarioId}\0${edge.sourceModuleId}\0${edge.targetModuleId}`;
      if (moduleActivationKeys.has(key)) {
        continue;
      }
      moduleActivationKeys.add(key);
      const sourceInitializer = this.moduleInitializersByModuleId.get(edge.sourceModuleId);
      const targetInitializer = this.moduleInitializersByModuleId.get(edge.targetModuleId);
      if (!sourceInitializer || !targetInitializer ||
        sourceInitializer.scenarioId !== edge.scenarioId ||
        targetInitializer.scenarioId !== edge.scenarioId) {
        throw new Error(`Static module activation ${key} has no exact initializer owners.`);
      }
      const callSiteId = `${edge.scenarioId}:module-activation:` +
        `${edge.sourceModuleId}->${edge.targetModuleId}`;
      const directCallId = `module-activation-edge:${callSiteId}`;
      if (edgeIdentities.has(directCallId)) {
        throw new Error(`Duplicate structural direct-call identity ${directCallId}.`);
      }
      edgeIdentities.add(directCallId);
      this.assembler.directCalls.push(Object.freeze({
        id: directCallId,
        scenarioId: edge.scenarioId,
        callerCallableId: sourceInitializer.id,
        calleeCallableId: targetInitializer.id
      }));
      this.assembler.callSites.push(Object.freeze({
        id: callSiteId,
        scenarioId: edge.scenarioId,
        callee: Object.freeze({ ...targetInitializer.value }),
        ownerCallableId: sourceInitializer.id,
        target: canonicalCallTarget([targetInitializer.id], false),
        invocationKind: 'module-initialization',
        moduleId: edge.sourceModuleId,
        location: `${edge.sourceModuleId}:static-module-activation:${edge.targetModuleId}`
      }));
    }
    for (const call of [...this.rawCalls].sort((left, right) =>
      compareCanonicalText(left.input.id, right.input.id))) {
      this.assembler.callSites.push(Object.freeze({ ...call.input }));
    }
    const observedCalls = Object.freeze([...this.assembler.directCalls]);
    const executionOwners = Object.freeze([
      ...this.index.allCallables(),
      ...this.index.allImplicitConstructors(),
      ...this.moduleInitializersByModuleId.values(),
      ...this.syntheticBoundCallables
    ].sort((left, right) => compareCanonicalText(left.id, right.id)));
    const callSccProjection = computeFiniteSccProjection(
      executionOwners.map(({ id }) => id),
      observedCalls.map(({ callerCallableId, calleeCallableId }) => ({
        source: callerCallableId,
        target: calleeCallableId
      }))
    );
    this.lifecycle.callSccProjectionCount += 1;
    return {
      callSccProjection,
      executionProjection: this.buildExecutionProjection(
        bindings,
        callSccProjection,
        observedCalls,
        executionOwners
      )
    };
  }

  private buildExecutionProjection(
    bindings: readonly CompactScenarioBinding[],
    callSccProjection: FiniteSccProjection,
    observedCalls: readonly FiniteProofDirectCallInput[],
    executionOwners: readonly ExecutionOwnerModel[]
  ): FiniteProofExecutionProjectionInput {
    const callableById = new Map(executionOwners.map((owner) => [owner.id, owner] as const));
    const components: FiniteProofCallSccComponentInput[] = callSccProjection.components
      .map((callableIds, id) => {
        const scenarioIds = new Set(callableIds.map((callableId) =>
          callableById.get(callableId as CallableId)?.scenarioId));
        if (scenarioIds.size !== 1 || scenarioIds.has(undefined)) {
          throw new Error(`Call SCC component ${id} crosses ScenarioPartition.`);
        }
        return Object.freeze({
          id,
          scenarioId: [...scenarioIds][0]!,
          callableIds: Object.freeze([...callableIds])
        });
      });
    const condensationEdgeKeys = new Set<string>();
    const condensationEdges: FiniteProofCallSccEdgeInput[] = [];
    for (const edge of observedCalls) {
      const sourceComponentId = callSccProjection.componentByNode[edge.callerCallableId];
      const targetComponentId = callSccProjection.componentByNode[edge.calleeCallableId];
      if (sourceComponentId === undefined || targetComponentId === undefined ||
        sourceComponentId === targetComponentId) continue;
      const key = `${edge.scenarioId}\0${sourceComponentId}\0${targetComponentId}`;
      if (condensationEdgeKeys.has(key)) continue;
      condensationEdgeKeys.add(key);
      condensationEdges.push(Object.freeze({
        scenarioId: edge.scenarioId,
        sourceComponentId,
        targetComponentId
      }));
    }
    condensationEdges.sort((left, right) => compareCanonicalText(
      `${left.scenarioId}\0${left.sourceComponentId}\0${left.targetComponentId}`,
      `${right.scenarioId}\0${right.sourceComponentId}\0${right.targetComponentId}`
    ));

    const roots: FiniteProofExecutionRootInput[] = [];
    const rootKeys = new Set<string>();
    const addRoot = (
      binding: CompactScenarioBinding,
      callableId: CallableId | null,
      rootBit: ExecutionRootBitValue
    ): void => {
      if (!callableId) return;
      const key = `${binding.scenarioId}\0${callableId}\0${rootBit}`;
      if (rootKeys.has(key)) return;
      rootKeys.add(key);
      roots.push(Object.freeze({
        scenarioId: binding.scenarioId,
        callableId,
        rootBit
      }));
    };
    for (const binding of bindings) {
      addRoot(binding, binding.commandCallableId, ExecutionRootBit.CommandOwner);
      addRoot(binding, binding.boundedCallableId, ExecutionRootBit.BoundedOwner);
      addRoot(binding, binding.runFastTestsCallableId, ExecutionRootBit.FastTestsEntry);
      addRoot(binding, binding.runCommandBytesCallableId, ExecutionRootBit.ProcessOwner);
      addRoot(
        binding,
        binding.commandModuleInitializerId,
        ExecutionRootBit.ModuleInitialization
      );
      addRoot(
        binding,
        binding.boundedModuleInitializerId,
        ExecutionRootBit.ModuleInitialization
      );
      addRoot(
        binding,
        binding.processModuleInitializerId,
        ExecutionRootBit.ModuleInitialization
      );
    }
    roots.sort((left, right) => compareCanonicalText(
      `${left.scenarioId}\0${left.callableId}\0${left.rootBit}`,
      `${right.scenarioId}\0${right.callableId}\0${right.rootBit}`
    ));

    const demandEdgeKeys = new Set<string>();
    const demandEdges: FiniteProofInvocationDemandEdgeInput[] = [];
    const scenarioByDemandNodeKey = new Map<string, string>();
    const registerDemandNode = (key: string, scenarioId: string): void => {
      const prior = scenarioByDemandNodeKey.get(key);
      if (prior !== undefined && prior !== scenarioId) {
        throw new Error(`Invocation-demand node ${key} crosses ScenarioPartition.`);
      }
      scenarioByDemandNodeKey.set(key, scenarioId);
    };
    const addDemandEdge = (
      scenarioId: string,
      source: FiniteProofNodeRef,
      target: FiniteProofNodeRef,
      kind: FiniteProofInvocationDemandEdgeInput['kind'],
      identity: string,
      gateCallSiteId?: string
    ): void => {
      const sourceNodeKey = nodeKey(source);
      const targetNodeKey = nodeKey(target);
      registerDemandNode(sourceNodeKey, scenarioId);
      registerDemandNode(targetNodeKey, scenarioId);
      const key = `${scenarioId}\0${kind}\0${sourceNodeKey}\0${targetNodeKey}\0` +
        `${gateCallSiteId ?? ''}`;
      if (demandEdgeKeys.has(key)) return;
      demandEdgeKeys.add(key);
      demandEdges.push(Object.freeze({
        id: identity,
        scenarioId,
        sourceNodeKey,
        targetNodeKey,
        kind,
        gateCallSiteId
      }));
    };
    const gatedValueFlowPairs = new Set(this.rawInvocationDemandEdges.map((edge) =>
      `${edge.scenarioId}\0${nodeKey(edge.source)}\0${nodeKey(edge.target)}`));
    for (const constraint of this.assembler.constraints) {
      if (constraint.kind === 'capability-derivation' || constraint.kind === 'parameter' ||
        constraint.kind === 'default') continue;
      if (constraint.kind === 'return' && gatedValueFlowPairs.has(
        `${constraint.scenarioId}\0${nodeKey(constraint.source)}\0${nodeKey(constraint.target)}`
      )) continue;
      addDemandEdge(
        constraint.scenarioId,
        constraint.source,
        constraint.target,
        'fixed-flow',
        `fixed-flow-demand:${constraint.id}`
      );
    }
    for (const edge of this.rawInvocationDemandEdges) {
      addDemandEdge(
        edge.scenarioId,
        edge.source,
        edge.target,
        edge.kind,
        edge.identity,
        edge.gateCallSiteId
      );
    }
    for (const call of this.rawCalls) {
      registerDemandNode(nodeKey(call.input.callee), call.module.scenarioId);
    }
    for (const owner of executionOwners) {
      registerDemandNode(nodeKey(owner.value), owner.scenarioId);
    }
    demandEdges.sort((left, right) => compareCanonicalText(
      `${left.scenarioId}\0${left.kind}\0${left.targetNodeKey}\0${left.sourceNodeKey}\0` +
        `${left.gateCallSiteId ?? ''}\0${left.id ?? ''}`,
      `${right.scenarioId}\0${right.kind}\0${right.targetNodeKey}\0${right.sourceNodeKey}\0` +
        `${right.gateCallSiteId ?? ''}\0${right.id ?? ''}`
    ));
    const callableShapeMask = CALLABLE_SHAPE_BITS.reduce((mask, bit) => mask | bit, 0);
    const externalCallbackProbes = [...this.rawExternalCallbackProbes]
      .sort((left, right) => compareCanonicalText(left.id, right.id))
      .map((probe): FiniteProofExternalCallbackProbeInput => Object.freeze({
        id: probe.id,
        scenarioId: probe.scenarioId,
        argumentNodeKey: nodeKey(probe.argument),
        callableShapeMask,
        gateCallSiteId: probe.gateCallSiteId,
        unknownExecutionBit: UnknownExecutionBit.UnclassifiedExternalCallback
      }));

    const terminalIngresses = [...this.terminalCallableIds]
      .map((callableId): FiniteProofTerminalIngressInput => {
        const callable = callableById.get(callableId as CallableId)!;
        return Object.freeze({
          scenarioId: callable.scenarioId,
          callableId,
          canonicalSelfRootBit: ExecutionRootBit.CommandOwner,
          admittedDemandRootBits: Object.freeze([])
        });
      })
      .sort((left, right) => compareCanonicalText(left.callableId, right.callableId));
    const callableSeeds = executionOwners.map((owner): FiniteProofCallableSeedInput =>
      Object.freeze({
        scenarioId: owner.scenarioId,
        callableId: owner.id,
        node: Object.freeze({ ...owner.value })
      }));
    return Object.freeze({
      components: Object.freeze(components),
      condensationEdges: Object.freeze(condensationEdges),
      roots: Object.freeze(roots),
      terminalIngresses: Object.freeze(terminalIngresses),
      callableSeeds: Object.freeze(callableSeeds),
      demandEdges: Object.freeze(demandEdges),
      externalCallbackProbes: Object.freeze(externalCallbackProbes)
    });
  }

}

function validateCompactProof(
  projection: FrozenCompactValidationProjection,
  lifecycle: MutableDevRunnerAnalysisLifecycle
): readonly DevRunnerAuthorityScenarioProof[] {
  const { proof, topology, ...plan } = projection;
  const supportedHandleMask = HANDLE_BITS.reduce((mask, bit) => mask | bit, 0);
  const supportedRoleMask = PROTECTED_ROLE_BITS.reduce((mask, bit) => mask | bit, 0);
  const supportedEffectMask = EFFECT_BITS.reduce((mask, bit) => mask | bit, 0);
  const supportedExecutionRootMask = EXECUTION_ROOT_BITS
    .reduce((mask, bit) => mask | bit, 0);
  const supportedCallableShapeMask = CALLABLE_SHAPE_BITS
    .reduce((mask, bit) => mask | bit, 0);
  const supportedExternalContractMask = EXTERNAL_CONTRACT_BITS
    .reduce((mask, bit) => mask | bit, 0);
  const supportedUnknownExecutionMask = UNKNOWN_EXECUTION_BITS
    .reduce((mask, bit) => mask | bit, 0);
  const assertSingleBit = (value: number, supportedMask: number, label: string): void => {
    assertFixedMask(label, value, supportedMask);
    if (value === 0 || (value & (value - 1)) !== 0) {
      throw new Error(`${label} must contain exactly one fixed proof bit.`);
    }
  };
  if (proof.executionTopologyIdentity !== topology.canonicalBytes ||
    topology.topologyFreezeCount !== 1 || proof.counters.topologyFreezeCount !== 1 ||
    proof.counters.graphSolveCount !== 1 ||
    proof.counters.postSolveTopologyMutationCount !== 0 ||
    proof.counters.arbitraryCallableFactCount !== 0 ||
    proof.counters.arbitraryNamespaceFactCount !== 0 ||
    proof.counters.ambientCrossProductSeedCount !== 0) {
    throw new Error('Compact validation projection violates its frozen single-solve identity.');
  }
  const scenarioIds = new Set<string>();
  for (const scenarioId of topology.scenarioIds) {
    if (scenarioId.length === 0 || scenarioIds.has(scenarioId)) {
      throw new Error(`Duplicate or empty frozen ScenarioPartition ${scenarioId}.`);
    }
    scenarioIds.add(scenarioId);
  }
  const requireScenario = (scenarioId: string, label: string): void => {
    if (!scenarioIds.has(scenarioId)) {
      throw new Error(`${label} references unknown ScenarioPartition ${scenarioId}.`);
    }
  };
  const nodeScenarioByKey = new Map<string, string>();
  const topologyExportNodeKeys = new Set<string>();
  for (const node of topology.nodes) {
    requireScenario(node.scenarioId, `Frozen node ${node.kind}\0${node.id}`);
    const key = `${node.kind}\0${node.id}`;
    if (nodeScenarioByKey.has(key)) throw new Error(`Duplicate frozen node ${key}.`);
    nodeScenarioByKey.set(key, node.scenarioId);
    if (node.kind === 'export-slot') topologyExportNodeKeys.add(key);
  }
  const requireNodeKey = (key: string, scenarioId: string, label: string): void => {
    if (nodeScenarioByKey.get(key) !== scenarioId) {
      throw new Error(`${label} references unknown or wrong-partition node ${key}.`);
    }
  };
  const callableScenarioById = new Map<string, string>();
  const topologyCallables = new Map<string, FiniteProofCallableInput>();
  for (const callable of topology.callables) {
    requireScenario(callable.scenarioId, `Frozen CallableId ${callable.id}`);
    if (callableScenarioById.has(callable.id)) {
      throw new Error(`Duplicate frozen CallableId ${callable.id}.`);
    }
    callableScenarioById.set(callable.id, callable.scenarioId);
    topologyCallables.set(callable.id, callable);
  }
  const requireCallable = (callableId: string, scenarioId: string, label: string): void => {
    if (callableScenarioById.get(callableId) !== scenarioId) {
      throw new Error(`${label} references unknown or wrong-partition CallableId ${callableId}.`);
    }
  };
  const moduleScenarioById = new Map<string, string>();
  for (const component of topology.moduleSccTopology.components) {
    requireScenario(component.scenarioId, `Frozen module component ${component.id}`);
    for (const moduleId of component.moduleIds) {
      if (moduleScenarioById.has(moduleId)) {
        throw new Error(`Duplicate frozen module id ${moduleId}.`);
      }
      moduleScenarioById.set(moduleId, component.scenarioId);
    }
  }
  const requireModule = (moduleId: string, scenarioId: string, label: string): void => {
    if (moduleScenarioById.get(moduleId) !== scenarioId) {
      throw new Error(`${label} references unknown or wrong-partition module ${moduleId}.`);
    }
  };
  const topologyCallSites = new Map<string, FiniteProofCallSiteInput>();
  for (const callSite of topology.callSites) {
    requireScenario(callSite.scenarioId, `Frozen call site ${callSite.id}`);
    if (topologyCallSites.has(callSite.id)) {
      throw new Error(`Duplicate frozen CallSiteId ${callSite.id}.`);
    }
    requireNodeKey(nodeKey(callSite.callee), callSite.scenarioId, `Frozen call site ${callSite.id}`);
    if (callSite.ownerCallableId !== undefined) {
      requireCallable(callSite.ownerCallableId, callSite.scenarioId, `Frozen call site ${callSite.id}`);
    }
    if (callSite.moduleId !== undefined) {
      requireModule(callSite.moduleId, callSite.scenarioId, `Frozen call site ${callSite.id}`);
    }
    for (const callableId of callTargetCallableIds(callSite.target)) {
      requireCallable(callableId, callSite.scenarioId, `Frozen call site ${callSite.id}`);
    }
    topologyCallSites.set(callSite.id, callSite);
  }
  const topologyFrontiers = new Map<string, FiniteProofUnknownFrontierInput>();
  for (const frontier of topology.unknownFrontiers) {
    requireScenario(frontier.scenarioId, `Frozen unknown frontier ${frontier.id}`);
    if (topologyFrontiers.has(frontier.id)) {
      throw new Error(`Duplicate frozen unknown frontier ${frontier.id}.`);
    }
    requireNodeKey(nodeKey(frontier.base), frontier.scenarioId, `Frozen frontier ${frontier.id}`);
    if (frontier.source) {
      requireNodeKey(nodeKey(frontier.source), frontier.scenarioId, `Frozen frontier ${frontier.id}`);
    }
    if (frontier.target) {
      requireNodeKey(nodeKey(frontier.target), frontier.scenarioId, `Frozen frontier ${frontier.id}`);
    }
    if (frontier.ownerCallableId !== undefined) {
      requireCallable(frontier.ownerCallableId, frontier.scenarioId, `Frozen frontier ${frontier.id}`);
    }
    if (frontier.moduleId !== undefined) {
      requireModule(frontier.moduleId, frontier.scenarioId, `Frozen frontier ${frontier.id}`);
    }
    topologyFrontiers.set(frontier.id, frontier);
  }
  const compactBindingScenarioIds = new Set<string>();
  for (const binding of plan.scenarioBindings) {
    requireScenario(binding.scenarioId, `Compact scenario binding ${binding.scenarioId}`);
    if (compactBindingScenarioIds.has(binding.scenarioId)) {
      throw new Error(`Duplicate compact scenario binding ${binding.scenarioId}.`);
    }
    compactBindingScenarioIds.add(binding.scenarioId);
  }
  if (compactBindingScenarioIds.size !== scenarioIds.size) {
    throw new Error('Compact scenario bindings do not exactly cover frozen ScenarioPartitions.');
  }
  const findingIds = new Set<string>();
  const findingsByScenario = new Map<string, Map<string, DevRunnerAuthorityFinding>>();
  const addFinding = (
    scenarioId: string,
    code: string,
    message: string,
    id: string,
    ownerCallableId: string | null = null,
    subjectId: string | null = null,
    site: string | null = null
  ): void => {
    if (!scenarioIds.has(scenarioId) || id.length === 0 || code.length === 0) {
      throw new Error(`Compact finding ${id || '<empty>'} has invalid authority identity.`);
    }
    if (ownerCallableId !== null) {
      requireCallable(ownerCallableId, scenarioId, `Compact finding ${id}`);
    }
    let findings = findingsByScenario.get(scenarioId);
    if (!findings) {
      findings = new Map();
      findingsByScenario.set(scenarioId, findings);
    }
    const finding: DevRunnerAuthorityFinding = Object.freeze({
      id,
      scenarioId,
      code,
      ownerCallableId,
      subjectId,
      site,
      message
    });
    const identityKey = canonicalFindingKey(finding);
    if (findingIds.has(id) || findings.has(identityKey)) {
      throw new Error(`Duplicate global compact finding identity ${id}.`);
    }
    findingIds.add(id);
    findings.set(identityKey, finding);
  };
  const topologyFindingsById = new Map<string, FiniteProofFindingInput>();
  for (const finding of topology.findings) {
    requireScenario(finding.scenarioId, `Frozen finding ${finding.id}`);
    if (finding.id.length === 0 || topologyFindingsById.has(finding.id)) {
      throw new Error(`Duplicate or empty frozen finding ID ${finding.id}.`);
    }
    if (finding.ownerCallableId !== null) {
      requireCallable(finding.ownerCallableId, finding.scenarioId, `Frozen finding ${finding.id}`);
    }
    topologyFindingsById.set(finding.id, finding);
  }
  const proofFindingIds = new Set<string>();
  for (const finding of proof.findings) {
    if (proofFindingIds.has(finding.id)) {
      throw new Error(`Duplicate global proof finding ID ${finding.id}.`);
    }
    proofFindingIds.add(finding.id);
    const frozenFinding = topologyFindingsById.get(finding.id);
    if (frozenFinding && canonicalFindingKey(frozenFinding) !== canonicalFindingKey(finding)) {
      throw new Error(`Proof finding ${finding.id} contradicts its frozen topology identity.`);
    }
    addFinding(
      finding.scenarioId,
      finding.code,
      finding.message,
      finding.id,
      finding.ownerCallableId,
      finding.subjectId,
      finding.site
    );
  }
  for (const findingId of topologyFindingsById.keys()) {
    if (!proofFindingIds.has(findingId)) {
      throw new Error(`Proof omits frozen finding identity ${findingId}.`);
    }
  }
  const executionReceiptIds = new Set<string>();
  const unresolvedReceiptNodeKeys = new Set<string>();
  for (const receipt of proof.executionReceipts) {
    requireScenario(receipt.scenarioId, 'Execution receipt');
    requireNodeKey(receipt.nodeKey, receipt.scenarioId, 'Execution receipt');
    if (!EXECUTION_ROOT_BITS.includes(receipt.rootBit)) {
      throw new Error(`Execution receipt has invalid ExecutionRootBit ${receipt.rootBit}.`);
    }
    const receiptId = `${receipt.scenarioId}\0${receipt.rootBit}\0${receipt.nodeKey}\0` +
      `${receipt.kind}\0${receipt.callableId ?? ''}\0${receipt.bit}`;
    if (executionReceiptIds.has(receiptId)) {
      throw new Error(`Duplicate execution receipt ${receiptId}.`);
    }
    executionReceiptIds.add(receiptId);
    if (receipt.kind === 'known-callable' || receipt.kind === 'known-terminal') {
      if (receipt.callableId === null) {
        throw new Error(`Execution receipt ${receiptId} omits its CallableId.`);
      }
      requireCallable(receipt.callableId, receipt.scenarioId, `Execution receipt ${receiptId}`);
      assertFixedMask(`${receiptId} EffectBit`, receipt.bit, supportedEffectMask);
    } else {
      if (receipt.callableId !== null) {
        throw new Error(`Execution receipt ${receiptId} has a forbidden CallableId.`);
      }
      if (receipt.kind === 'unknown') {
        assertSingleBit(receipt.bit, supportedUnknownExecutionMask, `${receiptId} unknown bit`);
      } else if (receipt.kind === 'known-effect') {
        assertSingleBit(receipt.bit, supportedEffectMask, `${receiptId} effect bit`);
      } else if (receipt.kind === 'known-intrinsic') {
        assertSingleBit(receipt.bit, supportedCallableShapeMask, `${receiptId} intrinsic bit`);
      } else {
        assertSingleBit(
          receipt.bit,
          supportedExternalContractMask,
          `${receiptId} external contract bit`
        );
      }
    }
    if (receipt.kind !== 'unknown') continue;
    if (receipt.bit === UnknownExecutionBit.UnresolvedTarget) {
      unresolvedReceiptNodeKeys.add(`${receipt.scenarioId}\0${receipt.nodeKey}`);
    }
  }
  const facts = new Map<string, FiniteProofFactProjection>();
  for (const fact of proof.facts) {
    const key = `${fact.nodeKind}\0${fact.nodeId}`;
    if (nodeScenarioByKey.get(key) !== fact.scenarioId || facts.has(key)) {
      throw new Error(`Duplicate, unknown, or wrong-partition compact fact ${key}.`);
    }
    assertFixedMask(`${key} HandleBit`, fact.handles, supportedHandleMask);
    assertFixedMask(`${key} ProtectedRoleBit`, fact.roles, supportedRoleMask);
    assertFixedMask(`${key} CallableShapeBit`, fact.callableShapes, supportedCallableShapeMask);
    assertFixedMask(
      `${key} ExternalContractBit`,
      fact.externalContracts,
      supportedExternalContractMask
    );
    assertFixedMask(
      `${key} UnknownExecutionBit`,
      fact.unknownExecutions,
      supportedUnknownExecutionMask
    );
    facts.set(key, fact);
  }
  for (const receiptNodeKey of unresolvedReceiptNodeKeys) {
    const separator = receiptNodeKey.indexOf('\0');
    const key = receiptNodeKey.slice(separator + 1);
    if (((facts.get(key)?.unknownExecutions ?? 0) &
      UnknownExecutionBit.UnresolvedTarget) === 0) {
      throw new Error(`UnresolvedTarget receipt ${receiptNodeKey} lacks its node fact.`);
    }
  }
  const rootEffects = new Map<string, number>();
  for (const effect of proof.rootEffects) {
    const key = `${effect.scenarioId}\0${effect.rootBit}`;
    if (!scenarioIds.has(effect.scenarioId) || !EXECUTION_ROOT_BITS.includes(effect.rootBit) ||
      rootEffects.has(key)) {
      throw new Error(`Duplicate or unknown compact root effect ${key}.`);
    }
    assertFixedMask(`${key} EffectBit`, effect.effects, supportedEffectMask);
    rootEffects.set(key, effect.effects);
  }
  for (const scenarioId of scenarioIds) {
    for (const rootBit of EXECUTION_ROOT_BITS) {
      if (!rootEffects.has(`${scenarioId}\0${rootBit}`)) {
        throw new Error(`Compact proof omits root-effect identity ${scenarioId}\0${rootBit}.`);
      }
    }
  }
  const state = (node: FiniteProofNodeRef): {
    handles: number;
    roles: number;
    callableShapes: number;
    externalContracts: number;
    unknownExecutions: number;
  } => {
    const fact = facts.get(nodeKey(node));
    return fact ?? Object.freeze({
      scenarioId: '',
      nodeKind: node.kind,
      nodeId: node.id,
      handles: 0,
      roles: 0,
      callableShapes: 0,
      externalContracts: 0,
      unknownExecutions: 0
    });
  };
  const moduleExportSlotsByModuleId =
    new Map<string, ReadonlyMap<string, FiniteProofNodeRef>>();
  const emptyModuleExportSlots: ReadonlyMap<string, FiniteProofNodeRef> = new Map();
  const compactExportNodeOwners = new Set<string>();
  for (const entry of plan.moduleExportSlots) {
    if (moduleExportSlotsByModuleId.has(entry.moduleId)) {
      throw new Error(`Duplicate compact module export index ${entry.moduleId}.`);
    }
    const moduleScenarioId = moduleScenarioById.get(entry.moduleId);
    if (!moduleScenarioId) {
      throw new Error(`Compact export index references unknown module ${entry.moduleId}.`);
    }
    const slots = new Map<string, FiniteProofNodeRef>();
    for (const slot of entry.slots) {
      const key = nodeKey(slot.node);
      if (slot.exportName.length === 0 || slots.has(slot.exportName)) {
        throw new Error(`Duplicate compact export ${entry.moduleId}#${slot.exportName}.`);
      }
      requireNodeKey(key, moduleScenarioId, `Compact export ${entry.moduleId}#${slot.exportName}`);
      if (slot.node.kind !== 'export-slot' || compactExportNodeOwners.has(key)) {
        throw new Error(`Compact export ${entry.moduleId}#${slot.exportName} has duplicate or non-export ownership.`);
      }
      compactExportNodeOwners.add(key);
      slots.set(slot.exportName, slot.node);
    }
    moduleExportSlotsByModuleId.set(entry.moduleId, slots);
  }
  if (compactExportNodeOwners.size !== topologyExportNodeKeys.size ||
    [...topologyExportNodeKeys].some((key) => !compactExportNodeOwners.has(key))) {
    throw new Error('Compact export slots do not exactly cover frozen export-slot nodes.');
  }
  const moduleExportSlots = (moduleId: string): ReadonlyMap<string, FiniteProofNodeRef> =>
    moduleExportSlotsByModuleId.get(moduleId) ?? emptyModuleExportSlots;
  const modulesWithBoundedExport = new Set<string>();
  for (const [moduleId, slots] of moduleExportSlotsByModuleId) {
    for (const slot of slots.values()) {
      if ((state(slot).roles & ProtectedRoleBit.BoundedExecutor) !== 0) {
        modulesWithBoundedExport.add(moduleId);
        break;
      }
    }
  }
  const moduleHasBoundedExportFact = (moduleId: string): boolean =>
    modulesWithBoundedExport.has(moduleId);
  const rootBitsByCallableId = new Map<string, number>();
  for (const fact of proof.executionRootFacts) {
    if (callableScenarioById.get(fact.callableId) !== fact.scenarioId ||
      rootBitsByCallableId.has(fact.callableId)) {
      throw new Error(`Duplicate or unknown compact execution owner ${fact.callableId}.`);
    }
    const frozenCallable = topologyCallables.get(fact.callableId)!;
    if ((frozenCallable.ownerKind ?? 'callable') !== fact.ownerKind) {
      throw new Error(`Compact execution owner ${fact.callableId} has a stale owner kind.`);
    }
    assertFixedMask(
      `${fact.callableId} ExecutionRootBit`,
      fact.rootBits,
      supportedExecutionRootMask
    );
    rootBitsByCallableId.set(fact.callableId, fact.rootBits);
  }
  if (rootBitsByCallableId.size !== callableScenarioById.size) {
    throw new Error('Compact execution owners do not exactly cover frozen CallableIds.');
  }
  const callableEffects = new Map<string, number>();
  for (const effect of proof.effects) {
    if (callableScenarioById.get(effect.callableId) !== effect.scenarioId ||
      !rootBitsByCallableId.has(effect.callableId) ||
      callableEffects.has(effect.callableId)) {
      throw new Error(`Duplicate or unknown compact callable effect ${effect.callableId}.`);
    }
    assertFixedMask(`${effect.callableId} EffectBit`, effect.effects, supportedEffectMask);
    callableEffects.set(effect.callableId, effect.effects);
  }
  const sameCanonicalTarget = (
    left: FiniteProofCanonicalCallTarget,
    right: FiniteProofCanonicalCallTarget
  ): boolean => left.kind === right.kind && (
    left.kind === 'unknown' || right.kind === 'unknown'
      ? left.kind === right.kind
      : left.callableIds.length === right.callableIds.length &&
        left.callableIds.every((callableId, index) =>
          callableId === right.callableIds[index])
  );
  const rootBitsByCallSiteId = new Map<string, number>();
  const structuralCallSitesById = new Map<string, FiniteProofCallSiteProjection>();
  const knownPairIdsByCallSiteId = new Map<string, Set<string>>();
  for (const pair of proof.knownCallablePairs) {
    let ids = knownPairIdsByCallSiteId.get(pair.callSiteId);
    if (!ids) {
      ids = new Set();
      knownPairIdsByCallSiteId.set(pair.callSiteId, ids);
    }
    ids.add(pair.callableId);
  }
  for (const site of proof.structuralCallSites) {
    const frozenSite = topologyCallSites.get(site.callSiteId);
    if (!frozenSite || rootBitsByCallSiteId.has(site.callSiteId) ||
      frozenSite.scenarioId !== site.scenarioId ||
      (frozenSite.ownerCallableId ?? null) !== site.ownerCallableId ||
      (frozenSite.invocationKind ?? 'other') !== site.invocationKind ||
      frozenSite.location !== site.location) {
      throw new Error(`Duplicate, unknown, or contradictory structural CallSiteId ${site.callSiteId}.`);
    }
    assertFixedMask(
      `${site.callSiteId} ExecutionRootBit`,
      site.executionRootBits,
      supportedExecutionRootMask
    );
    for (const callableId of callTargetCallableIds(site.target)) {
      requireCallable(callableId, site.scenarioId, `Structural call site ${site.callSiteId}`);
    }
    const frozenTarget = frozenSite.target ?? canonicalCallTarget([], true);
    const roleDerivedTargetIds = [...(knownPairIdsByCallSiteId.get(site.callSiteId) ?? [])]
      .sort(compareCanonicalText);
    const expectedTargetIds = [...new Set([
      ...callTargetCallableIds(frozenTarget),
      ...roleDerivedTargetIds
    ])].sort(compareCanonicalText);
    const expectedTarget = canonicalCallTarget(
      expectedTargetIds,
      callTargetHasUnknown(frozenTarget) ||
        (facts.get(nodeKey(frozenSite.callee))?.unknownExecutions ?? 0) !== 0
    );
    if (!sameCanonicalTarget(site.target, expectedTarget)) {
      throw new Error(`Structural call site ${site.callSiteId} contradicts frozen target and unknown execution facts.`);
    }
    if (unresolvedReceiptNodeKeys.has(`${site.scenarioId}\0${nodeKey(frozenSite.callee)}`) &&
      !callTargetHasUnknown(site.target)) {
      throw new Error(`Structural call site ${site.callSiteId} hides UnresolvedTarget execution.`);
    }
    rootBitsByCallSiteId.set(site.callSiteId, site.executionRootBits);
    structuralCallSitesById.set(site.callSiteId, site);
  }
  if (structuralCallSitesById.size !== topologyCallSites.size) {
    throw new Error('Structural call sites do not exactly cover frozen CallSiteIds.');
  }
  const knownPairIds = new Set<string>();
  for (const pair of proof.knownCallablePairs) {
    const site = structuralCallSitesById.get(pair.callSiteId);
    requireCallable(pair.callableId, pair.scenarioId, `Known call pair ${pair.callSiteId}`);
    const identity = `${pair.scenarioId}\0${pair.callSiteId}\0${pair.callableId}`;
    if (!site || site.scenarioId !== pair.scenarioId || knownPairIds.has(identity) ||
      !callTargetCallableIds(site.target).includes(pair.callableId)) {
      throw new Error(`Duplicate, unknown, or contradictory known call pair ${identity}.`);
    }
    knownPairIds.add(identity);
  }
  for (const site of proof.structuralCallSites) {
    for (const callableId of callTargetCallableIds(site.target)) {
      const identity = `${site.scenarioId}\0${site.callSiteId}\0${callableId}`;
      if (!knownPairIds.has(identity)) {
        throw new Error(`Known call pair projection omits ${identity}.`);
      }
    }
  }
  const callsByScenario = new Map<string, ValidatedCompactCallSite[]>();
  const validatedCallsById = new Map<string, ValidatedCompactCallSite>();
  const callIds = new Set<string>();
  for (const call of plan.calls) {
    if (callIds.has(call.id)) throw new Error(`Duplicate compact call ${call.id}.`);
    callIds.add(call.id);
    const frozenCall = topologyCallSites.get(call.id);
    const structuralCall = structuralCallSitesById.get(call.id);
    if (!frozenCall || !structuralCall || frozenCall.scenarioId !== call.scenarioId ||
      frozenCall.moduleId !== call.moduleId ||
      (frozenCall.ownerCallableId ?? null) !== call.ownerCallableId ||
      (frozenCall.invocationKind ?? 'other') !== call.invocationKind ||
      nodeKey(frozenCall.callee) !== nodeKey(call.callee) ||
      frozenCall.location !== call.location) {
      throw new Error(`Compact call ${call.id} contradicts its frozen CallSiteId.`);
    }
    requireModule(call.moduleId, call.scenarioId, `Compact call ${call.id}`);
    requireNodeKey(nodeKey(call.callee), call.scenarioId, `Compact call ${call.id}`);
    if (call.ownerCallableId !== null) {
      requireCallable(call.ownerCallableId, call.scenarioId, `Compact call ${call.id}`);
    }
    assertFixedMask(
      `${call.id} direct capability HandleBit`,
      call.directCapabilityHandles,
      supportedHandleMask
    );
    const validatedCall: ValidatedCompactCallSite = Object.freeze({
      ...call,
      target: structuralCall.target
    });
    validatedCallsById.set(call.id, validatedCall);
    let calls = callsByScenario.get(call.scenarioId);
    if (!calls) {
      calls = [];
      callsByScenario.set(call.scenarioId, calls);
    }
    calls.push(validatedCall);
  }
  if (validatedCallsById.size !== topologyCallSites.size) {
    throw new Error('Compact calls do not exactly cover frozen and structural CallSiteIds.');
  }
  const usesByScenario = new Map<string, CompactUseSite[]>();
  const calleeUsesByCallSiteId = new Map<string, CompactUseSite[]>();
  const compactUseIds = new Set<string>();
  for (const use of plan.uses) {
    requireScenario(use.scenarioId, `Compact use ${use.location}`);
    requireModule(use.moduleId, use.scenarioId, `Compact use ${use.location}`);
    requireNodeKey(nodeKey(use.node), use.scenarioId, `Compact use ${use.location}`);
    if (use.ownerCallableId !== null) {
      requireCallable(use.ownerCallableId, use.scenarioId, `Compact use ${use.location}`);
    }
    if ((use.ambientPropertyNames !== null &&
      (use.ambientPropertyNames.length === 0 ||
        new Set(use.ambientPropertyNames).size !== use.ambientPropertyNames.length)) ||
      !['computed-property', 'fixed-property-read', 'mutation', 'whole-value']
        .includes(use.ambientAuthorityUseKind)) {
      throw new Error(`Compact use ${use.location} has invalid ambient authority metadata.`);
    }
    const identity = `${use.scenarioId}\0${use.moduleId}\0${use.location}\0${use.kind}\0` +
      `${use.ownerCallableId ?? ''}\0${use.callSiteId ?? ''}\0${nodeKey(use.node)}`;
    if (compactUseIds.has(identity)) {
      throw new Error(`Duplicate compact use identity ${identity}.`);
    }
    compactUseIds.add(identity);
    if ((use.kind === 'call-callee') !== (use.callSiteId !== null)) {
      throw new Error(`Compact use ${identity} has inconsistent callsite ownership.`);
    }
    if (use.callSiteId !== null) {
      const call = validatedCallsById.get(use.callSiteId);
      if (!call || call.scenarioId !== use.scenarioId || call.moduleId !== use.moduleId ||
        call.ownerCallableId !== use.ownerCallableId) {
        throw new Error(`Compact use ${identity} references an invalid CallSiteId.`);
      }
    }
    let uses = usesByScenario.get(use.scenarioId);
    if (!uses) {
      uses = [];
      usesByScenario.set(use.scenarioId, uses);
    }
    uses.push(use);
    if (use.kind === 'call-callee' && use.callSiteId !== null) {
      let callUses = calleeUsesByCallSiteId.get(use.callSiteId);
      if (!callUses) {
        callUses = [];
        calleeUsesByCallSiteId.set(use.callSiteId, callUses);
      }
      callUses.push(use);
    }
  }
  const unknownFrontiersByScenario = new Map<string, FiniteProofUnknownFrontierInput[]>();
  const compactFrontierIds = new Set<string>();
  for (const frontier of plan.unknownFrontiers) {
    const frozenFrontier = topologyFrontiers.get(frontier.id);
    if (!frozenFrontier || compactFrontierIds.has(frontier.id) ||
      frozenFrontier.scenarioId !== frontier.scenarioId ||
      frozenFrontier.operation !== frontier.operation ||
      (frozenFrontier.moduleId ?? null) !== (frontier.moduleId ?? null) ||
      (frozenFrontier.ownerCallableId ?? null) !== (frontier.ownerCallableId ?? null) ||
      nodeKey(frozenFrontier.base) !== nodeKey(frontier.base) ||
      (frozenFrontier.source ? nodeKey(frozenFrontier.source) : null) !==
        (frontier.source ? nodeKey(frontier.source) : null) ||
      (frozenFrontier.target ? nodeKey(frozenFrontier.target) : null) !==
        (frontier.target ? nodeKey(frontier.target) : null) ||
      frozenFrontier.code !== frontier.code || frozenFrontier.message !== frontier.message) {
      throw new Error(`Duplicate, unknown, or contradictory compact frontier ${frontier.id}.`);
    }
    compactFrontierIds.add(frontier.id);
    requireNodeKey(nodeKey(frontier.base), frontier.scenarioId, `Compact frontier ${frontier.id}`);
    if (frontier.source) {
      requireNodeKey(nodeKey(frontier.source), frontier.scenarioId, `Compact frontier ${frontier.id}`);
    }
    if (frontier.target) {
      requireNodeKey(nodeKey(frontier.target), frontier.scenarioId, `Compact frontier ${frontier.id}`);
    }
    if (frontier.ownerCallableId !== undefined) {
      requireCallable(frontier.ownerCallableId, frontier.scenarioId, `Compact frontier ${frontier.id}`);
    }
    if (frontier.moduleId !== undefined) {
      requireModule(frontier.moduleId, frontier.scenarioId, `Compact frontier ${frontier.id}`);
    }
    let frontiers = unknownFrontiersByScenario.get(frontier.scenarioId);
    if (!frontiers) {
      frontiers = [];
      unknownFrontiersByScenario.set(frontier.scenarioId, frontiers);
    }
    frontiers.push(frontier);
  }
  if (compactFrontierIds.size !== topologyFrontiers.size) {
    throw new Error('Compact unknown frontiers do not exactly cover frozen frontier identities.');
  }
  const externalAcquisitionsByScenarioModule =
    new Map<string, CompactExternalAcquisition[]>();
  const externalAcquisitionIds = new Set<string>();
  for (const acquisition of plan.externalAcquisitions) {
    requireScenario(acquisition.scenarioId, `External acquisition ${acquisition.location}`);
    requireModule(
      acquisition.moduleId,
      acquisition.scenarioId,
      `External acquisition ${acquisition.location}`
    );
    const identity = `${acquisition.scenarioId}\0${acquisition.moduleId}\0` +
      `${acquisition.specifier}\0${acquisition.exportName}\0${acquisition.kind}\0` +
      acquisition.location;
    if (acquisition.specifier.length === 0 || acquisition.exportName.length === 0 ||
      acquisition.location.length === 0 || externalAcquisitionIds.has(identity)) {
      throw new Error(`Duplicate or incomplete external acquisition ${identity}.`);
    }
    externalAcquisitionIds.add(identity);
    const key = `${acquisition.scenarioId}\0${acquisition.moduleId}`;
    let acquisitions = externalAcquisitionsByScenarioModule.get(key);
    if (!acquisitions) {
      acquisitions = [];
      externalAcquisitionsByScenarioModule.set(key, acquisitions);
    }
    acquisitions.push(acquisition);
  }
  const modulesByScenario = new Map<string, string[]>();
  const moduleIds = new Set<string>();
  for (const module of plan.moduleIds) {
    if (moduleIds.has(module.moduleId) ||
      moduleScenarioById.get(module.moduleId) !== module.scenarioId) {
      throw new Error(`Duplicate compact module id ${module.moduleId}.`);
    }
    moduleIds.add(module.moduleId);
    let modules = modulesByScenario.get(module.scenarioId);
    if (!modules) {
      modules = [];
      modulesByScenario.set(module.scenarioId, modules);
    }
    modules.push(module.moduleId);
  }
  if (moduleIds.size !== moduleScenarioById.size) {
    throw new Error('Compact module ids do not exactly cover frozen module topology.');
  }
  const namespaceUsesByScenario = new Map<string, CompactNamespaceUse[]>();
  const namespaceUseIds = new Set<string>();
  for (const use of plan.namespaceUses) {
    requireScenario(use.scenarioId, `Namespace use ${use.location}`);
    requireModule(use.targetModuleId, use.scenarioId, `Namespace use ${use.location}`);
    const identity = `${use.scenarioId}\0${use.targetModuleId}\0${use.kind}\0${use.location}`;
    if (use.location.length === 0 || namespaceUseIds.has(identity)) {
      throw new Error(`Duplicate or incomplete namespace use ${identity}.`);
    }
    namespaceUseIds.add(identity);
    let uses = namespaceUsesByScenario.get(use.scenarioId);
    if (!uses) {
      uses = [];
      namespaceUsesByScenario.set(use.scenarioId, uses);
    }
    uses.push(use);
  }
  for (const binding of plan.scenarioBindings) {
    if (binding.moduleScope.length === 0 && binding.scenarioId !== 'live') {
      throw new Error(`Compact scenario binding ${binding.scenarioId} has an empty module scope.`);
    }
    for (const moduleId of [
      binding.commandModuleId,
      binding.boundedModuleId,
      binding.processModuleId
    ]) {
      if (moduleId !== null) {
        requireModule(moduleId, binding.scenarioId, `Compact binding ${binding.scenarioId}`);
      }
    }
    for (const callableId of [
      binding.commandCallableId,
      binding.boundedCallableId,
      binding.runFastTestsCallableId,
      binding.affectedTestsBaseRefCallableId,
      binding.gitChangedFilesCallableId,
      binding.resolveAffectedTestExecutionCallableId,
      binding.runCommandBytesCallableId,
      binding.commandModuleInitializerId,
      binding.boundedModuleInitializerId,
      binding.processModuleInitializerId
    ]) {
      if (callableId !== null) {
        requireCallable(callableId, binding.scenarioId, `Compact binding ${binding.scenarioId}`);
      }
    }
  }
  const executionRootBits = (entry: {
    readonly id?: string;
    readonly callSiteId?: string | null;
    readonly ownerCallableId: CallableId | null;
  }): number => {
    const callSiteId = entry.id ?? entry.callSiteId;
    if (callSiteId) {
      const bits = rootBitsByCallSiteId.get(callSiteId as CallSiteId);
      if (bits === undefined) throw new Error(`Unknown compact CallSiteId ${callSiteId}.`);
      return bits;
    }
    if (entry.ownerCallableId) {
      const bits = rootBitsByCallableId.get(entry.ownerCallableId);
      if (bits === undefined) {
        throw new Error(`Unknown compact execution owner ${entry.ownerCallableId}.`);
      }
      return bits;
    }
    return 0;
  };
  const hasExecutionRoot = (
    entry: Parameters<typeof executionRootBits>[0],
    rootBit: ExecutionRootBitValue
  ): boolean => (executionRootBits(entry) & rootBit) !== 0;
  const hasProtectedCallUse = (
    call: CompactCallSite,
    domain: 'handle' | 'role',
    mask: number
  ): boolean => {
    const calleeState = state(call.callee);
    if (((domain === 'handle' ? calleeState.handles : calleeState.roles) & mask) !== 0) {
      return true;
    }
    return (calleeUsesByCallSiteId.get(call.id) ?? []).some((use) =>
      use.kind === 'call-callee' && use.callSiteId === call.id &&
      ((domain === 'handle' ? state(use.node).handles : state(use.node).roles) & mask) !== 0);
  };
  const hasExactDirectTarget = (
    call: ValidatedCompactCallSite,
    callableId: CallableId
  ): boolean =>
    call.invocationKind === 'direct' && call.exactCanonicalCallee &&
    call.target.kind === 'known' &&
    call.target.callableIds.length === 1 && call.target.callableIds[0] === callableId;
  const processedFrontierIds = new Set<string>();
  for (const frontierId of proof.processedUnknownFrontiers) {
    if (!topologyFrontiers.has(frontierId) || processedFrontierIds.has(frontierId)) {
      throw new Error(`Duplicate or unknown processed frontier ${frontierId}.`);
    }
    processedFrontierIds.add(frontierId);
  }
  if (processedFrontierIds.size !== topologyFrontiers.size) {
    throw new Error('Processed frontier projection does not cover frozen frontiers exactly once.');
  }
  const triggeredFrontierIds = new Set<string>();
  for (const frontier of proof.triggeredUnknownFrontiers) {
    const frozenFrontier = topologyFrontiers.get(frontier.id);
    if (!frozenFrontier || triggeredFrontierIds.has(frontier.id) ||
      frozenFrontier.scenarioId !== frontier.scenarioId ||
      frozenFrontier.operation !== frontier.operation ||
      (frozenFrontier.ownerCallableId ?? null) !== frontier.ownerCallableId ||
      frozenFrontier.code !== frontier.code || frozenFrontier.message !== frontier.message) {
      throw new Error(`Duplicate, unknown, or contradictory triggered frontier ${frontier.id}.`);
    }
    if (frontier.ownerCallableId !== null) {
      requireCallable(
        frontier.ownerCallableId,
        frontier.scenarioId,
        `Triggered frontier ${frontier.id}`
      );
    }
    triggeredFrontierIds.add(frontier.id);
  }
  lifecycle.compactValidationIndexBuildCount += 1;

  for (const binding of plan.scenarioBindings) {
    const scenarioId = binding.scenarioId;
    const scenarioCalls = callsByScenario.get(scenarioId) ?? [];
    const scenarioUses = usesByScenario.get(scenarioId) ?? [];
    for (const use of scenarioUses) {
      if (!hasExecutionRoot(use, ExecutionRootBit.ModuleInitialization)) continue;
      const useState = state(use.node);
      if (useState.handles === 0 && useState.roles === 0) continue;
      addFinding(
        scenarioId,
        'MODULE_INITIALIZATION_AUTHORITY',
        `${use.location}: module initialization observes a protected handle or role`,
        `module-initialization-use:${use.location}:${nodeKey(use.node)}`,
        use.ownerCallableId,
        nodeKey(use.node),
        use.location
      );
    }
    const moduleInitializationEffects = rootEffects.get(
      `${scenarioId}\0${ExecutionRootBit.ModuleInitialization}`
    ) ?? 0;
    if (moduleInitializationEffects !== 0) {
      addFinding(
        scenarioId,
        'MODULE_INITIALIZATION_AUTHORITY',
        `module initialization reaches protected or unknown effect ` +
          `(EffectBit=${moduleInitializationEffects})`,
        `module-initialization-effect:${scenarioId}:${ExecutionRootBit.ModuleInitialization}`,
        null,
        String(ExecutionRootBit.ModuleInitialization),
        null
      );
    }
    for (const frontier of unknownFrontiersByScenario.get(scenarioId) ?? []) {
      if (!triggeredFrontierIds.has(frontier.id)) continue;
      addFinding(
        scenarioId,
        frontier.code,
        frontier.message,
        `triggered-frontier:${frontier.id}`,
        frontier.ownerCallableId ?? null,
        frontier.id,
        null
      );
    }
    const commandSlot = binding.commandModuleId
      ? moduleExportSlots(binding.commandModuleId).get('runDevCommand')
      : undefined;
    if (binding.commandCallableId &&
      (!commandSlot || (state(commandSlot).roles & ProtectedRoleBit.ReviewedDevCommand) === 0)) {
      addFinding(
        scenarioId,
        'COMMAND_OWNER_CONTRACT',
        `${binding.commandOwnerModuleId}: runDevCommand must own its exact reviewed export slot`,
        `command-owner-slot:${binding.commandOwnerModuleId}`,
        binding.commandCallableId,
        binding.commandOwnerModuleId,
        null
      );
    }
    if (binding.commandModuleId && binding.commandCallableId) {
      const childSpecifierSet = new Set([
        'node:child_process', 'node:cluster', 'node:worker_threads'
      ]);
      const childAcquisitions = (externalAcquisitionsByScenarioModule.get(
        `${scenarioId}\0${binding.commandModuleId}`
      ) ?? []).filter((acquisition) =>
        childSpecifierSet.has(normalizeBuiltinSpecifier(acquisition.specifier)));
      const exactAcquisitions = childAcquisitions.filter((acquisition) =>
        normalizeBuiltinSpecifier(acquisition.specifier) === 'node:child_process' &&
        acquisition.exportName === 'spawn' && acquisition.kind === 'named');
      if (childAcquisitions.length !== 1 || exactAcquisitions.length !== 1) {
        addFinding(
          scenarioId,
          'COMMAND_OWNER_CONTRACT',
          `${binding.commandModuleId}: must acquire exactly one named node:child_process#spawn value`,
          `command-owner-acquisition:${binding.commandModuleId}`,
          binding.commandCallableId,
          binding.commandModuleId,
          null
        );
      }
      const spawnCalls = scenarioCalls.filter((call) =>
        call.moduleId === binding.commandModuleId &&
        (state(call.callee).handles & HandleBit.ExactNodeChildSpawn) !== 0);
      const validSpawn = spawnCalls.length === 1 &&
        hasExecutionRoot(spawnCalls[0]!, ExecutionRootBit.CommandOwner) &&
        !hasExecutionRoot(spawnCalls[0]!, ExecutionRootBit.ModuleInitialization) &&
        (spawnCalls[0]!.invocationKind === 'direct' ||
          (spawnCalls[0]!.invocationKind === 'other' &&
            (state(spawnCalls[0]!.callee).handles & HandleBit.ExactNodeChildSpawn) !== 0)) &&
        (spawnCalls[0]!.directCapabilityHandles & HandleBit.ExactNodeChildSpawn) !== 0 &&
        hasProtectedCallUse(
          spawnCalls[0]!,
          'handle',
          HandleBit.ExactNodeChildSpawn
        );
      if (!validSpawn) {
        addFinding(
          scenarioId,
          'COMMAND_OWNER_CONTRACT',
          `${binding.commandModuleId}: exact spawn value must be directly invoked once inside runDevCommand`,
          `command-owner-spawn-call:${binding.commandModuleId}`,
          binding.commandCallableId,
          binding.commandModuleId,
          null
        );
      }
      const allowedSpawnCallSiteId = validSpawn ? spawnCalls[0]!.id : null;
      for (const use of scenarioUses) {
        if (use.moduleId !== binding.commandModuleId) continue;
        const useState = state(use.node);
        if ((useState.handles & HandleBit.ChildAuthority) === 0) continue;
        if (use.kind === 'call-callee' && use.callSiteId === allowedSpawnCallSiteId &&
          hasExecutionRoot(use, ExecutionRootBit.CommandOwner) &&
          !hasExecutionRoot(use, ExecutionRootBit.ModuleInitialization)) continue;
        addFinding(
          scenarioId,
          'COMMAND_OWNER_CONTRACT',
          `${use.location}: child authority is aliased, passed, wrapped, or exposed`,
          `command-owner-child-use:${use.location}:${nodeKey(use.node)}`,
          use.ownerCallableId,
          nodeKey(use.node),
          use.location
        );
      }
      for (const [exportName, slot] of moduleExportSlots(binding.commandModuleId)) {
        if (exportName === 'runDevCommand') continue;
        if ((state(slot).handles & HandleBit.ChildAuthority) !== 0) {
          addFinding(
            scenarioId,
            'COMMAND_OWNER_CONTRACT',
            `${binding.commandModuleId}: child authority is exported as ${exportName}`,
            `command-owner-child-export:${binding.commandModuleId}:${exportName}`,
            binding.commandCallableId,
            `${binding.commandModuleId}#${exportName}`,
            null
          );
        }
      }
    }

    if (binding.boundedCallableId && binding.commandCallableId && binding.boundedModuleId) {
      const boundedDirectDispatches = scenarioCalls.filter((call) =>
        hasExactDirectTarget(call, binding.commandCallableId!) &&
        call.boundedClosureNested &&
        hasExecutionRoot(call, ExecutionRootBit.BoundedOwner) &&
        !hasExecutionRoot(call, ExecutionRootBit.ModuleInitialization) &&
        hasProtectedCallUse(
          call,
          'role',
          ProtectedRoleBit.ReviewedDevCommand
        ));
      if (boundedDirectDispatches.length !== 1) {
        addFinding(
          scenarioId,
          'BOUNDED_OWNER_CONTRACT',
          `${binding.boundedModuleId}: bounded closure must contain one direct canonical runDevCommand dispatch`,
          `bounded-owner-dispatch:${binding.boundedModuleId}`,
          binding.boundedCallableId,
          binding.commandCallableId,
          null
        );
      }
      const boundedEffects = rootEffects.get(
        `${scenarioId}\0${ExecutionRootBit.BoundedOwner}`
      ) ?? 0;
      if ((boundedEffects & EffectBit.InvokesReviewedDevCommand) === 0) {
        addFinding(
          scenarioId,
          'BOUNDED_OWNER_CONTRACT',
          `${binding.boundedModuleId}: bounded closure has no reviewed dispatcher effect`,
          `bounded-owner-dispatch-effect:${binding.boundedModuleId}`,
          binding.boundedCallableId,
          String(EffectBit.InvokesReviewedDevCommand),
          null
        );
      }
      const forbiddenEffects = EffectBit.InvokesSharedProcessBytes |
        EffectBit.InvokesSharedProcessAlternative |
        EffectBit.InvokesChildAuthority |
        EffectBit.ReadsProcessEnvironment |
        EffectBit.UsesExecutableLoader |
        EffectBit.ReadsAvailableParallelism |
        EffectBit.ReadsPolicyAuthority |
        EffectBit.UsesWorkerAuthority |
        EffectBit.UnknownProtectedExecution;
      if ((boundedEffects & forbiddenEffects) !== 0) {
        addFinding(
          scenarioId,
          'BOUNDED_OWNER_CONTRACT',
          `${binding.boundedModuleId}: bounded closure reaches a forbidden authority effect`,
          `bounded-owner-forbidden-effect:${binding.boundedModuleId}`,
          binding.boundedCallableId,
          String(boundedEffects & forbiddenEffects),
          null
        );
      }
      const allowedDispatchCallSiteIds = new Set(boundedDirectDispatches.map(({ id }) => id));
      for (const use of scenarioUses) {
        if ((state(use.node).roles & ProtectedRoleBit.ReviewedDevCommand) === 0) continue;
        const inBoundedRegion = hasExecutionRoot(use, ExecutionRootBit.BoundedOwner) ||
          hasExecutionRoot(use, ExecutionRootBit.ModuleInitialization);
        if (!inBoundedRegion) continue;
        if (use.kind === 'call-callee' && use.callSiteId !== null &&
          allowedDispatchCallSiteIds.has(use.callSiteId)) continue;
        addFinding(
          scenarioId,
          'BOUNDED_OWNER_CONTRACT',
          `${use.location}: reviewed dispatcher escapes the bounded authority provenance`,
          `bounded-owner-dispatch-use:${use.location}:${nodeKey(use.node)}`,
          use.ownerCallableId,
          nodeKey(use.node),
          use.location
        );
      }
      const forbiddenHandles = HandleBit.ChildAuthority |
        HandleBit.ProcessEnvironment |
        HandleBit.ExecutableLoader |
        HandleBit.AvailableParallelism |
        HandleBit.PolicyAuthority |
        HandleBit.WorkerAuthority;
      for (const use of scenarioUses) {
        if (!hasExecutionRoot(use, ExecutionRootBit.BoundedOwner)) continue;
        const useState = state(use.node);
        if ((useState.handles & forbiddenHandles) !== 0 ||
          (useState.roles & ProtectedRoleBit.SharedProcessAlternative) !== 0) {
          addFinding(
            scenarioId,
            'BOUNDED_OWNER_CONTRACT',
            `${use.location}: bounded authority closure observes a forbidden capability`,
            `bounded-owner-forbidden-use:${use.location}:${nodeKey(use.node)}`,
            use.ownerCallableId,
            nodeKey(use.node),
            use.location
          );
        }
      }
    }

    if (binding.boundedModuleId && binding.gitChangedFilesCallableId) {
      const affectedBaseKeys = new Set(['SEC_AFFECTED_TESTS_BASE', 'SEC_CHANGED_BASE']);
      const exactAffectedBaseReads = new Map<string, number>(
        [...affectedBaseKeys].map((key) => [key, 0])
      );
      let environmentAuthorityClosed = binding.affectedTestsBaseRefExact &&
        binding.affectedTestsBaseRefCallableId !== null;
      for (const use of scenarioUses) {
        if (use.moduleId !== binding.boundedModuleId) continue;
        const handles = state(use.node).handles;
        const isRuntimeGlobal = (handles & HandleBit.RuntimeGlobal) !== 0;
        const isRuntimeBun = (handles & HandleBit.RuntimeBun) !== 0;
        const isRuntimeImportMeta = (handles & HandleBit.RuntimeImportMeta) !== 0;
        const isRuntimeProcess = (handles & HandleBit.RuntimeProcess) !== 0;
        const isProcessEnvironment = (handles & HandleBit.ProcessEnvironment) !== 0;
        if (!isRuntimeGlobal && !isRuntimeBun && !isRuntimeImportMeta &&
          !isRuntimeProcess && !isProcessEnvironment) continue;
        const properties = use.ambientPropertyNames;
        const exactAffectedBaseRead = isProcessEnvironment &&
          use.ambientAuthorityUseKind === 'fixed-property-read' &&
          use.ownerCallableId === binding.affectedTestsBaseRefCallableId &&
          properties !== null && properties.length === 1 &&
          affectedBaseKeys.has(properties[0]!);
        const fixedPropertyRead = use.ambientAuthorityUseKind === 'fixed-property-read' &&
          properties !== null && properties.length === 1;
        const ordinaryEnvironmentRead = isProcessEnvironment && fixedPropertyRead &&
          !affectedBaseKeys.has(properties[0]!);
        const ordinaryProcessRead = isRuntimeProcess && !isProcessEnvironment &&
          fixedPropertyRead;
        const ordinaryGlobalRead = isRuntimeGlobal && !isRuntimeProcess &&
          !isProcessEnvironment && fixedPropertyRead && properties[0] === 'process';
        const ordinaryBunEnvironmentRead = isRuntimeBun && !isProcessEnvironment &&
          fixedPropertyRead && properties[0] === 'env';
        const ordinaryImportMetaEnvironmentRead = isRuntimeImportMeta &&
          !isProcessEnvironment && fixedPropertyRead && properties[0] === 'env';
        const ordinaryImportMetaIdentityRead = isRuntimeImportMeta &&
          !isProcessEnvironment && fixedPropertyRead &&
          CAPABILITY_REGISTRY.some((entry) => entry.kind === 'immutable-property' &&
            entry.sourceHandle === HandleBit.RuntimeImportMeta &&
            entry.property === properties[0]!);
        if (exactAffectedBaseRead) {
          const key = properties[0]!;
          exactAffectedBaseReads.set(key, exactAffectedBaseReads.get(key)! + 1);
        } else if (!ordinaryEnvironmentRead && !ordinaryProcessRead &&
          !ordinaryGlobalRead && !ordinaryBunEnvironmentRead &&
          !ordinaryImportMetaEnvironmentRead && !ordinaryImportMetaIdentityRead) {
          environmentAuthorityClosed = false;
        }
      }
      if ([...exactAffectedBaseReads.values()].some((count) => count !== 1)) {
        environmentAuthorityClosed = false;
      }
      const observationCalls = scenarioCalls.filter((call) =>
        hasExactDirectTarget(call, binding.gitChangedFilesCallableId!));
      const validObservationOwner = binding.gitChangedFilesPrivateOwner &&
        environmentAuthorityClosed &&
        binding.resolveAffectedTestExecutionCallableId !== null &&
        observationCalls.length === 1 &&
        observationCalls[0]!.ownerCallableId ===
          binding.resolveAffectedTestExecutionCallableId &&
        !hasExecutionRoot(observationCalls[0]!, ExecutionRootBit.ModuleInitialization) &&
        hasProtectedCallUse(
          observationCalls[0]!,
          'role',
          ProtectedRoleBit.GitChangedFileObservationOwner
        );
      if (!validObservationOwner) {
        addFinding(
          scenarioId,
          'PROCESS_OWNER_CONTRACT',
          `${binding.boundedModuleId}: gitChangedFiles must be one private observation owner ` +
            `with one direct resolveAffectedTestExecution consumer`,
          `process-observation-owner:${binding.boundedModuleId}`,
          binding.gitChangedFilesCallableId,
          binding.resolveAffectedTestExecutionCallableId,
          null
        );
      }
      const allowedObservationCallSiteId = validObservationOwner
        ? observationCalls[0]!.id
        : null;
      for (const use of scenarioUses) {
        if ((state(use.node).roles & ProtectedRoleBit.GitChangedFileObservationOwner) === 0) {
          continue;
        }
        if (use.kind === 'call-callee' && use.callSiteId === allowedObservationCallSiteId &&
          use.ownerCallableId === binding.resolveAffectedTestExecutionCallableId) continue;
        addFinding(
          scenarioId,
          'PROCESS_OWNER_CONTRACT',
          `${use.location}: gitChangedFiles observation authority is aliased or exposed`,
          `process-observation-owner-use:${use.location}:${nodeKey(use.node)}`,
          use.ownerCallableId,
          nodeKey(use.node),
          use.location
        );
      }
      for (const [exportName, slot] of moduleExportSlots(binding.boundedModuleId)) {
        if ((state(slot).roles & ProtectedRoleBit.GitChangedFileObservationOwner) === 0) continue;
        addFinding(
          scenarioId,
          'PROCESS_OWNER_CONTRACT',
          `${binding.boundedModuleId}: gitChangedFiles observation authority is exported as ` +
            exportName,
          `process-observation-owner-export:${binding.boundedModuleId}:${exportName}`,
          binding.gitChangedFilesCallableId,
          `${binding.boundedModuleId}#${exportName}`,
          null
        );
      }
    }

    if (binding.boundedModuleId && binding.runCommandBytesCallableId) {
      const processCalls = scenarioCalls.filter((call) =>
        hasExactDirectTarget(call, binding.runCommandBytesCallableId!));
      const operationCensus = processCalls
        .map(({ gitChangedFileReadOperation }) => gitChangedFileReadOperation)
        .sort((left, right) => compareCanonicalText(left ?? '', right ?? ''));
      const hasExactReadOperationCensus =
        operationCensus.length === GIT_CHANGED_FILE_READ_OPERATIONS.length &&
        operationCensus.every((operation, index) =>
          operation === GIT_CHANGED_FILE_READ_OPERATIONS[index]);
      const valid = hasExactReadOperationCensus && binding.gitChangedFilesCallableId !== null &&
        processCalls.every((call) =>
          !hasExecutionRoot(call, ExecutionRootBit.ModuleInitialization) &&
          call.ownerCallableId === binding.gitChangedFilesCallableId &&
          call.firstArgumentLiteral === 'git' && hasProtectedCallUse(
          call,
          'role',
          ProtectedRoleBit.SharedProcessBytes
        ));
      if (!valid) {
        addFinding(
          scenarioId,
          'PROCESS_OWNER_CONTRACT',
          `${binding.boundedModuleId}: gitChangedFiles must own exactly the canonical read-only ` +
            `Git operation census; observed ${operationCensus.map((operation) =>
              operation ?? 'unclassified').join(', ')}`,
          `process-owner-direct-use:${binding.boundedModuleId}`,
          binding.gitChangedFilesCallableId,
          binding.runCommandBytesCallableId,
          null
        );
      }
      const allowedCallSiteIds = new Set(processCalls
        .filter((call) => !hasExecutionRoot(call, ExecutionRootBit.ModuleInitialization))
        .map(({ id }) => id));
      for (const use of scenarioUses) {
        if (use.moduleId !== binding.boundedModuleId ||
          (state(use.node).roles & ProtectedRoleBit.SharedProcessBytes) === 0) continue;
        if (use.kind === 'call-callee' && use.callSiteId !== null &&
          allowedCallSiteIds.has(use.callSiteId)) continue;
        addFinding(
          scenarioId,
          'PROCESS_OWNER_CONTRACT',
          `${use.location}: runCommandBytes is aliased, passed, or exposed`,
          `process-owner-use:${use.location}:${nodeKey(use.node)}`,
          use.ownerCallableId,
          nodeKey(use.node),
          use.location
        );
      }
    }

    if (binding.boundedCallableId && binding.runFastTestsCallableId && binding.boundedModuleId) {
      const boundedCalls = scenarioCalls.filter((call) =>
        hasExactDirectTarget(call, binding.boundedCallableId!));
      const legitimate = boundedCalls.filter((call) =>
        hasExecutionRoot(call, ExecutionRootBit.FastTestsEntry) &&
        !hasExecutionRoot(call, ExecutionRootBit.ModuleInitialization) &&
        hasProtectedCallUse(
          call,
          'role',
          ProtectedRoleBit.BoundedExecutor
        ));
      if (boundedCalls.length !== 2 || legitimate.length !== 2) {
        addFinding(
          scenarioId,
          'BOUNDED_EXPOSURE',
          `${binding.boundedModuleId}: private bounded executor must have exactly two direct runFastTests calls`,
          `bounded-exposure-call-count:${binding.boundedModuleId}`,
          binding.runFastTestsCallableId,
          binding.boundedCallableId,
          null
        );
      }
      const allowedCallSiteIds = new Set(legitimate.map(({ id }) => id));
      for (const use of scenarioUses) {
        if ((state(use.node).roles & ProtectedRoleBit.BoundedExecutor) === 0) continue;
        if (use.kind === 'call-callee' && use.callSiteId !== null &&
          allowedCallSiteIds.has(use.callSiteId)) continue;
        addFinding(
          scenarioId,
          'BOUNDED_EXPOSURE',
          `${use.location}: acquires or exposes the private bounded executor`,
          `bounded-exposure-use:${use.location}:${nodeKey(use.node)}`,
          use.ownerCallableId,
          nodeKey(use.node),
          use.location
        );
      }
    }
    for (const moduleId of modulesByScenario.get(scenarioId) ?? []) {
      if (moduleHasBoundedExportFact(moduleId)) {
        addFinding(
          scenarioId,
          'BOUNDED_EXPOSURE',
          `${moduleId}: exports the private bounded executor`,
          `bounded-exposure-module:${moduleId}`,
          null,
          moduleId,
          null
        );
      }
    }
    for (const use of namespaceUsesByScenario.get(scenarioId) ?? []) {
      if (!moduleHasBoundedExportFact(use.targetModuleId)) continue;
      addFinding(
        scenarioId,
        use.kind === 'package' ? 'PACKAGE_EXPOSURE' : 'BOUNDED_EXPOSURE',
        `${use.location}: ${use.kind} surface exposes the private bounded executor`,
        `bounded-exposure-namespace:${use.kind}:${use.location}:${use.targetModuleId}`,
        null,
        use.targetModuleId,
        use.location
      );
    }
  }

  return plan.scenarioBindings.map((binding): DevRunnerAuthorityScenarioProof => {
    const findings = [...(findingsByScenario.get(binding.scenarioId)?.values() ?? [])]
      .sort((left, right) => compareCanonicalText(
        canonicalFindingKey(left),
        canonicalFindingKey(right)
      ));
    return Object.freeze({
      scenarioId: binding.scenarioId,
      moduleScope: binding.moduleScope,
      commandOwnerModuleId: binding.commandOwnerModuleId,
      boundedOwnerModuleId: binding.boundedOwnerModuleId,
      processOwnerModuleId: binding.processOwnerModuleId,
      policyOwnerModuleIds: binding.policyOwnerModuleIds,
      violations: deepFreezeOwned(findings),
      violationCodes: deepFreezeOwned(findings.map(({ code }) => code))
    });
  });
}

function exactLiveScenario(
  scenarios: readonly DevRunnerAuthorityScenario[]
): DevRunnerAuthorityScenario {
  const liveScenarios = scenarios.filter(({ scenarioId }) => scenarioId === 'live');
  if (liveScenarios.length !== 1) {
    throw new Error('Program proof suite requires exactly one live scenario.');
  }
  return liveScenarios[0]!;
}

function analyzeSnapshottedDevRunnerAuthorityProof(
  inventory: TrackedDevRunnerHostInventory,
  ownedScenarios: readonly DevRunnerAuthorityScenario[],
  lifecycle: MutableDevRunnerAnalysisLifecycle,
  preparedKernel?: ProgramResolutionKernel
): DevRunnerAuthorityProofSuite {
  const ownedInventory = snapshotTrackedDevRunnerHostInventory(inventory);
  lifecycle.inventorySnapshotCount += 1;
  const context = buildProgramContext(
    ownedInventory,
    ownedScenarios,
    lifecycle,
    preparedKernel
  );
  const lowered = new ProgramAuthorityLowerer(context, lifecycle).lower();
  const finiteTopology = freezeFiniteAuthorityTopology(lowered.model);
  const finiteProof = solveFrozenFiniteAuthorityTopology(finiteTopology);
  const validationProjection: FrozenCompactValidationProjection = deepFreezeOwned({
    ...lowered.validationPlan,
    topology: finiteTopology,
    proof: finiteProof
  });
  const scenarioProofs = validateCompactProof(validationProjection, lifecycle);
  const scenarioProofRecord = Object.freeze(new Map(
    scenarioProofs.map((proof) => [proof.scenarioId, proof] as const)
  ));
  const moduleEdges = lowered.moduleEdges.map((edge): DevRunnerAuthorityModuleEdge => ({
    ...edge
  })).sort((left, right) => compareCanonicalText(
    `${left.scenarioId}\0${left.sourceModuleId}\0${left.targetModuleId}\0${left.kind}`,
    `${right.scenarioId}\0${right.sourceModuleId}\0${right.targetModuleId}\0${right.kind}`
  ));
  const moduleOwnerMap = new Map(context.modules.map((module) => [
    module.relativePath,
    module.scenarioId
  ] as const));
  for (const scenario of context.scenarios) {
    for (const surface of scenario.packageSurfaces) {
      const moduleId = devRunnerScenarioModuleId(scenario.scenarioId, surface.relativePath);
      const owner = moduleOwnerMap.get(moduleId);
      if (owner !== undefined && owner !== scenario.scenarioId) {
        throw new Error(`Package surface ${moduleId} crosses ScenarioPartition ownership.`);
      }
      moduleOwnerMap.set(moduleId, scenario.scenarioId);
    }
  }
  const moduleIds = [...moduleOwnerMap.keys()].sort(compareCanonicalText);
  const moduleOwners = Object.fromEntries(
    [...moduleOwnerMap].sort(([left], [right]) => compareCanonicalText(left, right))
  );
  lifecycle.publicSuiteFreezeCount += 1;
  const counters: DevRunnerAuthorityProofCounters = Object.freeze({
    inventoryReadCount: lifecycle.inventoryReadCount,
    injectedInventoryCount: lifecycle.injectedInventoryCount,
    inventorySnapshotCount: lifecycle.inventorySnapshotCount,
    packageJsonSnapshotCount: lifecycle.packageJsonSnapshotCount,
    programBuildCount: lifecycle.programBuildCount,
    typeCheckerBuildCount: lifecycle.typeCheckerBuildCount,
    moduleResolutionCacheBuildCount: lifecycle.moduleResolutionCacheBuildCount,
    programSymbolIndexBuildCount: lifecycle.programSymbolIndexBuildCount,
    moduleSccProjectionCount: lifecycle.moduleSccProjectionCount,
    callSccProjectionCount: lifecycle.callSccProjectionCount,
    compactValidationIndexBuildCount: lifecycle.compactValidationIndexBuildCount,
    publicSuiteFreezeCount: lifecycle.publicSuiteFreezeCount,
    ...finiteProof.counters
  });
  const compact = deepFreezeOwned({
    scenarioIds: context.scenarios.map(({ scenarioId }) => scenarioId),
    moduleIds,
    moduleOwners,
    moduleEdges,
    scenarioProofs,
    finiteProofBytes: finiteProof.canonicalBytes,
    counters,
    bounds: finiteProof.bounds
  });
  return deepFreezeOwned({
    inventory: ownedInventory,
    scenarioIds: compact.scenarioIds,
    moduleIds,
    moduleOwners,
    moduleEdges,
    scenarioProofs,
    scenarioProofsById: scenarioProofRecord,
    finiteProof,
    counters,
    bounds: finiteProof.bounds,
    canonicalBytes: JSON.stringify({ finiteProofBytes: finiteProof.canonicalBytes })
  });
}

export function analyzeDevRunnerAuthorityProofWithInventoryForTests(
  inventory: TrackedDevRunnerHostInventory,
  inputScenarios: readonly DevRunnerAuthorityScenario[]
): DevRunnerAuthorityProofSuite {
  const lifecycle = createDevRunnerAnalysisLifecycle();
  lifecycle.injectedInventoryCount += 1;
  const ownedScenarios = snapshotDevRunnerAuthorityScenarios(inputScenarios, () => {
    lifecycle.packageJsonSnapshotCount += 1;
  });
  return analyzeSnapshottedDevRunnerAuthorityProof(inventory, ownedScenarios, lifecycle);
}

export async function analyzeDevRunnerAuthorityProof(
  inputScenarios: readonly DevRunnerAuthorityScenario[]
): Promise<DevRunnerAuthorityProofSuite> {
  const lifecycle = createDevRunnerAnalysisLifecycle();
  const ownedScenarios = snapshotDevRunnerAuthorityScenarios(inputScenarios, () => {
    lifecycle.packageJsonSnapshotCount += 1;
  });
  const kernel = createProgramResolutionKernel(lifecycle);
  const inventory = await readTrackedDevRunnerHostSources(
    exactLiveScenario(ownedScenarios),
    kernel
  );
  lifecycle.inventoryReadCount += 1;
  return analyzeSnapshottedDevRunnerAuthorityProof(
    inventory,
    ownedScenarios,
    lifecycle,
    kernel
  );
}

function snapshotScenarioProofForProjection(
  candidate: CanonicalOrdinaryData,
  expectedScenarioId: string,
  label: string
): DevRunnerAuthorityScenarioProof {
  const proof = ordinaryRecord(candidate, label);
  assertExactOrdinaryKeys(proof, [
    'scenarioId',
    'moduleScope',
    'commandOwnerModuleId',
    'boundedOwnerModuleId',
    'processOwnerModuleId',
    'policyOwnerModuleIds',
    'violations',
    'violationCodes'
  ], label);
  const scenarioId = ordinaryString(proof.scenarioId, `${label}.scenarioId`);
  if (scenarioId !== expectedScenarioId) {
    throw new Error(`${label} changed its ScenarioPartition identity.`);
  }
  const findingIds = new Set<string>();
  const findingIdentities = new Set<string>();
  const findings = ordinaryArray(proof.violations!, `${label}.violations`).map(
    (candidateFinding, index): DevRunnerAuthorityFinding => {
      const findingLabel = `${label}.violations[${index}]`;
      const finding = ordinaryRecord(candidateFinding, findingLabel);
      assertExactOrdinaryKeys(finding, [
        'id',
        'scenarioId',
        'code',
        'ownerCallableId',
        'subjectId',
        'site',
        'message'
      ], findingLabel);
      const result: DevRunnerAuthorityFinding = {
        id: ordinaryString(finding.id, `${findingLabel}.id`),
        scenarioId: ordinaryString(finding.scenarioId, `${findingLabel}.scenarioId`),
        code: ordinaryString(finding.code, `${findingLabel}.code`),
        ownerCallableId: ordinaryNullableString(
          finding.ownerCallableId,
          `${findingLabel}.ownerCallableId`
        ),
        subjectId: ordinaryNullableString(finding.subjectId, `${findingLabel}.subjectId`),
        site: ordinaryNullableString(finding.site, `${findingLabel}.site`),
        message: ordinaryString(finding.message, `${findingLabel}.message`)
      };
      if (result.scenarioId !== scenarioId || result.id.length === 0 || result.code.length === 0) {
        throw new Error(`${findingLabel} has an invalid finding identity.`);
      }
      const identity = canonicalFindingKey(result);
      if (findingIds.has(result.id) || findingIdentities.has(identity)) {
        throw new Error(`${findingLabel} duplicates a finding identity.`);
      }
      findingIds.add(result.id);
      findingIdentities.add(identity);
      return result;
    }
  ).sort((left, right) => compareCanonicalText(
    canonicalFindingKey(left),
    canonicalFindingKey(right)
  ));
  const derivedViolationCodes = findings.map(({ code }) => code);
  const violationCodes = ordinaryArray(
    proof.violationCodes!,
    `${label}.violationCodes`
  ).map((value, index) => ordinaryString(
    value,
    `${label}.violationCodes[${index}]`
  ));
  if (violationCodes.length !== derivedViolationCodes.length ||
    violationCodes.some((code, index) => code !== derivedViolationCodes[index])) {
    throw new Error(`${label}.violationCodes is not mechanically derived from violations.`);
  }
  return deepFreezeOwned({
    scenarioId,
    moduleScope: ordinaryString(proof.moduleScope, `${label}.moduleScope`),
    commandOwnerModuleId: ordinaryString(
      proof.commandOwnerModuleId,
      `${label}.commandOwnerModuleId`
    ),
    boundedOwnerModuleId: ordinaryString(
      proof.boundedOwnerModuleId,
      `${label}.boundedOwnerModuleId`
    ),
    processOwnerModuleId: ordinaryString(
      proof.processOwnerModuleId,
      `${label}.processOwnerModuleId`
    ),
    policyOwnerModuleIds: ordinaryArray(
      proof.policyOwnerModuleIds!,
      `${label}.policyOwnerModuleIds`
    ).map((value, index) => ordinaryString(
      value,
      `${label}.policyOwnerModuleIds[${index}]`
    )),
    violations: findings,
    violationCodes: derivedViolationCodes
  });
}

export function canonicalDevRunnerScenarioProjection(
  suite: DevRunnerAuthorityProofSuite,
  scenarioOrder: readonly string[]
): readonly string[] {
  const snapshotSuite = {
    ...suite,
    scenarioProofsById: Object.fromEntries(
      [...suite.scenarioProofsById.entries()].map(([scenarioId, proof]) => [
        scenarioId,
        proof
      ] as const)
    )
  };
  const ownedSuite = deepFreezeOwned(snapshotOrdinaryData(
    snapshotSuite,
    'canonical scenario projection suite',
    STRICT_JSON_SNAPSHOT_OPTIONS
  ));
  const suiteRecord = ordinaryRecord(ownedSuite, 'canonical scenario projection suite');
  assertExactOrdinaryKeys(suiteRecord, [
    'inventory',
    'scenarioIds',
    'moduleIds',
    'moduleOwners',
    'moduleEdges',
    'scenarioProofs',
    'scenarioProofsById',
    'finiteProof',
    'counters',
    'bounds',
    'canonicalBytes'
  ], 'canonical scenario projection suite');
  const scenarioIds = ordinaryArray(
    suiteRecord.scenarioIds!,
    'canonical scenario projection suite.scenarioIds'
  ).map((value, index) => ordinaryString(
    value,
    `canonical scenario projection suite.scenarioIds[${index}]`
  ));
  if (new Set(scenarioIds).size !== scenarioIds.length) {
    throw new Error('Canonical scenario projection suite contains duplicate ScenarioPartition IDs.');
  }
  const scenarioIdSet = new Set(scenarioIds);
  const proofsById = ordinaryRecord(
    suiteRecord.scenarioProofsById!,
    'canonical scenario projection suite.scenarioProofsById'
  );
  assertExactOrdinaryKeys(
    proofsById,
    scenarioIds,
    'canonical scenario projection suite.scenarioProofsById'
  );
  const ownedProofsById = new Map<string, DevRunnerAuthorityScenarioProof>();
  for (const scenarioId of scenarioIds) {
    ownedProofsById.set(scenarioId, snapshotScenarioProofForProjection(
      proofsById[scenarioId]!,
      scenarioId,
      `canonical scenario projection suite.scenarioProofsById.${scenarioId}`
    ));
  }
  const proofArrayIds = new Set<string>();
  for (const [index, candidateProof] of ordinaryArray(
    suiteRecord.scenarioProofs!,
    'canonical scenario projection suite.scenarioProofs'
  ).entries()) {
    const proofRecord = ordinaryRecord(
      candidateProof,
      `canonical scenario projection suite.scenarioProofs[${index}]`
    );
    const scenarioId = ordinaryString(
      proofRecord.scenarioId,
      `canonical scenario projection suite.scenarioProofs[${index}].scenarioId`
    );
    if (!scenarioIdSet.has(scenarioId) || proofArrayIds.has(scenarioId)) {
      throw new Error(`Canonical scenario projection has invalid proof ${scenarioId}.`);
    }
    proofArrayIds.add(scenarioId);
    const arrayProof = snapshotScenarioProofForProjection(
      candidateProof,
      scenarioId,
      `canonical scenario projection suite.scenarioProofs[${index}]`
    );
    if (canonicalSnapshotBytes(arrayProof, 'canonical array scenario proof') !==
      canonicalSnapshotBytes(ownedProofsById.get(scenarioId), 'canonical indexed scenario proof')) {
      throw new Error(`Canonical scenario proof outputs disagree for ${scenarioId}.`);
    }
  }
  if (proofArrayIds.size !== scenarioIds.length) {
    throw new Error('Canonical scenario projection omits a scenario proof.');
  }
  const order = ordinaryArray(snapshotOrdinaryData(
    scenarioOrder,
    'canonical scenario order',
    STRICT_JSON_SNAPSHOT_OPTIONS
  ), 'canonical scenario order').map((value, index) => ordinaryString(
    value,
    `canonical scenario order[${index}]`
  ));
  if (new Set(order).size !== order.length) {
    throw new Error('Canonical scenario order contains duplicate ScenarioPartition IDs.');
  }
  return order.map((scenarioId) => {
    const proof = ownedProofsById.get(scenarioId);
    if (!proof) throw new Error(`Unknown Program proof scenario ${scenarioId}.`);
    return canonicalSnapshotBytes(proof, `canonical scenario proof ${scenarioId}`);
  }).sort(compareCanonicalText);
}
