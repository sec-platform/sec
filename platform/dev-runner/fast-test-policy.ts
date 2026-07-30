export const DEFAULT_FAST_TEST_PROCESS_SHARD_SIZE = 16;
export const MAX_FAST_TEST_PROCESS_SHARD_SIZE = 16;
export const DEFAULT_CONCURRENT_FAST_SHARD_CONCURRENCY = 2;
export const DEFAULT_ISOLATED_FAST_TEST_CONCURRENCY = 4;
export const MAX_DEFAULT_FAST_TEST_PROCESS_WAVES = 20;
export const DEFAULT_FAST_TEST_TIMEOUT_MS = 180_000;

export const DEFAULT_FAST_TEST_EXCLUSION_REGISTRY = [
  { file: 'tests/integration/semantic-mutation-apply.test.ts', reason: 'full-semantic-mutation-transaction' },
  {
    file: 'tests/integration/semantic-mutation-recovery-lifecycle.test.ts',
    reason: 'durable-recovery-lifecycle'
  },
  { file: 'tests/integration/semantic-pipeline-spine.test.ts', reason: 'full-workspace-compile' },
  {
    file: 'tests/integration/semantic-projection-consumers.test.ts',
    reason: 'full-workspace-derived-consumers'
  },
  { file: 'tests/integration/ticket-pipeline.test.ts', reason: 'full-workspace-compile' },
  { file: 'tests/integration/upgrade-pipeline-kernel.test.ts', reason: 'full-upgrade-compile' },
  { file: 'tests/integration/workbench-pipeline.test.ts', reason: 'server-and-full-workspace-compile' },
  { file: 'tests/integration/workspace-engineering-ir.test.ts', reason: 'full-workspace-ir-build' },
  {
    file: 'tests/unit/semantic-mutation-isolated-child-fence.test.ts',
    reason: 'production-host-and-runtime-lifecycle'
  },
  { file: 'tests/unit/work-package-gate-execution.test.ts', reason: 'repository-worktree-execution' }
] as const;

export const DEFAULT_FAST_TEST_EXCLUDED_FILES = DEFAULT_FAST_TEST_EXCLUSION_REGISTRY
  .map(({ file }) => file);
const defaultFastTestExcludedFileSet = new Set<string>(DEFAULT_FAST_TEST_EXCLUDED_FILES);

export function isDefaultFastTestFile(file: string): boolean {
  return !defaultFastTestExcludedFileSet.has(file);
}

export const FAST_TEST_PROCESS_RESOURCE_SCHEDULING = {
  'independent-process': 'bounded-parallel',
  'shared-host-runtime': 'exclusive',
  'repository-worktree': 'exclusive',
  'host-profile': 'exclusive'
} as const;

export type FastTestProcessResourceClass = keyof typeof FAST_TEST_PROCESS_RESOURCE_SCHEDULING;

const FAST_TEST_PROCESS_ISOLATION_DEFINITIONS = [
  {
    file: 'tests/integration/pipeline-kernel.test.ts',
    reason: 'workspace-mutation',
    resourceClass: 'independent-process'
  },
  {
    file: 'tests/integration/pipeline-workspace-write-lease.test.ts',
    reason: 'workspace-mutation',
    resourceClass: 'independent-process'
  },
  {
    file: 'tests/integration/semantic-mutation-apply.test.ts',
    reason: 'production-host-and-runtime-lifecycle',
    resourceClass: 'shared-host-runtime'
  },
  {
    file: 'tests/integration/semantic-mutation-recovery-lifecycle.test.ts',
    reason: 'workspace-mutation',
    resourceClass: 'independent-process'
  },
  {
    file: 'tests/integration/semantic-mutation-windows-rollback.test.ts',
    reason: 'workspace-mutation',
    resourceClass: 'independent-process'
  },
  {
    file: 'tests/integration/semantic-pipeline-spine.test.ts',
    reason: 'workspace-mutation',
    resourceClass: 'independent-process'
  },
  {
    file: 'tests/integration/semantic-projection-consumers.test.ts',
    reason: 'workspace-mutation',
    resourceClass: 'independent-process'
  },
  {
    file: 'tests/integration/semantic-projections.test.ts',
    reason: 'shared-workspace',
    resourceClass: 'independent-process'
  },
  {
    file: 'tests/integration/ticket-pipeline.test.ts',
    reason: 'workspace-mutation',
    resourceClass: 'independent-process'
  },
  {
    file: 'tests/integration/upgrade-pipeline-kernel.test.ts',
    reason: 'workspace-mutation',
    resourceClass: 'independent-process'
  },
  {
    file: 'tests/integration/workbench-pipeline.test.ts',
    reason: 'workspace-server',
    resourceClass: 'shared-host-runtime'
  },
  {
    file: 'tests/integration/workbench-writer-lease.test.ts',
    reason: 'workspace-server',
    resourceClass: 'shared-host-runtime'
  },
  {
    file: 'tests/integration/workspace-engineering-ir.test.ts',
    reason: 'workspace-mutation',
    resourceClass: 'independent-process'
  },
  {
    file: 'tests/unit/project-overview.test.ts',
    reason: 'workspace-overview',
    resourceClass: 'independent-process'
  },
  {
    file: 'tests/unit/semantic-mutation-isolated-child-fence.test.ts',
    reason: 'module-global-runtime-cache-and-process-lifecycle',
    resourceClass: 'shared-host-runtime'
  },
  {
    file: 'tests/unit/test-runner.test.ts',
    reason: 'process-global-mocks',
    resourceClass: 'independent-process'
  },
  {
    file: 'tests/unit/windows-appcontainer-executor.test.ts',
    reason: 'production-host-and-runtime-lifecycle',
    resourceClass: 'shared-host-runtime'
  },
  {
    file: 'tests/unit/windows-appcontainer-host-tool-lifecycle.test.ts',
    reason: 'production-host-and-runtime-lifecycle',
    resourceClass: 'shared-host-runtime'
  },
  {
    file: 'tests/unit/work-package-gate-contract.test.ts',
    reason: 'work-package-evidence',
    resourceClass: 'independent-process'
  },
  {
    file: 'tests/unit/work-package-gate-execution.test.ts',
    reason: 'repository-worktree-mutation',
    resourceClass: 'repository-worktree'
  },
  {
    file: 'tests/unit/work-package-profile-census-repair.test.ts',
    reason: 'work-package-profile-evidence',
    resourceClass: 'repository-worktree'
  },
  {
    file: 'tests/unit/work-package-profile-probe-diagnostic.test.ts',
    reason: 'host-profile-probe',
    resourceClass: 'host-profile'
  }
] as const satisfies readonly {
  file: string;
  reason: string;
  resourceClass: FastTestProcessResourceClass;
}[];

export const FAST_TEST_PROCESS_ISOLATION_REGISTRY = FAST_TEST_PROCESS_ISOLATION_DEFINITIONS
  .map((definition) => ({
    ...definition,
    scheduling: FAST_TEST_PROCESS_RESOURCE_SCHEDULING[definition.resourceClass]
  }));

export const PROCESS_ISOLATED_FAST_TEST_FILES = FAST_TEST_PROCESS_ISOLATION_REGISTRY.map(({ file }) => file);
export const BOUNDED_PARALLEL_ISOLATED_FAST_TEST_FILES = FAST_TEST_PROCESS_ISOLATION_REGISTRY
  .filter(({ scheduling }) => scheduling === 'bounded-parallel')
  .map(({ file }) => file);
export const EXCLUSIVE_FAST_TEST_FILES = FAST_TEST_PROCESS_ISOLATION_REGISTRY
  .filter(({ scheduling }) => scheduling === 'exclusive')
  .map(({ file }) => file);
type FastTestProcessScheduling = typeof FAST_TEST_PROCESS_ISOLATION_REGISTRY[number]['scheduling'];
const isolationByFastTestFile = new Map<string, FastTestProcessScheduling>(
  FAST_TEST_PROCESS_ISOLATION_REGISTRY.map(({ file, scheduling }) => [file, scheduling])
);

export function partitionFastTestFiles(files: readonly string[]): {
  concurrent: string[];
  isolatedParallel: string[];
  exclusive: string[];
} {
  const concurrent: string[] = [];
  const isolatedParallel: string[] = [];
  const exclusive: string[] = [];

  for (const file of files) {
    switch (isolationByFastTestFile.get(file)) {
      case 'bounded-parallel':
        isolatedParallel.push(file);
        break;
      case 'exclusive':
        exclusive.push(file);
        break;
      default:
        concurrent.push(file);
    }
  }

  return { concurrent, isolatedParallel, exclusive };
}

export function planFastTestProcesses(
  files: readonly string[],
  concurrentShardSize = DEFAULT_FAST_TEST_PROCESS_SHARD_SIZE
): {
  concurrentShards: string[][];
  isolatedParallel: string[];
  exclusive: string[];
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

  return {
    concurrentShards,
    isolatedParallel: partition.isolatedParallel,
    exclusive: partition.exclusive
  };
}
