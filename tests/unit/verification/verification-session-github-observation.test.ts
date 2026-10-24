import { expect, test } from 'bun:test';

import {
  classifyGitHubGraphQLSchemaFailure,
  classifyGitHubObservationFailure,
  isGitHubProviderSchemaUnsupportedError,
  PROVIDER_SCHEMA_UNSUPPORTED_STATUS,
  parseGitHubCheckPages
} from '../../../src/adapters/verification/platform/ci/runtime/verification-session-github.ts';

const HEAD = '1'.repeat(40);

function parse(source: unknown) {
  return parseGitHubCheckPages({
    source,
    repository: 'sec-platform/sec',
    headSha: HEAD,
    observeWorkflowRun: () => {
      throw new Error('a non-workflow check must not hydrate workflow provenance');
    }
  });
}

test('GitHub check census accepts exact zero and classifies reached malformed bytes as provider-invalid', () => {
  expect(parse([{ total_count: 0, check_runs: [] }])).toEqual([]);
  expect(parse([{ total_count: 1, check_runs: [{
    id: 7,
    name: 'unrelated/check',
    status: 'completed',
    conclusion: 'success',
    head_sha: HEAD,
    details_url: null,
    app: null
  }] }])).toEqual([{
    id: 7,
    name: 'unrelated/check',
    status: 'completed',
    conclusion: 'success',
    headSha: HEAD,
    detailsUrl: null,
    appId: null,
    appNodeId: null,
    appSlug: null,
    workflowPath: null,
    workflowRef: null,
    eventName: null,
    workflowRunId: null,
    workflowRunDisplayTitle: null
  }]);

  for (const malformed of [
    [],
    [{ total_count: 1, check_runs: [] }],
    [{ total_count: 1, check_runs: [{ id: '7' }] }],
    [{ total_count: 1, check_runs: [{
      id: 7,
      name: 'partial-app',
      status: 'completed',
      conclusion: 'success',
      head_sha: HEAD,
      details_url: null,
      app: { id: 1 }
    }] }]
  ]) {
    let failure: unknown;
    try {
      parse(malformed);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect(classifyGitHubObservationFailure(failure)).toMatchObject({
      kind: 'provider-invalid'
    });
  }
});

test('GitHub GraphQL schema drift is classified as typed provider-schema-unsupported', () => {
  const observed = "gh: Field 'id' doesn't exist on type 'Actor'";
  const failure = classifyGitHubGraphQLSchemaFailure(observed);
  expect(failure).not.toBeNull();
  expect(failure!.status).toBe(PROVIDER_SCHEMA_UNSUPPORTED_STATUS);
  expect(failure!.reasonCode).toBe('github-graphql-schema-unsupported');
  expect(failure!.responseDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
  expect(isGitHubProviderSchemaUnsupportedError(Object.assign(
    new Error('x'),
    { code: PROVIDER_SCHEMA_UNSUPPORTED_STATUS, reasonCode: 'r', responseDigest: failure!.responseDigest }
  ))).toBe(false);
  expect(classifyGitHubGraphQLSchemaFailure('HTTP 403: Resource not accessible')).toBeNull();
});
