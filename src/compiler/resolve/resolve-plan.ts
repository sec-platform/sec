import { CodedFailure } from '../../contracts/failure.ts';
import { portableLogicalPathCollisionKey } from '../../contracts/logical-path.ts';
import type { RegistryManifestResolution } from '../../contracts/registry-source.ts';
import { relativePosixPath } from '../../contracts/relative-path.ts';
import { assertManifestStackCompatibility, isManifestStackCompatible } from '../align/align-interfaces.ts';
import { SUPPORTED_STACK, type LockFile, type ManifestEntry, type PlanFile } from '../contract.ts';
import { assertManifestDefinitionConsistency } from '../contract/manifest-validation.ts';
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
    throw new CodedFailure(
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

/** Resolve already captured catalog values. Resource lookup and effects stay with the host. */
export function prepareManifestResolution(
  workspaceRoot: string,
  explicitEntries: readonly ManifestEntry[],
  allEntries: readonly ManifestEntry[]
) {
  // A target filter must not conceal contradictory source definitions. This
  // pure consumer also accepts catalog values independently of the loader.
  assertManifestDefinitionConsistency([...explicitEntries, ...allEntries]);
  for (const { manifest } of explicitEntries) {
    assertManifestStackCompatibility(manifest.id, manifest.stackProfiles);
  }
  // Hard conditions define the automatic candidate domain before ambiguity or
  // closure selection. Explicit choices still fail through their original rule.
  const compatibleEntries = allEntries.filter(({ manifest }) => isManifestStackCompatible(manifest.stackProfiles));
  let graph: ReturnType<typeof resolveManifestGraph>;
  try {
    graph = resolveManifestGraph(explicitEntries, compatibleEntries);
  } catch (error) {
    if (error instanceof CodedFailure && error.code === 'RESOLVE-MISSING-001') {
      throw new CodedFailure(error.code, `${error.message} in the stack-compatible catalog for ${SUPPORTED_STACK}`, {
        candidateDomain: 'stack-compatible', stack: SUPPORTED_STACK, causeDetails: error.details
      }, { cause: error });
    }
    throw error;
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
  const registryResolutions: RegistryManifestResolution[] = graph.entries.flatMap(entry => entry.registryResolution ? [{
    blockId: entry.manifest.id,
    selected: { version: entry.manifest.version, registrySourceId: entry.registrySourceId,
      registryKind: entry.registryKind, registryLocation: entry.registryLocation, registryPath: entry.registryPath },
    resolution: structuredClone(entry.registryResolution)
  }] : []);
  return { resolvedBlocks, resolvedCapabilities: [...graph.capabilities], installDescriptors, registryResolutions };
}
