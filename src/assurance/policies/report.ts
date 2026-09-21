import { isCanonicalBlockId } from '../../semantics/identity/block.ts';
import { isCanonicalPortableLogicalPath } from '../../contracts/logical-path.ts';
import { canonicalEquals, compareCodeUnits, deepFreeze, uniqueSorted } from '../../contracts/canonical.ts';
import { POLICY_SOURCE_PATHS } from '../../workspace/contract/policy-source-paths.ts';
import { isCanonicalPolicyId } from '../../semantics/policies/identity.ts';
import { isPolicyRuleId } from '../../semantics/policies/rules.ts';
import type {
  MergedPolicyReportEntry,
  PolicyDiagnostic,
  PolicyEvaluationAssurance,
  PolicyReport,
  PolicySourceFileReport,
  PolicyViolation
} from '../../semantics/policies/types.ts';

type JsonRecord = Record<string, unknown>;

function exactRecord(
  value: unknown,
  label: string,
  required: readonly string[],
  optional: readonly string[] = []
): JsonRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
      || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error(`${label} must be a plain object`);
  }
  const record = value as JsonRecord;
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw new Error(`${label} contains unknown field ${key}`);
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      throw new Error(`${label} omits required field ${key}`);
    }
  }
  return record;
}

function arrayOf<T>(value: unknown, label: string, parse: (item: unknown, label: string) => T): T[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((item, index) => parse(item, `${label}[${index}]`));
}

function boundedString(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum || value.includes('\0')) {
    throw new Error(`${label} must be bounded non-empty text without NUL`);
  }
  return value;
}

function oneOf<const T extends readonly string[]>(value: unknown, label: string, values: T): T[number] {
  if (typeof value !== 'string' || !values.includes(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value as T[number];
}

function canonicalStrings(
  value: unknown,
  label: string,
  predicate: (item: unknown) => item is string
): string[] {
  const values = arrayOf(value, label, (item, itemLabel) => {
    if (!predicate(item)) throw new Error(`${itemLabel} is invalid`);
    return item;
  });
  if (!canonicalEquals(values, uniqueSorted(values))) {
    throw new Error(`${label} values must be unique and canonically ordered`);
  }
  return values;
}

const isPredicateId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,127}$/u.test(value);
const isLogicalPath = (value: unknown): value is string =>
  typeof value === 'string' && isCanonicalPortableLogicalPath(value);

function parsePolicySource(value: unknown, label: string): PolicySourceFileReport {
  const record = exactRecord(value, label, ['path', 'policyIds']);
  if (!isLogicalPath(record.path)) throw new Error(`${label}.path is invalid`);
  return {
    path: record.path,
    policyIds: canonicalStrings(record.policyIds, `${label}.policyIds`, isCanonicalPolicyId)
  };
}

function parseViolation(value: unknown, label: string, diagnostic: false): PolicyViolation;
function parseViolation(value: unknown, label: string, diagnostic: true): PolicyDiagnostic;
function parseViolation(value: unknown, label: string, diagnostic: boolean): PolicyViolation | PolicyDiagnostic {
  const required = [
    'id', 'severity', 'appliesTo', 'rule', 'files', 'message', 'sourceScope', 'sourcePath',
    ...(diagnostic ? ['evidenceClass'] : [])
  ];
  const record = exactRecord(value, label, required);
  if (!isCanonicalPolicyId(record.id)) throw new Error(`${label}.id is invalid`);
  if (!isPolicyRuleId(record.rule)) throw new Error(`${label}.rule is invalid`);
  if (!isLogicalPath(record.sourcePath)) throw new Error(`${label}.sourcePath is invalid`);
  const violation: PolicyViolation = {
    id: record.id,
    severity: oneOf(record.severity, `${label}.severity`, ['info', 'warn', 'error', 'blocker'] as const),
    appliesTo: canonicalStrings(record.appliesTo, `${label}.appliesTo`, isCanonicalBlockId),
    rule: record.rule,
    files: canonicalStrings(record.files, `${label}.files`, isLogicalPath),
    message: boundedString(record.message, `${label}.message`, 16_384),
    sourceScope: oneOf(record.sourceScope, `${label}.sourceScope`, ['official', 'project'] as const),
    sourcePath: record.sourcePath
  };
  if (!diagnostic) return violation;
  if (record.evidenceClass !== 'source-structure') throw new Error(`${label}.evidenceClass is invalid`);
  return { ...violation, evidenceClass: 'source-structure' };
}

function parseScope(value: unknown, label: string): PolicyReport['official'] {
  const record = exactRecord(value, label, ['policies', 'sources', 'violations']);
  return {
    policies: canonicalStrings(record.policies, `${label}.policies`, isCanonicalPolicyId),
    sources: arrayOf(record.sources, `${label}.sources`, parsePolicySource),
    violations: arrayOf(record.violations, `${label}.violations`, (item, itemLabel) =>
      parseViolation(item, itemLabel, false))
  };
}

function parseMergedPolicy(value: unknown, label: string): MergedPolicyReportEntry {
  const record = exactRecord(value, label, ['id', 'sourceScope', 'sourcePath', 'targets']);
  if (!isCanonicalPolicyId(record.id)) throw new Error(`${label}.id is invalid`);
  if (!isLogicalPath(record.sourcePath)) throw new Error(`${label}.sourcePath is invalid`);
  return {
    id: record.id,
    sourceScope: oneOf(record.sourceScope, `${label}.sourceScope`, ['official', 'project'] as const),
    sourcePath: record.sourcePath,
    targets: canonicalStrings(record.targets, `${label}.targets`, isLogicalPath)
  };
}

function parseEvaluation(value: unknown, label: string): PolicyEvaluationAssurance {
  const record = exactRecord(value, label, [
    'providerId', 'providerRevision', 'assurance',
    'requiredSemanticPredicates', 'unsupportedSemanticPredicates'
  ]);
  const requiredSemanticPredicates = canonicalStrings(
    record.requiredSemanticPredicates,
    `${label}.requiredSemanticPredicates`,
    isPredicateId
  );
  const unsupportedSemanticPredicates = canonicalStrings(
    record.unsupportedSemanticPredicates,
    `${label}.unsupportedSemanticPredicates`,
    isPredicateId
  );
  const required = new Set(requiredSemanticPredicates);
  if (unsupportedSemanticPredicates.some((predicate) => !required.has(predicate))) {
    throw new Error(`${label}.unsupportedSemanticPredicates must be required`);
  }
  return {
    providerId: boundedString(record.providerId, `${label}.providerId`, 256),
    providerRevision: boundedString(record.providerRevision, `${label}.providerRevision`, 256),
    assurance: oneOf(record.assurance, `${label}.assurance`, ['source-structure', 'semantic'] as const),
    requiredSemanticPredicates,
    unsupportedSemanticPredicates
  };
}

function parsePolicyReport(value: unknown): PolicyReport {
  const record = exactRecord(
    value,
    'Policy report',
    ['status', 'official', 'project', 'merged', 'violations'],
    ['diagnostics', 'evaluation']
  );
  const merged = exactRecord(record.merged, 'Policy report.merged', ['policies']);
  return {
    status: oneOf(record.status, 'Policy report.status', ['passed', 'failed', 'skipped'] as const),
    official: parseScope(record.official, 'Policy report.official'),
    project: parseScope(record.project, 'Policy report.project'),
    merged: {
      policies: arrayOf(merged.policies, 'Policy report.merged.policies', parseMergedPolicy)
    },
    violations: arrayOf(record.violations, 'Policy report.violations', (item, label) =>
      parseViolation(item, label, false)),
    ...(record.diagnostics === undefined ? {} : {
      diagnostics: arrayOf(record.diagnostics, 'Policy report.diagnostics', (item, label) =>
        parseViolation(item, label, true))
    }),
    ...(record.evaluation === undefined ? {} : {
      evaluation: parseEvaluation(record.evaluation, 'Policy report.evaluation')
    })
  };
}

type PolicyDeclaration = Readonly<{
  scope: 'official' | 'project';
  path: string;
  precedence: number;
}>;

function projectSourcePrecedence(sourcePath: string): number {
  if (sourcePath.startsWith(`${POLICY_SOURCE_PATHS.project}/`)) return 1;
  throw new Error(`Project Policy source is outside canonical precedence roots: ${sourcePath}`);
}

function sourcePrecedence(scope: 'official' | 'project', sourcePath: string): number {
  if (scope === 'official') {
    if (!sourcePath.startsWith(`${POLICY_SOURCE_PATHS.official}/`)) {
      throw new Error(`Official Policy source is outside canonical runtime policy root: ${sourcePath}`);
    }
    return 0;
  }
  return projectSourcePrecedence(sourcePath);
}

function violationKey(value: PolicyViolation): string {
  return [value.id, value.sourceScope, value.sourcePath, value.rule, value.severity,
    value.appliesTo.join(','), value.files.join(','), value.message].join('\u0000');
}

function assertCanonicalFindings(findings: readonly PolicyViolation[], label: string): void {
  const keys = findings.map(violationKey);
  if (new Set(keys).size !== keys.length) {
    throw new Error(`${label} contain duplicate semantic findings`);
  }
  const canonicalKeys = [...keys].sort(compareCodeUnits);
  if (!canonicalEquals(keys, canonicalKeys)) {
    throw new Error(`${label} are not canonically ordered`);
  }
}

export function validatePolicyReport(value: unknown): PolicyReport {
  const parsed = parsePolicyReport(value);
  const report: PolicyReport = { ...parsed, diagnostics: parsed.diagnostics ?? [] };
  if (parsed.diagnostics === undefined && (report.status !== 'skipped' || report.merged.policies.length !== 0)) {
    throw new Error('Only a not-applicable empty Policy report may omit migration diagnostics');
  }
  for (const scope of ['official', 'project'] as const) {
    const sourcePaths = report[scope].sources.map((source) => source.path);
    if (!canonicalEquals(sourcePaths, uniqueSorted(sourcePaths))) throw new Error(`Policy ${scope} sources are not canonical`);
    const declared = uniqueSorted(report[scope].sources.flatMap((source) => source.policyIds));
    if (!canonicalEquals(report[scope].policies, declared)) throw new Error(`Policy ${scope} policies differ from sources`);
    const expectedViolations = report.violations.filter((entry) => entry.sourceScope === scope);
    if (!canonicalEquals(report[scope].violations, expectedViolations)) throw new Error(`Policy ${scope} violations differ from global violations`);
  }
  const diagnostics = report.diagnostics ?? [];
  assertCanonicalFindings(report.violations, 'Policy violations');
  assertCanonicalFindings(diagnostics, 'Policy diagnostics');

  const winningDeclarations = new Map<string, PolicyDeclaration>();
  for (const scope of ['official', 'project'] as const) {
    for (const source of report[scope].sources) {
      const precedence = sourcePrecedence(scope, source.path);
      for (const id of source.policyIds) {
        const previous = winningDeclarations.get(id);
        if (!previous || precedence > previous.precedence ||
            (precedence === previous.precedence && compareCodeUnits(source.path, previous.path) > 0)) {
          winningDeclarations.set(id, { scope, path: source.path, precedence });
        }
      }
    }
  }
  const expectedMergedIds = uniqueSorted([...winningDeclarations.keys()]);
  const mergedIds = report.merged.policies.map((entry) => entry.id);
  if (!canonicalEquals(mergedIds, expectedMergedIds)) {
    throw new Error('Policy merged set differs from the declared Policy identity set');
  }
  for (const merged of report.merged.policies) {
    const winner = winningDeclarations.get(merged.id);
    if (!winner || winner.scope !== merged.sourceScope || winner.path !== merged.sourcePath) {
      throw new Error(`Policy merged winner does not match canonical source precedence: ${merged.id}`);
    }
  }
  for (const finding of [...report.violations, ...diagnostics]) {
    const winner = winningDeclarations.get(finding.id);
    if (!winner || winner.scope !== finding.sourceScope || winner.path !== finding.sourcePath) {
      throw new Error(`Policy finding does not bind the canonical winning declaration: ${finding.id}`);
    }
  }

  const applicable = report.merged.policies.some((entry) => entry.targets.length > 0);
  const failed = report.violations.some((entry) => entry.severity === 'error' || entry.severity === 'blocker');
  const expectedStatus: PolicyReport['status'] = !applicable ? 'skipped' : failed ? 'failed' : 'passed';
  if (report.status !== expectedStatus) throw new Error('Policy status differs from applicability/violations');
  if (report.merged.policies.length === 0 ? report.evaluation !== undefined : report.evaluation === undefined) {
    throw new Error('Policy evaluator assurance does not match the merged policy set');
  }
  return deepFreeze(report);
}
