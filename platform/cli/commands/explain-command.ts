import { explainWorkspace } from '../../orchestrator.ts';
import type { ExplainGraph } from '../../shared/explain-types.ts';
import { buildE2eMatrix } from '../../shared/review-matrix.ts';
import { parseExplainArgs } from '../args.ts';
import type { CommandHandler } from '../command-registry.ts';
import { printRequiredWorkspaceJson } from '../command-utils.ts';
import { printJsonOrText } from '../format-utils.ts';
import { formatExplainGraphInspect, formatExplainSummary } from '../formatters.ts';
import { EXPLAIN_USAGE } from '../usage.ts';

export const explainCommand: CommandHandler = {
  name: 'explain',
  usage: EXPLAIN_USAGE,
  async execute(args, ctx) {
    const explainArgs = parseExplainArgs(args);
    if (explainArgs.mode === 'graph') {
      await printRequiredWorkspaceJson<ExplainGraph>(
        ctx.cwd,
        (paths) => paths.explainGraphPath,
        'Explain graph not found; run platform explain first',
        explainArgs,
        formatExplainGraphInspect
      );
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
