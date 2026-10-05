import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { withGitCandidateCheckout } from '../../src/adapters/providers/git-bundle/runtime.ts';

import { AgentOperationActivationUnavailableError, createAgentOperationActivationHostedStagePorts, observeAgentOperationActivationCandidateControl, observeOperationAuthorityOwners } from '../../src/adapters/self-hosting/control/agent/agent-operation-activation.ts';
import { CodexDevelopmentParseCurrentWorkPackageManifest } from '../../src/adapters/self-hosting/control/task/contract/work-package.ts';
import { selectHostedJobRuntimePhase } from '../../src/application/hosted-job-runtime.ts';
import { gitProtocolSuccess, inGitProtocolRepository } from '../testkit/git-protocol.ts';

import {
  assertAgentOperationActivationTestCensus,
  assertAgentOperationActivationWorkPackageCensus
} from '../../src/adapters/self-hosting/control/agent/agent-operation-activation-census.ts';
import {
  agentOperationActivationArtifactName,
  agentOperationActivationOperationId,
  createAgentOperationActivationPreparation,
  createAgentOperationActivationProvider,
  createAgentOperationActivationPublication,
  createAgentOperationActivationReceipt,
  createAgentOperationActivationRequest,
  parseAgentOperationActivationPreparation,
  parseAgentOperationActivationPublicationComment,
  parseAgentOperationActivationReceipt,
  renderAgentOperationActivationPublicationComment,
  type AgentOperationActivationPreparationInput,
  type AgentOperationActivationProvider,
  type AgentOperationActivationRequest
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

function provider(runId: string, workflowSha = sha('a')): AgentOperationActivationProvider {
  return createAgentOperationActivationProvider({
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

function prepareRequest(): AgentOperationActivationRequest {
  return createAgentOperationActivationRequest({
    phase: 'prepare',
    pullRequestNumber: 400,
    expectedBaseSha: sha('a'),
    expectedHeadSha: sha('c'),
    manifestPath: 'config/repository/work-packages/delegation-consumer-zero-retirement-v1.md',
    manifestDigest: digest('2'),
    preparationCommentId: null
  });
}

function preparationInput(): AgentOperationActivationPreparationInput {
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
    operationId: agentOperationActivationOperationId(request.requestOperationId),
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
  const first = createAgentOperationActivationPreparation(preparationInput());
  const second = createAgentOperationActivationPreparation({
    ...preparationInput(),
    authorizedPaths: [...preparationInput().authorizedPaths].reverse(),
    proposalChangedPaths: [...preparationInput().proposalChangedPaths].reverse()
  });
  expect(second).toEqual(first);
  expect(parseAgentOperationActivationPreparation(
    JSON.parse(JSON.stringify(first))
  )).toEqual(first);
  expect(() => createAgentOperationActivationPreparation({
    ...preparationInput(),
    proposalChangedPaths: ['source/forbidden.ts']
  })).toThrow(/scope is inconsistent/u);
  expect(() => createAgentOperationActivationPreparation({
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
  const preparation = createAgentOperationActivationPreparation(preparationInput());
  const request = createAgentOperationActivationRequest({
    phase: 'finalize',
    pullRequestNumber: preparation.proposal.number,
    expectedBaseSha: preparation.trustedBaseSha,
    expectedHeadSha: sha('e'),
    manifestPath: preparation.proposal.manifestPath,
    manifestDigest: preparation.proposal.manifestDigest,
    preparationCommentId: 501
  });
  const receipt = createAgentOperationActivationReceipt({
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
  expect(parseAgentOperationActivationReceipt(
    JSON.parse(JSON.stringify(receipt))
  )).toEqual(receipt);
  const { schema: _receiptSchema, activationDigest: _activationDigest, ...receiptInput } = receipt;
  expect(() => createAgentOperationActivationReceipt({
    ...receiptInput,
    changedPaths: ['source/forbidden.ts']
  })).toThrow(/exact PRE authority/u);
  expect(() => createAgentOperationActivationReceipt({
    ...receiptInput,
    controlDigests: { ...preparation.controlDigests, rollingPlan: digest('f') }
  })).toThrow(/exact PRE authority/u);
});

test('App comment is only a canonical immutable-artifact locator', () => {
  const request = prepareRequest();
  const publication = createAgentOperationActivationPublication({
    request,
    payloadDigest: digest('a'),
    artifactId: '9001',
    artifactName: agentOperationActivationArtifactName(
      request.phase, request.requestOperationId
    ),
    artifactFileName: 'agent-operation-activation.json',
    artifactDigest: digest('b'),
    provider: provider('11')
  });
  const rendered = renderAgentOperationActivationPublicationComment(publication);
  expect(parseAgentOperationActivationPublicationComment(rendered)).toEqual(publication);
  expect(rendered).not.toContain('authorizedPaths');
  const { schema: _publicationSchema, publicationDigest: _publicationDigest, ...publicationInput } = publication;
  expect(() => createAgentOperationActivationPublication({
    ...publicationInput,
    artifactName: 'candidate-local-ref'
  })).toThrow(/artifact name/u);
});

test('candidate-local objects cannot satisfy the hosted provider schema', () => {
  const { schema: _providerSchema, providerDigest: _providerDigest, ...providerInput } = provider('11');
  expect(() => createAgentOperationActivationProvider({
    ...providerInput,
    workflowPath: '.github/workflows/candidate.yml',
    workflowRef: `.github/workflows/candidate.yml@${sha('a')}`
  } as never)).toThrow(/provider workflow/u);
  const { schema: _requestSchema, requestOperationId: _requestOperationId, ...requestInput } = prepareRequest();
  expect(() => createAgentOperationActivationRequest({
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

test('V3 activation reader observes the trusted document owner and preserves missing-ref rejection', async () => {
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
    await expect(observeOperationAuthorityOwners(root, trusted, candidate, absentRefs, [guidance]))
      .rejects.toThrow('activation-scope-conflict');
    const owners = await observeOperationAuthorityOwners(root, trusted, candidate, manifest, [guidance]);
    const trustedBlob = gitProtocolSuccess(git(['rev-parse', `${trusted}:${guidance}`])).trim();
    const candidateBlob = gitProtocolSuccess(git(['rev-parse', `${candidate}:${guidance}`])).trim();
    expect(trustedBlob).not.toBe(candidateBlob);
    expect(owners.find(owner => owner.ref === guidance)).toMatchObject({ id: authorityId,
      owner: authorityId, revision: trustedBlob, projection: null });
  });
});

// These cases exercise closed selector data only. The real origin issuer and
// per-job policy supply the comparison pair; no native qualification is claimed.
test('hosted phase selector returns the phase for an exact job and phase data pair', () => {
  expect(selectHostedJobRuntimePhase({
    argv: ['--job', 'agent-operation-activation', '--phase', 'produce-hosted'],
    authenticatedJobId: 'agent-operation-activation', authenticatedPhase: 'produce-hosted'
  })).toBe('produce-hosted');
  expect(selectHostedJobRuntimePhase({
    argv: ['--job', 'agent-operation-activation', '--phase', 'publish-hosted'],
    authenticatedJobId: 'agent-operation-activation', authenticatedPhase: 'publish-hosted'
  })).toBe('publish-hosted');
  expect(selectHostedJobRuntimePhase({
    argv: ['--job', 'coordinate-verification-session', '--phase', 'prepare-parent-plan'],
    authenticatedJobId: 'coordinate-verification-session', authenticatedPhase: 'prepare-parent-plan'
  })).toBe('prepare-parent-plan');
});

test('hosted phase selector rejects empty, incomplete and extra selector tokens', () => {
  for (const argv of [
    [],
    ['--job'],
    ['--job', 'agent-operation-activation'],
    ['--job', 'agent-operation-activation', '--phase'],
    ['--phase', 'produce-hosted'],
    ['--job', 'agent-operation-activation', '--phase', 'produce-hosted', 'extra'],
    ['--job', 'agent-operation-activation', '--phase', 'produce-hosted', '--json'],
    ['--job', 'agent-operation-activation', '--phase', 'produce-hosted', '--phase', 'publish-hosted']
  ]) {
    expect(() => selectHostedJobRuntimePhase({ argv,
      authenticatedJobId: 'agent-operation-activation', authenticatedPhase: 'produce-hosted'
    })).toThrow();
  }
});

test('hosted phase selector compares both supplied job and phase identities exactly', () => {
  const argv = ['--job', 'agent-operation-activation', '--phase', 'produce-hosted'];
  for (const pair of [
    { authenticatedJobId: 'coordinate-verification-session', authenticatedPhase: 'produce-hosted' },
    { authenticatedJobId: 'Agent-operation-activation', authenticatedPhase: 'produce-hosted' },
    { authenticatedJobId: 'agent-operation-activation ', authenticatedPhase: 'produce-hosted' },
    { authenticatedJobId: 'agent-operation-activation', authenticatedPhase: 'publish-hosted' },
    { authenticatedJobId: 'agent-operation-activation', authenticatedPhase: 'Produce-hosted' },
    { authenticatedJobId: 'agent-operation-activation', authenticatedPhase: 'produce-hosted ' }
  ]) {
    expect(() => selectHostedJobRuntimePhase({ argv, ...pair })).toThrow();
  }
});

test('hosted phase selector rejects reordered flags and legacy unbounded command options', () => {
  for (const argv of [
    ['--phase', 'produce-hosted', '--job', 'agent-operation-activation'],
    ['--job-id', 'agent-operation-activation', '--phase', 'produce-hosted'],
    ['--job', 'agent-operation-activation', '--command', 'produce-hosted'],
    ['--job', 'agent-operation-activation', '--job', 'produce-hosted'],
    ['--phase', 'agent-operation-activation', '--phase', 'produce-hosted'],
    ['--job=agent-operation-activation', '--phase=produce-hosted'],
    ['request'], ['observe'], ['produce-hosted'], ['publish-hosted'],
    ['produce-hosted', '--json', '--json'],
    ['publish-hosted', '--arbitrary-program', 'candidate.js'],
    ['produce-hosted', '--runtime-root', '.', '--candidate-root', '.', '--request', 'request.json',
      '--output', 'output.json', '--json', '--skip-source-guard', 'true'],
    ['--job', 'agent-operation-activation', '--phase', 'produce-hosted', '--arbitrary-program', 'candidate.js'],
    ['--job', 'agent-operation-activation', '--phase', 'produce-hosted', '--skip-source-guard', 'true']
  ]) {
    expect(() => selectHostedJobRuntimePhase({ argv,
      authenticatedJobId: 'agent-operation-activation', authenticatedPhase: 'produce-hosted'
    })).toThrow();
  }
});


test('actual activation Git ports ignore ambient config, trace and repository redirects inside the private lifetime', async () => {
  await inGitProtocolRepository(async (root, git) => {
    writeFileSync(path.join(root, 'input.txt'), 'trusted\n');
    gitProtocolSuccess(git(['add', '.'])); gitProtocolSuccess(git(['commit', '--quiet', '-m', 'activation input']));
    const revision = gitProtocolSuccess(git(['rev-parse', 'HEAD'])).trim();
    await withGitCandidateCheckout({ sourceRoot: root, baseSha: revision, headSha: revision,
      purpose: 'activation-static', deadlineAtUnixMs: Date.now() + 120_000 }, async checkout => {
      const trace = path.join(root, 'ambient-trace-must-not-exist');
      const hostile = { GIT_DIR: path.join(root, 'foreign.git'), GIT_WORK_TREE: root,
        GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.fsmonitor', GIT_CONFIG_VALUE_0: '/must-not-execute',
        GIT_CONFIG_GLOBAL: path.join(root, 'foreign-config'), GIT_TRACE: trace,
        GIT_EXTERNAL_DIFF: '/must-not-execute', GIT_ALLOW_PROTOCOL: 'none' };
      const before = new Map(Object.keys(hostile).map(key => [key, process.env[key]]));
      try {
        Object.assign(process.env, hostile);
        const ports = createAgentOperationActivationHostedStagePorts(checkout);
        expect(await ports.repositoryRoot(checkout.candidateRoot)).toBe(checkout.candidateRoot);
        await ports.assertCleanExactRoot(checkout.candidateRoot, revision);
        expect(existsSync(trace)).toBe(false);
      } finally {
        for (const [key, value] of before) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
      }
    });
  });
});

test('actual activation Git consumer rejects cancellation after acquisition before any later observation', async () => {
  await inGitProtocolRepository(async (root, git) => {
    writeFileSync(path.join(root, 'input.txt'), 'trusted\n');
    gitProtocolSuccess(git(['add', '.'])); gitProtocolSuccess(git(['commit', '--quiet', '-m', 'activation cancellation']));
    const revision = gitProtocolSuccess(git(['rev-parse', 'HEAD'])).trim();
    const controller = new AbortController(), reason = new Error('activation scope revoked');
    let generation = '', entered = false, portRejected = false, scopeRejected = false;
    let portFailure: unknown;
    try {
      try {
        await withGitCandidateCheckout({ sourceRoot: root, baseSha: revision, headSha: revision,
          purpose: 'activation-static', deadlineAtUnixMs: Date.now() + 120_000, signal: controller.signal }, async checkout => {
          entered = true;
          generation = path.dirname(checkout.candidateRoot);
          const ports = createAgentOperationActivationHostedStagePorts(checkout);
          controller.abort(reason);
          try { await ports.assertCleanExactRoot(checkout.candidateRoot, revision); }
          catch (error) { portRejected = true; portFailure = error; throw error; }
        });
      } catch { scopeRejected = true; }
      // The expected scope rejection must never swallow a failed port oracle.
      expect(entered).toBe(true);
      expect(portRejected).toBe(true);
      expect(portFailure).toBe(reason);
      expect(scopeRejected).toBe(true);
    } finally {
      if (generation !== '') rmSync(generation, { recursive: true, force: true });
    }
  });
});


// Exercise the complete production control reader, including its mandatory
// literal-pathspec ls-tree census. Fixture bytes and expected identities are
// authored independently; no live Work/activation/publication is granted.
test('actual activation control reader accepts the full census argv and rejects a missing declared test', async () => {
  for (const missingTest of [false, true]) await inGitProtocolRepository(async (root, git) => {
    writeFileSync(path.join(root, 'base.txt'), 'base\n');
    gitProtocolSuccess(git(['add', '.']));
    gitProtocolSuccess(git(['commit', '--quiet', '-m', 'control base']));
    const base = gitProtocolSuccess(git(['rev-parse', 'HEAD'])).trim();
    const baseTree = gitProtocolSuccess(git(['rev-parse', 'HEAD^{tree}'])).trim();
    const manifestPath = 'config/repository/work-packages/control-reader.md';
    const tests = ['tests/unit/agent-operation-activation.test.ts', 'tests/unit/行为 [literal].test.ts'];
    const manifest = workPackageManifest('control-reader', 'issue-311').toString('utf8')
      .replace(sha('a'), base).replace(`  - ${tests[0]}\n`, `  - ${tests[0]}\n  - ${tests[1]}\n`);
    const manifestDigest = `sha256:${createHash('sha256').update(manifest).digest('hex')}` as const;
    const files = {
      [manifestPath]: manifest,
      'config/repository/current-state.yaml': `schema: sec-current-state-live-v1
resolver:
  command: bun src/adapters/self-hosting/control/documentation/document-control-plane.ts status --json
  repository: sec-platform/sec
  remote: origin
  defaultBranch: main
  defaultRef: refs/remotes/origin/main
  requireRemoteMatch: true
stableFacts: {}
`,
      'config/repository/active-work-package.md': `---
schema: sec-active-work-package-pointer-v2
status: conditional
last-reviewed: 2026-10-05
---
\`\`\`yaml
selectionMode: exact-manifest-not-on-default-branch-v1
defaultBranchRef: refs/remotes/origin/main
defaultRefFreshness: live-platform-match-required
manifest: ${manifestPath}
manifestDigest: ${manifestDigest}
digestBytes: git-blob
unavailableDefaultRef: unresolved
matchingDefaultBlob: none
\`\`\`
`,
      'config/repository/rolling-plan.md': `## 当前唯一 Work Package
### control-reader
## 候选 Work Package
### 1. next-one
### 2. next-two
`,
      [tests[0]!]: 'export {};\n',
      ...(missingTest ? {} : { [tests[1]!]: 'export {};\n' })
    };
    for (const [name, bytes] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
      writeFileSync(path.join(root, name), bytes);
    }
    gitProtocolSuccess(git(['add', '.']));
    gitProtocolSuccess(git(['commit', '--quiet', '-m', 'control candidate']));
    const head = gitProtocolSuccess(git(['rev-parse', 'HEAD'])).trim();
    let failure: unknown;
    let control: Awaited<ReturnType<typeof observeAgentOperationActivationCandidateControl>> | undefined;
    await withGitCandidateCheckout({ sourceRoot: root, baseSha: base, headSha: head,
      purpose: 'activation-static', deadlineAtUnixMs: Date.now() + 120_000 }, async checkout => {
      try {
        control = await observeAgentOperationActivationCandidateControl(checkout.candidateRoot, head,
          { repository: 'sec-platform/sec', exactMain: base, exactMainTree: baseTree }, checkout);
      } catch (error) { failure = error; }
    });
    if (missingTest) {
      expect(control).toBeUndefined();
      expect(failure).toBeInstanceOf(AgentOperationActivationUnavailableError);
      const unavailable = failure as AgentOperationActivationUnavailableError;
      expect(unavailable.reasonCode).toBe('activation-stale');
      // The adapter intentionally exposes a digest, not raw owner diagnostics.
      // Author the missing path independently instead of calling its census.
      const detail = 'work-package-test-blobs-missing:["tests/unit/行为 [literal].test.ts"]';
      expect(unavailable.blockerDigest).toBe(`sha256:${createHash('sha256').update(detail).digest('hex')}`);
    } else {
      expect(failure).toBeUndefined();
      expect(control).toBeDefined();
      if (control === undefined) throw new Error('Actual control reader produced no successful observation.');
      expect(control.manifestPath).toBe(manifestPath);
      expect(control.manifestDigest).toBe(manifestDigest);
      expect(control.manifest.tests).toEqual(tests);
      expect(Buffer.from(control.manifestBytes).toString('utf8')).toBe(manifest);
    }
  });
});

test.skipIf(process.platform === 'win32')('actual activation trusted-root status suppresses repository-local fsmonitor', async () => {
  await inGitProtocolRepository(async (root, git) => {
    writeFileSync(path.join(root, 'input.txt'), 'trusted\n');
    gitProtocolSuccess(git(['add', '.'])); gitProtocolSuccess(git(['commit', '--quiet', '-m', 'trusted status']));
    const revision = gitProtocolSuccess(git(['rev-parse', 'HEAD'])).trim();
    const marker = path.join(root, '.git', 'fsmonitor-executed');
    const helper = path.join(root, '.git', 'fsmonitor-helper');
    writeFileSync(helper, `#!/bin/sh\nprintf called > '${marker}'\nprintf '\\0'\n`);
    chmodSync(helper, 0o755);
    gitProtocolSuccess(git(['config', 'core.fsmonitor', helper]));
    // Independent native Git confirms this local setting actually selects the
    // helper. The production consumer must then suppress the same setting.
    gitProtocolSuccess(git(['status', '--porcelain=v2', '-z', '--untracked-files=all']));
    expect(existsSync(marker)).toBe(true);
    rmSync(marker);
    await withGitCandidateCheckout({ sourceRoot: root, trustedRoot: root, baseSha: revision, headSha: revision,
      purpose: 'activation-static', deadlineAtUnixMs: Date.now() + 120_000 }, async checkout => {
      const ports = createAgentOperationActivationHostedStagePorts(checkout);
      expect(await ports.repositoryRoot(root)).toBe(root);
      await ports.assertCleanExactRoot(root, revision);
      expect(existsSync(marker)).toBe(false);
    });
    expect(existsSync(marker)).toBe(false);
  });
});

test.skipIf(process.platform === 'win32')('actual activation ports retain the acquired Git despite a later hostile PATH', async () => {
  await inGitProtocolRepository(async (root, git) => {
    writeFileSync(path.join(root, 'input.txt'), 'trusted\n');
    gitProtocolSuccess(git(['add', '.'])); gitProtocolSuccess(git(['commit', '--quiet', '-m', 'retained PATH']));
    const revision = gitProtocolSuccess(git(['rev-parse', 'HEAD'])).trim();
    const bin = mkdtempSync(path.join(tmpdir(), 'sec-activation-hostile-path-'));
    const marker = path.join(bin, 'alternate-git-executed');
    writeFileSync(path.join(bin, 'git'), `#!/bin/sh\nprintf called > '${marker}'\nexit 1\n`);
    chmodSync(path.join(bin, 'git'), 0o755);
    const originalPath = process.env.PATH;
    try {
      await withGitCandidateCheckout({ sourceRoot: root, baseSha: revision, headSha: revision,
        purpose: 'activation-static', deadlineAtUnixMs: Date.now() + 120_000 }, async checkout => {
        const ports = createAgentOperationActivationHostedStagePorts(checkout);
        process.env.PATH = bin;
        expect(await ports.repositoryRoot(checkout.candidateRoot)).toBe(checkout.candidateRoot);
        await ports.assertCleanExactRoot(root, revision);
        expect(existsSync(marker)).toBe(false);
      });
    } finally {
      if (originalPath === undefined) delete process.env.PATH; else process.env.PATH = originalPath;
      rmSync(bin, { recursive: true, force: true });
    }
  });
});

test.skipIf(process.platform === 'win32')('actual activation port rejects replacement of its admitted executable before execution', async () => {
  await inGitProtocolRepository(async (root, git) => {
    writeFileSync(path.join(root, 'input.txt'), 'trusted\n');
    gitProtocolSuccess(git(['add', '.'])); gitProtocolSuccess(git(['commit', '--quiet', '-m', 'retained executable']));
    const revision = gitProtocolSuccess(git(['rev-parse', 'HEAD'])).trim();
    const bin = mkdtempSync(path.join(tmpdir(), 'sec-activation-retained-git-'));
    const executable = path.join(bin, 'git');
    const originalExecutable = Bun.which('git');
    expect(originalExecutable).not.toBeNull();
    copyFileSync(realpathSync(originalExecutable!), executable);
    chmodSync(executable, 0o755);
    const originalPath = process.env.PATH;
    const marker = path.join(bin, 'replacement-executed');
    let generation = '', portRejected = false, scopeRejected = false;
    try {
      process.env.PATH = `${bin}${path.delimiter}${originalPath ?? ''}`;
      try {
        await withGitCandidateCheckout({ sourceRoot: root, baseSha: revision, headSha: revision,
          purpose: 'activation-static', deadlineAtUnixMs: Date.now() + 120_000 }, async checkout => {
          generation = path.dirname(checkout.candidateRoot);
          const ports = createAgentOperationActivationHostedStagePorts(checkout);
          renameSync(executable, path.join(bin, 'original-git'));
          writeFileSync(executable, `#!/bin/sh\nprintf called > '${marker}'\nexit 0\n`);
          chmodSync(executable, 0o755);
          try { await ports.repositoryRoot(checkout.candidateRoot); }
          catch (error) { portRejected = true; throw error; }
        });
      } catch { scopeRejected = true; }
      expect(generation).not.toBe('');
      expect(portRejected).toBe(true);
      expect(scopeRejected).toBe(true);
      expect(existsSync(marker)).toBe(false);
    } finally {
      if (originalPath === undefined) delete process.env.PATH; else process.env.PATH = originalPath;
      if (generation !== '') rmSync(generation, { recursive: true, force: true });
      rmSync(bin, { recursive: true, force: true });
    }
  });
});


for (const driver of ['clean', 'process'] as const) for (const name of ['activation-record', 'unspecified', 'unset']) {
  test.skipIf(process.platform !== 'linux')(`actual activation status rejects ${driver} driver ${name} without execution`, async () => {
    await inGitProtocolRepository(async (root, git) => {
      writeFileSync(path.join(root, 'input.txt'), 'tracked before driver configuration\n');
      writeFileSync(path.join(root, '.gitattributes'), `*.txt filter=${name}\n`);
      gitProtocolSuccess(git(['add', '.']));
      gitProtocolSuccess(git(['commit', '--quiet', '-m', 'trusted attribute input']));
      const revision = gitProtocolSuccess(git(['rev-parse', 'HEAD'])).trim();
      const marker = path.join(root, '.git', 'filter-executed');
      gitProtocolSuccess(git(['config', `filter.${name}.${driver}`, `printf executed > '${marker}'; cat`]));
      writeFileSync(path.join(root, 'input.txt'), 'force real content comparison\n');
      let entered = false, statusAttempted = false, statusRejected = false, scopeRejected = false;
      let observedRoot: string | undefined;
      try {
        await withGitCandidateCheckout({ sourceRoot: root, trustedRoot: root,
          baseSha: revision, headSha: revision, purpose: 'activation-static',
          deadlineAtUnixMs: Date.now() + 120_000 }, async checkout => {
          entered = true;
          const ports = createAgentOperationActivationHostedStagePorts(checkout);
          observedRoot = await ports.repositoryRoot(root);
          statusAttempted = true;
          try { await ports.assertCleanExactRoot(root, revision); }
          catch (error) { statusRejected = true; throw error; }
        });
      } catch { scopeRejected = true; }
      expect(entered).toBe(true);
      expect(observedRoot).toBe(root);
      expect(statusAttempted).toBe(true);
      expect(statusRejected).toBe(true);
      expect(scopeRejected).toBe(true);
      expect(existsSync(marker)).toBe(false);
    });
  });
}
