import { createHash } from 'node:crypto';

import {
  CI_GITHUB_ACTIONS_IDENTITY_POLICY_V1
} from '../../ci/index.ts';
import {
  encodeVerificationActionDataV2,
  type VerificationActionKeyDigest
} from '../index.ts';

export const VERIFICATION_ACTION_PROVIDER_POLICY_SCHEMA_V2 =
  'sec-verification-action-provider-policy-v2' as const;
export const VERIFICATION_ACTION_PROVIDER_STATUS_READBACK_SCHEMA_V2 =
  'sec-verification-action-provider-status-readback-v2' as const;
export const VERIFICATION_ACTION_PROVIDER_START_MARKER_SCHEMA_V2 =
  'sec-verification-action-start-marker-v2' as const;
export const VERIFICATION_ACTION_PROVIDER_TERMINAL_ANCHOR_SCHEMA_V2 =
  'sec-verification-action-terminal-status-anchor-v2' as const;
export const VERIFICATION_ACTION_PROVIDER_START_ARTIFACT_PREFIX_V2 =
  'sec-verification-action-start-v2' as const;
export const VERIFICATION_ACTION_PROVIDER_START_ARTIFACT_FILE_V2 =
  'verification-action-start-marker.json' as const;
export const VERIFICATION_ACTION_PROVIDER_TERMINAL_ARTIFACT_PREFIX_V2 =
  'sec-verification-action-v2' as const;
export const VERIFICATION_ACTION_PROVIDER_TERMINAL_ARTIFACT_FILE_V2 =
  'verification-action-terminal-artifact.json' as const;
export const VERIFICATION_ACTION_PROVIDER_TERMINAL_ANCHOR_PREFIX_V2 =
  'sec-verification-action-terminal-anchor-v2' as const;
export const VERIFICATION_ACTION_PROVIDER_TERMINAL_ANCHOR_FILE_V2 =
  'verification-action-terminal-status-anchor.json' as const;

export const VERIFICATION_ACTION_PROVIDER_POLICY_V2 = Object.freeze({
  schema: VERIFICATION_ACTION_PROVIDER_POLICY_SCHEMA_V2,
  contextPrefix: 'sec/action/' as const,
  contextCase: 'lowercase' as const,
  descriptionVersion: 'v2' as const,
  perPage: 100 as const,
  maximumStatusesPerShaContext: 1000 as const,
  creator: CI_GITHUB_ACTIONS_IDENTITY_POLICY_V1.bot,
  referencedOrigin: Object.freeze({
    workflowPath: '.github/workflows/compiler-pr-validation.yml' as const,
    eventName: 'repository_dispatch' as const,
    app: CI_GITHUB_ACTIONS_IDENTITY_POLICY_V1.app
  }),
  authority: Object.freeze({
    machineState: 'action-key-at-most-once-tombstone' as const,
    verificationResult: false as const,
    verificationEvidence: false as const,
    requiredCheck: false as const,
    mergeAuthorization: false as const,
    exactPosterProvenance: false as const,
    statusWriterTrust: 'trusted-base-tcb-census' as const
  })
});

export const VERIFICATION_ACTION_PROVIDER_POLICY_DIGEST_V2 = digest(
  VERIFICATION_ACTION_PROVIDER_POLICY_V2
) as VerificationActionKeyDigest;

export type VerificationActionProviderOriginV2 = Readonly<{
  repositoryId: number;
  repository: string;
  workflowPath: '.github/workflows/compiler-pr-validation.yml';
  workflowRef: string;
  workflowSha: string;
  runId: string;
  runAttempt: number;
  appId: number;
  appNodeId: string;
  sourceEvent: 'repository_dispatch';
}>;

export type VerificationActionProviderStatusCreatorV2 = Readonly<{
  login: string;
  id: number;
  nodeId: string;
  type: string;
}>;

export type VerificationActionProviderStatusObservationV2 = Readonly<{
  id: number;
  nodeId: string;
  state: 'error' | 'failure' | 'pending' | 'success';
  context: string;
  description: string;
  targetUrl: string;
  commitSha: string;
  createdAt: string;
  updatedAt: string;
  creator: VerificationActionProviderStatusCreatorV2;
  /**
   * Independent readback of the run referenced by targetUrl. The target URL is
   * caller-supplied and therefore this proves referenced-origin closure, not
   * the identity of the status POST caller.
   */
  referencedOrigin: VerificationActionProviderOriginV2;
}>;

export type VerificationActionProviderStatusReadbackV2 = Readonly<{
  schema: typeof VERIFICATION_ACTION_PROVIDER_STATUS_READBACK_SCHEMA_V2;
  providerPolicyDigest: typeof VERIFICATION_ACTION_PROVIDER_POLICY_DIGEST_V2;
  repositoryId: number;
  repository: string;
  actionKey: VerificationActionKeyDigest;
  candidateSha: string;
  context: string;
  perPage: 100;
  paginationComplete: true;
  pageDigests: readonly VerificationActionKeyDigest[];
  statuses: readonly VerificationActionProviderStatusObservationV2[];
  readbackDigest: VerificationActionKeyDigest;
}>;

export type VerificationActionProviderStartMarkerV2 = Readonly<{
  schema: typeof VERIFICATION_ACTION_PROVIDER_START_MARKER_SCHEMA_V2;
  providerPolicyDigest: typeof VERIFICATION_ACTION_PROVIDER_POLICY_DIGEST_V2;
  actionKey: VerificationActionKeyDigest;
  candidateSha: string;
  executionEnvironmentRevision: string;
  producer: VerificationActionProviderOriginV2;
  markerDigest: VerificationActionKeyDigest;
}>;

export type VerificationActionProviderArtifactObservationV2<TPayload> = Readonly<{
  originId: string;
  artifactName: string;
  archiveDigest: VerificationActionKeyDigest | null;
  expired: boolean;
  payload: TPayload | null;
  referencedOrigin: VerificationActionProviderOriginV2 | null;
}>;

export type VerificationActionProviderStartObservationV2 =
  VerificationActionProviderArtifactObservationV2<VerificationActionProviderStartMarkerV2>;

export type VerificationActionProviderTerminalFactV2 = Readonly<{
  actionKey: VerificationActionKeyDigest;
  candidateSha: string;
  payloadDigest: VerificationActionKeyDigest;
  producer: VerificationActionProviderOriginV2;
}>;

export type VerificationActionProviderTerminalObservationV2 =
  VerificationActionProviderArtifactObservationV2<VerificationActionProviderTerminalFactV2>;

export type VerificationActionProviderTerminalAnchorV2 = Readonly<{
  schema: typeof VERIFICATION_ACTION_PROVIDER_TERMINAL_ANCHOR_SCHEMA_V2;
  providerPolicyDigest: typeof VERIFICATION_ACTION_PROVIDER_POLICY_DIGEST_V2;
  actionKey: VerificationActionKeyDigest;
  candidateSha: string;
  startStatusId: number;
  startStatusNodeId: string;
  startArtifactOriginId: string;
  startArtifactName: string;
  startArtifactArchiveDigest: VerificationActionKeyDigest;
  startMarkerDigest: VerificationActionKeyDigest;
  terminalArtifactOriginId: string;
  terminalArtifactName: string;
  terminalArtifactArchiveDigest: VerificationActionKeyDigest;
  terminalArtifactPayloadDigest: VerificationActionKeyDigest;
  terminalAssemblerOrigin: VerificationActionProviderOriginV2;
  anchorPublisherOrigin: VerificationActionProviderOriginV2;
  anchorDigest: VerificationActionKeyDigest;
}>;

export type VerificationActionProviderTerminalAnchorObservationV2 =
  VerificationActionProviderArtifactObservationV2<VerificationActionProviderTerminalAnchorV2>;

export type VerificationActionProviderDecisionDispositionV2 =
  | 'start-allowed'
  | 'repair-terminal-anchor'
  | 'repair-terminal-status'
  | 'terminal-anchored'
  | 'blocked';

export type VerificationActionProviderDecisionV2 = Readonly<{
  actionKey: VerificationActionKeyDigest;
  disposition: VerificationActionProviderDecisionDispositionV2;
  physicalExecutionAllowed: boolean;
  terminalAnchorRepairAllowed: boolean;
  terminalStatusRepairAllowed: boolean;
  terminalPayloadDigest: VerificationActionKeyDigest | null;
  reason: string | null;
  decisionDigest: VerificationActionKeyDigest;
}>;

export type VerificationActionProviderStateInputV2 = Readonly<{
  repositoryId: number;
  repository: string;
  actionKey: VerificationActionKeyDigest;
  candidateSha: string;
  executionEnvironmentRevision: string;
  statusReadback: VerificationActionProviderStatusReadbackV2;
  startObservations: readonly VerificationActionProviderStartObservationV2[];
  terminalObservations: readonly VerificationActionProviderTerminalObservationV2[];
  terminalAnchorObservations: readonly VerificationActionProviderTerminalAnchorObservationV2[];
}>;

type ParsedStatusHistoryV2 = Readonly<{
  start: VerificationActionProviderStatusObservationV2 | null;
  terminal: VerificationActionProviderStatusObservationV2 | null;
  startMarkerDigest: VerificationActionKeyDigest | null;
  terminalAnchorDigest: VerificationActionKeyDigest | null;
}>;

function fail(message: string): never {
  throw new Error(`VerificationAction provider ${message}`);
}

function digest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(encodeVerificationActionDataV2(value)).digest('hex')}`;
}

function assertDigest(value: unknown, label: string): asserts value is VerificationActionKeyDigest {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)) fail(`${label} is invalid.`);
}

function assertSha(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/u.test(value)) fail(`${label} is invalid.`);
}

function assertExactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} has unknown or missing fields.`);
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function assertIso(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value) ||
      Number.isNaN(Date.parse(value))) fail(`${label} is invalid.`);
}

function canonicalOrigin(value: unknown, label: string): VerificationActionProviderOriginV2 {
  const origin = record(value, label);
  assertExactKeys(origin, [
    'repositoryId', 'repository', 'workflowPath', 'workflowRef', 'workflowSha', 'runId', 'runAttempt',
    'appId', 'appNodeId', 'sourceEvent'
  ], label);
  if (!Number.isSafeInteger(origin.repositoryId) || Number(origin.repositoryId) < 1 ||
      typeof origin.repository !== 'string' || !/^[^/\s]+\/[^/\s]+$/u.test(origin.repository) ||
      origin.workflowPath !== VERIFICATION_ACTION_PROVIDER_POLICY_V2.referencedOrigin.workflowPath ||
      typeof origin.workflowSha !== 'string' || !/^[0-9a-f]{40}$/u.test(origin.workflowSha) ||
      origin.workflowRef !== `${origin.workflowPath}@${origin.workflowSha}` ||
      typeof origin.runId !== 'string' || !/^[1-9][0-9]*$/u.test(origin.runId) ||
      !Number.isSafeInteger(origin.runAttempt) || Number(origin.runAttempt) < 1 ||
      origin.appId !== VERIFICATION_ACTION_PROVIDER_POLICY_V2.referencedOrigin.app.id ||
      origin.appNodeId !== VERIFICATION_ACTION_PROVIDER_POLICY_V2.referencedOrigin.app.nodeId ||
      origin.sourceEvent !== VERIFICATION_ACTION_PROVIDER_POLICY_V2.referencedOrigin.eventName) {
    fail(`${label} is not the canonical trusted workflow origin.`);
  }
  return Object.freeze(origin as unknown as VerificationActionProviderOriginV2);
}

function canonicalEquals(left: unknown, right: unknown): boolean {
  return encodeVerificationActionDataV2(left) === encodeVerificationActionDataV2(right);
}

export function verificationActionProviderStatusContextV2(actionKey: VerificationActionKeyDigest): string {
  assertDigest(actionKey, 'ActionKey');
  return `${VERIFICATION_ACTION_PROVIDER_POLICY_V2.contextPrefix}${actionKey.slice(7)}`;
}

export function verificationActionProviderStartDescriptionV2(markerDigest: VerificationActionKeyDigest): string {
  assertDigest(markerDigest, 'start marker digest');
  return `${VERIFICATION_ACTION_PROVIDER_POLICY_V2.descriptionVersion} start ${markerDigest}`;
}

export function verificationActionProviderTerminalDescriptionV2(anchorDigest: VerificationActionKeyDigest): string {
  assertDigest(anchorDigest, 'terminal anchor digest');
  return `${VERIFICATION_ACTION_PROVIDER_POLICY_V2.descriptionVersion} terminal ${anchorDigest}`;
}

export function verificationActionProviderRunTargetUrlV2(origin: VerificationActionProviderOriginV2): string {
  const canonical = canonicalOrigin(origin, 'target origin');
  return `https://github.com/${canonical.repository}/actions/runs/${canonical.runId}/attempts/${canonical.runAttempt}`;
}

export function verificationActionProviderStartArtifactNameV2(actionKey: VerificationActionKeyDigest): string {
  assertDigest(actionKey, 'start artifact ActionKey');
  return `${VERIFICATION_ACTION_PROVIDER_START_ARTIFACT_PREFIX_V2}-${actionKey.slice(7)}`;
}

export function verificationActionProviderTerminalArtifactNameV2(actionKey: VerificationActionKeyDigest): string {
  assertDigest(actionKey, 'terminal artifact ActionKey');
  return `${VERIFICATION_ACTION_PROVIDER_TERMINAL_ARTIFACT_PREFIX_V2}-${actionKey.slice(7)}`;
}

export function verificationActionProviderTerminalAnchorNameV2(actionKey: VerificationActionKeyDigest): string {
  assertDigest(actionKey, 'terminal anchor ActionKey');
  return `${VERIFICATION_ACTION_PROVIDER_TERMINAL_ANCHOR_PREFIX_V2}-${actionKey.slice(7)}`;
}

export function createVerificationActionProviderStartMarkerV2(input: Omit<
  VerificationActionProviderStartMarkerV2,
  'schema' | 'providerPolicyDigest' | 'markerDigest'
>): VerificationActionProviderStartMarkerV2 {
  assertDigest(input.actionKey, 'start marker ActionKey');
  assertSha(input.candidateSha, 'start marker candidate SHA');
  if (typeof input.executionEnvironmentRevision !== 'string' || input.executionEnvironmentRevision.length < 1) {
    fail('start marker execution environment is invalid.');
  }
  const producer = canonicalOrigin(input.producer, 'start marker producer');
  const withoutDigest = Object.freeze({
    schema: VERIFICATION_ACTION_PROVIDER_START_MARKER_SCHEMA_V2,
    providerPolicyDigest: VERIFICATION_ACTION_PROVIDER_POLICY_DIGEST_V2,
    actionKey: input.actionKey,
    candidateSha: input.candidateSha,
    executionEnvironmentRevision: input.executionEnvironmentRevision,
    producer
  });
  return Object.freeze({ ...withoutDigest, markerDigest: digest(withoutDigest) as VerificationActionKeyDigest });
}

export function parseVerificationActionProviderStartMarkerV2(
  value: unknown
): VerificationActionProviderStartMarkerV2 {
  const marker = record(value, 'start marker');
  assertExactKeys(marker, [
    'schema', 'providerPolicyDigest', 'actionKey', 'candidateSha', 'executionEnvironmentRevision',
    'producer', 'markerDigest'
  ], 'start marker');
  if (marker.schema !== VERIFICATION_ACTION_PROVIDER_START_MARKER_SCHEMA_V2 ||
      marker.providerPolicyDigest !== VERIFICATION_ACTION_PROVIDER_POLICY_DIGEST_V2) {
    fail('start marker schema or policy mismatch.');
  }
  assertDigest(marker.markerDigest, 'start marker digest');
  const rebuilt = createVerificationActionProviderStartMarkerV2({
    actionKey: marker.actionKey as VerificationActionKeyDigest,
    candidateSha: marker.candidateSha as string,
    executionEnvironmentRevision: marker.executionEnvironmentRevision as string,
    producer: marker.producer as VerificationActionProviderOriginV2
  });
  if (rebuilt.markerDigest !== marker.markerDigest) fail('start marker digest mismatch.');
  return rebuilt;
}

export function finalizeVerificationActionProviderStatusReadbackV2(input: Omit<
  VerificationActionProviderStatusReadbackV2,
  'schema' | 'providerPolicyDigest' | 'readbackDigest'
>): VerificationActionProviderStatusReadbackV2 {
  const withoutDigest = Object.freeze({
    schema: VERIFICATION_ACTION_PROVIDER_STATUS_READBACK_SCHEMA_V2,
    providerPolicyDigest: VERIFICATION_ACTION_PROVIDER_POLICY_DIGEST_V2,
    ...input,
    pageDigests: Object.freeze([...input.pageDigests]),
    statuses: Object.freeze([...input.statuses])
  });
  const readback = Object.freeze({
    ...withoutDigest,
    readbackDigest: digest(withoutDigest) as VerificationActionKeyDigest
  });
  parseVerificationActionProviderStatusReadbackV2(readback);
  return readback;
}

export function parseVerificationActionProviderStatusReadbackV2(
  value: unknown
): VerificationActionProviderStatusReadbackV2 {
  const readback = record(value, 'status readback');
  assertExactKeys(readback, [
    'schema', 'providerPolicyDigest', 'repositoryId', 'repository', 'actionKey', 'candidateSha',
    'context', 'perPage', 'paginationComplete', 'pageDigests', 'statuses', 'readbackDigest'
  ], 'status readback');
  if (readback.schema !== VERIFICATION_ACTION_PROVIDER_STATUS_READBACK_SCHEMA_V2 ||
      readback.providerPolicyDigest !== VERIFICATION_ACTION_PROVIDER_POLICY_DIGEST_V2 ||
      !Number.isSafeInteger(readback.repositoryId) || Number(readback.repositoryId) < 1 ||
      typeof readback.repository !== 'string' || !/^[^/\s]+\/[^/\s]+$/u.test(readback.repository) ||
      readback.perPage !== 100 || readback.paginationComplete !== true ||
      !Array.isArray(readback.pageDigests) || readback.pageDigests.length < 1 ||
      !Array.isArray(readback.statuses) || readback.statuses.length >
        VERIFICATION_ACTION_PROVIDER_POLICY_V2.maximumStatusesPerShaContext) {
    fail('status readback identity or pagination is invalid.');
  }
  assertDigest(readback.actionKey, 'status readback ActionKey');
  assertSha(readback.candidateSha, 'status readback candidate SHA');
  assertDigest(readback.readbackDigest, 'status readback digest');
  if (readback.context !== verificationActionProviderStatusContextV2(readback.actionKey) ||
      readback.context !== readback.context.toLowerCase()) fail('status readback context mismatch.');
  const pageDigests = Object.freeze(readback.pageDigests.map((entry, index) => {
    assertDigest(entry, `status page digest[${index}]`);
    return entry;
  }));
  if (new Set(pageDigests).size !== pageDigests.length) fail('status pagination repeats one page digest.');
  const statuses = Object.freeze(readback.statuses.map((entry, index) =>
    canonicalStatus(entry, index, {
      repositoryId: Number(readback.repositoryId),
      repository: readback.repository as string,
      actionKey: readback.actionKey as VerificationActionKeyDigest,
      candidateSha: readback.candidateSha as string
    })
  ));
  const withoutDigest = Object.freeze({
    schema: VERIFICATION_ACTION_PROVIDER_STATUS_READBACK_SCHEMA_V2,
    providerPolicyDigest: VERIFICATION_ACTION_PROVIDER_POLICY_DIGEST_V2,
    repositoryId: Number(readback.repositoryId),
    repository: readback.repository as string,
    actionKey: readback.actionKey as VerificationActionKeyDigest,
    candidateSha: readback.candidateSha as string,
    context: readback.context as string,
    perPage: 100 as const,
    paginationComplete: true as const,
    pageDigests,
    statuses
  });
  if (digest(withoutDigest) !== readback.readbackDigest) fail('status readback digest mismatch.');
  return Object.freeze({ ...withoutDigest, readbackDigest: readback.readbackDigest });
}

function canonicalStatus(
  value: unknown,
  index: number,
  expected: Readonly<{
    repositoryId: number;
    repository: string;
    actionKey: VerificationActionKeyDigest;
    candidateSha: string;
  }>
): VerificationActionProviderStatusObservationV2 {
  const status = record(value, `status[${index}]`);
  assertExactKeys(status, [
    'id', 'nodeId', 'state', 'context', 'description', 'targetUrl', 'commitSha', 'createdAt',
    'updatedAt', 'creator', 'referencedOrigin'
  ], `status[${index}]`);
  const creator = record(status.creator, `status[${index}].creator`);
  assertExactKeys(creator, ['login', 'id', 'nodeId', 'type'], `status[${index}].creator`);
  const expectedCreator = VERIFICATION_ACTION_PROVIDER_POLICY_V2.creator;
  if (!Number.isSafeInteger(status.id) || Number(status.id) < 1 ||
      typeof status.nodeId !== 'string' || status.nodeId.length < 1 ||
      !['error', 'failure', 'pending', 'success'].includes(String(status.state)) ||
      status.context !== verificationActionProviderStatusContextV2(expected.actionKey) ||
      typeof status.description !== 'string' || status.description.length > 140 ||
      status.commitSha !== expected.candidateSha ||
      creator.login !== expectedCreator.login || creator.id !== expectedCreator.id ||
      creator.nodeId !== expectedCreator.nodeId || creator.type !== expectedCreator.type) {
    fail(`status[${index}] canonical fields are invalid.`);
  }
  assertIso(status.createdAt, `status[${index}].createdAt`);
  assertIso(status.updatedAt, `status[${index}].updatedAt`);
  if (status.updatedAt !== status.createdAt) fail(`status[${index}] was mutated after append.`);
  const referencedOrigin = canonicalOrigin(status.referencedOrigin, `status[${index}].referencedOrigin`);
  if (referencedOrigin.repositoryId !== expected.repositoryId ||
      referencedOrigin.repository !== expected.repository ||
      status.targetUrl !== verificationActionProviderRunTargetUrlV2(referencedOrigin)) {
    fail(`status[${index}] referenced-origin closure mismatch.`);
  }
  return Object.freeze({
    id: Number(status.id),
    nodeId: status.nodeId,
    state: status.state as VerificationActionProviderStatusObservationV2['state'],
    context: status.context as string,
    description: status.description,
    targetUrl: status.targetUrl as string,
    commitSha: status.commitSha as string,
    createdAt: status.createdAt,
    updatedAt: status.updatedAt,
    creator: Object.freeze({
      login: creator.login as string,
      id: Number(creator.id),
      nodeId: creator.nodeId as string,
      type: creator.type as string
    }),
    referencedOrigin
  });
}

export function createVerificationActionProviderTerminalAnchorV2(input: Omit<
  VerificationActionProviderTerminalAnchorV2,
  'schema' | 'providerPolicyDigest' | 'anchorDigest'
>): VerificationActionProviderTerminalAnchorV2 {
  assertDigest(input.actionKey, 'terminal anchor ActionKey');
  assertSha(input.candidateSha, 'terminal anchor candidate SHA');
  if (!Number.isSafeInteger(input.startStatusId) || input.startStatusId < 1 ||
      typeof input.startStatusNodeId !== 'string' || input.startStatusNodeId.length < 1 ||
      !/^[1-9][0-9]*$/u.test(input.startArtifactOriginId) ||
      input.startArtifactName !== verificationActionProviderStartArtifactNameV2(input.actionKey) ||
      !/^[1-9][0-9]*$/u.test(input.terminalArtifactOriginId) ||
      input.terminalArtifactName !== verificationActionProviderTerminalArtifactNameV2(input.actionKey)) {
    fail('terminal anchor identity is invalid.');
  }
  for (const [label, value] of Object.entries({
    startArtifactArchiveDigest: input.startArtifactArchiveDigest,
    startMarkerDigest: input.startMarkerDigest,
    terminalArtifactArchiveDigest: input.terminalArtifactArchiveDigest,
    terminalArtifactPayloadDigest: input.terminalArtifactPayloadDigest
  })) assertDigest(value, `terminal anchor ${label}`);
  const terminalAssemblerOrigin = canonicalOrigin(
    input.terminalAssemblerOrigin,
    'terminal anchor assembler origin'
  );
  const anchorPublisherOrigin = canonicalOrigin(
    input.anchorPublisherOrigin,
    'terminal anchor publisher origin'
  );
  const withoutDigest = Object.freeze({
    schema: VERIFICATION_ACTION_PROVIDER_TERMINAL_ANCHOR_SCHEMA_V2,
    providerPolicyDigest: VERIFICATION_ACTION_PROVIDER_POLICY_DIGEST_V2,
    ...input,
    terminalAssemblerOrigin,
    anchorPublisherOrigin
  });
  return Object.freeze({ ...withoutDigest, anchorDigest: digest(withoutDigest) as VerificationActionKeyDigest });
}

export function parseVerificationActionProviderTerminalAnchorV2(
  value: unknown
): VerificationActionProviderTerminalAnchorV2 {
  const anchor = record(value, 'terminal anchor');
  assertExactKeys(anchor, [
    'schema', 'providerPolicyDigest', 'actionKey', 'candidateSha', 'startStatusId', 'startStatusNodeId',
    'startArtifactOriginId', 'startArtifactName', 'startArtifactArchiveDigest', 'startMarkerDigest',
    'terminalArtifactOriginId', 'terminalArtifactName', 'terminalArtifactArchiveDigest',
    'terminalArtifactPayloadDigest', 'terminalAssemblerOrigin', 'anchorPublisherOrigin',
    'anchorDigest'
  ], 'terminal anchor');
  if (anchor.schema !== VERIFICATION_ACTION_PROVIDER_TERMINAL_ANCHOR_SCHEMA_V2 ||
      anchor.providerPolicyDigest !== VERIFICATION_ACTION_PROVIDER_POLICY_DIGEST_V2) {
    fail('terminal anchor schema or policy mismatch.');
  }
  assertDigest(anchor.anchorDigest, 'terminal anchor digest');
  const rebuilt = createVerificationActionProviderTerminalAnchorV2({
    actionKey: anchor.actionKey as VerificationActionKeyDigest,
    candidateSha: anchor.candidateSha as string,
    startStatusId: Number(anchor.startStatusId),
    startStatusNodeId: anchor.startStatusNodeId as string,
    startArtifactOriginId: anchor.startArtifactOriginId as string,
    startArtifactName: anchor.startArtifactName as string,
    startArtifactArchiveDigest: anchor.startArtifactArchiveDigest as VerificationActionKeyDigest,
    startMarkerDigest: anchor.startMarkerDigest as VerificationActionKeyDigest,
    terminalArtifactOriginId: anchor.terminalArtifactOriginId as string,
    terminalArtifactName: anchor.terminalArtifactName as string,
    terminalArtifactArchiveDigest: anchor.terminalArtifactArchiveDigest as VerificationActionKeyDigest,
    terminalArtifactPayloadDigest: anchor.terminalArtifactPayloadDigest as VerificationActionKeyDigest,
    terminalAssemblerOrigin: anchor.terminalAssemblerOrigin as VerificationActionProviderOriginV2,
    anchorPublisherOrigin: anchor.anchorPublisherOrigin as VerificationActionProviderOriginV2
  });
  if (rebuilt.anchorDigest !== anchor.anchorDigest) fail('terminal anchor digest mismatch.');
  return rebuilt;
}

function parseStatusHistory(readback: VerificationActionProviderStatusReadbackV2): ParsedStatusHistoryV2 {
  const ids = new Set<number>();
  const nodeIds = new Set<string>();
  let start: VerificationActionProviderStatusObservationV2 | null = null;
  let terminal: VerificationActionProviderStatusObservationV2 | null = null;
  let startMarkerDigest: VerificationActionKeyDigest | null = null;
  let terminalAnchorDigest: VerificationActionKeyDigest | null = null;
  for (const status of readback.statuses) {
    if (ids.has(status.id) || nodeIds.has(status.nodeId)) fail('status history contains a duplicate identity.');
    ids.add(status.id);
    nodeIds.add(status.nodeId);
    if (status.state === 'pending') {
      const match = /^v2 start (sha256:[0-9a-f]{64})$/u.exec(status.description);
      if (match === null || start !== null ||
          status.description !== verificationActionProviderStartDescriptionV2(match[1] as VerificationActionKeyDigest)) {
        fail('status history contains a malformed or duplicate start tombstone.');
      }
      start = status;
      startMarkerDigest = match[1] as VerificationActionKeyDigest;
      continue;
    }
    if (status.state !== 'success') {
      fail('status history contains a non-neutral terminal or unknown state.');
    }
    const match = /^v2 terminal (sha256:[0-9a-f]{64})$/u.exec(status.description);
    if (match === null || terminal !== null ||
        status.description !== verificationActionProviderTerminalDescriptionV2(match[1] as VerificationActionKeyDigest)) {
      fail('status history contains a malformed or duplicate terminal tombstone.');
    }
    terminal = status;
    terminalAnchorDigest = match[1] as VerificationActionKeyDigest;
  }
  if (terminal !== null && start === null) fail('terminal tombstone has no start tombstone.');
  if (start !== null && terminal !== null &&
      terminal.createdAt < start.createdAt) {
    fail('terminal tombstone timestamp predates the durable start observation.');
  }
  return Object.freeze({ start, terminal, startMarkerDigest, terminalAnchorDigest });
}

function canonicalArtifactObservation<TPayload>(
  observations: readonly VerificationActionProviderArtifactObservationV2<TPayload>[],
  expectedName: string,
  label: string
): VerificationActionProviderArtifactObservationV2<TPayload> | null {
  if (!Array.isArray(observations)) fail(`${label} observations are not an array.`);
  if (observations.length > 1) fail(`${label} has multiple immutable origins.`);
  const observation = observations[0] ?? null;
  if (observation === null) return null;
  if (!/^[1-9][0-9]*$/u.test(observation.originId) || observation.artifactName !== expectedName ||
      typeof observation.expired !== 'boolean') fail(`${label} provider identity is invalid.`);
  if (observation.expired) return observation;
  if (observation.archiveDigest === null || observation.payload === null || observation.referencedOrigin === null) {
    fail(`${label} active origin is missing authenticated bytes or provenance.`);
  }
  assertDigest(observation.archiveDigest, `${label} archive digest`);
  canonicalOrigin(observation.referencedOrigin, `${label} referenced origin`);
  return observation;
}

function decision(
  actionKey: VerificationActionKeyDigest,
  disposition: VerificationActionProviderDecisionDispositionV2,
  terminalPayloadDigest: VerificationActionKeyDigest | null,
  reason: string | null
): VerificationActionProviderDecisionV2 {
  const withoutDigest = Object.freeze({
    actionKey,
    disposition,
    physicalExecutionAllowed: disposition === 'start-allowed',
    terminalAnchorRepairAllowed: disposition === 'repair-terminal-anchor',
    terminalStatusRepairAllowed: disposition === 'repair-terminal-status',
    terminalPayloadDigest,
    reason
  });
  return Object.freeze({ ...withoutDigest, decisionDigest: digest(withoutDigest) as VerificationActionKeyDigest });
}

export function reduceVerificationActionProviderStateV2(
  input: VerificationActionProviderStateInputV2
): VerificationActionProviderDecisionV2 {
  if (!Number.isSafeInteger(input.repositoryId) || input.repositoryId < 1 ||
      !/^[^/\s]+\/[^/\s]+$/u.test(input.repository)) fail('repository identity is invalid.');
  assertDigest(input.actionKey, 'ActionKey');
  assertSha(input.candidateSha, 'candidate SHA');
  if (typeof input.executionEnvironmentRevision !== 'string' || input.executionEnvironmentRevision.length < 1) {
    fail('execution environment revision is invalid.');
  }
  const readback = parseVerificationActionProviderStatusReadbackV2(input.statusReadback);
  if (readback.repositoryId !== input.repositoryId || readback.repository !== input.repository ||
      readback.actionKey !== input.actionKey || readback.candidateSha !== input.candidateSha) {
    fail('status readback differs from the trusted resolution.');
  }
  const history = parseStatusHistory(readback);
  const startObservation = canonicalArtifactObservation(
    input.startObservations,
    verificationActionProviderStartArtifactNameV2(input.actionKey),
    'start artifact'
  );
  const terminalObservation = canonicalArtifactObservation(
    input.terminalObservations,
    verificationActionProviderTerminalArtifactNameV2(input.actionKey),
    'terminal artifact'
  );
  const anchorObservation = canonicalArtifactObservation(
    input.terminalAnchorObservations,
    verificationActionProviderTerminalAnchorNameV2(input.actionKey),
    'terminal anchor artifact'
  );

  if (history.start === null) {
    if (startObservation !== null || terminalObservation !== null || anchorObservation !== null) {
      return decision(input.actionKey, 'blocked', null,
        'artifact state exists without the durable provider start tombstone');
    }
    return decision(input.actionKey, 'start-allowed', null, null);
  }

  if (startObservation === null || startObservation.expired || startObservation.payload === null ||
      startObservation.archiveDigest === null || startObservation.referencedOrigin === null) {
    return decision(input.actionKey, 'blocked', null,
      'durable start tombstone has no current authenticated start artifact');
  }
  const startMarker = parseVerificationActionProviderStartMarkerV2(startObservation.payload);
  if (history.startMarkerDigest !== startMarker.markerDigest || startMarker.actionKey !== input.actionKey ||
      startMarker.candidateSha !== input.candidateSha ||
      startMarker.executionEnvironmentRevision !== input.executionEnvironmentRevision ||
      !canonicalEquals(startMarker.producer, startObservation.referencedOrigin) ||
      !canonicalEquals(startMarker.producer, history.start.referencedOrigin)) {
    fail('start tombstone, marker bytes, and referenced origin conflict.');
  }

  if (terminalObservation === null || terminalObservation.expired || terminalObservation.payload === null ||
      terminalObservation.archiveDigest === null || terminalObservation.referencedOrigin === null) {
    return decision(input.actionKey, 'blocked', null,
      history.terminal === null
        ? 'start tombstone exists without an authenticated terminal artifact; outcome is unknown'
        : 'terminal tombstone exists but its authenticated artifact is missing or retained out');
  }
  const terminal = terminalObservation.payload;
  assertDigest(terminal.payloadDigest, 'terminal payload digest');
  if (terminal.actionKey !== input.actionKey || terminal.candidateSha !== input.candidateSha ||
      !canonicalEquals(terminal.producer, terminalObservation.referencedOrigin) ||
      !canonicalEquals(terminal.producer, startMarker.producer)) {
    fail('terminal artifact fact differs from the trusted start and candidate.');
  }

  if (anchorObservation === null) {
    if (history.terminal === null) {
      return decision(input.actionKey, 'repair-terminal-anchor', terminal.payloadDigest,
        'authenticated terminal origin exists; only its post-upload anchor and neutral tombstone may be repaired');
    }
    return decision(input.actionKey, 'blocked', terminal.payloadDigest,
      'terminal tombstone exists without its canonical post-upload anchor artifact');
  }
  if (anchorObservation.expired || anchorObservation.payload === null ||
      anchorObservation.archiveDigest === null || anchorObservation.referencedOrigin === null) {
    return decision(input.actionKey, 'blocked', terminal.payloadDigest,
      'post-upload terminal anchor exists but its authenticated bytes are missing or retained out');
  }
  const anchor = parseVerificationActionProviderTerminalAnchorV2(anchorObservation.payload);
  if (anchor.actionKey !== input.actionKey || anchor.candidateSha !== input.candidateSha ||
      anchor.startStatusId !== history.start.id || anchor.startStatusNodeId !== history.start.nodeId ||
      anchor.startArtifactOriginId !== startObservation.originId ||
      anchor.startArtifactName !== startObservation.artifactName ||
      anchor.startArtifactArchiveDigest !== startObservation.archiveDigest ||
      anchor.startMarkerDigest !== startMarker.markerDigest ||
      anchor.terminalArtifactOriginId !== terminalObservation.originId ||
      anchor.terminalArtifactName !== terminalObservation.artifactName ||
      anchor.terminalArtifactArchiveDigest !== terminalObservation.archiveDigest ||
      anchor.terminalArtifactPayloadDigest !== terminal.payloadDigest ||
      !canonicalEquals(anchor.terminalAssemblerOrigin, terminal.producer) ||
      !canonicalEquals(anchor.anchorPublisherOrigin, anchorObservation.referencedOrigin)) {
    fail('terminal anchor does not bind the exact start, terminal artifact, and assembler origin.');
  }

  if (history.terminal === null) {
    return decision(input.actionKey, 'repair-terminal-status', terminal.payloadDigest,
      'authenticated terminal origin exists; only the neutral terminal tombstone may be repaired');
  }
  if (history.terminalAnchorDigest !== anchor.anchorDigest) {
    fail('terminal tombstone differs from the canonical terminal anchor digest.');
  }
  return decision(input.actionKey, 'terminal-anchored', terminal.payloadDigest, null);
}
