import { expect, test } from 'bun:test';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

import { expectCliSuccess } from '../testkit/cli.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

const cliEntrypoint = path.resolve(import.meta.dir, '../../src/bootstrap/cli/cli.ts');
const internalFailureEntrypoint = path.resolve(import.meta.dir, '../helpers/cli-entry-internal-failure.ts');

// Native Commander termination is part of this contract; do not replace it
// with an in-process parser or a test-owned error/help implementation.
function runEntry(workspaceRoot: string, args: readonly string[], internalFailure = false) {
  const options = {
    cwd: workspaceRoot,
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
    stdout: 'pipe' as const,
    stderr: 'pipe' as const,
    timeout: 5_000,
    maxBuffer: 1024 * 1024
  };
  const result = internalFailure
    ? Bun.spawnSync([process.execPath, '--no-env-file', internalFailureEntrypoint, ...args], options)
    : Bun.spawnSync([process.execPath, '--no-env-file', cliEntrypoint, ...args], options);
  expect(result.signalCode).toBeUndefined();
  expect(result.exitedDueToTimeout).not.toBe(true);
  expect(result.exitedDueToMaxBuffer).not.toBe(true);
  return { status: result.exitCode, stdout: result.stdout.toString('utf8'), stderr: result.stderr.toString('utf8') };
}

// reportCliFailure emits one compact protocol frame, followed by optional
// separately formatted details. A code-bearing frame must satisfy the entire
// presentation contract; malformed or duplicate frames are failures.
function errorProtocol(stderr: string): Record<string, unknown> {
  const frames = stderr.split('\n').flatMap((line) => {
    if (!line.startsWith('{') || !line.endsWith('}')) return [];
    const value: unknown = JSON.parse(line);
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      && Object.hasOwn(value, 'code') ? [value as Record<string, unknown>] : [];
  });
  expect(frames).toHaveLength(1);
  const protocol = frames[0]!;
  expect(Object.keys(protocol).sort()).toEqual([
    'artifactPaths', 'code', 'issueType', 'message', 'recoverable', 'suggestedActions'
  ]);
  expect(typeof protocol.code).toBe('string');
  expect(typeof protocol.message).toBe('string');
  expect(typeof protocol.recoverable).toBe('boolean');
  expect(['usage', 'spec', 'composition', 'kernel']).toContain(protocol.issueType as string);
  for (const field of ['suggestedActions', 'artifactPaths']) {
    expect(Array.isArray(protocol[field])).toBe(true);
    expect((protocol[field] as unknown[]).every((value) => typeof value === 'string')).toBe(true);
  }
  expect(stderr).toContain(`${protocol.code} ${protocol.message}`);
  return protocol;
}

test('CLI prints its real help for missing commands', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const result = runEntry(workspaceRoot, []);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    await expectCliSuccess(workspaceRoot, ['--help']);
    for (const marker of ['Usage: sec', 'init', 'resolve', 'compose', 'verify']) {
      expect(result.stdout).toContain(marker);
    }
    expect(await readdir(workspaceRoot)).toEqual([]);
  });
}, 10_000);

for (const args of [['unknown'], ['unknown', '--flag']]) {
  test(`CLI rejects unknown invocation: ${args.join(' ')}`, async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const result = runEntry(workspaceRoot, args);
      expect(result.status).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toMatch(/^error: /);
      expect(result.stderr).toContain(args.at(-1)!);
      await expect(expectCliSuccess(workspaceRoot, args)).rejects.toThrow('CLI exited with code 1');
      expect(await readdir(workspaceRoot)).toEqual([]);
    });
  }, 10_000);
}

const usageCases = [
  { args: ['init', '--unknown'], diagnostic: "unknown option '--unknown'" },
  { args: ['add'], diagnostic: "missing required argument 'block-id'" },
  { args: ['repair', '--extra'], diagnostic: "unknown option '--extra'" },
  { args: ['upgrade'], diagnostic: 'Usage: sec upgrade', protocol: true },
  { args: ['verify', '--lane', 'slow'], diagnostic: 'Lane must be', protocol: true },
  { args: ['resolve', '--extra'], diagnostic: "unknown option '--extra'" },
  { args: ['compose', '--extra'], diagnostic: "unknown option '--extra'" },
  { args: ['lock', '--extra'], diagnostic: "unknown option '--extra'" },
  { args: ['explain', '--extra'], diagnostic: "unknown option '--extra'" },
  { args: ['doctor', '--extra'], diagnostic: "unknown option '--extra'" }
];

for (const { args, diagnostic, protocol } of usageCases) {
  test(`CLI reports the argument error for ${args.join(' ')}`, async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const result = runEntry(workspaceRoot, args);
      expect(result.status).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain(diagnostic);
      if (protocol) {
        expect(errorProtocol(result.stderr)).toMatchObject({
          code: 'CLI-USAGE-001', issueType: 'usage', recoverable: true
        });
      } else {
        expect(result.stderr).toMatch(/^error: /);
      }
      expect(await readdir(workspaceRoot)).toEqual([]);
    });
  }, 10_000);
}

test('CLI preserves an unexpected handler failure as a kernel error', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const result = runEntry(workspaceRoot, ['fail'], true);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(errorProtocol(result.stderr)).toMatchObject({
      code: 'UNEXPECTED', issueType: 'kernel', recoverable: false,
      message: 'usage-contract-internal-failure'
    });
    expect(await readdir(workspaceRoot)).toEqual([]);
  });
}, 10_000);
