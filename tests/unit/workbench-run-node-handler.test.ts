import { expect, test } from 'bun:test';

import {
  createWorkbenchRunNodeStream,
  type WorkbenchRunNodeProcess
} from '../../platform/orchestrator/workbench-run-node-handler.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function closedByteStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close();
    }
  });
}

async function settleMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

test('queued run-node cancellation never resolves or starts a command after mutex acquisition', async () => {
  const acquisition = deferred<() => void>();
  let releases = 0;
  let resolverCalls = 0;
  let spawnCalls = 0;
  const stream = createWorkbenchRunNodeStream({
    acquire: () => acquisition.promise,
    initialMessage: 'queued',
    resolveCommand: async () => {
      resolverCalls += 1;
      return ['bun', 'test'];
    },
    spawn: () => {
      spawnCalls += 1;
      throw new Error('must not spawn');
    }
  });
  const reader = stream.getReader();
  const cancelled = reader.cancel();
  acquisition.resolve(() => {
    releases += 1;
  });

  await cancelled;
  await settleMicrotasks();
  expect(resolverCalls).toBe(0);
  expect(spawnCalls).toBe(0);
  expect(releases).toBe(1);
});

test('run-node cancellation during command resolution never starts the resolved process', async () => {
  const command = deferred<string[] | null>();
  let releases = 0;
  let resolverCalls = 0;
  let spawnCalls = 0;
  const stream = createWorkbenchRunNodeStream({
    acquire: async () => () => {
      releases += 1;
    },
    initialMessage: 'resolving',
    resolveCommand: async () => {
      resolverCalls += 1;
      return command.promise;
    },
    spawn: () => {
      spawnCalls += 1;
      throw new Error('must not spawn');
    }
  });
  const reader = stream.getReader();
  await settleMicrotasks();
  expect(resolverCalls).toBe(1);

  const cancelled = reader.cancel();
  command.resolve(['bun', 'test']);
  await cancelled;
  await settleMicrotasks();
  expect(spawnCalls).toBe(0);
  expect(releases).toBe(1);
});

test('active run-node cancellation kills the process and retains mutex until physical terminal', async () => {
  const exited = deferred<number>();
  let releases = 0;
  let kills = 0;
  let spawnCalls = 0;
  const processHandle: WorkbenchRunNodeProcess = {
    kill() {
      kills += 1;
    },
    exited: exited.promise,
    stdout: closedByteStream(),
    stderr: closedByteStream()
  };
  const stream = createWorkbenchRunNodeStream({
    acquire: async () => () => {
      releases += 1;
    },
    initialMessage: 'active',
    resolveCommand: async () => ['bun', 'test'],
    spawn: () => {
      spawnCalls += 1;
      return processHandle;
    }
  });
  const reader = stream.getReader();
  await settleMicrotasks();
  expect(spawnCalls).toBe(1);

  const cancelled = reader.cancel();
  await settleMicrotasks();
  expect(kills).toBe(1);
  expect(releases).toBe(0);

  exited.resolve(137);
  await cancelled;
  await settleMicrotasks();
  expect(releases).toBe(1);
});
