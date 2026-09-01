import path from 'node:path';

import { decodeExactUtf8, readOptionalRetainedOrdinaryFile } from '../../runtime-state/physical/runtime/retained-file-read.ts';
import type { OverrideEntry } from '../../semantic/provenance/contract/types.ts';
import type { CommitFence } from '../../workspace/files.ts';
import {
  deleteExpectedCanonicalWorkspaceFile,
  publishExclusiveCanonicalWorkspaceFile,
  publishExpectedCanonicalWorkspaceFile
} from '../../workspace/files.ts';
import { resolvePathInside } from '../../workspace/runtime/paths.ts';
import { CompilerError } from '../errors.ts';
import {
  loadOverrideManifest,
  resolveOverrideManifestPath
} from '../parse/load-override-manifest.ts';

type PreparedOverride = Readonly<{
  entry: OverrideEntry;
  sourcePath: string;
  sourceBytes: Uint8Array;
  targetPath: string;
  targetPreimage: Uint8Array | null;
}>;

function readOverrideSource(
  overrideRoot: string,
  workspaceRoot: string,
  entry: OverrideEntry
): PreparedOverride {
  const sourcePath = resolvePathInside(overrideRoot, entry.entry);
  const targetPath = resolvePathInside(workspaceRoot, entry.target);
  if (!sourcePath || !targetPath) {
    throw new CompilerError(
      'OVERRIDE-APPLY-001',
      `Override "${entry.id}" escaped its validated source/target root`
    );
  }

  const sourceBytes = readOptionalRetainedOrdinaryFile(
    sourcePath,
    `Override source ${entry.id}`
  );
  if (sourceBytes === null) {
    throw new CompilerError(
      'OVERRIDE-APPLY-001',
      `Override "${entry.id}" source "${entry.entry}" is missing`
    );
  }
  // Override source semantics are text, not arbitrary bytes. Preserve the exact
  // observed bytes for publication but reject non-UTF-8 input up front.
  try {
    decodeExactUtf8(sourceBytes, `Override source ${entry.id}`);
  } catch (error) {
    throw new CompilerError(
      'OVERRIDE-APPLY-001',
      `Override "${entry.id}" source is not exact UTF-8`,
      { cause: error instanceof Error ? error.message : String(error) }
    );
  }
  const targetPreimage = readOptionalRetainedOrdinaryFile(
    targetPath,
    `Override target ${entry.id}`
  );
  return Object.freeze({ entry, sourcePath, sourceBytes, targetPath, targetPreimage });
}

function sameOptionalBytes(left: Uint8Array | null, right: Uint8Array | null): boolean {
  return left === null
    ? right === null
    : right !== null && Buffer.from(left).equals(Buffer.from(right));
}

function assertPreparedOverrideInputsCurrent(prepared: readonly PreparedOverride[]): void {
  for (const override of prepared) {
    const source = readOptionalRetainedOrdinaryFile(
      override.sourcePath,
      `Override source ${override.entry.id} final fence`
    );
    const target = readOptionalRetainedOrdinaryFile(
      override.targetPath,
      `Override target ${override.entry.id} final fence`
    );
    if (source === null || !Buffer.from(source).equals(Buffer.from(override.sourceBytes))) {
      throw new CompilerError(
        'OVERRIDE-APPLY-001',
        `Override "${override.entry.id}" source changed after planning`
      );
    }
    if (!sameOptionalBytes(target, override.targetPreimage)) {
      throw new CompilerError(
        'OVERRIDE-APPLY-001',
        `Override "${override.entry.id}" target preimage changed after planning`
      );
    }
  }
}

async function rollbackPublishedOverrides(
  workspaceRoot: string,
  published: readonly PreparedOverride[]
): Promise<void> {
  for (const override of [...published].reverse()) {
    const input = {
      workspaceRoot,
      targetPath: override.targetPath,
      expectedBytes: override.sourceBytes,
      label: `Override ${override.entry.id} rollback`
    };
    if (override.targetPreimage === null) {
      await deleteExpectedCanonicalWorkspaceFile({ ...input, bytes: override.sourceBytes });
    } else {
      await publishExpectedCanonicalWorkspaceFile({ ...input, bytes: override.targetPreimage });
    }
  }
}

export async function applyOverrides(
  workspaceRoot: string,
  commitFence?: CommitFence
): Promise<void> {
  const manifest = await loadOverrideManifest(workspaceRoot);
  const overrideManifestPath = await resolveOverrideManifestPath(workspaceRoot);
  const overrideRoot = path.dirname(overrideManifestPath);

  // Freeze every applicable source before the first project effect so the
  // batch is planned against one exact source/target preimage.
  const prepared = manifest.overrides
    .map((entry) => readOverrideSource(overrideRoot, workspaceRoot, entry));

  await commitFence?.();
  assertPreparedOverrideInputsCurrent(prepared);

  const published: PreparedOverride[] = [];
  try {
    for (const override of prepared) {
      const publicationFence = async (): Promise<void> => {
        await commitFence?.();
        const sourceAtPublication = readOptionalRetainedOrdinaryFile(
          override.sourcePath,
          `Override source ${override.entry.id} publication fence`
        );
        if (sourceAtPublication === null
            || !Buffer.from(sourceAtPublication).equals(Buffer.from(override.sourceBytes))) {
          throw new CompilerError(
            'OVERRIDE-APPLY-001',
            `Override "${override.entry.id}" source changed before publication`
          );
        }
      };
      if (override.targetPreimage !== null
          && Buffer.from(override.targetPreimage).equals(Buffer.from(override.sourceBytes))) {
        await publicationFence();
        continue;
      }
      if (override.targetPreimage === null) {
        await publishExclusiveCanonicalWorkspaceFile({
          workspaceRoot,
          targetPath: override.targetPath,
          bytes: override.sourceBytes,
          label: `Override ${override.entry.id}`,
          commitFence: publicationFence
        });
        published.push(override);
        continue;
      }
      await publishExpectedCanonicalWorkspaceFile({
        workspaceRoot,
        targetPath: override.targetPath,
        expectedBytes: override.targetPreimage,
        bytes: override.sourceBytes,
        label: `Override ${override.entry.id}`,
        commitFence: publicationFence
      });
      published.push(override);
    }
  } catch (error) {
    try {
      // Forward authorization may remain failed after an interrupted batch.
      // Compensation is instead bounded by the exact bytes and retained
      // physical identity published by this operation; a substituted target
      // becomes typed residue rather than being overwritten.
      await rollbackPublishedOverrides(workspaceRoot, published);
    } catch (rollbackError) {
      throw new CompilerError(
        'OVERRIDE-APPLY-002',
        'Override publication failed and exact rollback could not be proven',
        {
          publicationError: error instanceof Error ? error.message : String(error),
          rollbackError: rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
        }
      );
    }
    throw error;
  }
}
