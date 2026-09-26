import type { BigIntStats } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getErrorCode } from '../../../../contracts/failure-inspection.ts';
import { FailureError } from '../../../../contracts/failure.ts';

export type DependencyEnvironmentMode = 'cold' | 'warm-shared' | 'warm-project' | 'dirty' | 'stale';
export type DependencyEntryKind = 'missing' | 'physical' | 'link';
export interface DependencyEntryStatus {
  path: string;
  exists: boolean;
  kind: DependencyEntryKind;
  sizeBytes: number;
  entryCount?: number;
  target?: string;
}

/** Diagnostic observation only: neither a retained handle nor write permission.
 * Keep directory identity separate from the existing public display contract. */
export interface DependencyEntryObservation {
  readonly entry: DependencyEntryStatus;
  readonly directory: Readonly<{ device: string; inode: string }> | null;
}

async function optionalStat(targetPath: string, follow: boolean): Promise<BigIntStats | null> {
  try {
    return follow ? await fs.stat(targetPath, { bigint: true })
      : await fs.lstat(targetPath, { bigint: true });
  } catch (error) {
    if (getErrorCode(error) === 'ENOENT') return null;
    throw error;
  }
}

function sameObservation(before: BigIntStats | null, after: BigIntStats | null): boolean {
  if (before === null || after === null) return before === after;
  return before.dev === after.dev && before.ino === after.ino && before.mode === after.mode
    && before.size === after.size && before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs;
}

function changed(targetPath: string): never {
  throw new FailureError('RUNTIME-DEPS-004', 'Dependency environment entry changed during observation', { path: targetPath });
}

/** Count through one directory iterator, without materializing all names.
 * Native async iteration owns handle closure on success or failure. */
async function entryCount(targetPath: string): Promise<number> {
  let count = 0;
  for await (const _entry of await fs.opendir(targetPath)) count++;
  return count;
}

export async function observeDependencyEntry(targetPath: string): Promise<DependencyEntryObservation> {
  targetPath = path.resolve(targetPath);
  const before = await optionalStat(targetPath, false);
  if (before === null) {
    return Object.freeze({ entry: { path: targetPath, exists: false, kind: 'missing' as const, sizeBytes: 0 }, directory: null });
  }
  const endpoint = before.isSymbolicLink() ? await optionalStat(targetPath, true) : before;
  let target: string | undefined;
  let count: number | undefined;
  try {
    // Broken links still exist as entries, but have no usable target directory.
    target = endpoint === null ? undefined : await fs.realpath(targetPath);
    // Preserve the public metadata meaning: count direct physical directories,
    // not a second traversal through every link to the same shared tree.
    count = before.isDirectory() ? await entryCount(targetPath) : undefined;
  } catch (error) {
    const code = getErrorCode(error);
    if (code === 'ENOENT' || code === 'ENOTDIR') changed(targetPath);
    throw error;
  }
  const after = await optionalStat(targetPath, false);
  const endpointAfter = before.isSymbolicLink() ? await optionalStat(targetPath, true) : after;
  if (!sameObservation(before, after) || !sameObservation(endpoint, endpointAfter)) changed(targetPath);
  return Object.freeze({
    entry: { path: targetPath, exists: true, kind: before.isSymbolicLink() ? 'link' as const : 'physical' as const,
      sizeBytes: Number(before.size), entryCount: count, target },
    directory: endpoint?.isDirectory() ? Object.freeze({ device: endpoint.dev.toString(), inode: endpoint.ino.toString() }) : null
  });
}

/** Equal stamps do not establish that a project link reaches the observed cache.
 * These filesystem identity observations are diagnostic, not content validation. */
export function sameObservedDependencyDirectory(left: DependencyEntryObservation, right: DependencyEntryObservation): boolean {
  return left.directory !== null && right.directory !== null
    && left.directory.device === right.directory.device && left.directory.inode === right.directory.inode;
}

/** Health is a diagnostic projection. A matching stamp cannot repair a missing
 * directory or make a link to an unrelated tree into the shared projection. */
export function classifyDependencyEnvironment(
  stamps: Readonly<{ manifestHash: string; sharedStampHash?: string; projectStampHash?: string }>,
  shared: DependencyEntryObservation,
  project: DependencyEntryObservation
): DependencyEnvironmentMode {
  if (shared.directory === null || !stamps.sharedStampHash) return 'cold';
  if (stamps.sharedStampHash !== stamps.manifestHash ||
      (stamps.projectStampHash && stamps.projectStampHash !== stamps.manifestHash)) return 'stale';
  if (!project.entry.exists) return 'warm-shared';
  if (project.entry.kind !== 'link' || !sameObservedDependencyDirectory(project, shared)) return 'dirty';
  return stamps.projectStampHash === stamps.manifestHash ? 'warm-project' : 'warm-shared';
}
