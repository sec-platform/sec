import { expect, test } from 'vitest';

import { loadAllManifests } from '../../platform/compiler/parse/load-manifest.ts';
import { resolveGraph } from '../../platform/compiler/resolve/resolve-graph.ts';
import { validateResolvedTemplates } from '../../platform/compiler/verify/validate-resolved-templates.ts';
import { buildManifestValidationPlan } from '../helpers/test-utils.ts';

test('official registry blocks typecheck in their minimal resolved closure', async () => {
  const manifests = await loadAllManifests();
  expect(manifests.length).toBeGreaterThan(0);

  for (const entry of manifests) {
    const plan = buildManifestValidationPlan(entry);
    const lock = await resolveGraph(process.cwd(), plan);
    await validateResolvedTemplates(process.cwd(), lock);
  }
}, 120000);
