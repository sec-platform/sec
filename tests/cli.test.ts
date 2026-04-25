import { expect, test } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { compilerRoot } from '../platform/shared/paths.ts';

function runCli(workspaceRoot: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(compilerRoot, 'platform', 'cli', 'index.ts'), ...args], {
      cwd: workspaceRoot,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8')
      });
    });
  });
}

async function withTempWorkspace<T>(callback: (workspaceRoot: string) => Promise<T>): Promise<T> {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'engineering-compiler-cli-'));
  try {
    return await callback(workspaceRoot);
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
}

test('CLI prints usage for missing or unknown commands', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await expect(runCli(workspaceRoot, [])).resolves.toMatchObject({
      code: 0,
      stdout: 'Usage: node platform/cli/index.ts <init|add|resolve|compose|adapt|verify|repair|upgrade|lock|explain>\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['unknown'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Usage: node platform/cli/index.ts <init|add|resolve|compose|adapt|verify|repair|upgrade|lock|explain>\n',
      stderr: ''
    });
    await expect(runCli(workspaceRoot, ['unknown', '--flag'])).resolves.toMatchObject({
      code: 0,
      stdout: 'Usage: node platform/cli/index.ts <init|add|resolve|compose|adapt|verify|repair|upgrade|lock|explain>\n',
      stderr: ''
    });
  });
});

test('CLI reports argument usage errors', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await expect(runCli(workspaceRoot, ['add'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: 'UNEXPECTED Usage: platform add <block-id>\n'
    });
    await expect(runCli(workspaceRoot, ['upgrade', 'entity/customer-basic'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: 'UNEXPECTED Usage: platform upgrade <block-id> <target-version>\n'
    });
    await expect(runCli(workspaceRoot, ['upgrade', 'entity/customer-basic', '0.2.0', '--extra'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: 'UNEXPECTED Usage: platform upgrade <block-id> <target-version>\n'
    });
    await expect(runCli(workspaceRoot, ['verify', '--lane', 'slow'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: 'UNEXPECTED Usage: platform verify [--lane fast|runtime|all]\n'
    });
    await expect(runCli(workspaceRoot, ['verify', '--lane'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: 'UNEXPECTED Usage: platform verify [--lane fast|runtime|all]\n'
    });
    await expect(runCli(workspaceRoot, ['verify', 'fast'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: 'UNEXPECTED Usage: platform verify [--lane fast|runtime|all]\n'
    });
    await expect(runCli(workspaceRoot, ['verify', '--lane', 'fast', '--extra'])).resolves.toMatchObject({
      code: 1,
      stdout: '',
      stderr: 'UNEXPECTED Usage: platform verify [--lane fast|runtime|all]\n'
    });
  });
});
