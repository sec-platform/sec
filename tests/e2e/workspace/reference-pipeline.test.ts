import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { readJson } from "../../../src/adapters/filesystem/files.ts";
import { getWorkspacePaths, resolveWorkspaceArtifactPath } from "../../../src/adapters/workspace-context.ts";
import { CI_ARTIFACT_FILES, CI_EXPLAIN_GRAPH_ARTIFACTS } from '../../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import {
  explainWorkspace,
  initWorkspace,
  lockWorkspace,
  resolveWorkspace,
  verifyWorkspace
} from '../../../src/bootstrap/engineering/cli.ts';
import { expectGraphEdge, expectGraphNode, expectNoGraphEdge } from '../../helpers/graph-assertions.ts';
import { expectCliJson, expectCliSuccess, expectCliText, expectCliVariants } from '../../testkit/cli.ts';
import { createWorkspace } from '../../testkit/workspace.ts';

const expectedDemoChecklistItemCount = [
  'verification-report',
  'runtime-report',
  'policy-report',
  'acceptance-coverage',
  'graph-lock',
  'provenance-registry',
  ...CI_EXPLAIN_GRAPH_ARTIFACTS.map((artifact) => artifact.id),
  'review-summary'
].length;
const [, explainGraphMermaidArtifact, explainGraphDotArtifact] = CI_EXPLAIN_GRAPH_ARTIFACTS;

test('v0.1 reference pipeline runs end to end in a temporary workspace', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-');

  // The fresh root provides the same missing-artifact and pre-init Doctor inputs.
  await expectCliText(workspaceRoot, ['demo', 'checklist'], [
    `Demo checklist attention; items=${expectedDemoChecklistItemCount}; missing=${expectedDemoChecklistItemCount}`,
    `verification-report: missing; ${CI_ARTIFACT_FILES.verificationReport}`,
    `${explainGraphMermaidArtifact.id}: missing; ${explainGraphMermaidArtifact.path}`,
    `${explainGraphDotArtifact.id}: missing; ${explainGraphDotArtifact.path}`,
    'Next command: bun run demo:quickstart'
  ]);

  await expectCliVariants(workspaceRoot, ['doctor'], {
    text: [
      'Developer environment doctor',
      'Checks: 5',
      'workspace-roots',
      'Workspace roots missing: model, src, .sec; run platform init.',
      'runtime-dependencies'
    ],
    json: {
      status: expect.any(String),
      checkCount: 5,
      checks: expect.arrayContaining([
        expect.objectContaining({ id: 'bun' }),
        expect.objectContaining({ id: 'workspace-plan' }),
        expect.objectContaining({ id: 'project-package' }),
        expect.objectContaining({
          id: 'workspace-roots',
          status: 'warn',
          message: 'Workspace roots missing: model, src, .sec; run platform init.'
        }),
        expect.objectContaining({ id: 'runtime-dependencies' })
      ]),
      dependencies: expect.objectContaining({
        mode: expect.any(String),
        recommendedAction: expect.any(String)
      })
    },
    compactJson: {
      status: expect.any(String),
      checkCount: 5,
      dependencies: expect.objectContaining({ mode: expect.any(String) })
    }
  });

  const { workspaceRoot: resolvedWorkspaceRoot, modelRoot, prismaRoot } = getWorkspacePaths(workspaceRoot);
  const acceptanceCoveragePath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.acceptanceCoverage);
  const lockPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.graphLock);
  const policyReportPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.policyReport);
  const provenancePath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.provenance);
  const runtimeReportPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.runtimeReport);

  await initWorkspace(workspaceRoot, { template: 'reference-customer' });
  // CLI init and its physical roots are independently observed by e2e-workspace.
  await expectCliJson(
    workspaceRoot,
    ['doctor', '--json', '--compact'],
    {
      checks: expect.arrayContaining([
        expect.objectContaining({
          id: 'workspace-roots',
          status: 'ok',
          message: 'Workspace roots exist: workspace, model, src, .sec.'
        })
      ])
    },
    { compact: true }
  );

  const prismaTemplateDirectory = path.join(modelRoot, 'schema');
  await fs.mkdir(prismaTemplateDirectory, { recursive: true });
  await fs.writeFile(path.join(prismaTemplateDirectory, 'db.prisma.template'), `
model CustomExtension {
  id    String @id
  value String
}
`, 'utf8');
  const { lock: resolvedLock } = await resolveWorkspace(workspaceRoot);
  expect(resolvedLock.resolvedBlocks.map((block) => block.id).sort()).toEqual([
    'auth/basic-session',
    'entity/customer-basic',
    'tenant/basic-workspace'
  ]);

  await expectCliSuccess(workspaceRoot, ['compose']);
  const generatedPrisma = await fs.readFile(path.join(prismaRoot, 'schema.prisma'), 'utf8');
  const customModel = /\bmodel\s+CustomExtension\s*\{([^}]*)\}/u.exec(generatedPrisma);
  expect(customModel).not.toBeNull();
  expect(customModel![1]).toMatch(/\bid\s+String\s+@id(?=$|\s)/u);
  expect(customModel![1]).toMatch(/\bvalue\s+String(?=$|\s)/u);
  await expect(fs.stat(path.join(prismaRoot, 'dev.db'))).rejects.toMatchObject({ code: 'ENOENT' });
  const installedCustomerService = await fs.readFile(
    path.join(resolvedWorkspaceRoot, 'src', 'installed', 'entity', 'customer-service.ts'),
    'utf8'
  );
  expect(installedCustomerService).toMatch(/normalizeCustomerInput/);
  expect(installedCustomerService).toMatch(/Unknown/);

  const { report } = await verifyWorkspace(workspaceRoot);
  expect(report.summary.status).toBe('passed');
  expect(report.summary.requestedLane).toBe('all');
  expect(report.build.status).toBe('passed');
  expect(report.policy.status).toBe('passed');
  expect(report.fast.status).toBe('passed');
  expect(report.runtime.status).toBe('passed');

  const locked = await lockWorkspace(workspaceRoot);
  expect(locked.passStatus.lock).toBe('succeeded');
  expect(locked.passStatus.emit).toBe('pending');
  expect(locked.generatedPaths).toContain(CI_ARTIFACT_FILES.runtimeReport);
  expect(locked.generatedPaths).toContain(CI_ARTIFACT_FILES.policyReport);
  expect(locked.generatedPaths).toContain(CI_ARTIFACT_FILES.acceptanceCoverage);

  const provenance = await readJson<{
    artifacts: Array<{ path: string; originType: string }>;
  }>(provenancePath);
  expect(provenance.artifacts).toContainEqual(expect.objectContaining({
    path: 'src/installed/entity/customer-service.ts',
    originType: 'block'
  }));

  const runtimeReport = await readJson<{
    status: string;
    build: { status: string };
    acceptance: { status: string };
    logs: { stdout: string };
  }>(runtimeReportPath);
  expect(runtimeReport.status).toBe('passed');
  expect(runtimeReport.build.status).toBe('passed');
  expect(runtimeReport.acceptance.status).toBe('passed');
  expect(runtimeReport.logs.stdout).toContain('runtime-build:passed');
  expect(runtimeReport.logs.stdout).not.toContain('Duration');
  expect(runtimeReport.logs.stdout).not.toContain('Start at');

  const coverage = await readJson<{
    status: string;
    uncoveredBlocks: string[];
  }>(acceptanceCoveragePath);
  expect(coverage.status).toBe('passed');
  expect(coverage.uncoveredBlocks).toHaveLength(0);

  const policyReport = await readJson<{
    status: string;
    merged: { policies: Array<{ id: string; sourceScope: string; sourcePath: string; targets: string[] }> };
    violations: unknown[];
  }>(policyReportPath);
  expect(policyReport.status).toBe('passed');
  expect(policyReport.violations).toHaveLength(0);
  expect(policyReport.merged.policies.find((policy) => policy.id === 'tenant-scope-required')).toEqual({
    id: 'tenant-scope-required',
    sourceScope: 'official',
    sourcePath: 'catalog/policies/official/policy.spec.yaml',
    targets: ['src/installed/entity/customer-service.ts']
  });

  const { graph, reviewSummary } = await explainWorkspace(workspaceRoot);
  const explainedLock = await readJson<{ passStatus: { emit: string }; generatedPaths: string[] }>(lockPath);
  expect(explainedLock.passStatus.emit).toBe('succeeded');
  expectGraphNode(graph, { id: 'port:entity/customer-basic:input:tenant_context', type: 'port' });
  expectGraphEdge(graph, {
    from: 'block:entity/customer-basic',
    to: 'port:entity/customer-basic:input:tenant_context',
    type: 'requires'
  });
  const canonicalPortNode = graph.nodes.find((node) => node.id === 'port:entity/customer-basic:input:tenant_context');
  const canonicalPortEdge = graph.edges.find((edge) =>
    edge.from === 'block:entity/customer-basic' &&
    edge.to === 'port:entity/customer-basic:input:tenant_context' &&
    edge.type === 'requires'
  );
  expect(canonicalPortNode?.references).toBeDefined();
  expect(canonicalPortEdge?.references).toBeDefined();
  expect(graph.nodes.some((node) => node.type === 'pin')).toBe(false);
  expect(new Set(graph.nodes.map((node) => node.id)).size).toBe(graph.nodes.length);
  expectGraphNode(graph, { id: 'policy:tenant-scope-required' });
  expectGraphEdge(graph, {
    from: 'policy:tenant-scope-required',
    to: 'file:src/installed/entity/customer-service.ts',
    type: 'connects_to'
  });
  expectNoGraphEdge(graph, { type: 'violates' });
  expect(graph.overlays.coverage.blocks.every((entry) => Array.isArray(entry.coveredBy))).toBe(true);
  expect(reviewSummary.ciSummary.status).toBe('passed');
  expect(reviewSummary.ciSummary.failureCount).toBe(0);
  expect(reviewSummary.provenanceSummary).toMatchObject({
    overrideArtifactCount: 0,
    registryArtifactCount: expect.any(Number),
    unverifiedArtifactCount: expect.any(Number),
    originSummaryCount: expect.any(Number),
    overrideSummaryCount: expect.any(Number),
    registrySummaryCount: expect.any(Number),
    originSummaries: expect.arrayContaining([
      expect.objectContaining({ originType: 'block' })
    ])
  });
  expect(reviewSummary.provenanceSummary?.artifactCount).toBeGreaterThan(0);
  expect(reviewSummary.coverageSummary).toMatchObject({
    status: 'passed',
    blockCount: 3,
    coveredBlockCount: 3,
    uncoveredBlockCount: 0
  });
  expect(reviewSummary.failurePoints).toHaveLength(0);
  expect(reviewSummary.regressionRisks).toHaveLength(0);
  expect(reviewSummary.conflictHints).toHaveLength(0);

  const refreshedProvenance = await readJson<{
    artifacts: Array<{ path: string; generatedByPass?: string }>;
  }>(provenancePath);
  expect(
    refreshedProvenance.artifacts.some(
      (artifact) => artifact.path === CI_ARTIFACT_FILES.explainGraph && artifact.generatedByPass === 'explain'
    )
  ).toBe(true);

  expect(explainedLock.generatedPaths).toEqual(
    expect.arrayContaining([
      CI_ARTIFACT_FILES.verificationReport,
      CI_ARTIFACT_FILES.runtimeReport,
      CI_ARTIFACT_FILES.policyReport,
      CI_ARTIFACT_FILES.acceptanceCoverage,
      CI_ARTIFACT_FILES.explainGraph,
      CI_ARTIFACT_FILES.explainGraphMermaid,
      CI_ARTIFACT_FILES.explainGraphDot,
      CI_ARTIFACT_FILES.reviewSummary
    ])
  );
}, 540000);
