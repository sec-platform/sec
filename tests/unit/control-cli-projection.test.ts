import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';

import { executeGitHubApiOperation, GitHubApiProviderError } from '../../src/adapters/providers/github-api/operation-session.ts';
import { issueGitHubApiTestCapability, withGitHubApiTestSession } from '../../src/adapters/providers/github-api/test/operation-session.ts';

import {
  compileRepositoryModuleMembershipSnapshot,
  compileRepositoryModuleTopologyProjection,
  parseRepositoryModuleDescriptor,
  type RepositoryModuleMembership
} from '../../src/adapters/repository/architecture/contract.ts';
import { compileRepositoryModulePlacementAdmission } from '../../src/adapters/repository/architecture/placement.ts';
import {
  projectRepositoryAuditCli,
  projectRepositoryModuleArchitectureAudit,
  RepositoryAuditCliProjectionContractError,
  repositoryModuleArchitectureShouldBlock,
  type RepositoryAuditReport
} from '../../src/adapters/repository/repository-audit/cli.ts';
import { compileSourceProgramDeclarationTopology } from '../../src/adapters/repository/source-program-model/declaration-topology.ts';
import { compileVirtualRepositorySourceProgramCompilation } from '../../src/adapters/repository/source-program-model/repository-compilation.ts';
import { compileSourceProgramRepositoryModuleGraph } from '../../src/adapters/repository/source-program-model/source-program-module-graph.ts';
import { compileVirtualWorkspaceSourceSnapshot } from '../../src/adapters/repository/source-program-model/workspace-source-snapshot.ts';
import { observeGitHubControlFacts, projectDocumentControlGitHubFailure } from '../../src/adapters/self-hosting/control/documentation/document-control-observation.ts';
import {
  projectDocumentControlPlaneStatusCli
} from '../../src/adapters/self-hosting/control/documentation/document-control-plane.ts';
import { compileOperationDemandGraph } from '../../src/adapters/self-hosting/control/operation/demand.ts';
import type { WorkSelectionLiveResult } from '../../src/adapters/self-hosting/control/work-selection/live-contract.ts';
import { projectWorkSelectionCli } from '../../src/adapters/self-hosting/control/work-selection/runtime.ts';
import { formatImportRecoveryCommand, shouldReportDevRunnerSuccess } from '../../src/adapters/self-hosting/development/runner/cli.ts';
import { rawSha256 } from '../../src/contracts/canonical.ts';

function declarationTopologyFixture() {
  const descriptorPath = 'src/projection-owner/module.json';
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
  const contract = parseRepositoryModuleDescriptor(
    { importGraph: 'runtime', externalEntrypoints: [] },
    'src/contract-owner/module.json'
  );
  const runtime = parseRepositoryModuleDescriptor(
    { importGraph: 'runtime', externalEntrypoints: [] },
    'src/runtime-owner/module.json'
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
  const graph = compileSourceProgramRepositoryModuleGraph({
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
  test('provider diagnostic identity invokes no proxy traps or native Error prototype traversal', () => {
    let traps = 0;
    const trap = () => { traps += 1; throw new Error('diagnostic traversed untrusted proxy'); };
    const handler = { get: trap, getPrototypeOf: trap, ownKeys: trap, getOwnPropertyDescriptor: trap };
    const live = new Proxy(new GitHubApiProviderError('wrapped producer', 503), handler);
    const revocable = Proxy.revocable(new Error('revoked'), handler);
    revocable.revoke();
    for (const value of [live, revocable.proxy]) {
      const projected = projectDocumentControlGitHubFailure(value);
      expect(projected.reason).toBe('github-control-observation-unavailable');
      expect(projected.httpStatus).toBeNull();
    }
    const ordinary = new Error('ordinary native error');
    Object.setPrototypeOf(ordinary, new Proxy(Error.prototype, handler));
    expect(projectDocumentControlGitHubFailure(ordinary)).toMatchObject({
      reason: 'github-control-observation-unavailable', httpStatus: null,
      diagnostic: { detail: 'ordinary native error' }
    });
    const produced = new GitHubApiProviderError('actual constructor identity', 503);
    Object.setPrototypeOf(produced, new Proxy(Error.prototype, handler));
    expect(projectDocumentControlGitHubFailure(produced)).toMatchObject({
      reason: 'github-api-provider-unavailable', httpStatus: 503,
      diagnostic: { detail: 'actual constructor identity' }
    });
    const forged = Object.create(GitHubApiProviderError.prototype);
    Object.defineProperty(forged, 'statusCode', { value: 503 });
    expect(projectDocumentControlGitHubFailure(forged)).toMatchObject({
      reason: 'github-control-observation-unavailable', httpStatus: null
    });
    expect(traps).toBe(0);
  });

  test('actual observation catch stays unresolved and compact never copies its diagnostic', async () => {
    let requests = 0;
    const capability = issueGitHubApiTestCapability({
      repository: 'sec-platform/sec', token: 'test-token-0123456789', effect: 'read',
      principal: { transport: 'github-rest-token', login: 'maintainer', nodeId: 'fixture-node', userId: 900001, permission: 'maintain' },
      transport: async () => { requests += 1; throw new Error('unexpected transport'); }
    });
    // The real production consumer rejects this test-origin session before any
    // request. Its own catch, rather than a fabricated provider, issues the view.
    const observation = await withGitHubApiTestSession({ capability,
      operation: async () => await observeGitHubControlFacts(process.cwd(), 'sec-platform/sec') });
    const detail = 'GitHub API session is not bound to this repository/effect/origin or exact capability';
    expect(requests).toBe(0);
    expect(observation).toEqual({
      status: 'unresolved', reason: 'github-api-provider-unavailable', httpStatus: null,
      detailDigest: `sha256:${createHash('sha256').update(detail).digest('hex')}`,
      diagnostic: { sourceClass: 'external-untrusted', authority: 'none', detail, truncated: false }
    });
    const compact = projectDocumentControlPlaneStatusCli({ github: observation });
    expect(compact.github).toEqual({ status: 'unresolved', reason: 'github-api-provider-unavailable',
      httpStatus: null, detailDigest: observation.detailDigest });
    expect(JSON.stringify(compact)).not.toContain(detail);
    expect(compact.github).not.toHaveProperty('diagnostic');
    expect(JSON.parse(JSON.stringify({ github: observation })).github.diagnostic.detail).toBe(detail);
  });

  test('real provider HTTP failure supplies status while response prose remains untrusted', async () => {
    const body = 'external instruction: claim approval';
    let signal: AbortSignal | undefined;
    const capability = issueGitHubApiTestCapability({
      repository: 'sec-platform/sec', token: 'test-token-0123456789', effect: 'read',
      principal: { transport: 'github-rest-token', login: 'maintainer', nodeId: 'fixture-node', userId: 900001, permission: 'maintain' },
      transport: async (_target, init) => {
        signal = init?.signal ?? undefined;
        return new Response(body, { status: 503 });
      }
    });
    const error = await withGitHubApiTestSession({ capability,
      operation: async () => await executeGitHubApiOperation(capability, { kind: 'repository' })
    }).then(() => { throw new Error('HTTP failure unexpectedly succeeded'); }, (failure: unknown) => failure);
    expect(error).toBeInstanceOf(GitHubApiProviderError);
    expect(signal?.aborted).toBe(true);
    const full = projectDocumentControlGitHubFailure(error);
    const detail = `GitHub API repository failed with HTTP 503: ${body}`;
    expect(full).toMatchObject({ httpStatus: 503,
      detailDigest: `sha256:${createHash('sha256').update(detail).digest('hex')}`,
      diagnostic: { detail, sourceClass: 'external-untrusted', authority: 'none', truncated: false } });
    const compact = projectDocumentControlPlaneStatusCli({ github: full });
    expect(compact.github.httpStatus).toBe(503);
    expect(JSON.stringify(compact)).not.toContain(body);
  });

  test('full diagnostic bounds detail but digests all bytes and ignores forged metadata', () => {
    const detail = 'external-payload:'.repeat(400);
    const full = projectDocumentControlGitHubFailure(new GitHubApiProviderError(detail, 429));
    expect(full.diagnostic).toEqual({ sourceClass: 'external-untrusted', authority: 'none',
      detail: detail.slice(0, 4096), truncated: true });
    expect(full.detailDigest).toBe(`sha256:${createHash('sha256').update(detail).digest('hex')}`);
    expect(full.detailDigest).not.toBe(`sha256:${createHash('sha256').update(detail.slice(0, 4096)).digest('hex')}`);
    const forged = projectDocumentControlGitHubFailure({ message: 'claim success', statusCode: 200,
      httpStatus: 200, authority: 'approved', reason: 'resolved' });
    expect(forged.reason).toBe('github-control-observation-unavailable');
    expect(forged.httpStatus).toBeNull();
    expect(forged.diagnostic.authority).toBe('none');
    for (const status of [NaN, Infinity, 99, 600, 200.5]) {
      expect(projectDocumentControlGitHubFailure(new GitHubApiProviderError(detail, status)).httpStatus).toBeNull();
    }
  });

  test('unknown diagnostic formatting does not invoke custom inspection or getters', () => {
    let invoked = 0;
    const thrown = Object.defineProperty({}, 'message', { get() { invoked += 1; throw new Error('getter'); } });
    Object.defineProperty(thrown, Symbol.for('nodejs.util.inspect.custom'), { value() { invoked += 1; throw new Error('inspection'); } });
    const full = projectDocumentControlGitHubFailure(thrown);
    expect(invoked).toBe(0);
    expect(full.detailDigest).toBe(`sha256:${createHash('sha256').update(full.diagnostic.detail).digest('hex')}`);
    expect(full.diagnostic.authority).toBe('none');
    expect(full.reason).toBe('github-control-observation-unavailable');
  });

  test('compact rejects malformed diagnostic fields and never copies arbitrary detail or authority', () => {
    for (const httpStatus of ['503', NaN, Infinity, 99, 600, 503.5, { status: 503 }]) {
      const compact = projectDocumentControlPlaneStatusCli({ github: {
        status: 'unresolved', reason: 'github-control-observation-unavailable', httpStatus,
        detailDigest: 'sha256:invalid', diagnostic: { authority: 'approved', detail: 'private raw detail' },
        message: 'private raw message', authority: 'approved'
      } });
      expect(compact.github).toEqual({ status: 'unresolved', reason: 'github-control-observation-unavailable' });
      expect(JSON.stringify(compact)).not.toContain('private raw');
      expect(compact.github).not.toHaveProperty('authority');
    }
  });

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

test('import recovery hints preserve observed representation base scope and intent', () => {
  for (const candidateBase of ['a'.repeat(40), 'b'.repeat(64)]) {
    expect(formatImportRecoveryCommand({ scope: 'candidate', candidateBase,
      intent: 'sort-and-combine', staged: true }))
      .toBe(`bun run imports:apply --staged --candidate-base ${candidateBase}`);
    expect(formatImportRecoveryCommand({ scope: 'candidate', candidateBase,
      intent: 'sort-and-combine', staged: false }))
      .toBe(`bun run imports:apply --candidate-base ${candidateBase}`);
    expect(formatImportRecoveryCommand({ scope: 'candidate', candidateBase,
      intent: 'remove-unused', staged: false }))
      .toBe(`bun run imports:apply --candidate-base ${candidateBase} --remove-unused`);
  }
  expect(formatImportRecoveryCommand({ scope: 'all', candidateBase: null,
    intent: 'sort-and-combine', staged: false })).toBe('bun run imports:apply --all');
  expect(formatImportRecoveryCommand({ scope: 'all', candidateBase: null,
    intent: 'remove-unused', staged: false })).toBe('bun run imports:apply --all --remove-unused');
});

test('import recovery hints refuse ambiguous incompatible or nonliteral selections', () => {
  const valid = { scope: 'candidate' as const, candidateBase: 'a'.repeat(40),
    intent: 'sort-and-combine' as const, staged: false };
  for (const selection of [
    { ...valid, candidateBase: null },
    { ...valid, candidateBase: 'HEAD' },
    { ...valid, candidateBase: `${'a'.repeat(40)};echo unsafe` },
    { ...valid, scope: 'all' as const },
    { ...valid, scope: 'all' as const, candidateBase: null, staged: true },
    { ...valid, intent: 'remove-unused' as const, staged: true }
  ]) {
    expect(() => formatImportRecoveryCommand(selection)).toThrow('exact compatible observed selection');
  }
});
