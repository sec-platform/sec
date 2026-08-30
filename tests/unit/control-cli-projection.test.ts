import { describe, expect, test } from 'bun:test';

import {
  projectRepositoryAuditCli,
  projectRepositoryModuleArchitectureAudit,
  repositoryModuleArchitectureShouldBlock,
  type RepositoryAuditReport
} from '../../src/brownfield/repository-audit/cli.ts';
import {
  projectDocumentControlPlaneStatusCli
} from '../../src/control/documentation/document-control-plane.ts';
import { projectSecWorkSelectionCli } from '../../src/control/main-health/work-selection.ts';
import { compileSecOperationDemandGraph } from '../../src/control/operation/demand.ts';
import type { SecWorkSelectionLiveResult } from '../../src/control/work-selection/live-contract.ts';
import { shouldReportDevRunnerSuccess } from '../../src/development/runner/cli.ts';
import type { SecRepositoryModuleArchitectureProjection } from '../../src/system-architecture/repository-modules/contract.ts';

describe('bounded control-plane CLI projections', () => {
  test('repository architecture projection preserves deterministic feedback projections and blocks violations', () => {
    const empty = {
      ownerEdges: [], strongComponents: [], reciprocalPairs: [], feedbackCuts: [],
      aggregateFacadePaths: [], unresolvedAggregateSurfacePaths: [], moduleRoles: [], violations: []
    } satisfies SecRepositoryModuleArchitectureProjection;
    expect(repositoryModuleArchitectureShouldBlock(empty)).toBe(false);
    expect(projectRepositoryModuleArchitectureAudit(empty)).toEqual({
      feedbackProjections: [], reciprocalPairs: [], strongComponents: [], violations: []
    });

    const witness = {
      fromOwner: 'contract-owner',
      toOwner: 'runtime-owner',
      witnesses: [{
        fromPath: 'src/contract-owner/contract.ts',
        toPath: 'src/runtime-owner/runtime.ts',
        kind: 'static' as const,
        specifier: '../runtime-owner/runtime.ts'
      }]
    };
    const violation = {
      code: 'repository-module-role-reverse-dependency' as const,
      from: witness.witnesses[0].fromPath,
      to: witness.witnesses[0].toPath,
      detail: 'contract-owner (contract) depends on runtime-owner (runtime)'
    };
    const invalid = {
      ...empty,
      ownerEdges: [witness],
      strongComponents: [{ ownerIds: ['contract-owner', 'runtime-owner'], edges: [witness] }],
      feedbackCuts: [witness],
      violations: [violation]
    } satisfies SecRepositoryModuleArchitectureProjection;
    const projected = projectRepositoryModuleArchitectureAudit(invalid);
    expect(repositoryModuleArchitectureShouldBlock(invalid)).toBe(true);
    expect(projected.feedbackProjections[0]?.witnesses).toEqual(witness.witnesses);
    expect(projected.violations).toEqual([violation]);
  });

  test('successful hook operations are silent while direct commands retain confirmation', () => {
    expect(shouldReportDevRunnerSuccess({ SEC_GIT_HOOK_ACTIVE: '1' })).toBe(false);
    expect(shouldReportDevRunnerSuccess({})).toBe(true);
  });

  test('repository audit projects decision facts without path-scale report bodies', () => {
    const report = {
      architecture: {
        ownerEdges: [], strongComponents: [], reciprocalPairs: [], feedbackCuts: [],
        aggregateFacadePaths: [], unresolvedAggregateSurfacePaths: [], moduleRoles: [], violations: []
      },
      revision: {
        defaultHead: 'a'.repeat(40), defaultRef: 'main', defaultRefInput: 'main',
        defaultRefMode: 'ref', head: 'b'.repeat(40), tree: 'c'.repeat(40), worktree: 'clean'
      },
      summary: {
        activeMarkdown: 1, behaviorCandidates: 0,
        contentCoverage: { excluded: 0, scanned: 500, unknown: 0 },
        findings: { critical: 0, high: 500, medium: 0, low: 0 },
        markdown: 1, skills: 8, trackedPaths: 500, unknowns: 0
      },
      findings: Array.from({ length: 500 }, (_, index) => ({
        code: 'one-root-class', message: `instance ${index}`, severity: 'high' as const
      })),
      unknowns: [],
      behaviorCandidates: Array.from({ length: 500 }, (_, index) => ({
        line: index + 1, path: `path-${index}`, skills: [], text: 'noise'
      })),
      contentCoverage: Array.from({ length: 500 }, (_, index) => ({ path: `path-${index}` }))
    } as unknown as RepositoryAuditReport;
    const projected = projectRepositoryAuditCli(report);
    expect(projected.findingCodes).toEqual(['one-root-class']);
    expect(projected).not.toHaveProperty('behaviorCandidates');
    expect(projected).not.toHaveProperty('contentCoverage');
    expect(JSON.stringify(projected).length).toBeLessThan(1_500);
  });

  test('work selection keeps authority identity and the actionable decision only', () => {
    const result = {
      status: 'resolved', resultDigest: 'sha256:result',
      demandGraph: compileSecOperationDemandGraph({
        operation: 'work-selection-observe',
        terminalWorkIds: []
      }),
      terminalCompaction: null,
      receipt: {
        exactMain: 'a'.repeat(40), exactMainTree: 'b'.repeat(40),
        receiptDigest: 'sha256:receipt',
        catalog: { items: Array.from({ length: 500 }, (_, index) => ({ index })) },
        decision: {
          status: 'select-next', selectedWorkId: 'issue-346',
          selectedCandidateRef: 'operation-read-plan-authority-canary-v1',
          decisionDigest: 'sha256:decision', reasonCodes: ['candidate-selected'],
          blockedCandidateRefs: ['issue-999'], requiredPreconditions: [{}, {}]
        }
      }
    } as unknown as SecWorkSelectionLiveResult;
    const projected = projectSecWorkSelectionCli(result);
    expect(projected).toMatchObject({
      status: 'resolved', exactMain: 'a'.repeat(40),
      decision: { selectedWorkId: 'issue-346', requiredPreconditions: 2 }
    });
    expect(projected).not.toHaveProperty('receipt.catalog');
    expect(JSON.stringify(projected).length).toBeLessThan(1_500);
  });

  test('status reports open inventory cardinality without copying issue bodies', () => {
    const resolved = {
      repository: { defaultRefState: 'fresh' },
      workspace: { status: 'clean' },
      github: {
        status: 'resolved',
        openPullRequests: [{ number: 539, body: 'x'.repeat(10_000) }],
        openIssues: Array.from({ length: 500 }, (_, number) => ({ number, body: 'x'.repeat(1_000) })),
        reviewThreads: { '539': { nodes: Array.from({ length: 100 }, () => 'noise') } }
      },
      activeWorkPackage: { state: 'active', manifest: 'docs/work-packages/focused.md' },
      activation: null,
      stableFacts: Array.from({ length: 500 }, () => 'noise')
    };
    const projected = projectDocumentControlPlaneStatusCli(resolved);
    expect(projected.github).toEqual({
      status: 'resolved', openPullRequestNumbers: [539], openIssueCount: 500,
      reviewThreadPullRequestCount: 1
    });
    expect(projected).not.toHaveProperty('stableFacts');
    expect(JSON.stringify(projected).length).toBeLessThan(1_500);
  });
});
