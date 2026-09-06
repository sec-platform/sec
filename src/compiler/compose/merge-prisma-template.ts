import path from 'node:path';

import { decodeExactUtf8, readOptionalRetainedOrdinaryFile } from '../../runtime-state/physical/runtime/retained-file-read.ts';
import { publishExclusiveCanonicalWorkspaceFile, publishExpectedCanonicalWorkspaceFile, type CommitFence } from '../../workspace/files.ts';
import { getWorkspacePaths } from '../../workspace/runtime/paths.ts';
import { CompilerError } from '../errors.ts';
import { mergePrismaSchemas } from './prisma-schema.ts';

export { parsePrismaSchema, mergePrismaSchemas, type PrismaBlock } from './prisma-schema.ts';

function sameBytes(actual: Uint8Array | null, expected: Uint8Array | null): boolean {
  return actual === null ? expected === null : expected !== null && Buffer.from(actual).equals(Buffer.from(expected));
}

/** One schema merge/publication path for package contributions and the model
 * template. It owns neither database migration nor process/network authority.
 * Existing readers/publishers own retained physical access and conditional writes. */
export async function materializePrismaSource(input: Readonly<{
  workspaceRoot: string;
  sourcePath: string;
  targetPath: string;
  sourceRequired: boolean;
  commitFence?: CommitFence;
}>): Promise<void> {
  const { workspaceRoot: root, sourcePath: source, targetPath: target, sourceRequired, commitFence } = input;
  const workspaceRoot = path.resolve(root);
  const sourcePath = path.resolve(workspaceRoot, source);
  const targetPath = path.resolve(workspaceRoot, target);
  if (typeof sourceRequired !== 'boolean') throw new TypeError('Prisma source requirement must be boolean');
  if (commitFence !== undefined && typeof commitFence !== 'function') throw new TypeError('Prisma commit fence must be callable');
  const sourceBytes = readOptionalRetainedOrdinaryFile(sourcePath, 'Prisma merge source');
  if (sourceBytes === null && sourceRequired) throw new CompilerError('COMPOSE-PATH-003', `Prisma source is missing: ${sourcePath}`);
  const sourceFence = async () => {
    await commitFence?.();
    if (!sameBytes(readOptionalRetainedOrdinaryFile(sourcePath, 'Prisma source publication readback'), sourceBytes)) {
      throw new CompilerError('COMPOSE-PRISMA-003', 'Prisma source changed after merge planning');
    }
  };
  if (sourceBytes === null) { await sourceFence(); return; }
  const sourceText = decodeExactUtf8(sourceBytes, 'Prisma merge source');
  const targetBytes = readOptionalRetainedOrdinaryFile(targetPath, 'Prisma merge target');
  const targetText = targetBytes === null ? '' : decodeExactUtf8(targetBytes, 'Prisma merge target');
  const merged = mergePrismaSchemas(targetText, sourceText);
  if (merged === targetText) {
    await sourceFence();
    if (!sameBytes(readOptionalRetainedOrdinaryFile(targetPath, 'Prisma no-op target readback'), targetBytes)) {
      throw new CompilerError('COMPOSE-PRISMA-003', 'Prisma target changed before no-op completion');
    }
    return;
  }
  const publication = { workspaceRoot, targetPath, bytes: Buffer.from(merged, 'utf8'),
    label: 'Prisma merged schema', commitFence: sourceFence };
  if (targetBytes === null) await publishExclusiveCanonicalWorkspaceFile(publication);
  else await publishExpectedCanonicalWorkspaceFile({ ...publication, expectedBytes: targetBytes });
}

/** Compile the optional model template; never push or migrate a live database. */
export async function mergePrismaTemplate(workspaceRoot: string, commitFence?: CommitFence): Promise<void> {
  workspaceRoot = path.resolve(workspaceRoot);
  const paths = getWorkspacePaths(workspaceRoot);
  return materializePrismaSource({ workspaceRoot,
    sourcePath: path.join(paths.modelRoot, 'schema', 'db.prisma.template'),
    targetPath: path.join(paths.prismaRoot, 'schema.prisma'),
    sourceRequired: false, commitFence });
}
