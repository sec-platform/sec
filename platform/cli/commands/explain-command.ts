import type { CommandHandler } from '../command-registry.ts';
import { parseExplainArgs } from '../args.ts';
import { explainWorkspace } from '../../orchestrator.ts';
import { getWorkspacePaths } from '../../shared/paths.ts';
import { pathExists, readJson } from '../../shared/fs.ts';
import { formatExplainGraphInspect, formatExplainSummary } from '../formatters.ts';
import { formatJson } from '../format-utils.ts';
import { buildE2eMatrix } from '../../shared/review-matrix.ts';
import type { ExplainGraph } from '../../shared/explain-types.ts';
import { EXPLAIN_USAGE } from '../usage.ts';

export const explainCommand: CommandHandler = {
  name: 'explain',
  usage: EXPLAIN_USAGE,
  async execute(args, ctx) {
    const explainArgs = parseExplainArgs(args);
    if (explainArgs.mode === 'graph') {
      const { explainGraphPath } = getWorkspacePaths(ctx.cwd);
      if (!(await pathExists(explainGraphPath))) {
        throw new Error('Explain graph not found; run platform explain first');
      }
      const graph = await readJson<ExplainGraph>(explainGraphPath);
      if (explainArgs.json) {
        console.log(formatJson(graph, explainArgs));
        return;
      }
      console.log(formatExplainGraphInspect(graph));
      return;
    }
    const { graph, reviewSummary } = await explainWorkspace(ctx.cwd);
    if (explainArgs.json) {
      console.log(formatJson(
        { graph, reviewSummary, e2eMatrix: buildE2eMatrix(reviewSummary) },
        explainArgs
      ));
      return;
    }
    console.log(formatExplainSummary(graph, reviewSummary));
  }
};
