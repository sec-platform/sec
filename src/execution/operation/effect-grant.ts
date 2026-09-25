import { randomBytes } from 'node:crypto';
import { deepFreeze, sha256 } from '../../contracts/canonical.ts';
import { SEMANTIC_OPERATION_ID_PATTERN } from './identity.ts';
import {
  assertSemanticOperationPlan,
  compileSemanticOperationIntent,
  type OperationDigest,
  type SemanticOperationIntent,
  type SemanticOperationPlan
} from './semantic.ts';

declare const SEC_OPERATION_EFFECT_GRANT_BRAND: unique symbol;

/**
 * Process-local authority for one Effect attempt.  The runtime object carries
 * no serializable authority fields; only its issuing authority's paired
 * consumer can resolve it.
 */
export type OperationEffectGrant = Readonly<{
  readonly [SEC_OPERATION_EFFECT_GRANT_BRAND]: true;
}>;

const OPERATION_EFFECT_GRANT_FAILURE_REASONS = Object.freeze([
  'already-consumed',
  'deadline-mismatch',
  'decision-mismatch',
  'epoch-mismatch',
  'execution-plan-mismatch',
  'expired',
  'foreign-grant',
  'grant-attempt-mismatch',
  'intent-mismatch',
  'invalid-authority',
  'operation-mismatch'
] as const);

export type OperationEffectGrantFailureReason =
  (typeof OPERATION_EFFECT_GRANT_FAILURE_REASONS)[number];

export class OperationEffectGrantError extends Error {
  readonly code = 'SEC-OPERATION-EFFECT-GRANT';

  constructor(readonly reason: OperationEffectGrantFailureReason, message: string) {
    super(message);
    this.name = 'OperationEffectGrantError';
  }
}

export type IssuedOperationEffectGrant = Readonly<{
  readonly grant: OperationEffectGrant;
  /** Correlation digest consumed by the semantic attempt compiler; not Effect authority. */
  readonly authorityGrantDigest: OperationDigest;
  readonly operationIdentityDigest: OperationDigest;
  readonly executionPlanDigest: OperationDigest;
  readonly currentEpochDigest: OperationDigest;
  readonly deadlineAtUnixMs: number;
}>;

export type ConsumedOperationEffectGrantBinding = Readonly<{
  readonly authorityGrantDigest: OperationDigest;
  readonly operationIdentityDigest: OperationDigest;
  readonly executionPlanDigest: OperationDigest;
  readonly attemptDigest: OperationDigest;
  readonly currentEpochDigest: OperationDigest;
  readonly deadlineAtUnixMs: number;
  readonly attemptBindingDigest: OperationDigest;
}>;

type OperationEffectGrantIssuer = Readonly<{
  issue(input: Readonly<{
    readonly operation: SemanticOperationIntent;
    readonly currentEpochDigest: OperationDigest;
    readonly deadlineAtUnixMs: number;
  }>): IssuedOperationEffectGrant;
}>;

type OperationEffectGrantConsumer = Readonly<{
  consume(input: Readonly<{
    readonly grant: OperationEffectGrant;
    readonly operation: SemanticOperationPlan;
    readonly currentEpochDigest: OperationDigest;
  }>): ConsumedOperationEffectGrantBinding;
}>;

export type OperationEffectGrantAuthority = Readonly<{
  /** Kept by the exact sec.module operation classified as grant-issuer. */
  readonly issuer: OperationEffectGrantIssuer;
  /** Given to the Effect owner without exposing grant issuance. */
  readonly consumer: OperationEffectGrantConsumer;
}>;

type GrantRecord = {
  readonly issuerIdentityDigest: OperationDigest;
  readonly semanticOperation: string;
  readonly intentDigest: OperationDigest;
  readonly decisionDigest: OperationDigest;
  readonly operationIdentityDigest: OperationDigest;
  readonly executionPlanDigest: OperationDigest;
  readonly currentEpochDigest: OperationDigest;
  readonly deadlineAtUnixMs: number;
  readonly deadlineAtMonotonicMs: number;
  readonly authorityGrantDigest: OperationDigest;
  consumed: boolean;
};

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;

function fail(reason: OperationEffectGrantFailureReason, message: string): never {
  throw new OperationEffectGrantError(reason, message);
}

function requireDigest(value: string, label: string): OperationDigest {
  if (!DIGEST_PATTERN.test(value)) {
    fail('invalid-authority', `${label} must be one canonical SHA-256 digest.`);
  }
  return value as OperationDigest;
}

function requireCanonicalIntent(operation: SemanticOperationIntent): void {
  const canonical = compileSemanticOperationIntent({
    operation: operation.identity.operation,
    intentDigest: operation.identity.intentDigest,
    decisionDigest: operation.identity.decisionDigest,
    aggregateBudgets: operation.execution.aggregateBudgets,
    requirements: operation.execution.requirements
  });
  if (canonical.identity.identityDigest !== operation.identity.identityDigest
      || canonical.execution.operationIdentityDigest
        !== operation.execution.operationIdentityDigest
      || canonical.execution.executionPlanDigest !== operation.execution.executionPlanDigest) {
    fail('invalid-authority', 'Effect grant issuance requires one canonical semantic operation intent.');
  }
}

/**
 * Creates one process-local issuer/consumer pair for exactly one semantic
 * operation.  This factory does not itself grant an Effect: a domain module
 * must keep `issuer` behind its exported operation classified as
 * `grant-issuer` in `module.json`, while the Effect owner receives only
 * `consumer`.
 */
export function createOperationEffectGrantAuthority(input: Readonly<{
  readonly semanticOperation: string;
  readonly issuerIdentityDigest: OperationDigest;
}>): OperationEffectGrantAuthority {
  if (!SEMANTIC_OPERATION_ID_PATTERN.test(input.semanticOperation)) {
    fail('invalid-authority', 'Effect grant semantic operation must be canonical.');
  }
  const issuerIdentityDigest = requireDigest(
    input.issuerIdentityDigest,
    'Effect grant issuer identity digest'
  );
  const grants = new WeakMap<object, GrantRecord>();

  const issuer: OperationEffectGrantIssuer = Object.freeze({
    issue(issueInput) {
      requireCanonicalIntent(issueInput.operation);
      if (issueInput.operation.identity.operation !== input.semanticOperation) {
        fail('operation-mismatch', 'Effect grant issuer does not own this semantic operation.');
      }
      const currentEpochDigest = requireDigest(
        issueInput.currentEpochDigest,
        'Effect grant current epoch digest'
      );
      const now = Date.now();
      if (!Number.isSafeInteger(issueInput.deadlineAtUnixMs)
          || issueInput.deadlineAtUnixMs <= now) {
        fail('expired', 'Effect grant deadline must be a future absolute safe integer.');
      }
      const deadlineAtMonotonicMs = performance.now() + (issueInput.deadlineAtUnixMs - now);
      const nonceDigest = `sha256:${randomBytes(32).toString('hex')}` as OperationDigest;
      const authorityGrantDigest = sha256({
        domain: 'sec.operation.effect-grant',
        issuerIdentityDigest,
        semanticOperation: input.semanticOperation,
        intentDigest: issueInput.operation.identity.intentDigest,
        decisionDigest: issueInput.operation.identity.decisionDigest,
        operationIdentityDigest: issueInput.operation.identity.identityDigest,
        executionPlanDigest: issueInput.operation.execution.executionPlanDigest,
        currentEpochDigest,
        deadlineAtUnixMs: issueInput.deadlineAtUnixMs,
        nonceDigest
      }) as OperationDigest;
      const grant = Object.freeze({}) as OperationEffectGrant;
      grants.set(grant, {
        issuerIdentityDigest,
        semanticOperation: input.semanticOperation,
        intentDigest: issueInput.operation.identity.intentDigest,
        decisionDigest: issueInput.operation.identity.decisionDigest,
        operationIdentityDigest: issueInput.operation.identity.identityDigest,
        executionPlanDigest: issueInput.operation.execution.executionPlanDigest,
        currentEpochDigest,
        deadlineAtUnixMs: issueInput.deadlineAtUnixMs,
        deadlineAtMonotonicMs,
        authorityGrantDigest,
        consumed: false
      });
      return deepFreeze({
        grant,
        authorityGrantDigest,
        operationIdentityDigest: issueInput.operation.identity.identityDigest,
        executionPlanDigest: issueInput.operation.execution.executionPlanDigest,
        currentEpochDigest,
        deadlineAtUnixMs: issueInput.deadlineAtUnixMs
      });
    }
  });

  const consumer: OperationEffectGrantConsumer = Object.freeze({
    consume(consumeInput) {
      const record = grants.get(consumeInput.grant);
      if (record === undefined || record.issuerIdentityDigest !== issuerIdentityDigest) {
        fail('foreign-grant', 'Effect grant was not issued by this authority.');
      }
      if (record.consumed) {
        fail('already-consumed', 'Effect grant has already been consumed.');
      }
      assertSemanticOperationPlan(consumeInput.operation);
      const currentEpochDigest = requireDigest(
        consumeInput.currentEpochDigest,
        'Effect grant current epoch digest'
      );
      const plan = consumeInput.operation;
      if (plan.identity.operation !== record.semanticOperation) {
        fail('operation-mismatch', 'Effect grant does not bind this semantic operation.');
      }
      if (plan.identity.intentDigest !== record.intentDigest) {
        fail('intent-mismatch', 'Effect grant does not bind this operation intent.');
      }
      if (plan.identity.decisionDigest !== record.decisionDigest) {
        fail('decision-mismatch', 'Effect grant does not bind this operation decision.');
      }
      if (plan.identity.identityDigest !== record.operationIdentityDigest) {
        fail('operation-mismatch', 'Effect grant operation identity has drifted.');
      }
      if (plan.execution.executionPlanDigest !== record.executionPlanDigest) {
        fail('execution-plan-mismatch', 'Effect grant execution plan has drifted.');
      }
      if (currentEpochDigest !== record.currentEpochDigest) {
        fail('epoch-mismatch', 'Effect grant current epoch has drifted.');
      }
      if (plan.attempt.deadlineAtUnixMs !== record.deadlineAtUnixMs) {
        fail('deadline-mismatch', 'Effect grant deadline does not bind the operation attempt.');
      }
      if (Date.now() >= record.deadlineAtUnixMs
          || performance.now() >= record.deadlineAtMonotonicMs) {
        fail('expired', 'Effect grant expired before consumption.');
      }
      if (plan.attempt.authorityGrantDigest !== record.authorityGrantDigest) {
        fail('grant-attempt-mismatch', 'Effect grant does not bind the operation attempt authority.');
      }

      // All checks and the state transition are synchronous.  Marking consumed
      // before returning ensures re-entrant callers cannot observe an unused
      // grant after the Effect owner admits the attempt.
      record.consumed = true;
      const attemptBindingDigest = sha256({
        domain: 'sec.operation.effect-grant-attempt-binding',
        authorityGrantDigest: record.authorityGrantDigest,
        operationIdentityDigest: record.operationIdentityDigest,
        executionPlanDigest: record.executionPlanDigest,
        attemptDigest: plan.attempt.attemptDigest,
        currentEpochDigest: record.currentEpochDigest,
        deadlineAtUnixMs: record.deadlineAtUnixMs
      }) as OperationDigest;
      return deepFreeze({
        authorityGrantDigest: record.authorityGrantDigest,
        operationIdentityDigest: record.operationIdentityDigest,
        executionPlanDigest: record.executionPlanDigest,
        attemptDigest: plan.attempt.attemptDigest,
        currentEpochDigest: record.currentEpochDigest,
        deadlineAtUnixMs: record.deadlineAtUnixMs,
        attemptBindingDigest
      });
    }
  });

  return Object.freeze({ issuer, consumer });
}
