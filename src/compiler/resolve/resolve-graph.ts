import path from 'node:path';
import { portableLogicalPathCollisionKey } from '../../contracts/logical-path.ts';
import { uniqueSorted } from '../../contracts/canonical.ts';
import { mapTaskGroup } from '../../execution/task-group.ts';
import { CI_ARTIFACT_FILES } from '../../verification/ci-artifacts/contract/manifest.ts';
import { relativePosixPath } from '../../contracts/relative-path.ts';
import type { PlanFile } from '../contract.ts';
import { LOCK_FILE_FORMAT_VERSION, type LockFile } from '../contract.ts';
import { CompilerError } from '../errors.ts';
import { loadAllManifests, loadManifestById, resolveManifestResource } from '../parse/load-manifest.ts';
import { PASS_STATUS_PENDING } from '../pipeline/defaults.ts';
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
function captureResolvePlan(plan: PlanFile) {
  const { app, blocks, registry, acceptance } = plan;
  const selectedApp = Object.freeze({ id: app.id, name: app.name, stack: app.stack, mode: app.mode });
  const selectedBlocks = blocks.map(({ id, version }) => Object.freeze({ id, version }));
  const sources = registry.sources.map(({ id, kind, location, path }) => Object.freeze({ id, kind, location, path }));
  const acceptanceIds = acceptance.map(entry => entry.id);
  Object.freeze(selectedBlocks); Object.freeze(sources); Object.freeze(acceptanceIds);
  return Object.freeze({ app: selectedApp, blocks: selectedBlocks, sources, acceptanceIds });
}

export async function resolveGraph(workspaceRoot: string, plan: PlanFile): Promise<LockFile> {
  workspaceRoot = path.resolve(workspaceRoot);
  const input = captureResolvePlan(plan);
  // Retained explicit lookup is synchronous: Promise.all cannot parallelize it.
  // Keep the original complete catalog validation rather than silently omitting
  // errors in unselected sources as a cache shortcut.
  const explicitEntries = input.blocks.map(block => loadManifestById(block.id, {
    workspaceRoot, version: block.version, registrySources: input.sources
  }));
  const allEntries = await loadAllManifests({ workspaceRoot, registrySources: input.sources });
  const graph = resolveManifestGraph(explicitEntries, allEntries);
  const sortedEntries = graph.entries;

  const resolvedBlocks = sortedEntries.map((entry, index) => ({
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

  const installDescriptors = sortedEntries.flatMap(block =>
    block.manifest.installs.map(install => ({ block, blockId: block.manifest.id,
      action: install.kind, from: install.from, to: install.to }))
  );
  // Ownership is known before resolving any resource. Reject the whole invalid
  // plan without starting a partial batch of resource lookups.
  assertInstallTargetOwnership(installDescriptors);
  const installPlan: LockFile['installPlan'] = await mapTaskGroup(
    installDescriptors, async ({ block, blockId, action, from, to }, index) => {
      const resource = await resolveManifestResource(block, from);
      return {
        stepId: `${blockId}:${index + 1}`, blockId,
        registrySourceId: block.registrySourceId,
        registryKind: block.registryKind,
        registryLocation: block.registryLocation,
        registryPath: block.registryPath,
        sourceRoot: relativePosixPath(block.registryRoot, resource.root), action, from, to
      };
    }
  );
  return {
    formatVersion: LOCK_FILE_FORMAT_VERSION,
    app: { ...input.app },
    resolvedBlocks,
    resolvedCapabilities: [...graph.capabilities],
    installPlan,
    generatedPaths: uniqueSorted([
      CI_ARTIFACT_FILES.blockUsageMap,
      CI_ARTIFACT_FILES.installManifest
    ]),
    acceptancePlan: uniqueSorted(input.acceptanceIds),
    passStatus: {
      ...PASS_STATUS_PENDING,
      parse: 'succeeded',
      align: 'succeeded',
      resolve: 'succeeded'
    }
  };
}
