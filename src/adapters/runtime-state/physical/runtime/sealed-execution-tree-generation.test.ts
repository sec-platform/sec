import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, open, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import {
  inspectNoFollowDirectoryChain,
  materializeRetainedNoFollowProvenDirectoryGeneration,
  retainNoFollowSealedDirectoryGeneration,
  scanNoFollowDirectoryTreeInventory,
  type PhysicalDirectoryIdentity,
  type RetainedNoFollowProvenDirectoryGeneration
} from './physical-no-follow.ts';
import {
  RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR
} from './retained-command-boundary.ts';
import {
  assertRetainedSealedExecutionTreeGeneration,
  assertSealedExecutionTreeRetirementReceipt,
  materializeSealedExecutionTree,
  retainMutableSealedExecutionProtectedRoot,
  SealedExecutionTreeAdmissionError,
  SealedExecutionTreeResidueError,
  type RetainedSealedExecutionProtectedRoot,
  type RetainedSealedExecutionTreeGeneration
} from './sealed-execution-tree-generation.ts';
import {
  assertRetainedTypeScriptExecutionGeneration,
  materializeRetainedTypeScriptExecutionGeneration,
  RetainedTypeScriptExecutionGenerationResidueError
} from './typescript-execution-generation.ts';
import { sealExistingWindowsReadOnlyTreeAuthority } from './windows-host-filesystem-authority.ts';

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

async function createFixture(label: string): Promise<Readonly<{
  dependency: RetainedNoFollowProvenDirectoryGeneration;
  generationParent: PhysicalDirectoryIdentity;
  rootPath: string;
}>> {
  const rootPath = await mkdtemp(path.join(tmpdir(), `sec-${label}-`));
  const generationParentPath = path.join(rootPath, 'execution-owner');
  const dependencyPath = path.join(rootPath, 'disjoint-dependency');
  await mkdir(generationParentPath);
  await mkdir(dependencyPath);
  await writeFile(path.join(dependencyPath, 'dependency.txt'), 'dependency\n');
  const dependencyRoot = inspectNoFollowDirectoryChain(
    dependencyPath,
    `${label} dependency`
  ).target;
  const inventory = scanNoFollowDirectoryTreeInventory(dependencyRoot, {
    deadlineAtMs: performance.now() + 30_000,
    maximumBytes: 1_024,
    maximumEntries: 4
  });
  const materialized = await materializeRetainedNoFollowProvenDirectoryGeneration({
    binding: {
      generationDigest: digest(`${label}-dependency-generation`),
      treeDigest: digest(JSON.stringify(inventory)),
      treeEntryCount: inventory.length
    },
    deadlineAtUnixMs: Date.now() + 30_000,
    inventory,
    proofText: null,
    releaseMode: 'restore-owner-write',
    root: dependencyRoot
  });
  return Object.freeze({
    dependency: materialized.generation,
    generationParent: inspectNoFollowDirectoryChain(
      generationParentPath,
      `${label} execution owner`
    ).target,
    rootPath
  });
}

async function createMutableProtectedSubject(
  fixture: Readonly<{ rootPath: string }>,
  label: string
) {
  const subjectPath = path.join(fixture.rootPath, `mutable-subject-${label}`);
  await mkdir(subjectPath);
  await writeFile(path.join(subjectPath, 'subject.txt'), 'mutable\n');
  const root = inspectNoFollowDirectoryChain(subjectPath, `${label} mutable subject`).target;
  return Object.freeze({
    capability: retainMutableSealedExecutionProtectedRoot(root),
    root,
    subjectPath
  });
}

test('sealed physical execution tree publishes exact caller bytes and retires one opaque generation', async () => {
  const fixture = await createFixture('sealed-execution-tree-normal');
  try {
    const generation = await materializeSealedExecutionTree({
      deadlineAtUnixMs: Date.now() + 30_000,
      directoryNamePrefix: 'execution-',
      directories: ['empty-state', 'src'],
      files: [
        { bytes: Buffer.from('export const value = 1;\n'), path: 'src/value.ts' },
        { bytes: Buffer.from('{"compilerOptions":{}}\n'), path: 'tsconfig.json' }
      ],
      generationParent: fixture.generationParent,
      links: [{ path: 'node_modules', source: fixture.dependency }],
      maximumBytes: 1_024,
      maximumEntries: 8
    });
    assertRetainedSealedExecutionTreeGeneration(generation);
    expect(() => assertRetainedSealedExecutionTreeGeneration({
      ...generation
    } as never)).toThrow('was not issued by Runtime Physical');
    const generationPath = generation.workingDirectory.root.path;
    expect(await readFile(path.join(generationPath, 'src', 'value.ts'), 'utf8'))
      .toBe('export const value = 1;\n');
    expect(await readFile(path.join(generationPath, 'tsconfig.json'), 'utf8'))
      .toBe('{"compilerOptions":{}}\n');
    expect(await readdir(path.join(generationPath, 'empty-state'))).toEqual([]);
    await generation.assertCurrent();
    expect(generation.identity.exactFileSetDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(generation.identity.generationDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(generation.identity.sealedRoot).toEqual(generation.workingDirectory.root);
    if (process.platform === 'linux') {
      expect(generation.workingDirectory.childPath)
        .toBe(`/proc/self/fd/${RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR}`);
      expect(generation.workingDirectory.stdioSourceDescriptor)
        .toEqual(expect.any(Number));
      expect(generation.workingDirectory.stdioSourceDescriptor!)
        .toBeGreaterThanOrEqual(5);
    }

    const receipt = await generation.retire();
    expect(await generation.retire()).toBe(receipt);
    assertSealedExecutionTreeRetirementReceipt(receipt, generation);
    expect(() => assertSealedExecutionTreeRetirementReceipt({
      ...receipt
    } as never, generation)).toThrow('was not issued by Runtime Physical');
    expect(receipt.generationIdentity).toBe(generation.identity);
    expect(receipt.linkedSettlements).toEqual([expect.objectContaining({
      path: 'node_modules',
      status: 'borrowed-current'
    })]);
    expect(receipt.protectedRootSettlements).toEqual([expect.objectContaining({
      status: 'current'
    })]);
    expect(receipt.tree.status).toBe('physically-absent');
    await expect(lstat(generationPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(generation.assertCurrent()).rejects.toThrow('is retired');
  } finally {
    await fixture.dependency.retire();
    await rm(fixture.rootPath, { recursive: true, force: true });
  }
}, 60_000);

test('generation identity is operation-exact and terminal receipts cannot be transplanted', async () => {
  const fixture = await createFixture('sealed-execution-tree-identity-binding');
  const input = {
    deadlineAtUnixMs: Date.now() + 30_000,
    directoryNamePrefix: 'execution-',
    files: [{ bytes: Buffer.from('same bytes\n'), path: 'src/implementation.ts' }],
    generationParent: fixture.generationParent,
    links: [{ path: 'node_modules', source: fixture.dependency }]
  } as const;
  try {
    const first = await materializeSealedExecutionTree(input);
    const second = await materializeSealedExecutionTree(input);
    expect(first.identity.exactFileSetDigest).toBe(second.identity.exactFileSetDigest);
    expect(first.identity.borrowedGenerationDigest).toBe(second.identity.borrowedGenerationDigest);
    expect(first.identity.materializationOperationDigest)
      .not.toBe(second.identity.materializationOperationDigest);
    expect(first.identity.generationDigest).not.toBe(second.identity.generationDigest);

    const firstReceipt = await first.retire();
    expect(() => assertSealedExecutionTreeRetirementReceipt(firstReceipt, second))
      .toThrow('does not settle this generation');
    assertSealedExecutionTreeRetirementReceipt(firstReceipt, first);
    const secondReceipt = await second.retire();
    assertSealedExecutionTreeRetirementReceipt(secondReceipt, second);
  } finally {
    await fixture.dependency.retire();
    await rm(fixture.rootPath, { recursive: true, force: true });
  }
}, 60_000);

test('partial borrowed-generation retirement preserves residue and issues no terminal receipt', async () => {
  const fixture = await createFixture('sealed-execution-tree-partial-retirement');
  try {
    const generation = await materializeSealedExecutionTree({
      deadlineAtUnixMs: Date.now() + 30_000,
      directoryNamePrefix: 'execution-',
      files: [{ bytes: Buffer.from('implementation\n'), path: 'implementation.ts' }],
      generationParent: fixture.generationParent,
      links: [{ path: 'node_modules', source: fixture.dependency }]
    });
    await fixture.dependency.retire();
    let firstFailure: unknown;
    try { await generation.retire(); } catch (error) { firstFailure = error; }
    expect(firstFailure).toBeInstanceOf(SealedExecutionTreeResidueError);
    expect((firstFailure as SealedExecutionTreeResidueError).residue)
      .toMatchObject({
        linkedSettlements: [{ status: 'borrowed-unavailable' }],
        retryability: 'owner-reconciliation-required',
        treeSettlements: { authority: 'released', tree: 'physically-absent' }
      });
    await expect(generation.retire()).rejects.toBeInstanceOf(
      SealedExecutionTreeResidueError
    );
  } finally {
    await fixture.dependency.retire();
    await rm(fixture.rootPath, { recursive: true, force: true });
  }
}, 60_000);

test('sealed physical execution tree returns typed residue and preserves both sides of root replacement', async () => {
  const fixture = await createFixture('sealed-execution-tree-replacement');
  try {
    const generation = await materializeSealedExecutionTree({
      deadlineAtUnixMs: Date.now() + 30_000,
      directoryNamePrefix: 'execution-',
      files: [{ bytes: Buffer.from('owned\n'), path: 'owned.txt' }],
      generationParent: fixture.generationParent,
      links: [{ path: 'node_modules', source: fixture.dependency }],
      maximumBytes: 1_024,
      maximumEntries: 4
    });
    const generationPath = generation.workingDirectory.root.path;
    const displacedPath = path.join(fixture.generationParent.path, 'displaced-generation');
    await generation.workingDirectory.retire();
    await rename(generationPath, displacedPath);
    await mkdir(generationPath);
    await writeFile(path.join(generationPath, 'replacement.txt'), 'replacement\n');

    let first: SealedExecutionTreeResidueError | null = null;
    try {
      await generation.retire();
    } catch (error) {
      expect(error).toBeInstanceOf(SealedExecutionTreeResidueError);
      first = error as SealedExecutionTreeResidueError;
    }
    expect(first!.residue.generationLocator.root.path).toBe(generationPath);
    expect(first!.residue.inventory.state).toBe('unknown');
    expect(first!.residue.retryability).toBe('owner-reconciliation-required');
    let second: unknown;
    try { await generation.retire(); } catch (error) { second = error; }
    expect(second).toBeInstanceOf(SealedExecutionTreeResidueError);
    expect(second).not.toBe(first);
    expect(await readFile(path.join(displacedPath, 'owned.txt'), 'utf8')).toBe('owned\n');
    expect(await readFile(path.join(generationPath, 'replacement.txt'), 'utf8'))
      .toBe('replacement\n');
  } finally {
    await fixture.dependency.retire();
    await rm(fixture.rootPath, { recursive: true, force: true });
  }
}, 60_000);

test('sealed physical execution tree fails closed on unknown retirement residue', async () => {
  const fixture = await createFixture('sealed-execution-tree-unknown-residue');
  try {
    const generation = await materializeSealedExecutionTree({
      deadlineAtUnixMs: Date.now() + 30_000,
      directoryNamePrefix: 'execution-',
      files: [{ bytes: Buffer.from('known\n'), path: 'known.txt' }],
      generationParent: fixture.generationParent,
      links: [{ path: 'node_modules', source: fixture.dependency }],
      maximumBytes: 1_024,
      maximumEntries: 4
    });
    const generationPath = generation.workingDirectory.root.path;
    await generation.workingDirectory.retire();
    await writeFile(path.join(generationPath, 'unknown.txt'), 'unknown\n');

    let residue: SealedExecutionTreeResidueError | null = null;
    try { await generation.retire(); } catch (error) {
      expect(error).toBeInstanceOf(SealedExecutionTreeResidueError);
      residue = error as SealedExecutionTreeResidueError;
    }
    expect(residue!.residue.linkedSettlements).toEqual([expect.objectContaining({
      status: 'borrowed-current'
    })]);
    expect(residue!.residue.treeSettlements).toEqual({
      authority: 'released',
      tree: 'retirement-failed'
    });
    expect(await readFile(path.join(generationPath, 'unknown.txt'), 'utf8')).toBe('unknown\n');
    await rm(path.join(generationPath, 'unknown.txt'));
    const recovered = await generation.retire();
    expect(recovered.tree.status).toBe('physically-absent');
    await expect(lstat(generationPath)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await fixture.dependency.retire();
    await rm(fixture.rootPath, { recursive: true, force: true });
  }
}, 60_000);

test('sealed physical execution tree rejects deadline, signal and exact inventory ceilings before publication', async () => {
  const fixture = await createFixture('sealed-execution-tree-bounds');
  const base = {
    directoryNamePrefix: 'execution-',
    files: [{ bytes: Buffer.from('two'), path: 'nested/value.txt' }],
    generationParent: fixture.generationParent,
    links: [{ path: 'node_modules', source: fixture.dependency }]
  } as const;
  try {
    await expect(materializeSealedExecutionTree({
      ...base,
      deadlineAtUnixMs: Date.now() - 1
    })).rejects.toBeInstanceOf(SealedExecutionTreeAdmissionError);
    const controller = new AbortController();
    controller.abort();
    await expect(materializeSealedExecutionTree({
      ...base,
      deadlineAtUnixMs: Date.now() + 30_000,
      signal: controller.signal
    })).rejects.toBeInstanceOf(SealedExecutionTreeAdmissionError);
    await expect(materializeSealedExecutionTree({
      ...base,
      deadlineAtUnixMs: Date.now() + 30_000,
      maximumBytes: 2
    })).rejects.toBeInstanceOf(SealedExecutionTreeAdmissionError);
    await expect(materializeSealedExecutionTree({
      ...base,
      deadlineAtUnixMs: Date.now() + 30_000,
      maximumEntries: 2
    })).rejects.toBeInstanceOf(SealedExecutionTreeAdmissionError);
  } finally {
    await fixture.dependency.retire();
    await rm(fixture.rootPath, { recursive: true, force: true });
  }
}, 60_000);

test('borrowed link source remains current across two trees, setup failure and generic retirement', async () => {
  const fixture = await createFixture('sealed-execution-tree-borrowed-source');
  try {
    const input = (name: string) => ({
      deadlineAtUnixMs: Date.now() + 30_000,
      directoryNamePrefix: `${name}-`,
      files: [{ bytes: Buffer.from(`${name}\n`), path: `${name}.ts` }],
      generationParent: fixture.generationParent,
      links: [{ path: 'node_modules', source: fixture.dependency }]
    } as const);
    const first = await materializeSealedExecutionTree(input('first'));
    const second = await materializeSealedExecutionTree(input('second'));
    await first.retire();
    fixture.dependency.assertCurrent();
    await fixture.dependency.assertAuthorityCurrent();
    await second.assertCurrent();
    await second.retire();
    fixture.dependency.assertCurrent();
    await fixture.dependency.assertAuthorityCurrent();

    await expect(materializeSealedExecutionTree({
      ...input('invalid'),
      files: [
        { bytes: Buffer.from('ancestor\n'), path: 'collision' },
        { bytes: Buffer.from('descendant\n'), path: 'collision/value.ts' }
      ]
    })).rejects.toBeInstanceOf(SealedExecutionTreeAdmissionError);
    fixture.dependency.assertCurrent();
    await fixture.dependency.assertAuthorityCurrent();
  } finally {
    await fixture.dependency.retire();
    await rm(fixture.rootPath, { recursive: true, force: true });
  }
}, 60_000);

test('retirement uses fresh recovery authority after the execution signal is aborted', async () => {
  const fixture = await createFixture('sealed-execution-tree-recovery-authority');
  const controller = new AbortController();
  try {
    const executionDeadlineAtUnixMs = Date.now() + 1_000;
    const generation = await materializeSealedExecutionTree({
      deadlineAtUnixMs: executionDeadlineAtUnixMs,
      directoryNamePrefix: 'execution-',
      files: [{ bytes: Buffer.from('sealed\n'), path: 'sealed.ts' }],
      generationParent: fixture.generationParent,
      links: [{ path: 'node_modules', source: fixture.dependency }],
      signal: controller.signal
    });
    const generationPath = generation.workingDirectory.root.path;
    controller.abort();
    await delay(Math.max(1, executionDeadlineAtUnixMs - Date.now() + 10));
    const receipt = await generation.retire();
    expect(receipt.tree.status).toBe('physically-absent');
    await expect(lstat(generationPath)).rejects.toMatchObject({ code: 'ENOENT' });
    fixture.dependency.assertCurrent();
  } finally {
    await fixture.dependency.retire();
    await rm(fixture.rootPath, { recursive: true, force: true });
  }
}, 60_000);

test('canonical path trie rejects ancestor, case and reserved equivalents with zero generation effect', async () => {
  const fixture = await createFixture('sealed-execution-tree-canonical-trie');
  const cases = [
    [
      { bytes: Buffer.from('a'), path: 'ancestor' },
      { bytes: Buffer.from('b'), path: 'ancestor/child.ts' }
    ],
    [
      { bytes: Buffer.from('a'), path: 'Case/one.ts' },
      { bytes: Buffer.from('b'), path: 'case/two.ts' }
    ],
    [{ bytes: Buffer.from('a'), path: 'CON.txt' }],
    [{ bytes: Buffer.from('a'), path: 'trailing.' }]
  ] as const;
  try {
    for (const files of cases) {
      await expect(materializeSealedExecutionTree({
        deadlineAtUnixMs: Date.now() + 30_000,
        directoryNamePrefix: 'execution-',
        files,
        generationParent: fixture.generationParent,
        links: [{ path: 'node_modules', source: fixture.dependency }]
      })).rejects.toBeInstanceOf(SealedExecutionTreeAdmissionError);
      expect(await readdir(fixture.generationParent.path)).toEqual([]);
      fixture.dependency.assertCurrent();
    }
    await expect(materializeSealedExecutionTree({
      deadlineAtUnixMs: Date.now() + 30_000,
      directoryNamePrefix: 'execution-',
      files: [{ bytes: Buffer.from('a'), path: 'value.ts' }],
      generationParent: fixture.generationParent,
      links: [
        { path: 'modules-a', source: fixture.dependency },
        { path: 'modules-b', source: fixture.dependency }
      ]
    })).rejects.toThrow('at most one borrowed link');
    expect(await readdir(fixture.generationParent.path)).toEqual([]);
  } finally {
    await fixture.dependency.retire();
    await rm(fixture.rootPath, { recursive: true, force: true });
  }
}, 60_000);

test('protected roots reject forged, overlapping and replaced capabilities before publication', async () => {
  const fixture = await createFixture('sealed-execution-tree-protected-root');
  const subject = await createMutableProtectedSubject(fixture, 'protected-root');
  const protectedRoot = subject.capability;
  const base = {
    deadlineAtUnixMs: Date.now() + 30_000,
    directoryNamePrefix: 'execution-',
    files: [{ bytes: Buffer.from('a'), path: 'value.ts' }],
    generationParent: fixture.generationParent,
    links: []
  } as const;
  try {
    await writeFile(path.join(subject.subjectPath, 'subject.txt'), 'changed while retained\n');
    await protectedRoot.assertCurrent();
    await expect(materializeSealedExecutionTree({
      ...base,
      protectedRoots: [{ ...protectedRoot } as RetainedSealedExecutionProtectedRoot]
    })).rejects.toThrow('was not issued by Runtime Physical');
    expect(await readdir(fixture.generationParent.path)).toEqual([]);
    await expect(materializeSealedExecutionTree({
      ...base,
      generationParent: subject.root,
      protectedRoots: [protectedRoot]
    })).rejects.toThrow('overlaps a protected root');
    expect(await readdir(fixture.generationParent.path)).toEqual([]);
  } finally {
    protectedRoot.release();
    await fixture.dependency.retire();
    await rm(fixture.rootPath, { recursive: true, force: true });
  }

  const replacement = await createFixture('sealed-execution-tree-protected-replacement');
  const replacementSubject = await createMutableProtectedSubject(replacement, 'replacement');
  const replacementProtectedRoot = replacementSubject.capability;
  try {
    replacementProtectedRoot.release();
    await rm(replacementSubject.subjectPath, { recursive: true, force: true });
    await mkdir(replacementSubject.subjectPath);
    await expect(materializeSealedExecutionTree({
      ...base,
      generationParent: replacement.generationParent,
      protectedRoots: [replacementProtectedRoot]
    })).rejects.toThrow();
    expect(await readdir(replacement.generationParent.path)).toEqual([]);
  } finally {
    replacementProtectedRoot.release();
    await replacement.dependency.retire();
    await rm(replacement.rootPath, { recursive: true, force: true });
  }
}, 60_000);

test.skipIf(process.platform !== 'win32')(
  'protected roots reject a case-equivalent owner spelling before publication',
  async () => {
    const fixture = await createFixture('sealed-execution-tree-protected-case');
    const subject = await createMutableProtectedSubject(fixture, 'case-equivalent');
    const protectedRoot = subject.capability;
    try {
      await expect(materializeSealedExecutionTree({
        deadlineAtUnixMs: Date.now() + 30_000,
        directoryNamePrefix: 'execution-',
        files: [{ bytes: Buffer.from('a'), path: 'value.ts' }],
        generationParent: Object.freeze({
          ...subject.root,
          path: subject.root.path.toUpperCase()
        }),
        links: [],
        protectedRoots: [protectedRoot]
      })).rejects.toThrow('overlaps a protected root');
      expect(await readdir(fixture.generationParent.path)).toEqual([]);
    } finally {
      protectedRoot.release();
      await fixture.dependency.retire();
      await rm(fixture.rootPath, { recursive: true, force: true });
    }
  },
  60_000
);

test.skipIf(process.platform !== 'win32')(
  'sealed execution handles exclude byte and membership mutation until terminal retirement',
  async () => {
    const fixture = await createFixture('sealed-execution-tree-writer-exclusion');
    try {
      const generation = await materializeSealedExecutionTree({
        deadlineAtUnixMs: Date.now() + 30_000,
        directoryNamePrefix: 'execution-',
        files: [{ bytes: Buffer.from('exact\n'), path: 'src/value.ts' }],
        generationParent: fixture.generationParent,
        links: [{ path: 'node_modules', source: fixture.dependency }]
      });
      const generationPath = generation.workingDirectory.root.path;
      const sourcePath = path.join(generationPath, 'src', 'value.ts');
      await expect(open(sourcePath, 'r+')).rejects.toBeInstanceOf(Error);
      await expect(open(path.join(generationPath, 'src', 'foreign.ts'), 'wx'))
        .rejects.toBeInstanceOf(Error);
      expect(await readFile(sourcePath, 'utf8')).toBe('exact\n');
      await generation.assertCurrent();
      await generation.retire();
    } finally {
      await fixture.dependency.retire();
      await rm(fixture.rootPath, { recursive: true, force: true });
    }
  },
  60_000
);

test.skipIf(process.platform !== 'win32')(
  'sealed generation admission rejects a pre-existing writer handle',
  async () => {
    const rootPath = await mkdtemp(path.join(tmpdir(), 'sec-sealed-existing-writer-'));
    const sourcePath = path.join(rootPath, 'value.ts');
    await writeFile(sourcePath, 'exact\n');
    const root = inspectNoFollowDirectoryChain(rootPath, 'existing writer root').target;
    const inventory = scanNoFollowDirectoryTreeInventory(root, {
      deadlineAtMs: performance.now() + 30_000,
      maximumBytes: 1_024,
      maximumEntries: 2
    });
    const writer = await open(sourcePath, 'r+');
    try {
      const membershipAuthority = await sealExistingWindowsReadOnlyTreeAuthority(root.path, [], {
        deadlineAtMs: Date.now() + 30_000,
        ownerRootPath: path.dirname(rootPath),
        repositoryRootPath: process.cwd()
      });
      await expect(retainNoFollowSealedDirectoryGeneration(
        root,
        inventory,
        membershipAuthority,
        'existing writer generation'
      )).rejects.toThrow();
      expect(await readFile(sourcePath, 'utf8')).toBe('exact\n');
    } finally {
      await writer.close();
      await rm(rootPath, { recursive: true, force: true });
    }
  },
  60_000
);

test('TypeScript compatibility wrapper retires its borrowed dependency after tree detachment', async () => {
  const fixture = await createFixture('typescript-execution-tree-compatibility');
  try {
    const generation = await materializeRetainedTypeScriptExecutionGeneration({
      deadlineAtUnixMs: Date.now() + 30_000,
      dependencyGeneration: fixture.dependency,
      files: [
        { bytes: Buffer.from('{"compilerOptions":{}}\n'), path: 'tsconfig.json' },
        { bytes: Buffer.from('export const exact = true;\n'), path: 'src/exact.ts' }
      ],
      generationParent: fixture.generationParent
    });
    assertRetainedTypeScriptExecutionGeneration(generation);
    expect(() => assertRetainedTypeScriptExecutionGeneration({
      ...generation
    } as never)).toThrow('was not issued by Runtime Physical');
    expect(generation.dependencyDirectory).toBe(fixture.dependency);
    const sourcePath = path.join(generation.workingDirectory.root.path, 'src', 'exact.ts');
    expect(await readFile(sourcePath, 'utf8')).toBe('export const exact = true;\n');
    if (process.platform === 'win32') {
      await expect(open(sourcePath, 'r+')).rejects.toBeInstanceOf(Error);
    }
    await generation.assertCurrent();
    const receipt = await generation.retire();
    expect(await generation.retire()).toBe(receipt);
    expect(receipt).toMatchObject({
      dependencyGeneration: 'physically-clean',
      projectAuthority: 'physically-clean',
      projectTree: { status: 'physically-absent' }
    });
    expect(() => fixture.dependency.assertCurrent()).toThrow();
  } finally {
    await fixture.dependency.retire();
    await rm(fixture.rootPath, { recursive: true, force: true });
  }
}, 60_000);

test('TypeScript wrapper preserves non-residue classification when invalid setup cleanup succeeds', async () => {
  const fixture = await createFixture('typescript-execution-tree-invalid-setup');
  try {
    let failure: unknown;
    try { await materializeRetainedTypeScriptExecutionGeneration({
      deadlineAtUnixMs: Date.now() + 30_000,
      dependencyGeneration: fixture.dependency,
      files: [{ bytes: Buffer.from('invalid\n'), path: 'ancestor' }, {
        bytes: Buffer.from('invalid\n'),
        path: 'ancestor/value.ts'
      }],
      generationParent: fixture.generationParent
    }); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(SealedExecutionTreeAdmissionError);
    expect(failure).not.toBeInstanceOf(RetainedTypeScriptExecutionGenerationResidueError);
    expect(() => fixture.dependency.assertCurrent()).toThrow();
    expect(await readdir(fixture.generationParent.path)).toEqual([]);
  } finally {
    await fixture.dependency.retire();
    await rm(fixture.rootPath, { recursive: true, force: true });
  }
}, 60_000);

test('TypeScript wrapper preserves dependency drift as non-terminal physical residue', async () => {
  const fixture = await createFixture('sealed-execution-tree-dependency-drift');
  try {
    const generation = await materializeRetainedTypeScriptExecutionGeneration({
      deadlineAtUnixMs: Date.now() + 30_000,
      dependencyGeneration: fixture.dependency,
      files: [{ bytes: Buffer.from('value\n'), path: 'value.ts' }],
      generationParent: fixture.generationParent
    });
    const generationPath = generation.workingDirectory.root.path;
    await fixture.dependency.retire();
    let drift: unknown;
    try { await generation.assertCurrent(); } catch (error) { drift = error; }
    expect(drift).toBeInstanceOf(Error);
    expect(drift).not.toBeInstanceOf(RetainedTypeScriptExecutionGenerationResidueError);
    let retirement: unknown;
    try { await generation.retire(); } catch (error) { retirement = error; }
    expect(retirement).toBeInstanceOf(RetainedTypeScriptExecutionGenerationResidueError);
    expect((retirement as RetainedTypeScriptExecutionGenerationResidueError).physicalResidues)
      .toEqual([expect.objectContaining({
        linkedSettlements: [expect.objectContaining({ status: 'borrowed-unavailable' })],
        treeSettlements: { authority: 'released', tree: 'physically-absent' }
      })]);
    await expect(lstat(generationPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(generation.retire()).rejects.toBeInstanceOf(
      RetainedTypeScriptExecutionGenerationResidueError
    );
  } finally {
    await fixture.dependency.retire();
    await rm(fixture.rootPath, { recursive: true, force: true });
  }
}, 60_000);

test('setup residue without a returned recovery capability is owner-reconciliation-required', async () => {
  const fixture = await createFixture('sealed-execution-tree-setup-residue');
  const files = Array.from({ length: 200 }, (_, index) => ({
    bytes: Buffer.from(`value-${index}\n`),
    path: `src/value-${String(index).padStart(3, '0')}.ts`
  }));
  let injectedPath: string | null = null;
  const returned: { generation?: RetainedSealedExecutionTreeGeneration } = {};
  let stopActor = async (): Promise<void> => {};
  try {
    // Publication uses synchronous filesystem operations. A timer on this same
    // event loop cannot race them; start an independent actor and await readiness.
    const actor = Bun.spawn([process.execPath, '-e', String.raw`
      const fs = require('node:fs');
      const path = require('node:path');
      const parent = process.argv[1];
      const pause = new Int32Array(new SharedArrayBuffer(4));
      const deadline = performance.now() + 2_000;
      process.stdout.write('ready\n');
      while (performance.now() < deadline) {
        const name = fs.readdirSync(parent).find(entry => entry.startsWith('setup-residue-'));
        if (name !== undefined) {
          const target = path.join(parent, name, 'foreign.txt');
          fs.writeFileSync(target, 'foreign\n', { flag: 'wx' });
          process.stdout.write(JSON.stringify({ path: target }));
          process.exit(0);
        }
        Atomics.wait(pause, 0, 0, 1);
      }
      throw new Error('Setup-residue actor did not observe the bounded generation');
    `, fixture.generationParent.path], { stdout: 'pipe', stderr: 'pipe' });
    const stderr = new Response(actor.stderr).text();
    const guard = setTimeout(() => actor.kill(), 5_000);
    stopActor = async () => {
      clearTimeout(guard);
      if (actor.exitCode === null) actor.kill();
      await actor.exited;
      await stderr;
    };
    const reader = actor.stdout.getReader();
    const decoder = new TextDecoder();
    let ready = '';
    while (!ready.includes('\n')) {
      const chunk = await reader.read();
      if (chunk.done) throw new Error(`Residue actor exited before readiness: ${await stderr}`);
      ready += decoder.decode(chunk.value, { stream: true });
    }
    expect(ready).toBe('ready\n');
    const remainder = (async () => {
      let output = '';
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) return output + decoder.decode();
          output += decoder.decode(chunk.value, { stream: true });
        }
      } finally { reader.releaseLock(); }
    })();
    const materialization = materializeSealedExecutionTree({
      deadlineAtUnixMs: Date.now() + 30_000,
      directoryNamePrefix: 'setup-residue-', files,
      generationParent: fixture.generationParent,
      links: [{ path: 'node_modules', source: fixture.dependency }], maximumEntries: 256
    }).then((generation) => { returned.generation = generation; return null; }, (error: unknown) => error);
    const [error, output, exitCode, diagnostic] = await Promise.all([
      materialization, remainder, actor.exited, stderr
    ]);
    expect(exitCode, diagnostic).toBe(0);
    injectedPath = (JSON.parse(output) as { path: string }).path;
    expect(error).toBeInstanceOf(SealedExecutionTreeResidueError);
    const residue = error as SealedExecutionTreeResidueError;
    expect(residue.residue.retryability).toBe('owner-reconciliation-required');
    expect(residue.residue.inventory.state).toBe('unknown');
    expect(injectedPath).not.toBeNull();
    fixture.dependency.assertCurrent();
    await fixture.dependency.assertAuthorityCurrent();
  } finally {
    await stopActor();
    if (injectedPath !== null) await rm(injectedPath, { force: true });
    // A late actor must fail the assertion without leaking a returned capability.
    await returned.generation?.retire();
    await fixture.dependency.retire();
    await rm(fixture.rootPath, { recursive: true, force: true });
  }
}, 60_000);

test('TypeScript wrapper preserves structured physical residue and retries after reconciliation', async () => {
  const fixture = await createFixture('typescript-execution-tree-structured-residue');
  try {
    const generation = await materializeRetainedTypeScriptExecutionGeneration({
      deadlineAtUnixMs: Date.now() + 30_000,
      dependencyGeneration: fixture.dependency,
      files: [{ bytes: Buffer.from('value\n'), path: 'value.ts' }],
      generationParent: fixture.generationParent
    });
    const generationPath = generation.workingDirectory.root.path;
    await generation.workingDirectory.retire();
    await writeFile(path.join(generationPath, 'unknown.txt'), 'unknown\n');
    let failure: RetainedTypeScriptExecutionGenerationResidueError | null = null;
    try { await generation.retire(); } catch (error) {
      expect(error).toBeInstanceOf(RetainedTypeScriptExecutionGenerationResidueError);
      failure = error as RetainedTypeScriptExecutionGenerationResidueError;
    }
    expect(failure!.physicalResidues).toHaveLength(1);
    expect(failure!.physicalResidues[0]!.retryability).toBe('retryable');
    fixture.dependency.assertCurrent();
    await rm(path.join(generationPath, 'unknown.txt'));
    const receipt = await generation.retire();
    expect(receipt.projectTree.status).toBe('physically-absent');
    expect(() => fixture.dependency.assertCurrent()).toThrow();
  } finally {
    await fixture.dependency.retire();
    await rm(fixture.rootPath, { recursive: true, force: true });
  }
}, 60_000);
