import { spawnSync } from 'node:child_process';

import { partitionFastTestFiles } from '../platform/dev-runner/fast-test-policy.ts';
import { getFastTestFilesSync } from '../platform/shared/test-budget-contract.ts';

type Step = { id: string; args: string[] };
type DiagnosticMode = 'group-a' | 'group-b' | 'concurrent' | 'serial-0' | 'serial-1' | 'serial-2' | 'serial-3';

const MODE: DiagnosticMode = 'group-a';
const files = getFastTestFilesSync();
const partition = partitionFastTestFiles(files);
const allSteps: Step[] = [
  ...(partition.concurrent.length > 0
    ? [{ id: 'concurrent-fast-inventory', args: ['test', '--concurrent', ...partition.concurrent] }]
    : []),
  ...partition.serial.map((file) => ({ id: `serial:${file}`, args: ['test', file] }))
];

function selectedSteps(mode: DiagnosticMode): Step[] {
  if (mode === 'group-a') return allSteps.slice(0, 3);
  if (mode === 'group-b') return allSteps.slice(3);
  if (mode === 'concurrent') return allSteps.slice(0, 1);
  const serialIndex = Number.parseInt(mode.slice('serial-'.length), 10);
  return allSteps.slice(serialIndex + 1, serialIndex + 2);
}

const selected = selectedSteps(MODE);
console.log(`FAST_DIAGNOSTIC mode=${MODE} files=${files.length} concurrent=${partition.concurrent.length}`);
console.log(`FAST_DIAGNOSTIC selected=${selected.map((step) => step.id).join(',')}`);

for (const step of selected) {
  const result = spawnSync('bun', step.args, {
    env: { ...process.env, SEC_SKIP_RUNTIME_DEPS_SETUP: '1' },
    stdio: 'inherit'
  });
  const code = result.status ?? 1;
  console.log(`FAST_DIAGNOSTIC result=${step.id} code=${code}`);
  if (code !== 0) process.exit(code);
}

process.exit(0);
