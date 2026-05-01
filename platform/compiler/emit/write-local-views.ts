import ejs from 'ejs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { AcceptanceCoverageReport } from '../../shared/acceptance-types.ts';
import { CI_ARTIFACT_PATHS } from '../../shared/ci-artifact-contract.ts';
import { countMatching, countPositiveValues, uniqueSorted } from '../../shared/collections.ts';
import { CompilerError } from '../../shared/errors.ts';
import type { ExplainGraph } from '../../shared/explain-types.ts';
import { ensureDir, pathExists, readJson } from '../../shared/fs.ts';
import type { LockFile } from '../../shared/lock-types.ts';
import { writeLockWithGeneratedPaths } from '../../shared/lock-utils.ts';
import { getWorkspacePaths } from '../../shared/paths.ts';
import type { PolicyReport } from '../../shared/policy-types.ts';
import type { ProvenanceFile } from '../../shared/provenance-types.ts';
import { buildE2eMatrix } from '../../shared/review-matrix.ts';
import type { ReviewSummary } from '../../shared/review-types.ts';
import { buildReviewUpgradePreflightSummaries } from '../../shared/review-upgrade.ts';
import type { VerificationReport } from '../../shared/verification-types.ts';
import { readReviewGovernanceReports } from './read-review-governance-reports.ts';
import { buildRuntimeAttributions, classifyRuntimeEntry, detectVerticalFromPath } from './runtime-attribution.ts';

const TEMPLATES_DIR = path.join(import.meta.dirname, 'templates');

function formatList(values: Iterable<string>, fallback = 'none'): string {
  const items = uniqueSorted([...values]);
  return items.length > 0 ? items.join(', ') : fallback;
}

async function readRequiredArtifact<T>(filePath: string, label: string): Promise<T> {
  if (!(await pathExists(filePath))) {
    throw new CompilerError('EXPLAIN-BLOCKED-003', `${label} is missing`);
  }
  return readJson<T>(filePath);
}

async function renderTemplate(name: string, data: Record<string, unknown>): Promise<string> {
  const filePath = path.join(TEMPLATES_DIR, name);
  return ejs.renderFile(filePath, data, { async: true });
}

async function renderLayout(title: string, currentNav: 'source' | 'slot-rule', body: string): Promise<string> {
  return renderTemplate('layout.ejs', { title, currentNav, body });
}

export async function writeLocalViews(workspaceRoot: string): Promise<void> {
  const {
    acceptanceCoveragePath,
    explainGraphPath,
    generatedViewsDir,
    lockPath,
    policyReportPath,
    provenancePath,
    reviewSummaryPath,
    sourceViewPath,
    slotRuleViewPath,
    verificationReportPath
  } = getWorkspacePaths(workspaceRoot);

  const lock = await readRequiredArtifact<LockFile>(lockPath, 'graph.lock.json');
  await ensureDir(generatedViewsDir);
  await writeLockWithGeneratedPaths(lockPath, lock, CI_ARTIFACT_PATHS.view);

  const [provenance, report, coverage, policyReport, review, graph, governanceReports] = await Promise.all([
    readRequiredArtifact<ProvenanceFile>(provenancePath, 'provenance.json'),
    readRequiredArtifact<VerificationReport>(verificationReportPath, 'verification-report.json'),
    readRequiredArtifact<AcceptanceCoverageReport>(acceptanceCoveragePath, 'acceptance-coverage.json'),
    readRequiredArtifact<PolicyReport>(policyReportPath, 'policy-report.json'),
    readRequiredArtifact<ReviewSummary>(reviewSummaryPath, 'review-summary.json'),
    readRequiredArtifact<ExplainGraph>(explainGraphPath, 'explain-graph.json'),
    readReviewGovernanceReports(workspaceRoot)
  ]);
  const { repairPlan, upgradeDiagnostics, upgradePlan } = governanceReports;

  const sharedData = {
    review, lock, provenance, policyReport, graph, repairPlan, upgradeDiagnostics, upgradePlan,
    countMatching, countPositiveValues, uniqueSorted, formatList,
    buildE2eMatrix, buildReviewUpgradePreflightSummaries,
    buildRuntimeAttributions, classifyRuntimeEntry, detectVerticalFromPath
  };

  const sourceBody = await renderTemplate('source-view.ejs', sharedData);
  const sourceHtml = await renderLayout('Source View', 'source', sourceBody);
  await fs.writeFile(sourceViewPath, sourceHtml, 'utf8');

  const slotRuleBody = await renderTemplate('slot-rule-view.ejs', { ...sharedData, report, coverage });
  const slotRuleHtml = await renderLayout('Slot / Rule View', 'slot-rule', slotRuleBody);
  await fs.writeFile(slotRuleViewPath, slotRuleHtml, 'utf8');
}
