import path from 'node:path';

import { CompilerError } from '../errors.ts';
import { resolvePathInside } from '../../workspace/paths.ts';
import type { ManifestEntry } from '../contract.ts';
import {
  decodeExactAuthorityUtf8,
  readOptionalAuthorityBytes
} from './read-authority-source.ts';

export interface ManifestResourceFileBytes {
  readonly root: string;
  readonly path: string;
  readonly bytes: Uint8Array;
}

function resourceCandidate(root: string, resourcePath: string): string {
  const candidate = resolvePathInside(root, resourcePath);
  if (!candidate) {
    throw new CompilerError(
      'MANIFEST-SCHEMA-006',
      `Manifest resource path "${resourcePath}" escapes its resource root`
    );
  }
  return candidate;
}

export function readManifestResourceFileBytes(
  entry: ManifestEntry,
  resourcePath: string
): ManifestResourceFileBytes | null {
  const roots = entry.resourceRoots.length > 0 ? entry.resourceRoots : [entry.manifestRoot];
  for (const root of roots) {
    const candidate = resourceCandidate(root, resourcePath);
    const bytes = readOptionalAuthorityBytes(
      candidate,
      `Manifest ${entry.manifest.id} resource ${resourcePath}`
    );
    if (bytes !== null) return Object.freeze({ root, path: candidate, bytes });
  }
  return null;
}

export function readManifestResourceFileUtf8(
  entry: ManifestEntry,
  resourcePath: string
): Readonly<{ root: string; path: string; raw: string }> | null {
  const source = readManifestResourceFileBytes(entry, resourcePath);
  if (source === null) return null;
  return Object.freeze({
    root: source.root,
    path: source.path,
    raw: decodeExactAuthorityUtf8(
      source.bytes,
      `Manifest ${entry.manifest.id} resource ${path.resolve(source.path)}`
    )
  });
}
