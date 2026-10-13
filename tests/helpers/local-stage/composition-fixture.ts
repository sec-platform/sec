/** Isolated orchestration test process. Provider and qualification functions are
 * fixtures, not production evidence. The composition, exact-request guards,
 * physical journal publication, lease and settlement owners execute normally. */
import { mock } from 'bun:test';
import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import path from 'node:path';

import * as gitAuthority from '../../../src/adapters/providers/git-read/authority.ts';
import * as githubSession from '../../../src/adapters/providers/github-api/operation-session.ts';
import { resolveSecRuntimeStateForRepository } from '../../../src/adapters/runtime-state/workspace-state/paths.ts';
import { createMainHealthLedger } from '../../../src/adapters/self-hosting/control/main-health/contract.ts';
import { createObservedMainHealthInput } from '../../../src/adapters/self-hosting/control/main-health/main-health-observation.ts';
import { CI_MAIN_HEALTH_POLICY, createCiMainHealthRequestOperationId } from '../../../src/adapters/self-hosting/control/main-health/provider-policy.ts';
import * as mainHealth from '../../../src/adapters/self-hosting/control/main-health/work-selection-main-health.ts';
import * as workPackage from '../../../src/adapters/self-hosting/control/task/contract/work-package.ts';
import * as gitRead from '../../../src/adapters/self-hosting/development/tooling/git/git-read.ts';
import { encodeVerificationActionData } from '../../../src/adapters/verification/platform/action/contract/action.ts';
import * as evidenceContract from '../../../src/adapters/verification/platform/ci/contract/evidence.ts';
import { CI_VERIFICATION_SESSION_REQUEST_SCHEMA } from "../../../src/adapters/verification/platform/ci/contract/session-request.ts";
import * as github from '../../../src/adapters/verification/platform/ci/runtime/verification-session-github.ts';
import * as sessionRuntime from '../../../src/adapters/verification/platform/ci/runtime/verification-session-runtime.ts';
import * as session from '../../../src/adapters/verification/platform/ci/runtime/verification-session.ts';
import * as container from '../../../src/adapters/verification/platform/trusted-runtime/trusted-runtime-container.ts';

const scenario = process.argv[2];
const repositoryRoot = process.argv[3]!;
const D = (n: string) => `sha256:${n.repeat(64)}` as const;
const request = Object.freeze({ schema: CI_VERIFICATION_SESSION_REQUEST_SCHEMA,
  prNumber: 123, expectedBaseSha: '1'.repeat(40), expectedBaseTreeSha: '2'.repeat(40),
  expectedHeadSha: '3'.repeat(40), expectedHeadTreeSha: '4'.repeat(40),
  manifestPath: 'work-packages/local.json', manifestDigest: D('1'), profile: 'fast',
  expectedScopeProposalDigest: D('2'), expectedActionPlanDigest: D('3'),
  expectedSessionRevision: D('4'), reviewPolicyDigest: D('5'), requestOperationId: D('6') });
const saved = sessionRuntime.createVerificationSessionLocalPreparationRequest(request);
const candidate = { repository: 'sec-platform/sec', number: 123, state: 'OPEN',
  isDraft: false, isCrossRepository: false, baseSha: request.expectedBaseSha,
  baseTreeSha: request.expectedBaseTreeSha, headSha: request.expectedHeadSha,
  headTreeSha: request.expectedHeadTreeSha, authorNodeId: 'author', body: '', baseBranch: 'main' };
const counters = { source: 0, review: 0, currentSubject: 0, remoteWrite: 0, platform: 0, reprepare: 0 };
const fixtureSession = { repository: candidate.repository, prNumber: 123,
  sessionRevision: request.expectedSessionRevision, baseSha: candidate.baseSha,
  baseTreeSha: candidate.baseTreeSha, headSha: candidate.headSha, headTreeSha: candidate.headTreeSha,
  manifestPath: request.manifestPath, manifestDigest: request.manifestDigest,
  profile: request.profile, reviewPolicyDigest: request.reviewPolicyDigest };
const producer = { sourceDigest: D('8') };
const evidence = { sessionRevision: request.expectedSessionRevision,
  baseSha: candidate.baseSha, headSha: candidate.headSha, headTreeSha: candidate.headTreeSha,
  actionPlan: { actionPlanDigest: request.expectedActionPlanDigest },
  evidenceDigest: D('9'), status: 'passed', producer };
const artifact = { session: fixtureSession, evidence, producer, artifactDigest: D('a'),
  scopeAuthorization: { proposalDigest: request.expectedScopeProposalDigest } };
const evidenceBytes = `${encodeVerificationActionData(evidence)}\n`;
const receipt = { sessionRevision: fixtureSession.sessionRevision, baseSha: fixtureSession.baseSha,
  headSha: fixtureSession.headSha, headTreeSha: fixtureSession.headTreeSha,
  evidenceDigest: evidence.evidenceDigest, producerSourceDigest: producer.sourceDigest,
  evidenceByteLength: Buffer.byteLength(evidenceBytes),
  evidenceByteDigest: `sha256:${createHash('sha256').update(evidenceBytes).digest('hex')}`,
  executionId: 'test-only-local-stage' };
const qualification = { qualificationDigest: D('b') };
const envelope = { session: fixtureSession,
  actionPlanClosure: { actionPlanDigest: request.expectedActionPlanDigest } };
const prepared = () => {
  counters.reprepare++;
  return { request: scenario === 'environment-drift' ? { ...request, expectedActionPlanDigest: D('f') } : request,
    sessionRevision: fixtureSession.sessionRevision, envelope };
};
const mockModule = (url: string, factory: () => object) => mock.module(new URL(url, import.meta.url).pathname, factory);
mockModule('../../../src/adapters/verification/platform/ci/runtime/verification-session-runtime.ts', () => ({
  ...sessionRuntime, prepareTrustedMainVerificationSession: prepared, prepareTrustedRuntimeVerificationSession: prepared,
  finalizeVerificationSessionHostedArtifact: () => artifact, refreshVerificationSessionHostedArtifact: () => artifact
}));
mockModule('../../../src/adapters/verification/platform/ci/runtime/verification-session.ts', () => ({
  ...session, observeVerificationSessionChangedSelection: async () => ({ changedPaths: [],
    testImpactTransition: {}, testImpactSourceProvider: {} }),
  observeVerificationSessionActionDependencyBlobs: async () => []
}));
mockModule('../../../src/adapters/verification/platform/ci/contract/evidence.ts', () => ({
  ...evidenceContract, parseVerificationSessionArtifact: (source: string) => JSON.parse(source),
  assertVerificationEvidence: () => {},
  parseSourceProgramTransitionAcceptanceRecord: (value: unknown) => value
}));
mockModule('../../../src/adapters/verification/platform/trusted-runtime/trusted-runtime-container.ts', () => ({
  ...container,
  withTrustedRuntimeMainHealthQualification: async () => { throw new Error('TEST_NATIVE_MAIN_HEALTH_UNAVAILABLE'); },
  parseTrustedRuntimeContainerReceipt: (value: unknown) => value,
  parseTrustedRuntimeSourceProgramAttemptEvidence: (value: unknown) => value
}));
mockModule('../../../src/adapters/verification/platform/ci/runtime/verification-session-github.ts', () => ({
  ...github, createVerificationSessionGitHubClient: () => ({
    observeCandidate: async () => {
      counters.currentSubject++;
      return scenario === 'merged-input' ? { ...candidate, state: 'MERGED' }
        : scenario === 'subject-drift' && counters.currentSubject >= 4
          ? { ...candidate, headTreeSha: 'f'.repeat(40) } : candidate;
    },
    observeComparison: async () => ({ status: 'ahead', behindBy: 0 }),
    observeOpenPullRequestCountForHead: async () => 1,
    readBlobText: async () => '{}',
    observeViewerPrincipal: async () => ({ permission: 'maintain', login: 'tester', nodeId: 'maintainer' }),
    observeReviewBarrier: async () => {
      counters.review++;
      if (counters.review > 1 && scenario !== 'reuse') throw new Error('TEST_PRE_MERGE_BOUNDARY');
      return { status: scenario === 'review-waiting' ? 'waiting' : 'clear', reason: 'test review waiting' };
    },
    observePlatformEnforcement: async () => { counters.platform++; throw new Error('TEST_PLATFORM_FORBIDDEN'); }
  })
}));
mockModule('../../../src/adapters/providers/git-read/authority.ts', () => ({
  ...gitAuthority, withAuthorityGitReadSession: async (_input: unknown, operation: (session: unknown) => unknown) => operation({})
}));
mockModule('../../../src/adapters/self-hosting/development/tooling/git/git-read.ts', () => ({
  ...gitRead, gitReadText: async (_session: unknown, args: readonly string[]) => {
    if (args.join(' ') === 'branch --show-current') return 'main';
    if (args.join(' ') === 'rev-parse HEAD') return candidate.baseSha;
    if (args.join(' ') === 'rev-parse HEAD^{tree}') return candidate.baseTreeSha;
    if (args[0] === 'status') return '';
    if (args[0] === 'remote') return 'https://github.com/sec-platform/sec.git';
    throw new Error(`Unexpected Git read ${args.join(' ')}`);
  }
}));
mockModule('../../../src/adapters/self-hosting/control/task/contract/work-package.ts', () => ({
  ...workPackage, parseWorkPackageLocator: () => request.manifestPath,
  workPackageManifestDigest: () => request.manifestDigest,
  parseCurrentWorkPackageManifest: () => ({ requiredProfile: request.profile }),
  assertWorkPackageOwnership: () => {}
}));
mockModule('../../../src/adapters/self-hosting/control/main-health/work-selection-main-health.ts', () => ({
  ...mainHealth,
  observeMainHealthGitHubDefaultBranchSha: async () => candidate.baseSha,
  withMainHealthGitHubReadOperationBudget: async (input: { operation: () => unknown }) => input.operation(),
  observeCanonicalMainHealthForPublication: async () => {
    const observedAt = new Date().toISOString();
    return { ledger: createMainHealthLedger(createObservedMainHealthInput({
      repository: candidate.repository, mainSha: candidate.baseSha,
      mainTreeSha: candidate.baseTreeSha, trustRevision: candidate.baseSha,
      observedAt, expiresAt: new Date(Date.now() + 600_000).toISOString(),
      checks: [{ id: 1, name: CI_MAIN_HEALTH_POLICY.context, status: 'completed',
        conclusion: 'success', headSha: candidate.baseSha, detailsUrl: null,
        appId: CI_MAIN_HEALTH_POLICY.app.id, appNodeId: CI_MAIN_HEALTH_POLICY.app.nodeId,
        appSlug: CI_MAIN_HEALTH_POLICY.app.slug,
        workflowPath: CI_MAIN_HEALTH_POLICY.producer.workflowPath,
        workflowRef: `${CI_MAIN_HEALTH_POLICY.producer.workflowPath}@${candidate.baseSha}`,
        eventName: 'repository_dispatch', workflowRunId: '1',
        workflowRunDisplayTitle: `SEC main health ${candidate.baseSha} operation ${createCiMainHealthRequestOperationId(candidate.baseSha)}` }]
    })), projection: { state: 'healthy' }, repairDecision: { routingState: 'ordinary-only' } };
  }
}));
mockModule('../../../src/adapters/providers/github-api/operation-session.ts', () => ({
  ...githubSession, withGitHubApiStatusWriteSession: () => { counters.remoteWrite++; throw new Error('TEST_STATUS_FORBIDDEN'); },
  withGitHubApiMergeWriteSession: () => { counters.remoteWrite++; throw new Error('TEST_MERGE_FORBIDDEN'); }
}));

const { verifyWithTrustedRuntime, closeoutWithTrustedRuntime, readLocalVerificationStatusWithTrustedRuntime } =
  await import('../../../src/adapters/self-hosting/control/composition/trusted-runtime-closeout.ts');
const source: Parameters<typeof verifyWithTrustedRuntime>[1] = async (context) => {
  counters.source++;
  await context.assertCurrentSubject();
  context.publishAttempt({ evidenceDigest: D('c') } as never);
  if (context.previousVerification === null) context.publishVerification({ evidence, receipt } as never);
  if (scenario === 'source-waiting') return { kind: 'waiting', value: { status: 'needs-author' } };
  context.publishAdoption(qualification as never);
  return { kind: 'accepted', qualification, verification: { evidence, receipt } } as never;
};
let result: unknown = null;
let failure: string | null = null;
try {
  result = scenario === 'full-closeout'
    ? await closeoutWithTrustedRuntime({ repositoryRoot, repository: candidate.repository, prNumber: 123 }, source)
    : await verifyWithTrustedRuntime({ repositoryRoot, repository: candidate.repository, request: saved }, source);
  if (scenario === 'reuse') result = await verifyWithTrustedRuntime({ repositoryRoot, repository: candidate.repository, request: saved }, source);
} catch (error) { failure = error instanceof Error ? error.message : String(error); }
const layout = resolveSecRuntimeStateForRepository({ repositoryRoot, repository: candidate.repository });
const records = path.join(layout.repositoryStateRoot, 'trusted-runtime', 'v1', fixtureSession.sessionRevision.slice(7));
let files: string[] = [];
try { files = readdirSync(records).sort(); } catch {}
const projection = failure === null && ['verified', 'reuse', 'source-waiting'].includes(scenario ?? '')
  ? readLocalVerificationStatusWithTrustedRuntime({ repositoryRoot, repository: candidate.repository, request: saved }) : null;
const leases = path.join(layout.repositoryStateRoot, 'trusted-runtime', 'closeout-leases');
let leaseFiles: string[] = [];
try { leaseFiles = readdirSync(leases).sort(); } catch {}
process.stdout.write(JSON.stringify({ result, failure, counters, files, projection, leaseFiles }));
