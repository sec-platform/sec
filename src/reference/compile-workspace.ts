import { compileWorkspace } from '../compiler/orchestration/pipeline-orchestrator.ts';

try {
  await compileWorkspace(process.cwd(), {
    source: 'reference'
  });
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
