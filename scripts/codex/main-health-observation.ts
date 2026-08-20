/** Canonical provider-checks to MainHealth-ledger input compiler. */

import { createHash } from 'node:crypto';

import {
  CI_MAIN_HEALTH_POLICY_DIGEST_V1,
  CI_MAIN_HEALTH_POLICY_V1,
  createCiMainHealthRequestOperationIdV1
} from '../../platform/shared/ci-verification-revision.ts';
import {
  createMainHealthRepairWorkPackagePathV1,
  type MainHealthLedgerInputV1
} from '../../platform/shared/main-health-contract.ts';
import { encodeVerificationActionDataV2 } from '../../platform/shared/verification-action-contract.ts';
import type { GitHubCheckObservationV1 } from './verification-session-github.ts';

type Digest = `sha256:${string}`;

export interface TrustedLocalMainHealthObservationV1 {
  readonly schema: 'sec-trusted-local-main-health-observation-v1';
  readonly repository: string;
  readonly mainSha: string;
  readonly mainTreeSha: string;
  readonly trustRevision: string;
  readonly runtimeRef: string;
  readonly executionId: string;
  readonly verificationReceiptDigest: Digest;
  readonly observedAt: string;
  readonly expiresAt: string;
}

export const MAIN_HEALTH_CHECK_PROVIDER_POLICY_SCHEMA_V1 =
  'sec-main-health-check-provider-policy-v1' as const;

export type MainHealthCheckProviderPolicyV1 = Readonly<{
  schema: typeof MAIN_HEALTH_CHECK_PROVIDER_POLICY_SCHEMA_V1;
  policyRevision: string;
  policyDigest: Digest;
  context: 'sec/main-health';
  app: Readonly<{ id: number; nodeId: string; slug: string }>;
  branch: 'main';
  producer:
    | Readonly<{
        kind: 'github-actions-workflow';
        workflowPath: string;
        workflowRefFormat: string;
        eventName: 'repository_dispatch';
        runTitleFormat: string;
      }>
    | Readonly<{
        kind: 'github-app-check';
      }>;
  terminal: Readonly<{
    status: 'completed';
    conclusion: 'success';
    recognizedConclusions: readonly string[];
  }>;
  degraded: Readonly<{
    owner: string;
    allowedLanes: readonly ['repair'];
  }>;
  locked: Readonly<{
    allowedLanes: readonly [];
  }>;
}>;

function hash(value: unknown): Digest {
  return `sha256:${createHash('sha256').update(encodeVerificationActionDataV2(value)).digest('hex')}`;
}

function sha(value: string, label: string): string {
  if (!/^[0-9a-f]{40}$/u.test(value)) throw new Error(`MainHealth ${label} must be a Git SHA.`);
  return value;
}

function digest(value: string, label: string): Digest {
  if (!/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`MainHealth ${label} must be a SHA-256 digest.`);
  }
  return value as Digest;
}

function instant(value: string, label: string): string {
  if (new Date(value).toISOString() !== value) {
    throw new Error(`MainHealth ${label} must be a canonical ISO instant.`);
  }
  return value;
}

/**
 * Provider-neutral MainHealth adapter for a trusted local runtime.  It does
 * not infer health from repository presence: the caller must supply the
 * durable exact-main verification receipt digest, which MergeGate binds to
 * the same trusted-base runtime revision and source ref.
 */
export function createTrustedLocalMainHealthInputV1(
  input: TrustedLocalMainHealthObservationV1
): MainHealthLedgerInputV1 {
  if (input.schema !== 'sec-trusted-local-main-health-observation-v1') {
    throw new Error('MainHealth trusted-local observation schema mismatch.');
  }
  const mainSha = sha(input.mainSha, 'mainSha');
  const mainTreeSha = sha(input.mainTreeSha, 'mainTreeSha');
  const trustRevision = sha(input.trustRevision, 'trustRevision');
  const observedAt = instant(input.observedAt, 'observedAt');
  const expiresAt = instant(input.expiresAt, 'expiresAt');
  if (mainSha !== trustRevision || expiresAt <= observedAt) {
    throw new Error('MainHealth trusted-local observation is not exact or fresh.');
  }
  return Object.freeze({
    repository: boundedText(input.repository, 'repository'),
    defaultBranch: 'main',
    mainSha,
    mainTreeSha,
    status: 'healthy',
    failureFingerprints: Object.freeze([]),
    owner: null,
    repairWorkPackage: null,
    expiresAt,
    allowedLanes: Object.freeze(['ordinary'] as const),
    trustRevision,
    observedAt,
    producer: Object.freeze({
      identity: 'platform/shared/default-branch-revision-health.ts',
      trustRevision,
      sourceTransport: 'trusted-local-readback' as const,
      sourceRunId: boundedText(input.executionId, 'executionId'),
      sourceRef: boundedText(input.runtimeRef, 'runtimeRef'),
      sourceDigest: digest(input.verificationReceiptDigest, 'verificationReceiptDigest')
    })
  });
}

function boundedText(value: string, label: string): string {
  if (value.length === 0 || value.length > 512 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`MainHealth ${label} must be bounded text.`);
  }
  return value;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`MainHealth ${label} must be a positive safe integer.`);
  }
  return value;
}

function canonicalApp(input: Readonly<{ id: number; nodeId: string; slug: string }>) {
  const id = positiveInteger(input.id, 'app.id');
  const nodeId = boundedText(input.nodeId, 'app.nodeId');
  const slug = boundedText(input.slug, 'app.slug');
  if (!/^[a-z0-9][a-z0-9-]{0,127}$/u.test(slug)) {
    throw new Error('MainHealth app.slug must be canonical kebab-case text.');
  }
  return Object.freeze({ id, nodeId, slug });
}

const RECOGNIZED_MAIN_HEALTH_CONCLUSIONS = Object.freeze([
  'success', 'failure', 'cancelled', 'skipped', 'timed_out',
  'action_required', 'neutral', 'stale', 'startup_failure'
] as const);

/**
 * Existing GitHub Actions policy projected into the provider-neutral matcher.
 * Its digest remains the canonical legacy digest so current Session proposal
 * identity and all existing Actions consumers remain byte/semantic compatible.
 */
export const GITHUB_ACTIONS_MAIN_HEALTH_CHECK_PROVIDER_POLICY_V1: MainHealthCheckProviderPolicyV1 =
  Object.freeze({
    schema: MAIN_HEALTH_CHECK_PROVIDER_POLICY_SCHEMA_V1,
    policyRevision: CI_MAIN_HEALTH_POLICY_V1.policyRevision,
    policyDigest: CI_MAIN_HEALTH_POLICY_DIGEST_V1,
    context: CI_MAIN_HEALTH_POLICY_V1.context,
    app: Object.freeze({
      id: CI_MAIN_HEALTH_POLICY_V1.app.id,
      nodeId: CI_MAIN_HEALTH_POLICY_V1.app.nodeId,
      slug: CI_MAIN_HEALTH_POLICY_V1.app.slug
    }),
    branch: CI_MAIN_HEALTH_POLICY_V1.producer.branch,
    producer: Object.freeze({
      kind: 'github-actions-workflow' as const,
      workflowPath: CI_MAIN_HEALTH_POLICY_V1.producer.workflowPath,
      workflowRefFormat: CI_MAIN_HEALTH_POLICY_V1.producer.workflowRefFormat,
      eventName: CI_MAIN_HEALTH_POLICY_V1.producer.eventNames[0],
      runTitleFormat: CI_MAIN_HEALTH_POLICY_V1.producer.runTitleFormats.repositoryDispatch
    }),
    terminal: Object.freeze({
      status: CI_MAIN_HEALTH_POLICY_V1.terminal.status,
      conclusion: CI_MAIN_HEALTH_POLICY_V1.terminal.conclusion,
      recognizedConclusions: CI_MAIN_HEALTH_POLICY_V1.terminal.recognizedConclusions
    }),
    degraded: Object.freeze({
      owner: CI_MAIN_HEALTH_POLICY_V1.degraded.owner,
      allowedLanes: CI_MAIN_HEALTH_POLICY_V1.degraded.allowedLanes
    }),
    locked: Object.freeze({ allowedLanes: CI_MAIN_HEALTH_POLICY_V1.locked.allowedLanes })
  });

/**
 * Builds the exact policy for a dedicated SEC Integration/App principal. The
 * App check is the GitHub transport/readback projection; the trusted runtime
 * that owns the App credentials remains responsible for executing the actual
 * MainHealth closure before publishing it.
 */
export function createTrustedRuntimeMainHealthCheckProviderPolicyV1(input: Readonly<{
  policyRevision: string;
  app: Readonly<{ id: number; nodeId: string; slug: string }>;
}>): MainHealthCheckProviderPolicyV1 {
  const semantic = Object.freeze({
    schema: MAIN_HEALTH_CHECK_PROVIDER_POLICY_SCHEMA_V1,
    policyRevision: boundedText(input.policyRevision, 'policyRevision'),
    context: 'sec/main-health' as const,
    app: canonicalApp(input.app),
    branch: 'main' as const,
    producer: Object.freeze({ kind: 'github-app-check' as const }),
    terminal: Object.freeze({
      status: 'completed' as const,
      conclusion: 'success' as const,
      recognizedConclusions: RECOGNIZED_MAIN_HEALTH_CONCLUSIONS
    }),
    degraded: Object.freeze({
      owner: 'ci-verification-maintainer' as const,
      allowedLanes: Object.freeze(['repair'] as const)
    }),
    locked: Object.freeze({ allowedLanes: Object.freeze([] as const) })
  });
  return Object.freeze({ ...semantic, policyDigest: hash(semantic) });
}

function matchesActionsProducerV1(
  check: GitHubCheckObservationV1,
  policy: Extract<MainHealthCheckProviderPolicyV1['producer'], { kind: 'github-actions-workflow' }>,
  mainSha: string
): boolean {
  const expectedRef = policy.workflowRefFormat.replace('<exact-main-sha>', mainSha);
  const titleParts = policy.runTitleFormat.replace('<exact-main-sha>', mainSha).split('<request-operation-id>');
  if (titleParts.length !== 2) {
    throw new Error('MainHealth repository-dispatch title policy must contain one request-operation placeholder.');
  }
  const [titlePrefix, titleSuffix] = titleParts as [string, string];
  if (check.workflowRunId === null || check.workflowRunDisplayTitle === null
      || check.eventName !== policy.eventName
      || check.workflowPath !== policy.workflowPath
      || check.workflowRef !== expectedRef
      || !check.workflowRunDisplayTitle.startsWith(titlePrefix)
      || !check.workflowRunDisplayTitle.endsWith(titleSuffix)) return false;
  const operationId = check.workflowRunDisplayTitle.slice(
    titlePrefix.length,
    check.workflowRunDisplayTitle.length - titleSuffix.length
  );
  return operationId === createCiMainHealthRequestOperationIdV1(mainSha);
}

function matchesDirectAppProducerV1(check: GitHubCheckObservationV1): boolean {
  return check.workflowPath === null
    && check.workflowRef === null
    && check.eventName === null
    && check.workflowRunId === null
    && check.workflowRunDisplayTitle === null;
}

/**
 * Single MainHealth ledger compiler. Provider-specific adapters authenticate
 * only the check producer; health/degraded/locked semantics and failure
 * fingerprinting remain one canonical implementation.
 */
export function createObservedMainHealthInputWithPolicyV1(input: {
  repository: string;
  mainSha: string;
  mainTreeSha: string;
  trustRevision: string;
  observedAt: string;
  expiresAt: string;
  sourceRunId: string;
  sourceRef: string;
  checks: readonly GitHubCheckObservationV1[];
  policy: MainHealthCheckProviderPolicyV1;
}): MainHealthLedgerInputV1 {
  const policy = input.policy;
  if (policy.schema !== MAIN_HEALTH_CHECK_PROVIDER_POLICY_SCHEMA_V1) {
    throw new Error('MainHealth provider policy schema is invalid.');
  }
  const app = canonicalApp(policy.app);
  const matching = input.checks.filter((check) => check.headSha === input.mainSha
    && check.name === policy.context
    && check.appId === app.id
    && check.appNodeId === app.nodeId
    && check.appSlug === app.slug
    && (policy.producer.kind === 'github-actions-workflow'
      ? matchesActionsProducerV1(check, policy.producer, input.mainSha)
      : matchesDirectAppProducerV1(check))).sort((left, right) => left.id - right.id);

  if (policy.producer.kind === 'github-app-check' && matching.length === 1
      && input.sourceRunId !== String(matching[0]!.id)) {
    throw new Error('MainHealth direct App sourceRunId must equal the exact observed check id.');
  }

  const successful = (check: GitHubCheckObservationV1): boolean =>
    check.status === policy.terminal.status && check.conclusion === policy.terminal.conclusion;
  const terminalConclusion = (check: GitHubCheckObservationV1): string | null =>
    check.status === policy.terminal.status
      && check.conclusion !== null
      && policy.terminal.recognizedConclusions.some((conclusion) => conclusion === check.conclusion)
      ? check.conclusion
      : null;

  // One exact provider check is the only producer. Duplicates, nonterminal
  // observations, and unrecognized outcomes remain ambiguous and fail closed.
  const selected = matching.length === 1 ? matching[0]! : null;
  const selectedConclusion = selected === null ? null : terminalConclusion(selected);
  const healthy = selected !== null && successful(selected);
  const degraded = selectedConclusion !== null && selectedConclusion !== policy.terminal.conclusion;
  const status = healthy ? 'healthy' as const : degraded ? 'degraded' as const : 'locked' as const;
  const degradedOutcome = selected === null ? null : policy.producer.kind === 'github-actions-workflow'
    ? Object.freeze({
        name: selected.name,
        status: selected.status,
        conclusion: selectedConclusion,
        headSha: selected.headSha
      })
    : Object.freeze({
        id: selected.id,
        name: selected.name,
        status: selected.status,
        conclusion: selectedConclusion,
        headSha: selected.headSha,
        appId: selected.appId
      });
  const fingerprints = healthy ? [] : [hash(degraded ? {
    status: 'main-health-check-failed',
    policyDigest: policy.policyDigest,
    outcome: degradedOutcome
  } : {
    status: 'main-health-policy-mismatch',
    policyDigest: policy.policyDigest,
    mainSha: input.mainSha,
    matching
  })];
  const repairWorkPackage = degraded ? createMainHealthRepairWorkPackagePathV1({
    repository: input.repository,
    defaultBranch: policy.branch,
    mainSha: input.mainSha,
    mainTreeSha: input.mainTreeSha,
    owner: policy.degraded.owner,
    failureFingerprints: fingerprints
  }) : null;
  return Object.freeze({
    repository: input.repository,
    defaultBranch: policy.branch,
    mainSha: input.mainSha,
    mainTreeSha: input.mainTreeSha,
    status,
    failureFingerprints: Object.freeze(fingerprints),
    owner: degraded ? policy.degraded.owner : null,
    repairWorkPackage,
    expiresAt: input.expiresAt,
    allowedLanes: healthy
      ? Object.freeze(['ordinary'] as const)
      : degraded
        ? policy.degraded.allowedLanes
        : policy.locked.allowedLanes,
    trustRevision: input.trustRevision,
    observedAt: input.observedAt,
    producer: Object.freeze({
      identity: 'platform/shared/default-branch-revision-health.ts',
      trustRevision: input.trustRevision,
      sourceTransport: 'github-api' as const,
      sourceRunId: input.sourceRunId,
      sourceRef: input.sourceRef,
      sourceDigest: hash({ policyDigest: policy.policyDigest, matching })
    })
  });
}

/** Existing Actions adapter preserved for current consumers. */
export function createObservedMainHealthInputV1(input: {
  repository: string;
  mainSha: string;
  mainTreeSha: string;
  trustRevision: string;
  observedAt: string;
  expiresAt: string;
  sourceRunId: string;
  sourceRef: string;
  checks: readonly GitHubCheckObservationV1[];
}): MainHealthLedgerInputV1 {
  return createObservedMainHealthInputWithPolicyV1({
    ...input,
    policy: GITHUB_ACTIONS_MAIN_HEALTH_CHECK_PROVIDER_POLICY_V1
  });
}
