import path from 'node:path';
import { uniqueSorted } from '../../contracts/canonical.ts';
import { mapTaskGroup } from '../../execution/task-group.ts';
import { CI_ARTIFACT_FILES } from '../../verification/ci-artifacts/contract/manifest.ts';
import { relativePosixPath } from '../../contracts/relative-path.ts';
import type { PlanFile } from '../../compiler/contract.ts';
import { LOCK_FILE_FORMAT_VERSION, type LockFile } from '../../compiler/contract.ts';
import { loadAllManifests, loadManifestById, resolveManifestResource } from './sources/load-manifest.ts';
import { PASS_INITIAL_STATES as PASS_STATUS_PENDING } from '../../compiler/contract/pass-status.ts';
import { captureResolvePlan, prepareManifestResolution } from '../../compiler/resolve/resolve-plan.ts';

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
  // Reject conflicting ownership before any resource lookup starts.
  const { resolvedBlocks, resolvedCapabilities, installDescriptors } = prepareManifestResolution(
    workspaceRoot, explicitEntries, allEntries
  );
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
    resolvedCapabilities,
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
