import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { materializeFastSuiteExecutionGeneration } from '../../src/adapters/verification/fast-suite-generation.ts';

test.skipIf(process.platform !== 'linux')('sealed fast-suite generations preserve executable modes and bind them into input identity', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-fast-suite-mode-'));
  const executable = path.join(root, 'tool.sh');
  writeFileSync(executable, '#!/bin/sh\nexit 0\n');
  chmodSync(executable, 0o755);
  let first: Awaited<ReturnType<typeof materializeFastSuiteExecutionGeneration>> | undefined;
  let second: Awaited<ReturnType<typeof materializeFastSuiteExecutionGeneration>> | undefined;
  try {
    first = await materializeFastSuiteExecutionGeneration({ workspaceRoot: root });
    assert.equal(statSync(path.join(first.generation.workingDirectory.root.path, 'tool.sh')).mode & 0o777, 0o755);
    chmodSync(executable, 0o644);
    second = await materializeFastSuiteExecutionGeneration({ workspaceRoot: root });
    assert.equal(statSync(path.join(second.generation.workingDirectory.root.path, 'tool.sh')).mode & 0o777, 0o644);
    assert.notEqual(first.inputDigest, second.inputDigest);
  } finally {
    await second?.retire();
    await first?.retire();
    rmSync(root, { recursive: true, force: true });
  }
});
