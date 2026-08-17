import { expect, test } from 'bun:test';

import {
  createWorkbenchCompileStream,
  type CompileStreamContext
} from '../../platform/orchestrator/workbench-compile-handler.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function settleMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

test('queued Workbench compile cancellation never starts execution after mutex acquisition', async () => {
  const acquisition = deferred<() => void>();
  let releases = 0;
  let compileCalls = 0;
  const compile: NonNullable<CompileStreamContext['compile']> = async () => {
    compileCalls += 1;
    return { transactionId: 'must-not-run' } as never;
  };

  const stream = createWorkbenchCompileStream({
    workspaceRoot: '/queued-cancel',
    acquire: () => acquisition.promise,
    compile
  });
  const reader = stream.getReader();
  const cancelled = reader.cancel();
  acquisition.resolve(() => {
    releases += 1;
  });

  await cancelled;
  await settleMicrotasks();
  expect(compileCalls).toBe(0);
  expect(releases).toBe(1);
});

test('active Workbench compile cancellation holds mutex until physical execution settles', async () => {
  const execution = deferred<never>();
  let releases = 0;
  let compileCalls = 0;
  const compile: NonNullable<CompileStreamContext['compile']> = async () => {
    compileCalls += 1;
    return execution.promise;
  };

  const stream = createWorkbenchCompileStream({
    workspaceRoot: '/active-cancel',
    acquire: async () => () => {
      releases += 1;
    },
    compile
  });
  const reader = stream.getReader();
  await settleMicrotasks();
  expect(compileCalls).toBe(1);

  const cancelled = reader.cancel();
  await settleMicrotasks();
  expect(releases).toBe(0);

  execution.resolve({ transactionId: 'settled' } as never);
  await cancelled;
  await settleMicrotasks();
  expect(releases).toBe(1);
});
