import { expect, test } from 'bun:test';

import {
  classifyGitHubGraphQLSchemaFailure,
  evaluatePlatformEnforcementObservation,
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

test('readable but noncanonical rulesets never become platform enforcement authority', async () => {
  const observation = await evaluatePlatformEnforcementObservation({
    repository: 'sec-platform/sec',
    readRulesets: () => ({
      defaultBranch: 'main',
      effectiveRules: [{
        type: 'required_status_checks',
        ruleset_id: 18533093,
        parameters: {
          required_status_checks: [{ context: 'CodeQL', integration_id: 57789 }],
          strict_required_status_checks_policy: false
        }
      }],
      detailedRulesets: [{
        id: 18533093,
        name: 'main-code-scanning',
        target: 'branch',
        source_type: 'Repository',
        source: 'sec-platform/sec',
        enforcement: 'active',
        bypass_actors: [],
        conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
        rules: [{ type: 'required_code_scanning', parameters: {} }]
      }]
    })
  });
  expect(observation).toMatchObject({
    status: 'unknown',
    reason: expect.stringContaining('Canonical MainAuthority ruleset proof failed')
  });
  expect(observation.rulesetDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
});

test('platform 403 is recorded as unavailable and never as no-bypass proof', async () => {
  const error = new Error('upgrade plan') as Error & { statusCode?: number };
  error.statusCode = 403;
  const observation = (await evaluatePlatformEnforcementObservation({
    repository: 'sec-platform/sec', readRulesets: () => { throw error; }
  }));
  expect(observation.status).toBe('platform-enforcement-unavailable');
  expect(observation.reason).toContain('unavailable');
  expect(observation.rulesetDigest).toMatch(/^sha256:/);
});
