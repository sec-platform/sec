import { LOCK_FILE_FORMAT_VERSION, type LockFile } from '../../src/compiler/contract.ts';
import { ticketSemanticGeneratorTask } from './semantic.ts';

export function semanticArtifactLock(target: string): LockFile {
  return {
    formatVersion: LOCK_FILE_FORMAT_VERSION,
    app: {
      id: 'semantic-artifact-test',
      name: 'semantic-artifact-test',
      stack: 'typescript-library',
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
