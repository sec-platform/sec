import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  assertAgentOperationActivationTestCensus,
  assertAgentOperationActivationWorkPackageCensus
} from '../../src/adapters/self-hosting/control/agent/agent-operation-activation-census.ts';
import {
  createActivationPreparation,
  createActivationProvider,
  createActivationPublication,
  createActivationReceipt,
  createActivationRequest,
  parseActivationPreparation,
  parseActivationPublicationComment,
  parseActivationReceipt,
  renderActivationPublicationComment,
  secAgentOperationActivationArtifactName,
  secAgentOperationActivationOperationId,
  type ActivationPreparationInput,
  type ActivationProvider,
  type ActivationRequest
} from '../../src/adapters/self-hosting/control/agent/operation-activation.ts';

const sha = (character: string): string => character.repeat(40);
const digest = (character: string): `sha256:${string}` => `sha256:${character.repeat(64)}`;

test('activation test census accepts colocated regular blobs and rejects non-file or incomplete evidence', () => {
  const paths = ['src/adapters/self-hosting/control/agent/行为.test.ts', 'tests/unit/example.spec.ts'];
  const records = [
    `100644 blob ${sha('a')}\t${paths[0]}\0`,
    `100755 blob ${sha('b')}\t${paths[1]}\0`
  ];
  const bytes = Buffer.from(records.join(''));
  expect(() => assertAgentOperationActivationTestCensus(paths, bytes)).not.toThrow();
  for (const [mode, kind] of [['120000', 'blob'], ['160000', 'commit'], ['040000', 'tree']]) {
    expect(() => assertAgentOperationActivationTestCensus(paths, Buffer.from(
      `100644 blob ${sha('a')}\t${paths[0]}\0${mode} ${kind} ${sha('b')}\t${paths[1]}\0`
    ))).toThrow(/work-package-test-blobs-missing/u);
  }
  expect(() => assertAgentOperationActivationTestCensus(paths, Buffer.from(records[0]!)))
    .toThrow(/work-package-test-blobs-missing/u);
  for (const invalid of [Buffer.alloc(0), bytes.subarray(0, -1)]) {
    expect(() => assertAgentOperationActivationTestCensus(paths, invalid)).toThrow(/unterminated/u);
  }
  for (const invalid of [Buffer.from('invalid\0'), Buffer.from(records.join('') + records[0])]) {
    expect(() => assertAgentOperationActivationTestCensus(paths, invalid)).toThrow(/malformed/u);
  }
});

function provider(runId: string, workflowSha = sha('a')): ActivationProvider {
  return createActivationProvider({
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

function prepareRequest(): ActivationRequest {
  return createActivationRequest({
    phase: 'prepare',
    pullRequestNumber: 400,
    expectedBaseSha: sha('a'),
    expectedHeadSha: sha('c'),
    manifestPath: 'config/repository/work-packages/delegation-consumer-zero-retirement-v1.md',
    manifestDigest: digest('2'),
    preparationCommentId: null
  });
}

function preparationInput(): ActivationPreparationInput {
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
      'config/repository/active-work-package.md',
      'config/repository/rolling-plan.md',
      'config/repository/work-packages/delegation-consumer-zero-retirement-v1.md',
      'src/adapters/self-hosting/control/agent/task-capsule-host.ts',
      'src/adapters/self-hosting/control/agent/task-capsule.ts',
      'scripts/codex/'
    ],
    forbiddenPaths: ['source/'],
    proposalChangedPaths: [
      'config/repository/active-work-package.md',
      'config/repository/rolling-plan.md',
      'config/repository/work-packages/delegation-consumer-zero-retirement-v1.md'
    ],
    operationId: secAgentOperationActivationOperationId(request.requestOperationId),
    role: 'worker',
    operationKind: 'implement',
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
      - config/repository/work-packages/${packageId}.md
forbiddenPaths:
  - src/compiler/
acceptance:
  - exact package census fixture
tests:
  - tests/unit/agent-operation-activation.test.ts
---
`, 'utf8');
}

test('hosted PRE is canonical and binds request, provider, and full manifest scope', () => {
  const first = createActivationPreparation(preparationInput());
  const second = createActivationPreparation({
    ...preparationInput(),
    authorizedPaths: [...preparationInput().authorizedPaths].reverse(),
    proposalChangedPaths: [...preparationInput().proposalChangedPaths].reverse()
  });
  expect(second).toEqual(first);
  expect(parseActivationPreparation(
    JSON.parse(JSON.stringify(first))
  )).toEqual(first);
  expect(() => createActivationPreparation({
    ...preparationInput(),
    proposalChangedPaths: ['source/forbidden.ts']
  })).toThrow(/scope is inconsistent/u);
  expect(() => createActivationPreparation({
    ...preparationInput(),
    provider: provider('11', sha('e'))
  })).toThrow(/scope is inconsistent/u);
});

test('hosted PRE requires every stale default-branch Work Package to be deleted', () => {
  const selectedPath = 'config/repository/work-packages/selected-v1.md';
  const predecessorPath = 'config/repository/work-packages/predecessor-v1.md';
  const selectedBytes = workPackageManifest('selected-v1', 'issue-999');
  const predecessorBytes = workPackageManifest('predecessor-v1', 'issue-998');
  expect(assertAgentOperationActivationWorkPackageCensus({
    selectedManifestPath: selectedPath,
    candidateEntries: [{ path: selectedPath, candidateBytes: selectedBytes, defaultBytes: null }],
    defaultPackagePaths: [predecessorPath]
  })).toEqual([predecessorPath]);
  expect(() => assertAgentOperationActivationWorkPackageCensus({
    selectedManifestPath: selectedPath,
    candidateEntries: [
      { path: selectedPath, candidateBytes: selectedBytes, defaultBytes: null },
      { path: predecessorPath, candidateBytes: predecessorBytes, defaultBytes: predecessorBytes }
    ],
    defaultPackagePaths: [predecessorPath]
  })).toThrow(/not activatable/u);
  for (const historicalOrFuture of ['ci-verification-v18', 'ci-verification-v20']) {
    expect(() => assertAgentOperationActivationWorkPackageCensus({
      selectedManifestPath: selectedPath,
      candidateEntries: [{
        path: selectedPath,
        candidateBytes: Buffer.from(selectedBytes.toString('utf8').replace(
          'ci-verification-v19', historicalOrFuture
        ), 'utf8'),
        defaultBytes: null
      }],
      defaultPackagePaths: []
    })).toThrow(/current CI verification revision/u);
  }
});

test('FINAL binds a distinct request, exact PRE comment, PR identity, and PRE scope', () => {
  const preparation = createActivationPreparation(preparationInput());
  const request = createActivationRequest({
    phase: 'finalize',
    pullRequestNumber: preparation.proposal.number,
    expectedBaseSha: preparation.trustedBaseSha,
    expectedHeadSha: sha('e'),
    manifestPath: preparation.proposal.manifestPath,
    manifestDigest: preparation.proposal.manifestDigest,
    preparationCommentId: 501
  });
  const receipt = createActivationReceipt({
    request,
    preparation,
    pullRequest: {
      ...preparation.proposal,
      headSha: request.expectedHeadSha,
      headTreeSha: sha('f')
    },
    controlDigests: preparation.controlDigests,
    changedPaths: [
      'config/repository/active-work-package.md',
      'src/adapters/self-hosting/control/agent/task-capsule-host.ts'
    ],
    workDecisionReceiptDigest: digest('8'),
    workDecisionDecisionDigest: digest('9'),
    provider: provider('12')
  });
  expect(parseActivationReceipt(
    JSON.parse(JSON.stringify(receipt))
  )).toEqual(receipt);
  const { schema: _receiptSchema, activationDigest: _activationDigest, ...receiptInput } = receipt;
  expect(() => createActivationReceipt({
    ...receiptInput,
    changedPaths: ['source/forbidden.ts']
  })).toThrow(/exact PRE authority/u);
  expect(() => createActivationReceipt({
    ...receiptInput,
    controlDigests: { ...preparation.controlDigests, rollingPlan: digest('f') }
  })).toThrow(/exact PRE authority/u);
});

test('App comment is only a canonical immutable-artifact locator', () => {
  const request = prepareRequest();
  const publication = createActivationPublication({
    request,
    payloadDigest: digest('a'),
    artifactId: '9001',
    artifactName: secAgentOperationActivationArtifactName(
      request.phase, request.requestOperationId
    ),
    artifactFileName: 'agent-operation-activation.json',
    artifactDigest: digest('b'),
    provider: provider('11')
  });
  const rendered = renderActivationPublicationComment(publication);
  expect(parseActivationPublicationComment(rendered)).toEqual(publication);
  expect(rendered).not.toContain('authorizedPaths');
  const { schema: _publicationSchema, publicationDigest: _publicationDigest, ...publicationInput } = publication;
  expect(() => createActivationPublication({
    ...publicationInput,
    artifactName: 'candidate-local-ref'
  })).toThrow(/artifact name/u);
});

test('candidate-local objects cannot satisfy the hosted provider schema', () => {
  const { schema: _providerSchema, providerDigest: _providerDigest, ...providerInput } = provider('11');
  expect(() => createActivationProvider({
    ...providerInput,
    workflowPath: '.github/workflows/candidate.yml',
    workflowRef: `.github/workflows/candidate.yml@${sha('a')}`
  } as never)).toThrow(/provider workflow/u);
  const { schema: _requestSchema, requestOperationId: _requestOperationId, ...requestInput } = prepareRequest();
  expect(() => createActivationRequest({
    ...requestInput,
    phase: 'finalize',
    preparationCommentId: null
  })).toThrow(/finalize requires/u);
});

test.skipIf(process.platform !== 'win32')('Windows activation fails closed before fake PATH Git or GitHub children and ambient CLI state', () => {
  const binHome = mkdtempSync(path.join(tmpdir(), 'sec-agent-activation-fake-cli-'));
  const gitExecutionSentinel = path.join(binHome, 'git-executed.txt');
  const ghExecutionSentinel = path.join(binHome, 'gh-executed.txt');
  const installFake = (name: string, sentinel: string): void => {
    writeFileSync(path.join(binHome, `${name}.cmd`), [
      '@echo off',
      `echo executed>"${sentinel}"`,
      ''
    ].join('\r\n'), 'utf8');
  };
  installFake('git', gitExecutionSentinel);
  installFake('gh', ghExecutionSentinel);

  try {
    const runner = path.resolve(import.meta.dir, '../../src/adapters/self-hosting/control/agent/agent-operation-activation.ts');
    const result = spawnSync(process.execPath, [
      runner,
      'request',
      '--phase', 'prepare',
      '--candidate-root', process.cwd(),
      '--json'
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
      windowsHide: true,
      env: {
        ...process.env,
        PATH: binHome,
        GIT_CONFIG: path.join(binHome, 'ambient-git-config'),
        GIT_DIR: path.join(binHome, 'ambient-git-dir'),
        GH_HOST: 'evil.example.invalid',
        GH_TOKEN: 'ambient-token-must-not-be-consumed'
      }
    });

    expect(result.status).not.toBe(0);
    expect(JSON.parse(result.stderr)).toMatchObject({
      schema: 'sec-agent-operation-activation-blocked-v1',
      reasonCode: 'activation-provider-unavailable'
    });
    expect(existsSync(gitExecutionSentinel)).toBe(false);
    expect(existsSync(ghExecutionSentinel)).toBe(false);
  } finally {
    rmSync(binHome, { recursive: true, force: true });
  }
});
