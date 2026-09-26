import { randomBytes } from 'node:crypto';

import { deepFreeze } from '../../contracts/canonical.ts';
import { type Identity } from '../../contracts/identity-profile.ts';
import {
  assertStructuredIdentityRuntime,
  type StructuredIdentityRuntime
} from '../../contracts/structured-identity.ts';
import {
  assertOperationFoundation,
  type OperationFoundation,
  type OperationIdentityReference,
  type SemanticOperationIntent,
  type SemanticOperationPlan
} from './identity-foundation.ts';
import { SEMANTIC_OPERATION_ID_PATTERN } from './identity.ts';

export type OperationEffectGrantFailureReason =
  | 'already-consumed'
  | 'deadline-mismatch'
  | 'epoch-mismatch'
  | 'execution-plan-mismatch'
  | 'expired'
  | 'foreign-grant'
  | 'grant-attempt-mismatch'
  | 'invalid-authority'
  | 'operation-mismatch';

export class OperationEffectGrantError extends Error {
  readonly code = 'SEC-OPERATION-EFFECT-GRANT';

  constructor(readonly reason: OperationEffectGrantFailureReason, message: string) {
    super(message);
    this.name = 'OperationEffectGrantError';
  }
}

declare const OPERATION_EFFECT_GRANT_BRAND: unique symbol;
export type OperationEffectGrant = Readonly<{
  readonly [OPERATION_EFFECT_GRANT_BRAND]: true;
}>;

export type IssuedOperationEffectGrant = Readonly<{
  readonly grant: OperationEffectGrant;
  readonly authorityGrant: OperationIdentityReference;
  readonly operationIdentity: SemanticOperationIntent['identity'];
  readonly executionIdentity: SemanticOperationIntent['execution']['identity'];
  readonly currentEpoch: OperationIdentityReference;
  readonly deadlineAtUnixMs: number;
}>;

export type ConsumedOperationEffectGrantBinding = Readonly<{
  readonly authorityGrant: OperationIdentityReference;
  readonly operationIdentity: SemanticOperationPlan['identity'];
  readonly executionIdentity: SemanticOperationPlan['execution']['identity'];
  readonly attemptIdentity: SemanticOperationPlan['attempt']['identity'];
  readonly currentEpoch: OperationIdentityReference;
  readonly deadlineAtUnixMs: number;
  readonly identity: Identity<'operation', 'effect-grant-attempt-binding'>;
}>;

export type OperationEffectGrantAuthority = Readonly<{
  readonly issuer: Readonly<{
    issue(input: Readonly<{
      operation: SemanticOperationIntent;
      currentEpoch: OperationIdentityReference;
      deadlineAtUnixMs: number;
    }>): IssuedOperationEffectGrant;
  }>;
  readonly consumer: Readonly<{
    consume(input: Readonly<{
      grant: OperationEffectGrant;
      operation: SemanticOperationPlan;
      currentEpoch: OperationIdentityReference;
    }>): ConsumedOperationEffectGrantBinding;
  }>;
}>;

type GrantRecord = {
  readonly semanticOperation: string;
  readonly operationIdentity: SemanticOperationIntent['identity'];
  readonly executionIdentity: SemanticOperationIntent['execution']['identity'];
  readonly currentEpoch: OperationIdentityReference;
  readonly deadlineAtUnixMs: number;
  readonly deadlineAtMonotonicMs: number;
  readonly authorityGrant: OperationIdentityReference;
  consumed: boolean;
};

function fail(reason: OperationEffectGrantFailureReason, message: string): never {
  throw new OperationEffectGrantError(reason, message);
}

function sameReference(left: OperationIdentityReference, right: OperationIdentityReference): boolean {
  return left.domain === right.domain && left.schema === right.schema && left.digest === right.digest;
}

function sameIdentity(left: Identity<string, string>, right: Identity<string, string>): boolean {
  return left.profile === right.profile && left.domain === right.domain
    && left.schema === right.schema && left.digest === right.digest;
}

export function createOperationEffectGrantAuthority(input: Readonly<{
  foundation: OperationFoundation;
  identities: StructuredIdentityRuntime;
  semanticOperation: string;
  issuer: OperationIdentityReference;
}>): OperationEffectGrantAuthority {
  assertOperationFoundation(input.foundation);
  assertStructuredIdentityRuntime(input.identities);
  if (!SEMANTIC_OPERATION_ID_PATTERN.test(input.semanticOperation)) {
    fail('invalid-authority', 'Effect grant semantic operation must be canonical.');
  }
  const issuerIdentity = input.foundation.createReference(input.issuer);
  const grants = new WeakMap<object, GrantRecord>();

  const issuer: OperationEffectGrantAuthority['issuer'] = Object.freeze({
    issue(issueInput) {
      input.foundation.assertIntent(issueInput.operation);
      if (issueInput.operation.operation !== input.semanticOperation) {
        fail('operation-mismatch', 'Effect grant issuer does not own this semantic operation.');
      }
      const currentEpoch = input.foundation.createReference(issueInput.currentEpoch);
      const now = Date.now();
      if (!Number.isSafeInteger(issueInput.deadlineAtUnixMs) || issueInput.deadlineAtUnixMs <= now) {
        fail('expired', 'Effect grant deadline must be a future absolute safe integer.');
      }
      const nonce = `grantnonce256:${randomBytes(32).toString('hex')}`;
      const grantIdentity = input.identities.structuredIdentity('operation', 'effect-grant', {
        issuer: issuerIdentity,
        semanticOperation: input.semanticOperation,
        operationIdentity: issueInput.operation.identity,
        executionIdentity: issueInput.operation.execution.identity,
        currentEpoch,
        deadlineAtUnixMs: issueInput.deadlineAtUnixMs,
        nonce
      });
      const authorityGrant = input.foundation.createReference({
        domain: grantIdentity.domain,
        schema: grantIdentity.schema,
        digest: grantIdentity.digest
      });
      const grant = Object.freeze({}) as OperationEffectGrant;
      grants.set(grant, {
        semanticOperation: input.semanticOperation,
        operationIdentity: issueInput.operation.identity,
        executionIdentity: issueInput.operation.execution.identity,
        currentEpoch,
        deadlineAtUnixMs: issueInput.deadlineAtUnixMs,
        deadlineAtMonotonicMs: performance.now() + (issueInput.deadlineAtUnixMs - now),
        authorityGrant,
        consumed: false
      });
      return deepFreeze({
        grant,
        authorityGrant,
        operationIdentity: issueInput.operation.identity,
        executionIdentity: issueInput.operation.execution.identity,
        currentEpoch,
        deadlineAtUnixMs: issueInput.deadlineAtUnixMs
      });
    }
  });

  const consumer: OperationEffectGrantAuthority['consumer'] = Object.freeze({
    consume(consumeInput) {
      const record = grants.get(consumeInput.grant);
      if (record === undefined) fail('foreign-grant', 'Effect grant was not issued by this authority.');
      if (record.consumed) fail('already-consumed', 'Effect grant has already been consumed.');
      input.foundation.assertPlan(consumeInput.operation);
      const currentEpoch = input.foundation.createReference(consumeInput.currentEpoch);
      const plan = consumeInput.operation;
      if (plan.operation !== record.semanticOperation
          || !sameIdentity(plan.identity, record.operationIdentity)) {
        fail('operation-mismatch', 'Effect grant does not bind this semantic operation.');
      }
      if (!sameIdentity(plan.execution.identity, record.executionIdentity)) {
        fail('execution-plan-mismatch', 'Effect grant execution plan has drifted.');
      }
      if (!sameReference(currentEpoch, record.currentEpoch)) {
        fail('epoch-mismatch', 'Effect grant current epoch has drifted.');
      }
      if (plan.attempt.deadlineAtUnixMs !== record.deadlineAtUnixMs) {
        fail('deadline-mismatch', 'Effect grant deadline does not bind the operation attempt.');
      }
      if (Date.now() >= record.deadlineAtUnixMs || performance.now() >= record.deadlineAtMonotonicMs) {
        fail('expired', 'Effect grant expired before consumption.');
      }
      if (!sameReference(plan.attempt.authorityGrant, record.authorityGrant)) {
        fail('grant-attempt-mismatch', 'Effect grant does not bind the operation attempt authority.');
      }
      record.consumed = true;
      const identity = input.identities.structuredIdentity('operation', 'effect-grant-attempt-binding', {
        authorityGrant: record.authorityGrant,
        operationIdentity: record.operationIdentity,
        executionIdentity: record.executionIdentity,
        attemptIdentity: plan.attempt.identity,
        currentEpoch: record.currentEpoch,
        deadlineAtUnixMs: record.deadlineAtUnixMs
      });
      return deepFreeze({
        authorityGrant: record.authorityGrant,
        operationIdentity: record.operationIdentity,
        executionIdentity: record.executionIdentity,
        attemptIdentity: plan.attempt.identity,
        currentEpoch: record.currentEpoch,
        deadlineAtUnixMs: record.deadlineAtUnixMs,
        identity
      });
    }
  });

  return Object.freeze({ issuer, consumer });
}
