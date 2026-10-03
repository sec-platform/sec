import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
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

// Native readback excludes only the active lease owner's changing namespace.
// It captures payload, journal, terminal and staging custody independently.
async function generationSnapshot(workspaceRoot: string): Promise<unknown[]> {
  const result: unknown[] = [];
  async function visit(relative: string): Promise<void> {
    if (relative === '.sec/workspace-write-lease') return;
    const absolute = path.join(workspaceRoot, relative);
    const stat = await fs.lstat(absolute);
    result.push({ relative, device: stat.dev, inode: stat.ino, mode: stat.mode,
      bytes: stat.isFile() ? (await fs.readFile(absolute)).toString('hex') : null });
    if (stat.isDirectory()) for (const name of (await fs.readdir(absolute)).sort()) await visit(path.posix.join(relative, name));
  }
  await visit('');
  return result;
}

async function interruptPreparedJournal(workspaceRoot: string): Promise<void> {
  await expect(createFixtureGeneration(workspaceRoot, {
    durabilityObserver: ({ targetPath, stage }) => {
      if (targetPath === path.join(workspaceRoot, '.sec/workspace-create.json') && stage === 'file-flushed') throw new Error('journal-parent-not-flushed');
    }
  })).rejects.toMatchObject({ code: 'WORKSPACE-INIT-003' });
}

test('recovered visible intent crosses file and parent barriers before any publication or retirement', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-init-intent-barrier-');
  await interruptPreparedJournal(workspaceRoot);
  const before = await generationSnapshot(workspaceRoot);
  const journalPath = path.join(workspaceRoot, '.sec/workspace-create.json');
  const journalBytes = await fs.readFile(journalPath);
  const journal = JSON.parse(journalBytes.toString('utf8')) as { entries: Array<{ relativePath: string; kind: string; device: string; inode: string }> };
  const barriers: string[] = [];
  await createFixtureGeneration(workspaceRoot, {
    durabilityObserver: async ({ label, stage }) => {
      if (label !== 'Workspace recovered intent barrier') return;
      barriers.push(stage);
      // Includes all directory frontiers, which have no file-rename callback.
      expect(await generationSnapshot(workspaceRoot)).toEqual(before);
    },
    beforeRename: () => { expect(barriers).toEqual(['file-flushed', 'parent-barrier']); },
    beforeCreate: () => { expect(barriers).toEqual(['file-flushed', 'parent-barrier']); }
  });
  expect(barriers).toEqual(['file-flushed', 'parent-barrier']);
  expect(await fs.readFile(journalPath)).toEqual(journalBytes);
  for (const [relative, bytes] of Object.entries(fixtureFiles)) {
    const expected = journal.entries.find(entry => entry.relativePath === relative)!;
    const stat = await fs.stat(path.join(workspaceRoot, relative));
    expect({ device: String(stat.dev), inode: String(stat.ino) }).toEqual({ device: expected.device, inode: expected.inode });
    expect(await fs.readFile(path.join(workspaceRoot, relative), 'utf8')).toBe(bytes);
  }
  expect((await fs.readdir(path.join(workspaceRoot, '.sec'))).filter(name => name.startsWith('.workspace-create-'))).toEqual([]);
});

test('a failed recovered intent barrier leaves all publication and staging identities untouched', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-init-intent-barrier-failure-');
  await interruptPreparedJournal(workspaceRoot);
  const before = await generationSnapshot(workspaceRoot);
  const effects: string[] = [];
  await expect(createFixtureGeneration(workspaceRoot, {
    beforeParentBarrier: ({ label }) => { if (label === 'Workspace recovered intent barrier') throw new Error('intent-barrier-failed'); },
    beforeRename: () => { effects.push('rename'); },
    beforeCreate: () => { effects.push('create'); },
    beforeCleanup: () => { effects.push('cleanup'); }
  })).rejects.toThrow('intent-barrier-failed');
  expect(effects).toEqual([]);
  expect(await generationSnapshot(workspaceRoot)).toEqual(before);
  await expect(fs.lstat(path.join(workspaceRoot, '.sec/workspace-created.json'))).rejects.toMatchObject({ code: 'ENOENT' });
});

test('an interrupted visible terminal is settled by exact barriers and fresh readback before repeated-init refusal', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-init-terminal-barrier-');
  await expect(createFixtureGeneration(workspaceRoot, {
    durabilityObserver: ({ targetPath, stage }) => {
      if (targetPath === path.join(workspaceRoot, '.sec/workspace-created.json') && stage === 'file-flushed') throw new Error('terminal-parent-not-flushed');
    }
  })).rejects.toThrow('terminal-parent-not-flushed');
  const before = await generationSnapshot(workspaceRoot);
  const barriers: string[] = [];
  await expect(createFixtureGeneration(workspaceRoot, {
    durabilityObserver: ({ label, stage }) => { barriers.push(`${label}:${stage}`); },
    beforeRename: () => { throw new Error('must not republish payload'); },
    beforeCreate: () => { throw new Error('must not recreate terminal'); }
  })).rejects.toMatchObject({ code: 'WORKSPACE-INIT-001' });
  expect(barriers).toEqual([
    'Workspace recovered intent barrier:file-flushed', 'Workspace recovered intent barrier:parent-barrier',
    'Workspace recovered terminal barrier:file-flushed', 'Workspace recovered terminal barrier:parent-barrier'
  ]);
  expect(await generationSnapshot(workspaceRoot)).toEqual(before);
});

test('failed terminal durability stays recovery-required and preserves the completed generation', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-init-terminal-barrier-failure-');
  await createFixtureGeneration(workspaceRoot);
  const before = await generationSnapshot(workspaceRoot);
  await expect(createFixtureGeneration(workspaceRoot, {
    beforeParentBarrier: ({ label }) => { if (label === 'Workspace recovered terminal barrier') throw new Error('terminal-barrier-failed'); }
  })).rejects.toMatchObject({ code: 'WORKSPACE-INIT-003', details: { reason: 'terminal-durability' } });
  expect(await generationSnapshot(workspaceRoot)).toEqual(before);
});

test('torn, foreign and premature terminals cannot suppress prepared-generation recovery', async () => {
  for (const kind of ['torn', 'wrong-generation', 'wrong-digest', 'extra-field', 'noncanonical', 'premature'] as const) {
    const workspaceRoot = await createWorkspace(`engineering-compiler-init-terminal-${kind}-`);
    await interruptPreparedJournal(workspaceRoot);
    const journalBytes = await fs.readFile(path.join(workspaceRoot, '.sec/workspace-create.json'));
    const journal = JSON.parse(journalBytes.toString('utf8')) as { generation: string };
    const value = {
      schema: 'sec-workspace-created-v1',
      generation: kind === 'wrong-generation' ? '00000000-0000-0000-0000-000000000000' : journal.generation,
      journalDigest: kind === 'wrong-digest' ? `sha256:${'0'.repeat(64)}` : `sha256:${createHash('sha256').update(journalBytes).digest('hex')}`,
      ...(kind === 'extra-field' ? { foreign: true } : {})
    };
    const terminal = kind === 'torn' ? '{"schema":' : kind === 'noncanonical' ? JSON.stringify(value) : `${JSON.stringify(value, null, 2)}\n`;
    await fs.writeFile(path.join(workspaceRoot, '.sec/workspace-created.json'), terminal, { flag: 'wx', mode: 0o600 });
    const before = await generationSnapshot(workspaceRoot);
    const effects: string[] = [];
    await expect(createFixtureGeneration(workspaceRoot, {
      beforeRename: () => { effects.push('rename'); },
      beforeCreate: () => { effects.push('create'); },
      durabilityObserver: () => { effects.push('barrier'); }
    })).rejects.toMatchObject({ code: 'WORKSPACE-INIT-003', details: { reason: kind === 'premature' ? 'terminal-before-stage-retirement' : 'invalid-terminal' } });
    expect(effects).toEqual([]);
    expect(await generationSnapshot(workspaceRoot)).toEqual(before);
  }
});

test('a valid historical terminal preserves later author edits and unrelated new files', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-init-terminal-author-edits-');
  await initWorkspace(workspaceRoot);
  await fs.writeFile(path.join(workspaceRoot, 'sec.yaml'), 'later author plan\n');
  await fs.writeFile(path.join(workspaceRoot, 'new-user-file.txt'), 'later author file\n');
  const before = await generationSnapshot(workspaceRoot);
  await expect(initWorkspace(workspaceRoot, { template: 'reference-customer' })).rejects.toMatchObject({ code: 'WORKSPACE-INIT-001' });
  expect(await generationSnapshot(workspaceRoot)).toEqual(before);
});

test('terminal recovery rejects same-byte replacement during its barrier without reclaiming the foreign inode', async () => {
  const container = await createWorkspace('engineering-compiler-init-terminal-replacement-');
  const workspaceRoot = path.join(container, 'work');
  await fs.mkdir(workspaceRoot);
  await createFixtureGeneration(workspaceRoot);
  const terminalPath = path.join(workspaceRoot, '.sec/workspace-created.json');
  const bytes = await fs.readFile(terminalPath);
  const originalPath = path.join(container, 'original-terminal.json');
  let replacementInode: number | undefined;
  await expect(createFixtureGeneration(workspaceRoot, {
    beforeParentBarrier: async ({ label }) => {
      if (label !== 'Workspace recovered terminal barrier') return;
      await fs.rename(terminalPath, originalPath);
      await fs.writeFile(terminalPath, bytes, { flag: 'wx', mode: 0o600 });
      replacementInode = (await fs.stat(terminalPath)).ino;
    }
  })).rejects.toMatchObject({ code: 'WORKSPACE-INIT-003', details: { reason: 'terminal-durability' } });
  expect(replacementInode).toBeDefined();
  expect((await fs.stat(terminalPath)).ino).toBe(replacementInode!);
  expect(await fs.readFile(terminalPath)).toEqual(bytes);
  expect(await fs.readFile(originalPath)).toEqual(bytes);
  for (const [relative, expected] of Object.entries(fixtureFiles)) expect(await fs.readFile(path.join(workspaceRoot, relative), 'utf8')).toBe(expected);
});

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

test('a legitimately released writer resumes visible publication through exact destination barriers', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-init-visible-publication-');
  await expect(createFixtureGeneration(workspaceRoot, {
    afterNamespaceMutationBeforeFlush: ({ targetPath }) => {
      if (targetPath === path.join(workspaceRoot, 'sec.yaml')) throw new Error('publication-parent-not-flushed');
    }
  })).rejects.toThrow('publication-parent-not-flushed');
  // The ordinary exception path has settled the transaction and released its
  // lease. This partial publication may now be recovered without reclaiming
  // authority from a dead or still-unsettled predecessor.
  const lockPath = path.join(workspaceRoot, CI_ARTIFACT_FILES.graphLock);
  const planPath = path.join(workspaceRoot, 'sec.yaml');
  const before = await Promise.all([fs.stat(lockPath), fs.stat(planPath)]);
  expect(await fs.readFile(planPath, 'utf8')).toBe(fixtureFiles['sec.yaml']!);
  await expect(fs.lstat(path.join(workspaceRoot, '.sec/workspace-created.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  const recoveredPlanBarriers: string[] = [];
  await createFixtureGeneration(workspaceRoot, {
    durabilityObserver: event => {
      if (event.label === 'Workspace recovered file barrier' && event.targetPath === planPath) recoveredPlanBarriers.push(event.stage);
    },
    beforeCreate: ({ targetPath }) => {
      if (targetPath === path.join(workspaceRoot, '.sec/workspace-created.json')) {
        expect(recoveredPlanBarriers).toEqual(['file-flushed', 'parent-barrier']);
      }
    }
  });
  expect(recoveredPlanBarriers).toEqual(['file-flushed', 'parent-barrier']);
  for (const [relative, bytes] of Object.entries(fixtureFiles)) expect(await fs.readFile(path.join(workspaceRoot, relative), 'utf8')).toBe(bytes);
  const after = await Promise.all([fs.stat(lockPath), fs.stat(planPath)]);
  expect(after.map(stat => ({ device: stat.dev, inode: stat.ino })))
    .toEqual(before.map(stat => ({ device: stat.dev, inode: stat.ino })));
  expect((await fs.readdir(path.join(workspaceRoot, '.sec'))).filter(name => name.startsWith('.workspace-create-'))).toEqual([]);
  await expect(createFixtureGeneration(workspaceRoot)).rejects.toMatchObject({ code: 'WORKSPACE-INIT-001' });
});

test('a terminated writer preserves its generation until predecessor effects are proven settled', async () => {
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
  const snapshot = await generationSnapshot(workspaceRoot);
  // Process death and old heartbeat timestamps cannot settle predecessor
  // effects. The lease owner must refuse before generation recovery writes.
  await expect(createFixtureGeneration(workspaceRoot)).rejects.toMatchObject({
    code: 'WORKSPACE-WRITE-LEASE-003',
    details: { phase: 'legacy-recovery', reason: 'effect-quiescence-unproven' }
  });
  expect(await generationSnapshot(workspaceRoot)).toEqual(snapshot);
  for (const [relative, bytes] of Object.entries(fixtureFiles)) expect(await fs.readFile(path.join(workspaceRoot, relative), 'utf8')).toBe(bytes);
  expect((await fs.stat(lockPath)).ino).toBe(before.ino);
  expect((await fs.readdir(path.join(workspaceRoot, '.sec'))).filter(name => name.startsWith('.workspace-create-'))).toHaveLength(1);
  await expect(fs.lstat(path.join(workspaceRoot, '.sec/workspace-created.json'))).rejects.toMatchObject({ code: 'ENOENT' });
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

test('generation scopes preserve primary failures while closing every acquired transaction', async () => {
  const root = await createWorkspace('engineering-compiler-init-settlement-');
  const { spawnSync } = await import('node:child_process');
  const physicalModule = new URL('../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts', import.meta.url).href;
  const leaseModule = new URL('../../src/adapters/filesystem/write-lease.ts', import.meta.url).href;
  const generationModule = new URL('../../src/adapters/workspace/create-generation.ts', import.meta.url).href;
  // Faults wrap real physical transactions in a child. The production generation
  // owner still performs its ordinary publication and resource settlement.
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
        const transaction = originalRetain(...args);
        const state = active;
        const label = args[1];
        const record = { label, closes: 0 };
        state.acquired.push(record);
        // Forward through an empty shell because the actual capability is
        // frozen; Proxy invariants prohibit replacing its own method values.
        return new Proxy({}, { get(_target, property) {
          const target = transaction;
          if (property === 'dispose') return () => {
            record.closes += 1;
            target.dispose();
            if (label === state.target) {
              state.closes.push('target');
              throw state.cleanup;
            }
            if (label === 'Workspace initial generation') {
              state.closes.push('outer');
              throw state.outerCleanup;
            }
          };
          const value = Reflect.get(target, property, target);
          if (typeof value !== 'function') return value;
          return (...values) => {
            if (!state.fired && state.failBody && label === state.target && property === state.method) {
              state.fired = true;
              throw state.primary;
            }
            return Reflect.apply(value, target, values);
          };
        } });
      }
    }));
    const { withWorkspaceWriteLease } = await import(${JSON.stringify(leaseModule)});
    const { publishWorkspaceCreateGeneration } = await import(${JSON.stringify(generationModule)});
    const leaves = error => error instanceof AggregateError
      ? error.errors.flatMap(leaves) : [error];
    const cases = [
      ['fresh', 'Workspace creation fresh readback', 'observe', false],
      ['fresh-undefined', 'Workspace creation fresh readback', 'observe', true],
      ['durability', 'Workspace recovered publication durability', 'flushExact', false],
      ['durability-undefined', 'Workspace recovered publication durability', 'flushExact', true],
      ['outer', 'Workspace initial generation', 'observe', false],
      ['outer-undefined', 'Workspace initial generation', 'observe', true],
      ['successful-publication', 'Workspace initial generation', null, false]
    ];
    for (const [name, target, method, throwsUndefined] of cases) {
      const workspaceRoot = path.join(${JSON.stringify(root)}, name);
      await fs.mkdir(workspaceRoot);
      const state = active = {
        target, method, failBody: method !== null, fired: false,
        primary: throwsUndefined ? undefined : Object.freeze({ name, failure: 'primary' }),
        cleanup: Object.freeze({ name, failure: 'cleanup' }),
        outerCleanup: Object.freeze({ name, failure: 'outer-cleanup' }),
        acquired: [], closes: []
      };
      let caught = false;
      try {
        await withWorkspaceWriteLease(workspaceRoot, undefined, token => publishWorkspaceCreateGeneration({
          workspaceRoot, token, template: 'minimal',
          blueprint: { directories: ['.sec/cache', '.sec/workspace-write-lease', 'src'],
            files: Object.entries(${JSON.stringify(fixtureFiles)}).map(([relativePath, bytes]) => ({
              relativePath, bytes: Buffer.from(bytes),
              creationMode: relativePath === ${JSON.stringify(CI_ARTIFACT_FILES.graphLock)} ? 0o600 : 0o666
            })) }
        }));
      } catch (error) {
        caught = true;
        const expected = [...(state.failBody ? [state.primary] : []), state.cleanup,
          ...(target === 'Workspace initial generation' ? [] : [state.outerCleanup])];
        assert.deepEqual(leaves(error), expected, name);
      }
      assert.equal(caught, true, name);
      assert.equal(state.fired, state.failBody, name);
      assert.deepEqual(state.closes, target === 'Workspace initial generation' ? ['target'] : ['target', 'outer'], name);
      assert.ok(state.acquired.length > 0, name);
      for (const record of state.acquired) assert.equal(record.closes, 1, name + ': ' + record.label);
      if (!state.failBody) {
        assert.equal(JSON.parse(await fs.readFile(path.join(workspaceRoot, '.sec/workspace-created.json'), 'utf8')).schema,
          'sec-workspace-created-v1');
      }
    }
    console.log('generation transactions settled');
  `;
  const child = spawnSync(process.execPath, ['--no-env-file', '-e', script], {
    encoding: 'utf8', timeout: 10_000
  });
  expect({ status: child.status, signal: child.signal, stderr: child.stderr }).toEqual({ status: 0, signal: null, stderr: '' });
  expect(child.stdout.trim()).toBe('generation transactions settled');
});
