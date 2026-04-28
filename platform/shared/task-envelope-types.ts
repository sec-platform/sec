import type { SlotProvenanceHints, SlotTask } from './lock-types.ts';
import type { SlotKind } from './plan-manifest-types.ts';

export interface TaskEnvelope {
  taskId: string;
  taskKind: `${SlotKind}-slot`;
  phase: 'adapt';
  targetBlock: string;
  targetFile: string;
  sourceSlot: {
    id: string;
    status: SlotTask['status'];
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
