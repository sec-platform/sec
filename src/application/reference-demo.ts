import { withAcquiredResource } from '../execution/resource-settlement.ts';

export const REFERENCE_DEMO_MODES = Object.freeze([
  'quickstart',
  'governance',
  'closed-loop'
] as const);

export type ReferenceDemoMode = (typeof REFERENCE_DEMO_MODES)[number];

export interface ReferenceDemoOperations {
  createWorkspace(): Promise<string>;
  announceWorkspace(workspaceRoot: string): void;
  initializeWorkspace(workspaceRoot: string): Promise<void>;
  compileWorkspace(workspaceRoot: string, through: 'compose' | 'full'): Promise<void>;
  verifyAll(workspaceRoot: string): Promise<void>;
  listGovernanceArtifacts(workspaceRoot: string): Promise<void>;
  explainCompactJson(workspaceRoot: string): Promise<void>;
  removeWorkspace(workspaceRoot: string): Promise<void>;
}

export function isReferenceDemoMode(value: unknown): value is ReferenceDemoMode {
  return REFERENCE_DEMO_MODES.some(mode => mode === value);
}

/**
 * Coordinate the reference demo independently from CLI argument syntax,
 * filesystem layout and the concrete command runner.
 */
export async function runReferenceDemo(
  selectedMode: ReferenceDemoMode,
  operations: ReferenceDemoOperations
): Promise<void> {
  // Select only this mode's operations, and bind them before the first await.
  const create = operations.createWorkspace.bind(operations);
  const announce = operations.announceWorkspace.bind(operations);
  const initialize = operations.initializeWorkspace.bind(operations);
  const compile = operations.compileWorkspace.bind(operations);
  const remove = operations.removeWorkspace.bind(operations);
  const verify = selectedMode === 'closed-loop' ? operations.verifyAll.bind(operations) : undefined;
  const artifacts = selectedMode === 'governance' || selectedMode === 'closed-loop'
    ? operations.listGovernanceArtifacts.bind(operations) : undefined;
  const explain = selectedMode === 'closed-loop' ? operations.explainCompactJson.bind(operations) : undefined;
  await withAcquiredResource({
    operationLabel: 'reference-demo',
    resourceLabel: 'reference-demo-workspace',
    acquire: create,
    async use(workspaceRoot) {
      announce(workspaceRoot);
      await initialize(workspaceRoot);
      await compile(workspaceRoot, selectedMode === 'closed-loop' ? 'full' : 'compose');
      if (verify !== undefined) await verify(workspaceRoot);
      if (artifacts !== undefined) await artifacts(workspaceRoot);
      if (explain !== undefined) await explain(workspaceRoot);
    },
    release: remove
  });
}
