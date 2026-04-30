import { SUPPORTED_STACK } from '../../platform/shared/constants.ts';
import { officialRegistryRelativePath, privateRegistryRelativePath } from '../../platform/shared/paths.ts';
import type { ManifestEntry, PlanFile } from '../../platform/shared/types.ts';

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

export function buildManifestValidationPlan(entry: ManifestEntry): PlanFile {
  return {
    app: buildSingleTenantPlanApp({ name: `validate-${entry.manifest.id.replaceAll('/', '-')}` }),
    registry: {
      sources: [buildOfficialPlanRegistrySource(), buildPrivatePlanRegistrySource()]
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
