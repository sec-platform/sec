import { spawnSync } from 'node:child_process';
import { closeSync, openSync, writeFileSync } from 'node:fs';
import { link, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, unlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, expect, test } from 'bun:test';

import { AUTHOR_KERNEL_GRAMMAR_MANIFEST } from '../../../contracts/author-kernel-verification.ts';
import { rawSha256 } from '../../../contracts/canonical.ts';
import { withAuthorityGitReadSession } from '../../providers/git-read/authority.ts';
import { GIT_READ_EXACT_TREE_OPERATION_BUDGET } from '../../providers/git-read/runtime/session.ts';
import { inspectNoFollowDirectoryChain } from '../../runtime-state/physical/runtime/physical-no-follow.ts';
import { GIT_READ_OPERATION_BUDGET } from '../../self-hosting/development/tooling/git/git-read.ts';
import { retainCompilerDependencyExecutionGeneration } from '../../toolchain/dependencies/runtime.ts';
import {
  issueCompilerDependencyFixtureOperation,
  retireCompilerDependencyFixtureOperation,
  settleCompilerDependencyFixtureOperation
} from '../../toolchain/dependencies/test/runtime.ts';
import { materializeTypeScriptExecutionGeneration } from '../../toolchain/typescript/execution-generation.ts';
import { compileRepositorySourceProgramCompilation } from './repository-compilation.ts';
import {
  encodeTestImpactProjectionReceipt,
  issueTestImpactProjection,
  parseTestImpactProjectionReceipt,
  retainTestImpactExecutionInputs
} from './test-impact-projection.ts';
import { assertRetainedWorkingSourceInputGeneration, decodeStagedIndexLocation, retainWorkingSourceInputGeneration } from './workspace-source-authority.ts';
import {
  acquireExactGitTreeWorkspaceSourceSnapshot,
  acquireExactGitTreeWorkspaceSourceSnapshotFromSession,
  acquireStagedIndexWorkspaceSourceSnapshot,
  acquireStagedWorkspaceSourceSelection,
  acquireWorkingTreeWorkspaceSourceSnapshot,
  assertWorkspaceTypeScriptProjectGenerationEvidence,
  compileVirtualWorkspaceSourceSnapshot,
  compileWorkspaceTypeScriptProjectFactIdentity,
  compileWorkspaceTypeScriptProjectInput,
  issueWorkspaceTypeScriptProjectGenerationEvidence,
  projectWorkspaceTypeScriptProjectFactIdentity,
  readBackStagedIndexWorkspaceSourceSnapshot,
  readBackStagedWorkspaceSourceSelection
} from './workspace-source-snapshot.ts';

const temporaryRepositories: string[] = [];

test.skipIf(process.platform !== 'win32')('working retained inputs protect the original positive read set across hardlinks until retirement', async () => {
  const { repositoryRoot } = await createRepository();
  const source = path.join(repositoryRoot, 'src/example/value.ts');
  const alias = path.join(repositoryRoot, 'source-alias');
  await link(source, alias);
  const snapshot = await workingSnapshot(repositoryRoot);
  const generation = await withAuthorityGitReadSession({ cwd: repositoryRoot, budget: GIT_READ_OPERATION_BUDGET },
    session => retainWorkingSourceInputGeneration({ snapshot, session, deadlineAtUnixMs: Date.now() + 20_000 }));
  try {
    assertRetainedWorkingSourceInputGeneration(generation);
    expect(generation.snapshotIdentityDigest).toBe(snapshot.identityDigest);
    expect(generation.snapshotDigest).toBe(snapshot.snapshotDigest);
    expect(generation.repositoryRoot).toBe(path.resolve(repositoryRoot));
    expect(generation.fileCount).toBe(snapshot.files.length);
    expect(generation.totalBytes).toBe(snapshot.files.reduce((sum, file) => sum + Buffer.byteLength(file.source), 0));
    expect(generation.protectionKind).toBe('windows-retained-read-sharing');
    expect(() => writeFileSync(alias, 'changed')).toThrow();
    generation.assertCurrent();
  } finally { generation.retire(); }
  expect(() => assertRetainedWorkingSourceInputGeneration(generation)).toThrow();
  expect(() => generation.assertCurrent()).toThrow();
  generation.retire();
  await writeFile(alias, 'after retirement');
  expect(await readFile(source, 'utf8')).toBe('after retirement');
});

test.skipIf(process.platform !== 'win32')('working retained inputs reject drift and release every partial acquisition on a writer conflict', async () => {
  const { repositoryRoot } = await createRepository();
  const snapshot = await workingSnapshot(repositoryRoot);
  const lastPath = [...snapshot.files].sort((left, right) => left.path < right.path ? -1 : 1).at(-1)!.path;
  const writer = openSync(path.join(repositoryRoot, lastPath), 'r+');
  try {
    await withAuthorityGitReadSession({ cwd: repositoryRoot, budget: GIT_READ_OPERATION_BUDGET }, async session => {
      await expect(retainWorkingSourceInputGeneration({ snapshot, session, deadlineAtUnixMs: Date.now() + 20_000 })).rejects.toThrow();
    });
    for (const file of snapshot.files.filter(file => file.path !== lastPath)) {
      writeFileSync(path.join(repositoryRoot, file.path), file.source);
    }
  } finally { closeSync(writer); }
  const current = await workingSnapshot(repositoryRoot);
  await writeFile(path.join(repositoryRoot, 'src/example/value.ts'), 'export const value = 2;\n');
  await withAuthorityGitReadSession({ cwd: repositoryRoot, budget: GIT_READ_OPERATION_BUDGET }, async session => {
    await expect(retainWorkingSourceInputGeneration({ snapshot: current, session, deadlineAtUnixMs: Date.now() + 20_000 }))
      .rejects.toThrow();
  });
  for (const file of current.files) writeFileSync(path.join(repositoryRoot, file.path), file.source);
});

test.skipIf(process.platform !== 'win32')('working retained inputs reject unissued virtual staged and other-repository snapshots', async () => {
  const { repositoryRoot } = await createRepository();
  const { repositoryRoot: otherRoot } = await createRepository();
  const snapshot = await workingSnapshot(repositoryRoot);
  const staged = await stagedSnapshot(repositoryRoot);
  const virtual = virtualProjectSnapshot(Object.fromEntries(snapshot.files.map(file => [file.path, file.source])));
  await withAuthorityGitReadSession({ cwd: repositoryRoot, budget: GIT_READ_OPERATION_BUDGET }, async session => {
    for (const candidate of [{ ...snapshot }, virtual, staged]) {
      await expect(retainWorkingSourceInputGeneration({ snapshot: candidate as typeof snapshot,
        session, deadlineAtUnixMs: Date.now() + 20_000 })).rejects.toThrow();
    }
    expect(() => assertRetainedWorkingSourceInputGeneration({ snapshotIdentityDigest: snapshot.identityDigest })).toThrow();
  });
  await withAuthorityGitReadSession({ cwd: otherRoot, budget: GIT_READ_OPERATION_BUDGET }, async session => {
    await expect(retainWorkingSourceInputGeneration({ snapshot, session, deadlineAtUnixMs: Date.now() + 20_000 }))
      .rejects.toThrow('matching production Git');
  });
});

test.skipIf(process.platform !== 'win32')('working retained inputs enforce original finite admission and cancellation without blocking retirement', async () => {
  const { repositoryRoot } = await createRepository();
  const snapshot = await workingSnapshot(repositoryRoot);
  await withAuthorityGitReadSession({ cwd: repositoryRoot, budget: { ...GIT_READ_OPERATION_BUDGET, maxRecords: 1 } }, async session => {
    await expect(retainWorkingSourceInputGeneration({ snapshot, session, deadlineAtUnixMs: Date.now() + 20_000 }))
      .rejects.toThrow('bounded domain');
  });
  const controller = new AbortController();
  await withAuthorityGitReadSession({ cwd: repositoryRoot, budget: GIT_READ_OPERATION_BUDGET }, async session => {
    await expect(retainWorkingSourceInputGeneration({ snapshot, session, deadlineAtUnixMs: Date.now() - 1 }))
      .rejects.toThrow('deadline');
    controller.abort(new Error('original cancellation'));
    await expect(retainWorkingSourceInputGeneration({ snapshot, session, deadlineAtUnixMs: Date.now() + 20_000,
      signal: controller.signal })).rejects.toThrow('original cancellation');
  });
  const active = new AbortController();
  const generation = await withAuthorityGitReadSession({ cwd: repositoryRoot, budget: GIT_READ_OPERATION_BUDGET },
    session => retainWorkingSourceInputGeneration({ snapshot, session, deadlineAtUnixMs: Date.now() + 20_000, signal: active.signal }));
  active.abort();
  expect(() => generation.retire()).not.toThrow();
});

test.skipIf(process.platform !== 'win32')('working retained inputs projection bridge retains only its original issued physical snapshot', async () => {
  const { repositoryRoot } = await createRepository();
  const snapshot = await workingSnapshot(repositoryRoot);
  const compilation = compileRepositorySourceProgramCompilation({ workspaceSnapshot: snapshot });
  const projection = issueTestImpactProjection({ workspaceSnapshot: snapshot,
    repositoryModel: compilation.model, typeScriptModel: compilation.typeScriptCompilation.model,
    testObservations: compilation.testObservations });
  await withAuthorityGitReadSession({ cwd: repositoryRoot, budget: GIT_READ_OPERATION_BUDGET }, async session => {
    const generation = await retainTestImpactExecutionInputs({ projection, session, deadlineAtUnixMs: Date.now() + 20_000 });
    try {
      expect(projection.workspaceSnapshotIdentityDigest).toBe(generation.snapshotIdentityDigest);
      expect(generation.fileCount).toBe(snapshot.files.length);
      generation.assertCurrent();
    } finally { generation.retire(); }
    const decoded = parseTestImpactProjectionReceipt(encodeTestImpactProjectionReceipt(projection));
    await expect(retainTestImpactExecutionInputs({ projection: decoded, session, deadlineAtUnixMs: Date.now() + 20_000 }))
      .rejects.toThrow('issued');
    await expect(retainTestImpactExecutionInputs({ projection: { ...projection }, session, deadlineAtUnixMs: Date.now() + 20_000 }))
      .rejects.toThrow('issued');
  });
});

function git(repositoryRoot: string, args: readonly string[]): string {
  const result = spawnSync('git', [...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args.join(' ')} failed`);
  }
  return result.stdout.trim();
}

async function createRepository(): Promise<Readonly<{ commitSha: string; repositoryRoot: string }>> {
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), 'sec-workspace-source-generation-'));
  temporaryRepositories.push(repositoryRoot);
  git(repositoryRoot, ['init', '--quiet']);
  git(repositoryRoot, ['config', 'user.email', 'tests@example.com']);
  git(repositoryRoot, ['config', 'user.name', 'SEC Tests']);
  git(repositoryRoot, ['config', 'core.autocrlf', 'false']);
  await mkdir(path.join(repositoryRoot, 'src', 'example'), { recursive: true });
  await writeFile(
    path.join(repositoryRoot, 'src', 'example', 'module.json'),
    `${JSON.stringify({
      importGraph: 'runtime',
      externalEntrypoints: [],
      capabilityProviders: [],
      preDependencyBootstrap: false
    }, null, 2)}\n`
  );
  await writeFile(
    path.join(repositoryRoot, 'src', 'example', 'value.ts'),
    'export const value = 1;\n'
  );
  await writeFile(
    path.join(repositoryRoot, 'src', 'example', 'removed.ts'),
    'export const removed = true;\n'
  );
  await writeFile(
    path.join(repositoryRoot, 'src', 'example', 'excluded.ts'),
    'export const excluded = true;\n'
  );
  await writeFile(
    path.join(repositoryRoot, 'src', 'example', 'non-checker.yaml'),
    'kind: source-program-resource\n'
  );
  await writeFile(
    path.join(repositoryRoot, 'tsconfig.json'),
    `${JSON.stringify({
      compilerOptions: { strict: true },
      include: ['src/**/*.ts'],
      exclude: ['src/example/excluded.ts']
    }, null, 2)}\n`
  );
  git(repositoryRoot, ['add', '--all']);
  git(repositoryRoot, ['update-index', '--chmod=+x', 'src/example/value.ts']);
  git(repositoryRoot, ['commit', '--quiet', '-m', 'source generation fixture']);
  return Object.freeze({
    commitSha: git(repositoryRoot, ['rev-parse', 'HEAD']),
    repositoryRoot
  });
}

async function exactSnapshot(repositoryRoot: string, commitSha: string) {
  return withAuthorityGitReadSession({
    cwd: repositoryRoot,
    budget: GIT_READ_EXACT_TREE_OPERATION_BUDGET
  }, (session) => acquireExactGitTreeWorkspaceSourceSnapshotFromSession({ session, commitSha }));
}

async function workingSnapshot(repositoryRoot: string) {
  return withAuthorityGitReadSession({
    cwd: repositoryRoot,
    budget: Object.freeze({ ...GIT_READ_OPERATION_BUDGET, maxProcesses: 4 })
  }, (session) => acquireWorkingTreeWorkspaceSourceSnapshot({ session }));
}

async function stagedSnapshot(repositoryRoot: string) {
  return withAuthorityGitReadSession({
    cwd: repositoryRoot,
    budget: GIT_READ_OPERATION_BUDGET
  }, (session) => acquireStagedIndexWorkspaceSourceSnapshot({ session }));
}

async function createNativeRepository(manifestSource?: string) {
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), 'sec-native-source-generation-'));
  temporaryRepositories.push(repositoryRoot);
  git(repositoryRoot, ['init', '--quiet']);
  git(repositoryRoot, ['config', 'user.email', 'tests@example.com']);
  git(repositoryRoot, ['config', 'user.name', 'SEC Tests']);
  git(repositoryRoot, ['config', 'core.autocrlf', 'false']);
  const retained: Readonly<Record<string, string>> = {
    'crates/gift-author-kernel/Cargo.toml': '[package]\nname = "native-fixture"\nversion = "0.1.0"\nedition = "2021"\n',
    'crates/gift-author-kernel/Cargo.lock': 'version = 4\n',
    'crates/gift-author-kernel/.cargo/config.toml': '[net]\noffline = true\n',
    'crates/gift-author-kernel/build.rs': 'fn main() {}\n',
    'crates/gift-author-kernel/src/lib.rs': 'pub const LABEL: &str = "原字节";\n',
    'crates/gift-author-kernel/tests/reader.rs': '#[test] fn source_is_retained() {}\n',
    'crates/gift-author-kernel/fixtures/input.json': '{"value":"900719925474099312345"}\n',
    [AUTHOR_KERNEL_GRAMMAR_MANIFEST]: manifestSource ?? `${JSON.stringify({
      schema: 'gift.design-codec-parameters/2', scope: 'complete-candidate-structure-only',
      resources: [{ path: 'native-resources/shape.json' }],
      externals: [{ path: 'external-data/oracle.txt' }], extensions: []
    })}\n`,
    'native-resources/shape.json': '{"type":"string","marker":"a"}\n',
    'external-data/oracle.txt': 'native external oracle bytes\n'
  };
  const ignored = {
    'native-resources/adjacent.json': '{"unreferenced":true}\n',
    'external-data/adjacent.txt': 'unreferenced external data\n',
    'crates/gift-author-kernel/target/src/generated.rs': 'derived output\n'
  };
  for (const [repositoryPath, source] of Object.entries({ ...retained, ...ignored })) {
    const filename = path.join(repositoryRoot, ...repositoryPath.split('/'));
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, source);
  }
  git(repositoryRoot, ['add', '--all']);
  git(repositoryRoot, ['commit', '--quiet', '-m', 'native source fixture without tsconfig']);
  return { repositoryRoot, commitSha: git(repositoryRoot, ['rev-parse', 'HEAD']), retained, ignored };
}

function virtualProjectSnapshot(sources: Readonly<Record<string, string>>) {
  return compileVirtualWorkspaceSourceSnapshot({
    subject: Object.freeze({
      kind: 'virtual-mutation' as const,
      provenance: Object.freeze({
        kind: 'source-program-virtual-mutation' as const,
        baseSnapshotDigest: rawSha256('project-input-test-base'),
        mutationDigest: rawSha256(JSON.stringify(sources))
      })
    }),
    files: Object.entries(sources).map(([sourcePath, source]) => Object.freeze({
      path: sourcePath,
      source,
      contentDigest: rawSha256(source)
    })),
    moduleMembership: Object.freeze({
      descriptors: Object.freeze([]),
      graphRoots: Object.freeze([]),
      moduleRoots: Object.freeze([]),
      moduleForPath: () => null
    })
  });
}

afterEach(async () => {
  while (temporaryRepositories.length > 0) {
    await rm(temporaryRepositories.pop()!, { recursive: true, force: true });
  }
});

test('working tree and exact Git tree issue one transport-neutral source generation', async () => {
  const { commitSha, repositoryRoot } = await createRepository();
  const exact = await exactSnapshot(repositoryRoot, commitSha);
  const working = await workingSnapshot(repositoryRoot);
  for (const snapshot of [working, exact]) {
    expect(() => snapshot.assertMatches({
      sourceRevision: snapshot.sourceRevision,
      files: snapshot.files,
      moduleMembership: snapshot.moduleMembership
    })).not.toThrow();
  }

  expect(working.sourceRevision).toBe(exact.sourceRevision);
  expect(working.files.map(({ path: repositoryPath, mode, contentDigest }) => ({
    path: repositoryPath,
    mode,
    contentDigest
  }))).toEqual(exact.files.map(({ path: repositoryPath, mode, contentDigest }) => ({
    path: repositoryPath,
    mode,
    contentDigest
  })));
  expect(exact.file('src/example/value.ts')?.mode).toBe('100755');
  expect(working.file('src/example/value.ts')?.mode).toBe('100755');
  expect(working.subjectDigest).not.toBe(exact.subjectDigest);
  expect(working.physicalObservationReceipt?.kind).toBe('working-tree-observation');
  expect(exact.physicalObservationReceipt).toMatchObject({ kind: 'git-tree', commitSha });
});

test('native-only working, staged and exact snapshots retain declared external bytes and isolate byte changes and deletion', async () => {
  const { repositoryRoot, commitSha, retained, ignored } = await createNativeRepository();
  const exact = await exactSnapshot(repositoryRoot, commitSha);
  const staged = await stagedSnapshot(repositoryRoot);
  const working = await workingSnapshot(repositoryRoot);
  for (const snapshot of [exact, staged, working]) {
    expect(snapshot.files.map(({ path: filename }) => filename).sort()).toEqual(Object.keys(retained).sort());
    expect(snapshot.file('tsconfig.json')).toBeNull();
    for (const [filename, source] of Object.entries(retained)) {
      expect(snapshot.file(filename)?.source).toBe(source);
      expect(snapshot.file(filename)?.contentDigest).toBe(rawSha256(source));
    }
    for (const filename of Object.keys(ignored)) expect(snapshot.file(filename)).toBeNull();
  }
  expect(working.sourceRevision).toBe(exact.sourceRevision);
  expect(staged.sourceRevision).toBe(exact.sourceRevision);

  const resource = 'native-resources/shape.json';
  const filename = path.join(repositoryRoot, ...resource.split('/'));
  const before = await lstat(filename);
  const changedSource = '{"type":"string","marker":"b"}\n';
  expect(Buffer.byteLength(changedSource)).toBe(Buffer.byteLength(retained[resource]!));
  await writeFile(filename, changedSource);
  await utimes(filename, before.atime, before.mtime);
  const changed = await workingSnapshot(repositoryRoot);
  expect(changed.file(resource)?.source).toBe(changedSource);
  expect(changed.file(resource)?.contentDigest).not.toBe(working.file(resource)?.contentDigest);
  expect(changed.sourceRevision).not.toBe(working.sourceRevision);
  expect(exact.file(resource)?.source).toBe(retained[resource]);
  expect((await stagedSnapshot(repositoryRoot)).file(resource)?.source).toBe(retained[resource]);
  git(repositoryRoot, ['add', resource]);
  expect((await stagedSnapshot(repositoryRoot)).file(resource)?.source).toBe(changedSource);

  await unlink(filename);
  const missing = await workingSnapshot(repositoryRoot);
  expect(missing.file(resource)).toBeNull();
  expect(missing.file(AUTHOR_KERNEL_GRAMMAR_MANIFEST)?.source).toBe(retained[AUTHOR_KERNEL_GRAMMAR_MANIFEST]);
  expect(missing.sourceRevision).not.toBe(changed.sourceRevision);
  git(repositoryRoot, ['add', resource]);
  // Reintroducing an untracked ambient file cannot fill an index/tree absence.
  await writeFile(filename, changedSource);
  expect((await stagedSnapshot(repositoryRoot)).file(resource)).toBeNull();
  git(repositoryRoot, ['commit', '--quiet', '-m', 'delete declared native resource']);
  const deleted = await exactSnapshot(repositoryRoot, git(repositoryRoot, ['rev-parse', 'HEAD']));
  expect(deleted.file(resource)).toBeNull();
  expect(deleted.file(AUTHOR_KERNEL_GRAMMAR_MANIFEST)?.source).toBe(retained[AUTHOR_KERNEL_GRAMMAR_MANIFEST]);
  expect((await workingSnapshot(repositoryRoot)).file(resource)?.source).toBe(changedSource);
});

test('native acquisition retains an invalid raw declaration without interpreting it as a valid resource closure', async () => {
  for (const source of [
    '{"schema":"gift.design-codec-parameters/2","scope":"complete-candidate-structure-only","resources":[{"path":"../outside.json"}],"externals":[],"extensions":[]}',
    '{"schema":"gift.design-codec-parameters/2","scope":"complete-candidate-structure-only","resources":[],"resources":[],"externals":[],"extensions":[]}'
  ]) {
    const { repositoryRoot, commitSha } = await createNativeRepository(source);
    for (const snapshot of [await workingSnapshot(repositoryRoot), await stagedSnapshot(repositoryRoot),
      await exactSnapshot(repositoryRoot, commitSha)]) {
      expect(snapshot.file(AUTHOR_KERNEL_GRAMMAR_MANIFEST)?.source).toBe(source);
      expect(snapshot.file('crates/gift-author-kernel/src/lib.rs')?.source).toContain('原字节');
      expect(snapshot.file('native-resources/shape.json')).toBeNull();
      expect(snapshot.file('external-data/oracle.txt')).toBeNull();
    }
  }
});

test('native declared external inputs cannot acquire an unsafe Git link mode through staged or exact readers', async () => {
  const { repositoryRoot, commitSha, retained } = await createNativeRepository();
  const resource = 'external-data/oracle.txt';
  expect((await exactSnapshot(repositoryRoot, commitSha)).file(resource)?.source).toBe(retained[resource]);
  const blob = git(repositoryRoot, ['hash-object', '-w', resource]);
  git(repositoryRoot, ['update-index', '--add', '--cacheinfo', `120000,${blob},${resource}`]);
  await expect(stagedSnapshot(repositoryRoot)).rejects.toThrow('not one ordinary blob');
  git(repositoryRoot, ['commit', '--quiet', '-m', 'unsafe native resource mode']);
  await expect(exactSnapshot(repositoryRoot, git(repositoryRoot, ['rev-parse', 'HEAD'])))
    .rejects.toThrow('not one ordinary blob');
});

test.each(['package.json', 'src/adapters/toolchain/package.json', 'src/example/opaque.ts'])(
  'selected source link %s cannot become an absent exact-tree input', async (repositoryPath) => {
    const { repositoryRoot } = await createNativeRepository();
    const blob = git(repositoryRoot, ['hash-object', '-w', 'external-data/oracle.txt']);
    git(repositoryRoot, ['update-index', '--add', '--cacheinfo', `120000,${blob},${repositoryPath}`]);
    await expect(stagedSnapshot(repositoryRoot)).rejects.toThrow('not one ordinary blob');
    git(repositoryRoot, ['commit', '--quiet', '-m', 'selected source link fixture']);
    const commitSha = git(repositoryRoot, ['rev-parse', 'HEAD']);
    await expect(exactSnapshot(repositoryRoot, commitSha)).rejects.toThrow('not one ordinary blob');
    expect(() => acquireExactGitTreeWorkspaceSourceSnapshot({ repositoryRoot, commitSha }))
      .toThrow('not one ordinary blob');
  }
);

test('staged index location decoding rejects ambiguous native output', () => {
  const root = path.resolve('native location with spaces');
  const index = path.join(root, '.git', 'index');
  for (const objectFormat of ['sha1', 'sha256'] as const) {
    for (const eol of ['\n', '\r\n']) {
      for (const trailing of ['', eol]) {
        expect(decodeStagedIndexLocation(Buffer.from([root, index, objectFormat].join(eol) + trailing)))
          .toEqual({ repositoryRoot: root, indexPath: index, objectFormat });
      }
    }
  }
  for (const invalid of [
    `${root}\n${index}`, `${root}\n${index}\nsha1\nextra\n`,
    `${root}\n\nsha1\n`, `${root}\n${index}\nsha1\n\n`,
    `${root}\0\n${index}\nsha1\n`, `${root}\rbroken\n${index}\nsha1\n`,
    `${root}\n${index}\nsha512\n`, `${root}\n${index}\n sha1\n`
  ]) {
    expect(() => decodeStagedIndexLocation(Buffer.from(invalid))).toThrow();
  }
  expect(() => decodeStagedIndexLocation(Buffer.from([0xff]))).toThrow();
});

test('staged index snapshot binds exact index bytes and blocks later index drift', async () => {
  const { repositoryRoot } = await createRepository();
  await withAuthorityGitReadSession({
    cwd: repositoryRoot,
    budget: GIT_READ_OPERATION_BUDGET
  }, async (session) => {
    const candidateBase = git(repositoryRoot, ['rev-parse', 'HEAD']);
    const selection = await acquireStagedWorkspaceSourceSelection({ session, candidateBase });
    expect(selection.selectedPaths).toEqual([]);
    await expect(readBackStagedWorkspaceSourceSelection({ ...selection }, session))
      .rejects.toThrow('not owner-issued');
    const snapshot = await acquireStagedIndexWorkspaceSourceSnapshot({ session });
    expect(snapshot.physicalObservationReceipt?.kind).toBe('staged-index-observation');
    const processesBeforeReadback = session.processCount;
    await readBackStagedIndexWorkspaceSourceSnapshot(snapshot, session);
    // This repeated fence must fit the original operation budget without relying
    // on a warm normalization result to skip otherwise-required observations.
    expect(session.processCount - processesBeforeReadback).toBe(1);
    await writeFile(
      path.join(repositoryRoot, 'src', 'example', 'value.ts'),
      'export const value = 2;\n'
    );
    git(repositoryRoot, ['add', 'src/example/value.ts']);
    await expect(readBackStagedIndexWorkspaceSourceSnapshot(snapshot, session))
      .rejects.toThrow('index changed before readback');
    await expect(readBackStagedWorkspaceSourceSelection(selection, session))
      .rejects.toThrow('index changed before readback');
  });
});

test('Project fact identity is stable across observation sessions and consumes opaque generation identity', async () => {
  const { repositoryRoot } = await createRepository();
  const first = await workingSnapshot(repositoryRoot);
  const second = await workingSnapshot(repositoryRoot);
  const generationDigest = `sha256:${'a'.repeat(64)}` as const;
  expect(compileWorkspaceTypeScriptProjectFactIdentity(first, 'tsconfig.json', {
    dependencyGenerationDigest: generationDigest
  })).toEqual(compileWorkspaceTypeScriptProjectFactIdentity(second, 'tsconfig.json', {
    dependencyGenerationDigest: generationDigest
  }));
});

test('Project fact identity resolves repository imports with the canonical TypeScript resolver', () => {
  const snapshot = virtualProjectSnapshot({
    'tsconfig.json': JSON.stringify({
      compilerOptions: {
        allowImportingTsExtensions: true,
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        noEmit: true
      },
      files: ['src/entry.ts']
    }),
    'package.json': '{"type":"module"}\n',
    'src/entry.ts': [
      "import profile from './profile.json' with { type: 'json' };",
      "import legacy = require('./legacy.cjs');",
      "import workerPath from './worker.mjs' with { type: 'file' };",
      "export { hidden } from './hidden.js';",
      "void import('./dynamic.mjs', { with: { type: 'file' } });",
      "type Imported = import('./types.js').Imported;",
      'export const profileName: Imported = `${profile.name}:${workerPath}:${legacy}`;'
    ].join('\n'),
    'src/dynamic.d.mts': 'declare const dynamic: string; export default dynamic;\n',
    'src/hidden.ts': 'export const hidden = true;\n',
    'src/legacy.d.cts': 'declare const legacy: string; export = legacy;\n',
    'src/profile.json': '{"name":"source-program"}\n',
    'src/types.ts': 'export type Imported = string;\n',
    'src/worker.d.mts': 'declare const workerPath: string; export default workerPath;\n',
    'src/worker.mjs': 'export default "worker";\n'
  });
  expect(compileWorkspaceTypeScriptProjectFactIdentity(snapshot, 'tsconfig.json', {
    dependencyGenerationDigest: null
  })).toEqual(projectWorkspaceTypeScriptProjectFactIdentity(
    compileWorkspaceTypeScriptProjectInput(snapshot, 'tsconfig.json')
  ));
});

test('working generation includes dirty and untracked source while excluding deleted membership', async () => {
  const { commitSha, repositoryRoot } = await createRepository();
  const exact = await exactSnapshot(repositoryRoot, commitSha);
  await writeFile(
    path.join(repositoryRoot, 'src', 'example', 'value.ts'),
    'export const value = 2;\n'
  );
  await unlink(path.join(repositoryRoot, 'src', 'example', 'removed.ts'));
  await writeFile(
    path.join(repositoryRoot, 'src', 'example', 'untracked.ts'),
    'export const untracked = true;\n'
  );

  const working = await workingSnapshot(repositoryRoot);
  expect(working.sourceRevision).not.toBe(exact.sourceRevision);
  expect(working.file('src/example/value.ts')?.source).toContain('value = 2');
  expect(working.file('src/example/untracked.ts')).not.toBeNull();
  expect(working.file('src/example/removed.ts')).toBeNull();

  await rename(
    path.join(repositoryRoot, 'src', 'example', 'untracked.ts'),
    path.join(repositoryRoot, 'src', 'example', 'renamed.ts')
  );
  const renamed = await workingSnapshot(repositoryRoot);
  expect(renamed.file('src/example/untracked.ts')).toBeNull();
  expect(renamed.file('src/example/renamed.ts')?.source).toContain('untracked = true');
});

test('working generation observes same-mtime byte changes and index optimization flags fail closed', async () => {
  const { repositoryRoot } = await createRepository();
  const valuePath = path.join(repositoryRoot, 'src', 'example', 'value.ts');
  const before = await lstat(valuePath);
  await writeFile(valuePath, 'export const value = 9;\n');
  await utimes(valuePath, before.atime, before.mtime);
  const changed = await workingSnapshot(repositoryRoot);
  expect(changed.file('src/example/value.ts')?.source).toContain('value = 9');

  git(repositoryRoot, ['checkout', '--', 'src/example/value.ts']);
  git(repositoryRoot, ['update-index', '--assume-unchanged', 'src/example/value.ts']);
  await writeFile(valuePath, 'export const value = 7;\n');
  const assumeUnchanged = await workingSnapshot(repositoryRoot);
  expect(assumeUnchanged.file('src/example/value.ts')?.source).toContain('value = 7');
  git(repositoryRoot, ['update-index', '--no-assume-unchanged', 'src/example/value.ts']);

  git(repositoryRoot, ['checkout', '--', 'src/example/value.ts']);
  git(repositoryRoot, ['update-index', '--skip-worktree', 'src/example/value.ts']);
  await writeFile(valuePath, 'export const value = 5;\n');
  const skipWorktree = await workingSnapshot(repositoryRoot);
  expect(skipWorktree.file('src/example/value.ts')?.source).toContain('value = 5');
  git(repositoryRoot, ['update-index', '--no-skip-worktree', 'src/example/value.ts']);
});

test('working-tree project generation evidence is owner-issued and opaque', async () => {
  const { repositoryRoot } = await createRepository();
  await withAuthorityGitReadSession({
    cwd: repositoryRoot,
    budget: Object.freeze({ ...GIT_READ_OPERATION_BUDGET, maxProcesses: 8 })
  }, async (session) => {
    const snapshot = await acquireWorkingTreeWorkspaceSourceSnapshot({ session });
    const projectInput = compileWorkspaceTypeScriptProjectInput(snapshot, 'tsconfig.json');
    const evidence = issueWorkspaceTypeScriptProjectGenerationEvidence(
      snapshot,
      projectInput
    );
    const valuePath = path.join(repositoryRoot, 'src', 'example', 'value.ts');
    await writeFile(valuePath, 'export const value = 9;\n');
    await writeFile(valuePath, 'export const value = 1;\n');
    expect(() => assertWorkspaceTypeScriptProjectGenerationEvidence({ ...evidence }))
      .toThrow('was not issued by the Source Program owner');
    expect(evidence.projectInput.projectInputDigest).toMatch(/^sha256:/u);
    expect(evidence.projectInput.sourceFacts.map(({ path: sourcePath }) => sourcePath))
      .not.toContain('src/example/excluded.ts');
    expect(evidence.projectInput.externalSourceFacts.some(({ kind }) => (
      kind === 'default-library'
    ))).toBe(true);
    await writeFile(
      path.join(repositoryRoot, 'src', 'example', 'excluded.ts'),
      'export const excluded = "changed outside Program input";\n'
    );
    const changedSnapshot = await acquireWorkingTreeWorkspaceSourceSnapshot({ session });
    const changedInput = compileWorkspaceTypeScriptProjectInput(changedSnapshot, 'tsconfig.json');
    expect(changedSnapshot.sourceRevision).not.toBe(snapshot.sourceRevision);
    expect(changedInput.projectInputDigest).toBe(projectInput.projectInputDigest);
    expect(changedInput.observationDigest).not.toBe(projectInput.observationDigest);
  });
});

test('ProjectInput preserves TypeScript requested path identity on Windows', () => {
  const snapshot = virtualProjectSnapshot({
    'src/example/removed.ts': 'export const removed = true;\n',
    'src/example/value.ts': "import { removed } from './removed.ts'; export const value = removed;\n",
    'tsconfig.json': `${JSON.stringify({
      compilerOptions: { allowImportingTsExtensions: true, strict: true },
      include: ['src/**/*.ts']
    }, null, 2)}\n`
  });
  const projectInput = compileWorkspaceTypeScriptProjectInput(snapshot, 'tsconfig.json');

  expect(projectInput.sourceFacts.map(({ path: sourcePath }) => sourcePath)).toEqual([
    'src/example/removed.ts',
    'src/example/value.ts',
    'tsconfig.json'
  ]);
});

test('ProjectInput emits one config fact when TypeScript imports its own project configuration', () => {
  const config = JSON.stringify({
    compilerOptions: { module: 'ESNext', moduleResolution: 'Bundler', resolveJsonModule: true, noLib: true, types: [] },
    files: ['src/example/value.ts']
  });
  const source = "import config from '../../tsconfig.json'; export const value = config.compilerOptions;\n";
  const snapshot = virtualProjectSnapshot({ 'tsconfig.json': config, 'src/example/value.ts': source });
  const projectInput = compileWorkspaceTypeScriptProjectInput(snapshot, 'tsconfig.json');

  expect(projectInput.sourceFacts.map(({ path: sourcePath, contentDigest }) => ({ path: sourcePath, contentDigest })))
    .toEqual([
      { path: 'src/example/value.ts', contentDigest: rawSha256(source) },
      { path: 'tsconfig.json', contentDigest: rawSha256(config) }
    ]);
});

test('ProjectInput represents a valid config with no matched TypeScript inputs as an empty generation', () => {
  const snapshot = virtualProjectSnapshot({
    'src/example/value.ts': 'export const value = true;\n',
    'tsconfig.json': `${JSON.stringify({
      compilerOptions: { strict: true },
      include: ['src/absent/**/*.ts']
    }, null, 2)}\n`
  });
  const projectInput = compileWorkspaceTypeScriptProjectInput(snapshot, 'tsconfig.json');

  expect(projectInput.sourceFacts.map(({ path: sourcePath }) => sourcePath)).toEqual([
    'tsconfig.json'
  ]);
  expect(projectInput.externalSourceFacts).toEqual([]);

  const invalidSnapshot = virtualProjectSnapshot({
    'tsconfig.json': `${JSON.stringify({
      compilerOptions: { strict: 'not-a-boolean' },
      include: ['src/absent/**/*.ts']
    }, null, 2)}\n`
  });
  expect(() => compileWorkspaceTypeScriptProjectInput(invalidSnapshot, 'tsconfig.json'))
    .toThrow('TypeScript ProjectInput config is invalid');

  const explicitlyInvalidEmptySnapshot = virtualProjectSnapshot({
    'tsconfig.json': `${JSON.stringify({ files: [] }, null, 2)}\n`
  });
  expect(() => compileWorkspaceTypeScriptProjectInput(
    explicitlyInvalidEmptySnapshot,
    'tsconfig.json'
  )).toThrow('TypeScript ProjectInput config is invalid');
});

test('ProjectInput rejects source escape before any materialization authority is requested', async () => {
  const { repositoryRoot } = await createRepository();
  const configSource = await readFile(path.join(repositoryRoot, 'tsconfig.json'), 'utf8');
  await withAuthorityGitReadSession({
    cwd: repositoryRoot,
    budget: Object.freeze({ ...GIT_READ_OPERATION_BUDGET, maxProcesses: 8 })
  }, async (session) => {
    for (const [source, compilerDiagnostic] of [
      ["import '/foreign.ts'; export const value = 1;\n", 'absolute or invalid import'],
      ["import '../../../foreign'; export const value = 1;\n", 'import escapes its snapshot']
    ] as const) {
      await writeFile(path.join(repositoryRoot, 'src', 'example', 'value.ts'), source);
      await expect(acquireWorkingTreeWorkspaceSourceSnapshot({ session }))
        .rejects.toThrow('import escapes its snapshot');
      const snapshot = virtualProjectSnapshot({
        'tsconfig.json': configSource,
        'src/example/value.ts': source
      });
      expect(() => compileWorkspaceTypeScriptProjectInput(snapshot, 'tsconfig.json'))
        .toThrow(compilerDiagnostic);
    }
  });
});

test('ProjectInput cannot observe host package declarations without one retained dependency generation', async () => {
  const { repositoryRoot } = await createRepository();
  await writeFile(
    path.join(repositoryRoot, 'src', 'example', 'value.ts'),
    "import type { Command } from 'commander'; export const value: Command | null = null;\n"
  );
  await withAuthorityGitReadSession({
    cwd: repositoryRoot,
    budget: Object.freeze({ ...GIT_READ_OPERATION_BUDGET, maxProcesses: 4 })
  }, async (session) => {
    const snapshot = await acquireWorkingTreeWorkspaceSourceSnapshot({ session });
    const projectInput = compileWorkspaceTypeScriptProjectInput(snapshot, 'tsconfig.json');
    expect(projectInput.dependencyGenerationDigest).toBeNull();
    expect(projectInput.externalSourceFacts.some(({ kind }) => kind === 'dependency-generation'))
      .toBe(false);
    expect(projectInput.externalSourceFacts.some(({ path: sourcePath }) => (
      sourcePath.includes('commander')
    ))).toBe(false);
  });
});

test('immutable execution generation isolates workspace mutation and retires its physical tree', async () => {
  const { repositoryRoot } = await createRepository();
  const ownerRoot = await mkdtemp(path.join(tmpdir(), 'sec-source-execution-owner-'));
  temporaryRepositories.push(ownerRoot);
  const generationParentPath = path.join(ownerRoot, 'generations');
  const dependencyRootPath = path.join(ownerRoot, 'dependencies');
  await Promise.all([
    mkdir(generationParentPath),
    mkdir(dependencyRootPath)
  ]);
  const dependencyFixture = await issueCompilerDependencyFixtureOperation({
    dependencies: { commander: '1.0.0' },
    dependencyRootPath,
    devDependencies: { typescript: '1.0.0' },
    lockfileBytes: 'fixture-lock\n',
    packages: [{ main: 'index.d.ts', name: 'commander', version: '1.0.0' }, {
      main: './lib/typescript.js',
      name: 'typescript',
      version: '1.0.0'
    }]
  });
  const dependencyGeneration = await settleCompilerDependencyFixtureOperation(dependencyFixture);
  try {
    await writeFile(
      path.join(repositoryRoot, 'src', 'example', 'value.ts'),
      "import 'commander'; export const value = 1;\n"
    );
    await withAuthorityGitReadSession({
      cwd: repositoryRoot,
      budget: Object.freeze({ ...GIT_READ_OPERATION_BUDGET, maxProcesses: 4 })
    }, async (session) => {
      const snapshot = await acquireWorkingTreeWorkspaceSourceSnapshot({ session });
      const retainedDependencyGeneration = await retainCompilerDependencyExecutionGeneration(
        dependencyGeneration.executionGenerationAuthority,
        { deadlineAtUnixMs: Date.now() + 30_000 }
      );
      const evidence = issueWorkspaceTypeScriptProjectGenerationEvidence(
        snapshot,
        compileWorkspaceTypeScriptProjectInput(snapshot, 'tsconfig.json', {
          dependencyGeneration: retainedDependencyGeneration.physicalGeneration,
          dependencyGenerationDigest: retainedDependencyGeneration.generationDigest
        })
      );
      expect(evidence.projectInput.externalSourceFacts.some(({ kind, path: sourcePath }) => (
        kind === 'dependency-generation' && sourcePath.startsWith('commander/')
      ))).toBe(true);
      for (const rejection of ['cancelled', 'deadline', 'foreign-evidence']) {
        const rejectedDependency = await retainCompilerDependencyExecutionGeneration(
          dependencyGeneration.executionGenerationAuthority,
          { deadlineAtUnixMs: Date.now() + 30_000 }
        );
        let releases = 0;
        const rejectedInput = {
          deadlineAtUnixMs: rejection === 'deadline' ? Date.now() - 1 : Date.now() + 30_000,
          dependencyGeneration: {
            physicalGeneration: rejectedDependency.physicalGeneration,
            generationDigest: rejectedDependency.generationDigest,
            retire: async () => { releases += 1; await rejectedDependency.retire(); }
          },
          dependencyLocatorPath: dependencyGeneration.nodeModulesPath,
          generationParent: inspectNoFollowDirectoryChain(generationParentPath).target,
          ...(rejection === 'cancelled' ? { signal: AbortSignal.abort() } : {})
        };
        await expect(materializeTypeScriptExecutionGeneration(
          rejection === 'foreign-evidence' ? { ...evidence } : evidence,
          rejectedInput
        )).rejects.toThrow(rejection === 'cancelled' ? 'cancelled' : rejection === 'deadline' ? 'deadline' : 'not issued');
        expect(releases).toBe(1);
        expect(await readdir(generationParentPath)).toEqual([]);
      }
      let dependencyRetirementAttempts = 0;
      const generation = await materializeTypeScriptExecutionGeneration(evidence, {
        deadlineAtUnixMs: Date.now() + 30_000,
        dependencyGeneration: {
          physicalGeneration: retainedDependencyGeneration.physicalGeneration,
          generationDigest: retainedDependencyGeneration.generationDigest,
          retire: async () => {
            dependencyRetirementAttempts += 1;
            if (dependencyRetirementAttempts === 1) throw new Error('dependency release temporarily unavailable');
            await retainedDependencyGeneration.retire();
          }
        },
        dependencyLocatorPath: dependencyGeneration.nodeModulesPath,
        generationParent: inspectNoFollowDirectoryChain(generationParentPath).target
      });
      // childPath names the child descriptor table, not this process's table.
      const generationRoot = generation.workingDirectory.root.path;
      try {
        await writeFile(path.join(repositoryRoot, 'src', 'example', 'value.ts'), 'export const value = 9;\n');
        expect(await readFile(path.join(generationRoot, 'src', 'example', 'value.ts'), 'utf8'))
          .toBe("import 'commander'; export const value = 1;\n");
        expect(await lstat(path.join(generationRoot, 'src', 'example', 'non-checker.yaml'))
          .then(() => true, () => false)).toBe(false);
        await expect(writeFile(
          path.join(generationRoot, 'src', 'example', 'value.ts'),
          'export const value = 7;\n'
        )).rejects.toBeDefined();
        await expect(writeFile(
          path.join(dependencyGeneration.nodeModulesPath, 'typescript', 'lib', 'typescript.js'),
          'module.exports = 2;\n'
        )).rejects.toBeDefined();
        await expect(unlink(path.join(
          dependencyGeneration.nodeModulesPath,
          'typescript',
          'lib',
          'typescript.js'
        )))
          .rejects.toBeDefined();
        await generation.assertCurrent();
      } finally {
        await expect(generation.retire()).rejects.toThrow('preserved physical residue');
        expect(await lstat(generationRoot).then(() => true, () => false)).toBe(false);
        const receipt = await generation.retire();
        expect(await generation.retire()).toBe(receipt);
        expect(dependencyRetirementAttempts).toBe(2);
      }
      expect(await lstat(generationRoot).then(() => true, () => false)).toBe(false);
      await expect(generation.assertCurrent()).rejects.toThrow('retired');

      const generationParentBeforeForeignLocator = await readdir(generationParentPath);
      const foreignGenerationPath = path.join(ownerRoot, 'foreign-dependency-generation');
      await mkdir(foreignGenerationPath);
      const foreignPreimage = await lstat(foreignGenerationPath, { bigint: true });
      // Keep the predecessor alive so a filesystem cannot immediately reuse its inode.
      await rename(foreignGenerationPath, `${foreignGenerationPath}.predecessor`);
      await mkdir(foreignGenerationPath);
      const foreignReplacement = await lstat(foreignGenerationPath, { bigint: true });
      expect(foreignReplacement.ino).not.toBe(foreignPreimage.ino);
      const replacementDependencyGeneration = await retainCompilerDependencyExecutionGeneration(
        dependencyGeneration.executionGenerationAuthority,
        { deadlineAtUnixMs: Date.now() + 30_000 }
      );
      const replacementEvidence = issueWorkspaceTypeScriptProjectGenerationEvidence(
        snapshot,
        compileWorkspaceTypeScriptProjectInput(snapshot, 'tsconfig.json', {
          dependencyGeneration: replacementDependencyGeneration.physicalGeneration,
          dependencyGenerationDigest: replacementDependencyGeneration.generationDigest
        })
      );
      await expect(materializeTypeScriptExecutionGeneration(replacementEvidence, {
        deadlineAtUnixMs: Date.now() + 30_000,
        dependencyGeneration: replacementDependencyGeneration,
        dependencyLocatorPath: foreignGenerationPath,
        generationParent: inspectNoFollowDirectoryChain(generationParentPath).target
      })).rejects.toThrow('targets a foreign generation');
      expect(await readdir(generationParentPath)).toEqual(generationParentBeforeForeignLocator);
    });
  } finally {
    await retireCompilerDependencyFixtureOperation(dependencyFixture);
  }
}, 30_000);

test('repository audit projects the owner-issued exact source generation', async () => {
  const { auditRepository } = await import('../repository-audit/cli.ts');
  const { commitSha, repositoryRoot } = await createRepository();
  const exact = await exactSnapshot(repositoryRoot, commitSha);
  const report = await auditRepository(repositoryRoot, { defaultRef: commitSha });

  expect(report.sourceProgram.sourceRevision).toBe(exact.sourceRevision);
  expect(report.sourceProgramCompilation.snapshotDigest).toBe(exact.snapshotDigest);
  expect(report.sourceProgramCompilation.moduleGraphDigest).toBe(exact.moduleGraphDigest);
});
