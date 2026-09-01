import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker as ThreadWorker } from 'node:worker_threads';

import windowsStdinWriterWorkerPath from './windows-stdin-writer-worker.mjs' with { type: 'file' };

import {
  copyBoundedCommandInput,
  runObservedCommand as runObservedCommandCore,
  type ObservedCommandCoreOptions,
  type ObservedCommandInputCapability,
  type ObservedCommandOutcome,
  type ObservedCommandStdinController,
  type ObservedNativeProcessResourceLedger
} from './observed-process.ts';

export * from './observed-process.ts';

export interface ObservedCommandOptions extends ObservedCommandCoreOptions {
  /** Immutable bytes written once to the observed child's stdin. */
  readonly input?: Uint8Array;
  /** Required aggregate bound whenever input is supplied. */
  readonly maxStdinBytes?: number;
}

function startWindowsObservedStdinWriter(
  handle: bigint,
  input: Uint8Array,
  closeHandle: () => void,
  nativeResourceLedger?: ObservedNativeProcessResourceLedger
): ObservedCommandStdinController {
  const workerUrl = path.isAbsolute(windowsStdinWriterWorkerPath)
    ? pathToFileURL(windowsStdinWriterWorkerPath)
    : new URL(windowsStdinWriterWorkerPath, import.meta.url);
  const workerResource = nativeResourceLedger?.admit('stdin-worker');
  let worker: ThreadWorker;
  try {
    worker = new ThreadWorker(workerUrl);
    workerResource?.start();
  } catch (error) {
    workerResource?.settle();
    closeHandle();
    throw error;
  }
  let settled = false;
  let resolveSettlement!: (value: boolean) => void;
  const settlement = new Promise<boolean>((resolve) => {
    resolveSettlement = resolve;
  });
  const finish = (value: boolean): void => {
    if (settled) return;
    settled = true;
    closeHandle();
    workerResource?.settle();
    resolveSettlement(value);
  };
  worker.once('message', (value: unknown) => {
    const record = typeof value === 'object' && value !== null
      ? value as { readonly ok?: unknown; readonly byteLength?: unknown }
      : null;
    finish(record?.ok === true && record.byteLength === input.byteLength);
  });
  worker.once('messageerror', () => finish(false));
  worker.once('error', () => finish(false));
  worker.once('exit', (code: number) => {
    if (code !== 0) finish(false);
  });
  worker.postMessage({ handle, bytes: new Uint8Array(input) });
  return Object.freeze({
    settlement,
    abort(): void {
      if (!settled) void worker.terminate().then(() => finish(false), () => finish(false));
    }
  });
}

function observedCommandInputCapability(
  input: Buffer,
  nativeResourceLedger?: ObservedNativeProcessResourceLedger
): ObservedCommandInputCapability {
  const capability: ObservedCommandInputCapability = {
    input,
    startWindowsWriter(handle, closeHandle) {
      return startWindowsObservedStdinWriter(handle, input, closeHandle, nativeResourceLedger);
    }
  };
  return Object.freeze(capability);
}

export async function runObservedCommand(
  command: string,
  args: readonly string[],
  options: ObservedCommandOptions
): Promise<ObservedCommandOutcome> {
  const commandInput = copyBoundedCommandInput(
    options.input,
    options.maxStdinBytes,
    'observed command stdin'
  );
  const { input: _input, maxStdinBytes: _maxStdinBytes, ...coreOptions } = options;
  return runObservedCommandCore(
    command,
    args,
    coreOptions,
    commandInput === null
      ? undefined
      : observedCommandInputCapability(commandInput, options.nativeResourceLedger)
  );
}
