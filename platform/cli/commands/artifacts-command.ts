import type { CommandHandler } from '../command-registry.ts';
import { parseArtifactsArgs } from '../args.ts';
import { buildCiArtifactManifest } from '../../compiler/emit/ci-artifacts.ts';
import { writeWorkspaceArtifacts } from '../../orchestrator.ts';
import { getWorkspacePaths } from '../../shared/paths.ts';
import { pathExists, readJson } from '../../shared/fs.ts';
import { buildArtifactUploadPathContract, formatCiArtifactManifest } from '../formatters.ts';
import { formatJson } from '../format-utils.ts';
import type { CiArtifactManifest } from '../../shared/ci-artifact-types.ts';
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
        console.log(formatJson(manifest, artifactsArgs));
        return;
      }
      console.log(formatCiArtifactManifest(manifest));
      return;
    }
    if (artifactsArgs.mode === 'paths') {
      const manifest = await buildCiArtifactManifest(ctx.cwd);
      const pathContract = buildArtifactUploadPathContract(manifest, artifactsArgs.kind);
      if (artifactsArgs.json) {
        console.log(formatJson(pathContract, artifactsArgs));
        return;
      }
      console.log(pathContract.paths.join('\n'));
      return;
    }
    const { manifest } = await writeWorkspaceArtifacts(ctx.cwd);
    console.log(formatJson(manifest, artifactsArgs));
  }
};
