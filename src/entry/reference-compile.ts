export interface ReferenceCompileProcessOperations {
  execute(): Promise<void>;
}

/** Own the reference-compile process error and exit-code protocol. */
export async function runReferenceCompileProcess(
  operations: ReferenceCompileProcessOperations
): Promise<void> {
  try {
    await operations.execute();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
