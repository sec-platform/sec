import fs from 'node:fs/promises';
import path from 'node:path';
import { canonicalEquals } from '../../../../contracts/canonical.ts';
import { CodedFailure } from '../../../../contracts/failure.ts';
import { withAcquiredResource } from '../../../../execution/resource-settlement.ts';
import { inspectExactNoFollowDirectoryPresence } from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import { compilerDependencyIdentity } from '../../../toolchain/dependencies/runtime/compiler-materialization-input.ts';
import { compilerDependencyStoragePaths } from '../../../toolchain/dependencies/runtime/dependency-storage-layout.ts';
import { sameHostPath } from '../../../toolchain/dependencies/runtime/host-path.ts';
import { COMPILER_DEPS_BINDING_FILE, compilerDependencyGenerationBinding } from '../../../toolchain/dependencies/runtime/materialization-binding.ts';
import { runtimeDependencyOperationContext, runtimeDependencyOperationOptions, type RuntimeDependencyInstallOptions } from '../../../toolchain/dependencies/runtime/operation-context.ts';
import {
  assertCompilerDependencyReadGenerationRetirementReceipt,
  collectCompilerDependencyCacheGarbage, ensureCompilerDepsReady, publishCompilerDependencyCacheCopy,
  replaceCompilerDependencyLocatorFromGeneration,
  retainCompilerDependencyReadGeneration,
  retireMigratedCompilerDependencyNamespace,
  retireSettledCompilerDependencyStageIntents,
  type CompilerDepsReadyState
} from '../../../toolchain/dependencies/runtime/project-runtime.ts';
import { runtimeDependencySourceGeneration } from '../../../toolchain/dependencies/runtime/source-generation.ts';
import { compilerRoot } from '../../../workspace-context.ts';
import { linkedWorktreeDependencyOwnerRoot } from './linked-worktree-owner.ts';

export const resolveDevelopmentCompilerDependencyOwner: NonNullable<RuntimeDependencyInstallOptions['resolveCompilerDependencyOwner']> = async input => {
  const authority = linkedWorktreeDependencyOwnerRoot(input.consumerRoot);
  if (authority === null) return null;
  let primary: unknown;
  try {
    authority.assertCurrent();
    const ownerIdentity = await compilerDependencyIdentity(authority.ownerRoot);
    if (ownerIdentity.manifestHash !== input.consumerIdentity.manifestHash) return null;
    const locator = path.join(authority.ownerRoot, 'node_modules');
    const generationPath = path.resolve(await fs.realpath(locator).catch(() => locator));
    const binding = await compilerDependencyGenerationBinding(authority.ownerRoot, generationPath,
      path.join(generationPath, COMPILER_DEPS_BINDING_FILE), ownerIdentity);
    authority.assertCurrent();
    if (binding === null) return null;
    const [finalOwner, finalConsumer, finalBinding] = await Promise.all([
      compilerDependencyIdentity(authority.ownerRoot), compilerDependencyIdentity(input.consumerRoot),
      compilerDependencyGenerationBinding(authority.ownerRoot, generationPath,
        path.join(generationPath, COMPILER_DEPS_BINDING_FILE), ownerIdentity)
    ]);
    authority.assertCurrent();
    if (finalOwner.manifestHash !== input.consumerIdentity.manifestHash ||
        finalConsumer.manifestHash !== input.consumerIdentity.manifestHash ||
        finalBinding === null || !canonicalEquals(finalBinding, binding)) {
      throw new CodedFailure('IMPORT-AUTHORITY-004', 'Linked worktree dependency generation changed during validation');
    }
    const sourceGeneration = await runtimeDependencySourceGeneration({ binding: finalBinding,
      options: input.options, ownerRoot: authority.ownerRoot, sourcePath: generationPath });
    authority.assertCurrent();
    return Object.freeze({ binding: finalBinding, nodeModulesPath: generationPath, sourceGeneration });
  } catch (error) {
    primary = error;
    throw error;
  } finally {
    try { authority.dispose(); }
    catch (error) {
      if (primary !== undefined) throw new AggregateError([primary, error], 'Dependency owner selection and Git capability release failed');
      throw error;
    }
  }
};

/** Repository policy and Git membership stay at the development composition. */
export async function ensureDevelopmentCompilerDependencies(input: RuntimeDependencyInstallOptions = {}, root = compilerRoot): Promise<CompilerDepsReadyState> {
  return prepareDevelopmentCompilerDependencies(input, root, false);
}

async function prepareDevelopmentCompilerDependencies(input: RuntimeDependencyInstallOptions, root: string,
  deferOriginalNamespaceRetirement: boolean): Promise<CompilerDepsReadyState> {
  root = path.resolve(root);
  const options = runtimeDependencyOperationOptions({ ...input, resolveCompilerDependencyOwner: resolveDevelopmentCompilerDependencyOwner });
  const legacyIntents = path.join(root, '.tmp', 'dependency-installs', '.compiler-stage-intents-v1');
  if (inspectExactNoFollowDirectoryPresence(legacyIntents, 'Original development dependency stages').state === 'present') {
    await retireSettledCompilerDependencyStageIntents(root, options);
  }
  const ready = await ensureCompilerDepsReady(options, root);
  const source = ready.sourceGeneration;
  if (source === undefined) throw new CodedFailure('RUNTIME-DEPS-004', 'Development dependency readiness has no original source generation');
  if (sameHostPath(source.sourcePath, path.join(compilerDependencyStoragePaths(source.ownerRoot).generationRoot,
    `generation-${source.epoch.slice(7, 31)}`, 'node_modules'))) {
    await retireSettledCompilerDependencyStageIntents(root, options);
    if (!deferOriginalNamespaceRetirement) await retireMigratedCompilerDependencyNamespace(root, options);
    return ready;
  }
  if (!sameHostPath(source.ownerRoot, root)) {
    const membership = linkedWorktreeDependencyOwnerRoot(root);
    if (membership === null) throw new CodedFailure('RUNTIME-DEPS-004', 'External dependency owner requires its own explicit cache preparation');
    return withAcquiredResource({
      acquire: async () => membership,
      release: authority => authority.dispose(),
      operationLabel: 'linked-worktree cache preparation', resourceLabel: 'retained Git owner membership',
      use: async authority => {
        authority.assertCurrent();
        if (!sameHostPath(authority.ownerRoot, source.ownerRoot)) {
          throw new CodedFailure('RUNTIME-DEPS-004', 'Dependency cache source is outside the selected Git owner');
        }
        const child = runtimeDependencyOperationOptions({ ...options, beforeCommit: async () => {
          authority.assertCurrent(); await options.beforeCommit?.(); authority.assertCurrent();
        } });
        const context = runtimeDependencyOperationContext(child);
        const replaced = await withAcquiredResource({
          acquire: () => retainCompilerDependencyReadGeneration(ready.executionGenerationAuthority,
            { deadlineAtUnixMs: context.deadlineAtUnixMs, signal: context.signal }),
          release: async retained => {
            const receipt = await retained.retire();
            assertCompilerDependencyReadGenerationRetirementReceipt(receipt, retained.generationDigest);
          },
          operationLabel: 'linked-worktree dependency cache cutover', resourceLabel: 'original consumer source borrow',
          use: async retained => {
            const ownerReady = await prepareDevelopmentCompilerDependencies(child, source.ownerRoot, true);
            authority.assertCurrent();
            await retained.assertAuthorityCurrent();
            return replaceCompilerDependencyLocatorFromGeneration(ready.executionGenerationAuthority,
              ownerReady.executionGenerationAuthority, child, root);
          }
        });
        await collectCompilerDependencyCacheGarbage(source.ownerRoot, child);
        await retireMigratedCompilerDependencyNamespace(source.ownerRoot, child);
        await retireSettledCompilerDependencyStageIntents(root, child);
        if (!deferOriginalNamespaceRetirement) await retireMigratedCompilerDependencyNamespace(root, child);
        return replaced;
      }
    });
  }
  const context = runtimeDependencyOperationContext(options);
  const retained = await retainCompilerDependencyReadGeneration(ready.executionGenerationAuthority,
    { deadlineAtUnixMs: context.deadlineAtUnixMs, signal: context.signal });
  let primary: unknown;
  let published;
  try {
    published = await publishCompilerDependencyCacheCopy(ready.executionGenerationAuthority, retained, options, root);
  } catch (error) {
    primary = error;
    throw error;
  } finally {
    try {
      const receipt = await retained.retire();
      assertCompilerDependencyReadGenerationRetirementReceipt(receipt, retained.generationDigest);
    } catch (error) {
      if (primary !== undefined) throw new AggregateError([primary, error], 'Dependency cache publication and original source release failed');
      throw error;
    }
  }
  await collectCompilerDependencyCacheGarbage(root, options);
  await retireSettledCompilerDependencyStageIntents(root, options);
  if (!deferOriginalNamespaceRetirement) await retireMigratedCompilerDependencyNamespace(root, options);
  return published;
}
