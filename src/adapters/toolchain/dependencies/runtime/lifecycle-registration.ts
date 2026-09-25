import path from 'node:path';

import { FailureError } from '../../../../contracts/failure.ts';
import type { GeneratedStatePhysicalIdentity } from '../../../runtime-state/generated-state/contract.ts';
import { captureRuntimeDependencyLifecycle, type CapturedRuntimeDependencyLifecycle, type RuntimeDependencyLifecycleInput } from './lifecycle-capabilities.ts';
import {
  runtimeDependencyEffectFenceOptions,
  runtimeDependencyOperationEffectFence,
  type RuntimeDependencyEffectFenceOptions
} from './operation-context.ts';
import { runtimeDependencyOperationControls, runtimeDependencyOperationRemainingMs, type BoundRuntimeDependencyOperationControls, type RuntimeDependencyOperationControlInput } from './operation-controls.ts';

export const COMPILER_NODE_MODULES_LIFECYCLE_OWNER = 'compiler-dependency-runtime' as const;
export const COMPILER_NODE_MODULES_LIFECYCLE_PRODUCER = 'ensure-compiler-deps-ready' as const;
export const COMPILER_NODE_MODULES_LIFECYCLE_RULE = 'compiler-node-modules' as const;
export const COMPILER_STAGING_LIFECYCLE_OWNER = 'compiler-dependency-runtime' as const;
export const COMPILER_STAGING_LIFECYCLE_PRODUCER = 'stage-compiler-dependency-generation' as const;
export const COMPILER_STAGING_LIFECYCLE_RULE = 'compiler-dependency-staging' as const;

/** Freeze the expected identity, not the provider's physical authority. This
 * is a value projection of the existing three-field contract; the lifecycle
 * owner still validates it against retained physical state and provenance.
 */
function captureExpectedPhysical(physical: GeneratedStatePhysicalIdentity): Readonly<GeneratedStatePhysicalIdentity> {
  const { device, inode, objectId } = physical;
  return Object.freeze({ device, inode, objectId });
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
    ...(physical === undefined ? {} : { physical: captureExpectedPhysical(physical) })
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
    physical: captureExpectedPhysical(physical)
  });
}

export async function settleRetiredCompilerDependencyGeneration(
  options: RuntimeDependencyEffectFenceOptions & RuntimeDependencyLifecycleInput<'settleRetired'>,
  expectedPhysical?: GeneratedStatePhysicalIdentity
): Promise<void> {
  const source = options.generatedStateLifecycle;
  if (source === undefined) return;
  const expected = compilerDependencyGenerationLifecycleExpectation(expectedPhysical);
  const lifecycle = captureRuntimeDependencyLifecycle({ generatedStateLifecycle: source }, ['settleRetired']);
  if (lifecycle?.settleRetired === undefined) return;
  const effect = runtimeDependencyEffectFenceOptions(options);
  await runtimeDependencyOperationEffectFence(
    effect,
    'Compiler dependency retired lifecycle settlement'
  );
  await lifecycle.settleRetired(
    'node_modules',
    expected
  );
  runtimeDependencyOperationRemainingMs(effect, 'Compiler dependency retired lifecycle readback');
}

export async function birthAndBindCompilerDependencyGeneration(
  options: RuntimeDependencyEffectFenceOptions & RuntimeDependencyLifecycleInput<'born' | 'bind'>,
  stagingRoot: string,
  expectedPhysical: GeneratedStatePhysicalIdentity
): Promise<void> {
  const source = options.generatedStateLifecycle;
  if (source === undefined) return;
  const expected = compilerDependencyGenerationLifecycleExpectation(expectedPhysical);
  const operationId = `compiler-node-modules:${path.basename(stagingRoot)}`;
  const lifecycle = captureRuntimeDependencyLifecycle({ generatedStateLifecycle: source }, ['born', 'bind'])!;
  const { born, bind } = lifecycle;
  if (born === undefined || bind === undefined) {
    throw new FailureError(
      'IMPORT-AUTHORITY-004',
      'Compiler dependency active lifecycle birth has no exact readback binding'
    );
  }
  const effect = runtimeDependencyEffectFenceOptions(options);
  await runtimeDependencyOperationEffectFence(effect, 'Compiler dependency active lifecycle birth');
  await born('node_modules', operationId);
  // Join the owner operation before rejecting; cancellation does not prove it
  // stopped. Do not perform another lifecycle call after its budget expires.
  runtimeDependencyOperationRemainingMs(effect, 'Compiler dependency active birth readback');
  await bind('node_modules', expected);
  runtimeDependencyOperationRemainingMs(effect, 'Compiler dependency active binding readback');
}

export async function bindExistingCompilerDependencyGeneration(
  options: RuntimeDependencyLifecycleInput<'bind'>,
  expectedPhysical: GeneratedStatePhysicalIdentity
): Promise<void> {
  const expected = compilerDependencyGenerationLifecycleExpectation(expectedPhysical);
  const lifecycle = captureRuntimeDependencyLifecycle(options, ['bind']);
  if (lifecycle === undefined) {
    throw new FailureError(
      'IMPORT-AUTHORITY-004',
      'Existing compiler dependency generation has no producer provenance registration and is preserved'
    );
  }
  const bind = lifecycle.bind;
  if (bind === undefined) {
    throw new FailureError(
      'IMPORT-AUTHORITY-004',
      'Compiler dependency generation adoption requires read-only producer provenance binding and is preserved'
    );
  }
  try {
    await bind(
      'node_modules',
      expected
    );
  } catch (error) {
    throw new FailureError(
      'IMPORT-AUTHORITY-004',
      'Compiler dependency generation producer provenance is missing, invalid, foreign, or stale; physical target is preserved',
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
  const expected = compilerDependencyGenerationLifecycleExpectation(expectedPhysical);
  return retireCapturedCompilerDependencyPreimage(
    captureRuntimeDependencyLifecycle(options, ['bind', 'retired']), expected, outcome
  );
}

async function retireCapturedCompilerDependencyPreimage(
  lifecycle: CapturedRuntimeDependencyLifecycle<'bind' | 'retired'> | undefined,
  expected: ReturnType<typeof compilerDependencyGenerationLifecycleExpectation>,
  outcome: string,
  controls?: BoundRuntimeDependencyOperationControls
): Promise<`sha256:${string}` | null> {
  if (lifecycle === undefined) {
    throw new FailureError(
      'IMPORT-AUTHORITY-004',
      'Existing compiler dependency generation has no producer provenance registration and is preserved'
    );
  }
  const { bind, retired: retire } = lifecycle;
  if (bind === undefined || retire === undefined) {
    throw new FailureError(
      'IMPORT-AUTHORITY-004',
      'Compiler dependency preimage retirement requires read-only producer provenance binding and is preserved'
    );
  }
  if (controls !== undefined) runtimeDependencyOperationRemainingMs(controls, 'Compiler dependency preimage binding admission');
  await preserveRetirementFailure(() => bind('node_modules', expected));
  // Budget checks are outside the provider failure adapter. Cancellation and
  // exhaustion must not be relabelled as missing producer provenance.
  if (controls !== undefined) runtimeDependencyOperationRemainingMs(controls, 'Compiler dependency preimage retirement admission');
  const digest = await preserveRetirementFailure(async () => {
    const retired = await retire('node_modules', outcome);
    return retired !== undefined && 'registrationDigest' in retired ? retired.registrationDigest : null;
  });
  if (controls !== undefined) runtimeDependencyOperationRemainingMs(controls, 'Compiler dependency preimage retirement readback');
  return digest;
}

async function preserveRetirementFailure<T>(execute: () => Promise<T>): Promise<T> {
  try {
    return await execute();
  } catch (error) {
    // A revoked proxy or a hostile code getter is still the original cause.
    let ownerFailure = false;
    try { ownerFailure = error instanceof FailureError && error.code === 'IMPORT-AUTHORITY-004'; } catch { /* Preserve below. */ }
    if (ownerFailure) throw error;
    throw new FailureError(
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
  const expected = compilerDependencyGenerationLifecycleExpectation(expectedPhysical);
  const source = options.generatedStateLifecycle;
  const lifecycle = captureRuntimeDependencyLifecycle({ generatedStateLifecycle: source }, ['observeRetirement']);
  if (lifecycle === undefined) {
    throw new FailureError(
      'IMPORT-AUTHORITY-004',
      'Compiler dependency recovery has no producer provenance lifecycle'
    );
  }
  const controls = runtimeDependencyOperationControls(options);
  if (lifecycle.observeRetirement !== undefined) {
    runtimeDependencyOperationRemainingMs(
      controls,
      'Compiler dependency preimage retirement observation'
    );
    const observation = await lifecycle.observeRetirement(
      'node_modules',
      expected
    );
    runtimeDependencyOperationRemainingMs(controls, 'Compiler dependency retirement observation readback');
    const [{ assertGeneratedStateRetirementObservation }, { sameGeneratedStateIdentity }] = await Promise.all([
      import('../../../runtime-state/generated-state/lifecycle.ts'),
      import('./dependency-transition/contract.ts')
    ]);
    runtimeDependencyOperationRemainingMs(controls, 'Compiler dependency retirement observation validation');
    assertGeneratedStateRetirementObservation(observation);
    if (observation.status === 'retired-present' && observation.physical !== null &&
        sameGeneratedStateIdentity(observation.physical, expected.physical!)) return;
    if (observation.status !== 'active') {
      throw new FailureError(
        'IMPORT-AUTHORITY-004',
        'Compiler dependency recovery requires an exact retired-present lifecycle observation',
        { status: observation.status, observationDigest: observation.observationDigest }
      );
    }
  }
  await retireCapturedCompilerDependencyPreimage(
    captureRuntimeDependencyLifecycle({ generatedStateLifecycle: source }, ['bind', 'retired']),
    expected, outcome, controls
  );
}
