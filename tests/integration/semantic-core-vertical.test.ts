import { beforeAll, expect, test } from 'bun:test';

import {
  projectArchitectureView,
  projectScenarioView,
  projectStateView
} from '../../platform/compiler/index.ts';
import { buildWorkspaceEngineeringIR } from '../../platform/orchestrator.ts';
import type { EngineeringIR } from '../../platform/shared/engineering-ir-types.ts';
import { readJson } from '../../platform/shared/fs.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import type { VerificationReport } from '../../platform/shared/verification-types.ts';
import { prepareVerifiedWorkspace } from '../testkit/workspace.ts';

let ticketIR: EngineeringIR;
let verificationReport: VerificationReport;

beforeAll(async () => {
  const workspaceRoot = await prepareVerifiedWorkspace({
    blockIds: ['ticket/basic'],
    prefix: 'engineering-compiler-semantic-core-vertical-'
  });
  const { verificationReportPath } = getWorkspacePaths(workspaceRoot);

  verificationReport = await readJson<VerificationReport>(verificationReportPath);
  ticketIR = await buildWorkspaceEngineeringIR(workspaceRoot);
}, 20_000);

test('ticket semantic core closes the verified pipeline and three canonical projections', () => {
  expect(verificationReport.fast.status).toBe('passed');
  expect(verificationReport.summary.status).toBe('passed');

  const architecture = projectArchitectureView(ticketIR, 'responsibility:ticket:TicketLifecycle');
  expect(architecture.subject).toBe('responsibility:ticket:TicketLifecycle');
  expect(architecture.nodes.some((node) => node.entityId === 'responsibility:ticket:TicketLifecycle')).toBe(true);

  const scenario = projectScenarioView(ticketIR, 'scenario:ticket:create-ticket');
  expect(scenario.subject).toBe('scenario:ticket:create-ticket');
  expect(scenario.nodes.some((node) => node.id === 'scenario:ticket:create-ticket#step:create')).toBe(true);

  const state = projectStateView(ticketIR, 'state:ticket:ticket-status');
  expect(state.subject).toBe('state:ticket:ticket-status');
  expect(state.edges.filter((edge) => edge.relation === 'TRANSITIONS_TO')).toHaveLength(3);
});
