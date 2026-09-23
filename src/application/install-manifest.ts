import type { InstallPlanStep } from '../compiler/contract.ts';
import { uniqueSorted } from '../contracts/canonical.ts';
import { summarizeCounts } from '../contracts/collections.ts';

export type InstalledManifestEntry = Pick<InstallPlanStep, 'blockId' | 'action' | 'registryKind'> & Readonly<{
  status: 'installed';
}>;

export type InstallManifestView = Readonly<{
  stepCount: number;
  blocks: readonly string[];
  actions: readonly Readonly<{ id: string; count: number }>[];
  registryKinds: readonly Readonly<{ id: string; count: number }>[];
  statuses: readonly Readonly<{ id: string; count: number }>[];
}>;

export function projectInstallManifest(entries: readonly InstalledManifestEntry[]): InstallManifestView {
  return {
    stepCount: entries.length,
    blocks: uniqueSorted(entries.map((entry) => entry.blockId)),
    actions: summarizeCounts(entries.map((entry) => entry.action)),
    registryKinds: summarizeCounts(entries.map((entry) => entry.registryKind)),
    statuses: summarizeCounts(entries.map((entry) => entry.status))
  };
}
