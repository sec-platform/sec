import { expect, test } from 'bun:test';

import {
  buildEngineeringIR,
  projectArchitectureView,
  type BuildEngineeringIRInput
} from '../../platform/compiler/index.ts';
import type { EngineeringIR } from '../../platform/shared/engineering-ir-types.ts';

const BEFORE_SEAMS_TICKET_IR = JSON.parse('{"formatVersion":"1","graphId":"engineering-ir:ticket-app","revision":"sha256:310a26f1343475094978d1fa924e8af0707ad6f76cf05baa9a9cf976ca26019c","appId":"app:ticket-app","entities":[{"id":"acceptance:ticket_can_be_created","kind":"acceptance","label":"ticket_can_be_created","attributes":[]},{"id":"acceptance:user_can_login","kind":"acceptance","label":"user_can_login","attributes":[]},{"id":"app:ticket-app","kind":"app","label":"ticket-app","attributes":[]},{"id":"artifact:src/installed/ticket/ticket-service.ts","kind":"artifact","label":"src/installed/ticket/ticket-service.ts","attributes":[{"key":"generatedByPass","value":"compose"},{"key":"originId","value":"ticket/basic"},{"key":"originType","value":"block"},{"key":"overrideStatus","value":"none"}]},{"id":"block:auth/basic-session","kind":"block","label":"auth/basic-session","attributes":[{"key":"manifestKind","value":"capability"},{"key":"registrySourceId","value":"official"},{"key":"version","value":"0.1.0"}]},{"id":"block:ticket/basic","kind":"block","label":"ticket/basic","attributes":[{"key":"manifestKind","value":"capability"},{"key":"registrySourceId","value":"official"},{"key":"version","value":"0.1.0"}]},{"id":"capability:auth/session","kind":"capability","label":"auth/session","attributes":[]},{"id":"capability:ticket/read","kind":"capability","label":"ticket/read","attributes":[]},{"id":"capability:ticket/write","kind":"capability","label":"ticket/write","attributes":[]},{"id":"policy:tenant-scope-required","kind":"policy","label":"tenant-scope-required","attributes":[]},{"id":"port:ticket/basic:input:actor_identity","kind":"port","label":"actor_identity","attributes":[{"key":"direction","value":"input"},{"key":"required","value":true},{"key":"type","value":"Session"}]},{"id":"port:ticket/basic:output:ticket_created","kind":"port","label":"ticket_created","attributes":[{"key":"direction","value":"output"},{"key":"required","value":true},{"key":"type","value":"TicketRecord"}]},{"id":"slot:ticket/basic:ticket_comment_delegate","kind":"slot","label":"ticket_comment_delegate","attributes":[{"key":"inputType","value":"TicketCommentInput"},{"key":"outputType","value":"TicketCommentRecord"},{"key":"slotKind","value":"adapter"},{"key":"symbol","value":"addTicketCommentDelegate"},{"key":"target","value":"custom/ticket_comment_delegate.ts"}]}],"facts":[{"id":"fact:262eded474949263d4aeb9e5","subject":"app:ticket-app","predicate":"CONTAINS","object":{"kind":"entity","entityId":"block:auth/basic-session"},"authority":"derived","confidence":1,"provenance":[{"kind":"compiler","sourceId":"resolve:resolved-block"}],"evidence":[],"validFrom":"sha256:310a26f1343475094978d1fa924e8af0707ad6f76cf05baa9a9cf976ca26019c"},{"id":"fact:266ca4777321d31c87f7c922","subject":"block:ticket/basic","predicate":"PROVIDES","object":{"kind":"entity","entityId":"capability:ticket/read"},"authority":"authoritative","confidence":1,"provenance":[{"kind":"contract","sourceId":"manifest:ticket/basic","sourcePath":"platform/registry/official/ticket.basic/block.manifest.yaml"}],"evidence":[],"validFrom":"sha256:310a26f1343475094978d1fa924e8af0707ad6f76cf05baa9a9cf976ca26019c"},{"id":"fact:33897f66850bfac13a90fab5","subject":"block:ticket/basic","predicate":"PROVIDES","object":{"kind":"entity","entityId":"capability:ticket/write"},"authority":"authoritative","confidence":1,"provenance":[{"kind":"contract","sourceId":"manifest:ticket/basic","sourcePath":"platform/registry/official/ticket.basic/block.manifest.yaml"}],"evidence":[],"validFrom":"sha256:310a26f1343475094978d1fa924e8af0707ad6f76cf05baa9a9cf976ca26019c"},{"id":"fact:5021e12a4146460f7d856ba0","subject":"block:ticket/basic","predicate":"DEPENDS_ON","object":{"kind":"entity","entityId":"capability:auth/session"},"authority":"authoritative","confidence":1,"provenance":[{"kind":"contract","sourceId":"manifest:ticket/basic","sourcePath":"platform/registry/official/ticket.basic/block.manifest.yaml"}],"evidence":[],"validFrom":"sha256:310a26f1343475094978d1fa924e8af0707ad6f76cf05baa9a9cf976ca26019c"},{"id":"fact:57afaa920725159c187a7e06","subject":"block:ticket/basic","predicate":"REQUIRES","object":{"kind":"entity","entityId":"port:ticket/basic:input:actor_identity"},"authority":"authoritative","confidence":1,"provenance":[{"kind":"contract","sourceId":"manifest:ticket/basic","sourcePath":"platform/registry/official/ticket.basic/block.manifest.yaml"}],"evidence":[],"validFrom":"sha256:310a26f1343475094978d1fa924e8af0707ad6f76cf05baa9a9cf976ca26019c"},{"id":"fact:7b259dda2b53fcab1d7d07f6","subject":"app:ticket-app","predicate":"CONTAINS","object":{"kind":"entity","entityId":"block:ticket/basic"},"authority":"derived","confidence":1,"provenance":[{"kind":"compiler","sourceId":"resolve:resolved-block"}],"evidence":[],"validFrom":"sha256:310a26f1343475094978d1fa924e8af0707ad6f76cf05baa9a9cf976ca26019c"},{"id":"fact:818844ca05216f6219ebae6e","subject":"artifact:src/installed/ticket/ticket-service.ts","predicate":"ORIGINATES_FROM","object":{"kind":"entity","entityId":"block:ticket/basic"},"authority":"derived","confidence":1,"provenance":[{"kind":"compiler","sourceId":"artifact-provenance"}],"evidence":[{"kind":"artifact-provenance","ref":"src/installed/ticket/ticket-service.ts"}],"validFrom":"sha256:310a26f1343475094978d1fa924e8af0707ad6f76cf05baa9a9cf976ca26019c"},{"id":"fact:a8dbed099e13ca4681ca29b0","subject":"block:auth/basic-session","predicate":"PROVIDES","object":{"kind":"entity","entityId":"capability:auth/session"},"authority":"authoritative","confidence":1,"provenance":[{"kind":"contract","sourceId":"manifest:auth/basic-session"}],"evidence":[],"validFrom":"sha256:310a26f1343475094978d1fa924e8af0707ad6f76cf05baa9a9cf976ca26019c"},{"id":"fact:d145b307e30b819cf99dc76b","subject":"block:ticket/basic","predicate":"PROVIDES","object":{"kind":"entity","entityId":"port:ticket/basic:output:ticket_created"},"authority":"authoritative","confidence":1,"provenance":[{"kind":"contract","sourceId":"manifest:ticket/basic","sourcePath":"platform/registry/official/ticket.basic/block.manifest.yaml"}],"evidence":[],"validFrom":"sha256:310a26f1343475094978d1fa924e8af0707ad6f76cf05baa9a9cf976ca26019c"},{"id":"fact:f14f29de1b65692534ce3a8c","subject":"block:ticket/basic","predicate":"CONTAINS","object":{"kind":"entity","entityId":"slot:ticket/basic:ticket_comment_delegate"},"authority":"derived","confidence":1,"provenance":[{"kind":"compiler","sourceId":"resolve:slot-task"}],"evidence":[],"validFrom":"sha256:310a26f1343475094978d1fa924e8af0707ad6f76cf05baa9a9cf976ca26019c"}],"scenarios":[]}') as EngineeringIR;

function ticketFixture(): BuildEngineeringIRInput {
  return {
    app: { name: 'ticket-app' },
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
    policyIds: ['tenant-scope-required'],
    provenanceArtifacts: [
      {
        path: 'src/installed/ticket/ticket-service.ts',
        originType: 'block',
        originId: 'ticket/basic',
        sourceBlock: 'ticket/basic',
        generatedByPass: 'compose',
        verifiedBy: ['ticket-service.test.ts'],
        overrideStatus: 'none'
      }
    ]
  };
}

function canonicalReferences(ir: EngineeringIR): string[] {
  return [
    ...ir.facts.flatMap((fact) => [
      `subject:${fact.subject}`,
      ...(fact.object.kind === 'entity' ? [`object:${fact.object.entityId}`] : [])
    ]),
    ...ir.scenarios.flatMap((scenario) => [
      `scenario:${scenario.id}`,
      `entry:${scenario.entryEntityId}`,
      ...scenario.factIds.map((factId) => `fact:${factId}`),
      ...scenario.steps.map((step) => `operation:${step.operationEntityId}`),
      ...scenario.acceptanceEntityIds.map((entityId) => `acceptance:${entityId}`)
    ])
  ];
}

test('IR kernel seam refactor preserves the Ticket fixture byte-for-byte', () => {
  const beforeIR = BEFORE_SEAMS_TICKET_IR;
  const afterIR = buildEngineeringIR(ticketFixture());

  expect(afterIR).toEqual(beforeIR);
  expect(afterIR.graphId).toBe(beforeIR.graphId);
  expect(afterIR.revision).toBe(beforeIR.revision);
  expect(afterIR.entities.map((entity) => entity.id)).toEqual(beforeIR.entities.map((entity) => entity.id));
  expect(afterIR.facts.map((fact) => fact.id)).toEqual(beforeIR.facts.map((fact) => fact.id));
  expect(afterIR.facts).toEqual(beforeIR.facts);
  expect(afterIR.scenarios).toEqual(beforeIR.scenarios);
  expect(projectArchitectureView(afterIR)).toEqual(projectArchitectureView(beforeIR));
  expect(canonicalReferences(afterIR)).toEqual(canonicalReferences(beforeIR));
});
