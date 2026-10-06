import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  inspectNoFollowDirectoryChain,
  retainNoFollowFileTransaction
} from '../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts';
import { removeNoFollowMigrationFile, updateNoFollowMigrationFile } from '../../src/adapters/upgrade/migration-physical.ts';
import { applyMigrationEntries } from '../../src/adapters/upgrade/migration-runtime.ts';
import {
  acknowledgeUpgradeFileMutation,
  admitUpgradeRecovery,
  assertUpgradeRecoveryIntent,
  createUpgradeRecoveryIntent,
  markUpgradeRecoveryUnknown,
  prepareUpgradeFileMutation
} from '../../src/adapters/upgrade/recovery-intent.ts';
import {
  restoreWorkspace,
  retireUpgradeBackup,
  snapshotWorkspace,
  type UpgradeWorkspaceSnapshot
} from '../../src/adapters/upgrade/workspace-snapshot.ts';
import { resolveWorkspaceArtifactPath } from '../../src/adapters/workspace-context.ts';
import { executeUpgradeApplyLifecycle } from '../../src/application/upgrade-apply.ts';
import { CI_ARTIFACT_FILES } from '../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import type { PlanFile } from '../../src/compiler/contract.ts';
import { sha256 } from '../../src/contracts/canonical.ts';
import type { CommitFence } from '../../src/contracts/commit-fence.ts';
import type { UpgradeMigrationEntry } from '../../src/semantics/upgrade/manifest-types.ts';
import {
  createUpgradeExecutionAttempt,
  createUpgradePlan,
  type UpgradeExecutionTerminal
} from '../../src/semantics/upgrade/upgrade-artifact.ts';

const originalPlan: PlanFile = {
  app: {
    id: 'recovery-fixture',
    name: 'Recovery fixture',
    stack: 'typescript-library',
    packageManager: 'npm',
    mode: 'single-tenant'
  },
  registry: { sources: [] },
  blocks: [{ id: 'fixture/customer', version: '0.1.0' }],
  acceptance: []
};
// Deliberately preserve formatting and CRLF. Rollback must restore original
// bytes, not serialize a semantically equivalent workspace plan.
const originalPlanBytes = Buffer.from(`${JSON.stringify(originalPlan, null, 2).replaceAll('\n', '\r\n')}\r\n`);
const appliedPlanBytes = Buffer.from(
  originalPlanBytes.toString('utf8').replace('"version": "0.1.0"', '"version": "0.2.0"')
);
const originalSchemaBytes = Buffer.from('model Customer {\n  id String @id\n  phone String\n}\n');
const originalLockBytes = Buffer.from('{"fixture":"original-lock"}\n');
const upgradePlan = createUpgradePlan({
  workspaceIdentityDigest: `sha256:${'3'.repeat(64)}`,
  blockId: 'fixture/customer',
  fromVersion: '0.1.0',
  toVersion: '0.2.0',
  planningInputRevision: `sha256:${'4'.repeat(64)}`,
  sourceRevision: `sha256:${'5'.repeat(64)}`,
  lockRevision: `sha256:${'6'.repeat(64)}`,
  compatibility: { blockApi: '1', compilerApi: '1', stackProfiles: ['typescript-library'] },
  preflightChecks: [],
  impacts: ['sec.yaml'],
  migrations: [],
  migrationKindCounts: {},
  migrationSummaries: [],
  migrationOperations: [],
  orderedSteps: []
});
const attempt = createUpgradeExecutionAttempt({
  leaseGeneration: 1,
  leaseId: 'recovery-fixture',
  ownerFileIdentityDigest: 'recovery-fixture-owner'
});
const binding = {
  operationIdentityDigest: upgradePlan.operationIdentityDigest,
  attemptRevision: attempt.attemptRevision
};
const healthyFence: CommitFence = async () => undefined;
const planMigration: UpgradeMigrationEntry = {
  id: 'publish-plan',
  kind: 'text-replace',
  reason: 'Advance the fixture block',
  target: 'sec.yaml',
  search: '"version": "0.1.0"',
  replacement: '"version": "0.2.0"'
};
const databaseMigration: UpgradeMigrationEntry = {
  id: 'copy-phone',
  kind: 'db-expand-contract',
  reason: 'Move the phone field',
  target: 'prisma/schema.prisma',
  entity: 'Customer',
  expandField: 'phoneNumber String?',
  contractField: 'phone',
  copyJobCode: 'await copyPhoneNumbers();'
};

interface RecoveryFixture {
  root: string;
  manifestRoot: string;
  planPath: string;
  schemaPath: string;
  jobPath: string;
  lockPath: string;
}

async function withRecoveryFixture(
  run: (fixture: RecoveryFixture, snapshot: UpgradeWorkspaceSnapshot) => Promise<void>,
  prepare: (fixture: RecoveryFixture) => Promise<void> = async () => undefined
): Promise<void> {
  const container = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-upgrade-recovery-'));
  const root = path.join(container, 'workspace');
  const fixture: RecoveryFixture = {
    root,
    manifestRoot: path.join(container, 'manifest'),
    planPath: path.join(root, 'sec.yaml'),
    schemaPath: path.join(root, 'prisma', 'schema.prisma'),
    jobPath: path.join(root, 'src', 'jobs', 'db-migrations', 'copy-phone.ts'),
    lockPath: resolveWorkspaceArtifactPath(root, CI_ARTIFACT_FILES.graphLock)
  };
  let snapshot: UpgradeWorkspaceSnapshot | undefined;
  try {
    for (const directory of [
      fixture.manifestRoot,
      path.dirname(fixture.schemaPath),
      path.dirname(fixture.jobPath),
      path.dirname(fixture.lockPath)
    ]) {
      await fs.mkdir(directory, { recursive: true });
    }
    await fs.writeFile(fixture.planPath, originalPlanBytes);
    await fs.writeFile(fixture.schemaPath, originalSchemaBytes);
    await fs.writeFile(fixture.lockPath, originalLockBytes);
    await prepare(fixture);
    snapshot = await snapshotWorkspace(root, fixture.lockPath, healthyFence, binding);
    await run(fixture, snapshot);
  } finally {
    try {
      // A retained backup is retired only after the test's recovery consumer
      // has finished inspecting it, including all fail-closed assertions.
      if (snapshot !== undefined) {
        const retained = await fs.lstat(snapshot.backup.path).then(
          () => true,
          (error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return false;
            throw error;
          }
        );
        // Lifecycle tests may expose an erroneous early retirement. Do not
        // obscure their primary assertion by attempting a second retirement.
        if (retained) await retireUpgradeBackup(snapshot);
      }
    } finally {
      await fs.rm(container, { recursive: true, force: true });
    }
  }
}

async function apply(
  fixture: RecoveryFixture,
  snapshot: UpgradeWorkspaceSnapshot,
  entries: UpgradeMigrationEntry[],
  impacts: string[],
  fence: CommitFence = healthyFence
): Promise<void> {
  await applyMigrationEntries(fixture.root, fixture.manifestRoot, impacts, entries, fence, snapshot.recoveryIntent);
}

async function expectAbsent(filePath: string): Promise<void> {
  await expect(fs.lstat(filePath)).rejects.toMatchObject({ code: 'ENOENT' });
}

async function readRecoveryRecord(
  snapshot: UpgradeWorkspaceSnapshot,
  kind: string
): Promise<{ path: string; bytes: Buffer }> {
  for (const entry of await fs.readdir(snapshot.backup.path, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const recordPath = path.join(snapshot.backup.path, entry.name);
    const bytes = await fs.readFile(recordPath);
    if ((JSON.parse(bytes.toString('utf8')) as { kind: string }).kind === kind) {
      return { path: recordPath, bytes };
    }
  }
  throw new Error(`No durable recovery record describes ${kind}`);
}

test('upgrade recovery restores original B after sequential updates and a copy-job fence failure', async () => {
  await withRecoveryFixture(async (fixture, snapshot) => {
    await apply(fixture, snapshot, [planMigration], ['sec.yaml']);
    expect(await fs.readFile(fixture.planPath)).toEqual(appliedPlanBytes);
    await apply(
      fixture,
      snapshot,
      [
        {
          id: 'advance-plan-again',
          kind: 'text-replace',
          reason: 'Exercise a second constituent on the same path',
          target: 'sec.yaml',
          search: '"version": "0.2.0"',
          replacement: '"version": "0.3.0"'
        }
      ],
      ['sec.yaml']
    );
    const finalBytes = Buffer.from(
      originalPlanBytes.toString('utf8').replace('"version": "0.1.0"', '"version": "0.3.0"')
    );
    expect(await fs.readFile(fixture.planPath)).toEqual(finalBytes);
    const copyFailure = new Error('copy-job write refused');
    let sawCommittedSchema = false;
    const failingCopyFence = async (): Promise<void> => {
      const schema = await fs.readFile(fixture.schemaPath, 'utf8');
      if (schema.includes('phoneNumber String?')) {
        sawCommittedSchema = true;
        await expectAbsent(fixture.jobPath);
        throw copyFailure;
      }
    };
    await expect(
      apply(
        fixture,
        snapshot,
        [databaseMigration],
        ['prisma/schema.prisma', 'src/jobs/db-migrations/copy-phone.ts'],
        failingCopyFence
      )
    ).rejects.toBe(copyFailure);
    expect(sawCommittedSchema).toBe(true);
    expect(await fs.readFile(fixture.schemaPath, 'utf8')).toContain('phoneNumber String?');
    expect(await fs.readFile(path.join(snapshot.preimage.path, 'sec.yaml'))).toEqual(originalPlanBytes);
    expect(await fs.readFile(path.join(snapshot.preimage.path, 'prisma', 'schema.prisma'))).toEqual(
      originalSchemaBytes
    );

    await restoreWorkspace(snapshot, fixture.lockPath, healthyFence);

    expect(await fs.readFile(fixture.planPath)).toEqual(originalPlanBytes);
    expect(await fs.readFile(fixture.schemaPath)).toEqual(originalSchemaBytes);
    expect(await fs.readFile(fixture.lockPath)).toEqual(originalLockBytes);
    await expectAbsent(fixture.jobPath);
    expect((await fs.stat(snapshot.backup.path)).isDirectory()).toBe(true);
  });
});

test('known file and graph-lock mutations roll back exact bytes, modes and absence', async () => {
  const deletedBytes = Buffer.from([0, 0xff, 0x80, 13, 10]);
  const renamedBytes = Buffer.from([0x81, 0, 0xfe, 10]);
  await withRecoveryFixture(
    async (fixture, snapshot) => {
      const deletedPath = path.join(fixture.root, 'src', 'deleted.bin');
      const oldPath = path.join(fixture.root, 'src', 'old.bin');
      const newPath = path.join(fixture.root, 'src', 'new.bin');
      const createdPath = path.join(fixture.root, 'src', 'created.txt');
      const beforeMode = (await fs.stat(deletedPath)).mode & 0o777;
      const renameMode = (await fs.stat(oldPath)).mode & 0o777;
      await apply(
        fixture,
        snapshot,
        [
          {
            id: 'create',
            kind: 'text-append',
            reason: 'Create a file',
            target: 'src/created.txt',
            content: 'new file\n'
          },
          { id: 'delete', kind: 'delete-file', reason: 'Delete a file', target: 'src/deleted.bin' },
          { id: 'rename', kind: 'rename-file', reason: 'Rename a file', source: 'src/old.bin', target: 'src/new.bin' }
        ],
        ['src/created.txt', 'src/deleted.bin', 'src/old.bin', 'src/new.bin']
      );
      expect(await fs.readFile(createdPath, 'utf8')).toBe('new file\n');
      expect(await fs.readFile(newPath)).toEqual(renamedBytes);
      await expectAbsent(oldPath);
      await expectAbsent(deletedPath);

      const changed = Buffer.from('{"fixture":"owned-lock-update"}\n');
      await updateNoFollowMigrationFile({ root: fixture.root, targetPath: fixture.lockPath,
        label: 'Upgrade graph lock constituent', commitFence: healthyFence,
        recoveryIntent: snapshot.recoveryIntent, createParents: false, update: () => changed });
      expect(await fs.readFile(fixture.lockPath)).toEqual(changed);

      await restoreWorkspace(snapshot, fixture.lockPath, healthyFence);

      expect(await fs.readFile(fixture.lockPath)).toEqual(originalLockBytes);
      expect(await fs.readFile(fixture.planPath)).toEqual(originalPlanBytes);
      expect(await fs.readFile(deletedPath)).toEqual(deletedBytes);
      expect(await fs.readFile(oldPath)).toEqual(renamedBytes);
      expect((await fs.stat(deletedPath)).mode & 0o777).toBe(beforeMode);
      expect((await fs.stat(oldPath)).mode & 0o777).toBe(renameMode);
      await expectAbsent(createdPath);
      await expectAbsent(newPath);
    },
    async ({ root }) => {
      await fs.writeFile(path.join(root, 'src', 'deleted.bin'), deletedBytes, { mode: 0o640 });
      await fs.writeFile(path.join(root, 'src', 'old.bin'), renamedBytes, { mode: 0o600 });
    }
  );
});

test('interrupted rollback resumes its saved reverse state and never reapplies a forward constituent', async () => {
  await withRecoveryFixture(async (fixture, snapshot) => {
    await apply(
      fixture,
      snapshot,
      [
        planMigration,
        {
          id: 'rename-schema-field',
          kind: 'text-replace',
          reason: 'Update a second file before rollback',
          target: 'prisma/schema.prisma',
          search: 'phone String',
          replacement: 'phoneNumber String?'
        }
      ],
      ['sec.yaml', 'prisma/schema.prisma']
    );
    expect(await fs.readFile(fixture.planPath)).toEqual(appliedPlanBytes);
    expect(await fs.readFile(fixture.schemaPath, 'utf8')).toContain('phoneNumber String?');
    const interruption = new Error('interrupt between restored files');
    let observedPartialRollback = false;
    const interruptedFence = async (): Promise<void> => {
      const planRestored = (await fs.readFile(fixture.planPath)).equals(originalPlanBytes);
      const schemaRestored = (await fs.readFile(fixture.schemaPath)).equals(originalSchemaBytes);
      if (planRestored !== schemaRestored) {
        observedPartialRollback = true;
        throw interruption;
      }
    };
    await expect(restoreWorkspace(snapshot, fixture.lockPath, interruptedFence)).rejects.toBe(interruption);
    expect(observedPartialRollback).toBe(true);
    const partialPlan = await fs.readFile(fixture.planPath);
    const partialSchema = await fs.readFile(fixture.schemaPath);
    expect(partialPlan.equals(originalPlanBytes)).not.toBe(partialSchema.equals(originalSchemaBytes));
    const alreadyRestoredPath = partialPlan.equals(originalPlanBytes) ? fixture.planPath : fixture.schemaPath;
    const restoredIdentity = await fs.stat(alreadyRestoredPath);
    expect(JSON.parse((await readRecoveryRecord(snapshot, 'rollback-direction')).bytes.toString('utf8')).kind).toBe(
      'rollback-direction'
    );

    await expect(
      apply(
        fixture,
        snapshot,
        [
          {
            id: 'forbidden-forward-reapply',
            kind: 'text-append',
            reason: 'Probe the persisted reverse-only direction',
            target: 'sec.yaml',
            content: '\nforward replay must not appear\n'
          }
        ],
        ['sec.yaml']
      )
    ).rejects.toMatchObject({ code: 'UPGRADE-BLOCKED-005' });
    expect(await fs.readFile(fixture.planPath)).toEqual(partialPlan);
    expect(await fs.readFile(fixture.schemaPath)).toEqual(partialSchema);

    await restoreWorkspace(snapshot, fixture.lockPath, healthyFence);

    expect(await fs.readFile(fixture.planPath)).toEqual(originalPlanBytes);
    expect(await fs.readFile(fixture.schemaPath)).toEqual(originalSchemaBytes);
    expect((await fs.stat(alreadyRestoredPath)).ino).toBe(restoredIdentity.ino);
  });
});

test('real directory creation records unsupported coverage and preserves its directory and output on recovery', async () => {
  await withRecoveryFixture(async (fixture, snapshot) => {
    await apply(
      fixture,
      snapshot,
      [
        planMigration,
        {
          id: 'create-tree',
          kind: 'create-directory',
          reason: 'Exercise unsupported directory recovery',
          target: 'src/generated'
        },
        {
          id: 'create-tree-output',
          kind: 'text-append',
          reason: 'Write output below the created directory',
          target: 'src/generated/output.txt',
          content: 'created output\n'
        }
      ],
      ['sec.yaml', 'src/generated', 'src/generated/output.txt']
    );
    const directoryPath = path.join(fixture.root, 'src', 'generated');
    const outputPath = path.join(directoryPath, 'output.txt');
    const beforeIdentity = await fs.stat(directoryPath);
    expect(beforeIdentity.isDirectory()).toBe(true);
    expect(await fs.readFile(outputPath, 'utf8')).toBe('created output\n');
    expect(JSON.parse((await readRecoveryRecord(snapshot, 'untracked-effect')).bytes.toString('utf8')).kind).toBe(
      'untracked-effect'
    );

    await expect(restoreWorkspace(snapshot, fixture.lockPath, healthyFence)).rejects.toMatchObject({
      code: 'UPGRADE-BLOCKED-005'
    });

    expect((await fs.stat(directoryPath)).ino).toBe(beforeIdentity.ino);
    expect(await fs.readFile(outputPath, 'utf8')).toBe('created output\n');
    expect(await fs.readFile(fixture.planPath)).toEqual(appliedPlanBytes);
    expect(await fs.readFile(path.join(snapshot.preimage.path, 'sec.yaml'))).toEqual(originalPlanBytes);
  });
});

test('tampered durable intent bytes refuse recovery before any live file is restored', async () => {
  await withRecoveryFixture(async (fixture, snapshot) => {
    await apply(fixture, snapshot, [planMigration], ['sec.yaml']);
    const record = await readRecoveryRecord(snapshot, 'prepared-intent');
    const planIdentity = await fs.stat(fixture.planPath);
    try {
      // A valid JSON document with different physical bytes must still fail
      // exact durable-record identity, even though its parsed value agrees.
      await fs.writeFile(record.path, Buffer.concat([record.bytes, Buffer.from(' ')]));

      await expect(restoreWorkspace(snapshot, fixture.lockPath, healthyFence)).rejects.toMatchObject({
        code: 'UPGRADE-BLOCKED-005'
      });

      expect(await fs.readFile(fixture.planPath)).toEqual(appliedPlanBytes);
      expect((await fs.stat(fixture.planPath)).ino).toBe(planIdentity.ino);
      expect(await fs.readFile(fixture.schemaPath)).toEqual(originalSchemaBytes);
      expect(await fs.readFile(path.join(snapshot.preimage.path, 'sec.yaml'))).toEqual(originalPlanBytes);
    } finally {
      // Restore only the test's own tamper so the fixture owner can retire
      // its backup; this is not an application recovery or repair flow.
      await fs.writeFile(record.path, record.bytes);
    }
  });
});

test('raw-byte drift with identical lossy UTF-8 text refuses all rollback writes', async () => {
  const before = Buffer.from([0, 0xfe, 0x80]);
  const after = Buffer.from([0, 0xff, 0x81]);
  const foreign = Buffer.from([0, 0xff, 0x82]);
  // This witness defeats decoded-text or length-only identity comparisons.
  expect(after.toString('utf8')).toBe(foreign.toString('utf8'));
  expect(after.length).toBe(foreign.length);
  await withRecoveryFixture(
    async (fixture, snapshot) => {
      await apply(
        fixture,
        snapshot,
        [
          planMigration,
          {
            id: 'replace-binary',
            kind: 'file-replace',
            reason: 'Replace exact binary bytes',
            source: 'after.bin',
            target: 'src/data.bin'
          }
        ],
        ['sec.yaml', 'src/data.bin']
      );
      const filePath = path.join(fixture.root, 'src', 'data.bin');
      expect(await fs.readFile(filePath)).toEqual(after);
      await fs.writeFile(filePath, foreign);
      const planIdentity = await fs.stat(fixture.planPath);

      await expect(restoreWorkspace(snapshot, fixture.lockPath, healthyFence)).rejects.toMatchObject({
        code: 'UPGRADE-BLOCKED-005'
      });

      expect(await fs.readFile(filePath)).toEqual(foreign);
      expect(await fs.readFile(fixture.planPath)).toEqual(appliedPlanBytes);
      expect((await fs.stat(fixture.planPath)).ino).toBe(planIdentity.ino);
      expect(await fs.readFile(path.join(snapshot.preimage.path, 'src', 'data.bin'))).toEqual(before);
    },
    async ({ root, manifestRoot }) => {
      await fs.writeFile(path.join(root, 'src', 'data.bin'), before);
      await fs.writeFile(path.join(manifestRoot, 'after.bin'), after);
    }
  );
});

test('a new external directory member is preserved before any known file is restored', async () => {
  await withRecoveryFixture(async (fixture, snapshot) => {
    await apply(fixture, snapshot, [planMigration], ['sec.yaml']);
    const externalPath = path.join(fixture.root, 'src', 'external.txt');
    const externalBytes = Buffer.from('external writer owns this\n');
    await fs.writeFile(externalPath, externalBytes);
    const planIdentity = await fs.stat(fixture.planPath);

    await expect(restoreWorkspace(snapshot, fixture.lockPath, healthyFence)).rejects.toMatchObject({
      code: 'UPGRADE-BLOCKED-005'
    });

    expect(await fs.readFile(externalPath)).toEqual(externalBytes);
    expect(await fs.readFile(fixture.planPath)).toEqual(appliedPlanBytes);
    expect((await fs.stat(fixture.planPath)).ino).toBe(planIdentity.ino);
    expect(await fs.readFile(fixture.schemaPath)).toEqual(originalSchemaBytes);
  });
});

for (const legacyKind of ['missing', 'unissued'] as const) {
  test(`${legacyKind} recovery intent cannot turn a genuine backup into restore authority`, async () => {
    await withRecoveryFixture(async (fixture, snapshot) => {
      await apply(fixture, snapshot, [planMigration], ['sec.yaml']);
      const { recoveryIntent: ignoredIntent, ...legacySnapshot } = snapshot;
      const unsupportedSnapshot =
        legacyKind === 'missing' ? legacySnapshot : { ...legacySnapshot, recoveryIntent: Object.freeze({}) };

      await expect(
        restoreWorkspace(unsupportedSnapshot as UpgradeWorkspaceSnapshot, fixture.lockPath, healthyFence)
      ).rejects.toMatchObject({ code: 'UPGRADE-BLOCKED-005' });

      expect(await fs.readFile(fixture.planPath)).toEqual(appliedPlanBytes);
      expect(await fs.readFile(fixture.schemaPath)).toEqual(originalSchemaBytes);
      expect(await fs.readFile(path.join(snapshot.preimage.path, 'sec.yaml'))).toEqual(originalPlanBytes);
    });
  });
}

test('a genuine intent from another snapshot cannot authorize a matching workspace rollback', async () => {
  await withRecoveryFixture(async (first, firstSnapshot) => {
    await withRecoveryFixture(async (second, secondSnapshot) => {
      await apply(first, firstSnapshot, [planMigration], ['sec.yaml']);
      await apply(second, secondSnapshot, [planMigration], ['sec.yaml']);
      const transplanted = { ...firstSnapshot, recoveryIntent: secondSnapshot.recoveryIntent };

      await expect(restoreWorkspace(transplanted, first.lockPath, healthyFence)).rejects.toMatchObject({
        code: 'UPGRADE-BLOCKED-005'
      });

      expect(await fs.readFile(first.planPath)).toEqual(appliedPlanBytes);
      expect(await fs.readFile(second.planPath)).toEqual(appliedPlanBytes);
      expect(await fs.readFile(path.join(firstSnapshot.preimage.path, 'sec.yaml'))).toEqual(originalPlanBytes);
      expect(await fs.readFile(path.join(secondSnapshot.preimage.path, 'sec.yaml'))).toEqual(originalPlanBytes);
    });
  });
});

test('a native write with prepared intent but no acknowledgment is refused without touching its A', async () => {
  await withRecoveryFixture(async (fixture, snapshot) => {
    const transaction = retainNoFollowFileTransaction(fixture.root, 'incomplete recovery constituent');
    try {
      const before = transaction.observe('sec.yaml', 'workspace plan before interrupted publication');
      expect(before).not.toBeNull();
      prepareUpgradeFileMutation(snapshot.recoveryIntent, [
        {
          path: fixture.planPath,
          before,
          after: appliedPlanBytes
        }
      ]);
      await transaction.rewriteExact('sec.yaml', before!, appliedPlanBytes, 'interrupted plan publication');
      // Simulate interruption after the real effect, before the intent owner
      // acknowledges native readback. The prepared A is not an acknowledgment.
    } finally {
      transaction.dispose();
    }
    const planIdentity = await fs.stat(fixture.planPath);

    await expect(restoreWorkspace(snapshot, fixture.lockPath, healthyFence)).rejects.toMatchObject({
      code: 'UPGRADE-BLOCKED-005'
    });

    expect(await fs.readFile(fixture.planPath)).toEqual(appliedPlanBytes);
    expect((await fs.stat(fixture.planPath)).ino).toBe(planIdentity.ino);
    expect(await fs.readFile(path.join(snapshot.preimage.path, 'sec.yaml'))).toEqual(originalPlanBytes);
  });
});

test('unknown compiler effects settle recovery-required and retain the original native backup', async () => {
  await withRecoveryFixture(async (fixture, snapshot) => {
    const compilerFailure = new Error('compiler stopped with unknown effects');
    const compilerPath = path.join(fixture.root, 'src', 'compiler-output.ts');
    const compilerBytes = Buffer.from('export const compilerEffect = true;\n');
    const terminals: UpgradeExecutionTerminal[] = [];
    const diagnostics: Array<{ phase: string; rollbackStatus: unknown }> = [];
    let retireCalls = 0;
    await expect(
      executeUpgradeApplyLifecycle(
        {
          plan: structuredClone(originalPlan),
          existingLock: null,
          upgradePlan,
          attempt
        },
        {
          snapshot: async () => snapshot,
          recoverySnapshot: (backup) => ({
            ...backup.backup,
            parentPath: backup.temporaryParent.path,
            parentDevice: backup.temporaryParent.device,
            parentInode: backup.temporaryParent.inode,
            status: 'retained-locator-only'
          }),
          clearExecutionTerminal: async () => undefined,
          clearDiagnostics: async () => undefined,
          publishPlan: async () => undefined,
          apply: async () => {
            await apply(fixture, snapshot, [planMigration], ['sec.yaml']);
            markUpgradeRecoveryUnknown(snapshot.recoveryIntent, 'compile');
            await fs.writeFile(compilerPath, compilerBytes);
            throw compilerFailure;
          },
          terminalReadback: {
            readPersistedPlan: () => upgradePlan,
            readWorkspacePlan: async () => JSON.parse(await fs.readFile(fixture.planPath, 'utf8')) as PlanFile
          },
          terminalPublication: {
            publish: async () => {
              throw new Error('applied terminal must not be published');
            },
            resolvePublication: () => 'unknown',
            isBeforeEffectFailure: () => false
          },
          recordGeneratedArtifacts: async () => {
            throw new Error('failed compile has no generated artifact settlement');
          },
          restore: (backup) => restoreWorkspace(backup, fixture.lockPath, healthyFence),
          publishExecutionTerminal: async (terminal) => {
            terminals.push(terminal);
            return terminal;
          },
          publishDiagnostics: async ({ phase, failure }) => {
            diagnostics.push({
              phase,
              rollbackStatus: (failure.details as { rollbackStatus?: unknown }).rollbackStatus
            });
          },
          retireBackup: async (backup) => {
            retireCalls += 1;
            await retireUpgradeBackup(backup);
          }
        }
      )
    ).rejects.toMatchObject({ code: 'UPGRADE-BLOCKED-005', details: { rollbackStatus: 'recovery-required' } });

    expect(retireCalls).toBe(0);
    expect(terminals.map(({ settlement }) => settlement)).toEqual(['recovery-required']);
    expect(diagnostics).toEqual([{ phase: 'recovery', rollbackStatus: 'recovery-required' }]);
    expect(await fs.readFile(fixture.planPath)).toEqual(appliedPlanBytes);
    expect(await fs.readFile(compilerPath)).toEqual(compilerBytes);
    expect(await fs.readFile(path.join(snapshot.preimage.path, 'sec.yaml'))).toEqual(originalPlanBytes);
    expect((await fs.stat(snapshot.backup.path)).isDirectory()).toBe(true);
  });
});

test('same-byte replacement by a different physical file is not adopted as the owned postimage', async () => {
  await withRecoveryFixture(async (fixture, snapshot) => {
    await apply(fixture, snapshot, [planMigration], ['sec.yaml']);
    const owned = await fs.stat(fixture.planPath);
    const replacement = path.join(fixture.root, 'replacement.tmp');
    await fs.writeFile(replacement, appliedPlanBytes, { mode: owned.mode & 0o7777 });
    await fs.rename(replacement, fixture.planPath);
    const foreign = await fs.stat(fixture.planPath);
    expect(foreign.ino).not.toBe(owned.ino);
    const publicProjection = snapshot.projection.find(entry => entry.relativePath === 'sec.yaml')!;
    const publicInventory = snapshot.backupInventory.find(entry => entry.relativePath === 'sec.yaml')!;
    expect(Reflect.set(publicProjection.identity!, 'inode', String(foreign.ino))).toBe(false);
    expect(Reflect.set(publicInventory, 'inode', String(foreign.ino))).toBe(false);
    expect(Reflect.set(snapshot.workspace, 'path', path.dirname(fixture.root))).toBe(false);
    await expect(restoreWorkspace(snapshot, fixture.lockPath, healthyFence)).rejects.toMatchObject({
      code: 'UPGRADE-BLOCKED-005'
    });
    expect(await fs.readFile(fixture.planPath)).toEqual(appliedPlanBytes);
    expect((await fs.stat(fixture.planPath)).ino).toBe(foreign.ino);
    expect(await fs.readFile(path.join(snapshot.preimage.path, 'sec.yaml'))).toEqual(originalPlanBytes);
  });
});

test.skipIf(process.platform !== 'linux')(
  'deleted-file restore uses sealed ordinary B mode, not later backup mode',
  async () => {
    await withRecoveryFixture(
      async (fixture, snapshot) => {
        const target = path.join(fixture.root, 'src', 'mode.txt');
        const original = path.join(snapshot.preimage.path, 'src', 'mode.txt');
        await apply(
          fixture,
          snapshot,
          [{ id: 'delete-mode', kind: 'delete-file', reason: 'mode boundary', target: 'src/mode.txt' }],
          ['src/mode.txt']
        );
        let fences = 0;
        try {
          await restoreWorkspace(snapshot, fixture.lockPath, async () => {
            if (++fences === 2) await fs.chmod(original, 0o777);
          });
          expect(await fs.readFile(target, 'utf8')).toBe('original mode');
          expect((await fs.stat(target)).mode & 0o7777).toBe(0o640);
        } finally {
          await fs.chmod(original, 0o640);
        }
      },
      async (fixture) => {
        await fs.writeFile(path.join(fixture.root, 'src', 'mode.txt'), 'original mode', { mode: 0o640 });
      }
    );
  }
);

test.skipIf(process.platform !== 'linux')(
  'unsupported special-bit creation refuses before any reverse write',
  async () => {
    await withRecoveryFixture(
      async (fixture, snapshot) => {
        const target = path.join(fixture.root, 'src', 'special.txt');
        await apply(
          fixture,
          snapshot,
          [
            planMigration,
            { id: 'delete-special', kind: 'delete-file', reason: 'special mode', target: 'src/special.txt' }
          ],
          ['sec.yaml', 'src/special.txt']
        );
        await expect(restoreWorkspace(snapshot, fixture.lockPath, healthyFence)).rejects.toMatchObject({
          code: 'UPGRADE-BLOCKED-005'
        });
        expect(await fs.readFile(fixture.planPath)).toEqual(appliedPlanBytes);
        await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
      },
      async (fixture) => {
        const file = path.join(fixture.root, 'src', 'special.txt');
        await fs.writeFile(file, 'special preimage');
        await fs.chmod(file, 0o4750);
      }
    );
  }
);

test('aggregate checkpoint admission leaves prior known state recoverable when next prepare exceeds budget', async () => {
  await withRecoveryFixture(async (fixture, snapshot) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-recovery-budget-'));
    try {
      await fs.mkdir(path.join(root, 'preimage'));
      const intent = createUpgradeRecoveryIntent({
        workspace: snapshot.workspace,
        backup: inspectNoFollowDirectoryChain(root, 'Budget fixture').target,
        binding,
        projection: snapshot.projection,
        limits: { maximumRecords: 1000, maximumRecordBytes: 10_000, maximumTotalBytes: 12_000 }
      });
      let previous = Buffer.alloc(40_000, 'a');
      await updateNoFollowMigrationFile({
        root: fixture.root,
        targetPath: fixture.planPath,
        label: 'First bounded mutation',
        commitFence: healthyFence,
        recoveryIntent: intent,
        createParents: false,
        update: () => previous
      });
      let rejected = false;
      for (let index = 0; index < 30; index += 1) {
        const next = Buffer.alloc(40_000, (index % 20) + 65);
        const recordsBefore = await fs.readdir(root);
        try {
          await updateNoFollowMigrationFile({
            root: fixture.root,
            targetPath: fixture.planPath,
            label: 'Next bounded mutation',
            commitFence: healthyFence,
            recoveryIntent: intent,
            createParents: false,
            update: () => next
          });
          previous = next;
        } catch (error) {
          expect(error).toMatchObject({ code: 'UPGRADE-BLOCKED-005' });
          expect(await fs.readdir(root)).toEqual(recordsBefore);
          rejected = true;
          break;
        }
      }
      expect(rejected).toBe(true);
      expect(await fs.readFile(fixture.planPath)).toEqual(previous);
      const current = retainNoFollowFileTransaction(fixture.root, 'Budget current readback');
      try {
        const file = current.observe('sec.yaml', 'Budget file')!;
        const projection = snapshot.projection.map((entry) =>
          entry.relativePath === 'sec.yaml'
            ? {
                ...entry,
                size: file.bytes.byteLength,
                contentDigest: sha256({ bytes: Buffer.from(file.bytes).toString('hex') }) as `sha256:${string}`,
                permissionMode: file.permissionMode,
                identity: file.identity
              }
            : entry.kind === 'directory'
              ? { ...entry, size: entry.size + 4096 }
              : entry
        );
        // Native directory storage size is not logical membership/content.
        expect(admitUpgradeRecovery(intent, projection)).toEqual(['sec.yaml']);
        assertUpgradeRecoveryIntent(intent);
      } finally {
        current.dispose();
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

test('large A binds within a small metadata budget without payload copies and wrong A is rejected', async () => {
  await withRecoveryFixture(async (fixture, snapshot) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-recovery-large-A-'));
    try {
      await fs.mkdir(path.join(root, 'preimage'));
      const intent = createUpgradeRecoveryIntent({
        workspace: snapshot.workspace,
        backup: inspectNoFollowDirectoryChain(root, 'Large A fixture').target,
        binding,
        projection: snapshot.projection,
        limits: { maximumRecords: 100, maximumRecordBytes: 16_384, maximumTotalBytes: 50_000 }
      });
      const payload = Buffer.alloc(256 * 1024, 0xff);
      await updateNoFollowMigrationFile({
        root: fixture.root,
        targetPath: fixture.planPath,
        label: 'Payload larger than record budget',
        commitFence: healthyFence,
        recoveryIntent: intent,
        createParents: false,
        update: () => payload
      });
      expect(await fs.readFile(fixture.planPath)).toEqual(payload);
      let recordBytes = 0;
      for (const name of await fs.readdir(root)) {
        if (!name.endsWith('.json')) continue;
        const bytes = await fs.readFile(path.join(root, name));
        recordBytes += bytes.byteLength;
        expect(bytes.byteLength).toBeLessThan(16_384);
        expect(bytes.toString('utf8')).not.toContain('afterBytes');
      }
      expect(recordBytes).toBeLessThan(50_000);
      const transaction = retainNoFollowFileTransaction(fixture.root, 'Wrong A native observation');
      try {
        const before = transaction.observe('sec.yaml', 'Current A')!;
        const intended = Buffer.alloc(payload.byteLength, 0xaa);
        const token = prepareUpgradeFileMutation(intent, [{ path: fixture.planPath, before, after: intended }]);
        const wrong = await transaction.rewriteExact(
          'sec.yaml',
          before,
          Buffer.alloc(payload.byteLength, 0xbb),
          'Wrong A fixture'
        );
        expect(() => acknowledgeUpgradeFileMutation(intent, token, [wrong])).toThrow('readback differs');
        expect(await fs.readFile(fixture.planPath)).toEqual(Buffer.alloc(payload.byteLength, 0xbb));
      } finally {
        transaction.dispose();
      }
      expect(await fs.readFile(path.join(snapshot.preimage.path, 'sec.yaml'))).toEqual(originalPlanBytes);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});


test('a different graph lock path cannot retarget an issued recovery snapshot', async () => {
  await withRecoveryFixture(async (fixture, snapshot) => {
    await apply(fixture, snapshot, [planMigration], ['sec.yaml']);
    const other = path.join(fixture.root, '.sec', 'other', path.basename(fixture.lockPath));
    await fs.mkdir(path.dirname(other), { recursive: true });
    await fs.writeFile(other, originalLockBytes);
    await expect(restoreWorkspace(snapshot, other, healthyFence)).rejects.toMatchObject({ code: 'UPGRADE-BLOCKED-005' });
    expect(await fs.readFile(fixture.planPath)).toEqual(appliedPlanBytes);
    expect(await fs.readFile(other)).toEqual(originalLockBytes);
    expect(await fs.readFile(fixture.lockPath)).toEqual(originalLockBytes);
  });
});


test('intent capture owns the original projection after caller data changes', async () => {
  await withRecoveryFixture(async (_fixture, snapshot) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-recovery-input-capture-'));
    try {
      await fs.mkdir(path.join(root, 'preimage'));
      const projection = structuredClone(snapshot.projection) as Array<typeof snapshot.projection[number]>;
      const intent = createUpgradeRecoveryIntent({
        workspace: snapshot.workspace,
        backup: inspectNoFollowDirectoryChain(root, 'Private intent fixture').target,
        binding: { ...binding }, projection,
        limits: { maximumRecords: 100, maximumRecordBytes: 16_384, maximumTotalBytes: 50_000 }
      });
      const originalFile = projection.find(entry => entry.relativePath === 'sec.yaml')!;
      Reflect.set(originalFile.identity!, 'inode', 'caller-replacement');
      Reflect.set(originalFile, 'contentDigest', 'sha256:' + 'f'.repeat(64));
      projection.splice(0, projection.length);
      expect(admitUpgradeRecovery(intent, snapshot.projection)).toEqual([]);
      assertUpgradeRecoveryIntent(intent);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
});


for (const targetKind of ['file', 'lock'] as const) {
  test(`reverse creation refuses a replaced ${targetKind} ancestor after its fence`, async () => {
    await withRecoveryFixture(async (fixture, snapshot) => {
      const target = targetKind === 'lock' ? fixture.lockPath : path.join(fixture.root, 'src', 'deleted.bin');
      await removeNoFollowMigrationFile({ root: fixture.root, targetPath: target,
        label: 'Owned deleted recovery constituent', commitFence: healthyFence,
        recoveryIntent: snapshot.recoveryIntent });
      const parent = path.dirname(target);
      const held = path.join(path.dirname(fixture.root), 'retained-original-parent');
      const marker = path.join(parent, 'foreign.txt');
      let fences = 0;
      await expect(restoreWorkspace(snapshot, fixture.lockPath, async () => {
        if (++fences !== 2) return;
        await fs.rename(parent, held);
        await fs.mkdir(parent);
        await fs.writeFile(marker, 'foreign parent content\n');
      })).rejects.toMatchObject({ code: 'UPGRADE-BLOCKED-005' });
      expect(fences).toBe(2);
      await expectAbsent(target);
      expect(await fs.readFile(marker, 'utf8')).toBe('foreign parent content\n');
      expect((await fs.stat(snapshot.backup.path)).isDirectory()).toBe(true);
    }, async fixture => {
      if (targetKind === 'file') await fs.writeFile(path.join(fixture.root, 'src', 'deleted.bin'), 'original file\n');
    });
  });
}

test.skipIf(process.platform !== 'linux')('reverse removal preserves an owned file whose mode changed at the fence', async () => {
  await withRecoveryFixture(async (fixture, snapshot) => {
    const target = path.join(fixture.root, 'src', 'created.txt');
    const bytes = Buffer.from('owned-created-content\n');
    await updateNoFollowMigrationFile({ root: fixture.root, targetPath: target,
      label: 'Owned created recovery constituent', commitFence: healthyFence,
      recoveryIntent: snapshot.recoveryIntent, createParents: false, update: () => bytes });
    const owned = await fs.stat(target);
    const foreignMode = (owned.mode & 0o7777) === 0o600 ? 0o644 : 0o600;
    let fences = 0;
    await expect(restoreWorkspace(snapshot, fixture.lockPath, async () => {
      if (++fences === 2) await fs.chmod(target, foreignMode);
    })).rejects.toMatchObject({ code: 'UPGRADE-BLOCKED-005' });
    expect(fences).toBe(2);
    const after = await fs.stat(target);
    expect(after.ino).toBe(owned.ino);
    expect(after.mode & 0o7777).toBe(foreignMode);
    expect(await fs.readFile(target)).toEqual(bytes);
    expect((await fs.stat(snapshot.backup.path)).isDirectory()).toBe(true);
  });
});

test('snapshot acquisition captures operation and attempt before the first suspended fence', async () => {
  await withRecoveryFixture(async fixture => {
    const supplied = { ...binding };
    const captured = await snapshotWorkspace(fixture.root, fixture.lockPath, async () => {
      supplied.operationIdentityDigest = `sha256:${'e'.repeat(64)}`;
      supplied.attemptRevision = `sha256:${'f'.repeat(64)}`;
    }, supplied);
    try {
      const record = JSON.parse((await readRecoveryRecord(captured, 'prepared-intent')).bytes.toString('utf8'));
      expect(record.body.binding).toEqual(binding);
      expect(record.body.binding).not.toEqual(supplied);
    } finally { await retireUpgradeBackup(captured); }
  });
});


test('final recovery readback rejects a foreign same-byte identity introduced by the last fence', async () => {
  await withRecoveryFixture(async (fixture, snapshot) => {
    await apply(fixture, snapshot, [planMigration], ['sec.yaml']);
    const original = await fs.stat(fixture.schemaPath);
    let changed = false;
    await expect(restoreWorkspace(snapshot, fixture.lockPath, async () => {
      if (changed || !(await fs.readFile(fixture.planPath)).equals(originalPlanBytes)) return;
      changed = true;
      const held = path.join(path.dirname(fixture.root), 'original-schema-file');
      await fs.rename(fixture.schemaPath, held);
      await fs.writeFile(fixture.schemaPath, originalSchemaBytes, { mode: original.mode & 0o7777 });
    })).rejects.toMatchObject({ code: 'UPGRADE-BLOCKED-005' });
    expect(changed).toBe(true);
    expect((await fs.stat(fixture.schemaPath)).ino).not.toBe(original.ino);
    expect(await fs.readFile(fixture.schemaPath)).toEqual(originalSchemaBytes);
    expect(await fs.readFile(fixture.planPath)).toEqual(originalPlanBytes);
    expect((await fs.stat(snapshot.backup.path)).isDirectory()).toBe(true);
  });
});
