import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  addBlock,
  composeWorkspace,
  initWorkspace,
  resolveWorkspace
} from '../../platform/orchestrator.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';

const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sec-runtime-consumer-probe-'));
await initWorkspace(workspaceRoot, { reset: true });
await addBlock(workspaceRoot, 'ticket/basic');
await resolveWorkspace(workspaceRoot);
await composeWorkspace(workspaceRoot);

const { projectRoot } = getWorkspacePaths(workspaceRoot);
const source = await fs.readFile(path.join(projectRoot, 'components', 'ticket-status-form.tsx'), 'utf8');
if (!source.includes('NEXT_TICKET_STATUS[currentStatus]')) {
  throw new Error('Ticket status form must consume NEXT_TICKET_STATUS');
}
if (source.includes('const NEXT_STATUS')) {
  throw new Error('Ticket status form must not declare a local NEXT_STATUS map');
}
console.log('runtime-contract consumer probe passed');
