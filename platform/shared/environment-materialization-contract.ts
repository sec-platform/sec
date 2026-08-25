import { sha256 } from './canonical-primitives.ts';

export const ENVIRONMENT_MATERIALIZATION_SPEC_SCHEMA_V1 =
  'sec-environment-materialization-spec-v1' as const;
export const ENVIRONMENT_MATERIALIZATION_PLAN_SCHEMA_V1 =
  'sec-environment-materialization-plan-v1' as const;
export const ENVIRONMENT_MATERIALIZATION_GENERATION_SCHEMA_V1 =
  'sec-environment-materialization-generation-v1' as const;

export interface EnvironmentMaterializationComponentV1 {
  readonly id: string;
  readonly version: string;
  readonly sourceDigest: `sha256:${string}`;
}

export interface EnvironmentMaterializationSpecV1 {
  readonly schema: typeof ENVIRONMENT_MATERIALIZATION_SPEC_SCHEMA_V1;
  readonly imageName: string;
  readonly acceptedImageDigest: `sha256:${string}`;
  readonly platform: 'linux/amd64';
  readonly sourcePolicyRevision: string;
  readonly providerRequirement: string;
  readonly components: readonly EnvironmentMaterializationComponentV1[];
  readonly specDigest: `sha256:${string}`;
}

export interface EnvironmentMaterializationObservationV1 {
  readonly localTag: 'absent' | 'matching' | 'mismatched';
  readonly localImageDigest: `sha256:${string}` | null;
  /** Exact provider-owned artifact closure available without network access. */
  readonly offlineArtifact: 'absent' | 'matching' | 'mismatched';
  readonly immutableBuildInputs: 'available' | 'missing' | 'unresolved';
  readonly providerCapability: 'available' | 'unavailable' | 'unresolved';
  /** Remote acquisition is intentionally distinct from a local projection
   * provider.  When omitted the v1 provider capability is used. */
  readonly remoteAcquisition?: 'available' | 'unavailable' | 'unresolved';
}

export interface EnvironmentMaterializationPlanV1 {
  readonly schema: typeof ENVIRONMENT_MATERIALIZATION_PLAN_SCHEMA_V1;
  readonly specDigest: `sha256:${string}`;
  readonly disposition: 'reuse-local' | 'restore-local' | 'materialize' | 'blocked';
  readonly phase?: 'local-exact' | 'offline-exact' | 'remote-missing' | 'blocked';
  readonly reason:
    | 'exact-local-image'
    | 'exact-local-image-missing-artifact'
    | 'exact-build-inputs-and-provider'
    | 'local-tag-digest-conflict'
    | 'immutable-build-inputs-missing'
    | 'immutable-build-inputs-unresolved'
    | 'provider-unavailable'
    | 'provider-unresolved'
    | 'exact-offline-artifact'
    | 'offline-artifact-digest-conflict'
    | 'remote-acquisition-unavailable'
    | 'remote-acquisition-unresolved';
  readonly missingComponents?: readonly string[];
  readonly planDigest: `sha256:${string}`;
}

/**
 * Durable identity and lifecycle for one provider-owned materialization.
 *
 * The generation is deliberately owned by this contract rather than by a
 * cache implementation.  A provider may store the record beside its bytes,
 * but it cannot publish externally visible bytes before the provisioning
 * record exists.  `generationDigest` is the stable identity of the owner and
 * input closure; `lifecycleDigest` covers the replaceable lifecycle pointer.
 * Keeping those two digests separate lets crash recovery advance
 * provisioning -> published -> terminal without manufacturing a second
 * materialization identity or retaining an unbounded receipt history.
 */
export type EnvironmentMaterializationGenerationPhaseV1 =
  'provisioning' | 'published' | 'terminal' | 'gc-pending';
export type EnvironmentMaterializationGenerationRetentionV1 =
  'provider-current' | 'provider-terminal' | 'gc-pending';

/**
 * The only retention class admissible for each generation phase.  Keep this
 * relation separate from the phase transition relation: a transition may
 * advance lifecycle state, but it may never manufacture a new retention
 * interpretation for a phase.
 */
export const ENVIRONMENT_MATERIALIZATION_GENERATION_RETENTION_BY_PHASE_V1:
  Readonly<Record<EnvironmentMaterializationGenerationPhaseV1,
    EnvironmentMaterializationGenerationRetentionV1>> = Object.freeze({
      provisioning: 'provider-current',
      published: 'provider-current',
      terminal: 'provider-terminal',
      'gc-pending': 'gc-pending'
    });

/**
 * Canonical lifecycle adjacency for one generation.  Self edges are
 * intentional idempotent re-publication/reconciliation edges; they do not
 * authorize a new physical effect.  A generation can only move forward from
 * active phases and can return from gc-pending to terminal after a cleanup
 * retry proves the provider is terminal.  No edge may return to provisioning
 * or published once the generation has left that phase.
 */
export const ENVIRONMENT_MATERIALIZATION_GENERATION_PHASE_ADJACENCY_V1:
  Readonly<Record<EnvironmentMaterializationGenerationPhaseV1,
    readonly EnvironmentMaterializationGenerationPhaseV1[]>> = Object.freeze({
      provisioning: Object.freeze([
        'provisioning', 'published', 'terminal'
      ] as readonly EnvironmentMaterializationGenerationPhaseV1[]),
      published: Object.freeze([
        'published', 'terminal'
      ] as readonly EnvironmentMaterializationGenerationPhaseV1[]),
      terminal: Object.freeze([
        'terminal', 'gc-pending'
      ] as readonly EnvironmentMaterializationGenerationPhaseV1[]),
      'gc-pending': Object.freeze([
        'terminal', 'gc-pending'
      ] as readonly EnvironmentMaterializationGenerationPhaseV1[])
    });

export interface EnvironmentMaterializationGenerationV1 {
  readonly schema: typeof ENVIRONMENT_MATERIALIZATION_GENERATION_SCHEMA_V1;
  readonly specDigest: `sha256:${string}`;
  readonly generation: number;
  readonly providerRef: string;
  readonly providerObjectSha: string;
  readonly providerDigest: `sha256:${string}`;
  readonly providerGeneration: number;
  readonly leaseId: `sha256:${string}`;
  readonly phase: EnvironmentMaterializationGenerationPhaseV1;
  readonly retention: EnvironmentMaterializationGenerationRetentionV1;
  readonly terminalObligation: 'provider-absent-and-consumer-zero';
  readonly receiptDigest: `sha256:${string}` | null;
  readonly createdAt: string;
  readonly terminalAt: string | null;
  readonly generationDigest: `sha256:${string}`;
  readonly lifecycleDigest: `sha256:${string}`;
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

function parseJsonOrValue(input: unknown, label: string): unknown {
  if (typeof input !== 'string') return input;
  try {
    return JSON.parse(input) as unknown;
  } catch {
    fail(`${label} is not valid JSON`);
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(`${label} keys are invalid`);
  }
}

function canonicalDigest(value: unknown, label: string): `sha256:${string}` {
  return digest(value, label);
}

const MATERIALIZATION_GENERATION_PHASES = new Set<EnvironmentMaterializationGenerationPhaseV1>([
  'provisioning', 'published', 'terminal', 'gc-pending'
]);
const MATERIALIZATION_GENERATION_RETENTIONS = new Set<EnvironmentMaterializationGenerationRetentionV1>([
  'provider-current', 'provider-terminal', 'gc-pending'
]);

function generationProviderText(value: unknown, label: string): string {
  const text = bounded(value, label, 256);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u.test(text)) {
    fail(`${label} contains an invalid provider identity`);
  }
  return text;
}

function canonicalTime(value: unknown, label: string): string {
  if (typeof value !== 'string') fail(`${label} must be canonical ISO time`);
  const parsed = new Date(value).toISOString();
  if (parsed !== value) fail(`${label} must be canonical ISO time`);
  return value;
}

function generationStableMaterialV1(
  input: Pick<EnvironmentMaterializationGenerationV1,
    'schema' | 'specDigest' | 'generation' | 'providerRef' | 'providerObjectSha'
      | 'providerDigest' | 'providerGeneration' | 'leaseId' | 'terminalObligation' | 'createdAt'>
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    schema: input.schema,
    specDigest: input.specDigest,
    generation: input.generation,
    providerRef: input.providerRef,
    providerObjectSha: input.providerObjectSha,
    providerDigest: input.providerDigest,
    providerGeneration: input.providerGeneration,
    leaseId: input.leaseId,
    terminalObligation: input.terminalObligation,
    createdAt: input.createdAt
  });
}

function assertGenerationSemanticsV1(
  phase: EnvironmentMaterializationGenerationPhaseV1,
  retention: EnvironmentMaterializationGenerationRetentionV1,
  receiptDigest: `sha256:${string}` | null,
  terminalAt: string | null
): void {
  const expectedRetention = ENVIRONMENT_MATERIALIZATION_GENERATION_RETENTION_BY_PHASE_V1[phase];
  if (retention !== expectedRetention) {
    fail(`materialization generation phase ${phase} requires ${expectedRetention} retention`);
  }
  const current = phase === 'provisioning' || phase === 'published';
  const terminal = phase === 'terminal' || phase === 'gc-pending';
  if (phase === 'provisioning' && receiptDigest !== null) {
    fail('materialization generation provisioning phase cannot publish a receipt');
  }
  if (phase === 'published' && receiptDigest === null) {
    fail('materialization generation published phase requires a receipt');
  }
  if (phase !== 'provisioning' && receiptDigest !== null
      && !/^sha256:[0-9a-f]{64}$/u.test(receiptDigest)) {
    fail('materialization generation receipt digest is invalid');
  }
  if (terminal && terminalAt === null) {
    fail('materialization generation terminal phase requires terminalAt');
  }
  if (current && terminalAt !== null) {
    fail('materialization generation current phase cannot carry terminalAt');
  }
}

function assertGenerationPhaseTransitionV1(
  current: EnvironmentMaterializationGenerationPhaseV1,
  next: EnvironmentMaterializationGenerationPhaseV1
): void {
  const allowed = ENVIRONMENT_MATERIALIZATION_GENERATION_PHASE_ADJACENCY_V1[current];
  if (!allowed.includes(next)) {
    fail(`materialization generation phase transition ${current}->${next} is invalid`);
  }
}

export function createEnvironmentMaterializationGenerationV1(
  input: Omit<EnvironmentMaterializationGenerationV1,
    'schema' | 'generationDigest' | 'lifecycleDigest'>
): EnvironmentMaterializationGenerationV1 {
  const specDigest = digest(input.specDigest, 'materialization generation specDigest');
  if (!Number.isSafeInteger(input.generation) || input.generation < 0) {
    fail('materialization generation generation is invalid');
  }
  const providerRef = generationProviderText(input.providerRef, 'materialization generation providerRef');
  const providerObjectSha = bounded(input.providerObjectSha, 'materialization generation providerObjectSha', 128);
  if (!/^[0-9a-f]{40}$/u.test(providerObjectSha)) {
    fail('materialization generation providerObjectSha is invalid');
  }
  const providerDigest = digest(input.providerDigest, 'materialization generation providerDigest');
  if (!Number.isSafeInteger(input.providerGeneration) || input.providerGeneration < 0) {
    fail('materialization generation providerGeneration is invalid');
  }
  const leaseId = digest(input.leaseId, 'materialization generation leaseId');
  if (input.terminalObligation !== 'provider-absent-and-consumer-zero') {
    fail('materialization generation terminal obligation is invalid');
  }
  const createdAt = canonicalTime(input.createdAt, 'materialization generation createdAt');
  const phase = input.phase;
  const retention = input.retention;
  if (!MATERIALIZATION_GENERATION_PHASES.has(phase)) {
    fail('materialization generation phase is invalid');
  }
  if (!MATERIALIZATION_GENERATION_RETENTIONS.has(retention)) {
    fail('materialization generation retention is invalid');
  }
  const receiptDigest = input.receiptDigest === null
    ? null
    : digest(input.receiptDigest, 'materialization generation receiptDigest');
  const terminalAt = input.terminalAt === null
    ? null
    : canonicalTime(input.terminalAt, 'materialization generation terminalAt');
  assertGenerationSemanticsV1(phase, retention, receiptDigest, terminalAt);
  const stable = generationStableMaterialV1({
    schema: ENVIRONMENT_MATERIALIZATION_GENERATION_SCHEMA_V1,
    specDigest,
    generation: input.generation,
    providerRef,
    providerObjectSha,
    providerDigest,
    providerGeneration: input.providerGeneration,
    leaseId,
    terminalObligation: input.terminalObligation,
    createdAt
  });
  const body: Omit<EnvironmentMaterializationGenerationV1,
    'generationDigest' | 'lifecycleDigest'> = Object.freeze({
    schema: ENVIRONMENT_MATERIALIZATION_GENERATION_SCHEMA_V1,
    specDigest,
    generation: input.generation,
    providerRef,
    providerObjectSha,
    providerDigest,
    providerGeneration: input.providerGeneration,
    leaseId,
    terminalObligation: input.terminalObligation,
    createdAt,
    phase,
    retention,
    receiptDigest,
    terminalAt
  });
  return Object.freeze({
    ...body,
    generationDigest: sha256(stable) as `sha256:${string}`,
    lifecycleDigest: sha256(body) as `sha256:${string}`
  });
}

export function transitionEnvironmentMaterializationGenerationV1(input: Readonly<{
  current: EnvironmentMaterializationGenerationV1;
  phase: EnvironmentMaterializationGenerationPhaseV1;
  retention: EnvironmentMaterializationGenerationRetentionV1;
  receiptDigest: `sha256:${string}` | null;
  terminalAt: string | null;
}>): EnvironmentMaterializationGenerationV1 {
  const current = parseEnvironmentMaterializationGenerationV1(input.current);
  assertGenerationPhaseTransitionV1(current.phase, input.phase);
  const next = createEnvironmentMaterializationGenerationV1({
    specDigest: current.specDigest,
    generation: current.generation,
    providerRef: current.providerRef,
    providerObjectSha: current.providerObjectSha,
    providerDigest: current.providerDigest,
    providerGeneration: current.providerGeneration,
    leaseId: current.leaseId,
    phase: input.phase,
    retention: input.retention,
    terminalObligation: current.terminalObligation,
    receiptDigest: input.receiptDigest,
    createdAt: current.createdAt,
    terminalAt: input.terminalAt
  });
  if (next.generationDigest !== current.generationDigest) {
    fail('materialization generation transition changed stable identity');
  }
  return next;
}

export function parseEnvironmentMaterializationGenerationV1(
  input: unknown
): EnvironmentMaterializationGenerationV1 {
  const value = record(parseJsonOrValue(input, 'environment materialization generation'),
    'environment materialization generation');
  exactKeys(value, [
    'schema', 'specDigest', 'generation', 'providerRef', 'providerObjectSha', 'providerDigest',
    'providerGeneration', 'leaseId', 'phase', 'retention', 'terminalObligation', 'receiptDigest',
    'createdAt', 'terminalAt', 'generationDigest', 'lifecycleDigest'
  ], 'environment materialization generation');
  if (value.schema !== ENVIRONMENT_MATERIALIZATION_GENERATION_SCHEMA_V1) {
    fail('environment materialization generation schema is invalid');
  }
  const generation = createEnvironmentMaterializationGenerationV1({
    specDigest: value.specDigest as `sha256:${string}`,
    generation: value.generation as number,
    providerRef: value.providerRef as string,
    providerObjectSha: value.providerObjectSha as string,
    providerDigest: value.providerDigest as `sha256:${string}`,
    providerGeneration: value.providerGeneration as number,
    leaseId: value.leaseId as `sha256:${string}`,
    phase: value.phase as EnvironmentMaterializationGenerationPhaseV1,
    retention: value.retention as EnvironmentMaterializationGenerationRetentionV1,
    terminalObligation: value.terminalObligation as 'provider-absent-and-consumer-zero',
    receiptDigest: value.receiptDigest === null ? null : value.receiptDigest as `sha256:${string}`,
    createdAt: value.createdAt as string,
    terminalAt: value.terminalAt === null ? null : value.terminalAt as string
  });
  if (generation.generationDigest !== value.generationDigest
      || generation.lifecycleDigest !== value.lifecycleDigest) {
    fail('environment materialization generation digest mismatch');
  }
  return generation;
}

const MATERIALIZATION_DISPOSITIONS = new Set<EnvironmentMaterializationPlanV1['disposition']>([
  'reuse-local', 'restore-local', 'materialize', 'blocked'
]);
const MATERIALIZATION_PHASES = new Set<NonNullable<EnvironmentMaterializationPlanV1['phase']>>([
  'local-exact', 'offline-exact', 'remote-missing', 'blocked'
]);
const MATERIALIZATION_REASONS = new Set<EnvironmentMaterializationPlanV1['reason']>([
  'exact-local-image', 'exact-local-image-missing-artifact',
  'exact-build-inputs-and-provider',
  'local-tag-digest-conflict',
  'immutable-build-inputs-missing', 'immutable-build-inputs-unresolved',
  'provider-unavailable', 'provider-unresolved', 'exact-offline-artifact',
  'offline-artifact-digest-conflict', 'remote-acquisition-unavailable',
  'remote-acquisition-unresolved'
]);
const LOCAL_OBSERVATIONS = new Set(['absent', 'matching', 'mismatched']);
const AVAILABILITY_OBSERVATIONS = new Set(['available', 'missing', 'unresolved']);
const PROVIDER_OBSERVATIONS = new Set(['available', 'unavailable', 'unresolved']);

function assertMaterializationPlanSemanticsV1(
  disposition: EnvironmentMaterializationPlanV1['disposition'],
  reason: EnvironmentMaterializationPlanV1['reason'],
  phase: EnvironmentMaterializationPlanV1['phase'] | undefined
): void {
  if (phase === undefined) return;
  const expected =
    reason === 'exact-local-image'
      ? { disposition: 'reuse-local', phase: 'local-exact' }
      : reason === 'exact-offline-artifact'
        ? { disposition: 'restore-local', phase: 'offline-exact' }
        : reason === 'exact-build-inputs-and-provider' || reason === 'exact-local-image-missing-artifact'
          ? { disposition: 'materialize', phase: 'remote-missing' }
          : { disposition: 'blocked', phase: 'blocked' };
  if (disposition !== expected.disposition || phase !== expected.phase) {
    fail('environment materialization plan semantic binding is invalid');
  }
}

export function createEnvironmentMaterializationSpecV1(input: Readonly<{
  imageName: string;
  acceptedImageDigest: string;
  sourcePolicyRevision: string;
  providerRequirement: string;
  components: readonly EnvironmentMaterializationComponentV1[];
}>): EnvironmentMaterializationSpecV1 {
  const components = input.components.map((component, index) => Object.freeze({
    id: bounded(component.id, `components[${index}].id`, 128),
    version: bounded(component.version, `components[${index}].version`, 128),
    sourceDigest: digest(component.sourceDigest, `components[${index}].sourceDigest`)
  })).sort((left, right) => left.id.localeCompare(right.id, 'en-US'));
  if (components.length === 0 || new Set(components.map(({ id }) => id)).size !== components.length) {
    fail('components must contain unique identities');
  }
  const body = Object.freeze({
    schema: ENVIRONMENT_MATERIALIZATION_SPEC_SCHEMA_V1,
    imageName: bounded(input.imageName, 'imageName'),
    acceptedImageDigest: digest(input.acceptedImageDigest, 'acceptedImageDigest'),
    platform: 'linux/amd64' as const,
    sourcePolicyRevision: bounded(input.sourcePolicyRevision, 'sourcePolicyRevision'),
    providerRequirement: bounded(input.providerRequirement, 'providerRequirement'),
    components: Object.freeze(components)
  });
  return Object.freeze({ ...body, specDigest: materializationDigest(body) });
}

/**
 * Canonical untrusted-input parser for the EnvironmentSpec owner.  Consumers
 * must use this parser instead of reconstructing a partial spec schema in a
 * downstream planner.
 */
export function parseEnvironmentMaterializationSpecV1(
  input: unknown
): EnvironmentMaterializationSpecV1 {
  const value = record(parseJsonOrValue(input, 'environment materialization spec'),
    'environment materialization spec');
  exactKeys(value, [
    'schema', 'imageName', 'acceptedImageDigest', 'platform', 'sourcePolicyRevision',
    'providerRequirement', 'components', 'specDigest'
  ], 'environment materialization spec');
  if (value.schema !== ENVIRONMENT_MATERIALIZATION_SPEC_SCHEMA_V1
      || value.platform !== 'linux/amd64') {
    fail('environment materialization spec schema or platform is invalid');
  }
  if (!Array.isArray(value.components)) fail('environment materialization spec components are invalid');
  const components = value.components.map((candidate, index) => {
    const component = record(candidate, `environment materialization spec components[${index}]`);
    exactKeys(component, ['id', 'version', 'sourceDigest'],
      `environment materialization spec components[${index}]`);
    return {
      id: component.id as string,
      version: component.version as string,
      sourceDigest: component.sourceDigest as `sha256:${string}`
    };
  });
  const recreated = createEnvironmentMaterializationSpecV1({
    imageName: value.imageName as string,
    acceptedImageDigest: value.acceptedImageDigest as string,
    sourcePolicyRevision: value.sourcePolicyRevision as string,
    providerRequirement: value.providerRequirement as string,
    components
  });
  if (recreated.specDigest !== value.specDigest) {
    fail('environment materialization spec digest mismatch');
  }
  return recreated;
}

/** Canonical untrusted-input parser owned by the Environment observation owner. */
export function parseEnvironmentMaterializationObservationV1(
  input: unknown
): EnvironmentMaterializationObservationV1 {
  const value = record(parseJsonOrValue(input, 'environment materialization observation'),
    'environment materialization observation');
  const required = [
    'immutableBuildInputs', 'localImageDigest', 'localTag', 'offlineArtifact', 'providerCapability'
  ];
  const allowed = new Set([...required, 'remoteAcquisition']);
  if (required.some((key) => !Object.hasOwn(value, key)) ||
      Object.keys(value).some((key) => !allowed.has(key)) ||
      (Object.hasOwn(value, 'remoteAcquisition') && value.remoteAcquisition === undefined)) {
    fail('environment materialization observation keys are invalid');
  }
  if (!LOCAL_OBSERVATIONS.has(String(value.localTag)) ||
      !LOCAL_OBSERVATIONS.has(String(value.offlineArtifact)) ||
      !AVAILABILITY_OBSERVATIONS.has(String(value.immutableBuildInputs)) ||
      !PROVIDER_OBSERVATIONS.has(String(value.providerCapability)) ||
      (value.remoteAcquisition !== undefined && !PROVIDER_OBSERVATIONS.has(String(value.remoteAcquisition)))) {
    fail('environment materialization observation contains an invalid enum');
  }
  const localImageDigest = value.localImageDigest === null
    ? null
    : digest(value.localImageDigest, 'localImageDigest');
  if ((value.localTag === 'absent') !== (localImageDigest === null)) {
    fail('local tag and image digest presence disagree');
  }
  return Object.freeze({
    localTag: value.localTag as EnvironmentMaterializationObservationV1['localTag'],
    localImageDigest,
    offlineArtifact: value.offlineArtifact as EnvironmentMaterializationObservationV1['offlineArtifact'],
    immutableBuildInputs:
      value.immutableBuildInputs as EnvironmentMaterializationObservationV1['immutableBuildInputs'],
    providerCapability: value.providerCapability as EnvironmentMaterializationObservationV1['providerCapability'],
    ...(value.remoteAcquisition === undefined ? {} : {
      remoteAcquisition:
        value.remoteAcquisition as NonNullable<EnvironmentMaterializationObservationV1['remoteAcquisition']>
    })
  });
}

export function compileEnvironmentMaterializationPlanV1(input: Readonly<{
  spec: EnvironmentMaterializationSpecV1;
  observation: EnvironmentMaterializationObservationV1;
}>): EnvironmentMaterializationPlanV1 {
  const spec = parseEnvironmentMaterializationSpecV1(input.spec);
  const observation = parseEnvironmentMaterializationObservationV1(input.observation);
  if (createEnvironmentMaterializationSpecV1(spec).specDigest !== spec.specDigest) {
    fail('spec digest is invalid');
  }
  let disposition: EnvironmentMaterializationPlanV1['disposition'];
  let reason: EnvironmentMaterializationPlanV1['reason'];
  let phase: NonNullable<EnvironmentMaterializationPlanV1['phase']>;
  const offlineArtifact = observation.offlineArtifact;
  const remoteAcquisition = observation.remoteAcquisition ?? observation.providerCapability;
  if (observation.localTag === 'matching') {
    if (observation.localImageDigest !== spec.acceptedImageDigest) {
      fail('matching local observation does not bind the accepted image digest');
    }
  } else if (observation.localTag === 'mismatched') {
    if (observation.localImageDigest === null
        || observation.localImageDigest === spec.acceptedImageDigest) {
      fail('mismatched local observation is invalid');
    }
  } else if (observation.localImageDigest !== null) {
    fail('absent local tag cannot carry an image digest');
  }
  if (observation.localTag === 'mismatched') {
    disposition = 'blocked';
    reason = 'local-tag-digest-conflict';
    phase = 'blocked';
  } else if (offlineArtifact === 'mismatched') {
    disposition = 'blocked';
    reason = 'offline-artifact-digest-conflict';
    phase = 'blocked';
  } else if (observation.localTag === 'matching' && offlineArtifact === 'matching') {
    // A warm local projection is reusable only when its provider-owned OCI
    // artifact and receipt are also exact.  Image identity alone cannot stand
    // in for the offline/recovery closure consumed by later lifecycle stages.
    disposition = 'reuse-local';
    reason = 'exact-local-image';
    phase = 'local-exact';
  } else if (offlineArtifact === 'matching') {
    // An exact offline generation is already a complete build closure.  A
    // remote acquisition capability must never be required merely to restore
    // it; the local projection provider, if needed, is a separate effect.
    disposition = 'restore-local';
    reason = 'exact-offline-artifact';
    phase = 'offline-exact';
  } else if (observation.immutableBuildInputs !== 'available') {
    disposition = 'blocked';
    reason = observation.immutableBuildInputs === 'missing'
      ? 'immutable-build-inputs-missing'
      : 'immutable-build-inputs-unresolved';
    phase = 'blocked';
  } else if (remoteAcquisition !== 'available') {
    disposition = 'blocked';
    reason = remoteAcquisition === 'unavailable'
      ? (observation.remoteAcquisition === undefined ? 'provider-unavailable' : 'remote-acquisition-unavailable')
      : (observation.remoteAcquisition === undefined ? 'provider-unresolved' : 'remote-acquisition-unresolved');
    phase = 'blocked';
  } else {
    disposition = 'materialize';
    reason = observation.localTag === 'matching'
      ? 'exact-local-image-missing-artifact'
      : 'exact-build-inputs-and-provider';
    phase = 'remote-missing';
  }
  const body = Object.freeze({
    schema: ENVIRONMENT_MATERIALIZATION_PLAN_SCHEMA_V1,
    specDigest: spec.specDigest,
    disposition,
    reason,
    phase
  });
  return Object.freeze({ ...body, planDigest: materializationDigest(body) });
}

/**
 * Canonical parser for the public materialization decision.  It accepts the
 * legacy v1 shape without `phase`/`missingComponents` for read compatibility,
 * but always validates the exact digest of the bytes it received.
 */
export function parseEnvironmentMaterializationPlanV1(
  input: unknown
): EnvironmentMaterializationPlanV1 {
  const value = record(parseJsonOrValue(input, 'environment materialization plan'),
    'environment materialization plan');
  const allowedKeys = new Set([
    'schema', 'specDigest', 'disposition', 'phase', 'reason', 'missingComponents', 'planDigest'
  ]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    fail('environment materialization plan keys are invalid');
  }
  for (const required of ['schema', 'specDigest', 'disposition', 'reason', 'planDigest']) {
    if (!Object.prototype.hasOwnProperty.call(value, required)) {
      fail(`environment materialization plan is missing ${required}`);
    }
  }
  if (value.schema !== ENVIRONMENT_MATERIALIZATION_PLAN_SCHEMA_V1
      || !MATERIALIZATION_DISPOSITIONS.has(value.disposition as EnvironmentMaterializationPlanV1['disposition'])
      || !MATERIALIZATION_REASONS.has(value.reason as EnvironmentMaterializationPlanV1['reason'])) {
    fail('environment materialization plan identity is invalid');
  }
  const specDigest = canonicalDigest(value.specDigest, 'environment materialization plan specDigest');
  const planDigest = canonicalDigest(value.planDigest, 'environment materialization plan planDigest');
  let phase: EnvironmentMaterializationPlanV1['phase'];
  if (value.phase !== undefined) {
    if (!MATERIALIZATION_PHASES.has(value.phase as NonNullable<EnvironmentMaterializationPlanV1['phase']>)) {
      fail('environment materialization plan phase is invalid');
    }
    phase = value.phase as NonNullable<EnvironmentMaterializationPlanV1['phase']>;
  }
  let missingComponents: readonly string[] | undefined;
  if (value.missingComponents !== undefined) {
    if (!Array.isArray(value.missingComponents)) {
      fail('environment materialization plan missingComponents is invalid');
    }
    const entries = value.missingComponents.map((entry, index) =>
      bounded(entry, `environment materialization plan missingComponents[${index}]`, 128)
    );
    const sorted = [...entries].sort((left, right) => left.localeCompare(right, 'en-US'));
    if (entries.length !== new Set(entries).size
        || entries.some((entry, index) => entry !== sorted[index])) {
      fail('environment materialization plan missingComponents are not canonical');
    }
    missingComponents = Object.freeze(entries);
  }
  assertMaterializationPlanSemanticsV1(
    value.disposition as EnvironmentMaterializationPlanV1['disposition'],
    value.reason as EnvironmentMaterializationPlanV1['reason'],
    phase
  );
  const body: Record<string, unknown> = {
    schema: ENVIRONMENT_MATERIALIZATION_PLAN_SCHEMA_V1,
    specDigest,
    disposition: value.disposition,
    reason: value.reason
  };
  if (phase !== undefined) body.phase = phase;
  if (missingComponents !== undefined) body.missingComponents = missingComponents;
  const expectedDigest = materializationDigest(Object.freeze(body));
  if (expectedDigest !== planDigest) fail('environment materialization plan digest mismatch');
  return Object.freeze({
    ...body,
    planDigest
  }) as EnvironmentMaterializationPlanV1;
}

/*
 * Dependency materialization is a projection of the environment owner, not a
 * second installer or a cache-specific source of truth.  The closure below
 * binds the exact EnvironmentSpec identity, lock/toolchain authority and
 * provider revision before a provider is allowed to publish an archive.
 * Physical paths are deliberately absent from these records: a path is only
 * a transport locator, while the exact closure digest is the cache identity.
 * Mutable provider epochs belong to provider current/settlement state and may
 * never split one immutable dependency closure into caller-selected cache keys.
 */
export const ENVIRONMENT_DEPENDENCY_CLOSURE_SCHEMA_V1 =
  'sec-environment-dependency-closure-v1' as const;
export const ENVIRONMENT_DEPENDENCY_CACHE_IDENTITY_SCHEMA_V1 =
  'sec-environment-dependency-cache-identity-v1' as const;
export const ENVIRONMENT_DEPENDENCY_CACHE_HANDLE_SCHEMA_V1 =
  'sec-environment-dependency-cache-handle-v1' as const;
export const ENVIRONMENT_DEPENDENCY_CACHE_STATE_SCHEMA_V2 =
  'sec-environment-dependency-cache-state-v2' as const;
export const ENVIRONMENT_DEPENDENCY_CACHE_SETTLEMENT_SCHEMA_V2 =
  'sec-environment-dependency-cache-settlement-v2' as const;
export const ENVIRONMENT_DEPENDENCY_CACHE_PHYSICAL_RECEIPT_SCHEMA_V2 =
  'sec-environment-dependency-cache-physical-receipt-v2' as const;

export type EnvironmentDependencyCachePhaseV2 =
  | 'registered'
  | 'materializing'
  | 'published'
  | 'terminal'
  | 'gc-pending'
  | 'physical-clean';

export interface EnvironmentDependencyCacheConsumerV2 {
  readonly consumerId: string;
  readonly acquireCredentialDigest: `sha256:${string}`;
  readonly ownerHost: string;
  readonly ownerBootId: string;
  readonly ownerPid: number;
  readonly ownerProcessStartTicks: string;
  readonly acquiredAt: string;
  readonly leaseExpiresAt: string;
}

export interface EnvironmentDependencyCacheConsumerRecoveryV2 {
  readonly consumerId: string;
  readonly acquireCredentialDigest: `sha256:${string}`;
  readonly reason: 'host-boot-replaced' | 'process-absent' | 'process-identity-replaced';
  readonly observedAt: string;
  readonly deathProofDigest: `sha256:${string}`;
}

/**
 * The Runtime/Dependency semantic owner's one replaceable current record.
 * Cache bytes and cache-local receipts are projections of this record.  They
 * can never create a resource, select a generation, admit a consumer or prove
 * cleanup.  `previousStateDigest` makes every durable replacement an exact
 * CAS transition and lets recovery distinguish never-started from crashed.
 */
export interface EnvironmentDependencyCacheStateV2 {
  readonly schema: typeof ENVIRONMENT_DEPENDENCY_CACHE_STATE_SCHEMA_V2;
  readonly resourceId: `sha256:${string}`;
  readonly identityDigest: `sha256:${string}`;
  readonly closureDigest: `sha256:${string}`;
  readonly providerRevision: string;
  readonly phase: EnvironmentDependencyCachePhaseV2;
  readonly transitionEpoch: number;
  readonly ownerLeaseDigest: `sha256:${string}`;
  readonly ownerHost: string;
  readonly ownerBootId: string;
  readonly ownerPid: number;
  readonly ownerProcessStartTicks: string;
  readonly leaseExpiresAt: string;
  readonly archiveDigest: `sha256:${string}` | null;
  readonly archiveBytes: number | null;
  readonly sourceSnapshotDigest: `sha256:${string}` | null;
  readonly archiveProjectionDigest: `sha256:${string}` | null;
  readonly activeConsumers: readonly EnvironmentDependencyCacheConsumerV2[];
  readonly lastConsumerRecovery: EnvironmentDependencyCacheConsumerRecoveryV2 | null;
  readonly retention: Readonly<{
    maxEntries: number;
    maxTotalBytes: number;
  }>;
  readonly terminalObligation: 'current-unbound-consumer-zero-physical-absent';
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly previousStateDigest: `sha256:${string}` | null;
  readonly stateDigest: `sha256:${string}`;
}

export interface EnvironmentDependencyCacheSettlementV2 {
  readonly schema: typeof ENVIRONMENT_DEPENDENCY_CACHE_SETTLEMENT_SCHEMA_V2;
  readonly resourceId: `sha256:${string}`;
  readonly identityDigest: `sha256:${string}`;
  readonly finalStateDigest: `sha256:${string}`;
  readonly archiveDigest: `sha256:${string}`;
  readonly physicalAbsenceDigest: `sha256:${string}`;
  readonly currentUnbound: true;
  readonly consumerZero: true;
  readonly archiveAbsent: true;
  readonly settledAt: string;
  readonly settlementDigest: `sha256:${string}`;
}

export interface EnvironmentDependencyCachePhysicalReceiptV2 {
  readonly schema: typeof ENVIRONMENT_DEPENDENCY_CACHE_PHYSICAL_RECEIPT_SCHEMA_V2;
  readonly resourceId: `sha256:${string}`;
  readonly identityDigest: `sha256:${string}`;
  readonly closureDigest: `sha256:${string}`;
  readonly archiveDigest: `sha256:${string}`;
  readonly archiveBytes: number;
  readonly sourceSnapshotDigest: `sha256:${string}`;
  readonly archiveProjectionDigest: `sha256:${string}`;
  readonly readOnly: true;
  readonly receiptDigest: `sha256:${string}`;
}

export interface EnvironmentDependencyAuthorityEntryV1 {
  readonly path: string;
  readonly bytesDigest: `sha256:${string}`;
}

export interface EnvironmentDependencyClosureV1 {
  readonly schema: typeof ENVIRONMENT_DEPENDENCY_CLOSURE_SCHEMA_V1;
  readonly environmentSpecDigest: `sha256:${string}`;
  readonly lockDigest: `sha256:${string}`;
  readonly toolchainDigest: `sha256:${string}`;
  readonly providerRevision: string;
  readonly platform: 'linux/amd64';
  readonly authority: readonly EnvironmentDependencyAuthorityEntryV1[];
  readonly closureDigest: `sha256:${string}`;
}

export interface EnvironmentDependencyCacheIdentityV1 {
  readonly schema: typeof ENVIRONMENT_DEPENDENCY_CACHE_IDENTITY_SCHEMA_V1;
  readonly closureDigest: `sha256:${string}`;
  readonly identityDigest: `sha256:${string}`;
}

export interface EnvironmentDependencyCacheHandleV1 {
  readonly schema: typeof ENVIRONMENT_DEPENDENCY_CACHE_HANDLE_SCHEMA_V1;
  /** Owner-issued read-only projection of a published/current resource. */
  readonly resourceId: `sha256:${string}`;
  readonly identityDigest: `sha256:${string}`;
  readonly closureDigest: `sha256:${string}`;
  readonly archiveDigest: `sha256:${string}`;
  readonly archiveBytes: number;
  readonly sourceSnapshotDigest: `sha256:${string}`;
  readonly archiveProjectionDigest: `sha256:${string}`;
  readonly readOnly: true;
  readonly state: 'published' | 'terminal' | 'gc-pending';
  readonly transitionEpoch: number;
  readonly consumerId: string | null;
  readonly acquireCredentialDigest: `sha256:${string}` | null;
  readonly releaseCredentialDigest: `sha256:${string}` | null;
  readonly handleDigest: `sha256:${string}`;
}


function dependencyPathV1(value: unknown, label: string): string {
  const text = bounded(value, label, 256);
  if (text.includes('\\') || text.startsWith('/') || text.split('/').some(
    (segment) => segment === '' || segment === '.' || segment === '..'
  )) {
    fail(`${label} must be a canonical relative POSIX path`);
  }
  return text;
}

function dependencyAuthorityV1(
  input: readonly EnvironmentDependencyAuthorityEntryV1[]
): readonly EnvironmentDependencyAuthorityEntryV1[] {
  if (!Array.isArray(input) || input.length === 0) {
    fail('environment dependency authority must not be empty');
  }
  const authority = input.map((entry, index) => Object.freeze({
    path: dependencyPathV1(entry?.path, `environment dependency authority[${index}].path`),
    bytesDigest: digest(entry?.bytesDigest,
      `environment dependency authority[${index}].bytesDigest`)
  }));
  const sorted = [...authority].sort((left, right) => left.path.localeCompare(right.path, 'en-US'));
  if (authority.length !== new Set(authority.map((entry) => entry.path)).size ||
      authority.some((entry, index) => entry.path !== sorted[index]?.path)) {
    fail('environment dependency authority must be sorted and unique');
  }
  return Object.freeze(authority);
}

export function createEnvironmentDependencyClosureV1(input: Readonly<{
  environmentSpecDigest: string;
  lockDigest: string;
  toolchainDigest: string;
  providerRevision: string;
  authority: readonly EnvironmentDependencyAuthorityEntryV1[];
}>): EnvironmentDependencyClosureV1 {
  const environmentSpecDigest = digest(input.environmentSpecDigest,
    'environment dependency environmentSpecDigest');
  const lockDigest = digest(input.lockDigest, 'environment dependency lockDigest');
  const toolchainDigest = digest(input.toolchainDigest, 'environment dependency toolchainDigest');
  const providerRevision = bounded(input.providerRevision,
    'environment dependency providerRevision', 256);
  const authority = dependencyAuthorityV1(input.authority);
  const lock = authority.find((entry) => entry.path === 'bun.lock');
  const toolchain = authority.find((entry) => entry.path === '.bun-version');
  if (lock?.bytesDigest !== lockDigest || toolchain?.bytesDigest !== toolchainDigest) {
    fail('environment dependency lock/toolchain digest is not bound to authority');
  }
  const body = Object.freeze({
    schema: ENVIRONMENT_DEPENDENCY_CLOSURE_SCHEMA_V1,
    environmentSpecDigest,
    lockDigest,
    toolchainDigest,
    providerRevision,
    platform: 'linux/amd64' as const,
    authority
  });
  return Object.freeze({
    ...body,
    closureDigest: materializationDigest(body)
  });
}

export function parseEnvironmentDependencyClosureV1(
  input: unknown
): EnvironmentDependencyClosureV1 {
  const value = record(parseJsonOrValue(input, 'environment dependency closure'),
    'environment dependency closure');
  exactKeys(value, [
    'schema', 'environmentSpecDigest', 'lockDigest', 'toolchainDigest',
    'providerRevision', 'platform', 'authority', 'closureDigest'
  ], 'environment dependency closure');
  if (value.schema !== ENVIRONMENT_DEPENDENCY_CLOSURE_SCHEMA_V1 ||
      value.platform !== 'linux/amd64' || !Array.isArray(value.authority)) {
    fail('environment dependency closure identity is invalid');
  }
  const closure = createEnvironmentDependencyClosureV1({
    environmentSpecDigest: value.environmentSpecDigest as string,
    lockDigest: value.lockDigest as string,
    toolchainDigest: value.toolchainDigest as string,
    providerRevision: value.providerRevision as string,
    authority: value.authority as EnvironmentDependencyAuthorityEntryV1[]
  });
  if (closure.closureDigest !== value.closureDigest) {
    fail('environment dependency closure digest mismatch');
  }
  return closure;
}

export function createEnvironmentDependencyCacheIdentityV1(input: Readonly<{
  closure: EnvironmentDependencyClosureV1;
}>): EnvironmentDependencyCacheIdentityV1 {
  const closure = parseEnvironmentDependencyClosureV1(input.closure);
  const body = Object.freeze({
    schema: ENVIRONMENT_DEPENDENCY_CACHE_IDENTITY_SCHEMA_V1,
    closureDigest: closure.closureDigest
  });
  return Object.freeze({
    ...body,
    identityDigest: materializationDigest(body)
  });
}

export function parseEnvironmentDependencyCacheIdentityV1(
  input: unknown
): EnvironmentDependencyCacheIdentityV1 {
  const value = record(parseJsonOrValue(input, 'environment dependency cache identity'),
    'environment dependency cache identity');
  exactKeys(value, ['schema', 'closureDigest', 'identityDigest'],
    'environment dependency cache identity');
  if (value.schema !== ENVIRONMENT_DEPENDENCY_CACHE_IDENTITY_SCHEMA_V1) {
    fail('environment dependency cache identity schema is invalid');
  }
  const closureDigest = digest(value.closureDigest,
    'environment dependency cache identity closureDigest');
  const body = Object.freeze({
    schema: ENVIRONMENT_DEPENDENCY_CACHE_IDENTITY_SCHEMA_V1,
    closureDigest
  });
  const identityDigest = digest(value.identityDigest,
    'environment dependency cache identity identityDigest');
  if (materializationDigest(body) !== identityDigest) {
    fail('environment dependency cache identity digest mismatch');
  }
  return Object.freeze({
    schema: ENVIRONMENT_DEPENDENCY_CACHE_IDENTITY_SCHEMA_V1,
    closureDigest,
    identityDigest
  });
}

const ENVIRONMENT_DEPENDENCY_CACHE_PHASES_V2 = new Set<EnvironmentDependencyCachePhaseV2>([
  'registered', 'materializing', 'published', 'terminal', 'gc-pending', 'physical-clean'
]);

const ENVIRONMENT_DEPENDENCY_CACHE_PHASE_ADJACENCY_V2:
  Readonly<Record<EnvironmentDependencyCachePhaseV2, readonly EnvironmentDependencyCachePhaseV2[]>> =
  Object.freeze({
    registered: Object.freeze(['materializing', 'terminal'] as EnvironmentDependencyCachePhaseV2[]),
    materializing: Object.freeze(['materializing', 'published', 'terminal'] as EnvironmentDependencyCachePhaseV2[]),
    published: Object.freeze(['published', 'terminal'] as EnvironmentDependencyCachePhaseV2[]),
    terminal: Object.freeze(['gc-pending'] as EnvironmentDependencyCachePhaseV2[]),
    'gc-pending': Object.freeze(['terminal', 'physical-clean'] as EnvironmentDependencyCachePhaseV2[]),
    'physical-clean': Object.freeze([] as EnvironmentDependencyCachePhaseV2[])
  });

function dependencyCachePositiveIntegerV2(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    fail(`${label} must be a positive safe integer`);
  }
  return value as number;
}

function dependencyCacheEpochV2(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    fail('environment dependency cache transitionEpoch is invalid');
  }
  return value as number;
}

function dependencyCacheConsumerIdV2(value: unknown, label: string): string {
  const consumerId = bounded(value, label, 256);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u.test(consumerId)) {
    fail(`${label} is not a canonical consumer identity`);
  }
  return consumerId;
}

function canonicalDependencyCacheConsumersV2(
  input: readonly EnvironmentDependencyCacheConsumerV2[]
): readonly EnvironmentDependencyCacheConsumerV2[] {
  if (!Array.isArray(input)) fail('environment dependency cache activeConsumers must be an array');
  const consumers = input.map((entry, index) => {
    const value = record(entry, `environment dependency cache activeConsumers[${index}]`);
    exactKeys(value, [
      'consumerId', 'acquireCredentialDigest', 'ownerHost', 'ownerBootId', 'ownerPid',
      'ownerProcessStartTicks', 'acquiredAt', 'leaseExpiresAt'
    ], `environment dependency cache activeConsumers[${index}]`);
    const consumerId = dependencyCacheConsumerIdV2(
      value.consumerId, `environment dependency cache activeConsumers[${index}].consumerId`
    );
    const acquireCredentialDigest = digest(
      value.acquireCredentialDigest,
      `environment dependency cache activeConsumers[${index}].acquireCredentialDigest`
    );
    const ownerHost = bounded(
      value.ownerHost, `environment dependency cache activeConsumers[${index}].ownerHost`, 255
    );
    const ownerBootId = bounded(
      value.ownerBootId, `environment dependency cache activeConsumers[${index}].ownerBootId`, 128
    );
    const ownerPid = value.ownerPid;
    const ownerProcessStartTicks = bounded(
      value.ownerProcessStartTicks,
      `environment dependency cache activeConsumers[${index}].ownerProcessStartTicks`, 64
    );
    const acquiredAt = canonicalTime(
      value.acquiredAt, `environment dependency cache activeConsumers[${index}].acquiredAt`
    );
    const leaseExpiresAt = canonicalTime(
      value.leaseExpiresAt, `environment dependency cache activeConsumers[${index}].leaseExpiresAt`
    );
    if (typeof ownerPid !== 'number' || !Number.isSafeInteger(ownerPid) || ownerPid <= 0 ||
        !/^[0-9a-f-]{8,128}$/u.test(ownerBootId) ||
        !/^\d+$/u.test(ownerProcessStartTicks) ||
        Date.parse(leaseExpiresAt) <= Date.parse(acquiredAt)) {
      fail(`environment dependency cache activeConsumers[${index}] owner lease is invalid`);
    }
    return Object.freeze({
      consumerId,
      acquireCredentialDigest,
      ownerHost,
      ownerBootId,
      ownerPid,
      ownerProcessStartTicks,
      acquiredAt,
      leaseExpiresAt
    });
  }).sort((left, right) => left.consumerId.localeCompare(right.consumerId, 'en-US'));
  if (new Set(consumers.map(({ consumerId }) => consumerId)).size !== consumers.length) {
    fail('environment dependency cache activeConsumers must be unique');
  }
  return Object.freeze(consumers);
}

function canonicalDependencyCacheConsumerRecoveryV2(
  input: EnvironmentDependencyCacheConsumerRecoveryV2 | null
): EnvironmentDependencyCacheConsumerRecoveryV2 | null {
  if (input === null) return null;
  const value = record(input, 'environment dependency cache lastConsumerRecovery');
  exactKeys(value, [
    'consumerId', 'acquireCredentialDigest', 'reason', 'observedAt', 'deathProofDigest'
  ], 'environment dependency cache lastConsumerRecovery');
  const consumerId = dependencyCacheConsumerIdV2(
    value.consumerId, 'environment dependency cache lastConsumerRecovery.consumerId'
  );
  const acquireCredentialDigest = digest(
    value.acquireCredentialDigest,
    'environment dependency cache lastConsumerRecovery.acquireCredentialDigest'
  );
  if (value.reason !== 'host-boot-replaced' && value.reason !== 'process-absent' &&
      value.reason !== 'process-identity-replaced') {
    fail('environment dependency cache lastConsumerRecovery.reason is invalid');
  }
  return Object.freeze({
    consumerId,
    acquireCredentialDigest,
    reason: value.reason,
    observedAt: canonicalTime(
      value.observedAt, 'environment dependency cache lastConsumerRecovery.observedAt'
    ),
    deathProofDigest: digest(
      value.deathProofDigest,
      'environment dependency cache lastConsumerRecovery.deathProofDigest'
    )
  });
}

function canonicalEnvironmentDependencyCacheStateV2(
  input: Omit<EnvironmentDependencyCacheStateV2, 'stateDigest'>
): EnvironmentDependencyCacheStateV2 {
  if (input.schema !== ENVIRONMENT_DEPENDENCY_CACHE_STATE_SCHEMA_V2) {
    fail('environment dependency cache state schema is invalid');
  }
  const resourceId = digest(input.resourceId, 'environment dependency cache resourceId');
  const identityDigest = digest(input.identityDigest, 'environment dependency cache identityDigest');
  const closureDigest = digest(input.closureDigest, 'environment dependency cache closureDigest');
  const providerRevision = bounded(
    input.providerRevision, 'environment dependency cache providerRevision', 256
  );
  const createdAt = canonicalTime(input.createdAt, 'environment dependency cache createdAt');
  const expectedResourceId = materializationDigest(Object.freeze({
    schema: 'sec-environment-dependency-cache-resource-v2',
    identityDigest,
    providerRevision,
    createdAt
  }));
  if (resourceId !== expectedResourceId) {
    fail('environment dependency cache resourceId is not identity-derived');
  }
  const phase = input.phase;
  if (!ENVIRONMENT_DEPENDENCY_CACHE_PHASES_V2.has(phase)) {
    fail('environment dependency cache phase is invalid');
  }
  const transitionEpoch = dependencyCacheEpochV2(input.transitionEpoch);
  const ownerLeaseDigest = digest(
    input.ownerLeaseDigest, 'environment dependency cache ownerLeaseDigest'
  );
  const ownerHost = bounded(input.ownerHost, 'environment dependency cache ownerHost', 255);
  const ownerBootId = bounded(input.ownerBootId, 'environment dependency cache ownerBootId', 128);
  const ownerPid = input.ownerPid;
  const ownerProcessStartTicks = bounded(
    input.ownerProcessStartTicks, 'environment dependency cache ownerProcessStartTicks', 64
  );
  if (!Number.isSafeInteger(ownerPid) || (ownerPid ?? 0) <= 0 ||
      !/^[0-9a-f-]{8,128}$/u.test(ownerBootId) || !/^\d+$/u.test(ownerProcessStartTicks)) {
    fail('environment dependency cache owner identity is invalid');
  }
  const leaseExpiresAt = canonicalTime(
    input.leaseExpiresAt, 'environment dependency cache leaseExpiresAt'
  );
  const archiveDigest = input.archiveDigest === null
    ? null : digest(input.archiveDigest, 'environment dependency cache archiveDigest');
  const archiveBytes = input.archiveBytes === null
    ? null : dependencyCachePositiveIntegerV2(
        input.archiveBytes, 'environment dependency cache archiveBytes'
      );
  const sourceSnapshotDigest = input.sourceSnapshotDigest === null
    ? null : digest(
        input.sourceSnapshotDigest, 'environment dependency cache sourceSnapshotDigest'
      );
  const archiveProjectionDigest = input.archiveProjectionDigest === null
    ? null : digest(
        input.archiveProjectionDigest, 'environment dependency cache archiveProjectionDigest'
      );
  const archiveFields = [archiveDigest, archiveBytes, sourceSnapshotDigest, archiveProjectionDigest];
  const hasArchive = archiveFields.every((value) => value !== null);
  if (archiveFields.some((value) => value !== null) !== hasArchive) {
    fail('environment dependency cache archive binding must be all-null or all-present');
  }
  if ((phase === 'registered' || phase === 'materializing') && hasArchive) {
    fail('environment dependency cache pre-publication phase cannot bind archive bytes');
  }
  if (!['registered', 'materializing'].includes(phase) && !hasArchive) {
    fail('environment dependency cache published or terminal phase requires archive binding');
  }
  const activeConsumers = canonicalDependencyCacheConsumersV2(input.activeConsumers);
  const lastConsumerRecovery = canonicalDependencyCacheConsumerRecoveryV2(
    input.lastConsumerRecovery
  );
  if (activeConsumers.length > 0 && phase !== 'published') {
    fail('environment dependency cache consumers require one published current resource');
  }
  const retention = Object.freeze({
    maxEntries: dependencyCachePositiveIntegerV2(
      input.retention?.maxEntries, 'environment dependency cache retention.maxEntries'
    ),
    maxTotalBytes: dependencyCachePositiveIntegerV2(
      input.retention?.maxTotalBytes, 'environment dependency cache retention.maxTotalBytes'
    )
  });
  if (archiveBytes !== null && archiveBytes > retention.maxTotalBytes) {
    fail('environment dependency cache archive exceeds aggregate byte budget');
  }
  if (input.terminalObligation !== 'current-unbound-consumer-zero-physical-absent') {
    fail('environment dependency cache terminal obligation is invalid');
  }
  const updatedAt = canonicalTime(input.updatedAt, 'environment dependency cache updatedAt');
  if (Date.parse(updatedAt) < Date.parse(createdAt) || Date.parse(leaseExpiresAt) <= Date.parse(createdAt)) {
    fail('environment dependency cache time ordering is invalid');
  }
  const previousStateDigest = input.previousStateDigest === null
    ? null : digest(
        input.previousStateDigest, 'environment dependency cache previousStateDigest'
      );
  if ((transitionEpoch === 0) !== (previousStateDigest === null)) {
    fail('environment dependency cache birth/previous-state binding is invalid');
  }
  const body: Omit<EnvironmentDependencyCacheStateV2, 'stateDigest'> = Object.freeze({
    schema: ENVIRONMENT_DEPENDENCY_CACHE_STATE_SCHEMA_V2,
    resourceId,
    identityDigest,
    closureDigest,
    providerRevision,
    phase,
    transitionEpoch,
    ownerLeaseDigest,
    ownerHost,
    ownerBootId,
    ownerPid: ownerPid as number,
    ownerProcessStartTicks,
    leaseExpiresAt,
    archiveDigest,
    archiveBytes,
    sourceSnapshotDigest,
    archiveProjectionDigest,
    activeConsumers,
    lastConsumerRecovery,
    retention,
    terminalObligation: input.terminalObligation,
    createdAt,
    updatedAt,
    previousStateDigest
  });
  return Object.freeze({ ...body, stateDigest: materializationDigest(body) });
}

export function createEnvironmentDependencyCacheBirthV2(input: Readonly<{
  identity: EnvironmentDependencyCacheIdentityV1;
  providerRevision: string;
  createdAt: string;
  leaseExpiresAt: string;
  maxEntries: number;
  maxTotalBytes: number;
  owner: Readonly<{
    host: string;
    bootId: string;
    pid: number;
    processStartTicks: string;
  }>;
}>): EnvironmentDependencyCacheStateV2 {
  const identity = parseEnvironmentDependencyCacheIdentityV1(input.identity);
  const providerRevision = bounded(
    input.providerRevision, 'environment dependency cache providerRevision', 256
  );
  const resourceId = materializationDigest(Object.freeze({
    schema: 'sec-environment-dependency-cache-resource-v2',
    identityDigest: identity.identityDigest,
    providerRevision,
    createdAt: input.createdAt
  }));
  const ownerLeaseDigest = materializationDigest(Object.freeze({
    schema: 'sec-environment-dependency-cache-owner-lease-v2',
    resourceId,
    providerRevision,
    owner: input.owner,
    createdAt: canonicalTime(input.createdAt, 'environment dependency cache createdAt'),
    leaseExpiresAt: canonicalTime(
      input.leaseExpiresAt, 'environment dependency cache leaseExpiresAt'
    )
  }));
  return canonicalEnvironmentDependencyCacheStateV2({
    schema: ENVIRONMENT_DEPENDENCY_CACHE_STATE_SCHEMA_V2,
    resourceId,
    identityDigest: identity.identityDigest,
    closureDigest: identity.closureDigest,
    providerRevision,
    phase: 'registered',
    transitionEpoch: 0,
    ownerLeaseDigest,
    ownerHost: input.owner.host,
    ownerBootId: input.owner.bootId,
    ownerPid: input.owner.pid,
    ownerProcessStartTicks: input.owner.processStartTicks,
    leaseExpiresAt: input.leaseExpiresAt,
    archiveDigest: null,
    archiveBytes: null,
    sourceSnapshotDigest: null,
    archiveProjectionDigest: null,
    activeConsumers: Object.freeze([]),
    lastConsumerRecovery: null,
    retention: Object.freeze({
      maxEntries: input.maxEntries,
      maxTotalBytes: input.maxTotalBytes
    }),
    terminalObligation: 'current-unbound-consumer-zero-physical-absent',
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    previousStateDigest: null
  });
}

function transitionEnvironmentDependencyCacheStateV2(input: Readonly<{
  current: EnvironmentDependencyCacheStateV2;
  phase: EnvironmentDependencyCachePhaseV2;
  updatedAt: string;
  archive?: Readonly<{
    archiveDigest: string;
    archiveBytes: number;
    sourceSnapshotDigest: string;
    archiveProjectionDigest: string;
  }>;
  activeConsumers?: readonly EnvironmentDependencyCacheConsumerV2[];
  lastConsumerRecovery?: EnvironmentDependencyCacheConsumerRecoveryV2 | null;
}>): EnvironmentDependencyCacheStateV2 {
  const current = parseEnvironmentDependencyCacheStateV2(input.current);
  if (!ENVIRONMENT_DEPENDENCY_CACHE_PHASE_ADJACENCY_V2[current.phase].includes(input.phase)) {
    fail(`environment dependency cache transition ${current.phase}->${input.phase} is invalid`);
  }
  const archive = input.archive;
  const next = canonicalEnvironmentDependencyCacheStateV2({
    schema: ENVIRONMENT_DEPENDENCY_CACHE_STATE_SCHEMA_V2,
    resourceId: current.resourceId,
    identityDigest: current.identityDigest,
    closureDigest: current.closureDigest,
    providerRevision: current.providerRevision,
    phase: input.phase,
    transitionEpoch: current.transitionEpoch + 1,
    ownerLeaseDigest: current.ownerLeaseDigest,
    ownerHost: current.ownerHost,
    ownerBootId: current.ownerBootId,
    ownerPid: current.ownerPid,
    ownerProcessStartTicks: current.ownerProcessStartTicks,
    leaseExpiresAt: current.leaseExpiresAt,
    archiveDigest: archive?.archiveDigest as `sha256:${string}` | undefined
      ?? current.archiveDigest,
    archiveBytes: archive?.archiveBytes ?? current.archiveBytes,
    sourceSnapshotDigest: archive?.sourceSnapshotDigest as `sha256:${string}` | undefined
      ?? current.sourceSnapshotDigest,
    archiveProjectionDigest: archive?.archiveProjectionDigest as `sha256:${string}` | undefined
      ?? current.archiveProjectionDigest,
    activeConsumers: input.activeConsumers ?? current.activeConsumers,
    lastConsumerRecovery: input.lastConsumerRecovery ?? current.lastConsumerRecovery,
    retention: current.retention,
    terminalObligation: current.terminalObligation,
    createdAt: current.createdAt,
    updatedAt: input.updatedAt,
    previousStateDigest: current.stateDigest
  });
  return next;
}

export function beginEnvironmentDependencyCacheMaterializationV2(input: Readonly<{
  current: EnvironmentDependencyCacheStateV2;
  updatedAt: string;
  leaseExpiresAt: string;
  owner: Readonly<{
    host: string;
    bootId: string;
    pid: number;
    processStartTicks: string;
  }>;
}>): EnvironmentDependencyCacheStateV2 {
  const current = parseEnvironmentDependencyCacheStateV2(input.current);
  const updatedAt = canonicalTime(input.updatedAt, 'environment dependency cache materialization start');
  const leaseExpiresAt = canonicalTime(
    input.leaseExpiresAt, 'environment dependency cache materialization leaseExpiresAt'
  );
  if (current.phase !== 'registered' || Date.parse(leaseExpiresAt) <= Date.parse(updatedAt)) {
    fail('environment dependency cache materialization start requires registered current and future lease');
  }
  const ownerLeaseDigest = materializationDigest(Object.freeze({
    schema: 'sec-environment-dependency-cache-materialization-lease-v2',
    resourceId: current.resourceId,
    previousOwnerLeaseDigest: current.ownerLeaseDigest,
    owner: input.owner,
    updatedAt,
    leaseExpiresAt,
    transitionEpoch: current.transitionEpoch + 1
  }));
  return canonicalEnvironmentDependencyCacheStateV2({
    ...current,
    phase: 'materializing',
    transitionEpoch: current.transitionEpoch + 1,
    ownerLeaseDigest,
    ownerHost: input.owner.host,
    ownerBootId: input.owner.bootId,
    ownerPid: input.owner.pid,
    ownerProcessStartTicks: input.owner.processStartTicks,
    leaseExpiresAt,
    updatedAt,
    previousStateDigest: current.stateDigest
  });
}

export function recoverEnvironmentDependencyCacheMaterializationV2(input: Readonly<{
  current: EnvironmentDependencyCacheStateV2;
  recoveredAt: string;
  leaseExpiresAt: string;
  reason: EnvironmentDependencyCacheConsumerRecoveryV2['reason'];
  deathProofDigest: string;
  owner: Readonly<{
    host: string;
    bootId: string;
    pid: number;
    processStartTicks: string;
  }>;
}>): EnvironmentDependencyCacheStateV2 {
  const current = parseEnvironmentDependencyCacheStateV2(input.current);
  const recoveredAt = canonicalTime(
    input.recoveredAt, 'environment dependency cache recoveredAt'
  );
  const leaseExpiresAt = canonicalTime(
    input.leaseExpiresAt, 'environment dependency cache recovery leaseExpiresAt'
  );
  if (current.phase !== 'materializing' || Date.parse(current.leaseExpiresAt) > Date.parse(recoveredAt) ||
      Date.parse(leaseExpiresAt) <= Date.parse(recoveredAt)) {
    fail('environment dependency cache recovery requires one expired materializing lease');
  }
  if (input.reason !== 'host-boot-replaced' && input.reason !== 'process-absent' &&
      input.reason !== 'process-identity-replaced') {
    fail('environment dependency cache materialization recovery reason is invalid');
  }
  const deathProofDigest = digest(
    input.deathProofDigest, 'environment dependency cache materialization deathProofDigest'
  );
  const ownerLeaseDigest = materializationDigest(Object.freeze({
    schema: 'sec-environment-dependency-cache-recovery-lease-v2',
    resourceId: current.resourceId,
    previousOwnerLeaseDigest: current.ownerLeaseDigest,
    recoveredAt,
    leaseExpiresAt,
    reason: input.reason,
    deathProofDigest,
    owner: input.owner,
    transitionEpoch: current.transitionEpoch + 1
  }));
  return canonicalEnvironmentDependencyCacheStateV2({
    schema: ENVIRONMENT_DEPENDENCY_CACHE_STATE_SCHEMA_V2,
    resourceId: current.resourceId,
    identityDigest: current.identityDigest,
    closureDigest: current.closureDigest,
    providerRevision: current.providerRevision,
    phase: 'materializing',
    transitionEpoch: current.transitionEpoch + 1,
    ownerLeaseDigest,
    ownerHost: input.owner.host,
    ownerBootId: input.owner.bootId,
    ownerPid: input.owner.pid,
    ownerProcessStartTicks: input.owner.processStartTicks,
    leaseExpiresAt,
    archiveDigest: current.archiveDigest,
    archiveBytes: current.archiveBytes,
    sourceSnapshotDigest: current.sourceSnapshotDigest,
    archiveProjectionDigest: current.archiveProjectionDigest,
    activeConsumers: current.activeConsumers,
    lastConsumerRecovery: current.lastConsumerRecovery,
    retention: current.retention,
    terminalObligation: current.terminalObligation,
    createdAt: current.createdAt,
    updatedAt: recoveredAt,
    previousStateDigest: current.stateDigest
  });
}

/** Pure reducer only; it cannot observe bytes, persist current or authorize publication. */
export function reduceEnvironmentDependencyCachePublishedStateV2(input: Readonly<{
  current: EnvironmentDependencyCacheStateV2;
  updatedAt: string;
  archiveDigest: string;
  archiveBytes: number;
  sourceSnapshotDigest: string;
  archiveProjectionDigest: string;
}>): EnvironmentDependencyCacheStateV2 {
  return transitionEnvironmentDependencyCacheStateV2({
    current: input.current,
    phase: 'published',
    updatedAt: input.updatedAt,
    archive: {
      archiveDigest: input.archiveDigest,
      archiveBytes: input.archiveBytes,
      sourceSnapshotDigest: input.sourceSnapshotDigest,
      archiveProjectionDigest: input.archiveProjectionDigest
    }
  });
}

export function acquireEnvironmentDependencyCacheConsumerV2(input: Readonly<{
  current: EnvironmentDependencyCacheStateV2;
  consumerId: string;
  updatedAt: string;
  leaseExpiresAt: string;
  owner: Readonly<{
    host: string;
    bootId: string;
    pid: number;
    processStartTicks: string;
  }>;
}>): Readonly<{
  current: EnvironmentDependencyCacheStateV2;
  handle: EnvironmentDependencyCacheHandleV1;
}> {
  const current = parseEnvironmentDependencyCacheStateV2(input.current);
  if (current.phase !== 'published') {
    fail('environment dependency cache consumer can only acquire published current state');
  }
  const consumerId = dependencyCacheConsumerIdV2(
    input.consumerId, 'environment dependency cache consumerId'
  );
  if (current.activeConsumers.some((entry) => entry.consumerId === consumerId)) {
    fail('environment dependency cache consumer is already active');
  }
  const acquiredAt = canonicalTime(input.updatedAt, 'environment dependency cache acquiredAt');
  const leaseExpiresAt = canonicalTime(
    input.leaseExpiresAt, 'environment dependency cache consumer leaseExpiresAt'
  );
  const ownerHost = bounded(input.owner.host, 'environment dependency cache consumer ownerHost', 255);
  const ownerBootId = bounded(
    input.owner.bootId, 'environment dependency cache consumer ownerBootId', 128
  );
  const ownerPid = input.owner.pid;
  const ownerProcessStartTicks = bounded(
    input.owner.processStartTicks,
    'environment dependency cache consumer ownerProcessStartTicks', 64
  );
  if (Date.parse(leaseExpiresAt) <= Date.parse(acquiredAt) ||
      !Number.isSafeInteger(ownerPid) || ownerPid <= 0 ||
      !/^[0-9a-f-]{8,128}$/u.test(ownerBootId) || !/^\d+$/u.test(ownerProcessStartTicks)) {
    fail('environment dependency cache consumer owner lease is invalid');
  }
  const acquireCredentialDigest = materializationDigest(Object.freeze({
    schema: 'sec-environment-dependency-cache-acquire-v2',
    currentStateDigest: current.stateDigest,
    consumerId,
    ownerHost,
    ownerBootId,
    ownerPid,
    ownerProcessStartTicks,
    acquiredAt,
    leaseExpiresAt,
    transitionEpoch: current.transitionEpoch + 1
  }));
  const next = transitionEnvironmentDependencyCacheStateV2({
    current,
    phase: 'published',
    updatedAt: input.updatedAt,
    activeConsumers: Object.freeze([
      ...current.activeConsumers,
      Object.freeze({
        consumerId,
        acquireCredentialDigest,
        ownerHost,
        ownerBootId,
        ownerPid,
        ownerProcessStartTicks,
        acquiredAt,
        leaseExpiresAt
      })
    ])
  });
  return Object.freeze({
    current: next,
    handle: projectEnvironmentDependencyCacheHandleV2({ current: next, consumerId })
  });
}

export function recoverEnvironmentDependencyCacheConsumerV2(input: Readonly<{
  current: EnvironmentDependencyCacheStateV2;
  consumerId: string;
  acquireCredentialDigest: string;
  reason: EnvironmentDependencyCacheConsumerRecoveryV2['reason'];
  observedAt: string;
  deathProofDigest: string;
}>): EnvironmentDependencyCacheStateV2 {
  const current = parseEnvironmentDependencyCacheStateV2(input.current);
  const consumerId = dependencyCacheConsumerIdV2(
    input.consumerId, 'environment dependency cache recovery consumerId'
  );
  const acquireCredentialDigest = digest(
    input.acquireCredentialDigest, 'environment dependency cache recovery acquireCredentialDigest'
  );
  const observedAt = canonicalTime(
    input.observedAt, 'environment dependency cache recovery observedAt'
  );
  const deathProofDigest = digest(
    input.deathProofDigest, 'environment dependency cache recovery deathProofDigest'
  );
  const active = current.activeConsumers.find((entry) => entry.consumerId === consumerId);
  if (current.phase !== 'published' || active?.acquireCredentialDigest !== acquireCredentialDigest ||
      Date.parse(active.leaseExpiresAt) > Date.parse(observedAt)) {
    fail('environment dependency cache consumer recovery is not bound to an expired active lease');
  }
  if (input.reason !== 'host-boot-replaced' && input.reason !== 'process-absent' &&
      input.reason !== 'process-identity-replaced') {
    fail('environment dependency cache consumer recovery reason is invalid');
  }
  return transitionEnvironmentDependencyCacheStateV2({
    current,
    phase: 'published',
    updatedAt: observedAt,
    activeConsumers: current.activeConsumers.filter((entry) => entry.consumerId !== consumerId),
    lastConsumerRecovery: Object.freeze({
      consumerId,
      acquireCredentialDigest,
      reason: input.reason,
      observedAt,
      deathProofDigest
    })
  });
}

export function releaseEnvironmentDependencyCacheConsumerV2(input: Readonly<{
  current: EnvironmentDependencyCacheStateV2;
  consumerId: string;
  acquireCredentialDigest: string;
  updatedAt: string;
}>): Readonly<{
  current: EnvironmentDependencyCacheStateV2;
  releaseCredentialDigest: `sha256:${string}`;
}> {
  const current = parseEnvironmentDependencyCacheStateV2(input.current);
  const consumerId = dependencyCacheConsumerIdV2(
    input.consumerId, 'environment dependency cache consumerId'
  );
  const acquireCredentialDigest = digest(
    input.acquireCredentialDigest, 'environment dependency cache acquireCredentialDigest'
  );
  const active = current.activeConsumers.find((entry) => entry.consumerId === consumerId);
  if (current.phase !== 'published' || active?.acquireCredentialDigest !== acquireCredentialDigest) {
    fail('environment dependency cache release is not bound to one active consumer');
  }
  const next = transitionEnvironmentDependencyCacheStateV2({
    current,
    phase: 'published',
    updatedAt: input.updatedAt,
    activeConsumers: current.activeConsumers.filter((entry) => entry.consumerId !== consumerId)
  });
  return Object.freeze({
    current: next,
    releaseCredentialDigest: materializationDigest(Object.freeze({
      schema: 'sec-environment-dependency-cache-release-v2',
      previousStateDigest: current.stateDigest,
      currentStateDigest: next.stateDigest,
      consumerId,
      acquireCredentialDigest
    }))
  });
}

export function transitionEnvironmentDependencyCacheTerminalV2(input: Readonly<{
  current: EnvironmentDependencyCacheStateV2;
  phase: 'terminal' | 'gc-pending' | 'physical-clean';
  updatedAt: string;
}>): EnvironmentDependencyCacheStateV2 {
  const current = parseEnvironmentDependencyCacheStateV2(input.current);
  if (current.activeConsumers.length !== 0) {
    fail('environment dependency cache terminal transition requires consumer-zero');
  }
  return transitionEnvironmentDependencyCacheStateV2({
    current, phase: input.phase, updatedAt: input.updatedAt
  });
}

export function parseEnvironmentDependencyCacheStateV2(
  input: unknown
): EnvironmentDependencyCacheStateV2 {
  const value = record(parseJsonOrValue(input, 'environment dependency cache state'),
    'environment dependency cache state');
  exactKeys(value, [
    'schema', 'resourceId', 'identityDigest', 'closureDigest', 'providerRevision',
    'phase', 'transitionEpoch', 'ownerLeaseDigest', 'ownerHost', 'ownerBootId', 'ownerPid',
    'ownerProcessStartTicks', 'leaseExpiresAt',
    'archiveDigest', 'archiveBytes', 'sourceSnapshotDigest', 'archiveProjectionDigest',
    'activeConsumers', 'lastConsumerRecovery', 'retention', 'terminalObligation', 'createdAt', 'updatedAt',
    'previousStateDigest', 'stateDigest'
  ], 'environment dependency cache state');
  if (!Array.isArray(value.activeConsumers)) {
    fail('environment dependency cache activeConsumers are invalid');
  }
  const retention = record(value.retention, 'environment dependency cache retention');
  exactKeys(retention, ['maxEntries', 'maxTotalBytes'], 'environment dependency cache retention');
  const state = canonicalEnvironmentDependencyCacheStateV2({
    schema: value.schema as typeof ENVIRONMENT_DEPENDENCY_CACHE_STATE_SCHEMA_V2,
    resourceId: value.resourceId as `sha256:${string}`,
    identityDigest: value.identityDigest as `sha256:${string}`,
    closureDigest: value.closureDigest as `sha256:${string}`,
    providerRevision: value.providerRevision as string,
    phase: value.phase as EnvironmentDependencyCachePhaseV2,
    transitionEpoch: value.transitionEpoch as number,
    ownerLeaseDigest: value.ownerLeaseDigest as `sha256:${string}`,
    ownerHost: value.ownerHost as string,
    ownerBootId: value.ownerBootId as string,
    ownerPid: value.ownerPid as number,
    ownerProcessStartTicks: value.ownerProcessStartTicks as string,
    leaseExpiresAt: value.leaseExpiresAt as string,
    archiveDigest: value.archiveDigest as `sha256:${string}` | null,
    archiveBytes: value.archiveBytes as number | null,
    sourceSnapshotDigest: value.sourceSnapshotDigest as `sha256:${string}` | null,
    archiveProjectionDigest: value.archiveProjectionDigest as `sha256:${string}` | null,
    activeConsumers: value.activeConsumers as EnvironmentDependencyCacheConsumerV2[],
    lastConsumerRecovery: value.lastConsumerRecovery as EnvironmentDependencyCacheConsumerRecoveryV2 | null,
    retention: {
      maxEntries: retention.maxEntries as number,
      maxTotalBytes: retention.maxTotalBytes as number
    },
    terminalObligation: value.terminalObligation as
      'current-unbound-consumer-zero-physical-absent',
    createdAt: value.createdAt as string,
    updatedAt: value.updatedAt as string,
    previousStateDigest: value.previousStateDigest as `sha256:${string}` | null
  });
  if (state.stateDigest !== value.stateDigest) {
    fail('environment dependency cache state digest mismatch');
  }
  return state;
}

export function createEnvironmentDependencyCacheSettlementV2(input: Readonly<{
  current: EnvironmentDependencyCacheStateV2;
  physicalAbsenceDigest: string;
  settledAt: string;
}>): EnvironmentDependencyCacheSettlementV2 {
  const current = parseEnvironmentDependencyCacheStateV2(input.current);
  if (current.phase !== 'physical-clean' || current.activeConsumers.length !== 0 ||
      current.archiveDigest === null) {
    fail('environment dependency cache settlement requires physical-clean consumer-zero state');
  }
  const body = Object.freeze({
    schema: ENVIRONMENT_DEPENDENCY_CACHE_SETTLEMENT_SCHEMA_V2,
    resourceId: current.resourceId,
    identityDigest: current.identityDigest,
    finalStateDigest: current.stateDigest,
    archiveDigest: current.archiveDigest,
    physicalAbsenceDigest: digest(
      input.physicalAbsenceDigest, 'environment dependency cache physicalAbsenceDigest'
    ),
    currentUnbound: true as const,
    consumerZero: true as const,
    archiveAbsent: true as const,
    settledAt: canonicalTime(input.settledAt, 'environment dependency cache settledAt')
  });
  return Object.freeze({ ...body, settlementDigest: materializationDigest(body) });
}

export function parseEnvironmentDependencyCacheSettlementV2(
  input: unknown
): EnvironmentDependencyCacheSettlementV2 {
  const value = record(parseJsonOrValue(input, 'environment dependency cache settlement'),
    'environment dependency cache settlement');
  exactKeys(value, [
    'schema', 'resourceId', 'identityDigest', 'finalStateDigest', 'archiveDigest',
    'physicalAbsenceDigest', 'currentUnbound', 'consumerZero', 'archiveAbsent',
    'settledAt', 'settlementDigest'
  ], 'environment dependency cache settlement');
  if (value.schema !== ENVIRONMENT_DEPENDENCY_CACHE_SETTLEMENT_SCHEMA_V2 ||
      value.currentUnbound !== true || value.consumerZero !== true || value.archiveAbsent !== true) {
    fail('environment dependency cache settlement semantics are invalid');
  }
  const body = Object.freeze({
    schema: ENVIRONMENT_DEPENDENCY_CACHE_SETTLEMENT_SCHEMA_V2,
    resourceId: digest(value.resourceId, 'environment dependency cache settlement resourceId'),
    identityDigest: digest(value.identityDigest, 'environment dependency cache settlement identityDigest'),
    finalStateDigest: digest(value.finalStateDigest, 'environment dependency cache settlement finalStateDigest'),
    archiveDigest: digest(value.archiveDigest, 'environment dependency cache settlement archiveDigest'),
    physicalAbsenceDigest: digest(
      value.physicalAbsenceDigest, 'environment dependency cache settlement physicalAbsenceDigest'
    ),
    currentUnbound: true as const,
    consumerZero: true as const,
    archiveAbsent: true as const,
    settledAt: canonicalTime(value.settledAt, 'environment dependency cache settlement settledAt')
  });
  const settlementDigest = digest(
    value.settlementDigest, 'environment dependency cache settlement settlementDigest'
  );
  if (materializationDigest(body) !== settlementDigest) {
    fail('environment dependency cache settlement digest mismatch');
  }
  return Object.freeze({ ...body, settlementDigest });
}

export function createEnvironmentDependencyCachePhysicalReceiptV2(input: Readonly<{
  current: EnvironmentDependencyCacheStateV2;
}>): EnvironmentDependencyCachePhysicalReceiptV2 {
  const current = parseEnvironmentDependencyCacheStateV2(input.current);
  if (current.phase !== 'published' || current.archiveDigest === null ||
      current.archiveBytes === null || current.sourceSnapshotDigest === null ||
      current.archiveProjectionDigest === null) {
    fail('environment dependency cache physical receipt requires published archive state');
  }
  const body = Object.freeze({
    schema: ENVIRONMENT_DEPENDENCY_CACHE_PHYSICAL_RECEIPT_SCHEMA_V2,
    resourceId: current.resourceId,
    identityDigest: current.identityDigest,
    closureDigest: current.closureDigest,
    archiveDigest: current.archiveDigest,
    archiveBytes: current.archiveBytes,
    sourceSnapshotDigest: current.sourceSnapshotDigest,
    archiveProjectionDigest: current.archiveProjectionDigest,
    readOnly: true as const
  });
  return Object.freeze({ ...body, receiptDigest: materializationDigest(body) });
}

export function parseEnvironmentDependencyCachePhysicalReceiptV2(
  input: unknown
): EnvironmentDependencyCachePhysicalReceiptV2 {
  const value = record(parseJsonOrValue(input, 'environment dependency cache physical receipt'),
    'environment dependency cache physical receipt');
  exactKeys(value, [
    'schema', 'resourceId', 'identityDigest', 'closureDigest', 'archiveDigest',
    'archiveBytes', 'sourceSnapshotDigest', 'archiveProjectionDigest', 'readOnly',
    'receiptDigest'
  ], 'environment dependency cache physical receipt');
  if (value.schema !== ENVIRONMENT_DEPENDENCY_CACHE_PHYSICAL_RECEIPT_SCHEMA_V2 ||
      value.readOnly !== true) {
    fail('environment dependency cache physical receipt semantics are invalid');
  }
  const body = Object.freeze({
    schema: ENVIRONMENT_DEPENDENCY_CACHE_PHYSICAL_RECEIPT_SCHEMA_V2,
    resourceId: digest(value.resourceId, 'environment dependency cache physical receipt resourceId'),
    identityDigest: digest(
      value.identityDigest, 'environment dependency cache physical receipt identityDigest'
    ),
    closureDigest: digest(
      value.closureDigest, 'environment dependency cache physical receipt closureDigest'
    ),
    archiveDigest: digest(
      value.archiveDigest, 'environment dependency cache physical receipt archiveDigest'
    ),
    archiveBytes: dependencyCachePositiveIntegerV2(
      value.archiveBytes, 'environment dependency cache physical receipt archiveBytes'
    ),
    sourceSnapshotDigest: digest(
      value.sourceSnapshotDigest, 'environment dependency cache physical receipt sourceSnapshotDigest'
    ),
    archiveProjectionDigest: digest(
      value.archiveProjectionDigest,
      'environment dependency cache physical receipt archiveProjectionDigest'
    ),
    readOnly: true as const
  });
  const receiptDigest = digest(
    value.receiptDigest, 'environment dependency cache physical receipt receiptDigest'
  );
  if (materializationDigest(body) !== receiptDigest) {
    fail('environment dependency cache physical receipt digest mismatch');
  }
  return Object.freeze({ ...body, receiptDigest });
}

function canonicalEnvironmentDependencyCacheHandleV2(
  input: Omit<EnvironmentDependencyCacheHandleV1, 'handleDigest'>
): EnvironmentDependencyCacheHandleV1 {
  const body = Object.freeze({
    schema: ENVIRONMENT_DEPENDENCY_CACHE_HANDLE_SCHEMA_V1,
    resourceId: digest(input.resourceId, 'environment dependency cache handle resourceId'),
    identityDigest: digest(input.identityDigest, 'environment dependency cache handle identityDigest'),
    closureDigest: digest(input.closureDigest, 'environment dependency cache handle closureDigest'),
    archiveDigest: digest(input.archiveDigest, 'environment dependency cache handle archiveDigest'),
    archiveBytes: dependencyCachePositiveIntegerV2(
      input.archiveBytes, 'environment dependency cache handle archiveBytes'
    ),
    sourceSnapshotDigest: digest(
      input.sourceSnapshotDigest, 'environment dependency cache handle sourceSnapshotDigest'
    ),
    archiveProjectionDigest: digest(
      input.archiveProjectionDigest, 'environment dependency cache handle archiveProjectionDigest'
    ),
    readOnly: true as const,
    state: input.state,
    transitionEpoch: dependencyCacheEpochV2(input.transitionEpoch),
    consumerId: input.consumerId === null ? null : dependencyCacheConsumerIdV2(
      input.consumerId, 'environment dependency cache handle consumerId'
    ),
    acquireCredentialDigest: input.acquireCredentialDigest === null ? null : digest(
      input.acquireCredentialDigest,
      'environment dependency cache handle acquireCredentialDigest'
    ),
    releaseCredentialDigest: input.releaseCredentialDigest === null ? null : digest(
      input.releaseCredentialDigest,
      'environment dependency cache handle releaseCredentialDigest'
    )
  });
  if (!['published', 'terminal', 'gc-pending'].includes(body.state)) {
    fail('environment dependency cache handle state is invalid');
  }
  if ((body.consumerId === null) !== (body.acquireCredentialDigest === null) ||
      body.releaseCredentialDigest !== null) {
    fail('environment dependency cache handle consumer binding is invalid');
  }
  return Object.freeze({ ...body, handleDigest: materializationDigest(body) });
}

function projectEnvironmentDependencyCacheHandleV2(input: Readonly<{
  current: EnvironmentDependencyCacheStateV2;
  consumerId?: string;
}>): EnvironmentDependencyCacheHandleV1 {
  const current = parseEnvironmentDependencyCacheStateV2(input.current);
  if (!['published', 'terminal', 'gc-pending'].includes(current.phase) ||
      current.archiveDigest === null || current.archiveBytes === null ||
      current.sourceSnapshotDigest === null || current.archiveProjectionDigest === null) {
    fail('environment dependency cache state cannot project a published handle');
  }
  const consumerId = input.consumerId === undefined ? null : dependencyCacheConsumerIdV2(
    input.consumerId, 'environment dependency cache handle consumerId'
  );
  const consumer = consumerId === null
    ? undefined
    : current.activeConsumers.find((entry) => entry.consumerId === consumerId);
  if (consumerId !== null && consumer === undefined) {
    fail('environment dependency cache handle consumer is not active');
  }
  return canonicalEnvironmentDependencyCacheHandleV2({
    schema: ENVIRONMENT_DEPENDENCY_CACHE_HANDLE_SCHEMA_V1,
    resourceId: current.resourceId,
    identityDigest: current.identityDigest,
    closureDigest: current.closureDigest,
    archiveDigest: current.archiveDigest,
    archiveBytes: current.archiveBytes,
    sourceSnapshotDigest: current.sourceSnapshotDigest,
    archiveProjectionDigest: current.archiveProjectionDigest,
    readOnly: true,
    state: current.phase as EnvironmentDependencyCacheHandleV1['state'],
    transitionEpoch: current.transitionEpoch,
    consumerId,
    acquireCredentialDigest: consumer?.acquireCredentialDigest ?? null,
    releaseCredentialDigest: null
  });
}

export function createEnvironmentDependencyCacheHandleV1(input: Readonly<{
  /** Only the canonical owner may turn its current state into a handle. */
  current: EnvironmentDependencyCacheStateV2;
  consumerId?: string;
}>): EnvironmentDependencyCacheHandleV1 {
  return projectEnvironmentDependencyCacheHandleV2(input);
}

export function parseEnvironmentDependencyCacheHandleV1(
  input: unknown
): EnvironmentDependencyCacheHandleV1 {
  const value = record(parseJsonOrValue(input, 'environment dependency cache handle'),
    'environment dependency cache handle');
  exactKeys(value, [
    'schema', 'resourceId', 'identityDigest', 'closureDigest', 'archiveDigest',
    'archiveBytes', 'sourceSnapshotDigest', 'archiveProjectionDigest',
    'readOnly', 'state', 'transitionEpoch', 'consumerId',
    'acquireCredentialDigest', 'releaseCredentialDigest', 'handleDigest'
  ], 'environment dependency cache handle');
  if (value.schema !== ENVIRONMENT_DEPENDENCY_CACHE_HANDLE_SCHEMA_V1 ||
      value.readOnly !== true ||
      !['published', 'terminal', 'gc-pending'].includes(value.state as string)) {
    fail('environment dependency cache handle semantics are invalid');
  }
  const handle = canonicalEnvironmentDependencyCacheHandleV2({
    schema: ENVIRONMENT_DEPENDENCY_CACHE_HANDLE_SCHEMA_V1,
    resourceId: digest(value.resourceId, 'environment dependency cache handle resourceId'),
    identityDigest: digest(value.identityDigest, 'environment dependency cache handle identityDigest'),
    closureDigest: digest(value.closureDigest, 'environment dependency cache handle closureDigest'),
    archiveDigest: digest(value.archiveDigest, 'environment dependency cache handle archiveDigest'),
    archiveBytes: value.archiveBytes as number,
    sourceSnapshotDigest: digest(value.sourceSnapshotDigest,
      'environment dependency cache handle sourceSnapshotDigest'),
    archiveProjectionDigest: digest(value.archiveProjectionDigest,
      'environment dependency cache handle archiveProjectionDigest'),
    readOnly: true,
    state: value.state as EnvironmentDependencyCacheHandleV1['state'],
    transitionEpoch: value.transitionEpoch as number,
    consumerId: value.consumerId === null ? null : bounded(value.consumerId,
      'environment dependency cache handle consumerId', 256),
    acquireCredentialDigest: value.acquireCredentialDigest === null ? null : digest(
      value.acquireCredentialDigest, 'environment dependency cache handle acquireCredentialDigest'),
    releaseCredentialDigest: value.releaseCredentialDigest === null ? null : digest(
      value.releaseCredentialDigest, 'environment dependency cache handle releaseCredentialDigest')
  });
  if (handle.handleDigest !== value.handleDigest) {
    fail('environment dependency cache handle digest mismatch');
  }
  return handle;
}
