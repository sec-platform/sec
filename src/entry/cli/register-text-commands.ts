import type { Command } from 'commander';

import { addJsonFlags, jsonOpts, usageError, type JsonOpts } from './command-options.ts';
import { printJsonOrText } from './format-utils.ts';

export type TextCensusThresholdAdmission =
  | Readonly<{ status: 'accepted'; threshold: string | undefined }>
  | Readonly<{ status: 'rejected'; expected: readonly string[] }>;

export type TextCensusProjection = Readonly<{
  value: unknown;
  text: string;
  thresholdMatched: boolean;
}>;

export interface TextCommandOperations {
  admitThreshold(value: string | undefined): TextCensusThresholdAdmission;
  runCensus(
    workspaceRoot: string,
    threshold: string | undefined
  ): Promise<TextCensusProjection>;
  progress<T>(
    text: string,
    output: JsonOpts,
    operation: () => Promise<T>
  ): Promise<T>;
}

export interface TextCommandHandlers {
  census(context: Readonly<{
    workspaceRoot: string;
    output: JsonOpts;
    failOn: string | undefined;
  }>): Promise<void>;
}

export function bindTextCommandHandlers(
  operations: TextCommandOperations
): TextCommandHandlers {
  if (typeof operations.admitThreshold !== 'function' ||
      typeof operations.runCensus !== 'function' ||
      typeof operations.progress !== 'function') {
    throw new TypeError('Text census command operations must be callable');
  }
  return Object.freeze({
    census: async ({ workspaceRoot, output, failOn }) => {
      const admission = operations.admitThreshold.call(operations, failOn);
      if (admission.status === 'rejected') {
        throw usageError(
          `Text census --fail-on must be any or one of: ${admission.expected.join(', ')}`
        );
      }
      const result = await operations.progress.call(
        operations,
        'Scanning text bytes',
        output,
        () => operations.runCensus.call(
          operations,
          workspaceRoot,
          admission.threshold
        )
      );
      printJsonOrText(result.value, output, () => result.text);
      if (result.thresholdMatched && admission.threshold !== undefined) {
        throw new Error(
          `Text census --fail-on ${admission.threshold} threshold matched.`
        );
      }
    }
  });
}

/** Entry owns text-inspection command grammar and raw option capture. */
export function registerTextCommands(
  program: Command,
  handlers: TextCommandHandlers
): void {
  if (typeof handlers.census !== 'function') {
    throw new TypeError('Text census command handler must be callable');
  }

  const text = program
    .command('text')
    .description('Text byte policy inspection');

  addJsonFlags(text.command('census'))
    .description('Scan tracked Git blobs and classify by .gitattributes policy')
    .option(
      '--fail-on <threshold>',
      'Exit non-zero for any fail-closed result or one classification'
    )
    .action(async (rawOptions: Record<string, unknown>) => {
      await handlers.census({
        workspaceRoot: process.cwd(),
        output: jsonOpts(rawOptions),
        failOn: typeof rawOptions.failOn === 'string'
          ? rawOptions.failOn
          : undefined
      });
    });
}
