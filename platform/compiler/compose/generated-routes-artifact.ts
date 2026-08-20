import { compareCodeUnits } from '../../shared/canonical-primitives.ts';
import { CompilerError } from '../../shared/errors.ts';
import type { CommitFence } from '../../shared/fs.ts';
import type { LockFile } from '../../shared/lock-types.ts';
import { getWorkspacePaths } from '../../shared/paths.ts';
import {
  createNoFollowDirectoryChainV1,
  inspectNoFollowDirectoryChainV1,
  PhysicalNoFollowError,
  replaceDurableCanonicalFileV1
} from '../../shared/physical-no-follow.ts';
import { CodeBuilder } from '../codegen/code-builder.ts';
import { loadManifestForResolvedBlock } from '../parse/load-manifest.ts';

export const GENERATED_ROUTES_ARTIFACT_PATH = 'generated/routes.ts' as const;

export interface GeneratedRoutesArtifactPlanV1 {
  readonly schema: 'sec-generated-routes-artifact-plan-v1';
  readonly relativePath: typeof GENERATED_ROUTES_ARTIFACT_PATH;
  readonly bytes: Uint8Array;
}

type PlannedRoute = Readonly<{
  blockId: string;
  path: string;
  file: string;
}>;

function routeKey(route: PlannedRoute): string {
  return `${route.path}\u0000${route.blockId}\u0000${route.file}`;
}

function renderRoute(route: PlannedRoute): string {
  return `{ blockId: ${JSON.stringify(route.blockId)}, path: ${JSON.stringify(route.path)}, file: ${JSON.stringify(route.file)} }`;
}

/** Pure with respect to the project publication surface: observes canonical
 * manifest inputs and returns the complete desired bytes without writing the
 * generated artifact. */
export async function planGeneratedRoutesArtifactV1(
  workspaceRoot: string,
  lock: LockFile
): Promise<GeneratedRoutesArtifactPlanV1> {
  const manifestEntries = await Promise.all(
    lock.resolvedBlocks.map((block) => loadManifestForResolvedBlock(workspaceRoot, block))
  );
  const routes: PlannedRoute[] = [];
  const routeOwnerByPath = new Map<string, string>();

  for (const entry of manifestEntries) {
    const blockId = entry.manifest.id;
    const ownedTargets = new Set([
      ...lock.installPlan
        .filter((step) => step.blockId === blockId)
        .map((step) => step.to),
      ...entry.manifest.generators.map((generator) => generator.target)
    ]);

    for (const route of entry.manifest.routes) {
      if (!ownedTargets.has(route.file)) {
        throw new CompilerError(
          'COMPOSE-ROUTE-002',
          `Route "${route.path}" references file "${route.file}" that is not produced by Block "${blockId}"`
        );
      }
      const previousOwner = routeOwnerByPath.get(route.path);
      if (previousOwner !== undefined) {
        throw new CompilerError(
          'COMPOSE-ROUTE-001',
          `Route "${route.path}" has multiple Block owners: "${previousOwner}", "${blockId}"`
        );
      }
      routeOwnerByPath.set(route.path, blockId);
      routes.push(Object.freeze({ blockId, path: route.path, file: route.file }));
    }
  }
  routes.sort((left, right) => compareCodeUnits(routeKey(left), routeKey(right)));

  const builder = new CodeBuilder(GENERATED_ROUTES_ARTIFACT_PATH)
    .addInterface(
      'GeneratedRoute',
      [
        { name: 'blockId', type: 'string' },
        { name: 'path', type: 'string' },
        { name: 'file', type: 'string' }
      ],
      true
    )
    .addVariable({
      name: 'routes',
      type: 'GeneratedRoute[]',
      isExported: true,
      initializer: `[\n${routes.map((route) => `  ${renderRoute(route)}`).join(',\n')}\n]`
    });

  return Object.freeze({
    schema: 'sec-generated-routes-artifact-plan-v1' as const,
    relativePath: GENERATED_ROUTES_ARTIFACT_PATH,
    bytes: Buffer.from(builder.getText(), 'utf8')
  });
}

async function retainedGeneratedDirectory(
  workspaceRoot: string,
  commitFence?: CommitFence
) {
  const { projectRoot, generatedDir } = getWorkspacePaths(workspaceRoot);
  try {
    return inspectNoFollowDirectoryChainV1(
      generatedDir,
      'Generated routes artifact directory'
    ).target;
  } catch (error) {
    if (!(error instanceof PhysicalNoFollowError) || error.code !== 'PHYSICAL_NO_FOLLOW_ABSENT') {
      throw error;
    }
  }

  const project = inspectNoFollowDirectoryChainV1(
    projectRoot,
    'Generated routes project root'
  ).target;
  await commitFence?.();
  return createNoFollowDirectoryChainV1(project, ['generated']);
}

/** Publishes exactly one planned routes artifact through retained no-follow
 * ancestry and durable replacement. This is a leaf publication slice, not the
 * full Composition Transaction owned by #300. */
export async function publishGeneratedRoutesArtifactV1(
  workspaceRoot: string,
  plan: GeneratedRoutesArtifactPlanV1,
  commitFence?: CommitFence
): Promise<void> {
  if (plan.relativePath !== GENERATED_ROUTES_ARTIFACT_PATH) {
    throw new Error(`Unexpected generated routes artifact path: ${plan.relativePath}`);
  }
  const parent = await retainedGeneratedDirectory(workspaceRoot, commitFence);
  const expected = Buffer.from(plan.bytes);
  await commitFence?.();
  replaceDurableCanonicalFileV1({
    parent,
    name: 'routes.ts',
    bytes: expected,
    validate: (current) => {
      if (!Buffer.from(current).equals(expected)) {
        throw new Error('Generated routes artifact readback differs from planned bytes');
      }
    }
  });
}
