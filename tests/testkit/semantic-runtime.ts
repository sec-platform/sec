import fs from 'node:fs/promises';
import path from 'node:path';

import { buildProvenance } from '../../src/adapters/compilation/emit/write-provenance.ts';
import { addBlock, compileWorkspace, initWorkspace, resolveWorkspace } from '../../src/bootstrap/engineering/cli.ts';

export async function prepareTicketSemanticRuntime(workspaceRoot: string) {
  await initWorkspace(workspaceRoot, { template: 'reference-customer' });
  await addBlock(workspaceRoot, 'ticket/basic');
  const { lock: resolvedLock } = await resolveWorkspace(workspaceRoot);
  const compilation = await compileWorkspace(workspaceRoot, { from: 'semantic', through: 'compose' });
  const composedLock = compilation.lock;
  const runtimeTarget = 'src/installed/ticket/ticket-semantic-contract.ts';
  const runtimeContract = await fs.readFile(path.join(workspaceRoot, runtimeTarget), 'utf8');
  const ticketService = await fs.readFile(path.join(workspaceRoot, 'src', 'installed', 'ticket', 'ticket-service.ts'), 'utf8');
  const provenance = await buildProvenance(workspaceRoot, composedLock);

  return {
    resolvedLock,
    composedLock,
    compilation,
    workspaceRoot,
    runtimeTarget,
    runtimeContract,
    ticketService,
    runtimeContractProvenance: provenance.artifacts.find((artifact) => artifact.path === runtimeTarget)
  };
}
