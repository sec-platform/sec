import { availableParallelism } from 'node:os';

import { isSecRepositoryTestModulePath, normalizeSecRepositoryTestModulePath } from '../../../../contracts/repository-test-path.ts';

export const MAX_FAST_TEST_GLOBAL_RESOURCE_BUDGET = 16;
export const MAX_FAST_TEST_PROCESS_CONCURRENCY = 8;

export const FAST_TEST_PROCESS_RESOURCE_CLASS_ORDER = [
  'independent-process',
  'shared-host-runtime',
  'repository-worktree',
  'host-profile'
] as const;

export type FastTestProcessResourceClass = typeof FAST_TEST_PROCESS_RESOURCE_CLASS_ORDER[number];

export interface FastTestProcessIsolationDefinition {
  readonly file: string;
  readonly reason: string;
  readonly resourceClass: FastTestProcessResourceClass;
}

export type FastTestResourceClassLimits = Readonly<Record<FastTestProcessResourceClass, number>>;

export interface FastTestConcurrencyBudget {
  readonly availableCpuCount: number;
  readonly globalBudget: number;
  readonly bunTestMaxConcurrency: number;
  readonly concurrentProcessLimit: number;
  readonly resourceClassProcessCaps: FastTestResourceClassLimits;
}

export interface ManagedFastTestConcurrency {
  readonly innerConcurrency: number;
  readonly outerProcessConcurrency: number;
  readonly resourceClassLimits: FastTestResourceClassLimits;
}

export function resolveFastTestConcurrencyBudget(availableCpuCount: number): FastTestConcurrencyBudget {
  if (!Number.isSafeInteger(availableCpuCount) || availableCpuCount < 1) {
    throw new Error('Available CPU count must be a positive safe integer.');
  }

  const globalBudget = Math.min(MAX_FAST_TEST_GLOBAL_RESOURCE_BUDGET, availableCpuCount);
  const bunTestMaxConcurrency = Math.max(1, Math.min(4, Math.floor(Math.sqrt(globalBudget))));
  const concurrentProcessLimit = Math.max(1, Math.floor(globalBudget / bunTestMaxConcurrency));
  const resourceClassProcessCaps = Object.freeze({
    'independent-process': Math.min(MAX_FAST_TEST_PROCESS_CONCURRENCY, globalBudget),
    'shared-host-runtime': Math.min(2, globalBudget),
    'repository-worktree': 1,
    'host-profile': 1
  });

  return Object.freeze({
    availableCpuCount,
    globalBudget,
    bunTestMaxConcurrency,
    concurrentProcessLimit,
    resourceClassProcessCaps
  });
}

export function resolveManagedFastTestConcurrency(
  budget: FastTestConcurrencyBudget,
  explicitInnerConcurrency: number | null
): ManagedFastTestConcurrency {
  const innerConcurrency = explicitInnerConcurrency ?? budget.bunTestMaxConcurrency;
  if (!Number.isSafeInteger(innerConcurrency) || innerConcurrency < 1) {
    throw new Error('Bun --max-concurrency must be a positive safe integer.');
  }
  if (innerConcurrency > budget.globalBudget) {
    throw new Error(
      `Bun --max-concurrency ${innerConcurrency} exceeds the managed fast-test global budget ${budget.globalBudget}.`
    );
  }

  const outerProcessConcurrency = Math.max(1, Math.floor(budget.globalBudget / innerConcurrency));
  const resourceClassLimits = Object.freeze(Object.fromEntries(
    FAST_TEST_PROCESS_RESOURCE_CLASS_ORDER.map((resourceClass) => [
      resourceClass,
      Math.min(budget.resourceClassProcessCaps[resourceClass], outerProcessConcurrency)
    ])
  ) as Record<FastTestProcessResourceClass, number>);

  return Object.freeze({
    innerConcurrency,
    outerProcessConcurrency,
    resourceClassLimits
  });
}

export const DEFAULT_FAST_TEST_CONCURRENCY_BUDGET = resolveFastTestConcurrencyBudget(
  availableParallelism()
);
export const DEFAULT_FAST_TEST_MAX_CONCURRENCY =
  DEFAULT_FAST_TEST_CONCURRENCY_BUDGET.bunTestMaxConcurrency;
const DEFAULT_MANAGED_FAST_TEST_CONCURRENCY = resolveManagedFastTestConcurrency(
  DEFAULT_FAST_TEST_CONCURRENCY_BUDGET,
  null
);
export const DEFAULT_FAST_TEST_RESOURCE_CLASS_LIMITS =
  DEFAULT_MANAGED_FAST_TEST_CONCURRENCY.resourceClassLimits;

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
  { file: 'tests/integration/workspace-engineering-ir.test.ts', reason: 'full-workspace-ir-build' },
  {
    file: 'tests/unit/semantic-mutation-isolated-child-fence.test.ts',
    reason: 'production-host-and-runtime-lifecycle'
  }
] as const;

export const DEFAULT_FAST_TEST_EXCLUDED_FILES = DEFAULT_FAST_TEST_EXCLUSION_REGISTRY
  .map(({ file }) => file);
const defaultFastTestExcludedFileSet = new Set<string>(
  DEFAULT_FAST_TEST_EXCLUDED_FILES.map(normalizeSecRepositoryTestModulePath)
);

export function isDefaultFastTestFile(file: string): boolean {
  return !defaultFastTestExcludedFileSet.has(normalizeSecRepositoryTestModulePath(file));
}

const FAST_TEST_PROCESS_ISOLATION_DEFINITIONS = [
  {
    file: 'tests/unit/formatter-publication-lifecycle.test.ts',
    reason: 'process-global-mocks',
    resourceClass: 'independent-process'
  },
  {
    file: 'tests/contract/test-budget.test.ts',
    reason: 'repeated-repository-compilation-and-process-global-cli-context',
    resourceClass: 'independent-process'
  },
  {
    file: 'tests/contract/dependency-transition-migration.test.ts',
    reason: 'process-global-environment',
    resourceClass: 'independent-process'
  },
  {
    file: 'tests/contract/repository-audit.test.ts',
    reason: 'process-global-environment',
    resourceClass: 'independent-process'
  },
  {
    file: 'tests/integration/pipeline-kernel.test.ts',
    reason: 'workspace-mutation',
    resourceClass: 'independent-process'
  },
  {
    file: 'tests/integration/compiler-dependency-installation.test.ts',
    reason: 'process-global-environment-and-isolated-physical-lifecycle',
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
    file: 'tests/integration/workspace-engineering-ir.test.ts',
    reason: 'workspace-mutation',
    resourceClass: 'independent-process'
  },
  {
    file: 'tests/unit/branch-lifecycle-temp-repo.test.ts',
    reason: 'process-global-environment',
    resourceClass: 'independent-process'
  },
  {
    file: 'tests/unit/ci-orchestration-git-isolation.test.ts',
    reason: 'process-global-environment',
    resourceClass: 'independent-process'
  },
  {
    file: 'tests/unit/ci-verification-execution.test.ts',
    reason: 'copied-tcb-cli-and-child-process-recovery',
    resourceClass: 'independent-process'
  },
  {
    file: 'tests/unit/project-overview.test.ts',
    reason: 'workspace-overview',
    resourceClass: 'independent-process'
  },
  {
    file: 'tests/unit/exact-git-blob.test.ts',
    reason: 'process-global-environment',
    resourceClass: 'independent-process'
  },
  {
    file: 'tests/unit/manifest-cache-activation.test.ts',
    reason: 'module-global-manifest-cache',
    resourceClass: 'independent-process'
  },
  {
    file: 'tests/unit/work-selection-main-health.test.ts',
    reason: 'production-child-process-and-runtime-state-lifecycle',
    resourceClass: 'independent-process'
  },
  {
    file: 'tests/unit/physical-no-follow.test.ts',
    reason: 'process-global-environment',
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
    file: 'tests/unit/command-runner.test.ts',
    reason: 'process-global-mocks',
    resourceClass: 'independent-process'
  },
  {
    file: 'tests/unit/verification-action-github-provider.test.ts',
    reason: 'process-global-environment',
    resourceClass: 'independent-process'
  },
  {
    file: 'tests/unit/verification-action-runner.test.ts',
    reason: 'process-global-environment',
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
    file: 'tests/unit/workspace-write-lease.test.ts',
    reason: 'workspace-lease-process-state',
    resourceClass: 'independent-process'
  },
  {
    file: 'src/adapters/providers/docker/runtime/windows-command-provider.test.ts',
    reason: 'process-global-environment-and-host-identity-readback',
    resourceClass: 'independent-process'
  },
  {
    file: 'src/adapters/providers/docker/runtime/launcher-lock.test.ts',
    reason: 'process-global-environment-and-isolated-provider-lease',
    resourceClass: 'independent-process'
  },
  {
    file: 'src/adapters/providers/docker/runtime/command-provider.test.ts',
    reason: 'process-global-environment-and-isolated-provider-capability',
    resourceClass: 'independent-process'
  },
  {
    file: 'src/adapters/repository/source-program-model/repository-compilation-cache-provider.test.ts',
    reason: 'module-global-compilation-cache-and-process-environment',
    resourceClass: 'independent-process'
  },
  {
    file: 'src/adapters/self-hosting/development/workspace-transition/operation.test.ts',
    reason: 'process-global-mocks-and-environment',
    resourceClass: 'independent-process'
  },
  {
    file: 'src/adapters/runtime-state/workspace-state/external-provider-coordination-lease.test.ts',
    reason: 'process-global-environment-and-isolated-provider-lease',
    resourceClass: 'independent-process'
  },
  {
    file: 'src/adapters/runtime-state/workspace-state/content-addressed-workspace-cache.test.ts',
    reason: 'module-global-runtime-cache-and-process-environment',
    resourceClass: 'independent-process'
  },
  {
    file: 'src/adapters/runtime-state/physical/runtime/windows-known-folders.test.ts',
    reason: 'process-global-environment-and-host-identity-readback',
    resourceClass: 'independent-process'
  },
  {
    file: 'tests/unit/dev-command-input.test.ts',
    reason: 'process-global-environment',
    resourceClass: 'independent-process'
  },
  {
    file: 'tests/unit/github-api-credential.test.ts',
    reason: 'process-global-environment-and-child-process',
    resourceClass: 'independent-process'
  },
  {
    file: 'tests/unit/local-github-actions-runner.test.ts',
    reason: 'process-global-environment-and-child-process',
    resourceClass: 'independent-process'
  },
  {
    file: 'tests/unit/template-validation-lifecycle.test.ts',
    reason: 'process-global-environment',
    resourceClass: 'independent-process'
  },
] as const satisfies readonly FastTestProcessIsolationDefinition[];

export function assertUniqueFastTestProcessIsolationDefinitions(
  definitions: readonly FastTestProcessIsolationDefinition[]
): void {
  const seen = new Set<string>();
  const resourceClasses = new Set<string>(FAST_TEST_PROCESS_RESOURCE_CLASS_ORDER);
  for (const definition of definitions) {
    const file = normalizeSecRepositoryTestModulePath(definition.file);
    if (!isSecRepositoryTestModulePath(file)) {
      throw new Error(`Fast-test process isolation path is invalid: ${definition.file}`);
    }
    if (seen.has(file)) {
      throw new Error(`Fast-test process isolation registration is duplicated: ${definition.file}`);
    }
    if (definition.reason.trim().length === 0) {
      throw new Error(`Fast-test process isolation reason is empty: ${definition.file}`);
    }
    if (!resourceClasses.has(definition.resourceClass)) {
      throw new Error(`Fast-test process isolation resource class is invalid: ${definition.file}`);
    }
    seen.add(file);
  }
}

assertUniqueFastTestProcessIsolationDefinitions(FAST_TEST_PROCESS_ISOLATION_DEFINITIONS);

export const FAST_TEST_PROCESS_ISOLATION_REGISTRY = FAST_TEST_PROCESS_ISOLATION_DEFINITIONS
  .map((definition) => ({
    ...definition,
    processLimit: DEFAULT_FAST_TEST_RESOURCE_CLASS_LIMITS[definition.resourceClass]
  }));

export function assertFastTestProcessPolicyInventory(
  currentFastFiles: readonly string[]
): void {
  const current = new Set<string>();
  for (const requestedFile of currentFastFiles) {
    const file = normalizeSecRepositoryTestModulePath(requestedFile);
    if (current.has(file)) throw new Error(`Current fast-test inventory is duplicated: ${file}`);
    current.add(file);
  }
  const excluded = new Set<string>();
  for (const entry of DEFAULT_FAST_TEST_EXCLUSION_REGISTRY) {
    const file = normalizeSecRepositoryTestModulePath(entry.file);
    if (excluded.has(file)) {
      throw new Error(`Default fast-test exclusion is duplicated: ${entry.file}`);
    }
    if (!current.has(file)) {
      throw new Error(`Default fast-test exclusion is stale: ${entry.file}`);
    }
    excluded.add(file);
  }

  assertUniqueFastTestProcessIsolationDefinitions(FAST_TEST_PROCESS_ISOLATION_DEFINITIONS);
  for (const entry of FAST_TEST_PROCESS_ISOLATION_REGISTRY) {
    const file = normalizeSecRepositoryTestModulePath(entry.file);
    if (!current.has(file)) {
      throw new Error(`Fast-test process isolation registration is stale: ${entry.file}`);
    }
    if (entry.processLimit !== DEFAULT_FAST_TEST_RESOURCE_CLASS_LIMITS[entry.resourceClass]) {
      throw new Error(`Fast-test process isolation limit drifted: ${entry.file}`);
    }
  }
}

const resourceClassByFastTestFile = new Map<string, FastTestProcessResourceClass>(
  FAST_TEST_PROCESS_ISOLATION_REGISTRY.map(({ file, resourceClass }) => [normalizeSecRepositoryTestModulePath(file), resourceClass])
);

export interface FastTestFilePartition {
  readonly concurrent: string[];
  readonly resourceQueues: Record<FastTestProcessResourceClass, string[]>;
}

export interface FastTestProcessPlan {
  readonly parallelFiles: string[];
  readonly resourceClassOrder: typeof FAST_TEST_PROCESS_RESOURCE_CLASS_ORDER;
  readonly resourceQueues: Record<FastTestProcessResourceClass, string[]>;
  readonly resourceLimits: FastTestResourceClassLimits;
}

function emptyFastTestResourceQueues(): Record<FastTestProcessResourceClass, string[]> {
  return {
    'independent-process': [],
    'shared-host-runtime': [],
    'repository-worktree': [],
    'host-profile': []
  };
}

export function partitionFastTestFiles(files: readonly string[]): FastTestFilePartition {
  const concurrent: string[] = [];
  const resourceQueues = emptyFastTestResourceQueues();

  const seen = new Set<string>();
  for (const requestedFile of files) {
    const file = normalizeSecRepositoryTestModulePath(requestedFile);
    if (seen.has(file)) throw new Error('Fast test process planning requires unique files.');
    seen.add(file);
    const resourceClass = resourceClassByFastTestFile.get(file);
    if (resourceClass) resourceQueues[resourceClass].push(file);
    else concurrent.push(file);
  }

  return { concurrent, resourceQueues };
}

export function planFastTestProcesses(
  files: readonly string[]
): FastTestProcessPlan {
  const partition = partitionFastTestFiles(files);
  return {
    parallelFiles: partition.concurrent,
    resourceClassOrder: FAST_TEST_PROCESS_RESOURCE_CLASS_ORDER,
    resourceQueues: partition.resourceQueues,
    resourceLimits: DEFAULT_FAST_TEST_RESOURCE_CLASS_LIMITS
  };
}
