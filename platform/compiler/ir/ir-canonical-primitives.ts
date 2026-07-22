import { createHash } from 'node:crypto';
import path from 'node:path';

export function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function normalizedArtifactTarget(target: string): string {
  return path.posix.normalize(target.replaceAll('\\', '/'));
}
