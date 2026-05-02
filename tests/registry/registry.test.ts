import { expect, test } from 'bun:test';

import { loadAllManifests, loadManifestById } from '../../platform/compiler/parse/load-manifest.ts';
import { resolveGraph } from '../../platform/compiler/resolve/resolve-graph.ts';
import { validateResolvedTemplates } from '../../platform/compiler/verify/validate-resolved-templates.ts';
import { buildManifestValidationPlan } from '../helpers/plan-fixtures.ts';

test('versioned official registry manifests inherit root manifest fields', async () => {
  const entry = await loadManifestById('ticket/basic', { version: '0.1.1' });

  expect(entry.manifest.version).toBe('0.1.1');
  expect(entry.manifest.requires).toEqual([] as any);
  expect(entry.manifest.installs.map((install) => install.to)).toEqual([] as any);
  expect(entry.manifest.upgrade?.migrations.map((migration) => migration.id)).toEqual([] as any);
  expect(entry.manifestPath.replaceAll('\\', '/')).toContain('/versions/0.1.1/block.manifest.yaml');
  expect(entry.manifestRoot.replaceAll('\\', '/')).toContain('/versions/0.1.1');
});

test('official registry blocks typecheck in their minimal resolved closure', async () => {
  const manifests = await loadAllManifests();
  expect(manifests.length).toBeGreaterThan(0);

  for (const entry of manifests) {
    const plan = buildManifestValidationPlan(entry);
    const lock = await resolveGraph(process.cwd(), plan);
    await validateResolvedTemplates(process.cwd(), lock);
  }
}, 120000);
