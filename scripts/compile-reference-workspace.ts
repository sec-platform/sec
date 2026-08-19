import { compileWorkspace } from '../platform/orchestrator/pipeline-orchestrator.ts';

try {
  await compileWorkspace(process.cwd(), {
    source: 'reference'
  });
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
