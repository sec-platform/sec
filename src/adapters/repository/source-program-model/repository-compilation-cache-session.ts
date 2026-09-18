import {
  inspectNoFollowDirectoryChain
} from '../../runtime-state/physical/runtime/physical-no-follow.ts';
import { settlePhysicalResources } from '../../runtime-state/physical/runtime/resource-settlement.ts';
import {
  openContentAddressedWorkspaceCacheSession,
  type ContentAddressedWorkspaceCacheSession
} from '../../runtime-state/workspace-state/content-addressed-workspace-cache.ts';
import { sha256 } from '../../../contracts/canonical.ts';
import {
  bindSecSemanticOperation,
  compileSecCapabilityBinding,
  compileSecSemanticOperationPlan,
  issueSecSemanticOperationAttemptContext,
  type SecOperationDigest
} from '../../../execution/operation/semantic.ts';
import {
  SOURCE_PROGRAM_COMPILATION_MAX_DURATION_MS,
  sourceProgramCompilationCheckpoint,
  type SourceProgramCompilationOperation
} from './compilation-operation.ts';
import { createRepositoryCompilationCacheProvider } from './repository-compilation-cache-provider.ts';
import {
  compileRepositorySourceProgramCompilation,
  type CompileRepositorySourceProgramCompilationInput,
  type RepositorySourceProgramCompilationReceipt
} from './repository-compilation.ts';
import {
  assertPhysicalWorkspaceSourceSnapshot,
  type PhysicalWorkspaceSourceSnapshot
} from './workspace-source-snapshot.ts';

const REPOSITORY_COMPILATION_CACHE_REQUIREMENT =
  'brownfield.source-program-model.repository-compilation-cache';
const REPOSITORY_COMPILATION_CACHE_MIN_BYTES = 64 * 1024 * 1024;
const REPOSITORY_COMPILATION_CACHE_MAX_BYTES = 256 * 1024 * 1024;
const REPOSITORY_COMPILATION_CACHE_MAX_ENCODING_AMPLIFICATION = 8;

/**
 * Opens the sole physical cache transport for an exact Source Program input.
 * Cache bytes are non-authoritative: the compilation owner validates every
 * loaded fact shard against the supplied snapshot and compiles cold on miss.
 */
export function openRepositoryCompilationCacheSession(input: Readonly<{
  repositoryRoot: string;
  deadlineAtUnixMs: number;
  workspaceSnapshot: PhysicalWorkspaceSourceSnapshot;
}>): ContentAddressedWorkspaceCacheSession {
  assertPhysicalWorkspaceSourceSnapshot(input.workspaceSnapshot);
  const deadlineAtUnixMs = Math.min(
    input.deadlineAtUnixMs,
    Date.now() + SOURCE_PROGRAM_COMPILATION_MAX_DURATION_MS
  );
  const durationMs = deadlineAtUnixMs - Date.now();
  const sourceByteLength = input.workspaceSnapshot.sourceByteLength;
  const sourceFileCount = input.workspaceSnapshot.files.length;
  if (!Number.isSafeInteger(durationMs) || durationMs < 1
      || sourceByteLength === null
      || !Number.isSafeInteger(sourceByteLength) || sourceByteLength < 0
      || !Number.isSafeInteger(sourceFileCount) || sourceFileCount < 1) {
    throw new Error('Repository compilation cache requires one live, bounded physical Source Program snapshot.');
  }
  const repository = inspectNoFollowDirectoryChain(
    input.repositoryRoot,
    'Repository compilation cache repository root'
  ).target;
  const cacheByteBudget = Math.min(
    REPOSITORY_COMPILATION_CACHE_MAX_BYTES,
    Math.max(
      REPOSITORY_COMPILATION_CACHE_MIN_BYTES,
      sourceByteLength * REPOSITORY_COMPILATION_CACHE_MAX_ENCODING_AMPLIFICATION
    )
  );
  const contractDigest = sha256({
    operation: 'brownfield.source-program-model.repository-compilation-cache',
    physicalProvider: 'runtime-state.content-addressed-workspace-cache',
    authority: 'non-authoritative-acceleration-only'
  }) as SecOperationDigest;
  const plan = compileSecSemanticOperationPlan({
    operation: 'brownfield.source-program-model.repository-compilation-cache',
    intentDigest: sha256({
      repository,
      sourceRevision: input.workspaceSnapshot.sourceRevision,
      sourceByteLength,
      sourceFileCount
    }) as SecOperationDigest,
    decisionDigest: contractDigest,
    deadlineAtUnixMs,
    attempt: issueSecSemanticOperationAttemptContext({ authorityGrantDigest: contractDigest }),
    aggregateBudgets: [
      { resource: 'duration-ms', maximum: durationMs },
      { resource: 'input-bytes', maximum: cacheByteBudget },
      { resource: 'output-bytes', maximum: cacheByteBudget },
      { resource: 'records', maximum: Math.max(64, sourceFileCount * 4) }
    ],
    requirements: [{
      id: REPOSITORY_COMPILATION_CACHE_REQUIREMENT,
      contractDigest,
      effectKinds: ['filesystem'],
      failureKinds: [
        'cache.cancelled',
        'cache.deadline-exhausted',
        'cache.physical-replacement',
        'cache.resource-budget-exhausted',
        'cache.settlement-unproven'
      ]
    }]
  });
  const operation = bindSecSemanticOperation(plan, [compileSecCapabilityBinding({
    requirementId: REPOSITORY_COMPILATION_CACHE_REQUIREMENT,
    contractDigest,
    providerIdentityDigest: sha256({
      provider: 'runtime-state.content-addressed-workspace-cache',
      repository
    }) as SecOperationDigest
  })]);
  return openContentAddressedWorkspaceCacheSession({
    operation,
    requirementId: REPOSITORY_COMPILATION_CACHE_REQUIREMENT,
    repository
  });
}

export type CompileRepositorySourceProgramWithCacheInput = Omit<
  CompileRepositorySourceProgramCompilationInput,
  'cacheProvider' | 'operation'
> & Readonly<{
  operation: SourceProgramCompilationOperation;
  repositoryRoot: string;
}>;

/**
 * The sole production composition for a physical Source Program compilation.
 * Runtime Cache remains a disposable hint: admission failure falls back to
 * the canonical compiler, read-only access retains validated cache reads
 * without publication, and every opened session is settled. Cache access can
 * never replace or certify the compiler's semantic result.
 */
export function compileRepositorySourceProgramWithCache(
  input: CompileRepositorySourceProgramWithCacheInput
): RepositorySourceProgramCompilationReceipt {
  const { workspaceSnapshot, operation, repositoryRoot, projectInput,
    reviewedProcessDispatchers, unknowns, cacheAccess = 'read-write' } = input;
  assertPhysicalWorkspaceSourceSnapshot(workspaceSnapshot);
  // Reject forged, cancelled or exhausted operations before opening optional
  // cache resources. This failure is not a cache miss and must not fall back.
  sourceProgramCompilationCheckpoint(operation, 'admission');
  if (cacheAccess !== 'read-only' && cacheAccess !== 'read-write') {
    throw new Error('Repository compilation cache access must be read-only or read-write.');
  }
  const deadlineAtUnixMs = operation.deadlineAtUnixMs;
  if (!Number.isSafeInteger(deadlineAtUnixMs) || deadlineAtUnixMs <= Date.now()) {
    throw new Error('Repository compilation cache composition requires one live finite compilation operation.');
  }
  let session: ContentAddressedWorkspaceCacheSession | null = null;
  let cacheProvider: ReturnType<typeof createRepositoryCompilationCacheProvider> | undefined;
  try {
    session = openRepositoryCompilationCacheSession({
      repositoryRoot,
      deadlineAtUnixMs,
      workspaceSnapshot
    });
    cacheProvider = createRepositoryCompilationCacheProvider({ session });
  } catch {
    if (session !== null) {
      settlePhysicalResources({
        cleanup: [{ label: 'repository-compilation-cache-session', settle: () => { session!.close(); } }]
      });
      session = null;
    }
  }

  let compilation: RepositorySourceProgramCompilationReceipt | undefined;
  let compilationFailed = false;
  let primary: unknown;
  try {
    compilation = compileRepositorySourceProgramCompilation({
      workspaceSnapshot, operation, repositoryRoot, projectInput,
      reviewedProcessDispatchers, unknowns, cacheAccess,
      ...(cacheProvider === undefined ? {} : { cacheProvider })
    });
  } catch (error) {
    compilationFailed = true;
    primary = error;
  }
  settlePhysicalResources({
    ...(!compilationFailed ? {} : {
      primary: { label: 'repository-source-program-compilation', error: primary }
    }),
    cleanup: session === null ? [] : [{
      label: 'repository-compilation-cache-session',
      settle: () => { session!.close(); }
    }]
  });
  return compilation!;
}
