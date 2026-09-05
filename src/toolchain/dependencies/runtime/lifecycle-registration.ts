import path from 'node:path';

import type { GeneratedStatePhysicalIdentity } from '../../../runtime-state/generated-state/contract.ts';
import { SecError } from '../../../system-architecture/foundation/contract/failure.ts';
import {
  runtimeDependencyOperationEffectFence,
  type RuntimeDependencyEffectFenceOptions
} from './operation-context.ts';
import { runtimeDependencyOperationRemainingMs, type RuntimeDependencyOperationControlInput } from './operation-controls.ts';
import { captureRuntimeDependencyLifecycle, type CapturedRuntimeDependencyLifecycle, type RuntimeDependencyLifecycleInput } from './lifecycle-capabilities.ts';

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
  options: RuntimeDependencyEffectFenceOptions & RuntimeDependencyLifecycleInput<'settleRetired'>,
  expectedPhysical?: GeneratedStatePhysicalIdentity
): Promise<void> {
  const lifecycle = captureRuntimeDependencyLifecycle(options, ['settleRetired']);
  if (lifecycle?.settleRetired === undefined) return;
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
  options: RuntimeDependencyEffectFenceOptions & RuntimeDependencyLifecycleInput<'born' | 'bind'>,
  stagingRoot: string,
  expectedPhysical: GeneratedStatePhysicalIdentity
): Promise<void> {
  const lifecycle = captureRuntimeDependencyLifecycle(options, ['born', 'bind']);
  if (lifecycle === undefined) return;
  const { born, bind } = lifecycle;
  if (born === undefined || bind === undefined) {
    throw new SecError(
      'IMPORT-AUTHORITY-004',
      'Compiler dependency active lifecycle birth has no exact readback binding'
    );
  }
  await runtimeDependencyOperationEffectFence(options, 'Compiler dependency active lifecycle birth');
  await born('node_modules', `compiler-node-modules:${path.basename(stagingRoot)}`);
  await bind('node_modules', compilerDependencyGenerationLifecycleExpectation(expectedPhysical));
}

export async function bindExistingCompilerDependencyGeneration(
  options: RuntimeDependencyLifecycleInput<'bind'>,
  expectedPhysical: GeneratedStatePhysicalIdentity
): Promise<void> {
  const lifecycle = captureRuntimeDependencyLifecycle(options, ['bind']);
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
      { cause: lifecycleFailureMessage(error) },
      { cause: error }
    );
  }
}

export async function bindExistingSharedDependencyRoot(
  options: RuntimeDependencyLifecycleInput<'bind'>,
  expectedPhysical: GeneratedStatePhysicalIdentity
): Promise<void> {
  const lifecycle = captureRuntimeDependencyLifecycle(options, ['bind']);
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
      { cause: lifecycleFailureMessage(error) },
      { cause: error }
    );
  }
}

function lifecycleFailureMessage(error: unknown): string {
  try {
    const message = error instanceof Error ? error.message : String(error);
    return typeof message === 'string' ? message : 'Unreadable lifecycle failure';
  } catch {
    return 'Unreadable lifecycle failure';
  }
}

export async function bindAndRetireCompilerDependencyPreimage(
  options: RuntimeDependencyLifecycleInput<'bind' | 'retired'>,
  expectedPhysical: GeneratedStatePhysicalIdentity,
  outcome: string
): Promise<`sha256:${string}` | null> {
  return retireCapturedCompilerDependencyPreimage(
    captureRuntimeDependencyLifecycle(options, ['bind', 'retired']), expectedPhysical, outcome
  );
}

async function retireCapturedCompilerDependencyPreimage(
  lifecycle: CapturedRuntimeDependencyLifecycle<'bind' | 'retired'> | undefined,
  expectedPhysical: GeneratedStatePhysicalIdentity,
  outcome: string
): Promise<`sha256:${string}` | null> {
  if (lifecycle === undefined) {
    throw new SecError(
      'IMPORT-AUTHORITY-004',
      'Existing compiler dependency generation has no producer provenance registration and is preserved'
    );
  }
  const { bind, retired: retire } = lifecycle;
  if (bind === undefined || retire === undefined) {
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
    const retired = await retire('node_modules', outcome);
    return retired !== undefined && 'registrationDigest' in retired
      ? retired.registrationDigest
      : null;
  } catch (error) {
    // A revoked proxy or a hostile code getter is still the original cause.
    let ownerFailure = false;
    try { ownerFailure = error instanceof SecError && error.code === 'IMPORT-AUTHORITY-004'; } catch { /* Preserve below. */ }
    if (ownerFailure) throw error;
    throw new SecError(
      'IMPORT-AUTHORITY-004',
      'Compiler dependency preimage producer provenance is missing, invalid, foreign, or stale; physical target is preserved',
      { cause: lifecycleFailureMessage(error) },
      { cause: error }
    );
  }
}

export async function ensureCompilerDependencyPreimageRetiredForRecovery(
  options: RuntimeDependencyOperationControlInput & RuntimeDependencyLifecycleInput<'observeRetirement' | 'bind' | 'retired'>,
  expectedPhysical: GeneratedStatePhysicalIdentity,
  outcome: string
): Promise<void> {
  // Observation and retirement are different phases. A read-only no-op must
  // not inspect unused write methods, while a selected write captures its
  // methods before its own first effect. Keep the provider reference stable.
  const source = options.generatedStateLifecycle;
  const lifecycle = captureRuntimeDependencyLifecycle({ generatedStateLifecycle: source }, ['observeRetirement']);
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
    const [{ assertGeneratedStateRetirementObservation }, { sameGeneratedStateIdentity }] = await Promise.all([
      import('../../../runtime-state/generated-state/lifecycle.ts'),
      import('./dependency-transition/contract.ts')
    ]);
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
  await retireCapturedCompilerDependencyPreimage(
    captureRuntimeDependencyLifecycle({ generatedStateLifecycle: source }, ['bind', 'retired']),
    expectedPhysical, outcome
  );
}
