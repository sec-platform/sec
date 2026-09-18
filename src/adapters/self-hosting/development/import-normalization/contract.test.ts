import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';
import {
  compileSourceProgramOperationProducerClosure,
  compileSourceProgramOperationProducerClosureFromWorkspaceSnapshot
} from '../../../repository/source-program-model/producer-closure.ts';
import { compileRepositorySourceProgramCompilation } from '../../../repository/source-program-model/repository-compilation.ts';
import {
  sourceProgramTypeScriptCompilerIdentity
} from '../../../repository/source-program-model/typescript.ts';
import {
  acquireExactGitTreeWorkspaceSourceSnapshot
} from '../../../repository/source-program-model/workspace-source-snapshot.ts';
import { withAuthorityGitReadOperation, withAuthorityGitReadSession } from '../../../providers/git-read/authority.ts';
import { rawSha256 } from '../../../../contracts/canonical.ts';
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
  await Promise.all([
    writeFile(path.join(root, 'tsconfig.json'), projectConfig),
    writeFile(path.join(root, 'note.txt'), `${note}\n`),
    writeFile(path.join(root, 'src', 'subject.ts'), 'export const subject = true;\n'),
    writeFile(path.join(root, 'src', 'adapters', 'self-hosting', 'development', 'import-normalization', 'kernel.ts'), kernel),
    writeFile(
      path.join(root, 'src', 'adapters', 'self-hosting', 'development', 'import-normalization', 'runtime.ts'),
      "import { normalize } from './kernel.ts';\nexport const verifyCandidateImportNormalization = normalize;\n"
    ),
    writeFile(
      path.join(root, 'src', 'adapters', 'self-hosting', 'development', 'import-normalization', 'sec.module.json'),
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
  git(root, ['add', '--all']);
  git(root, ['commit', '--quiet', '-m', note]);
  return git(root, ['rev-parse', 'HEAD']);
}

function subject(root: string, commitSha: string, baseCommitSha = commitSha) {
  const snapshot = acquireExactGitTreeWorkspaceSourceSnapshot({
    repositoryRoot: root,
    commitSha
  });
  const baseSnapshot = baseCommitSha === commitSha
    ? snapshot
    : acquireExactGitTreeWorkspaceSourceSnapshot({
      repositoryRoot: root,
      commitSha: baseCommitSha
    });
  const sourceProgramCompilation = compileRepositorySourceProgramCompilation({
    workspaceSnapshot: snapshot
  });
  const producerClosure = compileSourceProgramOperationProducerClosure(
    sourceProgramCompilation,
    IMPORT_NORMALIZATION_OPERATION
  );
  return compileCandidateNormalizationSubject({
    snapshot,
    baseSnapshot,
    producerClosure,
    compilerIdentity: sourceProgramTypeScriptCompilerIdentity()
  });
}

test('subject compiler owns producer, exact-tree, config and toolchain identity', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-import-normalization-subject-'));
  try {
    git(root, ['init', '--quiet']);
    git(root, ['config', 'user.email', 'tests@example.com']);
    git(root, ['config', 'user.name', 'SEC Tests']);
    const firstCommit = await commitFixture(
      root,
      'export function normalize(): void {}\n',
      'first'
    );
    const firstSnapshot = acquireExactGitTreeWorkspaceSourceSnapshot({
      repositoryRoot: root,
      commitSha: firstCommit
    });
    const fullProducer = compileSourceProgramOperationProducerClosure(
      compileRepositorySourceProgramCompilation({ workspaceSnapshot: firstSnapshot }),
      IMPORT_NORMALIZATION_OPERATION
    );
    const narrowProducer = compileSourceProgramOperationProducerClosureFromWorkspaceSnapshot(
      firstSnapshot,
      IMPORT_NORMALIZATION_OPERATION
    );
    expect(narrowProducer).toEqual(fullProducer);
    const first = subject(root, firstCommit);
    const firstAction = compileCandidateNormalizationActionKey(first);
    expect(firstAction.inputClosure).toEqual(first.observationBlobs);
    expect(requireCandidateNormalizationSubject(first)).toBe(first);
    expect(() => requireCandidateNormalizationSubject({ ...first })).toThrow('not owner-issued');
    const noteOnlyCommit = await commitFixture(
      root,
      'export function normalize(): void {}\n',
      'note-only'
    );
    const noteOnly = subject(root, noteOnlyCommit);
    expect(noteOnly.candidateIdentity).not.toEqual(first.candidateIdentity);
    expect(compileCandidateNormalizationActionKey(noteOnly).actionKey).toBe(firstAction.actionKey);

    const configCommit = await commitFixture(
      root,
      'export function normalize(): void {}\n',
      'config-change',
      '{"compilerOptions":{"noEmit":true,"strict":true}}\n'
    );
    const configChanged = subject(root, configCommit);
    expect(configChanged.configurationDigest).not.toBe(first.configurationDigest);
    expect(compileCandidateNormalizationActionKey(configChanged).actionKey)
      .not.toBe(firstAction.actionKey);

    const producerCommit = await commitFixture(
      root,
      'export function normalize(): void { console.log("changed"); }\n',
      'producer-change',
      '{"compilerOptions":{"noEmit":true}}\n'
    );
    const producerChanged = subject(root, producerCommit);
    expect(producerChanged.producerClosureDigest).not.toBe(first.producerClosureDigest);
    expect(compileCandidateNormalizationActionKey(producerChanged).actionKey)
      .not.toBe(firstAction.actionKey);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('immutable observer rejects an input closure other than the Action closure', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-import-normalization-closure-'));
  try {
    git(root, ['init', '--quiet']);
    git(root, ['config', 'user.email', 'tests@example.com']);
    git(root, ['config', 'user.name', 'SEC Tests']);
    const candidateCommit = await commitFixture(
      root,
      'export function normalize(): void {}\n',
      'closure'
    );
    const snapshot = acquireExactGitTreeWorkspaceSourceSnapshot({
      repositoryRoot: root,
      commitSha: candidateCommit
    });
    const candidate = subject(root, candidateCommit);
    expect(() => checkImmutableImportSnapshot({
      projectRoot: root,
      files: snapshot.files.map(({ path: relativePath, source }) => ({
        relativePath,
        source,
        contentDigest: rawSha256(source)
      })),
      targetPaths: [],
      expectedInputClosure: candidate.observationBlobs.slice(1)
    })).toThrow('differs from its Action input closure');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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

test('noncanonical candidate fails with a clean index', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-import-normalization-clean-index-'));
  try {
    git(root, ['init', '--quiet']);
    git(root, ['config', 'user.email', 'tests@example.com']);
    git(root, ['config', 'user.name', 'SEC Tests']);
    const baseCommit = await commitFixture(
      root,
      "import fs from 'node:fs';\nimport path from 'node:path';\nexport function normalize(): void { void fs; void path; }\n",
      'clean-index-base'
    );
    const candidateCommit = await commitFixture(
      root,
      "import path from 'node:path';\nimport fs from 'node:fs';\nexport function normalize(): void { void fs; void path; }\nexport const cleanIndexCandidate = true;\n",
      'clean-index-candidate'
    );
    expect(git(root, ['status', '--porcelain'])).toBe('');
    const outcome = await verifyCandidate({
      repositoryRoot: root,
      candidateBase: baseCommit,
      candidateCommit
    });
    expect(outcome.terminal?.status).toBe('failed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('staged normalization shares the Source Program input boundary for template files', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-import-normalization-template-'));
  try {
    git(root, ['init', '--quiet']);
    git(root, ['config', 'user.email', 'tests@example.com']);
    git(root, ['config', 'user.name', 'SEC Tests']);
    const candidateBase = await commitFixture(root,
      'export function normalize(): void {}\n', 'template-base');
    const templatePath = 'catalog/registry/official/example/files/src/template.ts';
    await mkdir(path.dirname(path.join(root, templatePath)), { recursive: true });
    await writeFile(path.join(root, templatePath),
      "import z from 'z';\nimport a from 'a';\nexport const template = [z, a];\n");
    git(root, ['add', '--', templatePath]);
    const before = git(root, ['write-tree']);
    const { checkStagedCandidateImportNormalization } = await import('./runtime.ts');
    const observe = () => withAuthorityGitReadSession({
      cwd: root, budget: GIT_READ_OPERATION_BUDGET
    }, session => checkStagedCandidateImportNormalization({ session, candidateBase }));
    expect((await observe()).status).toBe('canonical');
    expect(git(root, ['write-tree'])).toBe(before);

    const sourcePath = 'src/adapters/self-hosting/development/import-normalization/kernel.ts';
    await writeFile(path.join(root, sourcePath),
      "import path from 'node:path';\nimport fs from 'node:fs';\nexport function normalize(): void { void fs; void path; }\n");
    git(root, ['add', '--', sourcePath]);
    const failure = await observe();
    expect(failure.status).toBe('needs-import-transform');
    expect(failure.files).toEqual([sourcePath]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('canonical immutable candidate receives an owner terminal', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-import-normalization-terminal-'));
  try {
    git(root, ['init', '--quiet']);
    git(root, ['config', 'user.email', 'tests@example.com']);
    git(root, ['config', 'user.name', 'SEC Tests']);
    const baseCommit = await commitFixture(
      root,
      'export function normalize(): void {}\n',
      'base'
    );
    const candidateCommit = await commitFixture(
      root,
      'export function normalize(): void {}\n',
      'canonical-candidate'
    );
    const terminal = await verifyCandidate({
      repositoryRoot: root,
      candidateBase: baseCommit,
      candidateCommit
    });
    expect(['executed', 'reused']).toContain(terminal.disposition);
    expect(terminal.terminal?.status).toBe('passed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('terminal observes candidate A instead of staged index B', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-import-normalization-exact-subject-'));
  try {
    git(root, ['init', '--quiet']);
    git(root, ['config', 'user.email', 'tests@example.com']);
    git(root, ['config', 'user.name', 'SEC Tests']);
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
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('candidate configuration is immutable when the working tree config drifts', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-import-normalization-config-drift-'));
  try {
    git(root, ['init', '--quiet']);
    git(root, ['config', 'user.email', 'tests@example.com']);
    git(root, ['config', 'user.name', 'SEC Tests']);
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
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('staged candidate terminal issues an opaque normalization-only admission', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-import-normalization-staged-'));
  try {
    git(root, ['init', '--quiet']);
    git(root, ['config', 'user.email', 'tests@example.com']);
    git(root, ['config', 'user.name', 'SEC Tests']);
    const baseCommit = await commitFixture(root, 'export function normalize(): void {}\n', 'staged-base');
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
      if (result.outcome.terminal === null) {
        throw new Error(`Staged normalization did not settle: ${JSON.stringify(result.outcome)}`);
      }
      expect(result.outcome.terminal?.status).toBe('passed');
      expect(result.admission).not.toBeNull();
      expect(requireCandidateNormalizationAdmissionReceipt(result.admission)).toBe(result.admission!);
      expect(() => requireCandidateNormalizationAdmissionReceipt({ ...result.admission! }))
        .toThrow('not owner-issued');
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
