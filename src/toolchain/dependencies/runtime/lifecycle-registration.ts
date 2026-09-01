import path from 'node:path';

import type { GeneratedStatePhysicalIdentity } from '../../../runtime-state/generated-state/contract.ts';
import { SecError } from '../../../system-architecture/foundation/contract/failure.ts';
import { sameGeneratedStateIdentity } from './dependency-transition/contract.ts';
import {
  runtimeDependencyOperationEffectFence,
  runtimeDependencyOperationRemainingMs,
  type RuntimeDependencyInstallOptions,
  type RuntimeDependencyOperationOptions
} from './operation-context.ts';

export const COMPILER_NODE_MODULES_LIFECYCLE_OWNER = 'compiler-dependency-runtime' as const;
export const COMPILER_NODE_MODULES_LIFECYCLE_PRODUCER = 'ensure-compiler-deps-ready' as const;
export const COMPILER_NODE_MODULES_LIFECYCLE_RULE = 'compiler-node-modules' as const;
export const COMPILER_STAGING_LIFECYCLE_OWNER = 'compiler-dependency-runtime' as const;
export const COMPILER_STAGING_LIFECYCLE_PRODUCER = 'stage-compiler-dependency-generation' as const;
export const COMPILER_STAGING_LIFECYCLE_RULE = 'compiler-dependency-staging' as const;
const SHARED_DEPS_LIFECYCLE_OWNER = 'project-runtime' as const;
const SHARED_DEPS_LIFECYCLE_PRODUCER = 'ensure-shared-deps-ready' as const;
const SHARED_DEPS_LIFECYCLE_RULE = 'shared-dependency-cache' as const;

export function sharedDependencyLifecycleExpectation(
  physical: GeneratedStatePhysicalIdentity
): Readonly<{
  owner: typeof SHARED_DEPS_LIFECYCLE_OWNER;
  producer: typeof SHARED_DEPS_LIFECYCLE_PRODUCER;
  ruleId: typeof SHARED_DEPS_LIFECYCLE_RULE;
  physical: GeneratedStatePhysicalIdentity;
}> {
  return Object.freeze({
    owner: SHARED_DEPS_LIFECYCLE_OWNER,
    producer: SHARED_DEPS_LIFECYCLE_PRODUCER,
    ruleId: SHARED_DEPS_LIFECYCLE_RULE,
    physical
  });
}

export function compilerDependencyGenerationLifecycleExpectation(
  physical?: GeneratedStatePhysicalIdentity
): Readonly<{
  owner: typeof COMPILER_NODE_MODULES_LIFECYCLE_OWNER;
  producer: typeof COMPILER_NODE_MODULES_LIFECYCLE_PRODUCER;
  ruleId: typeof COMPILER_NODE_MODULES_LIFECYCLE_RULE;
  physical?: GeneratedStatePhysicalIdentity;
}> {
  return Object.freeze({
    owner: COMPILER_NODE_MODULES_LIFECYCLE_OWNER,
    producer: COMPILER_NODE_MODULES_LIFECYCLE_PRODUCER,
    ruleId: COMPILER_NODE_MODULES_LIFECYCLE_RULE,
    ...(physical === undefined ? {} : { physical })
  });
}

export function compilerDependencyStagingLifecycleExpectation(
  physical: GeneratedStatePhysicalIdentity
): Readonly<{
  owner: typeof COMPILER_STAGING_LIFECYCLE_OWNER;
  producer: typeof COMPILER_STAGING_LIFECYCLE_PRODUCER;
  ruleId: typeof COMPILER_STAGING_LIFECYCLE_RULE;
  physical: GeneratedStatePhysicalIdentity;
}> {
  return Object.freeze({
    owner: COMPILER_STAGING_LIFECYCLE_OWNER,
    producer: COMPILER_STAGING_LIFECYCLE_PRODUCER,
    ruleId: COMPILER_STAGING_LIFECYCLE_RULE,
    physical
  });
}

export async function settleRetiredCompilerDependencyGeneration(
  options: RuntimeDependencyOperationOptions,
  expectedPhysical?: GeneratedStatePhysicalIdentity
): Promise<void> {
  const lifecycle = options.generatedStateLifecycle;
  if (lifecycle === undefined || lifecycle.settleRetired === undefined) return;
  await runtimeDependencyOperationEffectFence(
    options,
    'Compiler dependency retired lifecycle settlement'
  );
  await lifecycle.settleRetired(
    'node_modules',
    compilerDependencyGenerationLifecycleExpectation(expectedPhysical)
  );
}

export async function birthAndBindCompilerDependencyGeneration(
  options: RuntimeDependencyOperationOptions,
  stagingRoot: string,
  expectedPhysical: GeneratedStatePhysicalIdentity
): Promise<void> {
  const lifecycle = options.generatedStateLifecycle;
  if (lifecycle === undefined) return;
  await runtimeDependencyOperationEffectFence(options, 'Compiler dependency active lifecycle birth');
  await lifecycle.born(
    'node_modules',
    `compiler-node-modules:${path.basename(stagingRoot)}`
  );
  const bind = lifecycle.bind;
  if (bind === undefined) {
    throw new SecError(
      'IMPORT-AUTHORITY-004',
      'Compiler dependency active lifecycle birth has no exact readback binding'
    );
  }
  await bind(
    'node_modules',
    compilerDependencyGenerationLifecycleExpectation(expectedPhysical)
  );
}

export async function bindExistingCompilerDependencyGeneration(
  options: RuntimeDependencyInstallOptions,
  expectedPhysical: GeneratedStatePhysicalIdentity
): Promise<void> {
  const lifecycle = options.generatedStateLifecycle;
  if (lifecycle === undefined) {
    throw new SecError(
      'IMPORT-AUTHORITY-004',
      'Existing compiler dependency generation has no producer provenance registration and is preserved'
    );
  }
  const bind = lifecycle.bind;
  if (bind === undefined) {
    throw new SecError(
      'IMPORT-AUTHORITY-004',
      'Compiler dependency generation adoption requires read-only producer provenance binding and is preserved'
    );
  }
  try {
    await bind(
      'node_modules',
      compilerDependencyGenerationLifecycleExpectation(expectedPhysical)
    );
  } catch (error) {
    throw new SecError(
      'IMPORT-AUTHORITY-004',
      'Compiler dependency generation producer provenance is missing, invalid, foreign, or stale; physical target is preserved',
      { cause: error instanceof Error ? error.message : String(error) }
    );
  }
}

export async function bindExistingSharedDependencyRoot(
  options: RuntimeDependencyInstallOptions,
  expectedPhysical: GeneratedStatePhysicalIdentity
): Promise<void> {
  const lifecycle = options.generatedStateLifecycle;
  if (lifecycle === undefined) {
    throw new SecError(
      'IMPORT-AUTHORITY-004',
      'Existing shared dependency root has no producer provenance registration and is preserved'
    );
  }
  const bind = lifecycle.bind;
  if (bind === undefined) {
    throw new SecError(
      'IMPORT-AUTHORITY-004',
      'Shared dependency root adoption requires read-only producer provenance binding and is preserved'
    );
  }
  try {
    await bind(
      '.shared-deps',
      sharedDependencyLifecycleExpectation(expectedPhysical)
    );
  } catch (error) {
    throw new SecError(
      'IMPORT-AUTHORITY-004',
      'Shared dependency root producer provenance is missing, invalid, foreign, or stale; physical root is preserved',
      { cause: error instanceof Error ? error.message : String(error) }
    );
  }
}

export async function bindAndRetireCompilerDependencyPreimage(
  options: RuntimeDependencyInstallOptions,
  expectedPhysical: GeneratedStatePhysicalIdentity,
  outcome: string
): Promise<`sha256:${string}` | null> {
  const lifecycle = options.generatedStateLifecycle;
  if (lifecycle === undefined) {
    throw new SecError(
      'IMPORT-AUTHORITY-004',
      'Existing compiler dependency generation has no producer provenance registration and is preserved'
    );
  }
  const bind = lifecycle.bind;
  if (bind === undefined) {
    throw new SecError(
      'IMPORT-AUTHORITY-004',
      'Compiler dependency preimage retirement requires read-only producer provenance binding and is preserved'
    );
  }
  try {
    await bind(
      'node_modules',
      compilerDependencyGenerationLifecycleExpectation(expectedPhysical)
    );
    const retired = await lifecycle.retired('node_modules', outcome);
    return retired !== undefined && 'registrationDigest' in retired
      ? retired.registrationDigest
      : null;
  } catch (error) {
    if (error instanceof SecError && error.code === 'IMPORT-AUTHORITY-004') throw error;
    throw new SecError(
      'IMPORT-AUTHORITY-004',
      'Compiler dependency preimage producer provenance is missing, invalid, foreign, or stale; physical target is preserved',
      { cause: error instanceof Error ? error.message : String(error) }
    );
  }
}

export async function ensureCompilerDependencyPreimageRetiredForRecovery(
  options: RuntimeDependencyInstallOptions,
  expectedPhysical: GeneratedStatePhysicalIdentity,
  outcome: string
): Promise<void> {
  const lifecycle = options.generatedStateLifecycle;
  if (lifecycle === undefined) {
    throw new SecError(
      'IMPORT-AUTHORITY-004',
      'Compiler dependency recovery has no producer provenance lifecycle'
    );
  }
  if (lifecycle.observeRetirement !== undefined) {
    runtimeDependencyOperationRemainingMs(
      options,
      'Compiler dependency preimage retirement observation'
    );
    const observation = await lifecycle.observeRetirement(
      'node_modules',
      compilerDependencyGenerationLifecycleExpectation(expectedPhysical)
    );
    const { assertGeneratedStateRetirementObservation } = await import(
      '../../../runtime-state/generated-state/lifecycle.ts'
    );
    assertGeneratedStateRetirementObservation(observation);
    if (observation.status === 'retired-present' && observation.physical !== null &&
        sameGeneratedStateIdentity(observation.physical, expectedPhysical)) return;
    if (observation.status !== 'active') {
      throw new SecError(
        'IMPORT-AUTHORITY-004',
        'Compiler dependency recovery requires an exact retired-present lifecycle observation',
        { status: observation.status, observationDigest: observation.observationDigest }
      );
    }
  }
  await bindAndRetireCompilerDependencyPreimage(options, expectedPhysical, outcome);
}
