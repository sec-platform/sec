import type { CommandHandler } from '../command-registry.ts';
import { parseExplainArgs } from '../args.ts';
import { explainWorkspace } from '../../orchestrator.ts';
import { getWorkspacePaths } from '../../shared/paths.ts';
import { readRequiredJson } from '../command-utils.ts';
import { formatExplainGraphInspect, formatExplainSummary } from '../formatters.ts';
import { printJsonOrText } from '../format-utils.ts';
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
      const graph = await readRequiredJson<ExplainGraph>(explainGraphPath, 'Explain graph not found; run platform explain first');
      printJsonOrText(graph, explainArgs, formatExplainGraphInspect);
      return;
    }
    const { graph, reviewSummary } = await explainWorkspace(ctx.cwd);
    printJsonOrText(
      { graph, reviewSummary, e2eMatrix: buildE2eMatrix(reviewSummary) },
      explainArgs,
      (summary) => formatExplainSummary(summary.graph, summary.reviewSummary)
    );
  }
};
