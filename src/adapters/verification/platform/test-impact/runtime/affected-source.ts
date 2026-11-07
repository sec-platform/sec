import { AUTHOR_KERNEL_GRAMMAR_MANIFEST, AuthorKernelInputDeclarationError, authorKernelDeclaredInputPaths } from '../../../../../contracts/author-kernel-verification.ts';
import { sha256, uniqueSorted } from '../../../../../contracts/canonical.ts';
import { observeExecutionProgressPhase } from '../../../../../execution/execution-progress.ts';
import type { GitReadSession } from '../../../../providers/git-read/runtime/session.ts';
import type { SourceProgramCompilationOperation } from '../../../../repository/source-program-model/compilation-operation.ts';
import { compileRepositorySourceProgramWithCache } from '../../../../repository/source-program-model/repository-compilation-cache-session.ts';
import { repositoryCompilationDiagnostics } from '../../../../repository/source-program-model/repository-compilation.ts';
import {
  issueTestImpactProjection,
  type IssuedTestImpactProjection
} from '../../../../repository/source-program-model/test-impact-projection.ts';
import {
  acquireWorkingTreeWorkspaceSourceSnapshot,
  compileWorkspaceTypeScriptProjectInput,
  issueWorkspaceTypeScriptProjectGenerationEvidence,
  type WorkspaceTypeScriptProjectGenerationEvidence
} from '../../../../repository/source-program-model/workspace-source-snapshot.ts';
import { readBlobBatch } from '../../../../self-hosting/development/tooling/git/git-read.ts';
import { assertRetainedCompilerDependencyReadGeneration, type RetainedCompilerDependencyReadGeneration } from '../../../../toolchain/dependencies/runtime.ts';
import { tsconfigRelativePath } from "../../../../workspace-context.ts";
import { issueTestInventoryProjection, type IssuedTestInventoryProjection } from '../contract/budget.ts';
import { issueAffectedGitSelectionSource, readAffectedGitSelectionBinding, type AffectedGitSelectionObservation, type IssuedAffectedGitSelectionSource } from './affected-git-source.ts';
import { CodexDevelopmentTestImpactTransitionDigest, gitPathBlobBatchArgs, parseGitPathBlobBatchOutput, type CodexDevelopmentTestImpactTransitionObservation } from './transition.ts';
export { issueAffectedGitSelectionSource, type AffectedGitSelectionObservation, type IssuedAffectedGitSelectionSource } from './affected-git-source.ts';

export type IssuedAffectedTestImpactSource = Readonly<{
  files: readonly string[];
  gitObservation: AffectedGitSelectionObservation;
  projection: IssuedTestImpactProjection;
  testInventory: IssuedTestInventoryProjection;
  projectGenerationEvidence: WorkspaceTypeScriptProjectGenerationEvidence;
  compilationDiagnostics: ReturnType<typeof repositoryCompilationDiagnostics>;
}>;

type AffectedBindingRecord = Readonly<{
  transition: CodexDevelopmentTestImpactTransitionObservation | null;
  descriptorChangeRoots: readonly string[];
  priorNativeDeclarationPaths: readonly string[];
  nativeDeclarationUnresolvedInputs: readonly string[];
}>;
const affectedSourceBindings = new WeakMap<object, AffectedBindingRecord>();
export function readIssuedAffectedTestImpactBinding(
  source: IssuedAffectedTestImpactSource
): AffectedBindingRecord | null {
  return affectedSourceBindings.get(source) ?? null;
}

/** Retired declarations retain their actual consumer through the same exact
 * Git observation. Current ambient files cannot supply these historical bytes. */
async function observePriorNativeDeclarations(
  selection: IssuedAffectedGitSelectionSource,
  session: GitReadSession
): Promise<Pick<AffectedBindingRecord, 'priorNativeDeclarationPaths' | 'nativeDeclarationUnresolvedInputs'>> {
  const paths: string[] = [];
  const unresolved: string[] = [];
  if (selection.files.includes(AUTHOR_KERNEL_GRAMMAR_MANIFEST)) {
    const objectIds: string[] = [];
    for (const revision of uniqueSorted([
      selection.gitObservation.headSha,
      ...(selection.gitObservation.baseSha === null ? [] : [selection.gitObservation.baseSha])
    ])) {
      const command = await session.run(gitPathBlobBatchArgs(revision, [AUTHOR_KERNEL_GRAMMAR_MANIFEST]));
      if (command.kind !== 'completed' || command.result.code !== 0) {
        throw new Error('Affected native declarations require their exact historical Git observation.');
      }
      const entries = parseGitPathBlobBatchOutput(command.result.stdout, [AUTHOR_KERNEL_GRAMMAR_MANIFEST]);
      if (session.consumeRecords(entries.size) !== null) throw new Error('Affected native declaration record budget exhausted.');
      const entry = entries.get(AUTHOR_KERNEL_GRAMMAR_MANIFEST);
      if (entry !== undefined) objectIds.push(entry.blobSha);
    }
    const blobs = await readBlobBatch(session, objectIds);
    for (const bytes of blobs.values()) {
      let source: string;
      try {
        source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        unresolved.push(AUTHOR_KERNEL_GRAMMAR_MANIFEST);
        continue;
      }
      try {
        paths.push(...authorKernelDeclaredInputPaths(source));
      } catch (error) {
        if (!(error instanceof AuthorKernelInputDeclarationError)) throw error;
        unresolved.push(AUTHOR_KERNEL_GRAMMAR_MANIFEST);
      }
    }
  }
  return Object.freeze({
    priorNativeDeclarationPaths: Object.freeze(uniqueSorted(paths)),
    nativeDeclarationUnresolvedInputs: Object.freeze(uniqueSorted(unresolved))
  });
}

export async function issueAffectedTestImpactSource(input: Readonly<{
  dependencyGeneration?: RetainedCompilerDependencyReadGeneration;
  compilationOperation: SourceProgramCompilationOperation;
  repositoryRoot: string;
  session: GitReadSession;
  baseRef: string | null;
  selection?: IssuedAffectedGitSelectionSource;
}>): Promise<IssuedAffectedTestImpactSource | null> {
  const { session, dependencyGeneration } = input;
  if (dependencyGeneration !== undefined) assertRetainedCompilerDependencyReadGeneration(dependencyGeneration);
  const selection = input.selection ?? await issueAffectedGitSelectionSource({
    session,
    baseRef: input.baseRef
  });
  if (selection === null) return null;
  const selectionBinding = readAffectedGitSelectionBinding(selection, session, input.baseRef);
  if (selectionBinding === null) return null;
  const transition = selectionBinding.transition;
  const nativeDeclarationBinding = await observePriorNativeDeclarations(selection, session);
  const workspaceSnapshot = await observeExecutionProgressPhase(
    'affected-selection', 'workspace-source-snapshot',
    () => acquireWorkingTreeWorkspaceSourceSnapshot({ session })
  );
  if (workspaceSnapshot.subject.provenance.kind !== 'working-tree-observation'
      || workspaceSnapshot.subject.provenance.providerIdentityDigest !== sha256(session.providerIdentity)
      || workspaceSnapshot.subject.provenance.repositoryRootIdentityDigest !== sha256(session.workingDirectoryIdentity)
      || transition?.removedPathBlobs.some(({ path }) => workspaceSnapshot.file(path) !== null)
      || !session.verifyExecutable() || session.verifyWorkingDirectory?.() !== true) return null;
  const projectInput = await observeExecutionProgressPhase(
    'affected-selection', 'project-input',
    () => compileWorkspaceTypeScriptProjectInput(
      workspaceSnapshot,
      tsconfigRelativePath,
      dependencyGeneration === undefined ? undefined : {
        dependencyGeneration: dependencyGeneration.physicalGeneration,
        dependencyGenerationDigest: dependencyGeneration.generationDigest
      }
    )
  );
  const compilation = await observeExecutionProgressPhase(
    'affected-selection', 'source-program.total',
    () => compileRepositorySourceProgramWithCache({
      workspaceSnapshot,
      operation: input.compilationOperation,
      projectInput,
      repositoryRoot: input.repositoryRoot
    })
  );
  const projection = issueTestImpactProjection({
    workspaceSnapshot,
    projectGeneration: compilation.projectGeneration,
    repositoryModel: compilation.model,
    typeScriptModel: compilation.typeScriptCompilation.model,
    testObservations: compilation.testObservations
  });
  if (transition !== null) CodexDevelopmentTestImpactTransitionDigest(transition);
  const source = Object.freeze({
    files: selection.files,
    gitObservation: selection.gitObservation,
    projection,
    testInventory: issueTestInventoryProjection({ snapshot: workspaceSnapshot }),
    projectGenerationEvidence: issueWorkspaceTypeScriptProjectGenerationEvidence(workspaceSnapshot, projectInput),
    compilationDiagnostics: repositoryCompilationDiagnostics(workspaceSnapshot)
  });
  affectedSourceBindings.set(source, Object.freeze({
    transition,
    descriptorChangeRoots: selectionBinding.descriptorChangeRoots,
    ...nativeDeclarationBinding
  }));
  return source;
}
