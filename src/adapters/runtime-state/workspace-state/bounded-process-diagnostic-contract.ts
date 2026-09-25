import {
  canonicalJson,
  compareCodeUnits,
  isPlainObject,
  rawSha256,
  sha256
} from '../../../contracts/canonical.ts';
import { parseExactJson } from '../../../contracts/exact-json.ts';
import { FailureError } from '../../../contracts/failure.ts';
import type { OperationDigest } from '../../../execution/operation/semantic.ts';

const BOUNDED_PROCESS_DIAGNOSTIC_OBJECT_SCHEMA =
  'sec-bounded-process-diagnostic-object' as const;
export const BOUNDED_PROCESS_DIAGNOSTIC_MAXIMUM_STREAM_BYTES = 16 * 1024 * 1024;
export const BOUNDED_PROCESS_DIAGNOSTIC_METADATA_MAXIMUM_BYTES = 4_096;

const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const RECEIPT_KEYS = Object.freeze([
  'boundAttemptDigest',
  'byteLength',
  'contentDigest',
  'executionPlanDigest',
  'objectDigest',
  'operationIdentityDigest',
  'retainedUntilUnixMs',
  'schema',
  'settlementDigest',
  'stream',
  'subjectDigest'
]);

export type BoundedProcessDiagnosticStream = 'combined-tail' | 'stderr' | 'stdout';

export type BoundedProcessDiagnosticObjectReceipt = Readonly<{
  schema: typeof BOUNDED_PROCESS_DIAGNOSTIC_OBJECT_SCHEMA;
  operationIdentityDigest: OperationDigest;
  executionPlanDigest: OperationDigest;
  boundAttemptDigest: OperationDigest;
  subjectDigest: OperationDigest;
  settlementDigest: OperationDigest;
  stream: BoundedProcessDiagnosticStream;
  byteLength: number;
  contentDigest: OperationDigest;
  retainedUntilUnixMs: number;
  objectDigest: OperationDigest;
}>;

export type BoundedProcessDiagnosticObjectReadbackReceipt = Readonly<{
  disposition: 'current';
  objectDigest: OperationDigest;
  physicalIdentityDigest: OperationDigest;
  contentDigest: OperationDigest;
  byteLength: number;
  readbackDigest: OperationDigest;
}>;

export type BoundedProcessDiagnosticPublishedObject = Readonly<{
  receipt: BoundedProcessDiagnosticObjectReceipt;
  readback: BoundedProcessDiagnosticObjectReadbackReceipt;
}>;

export type BoundedProcessDiagnosticFailureKind =
  | 'corrupt-object'
  | 'deadline-exhausted'
  | 'foreign-residue'
  | 'incomplete-object'
  | 'physical-replacement'
  | 'resource-exhausted';

export class BoundedProcessDiagnosticObjectError extends FailureError {
  readonly kind: BoundedProcessDiagnosticFailureKind;

  constructor(kind: BoundedProcessDiagnosticFailureKind, message: string, cause?: unknown) {
    super(
      'RUNTIME-STATE-002',
      message,
      { kind },
      cause === undefined ? undefined : { cause }
    );
    this.name = 'BoundedProcessDiagnosticObjectError';
    this.kind = kind;
  }
}

function fail(
  kind: BoundedProcessDiagnosticFailureKind,
  message: string,
  cause?: unknown
): never {
  throw new BoundedProcessDiagnosticObjectError(kind, message, cause);
}

function exactDigest(value: unknown, label: string): OperationDigest {
  if (typeof value !== 'string' || !DIGEST.test(value)) {
    fail('corrupt-object', `${label} is not a canonical SHA-256 digest`);
  }
  return value as OperationDigest;
}

function exactSafeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    fail('corrupt-object', `${label} is not a nonnegative safe integer`);
  }
  return value as number;
}

function receiptUnsigned(receipt: Omit<BoundedProcessDiagnosticObjectReceipt, 'objectDigest'>) {
  return Object.freeze(receipt);
}

export function createBoundedProcessDiagnosticObjectReceipt(input: Readonly<{
  operationIdentityDigest: OperationDigest;
  executionPlanDigest: OperationDigest;
  boundAttemptDigest: OperationDigest;
  subjectDigest: OperationDigest;
  settlementDigest: OperationDigest;
  stream: BoundedProcessDiagnosticStream;
  bytes: Uint8Array;
  retainedUntilUnixMs: number;
}>): BoundedProcessDiagnosticObjectReceipt {
  const unsigned = receiptUnsigned({
    schema: BOUNDED_PROCESS_DIAGNOSTIC_OBJECT_SCHEMA,
    operationIdentityDigest: exactDigest(input.operationIdentityDigest, 'Diagnostic operation identity'),
    executionPlanDigest: exactDigest(input.executionPlanDigest, 'Diagnostic execution plan'),
    boundAttemptDigest: exactDigest(input.boundAttemptDigest, 'Diagnostic bound attempt'),
    subjectDigest: exactDigest(input.subjectDigest, 'Diagnostic subject'),
    settlementDigest: exactDigest(input.settlementDigest, 'Diagnostic process settlement'),
    stream: input.stream,
    byteLength: input.bytes.byteLength,
    contentDigest: rawSha256(input.bytes) as OperationDigest,
    retainedUntilUnixMs: exactSafeInteger(input.retainedUntilUnixMs, 'Diagnostic retention deadline')
  });
  return Object.freeze({
    ...unsigned,
    objectDigest: sha256(unsigned) as OperationDigest
  });
}

function parseReceiptValue(value: unknown): BoundedProcessDiagnosticObjectReceipt {
  if (!isPlainObject(value)) fail('corrupt-object', 'Diagnostic receipt must be one plain object');
  const keys = Object.keys(value).sort(compareCodeUnits);
  const expected = [...RECEIPT_KEYS].sort(compareCodeUnits);
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    fail('corrupt-object', 'Diagnostic receipt fields are not canonical');
  }
  if (value.schema !== BOUNDED_PROCESS_DIAGNOSTIC_OBJECT_SCHEMA) {
    fail('corrupt-object', 'Diagnostic receipt schema is unsupported');
  }
  if (value.stream !== 'combined-tail' && value.stream !== 'stdout' && value.stream !== 'stderr') {
    fail('corrupt-object', 'Diagnostic receipt stream is invalid');
  }
  const unsigned = receiptUnsigned({
    schema: BOUNDED_PROCESS_DIAGNOSTIC_OBJECT_SCHEMA,
    operationIdentityDigest: exactDigest(value.operationIdentityDigest, 'Diagnostic operation identity'),
    executionPlanDigest: exactDigest(value.executionPlanDigest, 'Diagnostic execution plan'),
    boundAttemptDigest: exactDigest(value.boundAttemptDigest, 'Diagnostic bound attempt'),
    subjectDigest: exactDigest(value.subjectDigest, 'Diagnostic subject'),
    settlementDigest: exactDigest(value.settlementDigest, 'Diagnostic process settlement'),
    stream: value.stream,
    byteLength: exactSafeInteger(value.byteLength, 'Diagnostic byte length'),
    contentDigest: exactDigest(value.contentDigest, 'Diagnostic content'),
    retainedUntilUnixMs: exactSafeInteger(value.retainedUntilUnixMs, 'Diagnostic retention deadline')
  });
  if (unsigned.byteLength > BOUNDED_PROCESS_DIAGNOSTIC_MAXIMUM_STREAM_BYTES) {
    fail('resource-exhausted', 'Diagnostic receipt exceeds the stream byte ceiling');
  }
  const objectDigest = exactDigest(value.objectDigest, 'Diagnostic object');
  if (objectDigest !== sha256(unsigned)) {
    fail('corrupt-object', 'Diagnostic object digest does not bind its receipt');
  }
  return Object.freeze({ ...unsigned, objectDigest });
}

export function encodeBoundedProcessDiagnosticObjectReceipt(
  receipt: BoundedProcessDiagnosticObjectReceipt
): string {
  return JSON.stringify(canonicalJson(parseReceiptValue(receipt)));
}

export function parseBoundedProcessDiagnosticObjectReceipt(
  source: string
): BoundedProcessDiagnosticObjectReceipt {
  if (Buffer.byteLength(source, 'utf8') > BOUNDED_PROCESS_DIAGNOSTIC_METADATA_MAXIMUM_BYTES) {
    fail('resource-exhausted', 'Diagnostic receipt exceeds its metadata byte ceiling');
  }
  const receipt = parseReceiptValue(parseExactJson(source, 'Bounded process diagnostic receipt', {
    rootObjectKeys: RECEIPT_KEYS
  }));
  if (source !== JSON.stringify(canonicalJson(receipt))) {
    fail('corrupt-object', 'Diagnostic receipt bytes are not canonical');
  }
  return receipt;
}
