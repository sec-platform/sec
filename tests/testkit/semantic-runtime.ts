import fs from 'node:fs/promises';
import path from 'node:path';

import { buildProvenance } from '../../platform/compiler/emit/write-provenance.ts';
import {
  addBlock,
  composeWorkspace,
  initWorkspace,
  resolveWorkspace
} from '../../platform/orchestrator.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';

export async function prepareTicketSemanticRuntime(workspaceRoot: string) {
  await initWorkspace(workspaceRoot, { reset: true });
  await addBlock(workspaceRoot, 'ticket/basic');
  const { lock: resolvedLock } = await resolveWorkspace(workspaceRoot);
  const { lock: composedLock } = await composeWorkspace(workspaceRoot);
  const { projectRoot } = getWorkspacePaths(workspaceRoot);
  const runtimeTarget = 'src/installed/ticket/ticket-semantic-contract.ts';
  const runtimeContract = await fs.readFile(path.join(projectRoot, runtimeTarget), 'utf8');
  const ticketForm = await fs.readFile(path.join(projectRoot, 'components', 'ticket-status-form.tsx'), 'utf8');
  const provenance = await buildProvenance(workspaceRoot, composedLock);

  return {
    resolvedLock,
    composedLock,
    runtimeTarget,
    runtimeContract,
    ticketForm,
    runtimeContractProvenance: provenance.artifacts.find((artifact) => artifact.path === runtimeTarget)
  };
}
