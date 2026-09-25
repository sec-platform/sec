import { compareCodeUnits, sha256 } from '../../../contracts/canonical.ts';
import { isRepositoryTestModulePath } from '../../../contracts/repository-test-path.ts';
import {
  resolveSourceProgramCompilationOperation,
  sourceProgramCompilationCheckpoint,
  type SourceProgramCompilationOperation
} from './compilation-operation.ts';
import type {
  SourceProgramFileInput,
  SourceProgramModel,
  SourceProgramSpan,
  SourceProgramSupersessionReceipt
} from './contract.ts';
import {
  observeTestContractCensus,
  TEST_CONTRACT_CENSUS_UNRESOLVED_REASONS,
  testObservationsForFiles,
  type TestContractCensusUnresolvedReason,
  type TestSemanticClass
} from './test-observations.ts';

export type { TestSemanticClass } from './test-observations.ts';

export type SourceProgramTestFindingCode =
  | 'test-module-missing-from-worktree'
  | 'test-module-disposition-unbound'
  | 'test-module-disposition-unknown'
  | 'test-module-disposition-invalid'
  | 'test-module-disposition-outside-baseline'
  | 'test-module-delete-contract-not-empty'
  | 'test-module-replacement-unresolved'
  | 'test-module-without-registration'
  | 'test-observation-receipt-unresolved'
  | 'test-reads-production-source-text'
  | 'test-mirrors-production-path-layout'
  | 'test-mirrors-imported-function-arity'
  | 'test-oracle-derived-from-production-subject'
  | 'test-asserts-only-version-identity';

export const SOURCE_PROGRAM_BLOCKING_TEST_FINDING_CODES = Object.freeze([
  'test-module-missing-from-worktree',
  'test-module-disposition-unbound',
  'test-module-disposition-unknown',
  'test-module-disposition-invalid',
  'test-module-disposition-outside-baseline',
  'test-module-delete-contract-not-empty',
  'test-module-replacement-unresolved',
  'test-module-without-registration',
  'test-observation-receipt-unresolved',
  'test-reads-production-source-text',
  'test-mirrors-production-path-layout',
  'test-mirrors-imported-function-arity',
  'test-oracle-derived-from-production-subject',
  'test-asserts-only-version-identity'
] as const satisfies readonly SourceProgramTestFindingCode[]);

type SourceProgramTestDispositionKind =
  | 'keep'
  | 'rewrite'
  | 'merge'
  | 'delete'
  | 'unknown';

interface SourceProgramTestDispositionCensus {
  readonly producerCount: number;
  readonly consumerCount: number;
  readonly externalContractCount: number;
}

interface SourceProgramTestDispositionEvidence {
  /** Canonical owner that is accountable for this disposition. */
  readonly owner: string;
  /** Source revision against which the owner made the census. */
  readonly sourceRevision: string;
  /** Current test registrations that replace or absorb a missing test. */
  readonly replacementTestIds: readonly string[];
  /** Producer/consumer/external-contract evidence for a deletion decision. */
  readonly census: SourceProgramTestDispositionCensus;
  /** Exact Source Program proof that authorizes a derived DELETE or MERGE. */
  readonly supersession: Readonly<{
    readonly receiptDigest: string;
    readonly baselineTestId: string;
    readonly proof: 'consumer-zero' | 'strict-observation-superset';
  }> | null;
  /** Exact digest of a repository-owner REWRITE decision, otherwise null. */
  readonly ownerDecisionDigest: string | null;
}

/**
 * Machine-derived facts for a tracked test in the baseline revision.  These
 * facts are deliberately narrower than an owner disposition: they can prove
 * an empty graph, but they can never infer a replacement or a semantic merge.
 */
export interface SourceProgramTestBaselineEvidence {
  readonly path: string;
  readonly baselineRevision: string;
  readonly observationStatus: 'resolved' | 'unresolved';
  readonly observationReason: TestContractCensusUnresolvedReason | null;
  readonly observationDigest: string;
  readonly census: SourceProgramTestDispositionCensus;
}

export interface SourceProgramTestDisposition {
  readonly path: string;
  readonly disposition: SourceProgramTestDispositionKind;
  readonly evidence: SourceProgramTestDispositionEvidence;
  /** Digest of the complete tracked test baseline used for this decision. */
  readonly baselineDigest: string;
  /** Digest of the normalized disposition and evidence. */
  readonly evidenceDigest: string;
}

/**
 * Compact owner-facing projection of unresolved baseline dispositions.
 *
 * The full disposition records remain available for `--full` output and are
 * part of the compilation digest.  The normal audit projection should not
 * make an owner sift through one repeated record per missing test.  This
 * summary is derived from the records and never decides a disposition: it
 * only groups already-blocking UNKNOWN evidence by accountable owner and
 * finding code.
 */
export interface SourceProgramTestUnknownDispositionCluster {
  readonly owner: string;
  readonly disposition: 'unknown';
  readonly findingCodes: readonly SourceProgramTestFindingCode[];
  readonly dispositionCount: number;
  readonly paths: readonly string[];
  readonly pathsDigest: string;
  readonly census: Readonly<{
    producerCount: number;
    consumerCount: number;
    externalContractCount: number;
  }>;
}

export interface SourceProgramTestFinding {
  readonly code: SourceProgramTestFindingCode;
  readonly path: string;
  readonly detail: string;
  readonly span: SourceProgramSpan | null;
  readonly disposition: SourceProgramTestDisposition | null;
}

export interface SourceProgramTestRegistration {
  readonly testId: string;
  readonly path: string;
  readonly kind: string;
  readonly title: string | null;
  readonly span: SourceProgramSpan;
  readonly semanticClasses: readonly TestSemanticClass[];
  readonly observedProductionPaths: readonly string[];
  readonly capabilityOperations: readonly string[];
  readonly assertionCount: number;
  readonly unknowns: readonly string[];
}

export interface SourceProgramTestValueCompilation {
  readonly sourceRevision: string;
  readonly baselineTestPaths: readonly string[];
  readonly baselineDigest: string;
  readonly baselineEvidenceDigest: string;
  readonly dispositions: readonly SourceProgramTestDisposition[];
  readonly records: readonly SourceProgramTestRegistration[];
  readonly findings: readonly SourceProgramTestFinding[];
  readonly compilationDigest: string;
}

/**
 * One-way decision projection produced after Supersession has consumed Test
 * Value observations.  It intentionally is not a Test Value compilation, so
 * it cannot be fed back into Supersession as a new proof preimage.
 */
export interface SourceProgramTestDispositionProjection {
  readonly sourceRevision: string;
  readonly baselineTestPaths: readonly string[];
  readonly baselineDigest: string;
  readonly baselineEvidenceDigest: string;
  readonly dispositions: readonly SourceProgramTestDisposition[];
  readonly findings: readonly SourceProgramTestFinding[];
  readonly observationCompilationDigest: string;
  readonly supersessionReceiptDigest: string | null;
  readonly projectionDigest: string;
}

export interface CompileSourceProgramTestValueInput {
  readonly repositoryRoot: string;
  readonly files: readonly SourceProgramFileInput[];
  readonly model: SourceProgramModel;
  readonly operation?: SourceProgramCompilationOperation;
  /** Tracked test paths from the baseline; callers should derive this from Git. */
  readonly baselineTestPaths?: readonly string[];
  /** Strict owner dispositions for baseline tests absent from the candidate. */
  readonly dispositions?: readonly unknown[];
  /**
   * Exact baseline contract census.  The audit entrypoint derives this from
   * baseline Git blobs; callers must not hand-author deletion evidence.
   */
  readonly baselineEvidence?: readonly unknown[];
}

const GOVERNED_TEXT_DOCUMENT = /^(?:AGENTS\.md|\.agents\/skills\/.+\/SKILL\.md|\.github\/workflows\/[^/]+\.ya?ml)$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const OWNER_ID = /^[A-Za-z][A-Za-z0-9._-]{0,127}$/u;
const DISPOSITION_KINDS = Object.freeze([
  'keep',
  'rewrite',
  'merge',
  'delete',
  'unknown'
] as const);

function dispositionError(field: string, detail: string): never {
  throw new Error(`invalid source-program test disposition ${field}: ${detail}`);
}

function exactRecord(input: unknown, field: string): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return dispositionError(field, 'expected an object');
  }
  return input as Record<string, unknown>;
}

function exactKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  field: string
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(record)) {
    if (!allowedSet.has(key)) dispositionError(`${field}.${key}`, 'unknown field');
  }
}

function requiredString(
  record: Record<string, unknown>,
  key: string,
  field: string,
  pattern?: RegExp
): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    return dispositionError(`${field}.${key}`, 'expected a non-empty string');
  }
  if (pattern !== undefined && !pattern.test(value)) {
    return dispositionError(`${field}.${key}`, 'has an invalid format');
  }
  return value;
}

function requiredStringArray(
  record: Record<string, unknown>,
  key: string,
  field: string
): readonly string[] {
  const value = record[key];
  if (!Array.isArray(value)) return dispositionError(`${field}.${key}`, 'expected an array');
  const entries = value.map((entry, index) => {
    if (typeof entry !== 'string' || !DIGEST.test(entry)) {
      return dispositionError(`${field}.${key}[${index}]`, 'expected a sha256 digest');
    }
    return entry;
  });
  if (new Set(entries).size !== entries.length) {
    return dispositionError(`${field}.${key}`, 'entries must be unique');
  }
  return Object.freeze(entries.sort(compareCodeUnits));
}

function requiredCount(
  record: Record<string, unknown>,
  key: string,
  field: string
): number {
  const value = record[key];
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    return dispositionError(`${field}.${key}`, 'expected a non-negative safe integer');
  }
  return value as number;
}

function canonicalTestPath(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    return dispositionError(field, 'expected a non-empty test path');
  }
  const normalized = value.replaceAll('\\', '/');
  if (normalized !== value || !isRepositoryTestModulePath(normalized)
      || normalized.includes('/../') || normalized.startsWith('../')
      || normalized.includes('/./') || normalized.endsWith('/.')) {
    return dispositionError(field, 'expected a canonical repository-relative test path');
  }
  return normalized;
}

function canonicalBaselinePaths(paths: readonly string[]): readonly string[] {
  const normalized = paths.map((value, index) => canonicalTestPath(value, `baselineTestPaths[${index}]`));
  const unique = [...new Set(normalized)].sort(compareCodeUnits);
  if (unique.length !== normalized.length) {
    return dispositionError('baselineTestPaths', 'entries must be unique');
  }
  return Object.freeze(unique);
}

function sourceProgramTestBaselineDigest(
  baselineTestPaths: readonly string[]
): string {
  return sha256(canonicalBaselinePaths(baselineTestPaths));
}

function canonicalBaselineEvidence(
  input: unknown,
  baselineTestPaths: readonly string[]
): SourceProgramTestBaselineEvidence {
  const record = exactRecord(input, 'baselineEvidence');
  exactKeys(record, [
    'path',
    'baselineRevision',
    'observationStatus',
    'observationReason',
    'observationDigest',
    'census'
  ], 'baselineEvidence');
  const pathValue = canonicalTestPath(record.path, 'baselineEvidence.path');
  if (!new Set(baselineTestPaths).has(pathValue)) {
    return dispositionError(
      'baselineEvidence.path',
      'is not present in the tracked baseline census'
    );
  }
  const baselineRevision = requiredString(
    record, 'baselineRevision', 'baselineEvidence', DIGEST
  );
  const observationStatus = requiredString(
    record, 'observationStatus', 'baselineEvidence'
  );
  if (observationStatus !== 'resolved' && observationStatus !== 'unresolved') {
    return dispositionError(
      'baselineEvidence.observationStatus',
      'expected resolved or unresolved'
    );
  }
  const observationReason = record.observationReason;
  if (observationStatus === 'resolved' && observationReason !== null) {
    return dispositionError(
      'baselineEvidence.observationReason',
      'resolved evidence must not have an unresolved reason'
    );
  }
  if (observationStatus === 'unresolved'
      && (typeof observationReason !== 'string'
        || !TEST_CONTRACT_CENSUS_UNRESOLVED_REASONS.includes(
          observationReason as TestContractCensusUnresolvedReason
        ))) {
    return dispositionError(
      'baselineEvidence.observationReason',
      'unresolved evidence requires one canonical reason'
    );
  }
  const censusRecord = exactRecord(record.census, 'baselineEvidence.census');
  exactKeys(
    censusRecord,
    ['producerCount', 'consumerCount', 'externalContractCount'],
    'baselineEvidence.census'
  );
  return Object.freeze({
    path: pathValue,
    baselineRevision,
    observationStatus,
    observationReason: observationReason as TestContractCensusUnresolvedReason | null,
    observationDigest: requiredString(
      record, 'observationDigest', 'baselineEvidence', DIGEST
    ),
    census: Object.freeze({
      producerCount: requiredCount(censusRecord, 'producerCount', 'baselineEvidence.census'),
      consumerCount: requiredCount(censusRecord, 'consumerCount', 'baselineEvidence.census'),
      externalContractCount: requiredCount(
        censusRecord, 'externalContractCount', 'baselineEvidence.census'
      )
    })
  });
}

function sourceProgramTestBaselineEvidenceDigest(
  evidence: readonly SourceProgramTestBaselineEvidence[]
): string {
  return sha256([...evidence]
    .map(({
      path: repositoryPath,
      baselineRevision,
      observationStatus,
      observationReason,
      observationDigest,
      census
    }) => ({
      path: repositoryPath,
      baselineRevision,
      observationStatus,
      observationReason,
      observationDigest,
      census
    }))
    .sort((left, right) => compareCodeUnits(left.path, right.path)));
}

function dispositionFromEvidence(
  pathValue: string,
  disposition: SourceProgramTestDispositionKind,
  sourceRevision: string,
  baselineDigest: string,
  census: SourceProgramTestDispositionCensus,
  replacementTestIds: readonly string[] = [],
  supersession: SourceProgramTestDispositionEvidence['supersession'] = null
): SourceProgramTestDisposition {
  const evidence: SourceProgramTestDispositionEvidence = Object.freeze({
    owner: 'source-program-test-value',
    sourceRevision,
    replacementTestIds: Object.freeze([...replacementTestIds].sort(compareCodeUnits)),
    census: Object.freeze({ ...census }),
    supersession,
    ownerDecisionDigest: null
  });
  const normalized = {
    path: pathValue,
    disposition,
    evidence,
    baselineDigest
  };
  return Object.freeze({
    ...normalized,
    evidenceDigest: sha256(normalized)
  });
}

/**
 * Project baseline census into bounded UNKNOWN evidence.  Census is an input
 * to retirement proof, not retirement authority: even a syntactically empty
 * graph cannot sign DELETE without a Source Program supersession receipt.
 */
function deriveSourceProgramTestDispositions(
  baselineTestPaths: readonly string[],
  baselineEvidence: readonly SourceProgramTestBaselineEvidence[],
  sourceRevision: string,
  existingDispositionPaths: readonly string[] = [],
  candidateTestPaths: readonly string[] | undefined = undefined
): readonly SourceProgramTestDisposition[] {
  const baselineDigest = sourceProgramTestBaselineDigest(baselineTestPaths);
  const existing = new Set(existingDispositionPaths);
  const candidate = candidateTestPaths === undefined ? null : new Set(candidateTestPaths);
  const byPath = new Map<string, SourceProgramTestBaselineEvidence>();
  for (const evidence of baselineEvidence) {
    if (byPath.has(evidence.path)) {
      return dispositionError('baselineEvidence', `duplicate path: ${evidence.path}`);
    }
    byPath.set(evidence.path, evidence);
  }
  return Object.freeze(baselineTestPaths
    .filter((pathValue) => !existing.has(pathValue) && (candidate === null || !candidate.has(pathValue)))
    .flatMap((pathValue) => {
      const evidence = byPath.get(pathValue);
      if (evidence === undefined) return [];
      const { census } = evidence;
      return [dispositionFromEvidence(
        pathValue,
        'unknown',
        sourceRevision,
        baselineDigest,
        census
      )];
    }));
}

function supersessionReceiptIsBound(
  receipt: SourceProgramSupersessionReceipt,
  compilation: SourceProgramTestValueCompilation
): boolean {
  if (!DIGEST.test(receipt.receiptDigest)
      || receipt.current.sourceRevision !== compilation.sourceRevision
      || receipt.current.testCompilationDigest !== compilation.compilationDigest) return false;
  const { receiptDigest: _receiptDigest, ...canonicalReceipt } = receipt;
  return sha256(canonicalReceipt) === receipt.receiptDigest;
}

/**
 * Consume the one-way Source Program supersession proof after test
 * observations have been compiled.  This second phase avoids a Test Value ->
 * Supersession -> Test Value dependency cycle: the receipt is bound to the
 * observation compilation digest, and this projection records that receipt
 * without feeding the derived disposition back into its proof preimage.
 *
 * The current receipt grammar can prove only strict observation supersets for
 * a missing test module.  Consumer-zero retirement is intentionally not
 * reconstructed from the baseline syntax census; until the supersession owner
 * emits that proof per baseline test, DELETE remains UNKNOWN.
 */
export function reconcileSourceProgramTestValueWithSupersession(
  compilation: SourceProgramTestValueCompilation,
  receipt: SourceProgramSupersessionReceipt
): SourceProgramTestDispositionProjection {
  const project = (
    dispositions: readonly SourceProgramTestDisposition[],
    findings: readonly SourceProgramTestFinding[],
    supersessionReceiptDigest: string | null
  ): SourceProgramTestDispositionProjection => {
    const canonicalProjection = Object.freeze({
      sourceRevision: compilation.sourceRevision,
      baselineTestPaths: compilation.baselineTestPaths,
      baselineDigest: compilation.baselineDigest,
      baselineEvidenceDigest: compilation.baselineEvidenceDigest,
      dispositions: Object.freeze([...dispositions]),
      findings: Object.freeze([...findings]),
      observationCompilationDigest: compilation.compilationDigest,
      supersessionReceiptDigest
    });
    return Object.freeze({
      ...canonicalProjection,
      projectionDigest: sha256(canonicalProjection)
    });
  };
  if (receipt.status !== 'superseded'
      || !supersessionReceiptIsBound(receipt, compilation)) {
    return project(compilation.dispositions, compilation.findings, null);
  }

  const recordPathById = new Map(compilation.records.map(({ testId, path: testPath }) =>
    [testId, testPath] as const));
  const replacementsByBaselinePath = new Map<string, SourceProgramSupersessionReceipt['replacements']>();
  for (const replacement of receipt.replacements) {
    if (replacement.kind !== 'test' || replacement.baselinePaths.length !== 1) continue;
    const baselinePath = replacement.baselinePaths[0]!;
    const replacements = replacementsByBaselinePath.get(baselinePath) ?? [];
    replacementsByBaselinePath.set(baselinePath, Object.freeze([...replacements, replacement]));
  }

  const resolvedPaths = new Set<string>();
  const dispositions = compilation.dispositions.map((disposition) => {
    if (disposition.disposition !== 'unknown') return disposition;
    const replacements = replacementsByBaselinePath.get(disposition.path) ?? [];
    if (replacements.length === 0
        || replacements.some(({ proof }) => proof !== 'strict-observation-superset')) {
      return disposition;
    }
    const baselineIds = replacements.map(({ baselineId }) => baselineId);
    const replacementIds = [...new Set(replacements.flatMap(({ currentIds }) => currentIds))]
      .sort(compareCodeUnits);
    const replacementPaths = [...new Set(replacementIds.flatMap((testId) => {
      const testPath = recordPathById.get(testId);
      return testPath === undefined ? [] : [testPath];
    }))].sort(compareCodeUnits);
    const receiptPaths = [...new Set(replacements.flatMap(({ currentPaths }) => currentPaths))]
      .sort(compareCodeUnits);
    if (replacementIds.length === 0
        || replacementIds.some((testId) => !recordPathById.has(testId))
        || sha256(replacementPaths) !== sha256(receiptPaths)
        || new Set(baselineIds).size !== baselineIds.length) return disposition;
    resolvedPaths.add(disposition.path);
    return dispositionFromEvidence(
      disposition.path,
      'merge',
      compilation.sourceRevision,
      disposition.baselineDigest,
      disposition.evidence.census,
      replacementIds,
      Object.freeze({
        receiptDigest: receipt.receiptDigest,
        baselineTestId: baselineIds.length === 1
          ? baselineIds[0]!
          : sha256([...baselineIds].sort(compareCodeUnits)),
        proof: 'strict-observation-superset'
      })
    );
  });
  if (resolvedPaths.size === 0) {
    return project(compilation.dispositions, compilation.findings, null);
  }
  const findings = compilation.findings.filter(({ code, path: findingPath }) =>
    code !== 'test-module-disposition-unknown' || !resolvedPaths.has(findingPath));
  return project(dispositions, findings, receipt.receiptDigest);
}

/**
 * Parse one owner disposition against the exact baseline and source revision.
 * The parser is intentionally strict: a caller cannot smuggle a second field,
 * a non-canonical path, a foreign source revision, or an unbound replacement.
 */
function parseSourceProgramTestDisposition(
  input: unknown,
  baselineTestPaths: readonly string[],
  sourceRevision: string
): SourceProgramTestDisposition {
  const record = exactRecord(input, 'disposition');
  exactKeys(record, ['path', 'disposition', 'evidence'], 'disposition');
  const pathValue = canonicalTestPath(record.path, 'disposition.path');
  const disposition = requiredString(record, 'disposition', 'disposition');
  if (!DISPOSITION_KINDS.includes(disposition as SourceProgramTestDispositionKind)) {
    return dispositionError('disposition.disposition', 'unknown disposition');
  }
  if (disposition === 'delete' || disposition === 'merge') {
    return dispositionError(
      'disposition.disposition',
      `${disposition.toUpperCase()} requires a Source Program supersession receipt`
    );
  }
  const evidenceRecord = exactRecord(record.evidence, 'disposition.evidence');
  exactKeys(
    evidenceRecord,
    [
      'owner', 'sourceRevision', 'replacementTestIds', 'census', 'supersession',
      'ownerDecisionDigest'
    ],
    'disposition.evidence'
  );
  if (evidenceRecord.supersession !== undefined && evidenceRecord.supersession !== null) {
    return dispositionError(
      'disposition.evidence.supersession',
      'must be issued by the Source Program supersession projection'
    );
  }
  const evidenceSourceRevision = requiredString(
    evidenceRecord, 'sourceRevision', 'disposition.evidence', DIGEST
  );
  if (evidenceSourceRevision !== sourceRevision) {
    return dispositionError(
      'disposition.evidence.sourceRevision',
      'does not match the compiled source revision'
    );
  }
  const censusRecord = exactRecord(evidenceRecord.census, 'disposition.evidence.census');
  exactKeys(
    censusRecord,
    ['producerCount', 'consumerCount', 'externalContractCount'],
    'disposition.evidence.census'
  );
  const evidence: SourceProgramTestDispositionEvidence = Object.freeze({
    owner: requiredString(evidenceRecord, 'owner', 'disposition.evidence', OWNER_ID),
    sourceRevision: evidenceSourceRevision,
    replacementTestIds: requiredStringArray(
      evidenceRecord, 'replacementTestIds', 'disposition.evidence'
    ),
    census: Object.freeze({
      producerCount: requiredCount(censusRecord, 'producerCount', 'disposition.evidence.census'),
      consumerCount: requiredCount(censusRecord, 'consumerCount', 'disposition.evidence.census'),
      externalContractCount: requiredCount(
        censusRecord, 'externalContractCount', 'disposition.evidence.census'
      )
    }),
    supersession: null,
    ownerDecisionDigest: evidenceRecord.ownerDecisionDigest === undefined
      || evidenceRecord.ownerDecisionDigest === null
      ? null
      : requiredString(
          evidenceRecord, 'ownerDecisionDigest', 'disposition.evidence', DIGEST
        )
  });
  const baselineDigest = sourceProgramTestBaselineDigest(baselineTestPaths);
  const normalized = {
    path: pathValue,
    disposition: disposition as SourceProgramTestDispositionKind,
    evidence,
    baselineDigest
  };
  return Object.freeze({
    ...normalized,
    evidenceDigest: sha256(normalized)
  });
}

/**
 * Compile baseline evidence from two distinct exact compiler generations.
 * The Test Value owner records and validates the observation; it never parses
 * baseline or candidate source bytes itself.
 */
export function compileSourceProgramTestBaselineEvidence(
  input: Readonly<{
    baselineTestPaths: readonly string[];
    baselineModel: SourceProgramModel;
    candidateModel: SourceProgramModel;
    baselineRevision: string;
    operation?: SourceProgramCompilationOperation;
  }>
): readonly SourceProgramTestBaselineEvidence[] {
  const operation = resolveSourceProgramCompilationOperation(input.operation);
  sourceProgramCompilationCheckpoint(operation, 'baseline-test-evidence', 'start');
  if (!DIGEST.test(input.baselineRevision)) {
    return dispositionError('baselineRevision', 'expected a sha256 digest');
  }
  const canonicalPaths = canonicalBaselinePaths(input.baselineTestPaths);
  const evidence = Object.freeze(canonicalPaths.map((repositoryPath) => {
    sourceProgramCompilationCheckpoint(operation, 'baseline-test-evidence');
    const observation = observeTestContractCensus(
      input.baselineModel,
      input.candidateModel,
      repositoryPath,
      operation
    );
    return Object.freeze({
      path: repositoryPath,
      baselineRevision: input.baselineRevision,
      observationStatus: observation.status,
      observationReason: observation.status === 'resolved' ? null : observation.reason,
      observationDigest: observation.observationDigest,
      census: observation.status === 'resolved'
        ? observation.census
        : Object.freeze({ producerCount: 0, consumerCount: 0, externalContractCount: 1 })
    });
  }));
  sourceProgramCompilationCheckpoint(operation, 'baseline-test-evidence', 'complete');
  return evidence;
}

function testFinding(
  code: SourceProgramTestFindingCode,
  pathValue: string,
  detail: string,
  span: SourceProgramSpan | null,
  disposition: SourceProgramTestDisposition | null = null
): SourceProgramTestFinding {
  return Object.freeze({ code, path: pathValue, detail, span, disposition });
}

/**
 * Derive a compact projection for unresolved owner work.  This deliberately
 * groups only UNKNOWN dispositions; KEEP/REWRITE/MERGE/DELETE records remain
 * available in the full compilation and are not silently summarized as
 * unresolved.  The path digest makes the projection tamper-evident while the
 * paths keep the result directly actionable for the owner.
 */
export function summarizeSourceProgramTestUnknownDispositionClusters(
  dispositions: readonly SourceProgramTestDisposition[],
  findings: readonly SourceProgramTestFinding[]
): readonly SourceProgramTestUnknownDispositionCluster[] {
  const unknownDispositions = dispositions.filter(({ disposition }) => disposition === 'unknown');
  if (unknownDispositions.length === 0) return Object.freeze([]);
  const unknownPaths = new Set(unknownDispositions.map(({ path: repositoryPath }) => repositoryPath));
  const findingCodesByPath = new Map<string, Set<SourceProgramTestFindingCode>>();
  for (const finding of findings) {
    if (!unknownPaths.has(finding.path)
      || finding.disposition?.disposition !== 'unknown') continue;
    const codes = findingCodesByPath.get(finding.path) ?? new Set<SourceProgramTestFindingCode>();
    codes.add(finding.code);
    findingCodesByPath.set(finding.path, codes);
  }
  const byOwner = new Map<string, {
    readonly paths: Set<string>;
    readonly findingCodes: Set<SourceProgramTestFindingCode>;
    producerCount: number;
    consumerCount: number;
    externalContractCount: number;
  }>();
  for (const disposition of unknownDispositions) {
    const owner = disposition.evidence.owner;
    const current = byOwner.get(owner) ?? {
      paths: new Set<string>(),
      findingCodes: new Set<SourceProgramTestFindingCode>(),
      producerCount: 0,
      consumerCount: 0,
      externalContractCount: 0
    };
    current.paths.add(disposition.path);
    for (const code of findingCodesByPath.get(disposition.path) ?? []) current.findingCodes.add(code);
    current.producerCount += disposition.evidence.census.producerCount;
    current.consumerCount += disposition.evidence.census.consumerCount;
    current.externalContractCount += disposition.evidence.census.externalContractCount;
    byOwner.set(owner, current);
  }
  return Object.freeze([...byOwner.entries()]
    .map(([owner, value]) => {
      const paths = Object.freeze([...value.paths].sort(compareCodeUnits));
      const findingCodes = Object.freeze([
        ...(value.findingCodes.size === 0
          ? ['test-module-disposition-unknown' as const]
          : [...value.findingCodes])
      ].sort(compareCodeUnits));
      return Object.freeze({
        owner,
        disposition: 'unknown' as const,
        findingCodes,
        dispositionCount: paths.length,
        paths,
        pathsDigest: sha256(paths),
        census: Object.freeze({
          producerCount: value.producerCount,
          consumerCount: value.consumerCount,
          externalContractCount: value.externalContractCount
        })
      });
    })
    .sort((left, right) => compareCodeUnits(left.owner, right.owner)));
}

export function compileSourceProgramTestValue(
  input: CompileSourceProgramTestValueInput
): SourceProgramTestValueCompilation {
  const operation = resolveSourceProgramCompilationOperation(input.operation);
  sourceProgramCompilationCheckpoint(operation, 'test-value', 'start');
  if (input.baselineTestPaths !== undefined && !Array.isArray(input.baselineTestPaths)) {
    return dispositionError('baselineTestPaths', 'expected an array');
  }
  if (input.dispositions !== undefined && !Array.isArray(input.dispositions)) {
    return dispositionError('dispositions', 'expected an array');
  }
  if (input.baselineEvidence !== undefined && !Array.isArray(input.baselineEvidence)) {
    return dispositionError('baselineEvidence', 'expected an array');
  }
  // The immutable baseline is supplied by the exact revision reader.  Index
  // entries and worktree unknowns belong to the candidate epoch and must never
  // be promoted into baseline authority: a staged add that is later relocated
  // would otherwise masquerade as a deleted baseline test.
  const baselineTestPaths = canonicalBaselinePaths(input.baselineTestPaths ?? []);
  const baselineDigest = sourceProgramTestBaselineDigest(baselineTestPaths);
  const candidateTestPaths = new Set(input.files
    .filter(({ path: filePath }) => isRepositoryTestModulePath(filePath))
    .map(({ path: filePath }) => filePath));
  const baselineEvidence = Object.freeze((input.baselineEvidence ?? [])
    .map((evidence) => canonicalBaselineEvidence(evidence, baselineTestPaths))
    .sort((left, right) => compareCodeUnits(left.path, right.path)));
  const baselineEvidencePaths = new Set<string>();
  for (const evidence of baselineEvidence) {
    sourceProgramCompilationCheckpoint(operation, 'test-value');
    if (baselineEvidencePaths.has(evidence.path)) {
      return dispositionError('baselineEvidence', `duplicate path: ${evidence.path}`);
    }
    baselineEvidencePaths.add(evidence.path);
  }
  const baselineEvidenceRevisions = new Set(
    baselineEvidence.map(({ baselineRevision }) => baselineRevision)
  );
  if (baselineEvidenceRevisions.size > 1) {
    return dispositionError('baselineEvidence', 'entries use different baseline revisions');
  }
  const baselineEvidenceDigest = sourceProgramTestBaselineEvidenceDigest(baselineEvidence);
  const explicitDispositions = Object.freeze((input.dispositions ?? [])
    .map((disposition) => parseSourceProgramTestDisposition(
      disposition,
      baselineTestPaths,
      input.model.sourceRevision
    ))
    .sort((left, right) => compareCodeUnits(left.path, right.path)));
  const dispositions = Object.freeze([
    ...explicitDispositions,
    ...deriveSourceProgramTestDispositions(
      baselineTestPaths,
      baselineEvidence,
      input.model.sourceRevision,
      explicitDispositions.map(({ path: dispositionPath }) => dispositionPath),
      [...candidateTestPaths]
    )
  ].sort((left, right) => compareCodeUnits(left.path, right.path)));
  const dispositionsByPath = new Map<string, SourceProgramTestDisposition>();
  for (const disposition of dispositions) {
    sourceProgramCompilationCheckpoint(operation, 'test-value');
    if (dispositionsByPath.has(disposition.path)) {
      dispositionError('dispositions', `duplicate path: ${disposition.path}`);
    }
    dispositionsByPath.set(disposition.path, disposition);
  }
  const records: SourceProgramTestRegistration[] = [];
  const findings: SourceProgramTestFinding[] = [];
  const observations = testObservationsForFiles(
    input.files,
    input.model.sourceRevision
  );

  if (observations === null) {
    for (const testPath of [...candidateTestPaths].sort(compareCodeUnits)) {
      findings.push(testFinding(
        'test-observation-receipt-unresolved',
        testPath,
        'candidate test facts are not bound to the canonical lightweight observation receipt',
        null
      ));
    }
  } else {
    const registrationsByPath = new Map<string, number>();
    for (const registration of observations.registrations) {
      sourceProgramCompilationCheckpoint(operation, 'test-value');
      registrationsByPath.set(
        registration.path,
        (registrationsByPath.get(registration.path) ?? 0) + 1
      );
      if (registration.assertions.length > 0
          && registration.assertions.every(({ versionIdentityOnly }) => versionIdentityOnly)) {
        findings.push(testFinding(
          'test-asserts-only-version-identity',
          registration.path,
          registration.title === null
            ? 'test only asserts a schema/version/revision identity'
            : `${registration.title}: only asserts a schema/version/revision identity`,
          registration.span
        ));
      }
      for (const target of [...new Set(registration.assertions
        .map(({ productionPathLayoutTarget }) => productionPathLayoutTarget)
        .filter((target): target is string => target !== null))].sort(compareCodeUnits)) {
        findings.push(testFinding(
          'test-mirrors-production-path-layout',
          registration.path,
          `${registration.title === null ? 'test' : registration.title}: asserts production source path/layout ${target}`,
          registration.span
        ));
      }
      for (const assertion of registration.assertions.filter(({ importedFunctionArity }) =>
        importedFunctionArity)) {
        findings.push(testFinding(
          'test-mirrors-imported-function-arity',
          registration.path,
          registration.title === null
            ? 'test mirrors the JavaScript arity of an imported implementation'
            : `${registration.title}: mirrors the JavaScript arity of an imported implementation`,
          assertion.span
        ));
      }
      for (const assertion of registration.assertions.filter(({
        actualFromProductionSubject,
        expectedFromProductionSubject,
        expectedSharesActualProductionRoute,
        matcher,
        negated
      }) => expectedFromProductionSubject
        && !actualFromProductionSubject
        && expectedSharesActualProductionRoute
        && !negated
        && (matcher === 'toBe' || matcher === 'toEqual'))) {
        findings.push(testFinding(
          'test-oracle-derived-from-production-subject',
          registration.path,
          registration.title === null
            ? 'test expectation is derived from the production subject it is meant to verify'
            : `${registration.title}: expectation is derived from the production subject it is meant to verify`,
          assertion.span
        ));
      }
      records.push(Object.freeze({
        testId: sha256({
          path: registration.path,
          index: registration.index,
          kind: registration.kind,
          title: registration.title,
          span: registration.span
        }),
        path: registration.path,
        kind: registration.kind,
        title: registration.title,
        span: registration.span,
        semanticClasses: registration.semanticClasses,
        observedProductionPaths: registration.observedProductionPaths,
        capabilityOperations: registration.capabilityOperations,
        assertionCount: registration.assertions.length,
        unknowns: registration.unknowns
      }));
    }
    for (const testPath of observations.testPaths) {
      sourceProgramCompilationCheckpoint(operation, 'test-value');
      if (candidateTestPaths.has(testPath)
          && (registrationsByPath.get(testPath) ?? 0) === 0) {
        findings.push(testFinding(
          'test-module-without-registration',
          testPath,
          'test module has no test or it registration',
          null
        ));
      }
    }
    for (const reader of observations.productionSourceReads) {
      sourceProgramCompilationCheckpoint(operation, 'test-value');
      if (GOVERNED_TEXT_DOCUMENT.test(reader.target)) continue;
      findings.push(testFinding(
        'test-reads-production-source-text',
        reader.path,
        `test reads production source text: ${reader.target}`,
        reader.span
      ));
    }
    for (const unknown of observations.unknowns) {
      sourceProgramCompilationCheckpoint(operation, 'test-value');
      if (!candidateTestPaths.has(unknown.path)
          || (unknown.code !== 'test-source-parse-unresolved'
            && unknown.code !== 'test-dynamic-module-unresolved')) continue;
      findings.push(testFinding(
        'test-observation-receipt-unresolved',
        unknown.path,
        `${unknown.code}: ${unknown.detail}`,
        unknown.span
      ));
    }
  }

  records.sort((left, right) => compareCodeUnits(left.path, right.path)
    || left.span.start - right.span.start);

  const recordIds = new Set(records.map(({ testId }) => testId));
  const baselinePathSet = new Set(baselineTestPaths);
  for (const disposition of dispositions) {
    sourceProgramCompilationCheckpoint(operation, 'test-value');
    if (!baselinePathSet.has(disposition.path)) {
      findings.push(testFinding(
        'test-module-disposition-outside-baseline',
        disposition.path,
        'disposition path is not present in the tracked baseline census',
        null,
        disposition
      ));
    }
  }
  for (const baselinePath of baselineTestPaths) {
    sourceProgramCompilationCheckpoint(operation, 'test-value');
    if (candidateTestPaths.has(baselinePath)) continue;
    const disposition = dispositionsByPath.get(baselinePath);
    if (disposition === undefined) {
      findings.push(testFinding(
        'test-module-missing-from-worktree',
        baselinePath,
        'tracked test module is missing from the candidate worktree and requires owner disposition evidence',
        null
      ));
      findings.push(testFinding(
        'test-module-disposition-unbound',
        baselinePath,
        'missing tracked test has no owner, replacement, disposition, and producer/consumer/external-contract census evidence',
        null
      ));
      continue;
    }
    const { evidence } = disposition;
    const { census, replacementTestIds } = evidence;
    const hasLiveContract = census.producerCount > 0
      || census.consumerCount > 0
      || census.externalContractCount > 0;
    if (disposition.disposition === 'unknown') {
      findings.push(testFinding(
        'test-module-disposition-unknown',
        baselinePath,
        'owner disposition is UNKNOWN; the missing test remains a blocking unresolved item',
        null,
        disposition
      ));
      continue;
    }
    if (disposition.disposition === 'keep') {
      findings.push(testFinding(
        'test-module-disposition-invalid',
        baselinePath,
        'KEEP is invalid while the tracked test is absent from the candidate worktree',
        null,
        disposition
      ));
      continue;
    }
    if (disposition.disposition === 'delete') {
      if (hasLiveContract || replacementTestIds.length > 0) {
        findings.push(testFinding(
          'test-module-delete-contract-not-empty',
          baselinePath,
          `DELETE requires zero producer, consumer, and external-contract census and no replacement tests; observed ${census.producerCount}/${census.consumerCount}/${census.externalContractCount} and ${replacementTestIds.length} replacements`,
          null,
          disposition
        ));
      }
      continue;
    }
    if (replacementTestIds.length === 0) {
      findings.push(testFinding(
        'test-module-disposition-invalid',
        baselinePath,
        `${disposition.disposition.toUpperCase()} requires at least one replacementTestId`,
        null,
        disposition
      ));
      continue;
    }
    const unresolvedReplacementIds = replacementTestIds.filter((testId) => !recordIds.has(testId));
    if (unresolvedReplacementIds.length > 0) {
      findings.push(testFinding(
        'test-module-replacement-unresolved',
        baselinePath,
        `replacementTestIds are not present in the candidate registration census: ${unresolvedReplacementIds.join(',')}`,
        null,
        disposition
      ));
    }
  }
  findings.sort((left, right) => compareCodeUnits(left.path, right.path)
    || (left.span?.start ?? -1) - (right.span?.start ?? -1)
    || compareCodeUnits(left.code, right.code));
  const compilationDigest = sha256({
    sourceRevision: input.model.sourceRevision,
    baselineTestPaths,
    baselineDigest,
    baselineEvidence,
    baselineEvidenceDigest,
    dispositions,
    records,
    findings
  });
  sourceProgramCompilationCheckpoint(operation, 'test-value', 'complete');
  return Object.freeze({
    sourceRevision: input.model.sourceRevision,
    baselineTestPaths,
    baselineDigest,
    baselineEvidenceDigest,
    dispositions,
    records: Object.freeze(records),
    findings: Object.freeze(findings),
    compilationDigest
  });
}
