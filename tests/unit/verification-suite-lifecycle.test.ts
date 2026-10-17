import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { settleResourcesAsync } from '../../src/execution/resource-settlement.ts';
import { settleWorkspaceCallback } from '../testkit/workspace-cleanup.ts';
import { materializeFastSuiteExecutionGeneration } from '../../src/adapters/verification/fast-suite-generation.ts';

test.skipIf(process.platform !== 'linux')('sealed fast-suite generations preserve executable modes and bind them into input identity', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-fast-suite-mode-'));
  const executable = path.join(root, 'tool.sh');
  let first: Awaited<ReturnType<typeof materializeFastSuiteExecutionGeneration>> | undefined;
  let second: Awaited<ReturnType<typeof materializeFastSuiteExecutionGeneration>> | undefined;
  let acquisitionReturned = true;
  await settleWorkspaceCallback(async () => {
    writeFileSync(executable, '#!/bin/sh\nexit 0\n');
    chmodSync(executable, 0o755);
    acquisitionReturned = false;
    first = await materializeFastSuiteExecutionGeneration({ workspaceRoot: root });
    acquisitionReturned = true;
    assert.equal(statSync(path.join(first.generation.workingDirectory.root.path, 'tool.sh')).mode & 0o777, 0o755);
    chmodSync(executable, 0o644);
    acquisitionReturned = false;
    second = await materializeFastSuiteExecutionGeneration({ workspaceRoot: root });
    acquisitionReturned = true;
    assert.equal(statSync(path.join(second.generation.workingDirectory.root.path, 'tool.sh')).mode & 0o777, 0o644);
    assert.notEqual(first.inputDigest, second.inputDigest);
  }, async () => {
    await settleResourcesAsync({ cleanup: [
      { label: 'second fast-suite generation', settle: () => second?.retire() },
      { label: 'first fast-suite generation', settle: () => first?.retire() }
    ] });
    // A rejected acquisition may include failed protected-root cleanup.
    if (acquisitionReturned) rmSync(root, { recursive: true, force: true });
  });
});
