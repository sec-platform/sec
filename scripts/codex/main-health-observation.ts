/** Canonical provider-checks to MainHealth-ledger input compiler. */

import { createHash } from 'node:crypto';

import {
  CI_MAIN_HEALTH_POLICY_DIGEST_V1,
  CI_MAIN_HEALTH_POLICY_V1
} from '../../platform/shared/ci-verification-revision.ts';
import {
  createMainHealthRepairWorkPackagePathV1,
  type MainHealthLedgerInputV1
} from '../../platform/shared/main-health-contract.ts';
import { encodeVerificationActionDataV2 } from '../../platform/shared/verification-action-contract.ts';
import type { GitHubCheckObservationV1 } from './verification-session-github.ts';

type Digest = `sha256:${string}`;

function hash(value: unknown): Digest {
  return `sha256:${createHash('sha256').update(encodeVerificationActionDataV2(value)).digest('hex')}`;
}

/**
 * Compiles exactly one normalized provider check inventory into MainHealth
 * input. This is the sole owner of producer matching, ambiguity handling,
 * failure fingerprinting, and repair-locator derivation; callers only observe
 * checks and consume the resulting ledger input.
 */
export function createObservedMainHealthInputV1(input: {
  repository: string; mainSha: string; mainTreeSha: string; trustRevision: string;
  observedAt: string; expiresAt: string; sourceRunId: string; sourceRef: string;
  checks: readonly GitHubCheckObservationV1[];
}): MainHealthLedgerInputV1 {
  const expectedRef = CI_MAIN_HEALTH_POLICY_V1.producer.workflowRefFormat.replace('<exact-main-sha>', input.mainSha);
  const eventRank = (eventName: string | null): number =>
    CI_MAIN_HEALTH_POLICY_V1.producer.eventNames.findIndex((candidate) => candidate === eventName);
  const matching = input.checks.filter((check) => check.headSha === input.mainSha
    && check.name === CI_MAIN_HEALTH_POLICY_V1.context
    && check.appId === CI_MAIN_HEALTH_POLICY_V1.app.id
    && check.appNodeId === CI_MAIN_HEALTH_POLICY_V1.app.nodeId
    && check.appSlug === CI_MAIN_HEALTH_POLICY_V1.app.slug
    && check.workflowPath === CI_MAIN_HEALTH_POLICY_V1.producer.workflowPath
    && check.workflowRef === expectedRef
    && CI_MAIN_HEALTH_POLICY_V1.producer.eventNames.some(
      (eventName) => check.eventName === eventName
    )).sort((left, right) => eventRank(left.eventName) - eventRank(right.eventName) || left.id - right.id);
  const successful = (check: GitHubCheckObservationV1): boolean =>
    check.status === CI_MAIN_HEALTH_POLICY_V1.terminal.status
      && check.conclusion === CI_MAIN_HEALTH_POLICY_V1.terminal.conclusion;
  const terminalConclusion = (check: GitHubCheckObservationV1): string | null =>
    check.status === CI_MAIN_HEALTH_POLICY_V1.terminal.status
      && check.conclusion !== null
      && CI_MAIN_HEALTH_POLICY_V1.terminal.recognizedConclusions.some(
        (conclusion) => conclusion === check.conclusion
      )
      ? check.conclusion
      : null;
  const canonicalTerminalConclusion = matching.length > 0 ? terminalConclusion(matching[0]!) : null;
  const uniqueEventEquivalentTerminalProducers = matching.length > 1
    && new Set(matching.map((check) => check.eventName)).size === matching.length
    && canonicalTerminalConclusion !== null
    && matching.every((check) => terminalConclusion(check) === canonicalTerminalConclusion);
  // eventNames is the canonical producer priority. One observation per allowed
  // event may converge only when every producer reports the same terminal
  // status/conclusion outcome. Same-event duplicates, nonterminal observations,
  // and conflicting conclusions remain ambiguous and fail closed.
  const selected = matching.length === 1 || uniqueEventEquivalentTerminalProducers ? matching[0]! : null;
  const selectedConclusion = selected === null ? null : terminalConclusion(selected);
  const healthy = selected !== null && successful(selected);
  const degraded = selectedConclusion !== null
    && selectedConclusion !== CI_MAIN_HEALTH_POLICY_V1.terminal.conclusion;
  const status = healthy ? 'healthy' as const : degraded ? 'degraded' as const : 'locked' as const;
  const fingerprints = healthy ? [] : [hash(degraded ? {
    status: 'main-health-check-failed', policyDigest: CI_MAIN_HEALTH_POLICY_DIGEST_V1,
    outcome: { name: selected!.name, status: selected!.status,
      conclusion: selectedConclusion, headSha: selected!.headSha }
  } : { status: 'main-health-policy-mismatch', policyDigest: CI_MAIN_HEALTH_POLICY_DIGEST_V1,
    mainSha: input.mainSha, matching })];
  const repairWorkPackage = degraded ? createMainHealthRepairWorkPackagePathV1({
    repository: input.repository,
    defaultBranch: CI_MAIN_HEALTH_POLICY_V1.producer.branch,
    mainSha: input.mainSha,
    mainTreeSha: input.mainTreeSha,
    owner: CI_MAIN_HEALTH_POLICY_V1.degraded.owner,
    failureFingerprints: fingerprints
  }) : null;
  return Object.freeze({
    repository: input.repository, defaultBranch: 'main', mainSha: input.mainSha, mainTreeSha: input.mainTreeSha,
    status, failureFingerprints: Object.freeze(fingerprints),
    owner: degraded ? CI_MAIN_HEALTH_POLICY_V1.degraded.owner : null,
    repairWorkPackage,
    expiresAt: input.expiresAt, allowedLanes: healthy ? Object.freeze(['ordinary'] as const)
      : degraded ? CI_MAIN_HEALTH_POLICY_V1.degraded.allowedLanes : CI_MAIN_HEALTH_POLICY_V1.locked.allowedLanes,
    trustRevision: input.trustRevision, observedAt: input.observedAt,
    producer: Object.freeze({ identity: 'platform/shared/default-branch-revision-health.ts',
      trustRevision: input.trustRevision, sourceTransport: 'github-api' as const, sourceRunId: input.sourceRunId,
      sourceRef: input.sourceRef, sourceDigest: hash({ policyDigest: CI_MAIN_HEALTH_POLICY_DIGEST_V1, matching }) })
  });
}
