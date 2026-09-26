import { expect, test } from 'bun:test';

import { sha256 } from '../../src/contracts/canonical.ts';
import { parseExactRefRetirement } from '../../src/adapters/self-hosting/control/branch-lifecycle/exact-ref-retirement-contract.ts';
import { parseRepositoryMaintenanceRequest } from '../../src/adapters/self-hosting/control/repository-maintenance/contract.ts';
import {
  assertHostedRepositoryMaintenanceIdentity,
  parseHostedRepositoryMaintenanceRequest
} from '../../src/adapters/self-hosting/control/repository-maintenance/hosted-admission.ts';

const MAIN = 'a'.repeat(40);

function requestSource(): string {
  return JSON.stringify({
    schema: 'sec-repository-maintenance-request-v1',
    repository: 'sec-platform/sec',
    expectedMainSha: MAIN,
    operations: [{
      kind: 'exact-ref-retirement',
      retirement: {
        classification: 'closed-pr-superseded',
        branches: ['fix/old'],
        expectedHeadSha: 'b'.repeat(40),
        pullRequestNumber: 631
      }
    }]
  });
}

function environment(source = requestSource()): NodeJS.ProcessEnv {
  return {
    GITHUB_ACTIONS: 'true',
    GITHUB_SERVER_URL: 'https://github.com',
    GITHUB_API_URL: 'https://api.github.com',
    GITHUB_REPOSITORY: 'sec-platform/sec',
    GITHUB_EVENT_NAME: 'issue_comment',
    GITHUB_REF: 'refs/heads/main',
    GITHUB_SHA: MAIN,
    GITHUB_WORKFLOW_SHA: MAIN,
    GITHUB_WORKFLOW_REF:
      'sec-platform/sec/.github/workflows/repository-maintenance.yml@refs/heads/main',
    GITHUB_ACTOR: 'maintainer',
    SEC_MAINTENANCE_REQUEST_JSON: source,
    SEC_MAINTENANCE_ISSUE_NUMBER: '313',
    SEC_MAINTENANCE_COMMENT_ID: '42',
    SEC_MAINTENANCE_COMMENT_AUTHOR: 'maintainer',
    SEC_MAINTENANCE_AUTHOR_ASSOCIATION: 'MEMBER'
  };
}

test('maintenance request accepts one exact closed-PR or single transport retirement only', () => {
  const parsed = parseRepositoryMaintenanceRequest(requestSource());
  expect(parsed.operations).toHaveLength(1);
  expect(parsed.operations[0]!.retirement).toEqual(parseExactRefRetirement({
    classification: 'closed-pr-superseded',
    branches: ['fix/old'],
    expectedHeadSha: 'b'.repeat(40),
    pullRequestNumber: 631
  }));
  expect(() => parseExactRefRetirement({
    classification: 'closed-pr-superseded',
    branches: ['fix/old', 'fix/other'],
    expectedHeadSha: 'b'.repeat(40),
    pullRequestNumber: 631
  })).toThrow('exactly one branch');
  expect(parseExactRefRetirement({
    classification: 'transport-only',
    branches: ['transport/old'],
    expectedHeadSha: 'b'.repeat(40)
  })).toEqual({
    classification: 'transport-only',
    branches: ['transport/old'],
    expectedHeadSha: 'b'.repeat(40)
  });
  expect(() => parseExactRefRetirement({
    classification: 'transport-only',
    branches: ['transport/one', 'transport/two'],
    expectedHeadSha: 'b'.repeat(40)
  })).toThrow('exactly one branch');
  expect(() => parseExactRefRetirement({
    classification: 'transport-only',
    branches: ['fix/old'],
    expectedHeadSha: 'b'.repeat(40)
  })).toThrow('transport/*');
  const multi = JSON.parse(requestSource()) as Record<string, unknown>;
  const operations = multi.operations as unknown[];
  multi.operations = [...operations, ...operations];
  expect(() => parseRepositoryMaintenanceRequest(JSON.stringify(multi)))
    .toThrow('exactly one operation');
});

test('hosted maintenance binds exact main workflow, lifecycle issue and maintainer event identity', () => {
  const request = parseRepositoryMaintenanceRequest(requestSource());
  expect(() => assertHostedRepositoryMaintenanceIdentity(request, environment())).not.toThrow();
  for (const changed of [
    { GITHUB_EVENT_NAME: 'workflow_dispatch' },
    { GITHUB_REF: 'refs/heads/other' },
    { GITHUB_SHA: 'c'.repeat(40) },
    { GITHUB_WORKFLOW_SHA: 'c'.repeat(40) },
    { SEC_MAINTENANCE_ISSUE_NUMBER: '312' },
    { SEC_MAINTENANCE_COMMENT_ID: '0' },
    { SEC_MAINTENANCE_AUTHOR_ASSOCIATION: 'CONTRIBUTOR' },
    { GITHUB_ACTOR: 'other' }
  ]) {
    expect(() => assertHostedRepositoryMaintenanceIdentity(
      request,
      { ...environment(), ...changed }
    )).toThrow();
  }
});

test('hosted request is parsed from the exact issue comment body without repair', () => {
  const source = requestSource();
  expect(parseHostedRepositoryMaintenanceRequest(environment(source)))
    .toEqual(JSON.parse(source));
  expect(() => parseHostedRepositoryMaintenanceRequest(
    environment(source.replace('fix/old', 'fix/changed'))
  )).not.toThrow();
  expect(() => parseHostedRepositoryMaintenanceRequest({
    ...environment(source),
    SEC_MAINTENANCE_REQUEST_JSON: undefined
  })).toThrow('absent');
});

test('canonical maintenance request digest changes with exact ref identity', () => {
  const left = parseRepositoryMaintenanceRequest(requestSource());
  const right = parseRepositoryMaintenanceRequest(
    requestSource().replace('b'.repeat(40), 'c'.repeat(40))
  );
  expect(sha256(left)).not.toBe(sha256(right));
});
