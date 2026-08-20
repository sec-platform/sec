export interface WorkbenchRunNodeProcess {
  kill(): void;
  readonly exited: Promise<number>;
  readonly stdout: ReadableStream<Uint8Array>;
  readonly stderr: ReadableStream<Uint8Array>;
}

export interface WorkbenchRunNodeStreamContext {
  readonly acquire: () => Promise<() => void>;
  readonly resolveCommand: (log: (message: string) => void) => Promise<string[] | null>;
  readonly spawn: (command: string[]) => WorkbenchRunNodeProcess;
  readonly initialMessage: string;
}

function encodeSse(event: string, data: string): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${data}\n\n`);
}

async function readProcessStream(
  stream: ReadableStream<Uint8Array>,
  log: (message: string) => void
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      pending += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) if (line.trim()) log(`   ${line.trim()}`);
      if (done) {
        if (pending.trim()) log(`   ${pending.trim()}`);
        return;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Mechanical SSE/process lifecycle for a Workbench run-node request.
 * Cancellation is a subscription/execution signal, not mutex settlement:
 * - while queued, a cancelled request releases immediately after acquisition
 *   and never resolves or starts a command;
 * - while resolving, it never starts a process after resolution returns;
 * - while executing, it kills the process but retains the mutex until stdout,
 *   stderr, and the physical process terminal have all settled.
 */
export function createWorkbenchRunNodeStream(
  context: WorkbenchRunNodeStreamContext
): ReadableStream<Uint8Array> {
  let activeProcess: WorkbenchRunNodeProcess | null = null;
  let cancelled = false;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const release = await context.acquire();
      if (cancelled) {
        release();
        return;
      }

      const emit = (event: string, data: string): void => {
        if (cancelled) return;
        try {
          controller.enqueue(encodeSse(event, data));
        } catch {
          cancelled = true;
          activeProcess?.kill();
        }
      };
      const log = (message: string): void => emit('log', message);

      try {
        log(context.initialMessage);
        const command = await context.resolveCommand(log);
        if (cancelled) return;
        if (!command) {
          log('[ERROR] Physical slot handler file does not exist.');
          emit('failure', 'Slot file not found');
          return;
        }

        log(`[Runner] Executing: ${command.join(' ')}`);
        activeProcess = context.spawn(command);
        if (cancelled) activeProcess.kill();

        const [exitCode] = await Promise.all([
          activeProcess.exited,
          readProcessStream(activeProcess.stdout, log),
          readProcessStream(activeProcess.stderr, log)
        ]);
        if (cancelled) return;
        if (exitCode === 0) {
          log('[Runner] Execution completed successfully!');
          emit('success', 'passed');
        } else {
          log(`[ERROR] Verification exited with non-zero code: ${exitCode}`);
          emit('failure', 'failed');
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : String(error);
          log(`[ERROR] Process execution crashed: ${message}`);
          emit('failure', 'crashed');
        }
      } finally {
        activeProcess = null;
        release();
        if (!cancelled) {
          try {
            controller.close();
          } catch {
            // Stream already closed.
          }
        }
      }
    },
    cancel() {
      cancelled = true;
      activeProcess?.kill();
    }
  });
}
