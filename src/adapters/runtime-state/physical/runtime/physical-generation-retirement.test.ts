import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { sha256 } from '../../../../contracts/canonical.ts';
import {
  bindSemanticOperation,
  compileCapabilityBinding,
  compileSemanticOperationPlan,
  issueSemanticOperationAttemptContext
} from '../../../../execution/operation/semantic.ts';
import {
  closeWindowsHandlesBestEffort, WINDOWS_FILE_OPEN, WINDOWS_SHARE_READ,
  windowsIdentity, windowsOpenPinnedReadDirectory, windowsOpenRelativeDirectory
} from './physical-no-follow-native.ts';
import {
  assertPhysicalGenerationRetirementReceipt,
  inspectNoFollowDirectoryChain,
  materializeRetainedNoFollowProvenDirectoryGeneration,
  openWindowsLegacySealedDirectoryRelocation,
  prepareWindowsLegacySealedDirectoryRelocation,
  relocateWindowsLegacySealedDirectory,
  retireNoFollowDirectoryTree,
  retireNoFollowProvenDirectoryGeneration,
  scanNoFollowDirectoryTreeInventory
} from './physical-no-follow.ts';

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

async function withWindowsRetirementFixture(run: (parentPath: string, rootPath: string) => Promise<void>): Promise<void> {
  const parentPath = await mkdtemp(path.join(tmpdir(), 'sec-windows-tree-stack-'));
  const rootPath = path.join(parentPath, 'tree');
  await mkdir(rootPath);
  try { await run(parentPath, rootPath); }
  finally {
    expect(path.dirname(parentPath)).toBe(path.resolve(tmpdir()));
    expect(path.basename(parentPath).startsWith('sec-windows-tree-stack-')).toBe(true);
    await rm(parentPath, { recursive: true, force: true });
  }
}

function fixedRetirementInput(parentPath: string, rootPath: string) {
  const root = inspectNoFollowDirectoryChain(rootPath, 'Windows tree fixture').target;
  return {
    parent: inspectNoFollowDirectoryChain(parentPath, 'Windows tree fixture parent').target,
    root,
    inventory: scanNoFollowDirectoryTreeInventory(root, {
      deadlineAtMs: performance.now() + 30_000, maximumBytes: 1024 * 1024, maximumEntries: 128
    }),
    deadlineAtMonotonicMs: performance.now() + 30_000
  };
}

test.skipIf(process.platform !== 'win32')('Windows fixed inventory retirement visits nested and sibling directories in postorder', async () => {
  await withWindowsRetirementFixture(async (parentPath, rootPath) => {
    let directory = rootPath;
    for (let depth = 0; depth < 8; depth += 1) {
      directory = path.join(directory, `level-${depth}`);
      await mkdir(directory);
      await writeFile(path.join(directory, 'value.txt'), `depth ${depth}`);
    }
    await mkdir(path.join(rootPath, 'sibling'));
    await writeFile(path.join(rootPath, 'sibling', 'other.txt'), 'sibling');
    const input = fixedRetirementInput(parentPath, rootPath);
    const receipt = retireNoFollowDirectoryTree(input);
    expect(receipt.status).toBe('physically-absent');
    expect(receipt.entryCount).toBe(input.inventory.length);
    expect(receipt.root.objectId).toBe(input.root.objectId);
    await expect(lstat(rootPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

test.skipIf(process.platform !== 'win32')('Windows fixed inventory validates duplicate paths and complete ancestors before deletion', async () => {
  await withWindowsRetirementFixture(async (parentPath, rootPath) => {
    await mkdir(path.join(rootPath, 'nested'));
    const file = path.join(rootPath, 'nested', 'value.txt');
    await writeFile(file, 'preserved');
    const input = fixedRetirementInput(parentPath, rootPath);
    expect(() => retireNoFollowDirectoryTree({ ...input, inventory: [...input.inventory, input.inventory[0]!] }))
      .toThrow('duplicate');
    expect(() => retireNoFollowDirectoryTree({ ...input, inventory: input.inventory.filter(entry => entry.relativePath !== 'nested') }))
      .toThrow('ancestor inventory');
    const leaf = input.inventory.find(entry => entry.kind === 'file')!;
    for (const relativePath of ['../escape', 'nested//value.txt', 'nested/value.txt:stream']) {
      expect(() => retireNoFollowDirectoryTree({ ...input, inventory: [{ ...leaf, relativePath }] })).toThrow();
    }
    expect(await readFile(file, 'utf8')).toBe('preserved');
  });
});

test.skipIf(process.platform !== 'win32')('Windows retirement directory sharing prevents moving the retained stack scope', async () => {
  await withWindowsRetirementFixture(async (parentPath, rootPath) => {
    const nestedPath = path.join(rootPath, 'nested');
    await mkdir(nestedPath);
    const handles: bigint[] = [];
    try {
      const parent = windowsOpenPinnedReadDirectory(parentPath, 'retirement sharing fixture parent');
      handles.push(parent);
      const parentIdentity = windowsIdentity(parent, parentPath, 'retirement sharing fixture parent');
      const root = windowsOpenRelativeDirectory(parent, parentIdentity, 'tree', rootPath,
        WINDOWS_FILE_OPEN, 'retirement sharing fixture root', WINDOWS_SHARE_READ, true);
      if (root === null) throw new Error('Fixture root is missing');
      handles.push(root);
      const rootIdentity = windowsIdentity(root, rootPath, 'retirement sharing fixture root');
      const nested = windowsOpenRelativeDirectory(root, rootIdentity, 'nested', nestedPath,
        WINDOWS_FILE_OPEN, 'retirement sharing fixture nested', WINDOWS_SHARE_READ, true);
      if (nested === null) throw new Error('Fixture nested directory is missing');
      handles.push(nested);
      await expect(rename(parentPath, `${parentPath}-moved`)).rejects.toThrow();
      await expect(rename(rootPath, path.join(parentPath, 'moved-root'))).rejects.toThrow();
      await expect(rename(nestedPath, path.join(rootPath, 'moved-nested'))).rejects.toThrow();
      expect((await lstat(nestedPath)).isDirectory()).toBe(true);
    } finally {
      const failure = closeWindowsHandlesBestEffort(handles.reverse(), 'retirement sharing fixture');
      if (failure !== null) throw failure;
    }
    const moved = path.join(parentPath, 'moved-root');
    await rename(rootPath, moved);
    await rename(moved, rootPath);
    expect((await lstat(nestedPath)).isDirectory()).toBe(true);
  });
});

test.skipIf(process.platform !== 'win32')('Windows fixed inventory rejects a replaced directory or junction without deleting foreign entries', async () => {
  for (const replacement of ['directory', 'junction']) {
    await withWindowsRetirementFixture(async (parentPath, rootPath) => {
      const nested = path.join(rootPath, 'nested');
      await mkdir(nested);
      await writeFile(path.join(nested, 'value.txt'), 'original');
      const input = fixedRetirementInput(parentPath, rootPath);
      await rename(nested, path.join(parentPath, 'original-nested'));
      const foreign = replacement === 'directory' ? nested : path.join(parentPath, 'foreign');
      await mkdir(foreign);
      await writeFile(path.join(foreign, 'value.txt'), 'foreign');
      if (replacement === 'junction') await symlink(foreign, nested, 'junction');
      expect(() => retireNoFollowDirectoryTree(input)).toThrow();
      expect(await readFile(path.join(foreign, 'value.txt'), 'utf8')).toBe('foreign');
      expect(await readFile(path.join(parentPath, 'original-nested', 'value.txt'), 'utf8')).toBe('original');
    });
  }
});

test.skipIf(process.platform !== 'win32')('Windows fixed inventory preserves new members during failed retirement and remaining-scope retry', async () => {
  await withWindowsRetirementFixture(async (parentPath, rootPath) => {
    await mkdir(path.join(rootPath, 'nested'));
    await writeFile(path.join(rootPath, 'nested', 'known.txt'), 'known');
    const input = fixedRetirementInput(parentPath, rootPath);
    const newcomer = path.join(rootPath, 'nested', 'new.txt');
    await writeFile(newcomer, 'outside inventory');
    expect(() => retireNoFollowDirectoryTree(input)).toThrow();
    expect(await readFile(newcomer, 'utf8')).toBe('outside inventory');
    await expect(lstat(path.join(rootPath, 'nested', 'known.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(() => retireNoFollowDirectoryTree({ ...input, inventory: input.inventory.filter(entry => entry.kind === 'directory') })).toThrow();
    expect(await readFile(newcomer, 'utf8')).toBe('outside inventory');
  });
});

test.skipIf(process.platform !== 'win32')('Windows fixed inventory byte preimages fail safely and remaining original identities can retire after correction', async () => {
  await withWindowsRetirementFixture(async (parentPath, rootPath) => {
    await mkdir(path.join(rootPath, 'nested'));
    await writeFile(path.join(rootPath, 'nested', 'a.txt'), 'first');
    await writeFile(path.join(rootPath, 'nested', 'b.txt'), 'second');
    const input = fixedRetirementInput(parentPath, rootPath);
    const expectedFileBytes = new Map([['nested/a.txt', Buffer.from('first')], ['nested/b.txt', Buffer.from('second')]]);
    await writeFile(path.join(rootPath, 'nested', 'b.txt'), 'edited');
    expect(() => retireNoFollowDirectoryTree({ ...input, expectedFileBytes })).toThrow('file bytes changed');
    await expect(lstat(path.join(rootPath, 'nested', 'a.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(path.join(rootPath, 'nested', 'b.txt'), 'utf8')).toBe('edited');
    // Every directory handle must be closed even after a mid-tree failure.
    const moved = path.join(parentPath, 'moved-tree');
    await rename(rootPath, moved);
    await rename(moved, rootPath);
    await writeFile(path.join(rootPath, 'nested', 'b.txt'), 'second');
    const receipt = retireNoFollowDirectoryTree({ ...input,
      inventory: input.inventory.filter(entry => entry.relativePath !== 'nested/a.txt'),
      expectedFileBytes: new Map([['nested/b.txt', Buffer.from('second')]]) });
    expect(receipt.status).toBe('physically-absent');
    await expect(lstat(rootPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

function legacyRelocationOperation() {
  const requirementId = 'runtime-physical.legacy-relocation';
  const contractDigest = sha256({ contract: requirementId }) as `sha256:${string}`;
  const plan = compileSemanticOperationPlan({
    aggregateBudgets: [{ resource: 'duration-ms', maximum: 30_000 }],
    attempt: issueSemanticOperationAttemptContext({ authorityGrantDigest: digest('relocation-authority') }),
    deadlineAtUnixMs: Date.now() + 30_000,
    decisionDigest: digest('relocation-decision'),
    intentDigest: digest('relocation-intent'),
    operation: 'runtime-physical.legacy-relocation-test',
    requirements: [{
      contractDigest,
      effectKinds: ['filesystem', 'persistent-state'],
      failureKinds: ['relocation-failed'],
      id: requirementId
    }]
  });
  return bindSemanticOperation(plan, [compileCapabilityBinding({
    contractDigest,
    providerIdentityDigest: digest('runtime-physical-provider'),
    requirementId
  })]);
}

test('physical generation retirement issues one exact terminal receipt after releasing authority', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-physical-generation-retirement-'));
  try {
    await writeFile(path.join(root, 'value.txt'), 'immutable\n');
    const physical = inspectNoFollowDirectoryChain(root, 'physical retirement fixture').target;
    const inventory = scanNoFollowDirectoryTreeInventory(physical, {
      deadlineAtMs: performance.now() + 30_000,
      maximumBytes: 1_024,
      maximumEntries: 8
    });
    const materialized = await materializeRetainedNoFollowProvenDirectoryGeneration({
      binding: {
        generationDigest: digest('physical-retirement-generation'),
        treeDigest: digest(JSON.stringify(inventory)),
        treeEntryCount: inventory.length
      },
      deadlineAtUnixMs: Date.now() + 30_000,
      inventory,
      proofText: null,
      releaseMode: 'restore-owner-write',
      root: physical
    });

    const receipt = await materialized.generation.retire();
    expect(await materialized.generation.retire()).toBe(receipt);
    assertPhysicalGenerationRetirementReceipt(receipt);
    expect(() => assertPhysicalGenerationRetirementReceipt({ ...receipt }))
      .toThrow('was not issued by Runtime Physical');
    expect(receipt.root.path).toBe(path.resolve(root));

    await writeFile(path.join(root, 'after-retirement.txt'), 'owner-write-restored\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);

test('tree retirement reads back an uppercase ordinary root and deletes a junction leaf without following it', async () => {
  const parentPath = await mkdtemp(path.join(tmpdir(), 'sec-tree-retirement-uppercase-'));
  const rootPath = path.join(parentPath, 'Generation-UPPER');
  const externalTarget = path.join(parentPath, 'external-target');
  try {
    await mkdir(path.join(rootPath, 'nested'), { recursive: true });
    await mkdir(externalTarget);
    await writeFile(path.join(externalTarget, 'preserved.txt'), 'preserved\n');
    await symlink(externalTarget, path.join(rootPath, 'Retained-Link'),
      process.platform === 'win32' ? 'junction' : 'dir');
    const root = inspectNoFollowDirectoryChain(rootPath, 'uppercase retirement fixture').target;
    const inventory = scanNoFollowDirectoryTreeInventory(root, {
      deadlineAtMs: performance.now() + 30_000,
      maximumBytes: 1_024,
      maximumEntries: 8
    });
    const receipt = retireNoFollowDirectoryTree({
      deadlineAtMonotonicMs: performance.now() + 30_000,
      inventory,
      parent: inspectNoFollowDirectoryChain(parentPath, 'uppercase retirement parent fixture').target,
      root
    });
    expect(receipt.status).toBe('physically-absent');
    await expect(lstat(rootPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(path.join(externalTarget, 'preserved.txt'), 'utf8')).toBe('preserved\n');
  } finally {
    await rm(parentPath, { recursive: true, force: true });
  }
});

test('tree retirement preserves both sides of a root replacement ABA', async () => {
  const parentPath = await mkdtemp(path.join(tmpdir(), 'sec-tree-retirement-aba-'));
  const rootPath = path.join(parentPath, 'Generation-UPPER');
  const displacedPath = path.join(parentPath, 'displaced-generation');
  try {
    await mkdir(rootPath);
    await writeFile(path.join(rootPath, 'owned.txt'), 'owned\n');
    const root = inspectNoFollowDirectoryChain(rootPath, 'retirement ABA fixture').target;
    const inventory = scanNoFollowDirectoryTreeInventory(root, {
      deadlineAtMs: performance.now() + 30_000,
      maximumBytes: 1_024,
      maximumEntries: 8
    });
    await rename(rootPath, displacedPath);
    await mkdir(rootPath);
    await writeFile(path.join(rootPath, 'replacement.txt'), 'replacement\n');
    expect(() => retireNoFollowDirectoryTree({
      deadlineAtMonotonicMs: performance.now() + 30_000,
      inventory,
      parent: inspectNoFollowDirectoryChain(parentPath, 'retirement ABA parent fixture').target,
      root
    })).toThrow('identity changed');
    expect(await readFile(path.join(displacedPath, 'owned.txt'), 'utf8')).toBe('owned\n');
    expect(await readFile(path.join(rootPath, 'replacement.txt'), 'utf8')).toBe('replacement\n');
  } finally {
    await rm(parentPath, { recursive: true, force: true });
  }
});

test.skipIf(process.platform !== 'win32')(
  'Windows legacy relocation preserves an already-authorized descriptor without an ACL Effect',
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sec-legacy-relocation-'));
    const sourceParentPath = path.join(root, 'source-parent');
    const destinationParentPath = path.join(root, 'destination-parent');
    const sourcePath = path.join(sourceParentPath, 'generation');
    const destinationName = 'retained-generation';
    const destinationPath = path.join(destinationParentPath, destinationName);
    try {
      await mkdir(sourcePath, { recursive: true });
      await mkdir(destinationParentPath, { recursive: true });
      await writeFile(path.join(sourcePath, 'value.txt'), 'retained\n');
      const operation = legacyRelocationOperation();
      const capability = prepareWindowsLegacySealedDirectoryRelocation({
        destinationName,
        destinationParent: inspectNoFollowDirectoryChain(
          destinationParentPath,
          'legacy relocation destination parent fixture'
        ).target,
        directory: inspectNoFollowDirectoryChain(sourcePath, 'legacy relocation source fixture').target,
        operation
      });
      const first = relocateWindowsLegacySealedDirectory(capability);
      expect(first.temporaryDescriptorDigest).toBe(first.predecessorDescriptorDigest);
      expect(await readFile(path.join(destinationPath, 'value.txt'), 'utf8')).toBe('retained\n');

      const reopened = openWindowsLegacySealedDirectoryRelocation({
        operation,
        recoveryProofText: capability.recoveryProofText
      });
      const recovered = relocateWindowsLegacySealedDirectory(reopened);
      expect(recovered.destination.objectId).toBe(first.destination.objectId);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  30_000
);

test.skipIf(process.platform !== 'win32')(
  'Windows retirement deletes an exact owner-sealed tree without broad ACL restoration',
  async () => {
    const parentPath = await mkdtemp(path.join(tmpdir(), 'sec-sealed-tree-retirement-'));
    const rootPath = path.join(parentPath, 'generation');
    let binding: Readonly<{
      generationDigest: `sha256:${string}`;
      treeDigest: `sha256:${string}`;
      treeEntryCount: number;
    }> | null = null;
    let proofText: string | null = null;
    try {
      await mkdir(path.join(rootPath, 'nested'), { recursive: true });
      await writeFile(path.join(rootPath, 'nested', 'value.txt'), 'sealed\n');
      const root = inspectNoFollowDirectoryChain(rootPath, 'sealed retirement fixture').target;
      const inventory = scanNoFollowDirectoryTreeInventory(root, {
        deadlineAtMs: performance.now() + 30_000,
        maximumBytes: 1_024,
        maximumEntries: 8
      });
      binding = Object.freeze({
        generationDigest: digest('sealed-retirement-generation'),
        treeDigest: digest(JSON.stringify(inventory)),
        treeEntryCount: inventory.length
      });
      const materialized = await materializeRetainedNoFollowProvenDirectoryGeneration({
        binding,
        deadlineAtUnixMs: Date.now() + 30_000,
        inventory,
        proofText: null,
        root
      });
      proofText = materialized.proofText;
      await materialized.generation.retire();

      const receipt = retireNoFollowDirectoryTree({
        deadlineAtMonotonicMs: performance.now() + 30_000,
        inventory,
        parent: inspectNoFollowDirectoryChain(parentPath, 'sealed retirement parent fixture').target,
        root
      });
      expect(receipt.status).toBe('physically-absent');
      await expect(lstat(rootPath)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      if (proofText !== null && binding !== null &&
          await lstat(rootPath).then(() => true, () => false)) {
        try {
          await retireNoFollowProvenDirectoryGeneration({
            binding,
            deadlineAtUnixMs: Date.now() + 30_000,
            proofText,
            root: inspectNoFollowDirectoryChain(rootPath, 'sealed retirement fixture cleanup').target
          });
        } catch {
          // A failed focused assertion keeps the primary failure.  The test
          // only attempts owner-proof restoration for its own intact fixture.
        }
      }
      await rm(parentPath, { recursive: true, force: true });
    }
  },
  30_000
);
