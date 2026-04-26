import type { LockFile } from '../../shared/types.ts';

export type RuntimeEntryKind = 'page' | 'api';

export interface RuntimeAttribution {
  path: string;
  kind: RuntimeEntryKind;
  vertical?: string;
  relatedBlocks: string[];
}

export interface VerticalSliceAttribution {
  id: string;
  runtimeEntries: string[];
  relatedBlocks: string[];
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function classifyRuntimeEntry(targetPath: string): RuntimeEntryKind | null {
  if (/^app\/.+\/page\.tsx$/.test(targetPath) || targetPath === 'app/page.tsx') {
    return 'page';
  }
  if (/^app\/api\/.+\/route\.ts$/.test(targetPath)) {
    return 'api';
  }
  return null;
}

export function detectVerticalFromPath(targetPath: string): string | null {
  if (targetPath.includes('/tickets') || targetPath.includes('ticket') || targetPath.includes('worklog')) {
    return 'ticket';
  }
  if (targetPath.includes('/customers') || targetPath.includes('customer')) {
    return 'customer';
  }
  return null;
}

function isExportBlock(blockId: string): boolean {
  return blockId.startsWith('export/');
}

function isSummaryBlock(blockId: string, vertical: string | null): boolean {
  if (!blockId.includes('summary')) {
    return false;
  }
  if (!vertical) {
    return true;
  }
  return detectVerticalFromPath(blockId) === vertical || blockId.includes(`${vertical}-summary`);
}

export function inferRelatedBlocks(lock: LockFile, targetPath: string): string[] {
  const vertical = detectVerticalFromPath(targetPath);
  const related = new Set<string>();

  for (const block of lock.resolvedBlocks) {
    if (vertical && detectVerticalFromPath(block.id) === vertical) {
      related.add(block.id);
    }
    if (targetPath.includes('/export') && isExportBlock(block.id)) {
      related.add(block.id);
    }
    if (targetPath.includes('/summary') && isSummaryBlock(block.id, vertical)) {
      related.add(block.id);
    }
  }

  return unique([...related]);
}

export function buildRuntimeAttribution(lock: LockFile, targetPath: string): RuntimeAttribution | null {
  const kind = classifyRuntimeEntry(targetPath);
  if (!kind) {
    return null;
  }

  const vertical = detectVerticalFromPath(targetPath);
  return {
    path: targetPath,
    kind,
    ...(vertical ? { vertical } : {}),
    relatedBlocks: inferRelatedBlocks(lock, targetPath)
  };
}

export function buildRuntimeAttributions(lock: LockFile, targetPaths: string[]): RuntimeAttribution[] {
  return unique(targetPaths)
    .map((targetPath) => buildRuntimeAttribution(lock, targetPath))
    .filter((entry): entry is RuntimeAttribution => entry !== null)
    .sort((left, right) => left.path.localeCompare(right.path));
}

export function buildVerticalSliceAttributions(entries: RuntimeAttribution[]): VerticalSliceAttribution[] {
  const slices = new Map<string, { runtimeEntries: Set<string>; relatedBlocks: Set<string> }>();

  for (const entry of entries) {
    if (!entry.vertical) {
      continue;
    }

    let slice = slices.get(entry.vertical);
    if (!slice) {
      slice = { runtimeEntries: new Set<string>(), relatedBlocks: new Set<string>() };
      slices.set(entry.vertical, slice);
    }

    slice.runtimeEntries.add(entry.path);
    for (const blockId of entry.relatedBlocks) {
      slice.relatedBlocks.add(blockId);
    }
  }

  return [...slices.entries()]
    .map(([id, slice]) => ({
      id,
      runtimeEntries: unique([...slice.runtimeEntries]),
      relatedBlocks: unique([...slice.relatedBlocks])
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}
