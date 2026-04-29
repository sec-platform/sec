import { pathExists, readJson } from '../shared/fs.ts';

export async function readRequiredJson<T>(filePath: string, missingMessage: string): Promise<T> {
  if (!(await pathExists(filePath))) {
    throw new Error(missingMessage);
  }
  return readJson<T>(filePath);
}
