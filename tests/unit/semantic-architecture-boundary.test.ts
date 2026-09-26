import { expect, test } from 'bun:test';

import { buildEngineeringIR, type BuildEngineeringIRInput } from '../../src/compiler/ir/build-engineering-ir.ts';
import { rawSha256Hex, semanticRevisionPayload } from '../../src/compiler/ir/ir-revision.ts';
import { validateEngineeringIR } from '../../src/compiler/ir/validate-engineering-ir.ts';
import { projectArchitectureView } from '../../src/compiler/projection/project-architecture-view.ts';

function inputFixture(): BuildEngineeringIRInput {
  return {
    app: { id: 'boundary-app', name: 'boundary-app' },
    resolvedBlocks: [{
      id: 'boundary/basic',
      version: '0.1.0',
      kind: 'capability',
      installOrder: 1,
      manifestPath: 'registry/boundary.basic/block.manifest.yaml',
      registrySourceId: 'official',
      registryKind: 'official',
      registryLocation: 'compiler',
      registryPath: 'registry'
    }],
    manifests: [{
      blockId: 'boundary/basic',
      manifestPath: 'registry/boundary.basic/block.manifest.yaml',
      manifest: {
        requires: [],
        provides: [],
        pins: { inputs: [{ id: 'request', type: 'Request', required: true }], outputs: [] }
      }
    }],
    acceptanceIds: [],
    policyDeclarations: []
  };
}

test('Architecture View covers validated Boundary entities without inventing a relation', () => {
  const input = inputFixture();
  const base = buildEngineeringIR(input);
  const entities = [
    ...base.entities,
    { id: 'boundary:external-api', kind: 'boundary' as const, label: 'External API', attributes: [] }
  ].sort((left, right) => left.id.localeCompare(right.id));
  const semanticRevision = `sha256:${rawSha256Hex(semanticRevisionPayload(
    base.graphId,
    base.appId,
    entities,
    base.facts,
    base.scenarios
  ))}`;
  const snapshot = validateEngineeringIR({
    ...base,
    semanticRevision,
    entities,
    facts: base.facts.map((fact) => ({
      ...fact,
      assertions: fact.assertions.map((assertion) => ({
        ...assertion,
        validFromRevision: semanticRevision
      }))
    }))
  }, input);

  const view = projectArchitectureView(snapshot);
  expect(view.nodes).toContainEqual(expect.objectContaining({
    entityId: 'boundary:external-api',
    entityKind: 'boundary'
  }));
  expect(view.nodes).toContainEqual(expect.objectContaining({ entityKind: 'port' }));
  expect(view.edges.some((edge) =>
    edge.source === 'boundary:external-api' || edge.target === 'boundary:external-api'
  )).toBe(false);
});
