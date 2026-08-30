import { expect, test } from 'bun:test';

import { createIntegrationAuthorization } from '../../src/control/integration/authorization.ts';
import {
  canonicalGitHubApiTarget,
  createIntegrationAuthorizationStatusDescription,
  createIntegrationAuthorizationStatusPublication,
  parseIntegrationAuthorizationGateResult,
  parseIntegrationAuthorizationStatusPublication,
  publishIntegrationAuthorizationStatus,
  type IntegrationAuthorizationGateResult
} from '../../src/control/integration/integration-authorization-status-github.ts';
import { encodeVerificationActionData } from '../../src/verification/action/contract/action.ts';

const D = (char: string): `sha256:${string}` => `sha256:${char.repeat(64).slice(0, 64)}`;
const BASE = '1'.repeat(40);
const HEAD = '2'.repeat(40);

test('canonical GitHub network target is origin-confined before any effect', () => {
  expect(canonicalGitHubApiTarget('https://api.github.com/repos/sec-platform/sec').href)
    .toBe('https://api.github.com/repos/sec-platform/sec');
  for (const target of [
    'http://api.github.com/repos/sec-platform/sec',
    'https://api.github.com.evil.example/repos/sec-platform/sec',
    'https://user:secret@api.github.com/repos/sec-platform/sec',
    'https://api.github.com/repos/sec-platform/sec#credential-fragment'
  ]) {
    expect(() => canonicalGitHubApiTarget(target)).toThrow(
      'only permits credential-free https://api.github.com targets'
    );
  }
});

function result(): IntegrationAuthorizationGateResult {
  return {
    schema: 'sec-trusted-runtime-merge-gate-result-v1',
    status: 'authorized',
    resultDigest: D('a'),
    authorization: createIntegrationAuthorization({
      consumptionOperationId: D('c'),
      repository: 'sec-platform/sec',
      prNumber: 496,
      sessionRevision: D('d'),
      baseSha: BASE,
      baseTreeSha: '3'.repeat(40),
      headSha: HEAD,
      headTreeSha: '4'.repeat(40),
      manifestDigest: D('e'),
      scopeAuthorizationRevision: D('f'),
      scopeAuthorizationReceiptDigest: D('1'),
      actionClosureDigest: D('2'),
      evidenceDigest: D('3'),
      reviewRevision: D('4'),
      reviewReceiptDigest: D('5'),
      mainHealthRevision: D('6'),
      mainHealthReceiptDigest: D('7'),
      trustRevision: BASE,
      rulesetDigest: D('8'),
      issuedAt: '2026-08-19T00:00:00.000Z',
      expiresAt: '2026-08-19T01:00:00.000Z',
      issuer: {
        principalId: 'APP_sec_integrator',
        producerIdentity: 'src/control/integration/merge-gate.ts',
        trustedRevision: BASE,
        sourceTransport: 'trusted-integration-runtime',
        sourceRunId: 'trusted-runtime-1',
        sourceRef: `src/control/integration/merge-gate.ts@${BASE}`,
        sourceDigest: D('9')
      }
    }),
    reviewReceipt: {} as never,
    mainHealth: {} as never,
    platformObservation: {
      status: 'available',
      rulesetDigest: D('8'),
      reason: null
    },
    artifactObservation: {} as never,
    provenance: {} as never,
    terminalStatusContext: 'sec/integration-authorization'
  };
}

test('terminal status description binds gate and ruleset digests without Actions run identity', () => {
  expect(createIntegrationAuthorizationStatusDescription(result()))
    .toBe(`gate ${'a'.repeat(12)} rules ${'8'.repeat(12)}`);
});

test('terminal status publication receipt is content-addressed and round-trips', () => {
  const publication = createIntegrationAuthorizationStatusPublication({
    result: result(),
    targetUrl: 'https://github.com/sec-platform/sec/pull/496',
    statusId: 123,
    principal: { creatorLogin: 'sec-integrator[bot]', creatorId: 900001 }
  });
  expect(publication).toMatchObject({
    repository: 'sec-platform/sec',
    pullRequestNumber: 496,
    baseSha: BASE,
    headSha: HEAD,
    context: 'sec/integration-authorization',
    state: 'success',
    statusId: 123,
    creatorLogin: 'sec-integrator[bot]',
    creatorId: 900001
  });
  expect(publication.publicationDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
  expect(parseIntegrationAuthorizationStatusPublication(
    encodeVerificationActionData(publication)
  )).toEqual(publication);
});

test('terminal status publication rejects non-GitHub target URLs', () => {
  expect(() => createIntegrationAuthorizationStatusPublication({
    result: result(),
    targetUrl: 'https://example.com/sec-platform/sec/pull/496',
    statusId: 123,
    principal: { creatorLogin: 'sec-integrator[bot]', creatorId: 900001 }
  })).toThrow('targetUrl must be one GitHub repository HTTPS URL');
});

test('gate-result parser fails closed on unknown transport schema', () => {
  expect(() => parseIntegrationAuthorizationGateResult(JSON.stringify({
    schema: 'sec-unknown-gate-result-v1'
  }))).toThrow('schema is not supported');
});

function githubProviderFetch(defaultBranches: readonly string[]): Readonly<{
  calls: string[];
  fetchImpl: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
}> {
  const calls: string[] = [];
  let repositoryReads = 0;
  const status = {
    id: 123,
    state: 'success',
    context: 'sec/integration-authorization',
    description: `gate ${'a'.repeat(12)} rules ${'8'.repeat(12)}`,
    target_url: 'https://github.com/sec-platform/sec/pull/496',
    creator: { login: 'sec-integrator[bot]', id: 900001 }
  };
  const response = (value: unknown): Response => new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
  const fetchImpl = async (
    input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    const method = init?.method ?? 'GET';
    const parsed = new URL(url);
    const requestPath = parsed.pathname + parsed.search;
    calls.push(`${method} ${requestPath}`);
    if (method === 'GET' && requestPath === '/repos/sec-platform/sec') {
      const defaultBranch = defaultBranches[Math.min(repositoryReads, defaultBranches.length - 1)]!;
      repositoryReads += 1;
      return response({ full_name: 'sec-platform/sec', default_branch: defaultBranch });
    }
    if (method === 'GET' && requestPath === '/repos/sec-platform/sec/pulls/496') {
      return response({
        state: 'open',
        draft: false,
        base: { ref: 'release/next', sha: BASE },
        head: { sha: HEAD }
      });
    }
    if (method === 'GET' && requestPath === '/repos/sec-platform/sec/branches/release%2Fnext') {
      return response({ commit: { sha: BASE } });
    }
    if (method === 'POST' && requestPath === `/repos/sec-platform/sec/statuses/${HEAD}`) {
      return response(status);
    }
    if (method === 'GET'
        && requestPath === `/repos/sec-platform/sec/commits/${HEAD}/statuses?per_page=100&page=1`) {
      return response([status]);
    }
    return new Response(JSON.stringify({ message: 'unexpected request' }), { status: 404 });
  };
  return Object.freeze({ calls, fetchImpl });
}

test('terminal publisher binds both readbacks to the observed repository default branch', async () => {
  const provider = githubProviderFetch(['release/next', 'release/next']);
  const publication = await publishIntegrationAuthorizationStatus({
    result: result(),
    token: 'token-with-at-least-twenty-characters',
    targetUrl: 'https://github.com/sec-platform/sec/pull/496',
    principal: { creatorLogin: 'sec-integrator[bot]', creatorId: 900001 },
    fetchImpl: provider.fetchImpl
  });
  expect(publication.statusId).toBe(123);
  expect(provider.calls.filter((call) => call.includes('/branches/release%2Fnext'))).toHaveLength(2);
  expect(provider.calls.some((call) => call.includes('/branches/main'))).toBe(false);
});

test('terminal publisher rejects a default-branch change across the publication effect', async () => {
  const provider = githubProviderFetch(['release/next', 'other-default']);
  await expect(publishIntegrationAuthorizationStatus({
    result: result(),
    token: 'token-with-at-least-twenty-characters',
    targetUrl: 'https://github.com/sec-platform/sec/pull/496',
    principal: { creatorLogin: 'sec-integrator[bot]', creatorId: 900001 },
    fetchImpl: provider.fetchImpl
  })).rejects.toThrow('authorization subject drifted at terminal status boundary');
});
