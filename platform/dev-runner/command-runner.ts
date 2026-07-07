import { spawn } from 'node:child_process';
import { compilerRoot } from '../shared/paths.ts';
import { applyDefaultFastTestConcurrency } from './test-concurrency-policy.ts';

export function runDevCommand(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, applyDefaultFastTestConcurrency(command, args), {
      cwd: compilerRoot,
      env: Object.fromEntries(
        Object.entries({
          ...process.env,
          ...env
        }).filter(([, value]) => value !== undefined)
      ) as NodeJS.ProcessEnv,
      shell: false,
      stdio: 'inherit'
    });

    child.on('error', reject);
    child.on('close', (code) => {
      resolve(code ?? 1);
    });
  });
}
