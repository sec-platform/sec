import {
  inspectNoFollowDirectoryChain
} from '../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  openContentAddressedWorkspaceCacheSession,
  type ContentAddressedWorkspaceCacheSession
} from '../../runtime-state/workspace-state/content-addressed-workspace-cache.ts';
import { sha256 } from '../../system-architecture/foundation/runtime/canonical.ts';
import {
  bindSecSemanticOperation,
  compileSecCapabilityBinding,
  compileSecSemanticOperationPlan,
  issueSecSemanticOperationAttemptContext,
  type SecOperationDigest
} from '../../system-architecture/operation/semantic.ts';
import {
  assertPhysicalWorkspaceSourceSnapshot,
  type PhysicalWorkspaceSourceSnapshot
} from './workspace-source-snapshot.ts';

const REPOSITORY_COMPILATION_CACHE_REQUIREMENT =
  'brownfield.source-program-model.repository-compilation-cache';
const REPOSITORY_COMPILATION_CACHE_MAX_DURATION_MS = 300_000;
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
    Date.now() + REPOSITORY_COMPILATION_CACHE_MAX_DURATION_MS
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
