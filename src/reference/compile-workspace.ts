import { compileWorkspace } from '../application/engineering/pipeline-orchestrator.ts';
import { referenceWorkspaceRoot } from './workspace.ts';

try {
  await compileWorkspace(referenceWorkspaceRoot, {
    source: 'reference'
  });
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
