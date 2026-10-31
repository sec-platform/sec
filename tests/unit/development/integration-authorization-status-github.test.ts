import { expect, test } from 'bun:test';
import { sha256 } from '../../../src/contracts/canonical.ts';

import {
  issueGitHubApiTestCapability,
  withGitHubApiTestSession,
  type GitHubApiTransport
} from '../../../src/adapters/providers/github-api/test/operation-session.ts';
import { createIntegrationAuthorization } from '../../../src/adapters/self-hosting/control/integration/authorization.ts';
import {
  createIntegrationAuthorizationStatusPublication,
  parseIntegrationAuthorizationGateResult,
  parseIntegrationAuthorizationStatusPublication,
  publishIntegrationAuthorizationStatus,
  type IntegrationAuthorizationGateResult
} from '../../../src/adapters/self-hosting/control/integration/integration-authorization-status-github.ts';
import { encodeVerificationActionData } from '../../../src/adapters/verification/platform/action/contract/action.ts';

const D = (char: string): `sha256:${string}` => `sha256:${char.repeat(64).slice(0, 64)}`;
const BASE = '1'.repeat(40);
const HEAD = '2'.repeat(40);

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
        producerIdentity: 'src/adapters/self-hosting/control/integration/merge-gate.ts',
        trustedRevision: BASE,
        sourceTransport: 'trusted-integration-runtime',
        sourceRunId: 'trusted-runtime-1',
        sourceRef: `src/adapters/self-hosting/control/integration/merge-gate.ts@${BASE}`,
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

test('terminal status receipt round-trips exact identity and rejects foreign URL or rehashed malformed history', () => {
  const gateResult = result();
  const publication = createIntegrationAuthorizationStatusPublication({
    result: gateResult,
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
    description: `gate ${'a'.repeat(12)} rules ${'8'.repeat(12)}`,
    state: 'success',
    statusId: 123,
    creatorLogin: 'sec-integrator[bot]',
    creatorId: 900001
  });
  expect(publication.publicationDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
  expect(parseIntegrationAuthorizationStatusPublication(
    encodeVerificationActionData(publication)
  )).toEqual(publication);
  expect(() => createIntegrationAuthorizationStatusPublication({
    result: gateResult,
    targetUrl: 'https://example.com/sec-platform/sec/pull/496',
    statusId: 123,
    principal: { creatorLogin: 'sec-integrator[bot]', creatorId: 900001 }
  })).toThrow('targetUrl must be one GitHub repository HTTPS URL');
  const { publicationDigest: _oldDigest, ...history } = publication;
  const malformed = { ...history, repository: '' };
  expect(() => parseIntegrationAuthorizationStatusPublication(encodeVerificationActionData({
    ...malformed, publicationDigest: sha256(malformed)
  }))).toThrow('repository');
});

test('gate-result parser fails closed on unknown transport schema', () => {
  expect(() => parseIntegrationAuthorizationGateResult(JSON.stringify({
    schema: 'sec-unknown-gate-result-v1'
  }))).toThrow('schema is not supported');
});

function githubProviderFetch(): Readonly<{
  calls: string[];
  fetchImpl: GitHubApiTransport;
}> {
  const calls: string[] = [];
  return {
    calls,
    fetchImpl: async (target) => {
      calls.push(String(target));
      throw new Error('Unexpected provider request before trusted-runtime qualification.');
    }
  };
}

async function publishWithProvider(
  provider: ReturnType<typeof githubProviderFetch>,
  gateResult: IntegrationAuthorizationGateResult
): Promise<Awaited<ReturnType<typeof publishIntegrationAuthorizationStatus>>> {
  const capability = issueGitHubApiTestCapability({
    repository: 'sec-platform/sec',
    token: 'token-with-at-least-twenty-characters',
    principal: {
      transport: 'github-rest-token',
      login: 'sec-integrator[bot]',
      nodeId: 'MDQ6VXNlcjkwMDAwMQ==',
      userId: 900001,
      permission: 'maintain'
    },
    effect: 'status-write',
    transport: provider.fetchImpl
  });
  return await withGitHubApiTestSession({
    capability,
    operation: async () => await publishIntegrationAuthorizationStatus({
      result: gateResult,
      targetUrl: 'https://github.com/sec-platform/sec/pull/496',
      repositoryRoot: process.cwd(),
      expectedPrincipal: { login: 'sec-integrator[bot]', nodeId: 'MDQ6VXNlcjkwMDAwMQ==', userId: 900001 }
    })
  });
}

// Saved results are historical data. The previous mock's successful provider
// readbacks never established an actual producer qualification; those live
// post-qualification obligations require the real integration fixture.
test('terminal publisher rejects omitted or relabelled transition JSON before provider effects', async () => {
  const original = JSON.parse(JSON.stringify(result())) as Record<string, unknown>;
  const variants: readonly Record<string, unknown>[] = [
    { ...original, sourceProgramTransitionAcceptance: { qualificationDigest: D('b') } },
    { ...original },
    { ...original, schema: 'codex-development-merge-gate-result-v2' }
  ];
  for (const fields of variants) {
    const { resultDigest: _oldDigest, ...data } = fields;
    const callerResult = { ...data, resultDigest: sha256(data) } as unknown as IntegrationAuthorizationGateResult;
    const provider = githubProviderFetch();
    await expect(publishWithProvider(provider, callerResult))
      .rejects.toThrow('actual trusted-runtime transition producer');
    expect(provider.calls).toEqual([]);
  }
});
