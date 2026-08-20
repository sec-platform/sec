import path from 'node:path';

import { CompilerError } from '../../shared/errors.ts';
import type { CommitFence } from '../../shared/fs.ts';
import { getWorkspacePaths, resolvePathInside } from '../../shared/paths.ts';
import type { OverrideApplyPhase, OverrideEntry } from '../../shared/provenance-types.ts';
import {
  decodeExactUtf8V1,
  readOptionalRetainedOrdinaryFileV1
} from '../../shared/retained-file-read.ts';
import {
  publishExclusiveCanonicalWorkspaceFileV1,
  publishExpectedCanonicalWorkspaceFileV1
} from '../../shared/workspace-file-publication.ts';
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
  projectRoot: string,
  entry: OverrideEntry
): PreparedOverride {
  const sourcePath = resolvePathInside(overrideRoot, entry.entry);
  const targetPath = resolvePathInside(projectRoot, entry.target);
  if (!sourcePath || !targetPath) {
    throw new CompilerError(
      'OVERRIDE-APPLY-001',
      `Override "${entry.id}" escaped its validated source/target root`
    );
  }

  const sourceBytes = readOptionalRetainedOrdinaryFileV1(
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
    decodeExactUtf8V1(sourceBytes, `Override source ${entry.id}`);
  } catch (error) {
    throw new CompilerError(
      'OVERRIDE-APPLY-001',
      `Override "${entry.id}" source is not exact UTF-8`,
      { cause: error instanceof Error ? error.message : String(error) }
    );
  }
  const targetPreimage = readOptionalRetainedOrdinaryFileV1(
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
    const source = readOptionalRetainedOrdinaryFileV1(
      override.sourcePath,
      `Override source ${override.entry.id} final fence`
    );
    const target = readOptionalRetainedOrdinaryFileV1(
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

export async function applyOverrides(
  workspaceRoot: string,
  phase: OverrideApplyPhase,
  commitFence?: CommitFence
): Promise<void> {
  const { projectRoot } = getWorkspacePaths(workspaceRoot);
  const manifest = await loadOverrideManifest(workspaceRoot);
  const overrideManifestPath = await resolveOverrideManifestPath(workspaceRoot);
  const overrideRoot = path.dirname(overrideManifestPath);

  // Freeze every applicable source before the first project effect. This is
  // deliberately operation-local; #296/#420 can later supply the same bytes
  // from the unified Workspace Observation without changing this publisher.
  const prepared = manifest.overrides
    .filter((entry) => entry.appliesAfter.includes(phase))
    .map((entry) => readOverrideSource(overrideRoot, projectRoot, entry));

  await commitFence?.();
  assertPreparedOverrideInputsCurrent(prepared);

  for (const override of prepared) {
    const publicationFence = async (): Promise<void> => {
      await commitFence?.();
      const sourceAtPublication = readOptionalRetainedOrdinaryFileV1(
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
      await publishExclusiveCanonicalWorkspaceFileV1({
        workspaceRoot,
        targetPath: override.targetPath,
        bytes: override.sourceBytes,
        label: `Override ${override.entry.id}`,
        commitFence: publicationFence
      });
      continue;
    }
    await publishExpectedCanonicalWorkspaceFileV1({
      workspaceRoot,
      targetPath: override.targetPath,
      expectedBytes: override.targetPreimage,
      bytes: override.sourceBytes,
      label: `Override ${override.entry.id}`,
      commitFence: publicationFence
    });
  }
}
