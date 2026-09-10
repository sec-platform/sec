/** Existing fast-check family only: supplied stages still own their authority,
 * input readback and process lifetime. This sequencing function cannot grant a
 * provider, skip a required stage or convert a failure into an acceptance receipt.
 */
export interface FastCheckStages {
  readonly imports: () => Promise<number>;
  readonly documentation: () => Promise<number>;
  readonly types: () => Promise<number>;
  readonly tests: () => Promise<number>;
}

export async function executeFastCheckStages(stages: FastCheckStages): Promise<number> {
  const { imports, documentation, types, tests } = stages;
  if ([imports, documentation, types, tests].some(stage => typeof stage !== 'function')) {
    throw new TypeError('Fast check requires all declared stages');
  }
  const run = async (name: keyof FastCheckStages, stage: () => Promise<number>): Promise<number> => {
    const code: unknown = await Reflect.apply(stage, stages, []);
    // Keep platform-specific nonzero statuses representable; do not truncate to
    // eight bits or coerce a string/boolean/undefined into an execution result.
    if (typeof code !== 'number' || !Number.isSafeInteger(code) || code < 0) {
      throw new TypeError(`Fast-check stage ${name} must return a non-negative safe-integer exit code`);
    }
    return code;
  };
  const importCode = await run('imports', imports);
  if (importCode !== 0) return importCode;
  // Capture both calls before waiting. A rejection cannot abandon the other
  // check or erase a nonzero exit that the other check already produced.
  const names = ['documentation', 'types'] as const;
  const results = await Promise.allSettled([
    run(names[0], documentation),
    run(names[1], types)
  ]);
  if (results.some(result => result.status === 'rejected')) {
    const failures: unknown[] = [];
    for (let index = 0; index < results.length; index += 1) {
      const result = results[index]!;
      if (result.status === 'rejected') {
        failures.push(result.reason);
      } else if (result.value !== 0) {
        failures.push(Object.assign(
          new Error(`Fast-check stage ${names[index]} exited with status ${result.value}`),
          { stage: names[index], exitCode: result.value }
        ));
      }
    }
    if (failures.length === 1) throw failures[0];
    throw new AggregateError(failures, 'Parallel fast-check stages failed', { cause: failures[0] });
  }
  // Preserve the existing documentation-before-types priority when both
  // workers completed normally, including when both returned nonzero codes.
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value !== 0) return result.value;
  }
  return run('tests', tests);
}
