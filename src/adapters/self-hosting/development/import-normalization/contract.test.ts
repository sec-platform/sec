import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, expect, test } from 'bun:test';
import { settleWorkspaceCallback } from '../../../../../tests/testkit/workspace-cleanup.ts';
import { rawSha256 } from '../../../../contracts/canonical.ts';
import { withAuthorityGitReadOperation, withAuthorityGitReadSession } from '../../../providers/git-read/authority.ts';
import { GIT_READ_EXACT_TREE_OPERATION_BUDGET } from '../../../providers/git-read/runtime/session.ts';
import {
  compileSourceProgramOperationProducerClosure,
  compileSourceProgramOperationProducerClosureFromWorkspaceSnapshot
} from '../../../repository/source-program-model/producer-closure.ts';
import { compileRepositorySourceProgramCompilation } from '../../../repository/source-program-model/repository-compilation.ts';
import {
  sourceProgramTypeScriptCompilerIdentity
} from '../../../repository/source-program-model/typescript.ts';
import {
  acquireExactGitTreeWorkspaceSourceSnapshotFromSession
} from '../../../repository/source-program-model/workspace-source-snapshot.ts';
import { GIT_READ_OPERATION_BUDGET } from '../tooling/git/git-read.ts';
import {
  CANDIDATE_NORMALIZATION_DURATION_MS,
  compileCandidateNormalizationActionKey,
  compileCandidateNormalizationSubject,
  IMPORT_NORMALIZATION_OPERATION,
  requireCandidateNormalizationSubject
} from './contract.ts';
import { checkImmutableImportSnapshot } from './kernel.ts';

function git(root: string, args: readonly string[]): string {
  const result = spawnSync('git', [...args], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

async function verifyCandidate(input: Readonly<{
  repositoryRoot: string;
  candidateBase: string;
  candidateCommit: string;
}>) {
  const { verifyCandidateImportNormalization } = await import('./runtime.ts');
  return verifyCandidateImportNormalization(input);
}

async function commitFixture(
  root: string,
  kernel: string,
  note: string,
  projectConfig = '{"compilerOptions":{"noEmit":true}}\n'
): Promise<string> {
  await mkdir(path.join(root, 'src', 'adapters', 'self-hosting', 'development', 'import-normalization'), { recursive: true });
  const writes = await Promise.allSettled([
    writeFile(path.join(root, 'tsconfig.json'), projectConfig),
    writeFile(path.join(root, 'note.txt'), `${note}\n`),
    writeFile(path.join(root, 'src', 'subject.ts'), 'export const subject = true;\n'),
    writeFile(path.join(root, 'src', 'adapters', 'self-hosting', 'development', 'import-normalization', 'kernel.ts'), kernel),
    writeFile(
      path.join(root, 'src', 'adapters', 'self-hosting', 'development', 'import-normalization', 'runtime.ts'),
      "import { normalize } from './kernel.ts';\nexport const verifyCandidateImportNormalization = normalize;\n"
    ),
    writeFile(
      path.join(root, 'src', 'adapters', 'self-hosting', 'development', 'import-normalization', 'module.json'),
      `${JSON.stringify({
        importGraph: 'runtime',
        externalEntrypoints: ['src/adapters/self-hosting/development/import-normalization/runtime.ts'],
        capabilityProviders: [{
          capability: IMPORT_NORMALIZATION_OPERATION.capability,
          operations: [IMPORT_NORMALIZATION_OPERATION.operation]
        }]
      })}\n`
    )
  ]);
  const failures = writes.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(failures, 'Import normalization fixture writes failed', { cause: failures[0] });
  }
  git(root, ['add', '--all']);
  git(root, ['-c', 'user.name=SEC Tests', '-c', 'user.email=tests@example.com', 'commit', '--quiet', '-m', note]);
  return git(root, ['rev-parse', 'HEAD']);
}

// Reuse the initialized Git precondition for both the ordinary
// committed template and the two noncanonical-import cases. No case shares
// index, refs, objects or worktree after its private copy is created.
let initializedRepository: Promise<string> | undefined;
async function initializedGitRepository(): Promise<string> {
  if (initializedRepository !== undefined) return initializedRepository;
  const preparing = (async () => {
    const template = await mkdtemp(path.join(tmpdir(), 'sec-import-git-empty-base-'));
    try {
      git(template, ['init', '--quiet']);
      return template;
    } catch (primary) {
      return settleWorkspaceCallback(async () => { throw primary; },
        () => rm(template, { recursive: true, force: true }));
    }
  })();
  const retained = preparing.catch((error) => {
    if (initializedRepository === retained) initializedRepository = undefined;
    throw error;
  });
  initializedRepository = retained;
  return retained;
}
async function copyInitializedGitRepository(root: string): Promise<void> {
  await cp(await initializedGitRepository(), root, { recursive: true });
}

let defaultRepository: Promise<string> | undefined;
async function retainedDefaultRepository(): Promise<string> {
  if (defaultRepository !== undefined) return defaultRepository;
  const preparing = (async () => {
    const template = await mkdtemp(path.join(tmpdir(), 'sec-import-normalization-base-'));
    try {
      await copyInitializedGitRepository(template);
      await commitFixture(template, 'export function normalize(): void {}\n', 'base');
      return template;
    } catch (primary) {
      return settleWorkspaceCallback(async () => { throw primary; },
        () => rm(template, { recursive: true, force: true }));
    }
  })();
  const retained = preparing.catch((error) => {
    if (defaultRepository === retained) defaultRepository = undefined;
    throw error;
  });
  defaultRepository = retained;
  return retained;
}
async function copyDefaultRepository(root: string): Promise<string> {
  await cp(await retainedDefaultRepository(), root, { recursive: true });
  return git(root, ['rev-parse', 'HEAD']);
}

afterAll(async () => {
  const pending = [defaultRepository, initializedRepository].filter(
    (value): value is Promise<string> => value !== undefined
  );
  const settled = await Promise.allSettled(pending);
  const failures: unknown[] = [];
  for (const outcome of settled) {
    if (outcome.status !== 'fulfilled') continue;
    try { await rm(outcome.value, { recursive: true, force: true }); }
    catch (failure) { failures.push(failure); }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, 'Import Git template cleanup failed');
});

async function exactSnapshot(root: string, commitSha: string) {
  return withAuthorityGitReadSession({
    cwd: root,
    budget: GIT_READ_EXACT_TREE_OPERATION_BUDGET
  }, (session) => acquireExactGitTreeWorkspaceSourceSnapshotFromSession({ session, commitSha }));
}

async function subject(root: string, commitSha: string) {
  const snapshot = await exactSnapshot(root, commitSha);
  const sourceProgramCompilation = compileRepositorySourceProgramCompilation({
    workspaceSnapshot: snapshot
  });
  const producerClosure = compileSourceProgramOperationProducerClosure(
    sourceProgramCompilation,
    IMPORT_NORMALIZATION_OPERATION
  );
  return compileCandidateNormalizationSubject({
    snapshot,
    baseSnapshot: snapshot,
    producerClosure,
    compilerIdentity: sourceProgramTypeScriptCompilerIdentity()
  });
}

test('subject compiler owns producer, exact-tree, config and toolchain identity', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-import-normalization-subject-'));
  return settleWorkspaceCallback(async () => {
    const firstCommit = await copyDefaultRepository(root);
    const firstSnapshot = await exactSnapshot(root, firstCommit);
    const fullProducer = compileSourceProgramOperationProducerClosure(
      compileRepositorySourceProgramCompilation({ workspaceSnapshot: firstSnapshot }),
      IMPORT_NORMALIZATION_OPERATION
    );
    const narrowProducer = compileSourceProgramOperationProducerClosureFromWorkspaceSnapshot(
      firstSnapshot,
      IMPORT_NORMALIZATION_OPERATION
    );
    expect(narrowProducer).toEqual(fullProducer);
    const first = compileCandidateNormalizationSubject({
      snapshot: firstSnapshot,
      baseSnapshot: firstSnapshot,
      producerClosure: fullProducer,
      compilerIdentity: sourceProgramTypeScriptCompilerIdentity()
    });
    const firstAction = compileCandidateNormalizationActionKey(first);
    expect(firstAction.inputClosure).toEqual(first.observationBlobs);
    expect(requireCandidateNormalizationSubject(first)).toBe(first);
    expect(() => requireCandidateNormalizationSubject({ ...first })).toThrow('not owner-issued');
    const noteOnlyCommit = await commitFixture(
      root,
      'export function normalize(): void {}\n',
      'note-only'
    );
    const noteOnly = await subject(root, noteOnlyCommit);
    expect(noteOnly.candidateIdentity).not.toEqual(first.candidateIdentity);
    expect(compileCandidateNormalizationActionKey(noteOnly).actionKey).toBe(firstAction.actionKey);

    const configCommit = await commitFixture(
      root,
      'export function normalize(): void {}\n',
      'config-change',
      '{"compilerOptions":{"noEmit":true,"strict":true}}\n'
    );
    const configChanged = await subject(root, configCommit);
    expect(configChanged.configurationDigest).not.toBe(first.configurationDigest);
    expect(compileCandidateNormalizationActionKey(configChanged).actionKey)
      .not.toBe(firstAction.actionKey);

    const producerCommit = await commitFixture(
      root,
      'export function normalize(): void { console.log("changed"); }\n',
      'producer-change',
      '{"compilerOptions":{"noEmit":true}}\n'
    );
    const producerChanged = await subject(root, producerCommit);
    expect(producerChanged.producerClosureDigest).not.toBe(first.producerClosureDigest);
    expect(compileCandidateNormalizationActionKey(producerChanged).actionKey)
      .not.toBe(firstAction.actionKey);
  }, () => rm(root, { recursive: true, force: true }));
});

test('empty owner selection settles before project parsing', () => {
  const source = '{not-json';
  const digest = rawSha256(source);
  expect(checkImmutableImportSnapshot({
    projectRoot: path.resolve(import.meta.dir, 'empty-selection-fixture'),
    files: [{ relativePath: 'tsconfig.json', source, contentDigest: digest }],
    targetPaths: [],
    expectedInputClosure: [{ path: 'tsconfig.json', digest }]
  })).toEqual({
    schema: 'sec-import-check-outcome-v1',
    status: 'canonical',
    files: []
  });
});

test('staged normalization shares the Source Program input boundary for template files', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-import-normalization-template-'));
  return settleWorkspaceCallback(async () => {
    const candidateBase = await copyDefaultRepository(root);
    git(root, ['update-ref', 'refs/remotes/origin/main', candidateBase]);
    const templatePath = 'catalog/registry/official/example/files/src/template.ts';
    await mkdir(path.dirname(path.join(root, templatePath)), { recursive: true });
    await writeFile(path.join(root, templatePath),
      "import z from 'z';\nimport a from 'a';\nexport const template = [z, a];\n");
    git(root, ['add', '--', templatePath]);
    const before = git(root, ['write-tree']);
    const { checkStagedCandidateImportNormalizationWithSelection } = await import('./runtime.ts');
    const defaultSelection = await withAuthorityGitReadSession({
      cwd: root, budget: GIT_READ_OPERATION_BUDGET
    }, session => checkStagedCandidateImportNormalizationWithSelection({ session }));
    expect(defaultSelection.candidateBase).toBe(candidateBase);
    expect(defaultSelection.outcome.status).toBe('canonical');
    expect(git(root, ['write-tree'])).toBe(before);

    const sourcePath = 'src/adapters/self-hosting/development/import-normalization/kernel.ts';
    await writeFile(path.join(root, sourcePath),
      "import path from 'node:path';\nimport fs from 'node:fs';\nexport function normalize(): void { void fs; void path; }\n");
    git(root, ['add', '--', sourcePath]);
    const indexPath = path.resolve(root, git(root, ['rev-parse', '--git-path', 'index']));
    const indexBefore = await readFile(indexPath);
    const sourceBefore = await readFile(path.join(root, sourcePath));
    const sourceStatBefore = await stat(path.join(root, sourcePath));
    const { outcome: failure, candidateBase: observedBase } = await withAuthorityGitReadSession({
      cwd: root, budget: GIT_READ_OPERATION_BUDGET
    }, session => checkStagedCandidateImportNormalizationWithSelection({ session, candidateBase }));
    expect(observedBase).toBe(candidateBase);
    expect(failure.status).toBe('needs-import-transform');
    expect(failure.files).toEqual([sourcePath]);
    expect(await readFile(indexPath)).toEqual(indexBefore);
    expect(await readFile(path.join(root, sourcePath))).toEqual(sourceBefore);
    expect((await stat(path.join(root, sourcePath))).mtimeMs).toBe(sourceStatBefore.mtimeMs);
  }, () => rm(root, { recursive: true, force: true }));
});

test('canonical immutable candidate receives an owner terminal', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-import-normalization-terminal-'));
  return settleWorkspaceCallback(async () => {
    const baseCommit = await copyDefaultRepository(root);
    const candidateCommit = await commitFixture(
      root,
      'export function normalize(): void {}\nexport const canonicalCandidate = true;\n',
      'canonical-candidate'
    );
    const terminal = await verifyCandidate({
      repositoryRoot: root,
      candidateBase: baseCommit,
      candidateCommit
    });
    expect(['executed', 'reused']).toContain(terminal.disposition);
    expect(terminal.terminal?.status).toBe('passed');
  }, () => rm(root, { recursive: true, force: true }));
});

test('terminal observes candidate A instead of staged index B', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-import-normalization-exact-subject-'));
  return settleWorkspaceCallback(async () => {
    await copyInitializedGitRepository(root);
    const baseCommit = await commitFixture(
      root,
      "import fs from 'node:fs';\nimport path from 'node:path';\nexport function normalize(): void { void fs; void path; }\n",
      'canonical-base'
    );
    const candidateCommit = await commitFixture(
      root,
      "import path from 'node:path';\nimport fs from 'node:fs';\nexport function normalize(): void { void fs; void path; }\nexport const candidateA = true;\n",
      'noncanonical-candidate'
    );

    expect(git(root, ['status', '--porcelain'])).toBe('');
    git(root, ['update-ref', 'refs/remotes/origin/main', baseCommit]);
    await withAuthorityGitReadSession({ cwd: root, budget: GIT_READ_OPERATION_BUDGET }, async (session) => {
      const { checkStagedCandidateImportNormalization } = await import('./runtime.ts');
      expect((await checkStagedCandidateImportNormalization({ session })).status)
        .toBe('needs-import-transform');
    });

    await writeFile(
      path.join(root, 'src', 'adapters', 'self-hosting', 'development', 'import-normalization', 'kernel.ts'),
      "import fs from 'node:fs';\nimport path from 'node:path';\nexport function normalize(): void { void fs; void path; }\n"
    );
    git(root, ['add', 'src/adapters/self-hosting/development/import-normalization/kernel.ts']);

    const outcome = await verifyCandidate({
      repositoryRoot: root,
      candidateBase: baseCommit,
      candidateCommit
    });
    expect(['executed', 'reused']).toContain(outcome.disposition);
    expect(outcome.terminal?.status).toBe('failed');
  }, () => rm(root, { recursive: true, force: true }));
});

test('candidate configuration is immutable when the working tree config drifts', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-import-normalization-config-drift-'));
  return settleWorkspaceCallback(async () => {
    await copyInitializedGitRepository(root);
    const baseCommit = await commitFixture(
      root,
      "import fs from 'node:fs';\nimport path from 'node:path';\nexport function normalize(): void { void fs; void path; }\n",
      'config-drift-base',
      '{"compilerOptions":{"noEmit":true},"include":["src/**/*.ts"]}\n'
    );
    const candidateCommit = await commitFixture(
      root,
      "import path from 'node:path';\nimport fs from 'node:fs';\nexport function normalize(): void { void fs; void path; }\nexport const candidateConfig = true;\n",
      'config-drift-candidate',
      '{"compilerOptions":{"noEmit":true},"include":["src/**/*.ts"]}\n'
    );
    await writeFile(
      path.join(root, 'tsconfig.json'),
      '{"compilerOptions":{"noEmit":true},"files":[]}\n'
    );
    git(root, ['add', 'tsconfig.json']);

    const outcome = await verifyCandidate({
      repositoryRoot: root,
      candidateBase: baseCommit,
      candidateCommit
    });
    expect(outcome.terminal?.status).toBe('failed');
  }, () => rm(root, { recursive: true, force: true }));
});

test('empty staged selection issues opaque not-applicable admission before reading unrelated source blobs', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-import-normalization-staged-'));
  return settleWorkspaceCallback(async () => {
    await copyDefaultRepository(root);
    await writeFile(path.join(root, 'src', 'unselected.ts'), Buffer.from([0xff, 0xfe]));
    git(root, ['add', 'src/unselected.ts']);
    git(root, ['-c', 'user.name=SEC Tests', '-c', 'user.email=tests@example.com', 'commit', '--quiet', '-m', 'unrelated invalid UTF-8 source']);
    const baseCommit = git(root, ['rev-parse', 'HEAD']);
    await writeFile(path.join(root, 'note.txt'), 'staged candidate\n');
    git(root, ['add', 'note.txt']);
    await withAuthorityGitReadOperation({
      cwd: root,
      budget: GIT_READ_OPERATION_BUDGET,
      deadlineAtUnixMs: Date.now() + CANDIDATE_NORMALIZATION_DURATION_MS
    }, async (gitOperation) => {
      const {
        requireCandidateNormalizationAdmissionReceipt,
        verifyStagedCandidateImportNormalization
      } = await import('./runtime.ts');
      const result = await verifyStagedCandidateImportNormalization({
        gitOperation,
        candidateBase: baseCommit
      });
      expect(result.outcome.state).toBe('not-applicable');
      expect(result.outcome.terminal).toBeNull();
      expect(result.outcome.actionKey).toBeNull();
      expect(result.admission?.applicability).toBe('not-applicable');
      expect(result.admission).not.toBeNull();
      expect(requireCandidateNormalizationAdmissionReceipt(result.admission)).toBe(result.admission!);
      expect(() => requireCandidateNormalizationAdmissionReceipt({ ...result.admission! }))
        .toThrow('not owner-issued');
    });
    await withAuthorityGitReadSession({ cwd: root, budget: GIT_READ_OPERATION_BUDGET }, async (session) => {
      const { checkStagedCandidateImportNormalization } = await import('./runtime.ts');
      expect(await checkStagedCandidateImportNormalization({ session, candidateBase: baseCommit }))
        .toMatchObject({ status: 'canonical', files: [] });
    });
  }, () => rm(root, { recursive: true, force: true }));
});
