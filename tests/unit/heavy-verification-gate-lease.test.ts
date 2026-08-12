import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import {
  acquireHeavyVerificationGateLease
} from '../../platform/shared/heavy-verification-gate-lease.ts';
import { compilerRoot } from '../../platform/shared/paths.ts';

const TOKEN_A = '11111111111111111111111111111111';
const TOKEN_B = '22222222222222222222222222222222';

async function withLockRoot(callback: (lockPath: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-heavy-gate-'));
  try {
    await callback(path.join(root, 'gate'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('heavy verification gate rejects a second live owner and releases exact ownership', async () => {
  await withLockRoot(async (lockPath) => {
    const first = await acquireHeavyVerificationGateLease({
      gateId: 'test:affected',
      isProcessAlive: () => true,
      lockPath,
      ownerHost: 'test-host',
      ownerPid: 101,
      token: TOKEN_A
    });
    await expect(acquireHeavyVerificationGateLease({
      gateId: 'ci:risk',
      isProcessAlive: () => true,
      lockPath,
      ownerHost: 'test-host',
      ownerPid: 202,
      token: TOKEN_B
    })).rejects.toThrow('test:affected is already active');
    await first.release();
    const second = await acquireHeavyVerificationGateLease({
      gateId: 'ci:risk',
      isProcessAlive: () => true,
      lockPath,
      ownerHost: 'test-host',
      ownerPid: 202,
      token: TOKEN_B
    });
    await second.release();
    expect(await readFile(lockPath, 'utf8').catch(() => 'missing')).toBe('missing');
  });
});

test('heavy verification gate atomically reclaims a dead owner', async () => {
  await withLockRoot(async (lockPath) => {
    await mkdir(lockPath);
    await writeFile(path.join(lockPath, 'owner.json'), `${JSON.stringify({
      command: ['bun', 'run', 'test:affected'],
      gateId: 'test:affected',
      host: 'test-host',
      pid: 101,
      startedAt: '2026-07-26T00:00:00.000Z',
      token: TOKEN_A
    })}\n`);
    const lease = await acquireHeavyVerificationGateLease({
      gateId: 'ci:risk',
      isProcessAlive: () => false,
      lockPath,
      ownerHost: 'test-host',
      ownerPid: 202,
      token: TOKEN_B
    });
    expect(lease.owner.gateId).toBe('ci:risk');
    await lease.release();
  });
});

test('heavy verification gate never removes a successor owner during release', async () => {
  await withLockRoot(async (lockPath) => {
    const lease = await acquireHeavyVerificationGateLease({
      gateId: 'test:affected',
      isProcessAlive: () => true,
      lockPath,
      ownerHost: 'test-host',
      ownerPid: 101,
      token: TOKEN_A
    });
    const ownerPath = path.join(lockPath, 'owner.json');
    const owner = JSON.parse(await readFile(ownerPath, 'utf8')) as Record<string, unknown>;
    await writeFile(ownerPath, `${JSON.stringify({ ...owner, token: TOKEN_B })}\n`);
    await expect(lease.release()).rejects.toThrow('ownership was lost');
    expect(JSON.parse(await readFile(ownerPath, 'utf8'))).toMatchObject({ token: TOKEN_B });
  });
});

test('heavy verification gate never reclaims an owner from another host', async () => {
  await withLockRoot(async (lockPath) => {
    await mkdir(lockPath);
    await writeFile(path.join(lockPath, 'owner.json'), `${JSON.stringify({
      command: ['bun', 'run', 'test:affected'],
      gateId: 'test:affected',
      host: 'foreign-host',
      pid: 101,
      startedAt: '2026-07-26T00:00:00.000Z',
      token: TOKEN_A
    })}\n`);
    await expect(acquireHeavyVerificationGateLease({
      gateId: 'ci:risk',
      isProcessAlive: () => false,
      lockPath,
      ownerHost: 'test-host',
      ownerPid: 202,
      token: TOKEN_B
    })).rejects.toThrow('is owned by another host');
    expect(JSON.parse(await readFile(path.join(lockPath, 'owner.json'), 'utf8')))
      .toMatchObject({ host: 'foreign-host', token: TOKEN_A });
  });
});

test('affected and Risk CLI entrypoints share the same outer heavy-gate owner', async () => {
  const [devRunnerSource, riskSource, leaseSource] = await Promise.all([
    readFile(path.join(compilerRoot, 'platform/dev-runner.ts'), 'utf8')
      .then((source) => source.replaceAll('\r\n', '\n')),
    readFile(path.join(compilerRoot, 'scripts/ci-pr-risk.ts'), 'utf8')
      .then((source) => source.replaceAll('\r\n', '\n')),
    readFile(
      path.join(compilerRoot, 'platform/shared/heavy-verification-gate-lease.ts'),
      'utf8'
    ).then((source) => source.replaceAll('\r\n', '\n'))
  ]);
  expect(devRunnerSource).toContain(
    "withHeavyVerificationGateLease(\n      'test:affected',\n      () => runAffectedTests(args)"
  );
  const affectedEntryIndex = devRunnerSource.indexOf("if (target === 'test:affected')");
  const planBypassIndex = devRunnerSource.indexOf("if (args.length === 1 && args[0] === '--plan')");
  const leaseIndex = devRunnerSource.indexOf("withHeavyVerificationGateLease(\n      'test:affected'");
  expect(affectedEntryIndex).toBeGreaterThanOrEqual(0);
  expect(planBypassIndex).toBeGreaterThan(affectedEntryIndex);
  expect(leaseIndex).toBeGreaterThan(planBypassIndex);
  expect(devRunnerSource.slice(planBypassIndex, leaseIndex)).toContain(
    'process.exitCode = await runAffectedTests(args);'
  );
  expect(riskSource).toContain(
    "withHeavyVerificationGateLease('ci:risk', () => CodexDevelopmentCiPrRiskMain())"
  );
  expect(leaseSource).toContain("Global\\\\sec-heavy-verification-gate-");
  expect(leaseSource).toContain('WINDOWS_WAIT_ABANDONED_0');
});
