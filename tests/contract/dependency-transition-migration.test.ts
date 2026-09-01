import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import { generatedStateDigest } from '../../src/runtime-state/generated-state/contract.ts';
import {
  generatedStateProducerHooks,
  inspectGeneratedState
} from '../../src/runtime-state/generated-state/lifecycle.ts';
import { inspectNoFollowDirectoryChain } from '../../src/runtime-state/physical/runtime/physical-no-follow.ts';
import { compilerDependencyIdentity } from '../../src/toolchain/dependencies/runtime/compiler-materialization-input.ts';
import {
  advanceDependencyTransition,
  beginDependencyTransition,
  readDependencyTransition,
  transitionFailure
} from '../../src/toolchain/dependencies/runtime/dependency-transition/operation.ts';
import {
  runtimeDependencyOperationOptions
} from '../../src/toolchain/dependencies/runtime/operation-context.ts';
import {
  runtimeDependencySourceGeneration
} from '../../src/toolchain/dependencies/runtime/source-generation.ts';
import { migrateDependencyTransitionJournal } from '../../src/toolchain/dependencies/test/runtime.ts';

const LEGACY_SCHEMA = 'sec-dependency-transition-journal-v1' as const;
const LEGACY_NAMESPACE = '.dependency-transition-v1';
const TARGET_NAMESPACE = '.dependency-transition-v2';
const SHA256_ZERO = `sha256:${'0'.repeat(64)}` as const;

type PhysicalIdentity = Readonly<{
  device: string;
  inode: string;
  objectId: string;
}>;

type TransitionSlot = Readonly<{
  bindingDigest: `sha256:${string}` | null;
  kind: 'absent';
  linkTarget: null;
  path: string;
  physical: null;
}>;

type LegacyRecord = Readonly<{
  attemptNonce: string;
  backup: null;
  destination: TransitionSlot;
  durability: 'known';
  failure: null;
  kind: 'compiler-generation';
  operationKey: `sha256:${string}`;
  ownerRoot: string;
  ownerRootPhysical: PhysicalIdentity;
  phase: 'prepared' | 'published' | 'complete';
  preimage: TransitionSlot;
  previousRecordDigest: `sha256:${string}` | null;
  recordDigest: `sha256:${string}`;
  schema: typeof LEGACY_SCHEMA;
  sequence: number;
  sourceGeneration: Readonly<{
    bindingDigest: `sha256:${string}`;
    epoch: `sha256:${string}`;
    ownerRoot: string;
    ownerRootPhysical: PhysicalIdentity;
    physical: PhysicalIdentity;
    schema: 'sec-runtime-dependency-source-generation-v1';
    sourcePath: string;
    treeDigest?: `sha256:${string}`;
    treeEntryCount?: number;
  }>;
  stage: null;
}>;

function physicalIdentity(chain: ReturnType<typeof inspectNoFollowDirectoryChain>): PhysicalIdentity {
  const { device, inode, objectId } = chain.target;
  return Object.freeze({ device, inode, objectId });
}

function absentSlot(slotPath: string): TransitionSlot {
  return Object.freeze({
    bindingDigest: null,
    kind: 'absent',
    linkTarget: null,
    path: slotPath,
    physical: null
  });
}

function legacyRecordBytes(record: LegacyRecord): Buffer {
  return Buffer.from(`${JSON.stringify(record, null, 2)}\n`, 'utf8');
}

function buildLegacyRecords(root: string, count = 3): readonly LegacyRecord[] {
  const ownerChain = inspectNoFollowDirectoryChain(root, 'migration test owner root');
  const ownerRootPhysical = physicalIdentity(ownerChain);
  const sourceRoot = path.join(root, 'source');
  const sourcePath = path.join(sourceRoot, 'node_modules');
  const destinationPath = path.join(root, 'node_modules');
  const operationKey = generatedStateDigest({
    domain: 'dependency-transition-migration-test',
    root
  });
  const sourceGeneration = Object.freeze({
    bindingDigest: SHA256_ZERO,
    epoch: generatedStateDigest({ domain: 'source-epoch', root }),
    ownerRoot: root,
    ownerRootPhysical,
    physical: Object.freeze({
      device: 'test-device',
      inode: 'test-source-inode',
      objectId: 'test-source-object'
    }),
    schema: 'sec-runtime-dependency-source-generation-v1' as const,
    sourcePath
  });

  let previousRecordDigest: `sha256:${string}` | null = null;
  const records: LegacyRecord[] = [];
  for (let sequence = 1; sequence <= count; sequence += 1) {
    const unsigned = {
      schema: LEGACY_SCHEMA,
      previousRecordDigest,
      sequence,
      operationKey,
      attemptNonce: `migration-test-attempt-${sequence}`,
      kind: 'compiler-generation' as const,
      ownerRoot: root,
      ownerRootPhysical,
      destination: absentSlot(destinationPath),
      preimage: absentSlot(destinationPath),
      stage: null,
      backup: null,
      sourceGeneration,
      phase: (sequence === 1 ? 'prepared' : sequence === count ? 'complete' : 'published') as LegacyRecord['phase'],
      durability: 'known' as const,
      failure: null
    };
    const record = Object.freeze({
      ...unsigned,
      recordDigest: generatedStateDigest(unsigned)
    }) as LegacyRecord;
    records.push(record);
    previousRecordDigest = record.recordDigest;
  }
  return Object.freeze(records);
}

function legacyRecordsRoot(root: string): string {
  return path.join(
    root,
    '.tmp',
    'dependency-installs',
    'compiler-backups',
    LEGACY_NAMESPACE,
    'records'
  );
}

function targetJournalRoot(root: string): string {
  return path.join(
    root,
    '.tmp',
    'dependency-installs',
    'compiler-backups',
    TARGET_NAMESPACE
  );
}

function compilerStagePath(root: string, name: string): string {
  return path.join(root, '.tmp', 'dependency-installs', `c.staging-${name}`);
}

function compilerStageRelativePath(root: string, name: string): string {
  return path.relative(root, compilerStagePath(root, name)).replaceAll('\\', '/');
}

async function registerCompilerStage(
  root: string,
  name: string,
  state: 'active' | 'retired'
): Promise<string> {
  const stagePath = compilerStagePath(root, name);
  const relativePath = compilerStageRelativePath(root, name);
  await mkdir(path.join(stagePath, 'node_modules'), { recursive: true });
  const lifecycle = generatedStateProducerHooks({
    repositoryRoot: root,
    workspaceRoot: root
  });
  await lifecycle.born(relativePath, `dependency-transition-test-${name}`);
  if (state === 'retired') {
    await lifecycle.retired(relativePath, 'dependency-transition-test-retired');
  }
  return relativePath;
}

async function writeLegacyRecords(
  root: string,
  records = buildLegacyRecords(root)
): Promise<readonly LegacyRecord[]> {
  const recordsRoot = legacyRecordsRoot(root);
  await mkdir(recordsRoot, { recursive: true });
  for (const record of records) {
    await writeFile(
      path.join(recordsRoot, `record-${record.recordDigest.slice('sha256:'.length)}.json`),
      legacyRecordBytes(record)
    );
  }
  return records;
}

async function expectBlockedMigration(root: string): Promise<void> {
  let error: unknown;
  try {
    await migrateDependencyTransitionJournal(root, {
      lockTimeoutMs: 30_000
    });
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeDefined();
  expect(error).toMatchObject({ code: expect.stringMatching(/^RUNTIME-DEPS-00[24]$/u) });
}

async function readRegularFiles(root: string): Promise<ReadonlyMap<string, Buffer>> {
  const files = new Map<string, Buffer>();
  const visit = async (directory: string, relative = ''): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const nextRelative = path.join(relative, entry.name);
      const nextPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(nextPath, nextRelative);
      else if (entry.isFile()) files.set(nextRelative, await readFile(nextPath));
    }
  };
  await visit(root);
  return files;
}

function expectSameFileSet(
  actual: ReadonlyMap<string, Buffer>,
  expected: ReadonlyMap<string, Buffer>
): void {
  expect([...actual.keys()].sort()).toEqual([...expected.keys()].sort());
  for (const [name, bytes] of expected) {
    expect(actual.get(name)).toEqual(bytes);
  }
}

const COMPILER_BINDING_FILE = '.sec-compiler-deps-binding-v5.json';

function pinnedBunVersionForTest(): string {
  const match = /^(\d+)\.(\d+)\.(\d+)/u.exec(process.versions.bun ?? '');
  if (match === null) throw new Error('test requires one semantic Bun runtime version');
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

async function prepareBridgeRecovery(input: Readonly<{
  failure: 'bun-runtime-drift' | Readonly<{ code: string; message: string }> | null;
  root: string;
}>): Promise<Readonly<{
  bridgePath: string;
  installIdentityFailure: Readonly<{ code: string; message: string }> | null;
  pinnedBunVersion: string;
  sourcePath: string;
}>> {
  const pinnedBunVersion = pinnedBunVersionForTest();
  const sourcePath = path.join(input.root, 'node_modules');
  const bridgePath = path.join(input.root, 'consumer', 'node_modules');
  await mkdir(sourcePath, { recursive: true });
  await mkdir(path.dirname(bridgePath), { recursive: true });
  const fixtureIdentity = generatedStateDigest({ ownerRoot: input.root, pinnedBunVersion });
  const binding = Object.freeze({
    architecture: process.arch,
    bunExecutablePath: path.join(input.root, 'persisted-bun.exe'),
    bunExecutableSha256: fixtureIdentity,
    bunVersion: pinnedBunVersion,
    declaredBunVersion: pinnedBunVersion,
    dependencyManifestSha256: fixtureIdentity,
    formatVersion: 'compiler-deps-binding-v5' as const,
    installConfigSha256: null,
    lockSha256: fixtureIdentity,
    manifestHash: fixtureIdentity,
    packages: Object.freeze([]),
    platform: process.platform,
    runtimeMaterialization: null
  });
  await Promise.all([
    writeFile(path.join(sourcePath, COMPILER_BINDING_FILE), `${JSON.stringify(binding)}\n`, 'utf8'),
    writeFile(path.join(input.root, '.bun-version'), `${pinnedBunVersion}\n`, 'utf8'),
    writeFile(path.join(input.root, 'bun.lock'), '', 'utf8'),
    writeFile(path.join(input.root, 'package.json'), `${JSON.stringify({
      dependencies: {},
      devDependencies: {},
      packageManager: `bun@${pinnedBunVersion}`
    })}\n`, 'utf8')
  ]);
  const options = runtimeDependencyOperationOptions({ lockTimeoutMs: 30_000 });
  const sourceGeneration = await runtimeDependencySourceGeneration({
    binding,
    options,
    ownerRoot: input.root,
    sourcePath
  });
  let transition = await beginDependencyTransition({
    backupPath: null,
    bindingDigest: sourceGeneration.bindingDigest,
    destinationPath: bridgePath,
    kind: 'compiler-bridge',
    options,
    ownerRoot: input.root,
    sourceGeneration,
    stagePath: null
  });
  let installIdentityFailure: Readonly<{ code: string; message: string }> | null = null;
  if (input.failure === 'bun-runtime-drift') {
    try {
      await compilerDependencyIdentity(input.root);
      throw new Error('mismatched materialization identity was accepted');
    } catch (error) {
      installIdentityFailure = transitionFailure(error);
    }
  }
  const durableFailure = input.failure === 'bun-runtime-drift'
    ? installIdentityFailure
    : input.failure;
  if (durableFailure !== null) {
    transition = await advanceDependencyTransition(transition, {
      durability: 'unknown',
      failure: durableFailure,
      phase: 'recovery-required'
    }, options);
  }
  expect(transition.destination.kind).toBe('absent');
  return Object.freeze({ bridgePath, installIdentityFailure, pinnedBunVersion, sourcePath });
}

test('settles only the persisted current-Bun recovery premise without admitting a new install', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sec-dependency-bridge-bun-drift-'));
  try {
    const { installIdentityFailure } = await prepareBridgeRecovery({
      failure: 'bun-runtime-drift',
      root
    });

    // The materialization identity remains strict: this root cannot start a
    // new install under the current Bun generation.
    expect(installIdentityFailure).toMatchObject({
      code: 'IMPORT-AUTHORITY-001',
      message: expect.stringContaining('Bun runtime identity mismatch')
    });

    let commandStarts = 0;
    await migrateDependencyTransitionJournal(root, {
      materialize: async () => {
        commandStarts += 1;
        return { code: 0, stderr: '', stdout: '' };
      },
      lockTimeoutMs: 30_000
    });
    const terminal = await readDependencyTransition(
      root,
      runtimeDependencyOperationOptions({ lockTimeoutMs: 30_000 })
    );
    expect(terminal).toMatchObject({
      durability: 'known',
      failure: null,
      kind: 'compiler-bridge',
      phase: 'rolled-back'
    });
    expect(commandStarts).toBe(0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('settles exact active and retired legacy stage registrations without admitting installation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sec-dependency-stage-registration-'));
  try {
    const active = await registerCompilerStage(root, 'active', 'active');
    const retired = await registerCompilerStage(root, 'retired', 'retired');
    let commandStarts = 0;

    await migrateDependencyTransitionJournal(root, {
      materialize: async () => {
        commandStarts += 1;
        return { code: 0, stderr: '', stdout: '' };
      },
      lockTimeoutMs: 30_000
    });

    const inventory = await inspectGeneratedState({
      repositoryRoot: root,
      workspaceRoot: root,
      relativePaths: [active, retired]
    });
    expect(commandStarts).toBe(0);
    expect(inventory.blockers).toEqual([]);
    expect(inventory.entries.map(({ kind, registrationState }) => ({ kind, registrationState })))
      .toEqual([
        { kind: 'missing', registrationState: 'missing' },
        { kind: 'missing', registrationState: 'missing' }
      ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 10_000);

test('preserves unregistered or physically replaced legacy stages before any settlement effect', async () => {
  for (const mutation of ['unregistered', 'replaced'] as const) {
    const root = await mkdtemp(path.join(os.tmpdir(), `sec-dependency-stage-${mutation}-`));
    try {
      const registered = await registerCompilerStage(root, 'registered', 'retired');
      const blockedPath = compilerStagePath(root, 'blocked');
      await mkdir(path.join(blockedPath, 'node_modules'), { recursive: true });
      if (mutation === 'replaced') {
        const blockedRelative = compilerStageRelativePath(root, 'blocked');
        const lifecycle = generatedStateProducerHooks({ repositoryRoot: root, workspaceRoot: root });
        await lifecycle.born(blockedRelative, 'dependency-transition-test-replaced');
        await rename(blockedPath, `${blockedPath}-original`);
        await mkdir(path.join(blockedPath, 'node_modules'), { recursive: true });
      }

      await expect(migrateDependencyTransitionJournal(root, {
        lockTimeoutMs: 30_000
      })).rejects.toMatchObject({ code: 'RUNTIME-DEPS-004' });

      const registeredInventory = await inspectGeneratedState({
        repositoryRoot: root,
        workspaceRoot: root,
        relativePaths: [registered]
      });
      expect(registeredInventory.entries[0]).toMatchObject({
        kind: 'directory',
        registrationState: 'retired'
      });
      expect((await readdir(path.dirname(blockedPath))).includes(path.basename(blockedPath))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('preserves unknown bridge recovery failures instead of reclassifying them as Bun drift', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sec-dependency-bridge-unknown-'));
  try {
    await prepareBridgeRecovery({
      failure: Object.freeze({ code: 'UNKNOWN-RECOVERY', message: 'unclassified owner failure' }),
      root
    });
    const recordsRoot = path.join(targetJournalRoot(root), 'records');
    const beforeRecords = (await readdir(recordsRoot)).sort();
    await expect(migrateDependencyTransitionJournal(root, {
      lockTimeoutMs: 30_000
    })).rejects.toMatchObject({ code: 'IMPORT-AUTHORITY-004' });
    expect((await readdir(recordsRoot)).sort()).toEqual(beforeRecords);
    const preserved = await readDependencyTransition(
      root,
      runtimeDependencyOperationOptions({ lockTimeoutMs: 30_000 })
    );
    expect(preserved).toMatchObject({
      failure: { code: 'UNKNOWN-RECOVERY', message: 'unclassified owner failure' },
      phase: 'recovery-required'
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('blocks bridge recovery when persisted source, destination, owner, or journal evidence changes', async () => {
  for (const mutation of ['source', 'destination', 'owner', 'journal'] as const) {
    const root = await mkdtemp(path.join(os.tmpdir(), `sec-dependency-bridge-${mutation}-`));
    let displacedRoot: string | null = null;
    try {
      const { bridgePath, pinnedBunVersion, sourcePath } = await prepareBridgeRecovery({
        failure: 'bun-runtime-drift',
        root
      });
      // The helper derives the same deterministic mismatch value; keeping it
      // separate from source/destination mutations avoids making the test
      // depend on the repository's declared Bun version.
      expect(pinnedBunVersion).toBe(pinnedBunVersionForTest());
      if (mutation === 'source') {
        await writeFile(path.join(sourcePath, 'tampered-after-intent.txt'), 'tamper\n', 'utf8');
      } else if (mutation === 'destination') {
        await mkdir(bridgePath);
      } else if (mutation === 'owner') {
        displacedRoot = `${root}-displaced`;
        await rename(root, displacedRoot);
        await mkdir(root);
        for (const entry of ['.tmp', '.bun-version', 'bun.lock', 'consumer', 'node_modules', 'package.json']) {
          await rename(path.join(displacedRoot, entry), path.join(root, entry));
        }
      } else {
        const recordsRoot = path.join(targetJournalRoot(root), 'records');
        for (const name of await readdir(recordsRoot)) {
          const recordPath = path.join(recordsRoot, name);
          const value = JSON.parse(await readFile(recordPath, 'utf8')) as Record<string, unknown>;
          if (value.phase === 'recovery-required') {
            await writeFile(recordPath, `${JSON.stringify({ ...value, unexpected: true })}\n`, 'utf8');
            break;
          }
        }
      }
      await expect(migrateDependencyTransitionJournal(root, {
        lockTimeoutMs: 30_000
      })).rejects.toMatchObject({ code: expect.stringMatching(/^(?:IMPORT-AUTHORITY-004|RUNTIME-DEPS-002)$/u) });
    } finally {
      await rm(root, { recursive: true, force: true });
      if (displacedRoot !== null) await rm(displacedRoot, { recursive: true, force: true });
    }
  }
});

test('retires a valid terminal legacy ledger into one immutable v2 admission and retains v1 evidence', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sec-dependency-transition-migration-'));
  try {
    const records = await writeLegacyRecords(root);
    const oldBytes = new Map<string, Buffer>();
    for (const record of records) {
      oldBytes.set(
        `record-${record.recordDigest.slice('sha256:'.length)}.json`,
        legacyRecordBytes(record)
      );
    }

    await migrateDependencyTransitionJournal(root, {
      lockTimeoutMs: 30_000
    });

    expect(await readRegularFiles(legacyRecordsRoot(root))).toEqual(oldBytes);
    const targetFiles = await readRegularFiles(targetJournalRoot(root));
    const targetRecordFiles = [...targetFiles.entries()]
      .filter(([name]) => name.startsWith('records' + path.sep));
    expect(targetRecordFiles).toHaveLength(0);
    expect([...targetFiles.keys()].some((name) => /migration-.*-prepared\.json$/u.test(name))).toBe(true);
    expect([...targetFiles.keys()].some((name) => /migration-.*-complete\.json$/u.test(name))).toBe(true);
    expect(await readdir(legacyRecordsRoot(root))).toHaveLength(records.length);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('accepts a native empty v2 namespace without legacy source or migration intent', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sec-dependency-transition-native-v2-'));
  try {
    const targetRoot = targetJournalRoot(root);
    await mkdir(path.join(targetRoot, 'records'), { recursive: true });
    await mkdir(path.join(targetRoot, 'rollovers'));

    await migrateDependencyTransitionJournal(root, {
      lockTimeoutMs: 30_000
    });

    const backupRoot = path.dirname(targetRoot);
    expect(await readdir(backupRoot)).not.toContain(LEGACY_NAMESPACE);
    expect(await readRegularFiles(targetRoot)).toEqual(new Map());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects a well-formed legacy chain whose final phase is not terminal', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sec-dependency-transition-nonterminal-'));
  try {
    const records = buildLegacyRecords(root, 2);
    const terminalUnsigned = {
      ...Object.fromEntries(Object.entries(records[1]!).filter(([key]) => key !== 'recordDigest')),
      phase: 'published'
    };
    const nonterminal = Object.freeze({
      ...terminalUnsigned,
      recordDigest: generatedStateDigest(terminalUnsigned)
    }) as LegacyRecord;
    await writeLegacyRecords(root, [records[0]!, nonterminal]);
    await expectBlockedMigration(root);
    expect(await readdir(path.join(root, '.tmp', 'dependency-installs', 'compiler-backups')))
      .not.toContain(TARGET_NAMESPACE);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects foreign, partial, forked, and digest-invalid legacy sources before creating v2', async () => {
  const cases: readonly { name: string; prepare: (root: string) => Promise<void> }[] = [
    {
      name: 'foreign owner',
      prepare: async (root) => {
        const records = buildLegacyRecords(root);
        const foreignRoot = path.join(root, 'foreign-owner');
        const foreignRecords = records.map((record) => Object.freeze({
          ...record,
          ownerRoot: foreignRoot,
          recordDigest: generatedStateDigest({
            ...Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'recordDigest')),
            ownerRoot: foreignRoot
          })
        })) as readonly LegacyRecord[];
        await writeLegacyRecords(root, foreignRecords);
      }
    },
    {
      name: 'partial predecessor chain',
      prepare: async (root) => {
        const records = buildLegacyRecords(root);
        await writeLegacyRecords(root, [records[0]!, records[2]!]);
      }
    },
    {
      name: 'forked predecessor',
      prepare: async (root) => {
        const records = buildLegacyRecords(root);
        const forkUnsigned = {
          ...records[1]!,
          sequence: 2,
          attemptNonce: 'migration-test-fork-attempt'
        };
        const fork = Object.freeze({
          ...forkUnsigned,
          recordDigest: generatedStateDigest(Object.fromEntries(
            Object.entries(forkUnsigned).filter(([key]) => key !== 'recordDigest')
          ))
        }) as LegacyRecord;
        await writeLegacyRecords(root, [records[0]!, records[1]!, fork]);
      }
    },
    {
      name: 'digest mutation',
      prepare: async (root) => {
        const records = await writeLegacyRecords(root);
        const first = records[0]!;
        const mutated = { ...first, attemptNonce: 'tampered-without-digest-update' };
        await writeFile(
          path.join(legacyRecordsRoot(root), `record-${first.recordDigest.slice('sha256:'.length)}.json`),
          legacyRecordBytes(mutated as LegacyRecord)
        );
      }
    }
  ];

  for (const { name, prepare } of cases) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'sec-dependency-transition-invalid-'));
    try {
      await prepare(root);
      await expectBlockedMigration(root);
      expect(await readdir(path.join(root, '.tmp', 'dependency-installs', 'compiler-backups')))
        .not.toContain(TARGET_NAMESPACE);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('rejects source physical replacement without changing a completed target', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sec-dependency-transition-replacement-'));
  try {
    const records = await writeLegacyRecords(root);
    await migrateDependencyTransitionJournal(root, {
      lockTimeoutMs: 30_000
    });
    const targetBefore = await readRegularFiles(targetJournalRoot(root));
    const sourceRoot = legacyRecordsRoot(root);
    const replacement = `${sourceRoot}-replacement`;
    await rename(sourceRoot, replacement);
    await mkdir(sourceRoot);
    for (const record of records) {
      await writeFile(
        path.join(sourceRoot, `record-${record.recordDigest.slice('sha256:'.length)}.json`),
        legacyRecordBytes(record)
      );
    }

    let error: unknown;
    try {
      await migrateDependencyTransitionJournal(root, {
        lockTimeoutMs: 30_000
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ code: expect.stringMatching(/^RUNTIME-DEPS-00[24]$/u) });
    expectSameFileSet(await readRegularFiles(targetJournalRoot(root)), targetBefore);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
