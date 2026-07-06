import { compileWorkspace } from './pipeline-orchestrator.ts';

export interface CompileStreamContext {
  workspaceRoot: string;
  acquire: () => Promise<() => void>;
}

function encodeSse(event: string, data: string): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${data}\n\n`);
}

export function createWorkbenchCompileStream(context: CompileStreamContext): ReadableStream<Uint8Array> {
  let release: (() => void) | undefined;
  let released = false;
  const releaseOnce = (): void => {
    if (released) return;
    released = true;
    release?.();
  };

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      release = await context.acquire();
      const log = (message: string): void => {
        try {
          controller.enqueue(encodeSse('log', message));
        } catch {
          // Stream already closed.
        }
      };

      try {
        log('Starting canonical compilation pipeline...');
        const result = await compileWorkspace(context.workspaceRoot, {
          source: 'workbench',
          applyWorkbenchMutations: true,
          verificationLane: 'all',
          onEvent: (event) => log(`[${event.type}] ${event.message}`)
        });
        log(`Compilation transaction ${result.transactionId} finished successfully.`);
        controller.enqueue(encodeSse('success', 'done'));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log(`[ERROR] Compilation failed: ${message}`);
        try {
          controller.enqueue(encodeSse('failure', message));
        } catch {
          // Stream already closed.
        }
      } finally {
        releaseOnce();
        try {
          controller.close();
        } catch {
          // Stream already closed.
        }
      }
    },
    cancel() {
      releaseOnce();
    }
  });
}
