import { expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { writeProvenance } from '../../src/adapters/artifacts/provenance.ts';
import {
  acquireWorkspaceWriteLease,
  withWorkspaceWriteLease,
  WorkspaceWriteLeaseError
} from '../../src/adapters/filesystem/write-lease.ts';
import { createRetainedNoFollowFileTransactionTestActorForTests, type RetainedNoFollowFileTransactionTestActor } from '../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts';
import { getWorkspacePaths, resolveWorkspaceArtifactPath } from "../../src/adapters/workspace-context.ts";
import { openWorkspaceCreateSession } from '../../src/adapters/workspace/create-generation.ts';
import { readLockFile } from "../../src/adapters/workspace/lock.ts";
import { readOptionalProvenanceFile } from '../../src/adapters/workspace/provenance-reader.ts';
import { loadPlan } from '../../src/adapters/workspace/sources/load-plan.ts';
import { prepareWorkspaceCreate } from '../../src/application/workspace-create.ts';
import { initializePreparedWorkspace } from '../../src/application/workspace-initialize.ts';
import { CI_ARTIFACT_FILES } from '../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import { initWorkspace } from '../../src/bootstrap/engineering/workspace-orchestrator.ts';
import { withAcquiredResource } from '../../src/execution/resource-settlement.ts';
import { snapshotWorkspaceCreateRequest, type WorkspaceCreateSession } from '../../src/execution/workspace-create.ts';
import { createWorkspace } from '../testkit/workspace.ts';

test('init creates the minimal workspace on an empty root', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-init-empty-');
  const result = await initWorkspace(workspaceRoot);
  const paths = getWorkspacePaths(workspaceRoot);
  const plan = await loadPlan(result.planPath);

  expect(result.planPath).toBe(paths.workspaceConfigPath);
  expect(plan.app.id).toBe('app');
  expect(plan.blocks).toEqual([]);
  expect(plan.acceptance).toEqual([]);
  expect(await fs.readFile(result.lockPath, 'utf8')).not.toContain('customer-admin');
  await expect(fs.lstat(paths.srcRoot)).resolves.toMatchObject({});
  // The initial pending report is intentionally not a complete Verification
  // artifact set. Remove that optional observation so this assertion reaches
  // the first real provenance publication without fabricating Verification.
  await fs.rm(resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.verificationReport));
  const provenance = await writeProvenance(workspaceRoot, readLockFile(workspaceRoot));
  const persisted = readOptionalProvenanceFile(
    resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.provenance),
    'Minimal workspace provenance readback'
  );
  expect(persisted).toEqual(provenance);
});

test('reference Customer scaffold requires an explicit create template', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-init-reference-');
  const result = await initWorkspace(workspaceRoot, { template: 'reference-customer' });
  const paths = getWorkspacePaths(workspaceRoot);
  const plan = await loadPlan(result.planPath);

  expect(plan.app.id).toBe('customer-admin');
  expect(plan.blocks.map((block) => block.id)).toEqual([
    'auth/basic-session',
    'tenant/basic-workspace',
    'entity/customer-basic'
  ]);
  await expect(fs.lstat(paths.srcRoot)).resolves.toMatchObject({});
  expect(await fs.readFile(paths.packageJsonPath, 'utf8')).toContain('generated-customer-admin');
});

test('unsupported create template fails before lifecycle publication', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-init-invalid-template-');
  await expect(initWorkspace(
    workspaceRoot,
    { template: 'unknown-template' as 'minimal' }
  )).rejects.toMatchObject({ code: 'WORKSPACE-INIT-002' });

  await expect(fs.lstat(path.join(workspaceRoot, '.sec'))).rejects.toMatchObject({ code: 'ENOENT' });
});

test('init refuses a non-empty foreign root before acquiring deletion authority', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-init-foreign-');
  const foreignPath = path.join(workspaceRoot, 'foreign.txt');
  const foreignBytes = Buffer.from('do not overwrite\n', 'utf8');
  await fs.writeFile(foreignPath, foreignBytes);

  await expect(initWorkspace(workspaceRoot))
    .rejects.toMatchObject({ code: 'WORKSPACE-INIT-001' });

  expect(await fs.readFile(foreignPath)).toEqual(foreignBytes);
  await expect(fs.lstat(path.join(workspaceRoot, '.sec'))).rejects.toMatchObject({ code: 'ENOENT' });
});

test('same-intent repeated init completes without overwriting the existing workspace', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-init-repeat-');
  await initWorkspace(workspaceRoot);
  const paths = getWorkspacePaths(workspaceRoot);
  const planPath = paths.workspaceConfigPath;
  const lockPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.graphLock);
  const verificationReportPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.verificationReport);
  const before = await Promise.all([
    fs.readFile(planPath),
    fs.readFile(lockPath),
    fs.readFile(verificationReportPath)
  ]);

  await expect(initWorkspace(workspaceRoot)).resolves.toEqual({ planPath, lockPath });

  const after = await Promise.all([
    fs.readFile(planPath),
    fs.readFile(lockPath),
    fs.readFile(verificationReportPath)
  ]);
  expect(after).toEqual(before);
});

test('active writer contention remains a lease error instead of being relabeled as lifecycle conflict', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-init-active-writer-');
  await initWorkspace(workspaceRoot);
  const lease = await acquireWorkspaceWriteLease(workspaceRoot);
  try {
    await expect(initWorkspace(workspaceRoot))
      .rejects.toMatchObject({ code: 'WORKSPACE-WRITE-LEASE-001' });
  } finally {
    await lease.release();
  }
});

test('supplied lease authority is proven before the workspace create surface is inspected', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-init-released-token-');
  const lease = await acquireWorkspaceWriteLease(workspaceRoot);
  const releasedToken = lease.token;
  await lease.release();

  const foreignPath = path.join(workspaceRoot, 'foreign.txt');
  const foreignBytes = Buffer.from('foreign-state\n', 'utf8');
  await fs.writeFile(foreignPath, foreignBytes);

  let failure: unknown;
  try {
    await initWorkspace(workspaceRoot, {}, releasedToken);
  } catch (error) {
    failure = error;
  }

  expect(failure).toBeInstanceOf(WorkspaceWriteLeaseError);
  expect((failure as WorkspaceWriteLeaseError).code).toMatch(/^WORKSPACE-WRITE-LEASE-/u);
  expect((failure as WorkspaceWriteLeaseError).code).not.toBe('WORKSPACE-INIT-001');
  expect(await fs.readFile(foreignPath)).toEqual(foreignBytes);
});

const fixtureFiles = {
  'sec.yaml': 'fixture author plan\n',
  'package.json': 'fixture package\n',
  [CI_ARTIFACT_FILES.graphLock]: 'fixture initial lock\n',
  [CI_ARTIFACT_FILES.verificationReport]: 'fixture pending\n'
};

const nativeRequest = () => snapshotWorkspaceCreateRequest('minimal', {
  directories: ['src', '.sec/workspace-write-lease'],
  files: Object.entries(fixtureFiles).map(([relativePath, bytes]) => ({ relativePath, bytes: Buffer.from(bytes) }))
});

async function withNativeSession(root: string, use: (session: WorkspaceCreateSession) => Promise<void>, actor?: RetainedNoFollowFileTransactionTestActor): Promise<void> {
  await withWorkspaceWriteLease(root, undefined, token => withAcquiredResource({
    operationLabel: 'native create admission fixture', resourceLabel: 'native create session',
    acquire: () => openWorkspaceCreateSession({ workspaceRoot: root, token,
      ...(actor === undefined ? {} : { testOnlyActor: createRetainedNoFollowFileTransactionTestActorForTests(actor) }) }),
    release: session => session.dispose(), use
  }));
}

test('native prepare rejects invalid blueprint or caller digest before any stage or journal birth', async () => {
  const root = await createWorkspace('workspace-create-native-invalid-');
  await withNativeSession(root, async session => {
    expect(await session.observe()).toEqual({ phase: 'absent' });
    const before = await fs.readdir(path.join(root, '.sec'));
    const request = nativeRequest();
    await expect(session.prepare(request.blueprint, { ...request.intent, digest: 'caller-poison' })).rejects.toMatchObject({ code: 'WORKSPACE-INIT-003' });
    await expect(session.prepare({ directories: [], files: [] }, request.intent)).rejects.toMatchObject({ code: 'WORKSPACE-INIT-003' });
    await expect(session.prepare({ ...request.blueprint, files: [...request.blueprint.files, { relativePath: '../foreign', bytes: Buffer.from('x') }] }, request.intent)).rejects.toMatchObject({ code: 'WORKSPACE-INIT-003' });
    await expect(session.prepare({ ...request.blueprint, directories: [...request.blueprint.directories, '.sec/workspace-create.json/child'] }, request.intent)).rejects.toMatchObject({ code: 'WORKSPACE-INIT-003', details: { reason: 'invalid-template-path' } });
    await expect(session.prepare({ ...request.blueprint, directories: [], files: [...request.blueprint.files, { relativePath: '.sec/workspace-write-lease', bytes: Buffer.from('foreign lease file') }] }, request.intent)).rejects.toMatchObject({ code: 'WORKSPACE-INIT-003', details: { reason: 'invalid-template-path' } });
    expect(await fs.readdir(path.join(root, '.sec'))).toEqual(before);
    expect(await fs.readdir(root)).toEqual(['.sec']);
  });
});

test('native observed journal does not authorize effects or mismatched resume intent', async () => {
  const root = await createWorkspace('workspace-create-native-admission-');
  const request = nativeRequest();
  await withNativeSession(root, async session => {
    await session.observe(); await session.prepare(request.blueprint, request.intent);
  });
  const before = await fs.readFile(path.join(root, '.sec/workspace-create.json'));
  await withNativeSession(root, async session => {
    expect((await session.observe()).phase).toBe('prepared');
    for (const effect of [() => session.publish('sec.yaml'), () => session.beginSettlement(),
      () => session.retireStage(), () => session.flushPublished(), () => session.complete()]) {
      await expect(effect()).rejects.toMatchObject({ code: 'WORKSPACE-INIT-003', details: { reason: 'missing-intent-admission' } });
    }
    const changedMode = snapshotWorkspaceCreateRequest('minimal', { ...request.blueprint,
      files: request.blueprint.files.map(file => ({ ...file, creationMode: 0o600 })) });
    const changedTemplate = snapshotWorkspaceCreateRequest('reference-customer', request.blueprint);
    for (const changed of [changedMode, changedTemplate]) {
      await expect(session.resume(changed.blueprint, changed.intent)).rejects.toMatchObject({ code: 'WORKSPACE-INIT-003', details: { reason: 'template-request-mismatch' } });
    }
    await expect(session.readCompleted(request.blueprint, request.intent)).rejects.toMatchObject({ code: 'WORKSPACE-INIT-003' });
    expect(await fs.readFile(path.join(root, '.sec/workspace-create.json'))).toEqual(before);
    await expect(fs.lstat(path.join(root, 'sec.yaml'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

test('native durability uses private full blueprint despite a runtime caller supplying an empty subset', async () => {
  const root = await createWorkspace('workspace-create-native-full-flush-');
  const request = nativeRequest(), flushed: string[] = [];
  await withNativeSession(root, async session => {
    await session.observe(); await session.prepare(request.blueprint, request.intent);
    // The session snapshot must outlive caller-owned byte mutation.
    for (const file of request.blueprint.files) file.bytes.fill(42);
    for (const entry of session.frontier()) await session.publish(entry);
    await session.beginSettlement(); await session.retireStage();
    await Reflect.apply(session.flushPublished, session, [{ directories: [], files: [] }]);
    expect(flushed.sort()).toEqual(Object.keys(fixtureFiles).sort());
    for (const [relative, bytes] of Object.entries(fixtureFiles)) expect(await fs.readFile(path.join(root, relative), 'utf8')).toBe(bytes);
    await session.complete();
  }, { durabilityObserver: ({ label, targetPath, stage }) => {
    if (label === 'Workspace recovered file barrier' && stage === 'parent-barrier') flushed.push(path.relative(root, targetPath).replaceAll('\\', '/'));
  } });
  expect(JSON.parse(await fs.readFile(path.join(root, '.sec/workspace-create.json'), 'utf8')).phase).toBe('completed');
});

/** Native lifecycle fixtures use independent bytes, not the Create producer to
 * calculate expected payload. They do not claim a compiled Lock or Gate. */
async function createFixtureGeneration(
  workspaceRoot: string,
  actor?: RetainedNoFollowFileTransactionTestActor,
  stopBeforeCompletion = false
): Promise<void> {
  await withWorkspaceWriteLease(workspaceRoot, undefined, token => initializePreparedWorkspace(
    prepareWorkspaceCreate(undefined, { officialRegistryRelativePath: 'registry' }), {
      loadTemplate: () => ({ directories: ['src', '.sec/workspace-write-lease'], files: [] }),
      renderControls: () => ({ directories: [], files: Object.entries(fixtureFiles).map(([relativePath, bytes]) => ({ relativePath, bytes: Buffer.from(bytes) })) }),
      openSession: async () => {
        const session = await openWorkspaceCreateSession({ workspaceRoot, token,
          ...(actor === undefined ? {} : { testOnlyActor: createRetainedNoFollowFileTransactionTestActorForTests(actor) }) });
        return stopBeforeCompletion ? Object.freeze({ ...session,
          complete: async () => { throw new Error('fixture-before-completion'); }
        } satisfies WorkspaceCreateSession) : session;
      }
    }
  ));
}

test('prepared interruption resumes by exact readback and preserves published inode identities', async () => {
  const root = await createWorkspace('workspace-create-interrupted-');
  await expect(createFixtureGeneration(root, {
    afterNamespaceMutationBeforeFlush: ({ targetPath }) => {
      if (targetPath === path.join(root, 'sec.yaml')) throw new Error('fixture-after-publication');
    }
  })).rejects.toThrow('fixture-after-publication');
  const before = await fs.stat(path.join(root, 'sec.yaml'));
  await createFixtureGeneration(root);
  expect((await fs.stat(path.join(root, 'sec.yaml'))).ino).toBe(before.ino);
  for (const [relative, bytes] of Object.entries(fixtureFiles)) expect(await fs.readFile(path.join(root, relative), 'utf8')).toBe(bytes);
  expect((await fs.readdir(path.join(root, '.sec'))).filter(name => name.startsWith('.workspace-create-'))).toEqual([]);
  expect(JSON.parse(await fs.readFile(path.join(root, '.sec/workspace-create.json'), 'utf8')).phase).toBe('completed');
});

test('stage retirement interruption remains settling and finishes without re-publishing payload', async () => {
  const root = await createWorkspace('workspace-create-stage-settlement-');
  await expect(createFixtureGeneration(root, undefined, true)).rejects.toThrow('fixture-before-completion');
  const journal = JSON.parse(await fs.readFile(path.join(root, '.sec/workspace-create.json'), 'utf8'));
  expect(journal.phase).toBe('settling');
  await expect(fs.lstat(path.join(root, '.sec', journal.stageName))).rejects.toMatchObject({ code: 'ENOENT' });
  await createFixtureGeneration(root, { beforeRename: () => { throw new Error('must not republish'); } });
  expect(JSON.parse(await fs.readFile(path.join(root, '.sec/workspace-create.json'), 'utf8')).phase).toBe('completed');
});

test('same-byte foreign file replacement cannot be adopted by recovery', async () => {
  const container = await createWorkspace('workspace-create-foreign-inode-');
  const root = path.join(container, 'work'); await fs.mkdir(root);
  await expect(createFixtureGeneration(root, {
    afterNamespaceMutationBeforeFlush: ({ targetPath }) => {
      if (targetPath === path.join(root, 'package.json')) throw new Error('fixture-stop');
    }
  })).rejects.toThrow('fixture-stop');
  const target = path.join(root, 'package.json'), bytes = await fs.readFile(target);
  await fs.rename(target, path.join(container, 'original-package'));
  await fs.writeFile(target, bytes, { flag: 'wx' });
  const foreign = await fs.stat(target);
  await expect(createFixtureGeneration(root)).rejects.toMatchObject({ code: 'WORKSPACE-INIT-003' });
  expect((await fs.stat(target)).ino).toBe(foreign.ino);
  expect(await fs.readFile(target)).toEqual(bytes);
});

test('completed retry preserves later author edits and new files; different intent conflicts', async () => {
  const root = await createWorkspace('workspace-create-author-retention-');
  await initWorkspace(root);
  const plan = path.join(root, 'sec.yaml'), extra = path.join(root, 'author-owned.txt');
  await fs.writeFile(plan, 'later author plan\n'); await fs.writeFile(extra, 'later author file\n');
  const before = await fs.stat(plan);
  await initWorkspace(root);
  expect((await fs.stat(plan)).ino).toBe(before.ino);
  expect(await fs.readFile(plan, 'utf8')).toBe('later author plan\n');
  expect(await fs.readFile(extra, 'utf8')).toBe('later author file\n');
  await expect(initWorkspace(root, { template: 'reference-customer' })).rejects.toMatchObject({ code: 'WORKSPACE-INIT-003', details: { reason: 'template-request-mismatch' } });
  expect(await fs.readFile(plan, 'utf8')).toBe('later author plan\n');
});

test('copied or forged guardless journal bytes do not create birth or recovery authority', async () => {
  const original = await createWorkspace('workspace-create-original-');
  await createFixtureGeneration(original);
  const bytes = await fs.readFile(path.join(original, '.sec/workspace-create.json'));
  const root = await createWorkspace('workspace-create-forged-journal-');
  const lease = await acquireWorkspaceWriteLease(root);
  try {
    const target = path.join(root, '.sec/workspace-create.json'); await fs.writeFile(target, bytes, { flag: 'wx' });
    await expect(initializePreparedWorkspace(prepareWorkspaceCreate(undefined, { officialRegistryRelativePath: 'registry' }), {
      loadTemplate: () => ({ directories: ['src', '.sec/workspace-write-lease'], files: [] }),
      renderControls: () => ({ directories: [], files: Object.entries(fixtureFiles).map(([relativePath, value]) => ({ relativePath, bytes: Buffer.from(value) })) }),
      openSession: () => openWorkspaceCreateSession({ workspaceRoot: root, token: lease.token })
    })).rejects.toMatchObject({ code: 'WORKSPACE-INIT-003', details: { reason: 'unqualified-journal' } });
    expect(await fs.readFile(target)).toEqual(bytes);
    await expect(fs.lstat(path.join(root, 'sec.yaml'))).rejects.toMatchObject({ code: 'ENOENT' });
    // Copying the native admission material cannot transfer its parent/anchor
    // identities into another workspace. The original producer is no oracle.
    const guardNames = (await fs.readdir(path.join(original, '.sec'))).filter(name => name.startsWith('.journal-mutation-') || name.startsWith('.sec-journal-guard-'));
    expect(guardNames.length).toBe(2);
    for (const name of guardNames) await fs.writeFile(path.join(root, '.sec', name), await fs.readFile(path.join(original, '.sec', name)), { flag: 'wx' });
    await expect(initializePreparedWorkspace(prepareWorkspaceCreate(undefined, { officialRegistryRelativePath: 'registry' }), {
      loadTemplate: () => ({ directories: ['src', '.sec/workspace-write-lease'], files: [] }),
      renderControls: () => ({ directories: [], files: Object.entries(fixtureFiles).map(([relativePath, value]) => ({ relativePath, bytes: Buffer.from(value) })) }),
      openSession: () => openWorkspaceCreateSession({ workspaceRoot: root, token: lease.token })
    })).rejects.toMatchObject({ code: 'WORKSPACE-INIT-003', details: { reason: 'unqualified-journal' } });
    expect(await fs.readFile(target)).toEqual(bytes);
    await expect(fs.lstat(path.join(root, 'sec.yaml'))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { await lease.release(); }
});

test('publication interrupted in a settled predecessor process resumes in a new process', async () => {
  const root = await createWorkspace('workspace-create-process-recovery-');
  const app = new URL('../../src/application/workspace-initialize.ts', import.meta.url).href;
  const recipe = new URL('../../src/application/workspace-create.ts', import.meta.url).href;
  const lease = new URL('../../src/adapters/filesystem/write-lease.ts', import.meta.url).href;
  const generation = new URL('../../src/adapters/workspace/create-generation.ts', import.meta.url).href;
  const physical = new URL('../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts', import.meta.url).href;
  const script = (interrupt: boolean) => `
    import path from 'node:path';
    import { initializePreparedWorkspace } from ${JSON.stringify(app)};
    import { prepareWorkspaceCreate } from ${JSON.stringify(recipe)};
    import { withWorkspaceWriteLease } from ${JSON.stringify(lease)};
    import { openWorkspaceCreateSession } from ${JSON.stringify(generation)};
    import { createRetainedNoFollowFileTransactionTestActorForTests } from ${JSON.stringify(physical)};
    const root = ${JSON.stringify(root)};
    const interrupt = ${JSON.stringify(interrupt)};
    try {
      await withWorkspaceWriteLease(root, undefined, token => initializePreparedWorkspace(
        prepareWorkspaceCreate(undefined, { officialRegistryRelativePath: 'registry' }), {
          loadTemplate: () => ({ directories: ['src', '.sec/workspace-write-lease'], files: [] }),
          renderControls: () => ({ directories: [], files: Object.entries(${JSON.stringify(fixtureFiles)}).map(([relativePath, bytes]) => ({ relativePath, bytes: Buffer.from(bytes) })) }),
          openSession: () => openWorkspaceCreateSession({ workspaceRoot: root, token,
            ...(interrupt ? { testOnlyActor: createRetainedNoFollowFileTransactionTestActorForTests({
              afterNamespaceMutationBeforeFlush: ({ targetPath }) => {
                if (targetPath === path.join(root, 'sec.yaml')) throw new Error('settled-process-interruption');
              }
            }) } : {}) })
        }
      ));
      if (interrupt) throw new Error('expected interruption');
      console.log('recovered');
    } catch (error) {
      if (!interrupt || error.message !== 'settled-process-interruption') throw error;
      // The acquired scope has already joined and settled its writer lease.
      console.log('interrupted-settled');
    }
  `;
  const run = async (interrupt: boolean) => {
    const child = Bun.spawn([process.execPath, '--no-env-file', '-e', script(interrupt)], { stdout: 'pipe', stderr: 'pipe' });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(code, stderr).toBe(0); expect(stdout.trim()).toBe(interrupt ? 'interrupted-settled' : 'recovered');
  };
  await run(true);
  const before = await fs.stat(path.join(root, 'sec.yaml'));
  await run(false);
  expect((await fs.stat(path.join(root, 'sec.yaml'))).ino).toBe(before.ino);
  for (const [relative, bytes] of Object.entries(fixtureFiles)) expect(await fs.readFile(path.join(root, relative), 'utf8')).toBe(bytes);
});

test('unpublished stage birth without a journal stays unknown and is preserved', async () => {
  const root = await createWorkspace('workspace-create-unjournaled-stage-');
  await expect(createFixtureGeneration(root, {
    beforeCreate: ({ label }) => { if (label === 'Workspace staged file') throw new Error('fixture-before-journal'); }
  })).rejects.toThrow('fixture-before-journal');
  const local = path.join(root, '.sec');
  const stages = (await fs.readdir(local)).filter(name => name.startsWith('.workspace-create-'));
  expect(stages.length).toBe(1);
  const identity = await fs.stat(path.join(local, stages[0]!));
  await expect(createFixtureGeneration(root)).rejects.toMatchObject({ code: 'WORKSPACE-INIT-001' });
  expect((await fs.stat(path.join(local, stages[0]!))).ino).toBe(identity.ino);
  await expect(fs.lstat(path.join(root, 'sec.yaml'))).rejects.toMatchObject({ code: 'ENOENT' });
});

// Observe generation data independently of the producer. The v2 journal owns
// completion; workspace/journal mutation-lease records belong to their own
// changing control namespace and are not payload or staging identities.
async function generationDataSnapshot(workspaceRoot: string): Promise<unknown[]> {
  const snapshot: unknown[] = [];
  const visit = async (relative: string, recursive = true): Promise<void> => {
    const target = path.join(workspaceRoot, relative);
    let metadata: import('node:fs').BigIntStats;
    try { metadata = await fs.lstat(target, { bigint: true }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      snapshot.push({ relative, kind: 'absent' });
      return;
    }
    snapshot.push({ relative, device: String(metadata.dev), inode: String(metadata.ino), mode: String(metadata.mode),
      kind: metadata.isDirectory() ? 'directory' : metadata.isFile() ? 'file' : 'other',
      bytes: metadata.isFile() ? (await fs.readFile(target)).toString('hex') : null });
    if (recursive && metadata.isDirectory()) {
      for (const name of (await fs.readdir(target)).sort()) await visit(path.posix.join(relative, name));
    }
  };
  await visit('', false);
  await visit('.sec', false);
  const roots = new Set(['src', ...Object.keys(fixtureFiles).map(relative =>
    relative.startsWith('.sec/') ? relative.split('/').slice(0, 2).join('/') : relative.split('/')[0]!
  )]);
  for (const relative of [...roots].sort()) await visit(relative);
  await visit('.sec/workspace-create.json');
  const stages = (await fs.readdir(path.join(workspaceRoot, '.sec')))
    .filter(name => name.startsWith('.workspace-create-')).sort();
  snapshot.push({ stages });
  for (const stage of stages) await visit(path.posix.join('.sec', stage));
  return snapshot;
}

async function prepareFixtureGeneration(workspaceRoot: string): Promise<void> {
  const request = nativeRequest();
  await withNativeSession(workspaceRoot, async session => {
    expect(await session.observe()).toEqual({ phase: 'absent' });
    await session.prepare(request.blueprint, request.intent);
  });
}

test('a failed recovered intent barrier preserves all generation data before any payload effect', async () => {
  const root = await createWorkspace('workspace-create-intent-barrier-failure-');
  await prepareFixtureGeneration(root);
  const before = await generationDataSnapshot(root);
  const journalPath = path.join(root, '.sec/workspace-create.json');
  expect(JSON.parse(await fs.readFile(journalPath, 'utf8')).phase).toBe('prepared');
  const primary = new Error('fixture-intent-parent-barrier');
  const effects: string[] = [];
  let barrierAttempts = 0;
  await expect(createFixtureGeneration(root, {
    beforeParentBarrier: ({ label }) => {
      if (label !== 'Workspace recovered intent barrier') return;
      barrierAttempts++;
      throw primary;
    },
    beforeRename: () => { effects.push('rename'); },
    beforeCreate: () => { effects.push('create'); },
    beforeCleanup: () => { effects.push('cleanup'); }
  })).rejects.toBe(primary);
  expect(barrierAttempts).toBe(1);
  expect(effects).toEqual([]);
  expect(await generationDataSnapshot(root)).toEqual(before);
  for (const relative of Object.keys(fixtureFiles)) {
    await expect(fs.lstat(path.join(root, relative))).rejects.toMatchObject({ code: 'ENOENT' });
  }
  // A failed barrier also releases the real session/lease, so its unchanged
  // prepared generation can be admitted by the ordinary next invocation.
  await createFixtureGeneration(root);
  for (const [relative, bytes] of Object.entries(fixtureFiles)) {
    expect(await fs.readFile(path.join(root, relative), 'utf8')).toBe(bytes);
  }
  expect(JSON.parse(await fs.readFile(journalPath, 'utf8')).phase).toBe('completed');
});

test('failed completion readback durability preserves the completed generation and original failure', async () => {
  const root = await createWorkspace('workspace-create-completion-barrier-failure-');
  await createFixtureGeneration(root);
  const before = await generationDataSnapshot(root);
  const primary = new Error('fixture-completion-parent-barrier');
  const effects: string[] = [];
  let barrierAttempts = 0;
  await expect(createFixtureGeneration(root, {
    beforeParentBarrier: ({ label }) => {
      if (label !== 'Workspace recovered completion barrier') return;
      barrierAttempts++;
      throw primary;
    },
    beforeRename: () => { effects.push('rename'); },
    beforeCreate: () => { effects.push('create'); },
    beforeCleanup: () => { effects.push('cleanup'); }
  })).rejects.toBe(primary);
  expect(barrierAttempts).toBe(1);
  expect(effects).toEqual([]);
  expect(await generationDataSnapshot(root)).toEqual(before);
  expect(JSON.parse(await fs.readFile(path.join(root, '.sec/workspace-create.json'), 'utf8')).phase).toBe('completed');
  await createFixtureGeneration(root);
  expect(await generationDataSnapshot(root)).toEqual(before);
});

test('current generation sessions close every real nested transaction and preserve primary plus cleanup failures', async () => {
  const root = await createWorkspace('workspace-create-resource-settlement-');
  const physicalModule = new URL('../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts', import.meta.url).href;
  const leaseModule = new URL('../../src/adapters/filesystem/write-lease.ts', import.meta.url).href;
  const generationModule = new URL('../../src/adapters/workspace/create-generation.ts', import.meta.url).href;
  const applicationModule = new URL('../../src/application/workspace-initialize.ts', import.meta.url).href;
  const recipeModule = new URL('../../src/application/workspace-create.ts', import.meta.url).href;
  const requestModule = new URL('../../src/execution/workspace-create.ts', import.meta.url).href;
  const settlementModule = new URL('../../src/execution/resource-settlement.ts', import.meta.url).href;
  // Isolate module fault injection from other tests. Every acquisition, native
  // identity, observation and effect still comes from the real factory. The
  // wrapper calls real dispose before injecting a settlement failure.
  const script = `
    import assert from 'node:assert/strict';
    import fs from 'node:fs/promises';
    import path from 'node:path';
    import { mock } from 'bun:test';
    const physical = await import(${JSON.stringify(physicalModule)});
    const originalRetain = physical.retainNoFollowFileTransaction;
    let active;
    mock.module(${JSON.stringify(physicalModule)}, () => ({ ...physical,
      retainNoFollowFileTransaction(...args) {
        const transaction = Reflect.apply(originalRetain, physical, args);
        const state = active;
        if (state === undefined) return transaction;
        const label = args[1];
        const record = { label, closes: 0, assertDisposed: () => {
          assert.throws(() => transaction.assertCurrent(), /disposed/);
        } };
        state.acquired.push(record);
        if (state.targetRecord === undefined && label === state.target) state.targetRecord = record;
        // The original capability is frozen. An empty forwarding shell avoids
        // replacing its own methods and preserves each actual method receiver.
        return new Proxy({}, { get(_shell, property) {
          if (property === 'dispose') return () => {
            record.closes++;
            transaction.dispose();
            record.assertDisposed();
            if (record === state.targetRecord) {
              state.closes.push('target');
              throw state.cleanup;
            }
            if (label === 'Workspace initial generation') {
              state.closes.push('outer');
              throw state.outerCleanup;
            }
          };
          const value = Reflect.get(transaction, property, transaction);
          if (typeof value !== 'function') return value;
          return (...values) => {
            if (!state.fired && state.failBody && record === state.targetRecord && property === state.method) {
              state.fired = true;
              throw state.primary;
            }
            return Reflect.apply(value, transaction, values);
          };
        } });
      }
    }));
    const { withWorkspaceWriteLease } = await import(${JSON.stringify(leaseModule)});
    const { openWorkspaceCreateSession } = await import(${JSON.stringify(generationModule)});
    const { initializePreparedWorkspace } = await import(${JSON.stringify(applicationModule)});
    const { prepareWorkspaceCreate } = await import(${JSON.stringify(recipeModule)});
    const { snapshotWorkspaceCreateRequest } = await import(${JSON.stringify(requestModule)});
    const { withAcquiredResource } = await import(${JSON.stringify(settlementModule)});
    const files = () => Object.entries(${JSON.stringify(fixtureFiles)}).map(([relativePath, bytes]) => ({
      relativePath, bytes: Buffer.from(bytes)
    }));
    const run = root => withWorkspaceWriteLease(root, undefined, token => initializePreparedWorkspace(
      prepareWorkspaceCreate(undefined, { officialRegistryRelativePath: 'registry' }), {
        loadTemplate: () => ({ directories: ['src', '.sec/workspace-write-lease'], files: [] }),
        renderControls: () => ({ directories: [], files: files() }),
        openSession: () => openWorkspaceCreateSession({ workspaceRoot: root, token })
      }
    ));
    const prepare = root => withWorkspaceWriteLease(root, undefined, token => withAcquiredResource({
      operationLabel: 'fixture prepared generation', resourceLabel: 'fixture real session',
      acquire: () => openWorkspaceCreateSession({ workspaceRoot: root, token }),
      release: session => session.dispose(),
      use: async session => {
        const request = snapshotWorkspaceCreateRequest('minimal', {
          directories: ['src', '.sec/workspace-write-lease'], files: files()
        });
        assert.deepEqual(await session.observe(), { phase: 'absent' });
        await session.prepare(request.blueprint, request.intent);
      }
    }));
    const leaves = error => error instanceof AggregateError ? error.errors.flatMap(leaves) : [error];
    const cases = [
      ['fresh', 'new', 'Workspace creation fresh readback', 'observe', undefined],
      ['staging', 'new', 'Workspace staged generation', 'createExclusive', false],
      ['intent', 'prepared', 'Workspace recovered intent barrier', 'flushExact', undefined],
      ['completion', 'completed', 'Workspace recovered completion barrier', 'flushExact', null],
      ['outer', 'new', 'Workspace initial generation', 'assertCurrent', false],
      ['successful-publication', 'new', 'Workspace initial generation', null, undefined]
    ];
    for (const [kind, setup, target, method, falsyPrimary] of cases) {
      for (const falsy of [false, true]) {
        const name = kind + (falsy ? '-falsy' : '-object');
        const workspaceRoot = path.join(${JSON.stringify(root)}, name);
        await fs.mkdir(workspaceRoot);
        active = undefined;
        if (setup === 'prepared') await prepare(workspaceRoot);
        if (setup === 'completed') await run(workspaceRoot);
        const state = active = {
          target, method, failBody: method !== null, fired: false,
          primary: falsy ? falsyPrimary : Object.freeze({ name, failure: 'primary' }),
          cleanup: falsy ? undefined : Object.freeze({ name, failure: 'cleanup' }),
          outerCleanup: Object.freeze({ name, failure: 'outer-cleanup' }),
          acquired: [], closes: [], targetRecord: undefined
        };
        let caught = false;
        try { await run(workspaceRoot); }
        catch (error) {
          caught = true;
          assert.deepEqual(leaves(error), [
            ...(state.failBody ? [state.primary] : []), state.cleanup,
            ...(target === 'Workspace initial generation' ? [] : [state.outerCleanup])
          ], name);
        }
        assert.equal(caught, true, name);
        assert.equal(state.fired, state.failBody, name);
        assert.ok(state.targetRecord, name + ': intended physical scope was not reached');
        assert.deepEqual(state.closes, target === 'Workspace initial generation' ? ['target'] : ['target', 'outer'], name);
        for (const record of state.acquired) {
          assert.equal(record.closes, 1, name + ': ' + record.label);
          record.assertDisposed();
        }
        active = undefined;
        // Reacquisition proves the surrounding real writer lease was settled.
        await withWorkspaceWriteLease(workspaceRoot, undefined, async () => {});
        if (!state.failBody) {
          assert.equal(JSON.parse(await fs.readFile(path.join(workspaceRoot, '.sec/workspace-create.json'), 'utf8')).phase, 'completed');
          for (const [relative, bytes] of Object.entries(${JSON.stringify(fixtureFiles)})) {
            assert.equal(await fs.readFile(path.join(workspaceRoot, relative), 'utf8'), bytes);
          }
        }
      }
    }
    console.log('current generation transactions settled');
  `;
  const child = Bun.spawn([process.execPath, '--no-env-file', '-e', script], { stdout: 'pipe', stderr: 'pipe' });
  const [code, stdout, stderr] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()
  ]);
  expect(code, stderr).toBe(0);
  expect(stdout.trim()).toBe('current generation transactions settled');
});
