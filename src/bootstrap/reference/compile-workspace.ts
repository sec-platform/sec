import { runReferenceCompileProcess } from '../../entry/reference-compile.ts';
import { compileWorkspace } from '../engineering/pipeline-orchestrator.ts';
import { referenceWorkspaceRoot } from './workspace.ts';

await runReferenceCompileProcess({
  execute: async () => {
    await compileWorkspace(referenceWorkspaceRoot, {
      source: 'reference'
    });
  }
});
