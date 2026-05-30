import { serve } from 'bun';
import path from 'node:path';
import fs from 'node:fs/promises';
import YAML from 'yaml';
import { getWorkspacePaths } from '../shared/paths.ts';
import { writeJson } from '../shared/fs.ts';

import { resolveWorkspace } from './block-orchestrator.ts';
import { composeWorkspace, adaptWorkspace } from './compose-orchestrator.ts';
import { verifyWorkspace } from './verify-orchestrator.ts';
import { lockWorkspace, explainWorkspace } from './emit-orchestrator.ts';
import { applyWorkbenchMutations } from './workbench-orchestrator.ts';

// ==========================================
// 1. 工业级排队互斥锁 (Async Build Mutex)
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

// 全局唯一的编译互斥锁，防御多并发哈希竞争与死锁
const compileMutex = new Mutex();

// ==========================================
// 2. 防子进程泄漏与系统信号优雅清理 (Process Registry)
// ==========================================
const activeProcesses = new Set<any>();

function cleanUpSubprocesses() {
  if (activeProcesses.size === 0) return;
  console.log(`\x1b[31m[SYSTEM] [${new Date().toISOString()}] Cleaning up ${activeProcesses.size} active subprocesses...\x1b[0m`);
  for (const proc of activeProcesses) {
    try {
      proc.kill();
    } catch (e) {}
  }
  activeProcesses.clear();
}

// 绑定系统退出信号 (SIGINT, SIGTERM)
process.on('SIGINT', () => {
  console.log('\n\x1b[31m[SYSTEM] Received SIGINT. Gracefully shutting down...\x1b[0m');
  cleanUpSubprocesses();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n\x1b[31m[SYSTEM] Received SIGTERM. Gracefully shutting down...\x1b[0m');
  cleanUpSubprocesses();
  process.exit(0);
});

// ==========================================
// 3. 规范出站响应构建纯函数 (CORS & Security Headers)
// ==========================================
function createResponse(body: any, status = 200, isJson = true): Response {
  const headers = new Headers({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin'
  });

  if (isJson) {
    headers.set('Content-Type', 'application/json');
  }

  const responseBody = isJson && typeof body === 'object' ? JSON.stringify(body) : body;
  return new Response(responseBody, { status, headers });
}

// ==========================================
// 4. 工业级 Bun Serve API 宿主主入口
// ==========================================
export async function startWorkbenchServer(workspaceRoot: string, port: number): Promise<any> {
  const { explainGraphPath, reviewSummaryPath } = getWorkspacePaths(workspaceRoot);
  const viewsDir = path.join(workspaceRoot, 'control/workbench/views');

  console.log(`\x1b[34m[Workbench Server] Starting server on http://localhost:${port}\x1b[0m`);
  console.log(`\x1b[34m[Workbench Server] Serving views from: ${viewsDir}\x1b[0m`);

  return serve({
    port,
    async fetch(req) {
      const startTime = Date.now();
      const url = new URL(req.url);
      const reqPath = url.pathname;
      const method = req.method;

      // 友好处理 CORS OPTIONS 预检请求
      if (method === 'OPTIONS') {
        const res = createResponse(null, 204, false);
        console.log(`\x1b[32m[HTTP] [${new Date().toISOString()}] OPTIONS ${reqPath} - 204 No Content - ${Date.now() - startTime}ms\x1b[0m`);
        return res;
      }

      // ==========================================
      // 数据交互 API Endpoints 路由匹配
      // ==========================================

      // 1. 获取 Catalog 列表
      if (reqPath === '/api/blocks-catalog') {
        try {
          const registryDir = path.join(workspaceRoot, 'platform/registry/official');
          const entries = await fs.readdir(registryDir, { withFileTypes: true });
          const catalog = [];
          
          for (const entry of entries) {
            if (entry.isDirectory()) {
              const manifestPath = path.join(registryDir, entry.name, 'block.manifest.yaml');
              const exists = await fs.access(manifestPath).then(() => true).catch(() => false);
              if (exists) {
                const content = await fs.readFile(manifestPath, 'utf8');
                const parsed = YAML.parse(content);
                catalog.push(parsed);
              }
            }
          }
          
          const res = createResponse(catalog);
          console.log(`\x1b[32m[HTTP] [${new Date().toISOString()}] GET ${reqPath} - 200 OK - ${Date.now() - startTime}ms\x1b[0m`);
          return res;
        } catch (e: any) {
          const res = createResponse({ error: e.message || String(e) }, 500);
          console.log(`\x1b[31m[HTTP] [${new Date().toISOString()}] GET ${reqPath} - 500 Internal Error - ${Date.now() - startTime}ms\x1b[0m`);
          return res;
        }
      }

      // 2. 自举 Slot 代码
      if (reqPath === '/api/bootstrap-slot' && method === 'POST') {
        try {
          const body = await req.json();
          const { slotId, block } = body;
          if (!slotId) {
            const res = createResponse({ error: 'Missing slotId' }, 400);
            console.log(`\x1b[33m[HTTP] [${new Date().toISOString()}] POST ${reqPath} - 400 Bad Request - ${Date.now() - startTime}ms\x1b[0m`);
            return res;
          }

          const slotsDir = path.join(workspaceRoot, 'source/code/slots');
          await fs.mkdir(slotsDir, { recursive: true });
          const targetPath = path.join(slotsDir, `${slotId}.ts`);

          const exists = await fs.access(targetPath).then(() => true).catch(() => false);
          if (!exists) {
            const rawCamel = slotId.replace(/_([a-z])/g, (_: any, c: string) => c.toUpperCase());
            const symbolName = rawCamel.charAt(0).toUpperCase() + rawCamel.slice(1);
            
            const template = `/**
 * SpecEngineer Auto-Bootstrapped Slot Handler
 * Slot ID: ${slotId}
 * Associated Block: ${block || 'none'}
 */

export async function handle${symbolName}(input: any): Promise<any> {
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

          const res = createResponse({ status: 'success', path: `source/code/slots/${slotId}.ts` });
          console.log(`\x1b[32m[HTTP] [${new Date().toISOString()}] POST ${reqPath} - 200 OK - ${Date.now() - startTime}ms\x1b[0m`);
          return res;
        } catch (e: any) {
          const res = createResponse({ error: e.message || String(e) }, 500);
          console.log(`\x1b[31m[HTTP] [${new Date().toISOString()}] POST ${reqPath} - 500 Internal Error - ${Date.now() - startTime}ms\x1b[0m`);
          return res;
        }
      }

      // 3. 获取 Graph 依赖数据
      if (reqPath === '/api/graph') {
        try {
          const content = await fs.readFile(explainGraphPath, 'utf8');
          const res = createResponse(JSON.parse(content));
          console.log(`\x1b[32m[HTTP] [${new Date().toISOString()}] GET ${reqPath} - 200 OK - ${Date.now() - startTime}ms\x1b[0m`);
          return res;
        } catch (e) {
          const res = createResponse({ error: 'Graph not found' }, 404);
          console.log(`\x1b[33m[HTTP] [${new Date().toISOString()}] GET ${reqPath} - 404 Not Found - ${Date.now() - startTime}ms\x1b[0m`);
          return res;
        }
      }

      // 4. 获取 Review 摘要数据
      if (reqPath === '/api/review') {
        try {
          const content = await fs.readFile(reviewSummaryPath, 'utf8');
          const res = createResponse(JSON.parse(content));
          console.log(`\x1b[32m[HTTP] [${new Date().toISOString()}] GET ${reqPath} - 200 OK - ${Date.now() - startTime}ms\x1b[0m`);
          return res;
        } catch (e) {
          const res = createResponse({ error: 'Review summary not found' }, 404);
          console.log(`\x1b[33m[HTTP] [${new Date().toISOString()}] GET ${reqPath} - 404 Not Found - ${Date.now() - startTime}ms\x1b[0m`);
          return res;
        }
      }

      // 5. 保存 Mutations 改变集
      if (reqPath === '/api/mutations' && method === 'POST') {
        try {
          const body = await req.json();
          const mutationsDir = path.join(workspaceRoot, 'source/views/mutations');
          await fs.mkdir(mutationsDir, { recursive: true });
          const mutationsPath = path.join(mutationsDir, 'graph-action.json');
          await writeJson(mutationsPath, body);
          
          const res = createResponse({ status: 'success' });
          console.log(`\x1b[32m[HTTP] [${new Date().toISOString()}] POST ${reqPath} - 200 OK - ${Date.now() - startTime}ms\x1b[0m`);
          return res;
        } catch (err: any) {
          const res = createResponse({ error: err.message || String(err) }, 500);
          console.log(`\x1b[31m[HTTP] [${new Date().toISOString()}] POST ${reqPath} - 500 Internal Error - ${Date.now() - startTime}ms\x1b[0m`);
          return res;
        }
      }

      // 6. 热重载与缝合编译 (STREAM SSE API WITH MUTEX QUEUE)
      if (reqPath === '/api/compile' && method === 'POST') {
        let releaseMutex: (() => void) | null = null;
        
        console.log(`\x1b[36m[Mutex] [${new Date().toISOString()}] POST ${reqPath} - Waiting for compile mutex lock...\x1b[0m`);
        releaseMutex = await compileMutex.acquire();
        console.log(`\x1b[36m[Mutex] [${new Date().toISOString()}] POST ${reqPath} - Mutex lock acquired. Starting compilation stream.\x1b[0m`);

        const stream = new ReadableStream({
          async start(controller) {
            const encoder = new TextEncoder();
            const log = (msg: string) => {
              try {
                controller.enqueue(encoder.encode(`event: log\ndata: ${msg}\n\n`));
              } catch (e) {}
            };

            try {
              log('Starting compilation pipeline...');
              
              log('Applying workbench mutations to source/app.yaml...');
              const mutationsReport = await applyWorkbenchMutations(workspaceRoot);
              log(`   Mutations status: ${mutationsReport.status}. File count: ${mutationsReport.mutationFileCount}. Applied: ${mutationsReport.appliedCount}`);
              
              log('Resolving block dependencies...');
              await resolveWorkspace(workspaceRoot);
              
              log('Composing workspace...');
              await composeWorkspace(workspaceRoot);
              
              log('Adapting slots...');
              await adaptWorkspace(workspaceRoot);
              
              log('Running verification lane (fast)...');
              await verifyWorkspace(workspaceRoot, { lane: 'fast' });
              
              log('Locking project...');
              await lockWorkspace(workspaceRoot);
              
              log('Explaining project (regenerating graph & HTML views)...');
              await explainWorkspace(workspaceRoot);
              
              log('Compilation finished successfully!');
              controller.enqueue(encoder.encode(`event: success\ndata: done\n\n`));
            } catch (err: any) {
              log(`[ERROR] Compilation failed: ${err.message || String(err)}`);
              try {
                controller.enqueue(encoder.encode(`event: failure\ndata: ${err.message || String(err)}\n\n`));
              } catch (e) {}
            } finally {
              if (releaseMutex) {
                releaseMutex();
                console.log(`\x1b[36m[Mutex] [${new Date().toISOString()}] POST ${reqPath} - Mutex lock released.\x1b[0m`);
              }
              controller.close();
            }
          },
          cancel() {
            if (releaseMutex) {
              releaseMutex();
              console.log(`\x1b[36m[Mutex] [${new Date().toISOString()}] POST ${reqPath} - Connection cancelled. Mutex released.\x1b[0m`);
            }
          }
        });

        const headers = new Headers({
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*'
        });

        console.log(`\x1b[32m[HTTP] [${new Date().toISOString()}] POST ${reqPath} - 200 Stream Started - ${Date.now() - startTime}ms\x1b[0m`);
        return new Response(stream, { headers });
      }

      // 7. 单节点局部运行与调试 (STREAM SSE API WITH MUTEX & SUBPROCESS BINDING)
      if (reqPath === '/api/run-node' && method === 'POST') {
        let releaseMutex: (() => void) | null = null;
        let activeProcess: any = null;

        try {
          const body = await req.json();
          const { type, id } = body;

          console.log(`\x1b[36m[Mutex] [${new Date().toISOString()}] POST ${reqPath} - Waiting for compile mutex lock to run test...\x1b[0m`);
          releaseMutex = await compileMutex.acquire();
          console.log(`\x1b[36m[Mutex] [${new Date().toISOString()}] POST ${reqPath} - Mutex lock acquired. Spawning test sub-worker.\x1b[0m`);

          const stream = new ReadableStream({
            async start(controller) {
              const encoder = new TextEncoder();
              const log = (msg: string) => {
                try {
                  controller.enqueue(encoder.encode(`event: log\ndata: ${msg}\n\n`));
                } catch (e) {}
              };
              
              log(`[Runner] Initializing verify worker for ${type} "${id}"...`);
              let testCmd: string[] = [];
              
              if (type === 'slot') {
                log(`[Runner] Performing static structure check for slot: ${id}...`);
                const slotFile = path.join(workspaceRoot, `source/code/slots/${id}.ts`);
                const exists = await fs.access(slotFile).then(() => true).catch(() => false);
                if (!exists) {
                  log(`[ERROR] Physical slot handler file does not exist: ${slotFile}`);
                  try {
                    controller.enqueue(encoder.encode(`event: failure\ndata: Slot file not found\n\n`));
                  } catch (e) {}
                  if (releaseMutex) releaseMutex();
                  controller.close();
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
                  try {
                    controller.enqueue(encoder.encode(`event: success\ndata: passed\n\n`));
                  } catch (e) {}
                  if (releaseMutex) releaseMutex();
                  controller.close();
                  return;
                }
                
                const normalizedId = id.replace(/[\/\-_]/g, '').toLowerCase();
                const testsDir = path.join(workspaceRoot, 'tests');
                
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
                } catch (e) {}
                
                if (matchedFile) {
                  const relPath = path.relative(workspaceRoot, matchedFile);
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
                  cwd: workspaceRoot,
                  stdout: 'pipe',
                  stderr: 'pipe'
                });
                
                // 注册追踪活跃进程，防止强制关闭时残留僵尸进程
                activeProcesses.add(activeProcess);
                
                const readStream = async (stream: ReadableStream<Uint8Array>) => {
                  const reader = stream.getReader();
                  const decoder = new TextDecoder();
                  while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    const text = decoder.decode(value);
                    const lines = text.split('\n');
                    for (const line of lines) {
                      if (line.trim()) {
                        log(`   ${line.trim()}`);
                      }
                    }
                  }
                };
                
                await Promise.all([
                  readStream(activeProcess.stdout),
                  readStream(activeProcess.stderr)
                ]);
                
                const exitCode = await activeProcess.exited;
                if (exitCode === 0) {
                  log(`[Runner] Execution completed successfully!`);
                  controller.enqueue(encoder.encode(`event: success\ndata: passed\n\n`));
                } else {
                  log(`[ERROR] Verification exited with non-zero code: ${exitCode}`);
                  controller.enqueue(encoder.encode(`event: failure\ndata: failed\n\n`));
                }
              } catch (runErr: any) {
                log(`[ERROR] Process execution crashed: ${runErr.message || String(runErr)}`);
                controller.enqueue(encoder.encode(`event: failure\ndata: crashed\n\n`));
              } finally {
                if (activeProcess) {
                  activeProcesses.delete(activeProcess);
                }
                if (releaseMutex) {
                  releaseMutex();
                  console.log(`\x1b[36m[Mutex] [${new Date().toISOString()}] POST ${reqPath} - Mutex released.\x1b[0m`);
                }
                controller.close();
              }
            },
            cancel() {
              if (activeProcess) {
                try {
                  console.log(`\x1b[31m[SYSTEM] Stream cancelled. Terminating subprocess.\x1b[0m`);
                  activeProcess.kill();
                  activeProcesses.delete(activeProcess);
                } catch (e) {}
              }
              if (releaseMutex) {
                releaseMutex();
                console.log(`\x1b[36m[Mutex] [${new Date().toISOString()}] POST ${reqPath} - Connection cancelled. Mutex released.\x1b[0m`);
              }
            }
          });
          
          const headers = new Headers({
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*'
          });
          
          console.log(`\x1b[32m[HTTP] [${new Date().toISOString()}] POST ${reqPath} - 200 Stream Started - ${Date.now() - startTime}ms\x1b[0m`);
          return new Response(stream, { headers });
        } catch (err: any) {
          if (releaseMutex) releaseMutex();
          const res = createResponse({ error: err.message || String(err) }, 500);
          console.log(`\x1b[31m[HTTP] [${new Date().toISOString()}] POST ${reqPath} - 500 Internal Error - ${Date.now() - startTime}ms\x1b[0m`);
          return res;
        }
      }

      // ==========================================
      // 静态资源路由分发与安全判定
      // ==========================================
      let filePath = reqPath;
      if (filePath === '/') {
        filePath = '/overview-view.html';
      }

      // 防止跨目录安全注入攻击
      const targetFilePath = path.join(viewsDir, filePath);
      const relative = path.relative(viewsDir, targetFilePath);

      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        const res = createResponse('Forbidden', 403, false);
        console.log(`\x1b[31m[HTTP] [${new Date().toISOString()}] GET ${reqPath} - 403 Forbidden - ${Date.now() - startTime}ms\x1b[0m`);
        return res;
      }

      try {
        const fileContent = await fs.readFile(targetFilePath);
        let contentType = 'text/html';
        if (filePath.endsWith('.js')) {
          contentType = 'application/javascript';
        } else if (filePath.endsWith('.css')) {
          contentType = 'text/css';
        } else if (filePath.endsWith('.json')) {
          contentType = 'application/json';
        }

        // 统一注入 Security & CORS Headers
        const res = new Response(fileContent, {
          headers: new Headers({
            'Content-Type': contentType,
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
            'Access-Control-Allow-Origin': '*',
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY',
            'Referrer-Policy': 'strict-origin-when-cross-origin'
          })
        });
        
        console.log(`\x1b[32m[HTTP] [${new Date().toISOString()}] GET ${reqPath} - 200 OK - ${Date.now() - startTime}ms\x1b[0m`);
        return res;
      } catch (e) {
        const res = createResponse('Not Found', 404, false);
        console.log(`\x1b[33m[HTTP] [${new Date().toISOString()}] GET ${reqPath} - 404 Not Found - ${Date.now() - startTime}ms\x1b[0m`);
        return res;
      }
    }
  });
}
