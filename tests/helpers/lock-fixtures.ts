import { SUPPORTED_STACK } from '../../src/compiler/contract.ts';
import type { LockFile } from '../../src/compiler/contract.ts';

const officialRegistryMetadata = {
  registrySourceId: 'official',
  registryKind: 'official',
  registryLocation: 'compiler',
  registryPath: 'catalog/registry/official'
} as const;

export function buildSingleTenantLockApp(options: Partial<LockFile['app']> = {}): LockFile['app'] {
  return {
    id: options.id ?? 'customer-admin',
    name: options.name ?? 'customer-admin',
    stack: options.stack ?? SUPPORTED_STACK,
    mode: options.mode ?? 'single-tenant'
  };
}

export function buildOfficialResolvedBlock(options: {
  id: string;
  installOrder: number;
  version?: string;
  kind?: LockFile['resolvedBlocks'][number]['kind'];
  manifestPath?: string;
}): LockFile['resolvedBlocks'][number] {
  return {
    version: '0.1.0',
    kind: 'capability',
    manifestPath: 'manifest.yaml',
    ...officialRegistryMetadata,
    ...options
  };
}

type OfficialInstallStepOptions = Omit<
  LockFile['installPlan'][number],
  'registrySourceId' | 'registryKind' | 'registryLocation' | 'registryPath'
>;

type OfficialCopyInstallStepOptions = Omit<OfficialInstallStepOptions, 'action'>;

export function buildOfficialInstallStep(options: OfficialInstallStepOptions): LockFile['installPlan'][number] {
  return {
    ...officialRegistryMetadata,
    ...options
  };
}

export function buildOfficialCopyInstallStep(options: OfficialCopyInstallStepOptions): LockFile['installPlan'][number] {
  return buildOfficialInstallStep({ action: 'copy', ...options });
}
