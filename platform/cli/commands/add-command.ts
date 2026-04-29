import { loadManifestById } from '../../compiler/parse/load-manifest.ts';
import { loadPlan } from '../../compiler/parse/load-plan.ts';
import { addBlock } from '../../orchestrator.ts';
import { resolveWorkspacePlanPath } from '../../shared/paths.ts';
import type { CommandHandler } from '../command-registry.ts';
import { ADD_USAGE } from '../usage.ts';

export const addCommand: CommandHandler = {
  name: 'add',
  usage: ADD_USAGE,
  async execute(args, ctx) {
    if (args.length !== 1) {
      throw new Error(ADD_USAGE);
    }
    await addBlock(ctx.cwd, args[0]);
    const plan = await loadPlan(await resolveWorkspacePlanPath(ctx.cwd));
    const manifestEntry = await loadManifestById(args[0], {
      workspaceRoot: ctx.cwd,
      version: plan.blocks.find((block) => block.id === args[0])?.version,
      registrySources: plan.registry.sources
    });
    console.log(`Added block ${args[0]}@${manifestEntry.manifest.version} from ${manifestEntry.registrySourceId} (${manifestEntry.registryKind})`);
  }
};
