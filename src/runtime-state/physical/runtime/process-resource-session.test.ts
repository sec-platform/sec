import { expect, test } from 'bun:test';
import { chmod, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { sha256 } from '../../../system-architecture/foundation/runtime/canonical.ts';
import {
  bindSecSemanticOperation,
  compileSecCapabilityBinding,
  compileSecSemanticOperationPlan,
  type SecBoundSemanticOperation,
  type SecOperationBudget,
  type SecOperationDigest,
  type SecOperationEffectKind
} from '../../../system-architecture/operation/semantic.ts';
import {
  inspectNoFollowDirectoryChain,
  retainNoFollowDirectoryForChildProcess,
  retainNoFollowOrdinaryFile
} from './physical-no-follow.ts';
import { openProcessResourceSession } from './process-resource-session.ts';
import {
  issueRetainedCommandBoundary,
  RETAINED_EXECUTABLE_CHILD_DESCRIPTOR,
  RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR,
  type RetainedCommandBoundary
} from './process.ts';

const digest = (value: unknown): SecOperationDigest => sha256(value) as SecOperationDigest;
const compilerRoot = path.resolve(import.meta.dir, '../../../..');

function boundOperation(input: Readonly<{
  budgets?: readonly SecOperationBudget[];
  deadlineAtUnixMs?: number;
  effectKinds?: readonly SecOperationEffectKind[];
}> = {}): SecBoundSemanticOperation {
  const plan = compileSecSemanticOperationPlan({
    operation: 'verification.process-resource-test',
    intentDigest: digest('process-resource-test-intent'),
    decisionDigest: digest('process-resource-test-decision'),
    deadlineAtUnixMs: input.deadlineAtUnixMs ?? Date.now() + 30_000,
    aggregateBudgets: input.budgets ?? [
      { resource: 'duration-ms', maximum: 10_000 },
      { resource: 'input-bytes', maximum: 16 },
      { resource: 'output-bytes', maximum: 16 },
      { resource: 'processes', maximum: 2 }
    ],
    requirements: [{
      id: 'process.native-test',
      contractDigest: digest('process-native-test-contract'),
      effectKinds: input.effectKinds ?? ['process'],
      failureKinds: ['process.failed']
    }]
  });
  return bindSecSemanticOperation(plan, [compileSecCapabilityBinding({
    requirementId: plan.identity.requirements[0]!.id,
    contractDigest: plan.identity.requirements[0]!.contractDigest,
    providerIdentityDigest: digest('process-native-test-provider')
  })]);
}

function retainTestBoundary(): Readonly<{
  boundary: RetainedCommandBoundary;
  dispose(): void;
}> {
  const executablePath = path.resolve(process.execPath);
  const executable = retainNoFollowOrdinaryFile(
    inspectNoFollowDirectoryChain(path.dirname(executablePath), 'session test executable parent'),
    path.basename(executablePath),
    undefined,
    'session test executable',
    RETAINED_EXECUTABLE_CHILD_DESCRIPTOR,
    'executable'
  );
  const workingDirectory = retainNoFollowDirectoryForChildProcess(
    inspectNoFollowDirectoryChain(compilerRoot, 'session test cwd'),
    RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR,
    'session test cwd'
  );
  return Object.freeze({
    boundary: issueRetainedCommandBoundary({ executable, workingDirectory }),
    dispose() {
      workingDirectory.dispose();
      executable.dispose();
    }
  });
}

test('process sessions reject structural operation and session clones', async () => {
  const operation = boundOperation();
  const operationClone = structuredClone(operation) as SecBoundSemanticOperation;
  expect(() => openProcessResourceSession({ operation: operationClone })).toThrow(/owner-issued/u);

  const session = openProcessResourceSession({ operation });
  const clone = Object.freeze({ ...session });
  expect(() => clone.close()).toThrow(/owner-issued session/u);
  await expect(clone.run({} as RetainedCommandBoundary, [], {
    maxStderrBytes: 0,
    maxStdoutBytes: 0
  })).rejects.toThrow(/owner-issued session/u);
  session.close();
});

test('process session admission preserves pre-cancelled classification', () => {
  const controller = new AbortController();
  controller.abort(new Error('cancelled before admission'));
  expect(() => openProcessResourceSession({
    operation: boundOperation({ deadlineAtUnixMs: Date.now() - 1 }),
    signal: controller.signal
  })).toThrow('Process resource session is cancelled.');
});

test('process sessions require one process Effect and complete aggregate budgets exactly once', async () => {
  expect(() => openProcessResourceSession({
    operation: boundOperation({ effectKinds: ['filesystem'] })
  })).toThrow(/process Effect requirement/u);

  const retained = retainTestBoundary();
  const session = openProcessResourceSession({
    operation: boundOperation({ budgets: [
      { resource: 'duration-ms', maximum: 15_000 },
      { resource: 'input-bytes', maximum: 3 },
      { resource: 'output-bytes', maximum: 6 },
      { resource: 'processes', maximum: 2 }
    ] })
  });
  try {
    const first = await session.run(retained.boundary, [
      '--no-env-file',
      '--eval',
      "const chunks=[];process.stdin.on('data',c=>chunks.push(c));process.stdin.on('end',()=>process.stdout.write(Buffer.concat(chunks)))"
    ], {
      input: new Uint8Array([0, 1, 255]),
      maxStdinBytes: 3,
      maxStderrBytes: 0,
      maxStdoutBytes: 5
    });
    expect(first).toEqual({
      ordinal: 1,
      result: { code: 0, stdout: new Uint8Array([0, 1, 255]), stderr: '' }
    });

    await expect(session.run(retained.boundary, ['--version'], {
      input: new Uint8Array([1]),
      maxStdinBytes: 1,
      maxStderrBytes: 0,
      maxStdoutBytes: 0
    })).rejects.toThrow(/input-byte budget/u);
    await expect(session.run(retained.boundary, ['--version'], {
      maxStderrBytes: 0,
      maxStdoutBytes: 4
    })).rejects.toThrow(/output-byte admission/u);

    const second = await session.run(retained.boundary, [
      '--no-env-file',
      '--eval',
      "process.stdout.write('ok')"
    ], { maxStderrBytes: 0, maxStdoutBytes: 3 });
    expect(second.ordinal).toBe(2);
    expect(Buffer.from(second.result.stdout).toString('utf8')).toBe('ok');
    expect(session.processCount).toBe(2);
    expect(session.inputBytes).toBe(3);
    expect(session.outputBytes).toBe(5);

    await expect(session.run(retained.boundary, ['--version'], {
      maxStderrBytes: 0,
      maxStdoutBytes: 0
    })).rejects.toThrow(/process budget/u);

    const receipt = session.close();
    expect(session.close()).toBe(receipt);
    expect(receipt).toMatchObject({
      processCount: 2,
      failedProcessCount: 0,
      inputBytes: 3,
      outputBytes: 5,
      deadlineAtUnixMs: session.deadlineAtUnixMs
    });
    await expect(session.run(retained.boundary, ['--version'], {
      maxStderrBytes: 0,
      maxStdoutBytes: 0
    })).rejects.toThrow(/session is closed/u);
  } finally {
    retained.dispose();
  }
});

test('process sessions enforce single-flight cancellation and child settlement before close', async () => {
  const retained = retainTestBoundary();
  const controller = new AbortController();
  const session = openProcessResourceSession({
    operation: boundOperation(),
    signal: controller.signal
  });
  try {
    const running = session.run(retained.boundary, [
      '--no-env-file',
      '--eval',
      'setInterval(() => {}, 1_000)'
    ], {
      maxStderrBytes: 1,
      maxStdoutBytes: 1,
      terminationGraceMs: 25
    });
    await expect(session.run(retained.boundary, ['--version'], {
      maxStderrBytes: 0,
      maxStdoutBytes: 0
    })).rejects.toThrow(/single-flight/u);
    expect(() => session.close()).toThrow(/active child/u);
    controller.abort(new Error('test cancellation'));
    await expect(running).rejects.toThrow(/aborted/u);
    expect(session.signal.aborted).toBeTrue();
    expect(session.close()).toMatchObject({ processCount: 1, failedProcessCount: 1 });
  } finally {
    retained.dispose();
  }
});

test('process session deadline is one fixed wall and monotonic cancellation boundary', async () => {
  const session = openProcessResourceSession({
    operation: boundOperation({
      budgets: [
        { resource: 'duration-ms', maximum: 25 },
        { resource: 'output-bytes', maximum: 1 },
        { resource: 'processes', maximum: 1 }
      ],
      deadlineAtUnixMs: Date.now() + 1_000
    })
  });
  expect(session.deadlineAtUnixMs).toBeLessThanOrEqual(Date.now() + 25);
  expect(session.deadlineAtMonotonicMs).toBeGreaterThan(performance.now());
  await Bun.sleep(75);
  expect(session.signal.aborted).toBeTrue();
  await expect(session.run({} as RetainedCommandBoundary, [], {
    maxStderrBytes: 0,
    maxStdoutBytes: 0
  })).rejects.toThrow(/cancelled|deadline/u);
  session.close();
});

test.skipIf(process.platform !== 'linux')(
  'Linux retained executable uses one sealed descriptor image and rejects lexical ABA',
  async () => {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'sec-retained-executable-'));
    const executablePath = path.join(temporaryRoot, 'tool');
    const displacedPath = path.join(temporaryRoot, 'tool.displaced');
    const replacementPath = path.join(temporaryRoot, 'tool.replacement');
    const source = [
      '#!/bin/sh',
      'if printf x >&3 2>/dev/null; then exit 91; fi',
      'printf sealed'
    ].join('\n');
    await writeFile(executablePath, source, { mode: 0o755 });
    const parent = inspectNoFollowDirectoryChain(temporaryRoot, 'Linux executable test parent');
    const executable = retainNoFollowOrdinaryFile(
      parent,
      'tool',
      undefined,
      'Linux retained executable test',
      RETAINED_EXECUTABLE_CHILD_DESCRIPTOR,
      'executable'
    );
    const workingDirectory = retainNoFollowDirectoryForChildProcess(
      parent,
      RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR,
      'Linux retained executable cwd'
    );
    const boundary = issueRetainedCommandBoundary({ executable, workingDirectory });
    const session = openProcessResourceSession({ operation: boundOperation() });
    try {
      const executed = await session.run(boundary, [], {
        maxStderrBytes: 0,
        maxStdoutBytes: 6
      });
      expect(Buffer.from(executed.result.stdout).toString('utf8')).toBe('sealed');

      await rename(executablePath, displacedPath);
      await writeFile(executablePath, source, { mode: 0o755 });
      await rename(executablePath, replacementPath);
      await rename(displacedPath, executablePath);
      expect(() => executable.assertCurrent()).toThrow(/lexical executable edge changed/u);
      await expect(session.run(boundary, [], {
        maxStderrBytes: 0,
        maxStdoutBytes: 1
      })).rejects.toThrow(/lexical executable edge changed/u);
      session.close();
    } finally {
      workingDirectory.dispose();
      executable.dispose();
      expect(() => executable.assertCurrent()).toThrow(/disposed/u);
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }
);

test.skipIf(process.platform !== 'linux')(
  'Linux executable admission rejects a retained ordinary file without execute permission',
  async () => {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'sec-non-executable-'));
    const executablePath = path.join(temporaryRoot, 'tool');
    try {
      await writeFile(executablePath, '#!/bin/sh\nexit 0');
      await chmod(executablePath, 0o644);
      expect(() => retainNoFollowOrdinaryFile(
        inspectNoFollowDirectoryChain(temporaryRoot, 'Linux non-executable test parent'),
        'tool',
        undefined,
        'Linux non-executable test',
        RETAINED_EXECUTABLE_CHILD_DESCRIPTOR,
        'executable'
      )).toThrow(/not an executable ordinary file/u);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }
);
