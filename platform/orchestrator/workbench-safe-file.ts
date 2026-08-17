import path from 'node:path';

import {
  inspectNoFollowDirectoryChainV1,
  PhysicalNoFollowError,
  readNoFollowOrdinaryFileV1
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
