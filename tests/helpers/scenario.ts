import {
  adaptWorkspace,
  composeWorkspace,
  initWorkspace,
  lockWorkspace,
  resolveWorkspace,
  verifyWorkspace
} from '../../platform/orchestrator.ts';
import { createWorkspace } from '../testkit/workspace.ts';

export type ScenarioWorkspace = {
  root: string;
  resolved(): Promise<ScenarioWorkspace>;
  composed(): Promise<ScenarioWorkspace>;
  adapted(): Promise<ScenarioWorkspace>;
  verified(lane?: 'fast' | 'runtime' | 'all'): Promise<ScenarioWorkspace>;
  locked(): Promise<ScenarioWorkspace>;
};

export async function scenario(prefix = 'scenario-'): Promise<ScenarioWorkspace> {
  const root = await createWorkspace(prefix);

  const workspace: ScenarioWorkspace = {
    root,
    async resolved() {
      await initWorkspace(root, { reset: true });
      await resolveWorkspace(root);
      return workspace;
    },
    async composed() {
      await composeWorkspace(root);
      return workspace;
    },
    async adapted() {
      await adaptWorkspace(root);
      return workspace;
    },
    async verified(lane = 'fast') {
      await verifyWorkspace(root, { lane });
      return workspace;
    },
    async locked() {
      await lockWorkspace(root);
      return workspace;
    }
  };

  return workspace;
}
