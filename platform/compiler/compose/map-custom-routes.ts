import path from 'node:path';

import { CompilerError } from '../../shared/errors.ts';
import type { CommitFence } from '../../shared/fs.ts';
import {
  isCanonicalPortableLogicalPathV1,
  portableLogicalPathCollisionKeyV1
} from '../../shared/logical-path-identity.ts';
import {
  inspectExactNoFollowDirectoryPresenceV1,
  scanNoFollowDirectoryTreeMetadataV1
} from '../../shared/physical-no-follow.ts';
import { readOptionalRetainedOrdinaryFileV1 } from '../../shared/retained-file-read.ts';
import { publishExclusiveCanonicalWorkspaceFileV1 } from '../../shared/workspace-file-publication.ts';

const ROUTE_SOURCE_MAX_ENTRIES = 4096;
const ROUTE_SOURCE_MAX_BYTES = 64 * 1024 * 1024;
const ROUTE_SOURCE_TIMEOUT_MS = 5000;
const ROUTE_ENTRY_NAMES = new Set(['page.tsx', 'page.ts', 'page.jsx', 'page.js', 'route.ts', 'route.js']);
const LAYOUT_NAMES = ['layout.tsx', 'layout.ts', 'layout.jsx', 'layout.js'] as const;

type RouteSnapshotFile = Readonly<{
  relativePath: string;
  bytes: Uint8Array;
}>;

type RouteSourceSnapshot = Readonly<{
  files: readonly RouteSnapshotFile[];
  filePaths: ReadonlySet<string>;
}>;

type RoutePublication = Readonly<{
  targetFile: string;
  relativePath: string;
  bytes: Uint8Array;
}>;

function metadataKey(entries: ReturnType<typeof scanNoFollowDirectoryTreeMetadataV1>): string {
  return JSON.stringify(entries.map((entry) => [
    entry.relativePath,
    entry.kind,
    entry.device,
    entry.inode,
    entry.size,
    entry.linkTarget
  ]));
}

function inventoryRouteSource(routesSourceDir: string) {
  const presence = inspectExactNoFollowDirectoryPresenceV1(routesSourceDir, 'Custom routes source');
  if (presence.state === 'absent') return null;
  const entries = scanNoFollowDirectoryTreeMetadataV1(presence.directory.target, {
    deadlineAtMs: performance.now() + ROUTE_SOURCE_TIMEOUT_MS,
    maximumEntries: ROUTE_SOURCE_MAX_ENTRIES
  });
  const unsafe = entries.find((entry) =>
    entry.kind === 'link' || !isCanonicalPortableLogicalPathV1(entry.relativePath)
  );
  if (unsafe) {
    throw new CompilerError(
      'SPEC-ROUTE-006',
      `Custom route source contains an unsupported physical/logical entry: ${unsafe.relativePath}`
    );
  }
  const sourceIdentities = new Map<string, string>();
  for (const entry of entries) {
    const identity = portableLogicalPathCollisionKeyV1(entry.relativePath, 'Custom route source path');
    const previous = sourceIdentities.get(identity);
    if (previous !== undefined) {
      throw new CompilerError(
        'SPEC-ROUTE-006',
        `Custom route source contains portable path aliases: ${previous}, ${entry.relativePath}`
      );
    }
    sourceIdentities.set(identity, entry.relativePath);
  }
  const totalBytes = entries
    .filter((entry) => entry.kind === 'file')
    .reduce((total, entry) => total + entry.size, 0);
  if (totalBytes > ROUTE_SOURCE_MAX_BYTES) {
    throw new CompilerError(
      'SPEC-ROUTE-006',
      `Custom route source exceeds the ${ROUTE_SOURCE_MAX_BYTES} byte operation budget`
    );
  }
  return Object.freeze({ root: presence.directory.target, entries });
}

function retainedRouteBytes(routesSourceDir: string, relativePath: string): Uint8Array {
  const bytes = readOptionalRetainedOrdinaryFileV1(
    path.join(routesSourceDir, ...relativePath.split('/')),
    `Custom route source ${relativePath}`
  );
  if (bytes === null) {
    throw new CompilerError('SPEC-ROUTE-006', `Custom route disappeared during snapshot: ${relativePath}`);
  }
  return bytes;
}

function snapshotCustomRoutes(routesSourceDir: string): RouteSourceSnapshot | null {
  const before = inventoryRouteSource(routesSourceDir);
  if (before === null) return null;
  const files: RouteSnapshotFile[] = [];
  let observedBytes = 0;
  for (const entry of before.entries) {
    if (entry.kind !== 'file') continue;
    const bytes = retainedRouteBytes(routesSourceDir, entry.relativePath);
    observedBytes += bytes.byteLength;
    if (observedBytes > ROUTE_SOURCE_MAX_BYTES) {
      throw new CompilerError('SPEC-ROUTE-006', 'Custom route source changed beyond its byte budget during snapshot');
    }
    files.push(Object.freeze({ relativePath: entry.relativePath, bytes }));
  }

  const after = inventoryRouteSource(routesSourceDir);
  if (after === null || metadataKey(before.entries) !== metadataKey(after.entries)) {
    throw new CompilerError('SPEC-ROUTE-006', 'Custom route source changed during snapshot; retry from a new observation');
  }
  for (const file of files) {
    const current = retainedRouteBytes(routesSourceDir, file.relativePath);
    if (!Buffer.from(current).equals(Buffer.from(file.bytes))) {
      throw new CompilerError(
        'SPEC-ROUTE-006',
        `Custom route source bytes changed during snapshot: ${file.relativePath}`
      );
    }
  }

  return Object.freeze({
    files: Object.freeze(files),
    filePaths: new Set(files.map((file) => file.relativePath))
  });
}

function assertRouteSourceSnapshotCurrent(
  routesSourceDir: string,
  expected: RouteSourceSnapshot
): void {
  const observed = snapshotCustomRoutes(routesSourceDir);
  if (observed === null || observed.files.length !== expected.files.length) {
    throw new CompilerError('SPEC-ROUTE-006', 'Custom route source set changed after planning');
  }
  for (let index = 0; index < expected.files.length; index += 1) {
    const expectedFile = expected.files[index]!;
    const observedFile = observed.files[index]!;
    if (
      expectedFile.relativePath !== observedFile.relativePath ||
      !Buffer.from(expectedFile.bytes).equals(Buffer.from(observedFile.bytes))
    ) {
      throw new CompilerError(
        'SPEC-ROUTE-006',
        `Custom route source changed after planning: ${expectedFile.relativePath}`
      );
    }
  }
}

function routeDirectory(relativePath: string): string {
  const directory = path.posix.dirname(relativePath);
  return directory === '.' ? '' : directory;
}

function hasSourceLayoutInChain(routeDir: string, filePaths: ReadonlySet<string>): boolean {
  let current = routeDir;
  for (;;) {
    if (LAYOUT_NAMES.some((name) => filePaths.has(current ? `${current}/${name}` : name))) return true;
    if (current === '') return false;
    const parent = path.posix.dirname(current);
    current = parent === '.' ? '' : parent;
  }
}

function readOptionalTargetBytes(filePath: string, label: string): Uint8Array | null {
  return readOptionalRetainedOrdinaryFileV1(filePath, label);
}

function hasTargetLayoutInChain(targetRouteDir: string, targetAppRoot: string): boolean {
  let current = targetRouteDir;
  for (;;) {
    for (const name of LAYOUT_NAMES) {
      if (readOptionalTargetBytes(path.join(current, name), `Custom route layout target ${name}`) !== null) {
        return true;
      }
    }
    if (path.resolve(current) === path.resolve(targetAppRoot)) return false;
    const parent = path.dirname(current);
    const resolvedParent = path.resolve(parent);
    const resolvedTargetAppRoot = path.resolve(targetAppRoot);
    if (parent === current || (
      resolvedParent !== resolvedTargetAppRoot &&
      !resolvedParent.startsWith(`${resolvedTargetAppRoot}${path.sep}`)
    )) {
      throw new CompilerError('SPEC-ROUTE-006', 'Custom route layout traversal escaped the target app root');
    }
    current = parent;
  }
}

function resolveUniqueTargetAppRoot(projectRoot: string): string {
  const candidates = [path.join(projectRoot, 'src', 'app'), path.join(projectRoot, 'app')];
  const present = candidates.filter((candidate) =>
    inspectExactNoFollowDirectoryPresenceV1(candidate, `Custom route app root ${candidate}`).state === 'present'
  );
  if (present.length !== 1) {
    throw new CompilerError(
      'SPEC-ROUTE-006',
      present.length === 0
        ? 'Custom routes require exactly one existing project app root'
        : 'Custom routes found multiple project app roots'
    );
  }
  return present[0]!;
}

function planRoutePublication(
  targetFile: string,
  relativePath: string,
  bytes: Uint8Array
): RoutePublication {
  const existing = readOptionalTargetBytes(targetFile, `Custom route target ${relativePath}`);
  if (existing !== null && !Buffer.from(existing).equals(Buffer.from(bytes))) {
    throw new CompilerError(
      'SPEC-ROUTE-006',
      `Custom route target collision requires Composition ownership resolution: ${relativePath}`
    );
  }
  return Object.freeze({
    targetFile,
    relativePath,
    bytes
  });
}

function addUniquePublication(
  publications: Map<string, RoutePublication>,
  publication: RoutePublication
): void {
  const identity = portableLogicalPathCollisionKeyV1(
    publication.relativePath,
    'Custom route publication path'
  );
  const existing = publications.get(identity);
  if (!existing) {
    publications.set(identity, publication);
    return;
  }
  if (!Buffer.from(existing.bytes).equals(Buffer.from(publication.bytes))) {
    throw new CompilerError(
      'SPEC-ROUTE-006',
      `Custom route plan has conflicting producers for ${publication.relativePath}`
    );
  }
}

export async function mapCustomRoutes(
  workspaceRoot: string,
  projectRoot: string,
  commitFence?: CommitFence
): Promise<string[]> {
  const routesSourceDir = path.join(workspaceRoot, 'source', 'ui', 'routes');
  const fallbackLayoutPath = path.join(workspaceRoot, 'source', 'ui', 'layouts', 'dashboard-layout.tsx');
  const snapshot = snapshotCustomRoutes(routesSourceDir);
  if (snapshot === null || snapshot.files.length === 0) return [];
  const targetAppRoot = resolveUniqueTargetAppRoot(projectRoot);
  const publications = new Map<string, RoutePublication>();
  const generatedPaths = new Set<string>();
  const routeDirs = new Set<string>();

  for (const sourceFile of snapshot.files) {
    const targetFile = path.join(targetAppRoot, ...sourceFile.relativePath.split('/'));
    const relativeTarget = path.relative(projectRoot, targetFile).split(path.sep).join('/');
    addUniquePublication(
      publications,
      planRoutePublication(targetFile, relativeTarget, sourceFile.bytes)
    );
    generatedPaths.add(relativeTarget);
    if (ROUTE_ENTRY_NAMES.has(path.posix.basename(sourceFile.relativePath))) {
      routeDirs.add(routeDirectory(sourceFile.relativePath));
    }
  }

  const fallbackDirs: string[] = [];
  for (const relativeDir of [...routeDirs].sort()) {
    if (hasSourceLayoutInChain(relativeDir, snapshot.filePaths)) continue;
    const targetRouteDir = relativeDir
      ? path.join(targetAppRoot, ...relativeDir.split('/'))
      : targetAppRoot;
    if (!hasTargetLayoutInChain(targetRouteDir, targetAppRoot)) fallbackDirs.push(relativeDir);
  }

  let fallbackBytes: Uint8Array | null = null;
  const fallbackTargetDirectories: string[] = [];
  if (fallbackDirs.length > 0) {
    fallbackBytes = readOptionalRetainedOrdinaryFileV1(
      fallbackLayoutPath,
      'Custom route fallback dashboard layout'
    );
    if (fallbackBytes === null) {
      throw new CompilerError(
        'SPEC-ROUTE-005',
        `Missing layout for custom route "${fallbackDirs[0] || '/'}", and fallback dashboard-layout.tsx is absent.`
      );
    }
    // Re-read before any target effect so the fallback participates in the same
    // operation-local source-content fence as the route tree.
    const fallbackReadback = readOptionalRetainedOrdinaryFileV1(
      fallbackLayoutPath,
      'Custom route fallback dashboard layout readback'
    );
    if (fallbackReadback === null || !Buffer.from(fallbackReadback).equals(Buffer.from(fallbackBytes))) {
      throw new CompilerError('SPEC-ROUTE-006', 'Custom route fallback layout changed during planning');
    }

    for (const relativeDir of fallbackDirs) {
      const targetRouteDir = relativeDir
        ? path.join(targetAppRoot, ...relativeDir.split('/'))
        : targetAppRoot;
      fallbackTargetDirectories.push(targetRouteDir);
      const targetLayoutPath = path.join(targetRouteDir, 'layout.tsx');
      const relativeLayout = path.relative(projectRoot, targetLayoutPath).split(path.sep).join('/');
      addUniquePublication(
        publications,
        planRoutePublication(targetLayoutPath, relativeLayout, fallbackBytes)
      );
      generatedPaths.add(relativeLayout);
    }
  }

  await commitFence?.();
  assertRouteSourceSnapshotCurrent(routesSourceDir, snapshot);
  if (fallbackBytes !== null) {
    const currentFallback = readOptionalRetainedOrdinaryFileV1(
      fallbackLayoutPath,
      'Custom route fallback dashboard layout final fence'
    );
    if (currentFallback === null || !Buffer.from(currentFallback).equals(Buffer.from(fallbackBytes))) {
      throw new CompilerError('SPEC-ROUTE-006', 'Custom route fallback layout changed after planning');
    }
    if (fallbackTargetDirectories.some((directory) => hasTargetLayoutInChain(directory, targetAppRoot))) {
      throw new CompilerError('SPEC-ROUTE-006', 'Custom route target layout changed after planning');
    }
  }
  const publicationFence = async (): Promise<void> => {
    await commitFence?.();
    assertRouteSourceSnapshotCurrent(routesSourceDir, snapshot);
    if (fallbackBytes !== null) {
      const currentFallback = readOptionalRetainedOrdinaryFileV1(
        fallbackLayoutPath,
        'Custom route fallback dashboard layout publication fence'
      );
      if (currentFallback === null || !Buffer.from(currentFallback).equals(Buffer.from(fallbackBytes))) {
        throw new CompilerError('SPEC-ROUTE-006', 'Custom route fallback layout changed before publication');
      }
    }
  };

  // Every route target is a monotonic create-if-absent publication. A crash or
  // concurrent equal publisher is therefore recovered by the same exact plan;
  // conflicting bytes fail without replacing the other writer's target.
  for (const publication of [...publications.values()]
    .sort((left, right) => left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0)) {
    await publishExclusiveCanonicalWorkspaceFileV1({
      workspaceRoot: projectRoot,
      targetPath: publication.targetFile,
      bytes: publication.bytes,
      label: `Custom route publication ${publication.relativePath}`,
      commitFence: publicationFence
    });
  }

  return [...generatedPaths].sort();
}
