import { defaultLogger } from '../shared/logger.ts';

export class WorkbenchMutex {
  private queue: Array<() => void> = [];
  private locked = false;

  async acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      const grant = (): void => {
        let released = false;
        this.locked = true;
        resolve(() => {
          if (released) return;
          released = true;
          const next = this.queue.shift();
          if (next) next();
          else this.locked = false;
        });
      };

      if (this.locked) this.queue.push(grant);
      else grant();
    });
  }
}

export const WORKBENCH_COLORS = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
} as const;

/**
 * Workbench is same-origin and loopback-only. CORS headers are deliberately
 * absent: a random web origin must not be granted browser access to local
 * source mutation or process-execution endpoints.
 */
export const WORKBENCH_SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cross-Origin-Opener-Policy': 'same-origin'
};

const SSE_HEADERS: Record<string, string> = {
  ...WORKBENCH_SECURITY_HEADERS,
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive'
};

export function logWorkbenchMutex(message: string): void {
  defaultLogger.debug(message);
}

export function logWorkbenchHttp(
  method: string,
  reqPath: string,
  status: number,
  statusText: string,
  elapsedMs: number,
  color: string
): void {
  const level = color === WORKBENCH_COLORS.red
    ? 'error'
    : color === WORKBENCH_COLORS.yellow
      ? 'warn'
      : 'info';
  defaultLogger[level]('HTTP request', {
    method,
    path: reqPath,
    status,
    statusText,
    elapsedMs
  });
}

export function workbenchJsonResponse(body: unknown, status = 200): Response {
  const headers = new Headers(WORKBENCH_SECURITY_HEADERS);
  headers.set('Content-Type', 'application/json');
  const responseBody = typeof body === 'object' && body !== null ? JSON.stringify(body) : String(body);
  return new Response(responseBody, { status, headers });
}

export function workbenchErrorResponse(message: string, status: number): Response {
  return workbenchJsonResponse({ error: message }, status);
}

export function workbenchSseResponse(stream: ReadableStream<Uint8Array>): Response {
  return new Response(stream, { headers: new Headers(SSE_HEADERS) });
}
