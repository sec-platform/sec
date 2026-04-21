import test from 'node:test';
import assert from 'node:assert/strict';

import { SUPPORTED_STACK } from '../platform/shared/constants.ts';
import { loadAllManifests } from '../platform/compiler/parse/load-manifest.ts';
import { resolveGraph } from '../platform/compiler/resolve/resolve-graph.ts';
import { validateResolvedTemplates } from '../platform/compiler/verify/validate-resolved-templates.ts';
import type { ManifestEntry, PlanFile } from '../platform/shared/types.ts';

function buildValidationPlan(entry: ManifestEntry): PlanFile {
  return {
    app: {
      name: `validate-${entry.manifest.id.replaceAll('/', '-')}`,
      stack: SUPPORTED_STACK,
      packageManager: 'pnpm',
      mode: 'single-tenant'
    },
    blocks: [{ id: entry.manifest.id, version: entry.manifest.version }],
    slots: entry.manifest.slots.map((slot) => ({
      id: slot.id,
      block: entry.manifest.id,
      kind: slot.kind,
      target: slot.target,
      symbol: slot.symbol,
      description: `Template validation placeholder for ${slot.id}`
    })),
    acceptance: []
  };
}

test('official registry blocks typecheck in their minimal resolved closure', async () => {
  const manifests = await loadAllManifests();
  assert.ok(manifests.length > 0);

  for (const entry of manifests) {
    const plan = buildValidationPlan(entry);
    const lock = await resolveGraph(plan);
    await validateResolvedTemplates(lock);
  }
});
