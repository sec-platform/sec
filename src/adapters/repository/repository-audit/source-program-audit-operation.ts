import {
  canonicalJson,
  compareCodeUnits,
  deepFreeze,
  isPlainObject,
  sha256
} from '../../../contracts/canonical.ts';
import {
  parseExactJsonBytes
} from '../../../contracts/exact-json.ts';
import type { RepositoryModuleArchitectureProjection } from '../architecture/contract.ts';
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

import {
  sourceProgramFindingDeltaIsUnresolved, summarizeSourceProgramFindingDelta,
  type SourceProgramFindingDelta
} from '../source-program-model/reconciliation-findings.ts';

import { compileSourceProgramMechanismReview, type SourceProgramMechanismReview } from './mechanism-review.ts';
import { REPOSITORY_AUDIT_WORKER_PROTOCOL_LIMITS } from './worker-protocol.ts';

const REDUCTION_MODES = new Set<string>(['none', 'version', 'graph-cut', 'aggregate-import']);
const BLOCKING_DETAIL_DOMAINS = new Set<string>([
  'priority', 'source-program', 'declaration-topology', 'test-retirement',
  'implementation-dominance', 'test-value', 'supersession', 'module-architecture'
]);
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

type SourceProgramAuditReductionPatch = Readonly<{
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

type SourceProgramAuditImplementationDominanceProjection = Readonly<{
  readonly sourceRevision: string;
  readonly sourceProgramModelDigest: string;
  readonly units: readonly unknown[];
  readonly findings: readonly Readonly<{ readonly disposition: string }>[];
  readonly compilationDigest: string;
}>;

type SourceProgramAuditReconciliationProjection = Readonly<{
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
  /** Absent only on older parent projections; never implied to have been checked. */
  readonly findingDelta?: SourceProgramFindingDelta;
  readonly frontiers: readonly unknown[];
  readonly providerEvidence: readonly unknown[];
  readonly unresolvedReasons: readonly unknown[];
  readonly projectionDigest: Digest;
}>;

type SourceProgramAuditArchitectureEvolutionProjection = Readonly<{
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

type SourceProgramAuditSupersessionProjection = Readonly<{
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

type SourceProgramAuditTestRetirementProjection = Readonly<{
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
    readonly unknownDigests: readonly string[];
    readonly unknownsDigest: string;
    /** Nonblocking diagnostic view; older in-process projections may omit it. */
    readonly mechanismReview?: SourceProgramMechanismReview;
    readonly candidates: readonly SourceProgramCandidate[];
    readonly unknowns: SourceProgramModel['unknowns'];
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
  readonly moduleArchitecture: RepositoryModuleArchitectureProjection;
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
    readonly strongComponents: readonly Readonly<{ readonly declarationObservationIds: readonly string[] }> [];
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
    readonly blockingDetails: boolean;
    readonly blockingDetailsDomain: 'priority' | 'source-program' | 'declaration-topology'
      | 'test-retirement' | 'implementation-dominance' | 'test-value'
      | 'supersession' | 'module-architecture';
    readonly blockingDetailsPage: number;
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

export const BLOCKING_DETAILS_PAGE_MAXIMUM_BYTES =
  REPOSITORY_AUDIT_WORKER_PROTOCOL_LIMITS.maximumOperationInputBytes / 8;

export class SourceProgramAuditBlockingDetailError extends Error {
  readonly code = 'blocking-detail-record-too-large';
  constructor(
    readonly domain: string,
    readonly index: number,
    readonly recordDigest: string,
    readonly recordBytes: number
  ) {
    super(
      `Repository Audit blocking-detail record exceeds its page budget: ${domain}:${index}:${recordDigest}:${recordBytes}`
    );
    this.name = 'SourceProgramAuditBlockingDetailError';
  }
}

function pagedRecordSet<T>(
  domain: string,
  records: readonly T[],
  page: number
): Readonly<{
  count: number;
  digest: string;
  page: number;
  pageCount: number;
  pageMaximumBytes: number;
  records: readonly T[];
}> {
  const selected: T[] = [];
  let currentPage = 0;
  let currentRecordCount = 0;
  let currentBytes = 2;
  for (const [index, record] of records.entries()) {
    const recordBytes = canonicalWireBytes(record).byteLength;
    if (recordBytes + 2 > BLOCKING_DETAILS_PAGE_MAXIMUM_BYTES) {
      throw new SourceProgramAuditBlockingDetailError(
        domain, index, sha256(record), recordBytes
      );
    }
    const nextBytes = currentBytes + recordBytes + (currentRecordCount === 0 ? 0 : 1);
    if (currentRecordCount > 0 && nextBytes > BLOCKING_DETAILS_PAGE_MAXIMUM_BYTES) {
      currentPage++;
      currentRecordCount = 0;
      currentBytes = 2;
    }
    if (currentPage === page) selected.push(record);
    currentBytes += recordBytes + (currentRecordCount === 0 ? 0 : 1);
    currentRecordCount++;
  }
  return Object.freeze({
    count: records.length,
    digest: sha256(records),
    page,
    pageCount: records.length === 0 ? 0 : currentPage + 1,
    pageMaximumBytes: BLOCKING_DETAILS_PAGE_MAXIMUM_BYTES,
    records: Object.freeze(selected)
  });
}

type BlockingDetailRecord = Readonly<{ readonly category: string; readonly record: unknown }>;

function blockingDetailRecords(
  input: CompileSourceProgramAuditOperationInput,
  domain: CompileSourceProgramAuditOperationInput['options']['blockingDetailsDomain']
): readonly BlockingDetailRecord[] {
  const tagged = (category: string, records: readonly unknown[]): readonly BlockingDetailRecord[] =>
    Object.freeze(records.map((record) => Object.freeze({ category, record })));
  switch (domain) {
    case 'priority':
      return Object.freeze([
        ...tagged('blocking-candidate', input.blockingCandidates),
        ...tagged('blocking-test-finding', input.blockingTestFindings)
      ]);
    case 'source-program': return tagged('source-program-unknown', input.sourceProgram.unknowns);
    case 'declaration-topology':
      return tagged('declaration-topology-unknown', input.declarationTopology.unknowns);
    case 'test-retirement':
      return tagged('blocked-test-retirement-proof', input.testRetirement.proofs
        .filter(({ status }) => status === 'blocked'));
    case 'implementation-dominance':
      return tagged('implementation-dominance-finding', input.implementationDominance.findings);
    case 'test-value':
      return Object.freeze([
        ...tagged('blocking-test-finding', input.blockingTestFindings),
        ...tagged('unknown-test-disposition', input.unknownDispositionClusters)
      ]);
    case 'supersession': return tagged('supersession-finding', input.supersession.findings);
    case 'module-architecture':
      return tagged('module-architecture-violation', input.moduleArchitecture.violations);
  }
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
  includeCandidates: boolean,
  includeUnknowns = false
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
    mechanismReview: compileSourceProgramMechanismReview(model),
    candidateDigests: Object.freeze(model.candidates.map((candidate) => sha256(candidate))),
    unknownDigests: Object.freeze(model.unknowns.map((unknown) => sha256(unknown))),
    unknownsDigest: sha256(model.unknowns),
    candidates: includeCandidates ? model.candidates : Object.freeze([]),
    unknowns: includeUnknowns ? model.unknowns : Object.freeze([]),
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
      || input.sourceProgram.unknownDigests.length !== input.sourceProgram.counts.unknowns
      || input.sourceProgram.candidates.length !== (
        input.options.includeCandidates ? input.sourceProgram.counts.candidates : 0
      )) {
    throw new Error('Source Program projection is not bound to its exact fact set');
  }
  const mechanisms = input.sourceProgram.mechanismReview;
  if (mechanisms !== undefined && (
    mechanisms.sourceRevision !== input.sourceProgram.sourceRevision
    || mechanisms.modelDigest !== input.sourceProgram.modelDigest
    || mechanisms.coverage.files !== input.sourceProgram.counts.files
  )) {
    throw new Error('Mechanism review is not bound to the Source Program projection');
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
  const delta = input.reconciliation.findingDelta;
  if (delta !== undefined && (
    delta.before.sourceRevision !== input.reconciliation.before.sourceRevision
    || delta.before.modelDigest !== input.reconciliation.before.modelDigest
    || delta.after.sourceRevision !== input.reconciliation.after.sourceRevision
    || delta.after.modelDigest !== input.reconciliation.after.modelDigest
    || (sourceProgramFindingDeltaIsUnresolved(delta) && input.reconciliation.status !== 'unresolved')
  )) {
    throw new Error('Finding reconciliation is not bound to the compared models or unresolved state');
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
  const unknownDigests = new Set(input.sourceProgram.unknownDigests);
  if (input.options.blockingDetails
      && input.options.blockingDetailsDomain === 'source-program' && (
    input.sourceProgram.unknowns.length !== input.sourceProgram.counts.unknowns
    || sha256(input.sourceProgram.unknowns) !== input.sourceProgram.unknownsDigest
    || input.sourceProgram.unknowns.some((unknown) => !unknownDigests.has(sha256(unknown)))
  )) {
    throw new Error('Blocking-detail unknown projection is not the exact Source Program unknown set');
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

function operationExitCode(enforce: boolean, reasons: readonly string[]): 0 | 1 {
  return enforce && reasons.length > 0 ? 1 : 0;
}

function readEnforcement(projection: Readonly<Record<string, unknown>>): Readonly<{
  requested: boolean; blockingReasons: readonly string[];
}> {
  const enforcement = projection.enforcement;
  if (!isPlainObject(enforcement) || typeof enforcement.requested !== 'boolean'
      || !Array.isArray(enforcement.blockingReasons)) {
    throw new Error('Repository Audit report is missing an explicit enforcement decision');
  }
  const reasons = enforcement.blockingReasons as unknown[];
  for (const reason of reasons) {
    if (typeof reason !== 'string' || reason.length === 0 || reason.trim() !== reason) {
      throw new Error('Repository Audit report has invalid blocking reasons');
    }
  }
  if (new Set(reasons).size !== reasons.length) {
    throw new Error('Repository Audit report repeats a blocking reason');
  }
  return enforcement as { requested: boolean; blockingReasons: readonly string[] };
}

function assertResultDecision(projection: Readonly<Record<string, unknown>>, exitCode: number): void {
  const enforcement = readEnforcement(projection);
  if (exitCode !== operationExitCode(enforcement.requested, enforcement.blockingReasons)) {
    throw new Error('Repository Audit result exit code contradicts its reported enforcement decision');
  }
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
  const enforcement = readEnforcement(input.projection);
  if (enforcement.requested !== input.enforce
      || enforcement.blockingReasons.length !== input.blockingReasons.length
      || enforcement.blockingReasons.some((reason, index) => reason !== input.blockingReasons[index])) {
    throw new Error('Repository Audit input contradicts its reported enforcement decision');
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
  assertResultDecision(result.projection, result.exitCode);
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
  assertResultDecision(result.projection, result.exitCode);
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
  if (!Number.isSafeInteger(input.options.blockingDetailsPage)
      || input.options.blockingDetailsPage < 0) {
    throw new Error('Repository Audit blocking-detail page must be a non-negative safe integer');
  }
  if (!BLOCKING_DETAIL_DOMAINS.has(input.options.blockingDetailsDomain)) {
    throw new Error(`Unsupported Repository Audit blocking-detail domain: ${input.options.blockingDetailsDomain}`);
  }
  if (!input.options.blockingDetails && (
    input.options.blockingDetailsPage !== 0 || input.options.blockingDetailsDomain !== 'priority'
  )) {
    throw new Error('Repository Audit blocking-detail selectors require blocking details');
  }
  if (input.options.blockingDetails && input.options.full) {
    throw new Error('Repository Audit blocking details cannot be combined with the full projection');
  }
  if (!Number.isSafeInteger(input.sourceProgram.counts.unknowns)
      || input.sourceProgram.counts.unknowns < 0) {
    throw new Error('Source Program unknown observation count is invalid');
  }
  assertFacts(input);
  const full = input.options.full;
  const blockingDetails = input.options.blockingDetails;
  const blockingDetailsPage = input.options.blockingDetailsPage;
  const blockingDetailsDomain = input.options.blockingDetailsDomain;
  const detailsFor = (...domains: readonly typeof blockingDetailsDomain[]): boolean =>
    blockingDetails && domains.includes(blockingDetailsDomain);
  const blockingDetailsProjection = blockingDetails
    ? pagedRecordSet(
        blockingDetailsDomain,
        blockingDetailRecords(input, blockingDetailsDomain),
        blockingDetailsPage
      )
    : null;
  const candidates = input.blockingCandidates;
  const testFindings = input.blockingTestFindings;
  const unknownDispositionClusters = input.unknownDispositionClusters;
  const compactBlockingTestFindings = testFindings.filter(({ disposition }) =>
    disposition?.disposition !== 'unknown');
  const compactDispositions = input.testDisposition.dispositions.filter(({ disposition }) =>
    disposition !== 'unknown');
  const compactFindings = input.testDisposition.findings.filter(({ disposition }) =>
    disposition?.disposition !== 'unknown');
  // Enforcement owns transition safety, while the complete current inventory
  // remains visible in the report for migration and review.  Treating the
  // absolute inventory as a candidate failure makes an exact self-comparison
  // fail forever on pre-existing findings and contradicts the already-issued
  // reconciliation, architecture-evolution and supersession receipts.
  //
  // A missing comparison is not permission: current producers always issue a
  // finding delta, so its absence remains a fail-closed protocol boundary.
  const findingDelta = input.reconciliation.findingDelta;
  const findingRegression = findingDelta !== undefined
    && (findingDelta.counts.introduced > 0 || findingDelta.counts.changed > 0);
  const blockingReasons = Object.freeze([
    ...(input.testRetirement.proofs.some(({ status }) => status === 'blocked')
      ? ['test-retirement-blocked'] : []),
    ...(findingDelta === undefined ? ['finding-reconciliation-unavailable'] : []),
    ...(findingRegression ? ['source-program-finding-regression'] : []),
    ...(input.reconciliation.status === 'unresolved' ? ['reconciliation-unresolved'] : []),
    ...(input.architectureEvolution.status === 'blocked' ? ['architecture-evolution'] : []),
    ...(testFindings.length > 0 && input.supersession.status !== 'equivalent'
      ? ['test-value-findings'] : []),
    ...(input.supersession.status === 'owner-decision-required'
      ? ['supersession-owner-decision'] : []),
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
    // Both presentation modes expose the exact reasons consumed by the exit
    // decision. This is not an independent success or authority declaration.
    enforcement: Object.freeze({
      requested: input.options.enforce,
      blockingReasons
    }),
    // Mechanism findings are review leads, never new blocking reasons or
    // rewrite authority. Compact output retains coverage and its full digest.
    ...(input.sourceProgram.mechanismReview === undefined ? {} : {
      mechanisms: full ? input.sourceProgram.mechanismReview : Object.freeze({
        authority: input.sourceProgram.mechanismReview.authority,
        sourceRevision: input.sourceProgram.mechanismReview.sourceRevision,
        modelDigest: input.sourceProgram.mechanismReview.modelDigest,
        reviewDigest: input.sourceProgram.mechanismReview.reviewDigest,
        coverage: input.sourceProgram.mechanismReview.coverage,
        counts: input.sourceProgram.mechanismReview.counts
      })
    }),

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
      unresolvedReasons: compactRecordSet(input.reconciliation.unresolvedReasons),
      ...(input.reconciliation.findingDelta === undefined ? {} : {
        findingDelta: summarizeSourceProgramFindingDelta(input.reconciliation.findingDelta)
      })
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
    sourceProgramUnknowns: Object.freeze({
      count: input.sourceProgram.counts.unknowns,
      digest: input.sourceProgram.unknownsDigest
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
    ...(blockingDetailsProjection === null ? {} : {
      blockingDetails: blockingDetailsProjection
    }),
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
      reportedBlockingTestFindings: full
        ? testFindings.length
        : compactBlockingTestFindings.length + (detailsFor('priority', 'test-value')
          ? blockingDetailsProjection!.records.filter(({ category, record }) =>
              category === 'blocking-test-finding'
              && (record as SourceProgramTestFinding).disposition?.disposition === 'unknown'
            ).length
          : 0),
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
  const exitCode = operationExitCode(input.enforce, input.blockingReasons);
  const projection = input.projection;
  const reductionPatch = input.reductionPatch;
  const resultDigest = sha256({ projection, reductionPatch, exitCode }) as Digest;
  return Object.freeze({ projection, reductionPatch, exitCode, resultDigest });
}
