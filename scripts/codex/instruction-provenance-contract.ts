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

export type SecMaintainerAdoptionRecordV1 = Readonly<{
  acceptance: readonly string[];
  authorizedBy: Readonly<{
    login: string;
    permission: 'admin' | 'maintain';
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

function parseSource(value: unknown): SecMaintainerAdoptionRecordV1['source'] {
  assertRecord(value, 'source');
  assertExactKeys(
    value,
    ['digest', 'kind', 'number', 'repository'],
    ['commentId'],
    'source'
  );
  if (
    typeof value.repository !== 'string'
    || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(value.repository)
  ) {
    throw new Error('source.repository must be owner/name.');
  }
  if (
    typeof value.digest !== 'string'
    || !/^sha256:[0-9a-f]{64}$/u.test(value.digest)
  ) {
    throw new Error('source.digest must be a SHA-256 digest.');
  }
  if (
    typeof value.kind !== 'string'
    || !['discussion', 'issue', 'pull-request', 'review-comment'].includes(value.kind)
  ) {
    throw new Error('source.kind is invalid.');
  }
  const commentId = value.commentId === undefined
    ? undefined
    : positiveInteger(value.commentId, 'source.commentId');
  if (
    (value.kind === 'review-comment') !== (commentId !== undefined)
  ) {
    throw new Error('source.commentId is required only for review-comment sources.');
  }
  return Object.freeze({
    ...(commentId === undefined ? {} : { commentId }),
    digest: value.digest,
    kind: value.kind as SecMaintainerAdoptionRecordV1['source']['kind'],
    number: positiveInteger(value.number, 'source.number'),
    repository: value.repository
  });
}

function parseAuthorizedBy(value: unknown): SecMaintainerAdoptionRecordV1['authorizedBy'] {
  assertRecord(value, 'authorizedBy');
  assertExactKeys(value, ['login', 'permission'], [], 'authorizedBy');
  if (
    typeof value.login !== 'string'
    || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u.test(value.login)
  ) {
    throw new Error('authorizedBy.login is invalid.');
  }
  if (value.permission !== 'maintain' && value.permission !== 'admin') {
    throw new Error('authorizedBy.permission must be maintain or admin.');
  }
  return Object.freeze({ login: value.login, permission: value.permission });
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
    recordId: boundedText(value.recordId, 'recordId', 128),
    schema: 'sec-maintainer-adoption-record-v1',
    source: parseSource(value.source)
  });
}

export function CodexDevelopmentAdoptionRecordCanIssueInstructionsV1(
  record: SecMaintainerAdoptionRecordV1
): boolean {
  return record.decision === 'adopt' || record.decision === 'adapt';
}
