import type {
  ManifestEntry,
  PlanFile
} from '../../src/compiler/contract.ts';
import { SUPPORTED_STACK } from '../../src/compiler/contract.ts';
import { loadAllManifests } from '../../src/adapters/workspace/sources/load-manifest.ts';
import { officialRegistryRelativePath, privateRegistryRelativePath } from "../../src/adapters/workspace-context.ts";

export function buildSingleTenantPlanApp(options: Partial<PlanFile['app']> = {}): PlanFile['app'] {
  return {
    id: 'customer-admin',
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

export async function buildManifestValidationPlan(
  entry: ManifestEntry,
  allManifests?: ManifestEntry[]
): Promise<PlanFile> {
  const manifests = allManifests ?? (await loadAllManifests());
  const manifestMap = new Map<string, ManifestEntry>();
  for (const m of manifests) {
    manifestMap.set(m.manifest.id, m);
  }

  const blocks: PlanFile['blocks'] = [];
  const visited = new Set<string>();

  function collectDependencies(blockId: string) {
    if (visited.has(blockId)) return;
    visited.add(blockId);

    const manifestEntry = manifestMap.get(blockId);
    if (!manifestEntry) return;

    blocks.push({ id: manifestEntry.manifest.id, version: manifestEntry.manifest.version });

    for (const req of manifestEntry.manifest.requires) {
      collectDependencies(req);
    }
  }

  collectDependencies(entry.manifest.id);

  return {
    app: buildSingleTenantPlanApp({
      id: `validate-${entry.manifest.id.replaceAll('/', '-')}`,
      name: `validate-${entry.manifest.id.replaceAll('/', '-')}`
    }),
    registry: {
      sources: [buildOfficialPlanRegistrySource(), buildPrivatePlanRegistrySource()]
    },
    blocks,
    acceptance: []
  };
}
