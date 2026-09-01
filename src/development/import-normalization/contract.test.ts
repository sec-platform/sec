import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import {
  compileSourceProgramOperationProducerClosure
} from '../../brownfield/source-program-model/repository.ts';
import {
  acquireExactGitTreeWorkspaceSourceSnapshot
} from '../../brownfield/source-program-model/workspace-source-snapshot.ts';
import {
  compileCandidateNormalizationActionKey,
  compileCandidateNormalizationSubject,
  IMPORT_NORMALIZATION_OPERATION,
  requireCandidateNormalizationSubject
} from './contract.ts';
import { verifyCandidateImportNormalization } from './runtime.ts';

function git(root: string, args: readonly string[]): string {
  const result = spawnSync('git', [...args], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
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

function subject(root: string, commitSha: string) {
  const snapshot = acquireExactGitTreeWorkspaceSourceSnapshot({
    repositoryRoot: root,
    commitSha
  });
  const producerClosure = compileSourceProgramOperationProducerClosure(
    snapshot,
    IMPORT_NORMALIZATION_OPERATION
  );
  return compileCandidateNormalizationSubject({ snapshot, producerClosure });
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
    expect(requireCandidateNormalizationSubject(first)).toBe(first);
    expect(() => requireCandidateNormalizationSubject({ ...first })).toThrow('not owner-issued');
    const terminal = await verifyCandidateImportNormalization({
      repositoryRoot: root,
      candidateCommit: firstCommit
    });
    expect(terminal).toMatchObject({
      disposition: 'executed',
      terminal: { status: 'passed' }
    });

    const noteOnlyCommit = await commitFixture(
      root,
      'export function normalize(): void {}\n',
      'note-only'
    );
    const noteOnly = subject(root, noteOnlyCommit);
    expect(noteOnly.candidateTreeObjectId).not.toBe(first.candidateTreeObjectId);
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
