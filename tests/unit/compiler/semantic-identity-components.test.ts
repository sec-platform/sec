import { expect, test } from 'bun:test';
import { buildEngineeringIR, type BuildEngineeringIRInput } from '../../../src/compiler/ir/build-engineering-ir.ts';
import * as ids from '../../../src/compiler/ir/ir-identity.ts';
import { digest, inputRevisionPayload } from '../../../src/compiler/ir/ir-revision.ts';
import { validateEngineeringIR } from '../../../src/compiler/ir/validate-engineering-ir.ts';
import { assertSemanticIdentityComponent, semanticReferenceParts, semanticTargetParts } from '../../../src/semantics/definitions/identity-components.ts';
import { linkWorkspaceSemanticContracts, splitLinkedSemanticReference } from '../../../src/semantics/definitions/link.ts';
import { normalizeSemanticContract } from '../../../src/semantics/definitions/normalize.ts';
import type { SemanticContract } from '../../../src/semantics/definitions/types.ts';

function contract(): SemanticContract {
  return { formatVersion: '1', id: 'core', namespace: 'domain', entities: [], states: [], responsibilities: [], operations: [], events: [], policies: [], permissions: [], effects: [], scenarios: [] };
}

function input(): BuildEngineeringIRInput {
  return { app: { id: 'app', name: 'Display :\u0000 label' }, resolvedBlocks: [], manifests: [], acceptanceIds: [], policyDeclarations: [] };
}

test('a legacy cache with an unprojected ambiguous contract id cannot bypass source admission', () => {
  const source = input();
  source.resolvedBlocks = [{ id: 'block', version: '1.0.0', kind: 'capability', installOrder: 0, manifestPath: 'block.yaml', registrySourceId: 'official', registryKind: 'official', registryLocation: 'compiler', registryPath: 'registry' }];
  const definition = contract();
  source.semanticContracts = [{ blockId: 'block', contractPath: 'contract.yaml', contract: definition }];
  const cached = buildEngineeringIR(source);
  expect(cached.entities.map((entity) => entity.id)).toEqual(['app:app', 'block:block']);
  // Legacy construction accepted this source-only id. Empty contracts emit no
  // entities/facts, so its actual old cache differs only in inputRevision.
  definition.id = 'a:b';
  cached.inputRevision = `sha256:${digest(inputRevisionPayload(source))}`;
  expect(() => buildEngineeringIR(source)).toThrow('Semantic contract id');
  expect(() => validateEngineeringIR(cached, source)).toThrow('Semantic contract id');
});

test('fresh and cached entry points share admission for unprojected imports and manifest identities', () => {
  const mutations: ((source: BuildEngineeringIRInput) => void)[] = [
    (source) => { source.semanticContracts = [{ blockId: 'block', contractPath: 'c.yaml', contract: { ...contract(), imports: [{ alias: 'a:b', namespace: 'provider', contractId: 'core' }] } }]; },
    (source) => { source.semanticContracts = [{ blockId: 'block', contractPath: 'c.yaml', contract: { ...contract(), imports: [{ alias: 'provider', namespace: 'a:b', contractId: 'core' }] } }]; },
    (source) => { source.semanticContracts = [{ blockId: 'block', contractPath: 'c.yaml', contract: { ...contract(), imports: [{ alias: 'provider', namespace: 'provider', contractId: 'a:b' }] } }]; },
    (source) => { source.manifests = [{ blockId: 'a:b', manifest: { requires: [], provides: [], pins: { inputs: [], outputs: [] } } }]; },
    ...(['id', 'contract', 'state'] as const).map((field) => (source: BuildEngineeringIRInput) => {
      source.manifests = [{ blockId: 'block', manifest: { requires: [], provides: [], pins: { inputs: [], outputs: [] }, generators: [{ id: 'generator', kind: 'generate-state-transition-map', contract: 'core', state: 'state', target: 'src/a:b.ts', consumes: ['state', 'transition'], produces: 'typescript-runtime-contract', typeBinding: { name: 'ActualExport:Name', importFrom: './types' }, verification: ['arbitrary:selector'], [field]: 'a:b' }] } }];
    })
  ];
  const base = buildEngineeringIR(input());
  for (const mutate of mutations) {
    const source = input();
    const cached = structuredClone(base);
    mutate(source);
    cached.inputRevision = `sha256:${digest(inputRevisionPayload(source))}`;
    expect(() => buildEngineeringIR(source)).toThrow('identity component');
    expect(() => validateEngineeringIR(cached, source)).toThrow('identity component');
  }
});

test('mutation identity constructors reject colon collisions while valid scoped identities stay literal', () => {
  const constructors = [ids.contractOperationId, ids.contractStateId];
  for (const construct of constructors) {
    expect(() => construct('a:b', 'c')).toThrow();
    expect(() => construct('a', 'b:c')).toThrow();
  }
  expect(ids.contractEventId('a.b/中文%', '事件-1')).toBe('event:a.b/中文%:事件-1');
  expect(ids.contractFieldId('a.b', 'Entity', 'field')).toBe('field:a.b:Entity.field');
  expect(ids.generatorEntityId('block/name', 'gen.v1')).toBe('generator:block/name:gen.v1');
  expect(ids.scenarioStepEntityId('scenario:ns:plan.v1', 'step.1')).toBe('scenario:ns:plan.v1#step:step.1');
});

test('field, reference, generator, step and port boundaries share one literal component grammar', () => {
  for (const invalid of ['', ' padded', 'padded ', 'x:y', 'x\u0000y']) expect(() => assertSemanticIdentityComponent(invalid, 'test')).toThrow();
  for (const invalid of ['a:b::c', 'a:::c', 'a::b::c', 'a::', '::b']) expect(() => semanticReferenceParts(invalid)).toThrow();
  expect(splitLinkedSemanticReference('a.b::operation.v1')).toEqual({ namespace: 'a.b', id: 'operation.v1' });
  for (const invalid of ['Entity.field.extra', 'Entity.', '.field']) expect(() => semanticTargetParts(invalid)).toThrow();
  expect(() => ids.contractFieldId('ns', 'a.b', 'c')).toThrow();
  expect(() => ids.contractFieldId('ns', 'a', 'b.c')).toThrow();
  expect(() => ids.generatorEntityId('a:b', 'c')).toThrow();
  expect(() => ids.generatorEntityId('a', 'b:c')).toThrow();
  expect(() => ids.scenarioStepEntityId('scenario:a:b:c', 'step')).toThrow();
  expect(() => ids.scenarioStepEntityId('scenario:a:b', 'step:other')).toThrow();
  expect(() => ids.portEntityId('block:input', 'output', 'pin')).toThrow();
  expect(() => ids.appEntityId('app:other')).toThrow();
  expect(() => ids.capabilityEntityId('cap\u0000ability')).toThrow();
  expect(() => ids.acceptanceEntityId('accept:other')).toThrow();
  expect(() => ids.verificationPolicyEntityId('policy:other')).toThrow();
  expect(ids.artifactEntityId('src/a:b/file.ts')).toBe('artifact:src/a:b/file.ts');
});

test('shared identity admission covers declarations and imports and remains wired into the linker', () => {
  for (const kind of ['entities', 'states', 'responsibilities', 'operations', 'events', 'policies', 'permissions', 'effects', 'scenarios'] as const) {
    const source = contract();
    // Identity validation runs before consuming kind-specific contents.
    Object.assign(source, { [kind]: [{ id: 'ambiguous:name' }] });
    expect(() => normalizeSemanticContract(source)).toThrow(expect.objectContaining({ code: 'CONTRACT-SEMANTIC-024' }));
    // The linker invokes the same complete validator before its own projections.
    if (kind === 'entities') {
      expect(() => linkWorkspaceSemanticContracts([{ blockId: 'block', contractPath: 'x.yaml', contract: source }], [])).toThrow(expect.objectContaining({ code: 'CONTRACT-SEMANTIC-024' }));
    }
  }
  for (const field of ['alias', 'namespace', 'contractId'] as const) {
    const source = contract();
    source.imports = [{ alias: 'a', namespace: 'b', contractId: 'c', [field]: 'a:b' }];
    expect(() => normalizeSemanticContract(source)).toThrow(expect.objectContaining({ code: 'CONTRACT-SEMANTIC-024' }));
  }
  const source = contract();
  source.entities = [{ id: 'Entity.with.dot', fields: [] }];
  expect(() => normalizeSemanticContract(source)).toThrow(expect.objectContaining({ code: 'CONTRACT-SEMANTIC-024' }));
  source.entities = [{ id: 'Entity', fields: [{ id: 'field.with.dot', type: 'string' }] }];
  expect(() => normalizeSemanticContract(source)).toThrow(expect.objectContaining({ code: 'CONTRACT-SEMANTIC-024' }));
});

test('fact preimages keep legacy bytes while NUL stays legal in values and labels', () => {
  expect(ids.factIdentity({ subject: 'app:a', predicate: 'CONTAINS', object: { kind: 'entity', entityId: 'block:b' } })).toBe('app:a\u0000CONTAINS\u0000entity:block:b');
  expect(() => ids.factIdentity({ subject: 'app:a\u0000CONTAINS', predicate: 'CONTAINS', object: { kind: 'entity', entityId: 'block:b' } })).toThrow();
  expect(() => ids.factIdentity({ subject: 'app:a', predicate: 'CONTAINS', object: { kind: 'entity', entityId: 'block:b\u0000x' } })).toThrow();
  expect(ids.factIdentity({ subject: 'app:a', predicate: 'ASSUMES', object: { kind: 'value', value: 'a\u0000b:c' } })).toBe('app:a\u0000ASSUMES\u0000value:"a\\u0000b:c"');
  const source = input();
  const ir = buildEngineeringIR(source);
  expect(validateEngineeringIR(ir, source).ir.entities[0]!.label).toBe('Display :\u0000 label');
});

test('persisted entity validation rejects ambiguous v1 identities before issuing a snapshot', () => {
  const source = input();
  const base = buildEngineeringIR(source);
  for (const entity of [
    { kind: 'event' as const, id: 'event:a:b:c' },
    { kind: 'field' as const, id: 'field:a:Entity.field.extra' },
    { kind: 'generator' as const, id: 'generator:a:b:c' },
    { kind: 'scenario-step' as const, id: 'scenario:a:b:c#step:d' }
  ]) {
    const ir = structuredClone(base);
    ir.entities.push({ ...entity, label: 'persisted', attributes: [] });
    ir.entities.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    expect(() => validateEngineeringIR(ir, source)).toThrow('does not match canonical');
  }
});

test('arbitrary state strings cannot collide in revision tuples and actual component order is stable', () => {
  const source = contract();
  source.states = [{ id: 'state', entity: 'Entity', field: 'field', owner: 'Owner', values: ['a\u0000b', 'a', 'b\u0000c', 'c'], transitions: [
    { from: 'a\u0000b', to: 'c', by: 'operation' },
    { from: 'a', to: 'b\u0000c', by: 'operation' }
  ] }];
  const domain = { ...input(), semanticContracts: [{ blockId: 'block', contractPath: 'x.yaml', contract: source }] };
  const payload = inputRevisionPayload(domain);
  const transitions = JSON.parse(payload).semanticContracts[0].contract.states[0].transitions;
  expect(transitions).toEqual([{ from: 'a', to: 'b\u0000c', by: 'operation' }, { from: 'a\u0000b', to: 'c', by: 'operation' }]);
  source.states[0]!.transitions[1]!.to = 'changed';
  expect(inputRevisionPayload(domain)).not.toBe(payload);
});
