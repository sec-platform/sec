import { expect, test } from 'bun:test';

import type { BuildEngineeringIRInput } from '../../platform/compiler/ir/build-engineering-ir.ts';
import { buildEngineeringIR } from '../../platform/compiler/ir/build-engineering-ir.ts';
import { indexEngineeringIR } from '../../platform/compiler/ir/index-engineering-ir.ts';
import { CompilerError } from '../../platform/shared/errors.ts';

function fixture(): BuildEngineeringIRInput {
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
    slotTasks: [
      {
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
      }
    ],
    acceptanceIds: ['ticket_can_be_created', 'user_can_login'],
    policyDeclarations: [{
      id: 'tenant-scope-required',
      severity: 'error',
      appliesTo: ['ticket/basic'],
      rule: 'tenant_context_must_flow_to_query'
    }]
  };
}

function expectCompilerError(run: () => unknown, code: string): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(CompilerError);
    expect((error as CompilerError).code).toBe(code);
    return;
  }
  throw new Error(`Expected CompilerError ${code}`);
}

test('buildEngineeringIR creates stable semantic entities, facts, and revision domains', () => {
  const ir = buildEngineeringIR(fixture());

  expect(ir.formatVersion).toBe('2');
  expect(ir.appId).toBe('app:ticket-app');
  expect(ir.inputRevision.startsWith('sha256:')).toBe(true);
  expect(ir.semanticRevision.startsWith('sha256:')).toBe(true);
  expect(ir.entities.map((entity) => entity.id)).toEqual([...ir.entities.map((entity) => entity.id)].sort());
  expect(ir.facts.map((fact) => fact.id)).toEqual([...ir.facts.map((fact) => fact.id)].sort());

  const dependency = ir.facts.find((fact) =>
    fact.subject === 'block:ticket/basic' &&
    fact.predicate === 'DEPENDS_ON' &&
    fact.object.kind === 'entity' &&
    fact.object.entityId === 'capability:auth/session'
  );
  expect(dependency?.authority).toBe('authoritative');
  expect(dependency?.provenance[0]?.kind).toBe('contract');
  expect(dependency?.validFrom).toBe(ir.semanticRevision);
  expect(ir.entities.some((entity) => entity.kind === 'artifact')).toBe(false);
});

test('buildEngineeringIR is deterministic across input ordering', () => {
  const input = fixture();
  const reversed: BuildEngineeringIRInput = {
    ...input,
    resolvedBlocks: [...input.resolvedBlocks].reverse(),
    manifests: [...input.manifests].reverse(),
    slotTasks: [...input.slotTasks].reverse(),
    acceptanceIds: [...input.acceptanceIds].reverse(),
    policyDeclarations: [...input.policyDeclarations].reverse()
  };

  expect(buildEngineeringIR(reversed)).toEqual(buildEngineeringIR(input));
});

test('buildEngineeringIR merges provenance for the same semantic triple', () => {
  const input = fixture();
  const ticketManifest = input.manifests[0]!;
  const ir = buildEngineeringIR({
    ...input,
    manifests: [
      ...input.manifests,
      {
        ...ticketManifest,
        manifestPath: 'source/blocks/private/ticket.basic/block.manifest.yaml'
      }
    ]
  });

  const dependency = ir.facts.find((fact) =>
    fact.subject === 'block:ticket/basic' &&
    fact.predicate === 'DEPENDS_ON' &&
    fact.object.kind === 'entity' &&
    fact.object.entityId === 'capability:auth/session'
  );

  expect(dependency?.provenance).toEqual([
    {
      kind: 'contract',
      sourceId: 'manifest:ticket/basic',
      sourcePath: 'platform/registry/official/ticket.basic/block.manifest.yaml'
    },
    {
      kind: 'contract',
      sourceId: 'manifest:ticket/basic',
      sourcePath: 'source/blocks/private/ticket.basic/block.manifest.yaml'
    }
  ]);
  expect(ir.facts.filter((fact) => fact.id === dependency?.id)).toHaveLength(1);
});

test('buildEngineeringIR rejects a manifest for an unresolved block', () => {
  const input = fixture();
  expectCompilerError(
    () => buildEngineeringIR({
      ...input,
      manifests: [...input.manifests, {
        blockId: 'missing/block',
        manifest: { requires: [], provides: [], pins: { inputs: [], outputs: [] } }
      }]
    }),
    'IR-IDENTITY-002'
  );
});

test('buildEngineeringIR rejects a slot that references an unknown block', () => {
  const input = fixture();
  expectCompilerError(
    () => buildEngineeringIR({
      ...input,
      slotTasks: [{ ...input.slotTasks[0]!, block: 'missing/block' }]
    }),
    'IR-IDENTITY-003'
  );
});

test('buildEngineeringIR rejects a missing app id without falling back to app name', () => {
  const input = fixture();
  expectCompilerError(
    () => buildEngineeringIR({
      ...input,
      app: { id: '', name: 'ticket-app' }
    }),
    'IR-IDENTITY-007'
  );
});

test('indexEngineeringIR exposes entity and relation indexes without copying facts', () => {
  const ir = buildEngineeringIR(fixture());
  const index = indexEngineeringIR(ir);

  expect(index.entityById.get('block:ticket/basic')?.kind).toBe('block');
  expect(index.entitiesByKind.get('capability')?.map((entity) => entity.id)).toContain('capability:ticket/read');
  expect(index.factsByPredicate.get('PROVIDES')?.length).toBeGreaterThan(0);
  expect(index.outgoingFactsBySubject.get('block:ticket/basic')?.length).toBeGreaterThan(0);
  expect(index.incomingFactsByEntityObject.get('capability:auth/session')?.length).toBeGreaterThan(0);

  const firstFact = ir.facts[0];
  expect(firstFact).toBeDefined();
  expect(index.factById.get(firstFact!.id)).toBe(firstFact);
});
