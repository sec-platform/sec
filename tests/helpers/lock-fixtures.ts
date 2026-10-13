import type { LockFile } from '../../src/compiler/contract.ts';

const officialRegistryMetadata = {
  registrySourceId: 'official',
  registryKind: 'official',
  registryLocation: 'compiler',
  registryPath: 'catalog/registry/official'
} as const;

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

type OfficialCopyInstallStepOptions = Omit<
  LockFile['installPlan'][number],
  'registrySourceId' | 'registryKind' | 'registryLocation' | 'registryPath' | 'action'
>;

export function buildOfficialCopyInstallStep(options: OfficialCopyInstallStepOptions): LockFile['installPlan'][number] {
  return {
    ...officialRegistryMetadata,
    action: 'copy',
    ...options
  };
}
