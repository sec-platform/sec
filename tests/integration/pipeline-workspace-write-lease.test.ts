import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { initWorkspace } from '../../src/bootstrap/engineering/cli.ts';
import { withMonitoredWorkspaceWriteLease } from '../../src/bootstrap/engineering/pipeline-orchestrator.ts';
import { executePipelineStage, withPipelineTransaction } from '../../src/bootstrap/engineering/pipeline-kernel.ts';
import { runCommand } from '../../src/adapters/runtime-state/physical/runtime/process.ts';
import { pathExists, writeText } from "../../src/adapters/filesystem/files.ts";
import {
  acquireWorkspaceWriteLease,
  assertWorkspaceWriteLease,
  createWorkspaceWriteLeaseManager,
  WorkspaceWriteLeaseError
} from '../../src/adapters/filesystem/write-lease.ts';
import { getWorkspacePaths } from "../../src/adapters/workspace-context.ts";
import { withTempWorkspace } from '../testkit/workspace.ts';

async function activeOwnerPath(leaseRoot: string): Promise<string> {
  const entries = await fs.readdir(leaseRoot);
  const generations = entries.filter((entry) => /^[0-9]{16}\.owner\.json$/u.test(entry)).sort();
  const active = [...generations].reverse().find((entry) => !entries.includes(entry.replace('.owner.json', '.terminal.json')));
  if (!active) throw new Error('Expected one active workspace writer generation');
  return path.join(leaseRoot, active);
}

test('initWorkspace creates a missing workspace root before acquiring its writer lease', async () => {
  await withTempWorkspace(async (outerRoot) => {
    const workspaceRoot = path.join(outerRoot, 'workspace');
    expect(await pathExists(workspaceRoot)).toBe(false);

    const initialized = await initWorkspace(workspaceRoot);

    expect(await pathExists(workspaceRoot)).toBe(true);
    expect(await pathExists(initialized.planPath)).toBe(true);
    expect(await pathExists(initialized.lockPath)).toBe(true);
    expect((await fs.readdir(outerRoot)).sort()).toEqual(['workspace']);
    const leaseRoot = path.join(workspaceRoot, '.sec', 'workspace-write-lease');
    expect(await pathExists(leaseRoot)).toBe(true);
    expect((await fs.readdir(leaseRoot)).filter((entry) => entry.endsWith('.owner.json'))).toHaveLength(1);
    expect((await fs.readdir(leaseRoot)).filter((entry) => entry.endsWith('.terminal.json'))).toHaveLength(1);
    const lease = await acquireWorkspaceWriteLease(workspaceRoot);
    try {
      await lease.assertOwned();
      await expect(initWorkspace(workspaceRoot)).rejects.toMatchObject({
        code: 'WORKSPACE-WRITE-LEASE-001'
      });
    } finally {
      await lease.release();
    }
  }, 'engineering-compiler-init-missing-workspace-');
});

test('a child cannot reuse or release a live holder token copied from owner.json', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await initWorkspace(workspaceRoot);
    const lease = await acquireWorkspaceWriteLease(workspaceRoot);
    const { secRoot } = getWorkspacePaths(workspaceRoot);
    const ownerPath = await activeOwnerPath(path.join(secRoot, 'workspace-write-lease'));
    const resultPath = path.join(workspaceRoot, 'copied-token-attempt.json');
    const orchestratorUrl = new URL('../../src/bootstrap/engineering/cli.ts', import.meta.url).href;
    const leaseModuleUrl = new URL('../../src/adapters/filesystem/write-lease.ts', import.meta.url).href;
    const childScript = `
      import { readFile } from 'node:fs/promises';
      import { compileWorkspace } from ${JSON.stringify(orchestratorUrl)};
      import { releaseWorkspaceWriteLease } from ${JSON.stringify(leaseModuleUrl)};
      const { createdAtMs: _createdAtMs, heartbeatAtMs: _heartbeatAtMs, ...token } =
        JSON.parse(await readFile(${JSON.stringify(ownerPath)}, 'utf8'));
      let compileCode = 'unexpected-success';
      let releaseCode = 'unexpected-success';
      try {
        await compileWorkspace(${JSON.stringify(workspaceRoot)}, {
          through: 'resolve',
          workspaceWriteLease: token
        });
      } catch (error) {
        compileCode = error?.code ?? 'unknown';
      }
      try {
        await releaseWorkspaceWriteLease(${JSON.stringify(workspaceRoot)}, token);
      } catch (error) {
        releaseCode = error?.code ?? 'unknown';
      }
      await Bun.write(${JSON.stringify(resultPath)}, JSON.stringify({ compileCode, releaseCode }));
    `;
    const child = Bun.spawn([process.execPath, '--no-env-file', '--eval', childScript], { stdout: 'pipe', stderr: 'pipe' });

    try {
      const exitCode = await child.exited;
      const stderr = await new Response(child.stderr).text();
      expect(exitCode, stderr).toBe(0);
      expect(JSON.parse(await fs.readFile(resultPath, 'utf8'))).toEqual({
        compileCode: 'WORKSPACE-WRITE-LEASE-002',
        releaseCode: 'WORKSPACE-WRITE-LEASE-002'
      });
      await lease.assertOwned();
    } finally {
      child.kill();
      await child.exited;
      await lease.release();
    }
  }, 'engineering-compiler-workspace-lease-copied-token-');
}, 120000);

test('a stage producer stops the current and subsequent writes when its exact lease token is invalidated', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await initWorkspace(workspaceRoot);
    const { secRoot } = getWorkspacePaths(workspaceRoot);
    const leaseRoot = path.join(secRoot, 'workspace-write-lease');
    const parkedLeasePath = path.join(leaseRoot, 'active-owner.parked-test');
    const committedPath = path.join(workspaceRoot, 'producer-committed.txt');
    const blockedPath = path.join(workspaceRoot, 'producer-blocked.txt');
    const subsequentPath = path.join(workspaceRoot, 'producer-subsequent.txt');
    let reachedSubsequentWrite = false;

    await expect(
      withPipelineTransaction(workspaceRoot, 'api', ['resolve'], undefined, async (context) =>
        executePipelineStage(workspaceRoot, 'resolve', context, async (stageContext) => {
          const commitFence = () => assertWorkspaceWriteLease(workspaceRoot, stageContext.workspaceWriteLease);
          await writeText(committedPath, 'committed-before-token-loss\n', commitFence);

          const payloadAfterProducerWork = await Promise.resolve('must-not-commit-after-token-loss\n');
          const ownerPath = await activeOwnerPath(leaseRoot);
          await fs.rename(ownerPath, parkedLeasePath);
          let writeFailure: unknown;
          try {
            await writeText(blockedPath, payloadAfterProducerWork, commitFence);
            reachedSubsequentWrite = true;
            await writeText(subsequentPath, 'must-not-run\n', commitFence);
          } catch (error) {
            writeFailure = error;
          } finally {
            await fs.rename(parkedLeasePath, ownerPath);
          }
          if (!writeFailure) throw new Error('Invalidated writer lease unexpectedly allowed a producer write');
          throw writeFailure;
        })
      )
    ).rejects.toBeInstanceOf(WorkspaceWriteLeaseError);

    expect(await pathExists(committedPath)).toBe(true);
    expect(await pathExists(blockedPath)).toBe(false);
    expect(reachedSubsequentWrite).toBe(false);
    expect(await pathExists(subsequentPath)).toBe(false);
  }, 'engineering-compiler-pipeline-producer-fence-');
}, 120000);

test('the pipeline lease monitor aborts a long-running isolated child when the staging token is lost', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const { secRoot } = getWorkspacePaths(workspaceRoot);
    const leaseRoot = path.join(secRoot, 'workspace-write-lease');
    const parkedLeasePath = path.join(leaseRoot, 'active-owner.parked-monitor-test');
    const lease = await acquireWorkspaceWriteLease(workspaceRoot);
    const ownerPath = await activeOwnerPath(leaseRoot);
    let childStarted = false;
    let childAborted = false;

    const monitored = withMonitoredWorkspaceWriteLease(
      workspaceRoot,
      lease.token,
      (signal) =>
        new Promise<void>((resolve) => {
          childStarted = true;
          const onAbort = (): void => {
            childAborted = true;
            resolve();
          };
          if (signal.aborted) onAbort();
          else signal.addEventListener('abort', onAbort, { once: true });
        })
    );
    while (!childStarted) await Bun.sleep(1);
    await fs.rename(ownerPath, parkedLeasePath);
    try {
      await expect(monitored).rejects.toBeInstanceOf(WorkspaceWriteLeaseError);
      expect(childAborted).toBe(true);
    } finally {
      await fs.rename(parkedLeasePath, ownerPath);
      await lease.release();
    }
  }, 'engineering-compiler-pipeline-lease-monitor-');
}, 120000);

test('an aborted live command terminates both the direct Windows child and its descendant tree', async () => {
  if (process.platform !== 'win32') return;
  await withTempWorkspace(async (workspaceRoot) => {
    const parentReady = path.join(workspaceRoot, 'parent-ready');
    const parentPulse = path.join(workspaceRoot, 'parent-pulse');
    const descendantReady = path.join(workspaceRoot, 'descendant-ready');
    const descendantPulse = path.join(workspaceRoot, 'descendant-pulse');
    const descendantScript = `
      await Bun.write(${JSON.stringify(descendantReady)}, 'ready');
      setInterval(() => void Bun.write(${JSON.stringify(descendantPulse)}, String(Date.now())), 10);
    `;
    const parentScript = `
      Bun.spawn([process.execPath, '--no-env-file', '--eval', ${JSON.stringify(descendantScript)}], {
        stdout: 'ignore', stderr: 'ignore'
      });
      await Bun.write(${JSON.stringify(parentReady)}, 'ready');
      setInterval(() => void Bun.write(${JSON.stringify(parentPulse)}, String(Date.now())), 10);
    `;
    const controller = new AbortController();
    const running = runCommand(process.execPath, ['--no-env-file', '--eval', parentScript], {
      cwd: workspaceRoot,
      signal: controller.signal
    });
    try {
      let ready = false;
      for (let attempt = 0; attempt < 500; attempt += 1) {
        if (
          (await pathExists(parentReady)) &&
          (await pathExists(descendantReady)) &&
          (await pathExists(parentPulse)) &&
          (await pathExists(descendantPulse))
        ) {
          ready = true;
          break;
        }
        await Bun.sleep(10);
      }
      if (!ready) throw new Error('Live command process-tree sentinel did not become ready');
      controller.abort();
      await expect(running).rejects.toThrow('was aborted');
      const parentAfterAbort = await fs.readFile(parentPulse, 'utf8');
      const descendantAfterAbort = await fs.readFile(descendantPulse, 'utf8');
      await Bun.sleep(200);
      expect(await fs.readFile(parentPulse, 'utf8')).toBe(parentAfterAbort);
      expect(await fs.readFile(descendantPulse, 'utf8')).toBe(descendantAfterAbort);
    } finally {
      controller.abort();
      await running.catch(() => undefined);
    }
  }, 'engineering-compiler-live-command-tree-fence-');
}, 120000);

test('workspace writer lease contends with and reclaims an orphaned child process', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const signalPath = path.join(workspaceRoot, 'child-lease-ready');
    const moduleUrl = new URL('../../src/adapters/filesystem/write-lease.ts', import.meta.url).href;
    const childScript = `
      import { createWorkspaceWriteLeaseManager } from ${JSON.stringify(moduleUrl)};
      const manager = createWorkspaceWriteLeaseManager({ heartbeatIntervalMs: 25, staleAfterMs: 100 });
      await manager.acquire(${JSON.stringify(workspaceRoot)});
      await Bun.write(${JSON.stringify(signalPath)}, 'ready');
      setInterval(() => undefined, 1_000);
    `;
    const child = Bun.spawn([process.execPath, '--eval', childScript], {
      stdout: 'pipe',
      stderr: 'pipe'
    });

    try {
      let ready = false;
      for (let attempt = 0; attempt < 500; attempt += 1) {
        if ((await fs.readFile(signalPath, 'utf8').catch(() => '')) === 'ready') {
          ready = true;
          break;
        }
        if (await Promise.race([child.exited.then(() => true), Bun.sleep(10).then(() => false)])) break;
      }
      if (!ready) {
        const stderr = await new Response(child.stderr).text();
        throw new Error(`Child lease holder failed to start: ${stderr}`);
      }

      const contender = createWorkspaceWriteLeaseManager({
        heartbeatIntervalMs: 25,
        staleAfterMs: 100
      });
      await expect(contender.acquire(workspaceRoot)).rejects.toMatchObject({
        code: 'WORKSPACE-WRITE-LEASE-001'
      });

      child.kill();
      await child.exited;
      await Bun.sleep(150);

      const replacement = await contender.acquire(workspaceRoot);
      await replacement.assertOwned();
      await replacement.release();
    } finally {
      child.kill();
      await child.exited;
    }
  }, 'engineering-compiler-workspace-lease-child-process-');
}, 120000);
