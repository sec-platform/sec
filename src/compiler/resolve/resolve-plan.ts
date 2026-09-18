import { assertManifestStackCompatibility } from '../align/align-interfaces.ts';
import { portableLogicalPathCollisionKey } from '../../contracts/logical-path.ts';
import { relativePosixPath } from '../../contracts/relative-path.ts';
import type { PlanFile, LockFile, ManifestEntry } from '../contract.ts';
import { CompilerError } from '../errors.ts';
import { resolveManifestGraph } from './manifest-graph.ts';

type InstallOwnership = Readonly<Pick<LockFile['installPlan'][number], 'blockId' | 'action' | 'to'>>;

function assertInstallTargetOwnership(installPlan: readonly InstallOwnership[]): void {
  const byTarget = new Map<string, InstallOwnership[]>();
  for (const step of installPlan) {
    const identity = portableLogicalPathCollisionKey(step.to, 'Install target');
    const group = byTarget.get(identity) ?? [];
    group.push(step);
    byTarget.set(identity, group);
  }
  for (const group of byTarget.values()) {
    if (group.length <= 1) continue;
    const target = group[0]!.to;
    if (group.every((step) => step.action === 'merge-prisma' && step.to === target)) continue;
    throw new CompilerError(
      'RESOLVE-CONFLICT-006',
      `Install target "${target}" has multiple owners without an explicit composition strategy`,
      {
        target,
        owners: group.map((step) => ({ blockId: step.blockId, action: step.action })).sort((left, right) =>
          `${left.blockId}:${left.action}`.localeCompare(`${right.blockId}:${right.action}`)
        )
      }
    );
  }
}

/** Capture only the request decisions this resolver consumes; source validation
 * and provider admission remain in the manifest loader. All observations and
 * the resulting lock use this same invocation, even if the caller edits its
 * plan while manifest IO is pending. */
export function captureResolvePlan(plan: PlanFile) {
  const { app, blocks, registry, acceptance } = plan;
  const selectedApp = Object.freeze({ id: app.id, name: app.name, stack: app.stack, mode: app.mode });
  const selectedBlocks = blocks.map(({ id, version }) => Object.freeze({ id, version }));
  const sources = registry.sources.map(({ id, kind, location, path }) => Object.freeze({ id, kind, location, path }));
  const acceptanceIds = acceptance.map(entry => entry.id);
  Object.freeze(selectedBlocks); Object.freeze(sources); Object.freeze(acceptanceIds);
  return Object.freeze({ app: selectedApp, blocks: selectedBlocks, sources, acceptanceIds });
}

export type CapturedResolvePlan = ReturnType<typeof captureResolvePlan>;

/** Resolve already captured catalog values. Resource lookup and effects stay with the host. */
export function prepareManifestResolution(
  workspaceRoot: string,
  explicitEntries: readonly ManifestEntry[],
  allEntries: readonly ManifestEntry[]
) {
  const graph = resolveManifestGraph(explicitEntries, allEntries);
  // Closure discovery can add providers that were not in the author's plan.
  // Validate the actual selected set before resource lookup or a successful lock.
  for (const { manifest } of graph.entries) {
    assertManifestStackCompatibility(manifest.id, manifest.stackProfiles);
  }
  const resolvedBlocks = graph.entries.map((entry, index) => ({
    id: entry.manifest.id,
    version: entry.manifest.version,
    kind: entry.manifest.kind,
    installOrder: index + 1,
    manifestPath: relativePosixPath(workspaceRoot, entry.manifestPath),
    registrySourceId: entry.registrySourceId,
    registryKind: entry.registryKind,
    registryLocation: entry.registryLocation,
    registryPath: entry.registryPath
  }));
  const installDescriptors = graph.entries.flatMap(block =>
    block.manifest.installs.map(install => ({ block, blockId: block.manifest.id,
      action: install.kind, from: install.from, to: install.to }))
  );
  assertInstallTargetOwnership(installDescriptors);
  return { resolvedBlocks, resolvedCapabilities: [...graph.capabilities], installDescriptors };
}
