import { z } from 'zod';

import { deepFreeze } from '../../../system-architecture/foundation/runtime/canonical.ts';
import { parseExactJson } from '../../../system-architecture/foundation/runtime/exact-json.ts';
import { REVIEW_SUMMARY_FORMAT_VERSION, type ReviewSummary } from './types.ts';

const text = z.string();
const texts = z.array(text);
const count = z.number().int().nonnegative();
const counts = z.record(text, count);

const ciSummary = z.object({
  status: z.enum(['passed', 'attention', 'failed']),
  failureCount: count,
  regressionRiskCount: count,
  conflictHintCount: count,
  impactedBlockCount: count,
  runtimeEntryCount: count
}).strict();

const chainStage = z.object({
  id: z.enum(['verification', 'coverage', 'artifacts', 'review']),
  status: z.enum(['passed', 'attention', 'failed']),
  detail: text
}).strict();

const chainSummary = z.object({
  status: z.enum(['passed', 'attention', 'failed']),
  stageCount: count,
  passedStageCount: count,
  attentionStageCount: count,
  failedStageCount: count,
  stageSummaries: z.array(chainStage)
}).strict();

const semanticView = z.object({
  viewKind: z.enum(['architecture', 'scenario', 'state']),
  subject: text.optional(),
  nodeCount: count,
  edgeCount: count,
  factCount: count,
  factIds: texts
}).strict();

const semanticViewSummary = z.object({
  formatVersion: text,
  inputRevision: text,
  semanticRevision: text,
  viewCount: count,
  subjectCount: count,
  nodeCount: count,
  edgeCount: count,
  factCount: count,
  viewKindCounts: z.object({ architecture: count, scenario: count, state: count }).strict(),
  factIds: texts,
  views: z.array(semanticView)
}).strict();

const artifactUploadGroup = z.object({
  kind: z.enum(['governance', 'test', 'contract']),
  count,
  paths: texts
}).strict();

const artifactMissing = z.object({
  path: text,
  reason: z.enum(['declared-generated-missing', 'fixed-governance-missing', 'stale-semantic-projection']),
  declaredBy: z.enum(['graph.lock.json', 'artifact-manifest'])
}).strict();

const artifactSummary = z.object({
  artifactCount: count,
  governanceCount: count,
  missingCount: count,
  artifactStatus: z.enum(['passed', 'attention']).optional(),
  testCount: count.optional(),
  contractCount: count.optional(),
  contractPaths: texts.optional(),
  uploadGroupCount: count.optional(),
  missingReasonTypeCount: count.optional(),
  missingReasonCounts: z.object({
    'declared-generated-missing': count,
    'fixed-governance-missing': count,
    'stale-semantic-projection': count
  }).strict().optional(),
  uploadGroups: z.array(artifactUploadGroup).optional(),
  missing: z.array(artifactMissing).optional()
}).strict();

const coverageTarget = z.object({
  id: text,
  declaredAcceptanceCount: count,
  coveredByCount: count,
  declaredAcceptance: texts,
  coveredBy: texts
}).strict();

const coverageSummary = z.object({
  status: z.enum(['passed', 'failed', 'skipped']),
  acceptancePassedCount: count,
  blockCount: count,
  coveredBlockCount: count,
  uncoveredBlockCount: count,
  acceptancePassed: texts,
  uncoveredBlocks: texts,
  blockSummaries: z.array(coverageTarget)
}).strict();

const provenanceOrigin = z.object({
  originType: z.enum(['block', 'generated', 'override']),
  count,
  paths: texts
}).strict();

const provenanceOverride = z.object({
  overrideStatus: z.enum(['none', 'manual', 'rule-backed']),
  count,
  paths: texts
}).strict();

const provenanceRegistry = z.object({
  registrySourceId: text,
  registryKind: z.enum(['official', 'private', 'community']).optional(),
  registryLocation: z.enum(['compiler', 'workspace']).optional(),
  count,
  paths: texts
}).strict();

const provenancePass = z.object({ pass: text, count, paths: texts }).strict();

const provenanceSummary = z.object({
  artifactCount: count,
  verifiedArtifactCount: count,
  unverifiedArtifactCount: count,
  overrideArtifactCount: count,
  registryArtifactCount: count,
  generatedArtifactCount: count,
  generatedPassCount: count,
  originSummaryCount: count,
  originSummaries: z.array(provenanceOrigin),
  overrideSummaryCount: count,
  overrideSummaries: z.array(provenanceOverride),
  registrySummaryCount: count,
  registrySummaries: z.array(provenanceRegistry),
  generatedPassSummaries: z.array(provenancePass),
  unverifiedArtifacts: texts
}).strict();

const repairFailureTaxonomyEntry = z.object({ id: text, count }).strict();
const repairFailureTaxonomy = z.object({
  laneSummaries: z.array(repairFailureTaxonomyEntry),
  kindSummaries: z.array(repairFailureTaxonomyEntry),
  issueTypeSummaries: z.array(repairFailureTaxonomyEntry),
  repairabilitySummaries: z.array(repairFailureTaxonomyEntry)
}).strict();

const repairTask = z.object({
  taskId: text,
  category: z.enum(['file-repair', 'config-repair', 'generated-artifact-refresh']),
  targetBlock: text,
  targetFile: text,
  previewStatus: z.enum(['changed', 'unchanged', 'missing']),
  addedLines: count,
  removedLines: count,
  failurePointCount: count,
  targetIds: texts,
  allowedPathCount: count,
  requiredSymbolCount: count,
  forbiddenOperationCount: count,
  testCount: count,
  failureTargetCount: count,
  writeBounds: texts,
  requiredSymbols: texts,
  forbiddenOperations: texts,
  testsToPass: texts,
  failureTargets: texts
}).strict();

const repairBlocker = z.object({
  blockerId: text,
  boundary: text,
  reason: text,
  decisionRequired: text,
  failurePointCount: count
}).strict();

const repairSummary = z.object({
  status: z.enum(['pending', 'applied', 'skipped', 'blocked']),
  sourceVerificationStatus: z.enum(['passed', 'failed']),
  requiresVerification: z.boolean(),
  taskCount: count,
  blockerCount: count,
  previewCount: count,
  changedPreviewCount: count,
  failurePointCount: count,
  verificationTrace: z.object({
    pendingReason: z.enum(['repair-not-applied', 'verify-required', 'blocked', 'none']),
    nextAction: z.enum(['apply-repair', 'rerun-verify', 'resolve-blocker', 'none'])
  }).strict(),
  failureTaxonomy: repairFailureTaxonomy,
  targetSummaries: z.array(z.object({
    id: text,
    targetType: z.enum(['generated-file', 'file-target', 'acceptance-case', 'policy-target', 'runtime-target', 'unknown']),
    count
  }).strict()),
  taskCategorySummaries: z.array(repairFailureTaxonomyEntry),
  targetFileCount: count,
  targetFiles: texts,
  taskSummaries: z.array(repairTask),
  blockerSummaries: z.array(repairBlocker)
}).strict();

const migrationOperation = z.object({
  id: text,
  kind: text,
  target: text,
  role: z.enum(['file', 'directory', 'json', 'text', 'prisma']),
  source: text.optional(),
  path: texts.optional(),
  updateCount: count.optional(),
  itemCount: count.optional(),
  valueKeyCount: count.optional(),
  contentLength: count.optional(),
  searchLength: count.optional(),
  replacementLength: count.optional(),
  pattern: text.optional(),
  flags: text.optional(),
  entity: text.optional(),
  expandField: text.optional(),
  contractField: text.optional()
}).strict();

const upgradeSummary = z.object({
  status: z.enum(['planned', 'applied', 'blocked']),
  blockId: text,
  fromVersion: text.optional(),
  toVersion: text,
  preflightCheckCount: count,
  preflightEvidenceCount: count,
  migrationCount: count,
  migrationKindCounts: counts,
  requiresVerification: z.boolean(),
  requiresVerificationCount: count,
  impactCount: count,
  impacts: texts,
  sourceMigrationCount: count,
  verificationSummaries: z.array(z.object({ id: z.enum(['required', 'skipped']), count }).strict()),
  preflightSummaries: z.array(z.object({ group: text, checkCount: count, evidenceCount: count }).strict()),
  migrationSummaries: z.array(z.object({
    id: text,
    kind: text,
    target: text,
    reason: text,
    requiresVerification: z.boolean(),
    source: text.optional()
  }).strict()),
  migrationOperationCount: count,
  migrationOperationSummaries: z.array(migrationOperation),
  diagnostics: z.object({
    status: z.literal('blocked'),
    phase: z.enum(['planning', 'apply']),
    failedCheck: text,
    errorCode: text,
    message: text,
    details: z.unknown().optional()
  }).strict().optional()
}).strict();

const policySummary = z.object({
  status: z.enum(['passed', 'attention', 'failed', 'skipped']),
  sourceReportStatus: z.enum(['passed', 'failed', 'skipped']),
  assurance: z.enum(['source-structure', 'semantic', 'unknown']),
  evaluatorProviderId: text.nullable(),
  evaluatorProviderRevision: text.nullable(),
  unsupportedSemanticPredicates: texts,
  diagnosticCount: count,
  officialPolicyCount: count,
  projectPolicyCount: count,
  mergedPolicyCount: count,
  sourceCount: count,
  violationCount: count,
  severityCounts: z.object({
    info: count.optional(),
    warn: count.optional(),
    error: count.optional(),
    blocker: count.optional()
  }).strict(),
  sourceSummaries: z.array(z.object({
    scope: z.enum(['official', 'project']),
    path: text,
    policyIds: texts
  }).strict()),
  mergedSummaries: z.array(z.object({
    id: text,
    sourceScope: z.enum(['official', 'project']),
    sourcePath: text,
    targetCount: count,
    targets: texts
  }).strict()),
  violationSummaries: z.array(z.object({
    id: text,
    severity: z.enum(['info', 'warn', 'error', 'blocker']),
    rule: text,
    fileCount: count,
    files: texts,
    appliesTo: texts,
    message: text,
    sourceScope: z.enum(['official', 'project']),
    sourcePath: text
  }).strict())
}).strict();

const installImpact = z.object({
  blockId: text,
  actionKinds: texts,
  sourceRoots: texts,
  targetPaths: texts,
  verticals: texts,
  runtimeEntries: texts
}).strict();

const installImpactGroup = z.object({
  vertical: text,
  blockCount: count,
  actionKindCount: count,
  runtimeEntryCount: count,
  targetPathCount: count,
  blocks: texts,
  actionKinds: texts,
  runtimeEntries: texts,
  targetPaths: texts
}).strict();

const installImpactSummary = z.object({
  impactCount: count,
  blockCount: count,
  actionKindCount: count,
  sourceRootCount: count,
  targetPathCount: count,
  verticalCount: count,
  runtimeEntryCount: count,
  groupCount: count,
  blocks: texts,
  actionKinds: texts,
  sourceRoots: texts,
  targetPaths: texts,
  verticals: texts,
  runtimeEntries: texts,
  groupSummaries: z.array(installImpactGroup)
}).strict();

const changeSource = z.object({
  path: text,
  originType: z.enum(['block', 'generated', 'override']),
  originId: text,
  sourcePath: text.optional(),
  runtimeTarget: text.optional(),
  registrySourceId: text.optional(),
  registryKind: z.enum(['official', 'private', 'community']).optional(),
  registryLocation: z.enum(['compiler', 'workspace']).optional(),
  runtimeKind: z.enum(['library', 'service']).optional(),
  vertical: text.optional(),
  relatedBlocks: texts.optional()
}).strict();

const runtimeEntry = z.object({
  path: text,
  kind: z.enum(['library', 'service']),
  vertical: text.optional(),
  relatedBlocks: texts
}).strict();

const failurePoint = z.object({
  lane: z.enum(['fast', 'runtime', 'all']),
  kind: z.enum(['summary', 'policy', 'build', 'unit', 'acceptance', 'upgrade', 'repair']),
  message: text,
  artifactPath: text
}).strict();

const regressionRisk = z.object({
  kind: z.enum(['coverage-gap', 'override-active', 'upgrade-impact', 'upgrade-verification', 'repair-verification']),
  message: text,
  blockId: text.optional()
}).strict();

const conflictHint = z.object({
  kind: z.enum(['override-conflict', 'upgrade-plan-present', 'upgrade-preflight-passed', 'repair-plan-present', 'repair-blocked']),
  message: text,
  relatedId: text
}).strict();

export const ReviewSummarySchema = z.object({
  formatVersion: z.literal(REVIEW_SUMMARY_FORMAT_VERSION),
  ciSummary,
  chainSummary,
  semanticViewSummary: semanticViewSummary.optional(),
  artifactSummary: artifactSummary.optional(),
  coverageSummary: coverageSummary.optional(),
  provenanceSummary: provenanceSummary.optional(),
  repairSummary: repairSummary.optional(),
  upgradeSummary: upgradeSummary.optional(),
  policySummary: policySummary.optional(),
  changeSourceCount: count,
  runtimeEntryCount: count,
  installImpactCount: count,
  changeSources: z.array(changeSource),
  runtimeEntries: z.array(runtimeEntry),
  verticalSlices: z.array(z.object({ id: text, runtimeEntries: texts, relatedBlocks: texts }).strict()),
  installImpacts: z.array(installImpact),
  installImpactSummary,
  impactedBlocks: texts,
  failurePoints: z.array(failurePoint),
  regressionRisks: z.array(regressionRisk),
  conflictHints: z.array(conflictHint)
}).strict();

export function validateReviewSummary(value: unknown): ReviewSummary {
  return deepFreeze(ReviewSummarySchema.parse(value)) as ReviewSummary;
}

/**
 * Parses one durable Review Summary without losing duplicate object keys before
 * the domain schema can enforce its exact field and format identity contract.
 */
export function parseReviewSummaryJson(source: string): ReviewSummary {
  return validateReviewSummary(parseExactJson(source, 'Review Summary JSON'));
}
