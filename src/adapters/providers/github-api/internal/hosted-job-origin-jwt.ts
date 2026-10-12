import { createPublicKey, verify } from 'node:crypto';
import { parseExactJsonBytes } from '../../../../contracts/exact-json.ts';

export const GITHUB_ACTIONS_OIDC_ISSUER = 'https://token.actions.githubusercontent.com' as const;
export const GITHUB_ACTIONS_OIDC_JWKS = `${GITHUB_ACTIONS_OIDC_ISSUER}/.well-known/jwks` as const;
const TOKEN_BYTE_LIMIT = 32 * 1024;
const CLOCK_SKEW_MS = 30_000;

/** Data only. Even a valid signature against supplied keys issues no live authority. */
export interface GitHubHostedJobSignedClaims {
  readonly repository: string;
  readonly repositoryId: string;
  readonly workflowRef: string;
  readonly workflowSha: string;
  readonly runId: string;
  readonly runAttempt: number;
  readonly checkRunId: string;
  readonly eventName: string;
  readonly ref: 'refs/heads/main';
  readonly jwtId: string;
  readonly issuedAtUnixMs: number;
  readonly expiresAtUnixMs: number;
}

function fail(message: string): never {
  // Never include token bytes, claims or request credentials in diagnostics.
  throw new Error(`GitHub authenticated job origin: ${message}`);
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, limit = 1024): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > limit
      || /[\u0000-\u0020\u007f]/u.test(value)) fail(`${label} is invalid`);
  return value;
}

function positiveId(value: unknown, label: string): string {
  const result = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof result !== 'string' || !/^[1-9][0-9]{0,19}$/u.test(result)) fail(`${label} is invalid`);
  return result;
}

function base64url(value: string, label: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) fail(`${label} encoding is invalid`);
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.toString('base64url') !== value) fail(`${label} encoding is noncanonical`);
  return bytes;
}

function json(bytes: Uint8Array, label: string): Record<string, unknown> {
  return object(parseExactJsonBytes(bytes, label, { maximumInputBytes: TOKEN_BYTE_LIMIT, maximumDepth: 8 }), label);
}

function timestamp(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1
      || !Number.isSafeInteger(value * 1000)) fail(`${label} is invalid`);
  return value * 1000;
}

/**
 * Closed RS256 GitHub JWT validation using the native cryptographic verifier.
 * The caller owns key provenance; this pure decoder cannot mint a capability.
 */
export function verifyGitHubHostedJobSignedClaims(input: Readonly<{
  token: string;
  jwks: unknown;
  audience: string;
  requestedAtUnixMs: number;
  observedAtUnixMs: number;
}>): GitHubHostedJobSignedClaims {
  if (typeof input.token !== 'string' || Buffer.byteLength(input.token) > TOKEN_BYTE_LIMIT) fail('token size is invalid');
  if (!Number.isSafeInteger(input.requestedAtUnixMs) || !Number.isSafeInteger(input.observedAtUnixMs)
      || input.requestedAtUnixMs < 1 || input.observedAtUnixMs < input.requestedAtUnixMs) fail('request clock is invalid');
  const parts = input.token.split('.');
  if (parts.length !== 3) fail('token is not one compact signed JWT');
  const [encodedHeader, encodedClaims, encodedSignature] = parts as [string, string, string];
  const header = json(base64url(encodedHeader, 'header'), 'OIDC header');
  if (header.alg !== 'RS256' || header.typ !== 'JWT'
      || Object.keys(header).some(key => !['alg', 'typ', 'kid', 'x5t'].includes(key))) fail('JOSE header is unsupported');
  const kid = text(header.kid, 'key identifier', 256);
  if (header.x5t !== undefined) text(header.x5t, 'certificate thumbprint', 128);
  const keys = object(input.jwks, 'JWKS').keys;
  if (!Array.isArray(keys) || keys.length < 1 || keys.length > 16) fail('JWKS key census is invalid');
  const matching = keys.map(key => object(key, 'JWK')).filter(key => key.kid === kid);
  if (matching.length !== 1) fail('signing key is missing or ambiguous');
  const key = matching[0]!;
  if (key.kty !== 'RSA' || key.use !== 'sig' || (key.alg !== undefined && key.alg !== 'RS256')
      || key.e !== 'AQAB' || key.d !== undefined || key.p !== undefined || key.q !== undefined
      || (key.key_ops !== undefined && (!Array.isArray(key.key_ops) || key.key_ops.length !== 1 || key.key_ops[0] !== 'verify'))) {
    fail('signing key is not an admissible public RS256 key');
  }
  const modulus = base64url(text(key.n, 'RSA modulus', 1024), 'RSA modulus');
  if (modulus.length < 256 || modulus.length > 512 || modulus[0] === 0) fail('RSA modulus size is unsupported');
  const publicKey = createPublicKey({ key: { kty: 'RSA', n: key.n as string, e: 'AQAB' }, format: 'jwk' });
  if ((publicKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) fail('RSA key strength is unsupported');
  if (!verify('RSA-SHA256', Buffer.from(`${encodedHeader}.${encodedClaims}`, 'ascii'), publicKey,
    base64url(encodedSignature, 'signature'))) fail('signature does not verify');
  const claims = json(base64url(encodedClaims, 'claims'), 'OIDC claims');
  if (claims.iss !== GITHUB_ACTIONS_OIDC_ISSUER || claims.aud !== input.audience
      || !input.audience.startsWith('sec:hosted-job-origin:v1:')) fail('issuer or fresh audience mismatch');
  if (claims.runner_environment !== 'github-hosted' || claims.ref !== 'refs/heads/main') fail('runner environment or trusted ref mismatch');
  // No current route uses reusable workflows. Do not silently trust a second source.
  if (claims.job_workflow_ref !== undefined || claims.job_workflow_sha !== undefined) fail('reusable workflow source is not admitted');
  const issuedAtUnixMs = timestamp(claims.iat, 'issue time');
  const notBeforeUnixMs = timestamp(claims.nbf, 'not-before time');
  const expiresAtUnixMs = timestamp(claims.exp, 'expiry time');
  if (issuedAtUnixMs < input.requestedAtUnixMs - CLOCK_SKEW_MS
      || issuedAtUnixMs > input.observedAtUnixMs + CLOCK_SKEW_MS
      || notBeforeUnixMs > input.observedAtUnixMs + CLOCK_SKEW_MS
      || notBeforeUnixMs < issuedAtUnixMs - CLOCK_SKEW_MS
      || expiresAtUnixMs <= input.observedAtUnixMs
      || expiresAtUnixMs <= issuedAtUnixMs || expiresAtUnixMs - issuedAtUnixMs > 15 * 60_000) fail('token lifetime is invalid');
  const repository = text(claims.repository, 'repository');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)) fail('repository identity is invalid');
  const workflowSha = text(claims.workflow_sha, 'workflow SHA', 40);
  if (!/^[0-9a-f]{40}$/u.test(workflowSha)) fail('workflow SHA is invalid');
  const runAttempt = Number(positiveId(claims.run_attempt, 'run attempt'));
  if (!Number.isSafeInteger(runAttempt) || runAttempt > 1000) fail('run attempt is unsupported');
  return Object.freeze({ repository, repositoryId: positiveId(claims.repository_id, 'repository ID'),
    workflowRef: text(claims.workflow_ref, 'workflow ref'), workflowSha,
    runId: positiveId(claims.run_id, 'run ID'), runAttempt,
    checkRunId: positiveId(claims.check_run_id, 'check-run ID'),
    eventName: text(claims.event_name, 'event name', 64), ref: 'refs/heads/main' as const,
    jwtId: text(claims.jti, 'JWT ID', 256), issuedAtUnixMs, expiresAtUnixMs });
}
