import type { LockFile } from '../../platform/shared/lock-types.ts';
import { ticketSemanticGeneratorTask } from './semantic.ts';

export function semanticArtifactLock(target: string): LockFile {
  return {
    formatVersion: '1',
    app: {
      name: 'semantic-artifact-test',
      stack: 'nextjs-ts-prisma-sqlite',
      mode: 'single-tenant'
    },
    resolvedBlocks: [],
    resolvedCapabilities: [],
    installPlan: [],
    slotTasks: [],
    semanticLoweringTasks: [{
      ...ticketSemanticGeneratorTask(),
      target,
      status: 'generated'
    }],
    generatedPaths: [target],
    acceptancePlan: [],
    passStatus: {
      parse: 'succeeded',
      align: 'succeeded',
      resolve: 'succeeded',
      compose: 'succeeded',
      adapt: 'pending',
      verify: 'pending',
      repair: 'pending',
      lock: 'pending',
      emit: 'pending'
    }
  };
}
