import { CompilerError } from '../../shared/errors.ts';
import type {
  SemanticFactSelectorV1,
  SemanticMutationDiagnosticOrigin,
  SemanticMutationDiagnosticStage,
  SemanticMutationDiagnosticV2,
  VerificationRequirementV1
} from '../../shared/semantic-mutation-types.ts';
import {
  canonicalEquals,
  canonicalJson,
  cloneAndDeepFreeze,
  compareCodeUnits,
  isPlainObject,
  rawSha256,
  sha256,
  sortedKeys
} from '../ir/ir-canonical-primitives.ts';

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

// Re-export canonical primitives so existing call sites keep working.
// The canonical owner lives at `../../shared/canonical-primitives.ts`;
// `../ir/ir-canonical-primitives.ts` re-exports it for the compiler subsystem.
export {
  canonicalEquals,
  canonicalJson,
  cloneAndDeepFreeze,
  compareCodeUnits,
  isPlainObject,
  rawSha256,
  sha256,
  sortedKeys
};

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

const TRUSTED_NESTED_PRODUCER_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  'FACT-DELTA-001': 'Fact Delta endpoint binding failed',
  'FACT-DELTA-002': 'Fact Delta endpoint lineage mismatch',
  'FACT-DELTA-003': 'Fact Delta revision invariant failed',
  'FACT-DELTA-004': 'Semantic Fact identity collision',
  'FACT-DELTA-005': 'Fact assertion identity collision',
  'FACT-DELTA-006': 'Fact Delta validity is unsupported',
  'FACT-DELTA-007': 'Fact Delta canonical invariant failed',
  'IMPACT-001': 'Impact endpoint binding failed',
  'IMPACT-002': 'Impact canonical Delta binding failed',
  'IMPACT-003': 'Impact propagation rule invariant failed',
  'IMPACT-004': 'Impact Entity identity collision',
  'IMPACT-005': 'Impact Verification mapping is invalid',
  'IMPACT-006': 'Impact reference or canonical invariant failed'
});

function redactedNestedProducerDetails(
  origin: Exclude<SemanticMutationDiagnosticOrigin, 'semantic-mutation'>,
  code: string,
  details: unknown
): Readonly<Record<string, unknown>> | undefined {
  try {
    const canonical = canonicalJson(details);
    if (!isPlainObject(canonical) || Object.keys(canonical).length === 0) return undefined;
    return {
      redactedDetailRevision: sha256({
        domain: 'semantic-mutation-redacted-nested-detail-v1',
        origin,
        code,
        details: canonical
      })
    };
  } catch {
    return undefined;
  }
}

export function nestedDiagnostic(
  error: unknown,
  origin: Exclude<SemanticMutationDiagnosticOrigin, 'semantic-mutation'>,
  stage: SemanticMutationDiagnosticStage
): SemanticMutationDiagnosticV2 {
  const trustedMessage = error instanceof CompilerError
    ? TRUSTED_NESTED_PRODUCER_MESSAGES[error.code]
    : undefined;
  const trustedProducerCode = trustedMessage !== undefined && (
    (origin === 'fact-delta' && error instanceof CompilerError && error.code.startsWith('FACT-DELTA-')) ||
    (origin === 'impact' && error instanceof CompilerError && error.code.startsWith('IMPACT-'))
  );
  if (trustedProducerCode && error instanceof CompilerError) {
    const details = redactedNestedProducerDetails(origin, error.code, error.details);
    return {
      origin,
      code: error.code,
      stage,
      message: trustedMessage,
      ...(details === undefined ? {} : { details })
    };
  }
  return {
    origin,
    code: origin === 'impact' ? 'IMPACT-UNKNOWN' : 'COMPILER-UNKNOWN',
    stage,
    message: 'Unknown producer failure'
  };
}

export function diagnosticRevision(diagnostics: readonly SemanticMutationDiagnosticV2[]): string {
  return sha256({ domain: 'semantic-mutation-diagnostic-v2', diagnostics: canonicalDiagnostics(diagnostics) });
}
