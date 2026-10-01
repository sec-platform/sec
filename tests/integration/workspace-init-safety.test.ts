import { expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { writeProvenance } from '../../src/adapters/artifacts/provenance.ts';
import {
  acquireWorkspaceWriteLease,
  WorkspaceWriteLeaseError
} from '../../src/adapters/filesystem/write-lease.ts';
import { getWorkspacePaths, resolveWorkspaceArtifactPath } from "../../src/adapters/workspace-context.ts";
import { readLockFile } from "../../src/adapters/workspace/lock.ts";
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
  expect(plan.blocks).toEqual([]);
  expect(plan.acceptance).toEqual([]);
  expect(await fs.readFile(result.lockPath, 'utf8')).not.toContain('customer-admin');
  await expect(fs.lstat(paths.srcRoot)).resolves.toMatchObject({});
  if (process.platform === 'linux') {
    expect((await fs.stat(paths.srcRoot)).mode & 0o777).toBe(0o777 & ~process.umask());
    expect((await fs.stat(result.planPath)).mode & 0o777).toBe(0o666 & ~process.umask());
    expect((await fs.stat(result.lockPath)).mode & 0o777).toBe(0o600 & ~process.umask());
  }
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

test('repeated init cannot overwrite an existing SEC workspace', async () => {
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

  await expect(initWorkspace(workspaceRoot))
    .rejects.toMatchObject({ code: 'WORKSPACE-INIT-001' });

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

// The generation owner is tested at its physical boundary with independent,
// exact fixture bytes; the existing cases above cover both real templates.
const fixtureFiles: Readonly<Record<string, string>> = Object.freeze({
  'sec.yaml': 'app: generation-fixture\n',
  'package.json': '{"name":"generation-fixture"}\n',
  [CI_ARTIFACT_FILES.graphLock]: '{"fixture":"lock"}\n',
  [CI_ARTIFACT_FILES.verificationReport]: '{"summary":{"status":"pending"}}\n'
});
async function createFixtureGeneration(
  workspaceRoot: string,
  actor?: import('../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts').RetainedNoFollowFileTransactionTestActor
): Promise<void> {
  const { withWorkspaceWriteLease } = await import('../../src/adapters/filesystem/write-lease.ts');
  const { publishWorkspaceCreateGeneration } = await import('../../src/adapters/workspace/create-generation.ts');
  const { createRetainedNoFollowFileTransactionTestActorForTests } = await import('../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts');
  await withWorkspaceWriteLease(workspaceRoot, undefined, token => publishWorkspaceCreateGeneration({
    workspaceRoot, token, template: 'minimal',
    blueprint: { directories: ['.sec/cache', '.sec/workspace-write-lease', 'src'],
      files: Object.entries(fixtureFiles).map(([relativePath, bytes]) => ({ relativePath, bytes: Buffer.from(bytes), creationMode: relativePath === CI_ARTIFACT_FILES.graphLock ? 0o600 : 0o666 })) },
    ...(actor === undefined ? {} : { testOnlyActor: createRetainedNoFollowFileTransactionTestActorForTests(actor) })
  }));
}

test('external create between observation and publication preserves the foreign object and journal', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-init-create-race-');
  const external = Buffer.from('external author plan\n');
  await expect(createFixtureGeneration(workspaceRoot, {
    beforeRename: async ({ targetPath }) => {
      if (targetPath === path.join(workspaceRoot, 'sec.yaml')) await fs.writeFile(targetPath, external, { flag: 'wx' });
    }
  })).rejects.toMatchObject({ code: 'PHYSICAL_NO_FOLLOW_DURABILITY_FAILED' });
  expect(await fs.readFile(path.join(workspaceRoot, 'sec.yaml'))).toEqual(external);
  const journal = await fs.readFile(path.join(workspaceRoot, '.sec/workspace-create.json'));
  await expect(createFixtureGeneration(workspaceRoot)).rejects.toMatchObject({ code: 'WORKSPACE-INIT-003' });
  expect(await fs.readFile(path.join(workspaceRoot, 'sec.yaml'))).toEqual(external);
  expect(await fs.readFile(path.join(workspaceRoot, '.sec/workspace-create.json'))).toEqual(journal);
  await expect(fs.lstat(path.join(workspaceRoot, '.sec/workspace-created.json'))).rejects.toMatchObject({ code: 'ENOENT' });
});

test('a terminated writer resumes the prepared generation from physical readback without re-materialization', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-init-process-resume-');
  const { spawnSync } = await import('node:child_process');
  const leaseModule = new URL('../../src/adapters/filesystem/write-lease.ts', import.meta.url).href;
  const physicalModule = new URL('../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts', import.meta.url).href;
  const generationModule = new URL('../../src/adapters/workspace/create-generation.ts', import.meta.url).href;
  const script = `
    import fs from 'node:fs/promises';
    import path from 'node:path';
    import { createWorkspaceWriteLeaseManager } from ${JSON.stringify(leaseModule)};
    import { publishWorkspaceCreateGeneration } from ${JSON.stringify(generationModule)};
    import { createRetainedNoFollowFileTransactionTestActorForTests } from ${JSON.stringify(physicalModule)};
    const workspaceRoot = ${JSON.stringify(workspaceRoot)};
    const lease = await createWorkspaceWriteLeaseManager({ now: () => 0, heartbeatIntervalMs: 1000000, staleAfterMs: 1000001 }).acquire(workspaceRoot);
    await publishWorkspaceCreateGeneration({ workspaceRoot, token: lease.token, template: 'minimal',
      blueprint: { directories: ['.sec/cache', '.sec/workspace-write-lease', 'src'], files: Object.entries(${JSON.stringify(fixtureFiles)}).map(([relativePath, bytes]) => ({ relativePath, bytes: Buffer.from(bytes), creationMode: relativePath === ${JSON.stringify(CI_ARTIFACT_FILES.graphLock)} ? 0o600 : 0o666 })) },
      testOnlyActor: createRetainedNoFollowFileTransactionTestActorForTests({ afterNamespaceMutationBeforeFlush: ({ targetPath }) => { if (targetPath === path.join(workspaceRoot, 'sec.yaml')) process.exit(71); } })
    });
  `;
  const child = spawnSync(process.execPath, ['--no-env-file', '-e', script], { encoding: 'utf8', timeout: 10_000 });
  expect({ status: child.status, signal: child.signal, stderr: child.stderr }).toEqual({ status: 71, signal: null, stderr: '' });
  const lockPath = path.join(workspaceRoot, CI_ARTIFACT_FILES.graphLock);
  const before = await fs.stat(lockPath);
  expect(await fs.readFile(path.join(workspaceRoot, 'sec.yaml'), 'utf8')).toBe(fixtureFiles['sec.yaml']!);
  const recoveredPlanBarriers: string[] = [];
  await createFixtureGeneration(workspaceRoot, {
    durabilityObserver: event => {
      if (event.label === 'Workspace recovered file barrier' && event.targetPath === path.join(workspaceRoot, 'sec.yaml')) recoveredPlanBarriers.push(event.stage);
    },
    beforeCreate: ({ targetPath }) => {
      if (targetPath === path.join(workspaceRoot, '.sec/workspace-created.json')) {
        expect(recoveredPlanBarriers).toEqual(['file-flushed', 'parent-barrier']);
      }
    }
  });
  expect(recoveredPlanBarriers).toEqual(['file-flushed', 'parent-barrier']);
  for (const [relative, bytes] of Object.entries(fixtureFiles)) expect(await fs.readFile(path.join(workspaceRoot, relative), 'utf8')).toBe(bytes);
  expect((await fs.stat(lockPath)).ino).toBe(before.ino);
  expect((await fs.readdir(path.join(workspaceRoot, '.sec'))).filter(name => name.startsWith('.workspace-create-'))).toEqual([]);
  await expect(createFixtureGeneration(workspaceRoot)).rejects.toMatchObject({ code: 'WORKSPACE-INIT-001' });
});

test('recovery rejects a same-byte replacement instead of treating bytes as ownership', async () => {
  const container = await createWorkspace('engineering-compiler-init-identity-race-');
  const workspaceRoot = path.join(container, 'work');
  await fs.mkdir(workspaceRoot);
  await expect(createFixtureGeneration(workspaceRoot, {
    afterNamespaceMutationBeforeFlush: ({ targetPath }) => { if (targetPath === path.join(workspaceRoot, 'package.json')) throw new Error('interrupted'); }
  })).rejects.toThrow('interrupted');
  const target = path.join(workspaceRoot, 'package.json');
  const preserved = path.join(container, 'external-original.json');
  const old = await fs.readFile(target);
  await fs.rename(target, preserved);
  await fs.writeFile(target, old);
  const replacement = await fs.stat(target);
  await expect(createFixtureGeneration(workspaceRoot)).rejects.toMatchObject({ code: 'WORKSPACE-INIT-003' });
  expect(await fs.readFile(target)).toEqual(old);
  expect((await fs.stat(target)).ino).toBe(replacement.ino);
  expect(await fs.readFile(preserved)).toEqual(old);
  await expect(fs.lstat(path.join(workspaceRoot, 'sec.yaml'))).rejects.toMatchObject({ code: 'ENOENT' });
});

test('unfinished create binds both selected template and the physical workspace root', async () => {
  const container = await createWorkspace('engineering-compiler-init-root-binding-');
  const workspaceRoot = path.join(container, 'work');
  await fs.mkdir(workspaceRoot);
  await expect(createFixtureGeneration(workspaceRoot, { durabilityObserver: ({ targetPath, stage }) => { if (targetPath === path.join(workspaceRoot, '.sec/workspace-create.json') && stage === 'parent-barrier') throw new Error('prepared-only'); } })).rejects.toMatchObject({ code: 'WORKSPACE-INIT-003' });
  await expect(initWorkspace(workspaceRoot, { template: 'reference-customer' })).rejects.toMatchObject({ code: 'WORKSPACE-INIT-003', details: { reason: 'template-mismatch' } });
  const original = path.join(container, 'original');
  await fs.rename(workspaceRoot, original);
  await fs.mkdir(path.join(workspaceRoot, '.sec'), { recursive: true });
  await fs.copyFile(path.join(original, '.sec/workspace-create.json'), path.join(workspaceRoot, '.sec/workspace-create.json'));
  const lease = await acquireWorkspaceWriteLease(workspaceRoot);
  try {
    await expect(initWorkspace(workspaceRoot, {}, lease.token)).rejects.toMatchObject({ code: 'WORKSPACE-INIT-003', details: { reason: 'changed-root' } });
  } finally { await lease.release(); }
  await expect(fs.lstat(path.join(workspaceRoot, 'sec.yaml'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await fs.readFile(path.join(original, '.sec/workspace-create.json'))).toEqual(await fs.readFile(path.join(workspaceRoot, '.sec/workspace-create.json')));
});

test('unjournaled preparation residue is preserved and ordinary retry cannot adopt it', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-init-preparation-residue-');
  await expect(createFixtureGeneration(workspaceRoot, {
    beforeCreate: async ({ targetPath }) => {
      if (targetPath.includes('.workspace-create-') && path.basename(targetPath) === 'sec.yaml') {
        await fs.writeFile(path.join(path.dirname(targetPath), 'foreign-or-partial.txt'), 'preserve me');
        throw new Error('preparation interrupted');
      }
    }
  })).rejects.toMatchObject({ code: 'WORKSPACE-INIT-003', details: { reason: 'preparation-residue' } });
  const stageName = (await fs.readdir(path.join(workspaceRoot, '.sec'))).find(name => name.startsWith('.workspace-create-'))!;
  await expect(initWorkspace(workspaceRoot)).rejects.toMatchObject({ code: 'WORKSPACE-INIT-003', details: { reason: 'preparation-residue' } });
  expect(await fs.readFile(path.join(workspaceRoot, '.sec', stageName, 'foreign-or-partial.txt'), 'utf8')).toBe('preserve me');
  await expect(fs.lstat(path.join(workspaceRoot, '.sec/workspace-create.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(fs.lstat(path.join(workspaceRoot, 'sec.yaml'))).rejects.toMatchObject({ code: 'ENOENT' });
});
