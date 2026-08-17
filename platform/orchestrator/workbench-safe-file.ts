import path from 'node:path';

import { formatJsonFile, type CommitFence } from '../shared/fs.ts';
import {
  createNoFollowDirectoryChainV1,
  inspectNoFollowDirectoryChainV1,
  PhysicalNoFollowError,
  readNoFollowOrdinaryFileV1,
  replaceDurableCanonicalFileV1
} from '../shared/physical-no-follow.ts';

export function readWorkbenchOrdinaryFile(
  filePath: string,
  label: string
): Uint8Array | null {
  try {
    const parent = inspectNoFollowDirectoryChainV1(
      path.dirname(filePath),
      `${label} parent`
    ).target;
    return readNoFollowOrdinaryFileV1(parent, path.basename(filePath));
  } catch (error) {
    if (error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_ABSENT') {
      return null;
    }
    throw error;
  }
}

export function decodeExactWorkbenchUtf8(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error(`${label} is not exact UTF-8`, { cause: error });
  }
}

export function readWorkbenchJsonArtifact<T>(filePath: string, label: string): T | null {
  const bytes = readWorkbenchOrdinaryFile(filePath, label);
  if (bytes === null) return null;
  return JSON.parse(decodeExactWorkbenchUtf8(bytes, label)) as T;
}

export async function publishWorkbenchMutationEnvelope(
  workspaceRoot: string,
  value: unknown,
  commitFence: CommitFence
): Promise<void> {
  const workspacePath = path.resolve(workspaceRoot);
  await commitFence();
  const workspace = inspectNoFollowDirectoryChainV1(
    workspacePath,
    'Workbench workspace root'
  ).target;

  await commitFence();
  const mutationRoot = createNoFollowDirectoryChainV1(
    workspace,
    ['source', 'views', 'mutations']
  );
  const bytes = Buffer.from(formatJsonFile(value), 'utf8');

  await commitFence();
  replaceDurableCanonicalFileV1({
    parent: mutationRoot,
    name: 'graph-action.json',
    bytes,
    validate: (current) => {
      if (!Buffer.from(current).equals(bytes)) {
        throw new Error('Workbench mutation envelope readback differs from canonical bytes');
      }
    }
  });
}
