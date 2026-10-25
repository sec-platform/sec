import { beforeAll, expect, test } from 'bun:test';

import { loadWorkspaceEngineeringIRBuildInput } from '../../../src/adapters/workspace/engineering-input.ts';
import { type BuildEngineeringIRInput } from '../../../src/compiler/ir/build-engineering-ir.ts';
import { buildValidatedEngineeringIR, validateEngineeringIR } from '../../../src/compiler/ir/validate-engineering-ir.ts';
import { projectArchitectureView } from '../../../src/compiler/projection/project-architecture-view.ts';
import { projectScenarioView } from '../../../src/compiler/projection/project-scenario-view.ts';
import { projectStateView } from '../../../src/compiler/projection/project-state-view.ts';
import { PREDICATE_SIGNATURE_REGISTRY } from '../../../src/semantics/engineering-ir/predicate-signatures.ts';
import type { ValidatedEngineeringIRSnapshot } from '../../../src/semantics/engineering-ir/validated-types.ts';
import { INSPECTOR_SECTION_IDS } from '../../../src/semantics/projection/types.ts';
import { prepareResolvedWorkspace } from '../../testkit/workspace.ts';

let ticketSnapshot: ValidatedEngineeringIRSnapshot;
let ticketInput: BuildEngineeringIRInput;

beforeAll(async () => {
  const workspaceRoot = await prepareResolvedWorkspace({
    blockIds: ['ticket/basic'],
    prefix: 'engineering-compiler-semantic-projections-'
  });
  ticketInput = (await loadWorkspaceEngineeringIRBuildInput(workspaceRoot)).engineeringIRInput;
  ticketSnapshot = buildValidatedEngineeringIR(ticketInput);
});

test('architecture projection preserves Responsibility, Port, Effect, and Permission Fact edges', () => {
  const view = projectArchitectureView(ticketSnapshot, 'responsibility:ticket:TicketLifecycle');

  const lifecycle = view.nodes.find((node) => node.entityId === 'responsibility:ticket:TicketLifecycle');
  expect(lifecycle?.badges).toEqual(expect.arrayContaining(['stateful']));
  expect(view.edges.some((edge) =>
    edge.source === 'responsibility:ticket:TicketLifecycle' &&
    edge.target === 'operation:ticket:createTicket' &&
    edge.relation === 'IMPLEMENTS' &&
    edge.references.some((reference) => reference.kind === 'fact')
  )).toBe(true);
  expect(view.edges.some((edge) =>
    edge.source === 'operation:ticket:createTicket' &&
    edge.target === 'effect:ticket:ticket-db-write' &&
    edge.relation === 'PERFORMS_EFFECT' &&
    edge.references.some((reference) => reference.kind === 'fact')
  )).toBe(true);
  expect(view.nodes.some((node) => node.entityKind === 'port')).toBe(true);
  expect(view.edges.some((edge) =>
    edge.source === 'responsibility:ticket:TicketQuery' &&
    edge.target === 'responsibility:tenant:TenantScopeGuard' &&
    edge.relation === 'DEPENDS_ON'
  )).toBe(true);
  expect(view.inspector.map((section) => section.id)).toEqual([...INSPECTOR_SECTION_IDS]);
  expect(view.overlays[0]?.entries.length).toBeGreaterThan(0);

  if (false) {
    // @ts-expect-error Projection consumers require a branded validated snapshot.
    projectArchitectureView(ticketSnapshot.ir);
  }
});

test('state projection exposes owner, backing field, mutator, and transition loops', () => {
  const view = projectStateView(ticketSnapshot, 'state:ticket:ticket-status');

  expect(view.nodes.map((node) => node.entityId)).toEqual(expect.arrayContaining([
    'state:ticket:ticket-status',
    'responsibility:ticket:TicketStateMachine',
    'field:ticket:Ticket.status',
    'operation:ticket:transitionTicketStatus'
  ]));
  expect(view.edges.filter((edge) => edge.relation === 'TRANSITIONS_TO').map((edge) => edge.label).sort()).toEqual([
    'closed → open by transitionTicketStatus',
    'in_progress → closed by transitionTicketStatus',
    'open → in_progress by transitionTicketStatus'
  ]);
  expect(view.edges.some((edge) =>
    edge.source === 'operation:ticket:transitionTicketStatus' &&
    edge.target === 'state:ticket:ticket-status' &&
    edge.relation === 'MUTATES'
  )).toBe(true);
});

test("Ticket closes the P0-2A identity, assertion, signature, and Scenario ownership vertical", () => {
  const ticketIR = ticketSnapshot.ir;
  expect(ticketIR.appId).toBe("app:customer-admin");
  expect(ticketIR.graphId).toBe("engineering-ir:customer-admin");
  expect(ticketIR.inputRevision).toStartWith("sha256:");
  expect(ticketIR.semanticRevision).toStartWith("sha256:");

  const tripleKeys = ticketIR.facts.map((fact) =>
    JSON.stringify([fact.subject, fact.predicate, fact.object]),
  );
  expect(new Set(tripleKeys).size).toBe(ticketIR.facts.length);
  expect(ticketIR.facts.every((fact) => fact.assertions.length > 0)).toBe(true);
  expect(
    ticketIR.facts.every(
      (fact) =>
        new Set(fact.assertions.map((assertion) => assertion.id)).size ===
          fact.assertions.length &&
        fact.assertions.every(
          (assertion) =>
            assertion.validFromRevision === ticketIR.semanticRevision &&
            assertion.provenance.length > 0,
        ),
    ),
  ).toBe(true);

  expect(
    ticketIR.facts.every(
      (fact) =>
        PREDICATE_SIGNATURE_REGISTRY[fact.predicate].status === "active",
    ),
  ).toBe(true);

  expect(
    ticketIR.entities.some((entity) => entity.kind === "scenario-step"),
  ).toBe(true);
  expect(
    ticketIR.scenarios.every((scenario) =>
      scenario.steps.every(
        (step) =>
          ticketIR.entities.some(
            (entity) =>
              entity.id === step.id && entity.kind === "scenario-step",
          ) &&
          ticketIR.facts.some(
            (fact) =>
              fact.subject === scenario.id &&
              fact.predicate === "CONTAINS" &&
              fact.object.kind === "entity" &&
              fact.object.entityId === step.id,
          ) &&
          ticketIR.facts.some(
            (fact) =>
              fact.subject === step.id &&
              fact.predicate === "INVOKES" &&
              fact.object.kind === "entity" &&
              fact.object.entityId === step.operationEntityId,
          ),
      ),
    ),
  ).toBe(true);

  const scenarioId = "scenario:ticket:create-ticket";
  const canonicalView = projectScenarioView(ticketSnapshot, scenarioId);
  expect(
    canonicalView.nodes.every((node) =>
      node.references.some(
        (reference) => reference.kind === "fact" || reference.kind === "entity",
      ),
    ),
  ).toBe(true);

  const original = ticketSnapshot.ir.scenarios.find((scenario) => scenario.id === 'scenario:ticket:create-ticket')!;
  const scenarioIR = {
    ...ticketSnapshot.ir,
    scenarios: ticketSnapshot.ir.scenarios.map((scenario) => scenario.id === original.id
      ? {
          ...scenario,
          steps: [
            ...scenario.steps,
            {
              id: 'transition',
              operationEntityId: 'operation:ticket:transitionTicketStatus',
              afterStepIds: ['create'],
              awaits: true
            }
          ]
        }
      : scenario)
  };

  expect(() => validateEngineeringIR(scenarioIR, ticketInput)).toThrow();
  expect(canonicalView.nodes.find((node) => node.id === 'scenario:ticket:create-ticket#step:create')?.references).toContainEqual({
    kind: 'entity',
    ref: 'scenario:ticket:create-ticket#step:create'
  });
  expect(canonicalView.edges.filter((edge) => ['PRECEDES', 'AWAITS', 'RETRIES', 'HANDLES'].includes(edge.relation))
    .every((edge) => edge.references.some((reference) => reference.kind === 'fact'))).toBe(true);
});
