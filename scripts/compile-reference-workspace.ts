import { compileWorkspace } from '../platform/orchestrator.ts';

try {
  await compileWorkspace(process.cwd(), {
    source: 'reference'
  });
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
