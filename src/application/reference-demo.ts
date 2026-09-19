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
  const workspaceRoot = await operations.createWorkspace();
  try {
    operations.announceWorkspace(workspaceRoot);
    await operations.initializeWorkspace(workspaceRoot);
    await operations.compileWorkspace(
      workspaceRoot,
      selectedMode === 'closed-loop' ? 'full' : 'compose'
    );
    if (selectedMode === 'governance' || selectedMode === 'closed-loop') {
      if (selectedMode === 'closed-loop') await operations.verifyAll(workspaceRoot);
      await operations.listGovernanceArtifacts(workspaceRoot);
    }
    if (selectedMode === 'closed-loop') {
      await operations.explainCompactJson(workspaceRoot);
    }
  } finally {
    await operations.removeWorkspace(workspaceRoot);
  }
}
