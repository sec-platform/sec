/** Pure audit wire and decision kernel; parent fact compilation never loads in the worker. */
import { canonicalJson, deepFreeze, isPlainObject, sha256 } from '../../../contracts/canonical.ts';
import { parseExactJsonBytes } from '../../../contracts/exact-json.ts';

type Digest = `sha256:${string}`;

const OPERATION_INPUT_KEYS = Object.freeze([
  'binding',
  'blockingReasons',
  'enforce',
  'projection',
  'reductionPatch'
]);

const OPERATION_RESULT_KEYS = Object.freeze([
  'exitCode',
  'projection',
  'reductionPatch',
  'resultDigest'
]);

const OPERATION_WIRE_MAXIMUM_DEPTH = 256;

type SourceProgramAuditReductionPatch = Readonly<{
  readonly sourceRevision: string;
  readonly planDigest: string;
  readonly patchDigest: string;
  readonly patch: string;
  readonly files: readonly Readonly<{
    readonly path: string;
    readonly beforeDigest: string;
    readonly afterDigest: string;
  }>[];
}>;

export interface SourceProgramAuditOperationResult {
  readonly projection: Readonly<Record<string, unknown>>;
  readonly reductionPatch: SourceProgramAuditReductionPatch | null;
  readonly exitCode: 0 | 1;
  readonly resultDigest: Digest;
}

export interface SourceProgramAuditOperationInput {
  readonly binding: Readonly<{
    readonly sourceRevision: string;
    readonly modelDigest: string;
    readonly subjectDigest: Digest;
  }>;
  readonly blockingReasons: readonly string[];
  readonly enforce: boolean;
  readonly projection: Readonly<Record<string, unknown>>;
  readonly reductionPatch: SourceProgramAuditReductionPatch | null;
}

function operationInputProjection(
  input: SourceProgramAuditOperationInput
): SourceProgramAuditOperationInput {
  return Object.freeze({
    binding: input.binding,
    blockingReasons: input.blockingReasons,
    enforce: input.enforce,
    projection: input.projection,
    reductionPatch: input.reductionPatch
  });
}

function canonicalWireBytes(value: unknown): Uint8Array {
  return Buffer.from(JSON.stringify(canonicalJson(value)), 'utf8');
}

function requireCanonicalWireObject(
  bytes: Uint8Array,
  maximumInputBytes: number,
  label: string,
  rootObjectKeys: readonly string[]
): Record<string, unknown> {
  const parsed = parseExactJsonBytes(bytes, label, {
    maximumDepth: OPERATION_WIRE_MAXIMUM_DEPTH,
    maximumInputBytes
  }, { rootObjectKeys });
  if (!isPlainObject(parsed)) throw new Error(label + ' must be one object');
  if (!Buffer.from(canonicalWireBytes(parsed)).equals(Buffer.from(bytes))) {
    throw new Error(label + ' must use canonical JSON bytes');
  }
  return parsed;
}

/**
 * Encodes the parent-normalized pure operation input. Extra caller properties
 * are projected out before the bytes cross the process boundary.
 */
export function encodeSourceProgramAuditOperationInput(
  input: SourceProgramAuditOperationInput
): Uint8Array {
  const projected = operationInputProjection(input);
  assertOperationInput(projected);
  return canonicalWireBytes(projected);
}

/**
 * Parses one bounded canonical pure-operation input. The wire parser owns
 * syntax and exact root fields; the parent compiler owns every fact join.
 * The returned value is data only and carries no authority.
 */
export function parseSourceProgramAuditOperationInput(
  bytes: Uint8Array,
  maximumInputBytes: number
): SourceProgramAuditOperationInput {
  const parsed = requireCanonicalWireObject(
    bytes,
    maximumInputBytes,
    'Repository Audit Source Program operation input',
    OPERATION_INPUT_KEYS
  );
  const input = deepFreeze(parsed) as unknown as SourceProgramAuditOperationInput;
  assertOperationInput(input);
  return input;
}

function operationExitCode(enforce: boolean, reasons: readonly string[]): 0 | 1 {
  return enforce && reasons.length > 0 ? 1 : 0;
}

function readEnforcement(projection: Readonly<Record<string, unknown>>): Readonly<{
  requested: boolean; blockingReasons: readonly string[];
}> {
  const enforcement = projection.enforcement;
  if (!isPlainObject(enforcement) || typeof enforcement.requested !== 'boolean'
      || !Array.isArray(enforcement.blockingReasons)) {
    throw new Error('Repository Audit report is missing an explicit enforcement decision');
  }
  const reasons = enforcement.blockingReasons as unknown[];
  for (const reason of reasons) {
    if (typeof reason !== 'string' || reason.length === 0 || reason.trim() !== reason) {
      throw new Error('Repository Audit report has invalid blocking reasons');
    }
  }
  if (new Set(reasons).size !== reasons.length) {
    throw new Error('Repository Audit report repeats a blocking reason');
  }
  return enforcement as { requested: boolean; blockingReasons: readonly string[] };
}

function assertResultDecision(projection: Readonly<Record<string, unknown>>, exitCode: number): void {
  const enforcement = readEnforcement(projection);
  if (exitCode !== operationExitCode(enforcement.requested, enforcement.blockingReasons)) {
    throw new Error('Repository Audit result exit code contradicts its reported enforcement decision');
  }
}

function assertOperationInput(input: SourceProgramAuditOperationInput): void {
  if (!isPlainObject(input.binding)
      || !/^sha256:[0-9a-f]{64}$/u.test(input.binding.sourceRevision)
      || !/^sha256:[0-9a-f]{64}$/u.test(input.binding.modelDigest)
      || !/^sha256:[0-9a-f]{64}$/u.test(input.binding.subjectDigest)
      || !Array.isArray(input.blockingReasons)
      || input.blockingReasons.some((reason) => (
        typeof reason !== 'string' || reason.length === 0 || reason.trim() !== reason
      ))
      || new Set(input.blockingReasons).size !== input.blockingReasons.length
      || typeof input.enforce !== 'boolean'
      || !isPlainObject(input.projection)
      || input.projection.sourceRevision !== input.binding.sourceRevision
      || input.projection.modelDigest !== input.binding.modelDigest
      || (input.reductionPatch !== null && !isPlainObject(input.reductionPatch))) {
    throw new Error('Repository Audit Source Program operation input is inconsistent');
  }
  const enforcement = readEnforcement(input.projection);
  if (enforcement.requested !== input.enforce
      || enforcement.blockingReasons.length !== input.blockingReasons.length
      || enforcement.blockingReasons.some((reason, index) => reason !== input.blockingReasons[index])) {
    throw new Error('Repository Audit input contradicts its reported enforcement decision');
  }
  if (input.reductionPatch !== null
      && input.reductionPatch.sourceRevision !== input.binding.sourceRevision) {
    throw new Error('Repository Audit reduction patch belongs to another source revision');
  }
}

export function encodeSourceProgramAuditOperationResult(
  result: SourceProgramAuditOperationResult
): Uint8Array {
  if (!isPlainObject(result.projection)
      || (result.exitCode !== 0 && result.exitCode !== 1)
      || result.resultDigest !== sha256({
        projection: result.projection,
        reductionPatch: result.reductionPatch,
        exitCode: result.exitCode
      })) {
    throw new Error('Repository Audit Source Program operation result is inconsistent');
  }
  assertResultDecision(result.projection, result.exitCode);
  return canonicalWireBytes({
    exitCode: result.exitCode,
    projection: result.projection,
    reductionPatch: result.reductionPatch,
    resultDigest: result.resultDigest
  });
}

export function parseSourceProgramAuditOperationResult(
  bytes: Uint8Array,
  maximumInputBytes: number
): SourceProgramAuditOperationResult {
  const parsed = requireCanonicalWireObject(
    bytes,
    maximumInputBytes,
    'Repository Audit Source Program operation result',
    OPERATION_RESULT_KEYS
  );
  if (!isPlainObject(parsed.projection)
      || (parsed.exitCode !== 0 && parsed.exitCode !== 1)
      || (parsed.reductionPatch !== null && !isPlainObject(parsed.reductionPatch))) {
    throw new Error('Repository Audit Source Program operation result shape is invalid');
  }
  const result = deepFreeze(parsed) as unknown as SourceProgramAuditOperationResult;
  if (result.resultDigest !== sha256({
    projection: result.projection,
    reductionPatch: result.reductionPatch,
    exitCode: result.exitCode
  })) {
    throw new Error('Repository Audit Source Program operation result digest differs');
  }
  assertResultDecision(result.projection, result.exitCode);
  return result;
}

export function compileSourceProgramAuditOperation(
  input: SourceProgramAuditOperationInput
): SourceProgramAuditOperationResult {
  assertOperationInput(input);
  const exitCode = operationExitCode(input.enforce, input.blockingReasons);
  const projection = input.projection;
  const reductionPatch = input.reductionPatch;
  const resultDigest = sha256({ projection, reductionPatch, exitCode }) as Digest;
  return Object.freeze({ projection, reductionPatch, exitCode, resultDigest });
}
