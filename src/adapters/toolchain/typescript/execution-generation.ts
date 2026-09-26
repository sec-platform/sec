import { lstat } from 'node:fs/promises';
import path from 'node:path';

import { sha256 } from '../../../contracts/canonical.ts';
import {
  assertTypeScriptProjectGenerationEvidence,
  type TypeScriptProjectGenerationEvidence,
  type TypeScriptProjectInput
} from '../../repository/source-program-model/workspace-source-snapshot.ts';
import type {
  PhysicalDirectoryIdentity,
  RetainedNoFollowProvenDirectoryGeneration,
  RetainedNoFollowSealedDirectoryGeneration
} from '../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  assertSameNoFollowDirectoryIdentity,
  inspectExactNoFollowLinkEntry,
  inspectNoFollowDirectoryChain
} from '../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  materializeRetainedTypeScriptExecutionGeneration,
  RetainedTypeScriptExecutionGenerationResidueError,
  type RetainedTypeScriptExecutionGeneration,
  type RetainedTypeScriptExecutionGenerationCleanupReceipt
} from '../../runtime-state/physical/runtime/typescript-execution-generation.ts';

const typeScriptExecutionGenerationBrand: unique symbol = Symbol(
  'typescript-execution-generation'
);
const issuedTypeScriptExecutionGenerations = new WeakSet<object>();

class TypeScriptExecutionGenerationResidueError extends Error {
  readonly code = 'TYPESCRIPT_EXECUTION_GENERATION_RESIDUE' as const;

  constructor(message: string, cause: unknown) {
    super(message, { cause });
    this.name = 'TypeScriptExecutionGenerationResidueError';
  }
}

type TypeScriptExecutionGenerationCleanupReceipt =
  RetainedTypeScriptExecutionGenerationCleanupReceipt;

/**
 * Narrow capability consumed by the TypeScript execution owner. Dependency
 * materialization remains owned by the upper orchestration layer; importing
 * that runtime here would make TypeScript preload dependency admission and
 * form a reverse toolchain cycle.
 */
export type RetainedTypeScriptCompilerDependencyGeneration = Readonly<{
  physicalGeneration: RetainedNoFollowProvenDirectoryGeneration;
  generationDigest: `sha256:${string}`;
  retire(): Promise<unknown>;
}>;

export interface TypeScriptExecutionGeneration {
  readonly [typeScriptExecutionGenerationBrand]: true;
  readonly dependencyDirectory: RetainedNoFollowProvenDirectoryGeneration;
  readonly generationDigest: `sha256:${string}`;
  readonly projectInput: TypeScriptProjectInput;
  readonly workingDirectory: RetainedNoFollowSealedDirectoryGeneration | RetainedNoFollowProvenDirectoryGeneration;
  assertCurrent(): Promise<void>;
  retire(): Promise<TypeScriptExecutionGenerationCleanupReceipt>;
}

export type MaterializeTypeScriptExecutionGenerationInput = Readonly<{
  deadlineAtUnixMs: number;
  dependencyGeneration: RetainedTypeScriptCompilerDependencyGeneration;
  dependencyLocatorPath: string;
  generationParent: PhysicalDirectoryIdentity;
  signal?: AbortSignal;
}>;

function samePhysicalDirectory(
  left: PhysicalDirectoryIdentity,
  right: PhysicalDirectoryIdentity
): boolean {
  return left.device === right.device
    && left.inode === right.inode
    && left.objectId === right.objectId;
}

async function assertDependencyLocatorTargetsGeneration(
  locatorPath: string,
  generation: RetainedNoFollowProvenDirectoryGeneration,
  assertOperationActive: (label: string) => void
): Promise<void> {
  const locator = path.resolve(locatorPath);
  if (locator !== locatorPath) {
    throw new Error('TypeScript dependency locator path is not canonical');
  }
  assertOperationActive('dependency locator admission');
  generation.assertCurrent();
  await generation.assertAuthorityCurrent();
  const locatorKind = await lstat(locator);
  assertOperationActive('dependency locator observation');
  const source = assertSameNoFollowDirectoryIdentity(
    generation.root,
    'TypeScript dependency generation source'
  ).target;
  if (locatorKind.isSymbolicLink()) {
    const parent = inspectNoFollowDirectoryChain(
      path.dirname(locator),
      'TypeScript dependency locator parent'
    ).target;
    const first = inspectExactNoFollowLinkEntry(parent, path.basename(locator), source.path);
    if (first === null || first.kind !== 'link' || first.linkTarget === null) {
      throw new Error('TypeScript dependency locator is absent or not one exact retained link');
    }
    assertOperationActive('dependency locator readback');
    generation.assertCurrent();
    await generation.assertAuthorityCurrent();
    const second = inspectExactNoFollowLinkEntry(parent, path.basename(locator), source.path);
    if (second === null || second.kind !== 'link' || second.linkTarget === null
        || first.device !== second.device || first.inode !== second.inode
        || first.linkTarget !== second.linkTarget) {
      throw new Error('TypeScript dependency locator changed during exact target validation');
    }
    return;
  }
  if (!locatorKind.isDirectory()) {
    throw new Error('TypeScript dependency locator is not one directory or directory link');
  }
  const first = inspectNoFollowDirectoryChain(
    locator,
    'TypeScript dependency directory locator'
  ).target;
  if (!samePhysicalDirectory(first, source)) {
    throw new Error('TypeScript dependency directory locator targets a foreign generation');
  }
  assertOperationActive('dependency directory locator readback');
  generation.assertCurrent();
  await generation.assertAuthorityCurrent();
  const second = inspectNoFollowDirectoryChain(
    locator,
    'TypeScript dependency directory locator readback'
  ).target;
  if (!samePhysicalDirectory(first, second) || !samePhysicalDirectory(second, source)) {
    throw new Error('TypeScript dependency directory locator changed during exact target validation');
  }
}

function assertSourceProgramExecutionConfigContainment(
  evidence: TypeScriptProjectGenerationEvidence
): void {
  const projectInput = evidence.projectInput;
  const receipt = projectInput.executionConfigContainment;
  const canonical = Object.freeze({
    status: receipt.status,
    projectConfigPath: receipt.projectConfigPath,
    projectConfigDigest: receipt.projectConfigDigest,
    workspaceSnapshotIdentityDigest: receipt.workspaceSnapshotIdentityDigest,
    dependencyGenerationDigest: receipt.dependencyGenerationDigest,
    compilerRevision: receipt.compilerRevision,
    resolvedConfigDigest: receipt.resolvedConfigDigest
  });
  if (receipt.status !== 'contained'
      || receipt.projectConfigPath !== projectInput.projectConfigPath
      || receipt.projectConfigDigest !== projectInput.projectConfigDigest
      || receipt.workspaceSnapshotIdentityDigest !== projectInput.workspaceSnapshotIdentityDigest
      || receipt.dependencyGenerationDigest !== projectInput.dependencyGenerationDigest
      || receipt.compilerRevision.length === 0
      || !/^sha256:[0-9a-f]{64}$/u.test(receipt.resolvedConfigDigest)
      || receipt.containmentDigest !== sha256(canonical)) {
    throw new Error('TypeScript execution generation config containment receipt is invalid');
  }
}

export function typeScriptExecutionGenerationDigest(
  evidence: TypeScriptProjectGenerationEvidence
): `sha256:${string}` {
  assertTypeScriptProjectGenerationEvidence(evidence);
  return sha256(Object.freeze({
    projectInputDigest: evidence.projectInput.projectInputDigest
  })) as `sha256:${string}`;
}

export function assertTypeScriptExecutionGeneration(
  generation: TypeScriptExecutionGeneration
): void {
  if (!issuedTypeScriptExecutionGenerations.has(generation)) {
    throw new Error('TypeScript execution generation was not issued by the TypeScript owner');
  }
}

/**
 * TypeScript owns config containment and the semantic generation identity.
 * Runtime Physical owns every filesystem, ACL, link and retirement Effect.
 */
export async function materializeTypeScriptExecutionGeneration(
  evidence: TypeScriptProjectGenerationEvidence,
  input: MaterializeTypeScriptExecutionGenerationInput
): Promise<TypeScriptExecutionGeneration> {
  const assertOperationActive = (label: string): void => {
    if (input.signal?.aborted === true) {
      throw new Error(`TypeScript execution generation ${label} was cancelled`);
    }
    if (!Number.isSafeInteger(input.deadlineAtUnixMs)
        || input.deadlineAtUnixMs <= Date.now()) {
      throw new Error(`TypeScript execution generation ${label} exhausted its operation deadline`);
    }
  };
  assertOperationActive('admission');
  assertTypeScriptProjectGenerationEvidence(evidence);
  const dependencyGeneration = input.dependencyGeneration;
  let physical: RetainedTypeScriptExecutionGeneration;
  try {
    dependencyGeneration.physicalGeneration.assertCurrent();
    await dependencyGeneration.physicalGeneration.assertAuthorityCurrent();
    if (evidence.projectInput.dependencyGenerationDigest !== dependencyGeneration.generationDigest) {
      throw new Error('TypeScript ProjectInput belongs to a foreign dependency generation');
    }
    for (const fact of evidence.projectInput.externalSourceFacts) {
      if (fact.kind !== 'dependency-generation') continue;
      if (fact.path.length === 0 || path.isAbsolute(fact.path)
          || fact.path.split(/[\\/]+/u).some((segment) => segment.length === 0
            || segment === '.' || segment === '..')) {
        throw new Error('TypeScript ProjectInput contains a foreign dependency source fact');
      }
    }
    const config = evidence.sourceFiles.find(({ path: sourcePath }) => (
      sourcePath === evidence.projectInput.projectConfigPath
    ));
    if (config === undefined || config.contentDigest !== evidence.projectInput.projectConfigDigest) {
      throw new Error('TypeScript execution generation config is absent or differs from ProjectInput');
    }
    assertSourceProgramExecutionConfigContainment(evidence);
    if (evidence.sourceFiles.length !== evidence.projectInput.sourceFacts.length) {
      throw new Error('TypeScript execution generation source census differs from ProjectInput');
    }
    const files = Object.freeze(evidence.projectInput.sourceFacts.map((fact, index) => {
      const source = evidence.sourceFiles[index];
      if (source === undefined || source.path !== fact.path
          || source.contentDigest !== fact.contentDigest) {
        throw new Error(`TypeScript execution generation source differs from ProjectInput: ${fact.path}`);
      }
      return Object.freeze({
        bytes: Buffer.from(source.source, 'utf8'),
        path: source.path
      });
    }));
    await assertDependencyLocatorTargetsGeneration(
      input.dependencyLocatorPath,
      dependencyGeneration.physicalGeneration,
      assertOperationActive
    );
    physical = await materializeRetainedTypeScriptExecutionGeneration({
      deadlineAtUnixMs: input.deadlineAtUnixMs,
      dependencyGeneration: dependencyGeneration.physicalGeneration,
      files,
      generationParent: input.generationParent,
      signal: input.signal
    });
  } catch (error) {
    let dependencyRetirementFailure: Readonly<{ error: unknown }> | undefined;
    try {
      await dependencyGeneration.retire();
    } catch (retirementError) {
      dependencyRetirementFailure = Object.freeze({ error: retirementError });
    }
    if (dependencyRetirementFailure !== undefined) {
      throw new TypeScriptExecutionGenerationResidueError(
        'TypeScript execution generation setup preserved dependency consumer residue',
        new AggregateError([error, dependencyRetirementFailure.error])
      );
    }
    if (error instanceof RetainedTypeScriptExecutionGenerationResidueError) {
      throw new TypeScriptExecutionGenerationResidueError(
        'TypeScript execution generation setup preserved physical residue',
        error
      );
    }
    throw error;
  }
  let retired = false;
  let retirement: Promise<TypeScriptExecutionGenerationCleanupReceipt> | null = null;
  const generation: TypeScriptExecutionGeneration = Object.freeze({
    [typeScriptExecutionGenerationBrand]: true as const,
    dependencyDirectory: physical.dependencyDirectory,
    generationDigest: typeScriptExecutionGenerationDigest(
      evidence
    ),
    projectInput: evidence.projectInput,
    workingDirectory: physical.workingDirectory,
    assertCurrent: async () => {
      if (retired) throw new Error('TypeScript execution generation is retired');
      await physical.assertCurrent();
    },
    retire: () => {
      if (retirement !== null) return retirement;
      retired = true;
      retirement = (async () => {
        let physicalReceipt: TypeScriptExecutionGenerationCleanupReceipt | undefined;
        const retirementFailures: unknown[] = [];
        try {
          physicalReceipt = await physical.retire();
        } catch (error) {
          retirementFailures.push(error);
        }
        try {
          await dependencyGeneration.retire();
        } catch (error) {
          retirementFailures.push(error);
        }
        const retirementFailure = retirementFailures.length === 0
          ? undefined
          : retirementFailures.length === 1
            ? retirementFailures[0]
            : new AggregateError(
                retirementFailures,
                'TypeScript execution generation retirement had multiple failures.'
              );
        if (retirementFailure !== undefined || physicalReceipt === undefined) {
          throw new TypeScriptExecutionGenerationResidueError(
            'TypeScript execution generation retirement preserved physical residue',
            retirementFailure
          );
        }
        return physicalReceipt;
      })();
      return retirement;
    }
  });
  issuedTypeScriptExecutionGenerations.add(generation);
  await generation.assertCurrent();
  return generation;
}
