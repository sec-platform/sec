#!/usr/bin/env bun

import { createHash } from 'node:crypto';
import path from 'node:path';

import {
  CodexDevelopmentParseVerificationSessionArtifactV2,
  type CodexDevelopmentVerificationSessionArtifactV2
} from '../../platform/shared/ci-evidence-contract.ts';
import {
  compileDevelopmentCriticalPathMainDeltaV1,
  type DevelopmentCriticalPathMainDeltaV1,
  type DevelopmentCriticalPathMainIdentityV1
} from '../../platform/shared/development-critical-path-contract.ts';
import {
  parseGitHubClosingKeywordOccurrencesV1
} from '../../platform/shared/issue-disposition-contract.ts';
import { createMainHealthLedgerV1 } from '../../platform/shared/main-health-contract.ts';
import {
  publishExclusiveDurableCanonicalFileV1,
  readNoFollowOrdinaryFileV1,
  replaceDurableCanonicalFileV1,
  type PhysicalDirectoryIdentityV1
} from '../../platform/shared/physical-no-follow.ts';
import { runCommand } from '../../platform/shared/process.ts';
import { renderIndependentReviewTrailerV1 } from '../../platform/shared/review-stability-contract.ts';
import {
  bindTestImpactCachePhysicalCapabilityV1
} from '../../platform/shared/test-impact-contract.ts';
import {
  createVerificationActionTerminalV2,
  encodeVerificationActionDataV2,
  type VerificationActionKeyDigest
} from '../../platform/shared/verification-action-contract.ts';
import {
  composeDevelopmentCriticalPathV1
} from '../../tooling/sec-dev/development-critical-path.ts';
import {
  acquireSecRuntimeJournalAuthorityV1,
  acquireSecRuntimeStatePhysicalAuthorityV1,
  type SecRuntimeStatePhysicalAuthorityV1
} from '../../tooling/sec-dev/runtime-state-authority.ts';
import { createRuntimeStateJournalFileSystemV1 } from '../../tooling/sec-dev/runtime-state-journal-filesystem.ts';
import {
  resolveSecRuntimeStateForRepositoryV1,
  resolveSecWorkspaceRuntimeRootsV1
} from '../../tooling/sec-dev/runtime-state-paths.ts';
import {
  readVerificationActionJournalV2,
  readVerificationActionRetainedStaticClosureV1,
  retireVerificationActionStaticClosureAfterTrustedSettlementV1
} from '../../tooling/sec-dev/verification-action-journal.ts';
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
  createTrustedRuntimeMainHealthBaselineObservationV2,
  createTrustedRuntimeMainHealthReceiptV2,
  executeTrustedRuntimeContainerVerificationV1,
  executeTrustedRuntimeMainHealthV2,
  executeTrustedRuntimeWorkspaceCanaryV1,
  parseTrustedRuntimeContainerReceiptV1,
  parseTrustedRuntimeMainHealthReceiptV2,
  TRUSTED_RUNTIME_CONTAINER_EXECUTION_ENVIRONMENT_V1,
  TRUSTED_RUNTIME_MAIN_HEALTH_PLAN_DIGEST_V2,
  trustedRuntimeMainHealthCarryForwardBaselineMatchesV2,
  type TrustedRuntimeContainerReceiptV1,
  type TrustedRuntimeMainHealthReceiptV2
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
  CodexDevelopmentParseCurrentWorkPackageManifestV1,
  CodexDevelopmentParseWorkPackageLocator,
  CodexDevelopmentWorkPackageManifestDigest
} from './work-package-contract.ts';

/** Machine-visible closeout blocker; it is not a caller-supplied proof field. */
export const TRUSTED_RUNTIME_CRITICAL_PATH_RETIREMENT_BLOCKER_V1 =
  'NO_PRODUCTION_CONSUMER' as const;

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

/**
 * Bind the post-merge MainHealth reuse proposal to the exact verified
 * candidate closure and the physical new-main tree.  Squash changes commit
 * identity, so neither ancestry nor commit SHA participates in the semantic
 * equality claim; every policy/toolchain/provider/environment/Action closure
 * revision does.
 */
export type TrustedRuntimePostMergeMainIdentityFactsV1 = Readonly<{
  readonly treeSha: string | null;
  readonly policyRevision: Digest | null;
  readonly toolchainRevision: Digest | null;
  readonly providerRevision: Digest | null;
  readonly environmentRevision: Digest | null;
  readonly closureDigest: Digest | null;
  readonly unknowns: readonly string[];
}>;

/**
 * Join two independently observed MainIdentity owner facts.  The closeout
 * consumer is not allowed to manufacture the new-main side by copying the
 * candidate closure: absent owner facts are passed as unknown and therefore
 * force a physical MainHealth run.
 */
export function compileTrustedRuntimePostMergeMainDeltaV1(input: Readonly<{
  transition: Readonly<{
    candidate: TrustedRuntimePostMergeMainIdentityFactsV1;
    main: TrustedRuntimePostMergeMainIdentityFactsV1;
    transitionDigest: Digest;
  }>;
}>): DevelopmentCriticalPathMainDeltaV1 {
  if (input.transition.main.treeSha === null) {
    fail('post-merge identity transition requires one exact main tree');
  }
  const rebuilt = createTrustedRuntimePostMergeMainIdentityTransitionV1({
    candidate: input.transition.candidate,
    exactMainTreeSha: input.transition.main.treeSha
  });
  if (rebuilt.transitionDigest !== digest(
      input.transition.transitionDigest,
      'post-merge identity transition digest'
    ) || encodeVerificationActionDataV2(rebuilt.main)
      !== encodeVerificationActionDataV2(input.transition.main)) {
    fail('post-merge identity transition is not canonical');
  }
  const normalize = (
    value: TrustedRuntimePostMergeMainIdentityFactsV1,
    label: string
  ): DevelopmentCriticalPathMainIdentityV1 => Object.freeze({
    treeSha: value.treeSha === null ? null : gitSha(value.treeSha, `${label} tree SHA`),
    policyRevision: value.policyRevision === null ? null : digest(value.policyRevision, `${label} policy revision`),
    toolchainRevision: value.toolchainRevision === null ? null : digest(value.toolchainRevision, `${label} toolchain revision`),
    providerRevision: value.providerRevision === null ? null : digest(value.providerRevision, `${label} provider revision`),
    environmentRevision: value.environmentRevision === null ? null : digest(value.environmentRevision, `${label} environment revision`),
    closureDigest: value.closureDigest === null ? null : digest(value.closureDigest, `${label} closure digest`),
    unknowns: Object.freeze([...value.unknowns])
  });
  return compileDevelopmentCriticalPathMainDeltaV1({
    main: normalize(input.transition.main, 'exact new-main'),
    candidate: normalize(input.transition.candidate, 'verified candidate')
  });
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
  | Readonly<{ mode: 'main-health'; repository: string }>
  | Readonly<{ mode: 'runtime-canary'; repository: string; dependencies: boolean }>;

function parseArgs(argv: readonly string[]): TrustedRuntimeOperatorArgsV1 {
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

function createTrustedRuntimeCandidateMainIdentityFactsV1(input: Readonly<{
  artifact: CodexDevelopmentVerificationSessionArtifactV2;
  containerReceipt: TrustedRuntimeContainerReceiptV1;
  treeSha: string;
  carriedActionKeys?: readonly Digest[];
}>): TrustedRuntimePostMergeMainIdentityFactsV1 {
  const carriedActionKeys = input.carriedActionKeys ?? Object.freeze([]);
  return Object.freeze({
    treeSha: gitSha(input.treeSha, 'candidate identity tree SHA'),
    policyRevision: digest(input.artifact.evidence.actionPlan.actionPlanDigest, 'candidate Action plan revision'),
    toolchainRevision: digest(input.containerReceipt.producerSourceDigest, 'candidate toolchain revision'),
    providerRevision: hash(Object.freeze({
      schema: 'sec-trusted-runtime-provider-revision-v1',
      dockerEndpoint: input.containerReceipt.dockerEndpoint
    })),
    environmentRevision: hash(Object.freeze({
      schema: 'sec-trusted-runtime-environment-revision-v1',
      imageId: input.containerReceipt.imageId,
      executionEnvironment: TRUSTED_RUNTIME_CONTAINER_EXECUTION_ENVIRONMENT_V1
    })),
    closureDigest: hash(Object.freeze({
      schema: 'sec-trusted-runtime-main-closure-v1',
      evidenceDigest: digest(input.artifact.evidence.evidenceDigest, 'verification evidence digest'),
      manifestDigest: digest(input.artifact.session.manifestDigest, 'manifest digest'),
      carriedActionKeys: Object.freeze(carriedActionKeys.map((value) =>
        digest(value, 'carried ActionKey')).sort())
    })),
    unknowns: Object.freeze([])
  });
}

function createTrustedRuntimeUnknownMainIdentityFactsV1(treeSha: string):
  TrustedRuntimePostMergeMainIdentityFactsV1 {
  return Object.freeze({
    treeSha: gitSha(treeSha, 'exact new-main identity tree SHA'),
    policyRevision: null,
    toolchainRevision: null,
    providerRevision: null,
    environmentRevision: null,
    closureDigest: null,
    unknowns: Object.freeze([
      'exact-new-main-policy-revision-unobserved',
      'exact-new-main-toolchain-revision-unobserved',
      'exact-new-main-provider-revision-unobserved',
      'exact-new-main-environment-revision-unobserved',
      'exact-new-main-closure-unobserved'
    ])
  });
}

/**
 * Transfer authenticated candidate Evidence to exact new main only through an
 * independently observed Git tree equality. Git tree identity commits to all
 * repository bytes, while the carried revisions describe the authenticated
 * verification closure for those bytes. A different tree receives no copied
 * revision and therefore cannot be self-certified.
 */
export function createTrustedRuntimePostMergeMainIdentityTransitionV1(input: Readonly<{
  candidate: TrustedRuntimePostMergeMainIdentityFactsV1;
  exactMainTreeSha: string;
}>): Readonly<{
  candidate: TrustedRuntimePostMergeMainIdentityFactsV1;
  main: TrustedRuntimePostMergeMainIdentityFactsV1;
  transitionDigest: Digest;
}> {
  const exactMainTreeSha = gitSha(input.exactMainTreeSha, 'post-merge exact main tree SHA');
  const candidateTreeSha = input.candidate.treeSha === null
    ? null
    : gitSha(input.candidate.treeSha, 'post-merge candidate tree SHA');
  const main = candidateTreeSha === exactMainTreeSha
    ? Object.freeze({ ...input.candidate, treeSha: exactMainTreeSha })
    : createTrustedRuntimeUnknownMainIdentityFactsV1(exactMainTreeSha);
  return Object.freeze({
    candidate: input.candidate,
    main,
    transitionDigest: hash(Object.freeze({
      schema: 'sec-trusted-runtime-main-identity-transition-v1',
      candidateTreeSha,
      exactMainTreeSha,
      candidateClosureDigest: input.candidate.closureDigest,
      disposition: candidateTreeSha === exactMainTreeSha
        ? 'content-addressed-transfer'
        : 'blocked-tree-drift'
    }))
  });
}

function trustedRuntimeArtifactActionObservationV1(
  artifact: CodexDevelopmentVerificationSessionArtifactV2,
  actionKey: VerificationActionKeyDigest
) {
  const matches = artifact.evidence.gates.filter((gate) => gate.action.actionKey === actionKey);
  if (matches.length !== 1) {
    fail(`verified Evidence must contain exactly one gate for ActionKey ${actionKey}`);
  }
  const result = matches[0]!.result;
  const terminal = createVerificationActionTerminalV2({
    status: result.status,
    reasonCode: result.reasonCode,
    resultDigest: result.execution?.outputDigest ?? null
  });
  return Object.freeze({
    actionKey,
    state: 'terminal' as const,
    observationDigest: hash(Object.freeze({
      schema: 'sec-trusted-runtime-evidence-action-observation-v1',
      artifactDigest: digest(artifact.artifactDigest, 'verification artifact digest'),
      actionKey,
      terminal
    })),
    terminal
  });
}

function assertJournalAndArtifactTerminalAgreeV1(
  journal: ReturnType<typeof readVerificationActionJournalV2>,
  artifactObservation: ReturnType<typeof trustedRuntimeArtifactActionObservationV1>
): void {
  if (journal.latestState !== 'terminal' && journal.latestState !== 'reused') return;
  if (journal.terminal === null
      || encodeVerificationActionDataV2(journal.terminal)
        !== encodeVerificationActionDataV2(artifactObservation.terminal)) {
    fail(`VerificationAction journal conflicts with immutable Evidence for ${artifactObservation.actionKey}`);
  }
}

function resolveTrustedRuntimeActionObservationV1(
  journal: ReturnType<typeof readVerificationActionJournalV2>,
  artifactObservation: ReturnType<typeof trustedRuntimeArtifactActionObservationV1>
) {
  assertJournalAndArtifactTerminalAgreeV1(journal, artifactObservation);
  // The artifact parser has already revalidated the exact session/head/plan.
  // A local non-terminal journal may be an earlier or cross-host projection;
  // it cannot invalidate a later immutable FINAL artifact for the same key.
  return artifactObservation;
}

function readTrustedRuntimeDependencyResolutionV1(
  fs: ReturnType<typeof createRuntimeStateJournalFileSystemV1>,
  artifact: CodexDevelopmentVerificationSessionArtifactV2,
  actionKey: Digest
): Readonly<{
  actionKey: Digest;
  state: 'queued' | 'running' | 'terminal-passed' | 'terminal-failed' | 'not-run'
    | 'unsupported' | 'invalidated' | 'cancelled' | 'unknown';
  observationDigest: Digest | null;
}> {
  const journal = readVerificationActionJournalV2(fs, actionKey);
  const artifactObservation = trustedRuntimeArtifactActionObservationV1(artifact, actionKey);
  assertJournalAndArtifactTerminalAgreeV1(journal, artifactObservation);
  const observationDigest = journal.events.at(-1)?.eventDigest ?? null;
  if (journal.latestState === 'terminal' || journal.latestState === 'reused') {
    if (journal.terminal?.status === 'passed') {
      return Object.freeze({ actionKey, state: 'terminal-passed', observationDigest });
    }
    if (journal.terminal?.status === 'failed') {
      return Object.freeze({ actionKey, state: 'terminal-failed', observationDigest });
    }
    return Object.freeze({ actionKey, state: 'not-run', observationDigest });
  }
  // Immutable Evidence is the durable terminal owner when a local journal has
  // already been retired or was produced on another host.
  return Object.freeze({
    actionKey,
    state: artifactObservation.terminal.status === 'passed'
      ? 'terminal-passed' as const
      : 'terminal-failed' as const,
    observationDigest: artifactObservation.observationDigest
  });
}

/**
 * Consume the existing Action plan/journal without starting an Action.  The
 * returned digest is settlement evidence only; ActionKey identity, runner
 * execution/join/reuse, MainHealth and provider effects remain with their
 * existing owners.
 */
async function composeTrustedRuntimeCriticalPathSettlementDigestV1(input: Readonly<{
  repositoryRoot: string;
  candidate: GitHubCandidateObservationV1;
  actionBundle: TrustedRuntimeActionBundleV1;
  identities: ReturnType<typeof createTrustedRuntimePostMergeMainIdentityTransitionV1>;
}>): Promise<Readonly<{
  digest: Digest;
  allReusable: boolean;
  retirement: Readonly<{
    status: 'blocked' | 'retired';
    reasonCode: typeof TRUSTED_RUNTIME_CRITICAL_PATH_RETIREMENT_BLOCKER_V1 | null;
  }>;
}>> {
  if (input.candidate.mergeCommitTreeSha === null) {
    fail('critical-path settlement requires the exact merged main tree');
  }
  const mergedMainTreeSha = input.candidate.mergeCommitTreeSha;
  const authority = await acquireSecRuntimeJournalAuthorityV1({
    repositoryRoot: input.repositoryRoot
  });
  await authority.assertCurrent();
  const roots = resolveSecWorkspaceRuntimeRootsV1({ repositoryRoot: input.repositoryRoot });
  const journalFs = createRuntimeStateJournalFileSystemV1(
    authority.directory(roots.workspaceStateRoot)
  );
  const actionPlans = input.actionBundle.artifact.evidence.actionPlan.actions;
  const projectionClosures = actionPlans.map((plan) => {
    const dependencies = plan.dependencies.map((dependency) =>
      readTrustedRuntimeDependencyResolutionV1(
        journalFs,
        input.actionBundle.artifact,
        dependency.actionKey as Digest
      ));
    const journal = readVerificationActionJournalV2(journalFs, plan.action.actionKey as Digest);
    if (journal.evidence === null || journal.evidence === undefined) {
      fail(`critical-path settlement is missing durable provider Evidence for ${plan.action.actionKey}`);
    }
    const staticClosure = readVerificationActionRetainedStaticClosureV1(
      journalFs,
      plan.action.actionKey as Digest
    );
    if (staticClosure === null) {
      fail(`critical-path settlement is missing durable static closure for ${plan.action.actionKey}`);
    }
    if (staticClosure.analysisReadback.repository.headTreeSha !== mergedMainTreeSha) {
      fail(`critical-path static closure tree differs for ${plan.action.actionKey}`);
    }
    const artifactObservation = trustedRuntimeArtifactActionObservationV1(
      input.actionBundle.artifact,
      plan.action.actionKey
    );
    const actionObservation = resolveTrustedRuntimeActionObservationV1(journal, artifactObservation);
    const projection = composeDevelopmentCriticalPathV1({
      // Consume the exact pre-effect analyzer publication. Closeout never
      // recomputes a static proof from the plan or manufactures post-hoc PASS.
      staticClosure,
      action: plan.action,
      plan,
      observation: actionObservation,
      dependencies,
      main: input.identities.main,
      candidate: input.identities.candidate,
      mainHealth: {
        ledger: input.actionBundle.artifact.mainHealth,
        now: new Date().toISOString(),
        expectedRepository: input.actionBundle.artifact.session.repository,
        expectedDefaultBranch: input.candidate.baseBranch,
        expectedMainSha: input.candidate.mergeCommitSha ?? input.candidate.headSha,
        expectedMainTreeSha: mergedMainTreeSha,
        expectedTrustRevision: input.actionBundle.artifact.session.trustRevision
      },
      environment: {
        plan: null,
        spec: null,
        observation: null,
        environmentRevision: null,
        unknowns: ['closeout-environment-owner-not-joined']
      },
      provider: {
        required: false,
        capability: null,
        unknowns: []
      }
    });
    return Object.freeze({
      projection,
      staticClosure,
      terminalEvidenceDigest: journal.evidence.evidenceDigest
    });
  });
  const projections = projectionClosures.map(({ projection }) => projection);
  await authority.assertCurrent();
  const allReusable = projections.every((projection) => projection.overallDisposition === 'reuse-pass');
  const digestValue = hash(Object.freeze({
    schema: 'sec-trusted-runtime-development-critical-path-settlement-v1',
    sessionRevision: input.actionBundle.sessionRevision,
    artifactDigest: input.actionBundle.artifact.artifactDigest,
    mainTreeSha: input.candidate.mergeCommitTreeSha,
    actionPlanDigest: input.actionBundle.actionPlanDigest,
    identityTransitionDigest: input.identities.transitionDigest,
    projections: Object.freeze(projectionClosures.map(({ projection, staticClosure, terminalEvidenceDigest }) =>
      Object.freeze({
        actionKey: projection.action.actionKey,
        semanticDigest: projection.semanticDigest,
        closureDigest: staticClosure.closureDigest,
        terminalEvidenceDigest
      })))
  }));
  const retirements = projectionClosures.map(({ staticClosure }) =>
    retireVerificationActionStaticClosureAfterTrustedSettlementV1({
      fs: journalFs,
      actionKey: staticClosure.actionKey,
      sessionRevision: input.actionBundle.artifact.session.sessionRevision as Digest,
      artifactDigest: input.actionBundle.artifact.artifactDigest as Digest,
      settlementDigest: digestValue
    })
  );
  await authority.assertCurrent();
  if (retirements.some((retirement) => retirement.disposition !== 'retired')) {
    fail('critical-path static closure pointer retirement did not complete');
  }
  return Object.freeze({
    digest: digestValue,
    allReusable,
    retirement: Object.freeze({
      status: 'retired' as const,
      reasonCode: null
    })
  });
}

export async function ensureTrustedRuntimeMainHealthReceiptV2(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  mainSha: string;
  mainTreeSha: string;
  runtimeStateEnvironment?: NodeJS.ProcessEnv;
  execute?: typeof executeTrustedRuntimeMainHealthV2;
}>): Promise<Readonly<{
  receipt: TrustedRuntimeMainHealthReceiptV2;
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
  const ensured = await ensureTrustedRuntimeMainHealthReceiptInDirectoryV2({
    directory,
    repository: input.repository,
    mainSha: input.mainSha,
    mainTreeSha: input.mainTreeSha,
    execute: async () => await (input.execute ?? executeTrustedRuntimeMainHealthV2)({
      repositoryRoot,
      repository: input.repository,
      mainSha: input.mainSha,
      mainTreeSha: input.mainTreeSha
    })
  });
  await authority.assertCurrent();
  return Object.freeze({ ...ensured, authority, directory });
}

export async function ensureTrustedRuntimeMainHealthReceiptInDirectoryV2(input: Readonly<{
  directory: PhysicalDirectoryIdentityV1;
  repository: string;
  mainSha: string;
  mainTreeSha: string;
  execute: () => Promise<TrustedRuntimeMainHealthReceiptV2>;
}>): Promise<Readonly<{
  receipt: TrustedRuntimeMainHealthReceiptV2;
  reused: boolean;
}>> {
  const mainSha = gitSha(input.mainSha, 'MainHealth mainSha');
  const mainTreeSha = gitSha(input.mainTreeSha, 'MainHealth mainTreeSha');
  const name = `main-${mainSha}.json`;
  const existing = readNoFollowOrdinaryFileV1(input.directory, name);
  let receipt: TrustedRuntimeMainHealthReceiptV2;
  let reused: boolean;
  if (existing === null) {
    receipt = publishCanonical({
      parent: input.directory,
      name,
      value: await input.execute(),
      parse: (bytes) => parseTrustedRuntimeMainHealthReceiptV2(
        Buffer.from(bytes).toString('utf8')
      )
    });
    reused = false;
  } else {
    const source = Buffer.from(existing).toString('utf8');
    receipt = parseTrustedRuntimeMainHealthReceiptV2(source);
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

export async function ensureCurrentTrustedRuntimeMainHealthV2(input: Readonly<{
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
  const [branch, headSha, mainTreeSha, status, originUrl, liveDefaultSha] = await Promise.all([
    tool('git', ['branch', '--show-current'], repositoryRoot),
    tool('git', ['rev-parse', 'HEAD'], repositoryRoot),
    tool('git', ['rev-parse', 'HEAD^{tree}'], repositoryRoot),
    tool('git', ['status', '--porcelain=v1', '--untracked-files=all'], repositoryRoot),
    tool('git', ['remote', 'get-url', 'origin'], repositoryRoot),
    tool('gh', ['api', `/repos/${input.repository}/git/ref/heads/main`, '--jq', '.object.sha'], repositoryRoot)
  ]);
  assertOriginMatchesRepositoryV1(originUrl, input.repository);
  if (branch !== 'main' || status !== '' || !/^[0-9a-f]{40}$/u.test(liveDefaultSha)
      || liveDefaultSha !== headSha) {
    fail('standalone MainHealth must execute from the clean exact default-branch worktree');
  }
  const ensured = await ensureTrustedRuntimeMainHealthReceiptV2({
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

function assertOriginMatchesRepositoryV1(originUrl: string, repository: string): void {
  const escapedRepository = repository.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  if (!new RegExp(
    `^(?:https://github\\.com/|git@github\\.com:|ssh://git@github\\.com/)${escapedRepository}(?:\\.git)?$`,
    'u'
  ).test(originUrl)) {
    fail('origin remote does not match the requested GitHub repository');
  }
}

export async function runCurrentTrustedRuntimeWorkspaceCanaryV1(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  dependencies?: boolean;
}>): Promise<Awaited<ReturnType<typeof executeTrustedRuntimeWorkspaceCanaryV1>>> {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const [branch, headSha, headTreeSha, status, originUrl] = await Promise.all([
    tool('git', ['branch', '--show-current'], repositoryRoot),
    tool('git', ['rev-parse', 'HEAD'], repositoryRoot),
    tool('git', ['rev-parse', 'HEAD^{tree}'], repositoryRoot),
    tool('git', ['status', '--porcelain=v1', '--untracked-files=all'], repositoryRoot),
    tool('git', ['remote', 'get-url', 'origin'], repositoryRoot)
  ]);
  assertOriginMatchesRepositoryV1(originUrl, input.repository);
  if (branch === '' || status !== '' || !/^[0-9a-f]{40}$/u.test(headSha)
      || !/^[0-9a-f]{40}$/u.test(headTreeSha)) {
    fail('runtime workspace canary requires one clean attached exact Git head');
  }
  return await executeTrustedRuntimeWorkspaceCanaryV1({
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
  const manifest = CodexDevelopmentParseCurrentWorkPackageManifestV1(
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
  const mergedParentLine = await tool('git', [
    'rev-list', '--parents', '-n', '1', 'refs/remotes/origin/main'
  ], input.repositoryRoot);
  const mergedParentSha = mergedParentLine.split(' ')[1] ?? '';
  const mergedBaseline = createTrustedRuntimeMainHealthBaselineObservationV2({
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
  const candidateMainIdentity = createTrustedRuntimeCandidateMainIdentityFactsV1({
    artifact,
    containerReceipt: actionBundle.containerReceipt,
    treeSha: candidate.headTreeSha,
    carriedActionKeys
  });
  // The remote main tree was independently read above. Exact Git-tree equality
  // is the content-addressed proof that permits the authenticated candidate
  // Evidence closure to transition; no commit ancestry or candidate-authored
  // main observation participates.
  const identityTransition = createTrustedRuntimePostMergeMainIdentityTransitionV1({
    candidate: candidateMainIdentity,
    exactMainTreeSha: candidate.mergeCommitTreeSha
  });
  const criticalPathSettlement = await composeTrustedRuntimeCriticalPathSettlementDigestV1({
    repositoryRoot: input.repositoryRoot,
    candidate,
    actionBundle,
    identities: identityTransition
  });
  if (criticalPathSettlement.retirement.status !== 'retired') {
    fail(
      `${TRUSTED_RUNTIME_CRITICAL_PATH_RETIREMENT_BLOCKER_V1}: static closure retirement is blocked until an independent ` +
      `provider consumer and retention readback is wired (${criticalPathSettlement.retirement.reasonCode})`
    );
  }
  const mainDelta = compileTrustedRuntimePostMergeMainDeltaV1({
    transition: identityTransition
  });
  const carryForwardAllowed = mainDelta.disposition === 'tree-equivalent'
    && criticalPathSettlement.allReusable
    && trustedRuntimeMainHealthCarryForwardBaselineMatchesV2(
      mergedBaseline,
      { baselineSha: candidate.baseSha, baselineTreeSha: candidate.baseTreeSha }
    );
  const nextMainHealth = carryForwardAllowed
    ? createTrustedRuntimeMainHealthReceiptV2({
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
        planDigest: TRUSTED_RUNTIME_MAIN_HEALTH_PLAN_DIGEST_V2,
        actionResults: [Object.freeze({
          actionId: 'affected-closure',
          resultDigest: hash(Object.freeze({
            schema: 'sec-trusted-runtime-main-health-carry-forward-v2',
            baselineObservationDigest: mergedBaseline.observationDigest,
            mainSha: candidate.mergeCommitSha,
            mainTreeSha: candidate.mergeCommitTreeSha,
            mainDeltaDecisionDigest: mainDelta.decisionDigest,
            developmentCriticalPathDecisionDigest: criticalPathSettlement.digest,
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
    : await executeTrustedRuntimeMainHealthV2({
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
    parse: (bytes) => parseTrustedRuntimeMainHealthReceiptV2(
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
    mainDeltaDecisionDigest: mainDelta.decisionDigest,
    mainDeltaDisposition: mainDelta.disposition,
    developmentCriticalPathDecisionDigest: criticalPathSettlement.digest,
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
  const manifest = CodexDevelopmentParseCurrentWorkPackageManifestV1(manifestSource, manifestPath);
  const runtimeLayout = resolveSecRuntimeStateForRepositoryV1({
    repository: input.repository,
    repositoryRoot
  });
  await bindTestImpactCachePhysicalCapabilityV1({
    repositoryRoot,
    cacheRoot: runtimeLayout.cacheRoot
  });
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
  const mainHealthRoot = path.join(
    runtimeLayout.repositoryStateRoot,
    'trusted-main-health',
    'v1'
  );
  const ensuredMainHealth = await ensureTrustedRuntimeMainHealthReceiptV2({
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
    ? await ensureCurrentTrustedRuntimeMainHealthV2({
        repositoryRoot: process.cwd(),
        repository: args.repository
      })
    : args.mode === 'runtime-canary'
      ? await runCurrentTrustedRuntimeWorkspaceCanaryV1({
          repositoryRoot: process.cwd(),
          repository: args.repository,
          dependencies: args.dependencies
        })
      : await closeoutWithTrustedRuntimeV1({
          repositoryRoot: process.cwd(),
          repository: args.repository,
          prNumber: args.prNumber
        });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (import.meta.main) await main();
