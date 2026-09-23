import {
  SEMANTIC_MUTATION_REJECTED_TERMINAL_RECORD_REVISION,
  type SemanticMutationRejectedTerminalRecord
} from '../../semantics/mutation/transaction.ts';
import type { SemanticMutationResult } from '../../semantics/mutation/types.ts';
import {
  canonicalDiagnostics,
  canonicalEquals,
  cloneAndDeepFreeze,
  digestString,
  exactOwnKeys,
  isPlainObject,
  nonEmptyString,
  sha256
} from './canonical.ts';
import { semanticMutationResultRevision } from './result.ts';

function semanticMutationRejectedTerminalRecordRevision(
  value: Omit<SemanticMutationRejectedTerminalRecord, 'recordRevision'>
): string {
  return sha256({
    domain: 'semantic-mutation-rejected-terminal-record-v1',
    ...value
  });
}

function exactBase(value: unknown): boolean {
  return isPlainObject(value) &&
    exactOwnKeys(value, ['transactionId', 'inputRevision', 'semanticRevision']) &&
    nonEmptyString(value.transactionId) &&
    nonEmptyString(value.inputRevision) &&
    nonEmptyString(value.semanticRevision);
}

function assertRejectedResultInvariant(
  result: Extract<SemanticMutationResult, { readonly status: 'rejected' }>
): void {
  if (!isPlainObject(result) ||
      !exactOwnKeys(result, [
        'contractVersion',
        'requestId',
        'requestRevision',
        'planRevision',
        'base',
        'resultRevision',
        'status',
        'sourceChanges',
        'diagnostics'
      ], [
        'transactionId',
        'attempted',
        'actualDelta',
        'impact',
        'verification'
      ]) ||
      result.contractVersion !== '2' ||
      result.status !== 'rejected' ||
      !nonEmptyString(result.requestId) ||
      !digestString(result.requestRevision) ||
      !digestString(result.planRevision) ||
      !exactBase(result.base) ||
      (result.transactionId !== undefined &&
        !nonEmptyString(result.transactionId)) ||
      (result.attempted !== undefined && !exactBase(result.attempted)) ||
      !Array.isArray(result.sourceChanges) ||
      !Array.isArray(result.diagnostics) ||
      result.diagnostics.length === 0 ||
      !canonicalEquals(
        result.diagnostics,
        canonicalDiagnostics(result.diagnostics)
      )) {
    throw new Error(
      'Rejected Semantic Mutation result violates the frozen terminal schema'
    );
  }
  const { resultRevision: supplied, ...withoutRevision } = result;
  if (supplied !== semanticMutationResultRevision(withoutRevision)) {
    throw new Error('Rejected Semantic Mutation result revision is invalid');
  }
}

export function assertSemanticMutationRejectedTerminalRecordInvariant(
  record: SemanticMutationRejectedTerminalRecord
): void {
  if (!isPlainObject(record) ||
      !exactOwnKeys(record, [
        'formatRevision',
        'requestIdentityDigest',
        'requestRevision',
        'planRevision',
        'terminalSequence',
        'result',
        'recordRevision'
      ])) {
    throw new Error(
      'Rejected Semantic Mutation terminal record violates the frozen v1 schema'
    );
  }
  assertRejectedResultInvariant(record.result);
  const { recordRevision: supplied, ...withoutRevision } = record;
  if (record.formatRevision !==
        SEMANTIC_MUTATION_REJECTED_TERMINAL_RECORD_REVISION ||
      !digestString(record.requestIdentityDigest) ||
      !digestString(record.requestRevision) ||
      !digestString(record.planRevision) ||
      !Number.isSafeInteger(record.terminalSequence) ||
      record.terminalSequence <= 0 ||
      record.requestRevision !== record.result.requestRevision ||
      record.planRevision !== record.result.planRevision ||
      supplied !== semanticMutationRejectedTerminalRecordRevision(
        withoutRevision
      )) {
    throw new Error(
      'Rejected Semantic Mutation terminal record is invalid'
    );
  }
}

export function buildSemanticMutationRejectedTerminalRecord(input: Readonly<{
  requestIdentityDigest: string;
  requestRevision: string;
  planRevision: string;
  terminalSequence: number;
  result: Extract<SemanticMutationResult, { readonly status: 'rejected' }>;
}>): SemanticMutationRejectedTerminalRecord {
  assertRejectedResultInvariant(input.result);
  if (!digestString(input.requestIdentityDigest) ||
      input.requestRevision !== input.result.requestRevision ||
      input.planRevision !== input.result.planRevision) {
    throw new Error(
      'Rejected Semantic Mutation terminal input is not cross-bound to its result'
    );
  }
  const withoutRevision = {
    formatRevision: SEMANTIC_MUTATION_REJECTED_TERMINAL_RECORD_REVISION,
    requestIdentityDigest: input.requestIdentityDigest,
    requestRevision: input.requestRevision,
    planRevision: input.planRevision,
    terminalSequence: input.terminalSequence,
    result: input.result
  } as const;
  const record = cloneAndDeepFreeze({
    ...withoutRevision,
    recordRevision: semanticMutationRejectedTerminalRecordRevision(
      withoutRevision
    )
  });
  assertSemanticMutationRejectedTerminalRecordInvariant(record);
  return record;
}
