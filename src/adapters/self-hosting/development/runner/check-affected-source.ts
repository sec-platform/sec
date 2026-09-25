import type { GitReadSession } from '../../../providers/git-read/runtime/session.ts';
import type { SourceProgramCompilationOperation } from '../../../repository/source-program-model/compilation-operation.ts';
import { compileRepositorySourceProgramWithCache } from '../../../repository/source-program-model/repository-compilation-cache-session.ts';
import {
  repositoryCompilationDiagnostics,
  type RepositoryCompilationDiagnostics
} from '../../../repository/source-program-model/repository-compilation.ts';
import {
  issueTestImpactProjection,
  type IssuedTestImpactProjection
} from '../../../repository/source-program-model/test-impact-projection.ts';
import {
  acquireWorkingTreeSnapshot,
  compileTypeScriptProjectInput,
  issueTypeScriptProjectGenerationEvidence,
  type TypeScriptProjectGenerationEvidence
} from '../../../repository/source-program-model/workspace-source-snapshot.ts';
import { assertRetainedCompilerDependencyReadGeneration, type RetainedCompilerDependencyReadGeneration } from '../../../toolchain/dependencies/runtime.ts';
import { issueTestInventoryProjection, type IssuedTestInventoryProjection } from '../../../verification/platform/test-impact/contract/budget.ts';
import { tsconfigRelativePath } from "../../../workspace-context.ts";

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
  projectGenerationEvidence: TypeScriptProjectGenerationEvidence;
  compilationDiagnostics?: RepositoryCompilationDiagnostics | null;
}>>;

/** Private signer for one affected-check logical operation. */
export const issueCheckAffectedTestImpactProjection: AffectedTestImpactProjectionIssuer = async (
  input
) => {
  const dependencyGeneration = input.dependencyGeneration;
  assertRetainedCompilerDependencyReadGeneration(dependencyGeneration);
  const workspaceSnapshot = await acquireWorkingTreeSnapshot({
    session: input.session
  });
  const projectInput = compileTypeScriptProjectInput(
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
    projectGenerationEvidence: issueTypeScriptProjectGenerationEvidence(
      workspaceSnapshot,
      projectInput
    ),
    compilationDiagnostics: repositoryCompilationDiagnostics(workspaceSnapshot)
  });
};
