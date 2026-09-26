import type {
  NoFollowDirectoryTreeRetirementReceipt,
  PhysicalDirectoryIdentity,
  RetainedNoFollowProvenDirectoryGeneration,
  RetainedNoFollowSealedDirectoryGeneration
} from './physical-no-follow.ts';
import {
  materializeSealedExecutionTree,
  SealedExecutionTreeResidueError,
  type RetainedSealedExecutionTreeGeneration,
  type SealedExecutionTreeResidue
} from './sealed-execution-tree-generation.ts';

const retainedTypeScriptExecutionGenerationBrand: unique symbol = Symbol(
  'retained-typescript-execution-generation'
);
const issuedRetainedTypeScriptExecutionGenerations = new WeakSet<object>();

type TypeScriptExecutionGenerationFile = Readonly<{
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
  readonly physicalResidues: readonly SealedExecutionTreeResidue[];

  constructor(
    message: string,
    cause: unknown,
    physicalResidues: readonly SealedExecutionTreeResidue[] = []
  ) {
    super(message, { cause });
    this.name = 'RetainedTypeScriptExecutionGenerationResidueError';
    this.physicalResidues = Object.freeze([...physicalResidues]);
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
  let physical: RetainedSealedExecutionTreeGeneration | null = null;
  try {
    physical = await materializeSealedExecutionTree({
      deadlineAtUnixMs: input.deadlineAtUnixMs,
      directoryNamePrefix: 'typecheck-generation-',
      filePublication: 'sealed-ephemeral',
      files: input.files,
      generationParent: input.generationParent,
      links: [{ path: 'node_modules', source: input.dependencyGeneration }],
      signal: input.signal
    });
    let retired = false;
    let inFlightRetirement: Promise<RetainedTypeScriptExecutionGenerationCleanupReceipt> | null = null;
    let terminalReceipt: RetainedTypeScriptExecutionGenerationCleanupReceipt | null = null;
    const generation: RetainedTypeScriptExecutionGeneration = Object.freeze({
      [retainedTypeScriptExecutionGenerationBrand]: true as const,
      dependencyDirectory: input.dependencyGeneration,
      workingDirectory: physical.workingDirectory,
      assertCurrent: async () => {
        if (retired) throw new Error('Runtime Physical TypeScript generation is retired');
        await physical!.assertCurrent();
      },
      retire: () => {
        if (terminalReceipt !== null) return Promise.resolve(terminalReceipt);
        if (inFlightRetirement !== null) return inFlightRetirement;
        retired = true;
        inFlightRetirement = (async () => {
          try {
            const receipt = await physical!.retire();
            await input.dependencyGeneration.retire();
            terminalReceipt = Object.freeze({
              dependencyGeneration: 'physically-clean' as const,
              projectAuthority: 'physically-clean' as const,
              projectTree: receipt.tree
            });
            return terminalReceipt;
          } catch (error) {
            const residues = error instanceof SealedExecutionTreeResidueError
              ? [error.residue]
              : [];
            throw new RetainedTypeScriptExecutionGenerationResidueError(
              'Runtime Physical TypeScript generation retirement left physical residue',
              error,
              residues
            );
          }
        })().finally(() => {
          inFlightRetirement = null;
        });
        return inFlightRetirement;
      }
    });
    issuedRetainedTypeScriptExecutionGenerations.add(generation);
    await generation.assertCurrent();
    return generation;
  } catch (error) {
    const failures: unknown[] = [error];
    if (physical !== null) {
      try { await physical.retire(); } catch (cleanupError) { failures.push(cleanupError); }
    }
    try {
      await input.dependencyGeneration.retire();
    } catch (cleanupError) {
      failures.push(cleanupError);
    }
    const physicalResidues = Object.freeze(failures.flatMap((failure) => (
      failure instanceof SealedExecutionTreeResidueError ? [failure.residue] : []
    )));
    if (failures.length > 1 || physicalResidues.length > 0) {
      throw new RetainedTypeScriptExecutionGenerationResidueError(
        'Runtime Physical TypeScript generation setup settlement failed',
        failures.length === 1 ? error : new AggregateError(failures),
        physicalResidues
      );
    }
    throw error;
  }
}
