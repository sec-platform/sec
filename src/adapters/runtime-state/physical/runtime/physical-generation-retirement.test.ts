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
