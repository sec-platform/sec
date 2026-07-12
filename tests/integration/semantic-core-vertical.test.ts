import { beforeAll, expect, test } from 'bun:test';

import {
  buildValidatedEngineeringIR,
  loadWorkspaceEngineeringIRBuildInput,
  projectArchitectureView,
  projectScenarioView,
  projectStateView
} from '../../platform/compiler/index.ts';
import type { ValidatedEngineeringIRSnapshot } from '../../platform/shared/engineering-ir-types.ts';
import { readJson } from '../../platform/shared/fs.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import type { VerificationReport } from '../../platform/shared/verification-types.ts';
import { prepareVerifiedWorkspace } from '../testkit/workspace.ts';

let ticketSnapshot: ValidatedEngineeringIRSnapshot;
let verificationReport: VerificationReport;

beforeAll(async () => {
  const workspaceRoot = await prepareVerifiedWorkspace({
    blockIds: ['ticket/basic'],
    prefix: 'engineering-compiler-semantic-core-vertical-'
  });
  const { verificationReportPath } = getWorkspacePaths(workspaceRoot);

  verificationReport = await readJson<VerificationReport>(verificationReportPath);
  ticketSnapshot = buildValidatedEngineeringIR(
    (await loadWorkspaceEngineeringIRBuildInput(workspaceRoot)).engineeringIRInput
  );
}, 20_000);

test('ticket semantic core closes the verified pipeline and three canonical projections', () => {
  expect(verificationReport.fast.status).toBe('passed');
  expect(verificationReport.summary.status).toBe('passed');

  const architecture = projectArchitectureView(ticketSnapshot, 'responsibility:ticket:TicketLifecycle');
  expect(architecture.subject).toBe('responsibility:ticket:TicketLifecycle');
  expect(architecture.nodes.some((node) => node.entityId === 'responsibility:ticket:TicketLifecycle')).toBe(true);

  const scenario = projectScenarioView(ticketSnapshot, 'scenario:ticket:create-ticket');
  expect(scenario.subject).toBe('scenario:ticket:create-ticket');
  expect(scenario.nodes.some((node) => node.id === 'scenario:ticket:create-ticket#step:create')).toBe(true);

  const state = projectStateView(ticketSnapshot, 'state:ticket:ticket-status');
  expect(state.subject).toBe('state:ticket:ticket-status');
  expect(state.edges.filter((edge) => edge.relation === 'TRANSITIONS_TO')).toHaveLength(3);
});
