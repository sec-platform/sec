import { expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { writeProvenance } from '../../src/adapters/artifacts/provenance.ts';
import {
  acquireWorkspaceWriteLease,
  withWorkspaceWriteLease,
  WorkspaceWriteLeaseError
} from '../../src/adapters/filesystem/write-lease.ts';
import { createExclusiveNoFollowDirectory, createRetainedNoFollowFileTransactionTestActorForTests, inspectNoFollowDirectoryChain, type RetainedNoFollowFileTransactionTestActor } from '../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts';
import { getWorkspacePaths, resolveWorkspaceArtifactPath } from "../../src/adapters/workspace-context.ts";
import { publishWorkspaceCreate } from '../../src/adapters/workspace/create-publication.ts';
import { readLockFile } from "../../src/adapters/workspace/lock.ts";
import { ensureProjectBase } from '../../src/adapters/workspace/project-base.ts';
import { readOptionalProvenanceFile } from '../../src/adapters/workspace/provenance-reader.ts';
import { loadPlan } from '../../src/adapters/workspace/sources/load-plan.ts';
import { CI_ARTIFACT_FILES } from '../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import { initWorkspace } from '../../src/bootstrap/engineering/workspace-orchestrator.ts';
import { createWorkspace } from '../testkit/workspace.ts';

test('init creates the minimal workspace on an empty root', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-init-empty-');
  const result = await initWorkspace(workspaceRoot);
  const paths = getWorkspacePaths(workspaceRoot);
  const plan = await loadPlan(result.planPath);

  expect(result.planPath).toBe(paths.workspaceConfigPath);
  expect(plan.app.id).toBe('app');
  if (process.platform === 'linux') expect((await fs.stat(paths.srcRoot)).mode & 0o777).toBe(0o777 & ~process.umask());
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

test('same-intent init completes without overwriting an existing SEC workspace', async () => {
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

  await initWorkspace(workspaceRoot);

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

// Independent fixture bytes make partial physical publication observable without
// deriving expectations from the Create serializer or a completed workspace.
const recoveryFiles = {
  'sec.yaml': 'initial author plan\n',
  'package.json': '{"name":"independent-fixture"}\n',
  '.sec/artifacts/state/graph.lock.json': '{"lock":"initial"}\n',
  '.sec/artifacts/evidence/verification-report.json': '{"status":"pending"}\n'
};
async function publishFixture(root: string, actor?: RetainedNoFollowFileTransactionTestActor, contents = recoveryFiles): Promise<void> {
  await withWorkspaceWriteLease(root, undefined, token => publishWorkspaceCreate({
    workspaceRoot: root, token, template: 'minimal',
    material: { directories: ['src', '.sec/workspace-write-lease'],
      files: Object.entries(contents).map(([relativePath, bytes]) => ({ relativePath, bytes: Buffer.from(bytes) })) },
    ...(actor === undefined ? {} : { testOnlyActor: createRetainedNoFollowFileTransactionTestActorForTests(actor) })
  }));
}
const readCreateRecord = async (root: string) => JSON.parse(await fs.readFile(path.join(root, '.sec/workspace-create.json'), 'utf8'));

test('prepared Create resumes after rename-before-flush without republishing any original inode', async () => {
  const root = await createWorkspace('workspace-create-prepared-');
  await expect(publishFixture(root, { afterNamespaceMutationBeforeFlush: ({ targetPath }) => {
    if (targetPath === path.join(root, 'sec.yaml')) throw new Error('interrupted-after-rename');
  } })).rejects.toThrow('interrupted-after-rename');
  expect((await readCreateRecord(root)).phase).toBe('prepared');
  const identities = await Promise.all(Object.keys(recoveryFiles).map(relative => fs.stat(path.join(root, relative))));
  await publishFixture(root, { beforeRename: () => { throw new Error('must not republish'); } });
  for (const [index, [relative, bytes]] of Object.entries(recoveryFiles).entries()) {
    expect(await fs.readFile(path.join(root, relative), 'utf8')).toBe(bytes);
    expect((await fs.stat(path.join(root, relative))).ino).toBe(identities[index]!.ino);
  }
  expect((await readCreateRecord(root)).phase).toBe('completed');
  expect((await fs.readdir(path.join(root, '.sec'))).filter(name => name.startsWith('.workspace-create-'))).toEqual([]);
});

test('settling Create resumes after stage retirement without republishing payload', async () => {
  const root = await createWorkspace('workspace-create-settling-');
  await expect(publishFixture(root, { beforeParentBarrier: ({ label }) => {
    if (label === 'Workspace Create published barrier') throw new Error('interrupted-after-retirement');
  } })).rejects.toThrow('interrupted-after-retirement');
  const record = await readCreateRecord(root);
  expect(record.phase).toBe('settling');
  await expect(fs.lstat(path.join(root, '.sec', record.stageName))).rejects.toMatchObject({ code: 'ENOENT' });
  await publishFixture(root, { beforeRename: () => { throw new Error('must not republish'); } });
  expect((await readCreateRecord(root)).phase).toBe('completed');
});

for (const replacement of ['same-byte-inode', 'author-edit'] as const) {
  test(`prepared Create preserves and refuses ${replacement} replacement`, async () => {
    const container = await createWorkspace('workspace-create-foreign-');
    const root = path.join(container, 'work'); await fs.mkdir(root);
    await expect(publishFixture(root, { afterNamespaceMutationBeforeFlush: ({ targetPath }) => {
      if (targetPath === path.join(root, 'package.json')) throw new Error('interrupted');
    } })).rejects.toThrow('interrupted');
    const target = path.join(root, 'package.json');
    if (replacement === 'same-byte-inode') {
      await fs.rename(target, path.join(container, 'original'));
      await fs.writeFile(target, recoveryFiles['package.json'], { flag: 'wx' });
    } else await fs.writeFile(target, 'later author contents\n');
    const identity = await fs.stat(target), bytes = await fs.readFile(target);
    await expect(publishFixture(root)).rejects.toMatchObject({ code: 'WORKSPACE-INIT-003' });
    expect((await fs.stat(target)).ino).toBe(identity.ino);
    expect(await fs.readFile(target)).toEqual(bytes);
    await expect(fs.lstat(path.join(root, 'sec.yaml'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
}

test('completed Create keeps later author edits and rejects changed bytes or template intent', async () => {
  const root = await createWorkspace('workspace-create-completed-');
  await initWorkspace(root);
  const plan = path.join(root, 'sec.yaml'), extra = path.join(root, 'author-owned.txt');
  await fs.writeFile(plan, 'later author plan\n'); await fs.writeFile(extra, 'later author file\n');
  const before = await fs.stat(plan);
  await initWorkspace(root);
  expect((await fs.stat(plan)).ino).toBe(before.ino);
  expect(await fs.readFile(plan, 'utf8')).toBe('later author plan\n');
  expect(await fs.readFile(extra, 'utf8')).toBe('later author file\n');
  await expect(initWorkspace(root, { template: 'reference-customer' })).rejects.toMatchObject({ code: 'WORKSPACE-INIT-003', details: { reason: 'template-request-mismatch' } });
  const fixture = await createWorkspace('workspace-create-intent-bytes-'); await publishFixture(fixture);
  await expect(publishFixture(fixture, undefined, { ...recoveryFiles, 'sec.yaml': 'changed recipe bytes\n' }))
    .rejects.toMatchObject({ code: 'WORKSPACE-INIT-003', details: { reason: 'template-request-mismatch' } });
  expect(await fs.readFile(path.join(fixture, 'sec.yaml'), 'utf8')).toBe(recoveryFiles['sec.yaml']);
});

test('a copied record and guard namespace cannot confer creation ownership on another root', async () => {
  const original = await createWorkspace('workspace-create-original-'); await publishFixture(original);
  const root = await createWorkspace('workspace-create-forged-');
  const lease = await acquireWorkspaceWriteLease(root);
  try {
    const local = path.join(root, '.sec'), originalLocal = path.join(original, '.sec');
    const record = await fs.readFile(path.join(originalLocal, 'workspace-create.json'));
    await fs.writeFile(path.join(local, 'workspace-create.json'), record);
    const attempt = () => publishWorkspaceCreate({ workspaceRoot: root, token: lease.token, template: 'minimal',
      material: { directories: ['src', '.sec/workspace-write-lease'], files: Object.entries(recoveryFiles).map(([relativePath, bytes]) => ({ relativePath, bytes: Buffer.from(bytes) })) } });
    await expect(attempt()).rejects.toMatchObject({ code: 'WORKSPACE-INIT-003', details: { reason: 'unqualified-record' } });
    const guards = (await fs.readdir(originalLocal)).filter(name => name.startsWith('.journal-mutation-') || name.startsWith('.sec-journal-guard-'));
    expect(guards.length).toBe(2);
    for (const name of guards) await fs.writeFile(path.join(local, name), await fs.readFile(path.join(originalLocal, name)), { flag: 'wx' });
    await expect(attempt()).rejects.toMatchObject({ code: 'WORKSPACE-INIT-003', details: { reason: 'unqualified-record' } });
    expect(await fs.readFile(path.join(local, 'workspace-create.json'))).toEqual(record);
    await expect(fs.lstat(path.join(root, 'sec.yaml'))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { await lease.release(); }
});

test('unjournaled staging interruption leaves unknown residue and no public payload', async () => {
  const root = await createWorkspace('workspace-create-unknown-stage-');
  await expect(publishFixture(root, { beforeCreate: () => { throw new Error('interrupted-before-intent'); } })).rejects.toThrow('interrupted-before-intent');
  const local = path.join(root, '.sec'), stages = (await fs.readdir(local)).filter(name => name.startsWith('.workspace-create-'));
  expect(stages).toHaveLength(1);
  const before = await fs.stat(path.join(local, stages[0]!));
  if (process.platform === 'linux') expect(before.mode & 0o777).toBe(0o700 & ~process.umask());
  await expect(publishFixture(root)).rejects.toMatchObject({ code: 'WORKSPACE-INIT-001' });
  expect((await fs.stat(path.join(local, stages[0]!))).ino).toBe(before.ino);
  await expect(fs.lstat(path.join(root, 'sec.yaml'))).rejects.toMatchObject({ code: 'ENOENT' });
});

test('project-base recipe retains each original only-if-absent author surface', async () => {
  const root = await createWorkspace('workspace-create-recipe-preservation-');
  await ensureProjectBase(root);
  const optional = ['prisma/schema.prisma', 'model/policies/policy.spec.yaml', 'model/patches/override-manifest.yaml', CI_ARTIFACT_FILES.provenance];
  for (const relative of optional) await fs.writeFile(path.join(root, relative), 'owned author contents\n');
  await fs.writeFile(path.join(root, 'package.json'), 'replaceable scaffold contents\n');
  await ensureProjectBase(root);
  for (const relative of optional) expect(await fs.readFile(path.join(root, relative), 'utf8')).toBe('owned author contents\n');
  expect(await fs.readFile(path.join(root, 'package.json'), 'utf8')).toContain('generated-customer-admin');
});

for (const template of ['minimal', 'reference-customer'] as const) {
  for (const termination of ['settled-error', 'process-death'] as const) {
  test(`real ${template} init respects predecessor ${termination}`, async () => {
    const root = await createWorkspace('workspace-create-process-death-');
    const physicalModule = new URL('../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts', import.meta.url).href;
    const initializer = new URL('../../src/bootstrap/engineering/workspace-orchestrator.ts', import.meta.url).href;
    const script = `
      import { mock } from 'bun:test';
      import path from 'node:path';
      const physical = await import(${JSON.stringify(physicalModule)});
      const retain = physical.retainNoFollowFileTransaction;
      const root = ${JSON.stringify(root)};
      const actor = physical.createRetainedNoFollowFileTransactionTestActorForTests({
        afterNamespaceMutationBeforeFlush({targetPath}) {
          if (targetPath === path.join(root, 'sec.yaml')) {
            if (${JSON.stringify(termination)} === 'process-death') process.kill(process.pid, 'SIGKILL');
            throw new Error('settled-publication-interruption');
          }
        }
      });
      mock.module(${JSON.stringify(physicalModule)}, () => ({...physical,
        retainNoFollowFileTransaction(directory, label, suppliedActor) {
          return retain(directory, label, directory === root && label === 'Workspace Create publication' ? actor : suppliedActor);
        }
      }));
      const { initWorkspace } = await import(${JSON.stringify(initializer)});
      try {
        await initWorkspace(root, {template: ${JSON.stringify(template)}});
        throw new Error('expected process termination');
      } catch (error) {
        if (${JSON.stringify(termination)} !== 'settled-error' || error.message !== 'settled-publication-interruption') throw error;
      }
    `;
    const child = Bun.spawn([process.execPath, '--no-env-file', '-e', script], { stdout: 'pipe', stderr: 'pipe' });
    const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    expect(code, stderr).toBe(termination === 'process-death' ? 137 : 0);
    expect((await readCreateRecord(root)).phase).toBe('prepared');
    const published = await fs.stat(path.join(root, 'sec.yaml'));
    if (termination === 'process-death') {
      const recordBytes = await fs.readFile(path.join(root, '.sec/workspace-create.json'));
      const planBytes = await fs.readFile(path.join(root, 'sec.yaml'));
      // The existing lease owner cannot prove predecessor Effect quiescence.
      // Create must not use its receipt to bypass that authority boundary.
      await expect(initWorkspace(root, { template })).rejects.toMatchObject({ code: 'WORKSPACE-WRITE-LEASE-001' });
      expect(await fs.readFile(path.join(root, '.sec/workspace-create.json'))).toEqual(recordBytes);
      expect(await fs.readFile(path.join(root, 'sec.yaml'))).toEqual(planBytes);
      expect((await fs.stat(path.join(root, 'sec.yaml'))).ino).toBe(published.ino);
      return;
    }
    await initWorkspace(root, { template });
    expect((await fs.stat(path.join(root, 'sec.yaml'))).ino).toBe(published.ino);
    expect((await readCreateRecord(root)).phase).toBe('completed');
    expect((await fs.readdir(path.join(root, '.sec'))).filter(name => name.startsWith('.workspace-create-'))).toEqual([]);
    const plan = await loadPlan(path.join(root, 'sec.yaml'));
    expect(plan.app.id).toBe(template === 'minimal' ? 'app' : 'customer-admin');
  });
}
}

test('exclusive directory birth rejects invalid modes before creating a destination', async () => {
  const root = await createWorkspace('workspace-create-invalid-mode-');
  const retained = inspectNoFollowDirectoryChain(root, 'Create mode fixture').target;
  for (const mode of [-1, 0o1000, 1.5, Number.NaN]) {
    expect(() => createExclusiveNoFollowDirectory(retained, 'target', undefined, mode)).toThrow('creation mode is invalid');
    await expect(fs.lstat(path.join(root, 'target'))).rejects.toMatchObject({ code: 'ENOENT' });
  }
  createExclusiveNoFollowDirectory(retained, 'private');
  if (process.platform === 'linux') expect((await fs.stat(path.join(root, 'private'))).mode & 0o777).toBe(0o700 & ~process.umask());
});

for (const changed of ['file', 'directory', 'stage'] as const) {
  test(`Create refuses a same-inode ${changed} mode change between birth and intent`, async () => {
    if (process.platform !== 'linux') return; // POSIX modes have no Windows projection.
    const root = await createWorkspace('workspace-create-birth-mode-');
    let firstFile: string | undefined;
    let changedPath: string | undefined;
    let bornMode: number | undefined;
    await expect(publishFixture(root, { beforeCreate: async ({ targetPath }) => {
      if (changedPath !== undefined) return;
      if (changed === 'file') {
        if (firstFile === undefined) { firstFile = targetPath; return; }
        changedPath = firstFile;
      } else {
        const stages = (await fs.readdir(path.join(root, '.sec'))).filter(name => name.startsWith('.workspace-create-'));
        const stagePath = path.join(root, '.sec', stages[0]!);
        changedPath = changed === 'stage' ? stagePath : path.join(stagePath, 'src');
      }
      bornMode = (await fs.stat(changedPath)).mode & 0o777;
      await fs.chmod(changedPath, bornMode === 0o777 ? 0o700 : 0o777);
    } })).rejects.toMatchObject({ code: 'WORKSPACE-INIT-003', details: { reason: 'changed-staged-birth' } });
    expect(changedPath).toBeDefined();
    expect((await fs.stat(changedPath!)).mode & 0o777).not.toBe(bornMode);
    await expect(fs.lstat(path.join(root, 'sec.yaml'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.lstat(path.join(root, '.sec/workspace-create.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
}
