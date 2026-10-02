import fs from 'node:fs/promises';
import path from 'node:path';
import { canonicalEquals, canonicalJson, compareCodeUnits } from '../../../../contracts/canonical.ts';
import { SecError } from '../../../../contracts/failure.ts';
import { generatedStateDigest, generatedStateDomainProviderMaterialDigest, type GeneratedStatePhysicalIdentity } from '../../../runtime-state/generated-state/contract.ts';
import { consumeGeneratedStateWorktreeRetirementEffectAuthority, type GeneratedStateWorktreeRetirementProvider } from '../../../runtime-state/generated-state/lifecycle.ts';
import { assertSameNoFollowDirectoryIdentity, deleteRetainedNoFollowEntry, inspectExactNoFollowDirectoryPresence, inspectNoFollowDirectoryChain, inspectNoFollowLinkEntry, PhysicalNoFollowError } from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import { sameGeneratedStateIdentity as sameGeneratedStatePhysicalIdentity } from './dependency-transition/contract.ts';
import { dependencyTransitionNamespacePaths } from './dependency-transition/store.ts';
import { sameHostPath } from './host-path.ts';

/**
 * Own the compiler locator observation and worktree-retirement provider as one
 * boundary: exact plan bytes, current physical identities, authority consumption,
 * link removal and terminal readback stay together. The generated-state owner
 * issues the effect authority; a parsed plan or generation path cannot issue it.
 * Native no-follow primitives retire only the locator and preserve its generation;
 * path-only unlink cannot replace the retained-identity checks and recovery readback.
 * Generation publication and transition recovery remain with project-runtime.
 */
export function canonicalCompilerDependencyGenerationOwnerRoot(
  generationPath: string
): string | null {
  const resolvedGeneration = path.resolve(generationPath);
  if (!/^generation-[0-9a-f]{24}$/u.test(path.basename(resolvedGeneration))) return null;
  const generationParent = path.dirname(resolvedGeneration);
  let candidateOwner = generationParent;
  while (true) {
    if (sameHostPath(
      dependencyTransitionNamespacePaths(candidateOwner).backupRoot,
      generationParent
    )) return candidateOwner;
    const parent = path.dirname(candidateOwner);
    if (parent === candidateOwner) return null;
    candidateOwner = parent;
  }
}

export function isCanonicalLocalCompilerDependencyGeneration(
  consumerRoot: string,
  generationPath: string
): boolean {
  const ownerRoot = canonicalCompilerDependencyGenerationOwnerRoot(generationPath);
  return ownerRoot !== null && sameHostPath(ownerRoot, consumerRoot);
}

const COMPILER_DEPENDENCY_LOCATOR_PROVIDER_ID = 'compiler-dependency-locator' as const;

const COMPILER_DEPENDENCY_LOCATOR_PLAN_SCHEMA = 'sec-compiler-dependency-locator-retirement-plan' as const;

const COMPILER_DEPENDENCY_LOCATOR_RECEIPT_SCHEMA = 'sec-compiler-dependency-locator-retirement-receipt' as const;

interface CompilerDependencyLocatorRetirementPlan {
  readonly schema: typeof COMPILER_DEPENDENCY_LOCATOR_PLAN_SCHEMA;
  readonly consumerRoot: string;
  readonly consumer: GeneratedStatePhysicalIdentity;
  readonly relativePath: 'node_modules';
  readonly source: GeneratedStatePhysicalIdentity;
  readonly linkTarget: string;
  readonly generationPath: string;
  readonly generation: Readonly<{ device: string; inode: string; mode: string }> | null;
}

function compilerDependencyConsumerIdentity(consumerRoot: string): GeneratedStatePhysicalIdentity {
  const consumer = inspectNoFollowDirectoryChain(
    consumerRoot,
    'Compiler dependency locator consumer root'
  ).target;
  return Object.freeze({ device: consumer.device, inode: consumer.inode, objectId: consumer.objectId });
}

export function compilerDependencyLocatorObservation(
  consumerRoot: string,
  relativePath: string
): Readonly<{ source: GeneratedStatePhysicalIdentity; linkTarget: string }> | null {
  if (relativePath !== 'node_modules') {
    throw new Error('Compiler dependency locator provider only owns node_modules.');
  }
  const root = inspectNoFollowDirectoryChain(consumerRoot, 'Compiler dependency locator consumer root').target;
  try {
    const ordinaryDirectory = inspectExactNoFollowDirectoryPresence(
      path.join(root.path, relativePath),
      'Compiler dependency ordinary node_modules'
    );
    if (ordinaryDirectory.state === 'present') {
      assertSameNoFollowDirectoryIdentity(root, 'Compiler dependency locator consumer root readback');
      return null;
    }
  } catch (error) {
    // A retained reparse/symlink leaf is intentionally rejected by the
    // ordinary-directory observer and must then be observed by the exact link
    // capability below. Other kinds and physical failures remain blockers.
    if (!(error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_UNSAFE_PATH')) {
      throw error;
    }
  }
  const locator = inspectNoFollowLinkEntry(root, relativePath);
  if (locator === null || locator.kind !== 'link' || locator.linkTarget === null) return null;
  return Object.freeze({
    source: Object.freeze({
      device: locator.device,
      inode: locator.inode,
      objectId: generatedStateDigest({ kind: 'link', target: locator.linkTarget })
    }),
    linkTarget: locator.linkTarget
  });
}

async function compilerDependencyGenerationIdentity(
  generationPath: string
): Promise<Readonly<{ device: string; inode: string; mode: string }>> {
  const metadata = await fs.lstat(generationPath, { bigint: true });
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error('Compiler dependency generation is not one ordinary directory.');
  }
  return Object.freeze({
    device: String(metadata.dev),
    inode: String(metadata.ino),
    mode: String(metadata.mode)
  });
}

async function compilerDependencyGenerationIdentityIfPresent(
  generationPath: string
): Promise<Readonly<{ device: string; inode: string; mode: string }> | null> {
  try {
    return await compilerDependencyGenerationIdentity(generationPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function parseCompilerDependencyLocatorRetirementPlan(
  bytes: string
): CompilerDependencyLocatorRetirementPlan {
  const candidate = JSON.parse(bytes) as Partial<CompilerDependencyLocatorRetirementPlan>;
  if (JSON.stringify(canonicalJson(candidate)) !== bytes || candidate.schema !== COMPILER_DEPENDENCY_LOCATOR_PLAN_SCHEMA ||
      candidate.relativePath !== 'node_modules' || typeof candidate.consumerRoot !== 'string' ||
      typeof candidate.linkTarget !== 'string' || typeof candidate.generationPath !== 'string' ||
      candidate.source === undefined || candidate.consumer === undefined || candidate.generation === undefined) {
    throw new Error('Compiler dependency locator provider plan is malformed.');
  }
  const expectedKeys = [
    'consumer', 'consumerRoot', 'generation', 'generationPath', 'linkTarget', 'relativePath', 'schema', 'source'
  ];
  if (Object.keys(candidate).sort(compareCodeUnits).join('\0') !== expectedKeys.join('\0') ||
      Object.keys(candidate.source).sort(compareCodeUnits).join('\0') !== ['device', 'inode', 'objectId'].join('\0') ||
      Object.keys(candidate.consumer).sort(compareCodeUnits).join('\0') !== ['device', 'inode', 'objectId'].join('\0') ||
      (candidate.generation !== null &&
        Object.keys(candidate.generation).sort(compareCodeUnits).join('\0') !== ['device', 'inode', 'mode'].join('\0')) ||
      Object.values(candidate.source).some((value) => typeof value !== 'string') ||
      Object.values(candidate.consumer).some((value) => typeof value !== 'string') ||
      (candidate.generation !== null &&
        Object.values(candidate.generation).some((value) => typeof value !== 'string'))) {
    throw new Error('Compiler dependency locator provider plan shape is invalid.');
  }
  return candidate as CompilerDependencyLocatorRetirementPlan;
}

async function validateCompilerDependencyLocatorPlan(
  plan: CompilerDependencyLocatorRetirementPlan,
  requireLocator: boolean
): Promise<Readonly<{
  consumer: ReturnType<typeof inspectNoFollowDirectoryChain>['target'];
  locator: ReturnType<typeof compilerDependencyLocatorObservation>;
}>> {
  const consumerRoot = path.resolve(plan.consumerRoot);
  const generationPath = path.resolve(plan.generationPath);
  const relativeGeneration = path.relative(consumerRoot, generationPath);
  const generationIsExternal = relativeGeneration === '..' || relativeGeneration.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeGeneration);
  const generationIsLocalImmutable = isCanonicalLocalCompilerDependencyGeneration(
    consumerRoot,
    generationPath
  );
  if (consumerRoot !== plan.consumerRoot || generationPath !== plan.generationPath ||
      (!generationIsExternal && !generationIsLocalImmutable)) {
    throw new Error('Compiler dependency locator provider plan paths are not canonical generation paths.');
  }
  const observedConsumer = compilerDependencyConsumerIdentity(consumerRoot);
  if (!sameGeneratedStatePhysicalIdentity(observedConsumer, plan.consumer)) {
    throw new Error('Compiler dependency locator provider consumer root identity changed.');
  }
  const generation = await compilerDependencyGenerationIdentityIfPresent(generationPath);
  if (!canonicalEquals(generation, plan.generation)) {
    throw new Error('Compiler dependency locator provider inputs or generation identity changed.');
  }
  if (!requireLocator) {
    const finalConsumer = inspectNoFollowDirectoryChain(
      consumerRoot,
      'Compiler dependency locator final consumer root'
    ).target;
    const finalGeneration = await compilerDependencyGenerationIdentityIfPresent(generationPath);
    if (!sameGeneratedStatePhysicalIdentity(
      { device: finalConsumer.device, inode: finalConsumer.inode, objectId: finalConsumer.objectId },
      plan.consumer
    ) || !canonicalEquals(finalGeneration, plan.generation)) {
      throw new Error('Compiler dependency locator provider inputs changed during final validation.');
    }
    return Object.freeze({ consumer: finalConsumer, locator: null });
  }
  const locator = compilerDependencyLocatorObservation(consumerRoot, plan.relativePath);
  if (locator === null || !sameGeneratedStatePhysicalIdentity(locator.source, plan.source) ||
      locator.linkTarget !== plan.linkTarget ||
      !sameHostPath(path.resolve(await fs.realpath(path.join(consumerRoot, plan.relativePath)).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT' && plan.generation === null) {
            return fs.readlink(path.join(consumerRoot, plan.relativePath));
          }
          throw error;
        }
      )), generationPath)) {
    throw new Error('Compiler dependency locator provider locator identity or target changed.');
  }
  const finalGeneration = await compilerDependencyGenerationIdentityIfPresent(generationPath);
  const finalConsumer = inspectNoFollowDirectoryChain(
    consumerRoot,
    'Compiler dependency locator final consumer root'
  ).target;
  if (!sameGeneratedStatePhysicalIdentity(
    { device: finalConsumer.device, inode: finalConsumer.inode, objectId: finalConsumer.objectId },
      plan.consumer
  ) || !canonicalEquals(finalGeneration, plan.generation)) {
    throw new Error('Compiler dependency locator provider inputs changed during final validation.');
  }
  return Object.freeze({ consumer: finalConsumer, locator });
}

export const compilerDependencyLocatorWorktreeRetirementProvider:
GeneratedStateWorktreeRetirementProvider = Object.freeze<GeneratedStateWorktreeRetirementProvider>({
  id: COMPILER_DEPENDENCY_LOCATOR_PROVIDER_ID,
  async plan(input) {
    if (input.relativePath !== 'node_modules' ||
      !sameGeneratedStatePhysicalIdentity(input.registration.root, input.source)) {
      throw new Error('Compiler dependency locator provider requires one exact registration.');
    }
    const consumerRoot = path.resolve(input.workspaceRoot);
    const consumer = compilerDependencyConsumerIdentity(consumerRoot);
    if (!sameGeneratedStatePhysicalIdentity(consumer, input.registration.workspace)) {
      throw new Error('Compiler dependency locator provider registration targets another consumer root.');
    }
    const locator = compilerDependencyLocatorObservation(consumerRoot, input.relativePath);
    if (locator === null || !sameGeneratedStatePhysicalIdentity(locator.source, input.source)) {
      throw new Error('Compiler dependency locator provider source changed before planning.');
    }
    const generationPath = path.resolve(await fs.realpath(path.join(consumerRoot, input.relativePath)).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') {
          return fs.readlink(path.join(consumerRoot, input.relativePath));
        }
        throw error;
      }
    ));
    const material: CompilerDependencyLocatorRetirementPlan = Object.freeze({
      schema: COMPILER_DEPENDENCY_LOCATOR_PLAN_SCHEMA,
      consumerRoot,
      consumer,
      relativePath: 'node_modules',
      source: locator.source,
      linkTarget: locator.linkTarget,
      generationPath,
      generation: await compilerDependencyGenerationIdentityIfPresent(generationPath)
    });
    const bytes = JSON.stringify(canonicalJson(material));
    return Object.freeze({
      bytes,
      digest: generatedStateDomainProviderMaterialDigest(COMPILER_DEPENDENCY_LOCATOR_PROVIDER_ID, 'plan', bytes)
    });
  },
  async retire(authority) {
    const authorized = consumeGeneratedStateWorktreeRetirementEffectAuthority(
      authority,
      COMPILER_DEPENDENCY_LOCATOR_PROVIDER_ID
    );
    if (authorized.relativePath !== 'node_modules' || authorized.registration.phase !== 'retired' ||
        authorized.planDigest !== generatedStateDomainProviderMaterialDigest(
          COMPILER_DEPENDENCY_LOCATOR_PROVIDER_ID,
          'plan',
          authorized.planBytes
        )) {
      throw new Error('Compiler dependency locator provider retirement authority is invalid.');
    }
    const plan = parseCompilerDependencyLocatorRetirementPlan(authorized.planBytes);
    if (path.resolve(authorized.workspaceRoot) !== plan.consumerRoot ||
      !sameGeneratedStatePhysicalIdentity(authorized.source, plan.source) ||
      !sameGeneratedStatePhysicalIdentity(authorized.registration.root, plan.source) ||
      !sameGeneratedStatePhysicalIdentity(authorized.registration.workspace, plan.consumer)) {
      throw new Error('Compiler dependency locator provider retirement binding changed.');
    }
    const validateRetirementPlan = async (requireLocator: boolean) => {
      try {
        return await validateCompilerDependencyLocatorPlan(plan, requireLocator);
      } catch (error) {
        if (error instanceof SecError) throw error;
        const cause = error instanceof Error ? error.message : String(error);
        throw new SecError(
          'IMPORT-AUTHORITY-004',
          `Compiler dependency locator retirement validation failed: ${cause}`,
          { cause, consumerRoot: plan.consumerRoot }
        );
      }
    };
    const locator = compilerDependencyLocatorObservation(plan.consumerRoot, plan.relativePath);
    let outcome: 'removed' | 'resumed-absent';
    if (locator === null) {
      if (inspectExactNoFollowDirectoryPresence(
        path.join(plan.consumerRoot, plan.relativePath),
        'Compiler dependency locator retirement absence readback'
      ).state !== 'absent') {
        throw new SecError(
          'IMPORT-AUTHORITY-004',
          'Compiler dependency locator retirement found an occupied non-locator path.',
          { consumerRoot: plan.consumerRoot, relativePath: plan.relativePath }
        );
      }
      await validateRetirementPlan(false);
      outcome = 'resumed-absent';
    } else {
      const validated = await validateRetirementPlan(true);
      deleteRetainedNoFollowEntry({
        root: validated.consumer,
        relativePath: plan.relativePath,
        kind: 'link',
        device: locator.source.device,
        inode: locator.source.inode,
        expectedLinkTarget: locator.linkTarget,
        ancestorDirectories: Object.freeze([])
      });
      if (inspectExactNoFollowDirectoryPresence(
        path.join(plan.consumerRoot, plan.relativePath),
        'Compiler dependency locator retirement terminal absence readback'
      ).state !== 'absent') {
        throw new Error('Compiler dependency locator provider locator remains after retirement.');
      }
      await validateRetirementPlan(false);
      outcome = 'removed';
    }
    const bytes = JSON.stringify(canonicalJson(Object.freeze({
      schema: COMPILER_DEPENDENCY_LOCATOR_RECEIPT_SCHEMA,
      operationId: authorized.operationId,
      planDigest: authorized.planDigest,
      outcome,
      locator: plan.source,
      generation: plan.generation
    })));
    return Object.freeze({
      bytes,
      digest: generatedStateDomainProviderMaterialDigest(COMPILER_DEPENDENCY_LOCATOR_PROVIDER_ID, 'receipt', bytes)
    });
  }
});
