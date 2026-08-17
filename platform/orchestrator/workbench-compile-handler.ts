import { compileWorkspace } from './pipeline-orchestrator.ts';

export interface CompileStreamContext {
  workspaceRoot: string;
  acquire: () => Promise<() => void>;
}

const WORKBENCH_COMPILE_HEARTBEAT_MS = 5_000;

function encodeSse(event: string, data: string): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${data}\n\n`);
}

export function createWorkbenchCompileStream(context: CompileStreamContext): ReadableStream<Uint8Array> {
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let cancelled = false;
  const stopHeartbeat = (): void => {
    if (!heartbeat) return;
    clearInterval(heartbeat);
    heartbeat = undefined;
  };

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
          stopHeartbeat();
        }
      };
      const log = (message: string): void => emit('log', message);
      heartbeat = setInterval(() => emit('heartbeat', 'keep-alive'), WORKBENCH_COMPILE_HEARTBEAT_MS);

      try {
        log('Starting canonical compilation pipeline...');
        const result = await compileWorkspace(context.workspaceRoot, {
          source: 'workbench',
          applyWorkbenchMutations: true,
          verificationLane: 'all',
          onEvent: (event) => log(`[${event.type}] ${event.message}`)
        });
        log(`Compilation transaction ${result.transactionId} finished successfully.`);
        emit('success', 'done');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log(`[ERROR] Compilation failed: ${message}`);
        emit('failure', message);
      } finally {
        stopHeartbeat();
        // Client cancellation only ends the subscription. compileWorkspace has
        // no caller AbortSignal contract, so the Workbench execution mutex must
        // remain held until the real pipeline operation settles.
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
      stopHeartbeat();
      // Do not release the mutex here. If execution has started, release would
      // falsely advertise terminal state while compileWorkspace is still live.
      // If cancellation happened while waiting, start() releases immediately
      // after acquisition without starting compilation.
    }
  });
}
