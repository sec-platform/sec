import { isUtf8 } from 'node:buffer';
import fs from 'node:fs/promises';

import { digest } from './canonical-primitives.ts';

export async function calculateProjectFileHash(absolutePath: string): Promise<string | undefined> {
  try {
    const content = await fs.readFile(absolutePath);
    return digest(content);
  } catch {
    return undefined;
  }
}

export async function calculateCanonicalProjectFileHash(absolutePath: string): Promise<string | undefined> {
  try {
    const content = await fs.readFile(absolutePath);
    const canonicalContent = isUtf8(content)
      ? content.toString('utf8').replace(/\r\n?/g, '\n')
      : content;
    return digest(canonicalContent);
  } catch {
    return undefined;
  }
}
