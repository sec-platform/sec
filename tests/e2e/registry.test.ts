import { expect, test } from 'bun:test';
import pLimit from 'p-limit';

import { loadAllManifests, loadManifestById } from '../../platform/compiler/parse/load-manifest.ts';
import { resolveGraph } from '../../platform/compiler/resolve/resolve-graph.ts';
import { validateResolvedTemplates } from '../../platform/compiler/verify/validate-resolved-templates.ts';
import { buildManifestValidationPlan } from '../helpers/plan-fixtures.ts';

type RegistryValidationFailure = {
  blockId: string;
  error: unknown;
};

function registryValidationConcurrency(): number {
  const parsed = Number.parseInt(process.env.SEC_REGISTRY_VALIDATION_CONCURRENCY ?? '2', 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 2;
  }
  return parsed;
}

test('versioned official registry manifests inherit root manifest fields', async () => {
  const rootEntry = await loadManifestById('ticket/basic');
  const entry = await loadManifestById('ticket/basic', { version: '0.1.1' });

  expect(entry.manifest.version).toBe('0.1.1');
  expect(entry.manifest.requires).toEqual(rootEntry.manifest.requires);
  expect(entry.manifest.installs.map((install) => install.to)).toEqual(
    rootEntry.manifest.installs.map((install) => install.to)
  );
  expect(entry.manifest.pins).toEqual(rootEntry.manifest.pins);
  expect(entry.manifest.acceptance).toEqual(rootEntry.manifest.acceptance);
  expect(entry.manifest.upgrade?.migrations.map((migration) => migration.id)).toEqual([
    'mig-ticket-service-refresh',
    'mig-ticket-upgrade-metadata'
  ]);
  expect(entry.manifestPath.replaceAll('\\', '/')).toContain('/versions/0.1.1/block.manifest.yaml');
  expect(entry.manifestRoot.replaceAll('\\', '/')).toContain('/versions/0.1.1');
}, 180000);
test('official registry blocks typecheck in their minimal resolved closure', async () => {
  const manifests = await loadAllManifests();
  expect(manifests.length).toBeGreaterThan(0);

  const limit = pLimit(registryValidationConcurrency());
  const results = await Promise.all(manifests.map((entry) => limit(async (): Promise<RegistryValidationFailure | null> => {
    try {
      const plan = await buildManifestValidationPlan(entry, manifests);
      const lock = await resolveGraph(process.cwd(), plan);
      await validateResolvedTemplates(process.cwd(), lock);
      return null;
    } catch (caught: any) {
      return {
        blockId: entry.manifest.id,
        error: {
          code: caught.code,
          message: caught.message,
          details: caught.details
        }
      };
    }
  })));
  const failures = results.filter((failure): failure is RegistryValidationFailure => failure !== null);

  if (failures.length > 0) {
    console.error('Typecheck failures:', JSON.stringify(failures, null, 2));
  }
  expect(failures).toHaveLength(0);
}, 120000);
