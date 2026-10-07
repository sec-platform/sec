import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { observeOperationAuthorityOwners, resolveSecAgentOperationActivation } from '../../src/adapters/self-hosting/control/agent/agent-operation-activation.ts';
import { CodexDevelopmentParseCurrentWorkPackageManifest } from '../../src/adapters/self-hosting/control/task/contract/work-package.ts';
import { rawSha256 } from '../../src/contracts/canonical.ts';
import { gitProtocolSuccess, inGitProtocolRepository } from '../testkit/git-protocol.ts';

import {
  assertAgentOperationActivationTestCensus,
  assertAgentOperationActivationWorkPackageCensus
} from '../../src/adapters/self-hosting/control/agent/agent-operation-activation-census.ts';
import {
  createSecAgentOperationActivationPreparation,
  createSecAgentOperationActivationProvider,
  createSecAgentOperationActivationPublication,
  createSecAgentOperationActivationReceipt,
  createSecAgentOperationActivationRequest,
  parseSecAgentOperationActivationPreparation,
  parseSecAgentOperationActivationPublicationComment,
  parseSecAgentOperationActivationReceipt,
  renderSecAgentOperationActivationPublicationComment,
  secAgentOperationActivationArtifactName,
  secAgentOperationActivationOperationId,
  type SecAgentOperationActivationPreparationInput,
  type SecAgentOperationActivationProvider,
  type SecAgentOperationActivationRequest
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

function provider(runId: string, workflowSha = sha('a')): SecAgentOperationActivationProvider {
  return createSecAgentOperationActivationProvider({
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

function prepareRequest(): SecAgentOperationActivationRequest {
  return createSecAgentOperationActivationRequest({
    phase: 'prepare',
    pullRequestNumber: 400,
    expectedBaseSha: sha('a'),
    expectedHeadSha: sha('c'),
    manifestPath: 'config/repository/work-packages/delegation-consumer-zero-retirement-v1.md',
    manifestDigest: digest('2'),
    preparationCommentId: null
  });
}

function preparationInput(): SecAgentOperationActivationPreparationInput {
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
  const first = createSecAgentOperationActivationPreparation(preparationInput());
  const second = createSecAgentOperationActivationPreparation({
    ...preparationInput(),
    authorizedPaths: [...preparationInput().authorizedPaths].reverse(),
    proposalChangedPaths: [...preparationInput().proposalChangedPaths].reverse()
  });
  expect(second).toEqual(first);
  expect(parseSecAgentOperationActivationPreparation(
    JSON.parse(JSON.stringify(first))
  )).toEqual(first);
  expect(() => createSecAgentOperationActivationPreparation({
    ...preparationInput(),
    proposalChangedPaths: ['source/forbidden.ts']
  })).toThrow(/scope is inconsistent/u);
  expect(() => createSecAgentOperationActivationPreparation({
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
  const preparation = createSecAgentOperationActivationPreparation(preparationInput());
  const request = createSecAgentOperationActivationRequest({
    phase: 'finalize',
    pullRequestNumber: preparation.proposal.number,
    expectedBaseSha: preparation.trustedBaseSha,
    expectedHeadSha: sha('e'),
    manifestPath: preparation.proposal.manifestPath,
    manifestDigest: preparation.proposal.manifestDigest,
    preparationCommentId: 501
  });
  const receipt = createSecAgentOperationActivationReceipt({
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
  expect(parseSecAgentOperationActivationReceipt(
    JSON.parse(JSON.stringify(receipt))
  )).toEqual(receipt);
  const { schema: _receiptSchema, activationDigest: _activationDigest, ...receiptInput } = receipt;
  expect(() => createSecAgentOperationActivationReceipt({
    ...receiptInput,
    changedPaths: ['source/forbidden.ts']
  })).toThrow(/exact PRE authority/u);
  expect(() => createSecAgentOperationActivationReceipt({
    ...receiptInput,
    controlDigests: { ...preparation.controlDigests, rollingPlan: digest('f') }
  })).toThrow(/exact PRE authority/u);
});

test('App comment is only a canonical immutable-artifact locator', () => {
  const request = prepareRequest();
  const publication = createSecAgentOperationActivationPublication({
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
  const rendered = renderSecAgentOperationActivationPublicationComment(publication);
  expect(parseSecAgentOperationActivationPublicationComment(rendered)).toEqual(publication);
  expect(rendered).not.toContain('authorizedPaths');
  const { schema: _publicationSchema, publicationDigest: _publicationDigest, ...publicationInput } = publication;
  expect(() => createSecAgentOperationActivationPublication({
    ...publicationInput,
    artifactName: 'candidate-local-ref'
  })).toThrow(/artifact name/u);
});

test('candidate-local objects cannot satisfy the hosted provider schema', () => {
  const { schema: _providerSchema, providerDigest: _providerDigest, ...providerInput } = provider('11');
  expect(() => createSecAgentOperationActivationProvider({
    ...providerInput,
    workflowPath: '.github/workflows/candidate.yml',
    workflowRef: `.github/workflows/candidate.yml@${sha('a')}`
  } as never)).toThrow(/provider workflow/u);
  const { schema: _requestSchema, requestOperationId: _requestOperationId, ...requestInput } = prepareRequest();
  expect(() => createSecAgentOperationActivationRequest({
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

test('V3 activation reader preserves exact trusted bytes and missing-ref rejection under ambient Git state', async () => {
  const guidance = 'docs/开发/AI协作/规则装载与任务恢复.md';
  const authorityId = 'urn:uuid:00000000-0000-4000-8000-000000000002';
  const source = workPackageManifest('reader-v3', 'issue-311').toString('utf8')
    .replace('codex-development-work-package-v1', 'codex-development-work-package-v3')
    .replace(`base: "${sha('a')}"\n`, '');
  const absentRefs = CodexDevelopmentParseCurrentWorkPackageManifest(source);
  const manifest = CodexDevelopmentParseCurrentWorkPackageManifest(source.replace(
    'tasks:', `authorityRefs:\n  - ${authorityId}\ntasks:`
  ));
  expect(assertAgentOperationActivationWorkPackageCensus({
    selectedManifestPath: 'config/repository/work-packages/reader-v3.md',
    candidateEntries: [{ path: 'config/repository/work-packages/reader-v3.md',
      candidateBytes: Buffer.from(source), defaultBytes: null }],
    defaultPackagePaths: ['config/repository/work-packages/old-v1.md']
  })).toEqual(['config/repository/work-packages/old-v1.md']);
  await inGitProtocolRepository(async (root, git) => {
    mkdirSync(path.join(root, '.documentation'), { recursive: true });
    mkdirSync(path.dirname(path.join(root, guidance)), { recursive: true });
    writeFileSync(path.join(root, '.documentation/documents.json'), JSON.stringify({
      schema: 'sec.documentation-identity/1', scope: 'Reader fixture', documents: [
        { document_id: 'urn:uuid:00000000-0000-4000-8000-000000000001', path: 'AGENTS.md' },
        { document_id: authorityId, path: guidance }
      ]
    }));
    writeFileSync(path.join(root, 'AGENTS.md'), 'Trusted entry\n');
    writeFileSync(path.join(root, guidance), 'Trusted owner\n');
    gitProtocolSuccess(git(['add', '.']));
    gitProtocolSuccess(git(['commit', '--quiet', '-m', 'trusted reader fixture']));
    const trusted = gitProtocolSuccess(git(['rev-parse', 'HEAD'])).trim();
    writeFileSync(path.join(root, guidance), 'Candidate owner\n');
    gitProtocolSuccess(git(['add', '.']));
    gitProtocolSuccess(git(['commit', '--quiet', '-m', 'candidate reader fixture']));
    const candidate = gitProtocolSuccess(git(['rev-parse', 'HEAD'])).trim();
    const trustedBlob = gitProtocolSuccess(git(['rev-parse', `${trusted}:${guidance}`])).trim();
    const candidateBlob = gitProtocolSuccess(git(['rev-parse', `${candidate}:${guidance}`])).trim();
    expect(trustedBlob).not.toBe(candidateBlob);
    for (const state of ['clean', 'repository', 'config', 'trace', 'replacement'] as const) {
      if (state === 'replacement') {
        gitProtocolSuccess(git(['replace', trustedBlob, candidateBlob]));
        expect(gitProtocolSuccess(git(['cat-file', 'blob', trustedBlob]))).toBe('Candidate owner\n');
      }
      const trace = path.join(root, '.git', 'unadmitted-trace.log');
      const injected: NodeJS.ProcessEnv = state === 'repository' ? { GIT_DIR: path.join(root, 'foreign.git') }
        : state === 'config' ? { GIT_CONFIG_COUNT: 'invalid' }
        : state === 'trace' ? { GIT_TRACE: trace }
        : state === 'replacement' ? { GIT_NO_REPLACE_OBJECTS: undefined } : {};
      const previous = Object.fromEntries(Object.keys(injected).map(key => [key, process.env[key]]));
      try {
        for (const key of Object.keys(injected)) {
          if (injected[key] === undefined) delete process.env[key];
          else process.env[key] = injected[key];
        }
        expect(() => observeOperationAuthorityOwners(root, trusted, candidate, absentRefs, [guidance]))
          .toThrow('activation-scope-conflict');
        const owners = observeOperationAuthorityOwners(root, trusted, candidate, manifest, [guidance]);
        expect(owners.find(owner => owner.ref === guidance)).toMatchObject({ id: authorityId,
          owner: authorityId, revision: trustedBlob, contentDigest: rawSha256('Trusted owner\n'), projection: null });
        expect(existsSync(trace)).toBe(false);
      } finally {
        for (const key of Object.keys(injected)) {
          if (previous[key] === undefined) delete process.env[key];
          else process.env[key] = previous[key];
        }
      }
    }
  });
});


test.skipIf(process.platform === 'win32')('activation status read suppresses repository-local fsmonitor execution', async () => {
  await inGitProtocolRepository(async (root, git) => {
    gitProtocolSuccess(git(['commit', '--quiet', '--allow-empty', '-m', 'status fixture']));
    const helper = path.join(root, '.git', 'fsmonitor');
    const sentinel = `${helper}.executed`;
    writeFileSync(helper, '#!/bin/sh\nprintf executed > "$0.executed"\nprintf "\\0"\n', { mode: 0o755 });
    gitProtocolSuccess(git(['config', 'core.fsmonitor', helper]));
    gitProtocolSuccess(git(['status', '--porcelain=v2', '-z', '--untracked-files=all']));
    expect(existsSync(sentinel)).toBe(true);
    rmSync(sentinel);
    // No current-state exists: the real entry stops after the clean-root reads,
    // before any GitHub observation or publication can be requested.
    await expect(resolveSecAgentOperationActivation(root, root)).rejects.toThrow('activation-stale');
    expect(existsSync(sentinel)).toBe(false);
  });
});


test.skipIf(process.platform === 'win32').each(['clean', 'process'] as const)(
  'activation rejects configured %s filters before native status can execute them', async (driver) => {
  await inGitProtocolRepository(async (root, git) => {
    writeFileSync(path.join(root, '.gitattributes'), 'tracked filter=activation\n');
    writeFileSync(path.join(root, 'tracked'), 'before\n');
    gitProtocolSuccess(git(['add', '.']));
    gitProtocolSuccess(git(['commit', '--quiet', '-m', 'filter fixture']));
    const sentinel = path.join(root, '.git', 'filter.executed');
    const helper = `printf executed > '${sentinel}'; ${driver === 'clean' ? 'cat' : 'exit 1'}`;
    const config = path.join(root, '.git', 'included-config');
    gitProtocolSuccess(git(['config', '--file', config, `filter.activation.${driver}`, helper]));
    gitProtocolSuccess(git(['config', 'include.path', config]));
    writeFileSync(path.join(root, 'tracked'), 'AFTER!\n');
    git(['status', '--porcelain=v2', '-z', '--untracked-files=all']);
    expect(existsSync(sentinel)).toBe(true);
    rmSync(sentinel);
    await expect(resolveSecAgentOperationActivation(root, root)).rejects.toMatchObject({
      reasonCode: 'activation-stale', blockerDigest: rawSha256('worktree-filter-helper-unavailable')
    });
    expect(existsSync(sentinel)).toBe(false);
  });
});

test.skipIf(process.platform === 'win32')('activation rejects gitlinks before status can execute nested repository filters', async () => {
  await inGitProtocolRepository(async (root, git) => {
    const nested = path.join(root, 'nested');
    gitProtocolSuccess(git(['init', '--quiet', nested]));
    writeFileSync(path.join(nested, '.gitattributes'), 'tracked filter=activation\n');
    writeFileSync(path.join(nested, 'tracked'), 'before\n');
    gitProtocolSuccess(git(['-C', nested, 'add', '.']));
    gitProtocolSuccess(git(['-C', nested, 'commit', '--quiet', '-m', 'nested filter fixture']));
    const nestedHead = gitProtocolSuccess(git(['-C', nested, 'rev-parse', 'HEAD'])).trim();
    gitProtocolSuccess(git(['update-index', '--add', '--cacheinfo', `160000,${nestedHead},nested`]));
    gitProtocolSuccess(git(['commit', '--quiet', '-m', 'gitlink fixture']));
    const sentinel = path.join(nested, '.git', 'filter.executed');
    gitProtocolSuccess(git(['-C', nested, 'config', 'filter.activation.clean', `printf executed > '${sentinel}'; cat`]));
    writeFileSync(path.join(nested, 'tracked'), 'AFTER!\n');
    gitProtocolSuccess(git(['status', '--porcelain=v2', '-z', '--untracked-files=all']));
    expect(existsSync(sentinel)).toBe(true);
    rmSync(sentinel);
    await expect(resolveSecAgentOperationActivation(root, root)).rejects.toMatchObject({
      reasonCode: 'activation-stale', blockerDigest: rawSha256('worktree-submodule-observation-unavailable')
    });
    expect(existsSync(sentinel)).toBe(false);
  });
});


test.skipIf(process.platform === 'win32')('activation preserves native dirty-worktree rejection without helper configuration', async () => {
  await inGitProtocolRepository(async (root, git) => {
    writeFileSync(path.join(root, 'tracked'), 'before\n');
    gitProtocolSuccess(git(['add', '.']));
    gitProtocolSuccess(git(['commit', '--quiet', '-m', 'ordinary dirty fixture']));
    writeFileSync(path.join(root, 'tracked'), 'AFTER!\n');
    const nativeStatus = gitProtocolSuccess(git(['status', '--porcelain=v2', '-z', '--untracked-files=all']));
    expect(nativeStatus.length).toBeGreaterThan(0);
    await expect(resolveSecAgentOperationActivation(root, root)).rejects.toMatchObject({
      reasonCode: 'activation-stale', blockerDigest: rawSha256(nativeStatus)
    });
  });
});
