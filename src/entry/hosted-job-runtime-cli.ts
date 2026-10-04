import { runHostedJobRuntime } from '../bootstrap/development/hosted-job-runtime.ts';

export { runHostedJobRuntime };

if (import.meta.main) {
  const result = await runHostedJobRuntime(process.argv.slice(2));
  process.stdout.write(`${result}\n`);
}
