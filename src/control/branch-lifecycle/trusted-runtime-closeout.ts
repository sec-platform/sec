#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import path from 'node:path';

import {
  executeGitHubApiOperation,
  inspectGitHubApiCapability,
  withGitHubApiMergeWriteSession,
  withGitHubApiStatusWriteSession,
  type GitHubApiCapability
} from '../../external-capabilities/github-api/operation-session.ts';
import { publishExclusiveDurableCanonicalFile, readNoFollowOrdinaryFile, type PhysicalDirectoryIdentity } from '../../runtime-state/physical/runtime/physical-no-follow.ts';
import { runCommand } from '../../runtime-state/physical/runtime/process.ts';
import { resolveSecRuntimeStateForRepository } from '../../runtime-state/workspace-state/paths.ts';
import { acquireSecRuntimeStatePhysicalAuthority, type SecRuntimeStatePhysicalAuthority } from '../../runtime-state/workspace-state/physical-authority.ts';
import { encodeVerificationActionData } from '../../verification/action/contract/action.ts';
import { CodexDevelopmentParseVerificationSessionArtifact, type CodexDevelopmentVerificationSessionArtifact } from '../../verification/ci/contract/evidence.ts';
import {
  createVerificationSessionGitHubClient,
  type GitHubCandidateObservation,
  type VerificationSessionGitHubClient
} from '../../verification/ci/runtime/verification-session-github.ts';
import {
  createTrustedRuntimeArtifactObservationFromDurableFile,
  createVerificationSessionMergeOperationId,
  createVerificationSessionReviewReceipt,
  finalizeVerificationSessionHostedArtifact,
  prepareTrustedMainVerificationSession,
  prepareTrustedRuntimeVerificationSession,
  prepareVerificationSessionTrustedRuntimeMergeInput,
  refreshVerificationSessionHostedArtifact
} from '../../verification/ci/runtime/verification-session-runtime.ts';
import {
  assertHostedSquashMergeCompletion,
  observeExactIssueDispositionPlan,
  observePostMergeIssueReconciliation,
  observeVerificationSessionActionDependencyBlobs,
  observeVerificationSessionChangedSelection,
  parseHostedSynchronousSquashMergeResponse,
  readExactCommitMarker
} from '../../verification/ci/runtime/verification-session.ts';
import { renderIndependentReviewTrailer } from '../../verification/review/contract/stability.ts';
import { createTrustedRuntimeHostCommandEnvironment, createTrustedRuntimeMainHealthBaselineObservation, createTrustedRuntimeMainHealthReceipt, executeTrustedRuntimeContainerVerification, executeTrustedRuntimeMainHealth, executeTrustedRuntimeWorkspaceCanary, parseTrustedRuntimeContainerReceipt, parseTrustedRuntimeMainHealthReceipt, TRUSTED_RUNTIME_CONTAINER_EXECUTION_ENVIRONMENT, TRUSTED_RUNTIME_MAIN_HEALTH_PLAN_DIGEST, trustedRuntimeMainHealthCarryForwardBaselineMatches, type TrustedRuntimeContainerReceipt, type TrustedRuntimeMainHealthReceipt } from '../../verification/trusted-runtime/trusted-runtime-container.ts';
import {
  integrationAuthorizationStatusMergeMarkers,
  parseIntegrationAuthorizationStatusPublication,
  publishIntegrationAuthorizationStatus
} from '../integration/integration-authorization-status-github.ts';
import {
  CodexDevelopmentEvaluateTrustedRuntimeMergeGate,
  CodexDevelopmentMergeGateProducerIdentity,
  CodexDevelopmentParseTrustedRuntimeMergeGateResult
} from '../integration/merge-gate.ts';
import {
  parseGitHubClosingKeywordOccurrences
} from '../issues/disposition.ts';
import {
  acquireTrustedRuntimeMainHealthAuthority,
  assertMainHealthGitHubReadOperationBudgetCurrent,
  observeCanonicalMainHealthForPublication,
  observeMainHealthGitHubDefaultBranchSha,
  reconcileCanonicalMainHealthProviderConflict,
  trustedRuntimeMainHealthAuthorityBinding,
  withMainHealthGitHubReadOperationBudget,
  type MainHealthRuntimeAuthority
} from '../main-health/work-selection-main-health.ts';
import {
  CodexDevelopmentAssertWorkPackageOwnership,
  CodexDevelopmentParseCurrentWorkPackageManifest,
  CodexDevelopmentParseWorkPackageLocator,
  CodexDevelopmentWorkPackageManifestDigest
} from '../task/contract/work-package.ts';

const TRUSTED_RUNTIME_ACTION_BUNDLE_SCHEMA =
  'sec-trusted-runtime-action-bundle-v1' as const;
type Digest = `sha256:${string}`;

interface TrustedRuntimeActionBundle {
  readonly schema: typeof TRUSTED_RUNTIME_ACTION_BUNDLE_SCHEMA;
  readonly sessionRevision: Digest;
  readonly actionPlanDigest: Digest;
  readonly artifact: CodexDevelopmentVerificationSessionArtifact;
  readonly containerReceipt: TrustedRuntimeContainerReceipt;
  readonly bundleDigest: Digest;
}

type TrustedRuntimeCloseoutPreMerge = Readonly<{
  kind: 'ready';
  repositoryRoot: string;
  repository: string;
  prNumber: number;
  github: VerificationSessionGitHubClient;
  candidate: GitHubCandidateObservation;
  actionBundle: TrustedRuntimeActionBundle;
  gateReadback: ReturnType<typeof CodexDevelopmentParseTrustedRuntimeMergeGateResult>;
  statusReadback: ReturnType<typeof parseIntegrationAuthorizationStatusPublication>;
  mainHealthAuthority: SecRuntimeStatePhysicalAuthority;
  mainHealthDirectory: PhysicalDirectoryIdentity;
  actionEvidenceReused: boolean;
  integrationPrincipal: Readonly<{ login: string; nodeId: string }>;
  title: string;
  message: string;
  manifestPath: string;
  manifestDigest: Digest;
  disposition: ReturnType<typeof observeExactIssueDispositionPlan>;
}>;

type TrustedRuntimeCloseoutOpenResult =
  | TrustedRuntimeCloseoutPreMerge
  | Readonly<{ kind: 'waiting'; value: unknown }>;

function fail(message: string): never {
  throw new Error(`Trusted runtime closeout: ${message}`);
}

export class TrustedRuntimeControlCliUnavailableError extends Error {
  readonly code = 'trusted-runtime-control-cli-unavailable' as const;

  constructor(
    readonly providerStatus: 'unavailable',
    readonly providerReason: string,
    readonly providerDetailDigest: `sha256:${string}`
  ) {
    super(
      `Trusted runtime Windows control CLI is ${providerStatus}: ${providerReason} `
      + `(${providerDetailDigest})`
    );
    this.name = 'TrustedRuntimeControlCliUnavailableError';
  }
}

/**
 * Trusted closeout already owns hosted GitHub semantics, but its local Git
 * observations/effects have not yet been moved into one opaque Git operation.
 * Physical executable adoption cannot authorize those operations, so Windows
 * remains typed unavailable before any raw or nested CLI client can start.
 */
function assertTrustedRuntimeWindowsControlCliAdmission(repositoryRoot: string): void {
  if (process.platform !== 'win32') return;
  throw new TrustedRuntimeControlCliUnavailableError(
    'unavailable',
    'semantic-session-unavailable',
    hash({
      boundary: 'trusted-runtime-closeout-windows-semantic-session',
      repositoryRoot: path.resolve(repositoryRoot)
    })
  );
}

function hash(value: unknown): Digest {
  return `sha256:${createHash('sha256').update(encodeVerificationActionData(value)).digest('hex')}`;
}

function hashBytes(value: Uint8Array): Digest {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
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
  return Buffer.from(`${encodeVerificationActionData(value)}\n`, 'utf8');
}

type TrustedRuntimeOperatorArgs =
  | Readonly<{ mode: 'closeout'; repository: string; prNumber: number }>
  | Readonly<{ mode: 'main-health'; repository: string }>
  | Readonly<{ mode: 'runtime-canary'; repository: string; dependencies: boolean }>;

function parseArgs(argv: readonly string[]): TrustedRuntimeOperatorArgs {
  const mainHealthCount = argv.filter((argument) => argument === '--main-health').length;
  const runtimeCanaryCount = argv.filter((argument) => argument === '--runtime-canary').length;
  const dependenciesCount = argv.filter((argument) => argument === '--dependencies').length;
  if (mainHealthCount > 1 || runtimeCanaryCount > 1
      || dependenciesCount > 1 || mainHealthCount + runtimeCanaryCount > 1
      || (dependenciesCount === 1 && runtimeCanaryCount !== 1)) {
    fail('trusted runtime operator mode must appear exactly once');
  }
  const normalized = argv.filter((argument) =>
    argument !== '--main-health' && argument !== '--runtime-canary' && argument !== '--dependencies');
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
    fail('usage: bun run sec:closeout -- --pr <n> [--repository owner/name] | bun run sec:main-health | bun run sec:runtime-canary [-- --dependencies]');
  }
  const rawPr = values.get('--pr');
  const repository = values.get('--repository') ?? 'sec-platform/sec';
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)) fail('--repository is invalid');
  if (mainHealthCount === 1) {
    if (rawPr !== undefined) fail('standalone trusted runtime mode cannot be combined with --pr');
    return Object.freeze({ mode: 'main-health', repository });
  }
  if (runtimeCanaryCount === 1) {
    if (rawPr !== undefined) fail('standalone trusted runtime mode cannot be combined with --pr');
    return Object.freeze({ mode: 'runtime-canary', repository, dependencies: dependenciesCount === 1 });
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
  assertTrustedRuntimeWindowsControlCliAdmission(cwd);
  const result = await runCommand(executable, [...args], {
    cwd,
    ...(executable === 'git'
      ? {
          envMode: 'replace' as const,
          env: createTrustedRuntimeHostCommandEnvironment('git')
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
  candidate: GitHubCandidateObservation
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
  candidate: GitHubCandidateObservation
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
  artifact: CodexDevelopmentVerificationSessionArtifact;
  containerReceipt: TrustedRuntimeContainerReceipt;
}>): TrustedRuntimeActionBundle {
  const artifact = CodexDevelopmentParseVerificationSessionArtifact(
    encodeVerificationActionData(input.artifact)
  );
  const receipt = parseTrustedRuntimeContainerReceipt(input.containerReceipt);
  if (artifact.session.sessionRevision !== receipt.sessionRevision
      || artifact.session.baseSha !== receipt.baseSha
      || artifact.session.headSha !== receipt.headSha
      || artifact.session.headTreeSha !== receipt.headTreeSha
      || artifact.evidence.evidenceDigest !== receipt.evidenceDigest
      || artifact.producer.sourceDigest !== receipt.producerSourceDigest) {
    fail('Action bundle artifact and container receipt differ');
  }
  const withoutDigest = Object.freeze({
    schema: TRUSTED_RUNTIME_ACTION_BUNDLE_SCHEMA,
    sessionRevision: artifact.session.sessionRevision as Digest,
    actionPlanDigest: artifact.evidence.actionPlan.actionPlanDigest as Digest,
    artifact,
    containerReceipt: receipt
  });
  return Object.freeze({ ...withoutDigest, bundleDigest: hash(withoutDigest) });
}

function parseActionBundle(source: Uint8Array): TrustedRuntimeActionBundle {
  const text = Buffer.from(source).toString('utf8');
  const value = JSON.parse(text) as Record<string, unknown>;
  const expected = [
    'schema', 'sessionRevision', 'actionPlanDigest', 'artifact', 'containerReceipt', 'bundleDigest'
  ].sort();
  if (Object.keys(value).sort().join(',') !== expected.join(',')
      || value.schema !== TRUSTED_RUNTIME_ACTION_BUNDLE_SCHEMA) {
    fail('Action bundle shape is invalid');
  }
  const rebuilt = createActionBundle({
    artifact: CodexDevelopmentParseVerificationSessionArtifact(
      encodeVerificationActionData(value.artifact)
    ),
    containerReceipt: parseTrustedRuntimeContainerReceipt(value.containerReceipt)
  });
  if (value.sessionRevision !== rebuilt.sessionRevision
      || value.actionPlanDigest !== rebuilt.actionPlanDigest
      || value.bundleDigest !== rebuilt.bundleDigest
      || text !== `${encodeVerificationActionData(rebuilt)}\n`) {
    fail('Action bundle digest or canonical bytes mismatch');
  }
  return rebuilt;
}

function publishCanonical<T>(input: Readonly<{
  parent: PhysicalDirectoryIdentity;
  name: string;
  value: T;
  parse: (source: Uint8Array) => T;
}>): T {
  const bytes = canonicalBytes(input.value);
  publishExclusiveDurableCanonicalFile({
    parent: input.parent,
    name: input.name,
    bytes,
    validate: (candidate) => {
      const parsed = input.parse(candidate);
      if (encodeVerificationActionData(parsed) !== encodeVerificationActionData(input.value)) {
        fail(`durable ${input.name} semantic readback mismatch`);
      }
    }
  });
  const readback = readNoFollowOrdinaryFile(input.parent, input.name);
  if (readback === null) fail(`durable ${input.name} disappeared`);
  return input.parse(readback);
}

function readCanonical<T>(input: Readonly<{
  parent: PhysicalDirectoryIdentity;
  name: string;
  parse: (source: Uint8Array) => T;
}>): T {
  const bytes = readNoFollowOrdinaryFile(input.parent, input.name);
  if (bytes === null) fail(`durable ${input.name} is unavailable`);
  const value = input.parse(bytes);
  if (!Buffer.from(bytes).equals(Buffer.from(canonicalBytes(value)))) {
    fail(`durable ${input.name} bytes are not canonical`);
  }
  return value;
}

export async function ensureTrustedRuntimeMainHealthReceipt(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  mainSha: string;
  mainTreeSha: string;
  runtimeStateEnvironment?: NodeJS.ProcessEnv;
  execute?: typeof executeTrustedRuntimeMainHealth;
}>): Promise<Readonly<{
  receipt: TrustedRuntimeMainHealthReceipt;
  reused: boolean;
  authority: SecRuntimeStatePhysicalAuthority;
  directory: PhysicalDirectoryIdentity;
  mainHealthAuthority: MainHealthRuntimeAuthority;
}>> {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const runtimeLayout = resolveSecRuntimeStateForRepository({
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
  const acquired = await acquireTrustedRuntimeMainHealthAuthority({
    repositoryRoot,
    repository: input.repository,
    environment: input.runtimeStateEnvironment,
    requiredDirectories: [mainHealthRoot]
  });
  const authority = acquired.physicalAuthority;
  const directory = authority.directory(mainHealthRoot);
  const ensured = await ensureTrustedRuntimeMainHealthReceiptInDirectory({
    directory,
    repository: input.repository,
    mainSha: input.mainSha,
    mainTreeSha: input.mainTreeSha,
    execute: async () => await (input.execute ?? executeTrustedRuntimeMainHealth)({
      repositoryRoot,
      repository: input.repository,
      mainSha: input.mainSha,
      mainTreeSha: input.mainTreeSha
    })
  });
  await authority.assertCurrent();
  return Object.freeze({
    ...ensured,
    authority,
    directory,
    mainHealthAuthority: acquired.authority
  });
}

export async function ensureTrustedRuntimeMainHealthReceiptInDirectory(input: Readonly<{
  directory: PhysicalDirectoryIdentity;
  repository: string;
  mainSha: string;
  mainTreeSha: string;
  execute: () => Promise<TrustedRuntimeMainHealthReceipt>;
}>): Promise<Readonly<{
  receipt: TrustedRuntimeMainHealthReceipt;
  reused: boolean;
}>> {
  const mainSha = gitSha(input.mainSha, 'MainHealth mainSha');
  const mainTreeSha = gitSha(input.mainTreeSha, 'MainHealth mainTreeSha');
  const name = `main-${mainSha}.json`;
  const existing = readNoFollowOrdinaryFile(input.directory, name);
  let receipt: TrustedRuntimeMainHealthReceipt;
  let reused: boolean;
  if (existing === null) {
    receipt = publishCanonical({
      parent: input.directory,
      name,
      value: await input.execute(),
      parse: (bytes) => parseTrustedRuntimeMainHealthReceipt(
        Buffer.from(bytes).toString('utf8')
      )
    });
    reused = false;
  } else {
    const source = Buffer.from(existing).toString('utf8');
    receipt = parseTrustedRuntimeMainHealthReceipt(source);
    if (source !== `${encodeVerificationActionData(receipt)}\n`) {
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

export type TrustedRuntimeMainHealthPublication = Readonly<{
  schema: 'sec-trusted-runtime-main-health-publication-v2';
  repository: string;
  mainSha: string;
  mainTreeSha: string;
  runtimeAuthorityBinding: Digest;
  localReceipt: Readonly<{
    receiptDigest: Digest;
    byteDigest: Digest;
    executionId: string;
    reused: boolean;
  }>;
  provider: Readonly<{
    state: 'healthy' | 'unhealthy';
    ref: Digest;
    routingState: 'ordinary-only' | 'repair-only';
    reasonCode: string;
    observationDigest: Digest;
    decisionDigest: Digest;
  }>;
  supersession: Readonly<{
    status: 'superseded' | 'resumed-superseded';
    recordDigest: Digest;
    operationId: Digest;
    locator: string;
    hostedAuthorityDigest: Digest;
    effectAuthorizationDigest: Digest;
    semanticDigest: Digest;
    issuerNodeId: string;
  }> | null;
  publicationDigest: Digest;
}>;

export async function ensureCurrentTrustedRuntimeMainHealth(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  defaultBranch: string;
}>): Promise<TrustedRuntimeMainHealthPublication> {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  assertTrustedRuntimeWindowsControlCliAdmission(repositoryRoot);
  if (input.defaultBranch !== 'main') {
    fail('standalone MainHealth requires the canonical main default branch');
  }
  const liveDefaultBranchSha = () => observeMainHealthGitHubDefaultBranchSha({
    repositoryRoot,
    repository: input.repository,
    defaultBranch: input.defaultBranch
  });
  const [branch, headSha, mainTreeSha, status, originUrl, liveDefaultSha] = await Promise.all([
    tool('git', ['branch', '--show-current'], repositoryRoot),
    tool('git', ['rev-parse', 'HEAD'], repositoryRoot),
    tool('git', ['rev-parse', 'HEAD^{tree}'], repositoryRoot),
    tool('git', ['status', '--porcelain=v1', '--untracked-files=all'], repositoryRoot),
    tool('git', ['remote', 'get-url', 'origin'], repositoryRoot),
    liveDefaultBranchSha()
  ]);
  assertOriginMatchesRepository(originUrl, input.repository);
  if (branch !== input.defaultBranch || status !== '' || !/^[0-9a-f]{40}$/u.test(liveDefaultSha)
      || liveDefaultSha !== headSha) {
    fail('standalone MainHealth must execute from the clean exact default-branch worktree');
  }
  const ensured = await ensureTrustedRuntimeMainHealthReceipt({
    repositoryRoot,
    repository: input.repository,
    mainSha: headSha,
    mainTreeSha
  });
  const runtimeAuthority = ensured.mainHealthAuthority;
  const providerInput = Object.freeze({
    repositoryRoot,
    repository: input.repository,
    defaultBranch: input.defaultBranch,
    mainSha: headSha,
    mainTreeSha,
    runtimeAuthority
  });
  const before = await observeCanonicalMainHealthForPublication(providerInput);
  const reconciliation = before.repairDecision.reasonCode === 'repair-provider-conflict'
    ? await reconcileCanonicalMainHealthProviderConflict({
        ...providerInput,
        runtimeAuthority
      })
    : null;
  if (reconciliation === null && before.repairDecision.routingState === 'locked') {
    fail(`canonical MainHealth provider state is locked: ${before.repairDecision.reasonCode}`);
  }
  const after = await observeCanonicalMainHealthForPublication(providerInput);
  if (after.projection.state === 'unresolved'
      || after.repairDecision.routingState === 'locked') {
    fail(`canonical MainHealth terminal provider state is locked: ${after.repairDecision.reasonCode}`);
  }
  const receiptName = `main-${headSha}.json`;
  const receiptBytes = readNoFollowOrdinaryFile(ensured.directory, receiptName);
  if (receiptBytes === null) fail('durable local MainHealth receipt disappeared during publication');
  const localReceipt = parseTrustedRuntimeMainHealthReceipt(
    Buffer.from(receiptBytes).toString('utf8')
  );
  if (!Buffer.from(receiptBytes).equals(Buffer.from(canonicalBytes(localReceipt)))
      || localReceipt.receiptDigest !== ensured.receipt.receiptDigest
      || localReceipt.repository !== input.repository
      || localReceipt.mainSha !== headSha
      || localReceipt.mainTreeSha !== mainTreeSha) {
    fail('durable local MainHealth receipt changed during publication readback');
  }
  await ensured.authority.assertCurrent();
  const [finalBranch, finalHeadSha, finalTreeSha, finalStatus, finalOriginUrl, finalLiveDefaultSha] =
    await Promise.all([
      tool('git', ['branch', '--show-current'], repositoryRoot),
      tool('git', ['rev-parse', 'HEAD'], repositoryRoot),
      tool('git', ['rev-parse', 'HEAD^{tree}'], repositoryRoot),
      tool('git', ['status', '--porcelain=v1', '--untracked-files=all'], repositoryRoot),
      tool('git', ['remote', 'get-url', 'origin'], repositoryRoot),
      liveDefaultBranchSha()
    ]);
  assertOriginMatchesRepository(finalOriginUrl, input.repository);
  if (finalBranch !== 'main' || finalHeadSha !== headSha || finalTreeSha !== mainTreeSha
      || finalStatus !== '' || finalLiveDefaultSha !== headSha) {
    fail('standalone MainHealth exact default-branch state changed during publication');
  }
  // This is the publication boundary: the local receipt, Runtime State
  // authority, and exact Git/default-branch readback are already fenced.
  // Re-observe the hosted provider only now so the semantic publication can
  // never project an external ledger read that predates the final local fence.
  const finalAfter = await observeCanonicalMainHealthForPublication(providerInput);
  if (finalAfter.projection.state === 'unresolved'
      || finalAfter.repairDecision.routingState === 'locked') {
    fail(`canonical MainHealth provider state drifted at publication boundary: ${finalAfter.repairDecision.reasonCode}`);
  }
  const supersession = reconciliation?.supersession
    ?? (finalAfter.supersession.kind === 'active' ? finalAfter.supersession.supersession : null);
  if (reconciliation !== null
      && (finalAfter.supersession.kind !== 'active'
        || supersession === null
        || finalAfter.supersession.supersession.receipt.recordDigest
          !== reconciliation.supersession.receipt.recordDigest)) {
    fail('canonical MainHealth supersession differs during final publication readback');
  }
  const semantic = Object.freeze({
    schema: 'sec-trusted-runtime-main-health-publication-v2' as const,
    repository: input.repository,
    mainSha: headSha,
    mainTreeSha,
    runtimeAuthorityBinding: trustedRuntimeMainHealthAuthorityBinding(runtimeAuthority),
    localReceipt: Object.freeze({
      receiptDigest: localReceipt.receiptDigest,
      byteDigest: hashBytes(receiptBytes),
      executionId: localReceipt.executionId,
      reused: ensured.reused
    }),
    provider: Object.freeze({
      state: finalAfter.projection.state as 'healthy' | 'unhealthy',
      ref: digest(finalAfter.projection.ref, 'MainHealth provider ref'),
      routingState: finalAfter.repairDecision.routingState as 'ordinary-only' | 'repair-only',
      reasonCode: finalAfter.repairDecision.reasonCode,
      observationDigest: digest(
        finalAfter.repairDecision.observationDigest,
        'MainHealth provider observationDigest'
      ),
      decisionDigest: digest(
        finalAfter.repairDecision.decisionDigest,
        'MainHealth provider decisionDigest'
      )
    }),
    supersession: supersession === null
      ? null
      : Object.freeze({
          status: supersession.status,
          recordDigest: supersession.receipt.recordDigest,
          operationId: supersession.receipt.operationId,
          locator: path.basename(supersession.recordPath),
          hostedAuthorityDigest: supersession.receipt.hostedAuthorityDigest,
          effectAuthorizationDigest: supersession.receipt.effectAuthorizationDigest,
          semanticDigest: supersession.receipt.semanticDigest,
          issuerNodeId: supersession.receipt.issuer.nodeId
        })
  });
  const publicationSemantic = Object.freeze({
    schema: semantic.schema,
    repository: semantic.repository,
    mainSha: semantic.mainSha,
    mainTreeSha: semantic.mainTreeSha,
    runtimeAuthorityBinding: semantic.runtimeAuthorityBinding,
    localReceipt: Object.freeze({
      receiptDigest: semantic.localReceipt.receiptDigest,
      byteDigest: semantic.localReceipt.byteDigest,
      executionId: semantic.localReceipt.executionId
    }),
    provider: Object.freeze({
      state: semantic.provider.state,
      ref: semantic.provider.ref,
      routingState: semantic.provider.routingState,
      reasonCode: semantic.provider.reasonCode
    }),
    supersession: semantic.supersession === null
      ? null
      : Object.freeze({
          operationId: semantic.supersession.operationId,
          hostedAuthorityDigest: semantic.supersession.hostedAuthorityDigest,
          effectAuthorizationDigest: semantic.supersession.effectAuthorizationDigest,
          semanticDigest: semantic.supersession.semanticDigest,
          issuerNodeId: semantic.supersession.issuerNodeId
        })
  });
  return Object.freeze({ ...semantic, publicationDigest: hash(publicationSemantic) });
}

function assertOriginMatchesRepository(originUrl: string, repository: string): void {
  const escapedRepository = repository.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  if (!new RegExp(
    `^(?:https://github\\.com/|git@github\\.com:|ssh://git@github\\.com/)${escapedRepository}(?:\\.git)?$`,
    'u'
  ).test(originUrl)) {
    fail('origin remote does not match the requested GitHub repository');
  }
}

export async function runCurrentTrustedRuntimeWorkspaceCanary(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  dependencies?: boolean;
}>): Promise<Awaited<ReturnType<typeof executeTrustedRuntimeWorkspaceCanary>>> {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  assertTrustedRuntimeWindowsControlCliAdmission(repositoryRoot);
  const [branch, headSha, headTreeSha, status, originUrl] = await Promise.all([
    tool('git', ['branch', '--show-current'], repositoryRoot),
    tool('git', ['rev-parse', 'HEAD'], repositoryRoot),
    tool('git', ['rev-parse', 'HEAD^{tree}'], repositoryRoot),
    tool('git', ['status', '--porcelain=v1', '--untracked-files=all'], repositoryRoot),
    tool('git', ['remote', 'get-url', 'origin'], repositoryRoot)
  ]);
  assertOriginMatchesRepository(originUrl, input.repository);
  if (branch === '' || status !== '' || !/^[0-9a-f]{40}$/u.test(headSha)
      || !/^[0-9a-f]{40}$/u.test(headTreeSha)) {
    fail('runtime workspace canary requires one clean attached exact Git head');
  }
  return await executeTrustedRuntimeWorkspaceCanary({
    repositoryRoot,
    repository: input.repository,
    headSha,
    headTreeSha,
    dependencies: input.dependencies === true
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
  const github = createVerificationSessionGitHubClient(input.repositoryRoot);
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
  capability: GitHubApiCapability;
}>): Promise<ReturnType<typeof parseHostedSynchronousSquashMergeResponse>> {
  const response = await executeGitHubApiOperation(input.capability, {
    kind: 'merge-pull',
    pullRequestNumber: input.prNumber,
    headSha: input.headSha,
    title: input.title,
    message: input.message
  });
  return parseHostedSynchronousSquashMergeResponse(JSON.stringify(response));
}

async function finalizeMergedTrustedRuntime(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  prNumber: number;
  github: VerificationSessionGitHubClient;
  candidate: GitHubCandidateObservation;
  actionBundle: TrustedRuntimeActionBundle;
  gateReadback: ReturnType<typeof CodexDevelopmentParseTrustedRuntimeMergeGateResult>;
  statusReadback: ReturnType<typeof parseIntegrationAuthorizationStatusPublication>;
  mainHealthAuthority: Awaited<ReturnType<typeof acquireSecRuntimeStatePhysicalAuthority>>;
  mainHealthDirectory: PhysicalDirectoryIdentity;
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
  const manifest = CodexDevelopmentParseCurrentWorkPackageManifest(
    manifestSource,
    artifact.session.manifestPath
  );
  const disposition = observeExactIssueDispositionPlan({
    github: input.github,
    repository: input.repository,
    candidate,
    manifestPath: artifact.session.manifestPath,
    manifestDigest: artifact.session.manifestDigest,
    tracking: manifest.tracking
  });
  const authorizationMarkers = integrationAuthorizationStatusMergeMarkers({
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
  assertHostedSquashMergeCompletion({
    candidate,
    expectedHeadSha: artifact.session.headSha,
    expectedHeadTreeSha: artifact.session.headTreeSha,
    markers: mergeMarkers,
    reviewReceipt: gateReadback.reviewReceipt,
    expectedTitle: title,
    providerMergeCommitSha: input.providerMergeCommitSha
  });
  const issueReconciliation = observePostMergeIssueReconciliation({
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
  const mergedParentLine = await tool('git', [
    'rev-list', '--parents', '-n', '1', 'refs/remotes/origin/main'
  ], input.repositoryRoot);
  const mergedParentSha = mergedParentLine.split(' ')[1] ?? '';
  const mergedBaseline = createTrustedRuntimeMainHealthBaselineObservation({
    mainSha: candidate.mergeCommitSha,
    mainTreeSha: candidate.mergeCommitTreeSha,
    parentLine: mergedParentLine,
    parentTreeSha: await tool('git', [
      'rev-parse', `${mergedParentSha}^{tree}`
    ], input.repositoryRoot)
  });
  const requiredMainHealthActions = ['imports', 'typecheck', 'docs-doctor', 'affected-tests'] as const;
  if (artifact.evidence.profile !== 'full' || artifact.evidence.status !== 'passed') {
    fail('new-main health transition requires full passing candidate Evidence');
  }
  const carriedActionKeys = requiredMainHealthActions.map((gateId) => {
    const matching = artifact.evidence.gates.filter(({ action }) =>
      action.operation.identity === gateId);
    if (matching.length !== 1 || matching[0]!.result.status !== 'passed') {
      fail(`new-main health transition lacks one passing ${gateId} Action`);
    }
    return matching[0]!.action.actionKey as Digest;
  });
  const carryForwardAllowed = trustedRuntimeMainHealthCarryForwardBaselineMatches(
    mergedBaseline,
    { baselineSha: candidate.baseSha, baselineTreeSha: candidate.baseTreeSha }
  );
  const nextMainHealth = carryForwardAllowed
    ? createTrustedRuntimeMainHealthReceipt({
        origin: 'verified-candidate-transition',
        repository: input.repository,
        mainSha: candidate.mergeCommitSha,
        mainTreeSha: candidate.mergeCommitTreeSha,
        baselineSha: mergedBaseline.baselineSha,
        baselineTreeSha: mergedBaseline.baselineTreeSha,
        baselineObservationDigest: mergedBaseline.observationDigest,
        executionId: actionBundle.containerReceipt.executionId,
        imageId: actionBundle.containerReceipt.imageId,
        dockerEndpoint: actionBundle.containerReceipt.dockerEndpoint,
        networkIsolatedBeforeExecution: true,
        planDigest: TRUSTED_RUNTIME_MAIN_HEALTH_PLAN_DIGEST,
        actionResults: [Object.freeze({
          actionId: 'affected-closure',
          resultDigest: hash(Object.freeze({
            schema: 'sec-trusted-runtime-main-health-carry-forward-v2',
            baselineObservationDigest: mergedBaseline.observationDigest,
            mainSha: candidate.mergeCommitSha,
            mainTreeSha: candidate.mergeCommitTreeSha,
            carriedActionKeys
          }))
        })],
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
      })
    : await executeTrustedRuntimeMainHealth({
        repositoryRoot: input.repositoryRoot,
        repository: input.repository,
        mainSha: candidate.mergeCommitSha,
        mainTreeSha: candidate.mergeCommitTreeSha
      });
  await input.mainHealthAuthority.assertCurrent();
  const nextMainHealthReadback = publishCanonical({
    parent: input.mainHealthDirectory,
    name: `main-${candidate.mergeCommitSha}.json`,
    value: nextMainHealth,
    parse: (bytes) => parseTrustedRuntimeMainHealthReceipt(
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

async function recoverMergedTrustedRuntime(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  prNumber: number;
  github: VerificationSessionGitHubClient;
  candidate: GitHubCandidateObservation;
}>): Promise<unknown> {
  await assertTrustedMergedRecoveryRuntime(input.repositoryRoot, input.candidate);
  if (input.candidate.mergeCommitMessage === null) {
    fail('merged recovery has no merge message locator');
  }
  const sessionRevision = digest(
    readExactCommitMarker(input.candidate.mergeCommitMessage, 'Verification-Session'),
    'merged recovery session revision'
  );
  const gateResultDigest = digest(
    readExactCommitMarker(input.candidate.mergeCommitMessage, 'Merge-Gate-Result'),
    'merged recovery Gate result digest'
  );
  const statusPublicationDigest = digest(
    readExactCommitMarker(
      input.candidate.mergeCommitMessage,
      'Integration-Authorization-Status-Publication'
    ),
    'merged recovery status publication digest'
  );
  const runtimeLayout = resolveSecRuntimeStateForRepository({
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
  const authority = await acquireSecRuntimeStatePhysicalAuthority({
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
    parse: (bytes) => CodexDevelopmentParseTrustedRuntimeMergeGateResult(
      Buffer.from(bytes).toString('utf8')
    )
  });
  const statusReadback = readCanonical({
    parent: stateDirectory,
    name: `status-${statusPublicationDigest.slice(7)}.json`,
    parse: (bytes) => parseIntegrationAuthorizationStatusPublication(
      Buffer.from(bytes).toString('utf8')
    )
  });
  if (actionBundle.sessionRevision !== sessionRevision
      || gateReadback.resultDigest !== gateResultDigest
      || statusReadback.publicationDigest !== statusPublicationDigest) {
    fail('merged recovery locators differ from the durable canonical artifacts');
  }
  return finalizeMergedTrustedRuntime({
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

export async function closeoutWithTrustedRuntime(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  prNumber: number;
}>): Promise<unknown> {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  assertTrustedRuntimeWindowsControlCliAdmission(repositoryRoot);
  const github = createVerificationSessionGitHubClient(repositoryRoot);
  const candidate = github.observeCandidate(input.repository, input.prNumber);
  if (candidate.state === 'MERGED') {
    return recoverMergedTrustedRuntime({
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
  const preMerge = await withMainHealthGitHubReadOperationBudget({
    repositoryRoot,
    repository: input.repository,
    operation: async () => await closeoutOpenCandidateWithTrustedRuntime({
      input,
      repositoryRoot,
      github,
      candidate
    })
  });
  if (preMerge.kind === 'waiting') return preMerge.value;
  return await executeTrustedRuntimeCloseoutMergeEffect(preMerge);
}

async function closeoutOpenCandidateWithTrustedRuntime(args: Readonly<{
  input: Readonly<{
    repositoryRoot: string;
    repository: string;
    prNumber: number;
  }>;
  repositoryRoot: string;
  github: VerificationSessionGitHubClient;
  candidate: GitHubCandidateObservation;
}>): Promise<TrustedRuntimeCloseoutOpenResult> {
  const { input, repositoryRoot, github, candidate } = args;
  if (candidate.state !== 'OPEN' || candidate.isDraft || candidate.isCrossRepository) {
    fail('candidate changed before trusted-runtime closeout admission');
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
  const manifest = CodexDevelopmentParseCurrentWorkPackageManifest(manifestSource, manifestPath);
  const changed = observeVerificationSessionChangedSelection({ repositoryRoot,
    repository: input.repository, prNumber: input.prNumber, candidate, github });
  CodexDevelopmentAssertWorkPackageOwnership(manifest, [...changed.changedPaths]);
  const dependencyBlobs = observeVerificationSessionActionDependencyBlobs({ github,
    repository: input.repository, baseSha: candidate.baseSha, headSha: candidate.headSha });
  const principal = github.observeViewerPrincipal(input.repository);
  if (principal.permission !== 'admin' && principal.permission !== 'maintain') {
    fail('current principal lacks maintain/admin permission');
  }
  const reviewBarrier = github.observeReviewBarrier({ repository: input.repository,
    prNumber: input.prNumber, headSha: candidate.headSha,
    excludedPrincipalNodeIds: new Set([candidate.authorNodeId, principal.nodeId]) });
  const observedAt = new Date().toISOString();
  const runtimeRef = `${CodexDevelopmentMergeGateProducerIdentity}@${candidate.baseSha}`;
  const runtimeLayout = resolveSecRuntimeStateForRepository({
    repository: input.repository,
    repositoryRoot
  });
  const mainHealthRoot = path.join(
    runtimeLayout.repositoryStateRoot,
    'trusted-main-health',
    'v1'
  );
  const ensuredMainHealth = await ensureTrustedRuntimeMainHealthReceipt({
    repositoryRoot,
    repository: input.repository,
    mainSha: candidate.baseSha,
    mainTreeSha: candidate.baseTreeSha
  });
  const mainHealthAuthority = ensuredMainHealth.authority;
  const mainHealthDirectory = ensuredMainHealth.directory;
  const mainHealthRuntimeAuthority = ensuredMainHealth.mainHealthAuthority;
  const mainHealthObservation = await observeCanonicalMainHealthForPublication({
    repositoryRoot,
    repository: input.repository,
    defaultBranch: candidate.baseBranch,
    mainSha: candidate.baseSha,
    mainTreeSha: candidate.baseTreeSha,
    runtimeAuthority: mainHealthRuntimeAuthority
  });
  if (mainHealthObservation.ledger === null
      || mainHealthObservation.projection.state !== 'healthy'
      || mainHealthObservation.repairDecision.routingState !== 'ordinary-only'
      || mainHealthObservation.supersession.kind === 'blocked'
      || mainHealthObservation.supersession.kind === 'prepared') {
    fail(
      `canonical MainHealth is not healthy and ordinary-only at closeout admission: `
      + `${mainHealthObservation.repairDecision.reasonCode}`
    );
  }
  const mainHealthInput = mainHealthObservation.ledger;
  const preparationInput = {
    repository: input.repository,
    candidate,
    manifestPath,
    manifestDigest,
    changedPaths: changed.changedPaths,
    testImpactTransition: changed.testImpactTransition,
    testImpactSourceProvider: changed.testImpactSourceProvider,
    profile: manifest.requiredProfile,
    integrationPrincipalNodeId: principal.nodeId,
    producerPrincipalNodeId: principal.nodeId,
    sourceRunId: `trusted-runtime-${candidate.headSha.slice(0, 16)}`,
    sourceRef: runtimeRef,
    observedAt,
    reviewBarrier,
    mainHealthChecks: Object.freeze([]),
    dependencyBlobs,
    executionEnvironment: TRUSTED_RUNTIME_CONTAINER_EXECUTION_ENVIRONMENT,
    mainHealthInput
  } as const;
  const planning = prepareTrustedMainVerificationSession(preparationInput);
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
      kind: 'waiting' as const,
      value: Object.freeze({
        status: 'WAITING_REVIEW',
        sessionRevision: planning.sessionRevision,
        reviewWakeup: wakeup,
        reason: reviewBarrier.status === 'provider-schema-unsupported'
          ? reviewBarrier.reasonCode
          : reviewBarrier.reason
      })
    });
  }
  const prepared = prepareTrustedRuntimeVerificationSession(preparationInput);
  const envelope = prepared.envelope;
  const sessionRoot = path.join(runtimeLayout.repositoryStateRoot, 'trusted-runtime', 'v1',
    envelope.session.sessionRevision.slice(7));
  const authority = await acquireSecRuntimeStatePhysicalAuthority({
    repositoryRoot,
    stateRoot: runtimeLayout.stateRoot,
    cacheRoot: runtimeLayout.cacheRoot,
    requiredDirectories: [mainHealthRoot, sessionRoot]
  });
  const stateDirectory = authority.directory(sessionRoot);
  const actionFile = 'verification-action.json';
  const existingAction = readNoFollowOrdinaryFile(stateDirectory, actionFile);
  let actionBundle: TrustedRuntimeActionBundle;
  if (existingAction === null) {
    const requiredBlobs = dependencyBlobs.map(({ path: dependencyPath, candidateSource }) => Object.freeze({
      path: dependencyPath,
      digest: `sha256:${createHash('sha256').update(candidateSource).digest('hex')}` as Digest
    }));
    const executed = await executeTrustedRuntimeContainerVerification({
      repositoryRoot,
      envelope,
      actorNodeId: principal.nodeId,
      requiredBlobs
    });
    const artifact = finalizeVerificationSessionHostedArtifact({
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
  const artifact = refreshVerificationSessionHostedArtifact({
    envelope,
    previousArtifact: actionBundle.artifact,
    producer: actionBundle.artifact.producer,
    refreshedAt: observedAt
  });
  const artifactText = `${encodeVerificationActionData(artifact)}\n`;
  publishCanonical({
    parent: stateDirectory,
    name: `artifact-${artifact.artifactDigest.slice(7)}.json`,
    value: artifact,
    parse: (bytes) => CodexDevelopmentParseVerificationSessionArtifact(
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
    return Object.freeze({
      kind: 'waiting' as const,
      value: Object.freeze({
        status: 'WAITING_REVIEW',
        sessionRevision: envelope.session.sessionRevision,
        reason: preMergeBarrier.status === 'provider-schema-unsupported'
          ? preMergeBarrier.reasonCode : preMergeBarrier.reason
      })
    });
  }
  const issuedAt = preMergeBarrier.observedAt;
  const preMergeReview = createVerificationSessionReviewReceipt({
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
  // T2 is a real hosted/local/runtime observation, not a timestamp refresh of
  // the T1 local receipt. The owner-issued stable digest excludes volatile
  // observation time but includes provider authority/provenance and local
  // resolution, so healthy->healthy drift cannot pass the merge gate.
  const freshMainHealthObservation = await observeCanonicalMainHealthForPublication({
    repositoryRoot,
    repository: input.repository,
    defaultBranch: candidate.baseBranch,
    mainSha: candidate.baseSha,
    mainTreeSha: candidate.baseTreeSha,
    runtimeAuthority: mainHealthRuntimeAuthority
  });
  if (freshMainHealthObservation.ledger === null
      || freshMainHealthObservation.projection.state !== 'healthy'
      || freshMainHealthObservation.repairDecision.routingState !== 'ordinary-only'
      || freshMainHealthObservation.supersession.kind === 'blocked'
      || freshMainHealthObservation.supersession.kind === 'prepared') {
    fail(
      `canonical MainHealth is not healthy and ordinary-only at merge admission: `
      + `${freshMainHealthObservation.repairDecision.reasonCode}`
    );
  }
  if (freshMainHealthObservation.stableDigest !== mainHealthObservation.stableDigest) {
    fail('canonical MainHealth provider/local authority drifted between closeout snapshots');
  }
  const freshMainHealth = freshMainHealthObservation.ledger;
  const artifactObservation = createTrustedRuntimeArtifactObservationFromDurableFile({
    artifact,
    artifactText,
    runtimeSha: candidate.baseSha,
    executionId: actionBundle.containerReceipt.executionId
  });
  const consumptionOperationId = createVerificationSessionMergeOperationId({
    sessionRevision: artifact.session.sessionRevision,
    headSha: candidate.headSha,
    actionPlanDigest: artifact.evidence.actionPlan.actionPlanDigest
  });
  const platform = github.observePlatformEnforcement(input.repository);
  const gateInput = prepareVerificationSessionTrustedRuntimeMergeInput({
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
      runtimePath: CodexDevelopmentMergeGateProducerIdentity,
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
  const gate = CodexDevelopmentEvaluateTrustedRuntimeMergeGate(gateInput);
  const gateReadback = publishCanonical({
    parent: stateDirectory,
    name: `merge-gate-${gate.resultDigest.slice(7)}.json`,
    value: gate,
    parse: (bytes) => CodexDevelopmentParseTrustedRuntimeMergeGateResult(
      Buffer.from(bytes).toString('utf8')
    )
  });
  const publication = await withGitHubApiStatusWriteSession({
    repositoryRoot,
    repository: input.repository,
    operation: async (capability) => {
      const capabilityPrincipal = inspectGitHubApiCapability(capability).principal;
      if (capabilityPrincipal.login !== principal.login
          || capabilityPrincipal.nodeId !== principal.nodeId
          || capabilityPrincipal.userId === null) {
        fail('GitHub status capability principal differs from the observed maintainer');
      }
      return await publishIntegrationAuthorizationStatus({
        result: gateReadback,
        targetUrl: `https://github.com/${input.repository}/pull/${input.prNumber}`,
        capability
      });
    }
  });
  const statusReadback = publishCanonical({
    parent: stateDirectory,
    name: `status-${publication.publicationDigest.slice(7)}.json`,
    value: publication,
    parse: (bytes) => parseIntegrationAuthorizationStatusPublication(
      Buffer.from(bytes).toString('utf8')
    )
  });
  const disposition = observeExactIssueDispositionPlan({
    github,
    repository: input.repository,
    candidate,
    manifestPath,
    manifestDigest,
    tracking: manifest.tracking
  });
  const authorizationMarkers = integrationAuthorizationStatusMergeMarkers({
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
  const message = [...mergeMarkers, renderIndependentReviewTrailer(gateReadback.reviewReceipt)].join('\n');
  if (parseGitHubClosingKeywordOccurrences(`${title}\n${message}`, input.repository).length > 0) {
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
  const immediateDisposition = observeExactIssueDispositionPlan({
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
  // The read budget ends at this final pre-effect fence. Merge and its
  // readback run after the budget owner returns, so a long provider-side
  // mutation cannot turn a successful merge into a post-effect timeout.
  assertMainHealthGitHubReadOperationBudgetCurrent({
    repositoryRoot,
    repository: input.repository
  });
  return Object.freeze({
    kind: 'ready' as const,
    repositoryRoot,
    repository: input.repository,
    prNumber: input.prNumber,
    github,
    candidate,
    actionBundle,
    gateReadback,
    statusReadback,
    mainHealthAuthority,
    mainHealthDirectory,
    actionEvidenceReused: existingAction !== null,
    integrationPrincipal: Object.freeze({ login: principal.login, nodeId: principal.nodeId }),
    title,
    message,
    manifestPath,
    manifestDigest,
    disposition
  });
}

async function executeTrustedRuntimeCloseoutMergeEffect(
  preMerge: TrustedRuntimeCloseoutPreMerge
): Promise<unknown> {
  let providerMergeCommitSha: string | null = null;
  let mergeFailure: unknown = null;
  try {
    providerMergeCommitSha = (await withGitHubApiMergeWriteSession({
      repositoryRoot: preMerge.repositoryRoot,
      repository: preMerge.repository,
      operation: async (capability) => {
        const principal = inspectGitHubApiCapability(capability).principal;
        if (principal.login !== preMerge.integrationPrincipal.login
            || principal.nodeId !== preMerge.integrationPrincipal.nodeId) {
          fail('GitHub merge capability principal differs from status publication principal');
        }
        return await mergeExactHead({
          repository: preMerge.repository,
          prNumber: preMerge.prNumber,
          headSha: preMerge.candidate.headSha,
          title: preMerge.title,
          message: preMerge.message,
          capability
        });
      }
    })).sha;
  } catch (error) {
    mergeFailure = error;
  }
  let readback: GitHubCandidateObservation;
  try {
    readback = preMerge.github.observeCandidate(preMerge.repository, preMerge.prNumber);
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
  return finalizeMergedTrustedRuntime({
    repositoryRoot: preMerge.repositoryRoot,
    repository: preMerge.repository,
    prNumber: preMerge.prNumber,
    github: preMerge.github,
    candidate: readback,
    actionBundle: preMerge.actionBundle,
    gateReadback: preMerge.gateReadback,
    statusReadback: preMerge.statusReadback,
    mainHealthAuthority: preMerge.mainHealthAuthority,
    mainHealthDirectory: preMerge.mainHealthDirectory,
    providerMergeCommitSha,
    actionEvidenceReused: preMerge.actionEvidenceReused
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const result = args.mode === 'main-health'
      ? await ensureCurrentTrustedRuntimeMainHealth({
        repositoryRoot: process.cwd(),
        repository: args.repository,
        defaultBranch: 'main'
      })
    : args.mode === 'runtime-canary'
      ? await runCurrentTrustedRuntimeWorkspaceCanary({
          repositoryRoot: process.cwd(),
          repository: args.repository,
          dependencies: args.dependencies
        })
      : await closeoutWithTrustedRuntime({
          repositoryRoot: process.cwd(),
          repository: args.repository,
          prNumber: args.prNumber
        });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (import.meta.main) await main();
