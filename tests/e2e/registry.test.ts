import { expect, test } from 'bun:test';
import pLimit from 'p-limit';

import { loadAllManifests } from '../../src/adapters/workspace/sources/load-manifest.ts';
import { resolveGraph } from '../../src/adapters/workspace/resolve-graph.ts';
import { validateResolvedTemplates } from '../../src/adapters/verification/validate-resolved-templates.ts';
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
