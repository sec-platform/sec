import path from 'node:path';

import { createConcurrencyLimit } from '../../shared/concurrency.ts';
import { ensureDir, writeText, type CommitFence } from '../../shared/fs.ts';
import type { LockFile } from '../../shared/lock-types.ts';
import { getWorkspacePaths, resolvePathInside } from '../../shared/paths.ts';
import type {
  MicroserviceDeploymentIntent,
  MicroserviceDeploymentRenderer,
  MicroserviceResiliencePolicy,
  RenderedMicroserviceArtifact
} from './microservice-deployment-contract.ts';
import { DEFAULT_MICROSERVICE_RESILIENCE_POLICY } from './microservice-deployment-policy.ts';
import { nextBunDockerMicroserviceRenderer } from './microservice-next-bun-docker-adapter.ts';

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
    throw new Error(`Microservice deployment renderer returned an unsafe artifact path: ${artifact.relativePath}`);
  }
  return target;
}

async function publishRenderedArtifacts(
  projectRoot: string,
  artifacts: readonly RenderedMicroserviceArtifact[],
  commitFence?: CommitFence
): Promise<string[]> {
  const generatedPaths: string[] = [];
  for (const artifact of artifacts) {
    const target = resolveRenderedArtifactPath(projectRoot, artifact);
    await ensureDir(path.dirname(target), commitFence);
    await writeText(target, artifact.text, commitFence);
    generatedPaths.push(artifact.relativePath);
  }
  return generatedPaths;
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
    lock.resolvedBlocks.map((block) => limit(async () => {
      const intent = buildDeploymentIntent(block.id, resilience);
      const artifacts = await renderer.render(intent);
      return publishRenderedArtifacts(projectRoot, artifacts, commitFence);
    }))
  );
  return renderedByBlock.flat();
}

/**
 * Current default microservice lowering entrypoint. Provider-private Next/Bun/
 * Docker generation lives behind the renderer; the pass only owns neutral
 * intent construction and generic compose publication.
 */
export async function lowerToMicroservices(
  workspaceRoot: string,
  lock: LockFile,
  commitFence?: CommitFence
): Promise<string[]> {
  return lowerToMicroservicesWithRenderer(
    workspaceRoot,
    lock,
    nextBunDockerMicroserviceRenderer,
    DEFAULT_MICROSERVICE_RESILIENCE_POLICY,
    commitFence
  );
}
