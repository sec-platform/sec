import { spawn } from 'node:child_process';

import { partitionFastTestFiles } from '../platform/dev-runner/fast-test-policy.ts';
import { getFastTestFilesSync } from '../platform/shared/test-budget-contract.ts';

type Step = { id: string; args: string[] };
type Result = Step & { code: number; stdout: string; stderr: string };

function tailLines(value: string, limit = 120): string {
  return value.split(/\r?\n/u).slice(-limit).join('\n');
}

function run(step: Step): Promise<Result> {
  return new Promise((resolve) => {
    const child = spawn('bun', step.args, {
      env: { ...process.env, SEC_SKIP_RUNTIME_DEPS_SETUP: '1' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;

    child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk));

    const finish = (code: number): void => {
      if (settled) return;
      settled = true;
      resolve({
        ...step,
        code,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8')
      });
    };

    child.on('error', (error) => {
      stderr.push(Buffer.from(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`));
      finish(1);
    });
    child.on('close', (code) => finish(code ?? 1));
  });
}

const files = getFastTestFilesSync();
const partition = partitionFastTestFiles(files);
const steps: Step[] = [
  ...(partition.concurrent.length > 0
    ? [{ id: 'concurrent-fast-inventory', args: ['test', '--concurrent', ...partition.concurrent] }]
    : []),
  ...partition.serial.map((file) => ({ id: `serial:${file}`, args: ['test', file] }))
];

const failures: Array<{ id: string; code: number }> = [];
for (const step of steps) {
  console.log(`DIAGNOSTIC_START ${step.id}`);
  const result = await run(step);
  console.log(`DIAGNOSTIC_RESULT ${step.id} code=${result.code}`);
  if (result.code === 0) continue;

  failures.push({ id: step.id, code: result.code });
  console.log(`DIAGNOSTIC_FAILURE_START ${step.id}`);
  console.log(tailLines(`${result.stdout}\n${result.stderr}`));
  console.log(`DIAGNOSTIC_FAILURE_END ${step.id}`);
}

console.log(`DIAGNOSTIC_SUMMARY ${JSON.stringify({
  fastFileCount: files.length,
  concurrentFileCount: partition.concurrent.length,
  serialFiles: partition.serial,
  failures
})}`);

process.exit(failures.length > 0 ? 1 : 0);
