import { compileRepositorySourceProgramCompilation } from '../../brownfield/source-program-model/repository-compilation.ts';
import { issueTestImpactProjection } from '../../brownfield/source-program-model/test-impact-projection.ts';
import { acquireWorkingTreeWorkspaceSourceSnapshot } from '../../brownfield/source-program-model/workspace-source-snapshot.ts';
import type { AffectedTestImpactProjectionIssuer } from './test-runner.ts';

/** Private signer for one check:affected logical operation. */
export const issueCheckAffectedTestImpactProjection: AffectedTestImpactProjectionIssuer = async (
  input
) => {
  const workspaceSnapshot = await acquireWorkingTreeWorkspaceSourceSnapshot({
    session: input.session
  });
  const compilation = compileRepositorySourceProgramCompilation({
    workspaceSnapshot,
    repositoryRoot: input.repositoryRoot
  });
  return issueTestImpactProjection({
    workspaceSnapshot,
    typeScriptModel: compilation.typeScriptCompilation.model,
    testObservations: compilation.testObservations
  });
};
