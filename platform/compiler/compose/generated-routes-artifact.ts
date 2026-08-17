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

/** Pure with respect to the project publication surface: observes canonical
 * manifest inputs and returns the complete desired bytes without writing the
 * generated artifact. */
export async function planGeneratedRoutesArtifactV1(
  workspaceRoot: string,
  lock: LockFile
): Promise<GeneratedRoutesArtifactPlanV1> {
  const routeEntries = await Promise.all(
    lock.resolvedBlocks.map(async (block) => {
      const manifestEntry = await loadManifestForResolvedBlock(workspaceRoot, block);
      return manifestEntry.manifest.routes.map(
        (route) => `{ blockId: '${block.id}', path: '${route.path}', file: '${route.file}' }`
      );
    })
  );

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
      initializer: `[\n${routeEntries.flat().map((entry) => `  ${entry}`).join(',\n')}\n]`
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
