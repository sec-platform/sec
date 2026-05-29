# Project Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a shared Project Overview contract that powers both `platform overview` and a read-only Workbench Overview page.

**Architecture:** Add `platform/shared/project-overview.ts` as the single overview aggregation source. CLI and Workbench read existing governance artifacts, call the shared builder, and render text/JSON or HTML without duplicating review logic.

**Tech Stack:** TypeScript, Bun, Commander, Bun test, EJS templates, existing platform shared helpers.

---

## Source design

Use the approved design in `docs/superpowers/specs/2026-05-02-project-overview-design.md`.

## File structure

- Create `platform/shared/project-overview.ts`  
  Defines Project Overview types, `buildProjectOverview`, `buildProjectOverviewFromWorkspace`, and `formatProjectOverview`.

- Modify `platform/shared/workspace-types.ts`  
  Adds `overviewViewPath` to `WorkspacePaths`.

- Modify `platform/shared/paths.ts`  
  Resolves `control/workbench/views/overview-view.html`.

- Modify `platform/shared/ci-artifact-contract.ts`  
  Adds `overviewView` under `CI_ARTIFACT_FILES` and the existing `view` artifact group.

- Modify `platform/cli/register-commands.ts`  
  Registers top-level `overview` command.

- Modify `platform/cli/formatters.ts`  
  Re-exports or wraps `formatProjectOverview` only if current CLI import style requires it. Prefer importing formatter directly from `project-overview.ts` if it avoids widening `formatters.ts`.

- Modify `platform/compiler/emit/write-local-views.ts`  
  Reads existing governance artifacts, calls `buildProjectOverview`, and writes `overview-view.html`.

- Create `platform/compiler/emit/templates/overview-view.ejs`  
  Renders the Workbench dashboard from the shared overview object.

- Modify `platform/compiler/emit/templates/layout.ejs`  
  Adds Overview as the first navigation item.

- Add tests:
  - `tests/unit/project-overview.test.ts`
  - `tests/integration/overview.test.ts`
  - update `tests/e2e/local-views.slow.test.ts`
  - update `tests/e2e/artifacts.slow.test.ts`

- Update docs:
  - `README.md`
  - `docs/05-编译器核心实现规格.md`
  - `docs/08-Verification、Provenance与Graph规范.md`
  - `docs/11-Workbench与可视化规范.md`

## Task 1: Shared Project Overview builder

**Files:**
- Create: `platform/shared/project-overview.ts`
- Test: `tests/unit/project-overview.test.ts`

- [ ] **Step 1: Write the failing builder test**

Create `tests/unit/project-overview.test.ts`:

```ts
import { expect, test } from 'bun:test';

import { CI_ARTIFACT_FILES } from '../../platform/shared/ci-artifact-contract.ts';
import { buildProjectOverview, formatProjectOverview } from '../../platform/shared/project-overview.ts';
import { buildToolEvidenceReport } from '../../platform/shared/tool-evidence-contract.ts';
import type { AcceptanceCoverageReport } from '../../platform/shared/acceptance-types.ts';
import type { CiArtifactManifest } from '../../platform/shared/ci-artifact-types.ts';
import type { ExplainGraph } from '../../platform/shared/explain-types.ts';
import type { LockFile } from '../../platform/shared/lock-types.ts';
import type { PolicyReport } from '../../platform/shared/policy-types.ts';
import type { ProvenanceFile } from '../../platform/shared/provenance-types.ts';
import type { ReviewSummary } from '../../platform/shared/review-types.ts';
import type { VerificationReport } from '../../platform/shared/verification-types.ts';

const lock: LockFile = {
  formatVersion: '1',
  app: { name: 'Customer Admin', stack: 'nextjs-ts-prisma-sqlite', mode: 'local' },
  resolvedBlocks: [
    {
      id: 'auth/basic-session',
      version: '0.1.0',
      kind: 'capability',
      installOrder: 1,
      manifestPath: 'platform/registry/official/auth.basic-session/block.manifest.yaml',
      registrySourceId: 'official',
      registryKind: 'official',
      registryLocation: 'compiler',
      registryPath: 'platform/registry/official'
    },
    {
      id: 'entity/customer-basic',
      version: '0.1.0',
      kind: 'capability',
      installOrder: 2,
      manifestPath: 'platform/registry/official/entity.customer-basic/block.manifest.yaml',
      registrySourceId: 'official',
      registryKind: 'official',
      registryLocation: 'compiler',
      registryPath: 'platform/registry/official'
    }
  ],
  resolvedCapabilities: ['auth/session', 'entity/customer'],
  installPlan: [],
  slotTasks: [
    {
      id: 'customer_normalizer',
      block: 'entity/customer-basic',
      target: 'custom/customer_normalizer.ts',
      sourcePath: 'source/code/slots/customer_normalizer.ts',
      symbol: 'normalizeCustomer',
      kind: 'function',
      inputType: 'CustomerInput',
      outputType: 'Customer',
      status: 'verified',
      writableZones: ['normalize'],
      provenanceHints: { generator: null, verifiedBy: ['customer-normalizer.test.ts'] }
    }
  ],
  generatedPaths: ['src/installed/auth/session.ts', 'custom/customer_normalizer.ts'],
  acceptancePlan: ['user_can_login', 'user_can_create_customer'],
  passStatus: {
    parse: 'succeeded',
    align: 'succeeded',
    resolve: 'succeeded',
    compose: 'succeeded',
    adapt: 'succeeded',
    verify: 'succeeded',
    repair: 'skipped',
    lock: 'succeeded',
    emit: 'pending'
  }
};

const graph: ExplainGraph = {
  nodes: [
    { id: 'app:Customer Admin', type: 'app', label: 'Customer Admin' },
    { id: 'block:auth/basic-session', type: 'block', label: 'auth/basic-session' },
    { id: 'slot:customer_normalizer', type: 'slot', label: 'customer_normalizer' }
  ],
  edges: [
    { from: 'app:Customer Admin', to: 'block:auth/basic-session', type: 'depends_on' },
    { from: 'slot:customer_normalizer', to: 'block:entity/customer-basic', type: 'connects_to' }
  ],
  overlays: { provenance: [], coverage: { blocks: [], slots: [] } }
};

const provenance: ProvenanceFile = {
  formatVersion: '1',
  artifacts: [
    {
      path: 'src/installed/auth/session.ts',
      originType: 'block',
      originId: 'auth/basic-session',
      sourceBlock: 'auth/basic-session',
      sourcePath: 'files/src/installed/auth/session.ts',
      runtimeTarget: 'src/installed/auth/session.ts',
      generatedByPass: 'compose',
      verifiedBy: ['session.test.ts'],
      overrideStatus: 'none',
      registrySourceId: 'official',
      registryKind: 'official',
      registryLocation: 'compiler'
    },
    {
      path: 'custom/customer_normalizer.ts',
      originType: 'slot',
      originId: 'customer_normalizer',
      sourceBlock: 'entity/customer-basic',
      sourcePath: 'source/code/slots/customer_normalizer.ts',
      runtimeTarget: 'custom/customer_normalizer.ts',
      generatedByPass: 'adapt',
      verifiedBy: [],
      overrideStatus: 'none'
    }
  ]
};

const verificationReport: VerificationReport = {
  formatVersion: '1',
  status: 'passed',
  lane: 'fast',
  checks: [],
  summary: { passed: 1, failed: 0, skipped: 0 }
};

const coverage: AcceptanceCoverageReport = {
  formatVersion: '1',
  status: 'passed',
  acceptance: [
    { id: 'user_can_login', status: 'passed', coveredBlocks: ['auth/basic-session'], coveredSlots: [] },
    { id: 'user_can_create_customer', status: 'passed', coveredBlocks: ['entity/customer-basic'], coveredSlots: ['customer_normalizer'] }
  ],
  summary: {
    acceptanceCount: 2,
    passedCount: 2,
    failedCount: 0,
    blockCount: 2,
    coveredBlockCount: 2,
    slotCount: 1,
    coveredSlotCount: 1
  }
};

const policyReport: PolicyReport = {
  formatVersion: '1',
  status: 'passed',
  official: { sources: [], policies: [] },
  project: { sources: [], policies: [] },
  merged: { policies: [] },
  violations: []
};

const reviewSummary: ReviewSummary = {
  formatVersion: '2',
  ciSummary: {
    status: 'passed',
    failureCount: 0,
    regressionRiskCount: 1,
    conflictHintCount: 0,
    impactedBlockCount: 2,
    impactedSlotCount: 1,
    runtimeEntryCount: 0
  },
  chainSummary: {
    status: 'attention',
    stageCount: 4,
    passedStageCount: 3,
    attentionStageCount: 1,
    failedStageCount: 0,
    stageSummaries: [
      { id: 'verification', status: 'passed', detail: 'lane=fast; failed=none' },
      { id: 'coverage', status: 'passed', detail: 'blocks=2/2; slots=1/1' },
      { id: 'artifacts', status: 'attention', detail: 'total=3; missing=1' },
      { id: 'review', status: 'passed', detail: 'review-summary=generated' }
    ]
  },
  coverageSummary: {
    status: 'passed',
    acceptancePassedCount: 2,
    blockCount: 2,
    slotCount: 1,
    coveredBlockCount: 2,
    coveredSlotCount: 1,
    uncoveredBlockCount: 0,
    uncoveredSlotCount: 0,
    acceptancePassed: ['user_can_login', 'user_can_create_customer'],
    uncoveredBlocks: [],
    uncoveredSlots: [],
    blockSummaries: [],
    slotSummaries: []
  },
  provenanceSummary: {
    artifactCount: 2,
    verifiedArtifactCount: 1,
    unverifiedArtifactCount: 1,
    overrideArtifactCount: 0,
    registryArtifactCount: 1,
    generatedArtifactCount: 0,
    generatedPassCount: 2,
    originSummaryCount: 2,
    originSummaries: [],
    overrideSummaryCount: 0,
    overrideSummaries: [],
    registrySummaryCount: 1,
    registrySummaries: [],
    generatedPassSummaries: [],
    unverifiedArtifacts: ['custom/customer_normalizer.ts']
  },
  policySummary: {
    status: 'passed',
    officialPolicyCount: 1,
    projectPolicyCount: 0,
    mergedPolicyCount: 1,
    sourceCount: 1,
    violationCount: 0,
    severityCounts: {},
    sourceSummaries: [],
    mergedSummaries: [],
    violationSummaries: []
  },
  artifactSummary: {
    artifactStatus: 'attention',
    artifactCount: 3,
    governanceCount: 2,
    viewCount: 1,
    testCount: 0,
    contractCount: 0,
    contractPaths: [],
    uploadGroupCount: 1,
    missingCount: 1,
    missingReasonTypeCount: 1,
    missingReasonCounts: {
      'declared-generated-missing': 0,
      'fixed-governance-missing': 0,
      'fixed-view-missing': 1
    },
    uploadGroups: [],
    missing: [{ path: CI_ARTIFACT_FILES.overviewView, reason: 'fixed-view-missing', declaredBy: 'artifact-manifest' }]
  },
  failurePoints: [],
  regressionRisks: [{ kind: 'coverage-gap', message: 'Review unverified slot output.', slotId: 'customer_normalizer' }],
  conflictHints: [],
  impactedBlocks: ['auth/basic-session', 'entity/customer-basic'],
  impactedSlots: ['customer_normalizer'],
  changeSourceCount: 0,
  runtimeEntryCount: 0,
  installImpactCount: 0,
  installImpactSummary: {
    impactCount: 0,
    blockCount: 0,
    actionKindCount: 0,
    sourceRootCount: 0,
    targetPathCount: 0,
    verticalCount: 0,
    runtimeEntryCount: 0,
    groupCount: 0,
    blocks: [],
    actionKinds: [],
    sourceRoots: [],
    targetPaths: [],
    verticals: [],
    runtimeEntries: [],
    groupSummaries: []
  }
};

const artifactManifest: CiArtifactManifest = {
  formatVersion: '1',
  root: 'workspace',
  summary: reviewSummary.artifactSummary!,
  artifacts: [],
  uploadGroups: [],
  missing: reviewSummary.artifactSummary!.missing
};

test('builds high-signal project overview for developers and AI agents', () => {
  const codeQuality = buildToolEvidenceReport({
    kind: 'code-quality',
    toolId: 'jscpd',
    rawReportPaths: ['report/jscpd/jscpd-report.json'],
    diagnostics: [
      {
        id: 'duplicate-slot-flow',
        severity: 'warning',
        title: 'Duplicate slot flow',
        message: 'Two slot helpers share a repeated shape.',
        filePaths: ['platform/compiler/emit/write-local-views.ts'],
        evidence: ['jscpd:slot-flow']
      }
    ]
  });

  const overview = buildProjectOverview({
    workspaceRoot: 'D:/workspace',
    lock,
    graph,
    provenance,
    verificationReport,
    coverage,
    policyReport,
    reviewSummary,
    artifactManifest,
    toolEvidenceReports: [codeQuality]
  });

  expect(overview).toMatchObject({
    formatVersion: '1',
    workspace: {
      root: 'D:/workspace',
      sourceRoot: 'source',
      projectRoot: 'project',
      controlRoot: 'control',
      localStateRoot: '.sec'
    },
    status: {
      overall: 'attention',
      verification: 'passed',
      policy: 'passed',
      coverage: 'passed',
      artifacts: 'attention',
      reviewChain: 'attention'
    },
    navigation: {
      workbenchViews: expect.arrayContaining([
        { id: 'overview', path: CI_ARTIFACT_FILES.overviewView },
        { id: 'graph', path: CI_ARTIFACT_FILES.graphView },
        { id: 'review', path: CI_ARTIFACT_FILES.reviewView }
      ])
    },
    aiContext: {
      appName: 'Customer Admin',
      blockCount: 2,
      slotCount: 1,
      graphNodeCount: 3,
      graphEdgeCount: 2,
      generatedPathCount: 2,
      unverifiedArtifactCount: 1,
      priorityReviewFileCount: 2
    },
    quality: {
      reports: expect.arrayContaining([
        expect.objectContaining({ kind: 'code-quality', available: true, status: 'attention' }),
        expect.objectContaining({ kind: 'architecture-boundary', available: false }),
        expect.objectContaining({ kind: 'semantic-pattern', available: false })
      ])
    },
    risks: {
      failureCount: 0,
      regressionRiskCount: 1,
      conflictHintCount: 0,
      missingArtifactCount: 1,
      policyErrorCount: 0
    }
  });

  expect(overview.aiContext.priorityReviewFiles).toEqual([
    { path: 'custom/customer_normalizer.ts', reasons: ['unverified provenance', 'regression risk: coverage-gap'] },
    { path: CI_ARTIFACT_FILES.overviewView, reasons: ['missing artifact: fixed-view-missing'] }
  ]);

  expect(formatProjectOverview(overview)).toContain('Project overview attention');
  expect(formatProjectOverview(overview)).toContain('Graph: 3 nodes / 2 edges; blocks=2; slots=1');
  expect(formatProjectOverview(overview)).toContain('Risks: failures=0; regressions=1; conflicts=0; missingArtifacts=1');
});
```

- [ ] **Step 2: Run the failing builder test**

Run:

```powershell
bun test tests/unit/project-overview.test.ts
```

Expected: FAIL because `platform/shared/project-overview.ts` and `CI_ARTIFACT_FILES.overviewView` do not exist.

- [ ] **Step 3: Implement `platform/shared/project-overview.ts`**

Create `platform/shared/project-overview.ts` with focused types and builder functions:

```ts
import { CI_ARTIFACT_FILES } from './ci-artifact-contract.ts';
import type { CiArtifactManifest } from './ci-artifact-types.ts';
import { uniqueSorted } from './collections.ts';
import { CONTRACT_FORMAT_VERSION } from './constants.ts';
import { CompilerError } from './errors.ts';
import type { ExplainGraph } from './explain-types.ts';
import { pathExists, readJson } from './fs.ts';
import type { LockFile } from './lock-types.ts';
import { getWorkspacePaths, relativePosixPath } from './paths.ts';
import type { PolicyReport, PolicySeverity } from './policy-types.ts';
import type { ProvenanceFile } from './provenance-types.ts';
import type { ReviewSummary } from './review-types.ts';
import type { ToolEvidenceReport, ToolEvidenceReportKind } from './tool-evidence-contract.ts';
import { TOOL_EVIDENCE_REPORT_KINDS } from './tool-evidence-contract.ts';
import type { AcceptanceCoverageReport } from './acceptance-types.ts';
import type { VerificationReport } from './verification-types.ts';
import { platformCommand } from './platform-command.ts';

export type ProjectOverviewStatusValue = 'passed' | 'attention' | 'failed' | 'skipped' | 'unknown';
export type ProjectOverviewQualityStatus = ProjectOverviewStatusValue | 'unavailable';
export type ProjectOverviewViewId = 'overview' | 'source' | 'slot-rule' | 'graph' | 'review';

export interface ProjectOverviewWorkspace {
  root: string;
  sourceRoot: string;
  projectRoot: string;
  controlRoot: string;
  localStateRoot: string;
  commands: Array<{ id: string; command: string }>;
}

export interface ProjectOverviewStatus {
  overall: ProjectOverviewStatusValue;
  verification: ProjectOverviewStatusValue;
  policy: ProjectOverviewStatusValue;
  coverage: ProjectOverviewStatusValue;
  artifacts: ProjectOverviewStatusValue;
  reviewChain: ProjectOverviewStatusValue;
  repair: ProjectOverviewStatusValue;
  upgrade: ProjectOverviewStatusValue;
}

export interface ProjectOverviewNavigation {
  workbenchViews: Array<{ id: ProjectOverviewViewId; path: string }>;
  artifacts: Array<{ id: string; path: string }>;
  inspectCommands: Array<{ id: string; command: string }>;
}

export interface ProjectOverviewPriorityFile {
  path: string;
  reasons: string[];
}

export interface ProjectOverviewAiContext {
  appName: string;
  stack: string;
  mode: string;
  blockCount: number;
  blocks: string[];
  slotCount: number;
  slots: string[];
  graphNodeCount: number;
  graphEdgeCount: number;
  generatedPathCount: number;
  generatedPaths: string[];
  provenanceArtifactCount: number;
  verifiedArtifactCount: number;
  unverifiedArtifactCount: number;
  acceptanceCount: number;
  policyViolationCount: number;
  priorityReviewFileCount: number;
  priorityReviewFiles: ProjectOverviewPriorityFile[];
}

export interface ProjectOverviewQualityReport {
  kind: ToolEvidenceReportKind;
  available: boolean;
  status: ProjectOverviewQualityStatus;
  diagnosticCount: number;
  affectedFileCount: number;
  rawReportPaths: string[];
}

export interface ProjectOverviewQuality {
  reports: ProjectOverviewQualityReport[];
}

export interface ProjectOverviewRisks {
  failureCount: number;
  regressionRiskCount: number;
  conflictHintCount: number;
  repairBlockerCount: number;
  missingArtifactCount: number;
  policyErrorCount: number;
  policyBlockerCount: number;
  upgradeDiagnosticCount: number;
  missingArtifactReasons: Record<string, number>;
}

export interface ProjectOverview {
  formatVersion: typeof CONTRACT_FORMAT_VERSION;
  generatedAt: string;
  workspace: ProjectOverviewWorkspace;
  status: ProjectOverviewStatus;
  navigation: ProjectOverviewNavigation;
  aiContext: ProjectOverviewAiContext;
  quality: ProjectOverviewQuality;
  risks: ProjectOverviewRisks;
}

export interface BuildProjectOverviewInput {
  workspaceRoot: string;
  lock: LockFile;
  graph: ExplainGraph;
  provenance: ProvenanceFile;
  verificationReport: VerificationReport;
  coverage: AcceptanceCoverageReport;
  policyReport: PolicyReport;
  reviewSummary: ReviewSummary;
  artifactManifest?: CiArtifactManifest;
  toolEvidenceReports?: readonly ToolEvidenceReport[];
  generatedAt?: string;
}

const TOOL_EVIDENCE_REPORT_PATHS: Record<ToolEvidenceReportKind, string> = {
  'code-quality': 'control/evidence/code-quality-report.json',
  'architecture-boundary': 'control/evidence/architecture-boundary-report.json',
  'semantic-pattern': 'control/evidence/semantic-pattern-report.json'
};

function worstStatus(values: readonly ProjectOverviewStatusValue[]): ProjectOverviewStatusValue {
  if (values.includes('failed')) return 'failed';
  if (values.includes('attention')) return 'attention';
  if (values.includes('unknown')) return 'unknown';
  if (values.includes('skipped')) return 'skipped';
  return 'passed';
}

function statusValue(value: string | undefined): ProjectOverviewStatusValue {
  if (value === 'passed' || value === 'attention' || value === 'failed' || value === 'skipped') return value;
  return 'unknown';
}

function addPriorityFile(files: Map<string, Set<string>>, path: string | undefined, reason: string): void {
  if (!path) return;
  const reasons = files.get(path) ?? new Set<string>();
  reasons.add(reason);
  files.set(path, reasons);
}

function policySeverityCount(policyReport: PolicyReport, severity: PolicySeverity): number {
  return policyReport.violations.filter((violation) => violation.severity === severity).length;
}

function buildQualityReports(reports: readonly ToolEvidenceReport[] = []): ProjectOverviewQualityReport[] {
  const byKind = new Map(reports.map((report) => [report.kind, report]));
  return TOOL_EVIDENCE_REPORT_KINDS.map((kind) => {
    const report = byKind.get(kind);
    if (!report) {
      return {
        kind,
        available: false,
        status: 'unavailable',
        diagnosticCount: 0,
        affectedFileCount: 0,
        rawReportPaths: [TOOL_EVIDENCE_REPORT_PATHS[kind]]
      };
    }
    return {
      kind,
      available: true,
      status: report.status,
      diagnosticCount: report.summary.diagnosticCount,
      affectedFileCount: report.summary.affectedFileCount,
      rawReportPaths: report.rawReportPaths
    };
  });
}

function buildPriorityReviewFiles(reviewSummary: ReviewSummary): ProjectOverviewPriorityFile[] {
  const files = new Map<string, Set<string>>();
  for (const failurePoint of reviewSummary.failurePoints) {
    addPriorityFile(files, failurePoint.artifactPath, `failure point: ${failurePoint.lane}/${failurePoint.kind}`);
  }
  for (const missing of reviewSummary.artifactSummary?.missing ?? []) {
    addPriorityFile(files, missing.path, `missing artifact: ${missing.reason}`);
  }
  for (const path of reviewSummary.provenanceSummary?.unverifiedArtifacts ?? []) {
    addPriorityFile(files, path, 'unverified provenance');
  }
  for (const path of reviewSummary.repairSummary?.targetFiles ?? []) {
    addPriorityFile(files, path, 'repair target');
  }
  for (const path of reviewSummary.upgradeSummary?.impacts ?? []) {
    addPriorityFile(files, path, 'upgrade impact');
  }
  for (const risk of reviewSummary.regressionRisks) {
    if (risk.slotId) addPriorityFile(files, `slot:${risk.slotId}`, `regression risk: ${risk.kind}`);
    if (risk.blockId) addPriorityFile(files, `block:${risk.blockId}`, `regression risk: ${risk.kind}`);
  }
  return [...files.entries()]
    .map(([path, reasons]) => ({ path, reasons: uniqueSorted([...reasons]) }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function workspaceCommands(): Array<{ id: string; command: string }> {
  return [
    { id: 'refresh', command: 'bun run reference:refresh' },
    { id: 'verify', command: platformCommand('verify', '--json', '--compact') },
    { id: 'explain', command: platformCommand('explain', '--json', '--compact') },
    { id: 'overview', command: platformCommand('overview', '--json', '--compact') },
    { id: 'workbench', command: platformCommand('explain') }
  ];
}

function inspectCommands(): Array<{ id: string; command: string }> {
  return [
    { id: 'overview', command: platformCommand('overview', '--json', '--compact') },
    { id: 'graph', command: platformCommand('explain', 'graph', '--json', '--compact') },
    { id: 'review', command: platformCommand('review', 'summary', '--json', '--compact') },
    { id: 'verification', command: platformCommand('verification', 'report', '--json', '--compact') },
    { id: 'artifacts', command: platformCommand('artifacts', 'manifest', '--json', '--compact') },
    { id: 'contract-errors', command: platformCommand('contract', 'errors', '--json', '--compact') }
  ];
}

export function buildProjectOverview(input: BuildProjectOverviewInput): ProjectOverview {
  const paths = getWorkspacePaths(input.workspaceRoot);
  const priorityReviewFiles = buildPriorityReviewFiles(input.reviewSummary);
  const artifactStatus = statusValue(input.artifactManifest?.summary.artifactStatus ?? input.reviewSummary.artifactSummary?.artifactStatus);
  const repairStatus = statusValue(input.reviewSummary.repairSummary?.status);
  const upgradeStatus = statusValue(input.reviewSummary.upgradeSummary?.status);
  const status: ProjectOverviewStatus = {
    overall: 'passed',
    verification: statusValue(input.verificationReport.status),
    policy: statusValue(input.reviewSummary.policySummary?.status ?? input.policyReport.status),
    coverage: statusValue(input.reviewSummary.coverageSummary?.status ?? input.coverage.status),
    artifacts: artifactStatus,
    reviewChain: statusValue(input.reviewSummary.chainSummary.status),
    repair: repairStatus,
    upgrade: upgradeStatus
  };
  status.overall = worstStatus([
    status.verification,
    status.policy,
    status.coverage,
    status.artifacts,
    status.reviewChain,
    status.repair === 'unknown' ? 'passed' : status.repair,
    status.upgrade === 'unknown' ? 'passed' : status.upgrade
  ]);

  const risks: ProjectOverviewRisks = {
    failureCount: input.reviewSummary.failurePoints.length,
    regressionRiskCount: input.reviewSummary.regressionRisks.length,
    conflictHintCount: input.reviewSummary.conflictHints.length,
    repairBlockerCount: input.reviewSummary.repairSummary?.blockerCount ?? 0,
    missingArtifactCount: input.artifactManifest?.summary.missingCount ?? input.reviewSummary.artifactSummary?.missingCount ?? 0,
    policyErrorCount: policySeverityCount(input.policyReport, 'error'),
    policyBlockerCount: policySeverityCount(input.policyReport, 'blocker'),
    upgradeDiagnosticCount: input.reviewSummary.upgradeSummary?.diagnostics ? 1 : 0,
    missingArtifactReasons: input.artifactManifest?.summary.missingReasonCounts ?? input.reviewSummary.artifactSummary?.missingReasonCounts ?? {}
  };

  return {
    formatVersion: CONTRACT_FORMAT_VERSION,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    workspace: {
      root: input.workspaceRoot,
      sourceRoot: relativePosixPath(input.workspaceRoot, paths.developerSourceRoot),
      projectRoot: relativePosixPath(input.workspaceRoot, paths.projectRoot),
      controlRoot: relativePosixPath(input.workspaceRoot, paths.controlRoot),
      localStateRoot: relativePosixPath(input.workspaceRoot, paths.localStateRoot),
      commands: workspaceCommands()
    },
    status,
    navigation: {
      workbenchViews: [
        { id: 'overview', path: CI_ARTIFACT_FILES.overviewView },
        { id: 'source', path: CI_ARTIFACT_FILES.sourceView },
        { id: 'slot-rule', path: CI_ARTIFACT_FILES.slotRuleView },
        { id: 'graph', path: CI_ARTIFACT_FILES.graphView },
        { id: 'review', path: CI_ARTIFACT_FILES.reviewView }
      ],
      artifacts: [
        { id: 'graph-lock', path: CI_ARTIFACT_FILES.graphLock },
        { id: 'provenance', path: CI_ARTIFACT_FILES.provenance },
        { id: 'verification-report', path: CI_ARTIFACT_FILES.verificationReport },
        { id: 'policy-report', path: CI_ARTIFACT_FILES.policyReport },
        { id: 'acceptance-coverage', path: CI_ARTIFACT_FILES.acceptanceCoverage },
        { id: 'explain-graph', path: CI_ARTIFACT_FILES.explainGraph },
        { id: 'explain-graph-mermaid', path: CI_ARTIFACT_FILES.explainGraphMermaid },
        { id: 'explain-graph-dot', path: CI_ARTIFACT_FILES.explainGraphDot },
        { id: 'review-summary', path: CI_ARTIFACT_FILES.reviewSummary },
        { id: 'artifact-manifest', path: CI_ARTIFACT_FILES.artifactManifest }
      ],
      inspectCommands: inspectCommands()
    },
    aiContext: {
      appName: input.lock.app.name,
      stack: input.lock.app.stack,
      mode: input.lock.app.mode,
      blockCount: input.lock.resolvedBlocks.length,
      blocks: input.lock.resolvedBlocks.map((block) => block.id),
      slotCount: input.lock.slotTasks.length,
      slots: input.lock.slotTasks.map((slot) => slot.id),
      graphNodeCount: input.graph.nodes.length,
      graphEdgeCount: input.graph.edges.length,
      generatedPathCount: input.lock.generatedPaths.length,
      generatedPaths: [...input.lock.generatedPaths].sort(),
      provenanceArtifactCount: input.provenance.artifacts.length,
      verifiedArtifactCount: input.reviewSummary.provenanceSummary?.verifiedArtifactCount ?? input.provenance.artifacts.filter((artifact) => artifact.verifiedBy.length > 0).length,
      unverifiedArtifactCount: input.reviewSummary.provenanceSummary?.unverifiedArtifactCount ?? input.provenance.artifacts.filter((artifact) => artifact.verifiedBy.length === 0).length,
      acceptanceCount: input.lock.acceptancePlan.length,
      policyViolationCount: input.policyReport.violations.length,
      priorityReviewFileCount: priorityReviewFiles.length,
      priorityReviewFiles
    },
    quality: {
      reports: buildQualityReports(input.toolEvidenceReports)
    },
    risks
  };
}

async function readRequiredArtifact<T>(filePath: string, label: string): Promise<T> {
  if (!(await pathExists(filePath))) {
    throw new CompilerError('EXPLAIN-BLOCKED-004', `${label} is missing; run platform explain first`);
  }
  return readJson<T>(filePath);
}

async function readOptionalToolEvidenceReports(workspaceRoot: string): Promise<ToolEvidenceReport[]> {
  const paths = getWorkspacePaths(workspaceRoot);
  const entries = await Promise.all(TOOL_EVIDENCE_REPORT_KINDS.map(async (kind) => {
    const reportPath = `${paths.workspaceRoot}/${TOOL_EVIDENCE_REPORT_PATHS[kind]}`;
    return (await pathExists(reportPath)) ? readJson<ToolEvidenceReport>(reportPath) : null;
  }));
  return entries.filter((entry): entry is ToolEvidenceReport => Boolean(entry));
}

export async function buildProjectOverviewFromWorkspace(workspaceRoot = process.cwd()): Promise<ProjectOverview> {
  const paths = getWorkspacePaths(workspaceRoot);
  const [lock, graph, provenance, verificationReport, coverage, policyReport, reviewSummary, artifactManifest, toolEvidenceReports] = await Promise.all([
    readRequiredArtifact<LockFile>(paths.lockPath, 'graph.lock.json'),
    readRequiredArtifact<ExplainGraph>(paths.explainGraphPath, 'explain-graph.json'),
    readRequiredArtifact<ProvenanceFile>(paths.provenancePath, 'provenance.json'),
    readRequiredArtifact<VerificationReport>(paths.verificationReportPath, 'verification-report.json'),
    readRequiredArtifact<AcceptanceCoverageReport>(paths.acceptanceCoveragePath, 'acceptance-coverage.json'),
    readRequiredArtifact<PolicyReport>(paths.policyReportPath, 'policy-report.json'),
    readRequiredArtifact<ReviewSummary>(paths.reviewSummaryPath, 'review-summary.json'),
    pathExists(paths.ciArtifactsPath).then((exists) => exists ? readJson<CiArtifactManifest>(paths.ciArtifactsPath) : undefined),
    readOptionalToolEvidenceReports(workspaceRoot)
  ]);

  return buildProjectOverview({
    workspaceRoot,
    lock,
    graph,
    provenance,
    verificationReport,
    coverage,
    policyReport,
    reviewSummary,
    artifactManifest,
    toolEvidenceReports
  });
}

export function formatProjectOverview(overview: ProjectOverview): string {
  return [
    `Project overview ${overview.status.overall}`,
    `Workspace: ${overview.workspace.sourceRoot}/${overview.workspace.projectRoot}/${overview.workspace.controlRoot}/${overview.workspace.localStateRoot} ready`,
    `Verification: ${overview.status.verification}; policy: ${overview.status.policy}; coverage: ${overview.status.coverage}; artifacts: ${overview.status.artifacts}`,
    `Graph: ${overview.aiContext.graphNodeCount} nodes / ${overview.aiContext.graphEdgeCount} edges; blocks=${overview.aiContext.blockCount}; slots=${overview.aiContext.slotCount}`,
    `Risks: failures=${overview.risks.failureCount}; regressions=${overview.risks.regressionRiskCount}; conflicts=${overview.risks.conflictHintCount}; missingArtifacts=${overview.risks.missingArtifactCount}`,
    `Views: ${CI_ARTIFACT_FILES.overviewView}`,
    `Next: ${platformCommand('explain')} | ${platformCommand('verify', '--json', '--compact')}`
  ].join('\n');
}
```

- [ ] **Step 4: Run the builder test again**

Run:

```powershell
bun test tests/unit/project-overview.test.ts
```

Expected: FAIL only on type mismatches or the missing `CI_ARTIFACT_FILES.overviewView` constant. If it fails for fixture shape, adjust the fixture to match current shared types, not the implementation contract.

- [ ] **Step 5: Commit the builder test and implementation if the only remaining failure is artifact path wiring**

Run:

```powershell
git add -- platform/shared/project-overview.ts tests/unit/project-overview.test.ts
git commit -m "feat: add project overview builder"
```

Expected: commit succeeds only if tests for this task pass after Task 2 path wiring. If `CI_ARTIFACT_FILES.overviewView` is still missing, do not commit until Task 2 completes.

## Task 2: Overview view artifact path wiring

**Files:**
- Modify: `platform/shared/workspace-types.ts`
- Modify: `platform/shared/paths.ts`
- Modify: `platform/shared/ci-artifact-contract.ts`
- Test: `tests/e2e/artifacts.slow.test.ts`

- [ ] **Step 1: Write failing artifact path assertions**

In `tests/e2e/artifacts.slow.test.ts`, extend the existing manifest assertion around the view artifacts to include overview:

```ts
expect(manifest.artifacts).toEqual(
  expect.arrayContaining([
    expect.objectContaining({
      path: CI_ARTIFACT_FILES.overviewView,
      kind: 'view',
      uploadName: 'control__workbench__views__overview-view.html',
      exists: true
    })
  ])
);
```

Also extend the view upload path assertion so overview is included in `--paths --kind view` results:

```ts
expect(viewUploadPaths).toContain(CI_ARTIFACT_FILES.overviewView);
```

- [ ] **Step 2: Run the failing artifact test**

Run:

```powershell
bun test tests/e2e/artifacts.slow.test.ts
```

Expected: FAIL because `CI_ARTIFACT_FILES.overviewView` does not exist.

- [ ] **Step 3: Add the overview path to workspace path types**

Modify `platform/shared/workspace-types.ts`:

```ts
  overviewViewPath: string;
  sourceViewPath: string;
```

Place `overviewViewPath` immediately before `sourceViewPath` to match nav order.

- [ ] **Step 4: Resolve the overview path**

Modify `platform/shared/paths.ts` inside `getWorkspacePaths`:

```ts
    overviewViewPath: path.join(controlWorkbenchRoot, 'views', 'overview-view.html'),
    sourceViewPath: path.join(controlWorkbenchRoot, 'views', 'source-view.html'),
```

- [ ] **Step 5: Add overview to CI artifact contract view group**

Modify `platform/shared/ci-artifact-contract.ts`:

```ts
  overviewView: 'control/workbench/views/overview-view.html',
  sourceView: 'control/workbench/views/source-view.html',
```

Then include it first in `CI_ARTIFACT_PATHS.view`:

```ts
  view: [
    CI_ARTIFACT_FILES.overviewView,
    CI_ARTIFACT_FILES.sourceView,
    CI_ARTIFACT_FILES.slotRuleView,
    CI_ARTIFACT_FILES.graphView,
    CI_ARTIFACT_FILES.reviewView
  ],
```

- [ ] **Step 6: Run artifact tests**

Run:

```powershell
bun test tests/e2e/artifacts.slow.test.ts
```

Expected: FAIL until Workbench generation writes `overview-view.html`. This failure is acceptable before Task 4, but all type errors must be fixed.

- [ ] **Step 7: Commit path wiring after Task 4 makes the artifact test pass**

Run:

```powershell
git add -- platform/shared/workspace-types.ts platform/shared/paths.ts platform/shared/ci-artifact-contract.ts tests/e2e/artifacts.slow.test.ts
git commit -m "feat: register project overview view artifact"
```

Expected: commit succeeds after Task 4 writes the page.

## Task 3: CLI overview command

**Files:**
- Modify: `platform/cli/register-commands.ts`
- Modify: `platform/cli/formatters.ts` only if needed
- Test: `tests/integration/overview.test.ts`

- [ ] **Step 1: Write the failing CLI test**

Create or update `tests/integration/overview.test.ts`:

```ts
import { expect, test } from 'bun:test';

import { CI_ARTIFACT_FILES } from '../../platform/shared/ci-artifact-contract.ts';
import { expectCliJson, expectCliText, expectCliVariants, runCliPipeline } from '../testkit/cli.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

test('CLI emits project overview text and JSON for AI handoff', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await runCliPipeline(workspaceRoot, { verifyLane: 'all', lock: true, explain: true });

    const { json, compactJson } = await expectCliVariants<{
      formatVersion: string;
      status: { overall: string; verification: string; policy: string; coverage: string; artifacts: string; reviewChain: string };
      navigation: { workbenchViews: Array<{ id: string; path: string }> };
      aiContext: { appName: string; blockCount: number; slotCount: number; graphNodeCount: number; graphEdgeCount: number; priorityReviewFiles: unknown[] };
      quality: { reports: Array<{ kind: string; available: boolean; status: string }> };
      risks: { failureCount: number; regressionRiskCount: number; conflictHintCount: number; missingArtifactCount: number };
    }>(workspaceRoot, ['overview'], {
      text: [
        'Project overview',
        'Workspace: source/project/control/.sec ready',
        'Verification: passed; policy: passed; coverage: passed;',
        'Graph:',
        'blocks=',
        'slots=',
        'Risks: failures=0;',
        `Views: ${CI_ARTIFACT_FILES.overviewView}`,
        'Next: bun run platform -- explain | bun run platform -- verify --json --compact'
      ],
      compactJson: {
        formatVersion: '1',
        navigation: {
          workbenchViews: expect.arrayContaining([
            { id: 'overview', path: CI_ARTIFACT_FILES.overviewView },
            { id: 'graph', path: CI_ARTIFACT_FILES.graphView },
            { id: 'review', path: CI_ARTIFACT_FILES.reviewView }
          ])
        }
      }
    });

    expect(json.aiContext.blockCount).toBeGreaterThan(0);
    expect(json.aiContext.graphNodeCount).toBeGreaterThan(0);
    expect(json.quality.reports.map((report) => report.kind)).toEqual([
      'code-quality',
      'architecture-boundary',
      'semantic-pattern'
    ]);
    expect(compactJson.navigation.workbenchViews[0]).toEqual({ id: 'overview', path: CI_ARTIFACT_FILES.overviewView });
  });
});

test('CLI overview reports missing governance artifacts with recovery guidance', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const result = await expectCliJson(workspaceRoot, ['overview', '--json', '--compact']).catch((error) => error);
    expect(String(result)).toContain('graph.lock.json is missing; run platform explain first');
  });
});
```

If the second test cannot use `expectCliJson` for failures, use `runCliInProcess` exported from `tests/testkit/cli.ts`; do not add another local CLI runner.

- [ ] **Step 2: Run the failing CLI test**

Run:

```powershell
bun test tests/integration/overview.test.ts
```

Expected: FAIL because the `overview` command is not registered.

- [ ] **Step 3: Register the command**

Modify `platform/cli/register-commands.ts` imports:

```ts
import { buildProjectOverviewFromWorkspace, formatProjectOverview } from '../shared/project-overview.ts';
```

Add the command near `explain` and `artifacts`:

```ts
  addJsonFlags(program.command('overview'))
    .description('Inspect project overview')
    .action(async (opts: Record<string, unknown>) => {
      const output = jsonOpts(opts);
      const overview = await buildProjectOverviewFromWorkspace(process.cwd());
      printJsonOrText(overview, output, formatProjectOverview);
    });
```

- [ ] **Step 4: Run the CLI test**

Run:

```powershell
bun test tests/integration/overview.test.ts
```

Expected: PASS after Task 1 and Task 2 compile. If missing artifact error formatting differs, assert the actual `EXPLAIN-BLOCKED-004` message and the recovery text.

- [ ] **Step 5: Commit CLI command**

Run:

```powershell
git add -- platform/cli/register-commands.ts tests/integration/overview.test.ts
git commit -m "feat: add project overview cli"
```

Expected: commit succeeds.

## Task 4: Workbench Overview page

**Files:**
- Modify: `platform/compiler/emit/write-local-views.ts`
- Modify: `platform/compiler/emit/templates/layout.ejs`
- Create: `platform/compiler/emit/templates/overview-view.ejs`
- Test: `tests/e2e/local-views.slow.test.ts`

- [ ] **Step 1: Write failing local view assertions**

In `tests/e2e/local-views.slow.test.ts`, include `overviewViewPath` from `getWorkspacePaths`:

```ts
const {
  overviewViewPath,
  sourceViewPath,
  slotRuleViewPath,
  graphViewPath,
  reviewViewPath
} = getWorkspacePaths(workspaceRoot);
```

After `await writeLocalViews(workspaceRoot);`, read the page:

```ts
const overviewView = await fs.readFile(overviewViewPath, 'utf8');
```

Assert high-signal dashboard content:

```ts
expectContainsAll(overviewView, [
  'href="overview-view.html" aria-current="page"',
  'Project Overview',
  'Overall Status',
  'Workspace Navigation',
  'AI Handoff Context',
  'Quality Evidence',
  'Risk Radar',
  'control/workbench/views/graph-view.html',
  'control/workbench/views/review-view.html',
  '<td>Blocks</td>',
  '<td>Slots</td>',
  '<td>Failure Points</td>',
  '<td>Regression Risks</td>'
]);
```

Update existing nav assertions to expect overview link in all pages:

```ts
expectContainsAll(sourceView, ['href="overview-view.html"']);
expectContainsAll(slotRuleView, ['href="overview-view.html"']);
expectContainsAll(graphView, ['href="overview-view.html"']);
expectContainsAll(reviewView, ['href="overview-view.html"']);
```

- [ ] **Step 2: Run the failing local views test**

Run:

```powershell
bun test tests/e2e/local-views.slow.test.ts
```

Expected: FAIL because `overview-view.html` is not written.

- [ ] **Step 3: Modify `write-local-views.ts` to build overview**

Add import:

```ts
import { buildProjectOverview } from '../../shared/project-overview.ts';
```

Destructure `overviewViewPath`:

```ts
    overviewViewPath,
    sourceViewPath,
```

Build overview after shared data inputs are loaded:

```ts
  const overview = buildProjectOverview({
    workspaceRoot,
    lock,
    provenance,
    verificationReport: report,
    coverage,
    policyReport,
    reviewSummary: review,
    graph
  });
```

Render overview before source view:

```ts
  const overviewBody = await renderTemplate('overview-view.ejs', { ...sharedData, overview });
  const overviewHtml = await renderLayout('Project Overview', 'overview', overviewBody);
  await fs.writeFile(overviewViewPath, overviewHtml, 'utf8');
```

Update `renderLayout` signature:

```ts
async function renderLayout(
  title: string,
  currentNav: 'overview' | 'source' | 'slot-rule' | 'graph' | 'review',
  body: string
): Promise<string> {
```

- [ ] **Step 4: Add Overview nav item**

Modify `platform/compiler/emit/templates/layout.ejs`:

```ejs
        <a href="overview-view.html"<%- currentNav === 'overview' ? ' aria-current="page"' : '' %>>Overview</a>
        <a href="source-view.html"<%- currentNav === 'source' ? ' aria-current="page"' : '' %>>Source View</a>
```

- [ ] **Step 5: Create `overview-view.ejs`**

Create `platform/compiler/emit/templates/overview-view.ejs`:

```ejs
<%
  const statusRows = [
    ['Overall Status', overview.status.overall],
    ['Verification', overview.status.verification],
    ['Policy', overview.status.policy],
    ['Coverage', overview.status.coverage],
    ['Artifacts', overview.status.artifacts],
    ['Review Chain', overview.status.reviewChain],
    ['Repair', overview.status.repair],
    ['Upgrade', overview.status.upgrade]
  ];
  const workspaceRows = [
    ['Workspace Root', overview.workspace.root],
    ['Source Root', overview.workspace.sourceRoot],
    ['Project Root', overview.workspace.projectRoot],
    ['Control Root', overview.workspace.controlRoot],
    ['Local State Root', overview.workspace.localStateRoot]
  ];
  const commandRows = overview.workspace.commands.map(function(command) {
    return [command.id, command.command];
  });
  const aiRows = [
    ['App', overview.aiContext.appName],
    ['Stack', overview.aiContext.stack],
    ['Mode', overview.aiContext.mode],
    ['Blocks', String(overview.aiContext.blockCount)],
    ['Slots', String(overview.aiContext.slotCount)],
    ['Graph Nodes', String(overview.aiContext.graphNodeCount)],
    ['Graph Edges', String(overview.aiContext.graphEdgeCount)],
    ['Generated Paths', String(overview.aiContext.generatedPathCount)],
    ['Provenance Artifacts', String(overview.aiContext.provenanceArtifactCount)],
    ['Unverified Artifacts', String(overview.aiContext.unverifiedArtifactCount)],
    ['Priority Review Files', String(overview.aiContext.priorityReviewFileCount)]
  ];
  const priorityRows = overview.aiContext.priorityReviewFiles.map(function(file) {
    return [file.path, formatList(file.reasons)];
  });
  const qualityRows = overview.quality.reports.map(function(report) {
    return [
      report.kind,
      String(report.available),
      report.status,
      String(report.diagnosticCount),
      String(report.affectedFileCount),
      formatList(report.rawReportPaths)
    ];
  });
  const riskRows = [
    ['Failure Points', String(overview.risks.failureCount)],
    ['Regression Risks', String(overview.risks.regressionRiskCount)],
    ['Conflict Hints', String(overview.risks.conflictHintCount)],
    ['Repair Blockers', String(overview.risks.repairBlockerCount)],
    ['Missing Artifacts', String(overview.risks.missingArtifactCount)],
    ['Policy Errors', String(overview.risks.policyErrorCount)],
    ['Policy Blockers', String(overview.risks.policyBlockerCount)],
    ['Upgrade Diagnostics', String(overview.risks.upgradeDiagnosticCount)]
  ];
  const viewRows = overview.navigation.workbenchViews.map(function(view) {
    return [view.id, view.path];
  });
  const artifactRows = overview.navigation.artifacts.map(function(artifact) {
    return [artifact.id, artifact.path];
  });
  const inspectRows = overview.navigation.inspectCommands.map(function(command) {
    return [command.id, command.command];
  });
%>
<section class="card">
  <h1>Project Overview</h1>
  <p>Read-only entry dashboard derived from governance artifacts for developers and AI agents.</p>
</section>
<section class="card">
  <h2>Overall Status</h2>
  <%- metricTable(statusRows) %>
</section>
<section class="card">
  <h2>Workspace Navigation</h2>
  <%- metricTable(workspaceRows) %>
  <%- subCard('Commands', dataTable(['ID','Command'], commandRows, 2, 'No commands.')) %>
</section>
<section class="card">
  <h2>AI Handoff Context</h2>
  <%- metricTable(aiRows) %>
  <%- subCard('Blocks', dataTable(['Block'], overview.aiContext.blocks.map(function(block) { return [block]; }), 1, 'No blocks.')) %>
  <%- subCard('Slots', dataTable(['Slot'], overview.aiContext.slots.map(function(slot) { return [slot]; }), 1, 'No slots.')) %>
  <%- subCard('Priority Review Files', dataTable(['Path','Reasons'], priorityRows, 2, 'No priority review files.')) %>
</section>
<section class="card">
  <h2>Quality Evidence</h2>
  <%- dataTable(['Kind','Available','Status','Diagnostics','Affected Files','Raw Reports'], qualityRows, 6, 'No quality evidence.') %>
</section>
<section class="card">
  <h2>Risk Radar</h2>
  <%- metricTable(riskRows) %>
</section>
<section class="card">
  <h2>Workbench Links</h2>
  <%- dataTable(['View','Path'], viewRows, 2, 'No Workbench views.') %>
  <%- subCard('Artifacts', dataTable(['Artifact','Path'], artifactRows, 2, 'No artifacts.')) %>
  <%- subCard('Inspect Commands', dataTable(['ID','Command'], inspectRows, 2, 'No inspect commands.')) %>
</section>
```

- [ ] **Step 6: Run local view and artifact tests**

Run:

```powershell
bun test tests/e2e/local-views.slow.test.ts tests/e2e/artifacts.slow.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Workbench overview**

Run:

```powershell
git add -- platform/compiler/emit/write-local-views.ts platform/compiler/emit/templates/layout.ejs platform/compiler/emit/templates/overview-view.ejs tests/e2e/local-views.slow.test.ts
git commit -m "feat: add project overview workbench view"
```

Expected: commit succeeds.

## Task 5: Documentation sync

**Files:**
- Modify: `README.md`
- Modify: `docs/05-编译器核心实现规格.md`
- Modify: `docs/08-Verification、Provenance与Graph规范.md`
- Modify: `docs/11-Workbench与可视化规范.md`

- [ ] **Step 1: Update README command list**

In `README.md`, add these entries near the existing explain/review/workbench commands:

```md
- `bun run platform -- overview`: inspect the developer and AI project overview from existing governance artifacts
- `bun run platform -- overview --json --compact`: emit the compact project overview contract without writing a stable overview artifact
```

Also update the governance artifact paragraph to mention `overview-view.html`:

```md
- `lock` writes provenance to `control/provenance/provenance.json`; `explain` writes `control/graph/explain-graph.json`, `control/evidence/review-summary.json`, and local HTML Workbench projections including `overview-view.html`, `source-view.html`, `slot-rule-view.html`, `graph-view.html`, and `review-view.html` under `control/workbench/views/`.
```

- [ ] **Step 2: Update docs 05**

In `docs/05-编译器核心实现规格.md`, add `overview` to the CLI surface and the shared builder index:

```md
| overview | inspect current project overview from existing governance artifacts; JSON output is on-demand and does not persist a stable overview artifact |
```

Add to common builder patterns:

```md
| `buildProjectOverview` / `buildProjectOverviewFromWorkspace` | shared/project-overview.ts | CLI 与 Workbench 共享的全项目概览聚合，避免视图和命令各自重复计算 |
```

- [ ] **Step 3: Update docs 08**

In `docs/08-Verification、Provenance与Graph规范.md`, add the Workbench view path:

```md
| Overview view | `control/workbench/views/overview-view.html` |
```

Add one sentence near quality evidence:

```md
Project Overview JSON 由 `platform overview --json --compact` 按需从既有治理产物派生，第一版不写入稳定 governance artifact；Overview HTML 只作为 Workbench view artifact。
```

- [ ] **Step 4: Update docs 11**

In `docs/11-Workbench与可视化规范.md`, add Overview View to the standard views table:

```md
| Overview view | `control/workbench/views/overview-view.html` | 面向开发者与 AI 的全项目入口，汇总状态、导航、AI handoff、质量 evidence 可用性与风险雷达 |
```

Add one sentence in Workbench positioning:

```md
Overview View 是进入 Workbench 的默认只读入口；它只聚合已有治理产物，不成为新的事实源。
```

- [ ] **Step 5: Run doc-adjacent checks**

Run:

```powershell
bun test tests/integration/overview.test.ts tests/e2e/local-views.slow.test.ts tests/e2e/artifacts.slow.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit docs**

Run:

```powershell
git add -- README.md docs/05-编译器核心实现规格.md docs/08-Verification、Provenance与Graph规范.md docs/11-Workbench与可视化规范.md
git commit -m "docs: document project overview surface"
```

Expected: commit succeeds.

## Task 6: Final verification and cleanup

**Files:**
- Modify only if verification exposes targeted issues.

- [ ] **Step 1: Run typecheck**

Run:

```powershell
bun run typecheck
```

Expected: PASS.

- [ ] **Step 2: Run affected tests**

Run:

```powershell
bun run test:affected
```

Expected: PASS.

- [ ] **Step 3: Run focused contract/view tests if affected tests did not include them**

Run:

```powershell
bun test tests/unit/project-overview.test.ts tests/integration/overview.test.ts tests/e2e/local-views.slow.test.ts tests/e2e/artifacts.slow.test.ts
```

Expected: PASS.

- [ ] **Step 4: Inspect generated overview manually through CLI**

Run:

```powershell
bun run platform -- overview --json --compact
```

Expected: compact JSON on one line containing `"formatVersion":"1"`, `"navigation"`, `"aiContext"`, `"quality"`, and `"risks"`.

- [ ] **Step 5: Inspect git status**

Run:

```powershell
git status --short
```

Expected: clean working tree. If only intended files remain modified after a final fix, commit them with:

```powershell
git add -- <intended files>
git commit -m "fix: stabilize project overview contract"
```

- [ ] **Step 6: Final report**

Report in Chinese:

```text
已完成 Project Overview：新增 shared overview builder、platform overview CLI、Workbench overview-view.html、artifact path wiring 和文档同步。验证：bun run typecheck、bun run test:affected、focused overview/view tests 均通过。
```

## Self-review

- Spec coverage: shared builder, CLI contract, Workbench Overview, artifact path policy, docs sync, and verification are covered by Tasks 1-6.
- Placeholder scan: no deferred-work markers or unspecified validation steps remain.
- Type consistency: all later tasks consume `ProjectOverview`, `buildProjectOverview`, `buildProjectOverviewFromWorkspace`, `formatProjectOverview`, and `CI_ARTIFACT_FILES.overviewView` defined in Tasks 1-2.
