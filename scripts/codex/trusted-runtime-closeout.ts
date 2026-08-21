#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import path from 'node:path';

import {
  CodexDevelopmentParseVerificationSessionArtifactV2,
  type CodexDevelopmentVerificationSessionArtifactV2
} from '../../platform/shared/ci-evidence-contract.ts';
import {
  parseGitHubClosingKeywordOccurrencesV1
} from '../../platform/shared/issue-disposition-contract.ts';
import { createMainHealthLedgerV1 } from '../../platform/shared/main-health-contract.ts';
import {
  publishExclusiveDurableCanonicalFileV1,
  readNoFollowOrdinaryFileV1,
  type PhysicalDirectoryIdentityV1
} from '../../platform/shared/physical-no-follow.ts';
import { runCommand } from '../../platform/shared/process.ts';
import { renderIndependentReviewTrailerV1 } from '../../platform/shared/review-stability-contract.ts';
import { encodeVerificationActionDataV2 } from '../../platform/shared/verification-action-contract.ts';
import {
  acquireSecRuntimeStatePhysicalAuthorityV1,
  type SecRuntimeStatePhysicalAuthorityV1
} from '../../tooling/sec-dev/runtime-state-authority.ts';
import { resolveSecRuntimeStateForRepositoryV1 } from '../../tooling/sec-dev/runtime-state-paths.ts';
import {
  dispatchGitHubApiRequestV1,
  integrationAuthorizationStatusMergeMarkersV1,
  parseIntegrationAuthorizationStatusPublicationV1,
  publishIntegrationAuthorizationStatusV1
} from './integration-authorization-status-github.ts';
import {
  createTrustedLocalMainHealthInputV1,
  TRUSTED_LOCAL_MAIN_HEALTH_FRESHNESS_MS_V1
} from './main-health-observation.ts';
import {
  CodexDevelopmentEvaluateTrustedRuntimeMergeGateV1,
  CodexDevelopmentMergeGateProducerIdentityV2,
  CodexDevelopmentParseTrustedRuntimeMergeGateResultV1
} from './merge-gate.ts';
import {
  createTrustedRuntimeHostCommandEnvironmentV1,
  createTrustedRuntimeMainHealthReceiptV1,
  executeTrustedRuntimeContainerVerificationV1,
  executeTrustedRuntimeMainHealthV1,
  parseTrustedRuntimeContainerReceiptV1,
  parseTrustedRuntimeMainHealthReceiptV1,
  TRUSTED_RUNTIME_CONTAINER_EXECUTION_ENVIRONMENT_V1,
  TRUSTED_RUNTIME_MAIN_HEALTH_PLAN_DIGEST_V1,
  type TrustedRuntimeContainerReceiptV1,
  type TrustedRuntimeMainHealthReceiptV1
} from './trusted-runtime-container.ts';
import {
  createVerificationSessionGitHubClientV1,
  type GitHubCandidateObservationV1,
  type VerificationSessionGitHubClientV1
} from './verification-session-github.ts';
import {
  createTrustedRuntimeArtifactObservationFromDurableFileV1,
  createVerificationSessionMergeOperationIdV1,
  createVerificationSessionReviewReceiptV1,
  finalizeVerificationSessionHostedArtifactV2,
  prepareTrustedMainVerificationSessionV1,
  prepareTrustedRuntimeVerificationSessionV1,
  prepareVerificationSessionTrustedRuntimeMergeInputV1,
  refreshVerificationSessionHostedArtifactV2
} from './verification-session-runtime.ts';
import {
  assertHostedSquashMergeCompletionV1,
  observeExactIssueDispositionPlanV1,
  observePostMergeIssueReconciliationV1,
  observeVerificationSessionActionDependencyBlobsV2,
  observeVerificationSessionChangedSelectionV1,
  parseHostedSynchronousSquashMergeResponseV1,
  readExactCommitMarkerV1
} from './verification-session.ts';
import {
  CodexDevelopmentAssertWorkPackageOwnership,
  CodexDevelopmentParseWorkPackageLocator,
  CodexDevelopmentParseWorkPackageManifest,
  CodexDevelopmentWorkPackageManifestDigest
} from './work-package-contract.ts';

const TRUSTED_RUNTIME_ACTION_BUNDLE_SCHEMA_V1 =
  'sec-trusted-runtime-action-bundle-v1' as const;
type Digest = `sha256:${string}`;

interface TrustedRuntimeActionBundleV1 {
  readonly schema: typeof TRUSTED_RUNTIME_ACTION_BUNDLE_SCHEMA_V1;
  readonly sessionRevision: Digest;
  readonly actionPlanDigest: Digest;
  readonly artifact: CodexDevelopmentVerificationSessionArtifactV2;
  readonly containerReceipt: TrustedRuntimeContainerReceiptV1;
  readonly bundleDigest: Digest;
}

function fail(message: string): never {
  throw new Error(`Trusted runtime closeout: ${message}`);
}

function hash(value: unknown): Digest {
  return `sha256:${createHash('sha256').update(encodeVerificationActionDataV2(value)).digest('hex')}`;
}

function digest(value: unknown, label: string): Digest {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    fail(`${label} must be one SHA-256 digest`);
  }
  return value as Digest;
}

function gitSha(value: string, label: string): string {
  if (!/^[0-9a-f]{40}$/u.test(value)) fail(`${label} must be one lowercase Git SHA`);
  return value;
}

function canonicalBytes(value: unknown): Uint8Array {
  return Buffer.from(`${encodeVerificationActionDataV2(value)}\n`, 'utf8');
}

type TrustedRuntimeOperatorArgsV1 =
  | Readonly<{ mode: 'closeout'; repository: string; prNumber: number }>
  | Readonly<{ mode: 'main-health'; repository: string }>;

function parseArgs(argv: readonly string[]): TrustedRuntimeOperatorArgsV1 {
  const mainHealth = argv.includes('--main-health');
  const normalized = argv.filter((argument) => argument !== '--main-health');
  if (mainHealth && normalized.length !== argv.length - 1) {
    fail('--main-health must appear exactly once');
  }
  const values = new Map<string, string>();
  for (let index = 0; index < normalized.length; index += 2) {
    const key = normalized[index];
    const value = normalized[index + 1];
    if (key === undefined || value === undefined || !key.startsWith('--') || values.has(key)) {
      fail('arguments must be unique --key value pairs');
    }
    values.set(key, value);
  }
  if ([...values.keys()].some((key) => key !== '--pr' && key !== '--repository')) {
    fail('usage: bun run sec:closeout -- --pr <n> [--repository owner/name] | bun run sec:main-health');
  }
  const rawPr = values.get('--pr');
  const repository = values.get('--repository') ?? 'sec-platform/sec';
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)) fail('--repository is invalid');
  if (mainHealth) {
    if (rawPr !== undefined) fail('--main-health cannot be combined with --pr');
    return Object.freeze({ mode: 'main-health', repository });
  }
  if (rawPr === undefined || !/^[1-9][0-9]*$/u.test(rawPr)) fail('--pr must be positive');
  return Object.freeze({ mode: 'closeout', repository, prNumber: Number(rawPr) });
}

async function tool(
  executable: 'gh' | 'git',
  args: readonly string[],
  cwd: string,
  secret = false
): Promise<string> {
  const result = await runCommand(executable, [...args], {
    cwd,
    ...(executable === 'git'
      ? {
          envMode: 'replace' as const,
          env: createTrustedRuntimeHostCommandEnvironmentV1('git')
        }
      : {}),
    timeoutMs: 120_000,
    maxStdoutBytes: secret ? 16 * 1024 : 16 * 1024 * 1024,
    maxStderrBytes: 4 * 1024 * 1024
  });
  if (result.code !== 0) fail(`${executable} ${args[0] ?? '<missing>'} failed: ${result.stderr.trim().slice(-4096)}`);
  return result.stdout.trim();
}

async function assertTrustedBaseRuntime(
  repositoryRoot: string,
  candidate: GitHubCandidateObservationV1
): Promise<void> {
  const [branch, head, tree, status] = await Promise.all([
    tool('git', ['branch', '--show-current'], repositoryRoot),
    tool('git', ['rev-parse', 'HEAD'], repositoryRoot),
    tool('git', ['rev-parse', 'HEAD^{tree}'], repositoryRoot),
    tool('git', ['status', '--porcelain=v1', '--untracked-files=all'], repositoryRoot)
  ]);
  if (branch !== 'main' || head !== candidate.baseSha || tree !== candidate.baseTreeSha || status !== '') {
    fail('command must execute from the clean exact live-base main worktree');
  }
}

async function assertTrustedMergedRecoveryRuntime(
  repositoryRoot: string,
  candidate: GitHubCandidateObservationV1
): Promise<void> {
  if (candidate.state !== 'MERGED' || candidate.mergeCommitSha === null
      || candidate.mergeCommitTreeSha === null) {
    fail('merged recovery requires one exact merged candidate identity');
  }
  const [branch, head, tree, status] = await Promise.all([
    tool('git', ['branch', '--show-current'], repositoryRoot),
    tool('git', ['rev-parse', 'HEAD'], repositoryRoot),
    tool('git', ['rev-parse', 'HEAD^{tree}'], repositoryRoot),
    tool('git', ['status', '--porcelain=v1', '--untracked-files=all'], repositoryRoot)
  ]);
  const retainedBase = head === candidate.baseSha && tree === candidate.baseTreeSha;
  const synchronizedMain = head === candidate.mergeCommitSha
    && tree === candidate.mergeCommitTreeSha;
  if (branch !== 'main' || status !== '' || (!retainedBase && !synchronizedMain)) {
    fail('merged recovery must execute from clean main at the retained base or exact merged main');
  }
}

function createActionBundle(input: Readonly<{
  artifact: CodexDevelopmentVerificationSessionArtifactV2;
  containerReceipt: TrustedRuntimeContainerReceiptV1;
}>): TrustedRuntimeActionBundleV1 {
  const artifact = CodexDevelopmentParseVerificationSessionArtifactV2(
    encodeVerificationActionDataV2(input.artifact)
  );
  const receipt = parseTrustedRuntimeContainerReceiptV1(input.containerReceipt);
  if (artifact.session.sessionRevision !== receipt.sessionRevision
      || artifact.session.baseSha !== receipt.baseSha
      || artifact.session.headSha !== receipt.headSha
      || artifact.session.headTreeSha !== receipt.headTreeSha
      || artifact.evidence.evidenceDigest !== receipt.evidenceDigest
      || artifact.producer.sourceDigest !== receipt.producerSourceDigest) {
    fail('Action bundle artifact and container receipt differ');
  }
  const withoutDigest = Object.freeze({
    schema: TRUSTED_RUNTIME_ACTION_BUNDLE_SCHEMA_V1,
    sessionRevision: artifact.session.sessionRevision as Digest,
    actionPlanDigest: artifact.evidence.actionPlan.actionPlanDigest as Digest,
    artifact,
    containerReceipt: receipt
  });
  return Object.freeze({ ...withoutDigest, bundleDigest: hash(withoutDigest) });
}

function parseActionBundle(source: Uint8Array): TrustedRuntimeActionBundleV1 {
  const text = Buffer.from(source).toString('utf8');
  const value = JSON.parse(text) as Record<string, unknown>;
  const expected = [
    'schema', 'sessionRevision', 'actionPlanDigest', 'artifact', 'containerReceipt', 'bundleDigest'
  ].sort();
  if (Object.keys(value).sort().join(',') !== expected.join(',')
      || value.schema !== TRUSTED_RUNTIME_ACTION_BUNDLE_SCHEMA_V1) {
    fail('Action bundle shape is invalid');
  }
  const rebuilt = createActionBundle({
    artifact: CodexDevelopmentParseVerificationSessionArtifactV2(
      encodeVerificationActionDataV2(value.artifact)
    ),
    containerReceipt: parseTrustedRuntimeContainerReceiptV1(value.containerReceipt)
  });
  if (value.sessionRevision !== rebuilt.sessionRevision
      || value.actionPlanDigest !== rebuilt.actionPlanDigest
      || value.bundleDigest !== rebuilt.bundleDigest
      || text !== `${encodeVerificationActionDataV2(rebuilt)}\n`) {
    fail('Action bundle digest or canonical bytes mismatch');
  }
  return rebuilt;
}

function publishCanonical<T>(input: Readonly<{
  parent: PhysicalDirectoryIdentityV1;
  name: string;
  value: T;
  parse: (source: Uint8Array) => T;
}>): T {
  const bytes = canonicalBytes(input.value);
  publishExclusiveDurableCanonicalFileV1({
    parent: input.parent,
    name: input.name,
    bytes,
    validate: (candidate) => {
      const parsed = input.parse(candidate);
      if (encodeVerificationActionDataV2(parsed) !== encodeVerificationActionDataV2(input.value)) {
        fail(`durable ${input.name} semantic readback mismatch`);
      }
    }
  });
  const readback = readNoFollowOrdinaryFileV1(input.parent, input.name);
  if (readback === null) fail(`durable ${input.name} disappeared`);
  return input.parse(readback);
}

function readCanonical<T>(input: Readonly<{
  parent: PhysicalDirectoryIdentityV1;
  name: string;
  parse: (source: Uint8Array) => T;
}>): T {
  const bytes = readNoFollowOrdinaryFileV1(input.parent, input.name);
  if (bytes === null) fail(`durable ${input.name} is unavailable`);
  const value = input.parse(bytes);
  if (!Buffer.from(bytes).equals(Buffer.from(canonicalBytes(value)))) {
    fail(`durable ${input.name} bytes are not canonical`);
  }
  return value;
}

export async function ensureTrustedRuntimeMainHealthReceiptV1(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  mainSha: string;
  mainTreeSha: string;
  runtimeStateEnvironment?: NodeJS.ProcessEnv;
  execute?: typeof executeTrustedRuntimeMainHealthV1;
}>): Promise<Readonly<{
  receipt: TrustedRuntimeMainHealthReceiptV1;
  reused: boolean;
  authority: SecRuntimeStatePhysicalAuthorityV1;
  directory: PhysicalDirectoryIdentityV1;
}>> {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const runtimeLayout = resolveSecRuntimeStateForRepositoryV1({
    repository: input.repository,
    repositoryRoot,
    ...(input.runtimeStateEnvironment === undefined
      ? {}
      : { environment: input.runtimeStateEnvironment })
  });
  const mainHealthRoot = path.join(
    runtimeLayout.repositoryStateRoot,
    'trusted-main-health',
    'v1'
  );
  const authority = await acquireSecRuntimeStatePhysicalAuthorityV1({
    repositoryRoot,
    stateRoot: runtimeLayout.stateRoot,
    cacheRoot: runtimeLayout.cacheRoot,
    requiredDirectories: [mainHealthRoot]
  });
  const directory = authority.directory(mainHealthRoot);
  const ensured = await ensureTrustedRuntimeMainHealthReceiptInDirectoryV1({
    directory,
    repository: input.repository,
    mainSha: input.mainSha,
    mainTreeSha: input.mainTreeSha,
    execute: async () => await (input.execute ?? executeTrustedRuntimeMainHealthV1)({
      repositoryRoot,
      repository: input.repository,
      mainSha: input.mainSha,
      mainTreeSha: input.mainTreeSha
    })
  });
  await authority.assertCurrent();
  return Object.freeze({ ...ensured, authority, directory });
}

export async function ensureTrustedRuntimeMainHealthReceiptInDirectoryV1(input: Readonly<{
  directory: PhysicalDirectoryIdentityV1;
  repository: string;
  mainSha: string;
  mainTreeSha: string;
  execute: () => Promise<TrustedRuntimeMainHealthReceiptV1>;
}>): Promise<Readonly<{
  receipt: TrustedRuntimeMainHealthReceiptV1;
  reused: boolean;
}>> {
  const mainSha = gitSha(input.mainSha, 'MainHealth mainSha');
  const mainTreeSha = gitSha(input.mainTreeSha, 'MainHealth mainTreeSha');
  const name = `main-${mainSha}.json`;
  const existing = readNoFollowOrdinaryFileV1(input.directory, name);
  let receipt: TrustedRuntimeMainHealthReceiptV1;
  let reused: boolean;
  if (existing === null) {
    receipt = publishCanonical({
      parent: input.directory,
      name,
      value: await input.execute(),
      parse: (bytes) => parseTrustedRuntimeMainHealthReceiptV1(
        Buffer.from(bytes).toString('utf8')
      )
    });
    reused = false;
  } else {
    const source = Buffer.from(existing).toString('utf8');
    receipt = parseTrustedRuntimeMainHealthReceiptV1(source);
    if (source !== `${encodeVerificationActionDataV2(receipt)}\n`) {
      fail('durable local MainHealth receipt bytes are not canonical');
    }
    reused = true;
  }
  if (receipt.repository !== input.repository
      || receipt.mainSha !== mainSha
      || receipt.mainTreeSha !== mainTreeSha) {
    fail('durable local MainHealth receipt differs from the exact live main');
  }
  return Object.freeze({ receipt, reused });
}

export async function ensureCurrentTrustedRuntimeMainHealthV1(input: Readonly<{
  repositoryRoot: string;
  repository: string;
}>): Promise<Readonly<{
  schema: 'sec-trusted-runtime-main-health-publication-v1';
  repository: string;
  mainSha: string;
  mainTreeSha: string;
  receiptDigest: Digest;
  executionId: string;
  reused: boolean;
}>> {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const [branch, headSha, mainTreeSha, status, originUrl, liveDefault] = await Promise.all([
    tool('git', ['branch', '--show-current'], repositoryRoot),
    tool('git', ['rev-parse', 'HEAD'], repositoryRoot),
    tool('git', ['rev-parse', 'HEAD^{tree}'], repositoryRoot),
    tool('git', ['status', '--porcelain=v1', '--untracked-files=all'], repositoryRoot),
    tool('git', ['remote', 'get-url', 'origin'], repositoryRoot),
    tool('git', ['ls-remote', '--exit-code', 'origin', 'refs/heads/main'], repositoryRoot)
  ]);
  const escapedRepository = input.repository.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  if (!new RegExp(
    `^(?:https://github\\.com/|git@github\\.com:|ssh://git@github\\.com/)${escapedRepository}(?:\\.git)?$`,
    'u'
  ).test(originUrl)) {
    fail('origin remote does not match the requested GitHub repository');
  }
  const liveMatch = /^([0-9a-f]{40})\trefs\/heads\/main$/u.exec(liveDefault);
  if (branch !== 'main' || status !== '' || liveMatch?.[1] !== headSha) {
    fail('standalone MainHealth must execute from the clean exact default-branch worktree');
  }
  const ensured = await ensureTrustedRuntimeMainHealthReceiptV1({
    repositoryRoot,
    repository: input.repository,
    mainSha: headSha,
    mainTreeSha
  });
  return Object.freeze({
    schema: 'sec-trusted-runtime-main-health-publication-v1',
    repository: input.repository,
    mainSha: headSha,
    mainTreeSha,
    receiptDigest: ensured.receipt.receiptDigest,
    executionId: ensured.receipt.executionId,
    reused: ensured.reused
  });
}

async function postReviewWakeup(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  prNumber: number;
  sessionRevision: Digest;
  requestOperationId: Digest;
  headSha: string;
  headTreeSha: string;
  publisherLogin: string;
  publisherNodeId: string;
}>): Promise<Readonly<{ status: 'published' | 'reused'; commentId: string }>> {
  const github = createVerificationSessionGitHubClientV1(input.repositoryRoot);
  const operationId = hash(Object.freeze({
    schema: 'sec-trusted-runtime-review-wakeup-operation-v1',
    sessionRevision: input.sessionRevision,
    headSha: input.headSha
  }));
  const identity = { ...input, operationId };
  let observation = github.observeMaintainerReviewWakeup(identity);
  if (observation.status === 'absent') {
    const response = JSON.parse(await tool('gh', [
      'api', '-X', 'POST', `/repos/${input.repository}/issues/${input.prNumber}/comments`,
      '-f', `body=${observation.body}`
    ], input.repositoryRoot)) as Record<string, unknown>;
    if (!Number.isSafeInteger(response.id) || Number(response.id) < 1) {
      fail('Review wake-up POST response has no comment id');
    }
    observation = github.observeMaintainerReviewWakeup(identity);
    if (observation.status !== 'reused' || observation.commentId !== String(response.id)) {
      fail('Review wake-up exact readback is ambiguous');
    }
    return Object.freeze({ status: 'published', commentId: observation.commentId });
  }
  if (observation.commentId === null) fail('Review wake-up reuse has no comment id');
  return Object.freeze({ status: 'reused', commentId: observation.commentId });
}

async function mergeExactHead(input: Readonly<{
  repository: string;
  prNumber: number;
  headSha: string;
  title: string;
  message: string;
  token: string;
}>): Promise<ReturnType<typeof parseHostedSynchronousSquashMergeResponseV1>> {
  const response = await dispatchGitHubApiRequestV1(
    `https://api.github.com/repos/${input.repository}/pulls/${input.prNumber}/merge`, {
    method: 'PUT',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${input.token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'sec-trusted-runtime-closeout-v1',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    body: JSON.stringify({
      sha: input.headSha,
      merge_method: 'squash',
      commit_title: input.title,
      commit_message: input.message
    })
    }
  );
  const source = await response.text();
  if (!response.ok) fail(`exact-head merge failed with HTTP ${response.status}: ${source.slice(-2048)}`);
  return parseHostedSynchronousSquashMergeResponseV1(source);
}

async function finalizeMergedTrustedRuntimeV1(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  prNumber: number;
  github: VerificationSessionGitHubClientV1;
  candidate: GitHubCandidateObservationV1;
  actionBundle: TrustedRuntimeActionBundleV1;
  gateReadback: ReturnType<typeof CodexDevelopmentParseTrustedRuntimeMergeGateResultV1>;
  statusReadback: ReturnType<typeof parseIntegrationAuthorizationStatusPublicationV1>;
  mainHealthAuthority: Awaited<ReturnType<typeof acquireSecRuntimeStatePhysicalAuthorityV1>>;
  mainHealthDirectory: PhysicalDirectoryIdentityV1;
  providerMergeCommitSha: string | null;
  actionEvidenceReused: boolean;
}>): Promise<unknown> {
  const { candidate, actionBundle, gateReadback, statusReadback } = input;
  const artifact = actionBundle.artifact;
  if (candidate.state !== 'MERGED' || candidate.mergeCommitSha === null
      || candidate.mergeCommitTreeSha === null || candidate.mergeCommitMessage === null) {
    fail('post-merge finalization requires one exact merged candidate');
  }
  if (candidate.repository !== input.repository || candidate.number !== input.prNumber
      || artifact.session.repository !== input.repository
      || artifact.session.prNumber !== input.prNumber
      || artifact.session.baseSha !== candidate.baseSha
      || artifact.session.baseTreeSha !== candidate.baseTreeSha
      || artifact.session.headSha !== candidate.headSha
      || artifact.session.headTreeSha !== candidate.headTreeSha
      || actionBundle.sessionRevision !== artifact.session.sessionRevision) {
    fail('merged candidate differs from its durable trusted-runtime Session');
  }
  const manifestSource = input.github.readBlobText(
    input.repository,
    candidate.headSha,
    artifact.session.manifestPath
  );
  if (CodexDevelopmentWorkPackageManifestDigest(manifestSource)
      !== artifact.session.manifestDigest) {
    fail('merged candidate Work Package bytes differ from the durable Session');
  }
  const manifest = CodexDevelopmentParseWorkPackageManifest(
    manifestSource,
    artifact.session.manifestPath
  );
  const disposition = observeExactIssueDispositionPlanV1({
    github: input.github,
    repository: input.repository,
    candidate,
    manifestPath: artifact.session.manifestPath,
    manifestDigest: artifact.session.manifestDigest,
    tracking: manifest.tracking
  });
  const authorizationMarkers = integrationAuthorizationStatusMergeMarkersV1({
    result: gateReadback,
    publication: statusReadback
  });
  const issueMarkers = [
    `Issue-Disposition-Plan: ${disposition.planDigest}`,
    `Issue-Disposition-Mode: ${disposition.mode}`,
    `Issue-Disposition-Tracking: ${disposition.trackingIssueNumber ?? 'none'}`,
    `Issue-Disposition-Prose: ${disposition.titleBodyDigest}`
  ];
  const mergeMarkers = [...authorizationMarkers, ...issueMarkers];
  const title = `Verified integration ${artifact.session.sessionRevision.slice(7, 19)}`;
  assertHostedSquashMergeCompletionV1({
    candidate,
    expectedHeadSha: artifact.session.headSha,
    expectedHeadTreeSha: artifact.session.headTreeSha,
    markers: mergeMarkers,
    reviewReceipt: gateReadback.reviewReceipt,
    expectedTitle: title,
    providerMergeCommitSha: input.providerMergeCommitSha
  });
  const issueReconciliation = observePostMergeIssueReconciliationV1({
    repository: input.repository,
    prNumber: input.prNumber,
    candidate
  });
  if (issueReconciliation.status !== 'no-op') {
    fail(`external-maintainer-action-required: post-merge IssueDisposition is ${String(
      issueReconciliation.status
    )}`);
  }

  const remoteMain = await tool('git', [
    'ls-remote', '--heads', 'origin', 'refs/heads/main'
  ], input.repositoryRoot);
  const remoteMainMatch = /^([0-9a-f]{40})\trefs\/heads\/main$/u.exec(remoteMain);
  if (remoteMainMatch?.[1] !== candidate.mergeCommitSha) {
    fail('remote main does not equal the physical merge commit');
  }
  await tool('git', [
    'fetch', '--no-tags', 'origin',
    '+refs/heads/main:refs/remotes/origin/main'
  ], input.repositoryRoot);
  const remoteMainTree = await tool('git', [
    'rev-parse', 'refs/remotes/origin/main^{tree}'
  ], input.repositoryRoot);
  if (remoteMainTree !== candidate.headTreeSha
      || remoteMainTree !== candidate.mergeCommitTreeSha) {
    fail('remote main tree does not equal the verified candidate tree');
  }
  const requiredMainHealthActions = ['imports', 'typecheck', 'docs-doctor', 'full-fast'] as const;
  if (artifact.evidence.profile !== 'full' || artifact.evidence.status !== 'passed') {
    fail('new-main health transition requires full passing candidate Evidence');
  }
  const commandResultDigests = requiredMainHealthActions.map((gateId) => {
    const matching = artifact.evidence.gates.filter(({ action }) =>
      action.operation.identity === gateId);
    if (matching.length !== 1 || matching[0]!.result.status !== 'passed') {
      fail(`new-main health transition lacks one passing ${gateId} Action`);
    }
    return matching[0]!.action.actionKey as Digest;
  });
  const nextMainHealth = createTrustedRuntimeMainHealthReceiptV1({
    origin: 'verified-candidate-transition',
    repository: input.repository,
    mainSha: candidate.mergeCommitSha,
    mainTreeSha: candidate.mergeCommitTreeSha,
    executionId: actionBundle.containerReceipt.executionId,
    imageId: actionBundle.containerReceipt.imageId,
    dockerEndpoint: actionBundle.containerReceipt.dockerEndpoint,
    networkIsolatedBeforeExecution: true,
    planDigest: TRUSTED_RUNTIME_MAIN_HEALTH_PLAN_DIGEST_V1,
    commandResultDigests,
    transition: {
      candidateHeadSha: candidate.headSha,
      candidateHeadTreeSha: candidate.headTreeSha,
      sessionRevision: artifact.session.sessionRevision as Digest,
      verificationEvidenceDigest: artifact.evidence.evidenceDigest as Digest,
      containerReceiptDigest: actionBundle.containerReceipt.receiptDigest,
      mergeGateResultDigest: gateReadback.resultDigest,
      statusPublicationDigest: statusReadback.publicationDigest
    },
    observedAt: new Date().toISOString()
  });
  await input.mainHealthAuthority.assertCurrent();
  const nextMainHealthReadback = publishCanonical({
    parent: input.mainHealthDirectory,
    name: `main-${candidate.mergeCommitSha}.json`,
    value: nextMainHealth,
    parse: (bytes) => parseTrustedRuntimeMainHealthReceiptV1(
      Buffer.from(bytes).toString('utf8')
    )
  });
  return Object.freeze({
    status: 'MERGED',
    provider: 'sec-trusted-runtime',
    sessionRevision: artifact.session.sessionRevision,
    actionEvidenceReused: input.actionEvidenceReused,
    gateResultDigest: gateReadback.resultDigest,
    statusPublicationDigest: statusReadback.publicationDigest,
    mergeCommitSha: candidate.mergeCommitSha,
    mergeCommitTreeSha: candidate.mergeCommitTreeSha,
    nextMainHealthReceiptDigest: nextMainHealthReadback.receiptDigest,
    platformEnforcement: gateReadback.platformObservation.status,
    claimsNoBypassEnforcement: false
  });
}

async function recoverMergedTrustedRuntimeV1(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  prNumber: number;
  github: VerificationSessionGitHubClientV1;
  candidate: GitHubCandidateObservationV1;
}>): Promise<unknown> {
  await assertTrustedMergedRecoveryRuntime(input.repositoryRoot, input.candidate);
  if (input.candidate.mergeCommitMessage === null) {
    fail('merged recovery has no merge message locator');
  }
  const sessionRevision = digest(
    readExactCommitMarkerV1(input.candidate.mergeCommitMessage, 'Verification-Session'),
    'merged recovery session revision'
  );
  const gateResultDigest = digest(
    readExactCommitMarkerV1(input.candidate.mergeCommitMessage, 'Merge-Gate-Result'),
    'merged recovery Gate result digest'
  );
  const statusPublicationDigest = digest(
    readExactCommitMarkerV1(
      input.candidate.mergeCommitMessage,
      'Integration-Authorization-Status-Publication'
    ),
    'merged recovery status publication digest'
  );
  const runtimeLayout = resolveSecRuntimeStateForRepositoryV1({
    repository: input.repository,
    repositoryRoot: input.repositoryRoot
  });
  const mainHealthRoot = path.join(runtimeLayout.repositoryStateRoot, 'trusted-main-health', 'v1');
  const sessionRoot = path.join(
    runtimeLayout.repositoryStateRoot,
    'trusted-runtime',
    'v1',
    sessionRevision.slice(7)
  );
  const authority = await acquireSecRuntimeStatePhysicalAuthorityV1({
    repositoryRoot: input.repositoryRoot,
    stateRoot: runtimeLayout.stateRoot,
    cacheRoot: runtimeLayout.cacheRoot,
    requiredDirectories: [mainHealthRoot, sessionRoot]
  });
  const stateDirectory = authority.directory(sessionRoot);
  const mainHealthDirectory = authority.directory(mainHealthRoot);
  const actionBundle = readCanonical({
    parent: stateDirectory,
    name: 'verification-action.json',
    parse: parseActionBundle
  });
  const gateReadback = readCanonical({
    parent: stateDirectory,
    name: `merge-gate-${gateResultDigest.slice(7)}.json`,
    parse: (bytes) => CodexDevelopmentParseTrustedRuntimeMergeGateResultV1(
      Buffer.from(bytes).toString('utf8')
    )
  });
  const statusReadback = readCanonical({
    parent: stateDirectory,
    name: `status-${statusPublicationDigest.slice(7)}.json`,
    parse: (bytes) => parseIntegrationAuthorizationStatusPublicationV1(
      Buffer.from(bytes).toString('utf8')
    )
  });
  if (actionBundle.sessionRevision !== sessionRevision
      || gateReadback.resultDigest !== gateResultDigest
      || statusReadback.publicationDigest !== statusPublicationDigest) {
    fail('merged recovery locators differ from the durable canonical artifacts');
  }
  return finalizeMergedTrustedRuntimeV1({
    ...input,
    actionBundle,
    gateReadback,
    statusReadback,
    mainHealthAuthority: authority,
    mainHealthDirectory,
    providerMergeCommitSha: null,
    actionEvidenceReused: true
  });
}

export async function closeoutWithTrustedRuntimeV1(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  prNumber: number;
}>): Promise<unknown> {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const github = createVerificationSessionGitHubClientV1(repositoryRoot);
  const candidate = github.observeCandidate(input.repository, input.prNumber);
  if (candidate.state === 'MERGED') {
    return recoverMergedTrustedRuntimeV1({
      repositoryRoot,
      repository: input.repository,
      prNumber: input.prNumber,
      github,
      candidate
    });
  }
  if (candidate.state !== 'OPEN' || candidate.isDraft || candidate.isCrossRepository) {
    fail('candidate must be one open same-repository non-draft PR');
  }
  await assertTrustedBaseRuntime(repositoryRoot, candidate);
  const comparison = github.observeComparison(input.repository, candidate.baseSha, candidate.headSha);
  const openCount = github.observeOpenPullRequestCountForHead(input.repository, candidate.headSha);
  if (comparison.status !== 'ahead' || comparison.behindBy !== 0 || openCount !== 1) {
    fail('candidate ancestry or same-head PR identity is not exact');
  }
  const manifestPath = CodexDevelopmentParseWorkPackageLocator(candidate.body);
  const manifestSource = github.readBlobText(input.repository, candidate.headSha, manifestPath);
  const manifestDigest = CodexDevelopmentWorkPackageManifestDigest(manifestSource) as Digest;
  const manifest = CodexDevelopmentParseWorkPackageManifest(manifestSource, manifestPath);
  const changed = observeVerificationSessionChangedSelectionV1({ repositoryRoot,
    repository: input.repository, prNumber: input.prNumber, candidate, github });
  CodexDevelopmentAssertWorkPackageOwnership(manifest, [...changed.changedPaths]);
  const dependencyBlobs = observeVerificationSessionActionDependencyBlobsV2({ github,
    repository: input.repository, baseSha: candidate.baseSha, headSha: candidate.headSha });
  const principal = github.observeViewerPrincipal(input.repository);
  if (principal.permission !== 'admin' && principal.permission !== 'maintain') {
    fail('current principal lacks maintain/admin permission');
  }
  const reviewBarrier = github.observeReviewBarrier({ repository: input.repository,
    prNumber: input.prNumber, headSha: candidate.headSha,
    excludedPrincipalNodeIds: new Set([candidate.authorNodeId, principal.nodeId]) });
  const observedAt = new Date().toISOString();
  const runtimeRef = `${CodexDevelopmentMergeGateProducerIdentityV2}@${candidate.baseSha}`;
  const runtimeLayout = resolveSecRuntimeStateForRepositoryV1({
    repository: input.repository,
    repositoryRoot
  });
  const mainHealthRoot = path.join(
    runtimeLayout.repositoryStateRoot,
    'trusted-main-health',
    'v1'
  );
  const ensuredMainHealth = await ensureTrustedRuntimeMainHealthReceiptV1({
    repositoryRoot,
    repository: input.repository,
    mainSha: candidate.baseSha,
    mainTreeSha: candidate.baseTreeSha
  });
  const mainHealthReceipt = ensuredMainHealth.receipt;
  const mainHealthAuthority = ensuredMainHealth.authority;
  const mainHealthDirectory = ensuredMainHealth.directory;
  const mainHealthInput = createTrustedLocalMainHealthInputV1({
    schema: 'sec-trusted-local-main-health-observation-v1',
    repository: input.repository,
    mainSha: candidate.baseSha,
    mainTreeSha: candidate.baseTreeSha,
    trustRevision: candidate.baseSha,
    runtimeRef,
    executionId: mainHealthReceipt.executionId,
    verificationReceiptDigest: mainHealthReceipt.receiptDigest,
    observedAt,
    expiresAt: new Date(
      Date.parse(observedAt) + TRUSTED_LOCAL_MAIN_HEALTH_FRESHNESS_MS_V1
    ).toISOString()
  });
  const preparationInput = {
    repository: input.repository,
    candidate,
    manifestPath,
    manifestDigest,
    changedPaths: changed.changedPaths,
    testImpactTransition: changed.testImpactTransition,
    profile: manifest.requiredProfile,
    integrationPrincipalNodeId: principal.nodeId,
    producerPrincipalNodeId: principal.nodeId,
    sourceRunId: `trusted-runtime-${candidate.headSha.slice(0, 16)}`,
    sourceRef: runtimeRef,
    observedAt,
    reviewBarrier,
    mainHealthChecks: Object.freeze([]),
    dependencyBlobs,
    executionEnvironment: TRUSTED_RUNTIME_CONTAINER_EXECUTION_ENVIRONMENT_V1,
    mainHealthInput
  } as const;
  const planning = prepareTrustedMainVerificationSessionV1(preparationInput);
  if (reviewBarrier.status !== 'clear') {
    const wakeup = await postReviewWakeup({
      repositoryRoot,
      repository: input.repository,
      prNumber: input.prNumber,
      sessionRevision: planning.sessionRevision,
      requestOperationId: planning.request.requestOperationId,
      headSha: candidate.headSha,
      headTreeSha: candidate.headTreeSha,
      publisherLogin: principal.login,
      publisherNodeId: principal.nodeId
    });
    return Object.freeze({
      status: 'WAITING_REVIEW',
      sessionRevision: planning.sessionRevision,
      reviewWakeup: wakeup,
      reason: reviewBarrier.status === 'provider-schema-unsupported'
        ? reviewBarrier.reasonCode
        : reviewBarrier.reason
    });
  }
  const prepared = prepareTrustedRuntimeVerificationSessionV1(preparationInput);
  const envelope = prepared.envelope;
  const sessionRoot = path.join(runtimeLayout.repositoryStateRoot, 'trusted-runtime', 'v1',
    envelope.session.sessionRevision.slice(7));
  const authority = await acquireSecRuntimeStatePhysicalAuthorityV1({
    repositoryRoot,
    stateRoot: runtimeLayout.stateRoot,
    cacheRoot: runtimeLayout.cacheRoot,
    requiredDirectories: [mainHealthRoot, sessionRoot]
  });
  const stateDirectory = authority.directory(sessionRoot);
  const actionFile = 'verification-action.json';
  const existingAction = readNoFollowOrdinaryFileV1(stateDirectory, actionFile);
  let actionBundle: TrustedRuntimeActionBundleV1;
  if (existingAction === null) {
    const requiredBlobs = dependencyBlobs.map(({ path: dependencyPath, candidateSource }) => Object.freeze({
      path: dependencyPath,
      digest: `sha256:${createHash('sha256').update(candidateSource).digest('hex')}` as Digest
    }));
    const executed = await executeTrustedRuntimeContainerVerificationV1({
      repositoryRoot,
      envelope,
      actorNodeId: principal.nodeId,
      requiredBlobs
    });
    const artifact = finalizeVerificationSessionHostedArtifactV2({
      envelope,
      evidence: executed.evidence
    });
    actionBundle = publishCanonical({ parent: stateDirectory, name: actionFile,
      value: createActionBundle({ artifact, containerReceipt: executed.receipt }),
      parse: parseActionBundle });
  } else {
    actionBundle = parseActionBundle(existingAction);
    if (actionBundle.sessionRevision !== envelope.session.sessionRevision
        || actionBundle.actionPlanDigest !== envelope.actionPlanClosure.actionPlanDigest) {
      fail('durable Action evidence belongs to another Session or Action plan');
    }
  }
  const artifact = refreshVerificationSessionHostedArtifactV2({
    envelope,
    previousArtifact: actionBundle.artifact,
    producer: actionBundle.artifact.producer,
    refreshedAt: observedAt
  });
  const artifactText = `${encodeVerificationActionDataV2(artifact)}\n`;
  publishCanonical({
    parent: stateDirectory,
    name: `artifact-${artifact.artifactDigest.slice(7)}.json`,
    value: artifact,
    parse: (bytes) => CodexDevelopmentParseVerificationSessionArtifactV2(
      Buffer.from(bytes).toString('utf8')
    )
  });
  const freshCandidate = github.observeCandidate(input.repository, input.prNumber);
  if (freshCandidate.headSha !== candidate.headSha || freshCandidate.baseSha !== candidate.baseSha
      || freshCandidate.state !== 'OPEN') fail('candidate drifted after durable Verification');
  const preMergeBarrier = github.observeReviewBarrier({ repository: input.repository,
    prNumber: input.prNumber, headSha: candidate.headSha,
    excludedPrincipalNodeIds: new Set([candidate.authorNodeId, principal.nodeId]) });
  if (preMergeBarrier.status !== 'clear') {
    return Object.freeze({ status: 'WAITING_REVIEW', sessionRevision: envelope.session.sessionRevision,
      reason: preMergeBarrier.status === 'provider-schema-unsupported'
        ? preMergeBarrier.reasonCode : preMergeBarrier.reason });
  }
  const issuedAt = preMergeBarrier.observedAt;
  const preMergeReview = createVerificationSessionReviewReceiptV1({
    stage: 'pre-merge',
    session: artifact.session,
    scope: artifact.scopeAuthorization,
    barrier: preMergeBarrier,
    candidateAuthorNodeId: candidate.authorNodeId,
    integrationPrincipalNodeId: principal.nodeId,
    expiresAt: new Date(Date.parse(issuedAt) + 5 * 60_000).toISOString(),
    operationId: hash({ schema: 'sec-trusted-runtime-pre-merge-review-v1',
      sessionRevision: artifact.session.sessionRevision,
      snapshotDigest: preMergeBarrier.snapshot.snapshotDigest })
  });
  const freshMainHealth = createMainHealthLedgerV1(createTrustedLocalMainHealthInputV1({
    schema: 'sec-trusted-local-main-health-observation-v1',
    repository: input.repository,
    mainSha: candidate.baseSha,
    mainTreeSha: candidate.baseTreeSha,
    trustRevision: candidate.baseSha,
    runtimeRef,
    executionId: mainHealthReceipt.executionId,
    verificationReceiptDigest: mainHealthReceipt.receiptDigest,
    observedAt: issuedAt,
    expiresAt: new Date(Date.parse(issuedAt) + 5 * 60_000).toISOString()
  }));
  const artifactObservation = createTrustedRuntimeArtifactObservationFromDurableFileV1({
    artifact,
    artifactText,
    runtimeSha: candidate.baseSha,
    executionId: actionBundle.containerReceipt.executionId
  });
  const consumptionOperationId = createVerificationSessionMergeOperationIdV1({
    sessionRevision: artifact.session.sessionRevision,
    headSha: candidate.headSha,
    actionPlanDigest: artifact.evidence.actionPlan.actionPlanDigest
  });
  const platform = github.observePlatformEnforcement(input.repository);
  const gateInput = prepareVerificationSessionTrustedRuntimeMergeInputV1({
    artifact,
    preMergeReview,
    platform,
    candidate: {
      repository: input.repository,
      prNumber: input.prNumber,
      draft: false,
      headOpenPullRequestCount: 1,
      currentBaseSha: candidate.baseSha,
      currentBaseTreeSha: candidate.baseTreeSha,
      headSha: candidate.headSha,
      headTreeSha: candidate.headTreeSha,
      baseIsAncestor: true,
      behindBy: 0,
      manifestPath,
      manifestDigest,
      changedPaths: changed.changedPaths
    },
    artifactObservation,
    provenance: {
      runtimePath: CodexDevelopmentMergeGateProducerIdentityV2,
      runtimeRef,
      runtimeSha: candidate.baseSha,
      executionId: actionBundle.containerReceipt.executionId,
      actorNodeId: principal.nodeId,
      actorPermission: principal.permission
    },
    mainHealth: freshMainHealth,
    consumptionOperationId,
    issuedAt,
    expiresAt: new Date(Date.parse(issuedAt) + 5 * 60_000).toISOString()
  });
  const gate = CodexDevelopmentEvaluateTrustedRuntimeMergeGateV1(gateInput);
  const gateReadback = publishCanonical({
    parent: stateDirectory,
    name: `merge-gate-${gate.resultDigest.slice(7)}.json`,
    value: gate,
    parse: (bytes) => CodexDevelopmentParseTrustedRuntimeMergeGateResultV1(
      Buffer.from(bytes).toString('utf8')
    )
  });
  const token = await tool('gh', ['auth', 'token'], repositoryRoot, true);
  const viewer = JSON.parse(await tool('gh', ['api', 'user'], repositoryRoot)) as Record<string, unknown>;
  if (viewer.login !== principal.login || !Number.isSafeInteger(viewer.id) || Number(viewer.id) < 1) {
    fail('GitHub token principal differs from the observed maintainer');
  }
  const publication = await publishIntegrationAuthorizationStatusV1({
    result: gateReadback,
    token,
    targetUrl: `https://github.com/${input.repository}/pull/${input.prNumber}`,
    principal: { creatorLogin: principal.login, creatorId: Number(viewer.id) },
    fetchImpl: dispatchGitHubApiRequestV1
  });
  const statusReadback = publishCanonical({
    parent: stateDirectory,
    name: `status-${publication.publicationDigest.slice(7)}.json`,
    value: publication,
    parse: (bytes) => parseIntegrationAuthorizationStatusPublicationV1(
      Buffer.from(bytes).toString('utf8')
    )
  });
  const disposition = observeExactIssueDispositionPlanV1({
    github,
    repository: input.repository,
    candidate,
    manifestPath,
    manifestDigest,
    tracking: manifest.tracking
  });
  const authorizationMarkers = integrationAuthorizationStatusMergeMarkersV1({
    result: gateReadback,
    publication: statusReadback
  });
  const issueMarkers = [
    `Issue-Disposition-Plan: ${disposition.planDigest}`,
    `Issue-Disposition-Mode: ${disposition.mode}`,
    `Issue-Disposition-Tracking: ${disposition.trackingIssueNumber ?? 'none'}`,
    `Issue-Disposition-Prose: ${disposition.titleBodyDigest}`
  ];
  const mergeMarkers = [...authorizationMarkers, ...issueMarkers];
  const title = `Verified integration ${artifact.session.sessionRevision.slice(7, 19)}`;
  const message = [...mergeMarkers, renderIndependentReviewTrailerV1(gateReadback.reviewReceipt)].join('\n');
  if (parseGitHubClosingKeywordOccurrencesV1(`${title}\n${message}`, input.repository).length > 0) {
    fail('canonical merge message contains a forbidden closing keyword');
  }
  const platformBeforeMerge = github.observePlatformEnforcement(input.repository);
  const liveBeforeMerge = github.observeCandidate(input.repository, input.prNumber);
  if (platformBeforeMerge.status !== gateReadback.platformObservation.status
      || platformBeforeMerge.rulesetDigest !== gateReadback.platformObservation.rulesetDigest
      || platformBeforeMerge.reason !== gateReadback.platformObservation.reason
      || liveBeforeMerge.state !== 'OPEN' || liveBeforeMerge.headSha !== candidate.headSha
      || liveBeforeMerge.headTreeSha !== candidate.headTreeSha
      || liveBeforeMerge.baseSha !== candidate.baseSha
      || liveBeforeMerge.baseTreeSha !== candidate.baseTreeSha
      || liveBeforeMerge.isDraft || liveBeforeMerge.isCrossRepository) {
    fail('candidate or platform observation drifted immediately before merge');
  }
  const immediateDisposition = observeExactIssueDispositionPlanV1({
    github,
    repository: input.repository,
    candidate: liveBeforeMerge,
    manifestPath,
    manifestDigest,
    tracking: manifest.tracking
  });
  if (immediateDisposition.planDigest !== disposition.planDigest) {
    fail('IssueDisposition plan drifted immediately before merge');
  }
  let providerMergeCommitSha: string | null = null;
  let mergeFailure: unknown = null;
  try {
    providerMergeCommitSha = (await mergeExactHead({
      repository: input.repository,
      prNumber: input.prNumber,
      headSha: candidate.headSha,
      title,
      message,
      token
    })).sha;
  } catch (error) {
    mergeFailure = error;
  }
  let readback: GitHubCandidateObservationV1;
  try {
    readback = github.observeCandidate(input.repository, input.prNumber);
  } catch (error) {
    const providerReason = mergeFailure instanceof Error
      ? mergeFailure.message
      : mergeFailure === null ? 'provider reported success' : String(mergeFailure);
    const readbackReason = error instanceof Error ? error.message : String(error);
    fail(`AMBIGUOUS_SIDE_EFFECT: merge requires exact retry readback; provider=${providerReason}; readback=${readbackReason}`);
  }
  if (readback.state !== 'MERGED' && mergeFailure !== null) throw mergeFailure;
  if (readback.state !== 'MERGED') {
    fail('AMBIGUOUS_SIDE_EFFECT: provider reported merge success without a merged readback');
  }
  return finalizeMergedTrustedRuntimeV1({
    repositoryRoot,
    repository: input.repository,
    prNumber: input.prNumber,
    github,
    candidate: readback,
    actionBundle,
    gateReadback,
    statusReadback,
    mainHealthAuthority,
    mainHealthDirectory,
    providerMergeCommitSha,
    actionEvidenceReused: existingAction !== null
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const result = args.mode === 'main-health'
    ? await ensureCurrentTrustedRuntimeMainHealthV1({
        repositoryRoot: process.cwd(),
        repository: args.repository
      })
    : await closeoutWithTrustedRuntimeV1({
        repositoryRoot: process.cwd(),
        repository: args.repository,
        prNumber: args.prNumber
      });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (import.meta.main) await main();
