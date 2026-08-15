import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dir, '../..');

test('legacy merge bootstrap entrypoints are retired', () => {
  for (const filePath of [
    'scripts/codex/sec-merge-bootstrap-contract.ts',
    'scripts/codex/sec-merge-bootstrap-runtime.ts',
    'scripts/codex/sec-merge-bootstrap.ts'
  ]) {
    expect(existsSync(path.join(ROOT, filePath))).toBe(false);
  }
});

test('only the hosted Session CLI private boundary contains merge and leased closeout mutations', () => {
  const githubSource = readFileSync(
    path.join(ROOT, 'scripts/codex/verification-session-github.ts'),
    'utf8'
  );
  const cliSource = readFileSync(
    path.join(ROOT, 'scripts/codex/verification-session.ts'),
    'utf8'
  );
  const authorizationPublicationSource = readFileSync(
    path.join(ROOT, 'scripts/codex/integration-authorization-publication.ts'),
    'utf8'
  );
  expect(githubSource).not.toContain("'pr', 'merge'");
  expect(githubSource).not.toContain('executeVerifiedIntegration');
  expect(githubSource).not.toContain('mergeExactHead(');
  expect(githubSource).not.toContain('force-with-lease');
  expect(githubSource).not.toContain("'update-ref'");

  expect(cliSource).not.toContain("'pr', 'merge'");
  expect(cliSource).not.toContain('/merge-async');
  expect((cliSource.match(/function executeHostedSquashMerge\(/gu) ?? [])).toHaveLength(1);
  expect(cliSource).not.toContain('export function executeHostedSquashMerge');
  const mergeExecutorStart = cliSource.indexOf('function executeHostedSquashMerge(');
  const mergeExecutorEnd = cliSource.indexOf('\nconst USAGE =', mergeExecutorStart);
  expect(mergeExecutorStart).toBeGreaterThan(0);
  expect(mergeExecutorEnd).toBeGreaterThan(mergeExecutorStart);
  const mergeExecutor = cliSource.slice(mergeExecutorStart, mergeExecutorEnd);
  expect((mergeExecutor.match(/'--method', 'PUT'/gu) ?? [])).toHaveLength(1);
  expect((mergeExecutor.match(/\/pulls\/\$\{input\.prNumber\}\/merge/gu) ?? [])).toHaveLength(1);
  expect(mergeExecutor).toContain("'--input', '-'");
  expect(mergeExecutor).toContain('sha: input.headSha');
  expect(mergeExecutor).toContain("merge_method: 'squash'");
  expect(mergeExecutor).toContain('commit_message: markers.join');
  expect(mergeExecutor).toContain('if (result.status !== 0)');

  expect(authorizationPublicationSource)
    .not.toContain('export function publishAndReadBackIntegrationAuthorizationOperationV1');
  expect(authorizationPublicationSource).not.toContain('runBranchCommand(');
  expect(authorizationPublicationSource).not.toContain("'-X', 'POST'");
  expect((cliSource.match(/function publishHostedIntegrationAuthorizationOperationV1\(/gu) ?? []))
    .toHaveLength(1);
  expect((cliSource.match(/publishHostedIntegrationAuthorizationOperationV1\(/gu) ?? []))
    .toHaveLength(2);
  expect(cliSource).not.toContain('export function publishHostedIntegrationAuthorizationOperationV1');
  const authorizationPublisherStart = cliSource.indexOf(
    'function publishHostedIntegrationAuthorizationOperationV1('
  );
  const authorizationPublisherEnd = cliSource.indexOf(
    '\nfunction executeHostedSquashMerge(',
    authorizationPublisherStart
  );
  expect(authorizationPublisherStart).toBeGreaterThan(0);
  expect(authorizationPublisherEnd).toBeGreaterThan(authorizationPublisherStart);
  const authorizationPublisher = cliSource.slice(
    authorizationPublisherStart,
    authorizationPublisherEnd
  );
  expect((authorizationPublisher.match(/'-X', 'POST'/gu) ?? [])).toHaveLength(1);
  expect(authorizationPublisher).toContain('readBackHostedIntegrationAuthorizationCommentV1');
  expect(authorizationPublisher).toContain('observeIntegrationAuthorizationOperationPublicationsV1');

  expect((cliSource.match(/function deleteHostedRemoteRefCas\(/gu) ?? [])).toHaveLength(1);
  expect(cliSource).not.toContain('export function deleteHostedRemoteRefCas');
  const remoteDeleteStart = cliSource.indexOf('function deleteHostedRemoteRefCas(');
  const remoteDeleteEnd = cliSource.indexOf('\nfunction deleteHostedLocalRefCas(', remoteDeleteStart);
  expect(remoteDeleteStart).toBeGreaterThan(0);
  expect(remoteDeleteEnd).toBeGreaterThan(remoteDeleteStart);
  const remoteDeleteSource = cliSource.slice(remoteDeleteStart, remoteDeleteEnd);
  const credentialPrefixIndex = remoteDeleteSource.indexOf(
    '...createBranchLifecycleGitHubCredentialArgsV1()'
  );
  const pushIndex = remoteDeleteSource.indexOf("'push'");
  expect(credentialPrefixIndex).toBeGreaterThan(0);
  expect(pushIndex).toBeGreaterThan(credentialPrefixIndex);
  expect(remoteDeleteSource).not.toMatch(/\b(?:GH_TOKEN|GITHUB_TOKEN|x-access-token)\b/u);
  expect(remoteDeleteSource).not.toContain("'config'");
  expect((cliSource.match(/--force-with-lease=/gu) ?? [])).toHaveLength(1);
  expect(cliSource).toContain(
    '`--force-with-lease=refs/heads/${preparation.branch}:${preparation.expectedRemoteSha}`'
  );
  expect((cliSource.match(/`:refs\/heads\/\$\{preparation\.branch\}`/gu) ?? []))
    .toHaveLength(1);

  const dispatchParserStart = cliSource.indexOf('function unwrapHostedCompilerDispatchPayloadV1(');
  const dispatchParserEnd = cliSource.indexOf('\nfunction assertGitHubIdentityRecord(', dispatchParserStart);
  expect(dispatchParserStart).toBeGreaterThan(0);
  expect(dispatchParserEnd).toBeGreaterThan(dispatchParserStart);
  const dispatchParserSource = cliSource.slice(dispatchParserStart, dispatchParserEnd);
  expect(dispatchParserSource).toContain("keys.length !== 1 || keys[0] !== 'payload'");
  expect(dispatchParserSource).toContain(
    'const payload = unwrapHostedCompilerDispatchPayloadV1(clientPayload);'
  );
  expect(dispatchParserSource).toContain('parseCiVerificationActionProviderEnvelopeV2(payload)');
  expect(dispatchParserSource).not.toContain('parseCiVerificationActionProviderEnvelopeV2(clientPayload)');

  expect((cliSource.match(/function deleteHostedLocalRefCas\(/gu) ?? [])).toHaveLength(1);
  expect(cliSource).not.toContain('export function deleteHostedLocalRefCas');
  expect((cliSource.match(/'update-ref', '-d'/gu) ?? [])).toHaveLength(1);
  expect(cliSource).toContain(
    "'update-ref', '-d', `refs/heads/${preparation.branch}`, expected"
  );

  for (const source of [githubSource, cliSource]) {
    expect(source).not.toContain("'--admin'");
    expect(source).not.toContain('ensureSingleParent');
    expect(source).not.toContain('shouldSquashToSingleParent');
    expect(source).not.toContain("'commit-tree'");
    expect(source).not.toContain("'reset', '--hard'");
    expect(source).not.toContain("'push', '--force'");
  }
});
