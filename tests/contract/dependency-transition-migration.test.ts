import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import { generatedStateDigest } from '../../src/runtime-state/generated-state/contract.ts';
import { inspectNoFollowDirectoryChain } from '../../src/runtime-state/physical/runtime/physical-no-follow.ts';
import { migrateDependencyTransitionJournal } from '../../src/toolchain/dependencies/runtime.ts';

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
