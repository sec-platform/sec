import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';
import {
  compileSourceProgramOperationProducerClosure
} from '../../brownfield/source-program-model/producer-closure.ts';
import { compileRepositorySourceProgramCompilation } from '../../brownfield/source-program-model/repository-compilation.ts';
import {
  sourceProgramTypeScriptCompilerIdentity
} from '../../brownfield/source-program-model/typescript.ts';
import {
  acquireExactGitTreeWorkspaceSourceSnapshot
} from '../../brownfield/source-program-model/workspace-source-snapshot.ts';
import { rawSha256 } from '../../system-architecture/foundation/runtime/canonical.ts';
import {
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
  await mkdir(path.join(root, 'src', 'development', 'import-normalization'), { recursive: true });
  await Promise.all([
    writeFile(path.join(root, 'tsconfig.json'), projectConfig),
    writeFile(path.join(root, 'note.txt'), `${note}\n`),
    writeFile(path.join(root, 'src', 'subject.ts'), 'export const subject = true;\n'),
    writeFile(path.join(root, 'src', 'development', 'import-normalization', 'kernel.ts'), kernel),
    writeFile(
      path.join(root, 'src', 'development', 'import-normalization', 'runtime.ts'),
      "import { normalize } from './kernel.ts';\nexport const verifyCandidateImportNormalization = normalize;\n"
    ),
    writeFile(
      path.join(root, 'src', 'development', 'import-normalization', 'sec.module.json'),
      `${JSON.stringify({
        importGraph: 'runtime',
        externalEntrypoints: ['src/development/import-normalization/runtime.ts'],
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
    expect(noteOnly.candidateCommitSha).not.toBe(first.candidateCommitSha);
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
      path.join(root, 'src', 'development', 'import-normalization', 'kernel.ts'),
      "import fs from 'node:fs';\nimport path from 'node:path';\nexport function normalize(): void { void fs; void path; }\n"
    );
    git(root, ['add', 'src/development/import-normalization/kernel.ts']);

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
