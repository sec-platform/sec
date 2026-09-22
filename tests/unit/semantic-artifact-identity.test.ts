import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  identifySemanticArtifactSet,
  type SemanticArtifactSet
} from '../../src/compiler/semantic-artifacts.ts';
import { createContentIdentityRuntime } from '../../src/bootstrap/content-identity-runtime.ts';

function artifact(source = 'export const value = 1;'): SemanticArtifactSet {
  const task = Object.freeze({
    id: 'generator:test',
    blockId: 'block/test',
    generatorId: 'generator',
    generatorEntityId: 'generator:block/test:generator',
    artifactEntityId: 'artifact:generated.ts',
    inputRevision: 'sha256:legacy-input',
    semanticRevision: 'sha256:legacy-semantic',
    contractId: 'contract',
    contractPath: 'contract.sec',
    contractNamespace: 'contract',
    target: 'generated.ts',
    consumes: Object.freeze(['state'] as const),
    produces: 'typescript-runtime-contract' as const,
    verification: Object.freeze([]),
    verifiedByEntityIds: Object.freeze([]),
    registrySourceId: 'registry',
    registryKind: 'official' as const,
    registryLocation: 'compiler' as const,
    registryPath: 'registry',
    kind: 'generate-state-transition-map' as const,
    stateId: 'state',
    stateEntityId: 'state:contract:state',
    stateValues: Object.freeze(['ready']),
    transitions: Object.freeze([]),
    typeBinding: Object.freeze({ name: 'State', importFrom: './state.ts' })
  });
  return Object.freeze({
    scope: 'semantic-tasks' as const,
    inputRevision: task.inputRevision,
    semanticRevision: task.semanticRevision,
    members: Object.freeze([Object.freeze({ task, source })])
  });
}

const identities = createContentIdentityRuntime().identity;

test('semantic artifact identity is owner-issued and binds the complete rendered set', () => {
  const first = identifySemanticArtifactSet(artifact(), identities);
  const repeated = identifySemanticArtifactSet(artifact(), identities);
  const changed = identifySemanticArtifactSet(
    artifact('export const value = 2;'),
    identities
  );

  assert.equal(first.identity.profile, 'blake3-256-canonical-json-v1');
  assert.equal(first.identity.domain, 'semantic-artifact-set');
  assert.equal(first.identity.schema, 'v1');
  assert.deepEqual(repeated.identity, first.identity);
  assert.notDeepEqual(changed.identity, first.identity);
  assert.equal(Object.isFrozen(first), true);
});

test('semantic artifact identity rejects a structurally forged identity runtime', () => {
  assert.throws(
    () => identifySemanticArtifactSet(artifact(), { ...identities }),
    /owner-issued structured identity runtime/u
  );
});
