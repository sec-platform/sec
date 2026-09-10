import type { SourceProgramCompilationOperation } from '../../brownfield/source-program-model/compilation-operation.ts';
import { compileRepositorySourceProgramWithCache } from '../../brownfield/source-program-model/repository-compilation-cache-session.ts';
import {
  issueTestImpactProjection,
  type IssuedTestImpactProjection
} from '../../brownfield/source-program-model/test-impact-projection.ts';
import {
  acquireWorkingTreeWorkspaceSourceSnapshot,
  compileWorkspaceTypeScriptProjectInput,
  issueWorkspaceTypeScriptProjectGenerationEvidence,
  type WorkspaceTypeScriptProjectGenerationEvidence
} from '../../brownfield/source-program-model/workspace-source-snapshot.ts';
import type { GitReadSession } from '../../external-capabilities/git-read/runtime/session.ts';
import { assertRetainedCompilerDependencyReadGeneration, type RetainedCompilerDependencyReadGeneration } from '../../toolchain/dependencies/runtime.ts';
import { issueTestInventoryProjection, type IssuedTestInventoryProjection } from '../../verification/test-impact/contract/budget.ts';
import { tsconfigRelativePath } from '../../workspace/runtime/paths.ts';

export type AffectedTestImpactProjectionIssuer = (
  input: Readonly<{
    dependencyGeneration: RetainedCompilerDependencyReadGeneration;
    compilationOperation: SourceProgramCompilationOperation;
    repositoryRoot: string;
    session: GitReadSession;
  }>
) => Promise<Readonly<{
  projection: IssuedTestImpactProjection;
  testInventory: IssuedTestInventoryProjection;
  projectGenerationEvidence: WorkspaceTypeScriptProjectGenerationEvidence;
}>>;

/** Private signer for one check:affected logical operation. */
export const issueCheckAffectedTestImpactProjection: AffectedTestImpactProjectionIssuer = async (
  input
) => {
  const dependencyGeneration = input.dependencyGeneration;
  assertRetainedCompilerDependencyReadGeneration(dependencyGeneration);
  const workspaceSnapshot = await acquireWorkingTreeWorkspaceSourceSnapshot({
    session: input.session
  });
  const projectInput = compileWorkspaceTypeScriptProjectInput(
    workspaceSnapshot,
    tsconfigRelativePath,
    {
      dependencyGeneration: dependencyGeneration.physicalGeneration,
      dependencyGenerationDigest: dependencyGeneration.generationDigest
    }
  );
  const compilation = compileRepositorySourceProgramWithCache({
    workspaceSnapshot,
    operation: input.compilationOperation,
    projectInput,
    repositoryRoot: input.repositoryRoot
  });
  return Object.freeze({
    projection: issueTestImpactProjection({
      workspaceSnapshot,
      projectGeneration: compilation.projectGeneration,
      repositoryModel: compilation.model,
      typeScriptModel: compilation.typeScriptCompilation.model,
      testObservations: compilation.testObservations
    }),
    testInventory: issueTestInventoryProjection({ snapshot: workspaceSnapshot }),
    projectGenerationEvidence: issueWorkspaceTypeScriptProjectGenerationEvidence(
      workspaceSnapshot,
      projectInput
    )
  });
};
