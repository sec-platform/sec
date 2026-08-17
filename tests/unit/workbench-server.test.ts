import { expect, test } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { startWorkbenchServer } from '../../platform/orchestrator/workbench-server.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

test('workbench server serves same-origin APIs and bounds source writes to current Lock slots', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const viewsDir = path.join(workspaceRoot, 'control/workbench/views');
    await fs.mkdir(viewsDir, { recursive: true });
    await fs.writeFile(path.join(viewsDir, 'overview-view.html'), '<html>Overview</html>', 'utf8');

    const graphDir = path.join(workspaceRoot, 'control/graph');
    await fs.mkdir(graphDir, { recursive: true });
    const mockGraph = { nodes: [], edges: [] };
    await fs.writeFile(path.join(graphDir, 'explain-graph.json'), JSON.stringify(mockGraph), 'utf8');

    const stateDir = path.join(workspaceRoot, 'control/state');
    await fs.mkdir(stateDir, { recursive: true });
    await fs.writeFile(path.join(stateDir, 'graph.lock.json'), JSON.stringify({
      slotTasks: [{
        id: 'test_resolver_slot',
        block: 'test/block',
        target: 'custom/test_resolver_slot.ts',
        symbol: 'handleTestResolverSlot',
        kind: 'adapter',
        status: 'pending',
        writableZones: ['custom/'],
        provenanceHints: { generator: null, verifiedBy: [] }
      }]
    }), 'utf8');

    const server = await startWorkbenchServer(workspaceRoot, 0);
    expect(server).toBeDefined();
    const port = server.port ?? 0;
    expect(port).toBeGreaterThan(0);
    const base = `http://127.0.0.1:${port}`;

    try {
      const resFile = await fetch(`${base}/overview-view.html`);
      expect(resFile.status).toBe(200);
      expect(await resFile.text()).toContain('Overview');
      expect(resFile.headers.get('Access-Control-Allow-Origin')).toBeNull();
      expect(resFile.headers.get('Cross-Origin-Resource-Policy')).toBe('same-origin');

      const resGraph = await fetch(`${base}/api/graph`);
      expect(resGraph.status).toBe(200);
      const jsonGraph = await resGraph.json() as { nodes: unknown[]; edges: unknown[] };
      expect(jsonGraph.nodes).toBeDefined();

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
      expect((await resMutations.json() as { status: string }).status).toBe('success');

      const mutationsPath = path.join(workspaceRoot, 'source/views/mutations/graph-action.json');
      const written = JSON.parse(await fs.readFile(mutationsPath, 'utf8'));
      expect(written.mutations[0].blockId).toBe('test-block');

      const crossOriginMutation = await fetch(`${base}/api/mutations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://untrusted.example'
        },
        body: JSON.stringify(mockMutations)
      });
      expect(crossOriginMutation.status).toBe(403);
      expect(crossOriginMutation.headers.get('Access-Control-Allow-Origin')).toBeNull();

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
        expect(new TextDecoder().decode(value)).toContain('event: log');
        await reader.cancel();
      }

      const resCatalog = await fetch(`${base}/api/blocks-catalog`);
      expect(resCatalog.status).toBe(200);
      const jsonCatalog = await resCatalog.json() as Array<{ id: string; version: string }>;
      const matchedBlock = jsonCatalog.find((block) => block.id === 'worklog/basic');
      expect(matchedBlock).toBeDefined();
      expect(matchedBlock!.version).toBe('0.1.0');

      const resBootstrap = await fetch(`${base}/api/bootstrap-slot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slotId: 'test_resolver_slot', block: 'test/block' })
      });
      expect(resBootstrap.status).toBe(200);
      const jsonBootstrap = await resBootstrap.json() as { status: string; disposition: string; path: string };
      expect(jsonBootstrap.status).toBe('success');
      expect(jsonBootstrap.disposition).toBe('created');
      expect(jsonBootstrap.path).toBe('source/code/slots/test_resolver_slot.ts');

      const bootstrappedPath = path.join(workspaceRoot, 'source/code/slots/test_resolver_slot.ts');
      const bootstrappedContent = await fs.readFile(bootstrappedPath, 'utf8');
      expect(bootstrappedContent).toContain('export async function handleTestResolverSlot');

      await fs.writeFile(bootstrappedPath, '// user-owned implementation\n', 'utf8');
      const secondBootstrap = await fetch(`${base}/api/bootstrap-slot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slotId: 'test_resolver_slot', block: 'test/block' })
      });
      expect(secondBootstrap.status).toBe(200);
      expect((await secondBootstrap.json() as { disposition: string }).disposition).toBe('existing');
      expect(await fs.readFile(bootstrappedPath, 'utf8')).toBe('// user-owned implementation\n');

      const traversalBootstrap = await fetch(`${base}/api/bootstrap-slot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slotId: '../../escape', block: 'test/block' })
      });
      expect(traversalBootstrap.status).toBe(400);

      const unauthorizedBootstrap = await fetch(`${base}/api/bootstrap-slot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slotId: 'other_slot', block: 'test/block' })
      });
      expect(unauthorizedBootstrap.status).toBe(500);
      expect(await fs.stat(path.join(workspaceRoot, 'source/code/slots/other_slot.ts')).then(() => true).catch(() => false)).toBe(false);

      const resOptions = await fetch(`${base}/api/graph`, { method: 'OPTIONS' });
      expect(resOptions.status).toBe(204);
      expect(resOptions.headers.get('Access-Control-Allow-Origin')).toBeNull();

      const runPromises = Array.from({ length: 3 }).map(() =>
        fetch(`${base}/api/run-node`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'block', id: 'nonexistent-block-for-platform-verify' })
        })
      );
      const results = await Promise.all(runPromises);
      for (const response of results) {
        expect(response.status).toBe(200);
        const responseReader = response.body?.getReader();
        expect(responseReader).toBeDefined();
        if (responseReader) {
          const { value } = await responseReader.read();
          expect(new TextDecoder().decode(value)).toContain('event: log');
          await responseReader.cancel();
        }
      }
    } finally {
      server.stop();
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  });
});
