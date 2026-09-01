import { createHash } from 'node:crypto';
import path from 'node:path';

import { compareCodeUnits } from '../../../system-architecture/foundation/runtime/canonical.ts';

import {
  createExclusiveNoFollowRandomDirectory,
  createNoFollowOrdinaryDirectoryChain,
  materializeRetainedNoFollowProvenDirectoryGeneration,
  publishExclusiveDurableCanonicalFile,
  publishExclusiveNoFollowProvenDirectoryLink,
  retainNoFollowSealedDirectoryGeneration,
  retireNoFollowDirectoryTree,
  scanNoFollowDirectoryTreeInventory,
  type NoFollowDirectoryTreeInventoryEntry,
  type NoFollowDirectoryTreeRetirementReceipt,
  type PhysicalDirectoryIdentity,
  type RetainedNoFollowProvenDirectoryGeneration,
  type RetainedNoFollowSealedDirectoryGeneration
} from './physical-no-follow.ts';
import { sealExistingWindowsReadOnlyTreeAuthority } from './windows-host-filesystem-authority.ts';

const retainedTypeScriptExecutionGenerationBrand: unique symbol = Symbol(
  'retained-typescript-execution-generation'
);
const issuedRetainedTypeScriptExecutionGenerations = new WeakSet<object>();

export type TypeScriptExecutionGenerationFile = Readonly<{
  bytes: Uint8Array;
  path: string;
}>;

export type RetainedTypeScriptExecutionGenerationCleanupReceipt = Readonly<{
  dependencyGeneration: 'physically-clean';
  projectAuthority: 'physically-clean';
  projectTree: NoFollowDirectoryTreeRetirementReceipt;
}>;

export class RetainedTypeScriptExecutionGenerationResidueError extends Error {
  readonly code = 'RUNTIME_PHYSICAL_TYPESCRIPT_EXECUTION_GENERATION_RESIDUE' as const;

  constructor(message: string, cause: unknown) {
    super(message, { cause });
    this.name = 'RetainedTypeScriptExecutionGenerationResidueError';
  }
}

export interface RetainedTypeScriptExecutionGeneration {
  readonly [retainedTypeScriptExecutionGenerationBrand]: true;
  readonly dependencyDirectory: RetainedNoFollowProvenDirectoryGeneration;
  readonly workingDirectory: RetainedNoFollowSealedDirectoryGeneration | RetainedNoFollowProvenDirectoryGeneration;
  assertCurrent(): Promise<void>;
  retire(): Promise<RetainedTypeScriptExecutionGenerationCleanupReceipt>;
}

export type MaterializeRetainedTypeScriptExecutionGenerationInput = Readonly<{
  deadlineAtUnixMs: number;
  dependencyGeneration: RetainedNoFollowProvenDirectoryGeneration;
  files: readonly TypeScriptExecutionGenerationFile[];
  generationParent: PhysicalDirectoryIdentity;
  signal?: AbortSignal;
}>;

function canonicalGenerationFiles(
  files: readonly TypeScriptExecutionGenerationFile[]
): readonly TypeScriptExecutionGenerationFile[] {
  const seen = new Set<string>();
  return Object.freeze(files.map((file) => {
    const parts = file.path.split('/');
    if (file.path.length === 0 || path.isAbsolute(file.path)
        || parts.some((part) => part.length === 0 || part === '.' || part === '..')
        || parts.join('/') !== file.path || file.path.includes('\0')) {
      throw new Error(`Runtime Physical TypeScript generation path is not canonical: ${file.path}`);
    }
    if (seen.has(file.path)) {
      throw new Error(`Runtime Physical TypeScript generation path is duplicated: ${file.path}`);
    }
    seen.add(file.path);
    return Object.freeze({
      bytes: Buffer.from(file.bytes),
      path: file.path
    });
  }));
}

export function assertRetainedTypeScriptExecutionGeneration(
  generation: RetainedTypeScriptExecutionGeneration
): void {
  if (!issuedRetainedTypeScriptExecutionGenerations.has(generation)) {
    throw new Error('TypeScript execution generation was not issued by Runtime Physical');
  }
}

/**
 * Materializes and retains one immutable TypeScript process input. Runtime
 * Physical owns every filesystem, ACL, link and retirement Effect; the caller
 * supplies only exact bytes plus already-retained parent/dependency identities.
 */
export async function materializeRetainedTypeScriptExecutionGeneration(
  input: MaterializeRetainedTypeScriptExecutionGenerationInput
): Promise<RetainedTypeScriptExecutionGeneration> {
  const deadlineAtMonotonicMs = performance.now() + Math.max(
    0,
    input.deadlineAtUnixMs - Date.now()
  );
  const assertOperationCurrent = (): void => {
    if (input.signal?.aborted === true) {
      throw new Error('Runtime Physical TypeScript generation was aborted');
    }
    if (!Number.isSafeInteger(input.deadlineAtUnixMs)
        || Date.now() >= input.deadlineAtUnixMs
        || performance.now() >= deadlineAtMonotonicMs) {
      throw new Error('Runtime Physical TypeScript generation deadline is exhausted');
    }
  };
  assertOperationCurrent();
  const files = canonicalGenerationFiles(input.files);
  const parentPaths = [...new Set(files.flatMap((file) => {
    const parts = file.path.split('/');
    parts.pop();
    return parts.map((_, index) => parts.slice(0, index + 1).join('/'));
  }))].sort((left, right) => (
    left.split('/').length - right.split('/').length || compareCodeUnits(left, right)
  ));
  const maximumMaterializedEntries = parentPaths.length + files.length + 1;
  const maximumMaterializedBytes = files.reduce((total, file) => total + file.bytes.byteLength, 0);
  const generationRoot = createExclusiveNoFollowRandomDirectory(
    input.generationParent,
    'typecheck-generation-'
  );
  let inventory: readonly NoFollowDirectoryTreeInventoryEntry[] = [];
  let inventoryKnown = false;
  let workingDirectory: RetainedNoFollowSealedDirectoryGeneration | RetainedNoFollowProvenDirectoryGeneration | null = null;
  let dependencyDirectory: RetainedNoFollowProvenDirectoryGeneration | null = input.dependencyGeneration;
  try {
    const directories = new Map<string, PhysicalDirectoryIdentity>([['', generationRoot]]);
    for (const relativePath of parentPaths) {
      assertOperationCurrent();
      directories.set(
        relativePath,
        createNoFollowOrdinaryDirectoryChain(generationRoot, relativePath.split('/'))
      );
    }
    for (const file of files) {
      assertOperationCurrent();
      const parts = file.path.split('/');
      const name = parts.pop()!;
      const parent = directories.get(parts.join('/'));
      if (parent === undefined) {
        throw new Error(`Runtime Physical TypeScript generation parent is absent for ${file.path}`);
      }
      publishExclusiveDurableCanonicalFile({
        parent,
        name,
        bytes: file.bytes,
        validate: (readback) => {
          if (!Buffer.from(readback).equals(file.bytes)) {
            throw new Error('Runtime Physical TypeScript generation file readback differs');
          }
        }
      });
    }
    assertOperationCurrent();
    input.dependencyGeneration.assertCurrent();
    await input.dependencyGeneration.assertAuthorityCurrent();
    publishExclusiveNoFollowProvenDirectoryLink({
      parent: generationRoot,
      name: 'node_modules',
      source: input.dependencyGeneration
    });
    inventory = scanNoFollowDirectoryTreeInventory(generationRoot, {
      deadlineAtMs: performance.now() + Math.max(1, input.deadlineAtUnixMs - Date.now()),
      maximumEntries: maximumMaterializedEntries,
      maximumBytes: maximumMaterializedBytes
    });
    inventoryKnown = true;
    if (process.platform === 'win32') {
      const projectAcl = await sealExistingWindowsReadOnlyTreeAuthority(
        generationRoot.path,
        inventory.filter(({ kind }) => kind !== 'link').map(({ relativePath }) => (
          path.join(generationRoot.path, ...relativePath.split('/'))
        )),
        {
          deadlineAtMs: input.deadlineAtUnixMs,
          ownerRootPath: input.generationParent.path,
          repositoryRootPath: input.dependencyGeneration.root.path,
          signal: input.signal
        }
      );
      assertOperationCurrent();
      workingDirectory = await retainNoFollowSealedDirectoryGeneration(
        generationRoot,
        inventory,
        projectAcl,
        'TypeScript checker project generation'
      );
    } else if (process.platform === 'linux') {
      const treeDigest = `sha256:${createHash('sha256').update(JSON.stringify(inventory)).digest('hex')}` as const;
      const projectGeneration = await materializeRetainedNoFollowProvenDirectoryGeneration({
        binding: {
          generationDigest: `sha256:${createHash('sha256').update(JSON.stringify({
            root: generationRoot,
            treeDigest
          })).digest('hex')}`,
          treeDigest,
          treeEntryCount: inventory.length
        },
        deadlineAtUnixMs: input.deadlineAtUnixMs,
        inventory,
        proofText: null,
        releaseMode: 'restore-owner-write',
        root: generationRoot,
        signal: input.signal
      });
      workingDirectory = projectGeneration.generation;
    } else {
      throw new Error(`Runtime Physical TypeScript generation is unavailable on ${process.platform}`);
    }
    let retired = false;
    let retirement: Promise<RetainedTypeScriptExecutionGenerationCleanupReceipt> | null = null;
    const generation: RetainedTypeScriptExecutionGeneration = Object.freeze({
      [retainedTypeScriptExecutionGenerationBrand]: true as const,
      dependencyDirectory,
      workingDirectory,
      assertCurrent: async () => {
        if (retired) throw new Error('Runtime Physical TypeScript generation is retired');
        workingDirectory!.assertCurrent();
        dependencyDirectory!.assertCurrent();
        await workingDirectory!.assertAuthorityCurrent();
        await dependencyDirectory!.assertAuthorityCurrent();
      },
      retire: () => {
        if (retirement !== null) return retirement;
        retired = true;
        retirement = (async () => {
          let failure: unknown;
          let dependencyGenerationClean = false;
          let projectAuthorityClean = false;
          try {
            assertOperationCurrent();
            await dependencyDirectory!.retire();
            dependencyGenerationClean = true;
          } catch (error) { failure ??= error; }
          try {
            assertOperationCurrent();
            await workingDirectory!.retire();
            projectAuthorityClean = true;
          } catch (error) { failure ??= error; }
          let projectTree: NoFollowDirectoryTreeRetirementReceipt | null = null;
          try {
            assertOperationCurrent();
            projectTree = retireNoFollowDirectoryTree({
              deadlineAtMonotonicMs,
              inventory,
              parent: input.generationParent,
              root: generationRoot
            });
          } catch (error) { failure ??= error; }
          if (failure !== undefined || !dependencyGenerationClean
              || !projectAuthorityClean || projectTree === null) {
            throw new RetainedTypeScriptExecutionGenerationResidueError(
              'Runtime Physical TypeScript generation retirement left physical residue',
              failure
            );
          }
          return Object.freeze({
            dependencyGeneration: 'physically-clean' as const,
            projectAuthority: 'physically-clean' as const,
            projectTree
          });
        })();
        return retirement;
      }
    });
    issuedRetainedTypeScriptExecutionGenerations.add(generation);
    await generation.assertCurrent();
    return generation;
  } catch (error) {
    let cleanupFailure: unknown;
    try {
      assertOperationCurrent();
      await dependencyDirectory?.retire();
    } catch (failure) { cleanupFailure ??= failure; }
    try {
      assertOperationCurrent();
      await workingDirectory?.retire();
    } catch (failure) { cleanupFailure ??= failure; }
    if (inventory.length === 0) {
      try {
        assertOperationCurrent();
        inventory = scanNoFollowDirectoryTreeInventory(generationRoot, {
          deadlineAtMs: deadlineAtMonotonicMs,
          maximumEntries: maximumMaterializedEntries,
          maximumBytes: maximumMaterializedBytes
        });
        inventoryKnown = true;
      } catch (failure) {
        cleanupFailure ??= failure;
      }
    }
    if (inventoryKnown) {
      try {
        assertOperationCurrent();
        retireNoFollowDirectoryTree({
          deadlineAtMonotonicMs,
          inventory,
          parent: input.generationParent,
          root: generationRoot
        });
      } catch (failure) {
        cleanupFailure ??= failure;
      }
    }
    if (cleanupFailure !== undefined) {
      throw new RetainedTypeScriptExecutionGenerationResidueError(
        'Runtime Physical TypeScript generation failed and preserved typed physical residue',
        new AggregateError([error, cleanupFailure])
      );
    }
    throw error;
  }
}
