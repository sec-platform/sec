import ejs from 'ejs';
import path from 'node:path';
import { readOptionalCiArtifactManifestV1 } from '../../shared/ci-artifact-authority.ts';
import { CI_ARTIFACT_PATHS } from '../../shared/ci-artifact-contract.ts';
import { countMatching, countPositiveValues, uniqueSorted } from '../../shared/collections.ts';
import { CompilerError } from '../../shared/errors.ts';
import { EXPLAIN_NODE_TYPES, type ExplainGraph } from '../../shared/explain-types.ts';
import { writeText, type CommitFence } from '../../shared/fs.ts';
import type { LockFile } from '../../shared/lock-types.ts';
import { writeGeneratedArtifactWithLock } from '../../shared/lock-utils.ts';
import { portableLogicalPathCollisionKeyV1 } from '../../shared/logical-path-identity.ts';
import {
  getWorkspacePaths,
  graphViewRelativePath,
  overviewViewRelativePath,
  reviewViewRelativePath,
  slotRuleViewRelativePath,
  sourceViewRelativePath
} from '../../shared/paths.ts';
import {
  buildProjectOverview,
  PROJECT_OVERVIEW_OPTIONAL_TOOL_REPORT_PATHS,
  type ProjectOverview
} from '../../shared/project-overview.ts';
import { readOptionalProvenanceFileV1 } from '../../shared/provenance-authority.ts';
import type { ProvenanceFile } from '../../shared/provenance-types.ts';
import { readOptionalRetainedJsonV1 } from '../../shared/retained-file-read.ts';
import { buildE2eMatrix } from '../../shared/review-matrix.ts';
import type { ReviewSummary } from '../../shared/review-types.ts';
import { buildReviewUpgradePreflightSummaries } from '../../shared/review-upgrade.ts';
import { compilerRuntimeResources } from '../../shared/runtime-layout.ts';
import { semanticViewFactIds, type SemanticViewSet } from '../../shared/semantic-view-types.ts';
import type { ToolEvidenceReport } from '../../shared/tool-evidence-contract.ts';
import { readOptionalCanonicalVerificationArtifactSetV1 } from '../../shared/verification-artifact-authority.ts';
import { readReviewGovernanceReports } from './read-review-governance-reports.ts';
import { buildRuntimeAttributions, classifyRuntimeEntry, detectVerticalFromPath } from './runtime-attribution.ts';
import { assertSemanticViewArtifactsAreCurrent } from './semantic-view-artifact-contract.ts';

const TEMPLATES_DIR = compilerRuntimeResources.localViewTemplates;
const CANONICAL_LOCAL_VIEW_GENERATED_AT = '1970-01-01T00:00:00.000Z';

function formatList(values: Iterable<string>, fallback = 'none'): string {
  const items = uniqueSorted([...values]);
  return items.length > 0 ? items.join(', ') : fallback;
}

function esc(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function metricTable(rows: readonly (readonly unknown[])[]): string {
  return dataTable(['Metric', 'Value'], rows, 2, 'No metrics.');
}

function dataTable(
  headers: readonly string[],
  rows: readonly (readonly unknown[])[],
  colspan: number,
  emptyMsg: string
): string {
  const body = rows.length === 0
    ? `<tr><td colspan="${colspan}">${esc(emptyMsg)}</td></tr>`
    : rows.map((row) => `<tr>${row.map((cell) => `<td>${esc(cell)}</td>`).join('')}</tr>`).join('');
  return [
    '<table>',
    `<thead><tr>${headers.map((header) => `<th>${esc(header)}</th>`).join('')}</tr></thead>`,
    `<tbody>${body}</tbody>`,
    '</table>'
  ].join('');
}

function card(title: string, content: string): string {
  return `<section class="card"><h2>${esc(title)}</h2>${content}</section>`;
}
function subCard(title: string, content: string): string { return `<h3>${esc(title)}</h3>${content}`; }
function jsonPre(value: unknown): string { return `<pre>${esc(JSON.stringify(value, null, 2))}</pre>`; }
const templateHelpers = { esc, metricTable, dataTable, card, subCard, jsonPre };

export function buildSemanticViewRows(semanticViews: SemanticViewSet): string[][] {
  return semanticViews.views.map((view) => {
    const factIds = semanticViewFactIds(view);
    return [view.viewKind, view.subject ?? 'workspace', String(view.nodes.length), String(view.edges.length), String(factIds.length), formatList(factIds)];
  });
}

function readRequiredArtifact<T>(filePath: string, label: string): T {
  const value = readOptionalRetainedJsonV1<T>(filePath, label);
  if (value === null) throw new CompilerError('EXPLAIN-BLOCKED-003', `${label} is missing`);
  return value;
}

function readRequiredProvenance(filePath: string, label: string): ProvenanceFile {
  try {
    const value = readOptionalProvenanceFileV1(filePath, label);
    if (value === null) throw new CompilerError('EXPLAIN-BLOCKED-003', `${label} is missing`);
    return value;
  } catch (error) {
    if (error instanceof CompilerError) throw error;
    throw new CompilerError('EXPLAIN-BLOCKED-003', `${label} is malformed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readRequiredVerificationArtifacts(workspaceRoot: string) {
  try {
    const artifacts = readOptionalCanonicalVerificationArtifactSetV1(
      workspaceRoot,
      'Local Views Verification artifact set'
    );
    if (artifacts === null) throw new CompilerError('EXPLAIN-BLOCKED-003', 'Verification artifact set is missing');
    return artifacts;
  } catch (error) {
    if (error instanceof CompilerError) throw error;
    throw new CompilerError('EXPLAIN-BLOCKED-003', `Verification artifact set is malformed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function renderTemplate(name: string, data: Record<string, unknown>): Promise<string> {
  return ejs.renderFile(path.join(TEMPLATES_DIR, name), { viewHelpers: templateHelpers, ...templateHelpers, ...data }, { async: true });
}
async function renderLayout(title: string, currentNav: 'overview' | 'source' | 'slot-rule' | 'graph' | 'review', body: string): Promise<string> {
  return renderTemplate('layout.ejs', { title, currentNav, body });
}

function buildOverviewNextAction(overview: ProjectOverview): string {
  switch (overview.status.overall) {
    case 'failed': return 'Open Review View first, resolve failure points and blockers, then rerun verification.';
    case 'attention': return 'Inspect priority review files and missing artifacts, then rerun verification for handoff readiness.';
    case 'passed': return 'Use the linked workbench views for AI handoff or deeper source and graph inspection.';
    case 'not-run': return 'Complete required governance steps before handing the workspace to review or AI repair.';
    case 'unknown': return 'Refresh governance artifacts, then reopen this overview to rebuild the workbench state.';
  }
}

export interface LocalViewArtifact {
  readonly relativePath: typeof overviewViewRelativePath | typeof sourceViewRelativePath | typeof slotRuleViewRelativePath | typeof graphViewRelativePath | typeof reviewViewRelativePath;
  readonly text: string;
}

export async function buildLocalViewArtifacts(
  workspaceRoot: string,
  lockInput?: LockFile
): Promise<LocalViewArtifact[]> {
  const { ciArtifactsPath, explainGraphPath, lockPath, provenancePath, reviewSummaryPath } = getWorkspacePaths(workspaceRoot);
  const lock = lockInput ?? readRequiredArtifact<LockFile>(lockPath, 'graph.lock.json');
  const graph = readRequiredArtifact<ExplainGraph>(explainGraphPath, 'explain-graph.json');
  assertSemanticViewArtifactsAreCurrent(lock, graph);
  const provenance = readRequiredProvenance(provenancePath, 'provenance.json');
  const verificationArtifacts = readRequiredVerificationArtifacts(workspaceRoot);
  const report = verificationArtifacts.verificationReport;
  const coverage = verificationArtifacts.acceptanceCoverage;
  const policyReport = verificationArtifacts.policyReport;
  const review = readRequiredArtifact<ReviewSummary>(reviewSummaryPath, 'review-summary.json');
  const artifactManifest = readOptionalCiArtifactManifestV1(ciArtifactsPath, 'CI Artifact manifest');
  const codeQuality = readOptionalRetainedJsonV1<ToolEvidenceReport>(path.join(workspaceRoot, PROJECT_OVERVIEW_OPTIONAL_TOOL_REPORT_PATHS['code-quality']), 'Code quality report');
  const architectureBoundary = readOptionalRetainedJsonV1<ToolEvidenceReport>(path.join(workspaceRoot, PROJECT_OVERVIEW_OPTIONAL_TOOL_REPORT_PATHS['architecture-boundary']), 'Architecture boundary report');
  const semanticPattern = readOptionalRetainedJsonV1<ToolEvidenceReport>(path.join(workspaceRoot, PROJECT_OVERVIEW_OPTIONAL_TOOL_REPORT_PATHS['semantic-pattern']), 'Semantic pattern report');
  const { repairPlan, upgradeDiagnostics, upgradePlan } = readReviewGovernanceReports(workspaceRoot);

  const overview = buildProjectOverview({
    workspaceRoot,
    generatedAt: CANONICAL_LOCAL_VIEW_GENERATED_AT,
    lock,
    explainGraph: graph,
    provenance,
    verification: report,
    acceptanceCoverage: coverage,
    policy: policyReport,
    reviewSummary: review,
    artifactManifest,
    toolEvidenceReports: [codeQuality, architectureBoundary, semanticPattern].filter((toolReport): toolReport is ToolEvidenceReport => toolReport !== null)
  });

  const sharedData = {
    review, lock, provenance, policyReport, graph, repairPlan, upgradeDiagnostics, upgradePlan,
    semanticViewRows: buildSemanticViewRows(graph.semanticViews), explainNodeTypes: EXPLAIN_NODE_TYPES,
    countMatching, countPositiveValues, uniqueSorted, formatList,
    buildE2eMatrix, buildReviewUpgradePreflightSummaries,
    buildRuntimeAttributions, classifyRuntimeEntry, detectVerticalFromPath
  };

  // These template reads/renders are independent real async operations. The
  // layout phase starts only after every body has been constructed, preserving
  // deterministic data while overlapping provider-backed file I/O.
  const [overviewBody, sourceBody, slotRuleBody, graphBody, reviewBody] = await Promise.all([
    renderTemplate('overview-view.ejs', { overview, nextAction: buildOverviewNextAction(overview) }),
    renderTemplate('source-view.ejs', sharedData),
    renderTemplate('slot-rule-view.ejs', { ...sharedData, report, coverage }),
    renderTemplate('graph-view.ejs', sharedData),
    renderTemplate('review-view.ejs', sharedData)
  ]);
  const [overviewHtml, sourceHtml, slotRuleHtml, graphHtml, reviewHtml] = await Promise.all([
    renderLayout('Overview', 'overview', overviewBody),
    renderLayout('Source View', 'source', sourceBody),
    renderLayout('Slot / Rule View', 'slot-rule', slotRuleBody),
    renderLayout('Graph View', 'graph', graphBody),
    renderLayout('Review View', 'review', reviewBody)
  ]);

  return [
    { relativePath: overviewViewRelativePath, text: overviewHtml },
    { relativePath: sourceViewRelativePath, text: sourceHtml },
    { relativePath: slotRuleViewRelativePath, text: slotRuleHtml },
    { relativePath: graphViewRelativePath, text: graphHtml },
    { relativePath: reviewViewRelativePath, text: reviewHtml }
  ];
}

export async function writeLocalViews(workspaceRoot: string, commitFence?: CommitFence): Promise<void> {
  const { lockPath } = getWorkspacePaths(workspaceRoot);
  const lock = readRequiredArtifact<LockFile>(lockPath, 'graph.lock.json');
  await writeGeneratedArtifactWithLock(
    lockPath,
    lock,
    CI_ARTIFACT_PATHS.view,
    async () => {
      const artifacts = await buildLocalViewArtifacts(workspaceRoot, lock);
      const writePaths = artifacts.map((artifact) => artifact.relativePath);
      if (new Set(writePaths.map((value) => portableLogicalPathCollisionKeyV1(
        value,
        'Local View publication path'
      ))).size !== writePaths.length) {
        throw new Error('Local View publication contains duplicate target paths');
      }
      await Promise.all(artifacts.map((artifact) =>
        writeText(path.join(workspaceRoot, artifact.relativePath), artifact.text, commitFence)
      ));
    },
    commitFence
  );
}
