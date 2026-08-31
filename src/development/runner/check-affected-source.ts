import { compileRepositorySourceProgramCompilation } from '../../brownfield/source-program-model/repository-compilation.ts';
import { issueTestImpactProjection } from '../../brownfield/source-program-model/test-impact-projection.ts';
import {
  acquireWorkingTreeWorkspaceSourceSnapshot,
  compileWorkspaceTypeScriptProjectInput
} from '../../brownfield/source-program-model/workspace-source-snapshot.ts';
import { tsconfigRelativePath } from '../../workspace/runtime/paths.ts';
import type { AffectedTestImpactProjectionIssuer } from './test-runner.ts';

/** Private signer for one check:affected logical operation. */
export const issueCheckAffectedTestImpactProjection: AffectedTestImpactProjectionIssuer = async (
  input
) => {
  const workspaceSnapshot = await acquireWorkingTreeWorkspaceSourceSnapshot({
    session: input.session
  });
  const projectInput = compileWorkspaceTypeScriptProjectInput(
    workspaceSnapshot,
    tsconfigRelativePath
  );
  const compilation = compileRepositorySourceProgramCompilation({
    workspaceSnapshot,
    projectInput,
    repositoryRoot: input.repositoryRoot
  });
  if (compilation.projectGeneration === null) {
    throw new Error('check:affected Source Program project generation is unavailable');
  }
  return issueTestImpactProjection({
    workspaceSnapshot,
    projectGeneration: compilation.projectGeneration,
    typeScriptModel: compilation.typeScriptCompilation.model,
    testObservations: compilation.testObservations
  });
};
