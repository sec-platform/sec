import { expect, test } from 'bun:test';
import { chmod, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { sha256 } from '../../../../contracts/canonical.ts';
import {
  issueOperationRequirementBindingContext,
  type OperationRequirementBindingContext,
  type OperationResourceCeiling
} from '../../../../execution/operation/requirement-binding-context.ts';
import {
  bindSemanticOperation,
  compileCapabilityBinding,
  compileSemanticOperationPlan,
  issueSemanticOperationAttemptContext,
  type BoundSemanticOperation,
  type OperationBudget,
  type OperationDigest,
  type OperationEffectKind
} from '../../../../execution/operation/semantic.ts';
import {
  issueIndependentProviderProcessCapability
} from './independent-provider-process.ts';
import {
  openObservedNativeProcessResourceLedger,
  runObservedCommand
} from './observed-process-stdin.ts';
import {
  inspectNoFollowDirectoryChain,
  retainNoFollowDirectoryForChildProcess,
  retainNoFollowOrdinaryFile
} from './physical-no-follow.ts';
import {
  assertProcessResourceRunResult,
  assertProcessResourceSession,
  assertProcessResourceSessionReceipt,
  openProcessResourceSession,
  type ProcessResourceRunResult,
  type ProcessResourceSessionReceipt
} from './process-resource-session.ts';
import {
  issueRetainedCommandBoundary,
  RETAINED_EXECUTABLE_CHILD_DESCRIPTOR,
  RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR,
  RetainedCommandTransportError
} from './process.ts';
import type { RetainedCommandBoundary } from './retained-command-boundary.ts';

const digest = (value: unknown): OperationDigest => sha256(value) as OperationDigest;
const compilerRoot = path.resolve(import.meta.dir, '../../../..');

function boundOperation(input: Readonly<{
  authorityGrantLabel?: string;
  budgets?: readonly OperationBudget[];
  deadlineAtUnixMs?: number;
  effectKinds?: readonly OperationEffectKind[];
  label?: string;
  providerLabel?: string;
}> = {}): BoundSemanticOperation {
  const label = input.label ?? 'process-resource-test';
  const plan = compileSemanticOperationPlan({
    operation: 'verification.process-resource-test',
    intentDigest: digest(`${label}-intent`),
    decisionDigest: digest(`${label}-decision`),
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
    }],
    attempt: issueSemanticOperationAttemptContext({
      // A distinct grant changes only the bound attempt, not the operation plan.
      authorityGrantDigest: digest(
        input.authorityGrantLabel ?? 'process-native-test-authority-grant'
      )
    })
  });
  return bindSemanticOperation(plan, [compileCapabilityBinding({
    requirementId: plan.execution.requirements[0]!.id,
    contractDigest: plan.execution.requirements[0]!.contractDigest,
    providerIdentityDigest: digest(input.providerLabel ?? 'process-native-test-provider')
  })]);
}

function requirementBindingContext(
  operation: BoundSemanticOperation,
  ceilings?: readonly OperationResourceCeiling[]
): OperationRequirementBindingContext {
  const inputBudget = operation.plan.execution.aggregateBudgets.find(
    ({ resource }) => resource === 'input-bytes'
  );
  return issueOperationRequirementBindingContext({
    operation,
    requirementId: operation.plan.execution.requirements[0]!.id,
    resourceCeilings: ceilings ?? [
      ...operation.plan.execution.aggregateBudgets,
      ...(inputBudget === undefined
        ? [{ resource: 'input-bytes' as const, maximum: 0 }]
        : [])
    ]
  });
}

function retainTestBoundary(auxiliaryPath?: string): Readonly<{
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
  const auxiliary = auxiliaryPath === undefined
    ? null
    : retainNoFollowOrdinaryFile(
      inspectNoFollowDirectoryChain(path.dirname(auxiliaryPath), 'session test auxiliary parent'),
      path.basename(auxiliaryPath),
      undefined,
      'session test provider auxiliary',
      5,
      'ordinary-file'
    );
  return Object.freeze({
    boundary: issueRetainedCommandBoundary({
      executable,
      workingDirectory,
      ...(auxiliary === null ? {} : {
        auxiliaryInputs: [{ capability: auxiliary, kind: 'ordinary-file' as const }]
      })
    }),
    dispose() {
      auxiliary?.dispose();
      workingDirectory.dispose();
      executable.dispose();
    }
  });
}

test('independent provider identity binds retained auxiliary provider inputs', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sec-independent-provider-auxiliary-'));
  const firstPath = path.join(root, 'provider-a.bin');
  const secondPath = path.join(root, 'provider-b.bin');
  await writeFile(firstPath, 'provider-a');
  await writeFile(secondPath, 'provider-b');
  const operation = boundOperation({
    effectKinds: ['process', 'provider'],
    label: 'auxiliary-provider-identity'
  });
  const first = retainTestBoundary(firstPath);
  const second = retainTestBoundary(secondPath);
  try {
    const firstCapability = issueIndependentProviderProcessCapability({
      boundary: first.boundary,
      operation
    });
    const secondCapability = issueIndependentProviderProcessCapability({
      boundary: second.boundary,
      operation
    });
    expect(firstCapability.providerPhysicalIdentityDigest)
      .not.toBe(secondCapability.providerPhysicalIdentityDigest);
  } finally {
    second.dispose();
    first.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test('process sessions reject structural operation and session clones', async () => {
  const operation = boundOperation();
  const operationClone = structuredClone(operation) as BoundSemanticOperation;
  expect(() => openProcessResourceSession({
    operation: operationClone,
    requirementBindingContext: requirementBindingContext(operation)
  }))
    .toThrow(/foundation-compiled operation plan/u);

  const session = openProcessResourceSession({
    operation,
    requirementBindingContext: requirementBindingContext(operation)
  });
  const expectedBinding = {
    semanticOperation: operation.plan.identity.operation,
    requirementId: operation.plan.execution.requirements[0]!.id,
    providerIdentityDigest: operation.bindings[0]!.providerIdentityDigest,
    maximumDurationMs: 10_000,
    maximumInputBytes: 16,
    maximumOutputBytes: 16,
    maximumProcesses: 2
  } as const;
  expect(() => assertProcessResourceSession(session, expectedBinding)).not.toThrow();
  expect(session.observeNativeResourceCapacity()).toMatchObject({
    maximum: 2, admitted: 0, remaining: 2, root: 0, stdinWorker: 0, helper: 0
  });
  const clone = Object.freeze({ ...session });
  expect(() => assertProcessResourceSession(clone, expectedBinding))
    .toThrow(/owner-issued live session/u);
  expect(() => assertProcessResourceSession(session, {
    ...expectedBinding,
    semanticOperation: 'verification.foreign-operation'
  })).toThrow(/binding differs/u);
  expect(() => assertProcessResourceSession(session, {
    ...expectedBinding,
    providerIdentityDigest: digest('foreign-provider')
  })).toThrow(/binding differs/u);
  expect(() => clone.close()).toThrow(/owner-issued session/u);
  expect(() => clone.observeNativeResourceCapacity()).toThrow(/owner-issued session/u);
  await expect(clone.run({} as RetainedCommandBoundary, [], {
    maxStderrBytes: 0,
    maxStdoutBytes: 0
  })).rejects.toThrow(/owner-issued session/u);
  session.close();
  expect(() => session.observeNativeResourceCapacity()).toThrow(/closed/u);
  expect(() => assertProcessResourceSession(session, expectedBinding))
    .toThrow(/current live session/u);
});

test('process session admission preserves pre-cancelled classification', () => {
  const controller = new AbortController();
  controller.abort(new Error('cancelled before admission'));
  const operation = boundOperation();
  expect(() => openProcessResourceSession({
    operation,
    requirementBindingContext: requirementBindingContext(operation),
    signal: controller.signal
  })).toThrow('Process resource session is cancelled.');
});

test('process sessions require one process Effect and complete bound resource ceilings exactly once', async () => {
  const filesystemOperation = boundOperation({ effectKinds: ['filesystem'] });
  expect(() => openProcessResourceSession({
    operation: filesystemOperation,
    requirementBindingContext: requirementBindingContext(filesystemOperation)
  })).toThrow(/process Effect requirement/u);

  const retained = retainTestBoundary();
  const operation = boundOperation({ budgets: [
    { resource: 'duration-ms', maximum: 15_000 },
    { resource: 'input-bytes', maximum: 3 },
    { resource: 'output-bytes', maximum: 6 },
    // Windows uses a separate native stdin worker for the first run.
    { resource: 'processes', maximum: process.platform === 'win32' ? 3 : 2 }
  ] });
  const session = openProcessResourceSession({
    operation,
    requirementBindingContext: requirementBindingContext(operation)
  });
  try {
    const firstArgs = [
      '--no-env-file',
      '--eval',
      "const chunks=[];process.stdin.on('data',c=>chunks.push(c));process.stdin.on('end',()=>process.stdout.write(Buffer.concat(chunks)))"
    ] as const;
    const firstInput = new Uint8Array([0, 1, 255]);
    const firstEnvironment = { SEC_PROCESS_RESOURCE_RESULT_TEST: 'first' } as const;
    const first = await session.run(retained.boundary, firstArgs, {
      env: firstEnvironment,
      input: firstInput,
      maxStdinBytes: 3,
      maxStderrBytes: 0,
      maxStdoutBytes: 5
    });
    expect(first).toMatchObject({
      ordinal: 1,
      result: { code: 0, stdout: new Uint8Array([0, 1, 255]), stderr: '' }
    });
    expect(first.outcome.status).toBe('exited');
    expect(first.outcome.termination).toMatchObject({
      childCloseObserved: true,
      streamsDrained: true,
      treeClosed: true
    });
    expect(session.observeNativeResourceCapacity()).toMatchObject({
      remaining: 1, root: 1, stdinWorker: process.platform === 'win32' ? 1 : 0
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

    const secondArgs = [
      '--no-env-file',
      '--eval',
      "process.stdout.write('ok')"
    ] as const;
    const second = await session.run(retained.boundary, secondArgs, {
      maxStderrBytes: 0,
      maxStdoutBytes: 3
    });
    expect(second.ordinal).toBe(2);
    expect(Buffer.from(second.result.stdout).toString('utf8')).toBe('ok');
    expect(session.processCount).toBe(2);
    expect(session.observeNativeResourceCapacity()).toMatchObject({ remaining: 0, root: 2 });
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
      settledProcessCount: 2,
      successfulProcessRecordCount: 2,
      failedProcessCount: 0,
      admittedNativeResourceCount: process.platform === 'win32' ? 3 : 2,
      startedNativeResourceCount: process.platform === 'win32' ? 3 : 2,
      rootProcessCount: 2,
      stdinWorkerCount: process.platform === 'win32' ? 1 : 0,
      helperProcessCount: 0,
      settledNativeResourceCount: process.platform === 'win32' ? 3 : 2,
      failedNativeAdmissionCount: 0,
      inputBytes: 3,
      outputBytes: 5,
      deadlineAtUnixMs: session.deadlineAtUnixMs
    });
    assertProcessResourceSessionReceipt(receipt, {
      operationIdentityDigest: operation.plan.identity.identityDigest,
      boundAttemptDigest: operation.boundAttemptDigest,
      requirementId: operation.plan.execution.requirements[0]!.id
    });
    const expectedRunBinding = {
      operationIdentityDigest: operation.plan.identity.identityDigest,
      boundAttemptDigest: operation.boundAttemptDigest,
      requirementId: operation.plan.execution.requirements[0]!.id,
      boundary: retained.boundary
    } as const;
    expect(Object.isFrozen(first)).toBeTrue();
    expect(Object.isFrozen(first.result)).toBeTrue();
    expect(() => assertProcessResourceRunResult(first, receipt, {
      ...expectedRunBinding,
      args: firstArgs,
      env: firstEnvironment,
      input: firstInput,
      ordinal: 1
    })).not.toThrow();
    expect(() => assertProcessResourceRunResult(second, receipt, {
      ...expectedRunBinding,
      args: secondArgs,
      ordinal: 2
    })).not.toThrow();
    expect(() => assertProcessResourceRunResult(
      structuredClone(first) as ProcessResourceRunResult,
      receipt,
      { ...expectedRunBinding, args: firstArgs, env: firstEnvironment, input: firstInput }
    )).toThrow(/owner-issued exact result/u);

    const foreignOperation = boundOperation({ label: 'foreign-run-result-session' });
    const foreignSession = openProcessResourceSession({
      operation: foreignOperation,
      requirementBindingContext: requirementBindingContext(foreignOperation)
    });
    const foreignRun = await foreignSession.run(retained.boundary, [
      '--no-env-file',
      '--eval',
      "process.stdout.write('x')"
    ], { maxStderrBytes: 0, maxStdoutBytes: 1 });
    const foreignReceipt = foreignSession.close();
    expect(() => assertProcessResourceRunResult(
      first,
      foreignReceipt,
      { ...expectedRunBinding, args: firstArgs, env: firstEnvironment, input: firstInput }
    )).toThrow(/different sessions/u);
    expect(() => assertProcessResourceRunResult(
      foreignRun,
      receipt,
      { ...expectedRunBinding, args: secondArgs }
    )).toThrow(/different sessions/u);

    expect(() => assertProcessResourceRunResult(first, receipt, {
      ...expectedRunBinding,
      args: secondArgs,
      input: firstInput
    })).toThrow(/invocation differs/u);
    expect(() => assertProcessResourceRunResult(first, receipt, {
      ...expectedRunBinding,
      args: firstArgs,
      env: firstEnvironment,
      input: new Uint8Array([0, 1, 254])
    })).toThrow(/invocation differs/u);
    expect(() => assertProcessResourceRunResult(first, receipt, {
      ...expectedRunBinding,
      args: firstArgs,
      env: { SEC_PROCESS_RESOURCE_RESULT_TEST: 'transplanted' },
      input: firstInput
    })).toThrow(/invocation differs/u);
    const transplantedBoundary = retainTestBoundary();
    try {
      expect(() => assertProcessResourceRunResult(first, receipt, {
        ...expectedRunBinding,
        args: firstArgs,
        boundary: transplantedBoundary.boundary,
        env: firstEnvironment,
        input: firstInput
      })).toThrow(/invocation differs/u);
    } finally {
      transplantedBoundary.dispose();
    }

    first.result.stdout[0] = 9;
    expect(() => assertProcessResourceRunResult(
      first,
      receipt,
      { ...expectedRunBinding, args: firstArgs, env: firstEnvironment, input: firstInput }
    )).toThrow(/output identity changed/u);
    expect(() => assertProcessResourceSessionReceipt(
      structuredClone(receipt) as ProcessResourceSessionReceipt
    )).toThrow(/owner-issued terminal receipt/u);
    expect(() => assertProcessResourceSessionReceipt(receipt, {
      operationIdentityDigest: boundOperation({ label: 'receipt-transplant' })
        .plan.identity.identityDigest,
      boundAttemptDigest: operation.boundAttemptDigest,
      requirementId: operation.plan.execution.requirements[0]!.id
    })).toThrow(/expected operation requirement/u);
    await expect(session.run(retained.boundary, ['--version'], {
      maxStderrBytes: 0,
      maxStdoutBytes: 0
    })).rejects.toThrow(/session is closed/u);
  } finally {
    retained.dispose();
  }
});

test('process admission rejects context transplants omitted resources and widened ceilings', () => {
  const operation = boundOperation({ label: 'context-target' });
  const foreignOperation = boundOperation({ label: 'context-foreign' });
  expect(() => openProcessResourceSession({
    operation,
    requirementBindingContext: requirementBindingContext(foreignOperation)
  })).toThrow('operation binding context transplant');

  expect(() => openProcessResourceSession({
    operation,
    requirementBindingContext: requirementBindingContext(operation, [
      { resource: 'duration-ms', maximum: 1_000 },
      { resource: 'input-bytes', maximum: 0 },
      { resource: 'processes', maximum: 1 }
    ])
  })).toThrow('complete process resource ceiling set');

  expect(() => requirementBindingContext(operation, [
    { resource: 'duration-ms', maximum: 10_001 },
    { resource: 'input-bytes', maximum: 0 },
    { resource: 'output-bytes', maximum: 1 },
    { resource: 'processes', maximum: 1 }
  ])).toThrow('not narrowed from its operation');

  const singleUseOperation = boundOperation({ label: 'context-single-use' });
  const singleUseContext = requirementBindingContext(singleUseOperation);
  openProcessResourceSession({
    operation: singleUseOperation,
    requirementBindingContext: singleUseContext
  }).close();
  expect(() => openProcessResourceSession({
    operation: singleUseOperation,
    requirementBindingContext: singleUseContext
  })).toThrow('already been consumed');
});

test('process sessions enforce single-flight cancellation and child settlement before close', async () => {
  const retained = retainTestBoundary();
  const controller = new AbortController();
  const operation = boundOperation();
  const session = openProcessResourceSession({
    operation,
    requirementBindingContext: requirementBindingContext(operation),
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
    expect(() => assertProcessResourceSession(session, {
      semanticOperation: operation.plan.identity.operation,
      requirementId: operation.plan.execution.requirements[0]!.id,
      maximumDurationMs: 10_000,
      maximumInputBytes: 16,
      maximumOutputBytes: 16,
      maximumProcesses: 2
    })).toThrow(/current live session/u);
    expect(session.close()).toMatchObject({
      processCount: 1,
      settledProcessCount: 1,
      successfulProcessRecordCount: 0,
      failedProcessCount: 1
    });
  } finally {
    retained.dispose();
  }
});

test('process session deadline is one fixed wall and monotonic cancellation boundary', async () => {
  const operation = boundOperation({
    budgets: [
      { resource: 'duration-ms', maximum: 25 },
      { resource: 'input-bytes', maximum: 0 },
      { resource: 'output-bytes', maximum: 1 },
      { resource: 'processes', maximum: 1 }
    ],
    deadlineAtUnixMs: Date.now() + 1_000
  });
  const session = openProcessResourceSession({
    operation,
    requirementBindingContext: requirementBindingContext(operation)
  });
  expect(session.deadlineAtUnixMs).toBeLessThanOrEqual(Date.now() + 25);
  expect(session.deadlineAtMonotonicMs).toBeGreaterThan(performance.now());
  const cooperativeDeadlineAtUnixMs = session.cooperativeDeadlineAtUnixMs();
  expect(cooperativeDeadlineAtUnixMs).toBeGreaterThan(Date.now());
  expect(cooperativeDeadlineAtUnixMs).toBeLessThan(session.deadlineAtUnixMs);
  await Bun.sleep(75);
  expect(session.signal.aborted).toBeTrue();
  expect(() => assertProcessResourceSession(session, {
    semanticOperation: operation.plan.identity.operation,
    requirementId: operation.plan.execution.requirements[0]!.id,
    maximumDurationMs: 25,
    maximumInputBytes: 0,
    maximumOutputBytes: 1,
    maximumProcesses: 1
  })).toThrow(/current live session/u);
  await expect(session.run({} as RetainedCommandBoundary, [], {
    maxStderrBytes: 0,
    maxStdoutBytes: 0
  })).rejects.toThrow(/cancelled|deadline/u);
  session.close();
});

test('child timeout settles its physical process tree inside the parent operation deadline', async () => {
  const retained = retainTestBoundary();
  const operation = boundOperation({
    budgets: [
      { resource: 'duration-ms', maximum: 1_000 },
      { resource: 'input-bytes', maximum: 0 },
      { resource: 'output-bytes', maximum: 2 },
      { resource: 'processes', maximum: 2 }
    ],
    deadlineAtUnixMs: Date.now() + 5_000,
    label: 'child-timeout-settlement'
  });
  const session = openProcessResourceSession({
    operation,
    requirementBindingContext: requirementBindingContext(operation)
  });
  try {
    let failure: unknown;
    let settledAtMonotonicMs = Number.POSITIVE_INFINITY;
    try {
      await session.run(retained.boundary, [
        '--no-env-file',
        '--eval',
        'setInterval(() => {}, 1_000)'
      ], {
        maxStderrBytes: 1,
        maxStdoutBytes: 1,
        terminationGraceMs: 50
      });
    } catch (error) {
      failure = error;
      settledAtMonotonicMs = performance.now();
    }
    expect(failure).toBeInstanceOf(RetainedCommandTransportError);
    const transportFailure = failure as RetainedCommandTransportError;
    expect(transportFailure.outcome).toMatchObject({
      status: 'timed-out',
      trigger: 'timed-out',
      started: true,
      termination: {
        requested: true,
        childCloseObserved: true,
        streamsDrained: true,
        treeClosed: true
      }
    });
    expect(settledAtMonotonicMs).toBeLessThan(session.deadlineAtMonotonicMs);
    const receipt = session.close();
    expect(receipt).toMatchObject({
      processCount: 1,
      settledProcessCount: 1,
      successfulProcessRecordCount: 0,
      failedProcessCount: 1,
      settledNativeResourceCount: receipt.admittedNativeResourceCount
    });
  } finally {
    retained.dispose();
  }
});

test('native process resource ledger irreversibly accounts roots workers helpers and failed admission', () => {
  const ledger = openObservedNativeProcessResourceLedger({
    maximumResources: 3,
    deadlineAtMonotonicMs: performance.now() + 10_000
  });
  const root = ledger.admit('root-process');
  root.start();
  const worker = ledger.admit('stdin-worker');
  worker.start();
  worker.settle();
  const helper = ledger.admit('termination-helper');
  helper.settle();

  expect(() => ledger.admit('root-process')).toThrow(/process budget/u);
  expect(() => ledger.close()).toThrow(/unsettled admitted resources/u);
  expect(() => ({ ...ledger }).admit('root-process')).toThrow(/owner-issued ledger/u);

  root.settle();
  expect(ledger.close()).toEqual({
    admittedResourceCount: 3,
    startedResourceCount: 2,
    rootProcessCount: 1,
    stdinWorkerCount: 1,
    helperProcessCount: 1,
    settledResourceCount: 3,
    failedAdmissionCount: 1
  });
});

test('native process resource ledger conservatively settles a failed root spawn', async () => {
  const ledger = openObservedNativeProcessResourceLedger({
    maximumResources: 1,
    deadlineAtMonotonicMs: performance.now() + 10_000
  });
  const outcome = await runObservedCommand(
    path.join(compilerRoot, 'missing-process-resource-command.exe'),
    [],
    {
      cwd: compilerRoot,
      envMode: 'replace',
      maxObservedOutputBytes: 0,
      nativeResourceLedger: ledger,
      timeoutMs: 1_000
    }
  );
  expect(outcome.status).toBe('spawn-failed');
  expect(ledger.close()).toEqual({
    admittedResourceCount: 1,
    startedResourceCount: 0,
    rootProcessCount: 1,
    stdinWorkerCount: 0,
    helperProcessCount: 0,
    settledResourceCount: 1,
    failedAdmissionCount: 1
  });
});

test('failed command settlement retains its full output reservation in the terminal receipt', async () => {
  const retained = retainTestBoundary();
  const operation = boundOperation({
    budgets: [
      { resource: 'duration-ms', maximum: 10_000 },
      { resource: 'input-bytes', maximum: 0 },
      { resource: 'output-bytes', maximum: 2 },
      { resource: 'processes', maximum: 1 }
    ],
    label: 'failed-output-reservation'
  });
  const session = openProcessResourceSession({
    operation,
    requirementBindingContext: requirementBindingContext(operation)
  });
  try {
    await expect(session.run(retained.boundary, [
      '--no-env-file',
      '--eval',
      "process.stdout.write('overflow')"
    ], {
      maxStderrBytes: 0,
      maxStdoutBytes: 2
    })).rejects.toThrow(/stdout exceeded/u);
    expect(session.close()).toMatchObject({
      processCount: 1,
      settledProcessCount: 1,
      successfulProcessRecordCount: 0,
      failedProcessCount: 1,
      admittedNativeResourceCount: 1,
      startedNativeResourceCount: 1,
      rootProcessCount: 1,
      settledNativeResourceCount: 1,
      failedNativeAdmissionCount: 0,
      outputBytes: 2
    });
  } finally {
    retained.dispose();
  }
});

test('process session rejects operation, attempt, and provider breakaway token transplants before spawn', async () => {
  const sessionOperation = boundOperation({
    effectKinds: ['process', 'provider'],
    label: 'breakaway-session'
  });
  const session = openProcessResourceSession({
    operation: sessionOperation,
    requirementBindingContext: requirementBindingContext(sessionOperation)
  });
  const retained = retainTestBoundary();
  const runWith = async (
    capability: ReturnType<typeof issueIndependentProviderProcessCapability>
  ): Promise<void> => {
    await session.run(retained.boundary, ['--version'], {
      independentProvider: capability,
      maxStderrBytes: 1,
      maxStdoutBytes: 1
    });
  };
  try {
    const operationTransplant = issueIndependentProviderProcessCapability({
      boundary: retained.boundary,
      operation: boundOperation({
        effectKinds: ['process', 'provider'],
        label: 'different-operation'
      })
    });
    await expect(runWith(operationTransplant)).rejects.toThrow('operation transplant');

    const attemptTransplant = issueIndependentProviderProcessCapability({
      boundary: retained.boundary,
      operation: boundOperation({
        authorityGrantLabel: 'different-attempt-grant',
        effectKinds: ['process', 'provider'],
        label: 'breakaway-session'
      })
    });
    await expect(runWith(attemptTransplant)).rejects.toThrow('attempt transplant');

    const foreignRetained = retainTestBoundary();
    const providerTransplant = issueIndependentProviderProcessCapability({
      boundary: foreignRetained.boundary,
      operation: sessionOperation,
    });
    try {
      await expect(runWith(providerTransplant)).rejects.toThrow('retained provider transplant');
    } finally {
      foreignRetained.dispose();
    }
    expect(session.processCount).toBe(0);
  } finally {
    session.close();
    retained.dispose();
  }
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
    const operation = boundOperation();
    const session = openProcessResourceSession({
      operation,
      requirementBindingContext: requirementBindingContext(operation)
    });
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
