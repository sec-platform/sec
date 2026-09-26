/** Canonical provider-checks to MainHealth-ledger input compiler. */


import { rawSha256Hex } from '../../../../contracts/canonical.ts';
import type { GitHubCheckObservation } from '../../../providers/github-api/contract.ts';
import { encodeVerificationActionData } from '../../../verification/platform/action/contract/action.ts';
import {
  createMainHealthRepairWorkPackagePath,
  DEFAULT_BRANCH_REVISION_HEALTH_PRODUCER_IDENTITY,
  type MainHealthLedgerInput
} from './contract.ts';
import { CI_MAIN_HEALTH_POLICY, CI_MAIN_HEALTH_POLICY_DIGEST, createCiMainHealthRequestOperationId } from './provider-policy.ts';

type Digest = `sha256:${string}`;

const MAIN_HEALTH_CHECK_PROVIDER_POLICY_SCHEMA =
  'sec-main-health-check-provider-policy-v1' as const;

/** One freshness budget for the registered hosted MainHealth producer. */
export const HOSTED_MAIN_HEALTH_FRESHNESS_MS = 10 * 60_000;

export type MainHealthCheckProviderPolicy = Readonly<{
  schema: typeof MAIN_HEALTH_CHECK_PROVIDER_POLICY_SCHEMA;
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
  return `sha256:${rawSha256Hex(encodeVerificationActionData(value))}`;
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

/** GitHub Actions policy projected into the canonical hosted matcher. */
export const GITHUB_ACTIONS_MAIN_HEALTH_CHECK_PROVIDER_POLICY: MainHealthCheckProviderPolicy =
  Object.freeze({
    schema: MAIN_HEALTH_CHECK_PROVIDER_POLICY_SCHEMA,
    policyRevision: CI_MAIN_HEALTH_POLICY.policyRevision,
    policyDigest: CI_MAIN_HEALTH_POLICY_DIGEST,
    context: CI_MAIN_HEALTH_POLICY.context,
    app: Object.freeze({
      id: CI_MAIN_HEALTH_POLICY.app.id,
      nodeId: CI_MAIN_HEALTH_POLICY.app.nodeId,
      slug: CI_MAIN_HEALTH_POLICY.app.slug
    }),
    branch: CI_MAIN_HEALTH_POLICY.producer.branch,
    producer: Object.freeze({
      kind: 'github-actions-workflow' as const,
      workflowPath: CI_MAIN_HEALTH_POLICY.producer.workflowPath,
      workflowRefFormat: CI_MAIN_HEALTH_POLICY.producer.workflowRefFormat,
      eventName: CI_MAIN_HEALTH_POLICY.producer.eventNames[0],
      runTitleFormat: CI_MAIN_HEALTH_POLICY.producer.runTitleFormats.repositoryDispatch
    }),
    terminal: Object.freeze({
      status: CI_MAIN_HEALTH_POLICY.terminal.status,
      conclusion: CI_MAIN_HEALTH_POLICY.terminal.conclusion,
      recognizedConclusions: CI_MAIN_HEALTH_POLICY.terminal.recognizedConclusions
    }),
    degraded: Object.freeze({
      owner: CI_MAIN_HEALTH_POLICY.degraded.owner,
      allowedLanes: CI_MAIN_HEALTH_POLICY.degraded.allowedLanes
    }),
    locked: Object.freeze({ allowedLanes: CI_MAIN_HEALTH_POLICY.locked.allowedLanes })
  });

/**
 * Static trust registry for hosted MainHealth principals. Observing an App on
 * GitHub never enrolls it. A dedicated App becomes authoritative only after
 * its exact id/nodeId/slug policy is added by this canonical owner.
 */
const HOSTED_MAIN_HEALTH_PROVIDER_POLICIES:
readonly MainHealthCheckProviderPolicy[] = Object.freeze([
  GITHUB_ACTIONS_MAIN_HEALTH_CHECK_PROVIDER_POLICY
]);

/**
 * Builds the exact policy for a dedicated SEC Integration/App principal. The
 * App check is the GitHub transport/readback projection; the trusted runtime
 * that owns the App credentials remains responsible for executing the actual
 * MainHealth closure before publishing it.
 */
export function createTrustedRuntimeMainHealthCheckProviderPolicy(input: Readonly<{
  policyRevision: string;
  app: Readonly<{ id: number; nodeId: string; slug: string }>;
}>): MainHealthCheckProviderPolicy {
  const semantic = Object.freeze({
    schema: MAIN_HEALTH_CHECK_PROVIDER_POLICY_SCHEMA,
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

function matchesActionsProducer(
  check: GitHubCheckObservation,
  policy: Extract<MainHealthCheckProviderPolicy['producer'], { kind: 'github-actions-workflow' }>,
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
  return operationId === createCiMainHealthRequestOperationId(mainSha);
}

function matchesDirectAppProducer(check: GitHubCheckObservation): boolean {
  return check.workflowPath === null
    && check.workflowRef === null
    && check.eventName === null
    && check.workflowRunId === null
    && check.workflowRunDisplayTitle === null;
}

/**
 * One exact hosted-provider admission predicate. Registration and ledger
 * compilation must consume this same decision; a check that merely shares a
 * context, App, and subject cannot enroll a provider before its producer
 * provenance has also matched.
 */
function matchesHostedMainHealthProvider(
  check: GitHubCheckObservation,
  policy: MainHealthCheckProviderPolicy,
  mainSha: string
): boolean {
  if (policy.schema !== MAIN_HEALTH_CHECK_PROVIDER_POLICY_SCHEMA) {
    throw new Error('MainHealth provider policy schema is invalid.');
  }
  const app = canonicalApp(policy.app);
  return check.headSha === mainSha
    && check.name === policy.context
    && check.appId === app.id
    && check.appNodeId === app.nodeId
    && check.appSlug === app.slug
    && (policy.producer.kind === 'github-actions-workflow'
      ? matchesActionsProducer(check, policy.producer, mainSha)
      : matchesDirectAppProducer(check));
}

/**
 * Single MainHealth ledger compiler. Provider-specific adapters authenticate
 * only the check producer; health/degraded/locked semantics and failure
 * fingerprinting remain one canonical implementation.
 */
export function createObservedMainHealthInputWithPolicy(input: {
  repository: string;
  mainSha: string;
  mainTreeSha: string;
  trustRevision: string;
  observedAt: string;
  expiresAt: string;
  sourceRunId: string;
  sourceRef: string;
  checks: readonly GitHubCheckObservation[];
  policy: MainHealthCheckProviderPolicy;
}): MainHealthLedgerInput {
  const policy = input.policy;
  if (policy.schema !== MAIN_HEALTH_CHECK_PROVIDER_POLICY_SCHEMA) {
    throw new Error('MainHealth provider policy schema is invalid.');
  }
  const matching = input.checks
    .filter((check) => matchesHostedMainHealthProvider(check, policy, input.mainSha))
    .sort((left, right) => left.id - right.id);

  if (matching.length === 1) {
    const expectedSourceRunId = policy.producer.kind === 'github-app-check'
      ? String(matching[0]!.id)
      : matching[0]!.workflowRunId;
    if (expectedSourceRunId === null || input.sourceRunId !== expectedSourceRunId) {
      throw new Error(
        'MainHealth sourceRunId must equal the exact observed check or workflow run id.'
      );
    }
  }

  const successful = (check: GitHubCheckObservation): boolean =>
    check.status === policy.terminal.status && check.conclusion === policy.terminal.conclusion;
  const terminalConclusion = (check: GitHubCheckObservation): string | null =>
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
  const repairWorkPackage = degraded ? createMainHealthRepairWorkPackagePath({
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
      identity: DEFAULT_BRANCH_REVISION_HEALTH_PRODUCER_IDENTITY,
      trustRevision: input.trustRevision,
      sourceTransport: 'github-api' as const,
      sourceRunId: input.sourceRunId,
      sourceRef: input.sourceRef,
      sourceDigest: hash({ policyDigest: policy.policyDigest, matching })
    })
  });
}

/**
 * Selects only source-registered hosted principals and compiles each through
 * the single hosted MainHealth matcher. Unknown same-name checks do
 * not gain authority and cannot invalidate an independent trusted provider.
 */
export function createRegisteredHostedMainHealthInputs(input: {
  repository: string;
  mainSha: string;
  mainTreeSha: string;
  trustRevision: string;
  observedAt: string;
  expiresAt: string;
  sourceRef: string;
  checks: readonly GitHubCheckObservation[];
}): readonly MainHealthLedgerInput[] {
  const presentPolicies = HOSTED_MAIN_HEALTH_PROVIDER_POLICIES.filter((policy) => (
    input.checks.some((check) => matchesHostedMainHealthProvider(check, policy, input.mainSha))
  ));
  return Object.freeze(presentPolicies.map((policy) => {
    const exactProviderChecks = input.checks
      .filter((check) => matchesHostedMainHealthProvider(check, policy, input.mainSha));
    return createObservedMainHealthInputWithPolicy({
      ...input,
      sourceRunId: exactProviderChecks.length === 1
        ? policy.producer.kind === 'github-app-check'
          ? String(exactProviderChecks[0]!.id)
          : exactProviderChecks[0]!.workflowRunId!
        : 'ambiguous-hosted-provider',
      policy
    });
  }));
}

/** Direct Actions adapter used by hosted verification consumers. */
export function createObservedMainHealthInput(input: {
  repository: string;
  mainSha: string;
  mainTreeSha: string;
  trustRevision: string;
  observedAt: string;
  expiresAt: string;
  sourceRunId: string;
  sourceRef: string;
  checks: readonly GitHubCheckObservation[];
}): MainHealthLedgerInput {
  return createObservedMainHealthInputWithPolicy({
    ...input,
    policy: GITHUB_ACTIONS_MAIN_HEALTH_CHECK_PROVIDER_POLICY
  });
}
