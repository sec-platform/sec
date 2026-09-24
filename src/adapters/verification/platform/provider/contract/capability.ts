/**
 * Provider capability resolution (Issue #347 section A).
 *
 * Writer / reviewer / verification-executor providers are separate
 * capabilities. Availability is resolved into normalized state before any
 * expensive integration stage; raw quota/billing/upsell prose (#244-untrusted
 * diagnostic) never enters prompt/control/evidence truth — only a bounded
 * reasonCode and a content digest are retained. A provider already known
 * unavailable in the same availability epoch must not be retried.
 *
 * `hosted-verification` is the retained V1 role name for an independently
 * provisioned verification executor. It is not an assertion that GitHub
 * Actions owns the role: both the Actions adapter and an independent trusted
 * SEC runtime can satisfy it through distinct capability identities.
 */

import { createHash } from 'node:crypto';

import { CompilerError } from '../../../../../compiler/errors.ts';
import { encodeVerificationActionData } from '../../action/contract/action.ts';

const VERIFICATION_PROVIDER_CAPABILITY_SCHEMA =
  'sec-verification-provider-capability-v1' as const;
const VERIFICATION_PROVIDER_AVAILABILITY_EPOCH_SCHEMA =
  'sec-verification-provider-availability-epoch-v1' as const;

export type VerificationProviderRole = 'writer' | 'reviewer' | 'hosted-verification';
export type VerificationProviderAvailability = 'available' | 'unavailable' | 'degraded' | 'unknown';
export type VerificationProviderCapabilityId =
  | 'github-writer'
  | 'codex-review'
  | 'deepseek-independent-review'
  | 'github-actions-hosted-verification'
  | 'trusted-runtime-verification';

type VerificationProviderId =
  | 'github-api'
  | 'codex-code-review'
  | 'deepseek-independent-execution'
  | 'github-actions'
  | 'sec-trusted-runtime';

const VERIFICATION_CAPABILITY_PROVIDER: Readonly<Record<
  VerificationProviderCapabilityId,
  VerificationProviderId
>> = Object.freeze({
  'github-writer': 'github-api',
  'codex-review': 'codex-code-review',
  'deepseek-independent-review': 'deepseek-independent-execution',
  'github-actions-hosted-verification': 'github-actions',
  'trusted-runtime-verification': 'sec-trusted-runtime'
});

export interface VerificationProviderCapability {
  readonly schema: typeof VERIFICATION_PROVIDER_CAPABILITY_SCHEMA;
  readonly capability: VerificationProviderCapabilityId;
  readonly role: VerificationProviderRole;
  readonly provider: VerificationProviderId;
  readonly availability: VerificationProviderAvailability;
  /** Bounded kebab-case reason code; raw provider prose is never stored. */
  readonly reasonCode: string | null;
  readonly receiptRef: `sha256:${string}` | null;
  readonly observedAt: string;
}

export type VerificationProviderCapabilityInput = Omit<
  VerificationProviderCapability,
  'schema'
>;

export interface VerificationProviderAvailabilityEpoch {
  readonly schema: typeof VERIFICATION_PROVIDER_AVAILABILITY_EPOCH_SCHEMA;
  readonly epochId: string;
  readonly observedAt: string;
  readonly expiresAt: string;
  readonly capabilities: readonly VerificationProviderCapability[];
  readonly epochDigest: `sha256:${string}`;
}

function fail(message: string): never {
  throw new Error(`VerificationProviderCapability ${message}`);
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512
    || /[\u0000-\u001f\u007f]/u.test(value)) fail(`${label} must be bounded text.`);
  return value;
}

function reasonCode(value: unknown, label: string): string {
  const result = text(value, label);
  if (!/^[a-z0-9][a-z0-9-]{0,127}$/u.test(result)) fail(`${label} must be a bounded kebab-case code.`);
  return result;
}

function digest(value: unknown, label: string): `sha256:${string}` {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    fail(`${label} must be a SHA-256 digest.`);
  }
  return value as `sha256:${string}`;
}

function instant(value: unknown, label: string): string {
  const result = text(value, label);
  if (new Date(result).toISOString() !== result) fail(`${label} must be a canonical ISO timestamp.`);
  return result;
}

function hash(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(encodeVerificationActionData(value)).digest('hex')}`;
}

function expectedRole(capability: VerificationProviderCapabilityId): VerificationProviderRole {
  if (capability === 'github-writer') return 'writer';
  if (capability === 'codex-review' || capability === 'deepseek-independent-review') return 'reviewer';
  return 'hosted-verification';
}

export function createVerificationProviderCapability(
  input: VerificationProviderCapabilityInput
): VerificationProviderCapability {
  const capability = text(input.capability, 'capability');
  if (![
    'github-writer', 'codex-review', 'deepseek-independent-review',
    'github-actions-hosted-verification', 'trusted-runtime-verification'
  ].includes(capability)) fail('capability identity is unknown.');
  const role = text(input.role, 'role');
  if (role !== 'writer' && role !== 'reviewer' && role !== 'hosted-verification') {
    fail('role is unknown.');
  }
  const availability = text(input.availability, 'availability');
  if (!['available', 'unavailable', 'degraded', 'unknown'].includes(availability)) {
    fail('availability state is unknown.');
  }
  const normalizedReason = input.reasonCode === null ? null : reasonCode(input.reasonCode, 'reasonCode');
  if (availability === 'available' && normalizedReason !== null) {
    fail('an available capability must not carry an availability reason code.');
  }
  const normalizedReceipt = input.receiptRef === null ? null : digest(input.receiptRef, 'receiptRef');
  if (availability !== 'available' && normalizedReason === null) {
    fail('a non-available capability requires a bounded reason code.');
  }
  const provider = text(input.provider, 'provider') as VerificationProviderId;
  const capabilityId = capability as VerificationProviderCapabilityId;
  if (VERIFICATION_CAPABILITY_PROVIDER[capabilityId] !== provider) {
    fail(`capability ${capability} must use provider ${VERIFICATION_CAPABILITY_PROVIDER[capabilityId]}.`);
  }
  if (role !== expectedRole(capabilityId)) {
    fail(`capability ${capability} must use role ${expectedRole(capabilityId)}.`);
  }
  const observedAt = instant(input.observedAt, 'observedAt');
  // YAML and callers project only routing/negative-circuit-breaker state.
  // A static positive claim can never become physical-effect authority.
  if (availability === 'available') return Object.freeze({
    schema: VERIFICATION_PROVIDER_CAPABILITY_SCHEMA,
    capability: capabilityId,
    role: role as VerificationProviderRole,
    provider,
    availability: 'unknown' as const,
    reasonCode: 'provider-receipt-unverified',
    receiptRef: null,
    observedAt
  });
  return Object.freeze({
    schema: VERIFICATION_PROVIDER_CAPABILITY_SCHEMA,
    capability: capabilityId,
    role: role as VerificationProviderRole,
    provider,
    availability: availability as VerificationProviderAvailability,
    reasonCode: normalizedReason,
    receiptRef: normalizedReceipt,
    observedAt
  });
}

export function createVerificationProviderAvailabilityEpoch(input: {
  epochId: string;
  observedAt: string;
  expiresAt: string;
  capabilities: readonly VerificationProviderCapabilityInput[];
}): VerificationProviderAvailabilityEpoch {
  const epochId = text(input.epochId, 'epochId');
  const observedAt = instant(input.observedAt, 'observedAt');
  const expiresAt = instant(input.expiresAt, 'expiresAt');
  if (expiresAt <= observedAt) fail('expiresAt must be after observedAt.');
  if (!Array.isArray(input.capabilities) || input.capabilities.length === 0) {
    fail('an availability epoch must declare at least one capability.');
  }
  const capabilities = Object.freeze(input.capabilities.map((entry) =>
    createVerificationProviderCapability(entry)));
  for (const capability of capabilities) {
    if (capability.role !== expectedRole(capability.capability)) {
      fail(`capability ${capability.capability} must use role ${expectedRole(capability.capability)}.`);
    }
    if (capability.observedAt < observedAt || capability.observedAt >= expiresAt) {
      fail(`capability ${capability.capability} observation must fall within the availability epoch.`);
    }
  }
  const capabilityIds = capabilities.map((entry) => entry.capability);
  if (new Set(capabilityIds).size !== capabilityIds.length) {
    fail('an availability epoch cannot declare a capability twice.');
  }
  const withoutDigest = Object.freeze({
    schema: VERIFICATION_PROVIDER_AVAILABILITY_EPOCH_SCHEMA,
    epochId,
    observedAt,
    expiresAt,
    capabilities
  });
  return Object.freeze({ ...withoutDigest, epochDigest: hash(withoutDigest) });
}

export function assertProviderCapabilityUsable(input: {
  epoch: VerificationProviderAvailabilityEpoch;
  capability: VerificationProviderCapabilityId;
  expectedRole: VerificationProviderRole;
  now: string;
}): VerificationProviderCapability {
  const now = instant(input.now, 'now');
  if (now < input.epoch.observedAt) {
    throw new CompilerError('PROVIDER-AVAILABILITY-NOT-YET-OBSERVED',
      `Provider availability epoch ${input.epoch.epochId} was observed at ${input.epoch.observedAt}.`,
      { epochId: input.epoch.epochId, observedAt: input.epoch.observedAt });
  }
  if (now >= input.epoch.expiresAt) {
    throw new CompilerError('PROVIDER-AVAILABILITY-EXPIRED',
      `Provider availability epoch ${input.epoch.epochId} expired at ${input.epoch.expiresAt}.`,
      { epochId: input.epoch.epochId, expiresAt: input.epoch.expiresAt });
  }
  const capability = resolveProviderAvailability(input.epoch, input.capability);
  if (now < capability.observedAt) {
    throw new CompilerError('PROVIDER-AVAILABILITY-NOT-YET-OBSERVED',
      `Provider capability ${input.capability} was observed at ${capability.observedAt}.`,
      { capability: input.capability, observedAt: capability.observedAt });
  }
  if (capability.role !== input.expectedRole) {
    throw new CompilerError('PROVIDER-ROLE-MISMATCH',
      `Provider ${input.capability} is registered for ${capability.role}, not ${input.expectedRole}.`,
      { capability: input.capability, actualRole: capability.role, expectedRole: input.expectedRole });
  }
  return capability;
}

export function resolveProviderAvailability(
  epoch: VerificationProviderAvailabilityEpoch,
  capability: VerificationProviderCapabilityId
): VerificationProviderCapability {
  if (epoch.schema !== VERIFICATION_PROVIDER_AVAILABILITY_EPOCH_SCHEMA) {
    fail('availability epoch schema is invalid.');
  }
  const match = epoch.capabilities.find((entry) => entry.capability === capability);
  if (match === undefined) {
    return Object.freeze({
      schema: VERIFICATION_PROVIDER_CAPABILITY_SCHEMA,
      capability,
      role: expectedRole(capability),
      provider: VERIFICATION_CAPABILITY_PROVIDER[capability],
      availability: 'unknown',
      reasonCode: 'provider-unregistered',
      receiptRef: null,
      observedAt: epoch.observedAt
    });
  }
  return match;
}

/**
 * Same-epoch retry guard: a provider already observed unavailable in the same
 * availability epoch is never invoked again. Only a changed availability input
 * (a new epoch) authorizes another call.
 */
export function assertProviderRetryGuard(input: {
  previous: { availability: VerificationProviderAvailability; epochId: string };
  requested: { capability: VerificationProviderCapabilityId; epochId: string };
}): void {
  if (input.previous.epochId !== input.requested.epochId) return;
  if (input.previous.availability === 'unavailable') {
    throw new CompilerError(
      'PROVIDER-UNAVAILABLE-NOT-RETRIED',
      `Provider ${input.requested.capability} is unavailable in availability epoch `
        + `${input.requested.epochId} and must not be retried until a relevant availability input changes.`,
      { capability: input.requested.capability, epochId: input.requested.epochId }
    );
  }
}

/**
 * Quota/billing/upsell prose is untrusted diagnostic text. Only a bounded
 * reasonCode and a content digest may be retained; the raw bytes never become
 * engineering truth.
 */
export function classifyProviderDiagnosticText(
  raw: string
): { reasonCode: string; receiptRef: `sha256:${string}` } {
  const bounded = raw.length > 4096 ? raw.slice(0, 4096) : raw;
  const normalized = bounded.replaceAll('\r\n', '\n');
  const quotaLike = /quota|credits?|upgrade|billing|rate limit|usage limit|insufficient/iu.test(normalized);
  const reasonCode = quotaLike ? 'provider-quota-unavailable' : 'provider-diagnostic-unsupported';
  return {
    reasonCode,
    receiptRef: hash(Object.freeze({ schema: 'sec-provider-diagnostic-text-v1', source: normalized }))
  };
}
