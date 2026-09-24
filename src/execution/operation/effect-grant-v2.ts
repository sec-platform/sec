import { randomBytes } from 'node:crypto';

import { deepFreeze } from '../../contracts/canonical.ts';
import { type Identity } from '../../contracts/identity-profile.ts';
import {
  assertStructuredIdentityRuntime,
  type StructuredIdentityRuntime
} from '../../contracts/structured-identity.ts';
import {
  assertOperationFoundationV2,
  type OperationFoundationV2,
  type OperationIdentityReference,
  type SemanticOperationIntentV2,
  type SemanticOperationPlanV2
} from './foundation-v2.ts';
import { SEC_SEMANTIC_OPERATION_ID_PATTERN } from './identity.ts';

export type OperationEffectGrantFailureReasonV2 =
  | 'already-consumed'
  | 'deadline-mismatch'
  | 'epoch-mismatch'
  | 'execution-plan-mismatch'
  | 'expired'
  | 'foreign-grant'
  | 'grant-attempt-mismatch'
  | 'invalid-authority'
  | 'operation-mismatch';

export class OperationEffectGrantErrorV2 extends Error {
  readonly code = 'SEC-OPERATION-EFFECT-GRANT-V2';

  constructor(readonly reason: OperationEffectGrantFailureReasonV2, message: string) {
    super(message);
    this.name = 'OperationEffectGrantErrorV2';
  }
}

declare const OPERATION_EFFECT_GRANT_V2: unique symbol;
export type OperationEffectGrantV2 = Readonly<{
  readonly [OPERATION_EFFECT_GRANT_V2]: true;
}>;

export type IssuedOperationEffectGrantV2 = Readonly<{
  readonly grant: OperationEffectGrantV2;
  readonly authorityGrant: OperationIdentityReference;
  readonly operationIdentity: SemanticOperationIntentV2['identity'];
  readonly executionIdentity: SemanticOperationIntentV2['execution']['identity'];
  readonly currentEpoch: OperationIdentityReference;
  readonly deadlineAtUnixMs: number;
}>;

export type ConsumedOperationEffectGrantBindingV2 = Readonly<{
  readonly authorityGrant: OperationIdentityReference;
  readonly operationIdentity: SemanticOperationPlanV2['identity'];
  readonly executionIdentity: SemanticOperationPlanV2['execution']['identity'];
  readonly attemptIdentity: SemanticOperationPlanV2['attempt']['identity'];
  readonly currentEpoch: OperationIdentityReference;
  readonly deadlineAtUnixMs: number;
  readonly identity: Identity<'operation', 'effect-grant-attempt-binding/v2'>;
}>;

export type OperationEffectGrantAuthorityV2 = Readonly<{
  readonly issuer: Readonly<{
    issue(input: Readonly<{
      operation: SemanticOperationIntentV2;
      currentEpoch: OperationIdentityReference;
      deadlineAtUnixMs: number;
    }>): IssuedOperationEffectGrantV2;
  }>;
  readonly consumer: Readonly<{
    consume(input: Readonly<{
      grant: OperationEffectGrantV2;
      operation: SemanticOperationPlanV2;
      currentEpoch: OperationIdentityReference;
    }>): ConsumedOperationEffectGrantBindingV2;
  }>;
}>;

type GrantRecord = {
  readonly semanticOperation: string;
  readonly operationIdentity: SemanticOperationIntentV2['identity'];
  readonly executionIdentity: SemanticOperationIntentV2['execution']['identity'];
  readonly currentEpoch: OperationIdentityReference;
  readonly deadlineAtUnixMs: number;
  readonly deadlineAtMonotonicMs: number;
  readonly authorityGrant: OperationIdentityReference;
  consumed: boolean;
};

function fail(reason: OperationEffectGrantFailureReasonV2, message: string): never {
  throw new OperationEffectGrantErrorV2(reason, message);
}

function sameReference(left: OperationIdentityReference, right: OperationIdentityReference): boolean {
  return left.domain === right.domain && left.schema === right.schema && left.digest === right.digest;
}

function sameIdentity(left: Identity<string, string>, right: Identity<string, string>): boolean {
  return left.profile === right.profile && left.domain === right.domain
    && left.schema === right.schema && left.digest === right.digest;
}

export function createOperationEffectGrantAuthorityV2(input: Readonly<{
  foundation: OperationFoundationV2;
  identities: StructuredIdentityRuntime;
  semanticOperation: string;
  issuer: OperationIdentityReference;
}>): OperationEffectGrantAuthorityV2 {
  assertOperationFoundationV2(input.foundation);
  assertStructuredIdentityRuntime(input.identities);
  if (!SEC_SEMANTIC_OPERATION_ID_PATTERN.test(input.semanticOperation)) {
    fail('invalid-authority', 'Effect grant v2 semantic operation must be canonical.');
  }
  const issuerIdentity = input.foundation.createReference(input.issuer);
  const grants = new WeakMap<object, GrantRecord>();

  const issuer: OperationEffectGrantAuthorityV2['issuer'] = Object.freeze({
    issue(issueInput) {
      input.foundation.assertIntent(issueInput.operation);
      if (issueInput.operation.operation !== input.semanticOperation) {
        fail('operation-mismatch', 'Effect grant v2 issuer does not own this semantic operation.');
      }
      const currentEpoch = input.foundation.createReference(issueInput.currentEpoch);
      const now = Date.now();
      if (!Number.isSafeInteger(issueInput.deadlineAtUnixMs) || issueInput.deadlineAtUnixMs <= now) {
        fail('expired', 'Effect grant v2 deadline must be a future absolute safe integer.');
      }
      const nonce = `grantnonce256:${randomBytes(32).toString('hex')}`;
      const grantIdentity = input.identities.structuredIdentity('operation', 'effect-grant/v2', {
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
      const grant = Object.freeze({}) as OperationEffectGrantV2;
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

  const consumer: OperationEffectGrantAuthorityV2['consumer'] = Object.freeze({
    consume(consumeInput) {
      const record = grants.get(consumeInput.grant);
      if (record === undefined) fail('foreign-grant', 'Effect grant v2 was not issued by this authority.');
      if (record.consumed) fail('already-consumed', 'Effect grant v2 has already been consumed.');
      input.foundation.assertPlan(consumeInput.operation);
      const currentEpoch = input.foundation.createReference(consumeInput.currentEpoch);
      const plan = consumeInput.operation;
      if (plan.operation !== record.semanticOperation
          || !sameIdentity(plan.identity, record.operationIdentity)) {
        fail('operation-mismatch', 'Effect grant v2 does not bind this semantic operation.');
      }
      if (!sameIdentity(plan.execution.identity, record.executionIdentity)) {
        fail('execution-plan-mismatch', 'Effect grant v2 execution plan has drifted.');
      }
      if (!sameReference(currentEpoch, record.currentEpoch)) {
        fail('epoch-mismatch', 'Effect grant v2 current epoch has drifted.');
      }
      if (plan.attempt.deadlineAtUnixMs !== record.deadlineAtUnixMs) {
        fail('deadline-mismatch', 'Effect grant v2 deadline does not bind the operation attempt.');
      }
      if (Date.now() >= record.deadlineAtUnixMs || performance.now() >= record.deadlineAtMonotonicMs) {
        fail('expired', 'Effect grant v2 expired before consumption.');
      }
      if (!sameReference(plan.attempt.authorityGrant, record.authorityGrant)) {
        fail('grant-attempt-mismatch', 'Effect grant v2 does not bind the operation attempt authority.');
      }
      record.consumed = true;
      const identity = input.identities.structuredIdentity('operation', 'effect-grant-attempt-binding/v2', {
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
