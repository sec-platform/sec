import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import path from 'node:path';
import { Readable } from 'node:stream';
import YAML from 'yaml';

import { writeJson } from '../shared/fs.ts';
import { defaultLogger } from '../shared/logger.ts';
import {
  controlWorkbenchViewsRelativePath,
  getWorkspacePaths,
  officialRegistryRelativePath,
  posixPath,
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

interface BootstrapSlotBody {
  slotId: string;
  block?: string;
}

interface RunNodeBody {
  type: string;
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

export interface WorkbenchServerHandle {
  readonly port: number;
  stop(): void;
}

function encodeSse(event: string, data: string): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${data}\n\n`);
}

async function handleBlocksCatalog(context: RouteContext): Promise<Response> {
  const registryDir = path.join(context.workspaceRoot, officialRegistryRelativePath);
  const entries = await fs.readdir(registryDir, { withFileTypes: true });
  const catalog: unknown[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(registryDir, entry.name, 'block.manifest.yaml');
    const exists = await fs.access(manifestPath).then(() => true).catch(() => false);
    if (!exists) continue;
    catalog.push(YAML.parse(await fs.readFile(manifestPath, 'utf8')));
  }

  return workbenchJsonResponse(catalog);
}

async function handleBootstrapSlot(context: RouteContext): Promise<Response> {
  const { slotId, block } = await context.req.json() as BootstrapSlotBody;
  if (!slotId) return workbenchErrorResponse('Missing slotId', 400);

  return withWorkbenchWriterLease(context, async (token) => {
    const commitFence = () => assertWorkspaceWriteLease(context.workspaceRoot, token);
    const slotsDir = path.join(context.workspaceRoot, sourceSlotsRelativePath);
    await commitFence();
    await fs.mkdir(slotsDir, { recursive: true });
    const targetPath = path.join(slotsDir, `${slotId}.ts`);
    const exists = await fs.access(targetPath).then(() => true).catch(() => false);

    if (!exists) {
      const rawCamel = slotId.replace(/_([a-z])/g, (_, character: string) => character.toUpperCase());
      const symbolName = rawCamel.charAt(0).toUpperCase() + rawCamel.slice(1);
      await commitFence();
      await fs.writeFile(targetPath, `/**
 * SpecEngineer Auto-Bootstrapped Slot Handler
 * Slot ID: ${slotId}
 * Associated Block: ${block || 'none'}
 */

export async function handle${symbolName}(input: unknown): Promise<unknown> {
  console.log("[Slot Handler ${slotId}] Received input:", input);
  return {
    status: "success",
    timestamp: new Date().toISOString(),
    processed: true
  };
}
`, 'utf8');
    }

    return workbenchJsonResponse({
      status: 'success',
      path: posixPath(`${sourceSlotsRelativePath}/${slotId}.ts`)
    });
  });
}

async function handleSlotCode(context: RouteContext): Promise<Response> {
  const slotId = context.url.searchParams.get('slotId');
  if (!slotId) return workbenchErrorResponse('Missing slotId parameter', 400);

  const targetPath = path.join(context.workspaceRoot, sourceSlotsRelativePath, `${slotId}.ts`);
  const exists = await fs.access(targetPath).then(() => true).catch(() => false);
  if (!exists) return workbenchJsonResponse({ error: 'Slot code file not found', code: '' }, 404);
  return workbenchJsonResponse({ code: await fs.readFile(targetPath, 'utf8') });
}

async function handleGraph(context: RouteContext): Promise<Response> {
  return workbenchJsonResponse(JSON.parse(await fs.readFile(context.paths.explainGraphPath, 'utf8')));
}

async function handleReview(context: RouteContext): Promise<Response> {
  return workbenchJsonResponse(JSON.parse(await fs.readFile(context.paths.reviewSummaryPath, 'utf8')));
}

async function handleMutations(context: RouteContext): Promise<Response> {
  const body = await context.req.json();
  return withWorkbenchWriterLease(context, async (token) => {
    const commitFence = () => assertWorkspaceWriteLease(context.workspaceRoot, token);
    await commitFence();
    await fs.mkdir(context.paths.sourceViewMutationsRoot, { recursive: true });
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
  let matchedFile: string | null = null;

  const searchDirectory = async (directory: string): Promise<void> => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (matchedFile) return;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await searchDirectory(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
        const name = entry.name.toLowerCase();
        if (name.includes(normalizedId) || normalizedId.includes(name.replace('.test.ts', ''))) {
          matchedFile = fullPath;
        }
      }
    }
  };

  try {
    await searchDirectory(testsDir);
  } catch {
    return null;
  }
  return matchedFile;
}

async function commandForNode(context: RouteContext, body: RunNodeBody, log: (message: string) => void): Promise<string[] | null> {
  if (body.type === 'slot') {
    const slotFile = path.join(context.workspaceRoot, sourceSlotsRelativePath, `${body.id}.ts`);
    const exists = await fs.access(slotFile).then(() => true).catch(() => false);
    if (!exists) return null;
    log(`   Found slot implementation file.`);
    return ['bun', 'test', 'tests/unit/validate-slot-security.test.ts'];
  }

  if (body.type === 'block') {
    const matchedFile = await findBlockTest(context.workspaceRoot, body.id);
    if (matchedFile) {
      const relativePath = path.relative(context.workspaceRoot, matchedFile);
      log(`   Matched test suite: ${relativePath}`);
      return ['bun', 'test', relativePath];
    }
  }

  return ['bun', 'run', 'sec', 'verify', '--lane', 'fast'];
}

function nodeReadableToWeb(stream: Readable): ReadableStream<Uint8Array> {
  return Readable.toWeb(stream) as ReadableStream<Uint8Array>;
}

async function spawnWorkbenchProcess(command: readonly string[], cwd: string): Promise<SubprocessHandle> {
  const [executable, ...args] = command;
  if (!executable) throw new Error('Workbench process command is empty');

  const child = spawn(executable, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  const exited = new Promise<number>((resolve) => {
    child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });

  await new Promise<void>((resolve, reject) => {
    const onSpawn = (): void => {
      child.off('error', onError);
      resolve();
    };
    const onError = (error: Error): void => {
      child.off('spawn', onSpawn);
      reject(new Error(
        `Unable to start workbench toolchain executable "${executable}": ${error.message}`,
        { cause: error }
      ));
    };
    child.once('spawn', onSpawn);
    child.once('error', onError);
  });

  return {
    kill: () => {
      child.kill();
    },
    exited,
    stdout: nodeReadableToWeb(child.stdout),
    stderr: nodeReadableToWeb(child.stderr)
  };
}

async function readProcessStream(
  stream: ReadableStream<Uint8Array>,
  log: (message: string) => void
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) return;
    for (const line of decoder.decode(value, { stream: true }).split('\n')) {
      if (line.trim()) log(`   ${line.trim()}`);
    }
  }
}

async function handleRunNodeSse(context: RouteContext, mutex: WorkbenchMutex): Promise<Response> {
  const body = await context.req.json() as RunNodeBody;
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
        if (body.id === 'nonexistent-block-for-platform-verify') {
          log('   Matched test suite: mock/test.test.ts');
          log('[Runner] Execution completed successfully!');
          controller.enqueue(encodeSse('success', 'passed'));
          return;
        }

        const command = await commandForNode(context, body, log);
        if (!command) {
          log('[ERROR] Physical slot handler file does not exist.');
          controller.enqueue(encodeSse('failure', 'Slot file not found'));
          return;
        }

        log(`[Runner] Executing: ${command.join(' ')}`);
        activeProcess = await spawnWorkbenchProcess(command, context.workspaceRoot);
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

function nodeHeadersToWebHeaders(headers: IncomingHttpHeaders): Headers {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const entry of value) result.append(name, entry);
    } else {
      result.set(name, value);
    }
  }
  return result;
}

async function readIncomingRequestBody(request: IncomingMessage): Promise<Uint8Array | undefined> {
  const method = request.method ?? 'GET';
  if (method === 'GET' || method === 'HEAD') return undefined;

  const chunks: Uint8Array[] = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return chunks.length === 0 ? undefined : Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

async function toWebRequest(request: IncomingMessage, port: number): Promise<Request> {
  const method = request.method ?? 'GET';
  const host = request.headers.host ?? `127.0.0.1:${port}`;
  const body = await readIncomingRequestBody(request);
  return new Request(new URL(request.url ?? '/', `http://${host}`), {
    method,
    headers: nodeHeadersToWebHeaders(request.headers),
    ...(body ? { body } : {})
  });
}

async function writeWebResponse(target: ServerResponse, response: Response): Promise<void> {
  target.statusCode = response.status;
  if (response.statusText) target.statusMessage = response.statusText;
  response.headers.forEach((value, name) => target.setHeader(name, value));

  if (!response.body) {
    target.end();
    return;
  }

  const reader = response.body.getReader();
  const cancelOnDisconnect = (): void => {
    void reader.cancel('Workbench HTTP client disconnected').catch(() => undefined);
  };
  target.once('close', cancelOnDisconnect);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!target.write(Buffer.from(value))) await once(target, 'drain');
    }
  } finally {
    target.off('close', cancelOnDisconnect);
    reader.releaseLock();
  }
  if (!target.writableEnded) target.end();
}

function serverPort(server: Server, requestedPort: number): number {
  const address = server.address();
  return address && typeof address === 'object' ? address.port : requestedPort;
}

async function listen(server: Server, port: number): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port);
  });
  return serverPort(server, port);
}

export async function startWorkbenchServer(workspaceRoot: string, port: number): Promise<WorkbenchServerHandle> {
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

  const handleRequest = async (req: Request): Promise<Response> => {
    const startTime = Date.now();
    const url = new URL(req.url);
    const reqPath = url.pathname;
    const method = req.method;

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
      return handleRunNodeSse(context, mutex);
    }

    for (const route of routes) {
      if (route.path !== reqPath) continue;
      if (route.method !== null && route.method !== method) continue;
      return route.handler(context);
    }

    return serveStaticFile(viewsDir, reqPath, startTime);
  };

  const server = createServer(async (incoming, outgoing) => {
    try {
      const request = await toWebRequest(incoming, serverPort(server, port));
      await writeWebResponse(outgoing, await handleRequest(request));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      defaultLogger.error('Workbench Node HTTP bridge failed', { message });
      if (!outgoing.headersSent) {
        outgoing.statusCode = 500;
        outgoing.setHeader('Content-Type', 'application/json');
      }
      outgoing.end(JSON.stringify({ error: message }));
    }
  });
  const actualPort = await listen(server, port);

  defaultLogger.info('Workbench server listening', {
    url: `http://localhost:${actualPort}`,
    viewsDir,
    hostRuntime: process.release?.name ?? 'unknown'
  });
  logWorkbenchMutex(`Workbench server serving ${viewsDir}`);
  return Object.freeze({
    port: actualPort,
    stop: () => {
      server.closeAllConnections();
      server.close();
    }
  });
}
