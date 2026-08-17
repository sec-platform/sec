import { serve } from 'bun';
import fs from 'node:fs/promises';
import path from 'node:path';

import { bootstrapAuthorizedSlotSource } from '../compiler/workbench/bootstrap-slot-source.ts';
import { loadAllManifests } from '../compiler/parse/load-manifest.ts';
import { compareCodeUnits } from '../shared/canonical-primitives.ts';
import { ensureDir, pathExists, writeJson } from '../shared/fs.ts';
import { defaultLogger } from '../shared/logger.ts';
import {
  controlWorkbenchViewsRelativePath,
  getWorkspacePaths,
  sourceSlotsRelativePath
} from '../shared/paths.ts';
import {
  assertWorkspaceWriteLease,
  withWorkspaceWriteLease,
  WorkspaceWriteLeaseError,
  type WorkspaceWriteLeaseToken
} from '../shared/workspace-write-lease.ts';
import { createWorkbenchCompileStream } from './workbench-compile-handler.ts';
import {
  logWorkbenchHttp,
  logWorkbenchMutex,
  WORKBENCH_COLORS,
  WORKBENCH_SECURITY_HEADERS,
  workbenchErrorResponse,
  workbenchJsonResponse,
  WorkbenchMutex,
  workbenchSseResponse
} from './workbench-http-support.ts';

const SLOT_ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const NODE_ID_PATTERN = /^[A-Za-z0-9_.\/-]+$/u;
const MAX_NODE_ID_LENGTH = 256;
const MAX_MUTATION_BODY_BYTES = 1024 * 1024;

interface BootstrapSlotBody {
  slotId: string;
  block: string;
}

interface RunNodeBody {
  type: 'slot' | 'block';
  id: string;
}

interface RouteContext {
  req: Request;
  url: URL;
  method: string;
  reqPath: string;
  startTime: number;
  workspaceRoot: string;
  paths: ReturnType<typeof getWorkspacePaths>;
}

type RouteHandler = (context: RouteContext) => Promise<Response>;

async function withWorkbenchWriterLease(
  context: RouteContext,
  operation: (token: WorkspaceWriteLeaseToken) => Promise<Response>
): Promise<Response> {
  try {
    return await withWorkspaceWriteLease(context.workspaceRoot, undefined, operation);
  } catch (error) {
    if (error instanceof WorkspaceWriteLeaseError) {
      return workbenchErrorResponse('Workspace writer is busy', 409);
    }
    throw error;
  }
}

interface RouteEntry {
  method: string | null;
  path: string;
  handler: RouteHandler;
}

interface SubprocessHandle {
  kill(): void;
  readonly exited: Promise<number>;
  readonly stdout: ReadableStream<Uint8Array>;
  readonly stderr: ReadableStream<Uint8Array>;
}

function encodeSse(event: string, data: string): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${data}\n\n`);
}

function isSafeSlotId(value: unknown): value is string {
  return typeof value === 'string' && SLOT_ID_PATTERN.test(value);
}

function isSafeNodeId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_NODE_ID_LENGTH
    && NODE_ID_PATTERN.test(value)
    && !value.includes('..');
}

function sameOriginOrNonBrowser(req: Request): boolean {
  const origin = req.headers.get('origin');
  return origin === null || origin === new URL(req.url).origin;
}

async function readBoundedJson(req: Request, maxBytes: number): Promise<unknown> {
  const declaredLength = req.headers.get('content-length');
  if (declaredLength !== null) {
    const length = Number.parseInt(declaredLength, 10);
    if (!Number.isSafeInteger(length) || length < 0 || length > maxBytes) {
      throw new Error(`Request body exceeds the ${maxBytes}-byte Workbench limit`);
    }
  }
  const text = await req.text();
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    throw new Error(`Request body exceeds the ${maxBytes}-byte Workbench limit`);
  }
  return JSON.parse(text) as unknown;
}

function parseBootstrapSlotBody(value: unknown): BootstrapSlotBody | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (!isSafeSlotId(body.slotId) || !isSafeNodeId(body.block)) return null;
  return { slotId: body.slotId, block: body.block };
}

function parseRunNodeBody(value: unknown): RunNodeBody | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if ((body.type !== 'slot' && body.type !== 'block') || !isSafeNodeId(body.id)) return null;
  if (body.type === 'slot' && !isSafeSlotId(body.id)) return null;
  return { type: body.type, id: body.id };
}

async function handleBlocksCatalog(context: RouteContext): Promise<Response> {
  const entries = await loadAllManifests({ workspaceRoot: context.workspaceRoot });
  return workbenchJsonResponse(entries.map((entry) => entry.manifest));
}

async function handleBootstrapSlot(context: RouteContext): Promise<Response> {
  const body = parseBootstrapSlotBody(await readBoundedJson(context.req, 16 * 1024));
  if (!body) return workbenchErrorResponse('Invalid slotId or block identity', 400);

  return withWorkbenchWriterLease(context, async (token) => {
    const commitFence = () => assertWorkspaceWriteLease(context.workspaceRoot, token);
    const result = await bootstrapAuthorizedSlotSource(
      context.workspaceRoot,
      body.block,
      body.slotId,
      commitFence
    );
    return workbenchJsonResponse({
      status: 'success',
      disposition: result.status,
      path: result.path
    });
  });
}

async function handleSlotCode(context: RouteContext): Promise<Response> {
  const slotId = context.url.searchParams.get('slotId');
  if (!isSafeSlotId(slotId)) return workbenchErrorResponse('Invalid slotId parameter', 400);

  const targetPath = path.join(context.workspaceRoot, sourceSlotsRelativePath, `${slotId}.ts`);
  const exists = await pathExists(targetPath);
  if (!exists) return workbenchJsonResponse({ error: 'Slot code file not found', code: '' }, 404);
  const metadata = await fs.lstat(targetPath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    return workbenchErrorResponse('Slot code path is not one ordinary file', 409);
  }
  return workbenchJsonResponse({ code: await fs.readFile(targetPath, 'utf8') });
}

async function handleGraph(context: RouteContext): Promise<Response> {
  return workbenchJsonResponse(JSON.parse(await fs.readFile(context.paths.explainGraphPath, 'utf8')));
}

async function handleReview(context: RouteContext): Promise<Response> {
  return workbenchJsonResponse(JSON.parse(await fs.readFile(context.paths.reviewSummaryPath, 'utf8')));
}

async function handleMutations(context: RouteContext): Promise<Response> {
  const body = await readBoundedJson(context.req, MAX_MUTATION_BODY_BYTES);
  return withWorkbenchWriterLease(context, async (token) => {
    const commitFence = () => assertWorkspaceWriteLease(context.workspaceRoot, token);
    await ensureDir(context.paths.sourceViewMutationsRoot, commitFence);
    await writeJson(
      path.join(context.paths.sourceViewMutationsRoot, 'graph-action.json'),
      body,
      commitFence
    );
    return workbenchJsonResponse({ status: 'success' });
  });
}

async function findBlockTest(workspaceRoot: string, blockId: string): Promise<string | null> {
  const normalizedId = blockId.replace(/[\/\-_]/g, '').toLowerCase();
  const testsDir = path.join(workspaceRoot, 'tests');
  const matchedFiles: string[] = [];

  const searchDirectory = async (directory: string): Promise<void> => {
    const entries = (await fs.readdir(directory, { withFileTypes: true }))
      .sort((left, right) => compareCodeUnits(left.name, right.name));
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await searchDirectory(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
        const name = entry.name.toLowerCase();
        if (name.includes(normalizedId) || normalizedId.includes(name.replace('.test.ts', ''))) {
          matchedFiles.push(fullPath);
        }
      }
    }
  };

  try {
    await searchDirectory(testsDir);
  } catch {
    return null;
  }
  return matchedFiles.length === 1 ? matchedFiles[0]! : null;
}

async function commandForNode(context: RouteContext, body: RunNodeBody, log: (message: string) => void): Promise<string[] | null> {
  if (body.type === 'slot') {
    const slotFile = path.join(context.workspaceRoot, sourceSlotsRelativePath, `${body.id}.ts`);
    const metadata = await fs.lstat(slotFile).catch(() => null);
    if (!metadata?.isFile() || metadata.isSymbolicLink()) return null;
    log('   Found slot implementation file.');
    return ['bun', 'test', 'tests/unit/validate-slot-security.test.ts'];
  }

  const matchedFile = await findBlockTest(context.workspaceRoot, body.id);
  if (matchedFile) {
    const relativePath = path.relative(context.workspaceRoot, matchedFile);
    log(`   Matched test suite: ${relativePath}`);
    return ['bun', 'test', relativePath];
  }
  return ['bun', 'run', 'sec', 'verify', '--lane', 'fast'];
}

async function readProcessStream(
  stream: ReadableStream<Uint8Array>,
  log: (message: string) => void
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let pending = '';
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
}

async function handleRunNodeSse(context: RouteContext, mutex: WorkbenchMutex): Promise<Response> {
  const body = parseRunNodeBody(await readBoundedJson(context.req, 16 * 1024));
  if (!body) return workbenchErrorResponse('Invalid run-node request', 400);

  let activeProcess: SubprocessHandle | null = null;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const release = await mutex.acquire();
      const log = (message: string): void => {
        try {
          controller.enqueue(encodeSse('log', message));
        } catch {
          // Stream already closed.
        }
      };

      try {
        log(`[Runner] Initializing verify worker for ${body.type} "${body.id}"...`);
        const command = await commandForNode(context, body, log);
        if (!command) {
          log('[ERROR] Physical slot handler file does not exist.');
          controller.enqueue(encodeSse('failure', 'Slot file not found'));
          return;
        }

        log(`[Runner] Executing: ${command.join(' ')}`);
        activeProcess = Bun.spawn(command, {
          cwd: context.workspaceRoot,
          stdout: 'pipe',
          stderr: 'pipe'
        }) as unknown as SubprocessHandle;
        await Promise.all([
          readProcessStream(activeProcess.stdout, log),
          readProcessStream(activeProcess.stderr, log)
        ]);
        const exitCode = await activeProcess.exited;
        if (exitCode === 0) {
          log('[Runner] Execution completed successfully!');
          controller.enqueue(encodeSse('success', 'passed'));
        } else {
          log(`[ERROR] Verification exited with non-zero code: ${exitCode}`);
          controller.enqueue(encodeSse('failure', 'failed'));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log(`[ERROR] Process execution crashed: ${message}`);
        try {
          controller.enqueue(encodeSse('failure', 'crashed'));
        } catch {
          // Stream already closed.
        }
      } finally {
        activeProcess = null;
        release();
        try {
          controller.close();
        } catch {
          // Stream already closed.
        }
      }
    },
    cancel() {
      activeProcess?.kill();
    }
  });

  return workbenchSseResponse(stream);
}

const CONTENT_TYPES: Record<string, string> = {
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json'
};

async function serveStaticFile(viewsDir: string, reqPath: string, startTime: number): Promise<Response> {
  const filePath = reqPath === '/' ? '/overview-view.html' : reqPath;
  const targetFilePath = path.join(viewsDir, filePath);
  const relative = path.relative(viewsDir, targetFilePath);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    logWorkbenchHttp('GET', reqPath, 403, 'Forbidden', Date.now() - startTime, WORKBENCH_COLORS.red);
    return new Response('Forbidden', {
      status: 403,
      headers: new Headers(WORKBENCH_SECURITY_HEADERS)
    });
  }

  try {
    const fileContent = await fs.readFile(targetFilePath);
    const headers = new Headers(WORKBENCH_SECURITY_HEADERS);
    headers.set('Content-Type', CONTENT_TYPES[path.extname(filePath)] ?? 'text/html');
    headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    logWorkbenchHttp('GET', reqPath, 200, 'OK', Date.now() - startTime, WORKBENCH_COLORS.green);
    return new Response(fileContent, { headers });
  } catch {
    logWorkbenchHttp('GET', reqPath, 404, 'Not Found', Date.now() - startTime, WORKBENCH_COLORS.yellow);
    return new Response('Not Found', {
      status: 404,
      headers: new Headers(WORKBENCH_SECURITY_HEADERS)
    });
  }
}

function wrapHandler(handler: RouteHandler): RouteHandler {
  return async (context) => {
    try {
      const response = await handler(context);
      const color = response.status >= 500
        ? WORKBENCH_COLORS.red
        : response.status >= 400
          ? WORKBENCH_COLORS.yellow
          : WORKBENCH_COLORS.green;
      const statusText = response.status >= 500 ? 'Internal Error' : response.status >= 400 ? 'Bad Request' : 'OK';
      logWorkbenchHttp(
        context.method,
        context.reqPath,
        response.status,
        statusText,
        Date.now() - context.startTime,
        color
      );
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logWorkbenchHttp(context.method, context.reqPath, 500, 'Internal Error', Date.now() - context.startTime, WORKBENCH_COLORS.red);
      return workbenchErrorResponse(message, 500);
    }
  };
}

export async function startWorkbenchServer(workspaceRoot: string, port: number): Promise<ReturnType<typeof serve>> {
  const paths = getWorkspacePaths(workspaceRoot);
  const viewsDir = path.join(workspaceRoot, controlWorkbenchViewsRelativePath);
  const mutex = new WorkbenchMutex();
  const routes: RouteEntry[] = [
    { method: null, path: '/api/blocks-catalog', handler: wrapHandler(handleBlocksCatalog) },
    { method: 'POST', path: '/api/bootstrap-slot', handler: wrapHandler(handleBootstrapSlot) },
    { method: null, path: '/api/slot-code', handler: wrapHandler(handleSlotCode) },
    { method: null, path: '/api/graph', handler: wrapHandler(handleGraph) },
    { method: null, path: '/api/review', handler: wrapHandler(handleReview) },
    { method: 'POST', path: '/api/mutations', handler: wrapHandler(handleMutations) }
  ];

  const server = serve({
    hostname: '127.0.0.1',
    port,
    async fetch(req) {
      const startTime = Date.now();
      const url = new URL(req.url);
      const reqPath = url.pathname;
      const method = req.method;

      if (!sameOriginOrNonBrowser(req)) {
        logWorkbenchHttp(method, reqPath, 403, 'Forbidden', Date.now() - startTime, WORKBENCH_COLORS.red);
        return workbenchErrorResponse('Cross-origin Workbench requests are forbidden', 403);
      }

      if (method === 'OPTIONS') {
        const response = new Response(null, {
          status: 204,
          headers: new Headers(WORKBENCH_SECURITY_HEADERS)
        });
        logWorkbenchHttp('OPTIONS', reqPath, 204, 'No Content', Date.now() - startTime, WORKBENCH_COLORS.green);
        return response;
      }

      const context: RouteContext = {
        req,
        url,
        method,
        reqPath,
        startTime,
        workspaceRoot,
        paths
      };

      if (reqPath === '/api/compile' && method === 'POST') {
        const stream = createWorkbenchCompileStream({
          workspaceRoot,
          acquire: () => mutex.acquire()
        });
        return workbenchSseResponse(stream);
      }

      if (reqPath === '/api/run-node' && method === 'POST') {
        try {
          return await handleRunNodeSse(context, mutex);
        } catch (error) {
          return workbenchErrorResponse(error instanceof Error ? error.message : String(error), 400);
        }
      }

      for (const route of routes) {
        if (route.path !== reqPath) continue;
        if (route.method !== null && route.method !== method) continue;
        return route.handler(context);
      }

      return serveStaticFile(viewsDir, reqPath, startTime);
    }
  });

  const actualPort = server.port ?? port;
  defaultLogger.info('Workbench server listening', {
    url: `http://127.0.0.1:${actualPort}`,
    viewsDir
  });
  logWorkbenchMutex(`Workbench server serving ${viewsDir}`);
  return server;
}
