import fs from 'node:fs/promises';
import path from 'node:path';

import { buildProvenance } from '../../platform/compiler/emit/write-provenance.ts';
import {
  addBlock,
  compileWorkspace,
  initWorkspace,
  resolveWorkspace
} from '../../platform/orchestrator.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';

export async function prepareTicketSemanticRuntime(workspaceRoot: string) {
  await initWorkspace(workspaceRoot, { reset: true });
  await addBlock(workspaceRoot, 'ticket/basic');
  const { lock: resolvedLock } = await resolveWorkspace(workspaceRoot);
  const compilation = await compileWorkspace(workspaceRoot, { from: 'semantic', through: 'compose' });
  const composedLock = compilation.lock;
  const { projectRoot } = getWorkspacePaths(workspaceRoot);
  const runtimeTarget = 'src/installed/ticket/ticket-semantic-contract.ts';
  const runtimeContract = await fs.readFile(path.join(projectRoot, runtimeTarget), 'utf8');
  const ticketForm = await fs.readFile(path.join(projectRoot, 'components', 'ticket-status-form.tsx'), 'utf8');
  const ticketService = await fs.readFile(path.join(projectRoot, 'src', 'installed', 'ticket', 'ticket-service.ts'), 'utf8');
  const provenance = await buildProvenance(workspaceRoot, composedLock);

  return {
    resolvedLock,
    composedLock,
    compilation,
    projectRoot,
    runtimeTarget,
    runtimeContract,
    ticketForm,
    ticketService,
    runtimeContractProvenance: provenance.artifacts.find((artifact) => artifact.path === runtimeTarget)
  };
}
