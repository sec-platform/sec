import { CompilerError } from '../../shared/errors.ts';
import type {
  SemanticFactSelectorV1,
  SemanticMutationDiagnosticOrigin,
  SemanticMutationDiagnosticStage,
  SemanticMutationDiagnosticV2,
  VerificationRequirementV1
} from '../../shared/semantic-mutation-types.ts';
import { digest } from '../ir/ir-revision.ts';

const STAGE_ORDER: readonly SemanticMutationDiagnosticStage[] = [
  'request',
  'base',
  'precondition',
  'source-resolution',
  'path',
  'transform',
  'cas',
  'staged-rebuild',
  'fact-delta',
  'expectation',
  'impact',
  'impact-verification',
  'publish',
  'rollback'
];

const ORIGIN_ORDER: readonly SemanticMutationDiagnosticOrigin[] = [
  'semantic-mutation',
  'fact-delta',
  'impact',
  'compiler',
  'verification'
];

export const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;

export class SemanticMutationContractError extends CompilerError {
  readonly diagnostic: SemanticMutationDiagnosticV2;

  constructor(diagnostic: SemanticMutationDiagnosticV2) {
    super(diagnostic.code, diagnostic.message, diagnostic.details as Record<string, unknown> | undefined);
    this.diagnostic = diagnostic;
  }
}

export function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function sha256(value: unknown): string {
  return `sha256:${digest(JSON.stringify(value))}`;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function canonicalJson(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Canonical JSON numbers must be finite');
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!isPlainObject(value)) throw new Error('Canonical JSON only accepts arrays and plain objects');
  return Object.fromEntries(Object.keys(value)
    .sort(compareCodeUnits)
    .map((key) => {
      const entry = value[key];
      if (entry === undefined || typeof entry === 'bigint' || typeof entry === 'function' || typeof entry === 'symbol') {
        throw new Error(`Canonical JSON rejects unsupported value at key "${key}"`);
      }
      return [key, canonicalJson(entry)];
    }));
}

export function cloneAndDeepFreeze<Value>(value: Value): Value {
  const clone = structuredClone(value);
  const freeze = (entry: unknown): void => {
    if (entry === null || typeof entry !== 'object' || Object.isFrozen(entry)) return;
    for (const nested of Object.values(entry as Record<string, unknown>)) freeze(nested);
    Object.freeze(entry);
  };
  freeze(clone);
  return clone;
}

export function exactOwnKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = []
): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key));
}

export function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value === value.trim();
}

export function digestString(value: unknown): value is string {
  return typeof value === 'string' && SHA256_PATTERN.test(value);
}

export function factSelectorKey(selector: SemanticFactSelectorV1): string {
  return [selector.subject, selector.predicate, JSON.stringify(canonicalJson(selector.object))].join('\u0000');
}

export function verificationRequirementKey(requirement: VerificationRequirementV1): string {
  if (requirement.kind === 'acceptance') return `acceptance\u0000${requirement.acceptanceEntityId}`;
  if (requirement.kind === 'selector') return `selector\u0000${requirement.selector}`;
  return `pass\u0000${requirement.passId}`;
}

export function compareVerificationRequirements(
  left: VerificationRequirementV1,
  right: VerificationRequirementV1
): number {
  return compareCodeUnits(verificationRequirementKey(left), verificationRequirementKey(right));
}

export function canonicalVerificationUnion(
  ...collections: readonly (readonly VerificationRequirementV1[])[]
): VerificationRequirementV1[] {
  const values = new Map<string, VerificationRequirementV1>();
  for (const collection of collections) {
    for (const requirement of collection) {
      values.set(verificationRequirementKey(requirement), structuredClone(requirement));
    }
  }
  return [...values.values()].sort(compareVerificationRequirements);
}

function diagnosticDetailsJson(value: SemanticMutationDiagnosticV2): string {
  return JSON.stringify(value.details === undefined ? null : canonicalJson(value.details));
}

export function compareDiagnostics(
  left: SemanticMutationDiagnosticV2,
  right: SemanticMutationDiagnosticV2
): number {
  return STAGE_ORDER.indexOf(left.stage) - STAGE_ORDER.indexOf(right.stage) ||
    compareCodeUnits(left.operationId ?? '', right.operationId ?? '') ||
    compareCodeUnits(left.conditionId ?? '', right.conditionId ?? '') ||
    compareCodeUnits((left.relativePath ?? '').toLocaleLowerCase('en-US'), (right.relativePath ?? '').toLocaleLowerCase('en-US')) ||
    ORIGIN_ORDER.indexOf(left.origin) - ORIGIN_ORDER.indexOf(right.origin) ||
    compareCodeUnits(left.code, right.code) ||
    compareCodeUnits(left.message, right.message) ||
    compareCodeUnits(diagnosticDetailsJson(left), diagnosticDetailsJson(right));
}

export function canonicalDiagnostics(
  diagnostics: readonly SemanticMutationDiagnosticV2[]
): SemanticMutationDiagnosticV2[] {
  return diagnostics.map((diagnostic) => {
    const { details, ...withoutDetails } = diagnostic;
    return {
      ...withoutDetails,
      ...(details === undefined
        ? {}
        : { details: canonicalJson(details) as Readonly<Record<string, unknown>> })
    };
  }).sort(compareDiagnostics);
}

export function mutationDiagnostic(
  code: string,
  stage: SemanticMutationDiagnosticStage,
  message: string,
  fields: Omit<SemanticMutationDiagnosticV2, 'origin' | 'code' | 'stage' | 'message'> = {}
): SemanticMutationDiagnosticV2 {
  return { origin: 'semantic-mutation', code, stage, message, ...fields };
}

export function throwMutationDiagnostic(
  code: string,
  stage: SemanticMutationDiagnosticStage,
  message: string,
  fields: Omit<SemanticMutationDiagnosticV2, 'origin' | 'code' | 'stage' | 'message'> = {}
): never {
  throw new SemanticMutationContractError(mutationDiagnostic(code, stage, message, fields));
}

export function nestedDiagnostic(
  error: unknown,
  origin: Exclude<SemanticMutationDiagnosticOrigin, 'semantic-mutation'>,
  stage: SemanticMutationDiagnosticStage
): SemanticMutationDiagnosticV2 {
  if (error instanceof SemanticMutationContractError) return error.diagnostic;
  if (error instanceof CompilerError) {
    return {
      origin,
      code: error.code,
      stage,
      message: error.message,
      ...(error.details === undefined ? {} : { details: canonicalJson(error.details) as Readonly<Record<string, unknown>> })
    };
  }
  return {
    origin,
    code: origin === 'impact' ? 'IMPACT-UNKNOWN' : 'COMPILER-UNKNOWN',
    stage,
    message: error instanceof Error ? error.message : 'Unknown producer failure'
  };
}

export function diagnosticRevision(diagnostics: readonly SemanticMutationDiagnosticV2[]): string {
  return sha256({ domain: 'semantic-mutation-diagnostic-v2', diagnostics: canonicalDiagnostics(diagnostics) });
}
