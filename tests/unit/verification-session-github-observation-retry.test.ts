import { expect, test } from 'bun:test';

import {
  createGitHubCommandFailureDiagnosticV1,
  isIdempotentGitHubObservationCommandV1,
  isRetryableGitHubObservationFailureV1,
  runGitHubObservationWithBoundedRetryV1
} from '../../scripts/codex/verification-session-github.ts';

function result(status: number | null, stderr = '', stdout = '') {
  return Object.freeze({
    status,
    stderr: Buffer.from(stderr, 'utf8'),
    stdout: Buffer.from(stdout, 'utf8')
  });
}

test('idempotent GitHub observation retries bounded transient EOF and preserves final bytes', () => {
  const outcomes = [
    result(1, 'Get https://api.github.com/repos/sec-platform/sec: EOF'),
    result(1, 'HTTP 503 Service Unavailable'),
    result(0, '', '{"tree":{"sha":"abc"}}')
  ];
  const delays: number[] = [];
  let attempts = 0;
  const observed = runGitHubObservationWithBoundedRetryV1({
    args: ['api', '/repos/sec-platform/sec/git/commits/abc'],
    execute: () => outcomes[attempts++]!,
    wait: (delayMs) => { delays.push(delayMs); }
  });
  expect(attempts).toBe(3);
  expect(delays).toEqual([250, 1_000]);
  expect(observed).toEqual(outcomes[2]!);
});

test('non-transient provider failure is observed once', () => {
  let attempts = 0;
  const observed = runGitHubObservationWithBoundedRetryV1({
    args: ['pr', 'view', '532', '--repo', 'sec-platform/sec'],
    execute: () => {
      attempts += 1;
      return result(1, 'HTTP 401 Bad credentials');
    },
    wait: () => { throw new Error('non-transient failure must not wait'); }
  });
  expect(attempts).toBe(1);
  expect(observed.status).toBe(1);
});

test('effectful and filesystem-materializing GitHub commands are never replayed', () => {
  const body = Buffer.from('{}\n', 'utf8');
  expect(isIdempotentGitHubObservationCommandV1([
    'api', '--method', 'POST', '/repos/sec-platform/sec/dispatches', '--input', '-'
  ], body)).toBe(false);
  expect(isIdempotentGitHubObservationCommandV1([
    'run', 'download', '1', '--repo', 'sec-platform/sec', '--dir', 'target'
  ])).toBe(false);
  for (const args of [
    ['pr', 'merge', '532'],
    ['pr', 'close', '532'],
    ['pr', 'comment', '532', '--body', 'retry me'],
    ['issue', 'create', '--title', 'effect'],
    ['workflow', 'run', 'verify.yml'],
    ['repo', 'delete', 'sec-platform/sec'],
    ['api', '--method=POST', '/repos/sec-platform/sec/dispatches'],
    ['api', '-XPOST', '/repos/sec-platform/sec/dispatches'],
    ['api', '/repos/sec-platform/sec/dispatches', '--input=payload'],
    ['api', '/repos/sec-platform/sec/issues', '--field=title=effect'],
    ['api', '/repos/sec-platform/sec/issues', '-f=title=effect']
  ]) {
    expect(isIdempotentGitHubObservationCommandV1(args)).toBe(false);
  }
  let attempts = 0;
  runGitHubObservationWithBoundedRetryV1({
    args: ['api', '--method', 'POST', '/repos/sec-platform/sec/dispatches', '--input', '-'],
    body,
    execute: () => {
      attempts += 1;
      return result(1, 'EOF');
    },
    wait: () => { throw new Error('effect must not wait'); }
  });
  expect(attempts).toBe(1);
});

test('GraphQL queries can retry but mutations cannot', () => {
  expect(isIdempotentGitHubObservationCommandV1([
    'api', 'graphql', '-f', 'query=query($owner:String!){repository(owner:$owner,name:"sec"){id}}',
    '-F', 'owner=sec-platform'
  ])).toBe(true);
  expect(isIdempotentGitHubObservationCommandV1([
    'api', 'graphql', '-f', 'query=mutation{createIssue(input:{}){clientMutationId}}'
  ])).toBe(false);
  expect(isIdempotentGitHubObservationCommandV1([
    'api', 'graphql', '-f=query=query{viewer{login}}'
  ])).toBe(false);
  expect(isIdempotentGitHubObservationCommandV1([
    'api', 'graphql', '-f', 'query=query{viewer{login}}', '-f', 'query=query{viewer{id}}'
  ])).toBe(false);
  expect(isIdempotentGitHubObservationCommandV1([
    'api', 'graphql', '-f', 'query=query{viewer{login}}', '--method=POST'
  ])).toBe(false);
});

test('retry allowlist accepts only the exact production PR and REST observation shapes', () => {
  expect(isIdempotentGitHubObservationCommandV1([
    'pr', 'view', '532', '--repo', 'sec-platform/sec', '--json', 'number,state,headRefOid'
  ])).toBe(true);
  expect(isIdempotentGitHubObservationCommandV1([
    'pr', 'view', '532', '--web'
  ])).toBe(false);
  expect(isIdempotentGitHubObservationCommandV1([
    'api', '/repos/sec-platform/sec/git/commits/abc', '--jq', '.tree.sha'
  ])).toBe(true);
  expect(isIdempotentGitHubObservationCommandV1([
    'api', '--method', 'GET', '/repos/sec-platform/sec/pulls/532/files',
    '--paginate', '--slurp', '-f', 'per_page=100'
  ])).toBe(true);
  expect(isIdempotentGitHubObservationCommandV1([
    'api', '--method', 'GET', '/repos/sec-platform/sec/contents/AGENTS.md',
    '-f', `ref=${'1'.repeat(40)}`
  ])).toBe(true);
  expect(isIdempotentGitHubObservationCommandV1([
    'api', '/repos/sec-platform/sec/issues', '-f', 'state=open'
  ])).toBe(false);
  expect(isIdempotentGitHubObservationCommandV1([
    'api', '--method', 'POST', '/repos/sec-platform/sec/issues', '-f', 'title=effect'
  ])).toBe(false);
  expect(isIdempotentGitHubObservationCommandV1([
    'api', '/repos/sec-platform/sec/issues', '--unknown'
  ])).toBe(false);
});

test('spawn failure diagnostics retain timeout identity when stderr is empty', () => {
  const timeout = createGitHubCommandFailureDiagnosticV1(
    Buffer.alloc(0),
    new Error('spawnSync gh ETIMEDOUT')
  );
  expect(timeout.toString('utf8')).toBe('spawnSync gh ETIMEDOUT');
  expect(isRetryableGitHubObservationFailureV1({
    status: null,
    stdout: Buffer.alloc(0),
    stderr: timeout
  })).toBe(true);

  expect(createGitHubCommandFailureDiagnosticV1(
    Buffer.from('provider stderr', 'utf8'),
    new Error('spawnSync gh ETIMEDOUT')
  ).toString('utf8')).toBe('provider stderr\nspawnSync gh ETIMEDOUT');
});

test('retry classifier is narrow to transient transport and selected server failures', () => {
  for (const diagnostic of [
    'read: connection reset by peer',
    'dial tcp: i/o timeout',
    'HTTP 408 Request Timeout',
    'status 504'
  ]) {
    expect(isRetryableGitHubObservationFailureV1(result(1, diagnostic))).toBe(true);
  }
  for (const diagnostic of ['HTTP 403', 'HTTP 404', 'validation failed', 'rate limit exceeded']) {
    expect(isRetryableGitHubObservationFailureV1(result(1, diagnostic))).toBe(false);
  }
  expect(isRetryableGitHubObservationFailureV1(result(0, 'EOF'))).toBe(false);
});
