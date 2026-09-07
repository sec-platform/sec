/** Existing fast-check family only: supplied stages still own their authority,
 * input readback and process lifetime. This sequencing function cannot grant a
 * provider, skip a required stage or convert a failure into an acceptance receipt.
 */
export interface FastCheckStages {
  readonly imports: () => Promise<number>;
  readonly sourceAudit: () => Promise<number>;
  readonly documentation: () => Promise<number>;
  readonly types: () => Promise<number>;
  readonly tests: () => Promise<number>;
}

export async function executeFastCheckStages(stages: FastCheckStages): Promise<number> {
  const { imports, sourceAudit, documentation, types, tests } = stages;
  if ([imports, sourceAudit, documentation, types, tests].some(stage => typeof stage !== 'function')) {
    throw new TypeError('Fast check requires all declared stages');
  }
  const run = (stage: () => Promise<number>) => Reflect.apply(stage, stages, []) as Promise<number>;
  const importCode = await run(imports);
  if (importCode !== 0) return importCode;
  const auditCode = await run(sourceAudit);
  if (auditCode !== 0) return auditCode;
  // Both started checks settle before this scope returns or begins tests.
  // Rejection is not proof the other worker stopped; Promise.all would return early.
  const results = await Promise.allSettled([
    Promise.resolve().then(() => run(documentation)),
    Promise.resolve().then(() => run(types))
  ]);
  const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(failures, 'Parallel fast-check stages failed', { cause: failures[0] });
  }
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value !== 0) return result.value;
  }
  return run(tests);
}
