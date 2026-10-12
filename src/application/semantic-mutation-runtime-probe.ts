/** Admission and dependency preparation precede the native runtime probe. */
export async function probePreparedSemanticMutationRuntime(input: Readonly<{
  stagingWorkspaceRoot: string;
  admitStagingWorkspace: (workspaceRoot: string) => Promise<void>;
  ensureCompilerReady: () => Promise<unknown>;
  probeRuntime: (workspaceRoot: string) => Promise<Readonly<{ status: 'available' | 'unavailable' }>>;
}>): Promise<Readonly<{ status: 'available' | 'unavailable' }>> {
  try {
    await input.admitStagingWorkspace(input.stagingWorkspaceRoot);
    await input.ensureCompilerReady();
    return await input.probeRuntime(input.stagingWorkspaceRoot);
  } catch {
    return Object.freeze({ status: 'unavailable' as const });
  }
}
