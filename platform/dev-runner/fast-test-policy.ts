export const DEFAULT_FAST_TEST_PROCESS_SHARD_SIZE = 8;
export const MAX_FAST_TEST_PROCESS_SHARD_SIZE = 16;

export const FAST_TEST_PROCESS_ISOLATION_REGISTRY = [
  { file: 'tests/integration/overview.test.ts', reason: 'shared-workspace' },
  { file: 'tests/integration/pipeline-kernel.test.ts', reason: 'workspace-mutation' },
  { file: 'tests/integration/pipeline-workspace-write-lease.test.ts', reason: 'workspace-mutation' },
  { file: 'tests/integration/project-runtime.test.ts', reason: 'runtime-dependency-state' },
  { file: 'tests/integration/semantic-core-vertical.test.ts', reason: 'workspace-mutation' },
  { file: 'tests/integration/semantic-mutation-apply.test.ts', reason: 'workspace-mutation' },
  { file: 'tests/integration/semantic-mutation-recovery-lifecycle.test.ts', reason: 'workspace-mutation' },
  { file: 'tests/integration/semantic-mutation-windows-rollback.test.ts', reason: 'workspace-mutation' },
  { file: 'tests/integration/semantic-pipeline-spine.test.ts', reason: 'workspace-mutation' },
  { file: 'tests/integration/semantic-projection-consumers.test.ts', reason: 'workspace-mutation' },
  { file: 'tests/integration/semantic-projections.test.ts', reason: 'shared-workspace' },
  { file: 'tests/integration/ticket-pipeline.test.ts', reason: 'workspace-mutation' },
  { file: 'tests/integration/upgrade-pipeline-kernel.test.ts', reason: 'workspace-mutation' },
  { file: 'tests/integration/workbench-pipeline.test.ts', reason: 'workspace-server' },
  { file: 'tests/integration/workbench-writer-lease.test.ts', reason: 'workspace-server' },
  { file: 'tests/integration/workspace-engineering-ir.test.ts', reason: 'workspace-mutation' },
  { file: 'tests/unit/project-overview.test.ts', reason: 'workspace-overview' },
  { file: 'tests/unit/import-organizer-staged.test.ts', reason: 'typescript-language-service-git-fixtures' },
  { file: 'tests/unit/test-runner.test.ts', reason: 'process-global-mocks' },
  { file: 'tests/unit/work-package-gate-contract.test.ts', reason: 'work-package-evidence' },
  { file: 'tests/unit/work-package-gate-execution.test.ts', reason: 'repository-worktree-mutation' },
  { file: 'tests/unit/work-package-profile-census-repair.test.ts', reason: 'work-package-profile-evidence' },
  { file: 'tests/unit/work-package-profile-probe-diagnostic.test.ts', reason: 'host-profile-probe' }
] as const;

export const SERIAL_FAST_TEST_FILES = FAST_TEST_PROCESS_ISOLATION_REGISTRY.map(({ file }) => file);
const serialFastTestFiles = new Set<string>(SERIAL_FAST_TEST_FILES);

export function partitionFastTestFiles(files: readonly string[]): {
  concurrent: string[];
  serial: string[];
} {
  const concurrent: string[] = [];
  const serial: string[] = [];

  for (const file of files) {
    if (serialFastTestFiles.has(file)) {
      serial.push(file);
    } else {
      concurrent.push(file);
    }
  }

  return { concurrent, serial };
}

export function planFastTestProcesses(
  files: readonly string[],
  concurrentShardSize = DEFAULT_FAST_TEST_PROCESS_SHARD_SIZE
): {
  concurrentShards: string[][];
  serial: string[];
} {
  if (
    !Number.isSafeInteger(concurrentShardSize) ||
    concurrentShardSize < 1 ||
    concurrentShardSize > MAX_FAST_TEST_PROCESS_SHARD_SIZE
  ) {
    throw new Error(
      `Fast test process shard size must be an integer between 1 and ${MAX_FAST_TEST_PROCESS_SHARD_SIZE}.`
    );
  }
  if (new Set(files).size !== files.length) {
    throw new Error('Fast test process planning requires unique files.');
  }

  const partition = partitionFastTestFiles(files);
  const concurrentShards: string[][] = [];
  for (let index = 0; index < partition.concurrent.length; index += concurrentShardSize) {
    concurrentShards.push(partition.concurrent.slice(index, index + concurrentShardSize));
  }

  return { concurrentShards, serial: partition.serial };
}
