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
  let release: (() => void) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let released = false;
  const releaseOnce = (): void => {
    if (released) return;
    released = true;
    release?.();
  };
  const stopHeartbeat = (): void => {
    if (!heartbeat) return;
    clearInterval(heartbeat);
    heartbeat = undefined;
  };

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      release = await context.acquire();
      const emit = (event: string, data: string): void => {
        try {
          controller.enqueue(encodeSse(event, data));
        } catch {
          // Stream already closed.
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
        releaseOnce();
        try {
          controller.close();
        } catch {
          // Stream already closed.
        }
      }
    },
    cancel() {
      stopHeartbeat();
      releaseOnce();
    }
  });
}
