import { describe, expect, test } from 'bun:test';

import {
  compileRepositoryModuleMembershipSnapshot,
  compileRepositoryModuleTopologyProjection,
  parseModuleDescriptor,
  type RepositoryModuleMembership
} from '../../src/adapters/repository/architecture/contract.ts';
import { compileRepositoryModulePlacementAdmission } from '../../src/adapters/repository/architecture/placement.ts';
import {
  projectRepositoryAuditCli,
  projectRepositoryAuditFindingsCli,
  projectRepositoryModuleArchitectureAudit,
  RepositoryAuditCliProjectionContractError,
  repositoryModuleArchitectureShouldBlock,
  type RepositoryAuditReport
} from '../../src/adapters/repository/repository-audit/cli.ts';
import { compileSourceProgramDeclarationTopology } from '../../src/adapters/repository/source-program-model/declaration-topology.ts';
import { compileVirtualRepositorySourceProgramCompilation } from '../../src/adapters/repository/source-program-model/repository-compilation.ts';
import { compileRepositoryModuleGraph } from '../../src/adapters/repository/source-program-model/typescript.ts';
import { compileVirtualWorkspaceSourceSnapshot } from '../../src/adapters/repository/source-program-model/workspace-source-snapshot.ts';
import {
  projectDocumentControlPlaneStatusCli
} from '../../src/adapters/self-hosting/control/documentation/document-control-plane.ts';
import { compileOperationDemandGraph } from '../../src/adapters/self-hosting/control/operation/demand.ts';
import type { WorkSelectionLiveResult } from '../../src/adapters/self-hosting/control/work-selection/live-contract.ts';
import { projectWorkSelectionCli } from '../../src/adapters/self-hosting/control/work-selection/runtime.ts';
import { shouldReportDevRunnerSuccess } from '../../src/adapters/self-hosting/development/runner/cli.ts';
import { rawSha256 } from '../../src/contracts/canonical.ts';

function declarationTopologyFixture() {
  const descriptorPath = 'src/projection-owner/sec.module.json';
  const sourcePath = 'src/projection-owner/runtime.ts';
  const source = 'export const projection = true;';
  const sourceRevision = rawSha256(source);
  const moduleMembership = compileRepositoryModuleMembershipSnapshot({
    repositoryFiles: [descriptorPath, sourcePath],
    descriptorSources: [{
      descriptorPath,
      source: JSON.stringify({
        importGraph: 'runtime',
        externalEntrypoints: [],
        capabilityProviders: [],
        operationObligations: [],
        causalRelations: [],
        preDependencyBootstrap: false
      })
    }]
  });
  const workspaceSnapshot = compileVirtualWorkspaceSourceSnapshot({
    subject: {
      kind: 'virtual-mutation',
      provenance: {
        kind: 'source-program-virtual-mutation',
        baseSnapshotDigest: rawSha256('repository-audit-projection-base'),
        mutationDigest: sourceRevision
      }
    },
    files: [{ path: sourcePath, source, contentDigest: sourceRevision }],
    moduleMembership
  });
  return compileSourceProgramDeclarationTopology(
    compileVirtualRepositorySourceProgramCompilation({ workspaceSnapshot })
  );
}

function architectureProjectionFixture(topology: 'acyclic' | 'cyclic') {
  const contract = parseModuleDescriptor(
    { importGraph: 'runtime', externalEntrypoints: [] },
    'src/contract-owner/sec.module.json'
  );
  const runtime = parseModuleDescriptor(
    { importGraph: 'runtime', externalEntrypoints: [] },
    'src/runtime-owner/sec.module.json'
  );
  const descriptors = Object.freeze([contract, runtime]);
  const membership: RepositoryModuleMembership = Object.freeze({
    descriptors,
    graphRoots: Object.freeze(descriptors.map(({ root }) => root)),
    moduleRoots: Object.freeze(descriptors.map(({ root }) => root)),
    moduleForPath: (candidatePath) => descriptors.find(({ root }) => (
      candidatePath === root || candidatePath.startsWith(`${root}/`)
    )) ?? null
  });
  const sources = new Map<string, string>([
    [
      'src/contract-owner/contract.ts',
      topology === 'cyclic'
        ? "import { runtime } from '../runtime-owner/runtime.ts'; export const contract = runtime;"
        : 'export const contract = true;'
    ],
    [
      'src/runtime-owner/runtime.ts',
      topology === 'cyclic'
        ? "import { contract } from '../contract-owner/contract.ts'; export const runtime = contract;"
        : 'export const runtime = true;'
    ]
  ]);
  const graph = compileRepositoryModuleGraph({
    files: [...sources.keys()],
    readSource: (sourcePath) => sources.get(sourcePath) ?? null
  });
  const structural = compileRepositoryModuleTopologyProjection(graph, membership);
  const responsibilityAdmission = compileRepositoryModulePlacementAdmission({
    graph,
    membership,
    facts: Object.freeze({
      sourceRevision: rawSha256('repository-module-source'),
      semanticRevision: rawSha256('repository-module-semantics'),
      files: Object.freeze([]),
      declarations: Object.freeze([]),
      references: Object.freeze([]),
      capabilities: Object.freeze([]),
      entrypoints: Object.freeze([]),
      entrypointClosures: Object.freeze([])
    })
  });
  return Object.freeze({
    ...structural,
    aggregateFacadePaths: Object.freeze([]),
    unresolvedAggregateSurfacePaths: Object.freeze([]),
    nodeResponsibilities: Object.freeze([]),
    responsibilityAdmission
  });
}

describe('bounded control-plane CLI projections', () => {
  test('repository architecture projection preserves deterministic feedback projections and blocks violations', () => {
    const empty = architectureProjectionFixture('acyclic');
    expect(repositoryModuleArchitectureShouldBlock(empty)).toBe(false);
    expect(projectRepositoryModuleArchitectureAudit(empty)).toEqual({
      feedbackProjections: [], reciprocalPairs: [], strongComponents: [], violations: []
    });

    const invalid = architectureProjectionFixture('cyclic');
    const projected = projectRepositoryModuleArchitectureAudit(invalid);
    expect(repositoryModuleArchitectureShouldBlock(invalid)).toBe(true);
    expect(projected.feedbackProjections[0]?.witnesses)
      .toEqual(invalid.feedbackCuts[0]?.witnesses);
    expect(projected.violations).toEqual(invalid.violations);
  });

  test('successful hook operations are silent while direct commands retain confirmation', () => {
    expect(shouldReportDevRunnerSuccess({ SEC_GIT_HOOK_ACTIVE: '1' })).toBe(false);
    expect(shouldReportDevRunnerSuccess({})).toBe(true);
  });

  test('repository audit projects decision facts without path-scale report bodies', () => {
    const report = {
      architecture: architectureProjectionFixture('acyclic'),
      declarationTopology: declarationTopologyFixture(),
      revision: {
        defaultHead: 'a'.repeat(40), defaultRef: 'main', defaultRefInput: 'main',
        defaultRefMode: 'ref', head: 'b'.repeat(40), tree: 'c'.repeat(40), worktree: 'clean'
      },
      summary: {
        activeMarkdown: 1, behaviorCandidates: 0,
        contentCoverage: { excluded: 0, scanned: 500, unknown: 0 },
        findings: { critical: 0, high: 500, medium: 0, low: 0 },
        markdown: 1,
        sourceProgram: {
          capabilities: 0, candidates: 0, declarations: 0, dependencies: 0,
          entrypoints: 0, entrypointClosures: 0, files: 0, literals: 0,
          packages: 0, references: 0, unknowns: 0
        },
        skills: 8, trackedPaths: 500, unknowns: 0
      },
      sourceProgram: { modelDigest: `sha256:${'d'.repeat(64)}` },
      sourceProgramCompilation: {
        subjectDigest: `sha256:${'1'.repeat(64)}`,
        snapshotDigest: `sha256:${'2'.repeat(64)}`,
        moduleGraphDigest: `sha256:${'3'.repeat(64)}`,
        receiptDigest: `sha256:${'4'.repeat(64)}`
      },
      findings: Array.from({ length: 500 }, (_, index) => ({
        code: 'one-root-class', message: `instance ${index}`, severity: 'high' as const,
        ...(index === 0 ? { skills: undefined } : {})
      })),
      unknowns: [],
      optimizations: [],
      heuristicRoutes: {},
      surfaces: {},
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

    const findings = projectRepositoryAuditFindingsCli(report);
    expect(findings.reportDigest).toBe(projected.reportDigest);
    expect(findings.revision).toBe(report.revision);
    expect(findings.findings).toBe(report.findings);
    expect(findings.unknowns).toBe(report.unknowns);
    expect(findings.findingCodes).toEqual(['one-root-class']);
    expect(findings).not.toHaveProperty('sourceProgram');
    expect(findings).not.toHaveProperty('behaviorCandidates');

    const { declarationTopology: _declarationTopology, ...staleReport } = report;
    expect(() => projectRepositoryAuditCli(
      staleReport as unknown as RepositoryAuditReport
    )).toThrow(RepositoryAuditCliProjectionContractError);

    const { responsibilityAdmission: _responsibilityAdmission, ...incompleteArchitecture } = report.architecture;
    expect(() => projectRepositoryAuditCli({
      ...report,
      architecture: incompleteArchitecture
    } as unknown as RepositoryAuditReport)).toThrow(RepositoryAuditCliProjectionContractError);
  });

  test('work selection keeps authority identity and the actionable decision only', () => {
    const result = {
      status: 'resolved', resultDigest: 'sha256:result',
      demandGraph: compileOperationDemandGraph({
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
    } as unknown as WorkSelectionLiveResult;
    const projected = projectWorkSelectionCli(result);
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
      activeWorkPackage: { state: 'active', manifest: 'config/repository/work-packages/focused.md' },
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
