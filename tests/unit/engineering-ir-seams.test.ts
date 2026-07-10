import { expect, test } from 'bun:test';

import {
  buildEngineeringIR,
  projectArchitectureView,
  type BuildEngineeringIRInput
} from '../../platform/compiler/index.ts';
import type { EngineeringIR as CompatibilityEngineeringIR } from '../../platform/shared/engineering-ir-types.ts';
import type { EngineeringIR as RootEngineeringIR } from '../../platform/shared/engineering-ir/root-types.ts';

function ticketFixture(): BuildEngineeringIRInput {
  return {
    app: { id: 'ticket-app', name: 'ticket-app' },
    resolvedBlocks: [
      {
        id: 'ticket/basic',
        version: '0.1.0',
        kind: 'capability',
        installOrder: 2,
        manifestPath: 'platform/registry/official/ticket.basic/block.manifest.yaml',
        registrySourceId: 'official',
        registryKind: 'official',
        registryLocation: 'compiler',
        registryPath: 'platform/registry/official'
      },
      {
        id: 'auth/basic-session',
        version: '0.1.0',
        kind: 'capability',
        installOrder: 1,
        manifestPath: 'platform/registry/official/auth.basic-session/block.manifest.yaml',
        registrySourceId: 'official',
        registryKind: 'official',
        registryLocation: 'compiler',
        registryPath: 'platform/registry/official'
      }
    ],
    manifests: [
      {
        blockId: 'ticket/basic',
        manifestPath: 'platform/registry/official/ticket.basic/block.manifest.yaml',
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
      id: 'ticket_comment_delegate',
      block: 'ticket/basic',
      target: 'custom/ticket_comment_delegate.ts',
      sourcePath: 'source/code/slots/ticket_comment_delegate.ts',
      symbol: 'addTicketCommentDelegate',
      kind: 'adapter',
      inputType: 'TicketCommentInput',
      outputType: 'TicketCommentRecord',
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

function canonicalReferences(ir: CompatibilityEngineeringIR): string[] {
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

function throughCompatibilityBarrel(ir: RootEngineeringIR): CompatibilityEngineeringIR {
  return ir;
}

test('IR kernel seams preserve compatibility barrel and deterministic orchestration', () => {
  const first = throughCompatibilityBarrel(buildEngineeringIR(ticketFixture()));
  const second = buildEngineeringIR(ticketFixture());

  expect(first).toEqual(second);
  expect(first.graphId).toBe('engineering-ir:ticket-app');
  expect(first.appId).toBe('app:ticket-app');
  expect(first.entities.map((entity) => entity.id)).toEqual(second.entities.map((entity) => entity.id));
  expect(first.facts.map((fact) => fact.id)).toEqual(second.facts.map((fact) => fact.id));
  expect(first.scenarios).toEqual(second.scenarios);
  expect(projectArchitectureView(first)).toEqual(projectArchitectureView(second));
  expect(canonicalReferences(first)).toEqual(canonicalReferences(second));
});
