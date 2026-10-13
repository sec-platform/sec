import { CI_ARTIFACT_FILES } from '../assurance/verification/ci-artifacts/contract/manifest.ts';
import type { InstallPlanStep, LockFile } from '../compiler/contract.ts';
import { addGeneratedPaths } from '../compiler/contract/lock-schema.ts';
import type { PipelineSemanticContext } from '../compiler/pipeline/semantic-context.ts';
import type { OpaqueModuleMaterializationMode } from '../compiler/target-materialization.ts';
import type { CommitFence } from '../contracts/commit-fence.ts';
import { throwIfNativeAborted } from '../contracts/native-abort.ts';
import type { SemanticGeneratorTask } from '../semantics/generation/types.ts';

export type ComposeProjectOptions = Readonly<{
  commitFence?: CommitFence;
  signal?: AbortSignal;
  opaqueModuleMaterializationMode: OpaqueModuleMaterializationMode;
}>;

type Awaitable<T> = T | PromiseLike<T>;
type InstalledStep = InstallPlanStep & { status: 'installed' };
type BlockUsage = Pick<LockFile['resolvedBlocks'][number], 'id' | 'installOrder'>;

/** Concrete host capabilities, supplied by bootstrap. None owns the order or
 * completion of a composition request. The fence remains live at each effect. */
export interface ProjectCompositionOperations {
  checkWriteBoundary(): Awaitable<void>;
  ensureBase(fence: CommitFence): Awaitable<void>;
  install(steps: readonly InstallPlanStep[], lock: LockFile, fence: CommitFence, signal?: AbortSignal): Awaitable<void>;
  mergePrisma(fence: CommitFence): Awaitable<void>;
  installOpaque(mode: OpaqueModuleMaterializationMode, fence: CommitFence): Awaitable<string[]>;
  prepareArtifactDirectories(fence: CommitFence): Awaitable<void>;
  publishBlockUsage(blocks: BlockUsage[], fence: CommitFence): Awaitable<void>;
  lowerSemantic(context: PipelineSemanticContext, fence: CommitFence): Awaitable<{
    tasks: SemanticGeneratorTask[];
    generatedPaths: string[];
  }>;
  generateRuntime(lock: LockFile, fence: CommitFence, signal?: AbortSignal): Awaitable<string[]>;
  format(paths: string[], fence: CommitFence, signal?: AbortSignal): Awaitable<void>;
  applyOverrides(fence: CommitFence): Awaitable<void>;
  publishInstallManifest(manifest: InstalledStep[], fence: CommitFence): Awaitable<void>;
  readOverrideTargets(): Awaitable<string[]>;
  publishBaseline(paths: string[], fence: CommitFence): Awaitable<void>;
  persistLock(lock: LockFile, fence: CommitFence): Awaitable<void>;
}

/**
 * Compose one admitted workspace: install supply, lower semantics, materialize
 * runtime members, apply author overrides, then publish baseline and lock.
 * Failures propagate unchanged to the caller's pipeline/template-validation
 * settlement owner. Partial files are not a successful composition and are
 * never retried or deleted here; the physical write boundary owns their next
 * admission. In particular the lock cannot be published before the baseline.
 */
export async function executeProjectComposition(
  lock: LockFile,
  semanticContext: PipelineSemanticContext,
  options: ComposeProjectOptions,
  operations: ProjectCompositionOperations
): Promise<LockFile> {
  const { commitFence: providerFence, signal, opaqueModuleMaterializationMode } = options;
  if (providerFence !== undefined && typeof providerFence !== 'function') {
    throw new TypeError('Compose commit fence must be callable');
  }
  const {
    checkWriteBoundary, ensureBase, install, mergePrisma, installOpaque,
    prepareArtifactDirectories, publishBlockUsage, lowerSemantic, generateRuntime,
    format, applyOverrides, publishInstallManifest, readOverrideTargets,
    publishBaseline, persistLock
  } = operations;
  if ([checkWriteBoundary, ensureBase, install, mergePrisma, installOpaque,
    prepareArtifactDirectories, publishBlockUsage, lowerSemantic, generateRuntime,
    format, applyOverrides, publishInstallManifest, readOverrideTargets,
    publishBaseline, persistLock].some(operation => typeof operation !== 'function')) {
    throw new TypeError('Project composition operations must be callable');
  }
  throwIfNativeAborted(signal);
  // Capture the execution/manifest plan before the first callback or await.
  const installPlan = Object.freeze(lock.installPlan.map(step => Object.freeze({ ...step })));
  const commitFence: CommitFence = async () => {
    throwIfNativeAborted(signal);
    if (providerFence !== undefined) await Reflect.apply(providerFence, options, []);
    throwIfNativeAborted(signal);
  };
  // Capture ports once; preserve receivers without consulting replaceable
  // Function.call properties or a mutable operation table after an await.
  async function run<Args extends unknown[], Result>(
    operation: (...args: Args) => Awaitable<Result>, ...args: Args
  ): Promise<Result> {
    throwIfNativeAborted(signal);
    const result = await Reflect.apply(operation, operations, args) as Result;
    throwIfNativeAborted(signal);
    return result;
  }

  await run(checkWriteBoundary);
  await run(ensureBase, commitFence);
  await run(install, installPlan, lock, commitFence, signal);
  await run(mergePrisma, commitFence);
  const opaqueGeneratedPaths = await run(installOpaque, opaqueModuleMaterializationMode, commitFence);
  const installManifest: InstalledStep[] = installPlan.map(step => ({ ...step, status: 'installed' }));
  await run(prepareArtifactDirectories, commitFence);
  await run(publishBlockUsage,
    lock.resolvedBlocks.map(block => ({ id: block.id, installOrder: block.installOrder })), commitFence);
  const semanticLowering = await run(lowerSemantic, semanticContext, commitFence);
  lock.semanticLoweringTasks = semanticLowering.tasks;
  const runtimeScaffoldPaths = await run(generateRuntime, lock, commitFence, signal);
  addGeneratedPaths(lock, [
    ...semanticLowering.generatedPaths,
    ...runtimeScaffoldPaths,
    CI_ARTIFACT_FILES.blockUsageMap,
    CI_ARTIFACT_FILES.installManifest,
    ...opaqueGeneratedPaths
  ]);
  await run(format, lock.generatedPaths, commitFence, signal);
  await run(applyOverrides, commitFence);
  await run(publishInstallManifest, installManifest, commitFence);
  const overrideTargets = await run(readOverrideTargets);
  await run(publishBaseline, [
    ...installPlan.map(step => step.to),
    ...lock.generatedPaths,
    ...overrideTargets
  ], commitFence);
  throwIfNativeAborted(signal);
  lock.passStatus.compose = 'succeeded';
  // The persistence owner joins its live fence and settles publication. Once
  // it returns successfully, later cancellation cannot undo that terminal.
  await Reflect.apply(persistLock, operations, [lock, commitFence]);
  return lock;
}
