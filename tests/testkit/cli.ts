import { expect } from 'bun:test';
import { Command } from 'commander';
import { AsyncLocalStorage } from 'node:async_hooks';

import { buildErrorProtocol } from '../../src/bootstrap/engineering/error-protocol.ts';
import type { CompilerErrorDetails } from '../../src/compiler/errors.ts';
import {
  registerCommands,
  type CliCommandDomainLoaders
} from '../../src/bootstrap/cli/register-commands.ts';

function normalizeCliStderr(stderr: string): string {
  return stderr
    .split('\n')
    .filter((line) => line.trim() !== '[ora] Multiple concurrent spinners detected. This may cause visual corruption. Use one spinner at a time.')
    .join('\n')
    .trimEnd();
}

function expectContainsAll(source: string, fragments: readonly string[]): void {
  for (const fragment of fragments) {
    expect(source).toContain(fragment);
  }
}

export type CliResult = { code: number; stdout: string; stderr: string };
export type CliRunOptions = Readonly<{ domainLoaders?: CliCommandDomainLoaders }>;

type CliContext = { stdoutChunks: string[]; stderrChunks: string[]; cwd: string };

const cliContext = new AsyncLocalStorage<CliContext>();
const originalLog = console.log.bind(console);
const originalError = console.error.bind(console);
const originalWarn = console.warn.bind(console);
const originalCwd = process.cwd.bind(process);
let cliContextGlobalsInstalled = false;

function formatConsoleChunks(chunks: unknown[]): string {
  return `${chunks.map(String).join(' ')}\n`;
}

function installCliContextGlobals(): void {
  if (cliContextGlobalsInstalled) return;

  console.log = (...chunks: unknown[]) => {
    const context = cliContext.getStore();
    if (context) {
      context.stdoutChunks.push(formatConsoleChunks(chunks));
      return;
    }
    originalLog(...chunks);
  };
  console.error = (...chunks: unknown[]) => {
    const context = cliContext.getStore();
    if (context) {
      context.stderrChunks.push(formatConsoleChunks(chunks));
      return;
    }
    originalError(...chunks);
  };
  console.warn = (...chunks: unknown[]) => {
    const context = cliContext.getStore();
    if (context) {
      context.stderrChunks.push(formatConsoleChunks(chunks));
      return;
    }
    originalWarn(...chunks);
  };
  process.cwd = () => cliContext.getStore()?.cwd ?? originalCwd();

  cliContextGlobalsInstalled = true;
}

function runWithCliContext<T>(context: CliContext, fn: () => Promise<T>): Promise<T> {
  installCliContextGlobals();
  return cliContext.run(context, fn);
}

function createProgram(
  output: { stdoutChunks: string[]; stderrChunks: string[] },
  options: CliRunOptions
): Command {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({
    writeOut: (value) => { output.stdoutChunks.push(value); },
    writeErr: (value) => { output.stderrChunks.push(value); }
  });
  program.name('platform');
  program.allowUnknownOption(false);
  registerCommands(program, options.domainLoaders ?? {});
  program.action(() => {
    program.help();
  });
  return program;
}

export async function expectCliSuccess(
  workspaceRoot: string,
  args: string[],
  expectedStdout?: string
): Promise<CliResult> {
  const result = await runCliInProcess(workspaceRoot, args);
  if (result.code !== 0) {
    throw new Error([
      `CLI exited with code ${result.code}: ${args.join(' ')}`,
      `stdout:\n${result.stdout}`,
      `stderr:\n${result.stderr}`
    ].join('\n'));
  }
  expect(result.code).toBe(0);
  expect(normalizeCliStderr(result.stderr)).toBe('');
  if (expectedStdout !== undefined) {
    expect(result.stdout).toBe(expectedStdout);
  }
  return result;
}

export async function expectCliText(
  workspaceRoot: string,
  args: string[],
  expectedMarkers: readonly string[]
): Promise<CliResult> {
  const result = await expectCliSuccess(workspaceRoot, args);
  expectContainsAll(result.stdout, expectedMarkers);
  return result;
}

type CliJsonOptions = {
  compact?: boolean;
  stdoutMarkers?: readonly string[];
};

export async function expectCliJson<T = unknown>(
  workspaceRoot: string,
  args: string[],
  expected?: object,
  options: CliJsonOptions = {}
): Promise<T> {
  const result = await expectCliSuccess(workspaceRoot, args);
  if (options.compact === true) {
    expect(result.stdout.trim()).not.toContain('\n');
  }
  if (options.stdoutMarkers !== undefined) {
    expectContainsAll(result.stdout, options.stdoutMarkers);
  }
  const payload = JSON.parse(result.stdout) as T;
  if (expected !== undefined) {
    expect(payload).toMatchObject(expected);
  }
  return payload;
}

type CliVariantExpectations = {
  text: readonly string[];
  json?: object;
  compactJson?: object;
  jsonStdoutMarkers?: readonly string[];
  compactJsonStdoutMarkers?: readonly string[];
};

export async function expectCliVariants<TJson = unknown, TCompactJson = unknown>(
  workspaceRoot: string,
  args: string[],
  expectations: CliVariantExpectations
): Promise<{ text: CliResult; json: TJson; compactJson: TCompactJson }> {
  const text = await expectCliText(workspaceRoot, args, expectations.text);
  const json = await expectCliJson<TJson>(workspaceRoot, [...args, '--json'], expectations.json, {
    stdoutMarkers: expectations.jsonStdoutMarkers
  });
  const compactJson = await expectCliJson<TCompactJson>(
    workspaceRoot,
    [...args, '--json', '--compact'],
    expectations.compactJson ?? expectations.json,
    {
      compact: true,
      stdoutMarkers: expectations.compactJsonStdoutMarkers
    }
  );
  return { text, json, compactJson };
}


export async function expectCliUsageError(
  workspaceRoot: string,
  command: string,
  args: string[],
  _usage: string
): Promise<void> {
  const result = await runCliInProcess(workspaceRoot, [command, ...args]);
  expect(result.code).toBe(1);
}

function isUnknownRootCommand(program: Command | undefined, args: string[]): boolean {
  const commandName = args[0];
  return commandName !== undefined
    && !commandName.startsWith('-')
    && !program?.commands.some((command) => command.name() === commandName);
}

export async function runCliInProcess(
  workspaceRoot: string,
  args: string[],
  options: CliRunOptions = {}
): Promise<CliResult> {
  const context: CliContext = { stdoutChunks: [], stderrChunks: [], cwd: workspaceRoot };

  return runWithCliContext(context, async () => {
    let program: Command | undefined;
    try {
      program = createProgram(context, options);
      await program.parseAsync(args, { from: 'user' });
      return { code: 0, stdout: context.stdoutChunks.join(''), stderr: context.stderrChunks.join('') };
    } catch (error: unknown) {
      const failure = error as { code?: string; message?: string; details?: CompilerErrorDetails };
      if (failure.code === 'commander.help' || failure.code === 'commander.helpDisplayed') {
        return { code: 0, stdout: context.stdoutChunks.join(''), stderr: context.stderrChunks.join('') };
      }
      if (failure.code === 'commander.unknownCommand' || isUnknownRootCommand(program, args)) {
        context.stdoutChunks.length = 0;
        context.stderrChunks.length = 0;
        program?.outputHelp();
        return { code: 0, stdout: context.stdoutChunks.join(''), stderr: context.stderrChunks.join('') };
      }
      const protocol = buildErrorProtocol(failure);
      console.error(protocol.code, protocol.message);
      console.error(JSON.stringify({
        code: protocol.code,
        message: protocol.message,
        recoverable: protocol.recoverable,
        issueType: protocol.issueType,
        suggestedActions: protocol.suggestedActions,
        artifactPaths: protocol.artifactPaths
      }));
      if (protocol.details) {
        console.error(JSON.stringify(protocol.details, null, 2));
      }
      return { code: 1, stdout: context.stdoutChunks.join(''), stderr: context.stderrChunks.join('') };
    }
  });
}
