import { spawnSync } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import {
  issueDevelopmentCommitAdmission,
  type DevelopmentCommitAdmission,
  type DevelopmentCommitRequest
} from '../../src/development/commit-admission/operation.ts';
import {
  acknowledgeClosedAbsentDevelopmentCommitJournalRetirement,
  acknowledgeDevelopmentCommitResult,
  acknowledgeNotAppliedDevelopmentCommitResult,
  CLOSED_ABSENT_DEVELOPMENT_COMMIT_JOURNAL_RETIREMENT_CONTRACT_DIGEST,
  CLOSED_ABSENT_DEVELOPMENT_COMMIT_JOURNAL_RETIREMENT_PROVIDER_IDENTITY_DIGEST,
  CLOSED_ABSENT_DEVELOPMENT_COMMIT_JOURNAL_RETIREMENT_REQUIREMENT_ID,
  CLOSED_ABSENT_DEVELOPMENT_COMMIT_JOURNAL_RETIREMENT_RESOURCE_CEILINGS,
  DevelopmentCommitLostHandleError,
  prepareClosedAbsentDevelopmentCommitJournalRetirement,
  readDevelopmentCommitOutcome,
  recoverDevelopmentCommit,
  retireMergedDevelopmentCommitJournals,
  retryDevelopmentCommit,
  runDevelopmentCommit,
  runDevelopmentCommitForTests,
  settleDevelopmentCommitJournalsForRef
} from '../../src/development/commit/operation.ts';
import { IMPORT_NORMALIZATION_OPERATION } from '../../src/development/import-normalization/contract.ts';
import { GIT_READ_OPERATION_BUDGET } from '../../src/development/tooling/git/git-read.ts';
import { withAuthorityGitReadSession } from '../../src/external-capabilities/git-read/authority.ts';
import type { GitReadSession } from '../../src/external-capabilities/git-read/runtime/session.ts';
import type { GitHubApiPrincipal } from '../../src/external-capabilities/github-api/operation-session.ts';
import {
  issueGitHubApiTestCapability,
  withGitHubApiTestSession,
  type GitHubApiTransport
} from '../../src/external-capabilities/github-api/test/operation-session.ts';
import { sha256 } from '../../src/system-architecture/foundation/runtime/canonical.ts';
import { issueSecOperationRequirementBindingContext } from '../../src/system-architecture/operation/requirement-binding-context.ts';
import {
  bindSecSemanticOperation,
  compileSecCapabilityBinding,
  compileSecSemanticOperationPlan,
  issueSecSemanticOperationAttemptContext,
  type SecOperationDigest
} from '../../src/system-architecture/operation/semantic.ts';

const GITHUB_REPOSITORY = 'sec-platform/sec';
const GITHUB_TOKEN = 'development-commit-test-token';
const GITHUB_PRINCIPAL: GitHubApiPrincipal = Object.freeze({
  transport: 'github-rest-token',
  login: 'maintainer',
  nodeId: 'MDQ6VXNlcjE=',
  userId: 900001,
  permission: 'maintain'
});

function git(root: string, args: readonly string[]): string {
  const result = spawnSync('git', [...args], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

async function fixture(): Promise<Readonly<{
  root: string;
  request: DevelopmentCommitRequest;
}>> {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-development-commit-'));
  git(root, ['init', '--quiet']);
  git(root, ['config', 'user.name', 'SEC Tests']);
  git(root, ['config', 'user.email', 'tests@example.com']);
  const moduleRoot = path.join(root, 'src', 'development', 'import-normalization');
  await mkdir(moduleRoot, { recursive: true });
  await Promise.all([
    writeFile(path.join(root, 'tsconfig.json'), '{"compilerOptions":{"noEmit":true}}\n'),
    writeFile(path.join(moduleRoot, 'kernel.ts'), 'export function normalize(): void {}\n'),
    writeFile(
      path.join(moduleRoot, 'runtime.ts'),
      "export { normalize as verifyCandidateImportNormalization } from './kernel.ts';\n"
    ),
    writeFile(path.join(moduleRoot, 'sec.module.json'), `${JSON.stringify({
      importGraph: 'runtime',
      externalEntrypoints: ['src/development/import-normalization/runtime.ts'],
      capabilityProviders: [{
        capability: IMPORT_NORMALIZATION_OPERATION.capability,
        operations: [IMPORT_NORMALIZATION_OPERATION.operation]
      }]
    })}\n`)
  ]);
  git(root, ['add', '--all']);
  git(root, ['commit', '--quiet', '-m', 'base']);
  await writeFile(path.join(root, 'next.txt'), 'next\n');
  git(root, ['add', 'next.txt']);
  return Object.freeze({
    root,
    request: Object.freeze({
      repositoryRoot: path.resolve(root),
      message: 'apply staged candidate\n',
      author: Object.freeze({
        name: 'SEC Tests',
        email: 'tests@example.com',
        date: '1700000100 +0000'
      }),
      committer: Object.freeze({
        name: 'SEC Tests',
        email: 'tests@example.com',
        date: '1700000100 +0000'
      })
    })
  });
}

function closedAbsentRetirementBinding() {
  const intentDigest = sha256({ fixture: 'closed-absent-development-commit-retirement' }) as SecOperationDigest;
  const deadlineAtUnixMs = Date.now() + 30_000;
  const operation = bindSecSemanticOperation(compileSecSemanticOperationPlan({
    operation: 'control.branch-lifecycle.closed-absent-development-commit-retirement',
    intentDigest,
    decisionDigest: intentDigest,
    deadlineAtUnixMs,
    attempt: issueSecSemanticOperationAttemptContext({ authorityGrantDigest: intentDigest }),
    aggregateBudgets: CLOSED_ABSENT_DEVELOPMENT_COMMIT_JOURNAL_RETIREMENT_RESOURCE_CEILINGS,
    requirements: [{
      id: CLOSED_ABSENT_DEVELOPMENT_COMMIT_JOURNAL_RETIREMENT_REQUIREMENT_ID,
      contractDigest: CLOSED_ABSENT_DEVELOPMENT_COMMIT_JOURNAL_RETIREMENT_CONTRACT_DIGEST,
      effectKinds: ['filesystem', 'process', 'provider'],
      failureKinds: [
        'filesystem.identity-drift',
        'filesystem.write-failed',
        'process.settlement-unproven',
        'process.unavailable'
      ]
    }]
  }), [compileSecCapabilityBinding({
    requirementId: CLOSED_ABSENT_DEVELOPMENT_COMMIT_JOURNAL_RETIREMENT_REQUIREMENT_ID,
    contractDigest: CLOSED_ABSENT_DEVELOPMENT_COMMIT_JOURNAL_RETIREMENT_CONTRACT_DIGEST,
    providerIdentityDigest: CLOSED_ABSENT_DEVELOPMENT_COMMIT_JOURNAL_RETIREMENT_PROVIDER_IDENTITY_DIGEST
  })]);
  return issueSecOperationRequirementBindingContext({
    operation,
    requirementId: CLOSED_ABSENT_DEVELOPMENT_COMMIT_JOURNAL_RETIREMENT_REQUIREMENT_ID,
    resourceCeilings: CLOSED_ABSENT_DEVELOPMENT_COMMIT_JOURNAL_RETIREMENT_RESOURCE_CEILINGS
  });
}

test('development.commit consumes one exact staged admission before publishing its Git Effect', async () => {
  const { root } = await fixture();
  try {
    const preimage = git(root, ['rev-parse', 'HEAD']);
    const prepared = await issueDevelopmentCommitAdmission({
      repositoryRoot: root,
      message: 'apply staged candidate\n'
    });
    const { request } = prepared;
    await expect(runDevelopmentCommit(
      request,
      { ...prepared.admission } as DevelopmentCommitAdmission
    )).rejects.toThrow('foreign or structurally reproduced');
    expect(git(root, ['rev-parse', 'HEAD'])).toBe(preimage);

    const result = await runDevelopmentCommit(request, prepared.admission);
    expect(result.disposition).toBe('applied');
    expect(result.preimage).toBe(preimage);
    expect(git(root, ['rev-parse', 'HEAD'])).toBe(result.target);
    expect(git(root, ['status', '--porcelain'])).toBe('');
    expect((await readFile(result.journalPath, 'utf8')).includes('"terminal":"applied"')).toBe(true);
    expect(() => acknowledgeDevelopmentCommitResult({ ...result }))
      .toThrow('owner-issued undelivered result');
    acknowledgeDevelopmentCommitResult(result);
    await expect(lstat(result.journalPath)).rejects.toMatchObject({ code: 'ENOENT' });
    const gitDirectory = git(root, ['rev-parse', '--absolute-git-dir']);
    await expect(lstat(path.join(gitDirectory, 'sec-development-commit')))
      .rejects.toMatchObject({ code: 'ENOENT' });
    expect(() => acknowledgeDevelopmentCommitResult(result))
      .toThrow('owner-issued undelivered result');
    await expect(runDevelopmentCommit(request, prepared.admission))
      .rejects.toThrow('already been consumed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 20_000);

test('development.commit distinguishes genuine missing objects from unresolved Git observations', async () => {
  const { root } = await fixture();
  try {
    const ref = git(root, ['symbolic-ref', 'HEAD']);
    const preimage = git(root, ['rev-parse', 'HEAD']);
    const tree = git(root, ['write-tree']);
    const missingTarget = 'f'.repeat(40);
    const commonDirectory = git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
    const journal = Object.freeze({
      schema: 'sec-development-commit-journal-v1' as const,
      operation: `sha256:${'1'.repeat(64)}` as const,
      attempt: `sha256:${'2'.repeat(64)}` as const,
      ref,
      preimage,
      target: missingTarget,
      object: null,
      tree,
      terminal: null
    });
    const dispositions = await withAuthorityGitReadSession({
      cwd: root,
      budget: GIT_READ_OPERATION_BUDGET
    }, async (session) => {
      const missing = await readDevelopmentCommitOutcome({
        session,
        commonDirectory,
        journal,
        normal: null
      });
      const rejectedSession = Object.freeze({
        ...session,
        run: async (args: readonly string[], options?: Parameters<GitReadSession['run']>[1]) => (
          args[0] === 'cat-file'
            ? Object.freeze({
              kind: 'completed' as const,
              result: Object.freeze({
                code: 128,
                stdout: new Uint8Array(),
                stderr: 'injected completed Git failure'
              })
            })
            : await session.run(args, options)
        )
      }) as GitReadSession;
      const rejected = await readDevelopmentCommitOutcome({
        session: rejectedSession,
        commonDirectory,
        journal,
        normal: null
      });
      const unresolvedSession = Object.freeze({
        ...session,
        run: async (args: readonly string[], options?: Parameters<GitReadSession['run']>[1]) => (
          args[0] === 'cat-file' && args[1] === '-t'
            ? Object.freeze({
              kind: 'unresolved-git-read-session' as const,
              reason: 'command-error' as const,
              detail: 'injected object observation failure'
            })
            : await session.run(args, options)
        )
      }) as GitReadSession;
      const unresolved = await readDevelopmentCommitOutcome({
        session: unresolvedSession,
        commonDirectory,
        journal,
        normal: null
      });
      return Object.freeze({
        missing: missing.disposition,
        rejected: rejected.disposition,
        unresolved: unresolved.disposition
      });
    });
    expect(dispositions).toEqual({
      missing: 'not-applied',
      rejected: 'unknown',
      unresolved: 'unknown'
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 20_000);

test('development.commit retires a merged PR journal as a consumed transport without reclassifying it applied', async () => {
  const { root, request } = await fixture();
  let topicWorktree: string | null = null;
  try {
    git(root, ['branch', '-m', 'main']);
    git(root, ['remote', 'add', 'origin', `https://github.com/${GITHUB_REPOSITORY}.git`]);
    const preimage = git(root, ['rev-parse', 'HEAD']);
    const topic = 'test-design-topic';
    git(root, ['switch', '--quiet', '-c', topic]);
    const prepared = await issueDevelopmentCommitAdmission({ request });
    const committed = await runDevelopmentCommit(request, prepared.admission);
    expect(committed.disposition).toBe('applied');
    const journalSource = await readFile(committed.journalPath, 'utf8');

    const unrelatedPath = path.join(path.dirname(committed.journalPath), `${'b'.repeat(64)}.json`);
    const unrelated = JSON.parse(journalSource) as Record<string, unknown>;
    unrelated.ref = 'refs/heads/unrelated-topic';
    await writeFile(unrelatedPath, `${JSON.stringify(unrelated)}\n`, 'utf8');

    git(root, ['switch', '--quiet', 'main']);
    git(root, ['merge', '--quiet', '--no-ff', '-m', 'merge test design topic', topic]);
    const mergeSha = git(root, ['rev-parse', 'HEAD']);
    topicWorktree = path.join(path.dirname(root), `${path.basename(root)}-topic-worktree`);
    git(root, ['worktree', 'add', '--quiet', topicWorktree, topic]);
    git(root, ['update-ref', '-d', `refs/heads/${topic}`]);
    expect(git(root, ['branch', '--list', topic])).toBe('');
    const reflog = spawnSync('git', ['reflog', 'exists', `refs/heads/${topic}`], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true
    });
    expect(reflog.status).not.toBe(0);

    const capability = (input: Readonly<{
      headSha: string;
      pullExists?: boolean;
      remoteTopicExists?: boolean;
    }>) => issueGitHubApiTestCapability({
      repository: GITHUB_REPOSITORY,
      token: GITHUB_TOKEN,
      principal: GITHUB_PRINCIPAL,
      effect: 'read',
      transport: (async (target) => {
        const pathname = new URL(String(target)).pathname;
        if (pathname === `/repos/${GITHUB_REPOSITORY}`) {
          return Response.json({ full_name: GITHUB_REPOSITORY, default_branch: 'main' });
        }
        if (pathname === `/repos/${GITHUB_REPOSITORY}/pulls/600`) {
          if (input.pullExists === false) {
            return Response.json({ message: 'Not Found' }, { status: 404 });
          }
          return Response.json({
            number: 600,
            state: 'closed',
            merged: true,
            merge_commit_sha: mergeSha,
            head: { ref: topic, sha: input.headSha, repo: { full_name: GITHUB_REPOSITORY } },
            base: { ref: 'main', repo: { full_name: GITHUB_REPOSITORY } }
          });
        }
        if (pathname === `/repos/${GITHUB_REPOSITORY}/git/ref/heads/${topic}`) {
          return input.remoteTopicExists === true
            ? Response.json({ ref: `refs/heads/${topic}`, object: { sha: committed.target } })
            : Response.json({ message: 'Not Found' }, { status: 404 });
        }
        if (pathname === `/repos/${GITHUB_REPOSITORY}/git/ref/heads/main`) {
          return Response.json({ ref: 'refs/heads/main', object: { sha: mergeSha } });
        }
        return Response.json({ message: `Unexpected path ${pathname}` }, { status: 500 });
      }) satisfies GitHubApiTransport
    });
    const retire = async (api: ReturnType<typeof capability>) => await withGitHubApiTestSession({
      capability: api,
      operation: async () => await retireMergedDevelopmentCommitJournals({
        repositoryRoot: root,
        capability: api,
        pullRequestNumber: 600
      })
    });

    git(root, ['remote', 'set-url', 'origin', 'https://github.com/other/repository.git']);
    await expect(retire(capability({ headSha: committed.target })))
      .rejects.toThrow('repository');
    expect(await readFile(committed.journalPath, 'utf8')).toBe(journalSource);
    git(root, ['remote', 'set-url', 'origin', `https://github.com/${GITHUB_REPOSITORY}.git`]);

    await expect(retire(capability({ headSha: committed.target })))
      .rejects.toThrow('worktree consumer');
    expect(await readFile(committed.journalPath, 'utf8')).toBe(journalSource);
    git(root, ['worktree', 'remove', '--force', topicWorktree]);
    topicWorktree = null;

    await expect(retire(capability({ headSha: committed.target, pullExists: false })))
      .rejects.toThrow();
    expect(await readFile(committed.journalPath, 'utf8')).toBe(journalSource);

    await expect(retire(capability({ headSha: committed.target, remoteTopicExists: true })))
      .rejects.toThrow('still has a remote ref consumer');
    expect(await readFile(committed.journalPath, 'utf8')).toBe(journalSource);

    await expect(retire(capability({ headSha: preimage })))
      .rejects.toThrow('did not consume this exact journal target');
    expect(await readFile(committed.journalPath, 'utf8')).toBe(journalSource);

    const retired = await retire(capability({ headSha: committed.target }));
    expect(retired).toEqual({
      ref: `refs/heads/${topic}`,
      observed: 1,
      retired: 1
    });
    expect('disposition' in retired).toBe(false);
    await expect(lstat(committed.journalPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(unrelatedPath, 'utf8')).toBe(`${JSON.stringify(unrelated)}\n`);
  } finally {
    if (topicWorktree !== null) {
      spawnSync('git', ['worktree', 'remove', '--force', topicWorktree], {
        cwd: root,
        encoding: 'utf8',
        windowsHide: true
      });
      await rm(topicWorktree, { recursive: true, force: true });
    }
    await rm(root, { recursive: true, force: true });
  }
}, 40_000);

test('development.commit retires only an owner-planned closed-absent PR journal family', async () => {
  const { root, request } = await fixture();
  try {
    git(root, ['branch', '-m', 'main']);
    git(root, ['remote', 'add', 'origin', `https://github.com/${GITHUB_REPOSITORY}.git`]);
    const preimage = git(root, ['rev-parse', 'HEAD']);
    const topic = 'closed-absent-topic';
    git(root, ['switch', '--quiet', '-c', topic]);
    const prepared = await issueDevelopmentCommitAdmission({ request });
    const committed = await runDevelopmentCommit(request, prepared.admission);
    const journalSource = await readFile(committed.journalPath, 'utf8');
    git(root, ['switch', '--quiet', 'main']);
    git(root, ['update-ref', '-d', `refs/heads/${topic}`]);

    const capability = (headSha: string) => issueGitHubApiTestCapability({
      repository: GITHUB_REPOSITORY,
      token: GITHUB_TOKEN,
      principal: GITHUB_PRINCIPAL,
      effect: 'read',
      transport: (async (target) => {
        const pathname = new URL(String(target)).pathname;
        if (pathname === `/repos/${GITHUB_REPOSITORY}`) {
          return Response.json({ full_name: GITHUB_REPOSITORY, default_branch: 'main' });
        }
        if (pathname === `/repos/${GITHUB_REPOSITORY}/pulls/601`) {
          return Response.json({
            number: 601,
            state: 'closed',
            merged: false,
            head: { ref: topic, sha: headSha, repo: { full_name: GITHUB_REPOSITORY } },
            base: { ref: 'main', repo: { full_name: GITHUB_REPOSITORY } }
          });
        }
        if (pathname === `/repos/${GITHUB_REPOSITORY}/git/ref/heads/${topic}`) {
          return Response.json({ message: 'Not Found' }, { status: 404 });
        }
        return Response.json({ message: `Unexpected path ${pathname}` }, { status: 500 });
      }) satisfies GitHubApiTransport
    });
    const prepare = async (api: ReturnType<typeof capability>) =>
      await prepareClosedAbsentDevelopmentCommitJournalRetirement({
        repositoryRoot: root,
        ref: `refs/heads/${topic}`,
        capability: api,
        pullRequestNumber: 601,
        requirementBindingContext: closedAbsentRetirementBinding()
      });

    const wrongHeadCapability = capability(preimage);
    await withGitHubApiTestSession({
      capability: wrongHeadCapability,
      operation: async () => {
        await expect(prepare(wrongHeadCapability)).rejects.toThrow('did not consume this exact journal target');
      }
    });
    expect(await readFile(committed.journalPath, 'utf8')).toBe(journalSource);

    const unknownPath = path.join(path.dirname(committed.journalPath), `${'c'.repeat(64)}.json`);
    const unknown = { ...JSON.parse(journalSource) as Record<string, unknown>, terminal: 'unknown' };
    const unknownSource = `${JSON.stringify(unknown)}\n`;
    await writeFile(unknownPath, unknownSource, 'utf8');
    const unknownCapability = capability(committed.target);
    await withGitHubApiTestSession({
      capability: unknownCapability,
      operation: async () => {
        await expect(prepare(unknownCapability)).rejects.toThrow('nonterminal or unknown');
      }
    });
    expect(await readFile(committed.journalPath, 'utf8')).toBe(journalSource);
    expect(await readFile(unknownPath, 'utf8')).toBe(unknownSource);
    await rm(unknownPath);

    const retirementCapability = capability(committed.target);
    await withGitHubApiTestSession({
      capability: retirementCapability,
      operation: async () => {
        const plan = await prepare(retirementCapability);
        await expect(acknowledgeClosedAbsentDevelopmentCommitJournalRetirement(
          { ...plan }
        )).rejects.toThrow('owner-issued plan');
        await writeFile(committed.journalPath, `${journalSource} `, 'utf8');
        await expect(acknowledgeClosedAbsentDevelopmentCommitJournalRetirement(plan))
          .rejects.toThrow();
        expect(await readFile(committed.journalPath, 'utf8')).toBe(`${journalSource} `);
        await writeFile(committed.journalPath, journalSource, 'utf8');
        expect(await acknowledgeClosedAbsentDevelopmentCommitJournalRetirement(plan)).toEqual({
          ref: `refs/heads/${topic}`,
          observed: 1,
          retired: 1
        });
        await expect(acknowledgeClosedAbsentDevelopmentCommitJournalRetirement(plan))
          .rejects.toThrow('owner-issued plan');
      }
    });
    await expect(lstat(committed.journalPath)).rejects.toMatchObject({ code: 'ENOENT' });

    const noWorkCapability = issueGitHubApiTestCapability({
      repository: GITHUB_REPOSITORY,
      token: GITHUB_TOKEN,
      principal: GITHUB_PRINCIPAL,
      effect: 'read',
      transport: async () => Response.json(
        { message: 'zero-work retirement must not use provider transport' },
        { status: 500 }
      )
    });
    await withGitHubApiTestSession({
      capability: noWorkCapability,
      operation: async () => {
        const emptyPlan = await prepareClosedAbsentDevelopmentCommitJournalRetirement({
          repositoryRoot: root,
          ref: `refs/heads/${topic}`,
          capability: noWorkCapability,
          pullRequestNumber: 601,
          requirementBindingContext: closedAbsentRetirementBinding()
        });
        expect(await acknowledgeClosedAbsentDevelopmentCommitJournalRetirement(emptyPlan)).toEqual({
          ref: `refs/heads/${topic}`,
          observed: 0,
          retired: 0
        });
      }
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 50_000);

test('development.commit exact-ref settlement classifies every matching lost-handle journal before retirement', async () => {
  const { root, request } = await fixture();
  try {
    const ref = git(root, ['symbolic-ref', 'HEAD']);
    const preimage = git(root, ['rev-parse', 'HEAD']);
    const prepared = await issueDevelopmentCommitAdmission({ request });
    let journalPath = '';
    try {
      await runDevelopmentCommitForTests(request, prepared.admission, {
        afterRefUpdateBeforeReadback: (candidateJournalPath) => {
          journalPath = candidateJournalPath;
          throw new Error('simulated settlement handoff');
        }
      });
    } catch (error) {
      expect(error).toBeInstanceOf(DevelopmentCommitLostHandleError);
    }
    expect(journalPath.length).toBeGreaterThan(0);
    const pendingSource = await readFile(journalPath, 'utf8');
    expect(pendingSource).toContain('"terminal":null');
    const unknownPath = path.join(path.dirname(journalPath), `${'a'.repeat(64)}.json`);
    const unknown = JSON.parse(pendingSource) as Record<string, unknown>;
    const unknownTarget = git(root, [
      'commit-tree', `${preimage}^{tree}`, '-p', preimage, '-m', 'unpublished census observation'
    ]);
    unknown.object = unknownTarget;
    unknown.preimage = preimage;
    unknown.target = unknownTarget;
    unknown.tree = git(root, ['rev-parse', `${preimage}^{tree}`]);
    unknown.terminal = 'unknown';
    await writeFile(unknownPath, `${JSON.stringify(unknown)}\n`, 'utf8');
    await expect(settleDevelopmentCommitJournalsForRef({ repositoryRoot: root, ref }))
      .rejects.toThrow('requires applied readback, got unknown');
    expect(await readFile(journalPath, 'utf8')).toBe(pendingSource);
    await rm(unknownPath);

    await expect(settleDevelopmentCommitJournalsForRef({ repositoryRoot: root, ref }))
      .resolves.toEqual({ ref, observed: 1, retired: 1 });
    await expect(lstat(journalPath)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 20_000);

test('development.commit applied retry retires every exact not-applied predecessor in its Effect family', async () => {
  const { root, request } = await fixture();
  try {
    const firstPrepared = await issueDevelopmentCommitAdmission({ request });
    let predecessorPath = '';
    try {
      await runDevelopmentCommitForTests(request, firstPrepared.admission, {
        afterObjectJournaled: (candidateJournalPath) => {
          predecessorPath = candidateJournalPath;
          throw new Error('simulated loss before ref publication');
        }
      });
    } catch (error) {
      expect(String(error)).toContain('simulated loss before ref publication');
    }
    expect(predecessorPath.length).toBeGreaterThan(0);
    const recovery = await recoverDevelopmentCommit({
      repositoryRoot: root,
      journalPath: predecessorPath
    });
    expect(recovery.result.disposition).toBe('not-applied');
    expect(await readFile(predecessorPath, 'utf8')).toContain('"terminal":"not-applied"');

    const retryPrepared = await issueDevelopmentCommitAdmission({ request });
    const retry = await retryDevelopmentCommit({
      request,
      admission: retryPrepared.admission,
      recovery
    });
    expect(retry.disposition).toBe('applied');
    expect(await readFile(retry.journalPath, 'utf8')).toContain('"terminal":"applied"');
    acknowledgeDevelopmentCommitResult(retry);
    await expect(lstat(predecessorPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(lstat(retry.journalPath)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);

test('development.commit retry reserves the exact-ref journal ceiling before ref publication', async () => {
  const { root, request } = await fixture();
  try {
    const preimage = git(root, ['rev-parse', 'HEAD']);
    const prepared = await issueDevelopmentCommitAdmission({ request });
    let predecessorPath = '';
    await expect(runDevelopmentCommitForTests(request, prepared.admission, {
      afterObjectJournaled: (journalPath) => {
        predecessorPath = journalPath;
        throw new Error('retain not-applied ceiling fixture');
      }
    })).rejects.toThrow('retain not-applied ceiling fixture');
    const recovery = await recoverDevelopmentCommit({ repositoryRoot: root, journalPath: predecessorPath });
    expect(recovery.result.disposition).toBe('not-applied');
    const predecessorSource = await readFile(predecessorPath, 'utf8');
    const copies: string[] = [];
    for (let index = 1; index <= 11; index += 1) {
      const copy = path.join(path.dirname(predecessorPath), `${index.toString(16).padStart(64, '0')}.json`);
      await writeFile(copy, predecessorSource, 'utf8');
      copies.push(copy);
    }

    const blockedAdmission = await issueDevelopmentCommitAdmission({ request });
    await expect(retryDevelopmentCommit({ request, admission: blockedAdmission.admission, recovery }))
      .rejects.toThrow('exact-ref attempt ceiling is already full');
    expect(git(root, ['rev-parse', 'HEAD'])).toBe(preimage);
    expect(await readFile(predecessorPath, 'utf8')).toBe(predecessorSource);

    await rm(copies.pop()!);
    const boundaryAdmission = await issueDevelopmentCommitAdmission({ request });
    const boundary = await retryDevelopmentCommit({
      request,
      admission: boundaryAdmission.admission,
      recovery
    });
    expect(boundary.disposition).toBe('applied');
    acknowledgeDevelopmentCommitResult(boundary);
    await expect(lstat(predecessorPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(git(root, ['rev-parse', 'HEAD'])).toBe(boundary.target);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 40_000);

test('development.commit cancels delivered not-applied only while fresh native proof remains exact', async () => {
  const { root, request } = await fixture();
  try {
    const prepared = await issueDevelopmentCommitAdmission({ request });
    let journalPath = '';
    await expect(runDevelopmentCommitForTests(request, prepared.admission, {
      afterObjectJournaled: (candidateJournalPath) => {
        journalPath = candidateJournalPath;
        throw new Error('retain delivered not-applied fixture');
      }
    })).rejects.toThrow('retain delivered not-applied fixture');
    const recovery = await recoverDevelopmentCommit({ repositoryRoot: root, journalPath });
    expect(recovery.result.disposition).toBe('not-applied');
    await expect(acknowledgeNotAppliedDevelopmentCommitResult({ ...recovery.result }))
      .rejects.toThrow('owner-issued unacknowledged result');
    await acknowledgeNotAppliedDevelopmentCommitResult(recovery.result);
    await expect(lstat(journalPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(acknowledgeNotAppliedDevelopmentCommitResult(recovery.result))
      .rejects.toThrow('owner-issued unacknowledged result');

    const secondPrepared = await issueDevelopmentCommitAdmission({ request });
    let advancedJournalPath = '';
    await expect(runDevelopmentCommitForTests(request, secondPrepared.admission, {
      afterObjectJournaled: (candidateJournalPath) => {
        advancedJournalPath = candidateJournalPath;
        throw new Error('retain advanced not-applied fixture');
      }
    })).rejects.toThrow('retain advanced not-applied fixture');
    const advancedRecovery = await recoverDevelopmentCommit({ repositoryRoot: root, journalPath: advancedJournalPath });
    expect(advancedRecovery.result.disposition).toBe('not-applied');
    git(root, ['commit', '--quiet', '-m', 'advance without publishing retained target']);
    await expect(acknowledgeNotAppliedDevelopmentCommitResult(advancedRecovery.result))
      .rejects.toThrow('fresh readback is unknown');
    expect(await readFile(advancedJournalPath, 'utf8')).toContain('"terminal":"not-applied"');
    const unknown = await recoverDevelopmentCommit({ repositoryRoot: root, journalPath: advancedJournalPath });
    expect(unknown.result.disposition).toBe('unknown');
    await expect(acknowledgeNotAppliedDevelopmentCommitResult(unknown.result))
      .rejects.toThrow('requires not-applied readback');
    expect(await readFile(advancedJournalPath, 'utf8')).toContain('"terminal":"unknown"');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 40_000);

test('development.commit recovers an exact historical ref transition after ref advance and checkout, then retires on delivery', async () => {
  const { root, request } = await fixture();
  try {
    const preimage = git(root, ['rev-parse', 'HEAD']);
    const prepared = await issueDevelopmentCommitAdmission({ request });
    let lostHandle: DevelopmentCommitLostHandleError | null = null;
    try {
      await runDevelopmentCommitForTests(request, prepared.admission, {
        afterRefUpdateBeforeReadback: () => { throw new Error('simulated consumer loss'); }
      });
    } catch (error) {
      expect(error).toBeInstanceOf(DevelopmentCommitLostHandleError);
      lostHandle = error as DevelopmentCommitLostHandleError;
    }
    expect(lostHandle).not.toBeNull();
    const publishedTarget = git(root, ['rev-parse', 'HEAD']);
    expect(publishedTarget).not.toBe(preimage);

    await writeFile(path.join(root, 'later.txt'), 'later\n');
    git(root, ['add', 'later.txt']);
    git(root, ['commit', '--quiet', '-m', 'later ref advance']);
    const advancedTarget = git(root, ['rev-parse', 'HEAD']);
    expect(advancedTarget).not.toBe(publishedTarget);
    git(root, ['switch', '--quiet', '-c', 'observer', preimage]);
    expect(git(root, ['write-tree'])).not.toBe(git(root, ['rev-parse', `${publishedTarget}^{tree}`]));
    const staleNotApplied = JSON.parse(
      await readFile(lostHandle!.journalPath, 'utf8')
    ) as Record<string, unknown>;
    staleNotApplied.terminal = 'not-applied';
    await writeFile(lostHandle!.journalPath, `${JSON.stringify(staleNotApplied)}\n`, 'utf8');

    const recovery = await recoverDevelopmentCommit({
      repositoryRoot: root,
      journalPath: lostHandle!.journalPath
    });
    expect(recovery.result).toMatchObject({
      disposition: 'applied',
      preimage,
      target: publishedTarget
    });
    expect(git(root, ['rev-parse', advancedTarget])).toBe(advancedTarget);
    acknowledgeDevelopmentCommitResult(recovery.result);
    await expect(lstat(lostHandle!.journalPath)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 20_000);

test('development.commit refuses to retire applied journal bytes that drift after result issue', async () => {
  const { root, request } = await fixture();
  try {
    const prepared = await issueDevelopmentCommitAdmission({ request });
    const result = await runDevelopmentCommit(request, prepared.admission);
    expect(result.disposition).toBe('applied');
    const terminal = await readFile(result.journalPath, 'utf8');
    const drifted = `${terminal} `;
    await writeFile(result.journalPath, drifted, 'utf8');
    expect(() => acknowledgeDevelopmentCommitResult(result))
      .toThrow('changed before exact terminal retirement');
    expect(await readFile(result.journalPath, 'utf8')).toBe(drifted);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 20_000);

test('development.commit reports failed staged normalization without publishing the candidate', async () => {
  const { root, request } = await fixture();
  try {
    const kernelPath = 'src/development/import-normalization/kernel.ts';
    await writeFile(path.join(root, kernelPath),
      "import path from 'node:path';\nimport fs from 'node:fs';\nexport function normalize(): void { void fs; void path; }\n");
    git(root, ['add', '--', kernelPath]);
    const before = {
      head: git(root, ['rev-parse', 'HEAD']),
      tree: git(root, ['write-tree'])
    };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(issueDevelopmentCommitAdmission({ request }))
        .rejects.toThrow('Candidate import normalization blocked commit: failed; action sha256:');
      expect({
        head: git(root, ['rev-parse', 'HEAD']),
        tree: git(root, ['write-tree'])
      }).toEqual(before);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 20_000);

test('development.commit rejects missing admission before repository Effect', async () => {
  const { root, request } = await fixture();
  try {
    const before = Object.freeze({
      head: git(root, ['rev-parse', 'HEAD']),
      tree: git(root, ['write-tree']),
      objects: git(root, ['count-objects', '-v'])
    });
    await expect(runDevelopmentCommit(
      request,
      Object.freeze({}) as DevelopmentCommitAdmission
    )).rejects.toThrow('foreign or structurally reproduced');
    expect({
      head: git(root, ['rev-parse', 'HEAD']),
      tree: git(root, ['write-tree']),
      objects: git(root, ['count-objects', '-v'])
    }).toEqual(before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('development.commit rejects a real unfinished merge without publishing or consuming its state', async () => {
  const { root, request } = await fixture();
  try {
    const base = git(root, ['rev-parse', 'HEAD']);
    git(root, ['commit', '--quiet', '-m', 'current branch delta']);
    const currentBranch = git(root, ['symbolic-ref', '--short', 'HEAD']);
    git(root, ['switch', '--quiet', '-c', 'incoming', base]);
    await writeFile(path.join(root, 'incoming.txt'), 'incoming\n');
    git(root, ['add', 'incoming.txt']);
    git(root, ['commit', '--quiet', '-m', 'incoming delta']);
    git(root, ['switch', '--quiet', currentBranch]);
    git(root, ['merge', '--no-commit', '--no-ff', 'incoming']);
    const gitDirectory = git(root, ['rev-parse', '--absolute-git-dir']);
    const observe = async () => ({
      head: git(root, ['rev-parse', 'HEAD']),
      tree: git(root, ['write-tree']),
      objects: git(root, ['count-objects', '-v']),
      mergeHead: await readFile(path.join(gitDirectory, 'MERGE_HEAD'), 'utf8')
    });
    const before = await observe();
    await expect(issueDevelopmentCommitAdmission({ request }))
      .rejects.toThrow('unfinished Git operation: MERGE_HEAD');
    expect(await observe()).toEqual(before);
    await expect(lstat(path.join(gitDirectory, 'sec-development-commit')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 20_000);

test('development.commit fences sequencer state introduced after admission', async () => {
  const { root, request } = await fixture();
  try {
    const prepared = await issueDevelopmentCommitAdmission({ request });
    const gitDirectory = git(root, ['rev-parse', '--absolute-git-dir']);
    await mkdir(path.join(gitDirectory, 'sequencer'));
    const before = {
      head: git(root, ['rev-parse', 'HEAD']),
      tree: git(root, ['write-tree']),
      objects: git(root, ['count-objects', '-v'])
    };
    await expect(runDevelopmentCommit(request, prepared.admission))
      .rejects.toThrow('unfinished Git operation: sequencer');
    expect({
      head: git(root, ['rev-parse', 'HEAD']),
      tree: git(root, ['write-tree']),
      objects: git(root, ['count-objects', '-v'])
    }).toEqual(before);
    await expect(lstat(path.join(gitDirectory, 'sec-development-commit')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 20_000);
