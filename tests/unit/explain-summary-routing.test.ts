import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { projectExplainSummary } from '../../src/application/explain-summary.ts';
import { formatExplainSummary } from '../../src/entry/cli/explain-summary.ts';
import { buildE2eMatrix } from '../../src/assurance/verification/review/matrix.ts';
import { buildReviewSummaryFromInputs } from '../helpers/review-fixtures.ts';
import { buildSemanticViewFixture } from '../helpers/semantic-view-fixtures.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

// Domain effects are replaced only inside a separate process. The real command
// registration, argument parsing, application projection and renderer execute.
test('live explain routing preserves raw JSON, text and single matrix derivation', async () => {
  await withTempWorkspace(async (root) => {
    const reviewSummary = await buildReviewSummaryFromInputs(root);
    const graph = { semanticViews: buildSemanticViewFixture(), nodes: [], edges: [], overlays: { coverage: { blocks: [] }, provenance: [] } };
    const repo = fileURLToPath(new URL('../../', import.meta.url));
    const scriptPath = path.join(root, 'explain-routing.ts');
    const resultPath = path.join(root, 'explain-result.json');
    const receiptPath = path.join(root, 'explain-reads.json');
    await fs.writeFile(resultPath, JSON.stringify({ graph, reviewSummary }));
    await fs.writeFile(scriptPath, `
      import { mock } from 'bun:test';
      import { Command } from ${JSON.stringify(path.join(repo, 'node_modules/commander/index.js'))};
      const result = await Bun.file(${JSON.stringify(resultPath)}).json();
      const stages = result.reviewSummary.chainSummary.stageSummaries;
      let reads = 0;
      Object.defineProperty(result.reviewSummary.chainSummary, 'stageSummaries', {
        enumerable: true, get() { reads++; return stages; }
      });
      const unused = async () => { throw new Error('unrequested domain operation'); };
      mock.module(${JSON.stringify(path.join(repo, 'src/bootstrap/cli/lazy-command-domains.ts'))}, () => ({
        explainWorkspace: async () => result,
        lockWorkspace: unused, repairWorkspace: unused, upgradeWorkspace: unused
      }));
      const { registerWorkspaceCommands } = await import(${JSON.stringify(path.join(repo, 'src/bootstrap/cli/register-workspace-commands.ts'))});
      const program = new Command().name('sec').exitOverride();
      registerWorkspaceCommands(program);
      await program.parseAsync(process.argv.slice(2), { from: 'user' });
      await Bun.write(${JSON.stringify(receiptPath)}, JSON.stringify({ reads }));
    `);
    const invoke = async (args: string[]) => {
      const child = Bun.spawn([process.execPath, scriptPath, 'explain', ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
      const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      expect(exitCode, stderr).toBe(0);
      return stdout;
    };
    const e2eMatrix = buildE2eMatrix(reviewSummary);
    expect(await invoke([])).toBe(`${formatExplainSummary(projectExplainSummary(graph, reviewSummary, e2eMatrix))}\n`);
    expect(JSON.parse(await fs.readFile(receiptPath, 'utf8'))).toEqual({ reads: 1 });
    expect(JSON.parse(await invoke(['--json']))).toEqual({ graph, reviewSummary, e2eMatrix });
    const compact = await invoke(['--json', '--compact']);
    expect(compact.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(compact)).toEqual({ graph, reviewSummary, e2eMatrix });
  });
});
