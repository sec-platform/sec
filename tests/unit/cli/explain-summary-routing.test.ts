import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildE2eMatrix } from '../../../src/assurance/verification/review/matrix.ts';
import { buildReviewSummaryFromInputs } from '../../helpers/review-fixtures.ts';
import { buildSemanticViewFixture } from '../../helpers/semantic-view-fixtures.ts';
import { runRetainedBunTestCommand } from '../../testkit/process-resource.ts';
import { withTempWorkspace } from '../../testkit/workspace.ts';

// Domain effects are replaced only inside a separate process. The real command
// registration, argument parsing, application projection and renderer execute.
test('live explain routing preserves nonempty graph semantics and raw JSON', async () => {
  await withTempWorkspace(async (root) => {
    const reviewSummary = await buildReviewSummaryFromInputs(root);
    const graph = {
      semanticViews: buildSemanticViewFixture(),
      nodes: [
        { id: 'block:customer', type: 'block', label: 'Customer' },
        { id: 'operation:report', type: 'operation', label: 'Report' }
      ],
      edges: [{ from: 'operation:report', to: 'block:customer', type: 'depends_on' }],
      overlays: { coverage: { blocks: [] }, provenance: [] }
    };
    const repo = fileURLToPath(new URL('../../../', import.meta.url));
    const scriptPath = path.join(root, 'explain-routing.ts');
    const resultPath = path.join(root, 'explain-result.json');
    await fs.writeFile(resultPath, JSON.stringify({ graph, reviewSummary }));
    await fs.writeFile(scriptPath, `
      import { mock } from 'bun:test';
      import { Command } from ${JSON.stringify(path.join(repo, 'node_modules/commander/index.js'))};
      const result = await Bun.file(${JSON.stringify(resultPath)}).json();
      const unused = async () => { throw new Error('unrequested domain operation'); };
      mock.module(${JSON.stringify(path.join(repo, 'src/bootstrap/cli/lazy-command-domains.ts'))}, () => ({
        explainWorkspace: async () => result,
        lockWorkspace: unused, repairWorkspace: unused, upgradeWorkspace: unused
      }));
      const { registerWorkspaceCommands } = await import(${JSON.stringify(path.join(repo, 'src/bootstrap/cli/register-workspace-commands.ts'))});
      const program = new Command().name('sec').exitOverride();
      registerWorkspaceCommands(program);
      await program.parseAsync(process.argv.slice(2), { from: 'user' });
    `);
    const invoke = async (args: string[]) => {
      const { stdout, stderr, code } = await runRetainedBunTestCommand([scriptPath, 'explain', ...args], { cwd: root });
      expect(code, stderr).toBe(0);
      return stdout;
    };
    const e2eMatrix = buildE2eMatrix(reviewSummary);
    const output = await invoke([]);
    const lines = output.trimEnd().split(/\r?\n/u);
    expect(lines[0]).toMatch(/^Explain graph 2 nodes 1 edges\b/u);
    const required = [
      ['Node types:', ['block=1', 'operation=1']],
      ['Edge types:', ['depends_on=1']],
      ['CI status:', ['passed', 'failures: 0']],
      ['E2E verification:', ['passed', 'lane=fast', 'ci=passed', 'failures=0']],
      ['E2E coverage:', ['passed', 'blocks=0/0']],
      ['E2E artifacts:', ['attention', 'artifacts=missing']],
      ['E2E review:', ['passed', 'review-summary=generated']]
    ] as const;
    for (const [prefix, markers] of required) {
      const rows = lines.filter(line => line.startsWith(prefix));
      expect(rows).toHaveLength(1);
      for (const marker of markers) expect(rows[0]).toContain(marker);
    }
    expect(e2eMatrix.rows.map(row => row.stage)).toEqual([
      'verification', 'coverage', 'artifacts', 'review'
    ]);
    const compact = await invoke(['--json', '--compact']);
    expect(compact.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(compact)).toEqual({ graph, reviewSummary, e2eMatrix });
  });
});
