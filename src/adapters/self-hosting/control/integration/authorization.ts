
import { rawSha256Hex } from '../../../../contracts/canonical.ts';
import { encodeVerificationActionData } from '../../../verification/platform/action/contract/action.ts';

/** Content-integrity decision object, not a signature. The physical executor independently rereads issuer, live facts, and consumption state. */

const INTEGRATION_AUTHORIZATION_SCHEMA = 'sec-integration-authorization-v1' as const;
type IntegrationAuthorizationDigest = `sha256:${string}`;

interface IntegrationAuthorizationIssuer {
  readonly principalId: string;
  readonly producerIdentity: string;
  readonly trustedRevision: string;
  readonly sourceTransport: 'trusted-integration-runtime' | 'github-actions';
  readonly sourceRunId: string;
  readonly sourceRef: string;
  readonly sourceDigest: IntegrationAuthorizationDigest;
}

export interface IntegrationAuthorization {
  readonly schema: typeof INTEGRATION_AUTHORIZATION_SCHEMA;
  readonly authorizationId: string;
  readonly consumptionOperationId: string;
  readonly repository: string;
  readonly prNumber: number;
  readonly sessionRevision: IntegrationAuthorizationDigest;
  readonly baseSha: string;
  readonly baseTreeSha: string;
  readonly headSha: string;
  readonly headTreeSha: string;
  readonly manifestDigest: IntegrationAuthorizationDigest;
  readonly scopeAuthorizationRevision: IntegrationAuthorizationDigest;
  readonly scopeAuthorizationReceiptDigest: IntegrationAuthorizationDigest;
  readonly actionClosureDigest: IntegrationAuthorizationDigest;
  readonly evidenceDigest: IntegrationAuthorizationDigest;
  readonly reviewRevision: IntegrationAuthorizationDigest;
  readonly reviewReceiptDigest: IntegrationAuthorizationDigest;
  readonly mainHealthRevision: IntegrationAuthorizationDigest;
  readonly mainHealthReceiptDigest: IntegrationAuthorizationDigest;
  readonly trustRevision: string;
  readonly rulesetDigest: IntegrationAuthorizationDigest;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly issuer: IntegrationAuthorizationIssuer;
  readonly receiptDigest: IntegrationAuthorizationDigest;
}

export type IntegrationAuthorizationInput = Omit<IntegrationAuthorization, 'schema' | 'authorizationId' | 'receiptDigest'>;

function fail(message: string): never { throw new Error(`IntegrationAuthorization ${message}`); }
function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512 || /[\u0000-\u001f]/u.test(value)) fail(`${label} must be bounded text.`);
  return value;
}
function sha(value: unknown, label: string): string {
  const result = text(value, label);
  if (!/^[0-9a-f]{40}$/u.test(result)) fail(`${label} must be a commit/tree SHA.`);
  return result;
}
function digest(value: unknown, label: string): IntegrationAuthorizationDigest {
  const result = text(value, label);
  if (!/^sha256:[0-9a-f]{64}$/u.test(result)) fail(`${label} must be a SHA-256 digest.`);
  return result as IntegrationAuthorizationDigest;
}
function instant(value: unknown, label: string): string {
  const result = text(value, label);
  if (new Date(result).toISOString() !== result) fail(`${label} must be a canonical ISO timestamp.`);
  return result;
}
function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('receipt must be an object.');
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>): void {
  const expected = ['schema', 'authorizationId', 'consumptionOperationId', 'repository', 'prNumber', 'sessionRevision', 'baseSha', 'baseTreeSha', 'headSha', 'headTreeSha', 'manifestDigest', 'scopeAuthorizationRevision', 'scopeAuthorizationReceiptDigest', 'actionClosureDigest', 'evidenceDigest', 'reviewRevision', 'reviewReceiptDigest', 'mainHealthRevision', 'mainHealthReceiptDigest', 'trustRevision', 'rulesetDigest', 'issuedAt', 'expiresAt', 'issuer', 'receiptDigest'].sort();
  const actual = Object.keys(value).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail(`receipt must contain exactly: ${expected.join(', ')}.`);
}
function hash(value: unknown): IntegrationAuthorizationDigest {
  return `sha256:${rawSha256Hex(encodeVerificationActionData(value))}`;
}

export function createIntegrationAuthorization(input: IntegrationAuthorizationInput): IntegrationAuthorization {
  const issuerValue = record(input.issuer);
  const issuerKeys = Object.keys(issuerValue).sort();
  const expectedIssuerKeys = ['principalId', 'producerIdentity', 'trustedRevision', 'sourceTransport', 'sourceRunId', 'sourceRef', 'sourceDigest'].sort();
  if (issuerKeys.length !== expectedIssuerKeys.length || issuerKeys.some((key, index) => key !== expectedIssuerKeys[index])) fail('issuer keys are invalid.');
  if (issuerValue.sourceTransport !== 'trusted-integration-runtime' && issuerValue.sourceTransport !== 'github-actions') fail('issuer.sourceTransport is invalid.');
  const withoutDigest = Object.freeze({
    schema: INTEGRATION_AUTHORIZATION_SCHEMA,
    consumptionOperationId: text(input.consumptionOperationId, 'consumptionOperationId'),
    repository: text(input.repository, 'repository'),
    prNumber: Number.isSafeInteger(input.prNumber) && input.prNumber > 0 ? input.prNumber : fail('prNumber must be positive.'),
    sessionRevision: digest(input.sessionRevision, 'sessionRevision'),
    baseSha: sha(input.baseSha, 'baseSha'), baseTreeSha: sha(input.baseTreeSha, 'baseTreeSha'),
    headSha: sha(input.headSha, 'headSha'), headTreeSha: sha(input.headTreeSha, 'headTreeSha'),
    manifestDigest: digest(input.manifestDigest, 'manifestDigest'),
    scopeAuthorizationRevision: digest(input.scopeAuthorizationRevision, 'scopeAuthorizationRevision'),
    scopeAuthorizationReceiptDigest: digest(input.scopeAuthorizationReceiptDigest, 'scopeAuthorizationReceiptDigest'),
    actionClosureDigest: digest(input.actionClosureDigest, 'actionClosureDigest'),
    evidenceDigest: digest(input.evidenceDigest, 'evidenceDigest'),
    reviewRevision: digest(input.reviewRevision, 'reviewRevision'),
    reviewReceiptDigest: digest(input.reviewReceiptDigest, 'reviewReceiptDigest'),
    mainHealthRevision: digest(input.mainHealthRevision, 'mainHealthRevision'),
    mainHealthReceiptDigest: digest(input.mainHealthReceiptDigest, 'mainHealthReceiptDigest'),
    trustRevision: sha(input.trustRevision, 'trustRevision'),
    rulesetDigest: digest(input.rulesetDigest, 'rulesetDigest'),
    issuedAt: instant(input.issuedAt, 'issuedAt'), expiresAt: instant(input.expiresAt, 'expiresAt'),
    issuer: Object.freeze({
      principalId: text(issuerValue.principalId, 'issuer.principalId'),
      producerIdentity: text(issuerValue.producerIdentity, 'issuer.producerIdentity'),
      trustedRevision: text(issuerValue.trustedRevision, 'issuer.trustedRevision'),
      sourceTransport: issuerValue.sourceTransport,
      sourceRunId: text(issuerValue.sourceRunId, 'issuer.sourceRunId'),
      sourceRef: text(issuerValue.sourceRef, 'issuer.sourceRef'),
      sourceDigest: digest(issuerValue.sourceDigest, 'issuer.sourceDigest')
    })
  });
  if (withoutDigest.issuer.trustedRevision !== withoutDigest.trustRevision) fail('issuer trustedRevision must match authorization trustRevision.');
  if (withoutDigest.expiresAt <= withoutDigest.issuedAt) fail('expiresAt must be after issuedAt.');
  const { issuer, issuedAt: _issuedAt, expiresAt: _expiresAt,
    scopeAuthorizationReceiptDigest: _scopeReceipt, reviewReceiptDigest: _reviewReceipt,
    mainHealthReceiptDigest: _healthReceipt, ...semantic } = withoutDigest;
  const authorizationId = hash({ ...semantic, issuer: { principalId: issuer.principalId,
    producerIdentity: issuer.producerIdentity, trustedRevision: issuer.trustedRevision } });
  const receipt = Object.freeze({ ...withoutDigest, authorizationId });
  return Object.freeze({ ...receipt, receiptDigest: hash(receipt) });
}

export function parseIntegrationAuthorization(source: string): IntegrationAuthorization {
  const parsed = record(JSON.parse(source) as unknown);
  exact(parsed);
  if (parsed.schema !== INTEGRATION_AUTHORIZATION_SCHEMA) fail('schema mismatch.');
  const authorization = createIntegrationAuthorization(parsed as unknown as IntegrationAuthorizationInput);
  if (authorization.authorizationId !== parsed.authorizationId) fail('authorization semantic identity mismatch.');
  if (authorization.receiptDigest !== parsed.receiptDigest) fail('receipt digest mismatch.');
  return authorization;
}

export interface IntegrationAuthorizationLiveState {
  readonly now: string;
  readonly consumedAuthorizationIds: ReadonlySet<string>;
  readonly consumptionOperationId: string;
  readonly repository: string;
  readonly prNumber: number;
  readonly sessionRevision: IntegrationAuthorizationDigest;
  readonly baseSha: string;
  readonly baseTreeSha: string;
  readonly headSha: string;
  readonly headTreeSha: string;
  readonly manifestDigest: IntegrationAuthorizationDigest;
  readonly scopeAuthorizationRevision: IntegrationAuthorizationDigest;
  readonly scopeAuthorizationReceiptDigest: IntegrationAuthorizationDigest;
  readonly actionClosureDigest: IntegrationAuthorizationDigest;
  readonly evidenceDigest: IntegrationAuthorizationDigest;
  readonly reviewRevision: IntegrationAuthorizationDigest;
  readonly reviewReceiptDigest: IntegrationAuthorizationDigest;
  readonly mainHealthRevision: IntegrationAuthorizationDigest;
  readonly mainHealthReceiptDigest: IntegrationAuthorizationDigest;
  readonly trustRevision: string;
  readonly rulesetDigest: IntegrationAuthorizationDigest;
}

export function assertIntegrationAuthorizationUsable(
  authorization: IntegrationAuthorization,
  live: IntegrationAuthorizationLiveState
): void {
  const current = parseIntegrationAuthorization(encodeVerificationActionData(authorization));
  if (live.consumedAuthorizationIds.has(current.authorizationId)) fail('single-use receipt is already consumed.');
  if (live.consumptionOperationId !== current.consumptionOperationId) fail('consumption operation drift invalidates receipt.');
  if (instant(live.now, 'now') > current.expiresAt) fail('receipt is expired.');
  const checks: readonly [unknown, unknown, string][] = [
    [live.repository, current.repository, 'repository'], [live.prNumber, current.prNumber, 'prNumber'],
    [live.sessionRevision, current.sessionRevision, 'sessionRevision'], [live.baseSha, current.baseSha, 'baseSha'],
    [live.baseTreeSha, current.baseTreeSha, 'baseTreeSha'], [live.headSha, current.headSha, 'headSha'],
    [live.headTreeSha, current.headTreeSha, 'headTreeSha'], [live.manifestDigest, current.manifestDigest, 'manifestDigest'],
    [live.scopeAuthorizationRevision, current.scopeAuthorizationRevision, 'scopeAuthorizationRevision'],
    [live.scopeAuthorizationReceiptDigest, current.scopeAuthorizationReceiptDigest, 'scopeAuthorizationReceiptDigest'],
    [live.actionClosureDigest, current.actionClosureDigest, 'actionClosureDigest'],
    [live.evidenceDigest, current.evidenceDigest, 'evidenceDigest'],
    [live.reviewRevision, current.reviewRevision, 'reviewRevision'],
    [live.reviewReceiptDigest, current.reviewReceiptDigest, 'reviewReceiptDigest'],
    [live.mainHealthRevision, current.mainHealthRevision, 'mainHealthRevision'],
    [live.mainHealthReceiptDigest, current.mainHealthReceiptDigest, 'mainHealthReceiptDigest'],
    [live.trustRevision, current.trustRevision, 'trustRevision'], [live.rulesetDigest, current.rulesetDigest, 'rulesetDigest']
  ];
  for (const [actual, expected, label] of checks) if (actual !== expected) fail(`${label} drift invalidates receipt.`);
}
