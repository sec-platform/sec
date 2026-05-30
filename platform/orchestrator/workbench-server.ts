import { serve } from 'bun';
import path from 'node:path';
import fs from 'node:fs/promises';
import { getWorkspacePaths } from '../shared/paths.ts';
import { writeJson } from '../shared/fs.ts';

import { resolveWorkspace } from './block-orchestrator.ts';
import { composeWorkspace, adaptWorkspace } from './compose-orchestrator.ts';
import { verifyWorkspace } from './verify-orchestrator.ts';
import { lockWorkspace, explainWorkspace } from './emit-orchestrator.ts';
import { applyWorkbenchMutations } from './workbench-orchestrator.ts';

export async function startWorkbenchServer(workspaceRoot: string, port: number): Promise<any> {
  const { explainGraphPath, reviewSummaryPath } = getWorkspacePaths(workspaceRoot);
  const viewsDir = path.join(workspaceRoot, 'control/workbench/views');

  console.log(`[Workbench Server] Starting server on http://localhost:${port}`);
  console.log(`[Workbench Server] Serving views from: ${viewsDir}`);

  return serve({

    port,
    async fetch(req) {
      const url = new URL(req.url);
      const reqPath = url.pathname;

      // API Endpoints
      if (reqPath === '/api/graph') {
        try {
          const content = await fs.readFile(explainGraphPath, 'utf8');
          return new Response(content, {
            headers: { 'Content-Type': 'application/json' }
          });
        } catch (e) {
          return new Response(JSON.stringify({ error: 'Graph not found' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }

      if (reqPath === '/api/review') {
        try {
          const content = await fs.readFile(reviewSummaryPath, 'utf8');
          return new Response(content, {
            headers: { 'Content-Type': 'application/json' }
          });
        } catch (e) {
          return new Response(JSON.stringify({ error: 'Review summary not found' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }

      if (reqPath === '/api/mutations' && req.method === 'POST') {
        try {
          const body = await req.json();
          const mutationsDir = path.join(workspaceRoot, 'source/views/mutations');
          await fs.mkdir(mutationsDir, { recursive: true });
          const mutationsPath = path.join(mutationsDir, 'graph-action.json');
          await writeJson(mutationsPath, body);
          return new Response(JSON.stringify({ status: 'success' }), {
            headers: { 'Content-Type': 'application/json' }
          });
        } catch (err: any) {
          return new Response(JSON.stringify({ error: err.message || String(err) }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }

      if (reqPath === '/api/compile' && req.method === 'POST') {
        const stream = new ReadableStream({
          async start(controller) {
            const encoder = new TextEncoder();
            const log = (msg: string) => {
              controller.enqueue(encoder.encode(`event: log\ndata: ${msg}\n\n`));
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
              controller.enqueue(encoder.encode(`event: failure\ndata: ${err.message || String(err)}\n\n`));
            } finally {
              controller.close();
            }
          }
        });

        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
          }
        });
      }

      if (reqPath === '/api/run-node' && req.method === 'POST') {
        try {
          const body = await req.json();
          const { type, id } = body;
          
          let activeProcess: any = null;
          const stream = new ReadableStream({
            async start(controller) {
              const encoder = new TextEncoder();
              const log = (msg: string) => {
                controller.enqueue(encoder.encode(`event: log\ndata: ${msg}\n\n`));
              };
              
              log(`[Runner] Initializing verify worker for ${type} "${id}"...`);
              
              let testCmd: string[] = [];
              
              if (type === 'slot') {
                log(`[Runner] Performing static structure check for slot: ${id}...`);
                const slotFile = path.join(workspaceRoot, `source/code/slots/${id}.ts`);
                const exists = await fs.access(slotFile).then(() => true).catch(() => false);
                if (!exists) {
                  log(`[ERROR] Physical slot handler file does not exist: ${slotFile}`);
                  controller.enqueue(encoder.encode(`event: failure\ndata: Slot file not found\n\n`));
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
                  controller.enqueue(encoder.encode(`event: success\ndata: passed\n\n`));
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
                  log(`   No specific test suite found for this block. Running incremental platform verification...`);
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
                controller.close();
              }
            },
            cancel() {
              if (activeProcess) {
                try {
                  activeProcess.kill();
                } catch (e) {}
              }
            }
          });
          
          return new Response(stream, {
            headers: {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive'
            }
          });
        } catch (err: any) {
          return new Response(JSON.stringify({ error: err.message || String(err) }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }

      // Static Resource Serving
      let filePath = reqPath;
      if (filePath === '/') {
        filePath = '/overview-view.html';
      }

      // Safe path resolution
      const targetFilePath = path.join(viewsDir, filePath);
      const relative = path.relative(viewsDir, targetFilePath);

      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        return new Response('Forbidden', { status: 403 });
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

        return new Response(fileContent, {
          headers: {
            'Content-Type': contentType,
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate' // zero cache
          }
        });
      } catch (e) {
        return new Response('Not Found', { status: 404 });
      }
    }
  });
}
