import path from 'node:path';

import { inspectNoFollowDirectoryChain, PhysicalNoFollowError, readNoFollowOrdinaryFile } from '../../runtime-state/physical/runtime/physical-no-follow.ts';

export function readOptionalAuthorityBytes(
  filePath: string,
  label: string
): Uint8Array | null {
  const absolutePath = path.resolve(filePath);
  try {
    const parent = inspectNoFollowDirectoryChain(
      path.dirname(absolutePath),
      `${label} parent directory`
    ).target;
    return readNoFollowOrdinaryFile(parent, path.basename(absolutePath));
  } catch (error) {
    if (error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_ABSENT') {
      return null;
    }
    throw error;
  }
}
export function decodeExactAuthorityUtf8(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error(`${label} is not exact UTF-8`, { cause: error });
  }
}
