import { z } from 'zod';

import { isCanonicalBlockId } from './block-identity.ts';
import { canonicalEquals, compareCodeUnits, deepFreeze } from './canonical-primitives.ts';
import { uniqueSorted } from './collections.ts';
import { isCanonicalPortableLogicalPathV1 } from './logical-path-identity.ts';
import { officialPoliciesRelativePath, posixPath } from './paths.ts';
import { isCanonicalPolicyId } from './policy-identity.ts';
import type { PolicyReport, PolicyViolation } from './policy-types.ts';
import { readOptionalRetainedJsonV1 } from './retained-file-read.ts';

const canonicalArray = (item: z.ZodType<string>) => z.array(item).superRefine((values, context) => {
  if (!canonicalEquals(values, uniqueSorted(values))) {
    context.addIssue({ code: 'custom', message: 'values must be unique and canonically ordered' });
  }
});
const policyId = z.string().refine(isCanonicalPolicyId, 'invalid Policy ID');
const blockId = z.string().refine(isCanonicalBlockId, 'invalid Block ID');
const logicalPath = z.string().refine(isCanonicalPortableLogicalPathV1, 'invalid portable logical path');
const predicateId = z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/u);
const severity = z.enum(['info', 'warn', 'error', 'blocker']);
const sourceScope = z.enum(['official', 'project']);
const policyRule = z.literal('tenant_context_must_flow_to_query');

const sourceSchema = z.object({
  path: logicalPath,
  policyIds: canonicalArray(policyId)
}).strict();
const violationSchema = z.object({
  id: policyId,
  severity,
  appliesTo: canonicalArray(blockId),
  rule: policyRule,
  files: canonicalArray(logicalPath),
  message: z.string().min(1).max(16_384).refine((value) => !value.includes('\0')),
  sourceScope,
  sourcePath: logicalPath
}).strict();
const diagnosticSchema = violationSchema.extend({ evidenceClass: z.literal('source-structure') }).strict();
const scopeSchema = z.object({
  policies: canonicalArray(policyId),
  sources: z.array(sourceSchema),
  violations: z.array(violationSchema)
}).strict();
const mergedPolicySchema = z.object({
  id: policyId,
  sourceScope,
  sourcePath: logicalPath,
  targets: canonicalArray(logicalPath)
}).strict();
const evaluationSchema = z.object({
  providerId: z.string().min(1).max(256),
  providerRevision: z.string().min(1).max(256),
  assurance: z.enum(['source-structure', 'semantic']),
  requiredSemanticPredicates: canonicalArray(predicateId),
  unsupportedSemanticPredicates: canonicalArray(predicateId)
}).strict().superRefine((value, context) => {
  const required = new Set(value.requiredSemanticPredicates);
  if (value.unsupportedSemanticPredicates.some((predicate) => !required.has(predicate))) {
    context.addIssue({ code: 'custom', path: ['unsupportedSemanticPredicates'], message: 'unsupported predicates must be required' });
  }
});
const reportSchema = z.object({
  status: z.enum(['passed', 'failed', 'skipped']),
  official: scopeSchema,
  project: scopeSchema,
  merged: z.object({ policies: z.array(mergedPolicySchema) }).strict(),
  violations: z.array(violationSchema),
  diagnostics: z.array(diagnosticSchema).optional(),
  evaluation: evaluationSchema.optional()
}).strict();

type PolicyDeclaration = Readonly<{
  scope: 'official' | 'project';
  path: string;
  precedence: number;
}>;

function projectSourcePrecedence(sourcePath: string): number {
  if (sourcePath.startsWith('project/source/policies/')) return 1;
  if (sourcePath.startsWith('project/policies/')) return 2;
  if (sourcePath.startsWith('source/model/policies/')) return 3;
  throw new Error(`Project Policy source is outside canonical precedence roots: ${sourcePath}`);
}

function sourcePrecedence(scope: 'official' | 'project', sourcePath: string): number {
  if (scope === 'official') {
    if (!sourcePath.startsWith(`${posixPath(officialPoliciesRelativePath)}/`)) {
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

export function validatePolicyReportV1(value: unknown): PolicyReport {
  const parsed = reportSchema.parse(value);
  const report: PolicyReport = { ...parsed, diagnostics: parsed.diagnostics ?? [] } as PolicyReport;
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

export function readOptionalPolicyReportV1(filePath: string, label = 'Policy report'): PolicyReport | null {
  const raw = readOptionalRetainedJsonV1<unknown>(filePath, label);
  return raw === null ? null : validatePolicyReportV1(raw);
}
