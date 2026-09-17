import path from 'node:path';

import { decodeExactUtf8, readOptionalRetainedOrdinaryFile } from '../../../runtime-state/physical/runtime/retained-file-read.ts';
import type { OverrideEntry } from '../../../semantics/provenance/types.ts';
import type { CommitFence } from "../../../contracts/commit-fence.ts";
import { deleteExpectedCanonicalWorkspaceFile, publishExclusiveCanonicalWorkspaceFile, publishExpectedCanonicalWorkspaceFile } from "../../filesystem/file-publication.ts";
import { resolvePathInside } from "../../../contracts/relative-path.ts";
import { CompilerError } from '../../../compiler/errors.ts';
import {
  loadOverrideManifest,
  resolveOverrideManifestPath
} from '../../workspace/sources/load-override-manifest.ts';

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
      {},
      { cause: error }
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

type OverrideRollbackFailure = Readonly<{ overrideId: string; targetPath: string; reason: unknown }>;

async function rollbackPublishedOverrides(
  workspaceRoot: string,
  published: readonly PreparedOverride[]
): Promise<readonly OverrideRollbackFailure[]> {
  const failures: OverrideRollbackFailure[] = [];
  // Every confirmed publication gets its compensation attempt. Conditional
  // publishers still refuse a substituted target; one refusal must not strand
  // other independent outputs or discard their failure evidence.
  for (let index = published.length - 1; index >= 0; index -= 1) {
    const override = published[index]!;
    const input = {
      workspaceRoot,
      targetPath: override.targetPath,
      expectedBytes: override.sourceBytes,
      label: `Override ${override.entry.id} rollback`
    };
    try {
      if (override.targetPreimage === null) {
        await deleteExpectedCanonicalWorkspaceFile({ ...input, bytes: override.sourceBytes });
      } else {
        await publishExpectedCanonicalWorkspaceFile({ ...input, bytes: override.targetPreimage });
      }
    } catch (reason) {
      failures.push(Object.freeze({ overrideId: override.entry.id, targetPath: override.targetPath, reason }));
    }
  }
  return Object.freeze(failures);
}

export async function applyOverrides(
  workspaceRoot: string,
  commitFence?: CommitFence
): Promise<void> {
  workspaceRoot = path.resolve(workspaceRoot);
  if (commitFence !== undefined && typeof commitFence !== 'function') throw new TypeError('Override commit fence must be callable');
  const manifest = await loadOverrideManifest(workspaceRoot);
  const entries = manifest.overrides.map(entry => Object.freeze({ ...entry }));
  const overrideManifestPath = await resolveOverrideManifestPath(workspaceRoot);
  const overrideRoot = path.dirname(overrideManifestPath);

  // Freeze every applicable source before the first project effect so the
  // batch is planned against one exact source/target preimage.
  const prepared = entries
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
        const current = readOptionalRetainedOrdinaryFile(override.targetPath, `Override target ${override.entry.id} no-op readback`);
        if (!sameOptionalBytes(current, override.sourceBytes)) {
          throw new CompilerError('OVERRIDE-APPLY-001', `Override "${override.entry.id}" target changed before no-op completion`);
        }
        continue;
      }
      if (override.targetPreimage === null) {
        const receipt = await publishExclusiveCanonicalWorkspaceFile({
          workspaceRoot,
          targetPath: override.targetPath,
          bytes: override.sourceBytes,
          label: `Override ${override.entry.id}`,
          commitFence: publicationFence
        });
        // Equal bytes may have been published by another actor after planning.
        // Successful adoption does not authorize deletion of that actor's file.
        if (receipt.created) published.push(override);
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
    // Failed publication itself may have an uncertain physical outcome. Only
    // confirmed prior outputs are compensated; no force-write guesses ownership.
    const failures = await rollbackPublishedOverrides(workspaceRoot, published);
    if (failures.length > 0) {
      throw new CompilerError(
        'OVERRIDE-APPLY-002',
        'Override publication failed and exact rollback could not be proven',
        { rollbackFailures: failures.map(({ overrideId, targetPath }) => ({ overrideId, targetPath })) },
        { cause: new AggregateError([error, ...failures.map(({ reason }) => reason)],
          'Override publication and compensation failures', { cause: error }) }
      );
    }
    throw error;
  }
}
