import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';

export async function calculateProjectFileHash(absolutePath: string): Promise<string | undefined> {
  try {
    const content = await fs.readFile(absolutePath);
    return createHash('sha256').update(content).digest('hex');
  } catch {
    return undefined;
  }
}
