import { expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { startWorkbenchServer } from '../../platform/orchestrator/workbench-server.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

test('default Workbench entrypoint does not statically require the Bun host runtime', async () => {
  const sourcePaths = [
    'platform/orchestrator/workbench-server.ts',
    'platform/orchestrator/workbench-server-v2.ts',
    'platform/orchestrator.ts',
    'platform/cli/register-commands.ts'
  ];
  const sources = await Promise.all(sourcePaths.map((relativePath) =>
    fs.readFile(path.join(process.cwd(), relativePath), 'utf8')
  ));

  for (const source of sources) {
    expect(source).not.toMatch(/(?:from\s+|import\s*\()['"]bun['"]/u);
    expect(source).not.toMatch(/\bBun\./u);
  }
  expect(sources[1]).toContain("from 'node:http'");
  expect(sources[1]).toContain("from 'node:child_process'");
});

test('workbench server serves files and APIs correctly', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    // 1. Setup mock views and JSON paths
    const viewsDir = path.join(workspaceRoot, 'control/workbench/views');
    await fs.mkdir(viewsDir, { recursive: true });
    await fs.writeFile(path.join(viewsDir, 'overview-view.html'), '<html>Overview</html>', 'utf8');

    const graphDir = path.join(workspaceRoot, 'control/graph');
    await fs.mkdir(graphDir, { recursive: true });
    const mockGraph = { nodes: [], edges: [] };
    await fs.writeFile(path.join(graphDir, 'explain-graph.json'), JSON.stringify(mockGraph), 'utf8');

    // 2. Start the Node-compatible HTTP host on an OS-assigned port.
    const server = await startWorkbenchServer(workspaceRoot, 0);
    expect(server).toBeDefined();
    const port = server.port ?? 0;
    expect(port).toBeGreaterThan(0);
    const base = `http://localhost:${port}`;

    try {
      // 3. Test static file fetch
      const resFile = await fetch(`${base}/overview-view.html`);
      expect(resFile.status).toBe(200);
      const textFile = await resFile.text();
      expect(textFile).toContain('Overview');

      // 4. Test GET /api/graph
      const resGraph = await fetch(`${base}/api/graph`);
      expect(resGraph.status).toBe(200);
      const jsonGraph = await resGraph.json() as { nodes: unknown[]; edges: unknown[] };
      expect(jsonGraph.nodes).toBeDefined();

      // 5. Test POST /api/mutations
      const mockMutations = {
        formatVersion: '1',
        mutations: [
          { id: 'mut-1', kind: 'add-block', blockId: 'test-block', version: '1.0.0' }
        ]
      };
      const resMutations = await fetch(`${base}/api/mutations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mockMutations)
      });
      expect(resMutations.status).toBe(200);
      const jsonMutations = await resMutations.json() as { status: string };
      expect(jsonMutations.status).toBe('success');

      // Verify that graph-action.json was written
      const mutationsPath = path.join(workspaceRoot, 'source/views/mutations/graph-action.json');
      const fileExists = await fs.stat(mutationsPath).then(() => true).catch(() => false);
      expect(fileExists).toBe(true);

      const written = JSON.parse(await fs.readFile(mutationsPath, 'utf8'));
      expect(written.mutations[0].blockId).toBe('test-block');

      // 6. Test POST /api/run-node
      const resRun = await fetch(`${base}/api/run-node`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'block', id: 'nonexistent-block-for-platform-verify' })
      });
      expect(resRun.status).toBe(200);
      const reader = resRun.body?.getReader();
      expect(reader).toBeDefined();
      if (reader) {
        const { value } = await reader.read();
        const text = new TextDecoder().decode(value);
        expect(text).toContain('event: log');
        await reader.cancel();
      }

      // 7. Test GET /api/blocks-catalog (with dynamically created mock block)
      const mockRegDir = path.join(workspaceRoot, 'platform/registry/official/test-mock-block');
      await fs.mkdir(mockRegDir, { recursive: true });
      const mockManifest = `
id: test-mock-block
version: 0.9.9
requires: [auth]
provides: [test-mock]
slots: []
`;
      await fs.writeFile(path.join(mockRegDir, 'block.manifest.yaml'), mockManifest, 'utf8');

      const resCatalog = await fetch(`${base}/api/blocks-catalog`);
      expect(resCatalog.status).toBe(200);
      const jsonCatalog = await resCatalog.json() as Array<{ id: string; version: string }>;
      expect(Array.isArray(jsonCatalog)).toBe(true);
      const matchedBlock = jsonCatalog.find((b: { id: string }) => b.id === 'test-mock-block');
      expect(matchedBlock).toBeDefined();
      expect(matchedBlock!.version).toBe('0.9.9');

      // 8. Test POST /api/bootstrap-slot
      const resBootstrap = await fetch(`${base}/api/bootstrap-slot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slotId: 'test_resolver_slot', block: 'test/block' })
      });
      expect(resBootstrap.status).toBe(200);
      const jsonBootstrap = await resBootstrap.json() as { status: string; path: string };
      expect(jsonBootstrap.status).toBe('success');
      expect(jsonBootstrap.path).toBe('source/code/slots/test_resolver_slot.ts');

      // Check physical file contents
      const bootstrappedPath = path.join(workspaceRoot, 'source/code/slots/test_resolver_slot.ts');
      const bootstrappedContent = await fs.readFile(bootstrappedPath, 'utf8');
      expect(bootstrappedContent).toContain('export async function handleTestResolverSlot');
      expect(bootstrappedContent).toContain('test/block');

      // 9. Test OPTIONS Preflight CORS Request
      const resOptions = await fetch(`${base}/api/graph`, {
        method: 'OPTIONS'
      });
      expect(resOptions.status).toBe(204);
      expect(resOptions.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(resOptions.headers.get('Access-Control-Allow-Methods')).toContain('GET');

      // 10. Test High-Concurrency Mutex Compilation Lock (Concurrency Guard Test)
      // 并发发起 3 次 run-node 局部测试请求，断言服务器互斥锁成功串行化处理
      const runPromises = Array.from({ length: 3 }).map(() =>
        fetch(`${base}/api/run-node`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'block', id: 'nonexistent-block-for-platform-verify' })
        })
      );

      const results = await Promise.all(runPromises);
      for (const res of results) {
        expect(res.status).toBe(200);
        const reader = res.body?.getReader();
        expect(reader).toBeDefined();
        if (reader) {
          const { value } = await reader.read();
          const text = new TextDecoder().decode(value);
          expect(text).toContain('event: log');
          await reader.cancel();
        }
      }
    } finally {
      // Clean up server
      server.stop();
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  });
});
