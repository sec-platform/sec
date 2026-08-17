import path from 'node:path';

import { createConcurrencyLimit } from '../../shared/concurrency.ts';
import { CompilerError } from '../../shared/errors.ts';
import { ensureDir, writeText, type CommitFence } from '../../shared/fs.ts';
import type { LockFile } from '../../shared/lock-types.ts';
import { getWorkspacePaths, resolvePathInside } from '../../shared/paths.ts';
import type {
  MicroserviceDeploymentIntent,
  MicroserviceDeploymentRenderer,
  MicroserviceResiliencePolicy,
  RenderedMicroserviceArtifact
} from './microservice-deployment-contract.ts';
import { defaultMicroserviceDeploymentBinding } from './microservice-deployment-provider.ts';

const MICROSERVICE_RENDER_CONCURRENCY = 8;

function buildDeploymentIntent(
  blockId: string,
  resilience: MicroserviceResiliencePolicy
): MicroserviceDeploymentIntent {
  return Object.freeze({
    blockId,
    transport: 'json-rpc',
    requestMethod: 'POST',
    packaging: 'isolated-service',
    resilience
  });
}

function resolveRenderedArtifactPath(projectRoot: string, artifact: RenderedMicroserviceArtifact): string {
  const target = resolvePathInside(projectRoot, artifact.relativePath);
  if (!target) {
    throw new CompilerError(
      'COMPOSE-PATH-003',
      `Microservice deployment renderer returned an unsafe artifact path: ${artifact.relativePath}`,
      { artifactPath: artifact.relativePath }
    );
  }
  return target;
}

function assertUniqueRenderedArtifactPaths(
  renderer: MicroserviceDeploymentRenderer,
  artifacts: readonly RenderedMicroserviceArtifact[]
): void {
  const seen = new Set<string>();
  for (const artifact of artifacts) {
    if (seen.has(artifact.relativePath)) {
      throw new CompilerError(
        'COMPOSE-PATH-004',
        `Microservice deployment renderer "${renderer.providerId}" produced duplicate artifact path "${artifact.relativePath}"`,
        { providerId: renderer.providerId, providerRevision: renderer.revision, artifactPath: artifact.relativePath }
      );
    }
    seen.add(artifact.relativePath);
  }
}

async function publishRenderedArtifacts(
  projectRoot: string,
  artifacts: readonly RenderedMicroserviceArtifact[],
  commitFence?: CommitFence
): Promise<string[]> {
  const limit = createConcurrencyLimit(MICROSERVICE_RENDER_CONCURRENCY);
  await Promise.all(artifacts.map((artifact) => limit(async () => {
    const target = resolveRenderedArtifactPath(projectRoot, artifact);
    await ensureDir(path.dirname(target), commitFence);
    await writeText(target, artifact.text, commitFence);
  })));
  return artifacts.map((artifact) => artifact.relativePath);
}

export async function lowerToMicroservicesWithRenderer(
  workspaceRoot: string,
  lock: LockFile,
  renderer: MicroserviceDeploymentRenderer,
  resilience: MicroserviceResiliencePolicy,
  commitFence?: CommitFence
): Promise<string[]> {
  if (lock.app.target !== 'microservices') return [];

  const { projectRoot } = getWorkspacePaths(workspaceRoot);
  const limit = createConcurrencyLimit(MICROSERVICE_RENDER_CONCURRENCY);
  const renderedByBlock = await Promise.all(
    lock.resolvedBlocks.map((block) => limit(() => renderer.render(
      buildDeploymentIntent(block.id, resilience)
    )))
  );
  const artifacts = renderedByBlock.flat();
  assertUniqueRenderedArtifactPaths(renderer, artifacts);
  for (const artifact of artifacts) resolveRenderedArtifactPath(projectRoot, artifact);
  return publishRenderedArtifacts(projectRoot, artifacts, commitFence);
}

/**
 * Current compatibility entrypoint. Provider selection/default policy live in
 * the binding owner; this pass only constructs neutral intent and publishes the
 * renderer's bounded artifact set through the existing compose write boundary.
 */
export async function lowerToMicroservices(
  workspaceRoot: string,
  lock: LockFile,
  commitFence?: CommitFence
): Promise<string[]> {
  const binding = defaultMicroserviceDeploymentBinding();
  return lowerToMicroservicesWithRenderer(
    workspaceRoot,
    lock,
    binding.renderer,
    binding.resilience,
    commitFence
  );
}
