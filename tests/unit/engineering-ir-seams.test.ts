import { expect, test } from 'bun:test';

import { buildEngineeringIR, type BuildEngineeringIRInput } from '../../src/compiler/ir/build-engineering-ir.ts';
import { buildValidatedEngineeringIR } from '../../src/compiler/ir/validate-engineering-ir.ts';
import { projectArchitectureView } from '../../src/compiler/projection/project-architecture-view.ts';
import type { EngineeringIR } from '../../src/semantic/engineering-ir/contract/root-types.ts';

function ticketFixture(): BuildEngineeringIRInput {
  return {
    app: { id: 'ticket-app', name: 'ticket-app' },
    resolvedBlocks: [
      {
        id: 'ticket/basic',
        version: '0.1.0',
        kind: 'capability',
        installOrder: 2,
        manifestPath: 'catalog/registry/official/ticket.basic/block.manifest.yaml',
        registrySourceId: 'official',
        registryKind: 'official',
        registryLocation: 'compiler',
        registryPath: 'catalog/registry/official'
      },
      {
        id: 'auth/basic-session',
        version: '0.1.0',
        kind: 'capability',
        installOrder: 1,
        manifestPath: 'catalog/registry/official/auth.basic-session/block.manifest.yaml',
        registrySourceId: 'official',
        registryKind: 'official',
        registryLocation: 'compiler',
        registryPath: 'catalog/registry/official'
      }
    ],
    manifests: [
      {
        blockId: 'ticket/basic',
        manifestPath: 'catalog/registry/official/ticket.basic/block.manifest.yaml',
        manifest: {
          requires: ['auth/session'],
          provides: ['ticket/write', 'ticket/read'],
          pins: {
            inputs: [{ id: 'actor_identity', type: 'Session', required: true }],
            outputs: [{ id: 'ticket_created', type: 'TicketRecord', required: true }]
          }
        }
      },
      {
        blockId: 'auth/basic-session',
        manifest: {
          requires: [],
          provides: ['auth/session'],
          pins: { inputs: [], outputs: [] }
        }
      }
    ],
    slotTasks: [{
      id: 'ticket_title_formatter',
      block: 'ticket/basic',
      target: 'custom/ticket_title_formatter.ts',
      sourcePath: 'source/code/slots/ticket_title_formatter.ts',
      symbol: 'formatTicketTitle',
      kind: 'adapter',
      inputType: 'TicketTitleInput',
      outputType: 'FormattedTicketTitle',
      status: 'filled',
      writableZones: ['custom/'],
      provenanceHints: { generator: null, verifiedBy: [] }
    }],
    acceptanceIds: ['ticket_can_be_created', 'user_can_login'],
    policyDeclarations: [{
      id: 'tenant-scope-required',
      severity: 'error',
      appliesTo: ['ticket/basic'],
      rule: 'tenant_context_must_flow_to_query'
    }]
  };
}

function canonicalReferences(ir: EngineeringIR): string[] {
  return [
    ...ir.entities.map((entity) => `entity:${entity.id}`),
    ...ir.facts.flatMap((fact) => [
      `fact:${fact.id}`,
      `subject:${fact.subject}`,
      ...(fact.object.kind === 'entity' ? [`object:${fact.object.entityId}`] : [])
    ]),
    ...ir.scenarios.flatMap((scenario) => [
      `scenario:${scenario.id}`,
      `entry:${scenario.entryEntityId}`,
      ...scenario.factIds.map((factId) => `scenario-fact:${factId}`),
      ...scenario.steps.map((step) => `operation:${step.operationEntityId}`),
      ...scenario.acceptanceEntityIds.map((entityId) => `acceptance:${entityId}`)
    ])
  ].sort((left, right) => left.localeCompare(right));
}

test('IR kernel seams preserve deterministic orchestration', () => {
  const first = buildEngineeringIR(ticketFixture());
  const second = buildEngineeringIR(ticketFixture());
  const firstSnapshot = buildValidatedEngineeringIR(ticketFixture());
  const secondSnapshot = buildValidatedEngineeringIR(ticketFixture());

  expect(first).toEqual(second);
  expect(first.graphId).toBe('engineering-ir:ticket-app');
  expect(first.appId).toBe('app:ticket-app');
  expect(first.entities.map((entity) => entity.id)).toEqual(second.entities.map((entity) => entity.id));
  expect(first.facts.map((fact) => fact.id)).toEqual(second.facts.map((fact) => fact.id));
  expect(first.facts.every((fact) => fact.assertions.length === 1)).toBe(true);
  expect(first.facts.every((fact) =>
    fact.assertions[0]?.validFromRevision === first.semanticRevision
  )).toBe(true);
  expect(first.scenarios).toEqual(second.scenarios);
  expect(projectArchitectureView(firstSnapshot)).toEqual(projectArchitectureView(secondSnapshot));
  expect(canonicalReferences(first)).toEqual(canonicalReferences(second));

  if (false) {
    // @ts-expect-error Ordinary EngineeringIR cannot cross the Projection boundary.
    projectArchitectureView(first);
  }
});
