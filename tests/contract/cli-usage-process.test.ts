import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import packageMetadata from '../../package.json' with { type: 'json' };
import { createRawTestExecutableFixture } from '../testkit/raw-process.ts';

const entry = fileURLToPath(new URL('../../src/bootstrap/cli/cli.ts', import.meta.url));

// This observes the production composition and actual process streams, not the
// in-process fixture's separate Commander registration and failure handler.
async function invoke(args: readonly string[]) {
  const cwd = await mkdtemp(path.join(tmpdir(), 'sec-cli-usage-'));
  try {
    const executable = createRawTestExecutableFixture();
    try {
      const child = Bun.spawn([executable.command, 'run', '--no-env-file', entry, ...args], {
        cwd, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, FORCE_COLOR: '1' },
        timeout: 5_000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024
      });
      const stdout = new Response(child.stdout).text();
      const stderr = new Response(child.stderr).text();
      try {
        const [code, out, err] = await Promise.all([child.exited, stdout, stderr]);
        return { code, stdout: out, stderr: err };
      } finally {
        if (child.exitCode === null) child.kill('SIGKILL');
        await child.exited;
        await Promise.allSettled([stdout, stderr]);
      }
    } finally {
      executable.dispose();
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

for (const args of [
  ['not-a-sec-command', '--json'],
  ['add', '--json', '--compact'],
  ['verify', '--unsupported', '--json', '--compact'],
  ['init', '--json']
]) {
  test(`production CLI rejects ${args.join(' ')} as one safe machine usage result`, async () => {
    const result = await invoke(args);
    expect(result.code).toBe(2);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual({
      code: 'CLI-USAGE-001', message: 'Invalid command arguments',
      recoverable: true, issueType: 'usage',
      suggestedActions: ['retry-with-supported-arguments'], artifactPaths: []
    });
    expect(result.stdout).not.toContain('\u001b');
    if (args.includes('--compact')) expect(result.stdout.trimEnd()).not.toContain('\n');
  }, 10_000);
}

for (const args of [[], ['--help'], ['verify', '--help'], ['verify', '--version']]) {
  test(`production CLI preserves successful ${args.join(' ') || 'root help'}`, async () => {
    const result = await invoke(args);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    if (args.includes('--version')) expect(result.stdout.trim()).toBe(packageMetadata.version);
    else expect(result.stdout).toContain('Usage: sec');
  }, 10_000);
}

for (const args of [
  ['not-a-sec-command', '--', '--json'],
  ['verify', '--lane', '--json', '--unsupported']
]) {
  test(`production parser does not treat a value as a JSON flag: ${args.join(' ')}`, async () => {
    const result = await invoke(args);
    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('CLI-USAGE-001');
  }, 10_000);
}
