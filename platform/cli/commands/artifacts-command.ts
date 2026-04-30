import { buildCiArtifactManifest } from '../../compiler/emit/ci-artifacts.ts';
import { writeWorkspaceArtifacts } from '../../orchestrator.ts';
import type { CiArtifactManifest } from '../../shared/ci-artifact-types.ts';
import { parseArtifactsArgs } from '../args.ts';
import type { CommandHandler } from '../command-registry.ts';
import { printRequiredWorkspaceJson } from '../command-utils.ts';
import { formatJson, printJsonOrText } from '../format-utils.ts';
import { buildArtifactUploadPathContract, formatCiArtifactManifest } from '../formatters.ts';
import { ARTIFACTS_USAGE } from '../usage.ts';

export const artifactsCommand: CommandHandler = {
  name: 'artifacts',
  usage: ARTIFACTS_USAGE,
  async execute(args, ctx) {
    const artifactsArgs = parseArtifactsArgs(args);
    if (artifactsArgs.mode === 'manifest') {
      await printRequiredWorkspaceJson<CiArtifactManifest>(
        ctx.cwd,
        (paths) => paths.ciArtifactsPath,
        'Artifact manifest not found; run platform artifacts --json first',
        artifactsArgs,
        formatCiArtifactManifest
      );
      return;
    }
    if (artifactsArgs.mode === 'paths') {
      const manifest = await buildCiArtifactManifest(ctx.cwd);
      const pathContract = buildArtifactUploadPathContract(manifest, artifactsArgs.kind);
      printJsonOrText(pathContract, artifactsArgs, (contract) => contract.paths.join('\n'));
      return;
    }
    const { manifest } = await writeWorkspaceArtifacts(ctx.cwd);
    console.log(formatJson(manifest, artifactsArgs));
  }
};
