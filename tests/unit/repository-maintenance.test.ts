import { spawnSync } from 'node:child_process';
import { appendFileSync, chmodSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import { readLinuxRetainedFile } from '../../src/adapters/runtime-state/physical/runtime/physical-no-follow-native.ts';

import { isRepositoryMaintenancePermission } from '../../src/adapters/providers/github-api/repository-maintenance-permission.ts';

import { parseExactRefRetirement } from '../../src/adapters/self-hosting/control/branch-lifecycle/exact-ref-retirement-contract.ts';
import {
  parseExactRemoteRefRecoveryPreparation
} from '../../src/adapters/self-hosting/control/branch-lifecycle/exact-ref-retirement.ts';
import { parseRepositoryMaintenanceRequest, parseRepositoryMaintenanceResumeReceipt } from '../../src/adapters/self-hosting/control/repository-maintenance/contract.ts';
import {
  assertRepositoryMaintenanceDispatcherPermission,
  createRepositoryMaintenanceDispatchPayload
} from '../../src/adapters/self-hosting/control/repository-maintenance/dispatch.ts';
import {
  assertHostedRepositoryMaintenanceIdentity,
  parseHostedRepositoryMaintenanceRequest
} from '../../src/adapters/self-hosting/control/repository-maintenance/hosted-admission.ts';
import { sha256 } from '../../src/contracts/canonical.ts';

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

function batchSource(count = 1): string {
  const value = JSON.parse(requestSource());
  value.schema = 'sec-repository-maintenance-request-v2';
  value.operations = Array.from({ length: count }, (_, index) => ({
    kind: 'exact-ref-retirement',
    retirement: { classification: 'main-tree-identical', branches: [`fix/old-${index}`], expectedHeadSha: 'b'.repeat(40) }
  }));
  return JSON.stringify(value);
}

function environment(source = batchSource()): NodeJS.ProcessEnv {
  return {
    GITHUB_ACTIONS: 'true',
    GITHUB_SERVER_URL: 'https://github.com',
    GITHUB_API_URL: 'https://api.github.com',
    GITHUB_REPOSITORY: 'sec-platform/sec',
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_RUN_ATTEMPT: '1',
    GITHUB_REF: 'refs/heads/main',
    GITHUB_SHA: MAIN,
    GITHUB_WORKFLOW_SHA: MAIN,
    GITHUB_WORKFLOW_REF:
      'sec-platform/sec/.github/workflows/repository-maintenance.yml@refs/heads/main',
    GITHUB_ACTOR: 'maintainer',
    SEC_MAINTENANCE_REQUEST_JSON: source
  };
}

test('shared maintenance permission predicate accepts only qualified maintain/admin roles', () => {
  for (const role of ['admin', 'maintain']) expect(isRepositoryMaintenancePermission(role)).toBe(true);
  for (const role of ['OWNER', 'MEMBER', 'write', 'triage', 'read', 'none', '', null, undefined, {}, ['admin']]) {
    expect(isRepositoryMaintenancePermission(role)).toBe(false);
  }
});

test('maintenance dispatcher requires current maintain/admin before creating a workflow signal', () => {
  expect(assertRepositoryMaintenanceDispatcherPermission({ permission: 'admin' })).toBe('admin');
  expect(assertRepositoryMaintenanceDispatcherPermission({ permission: 'maintain' })).toBe('maintain');
  expect(assertRepositoryMaintenanceDispatcherPermission({ permission: 'write', role_name: 'maintain' }))
    .toBe('maintain');
  for (const value of [
    { permission: 'write' },
    { permission: 'admin', role_name: 'custom-maintainer' },
    { permission: 'triage' },
    { permission: 'read' },
    { permission: 'none' },
    {},
    null
  ]) {
    expect(() => assertRepositoryMaintenanceDispatcherPermission(value))
      .toThrow(/maintain\/admin permission|must be one object/u);
  }
});

test('maintenance dispatch sends one exact bounded batch without a comment carrier', () => {
  expect(createRepositoryMaintenanceDispatchPayload(batchSource(12))).toEqual({
    ref: 'main', inputs: { request: batchSource(12), request_digest: sha256(parseRepositoryMaintenanceRequest(batchSource(12))), execution_digest: sha256({ requestDigest: sha256(parseRepositoryMaintenanceRequest(batchSource(12))), resumeReceipt: null }), resume_receipt: '' }
  });
  expect(() => createRepositoryMaintenanceDispatchPayload(requestSource())).toThrow('legacy');
  expect(() => createRepositoryMaintenanceDispatchPayload(batchSource() + ' '.repeat(62_000))).toThrow('bounded byte');
  expect(() => createRepositoryMaintenanceDispatchPayload(batchSource() + '\t'.repeat(32_800))).toThrow('provider payload budget');
});

test('v2 batch rejects duplicates, mixed lanes and unbounded or malformed requests', () => {
  expect(parseRepositoryMaintenanceRequest(batchSource(64)).operations).toHaveLength(64);
  expect(() => parseRepositoryMaintenanceRequest(batchSource(65))).toThrow('1..64');
  const value = JSON.parse(batchSource());
  value.operations.push(value.operations[0]);
  expect(() => parseRepositoryMaintenanceRequest(JSON.stringify(value))).toThrow('duplicate branch');
  value.operations = [];
  expect(() => parseRepositoryMaintenanceRequest(JSON.stringify(value))).toThrow('1..64');
  value.operations = [{ kind: 'exact-comment-retirement', retirement: {
    issueNumber: 313, commentId: 42, expectedBodyDigest: 'sha256:' + 'c'.repeat(64)
  }}];
  expect(() => parseRepositoryMaintenanceRequest(JSON.stringify(value))).toThrow('only an exact ref batch');
  const unknown = { ...JSON.parse(batchSource()), authority: 'admin' };
  expect(() => parseRepositoryMaintenanceRequest(JSON.stringify(unknown))).toThrow('fields');
});

test('resume locator carries only exact provider identities, never supplied results', () => {
  const locator = { artifactId: '123', artifactDigest: `sha256:${'d'.repeat(64)}` as const, runId: '456', runAttempt: 1 };
  expect(parseRepositoryMaintenanceResumeReceipt(JSON.stringify(locator))).toEqual(locator);
  expect(createRepositoryMaintenanceDispatchPayload(batchSource(), JSON.stringify(locator)).inputs.resume_receipt)
    .toBe(JSON.stringify(locator));
  expect(createRepositoryMaintenanceDispatchPayload(batchSource(), JSON.stringify(locator)).inputs.execution_digest)
    .not.toBe(createRepositoryMaintenanceDispatchPayload(batchSource()).inputs.execution_digest);
  expect(parseRepositoryMaintenanceResumeReceipt('')).toBeUndefined();
  for (const changed of [{ results: [] }, { runAttempt: 0 }, { artifactId: '../123' }, { artifactId: '9'.repeat(30) }, { artifactDigest: 'not-a-digest' }]) {
    expect(() => parseRepositoryMaintenanceResumeReceipt(JSON.stringify({ ...locator, ...changed }))).toThrow();
  }
});

test('maintenance request accepts one exact ref or bounded exact comment batch', () => {
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
  expect(parseExactRefRetirement({
    classification: 'main-tree-identical',
    branches: ['fix/process-residue'],
    expectedHeadSha: 'b'.repeat(40)
  })).toEqual({
    classification: 'main-tree-identical',
    branches: ['fix/process-residue'],
    expectedHeadSha: 'b'.repeat(40)
  });
  expect(() => parseExactRefRetirement({
    classification: 'main-tree-identical',
    branches: ['fix/one', 'fix/two'],
    expectedHeadSha: 'b'.repeat(40)
  })).toThrow('exactly one branch');
  const multi = JSON.parse(requestSource()) as Record<string, unknown>;
  const operations = multi.operations as unknown[];
  multi.operations = [...operations, ...operations];
  expect(() => parseRepositoryMaintenanceRequest(JSON.stringify(multi)))
    .toThrow('exact ref retirement must remain one-operation-per-request');

  const expectedBodyDigest = `sha256:${'c'.repeat(64)}` as const;
  const comment = parseRepositoryMaintenanceRequest(JSON.stringify({
    schema: 'sec-repository-maintenance-request-v1',
    repository: 'sec-platform/sec',
    expectedMainSha: MAIN,
    operations: [42, 43].map((commentId) => ({
      kind: 'exact-comment-retirement',
      retirement: {
        issueNumber: 313,
        commentId,
        expectedBodyDigest
      }
    }))
  }));
  expect(comment.operations).toEqual([42, 43].map((commentId) => ({
    kind: 'exact-comment-retirement',
    retirement: {
      issueNumber: 313,
      commentId,
      expectedBodyDigest
    }
  })));

  const duplicate = JSON.parse(JSON.stringify(comment)) as Record<string, unknown>;
  duplicate.operations = [
    (comment.operations as readonly unknown[])[0],
    (comment.operations as readonly unknown[])[0]
  ];
  expect(() => parseRepositoryMaintenanceRequest(JSON.stringify(duplicate)))
    .toThrow('duplicate comment identity');

  const mixed = JSON.parse(requestSource()) as Record<string, unknown>;
  mixed.operations = [
    ...(mixed.operations as unknown[]),
    (comment.operations as readonly unknown[])[0]
  ];
  expect(() => parseRepositoryMaintenanceRequest(JSON.stringify(mixed)))
    .toThrow('exact ref retirement must remain one-operation-per-request');

  expect(() => parseRepositoryMaintenanceRequest(JSON.stringify({
    schema: 'sec-repository-maintenance-request-v1',
    repository: 'sec-platform/sec',
    expectedMainSha: MAIN,
    operations: Array.from({ length: 65 }, (_, index) => ({
      kind: 'exact-comment-retirement',
      retirement: {
        issueNumber: 313,
        commentId: index + 1,
        expectedBodyDigest: 'sha256:' + 'd'.repeat(64)
      }
    }))
  }))).toThrow('1..64 operations');
  expect(() => parseRepositoryMaintenanceRequest(JSON.stringify({
    schema: 'sec-repository-maintenance-request-v1',
    repository: 'sec-platform/sec',
    expectedMainSha: MAIN,
    operations: [{
      kind: 'exact-comment-retirement',
      retirement: {
        issueNumber: 313,
        commentId: 0,
        expectedBodyDigest: 'sha256:' + 'c'.repeat(64)
      }
    }]
  }))).toThrow('commentId');
  expect(() => parseRepositoryMaintenanceRequest(JSON.stringify({
    schema: 'sec-repository-maintenance-request-v1',
    repository: 'sec-platform/sec',
    expectedMainSha: MAIN,
    operations: [{
      kind: 'exact-comment-retirement',
      retirement: {
        issueNumber: 650,
        commentId: 42,
        expectedBodyDigest: 'sha256:' + 'c'.repeat(64)
      }
    }]
  }))).toThrow('restricted to lifecycle issue #313');
});

test('exact ref recovery preparation binds request identity, ref state and bundle digest', () => {
  const retirement = parseExactRefRetirement({
    classification: 'main-tree-identical',
    branches: ['fix/process-residue'],
    expectedHeadSha: 'b'.repeat(40)
  });
  const parsed = parseExactRemoteRefRecoveryPreparation({
    schema: 'sec-exact-ref-retirement-recovery-preparation-v1',
    repository: 'sec-platform/sec',
    expectedMainSha: MAIN,
    retirement,
    refState: 'present',
    recovery: {
      bundleName: 'sec-branch-closeout-1234-99-123e4567-e89b-12d3-a456-426614174000.bundle',
      sha256: `sha256:${'c'.repeat(64)}` as const,
      verifyOutput: 'verified'
    }
  });
  expect(parsed).toEqual({
    schema: 'sec-exact-ref-retirement-recovery-preparation-v1',
    repository: 'sec-platform/sec',
    expectedMainSha: MAIN,
    retirement,
    refState: 'present',
    recovery: {
      bundleName: 'sec-branch-closeout-1234-99-123e4567-e89b-12d3-a456-426614174000.bundle',
      sha256: `sha256:${'c'.repeat(64)}` as const,
      verifyOutput: 'verified'
    }
  });
  expect(() => parseExactRemoteRefRecoveryPreparation({
    ...parsed,
    refState: 'moved'
  })).toThrow('identity is invalid');
  expect(() => parseExactRemoteRefRecoveryPreparation({
    ...parsed,
    recovery: {
      ...parsed.recovery,
      bundleName: '../escape.bundle'
    }
  })).toThrow('bundle identity is invalid');
});

test('hosted maintenance selects exact main batch lane without treating environment fields as authority', () => {
  const request = parseRepositoryMaintenanceRequest(batchSource());
  expect(() => assertHostedRepositoryMaintenanceIdentity(request, environment())).not.toThrow();
  for (const association of ['MEMBER', 'COLLABORATOR', 'NONE', 'unknown', undefined]) {
    expect(() => assertHostedRepositoryMaintenanceIdentity(request, { ...environment(),
      SEC_MAINTENANCE_AUTHOR_ASSOCIATION: association })).not.toThrow();
  }
  for (const changed of [
    { GITHUB_EVENT_NAME: 'issue_comment' },
    { GITHUB_REF: 'refs/heads/other' },
    { GITHUB_SHA: 'c'.repeat(40) },
    { GITHUB_WORKFLOW_SHA: 'c'.repeat(40) },
    { GITHUB_EVENT_NAME: 'repository_dispatch' },
    { GITHUB_ACTOR: '' },
    { GITHUB_RUN_ATTEMPT: '2' }
  ]) {
    expect(() => assertHostedRepositoryMaintenanceIdentity(
      request,
      { ...environment(), ...changed }
    )).toThrow();
  }
});

test('hosted request is parsed from exact batch input without repair', () => {
  const source = batchSource();
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


test('reviewed superseded ref retirement is single-ref and bound to lifecycle issue evidence', () => {
  const request = {
    schema: 'sec-repository-maintenance-request-v1',
    repository: 'sec-platform/sec',
    expectedMainSha: MAIN,
    operations: [{
      kind: 'exact-ref-retirement',
      retirement: {
        classification: 'reviewed-superseded',
        branches: ['fix/orphan'],
        expectedHeadSha: 'b'.repeat(40),
        reviewIssueNumber: 313,
        reviewCommentId: 9001
      }
    }]
  };
  expect(parseRepositoryMaintenanceRequest(JSON.stringify(request)).operations[0]).toEqual({
    kind: 'exact-ref-retirement',
    retirement: {
      classification: 'reviewed-superseded',
      branches: ['fix/orphan'],
      expectedHeadSha: 'b'.repeat(40),
      reviewIssueNumber: 313,
      reviewCommentId: 9001
    }
  });
  const wrongIssue = structuredClone(request);
  wrongIssue.operations[0]!.retirement.reviewIssueNumber = 312;
  expect(() => parseRepositoryMaintenanceRequest(JSON.stringify(wrongIssue)))
    .toThrow('restricted to lifecycle issue #313');
  const multiple = structuredClone(request);
  multiple.operations[0]!.retirement.branches = ['fix/orphan', 'fix/other'];
  expect(() => parseRepositoryMaintenanceRequest(JSON.stringify(multiple)))
    .toThrow('exactly one branch');
});


test('CLI authenticates once and dispatches one batch with exact returned run identity', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'maintenance-dispatch-'));
  try {
    const executable = path.join(root, 'gh');
    const log = path.join(root, 'calls');
    const payload = path.join(root, 'payload');
    const request = path.join(root, 'request 计划.json');
    writeFileSync(request, batchSource(12));
    writeFileSync(executable, `#!/bin/sh
printf '%s\n' "$*" >> "$DISPATCH_LOG"
case "$*" in
  'api /user') printf '%s' '{"login":"maintainer","type":"User"}' ;;
  *'/permission') printf '%s' '{"permission":"admin"}' ;;
  *'/git/ref/heads/main'*) printf '%s' '${MAIN}' ;;
  *'--method POST'*) cat > "$DISPATCH_PAYLOAD"; if [ "$DISPATCH_FAIL" = 1 ]; then echo 'response lost' >&2; exit 2; fi; printf '%s' '{"workflow_run_id":123,"run_url":"https://api.github.com/repos/sec-platform/sec/actions/runs/123","html_url":"https://github.com/sec-platform/sec/actions/runs/123"}' ;;
  *) echo 'unexpected provider operation' >&2; exit 3 ;;
esac
`);
    chmodSync(executable, 0o755);
    const cli = path.resolve(import.meta.dir, '../../src/adapters/self-hosting/control/repository-maintenance/dispatch.ts');
    const run = (fail: boolean) => spawnSync(process.execPath, [cli, '--repository', 'sec-platform/sec', '--request', fail ? request : path.relative(root, request)], {
      cwd: root, encoding: 'utf8', env: { ...process.env, PATH: root + path.delimiter + process.env.PATH,
        DISPATCH_LOG: log, DISPATCH_PAYLOAD: payload, DISPATCH_FAIL: fail ? '1' : '0' }
    });
    const successful = run(false);
    expect(successful.status).toBe(0);
    expect(JSON.parse(successful.stdout)).toMatchObject({ status: 'dispatched', runId: 123, operations: 12 });
    expect(JSON.parse(readFileSync(payload, 'utf8'))).toEqual({ ref: 'main', inputs: { request: batchSource(12), request_digest: sha256(parseRepositoryMaintenanceRequest(batchSource(12))), execution_digest: sha256({ requestDigest: sha256(parseRepositoryMaintenanceRequest(batchSource(12))), resumeReceipt: null }), resume_receipt: '' } });
    const calls = readFileSync(log, 'utf8');
    expect(calls.trim().split('\n')).toHaveLength(4);
    expect(calls).not.toContain('/issues');
    expect(calls).toContain('/actions/workflows/repository-maintenance.yml/dispatches');
    writeFileSync(log, '');
    const uncertain = run(true);
    expect(uncertain.status).not.toBe(0);
    expect(uncertain.stderr).toContain('outcome is unknown; do not resend');
    expect(readFileSync(log, 'utf8').match(/--method POST/gu)).toHaveLength(1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});


test('v4 reviews belong only to immutable v2 plans; legacy comments remain readable', () => {
  const request = JSON.parse(batchSource());
  request.operations[0].retirement = {
    classification: 'reviewed-plan-superseded', branches: ['fix/old-0'], expectedHeadSha: 'b'.repeat(40),
    review: { kind: 'branch-supersession-review', version: 4, repository: 'sec-platform/sec',
      branch: 'fix/old-0', headSha: 'b'.repeat(40), headTreeSha: 'c'.repeat(40),
      currentMainSha: MAIN, currentMainTreeSha: 'd'.repeat(40), mergeBaseSha: 'e'.repeat(40),
      mergeBaseTreeSha: 'f'.repeat(40), reviewer: 'Review explanation, not an authenticated actor',
      verdict: 'approved', sourcePathSet: { count: 1, digest: 'sha256:' + '1'.repeat(64) },
      assessment: 'Exact source disposition adopted by the authenticated plan maintainer.', unknowns: [] }
  };
  expect(parseRepositoryMaintenanceRequest(JSON.stringify(request)).operations).toHaveLength(1);
  request.schema = 'sec-repository-maintenance-request-v1';
  expect(() => parseRepositoryMaintenanceRequest(JSON.stringify(request))).toThrow('require a v2 batch');
  const legacy = JSON.parse(requestSource());
  legacy.schema = 'sec-repository-maintenance-request-v2';
  legacy.operations[0].retirement = { classification: 'reviewed-superseded', branches: ['fix/old-0'],
    expectedHeadSha: 'b'.repeat(40), reviewIssueNumber: 313, reviewCommentId: 42 };
  expect(() => parseRepositoryMaintenanceRequest(JSON.stringify(legacy))).toThrow('not mutable comment reviews');
});


test('dispatch input ownership rejects linked ancestors and leaves, special files and oversized request or resume before gh', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'maintenance-input-'));
  try {
    const log = path.join(root, 'calls');
    const gh = path.join(root, 'gh');
    writeFileSync(gh, '#!/bin/sh\necho called >> "$DISPATCH_LOG"\nexit 99\n');
    chmodSync(gh, 0o755);
    const ordinary = path.join(root, 'ordinary');
    mkdirSync(ordinary);
    const request = path.join(ordinary, 'request.json');
    writeFileSync(request, batchSource());
    const leafLink = path.join(root, 'leaf.json');
    symlinkSync(request, leafLink);
    const parentLink = path.join(root, 'parent');
    symlinkSync(ordinary, parentLink);
    const oversized = path.join(root, 'oversized.json');
    writeFileSync(oversized, '');
    truncateSync(oversized, 128 * 1024 * 1024);
    const invalidUtf8 = path.join(root, 'invalid.json');
    writeFileSync(invalidUtf8, Buffer.from([0xff]));
    const fifo = path.join(root, 'fifo');
    expect(spawnSync('mkfifo', [fifo]).status).toBe(0);
    const cli = path.resolve(import.meta.dir, '../../src/adapters/self-hosting/control/repository-maintenance/dispatch.ts');
    for (const input of [leafLink, path.join(parentLink, 'request.json'), ordinary, oversized, invalidUtf8, fifo]) {
      const result = spawnSync(process.execPath, [cli, '--repository', 'sec-platform/sec', '--request', input], {
        timeout: 5_000, encoding: 'utf8', env: { ...process.env, PATH: root + path.delimiter + process.env.PATH, DISPATCH_LOG: log }
      });
      expect(result.error).toBeUndefined();
      expect(result.status).not.toBe(0);
      expect(existsSync(log)).toBe(false);
    }
    const resume = path.join(root, 'resume.json');
    writeFileSync(resume, ' '.repeat(1025));
    const result = spawnSync(process.execPath, [cli, '--repository', 'sec-platform/sec', '--request', request, '--resume-receipt', resume], {
      timeout: 5_000, encoding: 'utf8', env: { ...process.env, PATH: root + path.delimiter + process.env.PATH, DISPATCH_LOG: log }
    });
    expect(result.status).not.toBe(0);
    expect(existsSync(log)).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});


test('the physical bounded reader rejects growth after its initial size observation', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'maintenance-input-growth-'));
  const file = path.join(root, 'request.json');
  writeFileSync(file, '{}');
  const fd = openSync(file, 'r');
  try {
    let observations = 0;
    expect(() => readLinuxRetainedFile(fd, 'maintenance request growth fixture', 8, () => {
      observations += 1;
      if (observations === 2) appendFileSync(file, ' '.repeat(9));
    })).toThrow('bounded no-follow read size');
    expect(observations).toBeGreaterThanOrEqual(2);
  } finally { closeSync(fd); rmSync(root, { recursive: true, force: true }); }
});


test('unsupported file-input platforms fail explicitly without changing no-file CLI validation', () => {
  const cli = path.resolve(import.meta.dir, '../../src/adapters/self-hosting/control/repository-maintenance/dispatch.ts');
  const source = `
    const { repositoryMaintenanceDispatchCli } = await import(${JSON.stringify(cli)});
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const messages = [];
    for (const argv of [[], ['--repository', 'sec-platform/sec', '--request', 'request.json']]) {
      try { repositoryMaintenanceDispatchCli(argv); } catch (error) { messages.push(error.message); }
    }
    console.log(JSON.stringify(messages));
  `;
  const child = spawnSync(process.execPath, ['--eval', source], { encoding: 'utf8', timeout: 5_000 });
  expect(child.status).toBe(0);
  const messages = JSON.parse(child.stdout);
  expect(messages[0]).toContain('usage:');
  expect(messages[0]).not.toContain('unsupported');
  expect(messages[1]).toContain('file input is unsupported on darwin');
});
