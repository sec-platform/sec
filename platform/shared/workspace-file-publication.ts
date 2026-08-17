import path from 'node:path';

import type { CommitFence } from './fs.ts';
import {
  createNoFollowDirectoryChainV1,
  inspectNoFollowDirectoryChainV1,
  replaceDurableCanonicalFileV1
} from './physical-no-follow.ts';

export interface WorkspaceFilePublicationInput {
  readonly workspaceRoot: string;
  readonly targetPath: string;
  readonly bytes: Uint8Array;
  readonly label: string;
  readonly commitFence?: CommitFence;
}

function workspaceRelativeSegments(workspaceRoot: string, targetPath: string): string[] {
  const root = path.resolve(workspaceRoot);
  const target = path.resolve(targetPath);
  const relative = path.relative(root, target);
  if (
    relative.length === 0 ||
    path.isAbsolute(relative) ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`)
  ) {
    throw new Error(`Workspace publication target "${targetPath}" must be one file inside "${root}"`);
  }
  const segments = relative.split(path.sep);
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new Error(`Workspace publication target "${targetPath}" has a non-canonical path component`);
  }
  return segments;
}

/**
 * Pure physical publication primitive for already-authorized workspace writes.
 * It does not decide whether a caller is allowed to mutate the target.  It only
 * preserves the workspace physical identity, refuses link-following ancestors,
 * creates missing parent directories through retained handles, atomically
 * replaces the ordinary leaf, and verifies exact byte readback.
 */
export async function publishWorkspaceFileV1(input: WorkspaceFilePublicationInput): Promise<void> {
  const rootPath = path.resolve(input.workspaceRoot);
  const segments = workspaceRelativeSegments(rootPath, input.targetPath);
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
