import type { SlotKind, SlotProvenanceHints, SlotTask } from '../../../compiler/contract.ts';

export interface TaskEnvelope {
  taskId: string;
  taskKind: `${SlotKind}-slot`;
  phase: 'adapt';
  targetBlock: string;
  targetFile: string;
  sourceSlot: {
    id: string;
    status: SlotTask['status'];
    runtimeTarget: string;
    sourcePath?: string;
    writableZones: string[];
    provenanceHints: SlotProvenanceHints;
  };
  allowedPaths: string[];
  requiredSymbols: string[];
  forbiddenOperations: string[];
  inputContracts: {
    description: string;
    inputType?: string;
    outputType?: string;
  };
  testsToPass: string[];
  budget: {
    maxAttempts: number;
    timeoutSeconds: number;
    maxTokens: number;
  };
  expectedOutput: {
    type: 'source-file';
    language: 'typescript';
  };
  lockSummary: {
    blocks: string[];
  };
}
