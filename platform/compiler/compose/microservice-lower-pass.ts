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

const MICROSERVICE_PUBLICATION_CONCURRENCY = 8;

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

function assertCanonicalRenderedArtifactRelativePath(relativePath: string): void {
  const normalized = path.posix.normalize(relativePath);
  if (
    relativePath.length === 0 ||
    relativePath.includes('\\') ||
    path.posix.isAbsolute(relativePath) ||
    relativePath === '.' ||
    relativePath.endsWith('/') ||
    normalized !== relativePath ||
    normalized === '..' ||
    normalized.startsWith('../')
  ) {
    throw new CompilerError(
      'COMPOSE-PATH-003',
      `Microservice deployment renderer returned a non-canonical artifact path: ${relativePath}`,
      { artifactPath: relativePath, reason: 'non-canonical-relative-path' }
    );
  }
}

function resolveRenderedArtifactPath(projectRoot: string, artifact: RenderedMicroserviceArtifact): string {
  assertCanonicalRenderedArtifactRelativePath(artifact.relativePath);
  const target = resolvePathInside(projectRoot, artifact.relativePath);
  if (!target) {
    throw new CompilerError(
      'COMPOSE-PATH-003',
      `Microservice deployment renderer returned an unsafe artifact path: ${artifact.relativePath}`,
      { artifactPath: artifact.relativePath, reason: 'project-root-escape' }
    );
  }
  return target;
}

function assertUniqueRenderedArtifactPaths(
  renderer: MicroserviceDeploymentRenderer,
  projectRoot: string,
  artifacts: readonly RenderedMicroserviceArtifact[]
): void {
  const seenTargets = new Map<string, string>();
  for (const artifact of artifacts) {
    const target = resolveRenderedArtifactPath(projectRoot, artifact);
    const previous = seenTargets.get(target);
    if (previous !== undefined) {
      throw new CompilerError(
        'COMPOSE-PATH-004',
        `Microservice deployment renderer "${renderer.providerId}" produced colliding artifact paths "${previous}" and "${artifact.relativePath}"`,
        {
          providerId: renderer.providerId,
          providerRevision: renderer.revision,
          artifactPath: artifact.relativePath,
          previousArtifactPath: previous,
          target
        }
      );
    }
    seenTargets.set(target, artifact.relativePath);
  }
}

async function publishRenderedArtifacts(
  projectRoot: string,
  artifacts: readonly RenderedMicroserviceArtifact[],
  commitFence?: CommitFence
): Promise<string[]> {
  const limit = createConcurrencyLimit(MICROSERVICE_PUBLICATION_CONCURRENCY);
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
  const intents = lock.resolvedBlocks.map((block) => buildDeploymentIntent(block.id, resilience));
  const artifacts = await renderer.render(intents);
  assertUniqueRenderedArtifactPaths(renderer, projectRoot, artifacts);
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
