import type { LockFile } from '../../platform/shared/lock-types.ts';
import { ticketSemanticGeneratorTask } from './semantic.ts';

export function semanticArtifactLock(target: string): LockFile {
  return {
    formatVersion: '1',
    app: {
      id: 'semantic-artifact-test',
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
      status: 'generated',
      artifactBinding: {
        generatorEntityId: 'generator:ticket/basic:ticket-status-runtime-contract',
        artifactEntityId: 'artifact:src/installed/ticket/ticket-semantic-contract.ts',
        semanticRevision: 'sha256:test-semantic',
        compilationTransactionId: 'pipeline:test-transaction'
      }
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
