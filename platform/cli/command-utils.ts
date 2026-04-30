import { pathExists, readJson } from '../shared/fs.ts';
import { getWorkspacePaths } from '../shared/paths.ts';
import { printJsonOrText } from './format-utils.ts';

type JsonTextOutputOptions = { json: boolean; compact: boolean };
type WorkspacePaths = ReturnType<typeof getWorkspacePaths>;

export function requireSubcommand(args: string[], expected: string, usage: string): string[] {
  if (args[0] !== expected) {
    throw new Error(usage);
  }
  return args.slice(1);
}

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

export async function printRequiredWorkspaceJson<T>(
  cwd: string,
  selectPath: (paths: WorkspacePaths) => string,
  missingMessage: string,
  outputArgs: JsonTextOutputOptions,
  formatText: (value: T) => string
): Promise<void> {
  await printRequiredJson<T>(selectPath(getWorkspacePaths(cwd)), missingMessage, outputArgs, formatText);
}
