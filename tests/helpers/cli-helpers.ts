import { expect } from 'vitest';
import { Command } from 'commander';

import { registerCommands } from '../../platform/cli/register-commands.ts';
import { buildErrorProtocol } from '../../platform/shared/error-protocol.ts';
import { expectContainsAll } from './assertion-helpers.ts';

export type CliResult = { code: number; stdout: string; stderr: string };

function createProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.name('platform');
  program.allowUnknownOption(false);
  registerCommands(program);
  return program;
}

export async function expectCliSuccess(
  workspaceRoot: string,
  args: string[],
  expectedStdout?: string
): Promise<CliResult> {
  const result = await runCliInProcess(workspaceRoot, args);
  expect(result.code).toBe(0);
  expect(result.stderr).toBe('');
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

export async function runCliPipeline(
  workspaceRoot: string,
  options: { init?: boolean; verifyLane?: 'fast' | 'all'; lock?: boolean; explain?: boolean } = {}
): Promise<void> {
  if (options.init !== false) {
    await expectCliSuccess(workspaceRoot, ['init', '--reset'], 'Initialized project workspace\n');
  }
  await expectCliSuccess(workspaceRoot, ['resolve'], 'Resolved 3 blocks\n');
  await expectCliSuccess(workspaceRoot, ['compose'], 'Composed project\n');
  await expectCliSuccess(workspaceRoot, ['adapt'], 'Adapted slots\n');
  if (options.verifyLane) {
    const verification = await expectCliSuccess(workspaceRoot, ['verify', '--lane', options.verifyLane]);
    expect(verification.stdout).toContain(`Verification passed (${options.verifyLane})`);
  }
  if (options.lock) {
    await expectCliSuccess(workspaceRoot, ['lock'], 'Locked project\n');
  }
  if (options.explain) {
    await expectCliSuccess(workspaceRoot, ['explain']);
  }
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

export async function runCliInProcess(workspaceRoot: string, args: string[]): Promise<CliResult> {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;
  const originalCwd = process.cwd;

  console.log = (...chunks: unknown[]) => { stdoutChunks.push(`${chunks.map(String).join(' ')}\n`); };
  console.error = (...chunks: unknown[]) => { stderrChunks.push(`${chunks.map(String).join(' ')}\n`); };
  console.warn = (...chunks: unknown[]) => { stderrChunks.push(`${chunks.map(String).join(' ')}\n`); };
  process.cwd = () => workspaceRoot;

  try {
    const program = createProgram();
    await program.parseAsync(['node', 'platform', ...args], { from: 'user' });
    return { code: 0, stdout: stdoutChunks.join(''), stderr: stderrChunks.join('') };
  } catch (error: unknown) {
    const failure = error as { code?: string; message?: string; details?: unknown };
    if (failure.code === 'commander.help' || failure.code === 'commander.helpDisplayed') {
      return { code: 0, stdout: stdoutChunks.join(''), stderr: stderrChunks.join('') };
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
    return { code: 1, stdout: stdoutChunks.join(''), stderr: stderrChunks.join('') };
  } finally {
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
    process.cwd = originalCwd;
  }
}
