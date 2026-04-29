import type { CommandHandler, CommandContext } from '../command-registry.ts';
import { parseArtifactsArgs } from '../args.ts';
import { writeWorkspaceArtifacts } from '../../orchestrator.ts';
import { getWorkspacePaths } from '../../shared/paths.ts';
import { pathExists, readJson } from '../../shared/fs.ts';
import { artifactUploadPathSummary, formatCiArtifactManifest } from '../formatters.ts';
import type { CiArtifactManifest } from '../../compiler/emit/ci-artifacts.ts';
import { ARTIFACTS_USAGE } from '../usage.ts';

export const artifactsCommand: CommandHandler = {
  name: 'artifacts',
  usage: ARTIFACTS_USAGE,
  async execute(args, ctx) {
    const artifactsArgs = parseArtifactsArgs(args);
    if (artifactsArgs.mode === 'manifest') {
      const { ciArtifactsPath } = getWorkspacePaths(ctx.cwd);
      if (!(await pathExists(ciArtifactsPath))) {
        throw new Error('Artifact manifest not found; run platform artifacts --json first');
      }
      const manifest = await readJson<CiArtifactManifest>(ciArtifactsPath);
      if (artifactsArgs.json) {
        console.log(JSON.stringify(manifest, null, artifactsArgs.compact ? 0 : 2));
        return;
      }
      console.log(formatCiArtifactManifest(manifest));
      return;
    }
    const { manifest } = await writeWorkspaceArtifacts(ctx.cwd);
    if (artifactsArgs.mode === 'paths') {
      const pathSummary = artifactUploadPathSummary(manifest, artifactsArgs.kind);
      if (artifactsArgs.json) {
        console.log(JSON.stringify({
          formatVersion: manifest.formatVersion,
          root: manifest.root,
          kind: artifactsArgs.kind ?? 'all',
          artifactStatus: manifest.summary.artifactStatus,
          count: pathSummary.paths.length,
          paths: pathSummary.paths,
          byKind: pathSummary.byKind,
          uploadGroupCount: pathSummary.uploadGroups.length,
          uploadGroups: pathSummary.uploadGroups,
          missingCount: manifest.missing.length,
          missingReasonTypeCount: manifest.summary.missingReasonTypeCount,
          missingReasonCounts: manifest.summary.missingReasonCounts,
          missing: manifest.missing
        }, null, artifactsArgs.compact ? 0 : 2));
        return;
      }
      console.log(pathSummary.paths.join('\n'));
      return;
    }
    console.log(JSON.stringify(manifest, null, artifactsArgs.compact ? 0 : 2));
  }
};
