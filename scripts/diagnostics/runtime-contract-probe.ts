import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { buildProvenance } from '../../platform/compiler/emit/write-provenance.ts';
import {
  addBlock,
  composeWorkspace,
  initWorkspace,
  resolveWorkspace
} from '../../platform/orchestrator.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';

const requestedPhase = process.argv[2];
const phase = requestedPhase === 'resolve' ? 'runtime' : requestedPhase;
if (!phase) throw new Error('Probe phase is required');

const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), `sec-runtime-probe-${phase}-`));
await initWorkspace(workspaceRoot, { reset: true });
await addBlock(workspaceRoot, 'ticket/basic');
const { lock: resolvedLock } = await resolveWorkspace(workspaceRoot);

if (phase === 'resolve') {
  if (resolvedLock.semanticLoweringTasks?.length !== 1) {
    throw new Error('Expected exactly one semantic lowering task');
  }
  if (resolvedLock.semanticLoweringTasks[0]?.status !== 'pending') {
    throw new Error('Resolved semantic lowering task must be pending');
  }
  console.log('runtime-contract probe resolve passed');
  process.exit(0);
}

const { lock: composedLock } = await composeWorkspace(workspaceRoot);
const { projectRoot } = getWorkspacePaths(workspaceRoot);
const runtimeContractPath = path.join(projectRoot, 'src', 'installed', 'ticket', 'ticket-semantic-contract.ts');

if (phase === 'compose') {
  if (composedLock.semanticLoweringTasks?.[0]?.status !== 'generated') {
    throw new Error('Semantic lowering task must be generated after compose');
  }
  if (!composedLock.generatedPaths.includes('src/installed/ticket/ticket-semantic-contract.ts')) {
    throw new Error('Runtime semantic contract must be present in generatedPaths');
  }
  console.log('runtime-contract probe compose passed');
  process.exit(0);
}

if (phase === 'runtime') {
  const source = await fs.readFile(runtimeContractPath, 'utf8');
  for (const declaration of [
    'export const TICKET_STATUS_VALUES',
    'export const TICKET_STATUS_TRANSITIONS',
    'export const NEXT_TICKET_STATUS',
    'satisfies Record<TicketStatus, TicketStatus>'
  ]) {
    if (!source.includes(declaration)) throw new Error(`Missing runtime declaration: ${declaration}`);
  }
  for (const [from, to] of [
    ['closed', 'open'],
    ['in_progress', 'closed'],
    ['open', 'in_progress']
  ]) {
    const key = `['\"]?${from}['\"]?`;
    const value = `['\"]${to}['\"]`;
    if (!new RegExp(`${key}:\\s*${value}`).test(source)) {
      throw new Error(`Missing transition mapping: ${from} -> ${to}`);
    }
  }
  console.log('runtime-contract probe runtime passed');
  process.exit(0);
}

if (phase === 'consumer') {
  const source = await fs.readFile(path.join(projectRoot, 'components', 'ticket-status-form.tsx'), 'utf8');
  if (!source.includes('NEXT_TICKET_STATUS[currentStatus]')) {
    throw new Error('Ticket status form must consume NEXT_TICKET_STATUS');
  }
  if (source.includes('const NEXT_STATUS')) {
    throw new Error('Ticket status form must not declare a local NEXT_STATUS map');
  }
  console.log('runtime-contract probe consumer passed');
  process.exit(0);
}

if (phase === 'provenance') {
  const provenance = await buildProvenance(workspaceRoot, composedLock);
  const artifact = provenance.artifacts.find((entry) =>
    entry.path === 'src/installed/ticket/ticket-semantic-contract.ts'
  );
  if (!artifact) throw new Error('Runtime semantic contract provenance is missing');
  if (artifact.originType !== 'generated') throw new Error('Runtime semantic contract originType must be generated');
  if (artifact.originId !== 'generator:ticket/basic:ticket-status-runtime-contract') {
    throw new Error('Runtime semantic contract originId is incorrect');
  }
  if (!artifact.hash) throw new Error('Runtime semantic contract provenance hash is missing');
  console.log('runtime-contract probe provenance passed');
  process.exit(0);
}

throw new Error(`Unsupported probe phase: ${phase}`);
