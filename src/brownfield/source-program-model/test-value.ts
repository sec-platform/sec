import path from 'node:path';

import ts from 'typescript';

import { compareCodeUnits, sha256 } from '../../system-architecture/foundation/runtime/canonical.ts';
import { resolveSecRepositoryModuleImportCandidates } from '../../system-architecture/repository-modules/contract.ts';
import type {
  SourceProgramFileInput,
  SourceProgramModel,
  SourceProgramSpan
} from './contract.ts';

export type SourceProgramTestSemanticClass =
  | 'behavior'
  | 'durable-state'
  | 'effect'
  | 'failure-boundary'
  | 'algorithm-property'
  | 'external-protocol';

export type SourceProgramTestFindingCode =
  | 'test-module-missing-from-worktree'
  | 'test-module-disposition-unbound'
  | 'test-module-disposition-unknown'
  | 'test-module-disposition-invalid'
  | 'test-module-disposition-outside-baseline'
  | 'test-module-delete-contract-not-empty'
  | 'test-module-replacement-unresolved'
  | 'test-module-without-registration'
  | 'test-reads-production-source-text'
  | 'test-mirrors-production-path-layout'
  | 'test-mirrors-imported-function-arity'
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
  'test-reads-production-source-text',
  'test-mirrors-production-path-layout',
  'test-mirrors-imported-function-arity',
  'test-asserts-only-version-identity'
] as const satisfies readonly SourceProgramTestFindingCode[]);

export type SourceProgramTestDispositionKind =
  | 'keep'
  | 'rewrite'
  | 'merge'
  | 'delete'
  | 'unknown';

export interface SourceProgramTestDispositionCensus {
  readonly producerCount: number;
  readonly consumerCount: number;
  readonly externalContractCount: number;
}

export interface SourceProgramTestDispositionEvidence {
  /** Canonical owner that is accountable for this disposition. */
  readonly owner: string;
  /** Source revision against which the owner made the census. */
  readonly sourceRevision: string;
  /** Current test registrations that replace or absorb a missing test. */
  readonly replacementTestIds: readonly string[];
  /** Producer/consumer/external-contract evidence for a deletion decision. */
  readonly census: SourceProgramTestDispositionCensus;
}

/**
 * Machine-derived facts for a tracked test in the baseline revision.  These
 * facts are deliberately narrower than an owner disposition: they can prove
 * an empty graph, but they can never infer a replacement or a semantic merge.
 */
export interface SourceProgramTestBaselineEvidence {
  readonly path: string;
  readonly baselineRevision: string;
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
  readonly semanticClasses: readonly SourceProgramTestSemanticClass[];
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

export interface CompileSourceProgramTestValueInput {
  readonly repositoryRoot: string;
  readonly files: readonly SourceProgramFileInput[];
  readonly model: SourceProgramModel;
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

const TEST_MODULE_PATH = /^(?:src|tests)\/.+\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/iu;
const SOURCE_MODULE_PATH = /\.(?:[cm]?[jt]sx?)$/iu;
const GOVERNED_TEXT_DOCUMENT = /^(?:AGENTS\.md|\.agents\/skills\/.+\/SKILL\.md|\.github\/workflows\/[^/]+\.ya?ml)$/u;
const IDENTITY_NAME = /^(?:format)?(?:schema|version)$|(?:Schema|Version)$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const OWNER_ID = /^[A-Za-z][A-Za-z0-9._-]{0,127}$/u;
const TEST_SUPPORT_MODULE = /^(?:bun:test|node:test|node:assert(?:\/strict)?|vitest(?:\/.*)?|@jest\/globals|uvu|tap)$/iu;
const TEST_FRAMEWORK_CALL_ROOTS = new Set([
  'assert',
  'afterAll',
  'afterEach',
  'beforeAll',
  'beforeEach',
  'describe',
  'expect',
  'it',
  'mock',
  'test'
]);
const DISPOSITION_KINDS = Object.freeze([
  'keep',
  'rewrite',
  'merge',
  'delete',
  'unknown'
] as const);

function sourceProgramScriptKind(repositoryPath: string): ts.ScriptKind {
  const extension = path.posix.extname(repositoryPath).toLowerCase();
  if (extension === '.tsx') return ts.ScriptKind.TSX;
  if (extension === '.jsx') return ts.ScriptKind.JSX;
  if (extension === '.js' || extension === '.mjs' || extension === '.cjs') {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

/**
 * The test-value compiler and audit entrypoint must use one test-module
 * identity.  Keeping this predicate in the owner prevents a second, subtly
 * different path census from deciding which baseline files are governed.
 */
export function isSourceProgramTestModulePath(value: string): boolean {
  return TEST_MODULE_PATH.test(value);
}

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
  if (normalized !== value || !TEST_MODULE_PATH.test(normalized)
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

export function sourceProgramTestBaselineDigest(
  baselineTestPaths: readonly string[]
): string {
  return sha256(canonicalBaselinePaths(baselineTestPaths));
}

function canonicalBaselineEvidence(
  input: unknown,
  baselineTestPaths: readonly string[]
): SourceProgramTestBaselineEvidence {
  const record = exactRecord(input, 'baselineEvidence');
  exactKeys(record, ['path', 'baselineRevision', 'census'], 'baselineEvidence');
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
  const censusRecord = exactRecord(record.census, 'baselineEvidence.census');
  exactKeys(
    censusRecord,
    ['producerCount', 'consumerCount', 'externalContractCount'],
    'baselineEvidence.census'
  );
  return Object.freeze({
    path: pathValue,
    baselineRevision,
    census: Object.freeze({
      producerCount: requiredCount(censusRecord, 'producerCount', 'baselineEvidence.census'),
      consumerCount: requiredCount(censusRecord, 'consumerCount', 'baselineEvidence.census'),
      externalContractCount: requiredCount(
        censusRecord, 'externalContractCount', 'baselineEvidence.census'
      )
    })
  });
}

export function sourceProgramTestBaselineEvidenceDigest(
  evidence: readonly SourceProgramTestBaselineEvidence[]
): string {
  return sha256([...evidence]
    .map(({ path: repositoryPath, baselineRevision, census }) => ({
      path: repositoryPath,
      baselineRevision,
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
  replacementTestIds: readonly string[] = []
): SourceProgramTestDisposition {
  const evidence: SourceProgramTestDispositionEvidence = Object.freeze({
    owner: 'source-program-test-value',
    sourceRevision,
    replacementTestIds: Object.freeze([...replacementTestIds].sort(compareCodeUnits)),
    census: Object.freeze({ ...census })
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
 * Derive only the disposition that syntax/contract census can prove.  An
 * empty producer/consumer/external graph is a DELETE; every non-empty graph
 * stays UNKNOWN.  In particular, this function never guesses REWRITE or
 * MERGE from names, similarity, or registration counts.
 */
export function deriveSourceProgramTestDispositions(
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
      const empty = census.producerCount === 0
        && census.consumerCount === 0
        && census.externalContractCount === 0;
      return [dispositionFromEvidence(
        pathValue,
        empty ? 'delete' : 'unknown',
        sourceRevision,
        baselineDigest,
        census
      )];
    }));
}

/**
 * Parse one owner disposition against the exact baseline and source revision.
 * The parser is intentionally strict: a caller cannot smuggle a second field,
 * a non-canonical path, a foreign source revision, or an unbound replacement.
 */
export function parseSourceProgramTestDisposition(
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
  const evidenceRecord = exactRecord(record.evidence, 'disposition.evidence');
  exactKeys(
    evidenceRecord,
    ['owner', 'sourceRevision', 'replacementTestIds', 'census'],
    'disposition.evidence'
  );
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
    })
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

function spanFor(sourceFile: ts.SourceFile, node: ts.Node): SourceProgramSpan {
  const start = node.getStart(sourceFile, false);
  const end = node.getEnd();
  const startLocation = sourceFile.getLineAndCharacterOfPosition(start);
  const endLocation = sourceFile.getLineAndCharacterOfPosition(end);
  return Object.freeze({
    start,
    end,
    startLine: startLocation.line + 1,
    startColumn: startLocation.character + 1,
    endLine: endLocation.line + 1,
    endColumn: endLocation.character + 1
  });
}

function callIdentity(expression: ts.LeftHandSideExpression): string | null {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) {
    const owner = callIdentity(expression.expression);
    return owner === null ? null : `${owner}.${expression.name.text}`;
  }
  if (ts.isCallExpression(expression)) return callIdentity(expression.expression);
  return null;
}

function sourceFileParseError(sourceFile: ts.SourceFile): boolean {
  const diagnostics = (
    sourceFile as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }
  ).parseDiagnostics ?? [];
  return diagnostics.length > 0;
}

function isTestFrameworkCall(node: ts.CallExpression): boolean {
  if (assertionMatcher(node) !== null) return true;
  const identity = callIdentity(node.expression);
  if (identity === null) return false;
  return TEST_FRAMEWORK_CALL_ROOTS.has(identity.split('.')[0]!);
}

function exportedCandidateNames(files: readonly SourceProgramFileInput[]): ReadonlySet<string> {
  const names = new Set<string>();
  const exported = (node: ts.Node): boolean => ts.canHaveModifiers(node)
    && (ts.getModifiers(node)?.some(({ kind }) => kind === ts.SyntaxKind.ExportKeyword) ?? false);
  for (const file of files) {
    if (!/\.[cm]?[jt]sx?$/iu.test(file.path)) continue;
    const sourceFile = ts.createSourceFile(
      file.path,
      file.source,
      ts.ScriptTarget.Latest,
      true,
      sourceProgramScriptKind(file.path)
    );
    if (sourceFileParseError(sourceFile)) continue;
    for (const statement of sourceFile.statements) {
      if (ts.isExportAssignment(statement)) {
        names.add('default');
        continue;
      }
      if (ts.isExportDeclaration(statement) && statement.exportClause !== undefined
          && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) names.add(element.name.text);
        continue;
      }
      if (!exported(statement)) continue;
      if ((ts.isFunctionDeclaration(statement)
          || ts.isClassDeclaration(statement)
          || ts.isInterfaceDeclaration(statement)
          || ts.isTypeAliasDeclaration(statement)
          || ts.isEnumDeclaration(statement)
          || ts.isModuleDeclaration(statement))
          && statement.name !== undefined
          && ts.isIdentifier(statement.name)) {
        names.add(statement.name.text);
      }
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text);
        }
      }
      if (ts.canHaveModifiers(statement)
          && ts.getModifiers(statement)?.some(({ kind }) => kind === ts.SyntaxKind.DefaultKeyword)) {
        names.add('default');
      }
    }
  }
  return names;
}

function importedNames(statement: ts.ImportDeclaration): readonly string[] {
  const clause = statement.importClause;
  if (clause === undefined) return Object.freeze([]);
  const names: string[] = [];
  if (clause.name !== undefined) names.push('default');
  if (clause.namedBindings !== undefined) {
    if (ts.isNamespaceImport(clause.namedBindings)) names.push('*');
    else for (const element of clause.namedBindings.elements) {
      names.push((element.propertyName ?? element.name).text);
    }
  }
  return Object.freeze(names);
}

function baselineCensusForSource(
  source: string,
  repositoryPath: string,
  candidatePaths: ReadonlySet<string>,
  candidateExports: ReadonlySet<string>
): SourceProgramTestDispositionCensus {
  const sourceFile = ts.createSourceFile(
    repositoryPath,
    source,
    ts.ScriptTarget.Latest,
    true,
    sourceProgramScriptKind(repositoryPath)
  );
  let producerCount = 0;
  let consumerCount = 0;
  let externalContractCount = sourceFileParseError(sourceFile) ? 1 : 0;
  const relativeSpecifier = (value: string): boolean => value.startsWith('./') || value.startsWith('../');
  const liveRelativeConsumer = (specifier: string): boolean => (
    resolveSecRepositoryModuleImportCandidates(repositoryPath, specifier)
      .some((candidate) => candidatePaths.has(candidate))
  );
  const relocatedImportConsumer = (statement: ts.ImportDeclaration): boolean => {
    const names = importedNames(statement);
    return names.includes('*') || names.some((name) => candidateExports.has(name));
  };
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteralLike(statement.moduleSpecifier)) {
      const specifier = statement.moduleSpecifier.text;
      if (TEST_SUPPORT_MODULE.test(specifier)) continue;
      if (relativeSpecifier(specifier)) {
        if (liveRelativeConsumer(specifier) || relocatedImportConsumer(statement)) consumerCount += 1;
      }
      else externalContractCount += 1;
      continue;
    }
    if (ts.isImportEqualsDeclaration(statement)) {
      externalContractCount += 1;
      continue;
    }
    if (ts.isExportDeclaration(statement)) {
      producerCount += 1;
      if (statement.moduleSpecifier !== undefined
          && ts.isStringLiteralLike(statement.moduleSpecifier)
          && relativeSpecifier(statement.moduleSpecifier.text)
          && liveRelativeConsumer(statement.moduleSpecifier.text)) consumerCount += 1;
      continue;
    }
    if (ts.isExportAssignment(statement)) producerCount += 1;
    if (ts.canHaveModifiers(statement)
        && ts.getModifiers(statement)?.some(({ kind }) => kind === ts.SyntaxKind.ExportKeyword)) {
      producerCount += 1;
    }
  }
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const identity = callIdentity(node.expression);
      if (identity === 'require') {
        const argument = node.arguments[0];
        if (argument !== undefined && ts.isStringLiteralLike(argument)) {
          if (relativeSpecifier(argument.text)) {
            if (liveRelativeConsumer(argument.text)) consumerCount += 1;
          }
          else if (!TEST_SUPPORT_MODULE.test(argument.text)) externalContractCount += 1;
        } else {
          externalContractCount += 1;
        }
      }
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const argument = node.arguments[0];
        if (argument !== undefined && ts.isStringLiteralLike(argument)) {
          if (relativeSpecifier(argument.text)) {
            if (liveRelativeConsumer(argument.text)) consumerCount += 1;
          } else if (!TEST_SUPPORT_MODULE.test(argument.text)) externalContractCount += 1;
        } else {
          externalContractCount += 1;
        }
      }
    }
    if (ts.isPropertyAccessExpression(node)) {
      const identity = expressionIdentityName(node.expression);
      if ((identity === 'process' && node.name.text === 'env')
          || (identity === 'Bun' && /^(?:file|spawn|spawnSync)$/u.test(node.name.text))) {
        externalContractCount += 1;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return Object.freeze({
    producerCount,
    consumerCount,
    externalContractCount
  });
}

/**
 * Compile an exact baseline test-path census from immutable source blobs.
 * Missing/unreadable baseline blobs are intentionally unresolved rather than
 * treated as empty: a DELETE is only derivable from a complete zero graph.
 */
export function compileSourceProgramTestBaselineEvidence(
  baselineTestPaths: readonly string[],
  files: readonly SourceProgramFileInput[],
  baselineRevision: string,
  candidateFiles: readonly SourceProgramFileInput[] = []
): readonly SourceProgramTestBaselineEvidence[] {
  if (!DIGEST.test(baselineRevision)) {
    return dispositionError('baselineRevision', 'expected a sha256 digest');
  }
  const canonicalPaths = canonicalBaselinePaths(baselineTestPaths);
  const candidatePathSet = new Set(candidateFiles.map(({ path: candidatePath }) => candidatePath));
  const candidateExports = exportedCandidateNames(candidateFiles);
  const sources = new Map(files.map((file) => [file.path, file.source] as const));
  return Object.freeze(canonicalPaths.map((repositoryPath) => Object.freeze({
    path: repositoryPath,
    baselineRevision,
    census: sources.has(repositoryPath)
      ? baselineCensusForSource(
          sources.get(repositoryPath)!,
          repositoryPath,
          candidatePathSet,
          candidateExports
        )
      : Object.freeze({ producerCount: 0, consumerCount: 0, externalContractCount: 1 })
  })));
}

function testRegistrationKind(expression: ts.LeftHandSideExpression): string | null {
  const identity = callIdentity(expression);
  if (identity === null) return null;
  const root = identity.split('.')[0];
  return root === 'test' || root === 'it' ? identity : null;
}

function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isAwaitExpression(current)
    || ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isNonNullExpression(current)
  ) current = current.expression;
  return current;
}

function constantInitializers(sourceFile: ts.SourceFile): ReadonlyMap<string, ts.Expression> {
  const values = new Map<string, ts.Expression>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined) {
      values.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return values;
}

function staticString(
  expression: ts.Expression,
  testPath: string,
  repositoryRoot: string,
  constants: ReadonlyMap<string, ts.Expression>,
  resolving: ReadonlySet<string> = new Set()
): string | null {
  const current = unwrap(expression);
  if (ts.isStringLiteralLike(current)) return current.text;
  if (ts.isIdentifier(current)) {
    const initializer = constants.get(current.text);
    if (initializer === undefined || resolving.has(current.text)) return null;
    return staticString(
      initializer,
      testPath,
      repositoryRoot,
      constants,
      new Set([...resolving, current.text])
    );
  }
  if (ts.isTemplateExpression(current)) {
    let value = current.head.text;
    for (const part of current.templateSpans) {
      const replacement = staticString(
        part.expression, testPath, repositoryRoot, constants, resolving
      );
      if (replacement === null) return null;
      value += replacement + part.literal.text;
    }
    return value;
  }
  if (ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = staticString(current.left, testPath, repositoryRoot, constants, resolving);
    const right = staticString(current.right, testPath, repositoryRoot, constants, resolving);
    return left === null || right === null ? null : left + right;
  }
  if (ts.isCallExpression(current)) {
    const callee = callIdentity(current.expression);
    if (callee === 'process.cwd' && current.arguments.length === 0) return repositoryRoot;
    if ((callee === 'path.join' || callee === 'path.resolve') && current.arguments.length > 0) {
      const values = current.arguments.map((argument) => staticString(
        argument, testPath, repositoryRoot, constants, resolving
      ));
      if (values.some((value) => value === null)) return null;
      return callee === 'path.resolve'
        ? path.resolve(...values as string[])
        : path.join(...values as string[]);
    }
  }
  if (
    ts.isPropertyAccessExpression(current)
    && ts.isMetaProperty(current.expression)
    && current.expression.keywordToken === ts.SyntaxKind.ImportKeyword
  ) {
    const absoluteTestPath = path.join(repositoryRoot, testPath);
    if (current.name.text === 'dir') return path.dirname(absoluteTestPath);
    if (current.name.text === 'url') return new URL(`file:///${absoluteTestPath.replaceAll('\\', '/')}`).href;
  }
  if (ts.isNewExpression(current) && callIdentity(current.expression) === 'URL') {
    const [relativeExpression, baseExpression] = current.arguments ?? [];
    if (relativeExpression === undefined || baseExpression === undefined) return null;
    const relative = staticString(relativeExpression, testPath, repositoryRoot, constants, resolving);
    const base = staticString(baseExpression, testPath, repositoryRoot, constants, resolving);
    if (relative === null || base === null) return null;
    try {
      const resolved = new URL(relative, base);
      return resolved.protocol === 'file:' ? decodeURIComponent(resolved.pathname) : null;
    } catch {
      return null;
    }
  }
  return null;
}

function repositoryPath(repositoryRoot: string, value: string): string | null {
  const absolute = path.isAbsolute(value) ? path.resolve(value) : path.resolve(repositoryRoot, value);
  const relative = path.relative(repositoryRoot, absolute).replaceAll('\\', '/');
  return relative === '..' || relative.startsWith('../') ? null : relative;
}

function rawTextReadPath(node: ts.CallExpression): ts.Expression | null {
  const identity = callIdentity(node.expression);
  if (identity !== null && (
    identity === 'readFile'
    || identity === 'readFileSync'
    || identity.endsWith('.readFile')
    || identity.endsWith('.readFileSync')
  )) return node.arguments[0] ?? null;
  if (
    ts.isPropertyAccessExpression(node.expression)
    && node.expression.name.text === 'text'
    && ts.isCallExpression(node.expression.expression)
    && callIdentity(node.expression.expression.expression) === 'Bun.file'
  ) return node.expression.expression.arguments[0] ?? null;
  return null;
}

function assertionMatcher(node: ts.CallExpression): Readonly<{
  actual: ts.Expression;
  matcher: string;
}> | null {
  if (!ts.isPropertyAccessExpression(node.expression)) return null;
  let target: ts.Expression = node.expression.expression;
  while (ts.isPropertyAccessExpression(target)) target = target.expression;
  if (!ts.isCallExpression(target) || callIdentity(target.expression) !== 'expect') return null;
  const actual = target.arguments[0];
  return actual === undefined ? null : Object.freeze({
    actual,
    matcher: node.expression.name.text
  });
}

function expressionIdentityName(expression: ts.Expression): string | null {
  const current = unwrap(expression);
  if (ts.isIdentifier(current)) return current.text;
  if (ts.isPropertyAccessExpression(current)) return current.name.text;
  if (ts.isElementAccessExpression(current) && current.argumentExpression !== undefined) {
    return ts.isStringLiteralLike(current.argumentExpression) ? current.argumentExpression.text : null;
  }
  return null;
}

function isVersionIdentityAssertion(node: ts.CallExpression): boolean {
  const assertion = assertionMatcher(node);
  if (assertion === null || !['toBe', 'toEqual'].includes(assertion.matcher)) return false;
  const name = expressionIdentityName(assertion.actual);
  return name !== null && IDENTITY_NAME.test(name);
}

function importedBindingNames(sourceFile: ts.SourceFile): ReadonlySet<string> {
  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || statement.importClause === undefined
        || !ts.isStringLiteralLike(statement.moduleSpecifier)
        || !statement.moduleSpecifier.text.startsWith('.')) continue;
    const clause = statement.importClause;
    if (clause.name !== undefined) names.add(clause.name.text);
    if (clause.namedBindings === undefined) continue;
    if (ts.isNamespaceImport(clause.namedBindings)) {
      names.add(clause.namedBindings.name.text);
      continue;
    }
    for (const element of clause.namedBindings.elements) names.add(element.name.text);
  }
  return names;
}

function isImportedFunctionArityAssertion(
  node: ts.CallExpression,
  importedNames: ReadonlySet<string>
): boolean {
  const assertion = assertionMatcher(node);
  if (assertion === null || !['toBe', 'toEqual'].includes(assertion.matcher)) return false;
  const actual = unwrap(assertion.actual);
  const expected = node.arguments[0] === undefined ? null : unwrap(node.arguments[0]);
  return ts.isPropertyAccessExpression(actual)
    && actual.name.text === 'length'
    && ts.isIdentifier(actual.expression)
    && importedNames.has(actual.expression.text)
    && expected !== null
    && (ts.isNumericLiteral(expected)
      || (ts.isPrefixUnaryExpression(expected) && ts.isNumericLiteral(expected.operand)));
}

function registrationCallback(node: ts.CallExpression): ts.FunctionLikeDeclaration | null {
  for (const argument of node.arguments) {
    if (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) return argument;
  }
  return null;
}

function semanticClassesForPath(
  references: SourceProgramModel['references'],
  capabilities: SourceProgramModel['capabilities'],
  registration: ts.CallExpression
): readonly SourceProgramTestSemanticClass[] {
  const classes = new Set<SourceProgramTestSemanticClass>();
  const registrationReferences = references.filter(({ span }) =>
    span.start >= registration.getStart()
    && span.end <= registration.getEnd());
  if (registrationReferences.some(({ kind, targetPath }) =>
    (kind === 'call' || kind === 'construct')
    && targetPath !== null
    && !TEST_MODULE_PATH.test(targetPath))) classes.add('behavior');
  const registrationCapabilities = capabilities.filter(({ span }) =>
    span.start >= registration.getStart()
    && span.end <= registration.getEnd());
  if (registrationCapabilities.length > 0) classes.add('effect');
  const operations = new Set(registrationCapabilities.map(({ operation }) => operation.toLowerCase()));
  const hasRead = [...operations].some((operation) => /read|stat|scan|inspect|open/u.test(operation));
  const hasWrite = [...operations].some((operation) => /write|rename|remove|unlink|delete|mkdir|spawn|run/u.test(operation));
  if (hasRead && hasWrite) classes.add('durable-state');
  let hasFailureBoundary = false;
  let hasPropertyIteration = false;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const matcher = assertionMatcher(node)?.matcher;
      if (matcher !== undefined && /throw|reject|fail/iu.test(matcher)) hasFailureBoundary = true;
    }
    if (ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node)) {
      hasPropertyIteration = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(registration);
  if (hasFailureBoundary) classes.add('failure-boundary');
  if (hasPropertyIteration) classes.add('algorithm-property');
  return Object.freeze([...classes].sort(compareCodeUnits));
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
    .filter(({ path: filePath }) => TEST_MODULE_PATH.test(filePath))
    .map(({ path: filePath }) => filePath));
  const baselineEvidence = Object.freeze((input.baselineEvidence ?? [])
    .map((evidence) => canonicalBaselineEvidence(evidence, baselineTestPaths))
    .sort((left, right) => compareCodeUnits(left.path, right.path)));
  const baselineEvidencePaths = new Set<string>();
  for (const evidence of baselineEvidence) {
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
    if (dispositionsByPath.has(disposition.path)) {
      dispositionError('dispositions', `duplicate path: ${disposition.path}`);
    }
    dispositionsByPath.set(disposition.path, disposition);
  }
  const productionPaths = new Set(input.model.files
    .filter(({ surface, path: filePath }) => surface === 'production' && SOURCE_MODULE_PATH.test(filePath))
    .map(({ path: filePath }) => filePath));
  const staticProductionPath = (
    expression: ts.Expression,
    testPath: string,
    constants: ReadonlyMap<string, ts.Expression>
  ): string | null => {
    const value = staticString(expression, testPath, input.repositoryRoot, constants);
    if (value === null) return null;
    const target = repositoryPath(input.repositoryRoot, value);
    return target !== null && productionPaths.has(target) ? target : null;
  };
  const isPathLayoutExpression = (expression: ts.Expression): boolean => {
    const current = unwrap(expression);
    if (ts.isStringLiteralLike(current)) return true;
    return ts.isCallExpression(current)
      && (callIdentity(current.expression) === 'path.join'
        || callIdentity(current.expression) === 'path.resolve');
  };
  const records: SourceProgramTestRegistration[] = [];
  const findings: SourceProgramTestFinding[] = [];
  const referencesByPath = new Map<string, SourceProgramModel['references'][number][]>();
  for (const reference of input.model.references) {
    const references = referencesByPath.get(reference.path) ?? [];
    references.push(reference);
    referencesByPath.set(reference.path, references);
  }
  const capabilitiesByPath = new Map<string, SourceProgramModel['capabilities'][number][]>();
  for (const capability of input.model.capabilities) {
    const capabilities = capabilitiesByPath.get(capability.path) ?? [];
    capabilities.push(capability);
    capabilitiesByPath.set(capability.path, capabilities);
  }

  for (const file of input.files.filter(({ path: filePath }) => TEST_MODULE_PATH.test(filePath))) {
    const sourceFile = ts.createSourceFile(
      file.path,
      file.source,
      ts.ScriptTarget.Latest,
      true,
      sourceProgramScriptKind(file.path)
    );
    const constants = constantInitializers(sourceFile);
    const importedNames = importedBindingNames(sourceFile);
    const registrations: ts.CallExpression[] = [];
    const mutableSourceReaders: { node: ts.CallExpression; target: string }[] = [];
    const fileReferences = referencesByPath.get(file.path) ?? [];
    const fileCapabilities = capabilitiesByPath.get(file.path) ?? [];
    const visitFile = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        if (testRegistrationKind(node.expression) !== null) registrations.push(node);
        const pathExpression = rawTextReadPath(node);
        if (pathExpression !== null) {
          const value = staticString(
            pathExpression, file.path, input.repositoryRoot, constants
          );
          const target = value === null ? null : repositoryPath(input.repositoryRoot, value);
          if (target !== null && productionPaths.has(target) && !GOVERNED_TEXT_DOCUMENT.test(target)) {
            mutableSourceReaders.push({ node, target });
          }
        }
      }
      ts.forEachChild(node, visitFile);
    };
    visitFile(sourceFile);
    if (registrations.length === 0) {
      findings.push(testFinding(
        'test-module-without-registration',
        file.path,
        'test module has no test or it registration',
        null
      ));
    }
    for (const reader of mutableSourceReaders) {
      findings.push(testFinding(
        'test-reads-production-source-text',
        file.path,
        `test reads production source text: ${reader.target}`,
        spanFor(sourceFile, reader.node)
      ));
    }
    registrations.forEach((registration, index) => {
      const kind = testRegistrationKind(registration.expression)!;
      const titleExpression = registration.arguments[0];
      const title = titleExpression === undefined
        ? null
        : staticString(titleExpression, file.path, input.repositoryRoot, constants);
      const callback = registrationCallback(registration);
      const assertions: ts.CallExpression[] = [];
      if (callback !== null) {
        const visitRegistration = (node: ts.Node): void => {
          if (ts.isCallExpression(node) && assertionMatcher(node) !== null) assertions.push(node);
          ts.forEachChild(node, visitRegistration);
        };
        visitRegistration(callback);
      }
      if (assertions.length > 0 && assertions.every(isVersionIdentityAssertion)) {
        findings.push(testFinding(
          'test-asserts-only-version-identity',
          file.path,
          title === null
            ? 'test only asserts a schema/version/revision identity'
            : `${title}: only asserts a schema/version/revision identity`,
          spanFor(sourceFile, registration)
        ));
      }
      const pathLayoutTargets = new Set<string>();
      for (const assertion of assertions) {
        const assertionShape = assertionMatcher(assertion);
        if (assertionShape === null) continue;
        const expressions = [
          assertionShape.actual,
          assertion.arguments[0]
        ].filter((expression): expression is ts.Expression => expression !== undefined);
        for (const expression of expressions) {
          if (!isPathLayoutExpression(expression)) continue;
          const target = staticProductionPath(expression, file.path, constants);
          if (target !== null) pathLayoutTargets.add(target);
        }
      }
      for (const target of [...pathLayoutTargets].sort(compareCodeUnits)) {
        findings.push(testFinding(
          'test-mirrors-production-path-layout',
          file.path,
          `${title === null ? 'test' : title}: asserts production source path/layout ${target}`,
          spanFor(sourceFile, registration)
        ));
      }
      for (const assertion of assertions.filter((candidate) =>
        isImportedFunctionArityAssertion(candidate, importedNames))) {
        findings.push(testFinding(
          'test-mirrors-imported-function-arity',
          file.path,
          title === null
            ? 'test mirrors the JavaScript arity of an imported implementation'
            : `${title}: mirrors the JavaScript arity of an imported implementation`,
          spanFor(sourceFile, assertion)
        ));
      }
      const observedProductionPaths = [...new Set(fileReferences
        .filter(({ targetPath, span }) =>
          targetPath !== null
          && productionPaths.has(targetPath)
          && span.start >= registration.getStart(sourceFile)
          && span.end <= registration.getEnd())
        .map(({ targetPath }) => targetPath!))].sort(compareCodeUnits);
      const capabilityOperations = [...new Set(fileCapabilities
        .filter(({ span }) =>
          span.start >= registration.getStart(sourceFile)
          && span.end <= registration.getEnd())
        .map(({ operation }) => operation))].sort(compareCodeUnits);
      const semanticClasses = semanticClassesForPath(fileReferences, fileCapabilities, registration);
      const unknowns = semanticClasses.length === 0
        ? Object.freeze(['test-semantic-class-unresolved'])
        : Object.freeze([]);
      const registrationSpan = spanFor(sourceFile, registration);
      records.push(Object.freeze({
        testId: sha256({ path: file.path, index, kind, title, span: registrationSpan }),
        path: file.path,
        kind,
        title,
        span: registrationSpan,
        semanticClasses,
        observedProductionPaths: Object.freeze(observedProductionPaths),
        capabilityOperations: Object.freeze(capabilityOperations),
        assertionCount: assertions.length,
        unknowns
      }));
    });
  }

  records.sort((left, right) => compareCodeUnits(left.path, right.path)
    || left.span.start - right.span.start);

  const recordIds = new Set(records.map(({ testId }) => testId));
  const baselinePathSet = new Set(baselineTestPaths);
  for (const disposition of dispositions) {
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
