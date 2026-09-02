import {
  canonicalJson,
  compareCodeUnits,
  deepFreeze,
  isPlainObject,
  sha256
} from '../../system-architecture/foundation/runtime/canonical.ts';
import {
  parseExactJsonBytes
} from '../../system-architecture/foundation/runtime/exact-json.ts';
import type { SecRepositoryModuleArchitectureProjection } from '../../system-architecture/repository-modules/contract.ts';
import type {
  SourceProgramCandidate,
  SourceProgramModel,
  SourceProgramTopologySummary
} from '../source-program-model/contract.ts';
import type {
  SourceProgramTestDispositionProjection,
  SourceProgramTestFinding,
  SourceProgramTestUnknownDispositionCluster,
  SourceProgramTestValueCompilation
} from '../source-program-model/test-value.ts';

const REDUCTION_MODES = new Set<string>(['none', 'version', 'graph-cut', 'aggregate-import']);
const OPERATION_INPUT_KEYS = Object.freeze([
  'binding',
  'blockingReasons',
  'enforce',
  'projection',
  'reductionPatch'
]);
const OPERATION_RESULT_KEYS = Object.freeze([
  'exitCode',
  'projection',
  'reductionPatch',
  'resultDigest'
]);
const OPERATION_WIRE_MAXIMUM_DEPTH = 256;

type Digest = `sha256:${string}`;

export type SourceProgramAuditReductionPatch = Readonly<{
  readonly sourceRevision: string;
  readonly planDigest: string;
  readonly patchDigest: string;
  readonly patch: string;
  readonly files: readonly Readonly<{
    readonly path: string;
    readonly beforeDigest: string;
    readonly afterDigest: string;
  }>[];
}>;

export type SourceProgramAuditImplementationDominanceProjection = Readonly<{
  readonly sourceRevision: string;
  readonly sourceProgramModelDigest: string;
  readonly units: readonly unknown[];
  readonly findings: readonly Readonly<{ readonly disposition: string }>[];
  readonly compilationDigest: string;
}>;

export type SourceProgramAuditReconciliationProjection = Readonly<{
  readonly status: 'resolved' | 'unresolved';
  readonly before: Readonly<{
    readonly sourceRevision: string;
    readonly modelDigest: string;
    readonly compilationReceiptDigest: Digest;
  }>;
  readonly after: Readonly<{
    readonly sourceRevision: string;
    readonly modelDigest: string;
    readonly compilationReceiptDigest: Digest;
  }>;
  readonly changes: readonly unknown[];
  readonly frontiers: readonly unknown[];
  readonly providerEvidence: readonly unknown[];
  readonly unresolvedReasons: readonly unknown[];
  readonly projectionDigest: Digest;
}>;

export type SourceProgramAuditArchitectureEvolutionProjection = Readonly<{
  readonly status: 'blocked' | 'no-change' | 'ready';
  readonly direction: 'blocked' | 'improving' | 'neutral';
  readonly before: Readonly<{
    readonly sourceRevision: string;
    readonly modelDigest: string;
    readonly architectureDigest: Digest;
  }>;
  readonly after: Readonly<{
    readonly sourceRevision: string;
    readonly modelDigest: string;
    readonly architectureDigest: Digest;
  }>;
  readonly reconciliationProjectionDigest: Digest;
  readonly changes: readonly unknown[];
  readonly changedPaths: readonly string[];
  readonly consumerPaths: readonly string[];
  readonly retirementPaths: readonly string[];
  readonly graphDelta: Readonly<Record<string, readonly string[]>>;
  readonly blockers: readonly unknown[];
  readonly referenceDigest: Digest;
}>;

export type SourceProgramAuditSupersessionProjection = Readonly<{
  readonly status: 'equivalent' | 'superseded' | 'owner-decision-required';
  readonly baseline: Readonly<{
    readonly sourceRevision: string;
    readonly modelDigest: string;
    readonly testCompilationDigest: string;
    readonly intentEvidenceDigest: string;
  }>;
  readonly current: Readonly<{
    readonly sourceRevision: string;
    readonly modelDigest: string;
    readonly testCompilationDigest: string;
    readonly intentEvidenceDigest: string;
  }>;
  readonly lifecycleCost: Readonly<{
    readonly baseline: Readonly<{
      readonly productionUnits: number;
      readonly testUnits: number;
      readonly owners: number;
      readonly unresolvedObservations: number;
      readonly unobservedTestRisk: number;
    }>;
    readonly current: Readonly<{
      readonly productionUnits: number;
      readonly testUnits: number;
      readonly owners: number;
      readonly unresolvedObservations: number;
      readonly unobservedTestRisk: number;
    }>;
  }>;
  readonly replacements: readonly Readonly<{ readonly kind: 'entrypoint' | 'production' | 'resource' | 'test' }>[];
  readonly findings: readonly unknown[];
  readonly receiptDigest: string;
}>;

export type SourceProgramAuditTestRetirementProjection = Readonly<{
  readonly baselineSourceRevision: string;
  readonly currentSourceRevision: string;
  readonly baselineActionKey: string;
  readonly currentActionKey: string;
  readonly baselineTestPathsDigest: string;
  readonly baselineRegistrationCensusDigest: string;
  readonly currentRegistrationCensusDigest: string;
  readonly currentTestCompilationDigest: string;
  readonly supersessionReceiptDigest: string;
  readonly proofs: readonly Readonly<{ readonly status: 'retired' | 'blocked' }>[];
  readonly receiptDigest: string;
}>;

type SourceProgramAuditVersionReductionPlan = Readonly<{
  readonly sourceRevision: string;
  readonly planDigest: string;
  readonly reductions: readonly Readonly<{
    readonly status: 'ready' | 'blocked';
    readonly currentName: string;
    readonly declarationPaths: readonly string[];
    readonly locations: readonly unknown[];
    readonly reason: string | null;
  }>[];
}>;

type SourceProgramAuditAggregateImportReductionPlan = Readonly<{
  readonly sourceRevision: string;
  readonly planDigest: string;
  readonly architectureDigest: string;
  readonly snapshotStatus: 'sealed' | 'blocked';
  readonly snapshotReason: string | null;
  readonly reductions: readonly Readonly<{
    readonly status: 'ready' | 'blocked';
    readonly moduleSpecifier: string;
    readonly path: string;
    readonly reason: string | null;
  }>[];
}>;

type SourceProgramAuditGraphCutReductionPlan = Readonly<{
  readonly sourceRevision: string;
  readonly planDigest: string;
  readonly evidenceDigest: string;
  readonly verificationDigest: string;
  readonly reductions: readonly Readonly<{
    readonly status: 'ready' | 'blocked';
    readonly name: string;
    readonly path: string;
    readonly reason: string | null;
  }>[];
}>;

export type SourceProgramAuditReduction =
  | Readonly<{ readonly mode: 'none' }>
  | Readonly<{
      readonly mode: 'version';
      readonly plan: SourceProgramAuditVersionReductionPlan;
      readonly patch: SourceProgramAuditReductionPatch | null;
    }>
  | Readonly<{
      readonly mode: 'aggregate-import';
      readonly plan: SourceProgramAuditAggregateImportReductionPlan;
      readonly patch: SourceProgramAuditReductionPatch | null;
    }>
  | Readonly<{
      readonly mode: 'graph-cut';
      readonly plan: SourceProgramAuditGraphCutReductionPlan;
      readonly patch: SourceProgramAuditReductionPatch | null;
      /** Parent projection of the process-local Knip receipt used by the plan. */
      readonly providerEvidence: Readonly<{
        readonly provider: 'knip';
        readonly receiptDigest: string;
        readonly sourceRevision: string;
      }>;
    }>;

export interface CompileSourceProgramAuditOperationInput {
  readonly sourceProgram: Readonly<{
    readonly sourceRevision: string;
    readonly modelDigest: string;
    readonly sourceFileSetDigest: string;
    readonly candidateDigests: readonly string[];
    readonly candidates: readonly SourceProgramCandidate[];
    readonly counts: Readonly<{
      readonly capabilities: number;
      readonly candidates: number;
      readonly declarations: number;
      readonly dependencies: number;
      readonly entrypoints: number;
      readonly entrypointClosures: number;
      readonly files: number;
      readonly literals: number;
      readonly packages: number;
      readonly references: number;
      readonly unknowns: number;
    }>;
  }>;
  /** Parent projection of exact source identities; source bytes never cross. */
  readonly sourceFileIdentities: readonly Readonly<{
    readonly path: string;
    readonly contentDigest: string;
  }>[];
  readonly moduleArchitecture: SecRepositoryModuleArchitectureProjection;
  readonly sourceProgramCompilation: Readonly<{
    readonly subjectDigest: Digest;
    readonly snapshotDigest: Digest;
    readonly moduleGraphDigest: Digest;
    readonly receiptDigest: Digest;
  }>;
  readonly declarationTopology: Readonly<{
    readonly compilationReceiptDigest: Digest;
    readonly sourceRevision: string;
    readonly modelDigest: string;
    readonly declarations: readonly unknown[];
    readonly edges: readonly unknown[];
    readonly strongComponents: readonly Readonly<{ readonly declarationObservationIds: readonly string[] }>[];
    readonly unknowns: readonly unknown[];
    readonly topologyDigest: Digest;
  }>;
  readonly cache: 'hit' | 'incremental' | 'miss';
  readonly invalidatedTypeScriptPaths: readonly string[];
  /** Parent-issued because the compiler model issuer is process-local. */
  readonly implementationDominance: SourceProgramAuditImplementationDominanceProjection;
  /** Parent-issued because reconciliation retains compiler receipt bindings. */
  readonly reconciliation: SourceProgramAuditReconciliationProjection;
  /** Parent-issued because architecture evolution retains reconciliation bindings. */
  readonly architectureEvolution: SourceProgramAuditArchitectureEvolutionProjection;
  readonly testValue: Readonly<{
    readonly sourceRevision: string;
    readonly baselineTestPaths: readonly string[];
    readonly baselineDigest: string;
    readonly baselineEvidenceDigest: string;
    readonly compilationDigest: string;
    readonly candidateRegistrationCensus: Readonly<{
      readonly count: number;
      readonly digest: string;
      readonly paths: readonly string[];
    }>;
    readonly recordsWithUnknownSemantics: number;
    readonly semanticClasses: Readonly<Record<string, number>>;
  }>;
  readonly testDisposition: SourceProgramTestDispositionProjection;
  /** Parent projections from the canonical Source Program policy owner. */
  readonly blockingCandidates: readonly SourceProgramCandidate[];
  readonly blockingTestFindings: readonly SourceProgramTestFinding[];
  readonly unknownDispositionClusters: readonly SourceProgramTestUnknownDispositionCluster[];
  readonly topology: SourceProgramTopologySummary;
  readonly supersession: SourceProgramAuditSupersessionProjection;
  /** Parent-issued because retirement receipt acceptance is process-local. */
  readonly testRetirement: SourceProgramAuditTestRetirementProjection;
  /** Reduction compilers and provider receipts remain in the parent boundary. */
  readonly reduction: SourceProgramAuditReduction;
  readonly options: Readonly<{
    readonly full: boolean;
    readonly enforce: boolean;
    readonly includeCandidates: boolean;
    /** Parent-precomputed because query implementation belongs to the compiler layer. */
    readonly queryProjection: unknown | null;
    /** Parent-normalized presentation only; the operation never writes it. */
    readonly outputPath: string | null;
  }>;
}

export interface SourceProgramAuditOperationResult {
  readonly projection: Readonly<Record<string, unknown>>;
  readonly reductionPatch: SourceProgramAuditReductionPatch | null;
  readonly exitCode: 0 | 1;
  readonly resultDigest: Digest;
}

export interface SourceProgramAuditOperationInput {
  readonly binding: Readonly<{
    readonly sourceRevision: string;
    readonly modelDigest: string;
    readonly subjectDigest: Digest;
  }>;
  readonly blockingReasons: readonly string[];
  readonly enforce: boolean;
  readonly projection: Readonly<Record<string, unknown>>;
  readonly reductionPatch: SourceProgramAuditReductionPatch | null;
}

function operationInputProjection(
  input: SourceProgramAuditOperationInput
): SourceProgramAuditOperationInput {
  return Object.freeze({
    binding: input.binding,
    blockingReasons: input.blockingReasons,
    enforce: input.enforce,
    projection: input.projection,
    reductionPatch: input.reductionPatch
  });
}

function canonicalWireBytes(value: unknown): Uint8Array {
  return Buffer.from(JSON.stringify(canonicalJson(value)), 'utf8');
}

function requireCanonicalWireObject(
  bytes: Uint8Array,
  maximumInputBytes: number,
  label: string,
  rootObjectKeys: readonly string[]
): Record<string, unknown> {
  const parsed = parseExactJsonBytes(bytes, label, {
    maximumDepth: OPERATION_WIRE_MAXIMUM_DEPTH,
    maximumInputBytes
  }, { rootObjectKeys });
  if (!isPlainObject(parsed)) throw new Error(label + ' must be one object');
  if (!Buffer.from(canonicalWireBytes(parsed)).equals(Buffer.from(bytes))) {
    throw new Error(label + ' must use canonical JSON bytes');
  }
  return parsed;
}

function compactRecordSet<T>(records: readonly T[]): Readonly<{
  readonly count: number;
  readonly digest: string;
}> {
  return Object.freeze({ count: records.length, digest: sha256(records) });
}

function assertSourceFileIdentities(
  files: readonly Readonly<{ readonly path: string; readonly contentDigest: string }>[]
): void {
  const paths = new Set<string>();
  for (const file of files) {
    if (paths.has(file.path)) throw new Error(`Source Program audit source path is duplicated: ${file.path}`);
    paths.add(file.path);
  }
}

function assertReductionPatch(
  patch: SourceProgramAuditReductionPatch,
  sourceFiles: readonly Readonly<{ readonly path: string; readonly contentDigest: string }>[]
): void {
  const sourceDigestByPath = new Map(sourceFiles.map(({ path, contentDigest }) =>
    [path, contentDigest] as const));
  const seen = new Set<string>();
  for (const file of patch.files) {
    if (seen.has(file.path)) throw new Error(`Reduction patch path is duplicated: ${file.path}`);
    seen.add(file.path);
    if (sourceDigestByPath.get(file.path) !== file.beforeDigest) {
      throw new Error(`Reduction patch preimage is not bound to source bytes: ${file.path}`);
    }
  }
}

export function compileSourceProgramAuditSourceProgramProjection(
  model: SourceProgramModel,
  sourceFileIdentities: readonly Readonly<{ readonly path: string; readonly contentDigest: string }>[],
  includeCandidates: boolean
): CompileSourceProgramAuditOperationInput['sourceProgram'] {
  assertSourceFileIdentities(sourceFileIdentities);
  const modelFileDigestByPath = new Map(model.files.map(({ path, contentDigest }) =>
    [path, contentDigest] as const));
  if (sourceFileIdentities.length !== model.files.length
      || sourceFileIdentities.some(({ path, contentDigest }) =>
        modelFileDigestByPath.get(path) !== contentDigest)) {
    throw new Error('Source bytes are not the exact Source Program file set');
  }
  return Object.freeze({
    sourceRevision: model.sourceRevision,
    modelDigest: model.modelDigest,
    sourceFileSetDigest: sha256(sourceFileIdentities),
    candidateDigests: Object.freeze(model.candidates.map((candidate) => sha256(candidate))),
    candidates: includeCandidates ? model.candidates : Object.freeze([]),
    counts: Object.freeze({
      capabilities: model.capabilities.length,
      candidates: model.candidates.length,
      declarations: model.declarations.length,
      dependencies: model.dependencies.length,
      entrypoints: model.entrypoints.length,
      entrypointClosures: model.entrypointClosures.length,
      files: model.files.length,
      literals: model.literals.length,
      packages: model.packages.length,
      references: model.references.length,
      unknowns: model.unknowns.length
    })
  });
}

export function compileSourceProgramAuditTestValueProjection(
  compilation: SourceProgramTestValueCompilation,
  full: boolean
): CompileSourceProgramAuditOperationInput['testValue'] {
  return Object.freeze({
    sourceRevision: compilation.sourceRevision,
    baselineTestPaths: compilation.baselineTestPaths,
    baselineDigest: compilation.baselineDigest,
    baselineEvidenceDigest: compilation.baselineEvidenceDigest,
    compilationDigest: compilation.compilationDigest,
    candidateRegistrationCensus: Object.freeze({
      count: compilation.records.length,
      digest: sha256(compilation.records.map(({ testId, path, span }) => ({ testId, path, span }))),
      paths: full
        ? Object.freeze([...new Set(compilation.records.map(({ path }) => path))]
            .sort(compareCodeUnits))
        : Object.freeze([])
    }),
    recordsWithUnknownSemantics: compilation.records
      .filter(({ unknowns }) => unknowns.length > 0).length,
    semanticClasses: Object.freeze(Object.fromEntries(
      [...new Set(compilation.records.flatMap(({ semanticClasses }) => semanticClasses))]
        .sort(compareCodeUnits)
        .map((semanticClass) => [
          semanticClass,
          compilation.records.filter(({ semanticClasses }) =>
            semanticClasses.includes(semanticClass)).length
        ])
    ))
  });
}

function assertFacts(input: CompileSourceProgramAuditOperationInput): void {
  assertSourceFileIdentities(input.sourceFileIdentities);
  if (input.sourceProgram.sourceFileSetDigest !== sha256(input.sourceFileIdentities)
      || input.sourceProgram.counts.files !== input.sourceFileIdentities.length
      || input.sourceProgram.candidateDigests.length !== input.sourceProgram.counts.candidates
      || input.sourceProgram.candidates.length !== (
        input.options.includeCandidates ? input.sourceProgram.counts.candidates : 0
      )) {
    throw new Error('Source Program projection is not bound to its exact fact set');
  }
  if (input.implementationDominance.sourceRevision !== input.sourceProgram.sourceRevision
      || input.implementationDominance.sourceProgramModelDigest !== input.sourceProgram.modelDigest) {
    throw new Error('Implementation dominance is not bound to the Source Program model');
  }
  if (input.reconciliation.after.sourceRevision !== input.sourceProgram.sourceRevision
      || input.reconciliation.after.modelDigest !== input.sourceProgram.modelDigest
      || input.reconciliation.after.compilationReceiptDigest
        !== input.sourceProgramCompilation.receiptDigest
      || input.declarationTopology.sourceRevision !== input.sourceProgram.sourceRevision
      || input.declarationTopology.modelDigest !== input.sourceProgram.modelDigest
      || input.declarationTopology.compilationReceiptDigest
        !== input.sourceProgramCompilation.receiptDigest
      || input.architectureEvolution.after.sourceRevision !== input.sourceProgram.sourceRevision
      || input.architectureEvolution.after.modelDigest !== input.sourceProgram.modelDigest
      || input.architectureEvolution.reconciliationProjectionDigest
        !== input.reconciliation.projectionDigest) {
    throw new Error('Architecture projections are not bound to the Source Program model');
  }
  const testBindingFailures = [
    ...(input.testValue.sourceRevision === input.sourceProgram.sourceRevision ? [] : ['test-value-source']),
    ...(input.testDisposition.sourceRevision === input.sourceProgram.sourceRevision ? [] : ['test-disposition-source']),
    ...(input.testDisposition.baselineDigest === input.testValue.baselineDigest ? [] : ['test-baseline']),
    ...(input.testDisposition.baselineEvidenceDigest === input.testValue.baselineEvidenceDigest
      ? [] : ['test-baseline-evidence']),
    ...(input.testDisposition.observationCompilationDigest === input.testValue.compilationDigest
      ? [] : ['test-observation-compilation']),
    ...(input.testDisposition.supersessionReceiptDigest === (
      input.supersession.status === 'superseded' ? input.supersession.receiptDigest : null
    ) ? [] : ['test-supersession']),
    ...(input.supersession.current.sourceRevision === input.sourceProgram.sourceRevision
      ? [] : ['supersession-source']),
    ...(input.supersession.current.modelDigest === input.sourceProgram.modelDigest
      ? [] : ['supersession-model']),
    ...(input.supersession.current.testCompilationDigest === input.testValue.compilationDigest
      ? [] : ['supersession-test-compilation']),
    ...(input.testRetirement.currentSourceRevision === input.sourceProgram.sourceRevision
      ? [] : ['retirement-source']),
    ...(input.testRetirement.currentTestCompilationDigest === input.testValue.compilationDigest
      ? [] : ['retirement-test-compilation']),
    ...(input.testRetirement.supersessionReceiptDigest === input.supersession.receiptDigest
      ? [] : ['retirement-supersession']),
    ...(input.testRetirement.baselineTestPathsDigest === sha256(input.testValue.baselineTestPaths)
      ? [] : ['retirement-baseline-paths'])
  ];
  if (testBindingFailures.length > 0) {
    throw new Error(
      `Test and supersession projections are not bound to one observation: ${testBindingFailures.join(', ')}`
    );
  }
  const candidateDigests = new Set(input.sourceProgram.candidateDigests);
  if (input.blockingCandidates.some((candidate) => !candidateDigests.has(sha256(candidate)))) {
    throw new Error('Blocking candidate projection is not a subset of the Source Program model');
  }
  const findingDigests = new Set(input.testDisposition.findings.map((finding) => sha256(finding)));
  if (input.blockingTestFindings.some((finding) => !findingDigests.has(sha256(finding)))) {
    throw new Error('Blocking test finding projection is not a subset of the test disposition');
  }
  const reduction = input.reduction as SourceProgramAuditReduction & Readonly<{ mode: string }>;
  if (!REDUCTION_MODES.has(reduction.mode)) {
    throw new Error(`Unsupported Source Program audit reduction mode: ${reduction.mode}`);
  }
  if (reduction.mode === 'none') return;
  if (reduction.plan.sourceRevision !== input.sourceProgram.sourceRevision) {
    throw new Error('Reduction plan is not bound to the Source Program revision');
  }
  if (reduction.patch !== null
      && (reduction.patch.sourceRevision !== input.sourceProgram.sourceRevision
        || reduction.patch.planDigest !== reduction.plan.planDigest)) {
    throw new Error('Reduction patch is not bound to its plan');
  }
  if (reduction.patch !== null) assertReductionPatch(reduction.patch, input.sourceFileIdentities);
  if (reduction.mode === 'graph-cut'
      && (reduction.providerEvidence.sourceRevision !== input.sourceProgram.sourceRevision
        || reduction.providerEvidence.receiptDigest !== reduction.plan.evidenceDigest)) {
    throw new Error('Graph-cut plan is not bound to the parent provider evidence');
  }
}

/**
 * Encodes the parent-normalized pure operation input. Extra caller properties
 * are projected out before the bytes cross the process boundary.
 */
export function encodeSourceProgramAuditOperationInput(
  input: SourceProgramAuditOperationInput
): Uint8Array {
  const projected = operationInputProjection(input);
  assertOperationInput(projected);
  return canonicalWireBytes(projected);
}

/**
 * Parses one bounded canonical pure-operation input. The wire parser owns
 * syntax and exact root fields; the parent compiler owns every fact join.
 * The returned value is data only and carries no authority.
 */
export function parseSourceProgramAuditOperationInput(
  bytes: Uint8Array,
  maximumInputBytes: number
): SourceProgramAuditOperationInput {
  const parsed = requireCanonicalWireObject(
    bytes,
    maximumInputBytes,
    'Repository Audit Source Program operation input',
    OPERATION_INPUT_KEYS
  );
  const input = deepFreeze(parsed) as unknown as SourceProgramAuditOperationInput;
  assertOperationInput(input);
  return input;
}

function assertOperationInput(input: SourceProgramAuditOperationInput): void {
  if (!isPlainObject(input.binding)
      || !/^sha256:[0-9a-f]{64}$/u.test(input.binding.sourceRevision)
      || !/^sha256:[0-9a-f]{64}$/u.test(input.binding.modelDigest)
      || !/^sha256:[0-9a-f]{64}$/u.test(input.binding.subjectDigest)
      || !Array.isArray(input.blockingReasons)
      || input.blockingReasons.some((reason) => (
        typeof reason !== 'string' || reason.length === 0 || reason.trim() !== reason
      ))
      || new Set(input.blockingReasons).size !== input.blockingReasons.length
      || typeof input.enforce !== 'boolean'
      || !isPlainObject(input.projection)
      || input.projection.sourceRevision !== input.binding.sourceRevision
      || input.projection.modelDigest !== input.binding.modelDigest
      || (input.reductionPatch !== null && !isPlainObject(input.reductionPatch))) {
    throw new Error('Repository Audit Source Program operation input is inconsistent');
  }
  if (input.reductionPatch !== null
      && input.reductionPatch.sourceRevision !== input.binding.sourceRevision) {
    throw new Error('Repository Audit reduction patch belongs to another source revision');
  }
}

export function encodeSourceProgramAuditOperationResult(
  result: SourceProgramAuditOperationResult
): Uint8Array {
  if (!isPlainObject(result.projection)
      || (result.exitCode !== 0 && result.exitCode !== 1)
      || result.resultDigest !== sha256({
        projection: result.projection,
        reductionPatch: result.reductionPatch,
        exitCode: result.exitCode
      })) {
    throw new Error('Repository Audit Source Program operation result is inconsistent');
  }
  return canonicalWireBytes({
    exitCode: result.exitCode,
    projection: result.projection,
    reductionPatch: result.reductionPatch,
    resultDigest: result.resultDigest
  });
}

export function parseSourceProgramAuditOperationResult(
  bytes: Uint8Array,
  maximumInputBytes: number
): SourceProgramAuditOperationResult {
  const parsed = requireCanonicalWireObject(
    bytes,
    maximumInputBytes,
    'Repository Audit Source Program operation result',
    OPERATION_RESULT_KEYS
  );
  if (!isPlainObject(parsed.projection)
      || (parsed.exitCode !== 0 && parsed.exitCode !== 1)
      || (parsed.reductionPatch !== null && !isPlainObject(parsed.reductionPatch))) {
    throw new Error('Repository Audit Source Program operation result shape is invalid');
  }
  const result = deepFreeze(parsed) as unknown as SourceProgramAuditOperationResult;
  if (result.resultDigest !== sha256({
    projection: result.projection,
    reductionPatch: result.reductionPatch,
    exitCode: result.exitCode
  })) {
    throw new Error('Repository Audit Source Program operation result digest differs');
  }
  return result;
}

function reductionProjection(
  reduction: SourceProgramAuditReduction,
  outputPath: string | null
): Readonly<Record<string, unknown>> {
  if (reduction.mode === 'none') return Object.freeze({});
  if (reduction.mode === 'version') {
    return Object.freeze({ versionReductionPlan: Object.freeze({
      planDigest: reduction.plan.planDigest,
      sourceRevision: reduction.plan.sourceRevision,
      ready: reduction.plan.reductions.filter(({ status }) => status === 'ready').length,
      blocked: reduction.plan.reductions.filter(({ status }) => status === 'blocked').length,
      locations: reduction.plan.reductions.reduce(
        (total, item) => total + item.locations.length,
        0
      ),
      patchDigest: reduction.patch?.patchDigest ?? null,
      changedFiles: reduction.patch?.files.length ?? 0,
      outputPath,
      blockedReductions: reduction.plan.reductions
        .filter(({ status }) => status === 'blocked')
        .map(({ currentName, declarationPaths, reason }) => ({
          currentName,
          declarationPaths,
          reason
        }))
    }) });
  }
  if (reduction.mode === 'aggregate-import') {
    return Object.freeze({ aggregateImportPlan: Object.freeze({
      planDigest: reduction.plan.planDigest,
      sourceRevision: reduction.plan.sourceRevision,
      architectureDigest: reduction.plan.architectureDigest,
      snapshotStatus: reduction.plan.snapshotStatus,
      snapshotReason: reduction.plan.snapshotReason,
      ready: reduction.plan.reductions.filter(({ status }) => status === 'ready').length,
      blocked: reduction.plan.reductions.filter(({ status }) => status === 'blocked').length,
      patchDigest: reduction.patch?.patchDigest ?? null,
      changedFiles: reduction.patch?.files.length ?? 0,
      outputPath,
      blockedReductions: reduction.plan.reductions
        .filter(({ status }) => status === 'blocked')
        .map(({ moduleSpecifier, path, reason }) => ({ moduleSpecifier, path, reason }))
    }) });
  }
  return Object.freeze({ graphCutPlan: Object.freeze({
    planDigest: reduction.plan.planDigest,
    evidenceDigest: reduction.plan.evidenceDigest,
    verificationDigest: reduction.plan.verificationDigest,
    sourceRevision: reduction.plan.sourceRevision,
    ready: reduction.plan.reductions.filter(({ status }) => status === 'ready').length,
    blocked: reduction.plan.reductions.filter(({ status }) => status === 'blocked').length,
    patchDigest: reduction.patch?.patchDigest ?? null,
    changedFiles: reduction.patch?.files.length ?? 0,
    outputPath,
    blockedReductions: reduction.plan.reductions
      .filter(({ status }) => status === 'blocked')
      .map(({ name, path, reason }) => ({ name, path, reason }))
  }) });
}

/**
 * Pure Repository Audit domain operation. All Effectful observations and all
 * process-local issuer checks are completed by the parent before this call.
 * Unknown caller properties are deliberately outside this in-process domain
 * contract and never enter the projection or result digest.
 */
export function compileSourceProgramAuditOperationInput(
  input: CompileSourceProgramAuditOperationInput
): SourceProgramAuditOperationInput {
  assertFacts(input);
  const full = input.options.full;
  const candidates = input.blockingCandidates;
  const testFindings = input.blockingTestFindings;
  const unknownDispositionClusters = input.unknownDispositionClusters;
  const compactBlockingTestFindings = testFindings.filter(({ disposition }) =>
    disposition?.disposition !== 'unknown');
  const compactDispositions = input.testDisposition.dispositions.filter(({ disposition }) =>
    disposition !== 'unknown');
  const compactFindings = input.testDisposition.findings.filter(({ disposition }) =>
    disposition?.disposition !== 'unknown');
  const blockingReasons = Object.freeze([
    ...(candidates.length > 0 ? ['source-program-candidates'] : []),
    ...(input.implementationDominance.findings.length > 0
      ? ['implementation-dominance'] : []),
    ...(input.reconciliation.status === 'unresolved' ? ['reconciliation-unresolved'] : []),
    ...(input.architectureEvolution.status === 'blocked' ? ['architecture-evolution'] : []),
    ...(testFindings.length > 0 ? ['test-value-findings'] : []),
    ...(input.supersession.status === 'owner-decision-required'
      ? ['supersession-owner-decision'] : []),
    ...(input.moduleArchitecture.violations.length > 0 ? ['module-architecture'] : [])
  ].sort(compareCodeUnits));
  const projection = Object.freeze({
    architecture: full ? Object.freeze({
      feedbackProjections: input.moduleArchitecture.feedbackCuts,
      reciprocalPairs: input.moduleArchitecture.reciprocalPairs,
      strongComponents: input.moduleArchitecture.strongComponents,
      violations: input.moduleArchitecture.violations
    }) : Object.freeze({
      evidenceDigest: sha256(Object.freeze({
        feedbackProjections: input.moduleArchitecture.feedbackCuts,
        reciprocalPairs: input.moduleArchitecture.reciprocalPairs,
        strongComponents: input.moduleArchitecture.strongComponents,
        violations: input.moduleArchitecture.violations
      })),
      feedbackProjections: input.moduleArchitecture.feedbackCuts.length,
      reciprocalPairs: input.moduleArchitecture.reciprocalPairs.length,
      strongComponents: input.moduleArchitecture.strongComponents.length,
      violations: input.moduleArchitecture.violations.length
    }),
    modelDigest: input.sourceProgram.modelDigest,
    sourceRevision: input.sourceProgram.sourceRevision,
    sourceProgramCompilation: input.sourceProgramCompilation,
    declarationTopology: full ? input.declarationTopology : Object.freeze({
      compilationReceiptDigest: input.declarationTopology.compilationReceiptDigest,
      topologyDigest: input.declarationTopology.topologyDigest,
      declarations: input.declarationTopology.declarations.length,
      edges: input.declarationTopology.edges.length,
      strongComponents: input.declarationTopology.strongComponents.length,
      cyclicComponents: input.declarationTopology.strongComponents.filter(
        ({ declarationObservationIds }) => declarationObservationIds.length > 1
      ).length,
      unknowns: input.declarationTopology.unknowns.length
    }),
    cache: input.cache,
    invalidatedTypeScriptPaths: full
      ? input.invalidatedTypeScriptPaths
      : compactRecordSet(input.invalidatedTypeScriptPaths),
    implementationDominance: full
      ? input.implementationDominance
      : Object.freeze({
          compilationDigest: input.implementationDominance.compilationDigest,
          units: compactRecordSet(input.implementationDominance.units),
          findings: compactRecordSet(input.implementationDominance.findings),
          dispositions: Object.fromEntries(
            [...new Set(input.implementationDominance.findings.map(({ disposition }) => disposition))]
              .sort(compareCodeUnits)
              .map((disposition) => [
                disposition,
                input.implementationDominance.findings.filter((finding) =>
                  finding.disposition === disposition).length
              ])
          )
        }),
    reconciliation: full ? input.reconciliation : Object.freeze({
      status: input.reconciliation.status,
      projectionDigest: input.reconciliation.projectionDigest,
      before: input.reconciliation.before,
      after: input.reconciliation.after,
      changes: input.reconciliation.changes.length,
      frontiers: input.reconciliation.frontiers.length,
      providerEvidence: input.reconciliation.providerEvidence,
      unresolvedReasons: compactRecordSet(input.reconciliation.unresolvedReasons)
    }),
    architectureEvolution: full ? input.architectureEvolution : Object.freeze({
      status: input.architectureEvolution.status,
      direction: input.architectureEvolution.direction,
      referenceDigest: input.architectureEvolution.referenceDigest,
      before: input.architectureEvolution.before,
      after: input.architectureEvolution.after,
      changes: input.architectureEvolution.changes.length,
      changedPaths: compactRecordSet(input.architectureEvolution.changedPaths),
      consumerPaths: compactRecordSet(input.architectureEvolution.consumerPaths),
      retirementPaths: compactRecordSet(input.architectureEvolution.retirementPaths),
      graphDelta: Object.fromEntries(Object.entries(input.architectureEvolution.graphDelta).map(
        ([name, values]) => [name, values.length]
      )),
      blockers: compactRecordSet(input.architectureEvolution.blockers)
    }),
    blockingCandidates: full ? candidates : compactRecordSet(candidates),
    blockingTestFindings: full
      ? testFindings
      : compactRecordSet(compactBlockingTestFindings),
    unknownDispositionClusters: full
      ? unknownDispositionClusters
      : compactRecordSet(unknownDispositionClusters),
    supersession: full ? input.supersession : Object.freeze({
      status: input.supersession.status,
      receiptDigest: input.supersession.receiptDigest,
      baseline: input.supersession.baseline,
      current: input.supersession.current,
      lifecycleCost: input.supersession.lifecycleCost,
      replacements: Object.freeze({
        entrypoint: input.supersession.replacements.filter(({ kind }) => kind === 'entrypoint').length,
        production: input.supersession.replacements.filter(({ kind }) => kind === 'production').length,
        resource: input.supersession.replacements.filter(({ kind }) => kind === 'resource').length,
        test: input.supersession.replacements.filter(({ kind }) => kind === 'test').length
      }),
      findings: compactRecordSet(input.supersession.findings)
    }),
    testRetirement: full ? input.testRetirement : Object.freeze({
      receiptDigest: input.testRetirement.receiptDigest,
      retired: input.testRetirement.proofs.filter(({ status }) => status === 'retired').length,
      blocked: input.testRetirement.proofs.filter(({ status }) => status === 'blocked').length,
      proofsDigest: sha256(input.testRetirement.proofs)
    }),
    topology: input.topology,
    testValue: Object.freeze({
      baselineDigest: input.testValue.baselineDigest,
      baselineEvidenceDigest: input.testValue.baselineEvidenceDigest,
      compilationDigest: input.testValue.compilationDigest,
      dispositionProjectionDigest: input.testDisposition.projectionDigest,
      supersessionReceiptDigest: input.testDisposition.supersessionReceiptDigest,
      baselineTestPaths: full
        ? input.testValue.baselineTestPaths
        : compactRecordSet(input.testValue.baselineTestPaths),
      dispositions: full ? input.testDisposition.dispositions : compactRecordSet(compactDispositions),
      findings: full ? input.testDisposition.findings : compactRecordSet(compactFindings),
      candidateRegistrationCensus: Object.freeze({
        count: input.testValue.candidateRegistrationCensus.count,
        digest: input.testValue.candidateRegistrationCensus.digest,
        ...(full ? {
          paths: input.testValue.candidateRegistrationCensus.paths
        } : {})
      }),
      recordsWithUnknownSemantics: input.testValue.recordsWithUnknownSemantics,
      semanticClasses: input.testValue.semanticClasses
    }),
    summary: Object.freeze({
      blockingCandidates: candidates.length,
      implementationDominanceFindings: input.implementationDominance.findings.length,
      implementationDominanceUnits: input.implementationDominance.units.length,
      reconciliationStatus: input.reconciliation.status,
      reconciliationChanges: input.reconciliation.changes.length,
      reconciliationFrontiers: input.reconciliation.frontiers.length,
      reconciliationUnresolvedReasons: input.reconciliation.unresolvedReasons.length,
      architectureEvolutionStatus: input.architectureEvolution.status,
      architectureEvolutionDirection: input.architectureEvolution.direction,
      architectureEvolutionBlockers: input.architectureEvolution.blockers.length,
      blockingTestFindings: testFindings.length,
      reportedBlockingTestFindings: (full ? testFindings : compactBlockingTestFindings).length,
      unknownDispositionClusters: unknownDispositionClusters.length,
      unknownDispositions: input.testDisposition.dispositions.filter(({ disposition }) =>
        disposition === 'unknown').length,
      architectureFeedbackProjections: input.moduleArchitecture.feedbackCuts.length,
      architectureReciprocalPairs: input.moduleArchitecture.reciprocalPairs.length,
      architectureStrongComponents: input.moduleArchitecture.strongComponents.length,
      supersessionStatus: input.supersession.status,
      supersessionFindings: input.supersession.findings.length,
      architectureViolations: input.moduleArchitecture.violations.length,
      capabilities: input.sourceProgram.counts.capabilities,
      candidates: input.sourceProgram.counts.candidates,
      declarations: input.sourceProgram.counts.declarations,
      dependencies: input.sourceProgram.counts.dependencies,
      entrypoints: input.sourceProgram.counts.entrypoints,
      entrypointClosures: input.sourceProgram.counts.entrypointClosures,
      files: input.sourceProgram.counts.files,
      literals: input.sourceProgram.counts.literals,
      packages: input.sourceProgram.counts.packages,
      references: input.sourceProgram.counts.references,
      baselineTestModules: input.testValue.baselineTestPaths.length,
      testDispositionRecords: input.testDisposition.dispositions.length,
      testRegistrations: input.testValue.candidateRegistrationCensus.count,
      unknowns: input.sourceProgram.counts.unknowns
    }),
    ...(input.options.queryProjection === null
      ? {}
      : { result: input.options.queryProjection }),
    ...reductionProjection(input.reduction, input.options.outputPath),
    ...(input.options.includeCandidates ? { candidates: input.sourceProgram.candidates } : {})
  });
  const reductionPatch = input.reduction.mode === 'none' ? null : input.reduction.patch;
  const compiled = Object.freeze({
    binding: Object.freeze({
      sourceRevision: input.sourceProgram.sourceRevision,
      modelDigest: input.sourceProgram.modelDigest,
      subjectDigest: input.sourceProgramCompilation.subjectDigest
    }),
    blockingReasons,
    enforce: input.options.enforce,
    projection,
    reductionPatch
  });
  assertOperationInput(compiled);
  return compiled;
}

export function compileSourceProgramAuditOperation(
  input: SourceProgramAuditOperationInput
): SourceProgramAuditOperationResult {
  assertOperationInput(input);
  const exitCode = input.enforce && input.blockingReasons.length > 0 ? 1 as const : 0 as const;
  const projection = input.projection;
  const reductionPatch = input.reductionPatch;
  const resultDigest = sha256({ projection, reductionPatch, exitCode }) as Digest;
  return Object.freeze({ projection, reductionPatch, exitCode, resultDigest });
}
