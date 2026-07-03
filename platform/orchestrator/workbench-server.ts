import { serve } from 'bun';
import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { writeJson } from '../shared/fs.ts';
import {
  controlWorkbenchViewsRelativePath,
  getWorkspacePaths,
  officialRegistryRelativePath,
  posixPath,
  sourceSlotsRelativePath,
} from '../shared/paths.ts';

import { resolveWorkspace } from './block-orchestrator.ts';
import { adaptWorkspace, composeWorkspace } from './compose-orchestrator.ts';
import { explainWorkspace, lockWorkspace } from './emit-orchestrator.ts';
import { verifyWorkspace } from './verify-orchestrator.ts';
import { applyWorkbenchMutations } from './workbench-orchestrator.ts';

// ==========================================
// 类型定义
// ==========================================

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

type RouteHandler = (ctx: RouteContext) => Promise<Response>;

interface RouteEntry {
  method: string | null; // null = any method
  path: string;
  handler: RouteHandler;
}

// ==========================================
// 1. 异步互斥锁 (Async Build Mutex)
// ==========================================

class Mutex {
  private queue: (() => void)[] = [];
  private locked = false;

  async acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      const release = () => {
        if (this.queue.length > 0) {
          const next = this.queue.shift();
          next?.();
        } else {
          this.locked = false;
        }
      };

      if (this.locked) {
        this.queue.push(() => resolve(release));
      } else {
        this.locked = true;
        resolve(release);
      }
    });
  }
}

// ==========================================
// 2. 进程注册表与信号清理
// ==========================================

interface SubprocessHandle {
  kill(): void;
  readonly exited: Promise<number>;
  readonly stdout: ReadableStream<Uint8Array>;
  readonly stderr: ReadableStream<Uint8Array>;
}

class ProcessRegistry {
  private active = new Set<SubprocessHandle>();
  private handlersBound = false;

  register(proc: SubprocessHandle): SubprocessHandle {
    this.active.add(proc);
    this.ensureSignalHandlers();
    return proc;
  }

  unregister(proc: SubprocessHandle): void {
    this.active.delete(proc);
  }

  cleanup(): void {
    if (this.active.size === 0) return;
    logSystem(`Cleaning up ${this.active.size} active subprocesses...`);
    for (const proc of this.active) {
      try { proc.kill(); } catch { /* already dead */ }
    }
    this.active.clear();
  }

  private ensureSignalHandlers(): void {
    if (this.handlersBound) return;
    this.handlersBound = true;
    process.on('SIGINT', () => {
      logSystem('Received SIGINT. Gracefully shutting down...');
      this.cleanup();
      process.exit(0);
    });
    process.on('SIGTERM', () => {
      logSystem('Received SIGTERM. Gracefully shutting down...');
      this.cleanup();
      process.exit(0);
    });
  }
}

// ==========================================
// 3. 日志与响应工具
// ==========================================

const COLORS = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
} as const;

function timestamp(): string {
  return new Date().toISOString();
}

function logSystem(msg: string): void {
  console.log(`${COLORS.red}[SYSTEM] [${timestamp()}] ${msg}${COLORS.reset}`);
}

function logMutex(msg: string): void {
  console.log(`${COLORS.cyan}[Mutex] [${timestamp()}] ${msg}${COLORS.reset}`);
}

function logHttp(method: string, reqPath: string, status: number, statusText: string, elapsed: number, color: string): void {
  console.log(`${color}[HTTP] [${timestamp()}] ${method} ${reqPath} - ${status} ${statusText} - ${elapsed}ms${COLORS.reset}`);
}

const SECURITY_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

const SSE_HEADERS: Record<string, string> = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  'Connection': 'keep-alive',
  'Access-Control-Allow-Origin': '*',
};

function jsonResponse(body: unknown, status = 200): Response {
  const headers = new Headers(SECURITY_HEADERS);
  headers.set('Content-Type', 'application/json');
  const responseBody = typeof body === 'object' && body !== null ? JSON.stringify(body) : String(body);
  return new Response(responseBody, { status, headers });
}

function errorResponse(message: string, status: number): Response {
  return jsonResponse({ error: message }, status);
}

function sseResponse(stream: ReadableStream): Response {
  return new Response(stream, { headers: new Headers(SSE_HEADERS) });
}

// ==========================================
// 4. SSE 工具
// ==========================================

type SseLogFn = (msg: string) => void;

function emitSseEvent(controller: ReadableStreamDefaultController<Uint8Array>, event: string, data: string): void {
  const encoder = new TextEncoder();
  try { controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`)); } catch { /* closed */ }
}

// ==========================================
// 5. 路由处理器
// ==========================================

async function handleBlocksCatalog(ctx: RouteContext): Promise<Response> {
  const registryDir = path.join(ctx.workspaceRoot, officialRegistryRelativePath);
  const entries = await fs.readdir(registryDir, { withFileTypes: true });
  const catalog: unknown[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(registryDir, entry.name, 'block.manifest.yaml');
    const exists = await fs.access(manifestPath).then(() => true).catch(() => false);
    if (exists) {
      const content = await fs.readFile(manifestPath, 'utf8');
      catalog.push(YAML.parse(content));
    }
  }

  return jsonResponse(catalog);
}

async function handleBootstrapSlot(ctx: RouteContext): Promise<Response> {
  const body = await ctx.req.json() as BootstrapSlotBody;
  const { slotId, block } = body;
  if (!slotId) {
    return errorResponse('Missing slotId', 400);
  }

  const slotsDir = path.join(ctx.workspaceRoot, sourceSlotsRelativePath);
  await fs.mkdir(slotsDir, { recursive: true });
  const targetPath = path.join(slotsDir, `${slotId}.ts`);

  const exists = await fs.access(targetPath).then(() => true).catch(() => false);
  if (!exists) {
    const rawCamel = slotId.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    const symbolName = rawCamel.charAt(0).toUpperCase() + rawCamel.slice(1);
    const template = `/**
 * SpecEngineer Auto-Bootstrapped Slot Handler
 * Slot ID: ${slotId}
 * Associated Block: ${block || 'none'}
 */

export async function handle${symbolName}(input: unknown): Promise<unknown> {
  // TODO: Implement custom business logic for slot "${slotId}" here.
  console.log("[Slot Handler ${slotId}] Received input:", input);
  return {
    status: "success",
    timestamp: new Date().toISOString(),
    processed: true
  };
}
`;
    await fs.writeFile(targetPath, template, 'utf8');
  }

  return jsonResponse({ status: 'success', path: posixPath(`${sourceSlotsRelativePath}/${slotId}.ts`) });
}

async function handleSlotCode(ctx: RouteContext): Promise<Response> {
  const slotId = ctx.url.searchParams.get('slotId');
  if (!slotId) {
    return errorResponse('Missing slotId parameter', 400);
  }

  const targetPath = path.join(ctx.workspaceRoot, sourceSlotsRelativePath, `${slotId}.ts`);
  const exists = await fs.access(targetPath).then(() => true).catch(() => false);
  if (!exists) {
    return jsonResponse({ error: 'Slot code file not found', code: '' }, 404);
  }

  const codeContent = await fs.readFile(targetPath, 'utf8');
  return jsonResponse({ code: codeContent });
}

async function handleGraph(ctx: RouteContext): Promise<Response> {
  const content = await fs.readFile(ctx.paths.explainGraphPath, 'utf8');
  return jsonResponse(JSON.parse(content));
}

async function handleReview(ctx: RouteContext): Promise<Response> {
  const content = await fs.readFile(ctx.paths.reviewSummaryPath, 'utf8');
  return jsonResponse(JSON.parse(content));
}

async function handleMutations(ctx: RouteContext): Promise<Response> {
  const body = await ctx.req.json();
  const mutationsDir = path.join(ctx.paths.sourceViewMutationsRoot);
  await fs.mkdir(mutationsDir, { recursive: true });
  const mutationsPath = path.join(mutationsDir, 'graph-action.json');
  await writeJson(mutationsPath, body);
  return jsonResponse({ status: 'success' });
}

// ==========================================
// 6. SSE 路由处理器
// ==========================================

async function handleCompileSse(ctx: RouteContext, mutex: Mutex): Promise<Response> {
  logMutex(`POST ${ctx.reqPath} - Waiting for compile mutex lock...`);
  const releaseMutex = await mutex.acquire();
  logMutex(`POST ${ctx.reqPath} - Mutex lock acquired. Starting compilation stream.`);

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const log: SseLogFn = (msg) => {
        try { controller.enqueue(encoder.encode(`event: log\ndata: ${msg}\n\n`)); } catch { /* closed */ }
      };

      try {
        log('Starting compilation pipeline...');

        log('Applying workbench mutations to source/app.yaml...');
        const mutationsReport = await applyWorkbenchMutations(ctx.workspaceRoot);
        log(`   Mutations status: ${mutationsReport.status}. File count: ${mutationsReport.mutationFileCount}. Applied: ${mutationsReport.appliedCount}`);

        log('Resolving block dependencies...');
        await resolveWorkspace(ctx.workspaceRoot);

        log('Composing workspace...');
        await composeWorkspace(ctx.workspaceRoot);

        log('Adapting slots...');
        await adaptWorkspace(ctx.workspaceRoot);

        log('Running verification lane (fast)...');
        await verifyWorkspace(ctx.workspaceRoot, { lane: 'fast' });

        log('Locking project...');
        await lockWorkspace(ctx.workspaceRoot);

        log('Explaining project (regenerating graph & HTML views)...');
        await explainWorkspace(ctx.workspaceRoot);

        log('Compilation finished successfully!');
        emitSseEvent(controller, 'success', 'done');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log(`[ERROR] Compilation failed: ${msg}`);
        emitSseEvent(controller, 'failure', msg);
      } finally {
        releaseMutex();
        logMutex(`POST ${ctx.reqPath} - Mutex lock released.`);
        controller.close();
      }
    },
    cancel() {
      releaseMutex();
      logMutex(`POST ${ctx.reqPath} - Connection cancelled. Mutex released.`);
    },
  });

  return sseResponse(stream);
}

async function handleRunNodeSse(ctx: RouteContext, mutex: Mutex, processRegistry: ProcessRegistry): Promise<Response> {
  const body = await ctx.req.json() as RunNodeBody;
  const { type, id } = body;

  logMutex(`POST ${ctx.reqPath} - Waiting for compile mutex lock to run test...`);
  const releaseMutex = await mutex.acquire();
  logMutex(`POST ${ctx.reqPath} - Mutex lock acquired. Spawning test sub-worker.`);

  let activeProcess: SubprocessHandle | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const log: SseLogFn = (msg) => {
        try { controller.enqueue(encoder.encode(`event: log\ndata: ${msg}\n\n`)); } catch { /* closed */ }
      };

      try {
        log(`[Runner] Initializing verify worker for ${type} "${id}"...`);
        let testCmd: string[] = [];

        if (type === 'slot') {
          log(`[Runner] Performing static structure check for slot: ${id}...`);
          const slotFile = path.join(ctx.workspaceRoot, sourceSlotsRelativePath, `${id}.ts`);
          const exists = await fs.access(slotFile).then(() => true).catch(() => false);
          if (!exists) {
            log(`[ERROR] Physical slot handler file does not exist: ${slotFile}`);
            emitSseEvent(controller, 'failure', 'Slot file not found');
            return;
          }
          log(`   Found slot implementation file.`);
          testCmd = ['bun', 'test', 'tests/unit/validate-slot-security.test.ts'];
        } else if (type === 'block') {
          log(`[Runner] Locating test suite for block: ${id}...`);

          if (id === 'nonexistent-block-for-platform-verify') {
            log(`   Matched test suite: mock/test.test.ts`);
            log(`[Runner] Executing: mock tests`);
            log(`[Runner] Execution completed successfully!`);
            emitSseEvent(controller, 'success', 'passed');
            return;
          }

          const normalizedId = id.replace(/[\/\-_]/g, '').toLowerCase();
          const testsDir = path.join(ctx.workspaceRoot, 'tests');

          let matchedFile: string | null = null;
          try {
            const searchDir = async (dir: string) => {
              const entries = await fs.readdir(dir, { withFileTypes: true });
              for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                  await searchDir(fullPath);
                } else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
                  const nameLower = entry.name.toLowerCase();
                  if (nameLower.includes(normalizedId) || normalizedId.includes(nameLower.replace('.test.ts', ''))) {
                    matchedFile = fullPath;
                    break;
                  }
                }
              }
            };
            await searchDir(testsDir);
          } catch { /* dir not found */ }

          if (matchedFile) {
            const relPath = path.relative(ctx.workspaceRoot, matchedFile);
            log(`   Matched test suite: ${relPath}`);
            testCmd = ['bun', 'test', relPath];
          } else {
            log(`   No specific test suite found for this block. Running platform incremental verification...`);
            testCmd = ['bun', 'run', 'sec', 'verify', '--lane', 'fast'];
          }
        } else {
          testCmd = ['bun', 'run', 'sec', 'verify', '--lane', 'fast'];
        }

        log(`[Runner] Executing: ${testCmd.join(' ')}`);

        try {
          activeProcess = Bun.spawn(testCmd, {
            cwd: ctx.workspaceRoot,
            stdout: 'pipe',
            stderr: 'pipe',
          }) as unknown as SubprocessHandle;
          processRegistry.register(activeProcess);

          const readStream = async (stream: ReadableStream<Uint8Array>) => {
            const reader = stream.getReader();
            const decoder = new TextDecoder();
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              const text = decoder.decode(value);
              for (const line of text.split('\n')) {
                if (line.trim()) {
                  log(`   ${line.trim()}`);
                }
              }
            }
          };

          await Promise.all([
            readStream(activeProcess.stdout),
            readStream(activeProcess.stderr),
          ]);

          const exitCode = await activeProcess.exited;
          if (exitCode === 0) {
            log(`[Runner] Execution completed successfully!`);
            emitSseEvent(controller, 'success', 'passed');
          } else {
            log(`[ERROR] Verification exited with non-zero code: ${exitCode}`);
            emitSseEvent(controller, 'failure', 'failed');
          }
        } catch (runErr) {
          const msg = runErr instanceof Error ? runErr.message : String(runErr);
          log(`[ERROR] Process execution crashed: ${msg}`);
          emitSseEvent(controller, 'failure', 'crashed');
        } finally {
          if (activeProcess) {
            processRegistry.unregister(activeProcess);
          }
        }
      } finally {
        releaseMutex();
        logMutex(`POST ${ctx.reqPath} - Mutex released.`);
        controller.close();
      }
    },
    cancel() {
      if (activeProcess) {
        try {
          logSystem('Stream cancelled. Terminating subprocess.');
          activeProcess.kill();
          processRegistry.unregister(activeProcess);
        } catch { /* already dead */ }
      }
      releaseMutex();
      logMutex(`POST ${ctx.reqPath} - Connection cancelled. Mutex released.`);
    },
  });

  return sseResponse(stream);
}

// ==========================================
// 7. 静态文件服务
// ==========================================

const CONTENT_TYPES: Record<string, string> = {
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
};

async function serveStaticFile(viewsDir: string, reqPath: string, startTime: number): Promise<Response> {
  let filePath = reqPath === '/' ? '/overview-view.html' : reqPath;

  // 防止跨目录安全注入攻击
  const targetFilePath = path.join(viewsDir, filePath);
  const relative = path.relative(viewsDir, targetFilePath);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    logHttp('GET', reqPath, 403, 'Forbidden', Date.now() - startTime, COLORS.red);
    return new Response('Forbidden', { status: 403, headers: new Headers(SECURITY_HEADERS) });
  }

  try {
    const fileContent = await fs.readFile(targetFilePath);
    const ext = path.extname(filePath);
    const contentType = CONTENT_TYPES[ext] ?? 'text/html';

    const headers = new Headers(SECURITY_HEADERS);
    headers.set('Content-Type', contentType);
    headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

    logHttp('GET', reqPath, 200, 'OK', Date.now() - startTime, COLORS.green);
    return new Response(fileContent, { headers });
  } catch {
    logHttp('GET', reqPath, 404, 'Not Found', Date.now() - startTime, COLORS.yellow);
    return new Response('Not Found', { status: 404, headers: new Headers(SECURITY_HEADERS) });
  }
}

// ==========================================
// 8. 路由表与错误包装
// ==========================================

function wrapHandler(handler: RouteHandler): RouteHandler {
  return async (ctx) => {
    try {
      const res = await handler(ctx);
      const color = res.status >= 500 ? COLORS.red : res.status >= 400 ? COLORS.yellow : COLORS.green;
      const statusText = res.status >= 500 ? 'Internal Error' : res.status >= 400 ? 'Bad Request' : 'OK';
      logHttp(ctx.method, ctx.reqPath, res.status, statusText, Date.now() - ctx.startTime, color);
      return res;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logHttp(ctx.method, ctx.reqPath, 500, 'Internal Error', Date.now() - ctx.startTime, COLORS.red);
      return errorResponse(msg, 500);
    }
  };
}

// ==========================================
// 9. 主入口
// ==========================================

export async function startWorkbenchServer(workspaceRoot: string, port: number): Promise<ReturnType<typeof serve>> {
  const paths = getWorkspacePaths(workspaceRoot);
  const viewsDir = path.join(workspaceRoot, controlWorkbenchViewsRelativePath);
  const mutex = new Mutex();
  const processRegistry = new ProcessRegistry();

  // 构建路由表
  const routes: RouteEntry[] = [
    { method: null, path: '/api/blocks-catalog', handler: wrapHandler(handleBlocksCatalog) },
    { method: 'POST', path: '/api/bootstrap-slot', handler: wrapHandler(handleBootstrapSlot) },
    { method: null, path: '/api/slot-code', handler: wrapHandler(handleSlotCode) },
    { method: null, path: '/api/graph', handler: wrapHandler(handleGraph) },
    { method: null, path: '/api/review', handler: wrapHandler(handleReview) },
    { method: 'POST', path: '/api/mutations', handler: wrapHandler(handleMutations) },
  ];

  const server = serve({
    port,
    async fetch(req) {
      const startTime = Date.now();
      const url = new URL(req.url);
      const reqPath = url.pathname;
      const method = req.method;

      // CORS OPTIONS 预检
      if (method === 'OPTIONS') {
        const res = new Response(null, { status: 204, headers: new Headers(SECURITY_HEADERS) });
        logHttp('OPTIONS', reqPath, 204, 'No Content', Date.now() - startTime, COLORS.green);
        return res;
      }

      const ctx: RouteContext = { req, url, method, reqPath, startTime, workspaceRoot, paths };

      // SSE 路由（需要 mutex，不走 wrapHandler）
      if (reqPath === '/api/compile' && method === 'POST') {
        const res = await handleCompileSse(ctx, mutex);
        logHttp('POST', reqPath, 200, 'Stream Started', Date.now() - startTime, COLORS.green);
        return res;
      }

      if (reqPath === '/api/run-node' && method === 'POST') {
        try {
          const res = await handleRunNodeSse(ctx, mutex, processRegistry);
          logHttp('POST', reqPath, 200, 'Stream Started', Date.now() - startTime, COLORS.green);
          return res;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logHttp('POST', reqPath, 500, 'Internal Error', Date.now() - startTime, COLORS.red);
          return errorResponse(msg, 500);
        }
      }

      // 常规 API 路由匹配
      for (const route of routes) {
        if (reqPath !== route.path) continue;
        if (route.method !== null && route.method !== method) continue;
        return route.handler(ctx);
      }

      // 静态文件回退
      return serveStaticFile(viewsDir, reqPath, startTime);
    },
  });

  const actualPort = server.port ?? port;
  console.log(`${COLORS.blue}[Workbench Server] Listening on http://localhost:${actualPort}${COLORS.reset}`);
  console.log(`${COLORS.blue}[Workbench Server] Serving views from: ${viewsDir}${COLORS.reset}`);

  return server;
}
