#!/usr/bin/env bun
import packageMetadata from '../../../package.json' with { type: 'json' };
import { runCli } from '../../entry/cli/cli.ts';
import { registerPipelineCommands } from '../../entry/cli/register-pipeline-commands.ts';
import { registerSemanticCommands } from '../../entry/cli/register-semantic-commands.ts';
import { registerCommands } from './register-commands.ts';

await runCli({
  version: packageMetadata.version,
  register: (program) => {
    registerCommands(program);
    registerSemanticCommands(program, async (root, purpose, inputFile, roots) => {
      const { queryWorkspaceSemantics } = await import('../engineering/semantic-query.ts');
      return queryWorkspaceSemantics(root, purpose, inputFile, roots);
    });
    registerPipelineCommands(program, {
      compile: async (workspaceRoot, invocation) => {
        const { compileWorkspace } = await import('../engineering/pipeline-orchestrator.ts');
        return compileWorkspace(workspaceRoot, invocation);
      },
      inspect: async (workspaceRoot) => {
        const { readPipelineJournal } = await import('../../adapters/compilation/pipeline/journal.ts');
        return readPipelineJournal(workspaceRoot);
      }
    });
  }
});
