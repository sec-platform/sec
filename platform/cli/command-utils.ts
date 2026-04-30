import { pathExists, readJson } from '../shared/fs.ts';
import { printJsonOrText } from './format-utils.ts';

type JsonTextOutputOptions = { json: boolean; compact: boolean };

export async function readRequiredJson<T>(filePath: string, missingMessage: string): Promise<T> {
  if (!(await pathExists(filePath))) {
    throw new Error(missingMessage);
  }
  return readJson<T>(filePath);
}

export async function printRequiredJson<T>(
  filePath: string,
  missingMessage: string,
  outputArgs: JsonTextOutputOptions,
  formatText: (value: T) => string
): Promise<void> {
  const value = await readRequiredJson<T>(filePath, missingMessage);
  printJsonOrText(value, outputArgs, formatText);
}
