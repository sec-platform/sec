import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { rawSha256, sha256 } from '../../platform/shared/canonical-primitives.ts';
import { inspectNoFollowDirectoryChainV1 } from '../../platform/shared/physical-no-follow.ts';
import {
  buildCiVerificationActionPlanClosureV1,
  createCiVerificationLocalExecutionEnvironmentV2,
  type CiVerificationActionCandidateV1,
  type CiVerificationProducerGateV1
} from '../../platform/shared/verification-action-ci-contract.ts';
import {
  createVerificationActionKeyV2,
  createVerificationActionPlanV2,
  VERIFICATION_ACTION_CHEAP_EXECUTION_BUDGET_V1,
  type VerificationActionKeyInputV2
} from '../../platform/shared/verification-action-contract.ts';
import {
  createBranchLifecycleGitChildEnvironmentV1
} from '../../scripts/codex/branch-lifecycle-command.ts';
import {
  analyzeDevelopmentCriticalPathStaticClosureV2,
  readDevelopmentCriticalPathStaticAnalyzerTelemetryV2
} from '../../tooling/sec-dev/development-critical-path.ts';
import {
  createRuntimeStateJournalFileSystemV1
} from '../../tooling/sec-dev/runtime-state-journal-filesystem.ts';
import { resolveSecWorkspaceRuntimeRootsV1 } from '../../tooling/sec-dev/runtime-state.ts';
import { readVerificationActionJournalV2 } from '../../tooling/sec-dev/verification-action-journal.ts';
import { executeLocalVerificationActionDagV2 } from '../../tooling/sec-dev/verification-action-runner.ts';

const DIGEST_A = `sha256:${'a'.repeat(64)}` as const;
const CANARY_TIMEOUT_MS = 45_000;
const compilerRoot = path.resolve(import.meta.dir, '../..');

function git(cwd: string, args: readonly string[]): string {
  const result = spawnSync('git', [...args], { cwd, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return (result.stdout ?? '').trim();
}

function inspectRepository(
  repositoryRoot: string,
  environment: Readonly<NodeJS.ProcessEnv> = process.env
) {
  const read = (args: readonly string[]) => {
    const result = spawnSync('git', args, {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: createBranchLifecycleGitChildEnvironmentV1(environment),
      windowsHide: true
    });
    if (result.status !== 0) throw new Error(String(result.stderr || result.stdout));
    return String(result.stdout).trim();
  };
  return Object.freeze({
    headSha: read(['rev-parse', 'HEAD']),
    headTreeSha: read(['rev-parse', 'HEAD^{tree}']),
    trackedClean:
      read(['diff-files', '--name-only', '--ignore-cr-at-eol']) === ''
      && read(['diff-index', '--cached', '--name-only', '--ignore-cr-at-eol', 'HEAD', '--']) === ''
      && read(['ls-files', '--others', '--exclude-standard']) === '',
    gitCommonDirectory: realpathSync.native(read([
      'rev-parse', '--path-format=absolute', '--git-common-dir'
    ]))
  });
}

function localDagFixture(
  repositoryRoot: string,
  identity: Pick<CiVerificationActionCandidateV1,
    'baseSha' | 'baseTreeSha' | 'headSha' | 'headTreeSha'>
) {
  const environment = createCiVerificationLocalExecutionEnvironmentV2({
    os: 'win32',
    arch: 'x64',
    bunVersion: '1.3.14'
  });
  const manifestPath = 'docs/work-packages/development-critical-path-spine-v1.md';
  const trackedDigest = (repositoryPath: string) => rawSha256(
    readFileSync(path.join(repositoryRoot, ...repositoryPath.split('/')))
  );
  const candidate: CiVerificationActionCandidateV1 = {
    ...identity,
    manifestPath,
    manifestDigest: trackedDigest(manifestPath),
    scopeAuthorizationRevision: `sha256:${'b'.repeat(64)}`,
    profile: 'quick',
    toolchainRevision: environment.toolchainRevision,
    providerRevision: environment.executionEnvironmentRevision,
    contractRevision: 'ci-verification-v19',
    requiredBlobs: [
      { path: '.bun-version', digest: trackedDigest('.bun-version') },
      { path: 'bun.lock', digest: trackedDigest('bun.lock') },
      { path: 'bunfig.toml', digest: trackedDigest('bunfig.toml') },
      { path: 'package.json', digest: trackedDigest('package.json') }
    ]
  };
  const gates: readonly CiVerificationProducerGateV1[] = [Object.freeze({
    id: 'typecheck',
    phase: 'quick',
    argv: Object.freeze(['bun', 'run', 'typecheck']),
    runtime: 'bun',
    environment: Object.freeze({ SEC_LOCAL_FEEDBACK: DIGEST_A }),
    coveredScopeIds: Object.freeze(['gate:typecheck'])
  })];
  return Object.freeze({
    environment,
    closure: buildCiVerificationActionPlanClosureV1({ candidate, gates })
  });
}

function snapshotIndex(indexPath: string) {
  const stat = statSync(indexPath);
  return Object.freeze({
    bytes: readFileSync(indexPath),
    dev: stat.dev,
    ino: stat.ino,
    size: stat.size,
    mtimeMs: stat.mtimeMs
  });
}

function analyzerPlan(
  inputClosure: VerificationActionKeyInputV2['inputClosure'],
  actionKind = 'critical-path-canary'
) {
  const action = createVerificationActionKeyV2({
    actionKind,
    producer: { identity: 'critical-path-exact-tree-canary', revision: 'v1' },
    operation: {
      identity: 'exact-tree-canary',
      revision: 'v1',
      semanticDigest: DIGEST_A,
      workingDirectory: '.',
      declaredEnvironment: []
    },
    inputClosure,
    environment: {
      toolchainRevision: 'bun-test',
      providerRevision: 'local',
      contractRevision: 'critical-path-v1',
      executionBudget: VERIFICATION_ACTION_CHEAP_EXECUTION_BUDGET_V1
    },
    requiredCheapPreflightActionKeys: [],
    upstreamActionKeys: [],
    resultSchemaRevision: 'critical-path-result-v1',
    staticProofRequirement: 'bounded-action-admission'
  });
  return createVerificationActionPlanV2({
    action,
    executionClass: 'cheap-preflight',
    dependencies: []
  });
}

test('one exact-tree canary proves hostile Git isolation, one physical start, reuse and dirty rejection', async () => {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'sec-critical-path-canary-'));
  const authorityRoot = path.join(workspaceRoot, 'authority');
  const candidateRoot = path.join(workspaceRoot, 'candidate');
  const decoyRoot = path.join(workspaceRoot, 'decoy');
  try {
    git(workspaceRoot, ['clone', '--shared', compilerRoot, authorityRoot]);
    git(authorityRoot, ['config', 'user.name', 'SEC Runner']);
    git(authorityRoot, ['config', 'user.email', 'sec-runner@example.invalid']);
    writeFileSync(path.join(authorityRoot, 'tracked.txt'), 'candidate\n', 'utf8');
    git(authorityRoot, ['add', 'tracked.txt']);
    git(authorityRoot, ['commit', '-m', 'candidate']);
    const headSha = git(authorityRoot, ['rev-parse', 'HEAD']);
    const headTreeSha = git(authorityRoot, ['rev-parse', 'HEAD^{tree}']);
    git(authorityRoot, ['worktree', 'add', '--detach', candidateRoot, headSha]);

    const originalBranch = git(authorityRoot, ['symbolic-ref', '--short', 'HEAD']);
    git(authorityRoot, ['switch', '-c', 'replacement-view']);
    writeFileSync(path.join(authorityRoot, 'tracked.txt'), 'replacement\n', 'utf8');
    git(authorityRoot, ['add', 'tracked.txt']);
    git(authorityRoot, ['commit', '-m', 'replacement object view']);
    const replacementCommit = git(authorityRoot, ['rev-parse', 'HEAD']);
    git(authorityRoot, ['switch', originalBranch]);
    git(authorityRoot, ['replace', headSha, replacementCommit]);
    expect(git(authorityRoot, ['show', `${headSha}:tracked.txt`])).toBe('replacement');
    const isolatedBlob = spawnSync('git', ['show', `${headSha}:tracked.txt`], {
      cwd: authorityRoot,
      encoding: 'buffer',
      windowsHide: true,
      env: createBranchLifecycleGitChildEnvironmentV1(process.env)
    });
    expect(isolatedBlob.status).toBe(0);
    expect(isolatedBlob.stdout.toString('utf8').trim()).toBe('candidate');

    const actionPlanClosureDigest = sha256({
      schema: 'exact-tree-canary-plan-closure-v1'
    }) as `sha256:${string}`;
    const mainTreeDigest = sha256(headTreeSha) as `sha256:${string}`;
    const reservedPlan = analyzerPlan([
      { path: 'main.tree', digest: mainTreeDigest },
      { path: 'affected.plan', digest: actionPlanClosureDigest }
    ], 'critical-path-reserved-inputs');
    const reservedAuthority = analyzeDevelopmentCriticalPathStaticClosureV2({
      repositoryRoot: candidateRoot,
      plan: reservedPlan,
      actionPlanClosureDigest,
      expectedHeadSha: headSha,
      expectedHeadTreeSha: headTreeSha
    });
    expect(reservedAuthority.schema).toBe('sec-development-critical-path-static-analysis-authority-v2');
    expect(() => analyzeDevelopmentCriticalPathStaticClosureV2({
      repositoryRoot: candidateRoot,
      plan: analyzerPlan([{ path: 'main.tree', digest: DIGEST_A }], 'critical-path-reserved-drift'),
      actionPlanClosureDigest,
      expectedHeadSha: headSha,
      expectedHeadTreeSha: headTreeSha
    })).toThrow(/Action input bytes drifted for main\.tree/u);

    const manifestPath = 'docs/work-packages/development-critical-path-spine-v1.md';
    const manifestDigest = rawSha256(readFileSync(path.join(candidateRoot, manifestPath)));
    const wholeDeltaAuthority = analyzeDevelopmentCriticalPathStaticClosureV2({
      repositoryRoot: candidateRoot,
      plan: analyzerPlan([{ path: manifestPath, digest: manifestDigest }], 'critical-path-whole-delta'),
      actionPlanClosureDigest,
      expectedHeadSha: headSha,
      expectedHeadTreeSha: headTreeSha,
      manifestPath
    });
    const wholeDelta = wholeDeltaAuthority.readback.wholeDelta;
    expect(wholeDelta?.changes.every(({ status, path: changedPath }) =>
      ['added', 'changed', 'removed', 'renamed', 'copied'].includes(status) && changedPath.length > 0
    )).toBe(true);
    expect(wholeDelta?.unknowns.some(({ missingEdge }) =>
      missingEdge.startsWith('manifest-owned-path-absent:')
    )).toBe(false);
    expect(wholeDelta?.nonMisleadingProjection).toMatchObject({
      strongestStage: 'planned', completion: 'incomplete'
    });

    const censusBefore = readDevelopmentCriticalPathStaticAnalyzerTelemetryV2();
    for (const actionKind of ['critical-path-census-a', 'critical-path-census-b']) {
      analyzeDevelopmentCriticalPathStaticClosureV2({
        repositoryRoot: candidateRoot,
        plan: analyzerPlan([{ path: 'main.tree', digest: mainTreeDigest }], actionKind),
        actionPlanClosureDigest,
        expectedHeadSha: headSha,
        expectedHeadTreeSha: headTreeSha
      });
    }
    const censusAfter = readDevelopmentCriticalPathStaticAnalyzerTelemetryV2();
    expect(censusAfter.analyzerInvocationCount - censusBefore.analyzerInvocationCount).toBe(2);
    expect(censusAfter.censusLookupCount - censusBefore.censusLookupCount).toBe(2);
    expect(censusAfter.censusBuildCount - censusBefore.censusBuildCount).toBeLessThanOrEqual(1);

    git(workspaceRoot, ['init', decoyRoot]);
    git(decoyRoot, ['config', 'user.name', 'SEC Decoy']);
    git(decoyRoot, ['config', 'user.email', 'sec-decoy@example.invalid']);
    writeFileSync(path.join(decoyRoot, 'decoy.txt'), 'decoy\n', 'utf8');
    git(decoyRoot, ['add', 'decoy.txt']);
    git(decoyRoot, ['commit', '-m', 'decoy']);
    const decoyGitDirectory = git(decoyRoot, [
      'rev-parse', '--path-format=absolute', '--absolute-git-dir'
    ]);
    const decoyIndex = git(decoyRoot, [
      'rev-parse', '--path-format=absolute', '--git-path', 'index'
    ]);
    const authorityIndex = git(authorityRoot, [
      'rev-parse', '--path-format=absolute', '--git-path', 'index'
    ]);
    const candidateIndex = git(candidateRoot, [
      'rev-parse', '--path-format=absolute', '--git-path', 'index'
    ]);
    const authorityBefore = snapshotIndex(authorityIndex);
    const candidateBefore = snapshotIndex(candidateIndex);
    const future = new Date(Date.now() + 5_000);
    utimesSync(path.join(candidateRoot, 'tracked.txt'), future, future);

    const hostileEnvironment: NodeJS.ProcessEnv = {
      ...process.env,
      GIT_DIR: decoyGitDirectory,
      GIT_WORK_TREE: decoyRoot,
      GIT_COMMON_DIR: decoyGitDirectory,
      GIT_INDEX_FILE: decoyIndex,
      GIT_OBJECT_DIRECTORY: path.join(decoyGitDirectory, 'objects'),
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'core.worktree',
      GIT_CONFIG_VALUE_0: decoyRoot
    };
    const hostileInspectRepository = (repositoryPath: string) =>
      inspectRepository(repositoryPath, hostileEnvironment);
    const fixture = localDagFixture(candidateRoot, {
      baseSha: headSha,
      baseTreeSha: headTreeSha,
      headSha,
      headTreeSha
    });
    let physicalExecutions = 0;
    const before = readDevelopmentCriticalPathStaticAnalyzerTelemetryV2();
    const execute = () => executeLocalVerificationActionDagV2({
      authorityRoot,
      candidateRoot,
      actionPlanClosure: fixture.closure,
      executionEnvironment: fixture.environment,
      inspectRepository: hostileInspectRepository,
      executeNormalizedOperation: () => {
        physicalExecutions += 1;
        return 0;
      }
    });
    const first = await execute();
    const afterFirst = readDevelopmentCriticalPathStaticAnalyzerTelemetryV2();
    const reused = await execute();
    const afterReuse = readDevelopmentCriticalPathStaticAnalyzerTelemetryV2();

    expect(first.status).toBe('passed');
    expect(first.actionResults[0]?.disposition).toBe('executed');
    expect(reused.actionResults[0]?.disposition).toBe('reused');
    expect(physicalExecutions).toBe(1);
    expect(afterFirst.analyzerInvocationCount).toBe(before.analyzerInvocationCount + 1);
    expect(afterReuse.analyzerInvocationCount).toBe(afterFirst.analyzerInvocationCount);
    expect(afterReuse.censusBuildCount).toBe(afterFirst.censusBuildCount);

    const workspaceStateRoot = resolveSecWorkspaceRuntimeRootsV1({
      repositoryRoot: authorityRoot
    }).workspaceStateRoot;
    const journalFs = createRuntimeStateJournalFileSystemV1(
      inspectNoFollowDirectoryChainV1(
        workspaceStateRoot,
        'Development Critical Path exact-tree canary journal root'
      ).target
    );
    expect(readVerificationActionJournalV2(
      journalFs,
      fixture.closure.actions[0]!.action.actionKey
    ).latestState).toBe('terminal');

    for (const [indexPath, beforeSnapshot] of [
      [authorityIndex, authorityBefore],
      [candidateIndex, candidateBefore]
    ] as const) {
      const after = snapshotIndex(indexPath);
      expect(after.bytes).toEqual(beforeSnapshot.bytes);
      expect({ dev: after.dev, ino: after.ino, size: after.size, mtimeMs: after.mtimeMs })
        .toEqual({
          dev: beforeSnapshot.dev,
          ino: beforeSnapshot.ino,
          size: beforeSnapshot.size,
          mtimeMs: beforeSnapshot.mtimeMs
        });
    }

    writeFileSync(path.join(candidateRoot, 'tracked.txt'), 'dirty\n', 'utf8');
    await expect(execute()).rejects.toThrow('exact clean candidate head and tree');
    expect(physicalExecutions).toBe(1);
  } finally {
    try { git(authorityRoot, ['worktree', 'remove', '--force', candidateRoot]); } catch { /* canary cleanup */ }
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
}, CANARY_TIMEOUT_MS);
