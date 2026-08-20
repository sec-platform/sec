import path from 'node:path';

import {
  inspectNoFollowDirectoryChainV1,
  PhysicalNoFollowError,
  readNoFollowOrdinaryFileV1
} from '../../shared/physical-no-follow.ts';

export function readOptionalAuthorityBytes(
  filePath: string,
  label: string
): Uint8Array | null {
  const absolutePath = path.resolve(filePath);
  try {
    const parent = inspectNoFollowDirectoryChainV1(
      path.dirname(absolutePath),
      `${label} parent directory`
    ).target;
    return readNoFollowOrdinaryFileV1(parent, path.basename(absolutePath));
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

export function readOptionalAuthorityUtf8(
  filePath: string,
  label: string
): string | null {
  const bytes = readOptionalAuthorityBytes(filePath, label);
  return bytes === null ? null : decodeExactAuthorityUtf8(bytes, label);
}
