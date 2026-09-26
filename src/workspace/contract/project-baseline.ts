import { z } from 'zod';
import { isDigest256Hex } from '../../contracts/digest.ts';

import { deepFreeze } from '../../contracts/canonical.ts';
import { parseExactJson } from '../../contracts/exact-json.ts';
import { isCanonicalPortableLogicalPath } from '../../contracts/logical-path.ts';
import { captureProjectPathInventory } from './project-path-inventory.ts';

export const PROJECT_BASELINE_FORMAT_VERSION = '1' as const;

/**
 * Workspace-owned input for deriving the immutable project baseline.
 *
 * Upstream producers project their domain state into one logical artifact set;
 * Workspace does not inspect or depend on an upstream compiler lock shape.
 */
export interface ProjectBaselinePathInput {
  artifactPaths: readonly string[];
}

const projectBaselineArtifactSchema = z.object({
  path: z.string().refine(
    isCanonicalPortableLogicalPath,
    'must be one canonical portable logical path'
  ),
  hash: z.string().refine(isDigest256Hex, 'must be one lowercase SHA-256 digest')
}).strict();

const ProjectBaselineSchema = z.object({
  formatVersion: z.literal(PROJECT_BASELINE_FORMAT_VERSION),
  artifacts: z.array(projectBaselineArtifactSchema)
}).strict().superRefine((baseline, context) => {
  let previousPath: string | null = null;
  for (const [index, artifact] of baseline.artifacts.entries()) {
    if (previousPath !== null && artifact.path <= previousPath) {
      context.addIssue({
        code: 'custom',
        path: ['artifacts', index, 'path'],
        message: 'artifact paths must be in canonical code-unit order'
      });
    }
    previousPath = artifact.path;
  }
  try {
    captureProjectPathInventory(baseline.artifacts.map(artifact => artifact.path), 'reject', 'Project baseline paths');
  } catch {
    context.addIssue({ code: 'custom', path: ['artifacts'],
      message: 'artifact paths must be unique and must not alias a portable path' });
  }
});

export type ProjectBaselineArtifact = z.infer<typeof projectBaselineArtifactSchema>;
export type ProjectBaselineFile = z.infer<typeof ProjectBaselineSchema>;

export function parseProjectBaseline(value: unknown): ProjectBaselineFile {
  return deepFreeze(ProjectBaselineSchema.parse(value));
}

export function parseProjectBaselineJson(source: string): ProjectBaselineFile {
  return parseProjectBaseline(parseExactJson(source, 'Project baseline', {
    rootObjectKeys: ['formatVersion', 'artifacts']
  }));
}
