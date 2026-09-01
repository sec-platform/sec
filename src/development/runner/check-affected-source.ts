import { compileRepositorySourceProgramCompilation } from '../../brownfield/source-program-model/repository-compilation.ts';
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
import type { RetainedCompilerDependencyReadGeneration } from '../../toolchain/dependencies/runtime.ts';
import { tsconfigRelativePath } from '../../workspace/runtime/paths.ts';

export type AffectedTestImpactProjectionIssuer = (
  input: Readonly<{
    dependencyGeneration: RetainedCompilerDependencyReadGeneration;
    repositoryRoot: string;
    session: GitReadSession;
  }>
) => Promise<Readonly<{
  projection: IssuedTestImpactProjection;
  projectGenerationEvidence: WorkspaceTypeScriptProjectGenerationEvidence;
}>>;

/** Private signer for one check:affected logical operation. */
export const issueCheckAffectedTestImpactProjection: AffectedTestImpactProjectionIssuer = async (
  input
) => {
  const workspaceSnapshot = await acquireWorkingTreeWorkspaceSourceSnapshot({
    session: input.session
  });
  const projectInput = compileWorkspaceTypeScriptProjectInput(
    workspaceSnapshot,
    tsconfigRelativePath,
    {
      dependencyGeneration: input.dependencyGeneration.physicalGeneration,
      dependencyGenerationDigest: input.dependencyGeneration.generationDigest
    }
  );
  const compilation = compileRepositorySourceProgramCompilation({
    workspaceSnapshot,
    projectInput,
    repositoryRoot: input.repositoryRoot
  });
  return Object.freeze({
    projection: issueTestImpactProjection({
      workspaceSnapshot,
      projectGeneration: compilation.projectGeneration,
      typeScriptModel: compilation.typeScriptCompilation.model,
      testObservations: compilation.testObservations
    }),
    projectGenerationEvidence: issueWorkspaceTypeScriptProjectGenerationEvidence(
      workspaceSnapshot,
      projectInput
    )
  });
};
