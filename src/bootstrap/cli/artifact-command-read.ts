import type { JsonOpts } from '../../entry/cli/command-options.ts';
import { printJsonOrText } from '../../entry/cli/format-utils.ts';
import { readRequiredJson } from '../../adapters/workspace/required-artifact-read.ts';
import { readGeneratedContract } from '../../adapters/workspace/generated-contract-read.ts';

export async function printRequiredJson<T>(
  filePath: string, missingMessage: string, output: JsonOpts, formatText: (v: T) => string
): Promise<void> {
  const value = await readRequiredJson<T>(filePath, missingMessage);
  printJsonOrText(value, output, formatText);
}

export async function printWorkspaceJson<T>(
  cwd: string, selectPath: (workspaceRoot: string) => string,
  missingMessage: string, output: JsonOpts, formatText: (v: T) => string
): Promise<void> {
  await printRequiredJson<T>(selectPath(cwd), missingMessage, output, formatText);
}

export async function printGeneratedContract<T>(
  workspaceRoot: string,
  missingMessage: string,
  output: JsonOpts,
  formatText: (value: T) => string,
  matches: (value: T) => boolean
): Promise<void> {
  const value = await readGeneratedContract(workspaceRoot, missingMessage, matches);
  printJsonOrText(value, output, formatText);
}
