import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { projectProvenanceRegistryInspect } from '../../../src/application/provenance-registry-inspect.ts';
import { formatProvenanceRegistry } from '../../../src/entry/cli/provenance-registry-inspect.ts';

type ProvenanceInput = Parameters<typeof projectProvenanceRegistryInspect>[0];

test('an absent generating pass displays none, not an empty string identity', () => {
  const artifact = { path: 'a', originType: 'generated', originId: 'fixture', verifiedBy: [], overrideStatus: 'none' };
  const absent = formatProvenanceRegistry(projectProvenanceRegistryInspect({ artifacts: [artifact] } as unknown as ProvenanceInput));
  assert.ok(absent.includes('Generated passes: none'));
  const mixed = formatProvenanceRegistry(projectProvenanceRegistryInspect({ artifacts: [artifact, { ...artifact, path: 'b', generatedByPass: 'emit' }] } as unknown as ProvenanceInput));
  assert.ok(mixed.includes('Generated passes: emit')); assert.ok(!mixed.includes('Generated passes: ,'));
});
