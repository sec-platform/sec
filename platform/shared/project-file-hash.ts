import { createHash } from 'node:crypto';
import { isUtf8 } from 'node:buffer';
import fs from 'node:fs/promises';

export async function calculateProjectFileHash(absolutePath: string): Promise<string | undefined> {
  try {
    const content = await fs.readFile(absolutePath);
    return createHash('sha256').update(content).digest('hex');
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
    return createHash('sha256').update(canonicalContent).digest('hex');
  } catch {
    return undefined;
  }
}
