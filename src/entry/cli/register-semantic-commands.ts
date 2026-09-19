import type { Command } from 'commander';
import { requireSemanticQueryPurpose, type SemanticQueryPurpose, type SemanticQueryResult } from '../../application/semantic-query.ts';
import { addJsonFlags, jsonOpts, optionalModeCommand } from './command-options.ts';
import { commandValue } from './command-value.ts';
import { registerWorkspaceAction } from './workspace-action.ts';

/** Read-only analysis/generation entry. Domain reads and runtime assembly are
 * injected, not performed by transport code or an implicit write pipeline. */
export function registerSemanticCommands(
  program: Command,
  query: (root: string, purpose: SemanticQueryPurpose) => Promise<SemanticQueryResult>
): void {
  registerWorkspaceAction(addJsonFlags(optionalModeCommand(
    program.command('semantic').description('Analyze or generate semantic artifacts in memory without writing the workspace'),
    'mode', ['analyze', 'generate']
  )), {
    decode: (mode: unknown, options: Record<string, unknown>) => ({
      request: requireSemanticQueryPurpose(mode === undefined ? 'analyze' : mode),
      output: jsonOpts(options)
    }),
    execute: query,
    view: result => commandValue(result, value => value.purpose === 'generate'
      ? `Generated ${value.artifacts.members.length} semantic artifacts in memory; no files written\n${value.artifacts.members.map(member => member.task.target).join('\n')}`
      : `Analyzed ${value.compilation.snapshot.ir.entities.length} entities and ${value.compilation.snapshot.ir.facts.length} facts; no files written`)
  });
}
