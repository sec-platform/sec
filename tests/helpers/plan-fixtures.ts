import { SUPPORTED_STACK } from '../../platform/shared/constants.ts';
import { officialRegistryRelativePath, privateRegistryRelativePath } from '../../platform/shared/paths.ts';
import type { ManifestEntry, PlanFile } from '../../platform/shared/types.ts';
import { loadAllManifests } from '../../platform/compiler/parse/load-manifest.ts';

export function buildSingleTenantPlanApp(options: Partial<PlanFile['app']> = {}): PlanFile['app'] {
  return {
    name: 'customer-admin',
    stack: SUPPORTED_STACK,
    packageManager: 'pnpm',
    mode: 'single-tenant',
    ...options
  };
}

function buildOfficialPlanRegistrySource(): PlanFile['registry']['sources'][number] {
  return {
    id: 'official',
    kind: 'official',
    location: 'compiler',
    path: officialRegistryRelativePath.replaceAll('\\', '/')
  };
}

export function buildPrivatePlanRegistrySource(): PlanFile['registry']['sources'][number] {
  return {
    id: 'private',
    kind: 'private',
    location: 'workspace',
    path: privateRegistryRelativePath.replaceAll('\\', '/')
  };
}

export async function buildManifestValidationPlan(entry: ManifestEntry): Promise<PlanFile> {
  const allManifests = await loadAllManifests();
  const manifestMap = new Map<string, ManifestEntry>();
  for (const m of allManifests) {
    manifestMap.set(m.manifest.id, m);
  }

  const blocks: PlanFile['blocks'] = [];
  const slots: PlanFile['slots'] = [];
  const visited = new Set<string>();

  function collectDependencies(blockId: string) {
    if (visited.has(blockId)) return;
    visited.add(blockId);

    const manifestEntry = manifestMap.get(blockId);
    if (!manifestEntry) return;

    blocks.push({ id: manifestEntry.manifest.id, version: manifestEntry.manifest.version });

    for (const slot of manifestEntry.manifest.slots) {
      slots.push({
        id: slot.id,
        block: manifestEntry.manifest.id,
        kind: slot.kind,
        target: slot.target,
        symbol: slot.symbol,
        description: `Template validation placeholder for ${slot.id}`
      });
    }

    for (const req of manifestEntry.manifest.requires) {
      collectDependencies(req);
    }
  }

  collectDependencies(entry.manifest.id);

  return {
    app: buildSingleTenantPlanApp({ name: `validate-${entry.manifest.id.replaceAll('/', '-')}` }),
    registry: {
      sources: [buildOfficialPlanRegistrySource(), buildPrivatePlanRegistrySource()]
    },
    blocks,
    slots,
    acceptance: []
  };
}
