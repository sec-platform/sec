import path from 'node:path';

import type { CommitFence } from './fs.ts';
import {
  createNoFollowDirectoryChainV1,
  inspectNoFollowDirectoryChainV1,
  replaceDurableCanonicalFileV1
} from './physical-no-follow.ts';

export interface CanonicalWorkspaceFilePublicationInput {
  readonly workspaceRoot: string;
  readonly targetPath: string;
  readonly bytes: Uint8Array;
  readonly label: string;
  readonly commitFence?: CommitFence;
}

function canonicalWorkspaceRelativeSegments(workspaceRoot: string, targetPath: string): string[] {
  const root = path.resolve(workspaceRoot);
  const target = path.resolve(targetPath);
  const relative = path.relative(root, target);
  if (
    relative.length === 0 ||
    path.isAbsolute(relative) ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`)
  ) {
    throw new Error(`Canonical workspace publication target "${targetPath}" must be one file inside "${root}"`);
  }
  const segments = relative.split(path.sep);
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new Error(`Canonical workspace publication target "${targetPath}" has an invalid path component`);
  }
  for (const segment of segments.slice(0, -1)) {
    if (segment !== '.tmp' && !/^[a-z0-9-]+$/u.test(segment)) {
      throw new Error(
        `Canonical workspace publication parent "${segment}" is outside the retained canonical-directory vocabulary`
      );
    }
  }
  return segments;
}

/**
 * Physical publisher for already-authorized canonical workspace control/source
 * files whose parent directory names are in the retained canonical vocabulary.
 * It deliberately does NOT cover arbitrary project/slot paths.  Those require
 * a broader path-identity capability rather than weakening the canonical
 * directory primitive used by control/recovery state.
 */
export async function publishCanonicalWorkspaceFileV1(
  input: CanonicalWorkspaceFilePublicationInput
): Promise<void> {
  const rootPath = path.resolve(input.workspaceRoot);
  const segments = canonicalWorkspaceRelativeSegments(rootPath, input.targetPath);
  const leafName = segments.at(-1)!;
  const parentSegments = segments.slice(0, -1);
  const workspace = inspectNoFollowDirectoryChainV1(
    rootPath,
    `${input.label} workspace root`
  ).target;

  await input.commitFence?.();
  const parent = parentSegments.length === 0
    ? workspace
    : createNoFollowDirectoryChainV1(workspace, parentSegments);

  await input.commitFence?.();
  replaceDurableCanonicalFileV1({
    parent,
    name: leafName,
    bytes: input.bytes,
    validate: (current) => {
      if (!Buffer.from(current).equals(Buffer.from(input.bytes))) {
        throw new Error(`${input.label} readback differs from requested bytes`);
      }
    }
  });
}

/**
 * Transitional compatibility name for the already-landed Workbench consumer.
 * It is intentionally NOT a generic project-path publisher; callers must obey
 * the canonical parent vocabulary enforced above.  Remove this alias when the
 * Workbench import is renamed during its next focused edit.
 */
export const publishWorkspaceFileV1 = publishCanonicalWorkspaceFileV1;
