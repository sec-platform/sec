import { createHash } from 'node:crypto';

export const SEC_INSTRUCTION_PROVENANCE_CLASSES = [
  'canonical-main-authority',
  'derived-analysis',
  'external-untrusted',
  'historical',
  'machine-fact',
  'maintainer-intent'
] as const;

export type SecInstructionProvenanceClass =
  (typeof SEC_INSTRUCTION_PROVENANCE_CLASSES)[number];

export const SEC_EXTERNAL_ADOPTION_DISPOSITIONS = [
  'adapt',
  'adopt',
  'defer',
  'reject'
] as const;

export type SecExternalAdoptionDisposition =
  (typeof SEC_EXTERNAL_ADOPTION_DISPOSITIONS)[number];

export type SecMaintainerPermission = 'admin' | 'maintain';

export type SecMaintainerAdoptionRecordV1 = Readonly<{
  acceptance: readonly string[];
  authorizedBy: Readonly<{
    login: string;
    permission: SecMaintainerPermission;
  }>;
  containsExternalText: false;
  createdAt: string;
  decision: SecExternalAdoptionDisposition;
  forbidden: readonly string[];
  normalizedIntent: string;
  normalizationMethod: 'independent-restatement-v1';
  provenance: 'maintainer-intent';
  recordId: string;
  schema: 'sec-maintainer-adoption-record-v1';
  source: Readonly<{
    commentId?: number;
    digest: string;
    kind: 'discussion' | 'issue' | 'pull-request' | 'review-comment';
    number: number;
    repository: string;
  }>;
}>;

export type SecTrustedRepositoryIdentityV1 = Readonly<{
  defaultHead: string;
  fullName: string;
  id: number;
}>;

export type SecMaintainerAuthorizationObservationV1 = Readonly<{
  adoptionRecordDigest: string;
  defaultHead: string;
  evidenceDigest: string;
  login: string;
  observedAt: string;
  permission: SecMaintainerPermission;
  repository: string;
  repositoryId: number;
  schema: 'sec-maintainer-authorization-observation-v1';
  source: 'trusted-github-collaborator-permission-api';
  userId: number;
}>;

export type SecAuthorizedMaintainerAdoptionV1 = Readonly<{
  authorization: SecMaintainerAuthorizationObservationV1;
  instructionAuthority: boolean;
  record: SecMaintainerAdoptionRecordV1;
  repository: SecTrustedRepositoryIdentityV1;
  schema: 'sec-authorized-maintainer-adoption-v1';
}>;

const RecordKeys = [
  'acceptance',
  'authorizedBy',
  'containsExternalText',
  'createdAt',
  'decision',
  'forbidden',
  'normalizationMethod',
  'normalizedIntent',
  'provenance',
  'recordId',
  'schema',
  'source'
] as const;

const AuthorizationObservationKeys = [
  'adoptionRecordDigest',
  'defaultHead',
  'evidenceDigest',
  'login',
  'observedAt',
  'permission',
  'repository',
  'repositoryId',
  'schema',
  'source',
  'userId'
] as const;

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function assertExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  label: string
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label} contains forbidden key ${key}.`);
  }
  for (const key of required) {
    if (!(key in value)) throw new Error(`${label} is missing required key ${key}.`);
  }
}

function boundedText(value: unknown, label: string, maximum: number): string {
  if (
    typeof value !== 'string'
    || value.trim() !== value
    || value.length === 0
    || value.length > maximum
    || /[\0\r]/u.test(value)
  ) {
    throw new Error(`${label} must be bounded canonical text.`);
  }
  return value;
}

function boundedTextArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.length > 100) {
    throw new Error(`${label} must be a bounded array.`);
  }
  const output = value.map((entry, index) => boundedText(entry, `${label}[${index}]`, 2048));
  if (new Set(output).size !== output.length) throw new Error(`${label} contains duplicates.`);
  return Object.freeze(output);
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return value as number;
}

function parseTimestamp(value: unknown, label: string): string {
  if (
    typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)
    || Number.isNaN(Date.parse(value))
  ) {
    throw new Error(`${label} must be one canonical UTC timestamp.`);
  }
  return value;
}

function parseRepository(value: unknown, label: string): string {
  if (
    typeof value !== 'string'
    || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(value)
  ) {
    throw new Error(`${label} must be owner/name.`);
  }
  return value;
}

function parseDigest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`${label} must be a SHA-256 digest.`);
  }
  return value;
}

function parseCommitOid(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/u.test(value)) {
    throw new Error(`${label} must be one lowercase 40-character Git object ID.`);
  }
  return value;
}

function parseLogin(value: unknown, label: string): string {
  if (
    typeof value !== 'string'
    || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u.test(value)
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function parsePermission(value: unknown, label: string): SecMaintainerPermission {
  if (value !== 'maintain' && value !== 'admin') {
    throw new Error(`${label} must be maintain or admin.`);
  }
  return value;
}

function parseSource(value: unknown): SecMaintainerAdoptionRecordV1['source'] {
  assertRecord(value, 'source');
  assertExactKeys(
    value,
    ['digest', 'kind', 'number', 'repository'],
    ['commentId'],
    'source'
  );
  if (
    typeof value.kind !== 'string'
    || !['discussion', 'issue', 'pull-request', 'review-comment'].includes(value.kind)
  ) {
    throw new Error('source.kind is invalid.');
  }
  const commentId = value.commentId === undefined
    ? undefined
    : positiveInteger(value.commentId, 'source.commentId');
  if ((value.kind === 'review-comment') !== (commentId !== undefined)) {
    throw new Error('source.commentId is required only for review-comment sources.');
  }
  return Object.freeze({
    ...(commentId === undefined ? {} : { commentId }),
    digest: parseDigest(value.digest, 'source.digest'),
    kind: value.kind as SecMaintainerAdoptionRecordV1['source']['kind'],
    number: positiveInteger(value.number, 'source.number'),
    repository: parseRepository(value.repository, 'source.repository')
  });
}

function parseAuthorizedBy(value: unknown): SecMaintainerAdoptionRecordV1['authorizedBy'] {
  assertRecord(value, 'authorizedBy');
  assertExactKeys(value, ['login', 'permission'], [], 'authorizedBy');
  return Object.freeze({
    login: parseLogin(value.login, 'authorizedBy.login'),
    permission: parsePermission(value.permission, 'authorizedBy.permission')
  });
}

function parseTrustedRepositoryIdentity(value: unknown): SecTrustedRepositoryIdentityV1 {
  assertRecord(value, 'trusted repository identity');
  assertExactKeys(value, ['defaultHead', 'fullName', 'id'], [], 'trusted repository identity');
  return Object.freeze({
    defaultHead: parseCommitOid(value.defaultHead, 'trusted repository identity defaultHead'),
    fullName: parseRepository(value.fullName, 'trusted repository identity fullName'),
    id: positiveInteger(value.id, 'trusted repository identity id')
  });
}

export function CodexDevelopmentAssertMaintainerAdoptionRecordV1(
  value: unknown
): SecMaintainerAdoptionRecordV1 {
  assertRecord(value, 'adoption record');
  assertExactKeys(value, RecordKeys, [], 'adoption record');
  if (value.schema !== 'sec-maintainer-adoption-record-v1') {
    throw new Error('adoption record schema is invalid.');
  }
  if (value.provenance !== 'maintainer-intent') {
    throw new Error('adoption record provenance must be maintainer-intent.');
  }
  if (value.normalizationMethod !== 'independent-restatement-v1') {
    throw new Error('adoption record must use independent restatement.');
  }
  if (value.containsExternalText !== false) {
    throw new Error('adoption record must not contain external text.');
  }
  if (
    typeof value.decision !== 'string'
    || !SEC_EXTERNAL_ADOPTION_DISPOSITIONS.includes(
      value.decision as SecExternalAdoptionDisposition
    )
  ) {
    throw new Error('adoption record decision is invalid.');
  }
  const decision = value.decision as SecExternalAdoptionDisposition;
  const normalizedIntent = boundedText(value.normalizedIntent, 'normalizedIntent', 4096);
  const acceptance = boundedTextArray(value.acceptance, 'acceptance');
  const forbidden = boundedTextArray(value.forbidden, 'forbidden');
  if ((decision === 'adopt' || decision === 'adapt') && acceptance.length === 0) {
    throw new Error('adopt/adapt records require acceptance conditions.');
  }
  if ((decision === 'reject' || decision === 'defer') && acceptance.length > 0) {
    throw new Error('reject/defer records cannot issue acceptance conditions.');
  }
  if (
    typeof value.recordId !== 'string'
    || !/^[a-z0-9][a-z0-9-]{0,127}$/u.test(value.recordId)
  ) {
    throw new Error('recordId must be one canonical lower-kebab identity.');
  }
  return Object.freeze({
    acceptance,
    authorizedBy: parseAuthorizedBy(value.authorizedBy),
    containsExternalText: false,
    createdAt: parseTimestamp(value.createdAt, 'createdAt'),
    decision,
    forbidden,
    normalizedIntent,
    normalizationMethod: 'independent-restatement-v1',
    provenance: 'maintainer-intent',
    recordId: value.recordId,
    schema: 'sec-maintainer-adoption-record-v1',
    source: parseSource(value.source)
  });
}

export function CodexDevelopmentMaintainerAdoptionRecordDigestV1(
  record: SecMaintainerAdoptionRecordV1
): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(record)).digest('hex')}`;
}

export function CodexDevelopmentAssertMaintainerAuthorizationObservationV1(
  value: unknown
): SecMaintainerAuthorizationObservationV1 {
  assertRecord(value, 'authorization observation');
  assertExactKeys(value, AuthorizationObservationKeys, [], 'authorization observation');
  if (value.schema !== 'sec-maintainer-authorization-observation-v1') {
    throw new Error('authorization observation schema is invalid.');
  }
  if (value.source !== 'trusted-github-collaborator-permission-api') {
    throw new Error('authorization observation source is not trusted.');
  }
  return Object.freeze({
    adoptionRecordDigest: parseDigest(
      value.adoptionRecordDigest,
      'authorization observation adoptionRecordDigest'
    ),
    defaultHead: parseCommitOid(value.defaultHead, 'authorization observation defaultHead'),
    evidenceDigest: parseDigest(
      value.evidenceDigest,
      'authorization observation evidenceDigest'
    ),
    login: parseLogin(value.login, 'authorization observation login'),
    observedAt: parseTimestamp(value.observedAt, 'authorization observation observedAt'),
    permission: parsePermission(value.permission, 'authorization observation permission'),
    repository: parseRepository(value.repository, 'authorization observation repository'),
    repositoryId: positiveInteger(
      value.repositoryId,
      'authorization observation repositoryId'
    ),
    schema: 'sec-maintainer-authorization-observation-v1',
    source: 'trusted-github-collaborator-permission-api',
    userId: positiveInteger(value.userId, 'authorization observation userId')
  });
}

export function CodexDevelopmentAuthorizeMaintainerAdoptionRecordV1(input: {
  readonly authorization: unknown;
  readonly record: SecMaintainerAdoptionRecordV1;
  readonly repository: unknown;
}): SecAuthorizedMaintainerAdoptionV1 {
  const authorization = CodexDevelopmentAssertMaintainerAuthorizationObservationV1(
    input.authorization
  );
  const repository = parseTrustedRepositoryIdentity(input.repository);
  const recordDigest = CodexDevelopmentMaintainerAdoptionRecordDigestV1(input.record);
  if (authorization.adoptionRecordDigest !== recordDigest) {
    throw new Error('authorization observation is bound to a different adoption record.');
  }
  if (
    authorization.repository !== repository.fullName
    || authorization.repositoryId !== repository.id
  ) {
    throw new Error('authorization observation does not match the trusted repository identity.');
  }
  if (authorization.defaultHead !== repository.defaultHead) {
    throw new Error('authorization observation is stale for the current default head.');
  }
  if (input.record.source.repository !== repository.fullName) {
    throw new Error('adoption source repository does not match the trusted repository identity.');
  }
  if (
    authorization.login !== input.record.authorizedBy.login
    || authorization.permission !== input.record.authorizedBy.permission
  ) {
    throw new Error('live maintainer authorization does not match the adoption record signer.');
  }
  return Object.freeze({
    authorization,
    instructionAuthority: input.record.decision === 'adopt' || input.record.decision === 'adapt',
    record: input.record,
    repository,
    schema: 'sec-authorized-maintainer-adoption-v1'
  });
}

export function CodexDevelopmentAdoptionRecordCanIssueInstructionsV1(
  authorized: SecAuthorizedMaintainerAdoptionV1
): boolean {
  return authorized.instructionAuthority;
}
