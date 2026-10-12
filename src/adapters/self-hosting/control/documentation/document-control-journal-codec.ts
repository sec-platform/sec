import { digest, sha256 } from '../../../../contracts/canonical.ts';
import { GIT_INDEX_PLANNING_BUDGET_CEILING } from '../../../providers/git-read/runtime/budget.ts';
import { CodexDevelopmentWorkPackageManifestDigest } from '../task/contract/work-package.ts';

/**
 * Closed journal/result representation and exact identity codecs. Canonical bytes
 * and digests protect recovery input integrity; they neither observe an effect nor
 * grant authority. V4 activation and V5 proposal-only remain distinct contracts.
 */

export const CurrentStatePath = 'config/repository/current-state.yaml';

export const ActivePointerPath = 'config/repository/active-work-package.md';

export const RollingPlanPath = 'config/repository/rolling-plan.md';

export const LegacyFreezeJournalSchema = 'sec-document-control-plane-freeze-journal-v4' as const;

export const FreezeJournalSchema = 'sec-document-control-plane-freeze-journal-v5' as const;

export const LegacyFreezeResultSchema = 'sec-document-control-plane-freeze-result-v1' as const;

export const FreezeResultSchema = 'sec-document-control-plane-freeze-result-v2' as const;

export const FreezeJournalRelativePath = '.tmp/codex/document-control-plane-freeze-v1/journal.json';

export type FreezeFault =
  | 'after-journal-prepare'
  | 'after-index-lock-write'
  | 'after-index-pre-quarantine'
  | 'after-index-next-install'
  | 'after-index-publish'
  | 'after-journal-index-published-pre-quarantine'
  | 'after-journal-index-published-next-install'
  | 'after-pointer-temp-write'
  | 'after-pointer-pre-quarantine'
  | 'after-pointer-next-install'
  | 'after-pointer-publish'
  | 'after-journal-pointer-published-pre-quarantine'
  | 'after-rolling-temp-write'
  | 'after-rolling-pre-quarantine'
  | 'after-rolling-next-install'
  | 'after-rolling-publish'
  | 'after-journal-rolling-published-pre-quarantine'
  | 'after-journal-terminal-pre-quarantine'
  | 'after-journal-terminal-next-install'
  | 'after-terminal';

export type DurabilityStage =
  | 'renamed'
  | 'file-flushed'
  | 'parent-barrier';

export interface DurabilityEvent {
  readonly label: string;
  readonly targetPath: string;
  readonly stage: DurabilityStage;
}

export type FreezeJournalPhase =
  | 'prepared'
  | 'index-published'
  | 'pointer-published'
  | 'rolling-published'
  | 'terminal';

export interface FreezeResult {
  readonly schema: typeof LegacyFreezeResultSchema | typeof FreezeResultSchema;
  readonly status: 'ACTIVATED_INDEX_PENDING_COMMIT' | 'PROPOSED';
  readonly operationId: `sha256:${string}`;
  readonly baseSha: string;
  readonly baseTreeSha: string;
  readonly candidateTreeSha: string;
  readonly candidateHeadSha: null;
  readonly manifestPath: string;
  readonly manifestDigest: `sha256:${string}`;
  readonly indexPublished: true;
  readonly worktreeProjected: true;
}

interface FreezeJournalFile {
  readonly pre: string;
  readonly next: string;
}

export interface FreezeJournal {
  readonly schema: typeof LegacyFreezeJournalSchema | typeof FreezeJournalSchema;
  readonly authoringDisposition?: 'activation' | 'proposal-only';
  readonly operationId: `sha256:${string}`;
  readonly phase: FreezeJournalPhase;
  readonly manifestPath: string;
  readonly manifestDigest: `sha256:${string}`;
  readonly reviewedOn: string;
  readonly baseSha: string;
  readonly baseTreeSha: string;
  readonly preIndexTreeSha: string;
  readonly candidateTreeSha: string;
  readonly files: Readonly<{
    manifest: FreezeJournalFile;
    pointer: FreezeJournalFile;
    rollingPlan: FreezeJournalFile;
  }>;
  readonly index: FreezeJournalFile;
  readonly indexTransportDigest: `sha256:${string}`;
  readonly result: FreezeResult;
}

export function byteDigest(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${digest(bytes)}`;
}

export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

export function fromBase64(source: string, label: string): Buffer {
  if (typeof source !== 'string' || source.length > GIT_INDEX_PLANNING_BUDGET_CEILING.maxRawBytes
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(source)) {
    throw new Error(`${label} must be canonical base64.`);
  }
  const bytes = Buffer.from(source, 'base64');
  if (bytes.toString('base64') !== source) throw new Error(`${label} base64 is not canonical.`);
  return bytes;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} must contain exactly: ${wanted.join(', ')}.`);
  }
}

function recordValue(value: unknown, label: string): Record<string, unknown> {
  assertRecord(value, label);
  return value;
}

function textValue(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw new Error(`${label} must be non-empty trimmed text.`);
  }
  return value;
}

export function shaValue(value: unknown, label: string): string {
  const sha = textValue(value, label);
  if (!/^[0-9a-f]{40}$/u.test(sha)) throw new Error(`${label} must be a lowercase 40-character Git SHA.`);
  return sha;
}

function digestValue(value: unknown, label: string): `sha256:${string}` {
  const candidate = textValue(value, label);
  if (!/^sha256:[0-9a-f]{64}$/u.test(candidate)) throw new Error(`${label} must be a SHA-256 digest.`);
  return candidate as `sha256:${string}`;
}

function parseJournalFile(value: unknown, label: string): FreezeJournalFile {
  const record = recordValue(value, label);
  exactKeys(record, ['next', 'pre'], label);
  const pre = textValue(record.pre, `${label}.pre`);
  const next = textValue(record.next, `${label}.next`);
  fromBase64(pre, `${label}.pre`);
  fromBase64(next, `${label}.next`);
  return Object.freeze({ pre, next });
}

export function freezeIndexTransportDigest(index: FreezeJournalFile): `sha256:${string}` {
  return sha256({ schema: 'sec-document-control-index-transport-v1', index }) as `sha256:${string}`;
}

export function freezeOperationId(
  input: Omit<FreezeJournal, 'operationId' | 'phase' | 'result'>
): `sha256:${string}` {
  const { index: _indexTransport, indexTransportDigest: _transportDigest, ...semantic } = input;
  return sha256({
    ...semantic,
    indexSemanticIdentity: Object.freeze({
      preTreeSha: input.preIndexTreeSha,
      nextTreeSha: input.candidateTreeSha
    })
  }) as `sha256:${string}`;
}

function parseFreezeResult(value: unknown): FreezeResult {
  const record = recordValue(value, 'Freeze journal result');
  exactKeys(record, [
    'baseSha', 'baseTreeSha', 'candidateHeadSha', 'candidateTreeSha', 'indexPublished',
    'manifestDigest', 'manifestPath', 'operationId', 'schema', 'status', 'worktreeProjected'
  ], 'Freeze journal result');
  const legacy = record.schema === LegacyFreezeResultSchema;
  if ((!legacy && record.schema !== FreezeResultSchema)
      || (legacy
        ? record.status !== 'ACTIVATED_INDEX_PENDING_COMMIT'
        : record.status !== 'PROPOSED')
      || record.candidateHeadSha !== null || record.indexPublished !== true
      || record.worktreeProjected !== true) {
    throw new Error('Freeze journal result identity is invalid.');
  }
  return Object.freeze({
    schema: record.schema as FreezeResult['schema'],
    status: record.status as FreezeResult['status'],
    operationId: digestValue(record.operationId, 'Freeze result operationId'),
    baseSha: shaValue(record.baseSha, 'Freeze result baseSha'),
    baseTreeSha: shaValue(record.baseTreeSha, 'Freeze result baseTreeSha'),
    candidateTreeSha: shaValue(record.candidateTreeSha, 'Freeze result candidateTreeSha'),
    candidateHeadSha: null,
    manifestPath: textValue(record.manifestPath, 'Freeze result manifestPath'),
    manifestDigest: digestValue(record.manifestDigest, 'Freeze result manifestDigest'),
    indexPublished: true,
    worktreeProjected: true
  });
}

export function parseFreezeJournal(source: string): FreezeJournal {
  let parsed: unknown;
  try { parsed = JSON.parse(source); } catch (error) {
    throw new Error('Document control freeze journal is invalid JSON.', { cause: error });
  }
  const record = recordValue(parsed, 'Freeze journal');
  const legacy = record.schema === LegacyFreezeJournalSchema;
  if (!legacy && record.schema !== FreezeJournalSchema) {
    throw new Error('Only freeze journal V4 or V5 can serve as recovery authority.');
  }
  exactKeys(record, [
    ...(legacy ? [] : ['authoringDisposition']),
    'baseSha', 'baseTreeSha', 'candidateTreeSha', 'files', 'index', 'manifestDigest',
    'indexTransportDigest', 'manifestPath', 'operationId', 'phase', 'preIndexTreeSha',
    'result', 'reviewedOn', 'schema'
  ], 'Freeze journal');
  if (!['prepared', 'index-published', 'pointer-published', 'rolling-published', 'terminal'].includes(String(record.phase))) {
    throw new Error('Freeze journal phase is invalid.');
  }
  const files = recordValue(record.files, 'Freeze journal files');
  exactKeys(files, ['manifest', 'pointer', 'rollingPlan'], 'Freeze journal files');
  const authoringDisposition = legacy
    ? undefined
    : record.authoringDisposition === 'proposal-only'
      ? record.authoringDisposition
      : (() => { throw new Error('Freeze journal V5 must describe proposal-only authoring.'); })();
  const semantic = Object.freeze({
    schema: record.schema as FreezeJournal['schema'],
    ...(authoringDisposition === undefined ? {} : { authoringDisposition }),
    manifestPath: textValue(record.manifestPath, 'Freeze journal manifestPath'),
    manifestDigest: digestValue(record.manifestDigest, 'Freeze journal manifestDigest'),
    reviewedOn: textValue(record.reviewedOn, 'Freeze journal reviewedOn'),
    baseSha: shaValue(record.baseSha, 'Freeze journal baseSha'),
    baseTreeSha: shaValue(record.baseTreeSha, 'Freeze journal baseTreeSha'),
    preIndexTreeSha: shaValue(record.preIndexTreeSha, 'Freeze journal preIndexTreeSha'),
    candidateTreeSha: shaValue(record.candidateTreeSha, 'Freeze journal candidateTreeSha'),
    files: Object.freeze({
      manifest: parseJournalFile(files.manifest, 'Freeze journal manifest file'),
      pointer: parseJournalFile(files.pointer, 'Freeze journal pointer file'),
      rollingPlan: parseJournalFile(files.rollingPlan, 'Freeze journal rolling-plan file')
    }),
    index: parseJournalFile(record.index, 'Freeze journal index'),
    indexTransportDigest: digestValue(
      record.indexTransportDigest,
      'Freeze journal indexTransportDigest'
    )
  });
  if (freezeIndexTransportDigest(semantic.index) !== semantic.indexTransportDigest) {
    throw new Error('Freeze journal index transport digest mismatch.');
  }
  const operationId = digestValue(record.operationId, 'Freeze journal operationId');
  if (freezeOperationId(semantic) !== operationId) throw new Error('Freeze journal operation digest mismatch.');
  const result = parseFreezeResult(record.result);
  if (result.operationId !== operationId || result.baseSha !== semantic.baseSha
      || result.baseTreeSha !== semantic.baseTreeSha || result.candidateTreeSha !== semantic.candidateTreeSha
      || result.manifestPath !== semantic.manifestPath || result.manifestDigest !== semantic.manifestDigest) {
    throw new Error('Freeze journal result is not bound to its operation.');
  }
  if ((authoringDisposition === 'proposal-only')
      !== (result.status === 'PROPOSED')) {
    throw new Error('Freeze journal result status differs from its authoring disposition.');
  }
  if (legacy && result.schema !== LegacyFreezeResultSchema) {
    throw new Error('Freeze journal V4 requires its original activated result contract.');
  }
  if (!legacy && result.schema !== FreezeResultSchema) {
    throw new Error('Freeze journal V5 requires its revision-matched result contract.');
  }
  const manifestBytes = fromBase64(semantic.files.manifest.next, 'Freeze journal manifest next bytes');
  if (CodexDevelopmentWorkPackageManifestDigest(manifestBytes) !== semantic.manifestDigest) {
    throw new Error('Freeze journal manifest digest does not match its next bytes.');
  }
  return Object.freeze({
    ...semantic,
    operationId,
    phase: record.phase as FreezeJournalPhase,
    result
  });
}

export function renderFreezeJournal(journal: FreezeJournal): Buffer {
  return Buffer.from(`${JSON.stringify(journal, null, 2)}\n`, 'utf8');
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

export function decodeUtf8(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error(`${label} must be valid UTF-8.`, { cause: error });
  }
}

export function parseNulList(source: string): string[] {
  if (source.length === 0) return [];
  if (!source.endsWith('\0')) throw new Error('Git NUL-delimited path output is truncated.');
  return source.slice(0, -1).split('\0');
}
