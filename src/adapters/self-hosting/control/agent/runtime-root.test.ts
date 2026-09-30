import { expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { inGitProtocolRepository } from '../../../../../tests/testkit/git-protocol.ts';
import { rawSha256 } from '../../../../contracts/canonical.ts';
import { resolveAgentRuntimeRepositoryRoot } from './runtime-root.ts';

const repositoryRoot = path.resolve(import.meta.dir, '../../../../..');
// The harness must outlive the 10s child deadline plus fixture/stream settlement.
const processTestTimeoutMs = 30_000;

async function run(args: string[], cwd = repositoryRoot) {
  const child = Bun.spawn(args, { cwd, stdout: 'pipe', stderr: 'pipe', timeout: 10_000 });
  const stdoutResult = new Response(child.stdout).text();
  const stderrResult = new Response(child.stderr).text();
  try {
    const [stdout, stderr, code] = await Promise.all([stdoutResult, stderrResult, child.exited]);
    return { stdout, stderr, code };
  } finally {
    // A stream failure must still join the child before the fixture can be removed.
    if (child.exitCode === null) child.kill('SIGKILL');
    await Promise.allSettled([stdoutResult, stderrResult, child.exited]);
  }
}

// This is host read/entry evidence, not operation activation or provider permission.
test.skipIf(process.platform !== 'linux')('loaded agent owner resolves the actual Git worktree rather than fixed parent hops', async () => {
  expect(await resolveAgentRuntimeRepositoryRoot()).toBe(repositoryRoot);
  const result = await run([process.execPath, '--eval',
    `console.log(await (await import(${JSON.stringify(new URL('./runtime-root.ts', import.meta.url).href)})).resolveAgentRuntimeRepositoryRoot())`
  ], tmpdir());
  expect(result.code, result.stderr).toBe(0);
  expect(result.stdout.trim()).toBe(repositoryRoot);
}, processTestTimeoutMs);

for (const [entry, option] of [['task-capsule-host.ts', '--capsule'], ['operation-read-plan.ts', '--plan']] as const) {
  test.skipIf(process.platform !== 'linux')(`${entry} resolves relative inputs from its real repository before content validation`, async () => {
    const result = await run([process.execPath, path.join(import.meta.dir, entry), 'verify', option, 'package.json']);
    expect(result.code).toBe(2);
    expect(result.stderr).not.toContain('must be inline JSON or one readable JSON file');
    expect(result.stderr).toMatch(/schema|keys|unsupported/iu);
  }, processTestTimeoutMs);
}

test.skipIf(process.platform !== 'linux')('skill CLI reaches invalid Read Plan refusal from the actual repository root', async () => {
  const result = await run([process.execPath, path.join(import.meta.dir, 'skill-applicability.ts'),
    '--read-plan', '{}', '--candidate-root', repositoryRoot]);
  expect(result.code).toBe(2);
  expect(result.stderr).toContain('Read Plan verification failed');
  expect(result.stderr).not.toContain('must be invoked from the exact trusted-runtime repository root');
}, processTestTimeoutMs);

for (const command of ['request', 'observe'] as const) {
  test.skipIf(process.platform !== 'linux')(`activation ${command} checks foreign candidate identity before any hosted authority`, async () => {
    await inGitProtocolRepository(async (candidate) => {
      const args = command === 'request' ? ['--phase', 'prepare'] : ['--request-id', `sha256:${'a'.repeat(64)}`];
      const result = await run([process.execPath, path.join(import.meta.dir, 'agent-operation-activation.ts'),
        command, ...args, '--candidate-root', candidate, '--json']);
      expect(result.code).toBe(2);
      expect(JSON.parse(result.stderr)).toMatchObject({
        reasonCode: 'activation-stale', blockerDigest: rawSha256('candidate-repository-mismatch')
      });
    });
  }, processTestTimeoutMs);
}
