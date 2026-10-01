import { sha256 } from '../../../../../contracts/canonical.ts';
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
import { assertRetainedCompilerDependencyReadGeneration, type RetainedCompilerDependencyReadGeneration } from '../../../../toolchain/dependencies/runtime.ts';
import { tsconfigRelativePath } from "../../../../workspace-context.ts";
import { issueTestInventoryProjection, type IssuedTestInventoryProjection } from '../contract/budget.ts';
import { issueAffectedGitSelectionSource, readAffectedGitSelectionBinding, type AffectedGitSelectionObservation, type IssuedAffectedGitSelectionSource } from './affected-git-source.ts';
import { CodexDevelopmentTestImpactTransitionDigest, type CodexDevelopmentTestImpactTransitionObservation } from './transition.ts';
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
  transition: CodexDevelopmentTestImpactTransitionObservation;
  descriptorChangeRoots: readonly string[];
}>;
const affectedSourceBindings = new WeakMap<object, AffectedBindingRecord>();
export function readIssuedAffectedTestImpactBinding(
  source: IssuedAffectedTestImpactSource
): AffectedBindingRecord | null {
  return affectedSourceBindings.get(source) ?? null;
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
  if (transition !== null) {
    affectedSourceBindings.set(source, Object.freeze({
      transition,
      descriptorChangeRoots: selectionBinding.descriptorChangeRoots
    }));
  }
  return source;
}
