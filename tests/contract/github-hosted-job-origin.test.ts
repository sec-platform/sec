import { expect, test } from 'bun:test';
import { generateKeyPairSync, sign } from 'node:crypto';
import { assertAuthenticatedGitHubJobOriginCurrent, type AuthenticatedGitHubJobOrigin } from '../../src/adapters/providers/github-api/hosted-job-origin.ts';
import { verifyGitHubHostedJobSignedClaims } from '../../src/adapters/providers/github-api/internal/hosted-job-origin-jwt.ts';
import { decodeAuthenticatedGitHubJobBinding } from '../../src/adapters/providers/github-api/internal/hosted-job-origin-response.ts';

// Independent native signing is a cryptographic fixture, never a live issuer.
// Expected claim values and failure witnesses come from the frozen OIDC/job
// contract. No generated key or parser result is admitted to production.
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...keys.publicKey.export({ format: 'jwk' }), kid: 'fixture-1', alg: 'RS256', use: 'sig' };
const now = 1_790_000_000_000;
const audience = 'sec:hosted-job-origin:v1:fixture-fresh-challenge';
const sourceSha = 'a'.repeat(40);
const claims = {
  iss: 'https://token.actions.githubusercontent.com', aud: audience, sub: 'repo:sec-platform/sec:ref:refs/heads/main',
  repository: 'sec-platform/sec', repository_id: '123', workflow_ref: 'sec-platform/sec/.github/workflows/compiler-pr-validation.yml@refs/heads/main',
  workflow_sha: sourceSha, run_id: '900', run_attempt: '1', check_run_id: '901',
  runner_environment: 'github-hosted', event_name: 'repository_dispatch', ref: 'refs/heads/main',
  jti: 'fixture-unique-id', iat: now / 1000, nbf: now / 1000, exp: now / 1000 + 300
};
function jwt(payload: unknown = claims, header: unknown = { typ: 'JWT', alg: 'RS256', kid: 'fixture-1' }): string {
  const encodedHeader = Buffer.from(typeof header === 'string' ? header : JSON.stringify(header)).toString('base64url');
  const encodedClaims = Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload)).toString('base64url');
  const input = `${encodedHeader}.${encodedClaims}`;
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), keys.privateKey).toString('base64url')}`;
}
function verify(token: string, keySet: unknown = { keys: [jwk] }) {
  return verifyGitHubHostedJobSignedClaims({ token, jwks: keySet, audience, requestedAtUnixMs: now, observedAtUnixMs: now + 1000 });
}
function transport() {
  return {
    claims: verify(jwt()), jobId: 'execute-verification-action-sut',
    repository: { full_name: 'sec-platform/sec', id: 123, default_branch: 'main' },
    defaultBranch: { name: 'main', commit: { sha: sourceSha, commit: { tree: { sha: 'b'.repeat(40) } } } },
    run: { id: 900, run_attempt: 1, path: '.github/workflows/compiler-pr-validation.yml', head_sha: sourceSha,
      head_branch: 'main', event: 'repository_dispatch', status: 'in_progress', conclusion: null,
      repository: { full_name: 'sec-platform/sec', id: 123 } },
    jobs: [{ total_count: 1, jobs: [{ id: 902, run_id: 900, run_attempt: 1, name: 'execute-verification-action-sut',
      head_sha: sourceSha, status: 'in_progress', conclusion: null, completed_at: null,
      started_at: new Date(now - 60_000).toISOString(), labels: ['ubuntu-24.04'],
      steps: [{ name: 'Execute one normalized candidate operation without credentials', number: 8,
        status: 'in_progress', conclusion: null, started_at: new Date(now).toISOString(), completed_at: null }],
      check_run_url: 'https://api.github.com/repos/sec-platform/sec/check-runs/901' }] }],
    observedAtUnixMs: now + 1000
  };
}

test('independent RS256 fixture binds signed own-job claims without creating live authority', () => {
  const observed = verify(jwt());
  expect(observed.repositoryId).toBe('123');
  expect(observed.checkRunId).toBe('901');
  expect(observed.expiresAtUnixMs).toBe(now + 300_000);
  expect(() => assertAuthenticatedGitHubJobOriginCurrent(observed as unknown as AuthenticatedGitHubJobOrigin)).toThrow();
  expect(() => assertAuthenticatedGitHubJobOriginCurrent(Object.freeze({}) as AuthenticatedGitHubJobOrigin)).toThrow();
});

test('signature validation rejects forged signature, key ambiguity and alternate algorithm sources', () => {
  const good = jwt();
  const split = good.split('.');
  const signature = Buffer.from(split[2]!, 'base64url');
  signature[0] = signature[0]! ^ 1;
  expect(() => verify(`${split[0]}.${split[1]}.${signature.toString('base64url')}`)).toThrow();
  expect(() => verify(good, { keys: [jwk, { ...jwk }] })).toThrow();
  expect(() => verify(good, { keys: [{ ...jwk, kid: 'another-key' }] })).toThrow();
  for (const header of [
    { typ: 'JWT', alg: 'none', kid: 'fixture-1' },
    { typ: 'JWT', alg: 'HS256', kid: 'fixture-1' },
    { typ: 'JWT', alg: 'RS256', kid: 'fixture-1', jku: 'https://attacker.invalid/jwks' },
    { typ: 'JWT', alg: 'RS256', kid: 'fixture-1', crit: ['unrecognized'] }
  ]) expect(() => verify(jwt(claims, header))).toThrow();
});

test('fresh issuer, audience, bounded lifetime and native managed placement are independently required', () => {
  for (const patch of [
    { iss: 'https://attacker.invalid' }, { aud: `${audience}-stale` }, { aud: [audience] },
    { runner_environment: 'self-hosted' }, { ref: 'refs/pull/42/merge' },
    { exp: now / 1000 }, { nbf: now / 1000 + 60 }, { iat: now / 1000 - 60 },
    { exp: now / 1000 + 901 }, { check_run_id: undefined }, { run_attempt: '01' },
    { job_workflow_ref: 'attacker/repo/.github/workflows/reuse.yml@refs/heads/main' }
  ]) expect(() => verify(jwt({ ...claims, ...patch }))).toThrow();
});

test('signed duplicate JSON keys and noncanonical compact encodings are rejected', () => {
  const duplicate = JSON.stringify(claims).replace('"run_id":"900"', '"run_id":"900","run_id":"900"');
  expect(() => verify(jwt(duplicate))).toThrow();
  expect(() => verify(jwt(claims, '{"typ":"JWT","alg":"RS256","kid":"fixture-1","kid":"fixture-1"}'))).toThrow();
  const segments = jwt().split('.');
  expect(() => verify(`${segments[0]}=.${segments[1]}.${segments[2]}`)).toThrow();
  expect(() => verify('x'.repeat(32 * 1024 + 1))).toThrow();
});

test('canonical API binding joins signed check-run to exact job and original provider deadline', () => {
  const result = decodeAuthenticatedGitHubJobBinding(transport());
  expect(result.jobId).toBe('902');
  expect(result.policyJobId).toBe('execute-verification-action-sut');
  expect(result.role).toBe('sut');
  expect(result.phase).toBe('execute-hosted-action-sut');
  expect(result.stepNumber).toBe(8);
  expect(result.originalDeadlineAtUnixMs).toBe(now - 60_000 + 75 * 60_000);
  const later = decodeAuthenticatedGitHubJobBinding({ ...transport(), observedAtUnixMs: now + 120_000 });
  expect(later.originalDeadlineAtUnixMs).toBe(result.originalDeadlineAtUnixMs);
  expect(later.identityDigest).toBe(result.identityDigest);
  expect(() => assertAuthenticatedGitHubJobOriginCurrent(result as unknown as AuthenticatedGitHubJobOrigin)).toThrow();
});

test('origin binds the unique actual provider phase, never an argv or display-name-only claim', () => {
  const original = transport(), job = original.jobs[0]!.jobs[0]!, step = job.steps[0]!;
  expect(decodeAuthenticatedGitHubJobBinding(original).phase).toBe('execute-hosted-action-sut');
  for (const steps of [[], [step, { ...step, number: 9 }], [{ ...step, number: 0 }],
    [{ ...step, name: 'Upload untrusted raw SUT transport only' }], [{ ...step, status: 'queued' }],
    [{ ...step, conclusion: 'success' }], [{ ...step, completed_at: new Date(now).toISOString() }],
    [{ ...step, started_at: new Date(now - 120_000).toISOString() }]]) {
    expect(() => decodeAuthenticatedGitHubJobBinding({ ...original,
      jobs: [{ total_count: 1, jobs: [{ ...job, steps }] }] })).toThrow();
  }
});

test('matching names and caller source expectations cannot replace exact signed job/current-default binding', () => {
  const original = transport();
  const job = original.jobs[0]!.jobs[0]!;
  for (const patch of [
    { check_run_url: 'https://api.github.com/repos/sec-platform/sec/check-runs/999' },
    { run_attempt: 2 }, { name: 'preflight-verification-action-sut' }, { labels: ['self-hosted', 'Linux'] },
    { labels: ['ubuntu-24.04', 'self-hosted'] }, { head_sha: 'c'.repeat(40) }, { status: 'completed' },
    { started_at: new Date(now - 76 * 60_000).toISOString() }
  ]) expect(() => decodeAuthenticatedGitHubJobBinding({ ...original,
    jobs: [{ total_count: 1, jobs: [{ ...job, ...patch }] }] })).toThrow();
  expect(() => decodeAuthenticatedGitHubJobBinding({ ...original,
    defaultBranch: { ...original.defaultBranch, commit: { ...original.defaultBranch.commit, sha: 'c'.repeat(40) } } })).toThrow();
  expect(() => decodeAuthenticatedGitHubJobBinding({ ...original, jobId: 'validate-hosted-request' })).toThrow();
  expect(() => decodeAuthenticatedGitHubJobBinding({ ...original, jobs: [{ total_count: 2, jobs: [job] }] })).toThrow();
  expect(() => decodeAuthenticatedGitHubJobBinding({ ...original, jobs: [{ total_count: 2, jobs: [job, job] }] })).toThrow();
});
