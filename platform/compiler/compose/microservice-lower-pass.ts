import path from 'node:path';

import { createConcurrencyLimit } from '../../shared/concurrency.ts';
import { CompilerError } from '../../shared/errors.ts';
import { ensureDir, writeText, type CommitFence } from '../../shared/fs.ts';
import type { LockFile } from '../../shared/lock-types.ts';
import {
  isCanonicalPortableLogicalPathV1,
  portableLogicalPathCollisionKeyV1
} from '../../shared/logical-path-identity.ts';
import { getWorkspacePaths, resolvePathInside } from '../../shared/paths.ts';
import type {
  MicroserviceDeploymentIntent,
  MicroserviceDeploymentPublicationPolicy,
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

function assertResiliencePolicy(policy: MicroserviceResiliencePolicy): void {
  const valid =
    Number.isSafeInteger(policy.failureThreshold) && policy.failureThreshold > 0 &&
    Number.isFinite(policy.cooldownPeriodMs) && policy.cooldownPeriodMs >= 0 &&
    Number.isFinite(policy.timeoutMs) && policy.timeoutMs > 0 &&
    Number.isFinite(policy.initialRetryDelayMs) && policy.initialRetryDelayMs >= 0 &&
    Number.isSafeInteger(policy.maxRetries) && policy.maxRetries >= 0;
  if (!valid) {
    throw new CompilerError(
      'COMPOSE-PROVIDER-001',
      'Microservice resilience policy is invalid',
      { policy }
    );
  }
}

function canonicalPublicationRoots(
  policy: MicroserviceDeploymentPublicationPolicy
): readonly string[] {
  if (policy.allowedArtifactRoots.length === 0) {
    throw new CompilerError(
      'COMPOSE-PATH-005',
      'Microservice deployment publication policy must authorize at least one artifact root'
    );
  }
  const roots: string[] = [];
  const seen = new Map<string, string>();
  for (const root of policy.allowedArtifactRoots) {
    if (!isCanonicalPortableLogicalPathV1(root)) {
      throw new CompilerError(
        'COMPOSE-PATH-005',
        `Microservice deployment publication root is not one canonical relative path: ${root}`,
        { root }
      );
    }
    const identity = portableLogicalPathCollisionKeyV1(root);
    const previous = seen.get(identity);
    if (previous !== undefined) {
      throw new CompilerError(
        'COMPOSE-PATH-005',
        `Microservice deployment publication root aliases another portable path: ${root}`,
        { root, previousRoot: previous }
      );
    }
    seen.set(identity, root);
    roots.push(root);
  }
  return Object.freeze(roots);
}

function assertArtifactAuthorized(
  relativePath: string,
  allowedRoots: readonly string[]
): void {
  if (!allowedRoots.some((root) => relativePath.startsWith(`${root}/`))) {
    throw new CompilerError(
      'COMPOSE-PATH-005',
      `Microservice deployment renderer is not authorized to publish artifact path: ${relativePath}`,
      { artifactPath: relativePath, allowedRoots }
    );
  }
}

function resolveRenderedArtifactPath(
  projectRoot: string,
  artifact: RenderedMicroserviceArtifact,
  allowedRoots: readonly string[]
): string {
  if (!isCanonicalPortableLogicalPathV1(artifact.relativePath)) {
    throw new CompilerError(
      'COMPOSE-PATH-003',
      `Microservice deployment renderer returned a non-canonical artifact path: ${artifact.relativePath}`,
      { artifactPath: artifact.relativePath, reason: 'non-canonical-relative-path' }
    );
  }
  assertArtifactAuthorized(artifact.relativePath, allowedRoots);
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
  artifacts: readonly RenderedMicroserviceArtifact[],
  allowedRoots: readonly string[]
): void {
  const seenTargets = new Map<string, Readonly<{ relativePath: string; target: string }>>();
  for (const artifact of artifacts) {
    const target = resolveRenderedArtifactPath(projectRoot, artifact, allowedRoots);
    const identity = portableLogicalPathCollisionKeyV1(artifact.relativePath);
    const previous = seenTargets.get(identity);
    if (previous !== undefined) {
      throw new CompilerError(
        'COMPOSE-PATH-004',
        `Microservice deployment renderer "${renderer.providerId}" produced colliding artifact paths "${previous.relativePath}" and "${artifact.relativePath}"`,
        {
          providerId: renderer.providerId,
          providerRevision: renderer.revision,
          artifactPath: artifact.relativePath,
          previousArtifactPath: previous.relativePath,
          target,
          previousTarget: previous.target
        }
      );
    }
    seenTargets.set(identity, Object.freeze({ relativePath: artifact.relativePath, target }));
  }
}

async function publishRenderedArtifacts(
  projectRoot: string,
  artifacts: readonly RenderedMicroserviceArtifact[],
  allowedRoots: readonly string[],
  commitFence?: CommitFence
): Promise<string[]> {
  const limit = createConcurrencyLimit(MICROSERVICE_PUBLICATION_CONCURRENCY);
  await Promise.all(artifacts.map((artifact) => limit(async () => {
    const target = resolveRenderedArtifactPath(projectRoot, artifact, allowedRoots);
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
  publication: MicroserviceDeploymentPublicationPolicy,
  commitFence?: CommitFence
): Promise<string[]> {
  if (lock.app.target !== 'microservices') return [];

  assertResiliencePolicy(resilience);
  const allowedRoots = canonicalPublicationRoots(publication);
  const { projectRoot } = getWorkspacePaths(workspaceRoot);
  const intents = lock.resolvedBlocks.map((block) => buildDeploymentIntent(block.id, resilience));
  const artifacts = await renderer.render(intents);
  assertUniqueRenderedArtifactPaths(renderer, projectRoot, artifacts, allowedRoots);
  return publishRenderedArtifacts(projectRoot, artifacts, allowedRoots, commitFence);
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
    binding.publication,
    commitFence
  );
}
