import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  createSecAgentOperationActivationPreparationV1,
  createSecAgentOperationActivationProviderV1,
  createSecAgentOperationActivationPublicationV1,
  createSecAgentOperationActivationReceiptV1,
  createSecAgentOperationActivationRequestV1,
  parseSecAgentOperationActivationPreparationV1,
  parseSecAgentOperationActivationPublicationCommentV1,
  parseSecAgentOperationActivationReceiptV1,
  renderSecAgentOperationActivationPublicationCommentV1,
  secAgentOperationActivationArtifactNameV1,
  secAgentOperationActivationOperationIdV1,
  type SecAgentOperationActivationPreparationInputV1,
  type SecAgentOperationActivationProviderV1,
  type SecAgentOperationActivationRequestV1
} from '../../platform/shared/agent-operation-activation-contract.ts';
import {
  assertAgentOperationActivationWorkPackageCensusV1
} from '../../scripts/codex/agent-operation-activation-census.ts';

const sha = (character: string): string => character.repeat(40);
const digest = (character: string): `sha256:${string}` => `sha256:${character.repeat(64)}`;
const ROOT = path.resolve(import.meta.dir, '../..');

function provider(runId: string, workflowSha = sha('a')): SecAgentOperationActivationProviderV1 {
  return createSecAgentOperationActivationProviderV1({
    repositoryId: '123',
    workflowPath: '.github/workflows/compiler-pr-validation.yml',
    workflowRef: `.github/workflows/compiler-pr-validation.yml@${workflowSha}`,
    workflowSha,
    runId,
    runAttempt: 1,
    eventName: 'repository_dispatch',
    jobName: 'agent-operation-activation',
    uploadStepName: 'Upload exact Agent operation activation receipt',
    publicationStepName: 'Publish exact Agent operation activation receipt',
    actorLogin: 'qzcrane',
    actorNodeId: 'MDQ6VXNlcjEyMw==',
    actorPermission: 'admin'
  });
}

function prepareRequest(): SecAgentOperationActivationRequestV1 {
  return createSecAgentOperationActivationRequestV1({
    phase: 'prepare',
    pullRequestNumber: 400,
    expectedBaseSha: sha('a'),
    expectedHeadSha: sha('c'),
    manifestPath: 'docs/work-packages/delegation-consumer-zero-retirement-v1.md',
    manifestDigest: digest('2'),
    preparationCommentId: null
  });
}

function preparationInput(): SecAgentOperationActivationPreparationInputV1 {
  const request = prepareRequest();
  return {
    request,
    repository: 'sec-platform/sec',
    workId: 'issue-275',
    currentSpecRef: 'github:issue/275',
    currentSpecRevision: digest('1'),
    trustedBaseSha: sha('a'),
    trustedBaseTreeSha: sha('b'),
    proposal: {
      number: 400,
      baseSha: sha('a'),
      headSha: sha('c'),
      headTreeSha: sha('d'),
      headRef: 'codex/delegation-consumer-zero-retirement-v1',
      manifestPath: request.manifestPath,
      manifestDigest: request.manifestDigest
    },
    controlDigests: {
      currentState: digest('3'),
      pointer: digest('4'),
      rollingPlan: digest('5')
    },
    authorizedPaths: [
      'docs/work/active-work-package.md',
      'docs/work/rolling-plan.md',
      'docs/work-packages/delegation-consumer-zero-retirement-v1.md',
      'platform/shared/agent-task-capsule-contract.ts',
      'scripts/codex/'
    ],
    forbiddenPaths: ['source/'],
    proposalChangedPaths: [
      'docs/work/active-work-package.md',
      'docs/work/rolling-plan.md',
      'docs/work-packages/delegation-consumer-zero-retirement-v1.md'
    ],
    operationId: secAgentOperationActivationOperationIdV1(request.requestOperationId),
    role: 'worker',
    operationKind: 'implement',
    availableCapabilities: ['git'],
    workDecisionReceiptDigest: digest('6'),
    workDecisionDecisionDigest: digest('7'),
    provider: provider('11')
  };
}

function workPackageManifest(packageId: string, tracking: string): Buffer {
  return Buffer.from(`---
schema: codex-development-work-package-v1
id: ${packageId}
tracking: ${tracking}
base: "${sha('a')}"
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: fixture-task
    owner: development-governance-owner
    ownedPaths:
      - docs/work-packages/${packageId}.md
forbiddenPaths:
  - platform/compiler/
acceptance:
  - exact package census fixture
tests:
  - tests/unit/agent-operation-activation.test.ts
---
`, 'utf8');
}

test('hosted PRE is canonical and binds request, provider, and full manifest scope', () => {
  const first = createSecAgentOperationActivationPreparationV1(preparationInput());
  const second = createSecAgentOperationActivationPreparationV1({
    ...preparationInput(),
    authorizedPaths: [...preparationInput().authorizedPaths].reverse(),
    proposalChangedPaths: [...preparationInput().proposalChangedPaths].reverse()
  });
  expect(second).toEqual(first);
  expect(parseSecAgentOperationActivationPreparationV1(
    JSON.parse(JSON.stringify(first))
  )).toEqual(first);
  expect(() => createSecAgentOperationActivationPreparationV1({
    ...preparationInput(),
    proposalChangedPaths: ['source/forbidden.ts']
  })).toThrow(/scope is inconsistent/u);
  expect(() => createSecAgentOperationActivationPreparationV1({
    ...preparationInput(),
    provider: provider('11', sha('e'))
  })).toThrow(/scope is inconsistent/u);
});

test('hosted PRE requires every stale default-branch Work Package to be deleted', () => {
  const selectedPath = 'docs/work-packages/selected-v1.md';
  const predecessorPath = 'docs/work-packages/predecessor-v1.md';
  const selectedBytes = workPackageManifest('selected-v1', 'issue-999');
  const predecessorBytes = workPackageManifest('predecessor-v1', 'issue-998');
  expect(assertAgentOperationActivationWorkPackageCensusV1({
    selectedManifestPath: selectedPath,
    candidateEntries: [{ path: selectedPath, candidateBytes: selectedBytes, defaultBytes: null }],
    defaultPackagePaths: [predecessorPath]
  })).toEqual([predecessorPath]);
  expect(() => assertAgentOperationActivationWorkPackageCensusV1({
    selectedManifestPath: selectedPath,
    candidateEntries: [
      { path: selectedPath, candidateBytes: selectedBytes, defaultBytes: null },
      { path: predecessorPath, candidateBytes: predecessorBytes, defaultBytes: predecessorBytes }
    ],
    defaultPackagePaths: [predecessorPath]
  })).toThrow(/not activatable/u);
});

test('FINAL binds a distinct request, exact PRE comment, PR identity, and PRE scope', () => {
  const preparation = createSecAgentOperationActivationPreparationV1(preparationInput());
  const request = createSecAgentOperationActivationRequestV1({
    phase: 'finalize',
    pullRequestNumber: preparation.proposal.number,
    expectedBaseSha: preparation.trustedBaseSha,
    expectedHeadSha: sha('e'),
    manifestPath: preparation.proposal.manifestPath,
    manifestDigest: preparation.proposal.manifestDigest,
    preparationCommentId: 501
  });
  const receipt = createSecAgentOperationActivationReceiptV1({
    request,
    preparation,
    pullRequest: {
      ...preparation.proposal,
      headSha: request.expectedHeadSha,
      headTreeSha: sha('f')
    },
    controlDigests: preparation.controlDigests,
    changedPaths: [
      'docs/work/active-work-package.md',
      'scripts/codex/task-capsule.ts'
    ],
    workDecisionReceiptDigest: digest('8'),
    workDecisionDecisionDigest: digest('9'),
    provider: provider('12')
  });
  expect(parseSecAgentOperationActivationReceiptV1(
    JSON.parse(JSON.stringify(receipt))
  )).toEqual(receipt);
  const { schema: _receiptSchema, activationDigest: _activationDigest, ...receiptInput } = receipt;
  expect(() => createSecAgentOperationActivationReceiptV1({
    ...receiptInput,
    changedPaths: ['source/forbidden.ts']
  })).toThrow(/exact PRE authority/u);
  expect(() => createSecAgentOperationActivationReceiptV1({
    ...receiptInput,
    controlDigests: { ...preparation.controlDigests, rollingPlan: digest('f') }
  })).toThrow(/exact PRE authority/u);
});

test('App comment is only a canonical immutable-artifact locator', () => {
  const request = prepareRequest();
  const publication = createSecAgentOperationActivationPublicationV1({
    request,
    payloadDigest: digest('a'),
    artifactId: '9001',
    artifactName: secAgentOperationActivationArtifactNameV1(
      request.phase, request.requestOperationId
    ),
    artifactFileName: 'agent-operation-activation.json',
    artifactDigest: digest('b'),
    provider: provider('11')
  });
  const rendered = renderSecAgentOperationActivationPublicationCommentV1(publication);
  expect(parseSecAgentOperationActivationPublicationCommentV1(rendered)).toEqual(publication);
  expect(rendered).not.toContain('authorizedPaths');
  const { schema: _publicationSchema, publicationDigest: _publicationDigest, ...publicationInput } = publication;
  expect(() => createSecAgentOperationActivationPublicationV1({
    ...publicationInput,
    artifactName: 'candidate-local-ref'
  })).toThrow(/artifact name/u);
});

test('candidate-local objects cannot satisfy the hosted provider schema', () => {
  const { schema: _providerSchema, providerDigest: _providerDigest, ...providerInput } = provider('11');
  expect(() => createSecAgentOperationActivationProviderV1({
    ...providerInput,
    workflowPath: '.github/workflows/candidate.yml',
    workflowRef: `.github/workflows/candidate.yml@${sha('a')}`
  } as never)).toThrow(/provider workflow/u);
  const { schema: _requestSchema, requestOperationId: _requestOperationId, ...requestInput } = prepareRequest();
  expect(() => createSecAgentOperationActivationRequestV1({
    ...requestInput,
    phase: 'finalize',
    preparationCommentId: null
  })).toThrow(/finalize requires/u);
});

test('public activation CLI derives identity and exposes no local credential writer', () => {
  const source = readFileSync(
    path.join(ROOT, 'scripts/codex/agent-operation-activation.ts'),
    'utf8'
  );
  expect(source).toContain("subcommand === 'request'");
  expect(source).toContain("subcommand === 'observe'");
  expect(source).toContain("subcommand === 'produce-hosted'");
  expect(source).toContain("subcommand === 'publish-hosted'");
  expect(source).not.toContain("'hash-object'");
  expect(source).not.toContain("'update-ref'");
  expect(source).not.toContain("'--manifest-digest'");
  expect(source).not.toContain("'preparation-comment'");
  expect(source.match(/resolveMaximalPreparationV1\(/gu)?.length).toBe(4);
  expect(source).toContain('const maximal = candidates.filter');
  expect(source).toContain('caller-selected-PRE-is-not-unique-maximal-ancestor');
  expect(source).toContain('FINAL-consumer-PRE-is-not-unique-maximal-ancestor');
  expect(source).toContain('rebindPayloadProvider(value, existing.publication.provider)');
  expect(source).not.toContain('canonicalEqual(payload, value)');
  expect(source).toContain("'api', '--method', 'POST', `/repos/${repository}/issues/${request.pullRequestNumber}/comments`");
  expect(source).toContain('created.body !== body || !hostedPublisherMatches(created)');
  expect(source).not.toContain("'run', 'download'");
  expect(source).toContain('/actions/artifacts/${publication.artifactId}/zip');
  expect(source).toContain('rawSha256(archiveBytes) !== publication.artifactDigest');
  expect(source).toContain('gitTree(candidateRoot, request.expectedHeadSha) !== entries[0]!.headTreeSha');
  expect(source).toContain('PRE-consumer-stable-fact-rederivation-drift');
  expect(source).toContain('FINAL-consumer-whole-value-rederivation-drift');
  expect(source).toContain('preparationWorkPackageDeletions(');
  expect(source).not.toContain('predecessor-manifest-not-retired');
  expect(source).not.toContain('requireCompletedPublication');
  expect(source).not.toContain('console.error(error instanceof Error');
  expect(source).toContain("new SecAgentOperationActivationUnavailableError(\n          'activation-issuer-unavailable'");
  expect(source).toContain("phase: 'prepare',\n      preparation,\n      receipt: null");
  expect(source).toContain("phase: 'finalize',\n    preparation: receipt.preparation");
  expect(source).toContain('metadata.expired !== false');
  expect(source).toContain("String(workflowRun.repository_id ?? '') !== publication.provider.repositoryId");
  expect(source).toContain("unavailable('activation-provider-readback-conflict', repoObservation.bytes)");
  expect(source).toContain("unavailable('activation-provider-readback-conflict', jobsBytes)");
  expect(source).toContain('const manifestBlob = readGitBlob(candidateRoot, `${revision}:${pointer.manifest}`)');
  expect(source).toContain('manifestRevision: manifestBlob.oid');
  expect(source.match(/manifestRevision: control\.manifestRevision/gu)?.length).toBe(2);
  const markerFilter = source.indexOf('comment.body.includes(SEC_AGENT_OPERATION_ACTIVATION_COMMENT_MARKER)');
  const publisherFilter = source.indexOf('hostedPublisherMatches(comment)', markerFilter);
  const markerParser = source.indexOf('parseSecAgentOperationActivationPublicationCommentV1(comment.body)', publisherFilter);
  expect(markerFilter).toBeGreaterThan(-1);
  expect(publisherFilter).toBeGreaterThan(markerFilter);
  expect(markerParser).toBeGreaterThan(publisherFilter);
});
