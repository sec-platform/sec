const DOCUMENT_CONTROL_FREEZE_CHILD_FAILURE_SCHEMA =
  'sec-document-control-freeze-child-failure-v1' as const;
export const DOCUMENT_CONTROL_FREEZE_CHILD_FAILURE_MAX_BYTES = 512;
const DOCUMENT_CONTROL_FREEZE_CHILD_FAILURE_FIELD_LIMITS = Object.freeze({
  name: 32,
  code: 64,
  message: 128
});

export interface DocumentControlFreezeChildFailure {
  readonly schema: typeof DOCUMENT_CONTROL_FREEZE_CHILD_FAILURE_SCHEMA;
  readonly name: 'Error' | 'UnexpectedFailure';
  readonly code: null | 'DOCUMENT-CONTROL-FREEZE-CHILD-UNEXPECTED-001';
  readonly message:
    | 'Git index escapes its canonical transaction root.'
    | 'Unexpected document-control freeze child failure.';
}

export const DOCUMENT_CONTROL_FREEZE_OUTSIDE_INDEX_FAILURE:
DocumentControlFreezeChildFailure = Object.freeze({
  schema: DOCUMENT_CONTROL_FREEZE_CHILD_FAILURE_SCHEMA,
  name: 'Error',
  code: null,
  message: 'Git index escapes its canonical transaction root.'
});

export const DOCUMENT_CONTROL_FREEZE_UNEXPECTED_CHILD_FAILURE:
DocumentControlFreezeChildFailure = Object.freeze({
  schema: DOCUMENT_CONTROL_FREEZE_CHILD_FAILURE_SCHEMA,
  name: 'UnexpectedFailure',
  code: 'DOCUMENT-CONTROL-FREEZE-CHILD-UNEXPECTED-001',
  message: 'Unexpected document-control freeze child failure.'
});

function observedString(error: unknown, property: 'name' | 'code' | 'message'): string | null {
  if (error === null || (typeof error !== 'object' && typeof error !== 'function')) return null;
  try {
    const value = Reflect.get(error, property);
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

function isExactOutsideIndexFailure(error: unknown): boolean {
  return observedString(error, 'name') === DOCUMENT_CONTROL_FREEZE_OUTSIDE_INDEX_FAILURE.name &&
    observedString(error, 'code') === null &&
    observedString(error, 'message') ===
      DOCUMENT_CONTROL_FREEZE_OUTSIDE_INDEX_FAILURE.message;
}

export function compileDocumentControlFreezeChildFailure(
  error: unknown
): DocumentControlFreezeChildFailure {
  return isExactOutsideIndexFailure(error)
    ? DOCUMENT_CONTROL_FREEZE_OUTSIDE_INDEX_FAILURE
    : DOCUMENT_CONTROL_FREEZE_UNEXPECTED_CHILD_FAILURE;
}

function allowedFailureTuple(
  value: Readonly<Record<string, unknown>>
): DocumentControlFreezeChildFailure | null {
  return [
    DOCUMENT_CONTROL_FREEZE_OUTSIDE_INDEX_FAILURE,
    DOCUMENT_CONTROL_FREEZE_UNEXPECTED_CHILD_FAILURE
  ].find((allowed) => allowed.schema === value.schema && allowed.name === value.name &&
    allowed.code === value.code && allowed.message === value.message) ?? null;
}

function codePointLength(value: string): number {
  return [...value].length;
}

function assertBoundedFailureFields(value: Readonly<Record<string, unknown>>): void {
  const limits = DOCUMENT_CONTROL_FREEZE_CHILD_FAILURE_FIELD_LIMITS;
  if (typeof value.name !== 'string' || value.name.length === 0 ||
    codePointLength(value.name) > limits.name ||
    (value.code !== null && (typeof value.code !== 'string' || value.code.length === 0 ||
      codePointLength(value.code) > limits.code)) ||
    typeof value.message !== 'string' || value.message.length === 0 ||
    codePointLength(value.message) > limits.message) {
    throw new Error('Freeze child failure envelope fields are outside canonical bounds.');
  }
}

export function renderDocumentControlFreezeChildFailure(error: unknown): string {
  const rendered = `${JSON.stringify(compileDocumentControlFreezeChildFailure(error))}\n`;
  if (Buffer.byteLength(rendered, 'utf8') >
    DOCUMENT_CONTROL_FREEZE_CHILD_FAILURE_MAX_BYTES) {
    throw new Error('Freeze child failure envelope exceeds its canonical byte bound.');
  }
  return rendered;
}

export function parseDocumentControlFreezeChildFailure(
  source: string | Uint8Array
): DocumentControlFreezeChildFailure {
  const bytes = typeof source === 'string' ? Buffer.from(source, 'utf8') : Buffer.from(source);
  if (bytes.byteLength === 0 ||
    bytes.byteLength > DOCUMENT_CONTROL_FREEZE_CHILD_FAILURE_MAX_BYTES) {
    throw new Error('Freeze child failure envelope byte length is invalid.');
  }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (!text.endsWith('\n') || text.includes('\r') || text.indexOf('\n') !== text.length - 1) {
    throw new Error('Freeze child failure envelope must be one canonical LF-terminated line.');
  }
  const parsed: unknown = JSON.parse(text.slice(0, -1));
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Freeze child failure envelope must be one object.');
  }
  const record = parsed as Record<string, unknown>;
  if (JSON.stringify(Object.keys(record).sort()) !==
    JSON.stringify(['code', 'message', 'name', 'schema']) ||
    record.schema !== DOCUMENT_CONTROL_FREEZE_CHILD_FAILURE_SCHEMA) {
    throw new Error('Freeze child failure envelope keys or schema are invalid.');
  }
  assertBoundedFailureFields(record);
  const allowed = allowedFailureTuple(record);
  if (allowed === null || `${JSON.stringify(allowed)}\n` !== text) {
    throw new Error('Freeze child failure envelope is not a canonical allowed projection.');
  }
  return allowed;
}
